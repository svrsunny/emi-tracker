import { describe, expect, it } from 'vitest';
import { calculateEmi, computeLoan, dueDateFor } from '../../src/shared/engine';
import { dec } from '../../src/shared/money';
import { adj, makeLoan, pay, payAllUntil } from './fixtures';

const sum = (xs: string[]) => xs.reduce((s, x) => s.plus(dec(x)), dec(0));

describe('EMI formula — known examples', () => {
  it('1,00,000 @ 12% for 12 months = 8,884.88', () => {
    expect(calculateEmi('100000', '12', 12, 'monthly', 'reducing_monthly', 'paisa')).toBe('8884.88');
  });
  it('10,00,000 @ 10% for 120 months = 13,215.07', () => {
    expect(calculateEmi('1000000', '10', 120, 'monthly', 'reducing_monthly', 'paisa')).toBe('13215.07');
  });
  it('50,00,000 @ 8.5% for 240 months = 43,391.16 (rupee rounding -> 43,391)', () => {
    expect(calculateEmi('5000000', '8.5', 240, 'monthly', 'reducing_monthly', 'paisa')).toBe('43391.16');
    expect(calculateEmi('5000000', '8.5', 240, 'monthly', 'reducing_monthly', 'rupee_nearest')).toBe('43391.00');
    expect(calculateEmi('5000000', '8.5', 240, 'monthly', 'reducing_monthly', 'rupee_up')).toBe('43392.00');
  });
  it('zero interest divides evenly', () => {
    expect(calculateEmi('120000', '0', 12, 'monthly', 'reducing_monthly', 'paisa')).toBe('10000.00');
  });
  it('flat rate: 1,00,000 @ 10% flat for 24 months', () => {
    // total interest = 1,00,000 * 10% * 2 = 20,000 ; EMI = 1,20,000 / 24 = 5,000
    expect(calculateEmi('100000', '10', 24, 'monthly', 'flat', 'paisa')).toBe('5000.00');
  });
});

describe('contract amortization schedule', () => {
  const loan = makeLoan();
  const c = computeLoan(loan, [], [], '2023-12-31');

  it('produces 12 rows that fully amortize the principal', () => {
    expect(c.rows).toHaveLength(12);
    expect(c.rows[11].closingPrincipal).toBe('0.00');
    expect(sum(c.rows.map((r) => r.principalDue)).toFixed(2)).toBe('100000.00');
  });
  it('first row: interest 1,000.00, principal 7,884.88', () => {
    expect(c.rows[0].interest).toBe('1000.00');
    expect(c.rows[0].principalDue).toBe('7884.88');
    expect(c.rows[0].closingPrincipal).toBe('92115.12');
  });
  it('each row: opening - principal = closing; interest + principal = scheduled', () => {
    for (const r of c.rows) {
      expect(dec(r.openingPrincipal).minus(dec(r.paidPrincipal)).minus(dec(r.extraPrincipal)).toFixed(2)).toBe(r.closingPrincipal);
      expect(dec(r.interest).plus(dec(r.principalDue)).toFixed(2)).toBe(r.scheduledAmount);
    }
  });
  it('final row absorbs rounding; total interest ~ 6,618.55', () => {
    const totalInterest = sum(c.rows.map((r) => r.interest));
    expect(totalInterest.toFixed(2)).toBe(c.summary.remainingInterest);
    expect(Math.abs(totalInterest.toNumber() - 6618.55)).toBeLessThan(0.1);
    expect(c.summary.remainingPrincipal).toBe('100000.00');
    expect(c.summary.closureDate).toBe('2025-01-01');
  });
  it('remaining installment counter counts down', () => {
    expect(c.rows.map((r) => r.remainingInstallments)).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  });
});

describe('due dates: month-end and leap years', () => {
  it('due day 31 clamps to month ends including leap February', () => {
    const l = makeLoan({ firstEmiDate: '2024-01-31', emiDueDay: 31 });
    expect([0, 1, 2, 3].map((i) => dueDateFor(l, i))).toEqual(['2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30']);
  });
  it('non-leap February', () => {
    const l = makeLoan({ firstEmiDate: '2023-01-30', emiDueDay: 30 });
    expect(dueDateFor(l, 1)).toBe('2023-02-28');
    expect(dueDateFor(l, 2)).toBe('2023-03-30');
  });
  it('quarterly and weekly frequencies', () => {
    expect(dueDateFor(makeLoan({ frequency: 'quarterly', firstEmiDate: '2024-01-15', emiDueDay: 15 }), 2)).toBe('2024-07-15');
    expect(dueDateFor(makeLoan({ frequency: 'weekly', firstEmiDate: '2024-02-26' }), 1)).toBe('2024-03-04');
  });
  it('daily-reducing interest counts the leap day', () => {
    const l = makeLoan({ interestMethod: 'reducing_daily', startDate: '2024-01-31', firstEmiDate: '2024-02-29', emiDueDay: 29, emiAmount: '9000.00' });
    const c = computeLoan(l, [], [], '2024-01-01');
    // 29 days on 1,00,000 @ 12% / 365
    expect(c.rows[0].interest).toBe('953.42');
  });
});

describe('recorded payments and reconciliation of totals', () => {
  const loan = makeLoan();
  const contract = computeLoan(loan, [], [], '2023-12-31');

  it('on-time payments: statuses, outstanding and invariant totals', () => {
    const pays = payAllUntil(contract.rows, '2024-06-01');
    const c = computeLoan(loan, [], pays, '2024-06-15');
    expect(c.rows.slice(0, 5).every((r) => r.status === 'paid')).toBe(true);
    expect(c.rows[5].status).toBe('upcoming');
    expect(c.summary.installmentsPaid).toBe(5);
    expect(c.summary.installmentsRemaining).toBe(7);
    expect(c.summary.outstandingPrincipal).toBe(contract.rows[4].closingPrincipal);
    // totalPaid = principal + interest + fees + unapplied
    const s = c.summary;
    expect(dec(s.principalRepaid).plus(s.interestPaid).plus(s.feesPaid).plus(s.penaltiesPaid).plus(s.unapplied).toFixed(2)).toBe(s.totalPaid);
    expect(sum(pays.map((p) => p.amount)).toFixed(2)).toBe(s.totalPaidRecorded);
    // outstanding + future principal reconcile with original principal
    expect(dec(s.principalRepaid).plus(s.outstandingPrincipal).toFixed(2)).toBe('100000.00');
    expect(s.remainingPrincipal).toBe(s.outstandingPrincipal);
    expect(s.interestSaved).toBe('0.00');
  });

  it('does not assume a past-due EMI was paid', () => {
    const c = computeLoan(loan, [], [], '2024-03-15');
    expect(c.rows[0].status).toBe('overdue');
    expect(c.rows[1].status).toBe('overdue');
    expect(c.summary.overdueCount).toBe(2);
    expect(c.summary.outstandingPrincipal).toBe('100000.00');
    expect(c.summary.installmentsPaid).toBe(0);
  });

  it('due today and grace period', () => {
    expect(computeLoan(loan, [], [], '2024-02-01').rows[0].status).toBe('due');
    const g = makeLoan({ gracePeriodDays: 5 });
    expect(computeLoan(g, [], [], '2024-02-04').rows[0].status).toBe('due');
    expect(computeLoan(g, [], [], '2024-02-07').rows[0].status).toBe('overdue');
  });

  it('partial payment leaves shortfall and carries interest arrears', () => {
    const c = computeLoan(loan, [], [pay({ installmentNo: 1, txnDate: '2024-02-01', amount: '5000.00', type: 'partial' })], '2024-02-10');
    const r = c.rows[0];
    expect(r.status).toBe('partially_paid');
    expect(r.paidInterest).toBe('1000.00');
    expect(r.paidPrincipal).toBe('4000.00');
    expect(r.shortfall).toBe('3884.88');
    expect(c.summary.outstandingPrincipal).toBe('96000.00');
  });

  it('missed marker and later late payment', () => {
    const missed = pay({ installmentNo: 1, type: 'missed', amount: '0.00', txnDate: '2024-02-05' });
    expect(computeLoan(loan, [], [missed], '2024-02-20').rows[0].status).toBe('missed');
    const late = pay({ installmentNo: 1, txnDate: '2024-02-20', amount: '8884.88' });
    const c = computeLoan(loan, [], [missed, late], '2024-02-25');
    expect(c.rows[0].status).toBe('paid');
    expect(c.rows[0].late).toBe(true);
  });

  it('late fee and penal interest are estimated as charges due', () => {
    const l = makeLoan({ lateFee: '500.00', penalRate: '24', gracePeriodDays: 0 });
    const c = computeLoan(l, [], [pay({ installmentNo: 1, txnDate: '2024-03-02', amount: '8884.88' })], '2024-03-10');
    // late fee 500 + penal interest: 30 days late on 8,884.88 at 24% p.a. = 175.26
    expect(c.rows[0].feesCharged).toBe('675.26');
    // row 2 (due 1 Mar) is also overdue on 10 Mar: 500 + 9 days penal on 8,884.88 = 552.58
    expect(c.summary.chargesDue).toBe('1227.84');
    expect(c.summary.isEstimate).toBe(true);
    const paidFee = computeLoan(l, [], [pay({ installmentNo: 1, txnDate: '2024-03-02', amount: '8884.88' }), pay({ type: 'fee', txnDate: '2024-03-05', amount: '500.00' })], '2024-03-10');
    expect(paidFee.summary.chargesDue).toBe('727.84');
  });

  it('advance payment for a future installment shows as prepaid', () => {
    const pays = [
      pay({ installmentNo: 1, txnDate: '2024-02-01', amount: '8884.88' }),
      pay({ installmentNo: 2, txnDate: '2024-02-10', amount: '8884.88', type: 'advance' }),
    ];
    const c = computeLoan(loan, [], pays, '2024-02-15');
    expect(c.rows[1].status).toBe('prepaid');
    expect(c.summary.installmentsPaid).toBe(2);
    expect(c.summary.nextUpcoming?.no).toBe(3);
    expect(dec(c.summary.principalRepaid).plus(c.summary.outstandingPrincipal).toFixed(2)).toBe('100000.00');
  });

  it('excess on an EMI payment is extra principal', () => {
    const c = computeLoan(loan, [], [pay({ installmentNo: 1, txnDate: '2024-02-01', amount: '10884.88' })], '2024-02-05');
    expect(c.rows[0].extraPrincipal).toBe('2000.00');
    expect(c.summary.outstandingPrincipal).toBe('90115.12');
  });

  it('waiver marks the row waived and forgives its interest', () => {
    const c = computeLoan(loan, [], [pay({ installmentNo: 1, type: 'waiver', amount: '0.00', txnDate: '2024-02-01' })], '2024-02-10');
    expect(c.rows[0].status).toBe('waived');
    expect(c.summary.interestArrears).toBe('0.00');
  });

  it('reversed payments are ignored', () => {
    const p = pay({ installmentNo: 1, txnDate: '2024-02-01', amount: '8884.88', status: 'reversed' });
    expect(computeLoan(loan, [], [p], '2024-02-10').rows[0].status).toBe('overdue');
  });

  it('manual allocation from a lender statement is respected', () => {
    const p = pay({ installmentNo: 1, txnDate: '2024-02-01', amount: '8884.88', manualAllocation: true, allocPrincipal: '7900.00', allocInterest: '984.88' });
    const c = computeLoan(loan, [], [p], '2024-02-10');
    expect(c.allocations[p.id].principal).toBe('7900.00');
    expect(c.allocations[p.id].interest).toBe('984.88');
    expect(c.summary.outstandingPrincipal).toBe('92100.00');
  });
});

describe('prepayments, foreclosure and forecasts', () => {
  const loan = makeLoan({ principal: '1000000', sanctionedAmount: '1000000', disbursedAmount: '1000000', annualRate: '10', totalInstallments: 120 });
  const contract = computeLoan(loan, [], [], '2023-12-31');

  it('contract closes after 120 installments', () => {
    expect(contract.rows.filter((r) => r.kind === 'emi')).toHaveLength(120);
    expect(contract.summary.closureDate).toBe('2034-01-01');
  });

  it('prepayment reduces tenure and saves interest', () => {
    const pays = [...payAllUntil(contract.rows, '2025-01-01'), pay({ type: 'prepayment', txnDate: '2025-01-01', amount: '200000.00' })];
    const c = computeLoan(loan, [], pays, '2025-01-15');
    expect(c.summary.periodsSaved).toBeGreaterThan(20);
    expect(dec(c.summary.interestSaved).gt(100000)).toBe(true);
    expect(c.summary.closureDate! < '2034-01-01').toBe(true);
    // EMI unchanged
    expect(c.summary.currentEmi).toBe('13215.07');
    expect(c.summary.remainingPrincipal).toBe(c.summary.outstandingPrincipal);
  });

  it('prepayment with reduce_emi lowers EMI and keeps the tenure', () => {
    const l = { ...loan, prepaymentEffect: 'reduce_emi' as const };
    const pays = [...payAllUntil(contract.rows, '2025-01-01'), pay({ type: 'prepayment', txnDate: '2025-01-01', amount: '200000.00' })];
    const c = computeLoan(l, [], pays, '2025-01-15');
    expect(dec(c.summary.currentEmi).lt(13215.07)).toBe(true);
    expect(c.summary.closureDate).toBe('2034-01-01');
  });

  it('foreclosure closes the loan and cancels remaining rows', () => {
    const paid = payAllUntil(contract.rows, '2024-06-01');
    const bal = dec(contract.rows[4].closingPrincipal);
    // 14 days interest on balance accrues in the monthly method pro-rata of the period
    const fc = pay({ type: 'foreclosure', txnDate: '2024-06-15', amount: bal.plus(5000).toFixed(2) });
    const c = computeLoan(loan, [], [...paid, fc], '2024-06-20');
    expect(c.summary.closureDate).toBe('2024-06-15');
    expect(c.summary.computedClosed).toBe(true);
    expect(c.summary.outstandingPrincipal).toBe('0.00');
    expect(c.rows[c.rows.length - 1].status).toBe('cancelled');
    expect(dec(c.allocations[fc.id].unapplied).gt(0)).toBe(true);
    expect(c.summary.installmentsRemaining).toBe(0);
  });

  it('closure date is derived from amortization, not balance / EMI', () => {
    const c = computeLoan(loan, [], payAllUntil(contract.rows, '2024-12-01'), '2024-12-15');
    const naive = Math.ceil(dec(c.summary.outstandingPrincipal).div(13215.07).toNumber());
    expect(c.summary.installmentsRemaining).toBeGreaterThan(naive);
  });
});

describe('variable rates, EMI changes and restructuring', () => {
  const loan = makeLoan({ principal: '1000000', annualRate: '10', totalInstallments: 120 });
  const contract = computeLoan(loan, [], [], '2023-12-31');

  it('rate rise with keep_emi extends the tenure', () => {
    const c = computeLoan(loan, [adj({ effectiveDate: '2024-06-01', annualRate: '12', recalc: 'keep_emi' })], [], '2023-12-31');
    expect(c.rows.filter((r) => r.kind === 'emi').length).toBeGreaterThan(120);
    expect(c.rows[6].rate).toBe('12.00');
    expect(c.rows[4].rate).toBe('10.00');
  });

  it('rate change with recompute_emi keeps the tenure and changes the EMI', () => {
    const c = computeLoan(loan, [adj({ effectiveDate: '2024-06-01', annualRate: '12', recalc: 'recompute_emi' })], [], '2023-12-31');
    expect(c.rows.filter((r) => r.kind === 'emi').length).toBe(120);
    expect(dec(c.rows[6].emi).gt(dec(c.rows[0].emi))).toBe(true);
  });

  it('mid-period rate change splits interest pro-rata', () => {
    const c = computeLoan(loan, [adj({ effectiveDate: '2024-02-16', annualRate: '12' })], [], '2023-12-31');
    // Feb period: 15 days @10% + 14 days @12% of 29 days on the March-1 row
    const r = c.rows[1];
    const bal = dec(r.openingPrincipal);
    const expected = bal.mul(0.10).div(12).mul(15).div(29).plus(bal.mul(0.12).div(12).mul(14).div(29));
    expect(r.interest).toBe(expected.toDecimalPlaces(2).toFixed(2));
  });

  it('EMI change applies from its effective date', () => {
    const c = computeLoan(loan, [adj({ kind: 'emi', effectiveDate: '2024-03-15', emiAmount: '20000.00' })], [], '2023-12-31');
    expect(c.rows[2].emi).toBe('20000.00');
    expect(c.rows[1].emi).toBe(contract.rows[1].emi);
    expect(c.summary.closureDate! < contract.summary.closureDate!).toBe(true);
  });

  it('restructure resets the remaining tenure', () => {
    const c = computeLoan(loan, [adj({ kind: 'restructure', effectiveDate: '2024-06-15', annualRate: '9', remainingInstallments: 60 })], [], '2023-12-31');
    expect(c.rows.filter((r) => r.kind === 'emi').length).toBe(5 + 60);
  });
});

describe('moratorium and pre-tracking history', () => {
  it('capitalized moratorium increases principal before EMIs', () => {
    const l = makeLoan({ moratoriumPeriods: 3, moratoriumTreatment: 'capitalize' });
    const c = computeLoan(l, [], [], '2023-12-31');
    expect(c.rows.slice(0, 3).every((r) => r.kind === 'moratorium' && r.status === 'moratorium')).toBe(true);
    expect(dec(c.rows[3].openingPrincipal).gt(100000)).toBe(true);
    expect(c.rows.filter((r) => r.kind === 'emi')).toHaveLength(12);
  });
  it('interest-only moratorium keeps the principal', () => {
    const l = makeLoan({ moratoriumPeriods: 2, moratoriumTreatment: 'interest_only' });
    const c = computeLoan(l, [], [], '2023-12-31');
    expect(c.rows[0].scheduledAmount).toBe('1000.00');
    expect(c.rows[2].openingPrincipal).toBe('100000.00');
  });
  it('installments paid before tracking are assumed and labelled estimates', () => {
    const l = makeLoan({ installmentsPaidBeforeTracking: 6, trackingStartDate: '2024-07-15' });
    const c = computeLoan(l, [], [], '2024-07-20');
    expect(c.rows.slice(0, 6).every((r) => r.status === 'assumed_paid' && r.isEstimated)).toBe(true);
    expect(c.summary.isEstimate).toBe(true);
    expect(c.summary.principalRepaidEstimated).toBe(c.summary.principalRepaid);
    expect(c.summary.installmentsPaid).toBe(6);
  });
  it('opening outstanding override records a balance adjustment', () => {
    const l = makeLoan({ installmentsPaidBeforeTracking: 6, openingOutstanding: '52000.00', trackingStartDate: '2024-07-15' });
    const c = computeLoan(l, [], [], '2024-07-20');
    expect(c.summary.outstandingPrincipal).toBe('52000.00');
    expect(c.rows[5].closingPrincipal).toBe('52000.00');
  });
  it('unrecorded history is flagged, not inferred as missed', () => {
    const l = makeLoan({ trackingStartDate: '2024-05-01' });
    const c = computeLoan(l, [], [], '2024-05-10');
    expect(c.rows[0].status).toBe('unrecorded');
    expect(c.rows[3].status).toBe('overdue'); // 2024-05-01 is on/after tracking start
    expect(c.summary.unrecordedCount).toBe(3);
  });
  it('lender balance reconciliation reports the difference', () => {
    const l = makeLoan({ lenderOutstanding: '93000.00', lenderOutstandingDate: '2024-02-10' });
    const c = computeLoan(l, [], [pay({ installmentNo: 1, txnDate: '2024-02-01', amount: '8884.88' })], '2024-02-15');
    expect(c.summary.reconciliation?.calculated).toBe('92115.12');
    expect(c.summary.reconciliation?.difference).toBe('884.88');
  });
});

describe('non-converging loans', () => {
  it('flags an EMI smaller than the interest', () => {
    const c = computeLoan(makeLoan({ emiAmount: '500.00' }), [], [], '2023-12-31');
    expect(c.summary.nonConverging).toBe(true);
    expect(c.summary.closureDate).toBeNull();
  });
});

describe('long arrears', () => {
  it('a loan with many unpaid EMIs still projects to closure and reconciles outflow', () => {
    const loan = makeLoan({ principal: '1000000', annualRate: '10', totalInstallments: 120, emiAmount: '13215.07' });
    const c = computeLoan(loan, [], [pay({ installmentNo: 1, txnDate: '2024-02-01', amount: '13215.07' })], '2026-10-28');
    expect(c.summary.nonConverging).toBe(false);
    expect(c.summary.overdueCount).toBeGreaterThan(30);
    expect(c.summary.closureDate! > '2034-01-01').toBe(true);
    // future outflow = outstanding principal + all remaining interest (arrears included) + charges
    const s = c.summary;
    expect(dec(s.remainingCashOutflow).toFixed(2)).toBe(dec(s.outstandingPrincipal).plus(s.remainingInterest).plus(s.remainingFees).toFixed(2));
    expect(dec(s.remainingInterest).gte(dec(s.interestArrears))).toBe(true);
  });
});
