/**
 * Recurring bills and the monthly expenses view. Pure functions shared by the UI, the
 * reminder planner and the tests; the Android app has the same logic in core/Bills.kt.
 */
import { addDays, daysInMonth, fmtISO, parts, type ISODate } from './dates';
import type { LoanComputation, RowStatus } from './engine';
import { dec, maxD, money, ZERO, type Dec } from './money';
import { BILL_FREQUENCY_MONTHS, type Bill, type BillPayment, type Loan, type Payment } from './types';

/** Due dates of a bill in [from, to]. The due day is clamped to the month length. */
export function billDueDates(b: Bill, from: ISODate, to: ISODate): ISODate[] {
  if (b.frequency === 'once') return b.startDate >= from && b.startDate <= to ? [b.startDate] : [];
  const out: ISODate[] = [];
  const step = BILL_FREQUENCY_MONTHS[b.frequency];
  const [y0, m0] = parts(b.startDate);
  const last = b.endDate && b.endDate < to ? b.endDate : to;
  for (let i = 0; i < 2400; i++) {
    const total = y0 * 12 + (m0 - 1) + i * step;
    const y = Math.floor(total / 12), m = (total % 12) + 1;
    const d = fmtISO(y, m, Math.min(b.dueDay, daysInMonth(y, m)));
    if (d > last) break;
    if (d >= from && d >= b.startDate) out.push(d);
  }
  return out;
}

export type ExpenseStatus = 'paid' | 'partial' | 'due' | 'overdue' | 'upcoming' | 'no_record';

export interface BillOccurrence { bill: Bill; dueDate: ISODate; payment: BillPayment | null; status: ExpenseStatus }

export function billOccurrences(bills: Bill[], payments: BillPayment[], from: ISODate, to: ISODate, asOf: ISODate): BillOccurrence[] {
  const paid = new Map(payments.map((p) => [`${p.billId}:${p.dueDate}`, p]));
  const out: BillOccurrence[] = [];
  for (const b of bills) {
    for (const d of billDueDates(b, from, to)) {
      const payment = paid.get(`${b.id}:${d}`) ?? null;
      if (!b.active && !payment) continue;
      out.push({ bill: b, dueDate: d, payment, status: payment ? 'paid' : d < asOf ? 'overdue' : d === asOf ? 'due' : 'upcoming' });
    }
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.bill.name.localeCompare(b.bill.name));
}

export type ExpenseKind = 'loan' | 'chit' | 'bill';

export interface ExpenseItem {
  kind: ExpenseKind;
  refId: string; // loan or bill id
  name: string;
  detail: string;
  dueDate: ISODate;
  expected: string; // amount due
  paid: string;
  remaining: string;
  status: ExpenseStatus;
  rowNo: number | null; // loan schedule row, for "record payment"
}

export interface ExpenseTotals { expected: string; paid: string; remaining: string; count: number }
export interface MonthlyExpenses { month: string; items: ExpenseItem[]; totals: Record<ExpenseKind | 'all', ExpenseTotals> }

const ROW_STATUS: Partial<Record<RowStatus, ExpenseStatus>> = {
  paid: 'paid', prepaid: 'paid', assumed_paid: 'paid', waived: 'paid', partially_paid: 'partial',
  overdue: 'overdue', missed: 'overdue', due: 'due', upcoming: 'upcoming', unrecorded: 'no_record',
};

/** Everything due in a month (YYYY-MM): EMIs, chit installments and bills, with totals per kind. */
export function monthlyExpenses(input: { loans: Loan[]; comps: Map<string, LoanComputation>; bills: Bill[]; billPayments: BillPayment[]; month: string; asOf: ISODate }): MonthlyExpenses {
  const { month, asOf } = input;
  const [y, m] = month.split('-').map(Number);
  const from = fmtISO(y, m, 1), to = fmtISO(y, m, daysInMonth(y, m));
  const items: ExpenseItem[] = [];
  for (const loan of input.loans) {
    if (loan.status === 'archived') continue;
    const comp = input.comps.get(loan.id);
    if (!comp) continue;
    const chit = loan.loanType === 'chit_fund';
    for (const r of comp.rows) {
      if (r.dueDate < from || r.dueDate > to || r.status === 'cancelled' || dec(r.scheduledAmount).lte(0)) continue;
      const status = ROW_STATUS[r.status] ?? 'upcoming';
      const paid = r.status === 'assumed_paid' ? dec(r.scheduledAmount) : dec(r.paidAmount);
      items.push({
        kind: chit ? 'chit' : 'loan', refId: loan.id, name: loan.name, rowNo: r.no,
        detail: `${chit ? 'Installment' : 'EMI'} ${r.emiNo ?? r.no}${+r.dividend > 0 ? ` · dividend ${money(r.dividend)}` : ''}`,
        // future rows are projected as paid in the schedule; here anything not yet paid is still to pay
        dueDate: r.dueDate, expected: r.scheduledAmount, paid: money(paid), remaining: status === 'paid' ? '0.00' : money(maxD(ZERO, dec(r.scheduledAmount).minus(paid).minus(dec(r.dividend)))), status,
      });
    }
  }
  for (const o of billOccurrences(input.bills, input.billPayments, from, to, asOf)) {
    const expected = dec(o.bill.amount);
    const paid = o.payment ? dec(o.payment.amount) : ZERO;
    items.push({
      kind: 'bill', refId: o.bill.id, name: o.bill.name, rowNo: null,
      detail: [o.bill.frequency === 'once' ? 'one-time' : '', o.bill.payee, o.bill.variable ? 'amount varies' : ''].filter(Boolean).join(' · '),
      dueDate: o.dueDate, expected: money(o.payment ? paid : expected), paid: money(paid), remaining: o.payment ? '0.00' : money(expected), status: o.status,
    });
  }
  items.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name));
  const total = (xs: ExpenseItem[]): ExpenseTotals => {
    const sum = (f: (x: ExpenseItem) => string): Dec => xs.reduce((s, x) => s.plus(dec(f(x))), ZERO);
    return { expected: money(sum((x) => x.expected)), paid: money(sum((x) => x.paid)), remaining: money(sum((x) => x.remaining)), count: xs.length };
  };
  return {
    month, items,
    totals: { all: total(items), loan: total(items.filter((x) => x.kind === 'loan')), chit: total(items.filter((x) => x.kind === 'chit')), bill: total(items.filter((x) => x.kind === 'bill')) },
  };
}

/** Next unpaid due date of a bill on or after `asOf` (or the oldest overdue one). */
export function nextBillDue(b: Bill, payments: BillPayment[], asOf: ISODate): { dueDate: ISODate; overdue: boolean } | null {
  const occ = billOccurrences([b], payments.filter((p) => p.billId === b.id), addDays(asOf, -92), addDays(asOf, 400), asOf).filter((o) => !o.payment);
  const overdue = occ.find((o) => o.dueDate < asOf);
  if (overdue) return { dueDate: overdue.dueDate, overdue: true };
  return occ[0] ? { dueDate: occ[0].dueDate, overdue: false } : null;
}

export type SpendKind = 'loan' | 'chit' | 'bill' | 'one_time';
export const SPEND_KINDS: SpendKind[] = ['loan', 'chit', 'bill', 'one_time'];
export interface SpendEntry { id: string; kind: SpendKind; refId: string; name: string; amount: string; date: ISODate }

/**
 * Money actually paid out, by the day it was paid: loan / chit payments (not reversed, not the
 * zero-amount missed / waiver markers) and bill payments, one-time expenses kept apart.
 * Lending & borrowing is not spending and is left out. `loanIds` limits it to those loans (no bills).
 */
export function spendingByDay(input: { loans: Loan[]; payments: Payment[]; bills: Bill[]; billPayments: BillPayment[]; from: ISODate; to: ISODate; loanIds?: string[] | null }): Map<ISODate, SpendEntry[]> {
  const out = new Map<ISODate, SpendEntry[]>();
  const add = (e: SpendEntry) => { if (e.date >= input.from && e.date <= input.to) out.set(e.date, [...(out.get(e.date) ?? []), e]); };
  const loans = new Map(input.loans.map((l) => [l.id, l]));
  for (const p of input.payments) {
    const l = loans.get(p.loanId);
    if (!l || p.status !== 'active' || p.type === 'missed' || p.type === 'waiver' || dec(p.amount).lte(0)) continue;
    if (input.loanIds && !input.loanIds.includes(l.id)) continue;
    add({ id: p.id, kind: l.loanType === 'chit_fund' ? 'chit' : 'loan', refId: l.id, name: l.name, amount: money(p.amount), date: p.txnDate });
  }
  if (!input.loanIds) {
    const bills = new Map(input.bills.map((b) => [b.id, b]));
    for (const p of input.billPayments) {
      const b = bills.get(p.billId);
      if (!b) continue;
      add({ id: p.id, kind: b.frequency === 'once' ? 'one_time' : 'bill', refId: b.id, name: b.name, amount: money(p.amount), date: p.paidDate });
    }
  }
  for (const xs of out.values()) xs.sort((a, b) => SPEND_KINDS.indexOf(a.kind) - SPEND_KINDS.indexOf(b.kind) || a.name.localeCompare(b.name));
  return out;
}

/** Totals per kind (and 'all') for a list of spend entries. */
export function spendTotals(entries: SpendEntry[]): Record<SpendKind | 'all', string> {
  const sum = (xs: SpendEntry[]) => money(xs.reduce((s, x) => s.plus(dec(x.amount)), ZERO));
  return { all: sum(entries), loan: sum(entries.filter((x) => x.kind === 'loan')), chit: sum(entries.filter((x) => x.kind === 'chit')), bill: sum(entries.filter((x) => x.kind === 'bill')), one_time: sum(entries.filter((x) => x.kind === 'one_time')) };
}
