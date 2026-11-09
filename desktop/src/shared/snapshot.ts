/**
 * Snapshot helpers shared by backup, restore, sync and export.
 *
 * Canonical JSON: object keys sorted recursively, no whitespace. The snapshot checksum is
 * SHA-256 over the canonical JSON of `data`. The Android app uses the same canonicalization,
 * so checksums verify across platforms.
 */
import type {
  AuditEntry, Bill, BillPayment, Category, Debt, DebtRepayment, CustomReminder, Loan, NotificationRecord, Payment, Adjustment, SnapshotData, SyncTable, Tombstone,
} from './types';

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export function countRecords(d: SnapshotData): Record<string, number> {
  return {
    loans: d.loans.length, adjustments: d.adjustments.length, payments: d.payments.length,
    customReminders: d.customReminders.length, notifications: d.notifications.length, audit: d.audit.length,
    categories: d.categories.length, bills: d.bills.length, billPayments: d.billPayments.length,
    debts: d.debts?.length ?? 0, debtRepayments: d.debtRepayments?.length ?? 0, tombstones: d.tombstones.length,
  };
}

export const SYNC_TABLES: SyncTable[] = ['loans', 'adjustments', 'payments', 'customReminders', 'notifications', 'audit', 'categories', 'bills', 'billPayments', 'debts', 'debtRepayments'];

type Rec = { id: string; updatedAt: string };

/** Deterministic last-writer-wins: newer updatedAt wins; ties broken by canonical JSON. */
function newer<T extends Rec>(a: T, b: T): T {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  return canonicalJson(a) >= canonicalJson(b) ? a : b;
}

export interface MergeStats {
  added: number;
  updated: number;
  deleted: number;
  unchanged: number;
  preferencesUpdated: boolean;
}

/**
 * Merge a remote snapshot into local data. Commutative and idempotent: merging A into B and
 * B into A produce the same result, and re-merging changes nothing.
 */
export function mergeData(local: SnapshotData, remote: SnapshotData): { data: SnapshotData; stats: MergeStats } {
  const stats: MergeStats = { added: 0, updated: 0, deleted: 0, unchanged: 0, preferencesUpdated: false };
  const tomb = new Map<string, Tombstone>();
  for (const t of [...local.tombstones, ...remote.tombstones]) {
    const k = `${t.table}:${t.id}`;
    const cur = tomb.get(k);
    if (!cur || t.deletedAt > cur.deletedAt) tomb.set(k, t);
  }
  const mergeTable = <T extends Rec>(table: SyncTable, a: T[], b: T[]): T[] => {
    const map = new Map<string, T>(a.map((r) => [r.id, r]));
    for (const r of b) {
      const cur = map.get(r.id);
      if (!cur) { map.set(r.id, r); stats.added++; continue; }
      const win = newer(cur, r);
      if (win !== cur) { map.set(r.id, win); stats.updated++; } else stats.unchanged++;
    }
    const out: T[] = [];
    for (const r of map.values()) {
      const t = tomb.get(`${table}:${r.id}`);
      if (t && t.deletedAt >= r.updatedAt) {
        if (a.some((x) => x.id === r.id)) stats.deleted++;
        continue;
      }
      out.push(r);
    }
    return out.sort((x, y) => x.id.localeCompare(y.id));
  };
  const prefs = local.preferences.updatedAt >= remote.preferences.updatedAt ? local.preferences : remote.preferences;
  stats.preferencesUpdated = prefs !== local.preferences;
  const data: SnapshotData = {
    loans: mergeTable<Loan>('loans', local.loans, remote.loans),
    adjustments: mergeTable<Adjustment>('adjustments', local.adjustments, remote.adjustments),
    payments: mergeTable<Payment>('payments', local.payments, remote.payments),
    customReminders: mergeTable<CustomReminder>('customReminders', local.customReminders, remote.customReminders),
    notifications: mergeTable<NotificationRecord>('notifications', local.notifications, remote.notifications),
    audit: mergeTable<AuditEntry>('audit', local.audit, remote.audit),
    categories: mergeTable<Category>('categories', local.categories, remote.categories),
    bills: mergeTable<Bill>('bills', local.bills, remote.bills),
    billPayments: mergeTable<BillPayment>('billPayments', local.billPayments, remote.billPayments),
    debts: mergeTable<Debt>('debts', local.debts ?? [], remote.debts ?? []),
    debtRepayments: mergeTable<DebtRepayment>('debtRepayments', local.debtRepayments ?? [], remote.debtRepayments ?? []),
    tombstones: [...tomb.values()].sort((x, y) => `${x.table}:${x.id}`.localeCompare(`${y.table}:${y.id}`)),
    preferences: prefs,
  };
  // referential integrity: drop children whose loan no longer exists
  const loanIds = new Set(data.loans.map((l) => l.id));
  data.adjustments = data.adjustments.filter((x) => loanIds.has(x.loanId));
  data.payments = data.payments.filter((x) => loanIds.has(x.loanId));
  data.customReminders = data.customReminders.map((r) => (r.loanId && !loanIds.has(r.loanId) ? { ...r, loanId: null } : r));
  const billIds = new Set(data.bills.map((b) => b.id));
  data.billPayments = data.billPayments.filter((x) => billIds.has(x.billId));
  const debtIds = new Set(data.debts.map((d) => d.id));
  data.debtRepayments = data.debtRepayments.filter((x) => debtIds.has(x.debtId));
  return { data, stats };
}

/** Sort every table by id so the checksum does not depend on storage order. */
export function normalizeData(d: SnapshotData): SnapshotData {
  // tables missing from older backups (e.g. bills) stay missing, so their checksum still verifies
  const byId = <T extends { id: string }>(xs: T[]) => (xs ? [...xs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) : xs);
  return {
    loans: byId(d.loans), adjustments: byId(d.adjustments), payments: byId(d.payments), customReminders: byId(d.customReminders),
    notifications: byId(d.notifications), audit: byId(d.audit), categories: byId(d.categories), bills: byId(d.bills), billPayments: byId(d.billPayments),
    debts: byId(d.debts), debtRepayments: byId(d.debtRepayments),
    tombstones: [...d.tombstones].sort((a, b) => {
      const x = `${a.table}:${a.id}`, y = `${b.table}:${b.id}`;
      return x < y ? -1 : x > y ? 1 : 0;
    }),
    preferences: d.preferences,
  };
}
