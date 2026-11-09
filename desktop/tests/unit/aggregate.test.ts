import { describe, expect, it } from 'vitest';
import {
  annualSummary, autoThresholds, dailyCells, dashboardTotals, financialYearSummary, intensity, monthlyCells, monthlySeries, type Portfolio,
} from '../../src/shared/aggregate';
import { computeLoan } from '../../src/shared/engine';
import { runScenario, EMPTY_SCENARIO, combinedProjection } from '../../src/shared/forecast';
import { dec } from '../../src/shared/money';
import { makeLoan, pay, payAllUntil } from './fixtures';

function portfolio(asOf: string) {
  const a = makeLoan({ id: 'A', name: 'A' });
  const b = makeLoan({ id: 'B', name: 'B', principal: '50000.00', sanctionedAmount: '60000.00', disbursedAmount: '50000.00', firstEmiDate: '2024-02-10', emiDueDay: 10, totalInstallments: 6 });
  const ca = computeLoan(a, [], [], '2023-12-31');
  const cb = computeLoan(b, [], [], '2023-12-31');
  const payments = [
    ...payAllUntil(ca.rows, '2024-04-01').map((p) => ({ ...p, loanId: 'A' })),
    ...payAllUntil(cb.rows, '2024-03-10').map((p) => ({ ...p, loanId: 'B' })),
    pay({ loanId: 'B', type: 'prepayment', txnDate: '2024-03-10', amount: '1000.00' }),
  ];
  const loans = [a, b];
  const comps = new Map(loans.map((l) => [l.id, computeLoan(l, [], payments, asOf)]));
  return { loans, comps, payments } satisfies Portfolio;
}

describe('dashboard aggregation', () => {
  const p = portfolio('2024-04-05');
  const t = dashboardTotals(p, '2024-04-05');

  it('sums per-loan summaries exactly', () => {
    const sumOf = (k: 'principalRepaid' | 'totalPaid' | 'outstandingPrincipal' | 'interestPaid') =>
      [...p.comps.values()].reduce((s, c) => s.plus(dec(c.summary[k])), dec(0)).toFixed(2);
    expect(t.principalRepaid).toBe(sumOf('principalRepaid'));
    expect(t.totalPaid).toBe(sumOf('totalPaid'));
    expect(t.outstandingPrincipal).toBe(sumOf('outstandingPrincipal'));
    expect(t.interestPaid).toBe(sumOf('interestPaid'));
    expect(t.originalPrincipal).toBe('150000.00');
    expect(t.sanctioned).toBe('160000.00');
  });
  it('principal repaid + outstanding = original principal', () => {
    expect(dec(t.principalRepaid).plus(t.outstandingPrincipal).toFixed(2)).toBe(t.originalPrincipal);
  });
  it('total paid equals recorded payments', () => {
    const recorded = p.payments.reduce((s, x) => s.plus(dec(x.amount)), dec(0));
    expect(t.totalPaid).toBe(recorded.toFixed(2));
  });
  it('distinguishes outstanding principal from future cash outflow', () => {
    expect(dec(t.remainingOutflow).gt(dec(t.outstandingPrincipal))).toBe(true);
    expect(dec(t.remainingOutflow).minus(t.outstandingPrincipal).toFixed(2)).toBe(dec(t.remainingInterest).plus(t.remainingFees).toFixed(2));
  });
  it('next EMI, due windows and closure', () => {
    expect(t.nextEmi?.loanName).toBe('B');
    expect(t.nextEmi?.date).toBe('2024-04-10');
    expect(t.due7.map((d) => d.loanName)).toEqual(['B']);
    expect(t.overdue).toHaveLength(0);
    expect(t.activeLoans).toBe(2);
    expect(t.allClosedBy).toBe('2025-01-01');
  });
  it('loan filter limits totals', () => {
    const only = dashboardTotals(p, '2024-04-05', { loanIds: ['B'] });
    expect(only.originalPrincipal).toBe('50000.00');
  });
  it('combined projection takes the latest closure', () => {
    expect(combinedProjection([...p.comps.values()]).allClosedBy).toBe('2025-01-01');
  });
});

describe('heatmap aggregation', () => {
  const p = portfolio('2024-04-05');
  it('daily cells reconcile with payment history', () => {
    const cells = dailyCells(p, '2024-01-01', '2024-04-30', '2024-04-05');
    const total = [...cells.values()].reduce((s, c) => s.plus(dec(c.amount)), dec(0));
    const recorded = p.payments.reduce((s, x) => s.plus(dec(x.amount)), dec(0));
    expect(total.toFixed(2)).toBe(recorded.toFixed(2));
    const mar10 = cells.get('2024-03-10')!;
    expect(mar10.count).toBe(2);
    expect(mar10.state).toBe('extra');
    expect(dec(mar10.principal).plus(mar10.interest).toFixed(2)).toBe(mar10.amount);
  });
  it('distinguishes zero activity from no data', () => {
    const cells = dailyCells(p, '2023-12-01', '2024-01-31', '2024-04-05');
    expect(cells.get('2023-12-15')!.hasData).toBe(false);
    expect(cells.get('2023-12-15')!.state).toBe('no_data');
    expect(cells.get('2024-01-15')!.hasData).toBe(true);
    expect(cells.get('2024-01-15')!.amount).toBe('0.00');
  });
  it('calendar shows scheduled upcoming rows', () => {
    const cells = dailyCells(p, '2024-04-01', '2024-05-31', '2024-04-05');
    expect(cells.get('2024-05-01')!.state).toBe('upcoming');
    expect(cells.get('2024-04-01')!.state).toBe('paid');
  });
  it('monthly cells: amounts, installments and completion %', () => {
    const m = monthlyCells(p, '2024-01', '2024-06', '2024-04-05');
    const total = [...m.values()].reduce((s, c) => s.plus(dec(c.amount)), dec(0));
    expect(total.toFixed(2)).toBe(p.payments.reduce((s, x) => s.plus(dec(x.amount)), dec(0)).toFixed(2));
    expect(m.get('2024-02')!.installmentsPaid).toBe(2);
    expect(m.get('2024-02')!.completionPct).toBe(100);
    expect(m.get('2024-06')!.completionPct).toBeNull();
  });
  it('overdue month shows missed count and partial completion', () => {
    const p2 = portfolio('2024-05-20');
    const m = monthlyCells(p2, '2024-05', '2024-05', '2024-05-20');
    expect(m.get('2024-05')!.missedOrOverdue).toBe(2);
    expect(m.get('2024-05')!.completionPct).toBe(0);
  });
  it('intensity levels follow thresholds', () => {
    expect(intensity(0, [0, 100, 200, 300])).toBe(0);
    expect(intensity(50, [0, 100, 200, 300])).toBe(1);
    expect(intensity(150, [0, 100, 200, 300])).toBe(2);
    expect(intensity(1000, [0, 100, 200, 300])).toBe(4);
    expect(autoThresholds([10, 20, 30, 40])).toEqual([0, 20, 30, 40]);
  });
  it('series and annual / financial-year summaries reconcile', () => {
    const s = monthlySeries(p, {}, '2024-04-05');
    const paid = s.reduce((x, r) => x + r.paid, 0);
    expect(Math.round(paid * 100) / 100).toBe(+p.payments.reduce((a, x) => a.plus(dec(x.amount)), dec(0)).toFixed(2));
    expect(annualSummary(p)[0].year).toBe(2024);
    expect(financialYearSummary(p).map((f) => f.fy)).toEqual(['FY 2023-24', 'FY 2024-25']);
  });
});

describe('what-if scenarios', () => {
  const loan = makeLoan({ principal: '1000000', annualRate: '10', totalInstallments: 120 });
  const contract = computeLoan(loan, [], [], '2023-12-31');
  const pays = payAllUntil(contract.rows, '2024-12-01');
  const asOf = '2024-12-05';

  it('baseline scenario changes nothing', () => {
    const r = runScenario(loan, [], pays, asOf, EMPTY_SCENARIO);
    expect(r.monthsSaved).toBe(0);
    expect(r.interestSaved).toBe('0.00');
  });
  it('EMI increase saves months and interest', () => {
    const r = runScenario(loan, [], pays, asOf, { ...EMPTY_SCENARIO, emiIncrease: '2000' });
    expect(r.monthsSaved).toBeGreaterThan(10);
    expect(dec(r.interestSaved).gt(0)).toBe(true);
    expect(r.extraMonthlyCash).toBe('2000.00');
  });
  it('extra monthly principal saves interest', () => {
    const r = runScenario(loan, [], pays, asOf, { ...EMPTY_SCENARIO, extraMonthly: '2000' });
    expect(r.monthsSaved).toBeGreaterThan(10);
  });
  it('one-time and annual prepayments', () => {
    const one = runScenario(loan, [], pays, asOf, { ...EMPTY_SCENARIO, oneTimeAmount: '100000', oneTimeDate: '2025-01-15' });
    const annual = runScenario(loan, [], pays, asOf, { ...EMPTY_SCENARIO, annualAmount: '50000', annualMonth: 4 });
    expect(one.monthsSaved).toBeGreaterThan(5);
    expect(annual.monthsSaved).toBeGreaterThan(one.monthsSaved);
  });
  it('rate increase costs interest', () => {
    const r = runScenario(loan, [], pays, asOf, { ...EMPTY_SCENARIO, newRate: '12' });
    expect(dec(r.interestSaved).lt(0)).toBe(true);
    expect(r.monthsSaved).toBeLessThan(0);
  });
  it('combined strategies beat each alone', () => {
    const a = runScenario(loan, [], pays, asOf, { ...EMPTY_SCENARIO, emiIncrease: '2000' });
    const both = runScenario(loan, [], pays, asOf, { ...EMPTY_SCENARIO, emiIncrease: '2000', extraMonthly: '2000' });
    expect(dec(both.interestSaved).gt(dec(a.interestSaved))).toBe(true);
  });
  it('scenarios never persist simulated records', () => {
    runScenario(loan, [], pays, asOf, { ...EMPTY_SCENARIO, extraMonthly: '1000' });
    expect(pays.some((p) => p.id.startsWith('sim:'))).toBe(false);
  });
});
