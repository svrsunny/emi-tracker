/**
 * Portfolio aggregation for the dashboard, heatmaps, calendar and reports. Every figure is
 * derived from loan records + engine output; nothing is stored or hard-coded.
 */
import { addDays, monthKey, parts, toDays, type ISODate } from './dates';
import { DONE_STATUSES, OPEN_STATUSES, type LoanComputation, type RowStatus } from './engine';
import { dec, money, ZERO, type Dec } from './money';
import type { Loan, Payment } from './types';

export interface Filters {
  loanIds?: string[] | null; // null/empty = all
  from?: ISODate | null;
  to?: ISODate | null;
}

export interface Portfolio {
  loans: Loan[];
  comps: Map<string, LoanComputation>;
  payments: Payment[];
}

const inRange = (d: ISODate, f: Filters) => (!f.from || d >= f.from) && (!f.to || d <= f.to);
const selected = (loan: Loan, f: Filters) => !f.loanIds?.length || f.loanIds.includes(loan.id);

export interface DashboardTotals {
  originalPrincipal: string;
  sanctioned: string;
  principalRepaid: string;
  interestPaid: string;
  chargesPaid: string;
  totalPaid: string;
  outstandingPrincipal: string;
  outstandingInterest: string;
  remainingInstallments: number;
  remainingScheduled: string;
  remainingInterest: string;
  remainingFees: string;
  remainingOutflow: string;
  activeLoans: number;
  closedLoans: number;
  progressPct: number;
  estimatedPortion: string;
  paidInRange: string;
  nextEmi: { loanId: string; loanName: string; date: ISODate; amount: string } | null;
  dueToday: DueItem[];
  overdue: DueItem[];
  due7: DueItem[];
  due30: DueItem[];
  allClosedBy: ISODate | null;
  anyOpenEnded: boolean;
  isEstimate: boolean;
}

export interface DueItem { loanId: string; loanName: string; no: number; date: ISODate; amount: string; status: RowStatus }

export function dashboardTotals(p: Portfolio, asOf: ISODate, f: Filters = {}): DashboardTotals {
  const z = () => ZERO;
  let principal = z(), sanctioned = z(), repaid = z(), interest = z(), charges = z(), paid = z(), outstanding = z();
  let outInterest = z(), remSched = z(), remInterest = z(), remFees = z(), remOut = z(), estimated = z(), paidInRange = z();
  let remaining = 0, active = 0, closedCount = 0, allClosedBy: ISODate | null = null, openEnded = false, isEstimate = false;
  const dueToday: DueItem[] = [], overdue: DueItem[] = [], due7: DueItem[] = [], due30: DueItem[] = [];
  let next: DashboardTotals['nextEmi'] = null;
  const d7 = addDays(asOf, 7), d30 = addDays(asOf, 30);

  for (const loan of p.loans) {
    if (!selected(loan, f) || loan.status === 'archived') continue;
    const c = p.comps.get(loan.id);
    if (!c) continue;
    const s = c.summary;
    const isActive = loan.status === 'active';
    if (isActive) active++; else closedCount++;
    principal = principal.plus(dec(s.principal));
    sanctioned = sanctioned.plus(dec(s.sanctioned));
    repaid = repaid.plus(dec(s.principalRepaid));
    interest = interest.plus(dec(s.interestPaid));
    charges = charges.plus(dec(s.feesPaid)).plus(dec(s.penaltiesPaid));
    paid = paid.plus(dec(s.totalPaid));
    estimated = estimated.plus(dec(s.principalRepaidEstimated)).plus(dec(s.interestPaidEstimated));
    if (s.isEstimate) isEstimate = true;
    for (const pay of p.payments) {
      if (pay.loanId === loan.id && pay.status === 'active' && inRange(pay.txnDate, f) && pay.type !== 'missed' && pay.type !== 'waiver') paidInRange = paidInRange.plus(dec(pay.amount));
    }
    if (!isActive) continue;
    outstanding = outstanding.plus(dec(s.outstandingPrincipal));
    outInterest = outInterest.plus(dec(s.interestArrears)).plus(dec(s.accruedInterest));
    remSched = remSched.plus(dec(s.remainingScheduledAmount));
    remInterest = remInterest.plus(dec(s.remainingInterest));
    remFees = remFees.plus(dec(s.remainingFees));
    remOut = remOut.plus(dec(s.remainingCashOutflow));
    remaining += s.installmentsRemaining;
    if (s.nonConverging) openEnded = true;
    if (s.closureDate && (!allClosedBy || s.closureDate > allClosedBy)) allClosedBy = s.closureDate;
    for (const r of c.rows) {
      if (!OPEN_STATUSES.includes(r.status) || r.status === 'unrecorded') continue;
      const amt = dec(r.shortfall).gt(0) ? r.shortfall : r.scheduledAmount;
      if (dec(amt).lte(0)) continue;
      const item: DueItem = { loanId: loan.id, loanName: loan.name, no: r.no, date: r.dueDate, amount: money(amt), status: r.status };
      if (r.dueDate === asOf) dueToday.push(item);
      else if (r.dueDate < asOf) overdue.push(item);
      else if (r.dueDate <= d7) due7.push(item);
      else if (r.dueDate <= d30) due30.push(item);
      if (r.dueDate >= asOf && (!next || r.dueDate < next.date)) next = { loanId: loan.id, loanName: loan.name, date: r.dueDate, amount: money(amt) };
    }
  }
  const base = repaid.plus(outstanding);
  return {
    originalPrincipal: money(principal), sanctioned: money(sanctioned), principalRepaid: money(repaid), interestPaid: money(interest),
    chargesPaid: money(charges), totalPaid: money(paid), outstandingPrincipal: money(outstanding), outstandingInterest: money(outInterest),
    remainingInstallments: remaining, remainingScheduled: money(remSched), remainingInterest: money(remInterest), remainingFees: money(remFees),
    remainingOutflow: money(remOut), activeLoans: active, closedLoans: closedCount,
    progressPct: base.gt(0) ? Math.round(repaid.div(base).mul(10000).toNumber()) / 100 : 0,
    estimatedPortion: money(estimated), paidInRange: money(paidInRange), nextEmi: next,
    dueToday, overdue, due7, due30: [...due7, ...due30].sort((a, b) => a.date.localeCompare(b.date)),
    allClosedBy: openEnded ? null : allClosedBy, anyOpenEnded: openEnded, isEstimate,
  };
}

// ---------------------------------------------------------------- activity ledger

export interface ActivityItem {
  paymentId: string;
  loanId: string;
  date: ISODate;
  type: Payment['type'];
  amount: Dec;
  principal: Dec;
  interest: Dec;
  fees: Dec;
  penalty: Dec;
}

/** Recorded (non-reversed, non-marker) payments with their engine allocation. */
export function activity(p: Portfolio, f: Filters = {}): ActivityItem[] {
  const loanById = new Map(p.loans.map((l) => [l.id, l]));
  const out: ActivityItem[] = [];
  for (const pay of p.payments) {
    const loan = loanById.get(pay.loanId);
    if (!loan || !selected(loan, f) || pay.status !== 'active' || pay.type === 'missed' || pay.type === 'waiver') continue;
    if (!inRange(pay.txnDate, f)) continue;
    const a = p.comps.get(pay.loanId)?.allocations[pay.id];
    out.push({
      paymentId: pay.id, loanId: pay.loanId, date: pay.txnDate, type: pay.type, amount: dec(pay.amount),
      principal: dec(a?.principal), interest: dec(a?.interest), fees: dec(a?.fees), penalty: dec(a?.penalty),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------- heatmaps

export interface DayCell {
  date: ISODate;
  amount: string;
  count: number;
  principal: string;
  interest: string;
  fees: string;
  penalty: string;
  loanIds: string[];
  paymentIds: string[];
  hasData: boolean; // false => before any tracking (unknown), not zero
  scheduled: { loanId: string; no: number; status: RowStatus; amount: string; projected: boolean }[];
  state: CalendarState;
}

export type CalendarState = 'none' | 'no_data' | 'paid' | 'partial' | 'upcoming' | 'due' | 'overdue' | 'missed' | 'prepaid' | 'extra' | 'waived';

/** Earliest date for which the user's records are considered complete. */
export function trackedSince(p: Portfolio, f: Filters = {}): ISODate | null {
  let d: ISODate | null = null;
  for (const l of p.loans) {
    if (!selected(l, f)) continue;
    const s = l.trackingStartDate < l.startDate ? l.startDate : l.trackingStartDate;
    if (!d || s < d) d = s;
  }
  return d;
}

const STATE_RANK: CalendarState[] = ['none', 'no_data', 'waived', 'upcoming', 'prepaid', 'paid', 'extra', 'due', 'partial', 'missed', 'overdue'];

function rowState(status: RowStatus): CalendarState {
  switch (status) {
    case 'paid': case 'assumed_paid': return 'paid';
    case 'prepaid': return 'prepaid';
    case 'partially_paid': return 'partial';
    case 'overdue': return 'overdue';
    case 'missed': return 'missed';
    case 'due': return 'due';
    case 'upcoming': return 'upcoming';
    case 'waived': return 'waived';
    case 'unrecorded': return 'no_data';
    default: return 'none';
  }
}

export function dailyCells(p: Portfolio, from: ISODate, to: ISODate, asOf: ISODate, f: Filters = {}): Map<ISODate, DayCell> {
  const since = trackedSince(p, f);
  const cells = new Map<ISODate, DayCell>();
  for (let d = toDays(from); d <= toDays(to); d++) {
    const date = addDays('1970-01-01', d);
    cells.set(date, {
      date, amount: '0.00', count: 0, principal: '0.00', interest: '0.00', fees: '0.00', penalty: '0.00', loanIds: [], paymentIds: [],
      hasData: !!since && date >= since && date <= asOf, scheduled: [], state: !since || date < since ? 'no_data' : 'none',
    });
  }
  for (const a of activity(p, { ...f, from, to })) {
    const c = cells.get(a.date);
    if (!c) continue;
    c.amount = money(dec(c.amount).plus(a.amount));
    c.principal = money(dec(c.principal).plus(a.principal));
    c.interest = money(dec(c.interest).plus(a.interest));
    c.fees = money(dec(c.fees).plus(a.fees));
    c.penalty = money(dec(c.penalty).plus(a.penalty));
    c.count++;
    c.hasData = true;
    if (!c.loanIds.includes(a.loanId)) c.loanIds.push(a.loanId);
    c.paymentIds.push(a.paymentId);
    if (a.type === 'prepayment' || a.type === 'foreclosure') c.state = pick(c.state, 'extra');
  }
  for (const loan of p.loans) {
    if (!selected(loan, f) || loan.status === 'archived') continue;
    for (const r of p.comps.get(loan.id)?.rows ?? []) {
      const c = cells.get(r.dueDate);
      if (!c || r.status === 'cancelled' || r.status === 'moratorium') continue;
      c.scheduled.push({ loanId: loan.id, no: r.no, status: r.status, amount: r.scheduledAmount, projected: r.isProjected });
      c.state = pick(c.state, rowState(r.status));
    }
  }
  for (const c of cells.values()) if (c.count > 0 && c.state === 'none') c.state = 'paid';
  return cells;
}

function pick(a: CalendarState, b: CalendarState): CalendarState {
  return STATE_RANK.indexOf(b) > STATE_RANK.indexOf(a) ? b : a;
}

export type MonthMetric = 'amount' | 'principal' | 'interest' | 'installments' | 'missed' | 'completion';

export interface MonthCell {
  month: string; // YYYY-MM
  amount: string;
  principal: string;
  interest: string;
  fees: string;
  installmentsPaid: number;
  scheduledCount: number;
  missedOrOverdue: number;
  completionPct: number | null; // null when nothing was scheduled
  count: number;
  hasData: boolean;
}

export function monthlyCells(p: Portfolio, fromMonth: string, toMonth: string, asOf: ISODate, f: Filters = {}): Map<string, MonthCell> {
  const since = trackedSince(p, f);
  const cells = new Map<string, MonthCell>();
  let [y, m] = parts(fromMonth + '-01');
  const [ty, tm] = parts(toMonth + '-01');
  while (y < ty || (y === ty && m <= tm)) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    cells.set(key, {
      month: key, amount: '0.00', principal: '0.00', interest: '0.00', fees: '0.00', installmentsPaid: 0, scheduledCount: 0,
      missedOrOverdue: 0, completionPct: null, count: 0,
      hasData: !!since && key >= monthKey(since) && key <= monthKey(asOf),
    });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  for (const a of activity(p, f)) {
    const c = cells.get(monthKey(a.date));
    if (!c) continue;
    c.amount = money(dec(c.amount).plus(a.amount));
    c.principal = money(dec(c.principal).plus(a.principal));
    c.interest = money(dec(c.interest).plus(a.interest));
    c.fees = money(dec(c.fees).plus(a.fees).plus(a.penalty));
    c.count++;
    c.hasData = true;
  }
  for (const loan of p.loans) {
    if (!selected(loan, f) || loan.status === 'archived') continue;
    for (const r of p.comps.get(loan.id)?.rows ?? []) {
      if (r.kind !== 'emi' || r.status === 'cancelled' || r.dueDate > asOf) continue;
      const c = cells.get(monthKey(r.dueDate));
      if (!c) continue;
      c.scheduledCount++;
      if (DONE_STATUSES.includes(r.status) && r.status !== 'assumed_paid') c.installmentsPaid++;
      if (['overdue', 'missed', 'partially_paid'].includes(r.status)) c.missedOrOverdue++;
    }
  }
  for (const c of cells.values()) c.completionPct = c.scheduledCount ? Math.round((c.installmentsPaid / c.scheduledCount) * 100) : null;
  return cells;
}

export function monthMetricValue(c: MonthCell, metric: MonthMetric): number {
  switch (metric) {
    case 'amount': return +c.amount;
    case 'principal': return +c.principal;
    case 'interest': return +c.interest;
    case 'installments': return c.installmentsPaid;
    case 'missed': return c.missedOrOverdue;
    case 'completion': return c.completionPct ?? 0;
  }
}

/** Per-loan monthly amounts for the loan comparison heatmap. */
export function loanMonthMatrix(p: Portfolio, fromMonth: string, toMonth: string, asOf: ISODate, f: Filters = {}) {
  return p.loans.filter((l) => selected(l, f) && l.status !== 'archived').map((loan) => ({
    loan,
    cells: monthlyCells(p, fromMonth, toMonth, asOf, { ...f, loanIds: [loan.id] }),
  }));
}

/** Intensity level 0..4 from user thresholds (ascending). 0 = zero activity. */
export function intensity(value: number, thresholds: number[]): number {
  if (value <= 0) return 0;
  let level = 1;
  for (const t of thresholds.slice(1)) if (value >= t) level++;
  return Math.min(4, level);
}

/** Thresholds derived from data quartiles when the user has not configured fixed ones. */
export function autoThresholds(values: number[]): number[] {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  if (!v.length) return [0, 1, 2, 3];
  const q = (p: number) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  return [0, q(0.25), q(0.5), q(0.75)];
}

// ---------------------------------------------------------------- time series

export interface MonthSeries {
  month: string;
  paid: number;
  principal: number;
  interest: number;
  fees: number;
  scheduled: number;
  projected: number;
}

export function monthlySeries(p: Portfolio, f: Filters, asOf: ISODate): MonthSeries[] {
  const map = new Map<string, MonthSeries>();
  const get = (k: string) => {
    let s = map.get(k);
    if (!s) { s = { month: k, paid: 0, principal: 0, interest: 0, fees: 0, scheduled: 0, projected: 0 }; map.set(k, s); }
    return s;
  };
  for (const a of activity(p, f)) {
    const s = get(monthKey(a.date));
    s.paid += a.amount.toNumber();
    s.principal += a.principal.toNumber();
    s.interest += a.interest.toNumber();
    s.fees += a.fees.plus(a.penalty).toNumber();
  }
  for (const loan of p.loans) {
    if (!selected(loan, f) || loan.status === 'archived') continue;
    for (const r of p.comps.get(loan.id)?.rows ?? []) {
      if (!inRange(r.dueDate, f) || r.status === 'cancelled') continue;
      const s = get(monthKey(r.dueDate));
      if (r.dueDate <= asOf) s.scheduled += +r.scheduledAmount;
      else s.projected += +r.projectedAmount + +r.paidAmount;
    }
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month)).map((s) => ({
    ...s, paid: round(s.paid), principal: round(s.principal), interest: round(s.interest), fees: round(s.fees),
    scheduled: round(s.scheduled), projected: round(s.projected),
  }));
}

const round = (x: number) => Math.round(x * 100) / 100;

export interface YearSummary { year: number; paid: string; principal: string; interest: string; fees: string; count: number }

export function annualSummary(p: Portfolio, f: Filters = {}): YearSummary[] {
  const map = new Map<number, { paid: Dec; principal: Dec; interest: Dec; fees: Dec; count: number }>();
  for (const a of activity(p, f)) {
    const y = parts(a.date)[0];
    const s = map.get(y) ?? { paid: ZERO, principal: ZERO, interest: ZERO, fees: ZERO, count: 0 };
    s.paid = s.paid.plus(a.amount); s.principal = s.principal.plus(a.principal); s.interest = s.interest.plus(a.interest);
    s.fees = s.fees.plus(a.fees).plus(a.penalty); s.count++;
    map.set(y, s);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([year, s]) => ({
    year, paid: money(s.paid), principal: money(s.principal), interest: money(s.interest), fees: money(s.fees), count: s.count,
  }));
}

/** Indian financial year (April–March) totals, e.g. "FY 2024-25". */
export function financialYearSummary(p: Portfolio, f: Filters = {}) {
  const map = new Map<string, { principal: Dec; interest: Dec; paid: Dec }>();
  for (const a of activity(p, f)) {
    const [y, m] = parts(a.date);
    const start = m >= 4 ? y : y - 1;
    const key = `FY ${start}-${String((start + 1) % 100).padStart(2, '0')}`;
    const s = map.get(key) ?? { principal: ZERO, interest: ZERO, paid: ZERO };
    s.principal = s.principal.plus(a.principal); s.interest = s.interest.plus(a.interest); s.paid = s.paid.plus(a.amount);
    map.set(key, s);
  }
  return [...map.entries()].sort().map(([fy, s]) => ({ fy, principal: money(s.principal), interest: money(s.interest), paid: money(s.paid) }));
}
