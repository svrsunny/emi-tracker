/** Chit funds: no interest, a fixed installment, and dividends when an installment is paid for less. */
import { describe, expect, it } from 'vitest';
import { computeLoan } from '../../src/shared/engine';
import { loanSchema } from '../../src/shared/validation';
import { makeLoan, pay } from './fixtures';

const chit = makeLoan({
  name: 'Ramesh chit', loanType: 'chit_fund', category: 'Chit fund', principal: '100000.00', sanctionedAmount: '100000.00', disbursedAmount: '100000.00',
  annualRate: '0', rateType: 'fixed', interestMethod: 'flat', emiAmount: '5000.00', totalInstallments: 20,
  startDate: '2024-02-01', firstEmiDate: '2024-02-01', trackingStartDate: '2024-02-01',
});

describe('chit fund', () => {
  it('is a valid loan type', () => {
    const r = loanSchema.safeParse(chit);
    expect(r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)).toEqual([]);
  });

  it('schedules the full installment every month with no interest', () => {
    const c = computeLoan(chit, [], [], '2024-01-15');
    expect(c.rows.filter((r) => r.kind === 'emi')).toHaveLength(20);
    expect(c.rows.every((r) => r.scheduledAmount === '5000.00' && r.interest === '0.00')).toBe(true);
    expect(c.summary.remainingCashOutflow).toBe('100000.00');
    expect(c.summary.warnings.some((w) => w.includes('Flat-rate'))).toBe(false);
    expect(c.summary.isEstimate).toBe(false);
  });

  it('settles an installment paid for less and records the dividend', () => {
    const pays = [
      pay({ loanId: 'L1', installmentNo: 1, txnDate: '2024-02-01', amount: '5000.00' }),
      pay({ loanId: 'L1', installmentNo: 2, txnDate: '2024-03-01', amount: '4600.00' }),
      pay({ loanId: 'L1', installmentNo: 3, txnDate: '2024-04-02', amount: '4250.00' }),
    ];
    const c = computeLoan(chit, [], pays, '2024-04-10');
    const [r1, r2, r3, r4] = c.rows;
    expect([r1.status, r2.status, r3.status]).toEqual(['paid', 'paid', 'paid']);
    expect([r1.dividend, r2.dividend, r3.dividend]).toEqual(['0.00', '400.00', '750.00']);
    expect(r2.shortfall).toBe('0.00');
    expect(r4.status).toBe('upcoming');
    expect(r4.scheduledAmount).toBe('5000.00'); // later installments stay at the full amount
    const s = c.summary;
    expect(s.dividends).toBe('1150.00');
    expect(s.totalPaid).toBe('13850.00');
    expect(s.installmentsPaid).toBe(3);
    expect(s.installmentsRemaining).toBe(17);
    expect(s.outstandingPrincipal).toBe('85000.00'); // 17 installments left, dividends are not owed
    expect(s.overdueCount).toBe(0);
    expect(s.remainingCashOutflow).toBe('85000.00');
    expect(c.rows.filter((r) => r.kind === 'emi' && r.status !== 'cancelled')).toHaveLength(20); // no extra month added
  });

  it('a fully unpaid past installment is still overdue', () => {
    const c = computeLoan(chit, [], [pay({ loanId: 'L1', installmentNo: 1, txnDate: '2024-02-01', amount: '4800.00' })], '2024-03-20');
    expect(c.rows[1].status).toBe('overdue');
    expect(c.summary.overdueAmount).toBe('5000.00');
  });

  it('other loans keep the partial-payment behaviour', () => {
    const c = computeLoan({ ...chit, loanType: 'personal' }, [], [pay({ loanId: 'L1', installmentNo: 1, txnDate: '2024-02-01', amount: '4600.00' })], '2024-02-10');
    expect(c.rows[0].status).toBe('partially_paid');
    expect(c.rows[0].dividend).toBe('0.00');
    expect(c.summary.dividends).toBe('0.00');
  });
});
