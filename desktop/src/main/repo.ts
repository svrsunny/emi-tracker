/**
 * Repository: all reads/writes of user data. Independent of Electron so it can be tested
 * against an in-memory database. Every multi-step change runs in one transaction and writes
 * an audit entry. Payment history is never deleted: payments are reversed instead.
 */
import { canonicalJson, countRecords } from '../shared/snapshot';
import { DEFAULT_PREFERENCES, newId } from '../shared/defaults';
import {
  adjustmentSchema, billPaymentSchema, billSchema, categorySchema, debtRepaymentSchema, debtSchema, customReminderSchema, firstError, loanSchema, notificationSchema, paymentSchema, preferencesSchema,
} from '../shared/validation';
import type {
  Adjustment, AuditEntry, Bill, BillPayment, Category, Debt, DebtRepayment, CustomReminder, Loan, NotificationRecord, Payment, Preferences, SnapshotData, SyncTable, Tombstone,
} from '../shared/types';
import type { Db } from './db';
import type { z } from 'zod';

export class ValidationError extends Error {}
export class ConflictError extends Error {
  constructor(message: string, public readonly code: string) { super(message); }
}

/** Device-local settings: never synced, but included in full backups. */
export interface LocalSettings {
  deviceId: string;
  deviceName: string;
  backupDir: string;
  autoBackup: boolean;
  autoBackupHours: number;
  backupKeep: number;
  lastBackupAt: string | null;
  minimizeToTray: boolean;
  launchAtStartup: boolean;
  startHidden: boolean;
  syncEnabled: boolean;
  syncFolder: string;
  syncIntervalMinutes: number;
  syncEncrypted: boolean;
  lastSyncAt: string | null;
  lastSyncResult: string;
  lanEnabled: boolean; // Wi-Fi sync server for paired phones
  lanPort: number;
  onboardingDone: boolean;
}

export const DEFAULT_LOCAL: Omit<LocalSettings, 'deviceId' | 'deviceName' | 'backupDir'> = {
  autoBackup: true, autoBackupHours: 24, backupKeep: 30, lastBackupAt: null, minimizeToTray: true, launchAtStartup: false,
  startHidden: false, syncEnabled: false, syncFolder: '', syncIntervalMinutes: 30, syncEncrypted: false, lastSyncAt: null,
  lastSyncResult: '', lanEnabled: false, lanPort: 47830, onboardingDone: false,
};

const TABLE_SQL: Record<SyncTable, string> = {
  loans: 'loans', adjustments: 'adjustments', payments: 'payments', customReminders: 'custom_reminders',
  notifications: 'notifications', audit: 'audit', categories: 'categories', bills: 'bills', billPayments: 'bill_payments',
  debts: 'debts', debtRepayments: 'debt_repayments',
};

const now = () => new Date().toISOString();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new ValidationError(firstError(r.error));
  return r.data;
}

export class Repo {
  constructor(public readonly db: Db, private readonly deviceIdProvider: () => string = () => 'unknown') {}

  // ------------------------------------------------------------------ reads
  loans(): Loan[] { return this.docs<Loan>('SELECT data FROM loans ORDER BY name'); }
  loan(id: string): Loan | undefined { return this.docs<Loan>('SELECT data FROM loans WHERE id = ?', [id])[0]; }
  payments(): Payment[] { return this.docs<Payment>('SELECT data FROM payments ORDER BY txn_date, id'); }
  payment(id: string): Payment | undefined { return this.docs<Payment>('SELECT data FROM payments WHERE id = ?', [id])[0]; }
  adjustments(): Adjustment[] { return this.docs<Adjustment>('SELECT data FROM adjustments ORDER BY effective_date'); }
  customReminders(): CustomReminder[] { return this.docs<CustomReminder>('SELECT data FROM custom_reminders'); }
  notifications(limit = 5000): NotificationRecord[] {
    return this.docs<NotificationRecord>('SELECT data FROM notifications ORDER BY updated_at DESC LIMIT ?', [limit]);
  }
  notificationByKey(key: string): NotificationRecord | undefined {
    return this.docs<NotificationRecord>('SELECT data FROM notifications WHERE key = ? ORDER BY updated_at DESC LIMIT 1', [key])[0];
  }
  audit(limit = 2000, entityId?: string): AuditEntry[] {
    return entityId
      ? this.docs<AuditEntry>('SELECT data FROM audit WHERE entity_id = ? ORDER BY at DESC LIMIT ?', [entityId, limit])
      : this.docs<AuditEntry>('SELECT data FROM audit ORDER BY at DESC LIMIT ?', [limit]);
  }
  categories(): Category[] { return this.docs<Category>('SELECT data FROM categories'); }
  bills(): Bill[] { return this.docs<Bill>('SELECT data FROM bills ORDER BY name'); }
  billPayments(): BillPayment[] { return this.docs<BillPayment>('SELECT data FROM bill_payments ORDER BY due_date, id'); }
  debts(): Debt[] { return this.docs<Debt>('SELECT data FROM debts ORDER BY person, id'); }
  debtRepayments(): DebtRepayment[] { return this.docs<DebtRepayment>('SELECT data FROM debt_repayments ORDER BY date, id'); }
  tombstones(): Tombstone[] {
    return this.db.all('SELECT id, tbl, deleted_at FROM tombstones').map((r) => ({ id: String(r.id), table: r.tbl as SyncTable, deletedAt: String(r.deleted_at) }));
  }

  preferences(): { value: Preferences; updatedAt: string } {
    const r = this.db.get("SELECT value, updated_at FROM kv WHERE key = 'preferences'");
    if (!r) return { value: DEFAULT_PREFERENCES, updatedAt: '1970-01-01T00:00:00.000Z' };
    const parsed = preferencesSchema.safeParse({ ...DEFAULT_PREFERENCES, ...JSON.parse(String(r.value)) });
    return { value: parsed.success ? parsed.data : DEFAULT_PREFERENCES, updatedAt: String(r.updated_at) };
  }

  local(): LocalSettings {
    const r = this.db.get("SELECT value FROM kv WHERE key = 'local'");
    const stored = r ? (JSON.parse(String(r.value)) as Partial<LocalSettings>) : {};
    return { ...DEFAULT_LOCAL, deviceId: '', deviceName: '', backupDir: '', ...stored } as LocalSettings;
  }

  setLocal(patch: Partial<LocalSettings>): LocalSettings {
    const next = { ...this.local(), ...patch };
    this.db.tx(() => this.db.run("INSERT INTO kv (key, value, updated_at) VALUES ('local', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", [JSON.stringify(next), now()]));
    return next;
  }

  snapshotData(): SnapshotData {
    return {
      loans: this.loans(), adjustments: this.adjustments(), payments: this.payments(), customReminders: this.customReminders(),
      notifications: this.notifications(100000), audit: this.audit(1000000), categories: this.categories(), bills: this.bills(), billPayments: this.billPayments(),
      debts: this.debts(), debtRepayments: this.debtRepayments(),
      tombstones: this.tombstones(),
      preferences: this.preferences(),
    };
  }

  counts(): Record<string, number> { return countRecords(this.snapshotData()); }

  // ------------------------------------------------------------------ writes
  saveLoan(input: Loan): Loan {
    const loan = parse(loanSchema, { ...input, updatedAt: now() }) as Loan;
    return this.db.tx(() => {
      const before = this.loan(loan.id);
      this.upsertLoan(loan);
      this.addAudit('loan', loan.id, before ? 'update' : 'create', before ? `Updated loan “${loan.name}”${diffSummary(before, loan)}` : `Created loan “${loan.name}”`, before, loan);
      return loan;
    });
  }

  setLoanStatus(id: string, status: Loan['status']): Loan {
    const loan = this.loan(id);
    if (!loan) throw new ValidationError('Loan not found');
    return this.saveLoan({ ...loan, status });
  }

  /**
   * Permanently delete a loan with its payments and adjustments. Only callable with the exact
   * loan name as confirmation; the caller must take a recovery backup first.
   */
  deleteLoanPermanently(id: string, confirmName: string): void {
    const loan = this.loan(id);
    if (!loan) throw new ValidationError('Loan not found');
    if (confirmName.trim() !== loan.name.trim()) throw new ValidationError('Type the loan name exactly to confirm deletion');
    this.db.tx(() => {
      const pays = this.db.all('SELECT id FROM payments WHERE loan_id = ?', [id]).map((r) => String(r.id));
      const adjs = this.db.all('SELECT id FROM adjustments WHERE loan_id = ?', [id]).map((r) => String(r.id));
      const ts = now();
      for (const p of pays) this.tombstone('payments', p, ts);
      for (const a of adjs) this.tombstone('adjustments', a, ts);
      this.db.run('DELETE FROM payments WHERE loan_id = ?', [id]);
      this.db.run('DELETE FROM adjustments WHERE loan_id = ?', [id]);
      this.db.run('DELETE FROM loans WHERE id = ?', [id]);
      this.tombstone('loans', id, ts);
      this.addAudit('loan', id, 'delete', `Permanently deleted loan “${loan.name}” with ${pays.length} payment(s) and ${adjs.length} adjustment(s)`, loan, null);
    });
  }

  /** Records that look like an accidental duplicate of `p`. */
  findDuplicates(p: Payment): Payment[] {
    return this.payments().filter((x) => x.id !== p.id && x.status === 'active' && x.loanId === p.loanId && x.type === p.type
      && x.amount === p.amount && (x.txnDate === p.txnDate || (p.installmentNo != null && x.installmentNo === p.installmentNo && ['emi', 'advance'].includes(p.type))));
  }

  savePayment(input: Payment, opts: { allowDuplicate?: boolean } = {}): Payment {
    const p = parse(paymentSchema, { ...input, updatedAt: now() }) as Payment;
    if (!this.loan(p.loanId)) throw new ValidationError('Loan not found');
    const before = this.payment(p.id);
    if (before?.status === 'reversed') throw new ValidationError('A reversed payment cannot be edited; record a new payment instead');
    if (!before && !opts.allowDuplicate) {
      const dup = this.findDuplicates(p);
      if (dup.length) throw new ConflictError(`A ${p.type} payment of ${p.amount} on ${dup[0].txnDate} already exists for this loan`, 'duplicate');
    }
    return this.db.tx(() => {
      this.upsertPayment(p);
      this.addAudit('payment', p.id, before ? 'update' : 'create', before ? `Edited ${p.type} payment ${p.amount} (${p.txnDate})${diffSummary(before, p)}` : `Recorded ${p.type} payment ${p.amount} on ${p.txnDate}`, before, p);
      return p;
    });
  }

  reversePayment(id: string, reason: string): Payment {
    const p = this.payment(id);
    if (!p) throw new ValidationError('Payment not found');
    if (p.status === 'reversed') throw new ValidationError('Payment is already reversed');
    if (!reason.trim()) throw new ValidationError('Give a reason for the reversal');
    const next: Payment = { ...p, status: 'reversed', reversalReason: reason.trim(), reversedAt: now(), updatedAt: now() };
    return this.db.tx(() => {
      this.upsertPayment(next);
      this.addAudit('payment', id, 'reverse', `Reversed ${p.type} payment ${p.amount} (${p.txnDate}): ${reason.trim()}`, p, next);
      return next;
    });
  }

  saveAdjustment(input: Adjustment): Adjustment {
    const a = parse(adjustmentSchema, { ...input, updatedAt: now() }) as Adjustment;
    if (!this.loan(a.loanId)) throw new ValidationError('Loan not found');
    return this.db.tx(() => {
      const before = this.docs<Adjustment>('SELECT data FROM adjustments WHERE id = ?', [a.id])[0];
      this.db.run('INSERT INTO adjustments (id, loan_id, effective_date, updated_at, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET loan_id=excluded.loan_id, effective_date=excluded.effective_date, updated_at=excluded.updated_at, data=excluded.data',
        [a.id, a.loanId, a.effectiveDate, a.updatedAt, JSON.stringify(a)]);
      this.addAudit('adjustment', a.id, before ? 'update' : 'create', `${before ? 'Updated' : 'Added'} ${a.kind} change effective ${a.effectiveDate}`, before, a);
      return a;
    });
  }

  deleteAdjustment(id: string): void {
    const a = this.docs<Adjustment>('SELECT data FROM adjustments WHERE id = ?', [id])[0];
    if (!a) throw new ValidationError('Change not found');
    this.db.tx(() => {
      this.db.run('DELETE FROM adjustments WHERE id = ?', [id]);
      this.tombstone('adjustments', id, now());
      this.addAudit('adjustment', id, 'delete', `Removed ${a.kind} change effective ${a.effectiveDate}`, a, null);
    });
  }

  saveCustomReminder(input: CustomReminder): CustomReminder {
    const r = parse(customReminderSchema, { ...input, updatedAt: now() }) as CustomReminder;
    return this.db.tx(() => {
      this.db.run('INSERT INTO custom_reminders (id, updated_at, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, data=excluded.data', [r.id, r.updatedAt, JSON.stringify(r)]);
      this.addAudit('reminder', r.id, 'save', `Saved reminder “${r.title}”`, null, null);
      return r;
    });
  }

  deleteCustomReminder(id: string): void {
    this.db.tx(() => {
      this.db.run('DELETE FROM custom_reminders WHERE id = ?', [id]);
      this.tombstone('customReminders', id, now());
      this.addAudit('reminder', id, 'delete', 'Deleted a custom reminder', null, null);
    });
  }

  saveBill(input: Bill): Bill {
    const b = parse(billSchema, { ...input, updatedAt: now() }) as Bill;
    const before = this.docs<Bill>('SELECT data FROM bills WHERE id = ?', [b.id])[0];
    return this.db.tx(() => {
      this.db.run('INSERT INTO bills (id, name, updated_at, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at, data=excluded.data', [b.id, b.name, b.updatedAt, JSON.stringify(b)]);
      // a one-time expense whose date is corrected keeps its payment: it moves to the new date
      if (before && b.frequency === 'once' && before.startDate !== b.startDate) {
        for (const p of this.docs<BillPayment>('SELECT data FROM bill_payments WHERE bill_id = ?', [b.id])) {
          const moved = { ...p, dueDate: b.startDate, updatedAt: b.updatedAt };
          this.db.run('UPDATE bill_payments SET due_date = ?, updated_at = ?, data = ? WHERE id = ?', [moved.dueDate, moved.updatedAt, JSON.stringify(moved), p.id]);
        }
      }
      this.addAudit('bill', b.id, before ? 'update' : 'create', before ? `Updated bill “${b.name}”${diffSummary(before, b)}` : `Added bill “${b.name}”`, before ?? null, b);
      return b;
    });
  }

  /** Deletes a bill and its payment records. */
  deleteBill(id: string): void {
    const b = this.docs<Bill>('SELECT data FROM bills WHERE id = ?', [id])[0];
    if (!b) throw new ValidationError('Bill not found');
    const ts = now();
    this.db.tx(() => {
      for (const r of this.db.all('SELECT id FROM bill_payments WHERE bill_id = ?', [id])) this.tombstone('billPayments', String(r.id), ts);
      this.db.run('DELETE FROM bill_payments WHERE bill_id = ?', [id]);
      this.db.run('DELETE FROM bills WHERE id = ?', [id]);
      this.tombstone('bills', id, ts);
      this.addAudit('bill', id, 'delete', `Deleted bill “${b.name}”`, b, null);
    });
  }

  /** Records (or corrects) the payment of one bill due date; one payment per due date. */
  saveBillPayment(input: BillPayment): BillPayment {
    const p = parse(billPaymentSchema, { ...input, updatedAt: now() }) as BillPayment;
    const bill = this.docs<Bill>('SELECT data FROM bills WHERE id = ?', [p.billId])[0];
    if (!bill) throw new ValidationError('Bill not found');
    const other = this.docs<BillPayment>('SELECT data FROM bill_payments WHERE bill_id = ? AND due_date = ? AND id <> ?', [p.billId, p.dueDate, p.id])[0];
    if (other) throw new ConflictError(`${bill.name} is already marked paid for ${p.dueDate}`, 'duplicate');
    return this.db.tx(() => {
      this.db.run('INSERT INTO bill_payments (id, bill_id, due_date, updated_at, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET due_date=excluded.due_date, updated_at=excluded.updated_at, data=excluded.data',
        [p.id, p.billId, p.dueDate, p.updatedAt, JSON.stringify(p)]);
      this.addAudit('bill', p.billId, 'pay', `Paid ${bill.name} (due ${p.dueDate}): ${p.amount}`, null, p);
      return p;
    });
  }

  deleteBillPayment(id: string): void {
    const p = this.docs<BillPayment>('SELECT data FROM bill_payments WHERE id = ?', [id])[0];
    if (!p) throw new ValidationError('Payment not found');
    this.db.tx(() => {
      this.db.run('DELETE FROM bill_payments WHERE id = ?', [id]);
      this.tombstone('billPayments', id, now());
      this.addAudit('bill', p.billId, 'unpay', `Marked unpaid (due ${p.dueDate})`, p, null);
    });
  }

  saveCategory(input: Category): Category {
    const c = parse(categorySchema, { ...input, updatedAt: now() }) as Category;
    this.db.tx(() => this.db.run('INSERT INTO categories (id, updated_at, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, data=excluded.data', [c.id, c.updatedAt, JSON.stringify(c)]));
    return c;
  }

  deleteCategory(id: string): void {
    this.db.tx(() => {
      this.db.run('DELETE FROM categories WHERE id = ?', [id]);
      this.tombstone('categories', id, now());
    });
  }

  saveNotification(input: NotificationRecord): NotificationRecord {
    const n = parse(notificationSchema, { ...input, updatedAt: now() }) as NotificationRecord;
    this.db.tx(() => this.db.run('INSERT INTO notifications (id, key, updated_at, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET key=excluded.key, updated_at=excluded.updated_at, data=excluded.data', [n.id, n.key, n.updatedAt, JSON.stringify(n)]));
    return n;
  }

  setPreferences(value: Preferences): Preferences {
    const v = parse(preferencesSchema, value) as Preferences;
    this.db.tx(() => {
      const before = this.preferences().value;
      this.db.run("INSERT INTO kv (key, value, updated_at) VALUES ('preferences', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", [JSON.stringify(v), now()]);
      this.addAudit('settings', null, 'update', `Updated preferences${diffSummary(before, v)}`, null, null);
    });
    return v;
  }

  addBackupHistory(h: { kind: string; path: string; size: number; encrypted: boolean; checksum: string; counts: Record<string, number>; ok: boolean; message: string }): void {
    this.db.tx(() => this.db.run('INSERT INTO backup_history (id, created_at, kind, path, size, encrypted, checksum, counts, ok, message) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [newId(), now(), h.kind, h.path, h.size, h.encrypted ? 1 : 0, h.checksum, JSON.stringify(h.counts), h.ok ? 1 : 0, h.message]));
  }

  backupHistory(limit = 200) {
    return this.db.all('SELECT * FROM backup_history ORDER BY created_at DESC LIMIT ?', [limit]).map((r) => ({
      id: String(r.id), createdAt: String(r.created_at), kind: String(r.kind), path: String(r.path), size: Number(r.size),
      encrypted: r.encrypted === 1, checksum: String(r.checksum), counts: JSON.parse(String(r.counts)) as Record<string, number>,
      ok: r.ok === 1, message: String(r.message),
    }));
  }

  /**
   * Replace all synced data with `data` (restore) in a single transaction. Device-local
   * settings and backup history are kept.
   */
  // ---------------------------------------------------------------- lending & borrowing
  private repaidSoFar(debtId: string, exceptId: string | null): number {
    return this.docs<DebtRepayment>('SELECT data FROM debt_repayments WHERE debt_id = ?', [debtId]).filter((r) => r.id !== exceptId).reduce((s, r) => s + Math.round(+r.amount * 100), 0);
  }

  saveDebt(input: Debt): Debt {
    const d = parse(debtSchema, { ...input, updatedAt: now() }) as Debt;
    const before = this.docs<Debt>('SELECT data FROM debts WHERE id = ?', [d.id])[0];
    const repaid = this.repaidSoFar(d.id, null);
    if (Math.round(+d.amount * 100) < repaid) throw new ValidationError(`Amount cannot be less than what was already returned (${(repaid / 100).toFixed(2)})`);
    const what = d.direction === 'lent' ? `Lent to ${d.person}` : `Borrowed from ${d.person}`;
    return this.db.tx(() => {
      this.db.run('INSERT INTO debts (id, person, updated_at, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET person=excluded.person, updated_at=excluded.updated_at, data=excluded.data', [d.id, d.person, d.updatedAt, JSON.stringify(d)]);
      this.addAudit('debt', d.id, before ? 'update' : 'create', before ? `Updated “${what}”${diffSummary(before, d)}` : `${what}: ${d.amount}`, before ?? null, d);
      return d;
    });
  }

  /** Deletes an entry and its repayments. */
  deleteDebt(id: string): void {
    const d = this.docs<Debt>('SELECT data FROM debts WHERE id = ?', [id])[0];
    if (!d) throw new ValidationError('Entry not found');
    const ts = now();
    this.db.tx(() => {
      for (const r of this.db.all('SELECT id FROM debt_repayments WHERE debt_id = ?', [id])) this.tombstone('debtRepayments', String(r.id), ts);
      this.db.run('DELETE FROM debt_repayments WHERE debt_id = ?', [id]);
      this.db.run('DELETE FROM debts WHERE id = ?', [id]);
      this.tombstone('debts', id, ts);
      this.addAudit('debt', id, 'delete', `Deleted “${d.direction === 'lent' ? 'Lent to' : 'Borrowed from'} ${d.person}”`, d, null);
    });
  }

  /** Records (or corrects) a repayment; the total returned can never exceed the amount. */
  saveDebtRepayment(input: DebtRepayment): DebtRepayment {
    const r = parse(debtRepaymentSchema, { ...input, updatedAt: now() }) as DebtRepayment;
    const d = this.docs<Debt>('SELECT data FROM debts WHERE id = ?', [r.debtId])[0];
    if (!d) throw new ValidationError('Entry not found');
    const pending = Math.round(+d.amount * 100) - this.repaidSoFar(d.id, r.id);
    if (Math.round(+r.amount * 100) > pending) throw new ValidationError(`Only ${(pending / 100).toFixed(2)} is still pending`);
    return this.db.tx(() => {
      this.db.run('INSERT INTO debt_repayments (id, debt_id, date, updated_at, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET date=excluded.date, updated_at=excluded.updated_at, data=excluded.data',
        [r.id, r.debtId, r.date, r.updatedAt, JSON.stringify(r)]);
      this.addAudit('debt', d.id, 'repay', `${d.direction === 'lent' ? `Received from ${d.person}` : `Repaid to ${d.person}`}: ${r.amount}`, null, r);
      return r;
    });
  }

  deleteDebtRepayment(id: string): void {
    const r = this.docs<DebtRepayment>('SELECT data FROM debt_repayments WHERE id = ?', [id])[0];
    if (!r) throw new ValidationError('Repayment not found');
    this.db.tx(() => {
      this.db.run('DELETE FROM debt_repayments WHERE id = ?', [id]);
      this.tombstone('debtRepayments', id, now());
      this.addAudit('debt', r.debtId, 'unrepay', `Removed a repayment of ${r.amount} (${r.date})`, r, null);
    });
  }

  replaceAll(data: SnapshotData): void {
    this.db.tx(() => {
      for (const t of ['payments', 'adjustments', 'loans', 'custom_reminders', 'notifications', 'audit', 'categories', 'bill_payments', 'bills', 'debt_repayments', 'debts', 'tombstones']) this.db.run(`DELETE FROM ${t}`);
      this.writeData(data);
    });
  }

  /** Apply merged sync data: upsert everything, delete records removed by tombstones. */
  applyMerged(data: SnapshotData): void {
    this.db.tx(() => {
      const keep = {
        loans: new Set(data.loans.map((x) => x.id)), adjustments: new Set(data.adjustments.map((x) => x.id)),
        payments: new Set(data.payments.map((x) => x.id)), customReminders: new Set(data.customReminders.map((x) => x.id)),
        notifications: new Set(data.notifications.map((x) => x.id)), audit: new Set(data.audit.map((x) => x.id)),
        categories: new Set(data.categories.map((x) => x.id)), bills: new Set(data.bills.map((x) => x.id)),
        billPayments: new Set(data.billPayments.map((x) => x.id)),
        debts: new Set(data.debts.map((x) => x.id)), debtRepayments: new Set(data.debtRepayments.map((x) => x.id)),
      };
      // children first to respect foreign keys
      for (const t of ['payments', 'adjustments', 'customReminders', 'notifications', 'audit', 'categories', 'billPayments', 'bills', 'debtRepayments', 'debts', 'loans'] as SyncTable[]) {
        const sqlT = TABLE_SQL[t];
        for (const r of this.db.all(`SELECT id FROM ${sqlT}`)) if (!keep[t].has(String(r.id))) this.db.run(`DELETE FROM ${sqlT} WHERE id = ?`, [String(r.id)]);
      }
      this.db.run('DELETE FROM tombstones');
      this.writeData(data);
    });
  }

  private writeData(data: SnapshotData): void {
    for (const l of data.loans) this.upsertLoan(l);
    for (const a of data.adjustments) this.db.run('INSERT OR REPLACE INTO adjustments (id, loan_id, effective_date, updated_at, data) VALUES (?, ?, ?, ?, ?)', [a.id, a.loanId, a.effectiveDate, a.updatedAt, JSON.stringify(a)]);
    for (const p of data.payments) this.upsertPayment(p);
    for (const r of data.customReminders) this.db.run('INSERT OR REPLACE INTO custom_reminders (id, updated_at, data) VALUES (?, ?, ?)', [r.id, r.updatedAt, JSON.stringify(r)]);
    for (const n of data.notifications) this.db.run('INSERT OR REPLACE INTO notifications (id, key, updated_at, data) VALUES (?, ?, ?, ?)', [n.id, n.key, n.updatedAt, JSON.stringify(n)]);
    for (const a of data.audit) this.db.run('INSERT OR REPLACE INTO audit (id, at, entity, entity_id, data) VALUES (?, ?, ?, ?, ?)', [a.id, a.at, a.entity, a.entityId, JSON.stringify(a)]);
    for (const c of data.categories) this.db.run('INSERT OR REPLACE INTO categories (id, updated_at, data) VALUES (?, ?, ?)', [c.id, c.updatedAt, JSON.stringify(c)]);
    // upsert, not REPLACE: REPLACE deletes the row first, which its payments' foreign key forbids
    for (const b of data.bills) this.db.run('INSERT INTO bills (id, name, updated_at, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at, data=excluded.data', [b.id, b.name, b.updatedAt, JSON.stringify(b)]);
    for (const p of data.billPayments) this.db.run('INSERT OR REPLACE INTO bill_payments (id, bill_id, due_date, updated_at, data) VALUES (?, ?, ?, ?, ?)', [p.id, p.billId, p.dueDate, p.updatedAt, JSON.stringify(p)]);
    // upsert, not REPLACE: REPLACE deletes the row first, which its repayments' foreign key forbids
    for (const d of data.debts ?? []) this.db.run('INSERT INTO debts (id, person, updated_at, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET person=excluded.person, updated_at=excluded.updated_at, data=excluded.data', [d.id, d.person, d.updatedAt, JSON.stringify(d)]);
    for (const r of data.debtRepayments ?? []) this.db.run('INSERT OR REPLACE INTO debt_repayments (id, debt_id, date, updated_at, data) VALUES (?, ?, ?, ?, ?)', [r.id, r.debtId, r.date, r.updatedAt, JSON.stringify(r)]);
    for (const t of data.tombstones) this.db.run('INSERT OR REPLACE INTO tombstones (id, tbl, deleted_at) VALUES (?, ?, ?)', [t.id, t.table, t.deletedAt]);
    this.db.run("INSERT INTO kv (key, value, updated_at) VALUES ('preferences', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", [JSON.stringify(data.preferences.value), data.preferences.updatedAt]);
  }

  addAudit(entity: AuditEntry['entity'], entityId: string | null, action: string, summary: string, before: unknown, after: unknown): void {
    const ts = now();
    const a: AuditEntry = {
      id: newId(), createdAt: ts, updatedAt: ts, at: ts, entity, entityId, action, summary,
      before: before ? canonicalJson(before) : null, after: after ? canonicalJson(after) : null, deviceId: this.deviceIdProvider(),
    };
    this.db.tx(() => this.db.run('INSERT INTO audit (id, at, entity, entity_id, data) VALUES (?, ?, ?, ?, ?)', [a.id, a.at, a.entity, a.entityId, JSON.stringify(a)]));
  }

  private upsertLoan(l: Loan) {
    this.db.run('INSERT INTO loans (id, name, status, updated_at, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, status=excluded.status, updated_at=excluded.updated_at, data=excluded.data',
      [l.id, l.name, l.status, l.updatedAt, JSON.stringify(l)]);
  }

  private upsertPayment(p: Payment) {
    this.db.run(`INSERT INTO payments (id, loan_id, txn_date, installment_no, type, amount, status, updated_at, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET loan_id=excluded.loan_id, txn_date=excluded.txn_date, installment_no=excluded.installment_no, type=excluded.type,
      amount=excluded.amount, status=excluded.status, updated_at=excluded.updated_at, data=excluded.data`,
    [p.id, p.loanId, p.txnDate, p.installmentNo, p.type, p.amount, p.status, p.updatedAt, JSON.stringify(p)]);
  }

  private tombstone(table: SyncTable, id: string, ts: string) {
    this.db.run('INSERT OR REPLACE INTO tombstones (id, tbl, deleted_at) VALUES (?, ?, ?)', [id, table, ts]);
  }

  private docs<T>(sql: string, params: (string | number | null)[] = []): T[] {
    return this.db.all(sql, params).map((r) => JSON.parse(String(r.data)) as T);
  }
}

/** Short list of changed field names for audit summaries (values omitted on purpose). */
function diffSummary(a: object, b: object): string {
  const ra = a as Record<string, unknown>, rb = b as Record<string, unknown>;
  const changed = Object.keys(rb).filter((k) => k !== 'updatedAt' && JSON.stringify(ra[k]) !== JSON.stringify(rb[k]));
  return changed.length ? ` (${changed.slice(0, 8).join(', ')}${changed.length > 8 ? '…' : ''})` : '';
}
