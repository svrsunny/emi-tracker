/**
 * EMI / amortization engine. Pure and UI-independent.
 *
 * The engine walks the schedule period by period. Within a period it processes dated
 * events (prepayments, foreclosure, fee/penalty payments, rate/EMI/restructure adjustments)
 * in chronological order, accruing interest segment by segment on the running principal.
 * At each due date the period's interest is posted (rounded half-up to paisa), the row's
 * contractual amount is fixed, and the payments recorded against that installment are
 * allocated. Rows due after `asOf` without recorded payments are projected as if the
 * scheduled EMI is paid on the due date. See docs/FINANCIAL_CALCULATIONS.md.
 */
import {
  addDays, addMonths, diffDays, type ISODate,
} from './dates';
import {
  D, EPS, ZERO, dec, emiFormula, maxD, minD, money, round2, roundEmi, type Dec,
} from './money';
import {
  FREQUENCY_PERIODS, INSTALLMENT_PAYMENT_TYPES, type Adjustment, type Loan, type Payment,
} from './types';

export type RowStatus =
  | 'upcoming' | 'due' | 'paid' | 'partially_paid' | 'overdue' | 'missed' | 'prepaid'
  | 'waived' | 'cancelled' | 'unrecorded' | 'assumed_paid' | 'moratorium';

export const DONE_STATUSES: RowStatus[] = ['paid', 'prepaid', 'assumed_paid'];
export const OPEN_STATUSES: RowStatus[] = ['upcoming', 'due', 'partially_paid', 'overdue', 'missed', 'unrecorded'];

export interface ScheduleRow {
  no: number;
  kind: 'moratorium' | 'emi';
  emiNo: number | null;
  dueDate: ISODate;
  rate: string;
  openingPrincipal: string;
  emi: string; // EMI in force for this row
  scheduledAmount: string; // contractual amount for this row (interest + scheduled principal)
  interest: string; // interest posted for the period
  principalDue: string;
  paidAmount: string; // recorded payments against the row
  projectedAmount: string; // assumed future payment
  paidPrincipal: string; // scheduled principal paid (actual + projected)
  paidInterest: string; // actual + projected
  feesCharged: string; // late fee / penal interest charged on this row (estimate)
  feesPaid: string;
  extraPrincipal: string; // excess on installment payments + prepayments dated in this period
  capitalized: string;
  closingPrincipal: string;
  shortfall: string; // unpaid part of scheduledAmount
  dividend: string; // chit fund: full installment minus the amount actually paid (settled, not owed)
  status: RowStatus;
  late: boolean;
  isProjected: boolean;
  isEstimated: boolean;
  remainingInstallments: number;
  lastPaymentDate: ISODate | null;
  paymentIds: string[];
}

export interface Allocation {
  principal: string;
  interest: string;
  fees: string;
  penalty: string;
  unapplied: string;
  rowNo: number | null;
  simulated: boolean;
}

export interface LoanSummary {
  principal: string;
  sanctioned: string;
  disbursed: string;
  capitalizedInterest: string;
  balanceAdjustment: string;
  principalRepaid: string; // recorded + estimated pre-tracking
  dividends: string; // chit fund dividends (installments settled for less than the full amount)
  principalRepaidEstimated: string;
  interestPaid: string; // recorded + pre-tracking estimate + pre-EMI
  interestPaidEstimated: string;
  feesPaid: string; // fee payments + processing + other charges
  penaltiesPaid: string;
  upfrontCharges: string;
  unapplied: string;
  totalPaid: string;
  totalPaidRecorded: string;
  outstandingPrincipal: string;
  interestArrears: string;
  accruedInterest: string;
  chargesDue: string;
  payoffEstimate: string;
  totalInstallments: number;
  installmentsPaid: number;
  installmentsRemaining: number;
  currentInstallment: number | null;
  currentEmi: string;
  remainingScheduledAmount: string;
  remainingPrincipal: string;
  remainingInterest: string;
  remainingFees: string;
  remainingCashOutflow: string;
  nextDue: { no: number; date: ISODate; amount: string; status: RowStatus } | null;
  nextUpcoming: { no: number; date: ISODate; amount: string } | null;
  overdueCount: number;
  overdueAmount: string;
  unrecordedCount: number;
  lastPaymentDate: ISODate | null;
  closureDate: ISODate | null;
  computedClosed: boolean;
  progressPct: number;
  baselineClosureDate: ISODate | null;
  baselineTotalInterest: string;
  lifetimeInterest: string;
  interestSaved: string;
  periodsSaved: number;
  nonConverging: boolean;
  isEstimate: boolean;
  warnings: string[];
  reconciliation: { lenderOutstanding: string; date: ISODate; calculated: string; difference: string } | null;
}

export interface LoanComputation {
  loanId: string;
  rows: ScheduleRow[];
  allocations: Record<string, Allocation>;
  summary: LoanSummary;
}

export interface EngineOptions {
  mode?: 'actual' | 'contract';
  skipBaseline?: boolean;
  skipReconciliation?: boolean;
}

export const PERIOD_MONTHS: Partial<Record<Loan['frequency'], number>> = {
  monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12,
};

/** Due date of schedule row index (0-based), month-end clamped to the EMI due day. */
export function dueDateFor(loan: Pick<Loan, 'firstEmiDate' | 'emiDueDay' | 'frequency'>, index: number): ISODate {
  if (index === 0) return loan.firstEmiDate;
  const months = PERIOD_MONTHS[loan.frequency];
  if (months) return addMonths(loan.firstEmiDate, index * months, loan.emiDueDay);
  return addDays(loan.firstEmiDate, index * (loan.frequency === 'weekly' ? 7 : 14));
}

export function periodicRate(annualRatePct: Dec, frequency: Loan['frequency']): Dec {
  return annualRatePct.div(100).div(FREQUENCY_PERIODS[frequency]);
}

/** EMI for a loan configuration (used by the wizard and for missing EMI). */
export function calculateEmi(principal: string, annualRate: string, n: number, frequency: Loan['frequency'],
  method: Loan['interestMethod'], rounding: Loan['emiRounding']): string {
  const p = dec(principal);
  const r = dec(annualRate);
  if (n <= 0 || p.lte(0)) return '0.00';
  if (method === 'flat') {
    const years = new D(n).div(FREQUENCY_PERIODS[frequency]);
    return money(roundEmi(p.plus(p.mul(r).div(100).mul(years)).div(n), rounding));
  }
  return money(roundEmi(emiFormula(p, periodicRate(r, frequency), n), rounding));
}

type Event =
  | { date: ISODate; order: number; kind: 'adj'; adj: Adjustment }
  | { date: ISODate; order: number; kind: 'pay'; pay: Payment }
  | { date: ISODate; order: number; kind: 'asOf' };

const isSim = (p: Payment) => p.id.startsWith('sim:');

export function computeLoan(
  loan: Loan,
  adjustmentsIn: Adjustment[],
  paymentsIn: Payment[],
  asOf: ISODate,
  opts: EngineOptions = {},
): LoanComputation {
  const contract = opts.mode === 'contract';
  const chit = loan.loanType === 'chit_fund';
  const ppy = FREQUENCY_PERIODS[loan.frequency];
  const flat = loan.interestMethod === 'flat';
  const grace = Math.max(0, loan.gracePeriodDays | 0);
  const M = Math.max(0, loan.moratoriumPeriods | 0);
  const preTrackEmi = contract ? 0 : Math.max(0, loan.installmentsPaidBeforeTracking | 0);
  const lateFee = dec(loan.lateFee);
  const penalRate = dec(loan.penalRate);

  const adjustments = adjustmentsIn
    .filter((a) => a.loanId === loan.id)
    .slice()
    .sort((a, b) => (a.effectiveDate === b.effectiveDate ? a.createdAt.localeCompare(b.createdAt) : a.effectiveDate.localeCompare(b.effectiveDate)));
  const payments = contract
    ? paymentsIn.filter((p) => isSim(p) && p.loanId === loan.id)
    : paymentsIn.filter((p) => p.status === 'active' && p.loanId === loan.id);

  const instPays = new Map<number, Payment[]>();
  const markers = new Map<number, Set<'missed' | 'waiver'>>();
  const events: Event[] = [];
  for (const p of payments) {
    if (INSTALLMENT_PAYMENT_TYPES.includes(p.type) && p.installmentNo != null) {
      const list = instPays.get(p.installmentNo) ?? [];
      list.push(p);
      instPays.set(p.installmentNo, list);
    } else if ((p.type === 'missed' || p.type === 'waiver') && p.installmentNo != null) {
      const s = markers.get(p.installmentNo) ?? new Set();
      s.add(p.type);
      markers.set(p.installmentNo, s);
    } else if (p.type === 'prepayment' || p.type === 'foreclosure' || p.type === 'fee' || p.type === 'penalty') {
      events.push({ date: p.txnDate, order: 0, kind: 'pay', pay: p });
    }
  }
  for (const list of instPays.values()) list.sort((a, b) => a.txnDate.localeCompare(b.txnDate) || a.createdAt.localeCompare(b.createdAt));
  for (const a of adjustments) events.push({ date: a.effectiveDate, order: 1, kind: 'adj', adj: a });
  events.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order
    || (a.kind === 'pay' && b.kind === 'pay' ? a.pay.createdAt.localeCompare(b.pay.createdAt) : 0));

  // ---- running state
  let balance = dec(loan.principal);
  let rate = dec(loan.annualRate);
  let emi: Dec | null = loan.emiAmount && dec(loan.emiAmount).gt(0) ? dec(loan.emiAmount) : null;
  const emiWasProvided = emi !== null;
  let needRecompute = emi === null;
  let plannedTotal = Math.max(1, loan.totalInstallments | 0);
  let emiRowsDone = 0;
  let arrears = ZERO; // unpaid posted interest
  let feesDue = ZERO;
  let penaltyDue = ZERO;
  let flatBase: Dec | null = null;
  let accrued = ZERO; // unrounded interest accrued in current period
  let prev = loan.startDate;
  let balanceAdjustment = ZERO;
  let capitalizedActual = ZERO;
  let capitalizedAll = ZERO;
  let accruedAtAsOf: Dec | null = null;
  let arrearsSnapshot = ZERO; // interest arrears after the last elapsed row
  let closed = false;
  let closedDate: ISODate | null = null;
  let nonConverging = false;
  let estimatedCharges = false;

  // ---- totals
  const t = {
    recPrincipal: ZERO, dividends: ZERO, recInterest: ZERO, recFees: ZERO, recPenalty: ZERO, recUnapplied: ZERO, recTotal: ZERO,
    estPrincipal: ZERO, estInterest: ZERO,
    projPrincipal: ZERO, projInterest: ZERO, projPayments: ZERO,
    allInterest: ZERO,
  };
  const allocations: Record<string, Allocation> = {};
  const alloc = (p: Payment, rowNo: number | null) => {
    if (!allocations[p.id]) {
      allocations[p.id] = { principal: '0.00', interest: '0.00', fees: '0.00', penalty: '0.00', unapplied: '0.00', rowNo, simulated: isSim(p) };
    }
    return allocations[p.id];
  };
  const book = (p: Payment, rowNo: number | null, part: 'principal' | 'interest' | 'fees' | 'penalty' | 'unapplied', amt: Dec) => {
    if (amt.lte(0)) return;
    const a = alloc(p, rowNo);
    a[part] = money(dec(a[part]).plus(amt));
    if (part === 'interest') t.allInterest = t.allInterest.plus(amt);
    if (isSim(p)) {
      t.projPayments = t.projPayments.plus(amt);
      if (part === 'principal') t.projPrincipal = t.projPrincipal.plus(amt);
      if (part === 'interest') t.projInterest = t.projInterest.plus(amt);
      return;
    }
    if (part === 'principal') t.recPrincipal = t.recPrincipal.plus(amt);
    else if (part === 'interest') t.recInterest = t.recInterest.plus(amt);
    else if (part === 'fees') t.recFees = t.recFees.plus(amt);
    else if (part === 'penalty') t.recPenalty = t.recPenalty.plus(amt);
    else t.recUnapplied = t.recUnapplied.plus(amt);
  };

  const segment = (from: ISODate, to: ISODate, periodDays: number): Dec => {
    if (flat || balance.lte(0)) return ZERO;
    const days = diffDays(from, to);
    if (days <= 0) return ZERO;
    if (loan.interestMethod === 'reducing_daily') return balance.mul(rate).div(100).mul(days).div(365);
    return balance.mul(rate).div(100).div(ppy).mul(days).div(periodDays);
  };

  const rows: ScheduleRow[] = [];
  let evIdx = 0;
  const cap = M + plannedTotal + 1200;
  const asOfOutsideAllPeriods = asOf < loan.startDate;

  for (let i = 1; i <= cap && !closed; i++) {
    const due = dueDateFor(loan, i - 1);
    const periodDays = Math.max(1, diffDays(prev, due));
    const openingPrincipal = balance;
    let extraPrincipal = ZERO;
    let cursor = prev;
    const isMor = i <= M;
    const emiNo = isMor ? null : i - M;

    // payments dated in (prev, due] and adjustments effective in (prev, due) belong to this period
    // (an adjustment effective on a due date applies from the next period); the first period
    // also takes anything dated earlier
    const periodEvents: Event[] = [];
    while (evIdx < events.length && (events[evIdx].date < due || (events[evIdx].date === due && events[evIdx].kind === 'pay'))) {
      periodEvents.push(events[evIdx++]);
    }
    if (!asOfOutsideAllPeriods && prev < asOf && asOf < due) {
      periodEvents.push({ date: asOf, order: 9, kind: 'asOf' });
      periodEvents.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
    }

    for (const ev of periodEvents) {
      if (closed) {
        if (ev.kind === 'pay') book(ev.pay, null, 'unapplied', dec(ev.pay.amount));
        continue;
      }
      const at = ev.date > cursor ? ev.date : cursor;
      accrued = accrued.plus(segment(cursor, at, periodDays));
      cursor = at;
      if (ev.kind === 'asOf') {
        accruedAtAsOf = round2(accrued);
        continue;
      }
      if (ev.kind === 'adj') {
        const a = ev.adj;
        if (a.kind === 'rate' || a.kind === 'restructure') {
          if (a.annualRate != null && a.annualRate !== '') rate = dec(a.annualRate);
        }
        if (a.kind === 'emi' && a.emiAmount) {
          emi = dec(a.emiAmount);
          needRecompute = false;
        } else if (a.kind === 'restructure') {
          if (a.remainingInstallments != null && a.remainingInstallments > 0) plannedTotal = emiRowsDone + a.remainingInstallments;
          if (a.emiAmount && dec(a.emiAmount).gt(0)) {
            emi = dec(a.emiAmount);
            needRecompute = false;
          } else needRecompute = true;
        } else if (a.kind === 'rate' && a.recalc === 'recompute_emi') {
          needRecompute = true;
        }
        continue;
      }
      // dated payment event
      const p = ev.pay;
      let rem = dec(p.amount);
      if (p.manualAllocation) {
        const ap = minD(dec(p.allocPrincipal), balance);
        balance = balance.minus(ap);
        extraPrincipal = extraPrincipal.plus(ap);
        book(p, i, 'principal', ap);
        const ai = dec(p.allocInterest);
        arrears = maxD(ZERO, arrears.minus(ai));
        book(p, i, 'interest', ai);
        feesDue = maxD(ZERO, feesDue.minus(dec(p.allocFees)));
        book(p, i, 'fees', dec(p.allocFees));
        penaltyDue = maxD(ZERO, penaltyDue.minus(dec(p.allocPenalty)));
        book(p, i, 'penalty', dec(p.allocPenalty));
        book(p, i, 'unapplied', rem.minus(ap).minus(ai).minus(dec(p.allocFees)).minus(dec(p.allocPenalty)));
      } else if (p.type === 'fee') {
        feesDue = maxD(ZERO, feesDue.minus(rem));
        book(p, i, 'fees', rem);
      } else if (p.type === 'penalty') {
        penaltyDue = maxD(ZERO, penaltyDue.minus(rem));
        book(p, i, 'penalty', rem);
      } else if (p.type === 'prepayment') {
        const ap = minD(rem, balance);
        balance = balance.minus(ap);
        extraPrincipal = extraPrincipal.plus(ap);
        book(p, i, 'principal', ap);
        rem = rem.minus(ap);
        // anything beyond the principal pays interest due, then is unapplied credit
        const ai = minD(rem, arrears.plus(round2(accrued)));
        if (ai.gt(0)) {
          const fromArrears = minD(ai, arrears);
          arrears = arrears.minus(fromArrears);
          accrued = maxD(ZERO, accrued.minus(ai.minus(fromArrears)));
          book(p, i, 'interest', ai);
          rem = rem.minus(ai);
        }
        book(p, i, 'unapplied', rem);
        if (ap.gt(0) && loan.prepaymentEffect === 'reduce_emi') needRecompute = true;
      } else if (p.type === 'foreclosure') {
        const payPen = minD(rem, penaltyDue); penaltyDue = penaltyDue.minus(payPen); rem = rem.minus(payPen); book(p, i, 'penalty', payPen);
        const payFee = minD(rem, feesDue); feesDue = feesDue.minus(payFee); rem = rem.minus(payFee); book(p, i, 'fees', payFee);
        const interestNow = arrears.plus(round2(accrued));
        const ai = minD(rem, interestNow);
        const fromArrears = minD(ai, arrears);
        arrears = arrears.minus(fromArrears);
        accrued = maxD(ZERO, round2(accrued).minus(ai.minus(fromArrears)));
        rem = rem.minus(ai);
        book(p, i, 'interest', ai);
        const ap = minD(rem, balance);
        balance = balance.minus(ap);
        extraPrincipal = extraPrincipal.plus(ap);
        rem = rem.minus(ap);
        book(p, i, 'principal', ap);
        book(p, i, 'unapplied', rem);
        if (balance.lte(EPS) && arrears.lte(EPS) && accrued.lte(EPS)) {
          closed = true;
          closedDate = p.txnDate;
          balance = ZERO;
          accrued = ZERO;
        }
      }
    }

    if (closed && closedDate && closedDate <= due) {
      // loan foreclosed inside this period: the row is cancelled
      rows.push(makeRow({
        no: i, kind: isMor ? 'moratorium' : 'emi', emiNo, dueDate: due, rate: rate.toFixed(2), openingPrincipal,
        emi: emi ?? ZERO, scheduledAmount: ZERO, interest: ZERO, principalDue: ZERO, paidAmount: ZERO, projectedAmount: ZERO,
        paidPrincipal: ZERO, paidInterest: ZERO, feesCharged: ZERO, feesPaid: ZERO, extraPrincipal, capitalized: ZERO,
        closingPrincipal: ZERO, shortfall: ZERO, dividend: ZERO, status: 'cancelled', late: false, isProjected: due > asOf, isEstimated: false,
        lastPaymentDate: closedDate, paymentIds: [],
      }));
      // installment payments recorded against this or later rows become unapplied credit
      for (const [no, list] of instPays) if (no >= i) for (const p of list) book(p, no, 'unapplied', dec(p.amount));
      break;
    }

    accrued = accrued.plus(segment(cursor, due, periodDays));

    // ---- EMI determination
    if (!isMor && balance.gt(0) && (needRecompute || emi === null)) {
      const remaining = Math.max(1, plannedTotal - emiRowsDone);
      if (flat) {
        flatBase = balance;
        const years = new D(remaining).div(ppy);
        emi = roundEmi(balance.plus(balance.mul(rate).div(100).mul(years)).div(remaining), loan.emiRounding);
      } else {
        emi = roundEmi(emiFormula(balance, periodicRate(rate, loan.frequency), remaining), loan.emiRounding);
      }
      needRecompute = false;
    }
    if (flat && !isMor && flatBase === null) flatBase = balance;

    let interestRow: Dec;
    if (flat && !isMor) interestRow = balance.gt(0) && flatBase ? round2(flatBase.mul(rate).div(100).div(ppy)) : ZERO;
    else if (flat && isMor) interestRow = round2(balance.mul(rate).div(100).div(ppy));
    else interestRow = round2(accrued);
    accrued = ZERO;

    const emiNow = emi ?? ZERO;
    let principalDue = ZERO;
    let scheduled: Dec;
    if (isMor) {
      scheduled = loan.moratoriumTreatment === 'interest_only' ? interestRow : ZERO;
    } else {
      principalDue = minD(balance, maxD(ZERO, emiNow.minus(interestRow)));
      const lastPlanned = emiRowsDone + 1 >= plannedTotal;
      const residual = balance.minus(principalDue);
      if (balance.plus(interestRow).lte(emiNow) || (lastPlanned && residual.lte(emiNow.div(2)))) principalDue = balance;
      scheduled = interestRow.plus(principalDue);
    }

    // ---- allocation against the row
    let interestOut = arrears.plus(interestRow); // interest outstanding incl. earlier arrears
    let rowInterestUnpaid = interestRow;
    let principalDueUnpaid = principalDue;
    let paidAmount = ZERO;
    let dividend = ZERO;
    let projectedAmount = ZERO;
    let paidPrincipal = ZERO;
    let paidInterest = ZERO;
    let feesPaid = ZERO;
    let lastPaymentDate: ISODate | null = null;
    let paidByGrace = ZERO;
    let fullPaidDate: ISODate | null = null;
    const graceDate = addDays(due, grace);
    const rowPays = instPays.get(i) ?? [];
    const preTracked = !contract && !rowPays.length && (isMor ? preTrackEmi > 0 : (emiNo ?? 0) <= preTrackEmi);
    const paymentIds: string[] = [];

    const payInterest = (amt: Dec): Dec => {
      const x = minD(amt, interestOut);
      interestOut = interestOut.minus(x);
      // older arrears are settled before the current row's interest
      rowInterestUnpaid = minD(rowInterestUnpaid, interestOut);
      paidInterest = paidInterest.plus(x);
      return x;
    };
    const payScheduledPrincipal = (amt: Dec): Dec => {
      const x = minD(amt, minD(principalDueUnpaid, balance));
      principalDueUnpaid = principalDueUnpaid.minus(x);
      balance = balance.minus(x);
      paidPrincipal = paidPrincipal.plus(x);
      return x;
    };
    const payCharges = (p: Payment, amt: Dec): Dec => {
      const pen = minD(amt, penaltyDue); penaltyDue = penaltyDue.minus(pen); book(p, i, 'penalty', pen);
      const fee = minD(amt.minus(pen), feesDue); feesDue = feesDue.minus(fee); book(p, i, 'fees', fee);
      feesPaid = feesPaid.plus(pen).plus(fee);
      return pen.plus(fee);
    };

    if (preTracked) {
      const amt = isMor ? (loan.moratoriumTreatment === 'interest_only' ? interestOut : ZERO) : interestOut.plus(principalDue);
      const xi = payInterest(amt);
      const xp = payScheduledPrincipal(amt.minus(xi));
      t.estInterest = t.estInterest.plus(xi);
      t.estPrincipal = t.estPrincipal.plus(xp);
      t.allInterest = t.allInterest.plus(xi);
      paidAmount = xi.plus(xp);
      fullPaidDate = due;
    } else {
      for (const p of rowPays) {
        paymentIds.push(p.id);
        let rem = dec(p.amount);
        paidAmount = paidAmount.plus(rem);
        if (!lastPaymentDate || p.txnDate > lastPaymentDate) lastPaymentDate = p.txnDate;
        if (p.manualAllocation) {
          const ai = dec(p.allocInterest);
          const xi = minD(ai, interestOut);
          interestOut = interestOut.minus(xi);
          rowInterestUnpaid = minD(rowInterestUnpaid, interestOut);
          paidInterest = paidInterest.plus(ai);
          book(p, i, 'interest', ai);
          const ap = minD(dec(p.allocPrincipal), balance);
          const sched = minD(ap, principalDueUnpaid);
          principalDueUnpaid = principalDueUnpaid.minus(sched);
          balance = balance.minus(ap);
          paidPrincipal = paidPrincipal.plus(sched);
          extraPrincipal = extraPrincipal.plus(ap.minus(sched));
          book(p, i, 'principal', ap);
          feesDue = maxD(ZERO, feesDue.minus(dec(p.allocFees)));
          penaltyDue = maxD(ZERO, penaltyDue.minus(dec(p.allocPenalty)));
          book(p, i, 'fees', dec(p.allocFees));
          book(p, i, 'penalty', dec(p.allocPenalty));
          feesPaid = feesPaid.plus(dec(p.allocFees)).plus(dec(p.allocPenalty));
          book(p, i, 'unapplied', rem.minus(ai).minus(dec(p.allocPrincipal)).minus(dec(p.allocFees)).minus(dec(p.allocPenalty)).plus(dec(p.allocPrincipal).minus(ap)));
        } else {
          if (loan.allocationOrder === 'fees_interest_principal') rem = rem.minus(payCharges(p, rem));
          const xi = payInterest(rem); rem = rem.minus(xi); book(p, i, 'interest', xi);
          const xp = payScheduledPrincipal(rem); rem = rem.minus(xp); book(p, i, 'principal', xp);
          if (loan.allocationOrder === 'interest_principal_fees') rem = rem.minus(payCharges(p, rem));
          const extra = minD(rem, balance);
          if (extra.gt(0)) {
            balance = balance.minus(extra);
            extraPrincipal = extraPrincipal.plus(extra);
            book(p, i, 'principal', extra);
            rem = rem.minus(extra);
            if (loan.prepaymentEffect === 'reduce_emi') needRecompute = true;
          }
          book(p, i, 'unapplied', rem);
        }
        if (p.txnDate <= graceDate) paidByGrace = paidByGrace.plus(dec(p.amount));
        if (!fullPaidDate && rowInterestUnpaid.plus(principalDueUnpaid).lte(EPS)) fullPaidDate = p.txnDate;
      }
      // chit fund: whatever was paid settles the installment; the unpaid rest is the dividend
      if (chit && !isMor && paidAmount.gt(0)) {
        const rest = rowInterestUnpaid.plus(principalDueUnpaid);
        if (rest.gt(EPS)) {
          dividend = rest;
          balance = balance.minus(principalDueUnpaid);
          interestOut = interestOut.minus(rowInterestUnpaid);
          principalDueUnpaid = ZERO;
          rowInterestUnpaid = ZERO;
          if (!contract) t.dividends = t.dividends.plus(rest);
          if (!fullPaidDate) fullPaidDate = lastPaymentDate;
        }
      }
      // projection: future rows are assumed paid on their due date
      if ((contract || due > asOf) && !closed && !(chit && paidAmount.gt(0))) {
        let target: Dec;
        if (isMor) target = loan.moratoriumTreatment === 'interest_only' ? interestOut : ZERO;
        else target = minD(emiNow, interestOut.plus(balance));
        let topUp = maxD(ZERO, target.minus(paidAmount));
        if (!isMor && topUp.lt(rowInterestUnpaid.plus(principalDueUnpaid))) topUp = rowInterestUnpaid.plus(principalDueUnpaid);
        if (topUp.gt(0)) {
          const xi = payInterest(topUp);
          const xp = payScheduledPrincipal(topUp.minus(xi));
          let leftover = topUp.minus(xi).minus(xp);
          // arrears case: after scheduled principal, remaining EMI keeps reducing principal
          const xe = minD(leftover, balance);
          if (xe.gt(0)) { balance = balance.minus(xe); paidPrincipal = paidPrincipal.plus(xe); leftover = leftover.minus(xe); }
          const used = topUp.minus(leftover);
          projectedAmount = used;
          t.projInterest = t.projInterest.plus(xi);
          t.projPrincipal = t.projPrincipal.plus(xp).plus(xe);
          t.projPayments = t.projPayments.plus(used);
          t.allInterest = t.allInterest.plus(xi);
        }
      }
    }

    // ---- moratorium capitalization
    let capitalized = ZERO;
    if (isMor && loan.moratoriumTreatment === 'capitalize' && interestOut.gt(0)) {
      // unpaid moratorium interest (this row and any arrears) is added to principal
      capitalized = interestOut;
      balance = balance.plus(capitalized);
      interestOut = ZERO;
      rowInterestUnpaid = ZERO;
      capitalizedAll = capitalizedAll.plus(capitalized);
      if (due <= asOf && !contract) capitalizedActual = capitalizedActual.plus(capitalized);
    }

    const shortfall = rowInterestUnpaid.plus(principalDueUnpaid);
    const rowMarkers = markers.get(i);
    let status: RowStatus;
    const isProjected = projectedAmount.gt(0);
    if (rowMarkers?.has('waiver')) {
      status = 'waived';
      interestOut = interestOut.minus(rowInterestUnpaid); // forgive this row's unpaid interest
    } else if (preTracked) status = isMor && loan.moratoriumTreatment === 'capitalize' ? 'moratorium' : 'assumed_paid';
    else if (isMor && scheduled.lte(EPS) && paidAmount.lte(EPS)) status = 'moratorium';
    else if (shortfall.lte(EPS)) {
      if (isProjected) status = 'upcoming';
      else if (due > asOf) status = 'prepaid';
      else status = 'paid';
    } else if (due > asOf || contract) status = paidAmount.gt(0) ? 'partially_paid' : 'upcoming';
    else if (paidAmount.gt(0)) status = 'partially_paid';
    else if (rowMarkers?.has('missed')) status = 'missed';
    else if (due >= addDays(asOf, -grace)) status = 'due';
    else if (due < loan.trackingStartDate) status = 'unrecorded';
    else status = 'overdue';
    arrears = interestOut;
    if (due <= asOf) arrearsSnapshot = arrears;

    const late = !preTracked && !contract && due <= asOf && scheduled.gt(EPS) && status !== 'waived'
      && (shortfall.gt(EPS) ? graceDate < asOf : (fullPaidDate ?? due) > graceDate);

    // ---- estimated late charges (only for elapsed rows)
    let feesCharged = ZERO;
    if (late && status !== 'waived') {
      if (lateFee.gt(0)) { feesDue = feesDue.plus(lateFee); feesCharged = feesCharged.plus(lateFee); estimatedCharges = true; }
      if (penalRate.gt(0)) {
        const shortAtGrace = maxD(ZERO, scheduled.minus(paidByGrace));
        const end = fullPaidDate && fullPaidDate <= asOf ? fullPaidDate : asOf;
        const days = Math.max(0, diffDays(due, end));
        const pen = round2(shortAtGrace.mul(penalRate).div(100).mul(days).div(365));
        if (pen.gt(0)) { penaltyDue = penaltyDue.plus(pen); feesCharged = feesCharged.plus(pen); estimatedCharges = true; }
      }
    }

    rows.push(makeRow({
      no: i, kind: isMor ? 'moratorium' : 'emi', emiNo, dueDate: due, rate: rate.toFixed(2), openingPrincipal, emi: emiNow,
      scheduledAmount: scheduled, interest: interestRow, principalDue, paidAmount, projectedAmount, paidPrincipal,
      paidInterest, feesCharged, feesPaid, extraPrincipal, capitalized, closingPrincipal: balance, shortfall, dividend, status,
      late, isProjected, isEstimated: preTracked || status === 'unrecorded', lastPaymentDate, paymentIds,
    }));

    // opening outstanding override after the last pre-tracking row
    if (!contract && !isMor && preTrackEmi > 0 && emiNo === preTrackEmi && loan.openingOutstanding != null && loan.openingOutstanding !== '') {
      const target = dec(loan.openingOutstanding);
      balanceAdjustment = target.minus(balance);
      balance = target;
      rows[rows.length - 1].closingPrincipal = money(balance);
    }

    if (!isMor) emiRowsDone++;
    prev = due;

    if (!isMor && balance.lte(EPS) && arrears.lte(EPS)) {
      closed = true;
      closedDate = status === 'upcoming' ? due : lastPaymentDate ?? due;
      balance = ZERO;
    }
    // non-converging: the EMI does not even cover the period's own interest (arrears alone
    // only delay closure; they are paid down by later EMIs)
    if (!closed && !isMor && (contract || due > asOf) && isProjected && balance.gt(0) && emiNow.lte(interestRow)) {
      nonConverging = true;
      break;
    }
  }
  if (!closed && rows.length >= cap) nonConverging = true;

  // anything never allocated (installments beyond closure, events after the last row)
  for (const [no, list] of instPays) for (const p of list) if (!allocations[p.id]) book(p, no, 'unapplied', dec(p.amount));
  for (let k = evIdx; k < events.length; k++) {
    const e = events[k];
    if (e.kind === 'pay' && !allocations[e.pay.id]) book(e.pay, null, 'unapplied', dec(e.pay.amount));
  }
  for (const p of payments) {
    if (!isSim(p) && !MARKER(p)) t.recTotal = t.recTotal.plus(dec(p.amount));
  }

  // remaining installments column
  let remainingCount = rows.filter((r) => r.kind === 'emi' && !['paid', 'prepaid', 'assumed_paid', 'waived', 'cancelled'].includes(r.status)).length;
  for (const r of rows) {
    if (r.kind === 'emi' && !['paid', 'prepaid', 'assumed_paid', 'waived', 'cancelled'].includes(r.status)) remainingCount--;
    r.remainingInstallments = Math.max(0, remainingCount);
  }

  const summary = summarize();
  return { loanId: loan.id, rows, allocations, summary };

  function summarize(): LoanSummary {
    const principal = dec(loan.principal);
    const preEmi = dec(loan.preEmiInterest);
    const upfront = dec(loan.processingFee).plus(dec(loan.otherCharges));
    const principalRepaid = t.recPrincipal.plus(t.estPrincipal);
    const interestPaid = t.recInterest.plus(t.estInterest).plus(preEmi);
    const feesPaidTotal = t.recFees.plus(upfront);
    const totalPaid = t.recTotal.plus(t.estPrincipal).plus(t.estInterest).plus(preEmi).plus(upfront);
    const outstanding = maxD(ZERO, principal.plus(capitalizedActual).plus(balanceAdjustment).minus(principalRepaid).minus(t.dividends));
    const chargesDue = feesDue.plus(penaltyDue);
    const emiRows = rows.filter((r) => r.kind === 'emi');
    const doneEmi = emiRows.filter((r) => DONE_STATUSES.includes(r.status)).length;
    const remainingEmi = emiRows.filter((r) => OPEN_STATUSES.includes(r.status)).length;
    const firstOpen = rows.find((r) => OPEN_STATUSES.includes(r.status) && r.kind === 'emi') ?? rows.find((r) => OPEN_STATUSES.includes(r.status));
    const nextUp = rows.find((r) => r.dueDate >= asOf && OPEN_STATUSES.includes(r.status));
    const overdueRows = rows.filter((r) => r.dueDate <= asOf && ['overdue', 'missed', 'partially_paid', 'unrecorded', 'due'].includes(r.status) && dec(r.shortfall).gt(EPS) && r.dueDate < addDays(asOf, -grace));
    const overdueAmount = overdueRows.reduce((s, r) => s.plus(dec(r.shortfall)), ZERO);
    const unrecorded = rows.filter((r) => r.status === 'unrecorded').length;
    const recordedDates = payments.filter((p) => !isSim(p) && !MARKER(p)).map((p) => p.txnDate).sort();
    const lastPay = recordedDates.length ? recordedDates[recordedDates.length - 1] : null;
    const remainingInterest = t.projInterest;
    const remainingScheduled = t.projPayments;
    const base = principal.plus(capitalizedActual).plus(balanceAdjustment);
    const progress = base.gt(0) ? Math.min(100, Math.max(0, principalRepaid.plus(t.dividends).div(base).mul(100).toNumber())) : 0;
    const accruedNow = accruedAtAsOf ?? ZERO;
    const payoff = maxD(ZERO, outstanding.plus(arrearsAtAsOf()).plus(accruedNow).plus(chargesDue).minus(dec(loan.advanceEmiBalance)));

    const warnings: string[] = [];
    if (unrecorded) warnings.push(`${unrecorded} past installment(s) before tracking started have no payment record; they are treated as unpaid.`);
    if (nonConverging) warnings.push('The EMI does not cover the interest due; the loan will not close at this EMI.');
    if (preTrackEmi > 0) warnings.push(`${preTrackEmi} installment(s) before tracking are assumed paid on schedule (estimated split).`);
    if (estimatedCharges) warnings.push('Late fees / penal interest are estimated from the loan configuration.');
    if (!emiWasProvided) warnings.push('EMI was calculated from the loan terms, not entered from the lender.');
    if (loan.interestMethod === 'reducing_daily') warnings.push('Daily-reducing interest uses an actual/365 day count.');
    if (loan.interestMethod === 'flat' && !chit) warnings.push('Flat-rate interest: prepayments reduce outstanding principal but interest per installment follows the flat base.');
    const isEstimate = preTrackEmi > 0 || unrecorded > 0 || estimatedCharges || !emiWasProvided || (loan.interestMethod !== 'reducing_monthly' && !chit);

    let reconciliation: LoanSummary['reconciliation'] = null;
    if (!opts.skipReconciliation && !contract && loan.lenderOutstanding && loan.lenderOutstandingDate) {
      const at = computeLoan(loan, adjustmentsIn, paymentsIn, loan.lenderOutstandingDate, { skipBaseline: true, skipReconciliation: true });
      const calc = dec(at.summary.outstandingPrincipal);
      reconciliation = {
        lenderOutstanding: money(loan.lenderOutstanding), date: loan.lenderOutstandingDate,
        calculated: money(calc), difference: money(dec(loan.lenderOutstanding).minus(calc)),
      };
      if (dec(reconciliation.difference).abs().gt(1)) warnings.push(`Lender balance differs from the calculated principal by ${reconciliation.difference}.`);
    }

    let baselineClosure: ISODate | null = null;
    let baselineInterest = ZERO;
    let periodsSaved = 0;
    const lifetimeInterest = t.allInterest.plus(preEmi);
    if (!opts.skipBaseline && !contract) {
      const b = computeLoan(loan, adjustmentsIn, [], asOf, { mode: 'contract', skipBaseline: true, skipReconciliation: true });
      baselineClosure = b.summary.closureDate;
      baselineInterest = dec(b.summary.lifetimeInterest);
      const bRows = b.rows.filter((r) => r.kind === 'emi').length;
      const nRows = rows.filter((r) => r.kind === 'emi' && r.status !== 'cancelled').length;
      periodsSaved = nonConverging || b.summary.nonConverging ? 0 : bRows - nRows;
    }

    return {
      principal: money(principal),
      sanctioned: money(loan.sanctionedAmount || loan.principal),
      disbursed: money(loan.disbursedAmount || loan.principal),
      capitalizedInterest: money(capitalizedActual),
      balanceAdjustment: money(balanceAdjustment),
      principalRepaid: money(principalRepaid),
      dividends: money(t.dividends),
      principalRepaidEstimated: money(t.estPrincipal),
      interestPaid: money(interestPaid),
      interestPaidEstimated: money(t.estInterest),
      feesPaid: money(feesPaidTotal),
      penaltiesPaid: money(t.recPenalty),
      upfrontCharges: money(upfront),
      unapplied: money(t.recUnapplied),
      totalPaid: money(totalPaid),
      totalPaidRecorded: money(t.recTotal),
      outstandingPrincipal: money(outstanding),
      interestArrears: money(arrearsAtAsOf()),
      accruedInterest: money(accruedNow),
      chargesDue: money(chargesDue),
      payoffEstimate: money(payoff),
      totalInstallments: emiRows.filter((r) => r.status !== 'cancelled').length,
      installmentsPaid: doneEmi,
      installmentsRemaining: remainingEmi,
      currentInstallment: firstOpen ? firstOpen.no : null,
      currentEmi: money(firstOpen ? dec(firstOpen.emi) : emi ?? ZERO),
      remainingScheduledAmount: money(remainingScheduled),
      remainingPrincipal: money(t.projPrincipal),
      remainingInterest: money(remainingInterest),
      remainingFees: money(chargesDue),
      // projected payments already include clearing overdue principal and interest arrears
      remainingCashOutflow: money(remainingScheduled.plus(chargesDue)),
      nextDue: firstOpen ? { no: firstOpen.no, date: firstOpen.dueDate, amount: money(dec(firstOpen.shortfall).gt(0) ? dec(firstOpen.shortfall) : dec(firstOpen.scheduledAmount)), status: firstOpen.status } : null,
      nextUpcoming: nextUp ? { no: nextUp.no, date: nextUp.dueDate, amount: money(dec(nextUp.shortfall).gt(0) ? dec(nextUp.shortfall) : dec(nextUp.scheduledAmount)) } : null,
      overdueCount: overdueRows.length,
      overdueAmount: money(overdueAmount),
      unrecordedCount: unrecorded,
      lastPaymentDate: lastPay,
      closureDate: closed ? closedDate : null,
      computedClosed: closed && (closedDate ?? '9999') <= asOf,
      progressPct: Math.round(progress * 100) / 100,
      baselineClosureDate: baselineClosure,
      baselineTotalInterest: money(baselineInterest),
      lifetimeInterest: money(lifetimeInterest),
      interestSaved: money(opts.skipBaseline || contract ? ZERO : baselineInterest.minus(lifetimeInterest)),
      periodsSaved,
      nonConverging,
      isEstimate,
      warnings,
      reconciliation,
    };
  }

  function arrearsAtAsOf(): Dec {
    return arrearsSnapshot;
  }
}

function MARKER(p: Payment): boolean {
  return p.type === 'missed' || p.type === 'waiver';
}

interface RowInput extends Omit<ScheduleRow, 'openingPrincipal' | 'emi' | 'scheduledAmount' | 'interest' | 'principalDue'
  | 'paidAmount' | 'projectedAmount' | 'paidPrincipal' | 'paidInterest' | 'feesCharged' | 'feesPaid' | 'extraPrincipal'
  | 'capitalized' | 'closingPrincipal' | 'shortfall' | 'dividend' | 'remainingInstallments'> {
  openingPrincipal: Dec; emi: Dec; scheduledAmount: Dec; interest: Dec; principalDue: Dec; paidAmount: Dec;
  projectedAmount: Dec; paidPrincipal: Dec; paidInterest: Dec; feesCharged: Dec; feesPaid: Dec; extraPrincipal: Dec;
  capitalized: Dec; closingPrincipal: Dec; shortfall: Dec; dividend: Dec;
}

function makeRow(r: RowInput): ScheduleRow {
  return {
    ...r,
    openingPrincipal: money(r.openingPrincipal), emi: money(r.emi), scheduledAmount: money(r.scheduledAmount),
    interest: money(r.interest), principalDue: money(r.principalDue), paidAmount: money(r.paidAmount),
    projectedAmount: money(r.projectedAmount), paidPrincipal: money(r.paidPrincipal), paidInterest: money(r.paidInterest),
    feesCharged: money(r.feesCharged), feesPaid: money(r.feesPaid), extraPrincipal: money(r.extraPrincipal),
    capitalized: money(r.capitalized), closingPrincipal: money(r.closingPrincipal), shortfall: money(r.shortfall), dividend: money(r.dividend),
    remainingInstallments: 0,
  };
}
