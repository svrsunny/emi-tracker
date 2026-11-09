import type { Adjustment, Loan, Payment } from '../../src/shared/types';

const TS = '2024-01-01T00:00:00.000Z';

export function makeLoan(over: Partial<Loan> = {}): Loan {
  return {
    id: 'L1', createdAt: TS, updatedAt: TS,
    name: 'Test loan', category: 'Home', lender: 'Bank', accountRef: '', maskAccountRef: true, loanType: 'home',
    status: 'active', sanctionDate: null, startDate: '2024-01-01', firstEmiDate: '2024-02-01', emiDueDay: 1,
    sanctionedAmount: '100000.00', disbursedAmount: '100000.00', principal: '100000.00', annualRate: '12',
    rateType: 'fixed', interestMethod: 'reducing_monthly', frequency: 'monthly', emiAmount: null, emiRounding: 'paisa',
    totalInstallments: 12, moratoriumPeriods: 0, moratoriumTreatment: 'capitalize', preEmiInterest: '0.00',
    processingFee: '0.00', otherCharges: '0.00', lateFee: '0.00', penalRate: '0', gracePeriodDays: 0,
    advanceEmiBalance: '0.00', prepaymentEffect: 'reduce_tenure', allocationOrder: 'interest_principal_fees',
    installmentsPaidBeforeTracking: 0, openingOutstanding: null, trackingStartDate: '2024-01-01',
    lenderOutstanding: null, lenderOutstandingDate: null, reminderEnabled: true, reminderOffsets: null, notes: '',
    color: '#5b8def',
    ...over,
  };
}

let seq = 0;
export function pay(over: Partial<Payment>): Payment {
  seq++;
  return {
    id: `P${seq}`, createdAt: `2024-01-01T00:00:${String(seq % 60).padStart(2, '0')}.000Z`, updatedAt: TS,
    loanId: 'L1', txnDate: '2024-02-01', installmentNo: null, type: 'emi', amount: '0.00', manualAllocation: false,
    allocPrincipal: '0.00', allocInterest: '0.00', allocFees: '0.00', allocPenalty: '0.00', reference: '', notes: '',
    attachmentPath: '', reconciled: false, status: 'active', reversalReason: '', reversedAt: null,
    ...over,
  };
}

export function adj(over: Partial<Adjustment>): Adjustment {
  seq++;
  return {
    id: `A${seq}`, createdAt: TS, updatedAt: TS, loanId: 'L1', effectiveDate: '2024-06-01', kind: 'rate',
    annualRate: null, emiAmount: null, remainingInstallments: null, recalc: 'keep_emi', note: '',
    ...over,
  };
}

/** Record every scheduled installment due on or before `until` as paid on its due date. */
export function payAllUntil(rows: { no: number; dueDate: string; scheduledAmount: string }[], until: string): Payment[] {
  return rows.filter((r) => r.dueDate <= until).map((r) => pay({ installmentNo: r.no, txnDate: r.dueDate, amount: r.scheduledAmount }));
}
