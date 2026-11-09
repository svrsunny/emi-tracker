/**
 * What-if scenarios. A scenario is expressed as hypothetical (simulated) future events —
 * EMI/rate adjustments and prepayments — fed through the same amortization engine, so
 * projections follow exactly the same interest rules as the contractual schedule.
 * Simulated records carry ids prefixed "sim:" and are never persisted.
 */
import { addDays, parts, fmtISO, daysInMonth, type ISODate } from './dates';
import { computeLoan, type LoanComputation } from './engine';
import { dec, money, ZERO } from './money';
import type { Adjustment, Loan, Payment, PrepaymentEffect } from './types';

export interface Scenario {
  name: string;
  emiIncrease: string; // added to the current EMI from the next due date
  extraMonthly: string; // extra principal paid with every installment
  oneTimeAmount: string;
  oneTimeDate: ISODate | null;
  annualAmount: string;
  annualMonth: number; // 1..12
  newRate: string; // '' = unchanged
  rateRecalc: 'keep_emi' | 'recompute_emi';
  prepaymentEffect: PrepaymentEffect | 'loan_default';
}

export const EMPTY_SCENARIO: Scenario = {
  name: 'Continue current EMI', emiIncrease: '', extraMonthly: '', oneTimeAmount: '', oneTimeDate: null,
  annualAmount: '', annualMonth: 4, newRate: '', rateRecalc: 'keep_emi', prepaymentEffect: 'loan_default',
};

export interface ScenarioResult {
  name: string;
  closureDate: ISODate | null;
  remainingInstallments: number;
  remainingInterest: string;
  totalRepayment: string; // all future cash outflow under the scenario
  monthsSaved: number;
  interestSaved: string;
  extraMonthlyCash: string;
  nonConverging: boolean;
  computation: LoanComputation;
}

const TS = '1970-01-01T00:00:00.000Z';

function simPayment(loanId: string, n: number, txnDate: ISODate, amount: string): Payment {
  return {
    id: `sim:${n}`, createdAt: TS, updatedAt: TS, loanId, txnDate, installmentNo: null, type: 'prepayment', amount,
    manualAllocation: false, allocPrincipal: '0.00', allocInterest: '0.00', allocFees: '0.00', allocPenalty: '0.00',
    reference: '', notes: 'simulated', attachmentPath: '', reconciled: false, status: 'active', reversalReason: '', reversedAt: null,
  };
}

function simAdjustment(loanId: string, n: number, over: Partial<Adjustment>): Adjustment {
  return {
    id: `sim-adj:${n}`, createdAt: '9999-12-31T00:00:00.000Z', updatedAt: TS, loanId, effectiveDate: '1970-01-01',
    kind: 'rate', annualRate: null, emiAmount: null, remainingInstallments: null, recalc: 'keep_emi', note: 'simulated', ...over,
  };
}

/** Months between two dates on the period grid (positive when b is later). */
function monthsBetween(a: ISODate, b: ISODate): number {
  const [ay, am] = parts(a);
  const [by, bm] = parts(b);
  return (by - ay) * 12 + (bm - am);
}

export function runScenario(loan: Loan, adjustments: Adjustment[], payments: Payment[], asOf: ISODate, s: Scenario,
  base?: LoanComputation): ScenarioResult {
  const current = base ?? computeLoan(loan, adjustments, payments, asOf, { skipBaseline: true, skipReconciliation: true });
  const effLoan: Loan = s.prepaymentEffect === 'loan_default' ? loan : { ...loan, prepaymentEffect: s.prepaymentEffect };
  const futureRows = current.rows.filter((r) => r.dueDate > asOf && r.isProjected);
  const sims: Payment[] = [];
  const simAdj: Adjustment[] = [];
  let n = 0;
  const startDate = addDays(asOf, 1);

  if (dec(s.newRate).gt(0)) simAdj.push(simAdjustment(loan.id, n++, { effectiveDate: startDate, kind: 'rate', annualRate: dec(s.newRate).toFixed(4), recalc: s.rateRecalc }));
  if (dec(s.emiIncrease).gt(0)) {
    simAdj.push(simAdjustment(loan.id, n++, { effectiveDate: startDate, kind: 'emi', emiAmount: money(dec(current.summary.currentEmi).plus(dec(s.emiIncrease))) }));
  }
  if (dec(s.extraMonthly).gt(0)) {
    for (const r of futureRows) if (r.kind === 'emi') sims.push(simPayment(loan.id, n++, r.dueDate, money(s.extraMonthly)));
  }
  if (dec(s.oneTimeAmount).gt(0)) sims.push(simPayment(loan.id, n++, s.oneTimeDate && s.oneTimeDate > asOf ? s.oneTimeDate : startDate, money(s.oneTimeAmount)));
  if (dec(s.annualAmount).gt(0) && futureRows.length) {
    const last = futureRows[futureRows.length - 1].dueDate;
    const [y0] = parts(startDate);
    for (let y = y0; y <= parts(last)[0]; y++) {
      const day = Math.min(loan.emiDueDay, daysInMonth(y, s.annualMonth));
      const d = fmtISO(y, s.annualMonth, day);
      if (d > asOf && d <= last) sims.push(simPayment(loan.id, n++, d, money(s.annualAmount)));
    }
  }

  const comp = computeLoan(effLoan, [...adjustments, ...simAdj], [...payments, ...sims], asOf, { skipBaseline: true, skipReconciliation: true });
  const baseInterest = dec(current.summary.remainingInterest);
  const sc = comp.summary;
  const monthsSaved = current.summary.closureDate && sc.closureDate ? monthsBetween(sc.closureDate, current.summary.closureDate) : 0;
  return {
    name: s.name,
    closureDate: sc.closureDate,
    remainingInstallments: sc.installmentsRemaining,
    remainingInterest: sc.remainingInterest,
    totalRepayment: sc.remainingCashOutflow,
    monthsSaved,
    interestSaved: money(baseInterest.minus(dec(sc.remainingInterest))),
    extraMonthlyCash: money(dec(s.emiIncrease).plus(dec(s.extraMonthly))),
    nonConverging: sc.nonConverging,
    computation: comp,
  };
}

/** Combined projection of several loans: the month all of them close and total outflow. */
export function combinedProjection(comps: LoanComputation[]) {
  let latest: ISODate | null = null;
  let anyOpenEnded = false;
  let outflow = ZERO;
  let interest = ZERO;
  for (const c of comps) {
    if (c.summary.nonConverging) anyOpenEnded = true;
    if (c.summary.closureDate && (!latest || c.summary.closureDate > latest)) latest = c.summary.closureDate;
    outflow = outflow.plus(dec(c.summary.remainingCashOutflow));
    interest = interest.plus(dec(c.summary.remainingInterest));
  }
  return { allClosedBy: anyOpenEnded ? null : latest, remainingOutflow: money(outflow), remainingInterest: money(interest), anyOpenEnded };
}

