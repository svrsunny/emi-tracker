/** Recurring bills: due dates, monthly expenses, reminders, storage and sync. */
import { describe, expect, it } from 'vitest';
import { billDueDates, monthlyExpenses, nextBillDue } from '../../src/shared/bills';
import { computeLoan } from '../../src/shared/engine';
import { DEFAULT_REMINDER_SETTINGS, dueReminders } from '../../src/shared/reminders';
import { mergeData } from '../../src/shared/snapshot';
import { blankBill, DEFAULT_PREFERENCES } from '../../src/shared/defaults';
import { billSchema, notificationSchema } from '../../src/shared/validation';
import { Db } from '../../src/main/db';
import { Repo } from '../../src/main/repo';
import type { Bill, BillPayment, SnapshotData } from '../../src/shared/types';
import { makeLoan, pay } from './fixtures';

const TS = '2026-01-01T00:00:00.000Z';
const bill = (over: Partial<Bill> = {}): Bill => ({ ...blankBill('2026-01-31'), id: 'B1', createdAt: TS, updatedAt: TS, name: 'Rent', category: 'rent', amount: '15000.00', ...over });
const bp = (over: Partial<BillPayment>): BillPayment => ({ id: 'BP1', createdAt: TS, updatedAt: TS, billId: 'B1', dueDate: '2026-01-31', paidDate: '2026-01-30', amount: '15000.00', notes: '', ...over });

describe('bills', () => {
  it('validates', () => {
    expect(billSchema.safeParse(bill()).success).toBe(true);
    expect(billSchema.safeParse(bill({ amount: '0.00' })).success).toBe(false);
    expect(billSchema.safeParse(bill({ endDate: '2025-01-01' })).success).toBe(false);
  });

  it('clamps the due day to short months and honours frequency and end date', () => {
    expect(billDueDates(bill(), '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(billDueDates(bill({ frequency: 'quarterly' }), '2026-01-01', '2026-12-31')).toEqual(['2026-01-31', '2026-04-30', '2026-07-31', '2026-10-31']);
    expect(billDueDates(bill({ endDate: '2026-03-15' }), '2026-01-01', '2026-12-31')).toEqual(['2026-01-31', '2026-02-28']);
    expect(billDueDates(bill({ frequency: 'yearly', startDate: '2024-02-29', dueDay: 29 }), '2024-01-01', '2026-12-31')).toEqual(['2024-02-29', '2025-02-28', '2026-02-28']);
  });

  it('finds the next unpaid due date, oldest overdue first', () => {
    expect(nextBillDue(bill(), [], '2026-03-10')).toEqual({ dueDate: '2026-01-31', overdue: true });
    const paid = [bp({}), bp({ id: 'BP2', dueDate: '2026-02-28' })];
    expect(nextBillDue(bill(), paid, '2026-03-10')).toEqual({ dueDate: '2026-03-31', overdue: false });
  });

  it('adds loans, chits and bills into monthly expenses', () => {
    const home = makeLoan({ id: 'H', name: 'Home', principal: '120000.00', annualRate: '0', interestMethod: 'flat', emiAmount: '10000.00', totalInstallments: 12, firstEmiDate: '2026-02-05', emiDueDay: 5, startDate: '2026-01-05', trackingStartDate: '2026-01-05' });
    const chit = makeLoan({ id: 'K', name: 'Chit', loanType: 'chit_fund', principal: '100000.00', annualRate: '0', interestMethod: 'flat', emiAmount: '5000.00', totalInstallments: 20, firstEmiDate: '2026-02-10', emiDueDay: 10, startDate: '2026-02-10', trackingStartDate: '2026-02-10' });
    const payments = [pay({ loanId: 'K', installmentNo: 1, txnDate: '2026-02-10', amount: '4600.00' })];
    const comps = new Map([[home.id, computeLoan(home, [], [], '2026-02-20')], [chit.id, computeLoan(chit, [], payments, '2026-02-20')]]);
    const electricity = bill({ id: 'B2', name: 'Electricity', category: 'electricity', amount: '1800.00', variable: true, dueDay: 15, startDate: '2026-01-15' });
    const m = monthlyExpenses({ loans: [home, chit], comps, bills: [bill(), electricity], billPayments: [bp({ billId: 'B2', dueDate: '2026-02-15', amount: '2140.00' })], month: '2026-02', asOf: '2026-02-20' });
    expect(m.items.map((x) => [x.kind, x.name, x.dueDate, x.expected, x.paid, x.remaining, x.status])).toEqual([
      ['loan', 'Home', '2026-02-05', '10000.00', '0.00', '10000.00', 'overdue'],
      ['chit', 'Chit', '2026-02-10', '5000.00', '4600.00', '0.00', 'paid'],
      ['bill', 'Electricity', '2026-02-15', '2140.00', '2140.00', '0.00', 'paid'], // actual amount once paid
      ['bill', 'Rent', '2026-02-28', '15000.00', '0.00', '15000.00', 'upcoming'],
    ]);
    expect(m.totals.all).toEqual({ expected: '32140.00', paid: '6740.00', remaining: '25000.00', count: 4 });
    expect(m.totals.chit.paid).toBe('4600.00');
    // a future month: nothing paid yet, so everything is still to pay (not 'projected as paid')
    const march = monthlyExpenses({ loans: [home, chit], comps, bills: [], billPayments: [], month: '2026-03', asOf: '2026-02-20' });
    expect(march.items.map((x) => [x.name, x.status, x.remaining])).toEqual([['Home', 'upcoming', '10000.00'], ['Chit', 'upcoming', '5000.00']]);
    expect(march.totals.all.remaining).toBe('15000.00');
    expect(m.totals.bill.expected).toBe('17140.00');
  });

  it('reminds before, on and after the due date, and stops once paid', () => {
    const base = {
      settings: { ...DEFAULT_REMINDER_SETTINGS, quietEnabled: false, offsets: [3] }, loans: [], comps: new Map(), adjustments: [], custom: [], history: [],
      lastBackupDate: '2026-02-01', formatMoney: (a: string) => `₹${a}`, formatDate: (d: string) => d,
    };
    const b = bill({ dueDay: 28, startDate: '2026-02-28' });
    const keys = (now: string, payments: BillPayment[] = []) => dueReminders({ ...base, now, bills: [b], billPayments: payments }).map((r) => r.key);
    expect(keys('2026-02-25T09:00')).toContain('bill:B1:2026-02-28:3');
    expect(keys('2026-02-28T09:00')).toContain('bill_due:B1:2026-02-28');
    expect(keys('2026-03-01T09:00')).toContain('bill_overdue:B1:2026-02-28');
    expect(keys('2026-03-01T09:00', [bp({ dueDate: '2026-02-28' })]).filter((k) => k.startsWith('bill'))).toEqual([]);
    expect(dueReminders({ ...base, now: '2026-02-28T09:00', bills: [{ ...b, reminderEnabled: false }], billPayments: [] }).filter((r) => r.category === 'bill')).toEqual([]);
    // a sent bill reminder must pass backup / sync validation (it once failed Wi-Fi sync from the phone)
    const sent = { id: 'N1', createdAt: TS, updatedAt: TS, key: 'bill_due:B1:2026-02-28', category: 'bill', title: 'Rent: due today', body: 'Due today.', loanId: null,
      scheduledFor: '2026-02-28T09:00', deliveredAt: TS, state: 'sent', snoozedUntil: null, channel: 'in_app', late: false, deviceId: 'pc' };
    const r = notificationSchema.safeParse(sent);
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it('merges bills between devices and drops payments of deleted bills', () => {
    const empty: SnapshotData = { loans: [], adjustments: [], payments: [], customReminders: [], notifications: [], audit: [], categories: [], bills: [], billPayments: [], debts: [], debtRepayments: [], tombstones: [], preferences: { value: DEFAULT_PREFERENCES, updatedAt: TS } };
    const phone = { ...empty, bills: [bill({ updatedAt: '2026-02-02T00:00:00.000Z', amount: '16000.00' })], billPayments: [bp({})] };
    const pc = { ...empty, bills: [bill()] };
    const { data, stats } = mergeData(pc, phone);
    expect(data.bills[0].amount).toBe('16000.00');
    expect(data.billPayments).toHaveLength(1);
    expect(stats.updated + stats.added).toBe(2);
    const deleted = mergeData(data, { ...empty, tombstones: [{ id: 'B1', table: 'bills', deletedAt: '2026-03-01T00:00:00.000Z' }] }).data;
    expect(deleted.bills).toEqual([]);
    expect(deleted.billPayments).toEqual([]);
  });

  it('stores bills and payments, refuses paying the same due date twice, and deletes with tombstones', async () => {
    const repo = new Repo(await Db.open(null), () => 'test');
    repo.saveBill(bill());
    repo.saveBillPayment(bp({}));
    expect(() => repo.saveBillPayment(bp({ id: 'BP9' }))).toThrow(/already marked paid/);
    expect(repo.snapshotData().billPayments).toHaveLength(1);
    // a sync merge re-writes existing bills that have payments
    repo.applyMerged(repo.snapshotData());
    expect(repo.snapshotData().billPayments).toHaveLength(1);
    repo.deleteBill('B1');
    const snap = repo.snapshotData();
    expect(snap.bills).toEqual([]);
    expect(snap.billPayments).toEqual([]);
    expect(snap.tombstones.map((t) => t.table).sort()).toEqual(['billPayments', 'bills']);
  });
});
