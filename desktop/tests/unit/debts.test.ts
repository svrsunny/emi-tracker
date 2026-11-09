/** One-time expenses and lending & borrowing: summaries, reminders, storage and sync. */
import { describe, expect, it } from 'vitest';
import { billDueDates, monthlyExpenses, nextBillDue, spendingByDay, spendTotals } from '../../src/shared/bills';
import { makeLoan, pay } from './fixtures';
import { debtStats, debtSummary } from '../../src/shared/debts';
import { blankBill, blankDebt, DEFAULT_PREFERENCES } from '../../src/shared/defaults';
import { DEFAULT_REMINDER_SETTINGS, dueReminders } from '../../src/shared/reminders';
import { mergeData, normalizeData } from '../../src/shared/snapshot';
import { billSchema, debtSchema, notificationSchema, snapshotDataSchema } from '../../src/shared/validation';
import { Db } from '../../src/main/db';
import { Repo } from '../../src/main/repo';
import type { Bill, Debt, DebtRepayment, SnapshotData } from '../../src/shared/types';

const TS = '2026-01-01T00:00:00.000Z';
const once = (over: Partial<Bill> = {}): Bill => ({ ...blankBill('2026-02-10'), id: 'O1', createdAt: TS, updatedAt: TS, name: 'Car service', category: 'other', amount: '4500.00', frequency: 'once', ...over });
const debt = (over: Partial<Debt> = {}): Debt => ({ ...blankDebt('2026-01-05'), id: 'D1', createdAt: TS, updatedAt: TS, person: 'Ravi', amount: '10000.00', dueDate: '2026-03-01', ...over });
const rp = (over: Partial<DebtRepayment> = {}): DebtRepayment => ({ id: 'R1', createdAt: TS, updatedAt: TS, debtId: 'D1', date: '2026-02-01', amount: '4000.00', notes: '', ...over });
const empty: SnapshotData = { loans: [], adjustments: [], payments: [], customReminders: [], notifications: [], audit: [], categories: [], bills: [], billPayments: [], debts: [], debtRepayments: [], tombstones: [], preferences: { value: DEFAULT_PREFERENCES, updatedAt: TS } };

describe('one-time expenses', () => {
  it('has a single due date and shows in its own month only', () => {
    expect(billSchema.safeParse(once()).success).toBe(true);
    expect(billDueDates(once(), '2026-01-01', '2026-12-31')).toEqual(['2026-02-10']);
    expect(billDueDates(once(), '2026-03-01', '2026-12-31')).toEqual([]);
    const feb = monthlyExpenses({ loans: [], comps: new Map(), bills: [once()], billPayments: [], month: '2026-02', asOf: '2026-02-05' });
    expect(feb.items.map((x) => [x.name, x.expected, x.status, x.detail])).toEqual([['Car service', '4500.00', 'upcoming', 'one-time']]);
    expect(monthlyExpenses({ loans: [], comps: new Map(), bills: [once()], billPayments: [], month: '2026-03', asOf: '2026-02-05' }).items).toEqual([]);
    // paid: nothing left to remind about
    const paid = [{ id: 'P1', createdAt: TS, updatedAt: TS, billId: 'O1', dueDate: '2026-02-10', paidDate: '2026-02-10', amount: '4300.00', notes: '' }];
    expect(nextBillDue(once(), paid, '2026-02-12')).toBeNull();
  });

  it('keeps the payment when the date of a paid one-time expense is corrected', async () => {
    const repo = new Repo(await Db.open(null), () => 'test');
    repo.saveBill(once());
    repo.saveBillPayment({ id: 'P1', createdAt: TS, updatedAt: TS, billId: 'O1', dueDate: '2026-02-10', paidDate: '2026-02-10', amount: '4300.00', notes: '' });
    repo.saveBill(once({ startDate: '2026-02-12', dueDay: 12 }));
    expect(repo.billPayments().map((p) => [p.dueDate, p.paidDate])).toEqual([['2026-02-12', '2026-02-10']]);
    expect(nextBillDue(repo.bills()[0], repo.billPayments(), '2026-02-20')).toBeNull();
  });
});

describe('spending by day', () => {
  it('counts loan, chit, bill and one-time payments on the day they were paid', () => {
    const home = makeLoan({ id: 'H', name: 'Home' });
    const chit = makeLoan({ id: 'K', name: 'Chit', loanType: 'chit_fund' });
    const pays = [pay({ id: 'p1', loanId: 'H', txnDate: '2026-02-05', amount: '10000.00' }), pay({ id: 'p2', loanId: 'K', txnDate: '2026-02-05', amount: '4600.00' }),
      { ...pay({ id: 'p3', loanId: 'H', txnDate: '2026-02-06', amount: '500.00' }), status: 'reversed' as const }];
    const rent: Bill = { ...once(), id: 'B1', name: 'Rent', frequency: 'monthly', startDate: '2026-01-05', dueDay: 5, amount: '15000.00' };
    const bps = [{ id: 'BP1', createdAt: TS, updatedAt: TS, billId: 'B1', dueDate: '2026-02-05', paidDate: '2026-02-05', amount: '15000.00', notes: '' },
      { id: 'OP1', createdAt: TS, updatedAt: TS, billId: 'O1', dueDate: '2026-02-10', paidDate: '2026-02-07', amount: '4300.00', notes: '' }];
    const days = spendingByDay({ loans: [home, chit], payments: pays, bills: [rent, once()], billPayments: bps, from: '2026-02-01', to: '2026-02-28' });
    expect(days.get('2026-02-05')!.map((x) => [x.kind, x.amount])).toEqual([['loan', '10000.00'], ['chit', '4600.00'], ['bill', '15000.00']]);
    expect(days.get('2026-02-06')).toBeUndefined(); // reversed payments are not spending
    expect(days.get('2026-02-07')!.map((x) => x.kind)).toEqual(['one_time']); // by the day it was paid, not its due date
    expect(spendTotals(days.get('2026-02-05')!)).toEqual({ all: '29600.00', loan: '10000.00', chit: '4600.00', bill: '15000.00', one_time: '0.00' });
    // one loan selected: only that loan, no bills
    const one = spendingByDay({ loans: [home, chit], payments: pays, bills: [rent], billPayments: bps, from: '2026-02-01', to: '2026-02-28', loanIds: ['H'] });
    expect([...one.values()].flat().map((x) => x.refId)).toEqual(['H']);
  });
});

describe('lending & borrowing', () => {
  it('validates', () => {
    expect(debtSchema.safeParse(debt()).success).toBe(true);
    expect(debtSchema.safeParse(debt({ amount: '0.00' })).success).toBe(false);
    expect(debtSchema.safeParse(debt({ person: ' ' })).success).toBe(false);
    expect(debtSchema.safeParse(debt({ dueDate: '2025-12-31' })).success).toBe(false);
  });

  it('works out what is pending and totals per side', () => {
    expect(debtSummary(debt(), [rp()], '2026-02-10')).toMatchObject({ repaid: '4000.00', pending: '6000.00', status: 'pending' });
    expect(debtSummary(debt(), [rp()], '2026-03-01').status).toBe('due');
    expect(debtSummary(debt(), [rp()], '2026-03-02').status).toBe('overdue');
    expect(debtSummary(debt(), [rp(), rp({ id: 'R2', amount: '6000.00' })], '2026-04-01')).toMatchObject({ pending: '0.00', status: 'settled' });
    expect(debtSummary(debt({ dueDate: null }), [], '2030-01-01').status).toBe('pending');
    const all = [debt(), debt({ id: 'D2', direction: 'borrowed', person: 'Uncle', amount: '25000.00' }), debt({ id: 'D3', amount: '500.00' })];
    const rows = all.map((d) => ({ d, s: debtSummary(d, [rp(), rp({ id: 'R3', debtId: 'D3', amount: '500.00' })], '2026-02-10') }));
    // the totals follow what is listed: open entries, settled ones, or everything
    expect(debtStats(rows.filter((r) => r.s.status !== 'settled'))).toEqual({
      lent: { amount: '10000.00', repaid: '4000.00', pending: '6000.00', count: 1 }, borrowed: { amount: '25000.00', repaid: '0.00', pending: '25000.00', count: 1 } });
    expect(debtStats(rows.filter((r) => r.s.status === 'settled')).lent).toEqual({ amount: '500.00', repaid: '500.00', pending: '0.00', count: 1 });
    expect(debtStats(rows).lent).toEqual({ amount: '10500.00', repaid: '4500.00', pending: '6000.00', count: 2 });
  });

  it('reminds the day before, on and after the return date, never once settled', () => {
    const base = {
      settings: { ...DEFAULT_REMINDER_SETTINGS, quietEnabled: false }, loans: [], comps: new Map(), adjustments: [], custom: [], bills: [], billPayments: [], history: [],
      lastBackupDate: '2026-02-28', formatMoney: (a: string) => `₹${a}`, formatDate: (d: string) => d,
    };
    const at = (now: string, repayments: DebtRepayment[] = [], d = debt()) => dueReminders({ ...base, now, debts: [d], debtRepayments: repayments }).filter((r) => r.category === 'debt');
    expect(at('2026-02-28T09:00').map((r) => [r.key, r.title])).toEqual([['debt:D1:2026-03-01:1', 'Collect ₹10000.00 from Ravi tomorrow']]);
    expect(at('2026-03-01T09:00', [rp()]).map((r) => r.title)).toContain('Collect ₹6000.00 from Ravi today');
    expect(at('2026-03-02T09:00', [], debt({ direction: 'borrowed' })).map((r) => r.key)).toContain('debt_overdue:D1:2026-03-01');
    expect(at('2026-03-01T09:00', [rp({ amount: '10000.00' })])).toEqual([]);
    expect(at('2026-03-01T09:00', [], debt({ reminderEnabled: false }))).toEqual([]);
    const sent = { id: 'N1', createdAt: TS, updatedAt: TS, key: 'debt_due:D1:2026-03-01', category: 'debt', title: 't', body: 'b', loanId: null,
      scheduledFor: '2026-03-01T09:00', deliveredAt: TS, state: 'sent', snoozedUntil: null, channel: 'in_app', late: false, deviceId: 'pc' };
    expect(notificationSchema.safeParse(sent).success).toBe(true);
  });

  it('merges between devices, drops repayments of deleted entries, and reads backups made before it existed', () => {
    const phone = { ...empty, debts: [debt({ updatedAt: '2026-02-02T00:00:00.000Z', amount: '12000.00' })], debtRepayments: [rp()] };
    const { data } = mergeData({ ...empty, debts: [debt()] }, phone);
    expect(data.debts[0].amount).toBe('12000.00');
    expect(data.debtRepayments).toHaveLength(1);
    const gone = mergeData(data, { ...empty, tombstones: [{ id: 'D1', table: 'debts', deletedAt: '2026-03-01T00:00:00.000Z' }] }).data;
    expect(gone.debts).toEqual([]);
    expect(gone.debtRepayments).toEqual([]);
    // an old backup without the new tables still parses, and its checksum input is unchanged
    const { debts: _d, debtRepayments: _r, ...old } = empty;
    const parsed = snapshotDataSchema.parse(old);
    expect(parsed.debts).toEqual([]);
    expect('debts' in normalizeData(old as SnapshotData)).toBe(true);
    expect(JSON.stringify(normalizeData(old as SnapshotData))).toBe(JSON.stringify(normalizeData(old as SnapshotData)));
  });

  it('stores entries, refuses returning more than is pending, and deletes with tombstones', async () => {
    const repo = new Repo(await Db.open(null), () => 'test');
    repo.saveDebt(debt());
    repo.saveDebtRepayment(rp());
    expect(() => repo.saveDebtRepayment(rp({ id: 'R2', amount: '6000.01' }))).toThrow(/Only 6000.00 is still pending/);
    repo.saveDebtRepayment(rp({ id: 'R2', amount: '6000.00' }));
    // correcting a repayment counts everything except itself
    repo.saveDebtRepayment(rp({ amount: '3000.00' }));
    expect(() => repo.saveDebt(debt({ amount: '8000.00' }))).toThrow(/cannot be less than/);
    // a sync merge re-writes an entry that has repayments (upsert, not REPLACE)
    repo.applyMerged(repo.snapshotData());
    expect(repo.snapshotData().debtRepayments).toHaveLength(2);
    repo.deleteDebt('D1');
    const snap = repo.snapshotData();
    expect(snap.debts).toEqual([]);
    expect(snap.debtRepayments).toEqual([]);
    expect(snap.tombstones.map((t) => t.table).sort()).toEqual(['debtRepayments', 'debtRepayments', 'debts']);
  });
});
