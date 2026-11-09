import { calculateEmi, computeLoan } from './engine';
import { addDays, addMonths, parts, type ISODate } from './dates';
import { DEFAULT_REMINDER_SETTINGS } from './reminders';
import type { Loan, Payment, Preferences, Adjustment, Bill, BillPayment, CustomReminder, Debt, DebtRepayment } from './types';

export const DASHBOARD_WIDGETS: { id: string; label: string }[] = [
  { id: 'summary', label: 'Financial summary' },
  { id: 'due', label: 'Due & overdue' },
  { id: 'breakdown', label: 'Principal vs interest' },
  { id: 'paidRemaining', label: 'Paid vs remaining' },
  { id: 'progress', label: 'Loan-wise progress' },
  { id: 'monthly', label: 'Monthly payment history' },
  { id: 'actualVsScheduled', label: 'Actual vs scheduled' },
  { id: 'interestTrend', label: 'Interest paid over time' },
  { id: 'timeline', label: 'Loan closure timeline' },
  { id: 'calendar', label: 'Upcoming payment calendar' },
  { id: 'distribution', label: 'Payment distribution by year' },
  { id: 'heatmap', label: 'Repayment heatmap' },
];

export const DEFAULT_PREFERENCES: Preferences = {
  currency: 'INR',
  locale: 'en-IN',
  decimals: 2,
  dateFormat: 'DD MMM YYYY',
  weekStart: 1,
  timeZone: '',
  theme: 'dark',
  accent: '#4f8cff',
  heatmapPalette: 'emerald',
  heatmapThresholds: [0, 5000, 25000, 75000],
  dashboardWidgets: DASHBOARD_WIDGETS.map((w) => ({ id: w.id, visible: true })),
  dashboardRange: '12m',
  loanSort: 'next_due',
  loanFilter: 'active',
  reminders: DEFAULT_REMINDER_SETTINGS,
};

export const LOAN_COLORS = ['#4f8cff', '#34c38f', '#f1b44c', '#a78bfa', '#f46a6a', '#50a5f1', '#f78fb3', '#7dd3c0'];

export function newId(): string {
  return globalThis.crypto.randomUUID();
}

export function nowTs(): string {
  return new Date().toISOString();
}

/** A blank loan with sensible, overridable defaults. */
export function blankLoan(today: ISODate, index = 0): Loan {
  const ts = nowTs();
  const first = addMonths(today, 1);
  return {
    id: newId(), createdAt: ts, updatedAt: ts,
    name: '', category: 'Home', lender: '', accountRef: '', maskAccountRef: true, loanType: 'home', status: 'active',
    sanctionDate: null, startDate: today, firstEmiDate: first, emiDueDay: parts(first)[2],
    sanctionedAmount: '', disbursedAmount: '', principal: '', annualRate: '', rateType: 'floating',
    interestMethod: 'reducing_monthly', frequency: 'monthly', emiAmount: null, emiRounding: 'rupee_nearest',
    totalInstallments: 240, moratoriumPeriods: 0, moratoriumTreatment: 'capitalize', preEmiInterest: '0.00',
    processingFee: '0.00', otherCharges: '0.00', lateFee: '0.00', penalRate: '0', gracePeriodDays: 0,
    advanceEmiBalance: '0.00', prepaymentEffect: 'reduce_tenure', allocationOrder: 'interest_principal_fees',
    installmentsPaidBeforeTracking: 0, openingOutstanding: null, trackingStartDate: today, lenderOutstanding: null,
    lenderOutstandingDate: null, reminderEnabled: true, reminderOffsets: null, notes: '', color: LOAN_COLORS[index % LOAN_COLORS.length],
  };
}

export function blankPayment(loanId: string, today: ISODate): Payment {
  const ts = nowTs();
  return {
    id: newId(), createdAt: ts, updatedAt: ts, loanId, txnDate: today, installmentNo: null, type: 'emi', amount: '',
    manualAllocation: false, allocPrincipal: '0.00', allocInterest: '0.00', allocFees: '0.00', allocPenalty: '0.00',
    reference: '', notes: '', attachmentPath: '', reconciled: false, status: 'active', reversalReason: '', reversedAt: null,
  };
}

export function blankAdjustment(loanId: string, today: ISODate): Adjustment {
  const ts = nowTs();
  return { id: newId(), createdAt: ts, updatedAt: ts, loanId, effectiveDate: today, kind: 'rate', annualRate: '', emiAmount: null, remainingInstallments: null, recalc: 'keep_emi', note: '' };
}

export function blankReminder(today: ISODate): CustomReminder {
  const ts = nowTs();
  return { id: newId(), createdAt: ts, updatedAt: ts, title: '', description: '', date: today, time: '09:00', repeat: 'none', loanId: null, enabled: true };
}

/**
 * Optional, clearly-labelled demo data generated relative to today. Never loaded unless the
 * user asks for it; every demo record is named "Demo …".
 */
export function demoData(today: ISODate): { loans: Loan[]; payments: Payment[]; adjustments: Adjustment[] } {
  const mk = (i: number, over: Partial<Loan>): Loan => ({ ...blankLoan(today, i), ...over, notes: 'Demo data — safe to delete.' });
  const home = mk(0, {
    name: 'Demo Home Loan', category: 'Home', lender: 'Demo Bank', loanType: 'home', principal: '4500000.00',
    sanctionedAmount: '5000000.00', disbursedAmount: '4500000.00', annualRate: '8.50', totalInstallments: 240,
    startDate: addMonths(today, -26, 5), firstEmiDate: addMonths(today, -25, 5), emiDueDay: 5, sanctionDate: addMonths(today, -27, 20),
    processingFee: '10000.00', trackingStartDate: addMonths(today, -26, 5),
  });
  home.emiAmount = calculateEmi(home.principal, home.annualRate, home.totalInstallments, 'monthly', 'reducing_monthly', 'rupee_nearest');
  const car = mk(1, {
    name: 'Demo Car Loan', category: 'Vehicle', lender: 'Demo Finance', loanType: 'vehicle', principal: '800000.00',
    sanctionedAmount: '800000.00', disbursedAmount: '800000.00', annualRate: '9.25', totalInstallments: 60, rateType: 'fixed',
    startDate: addMonths(today, -14, 10), firstEmiDate: addMonths(today, -13, 10), emiDueDay: 10, sanctionDate: addMonths(today, -14, 1),
    lateFee: '500.00', gracePeriodDays: 3, trackingStartDate: addMonths(today, -14, 10),
  });
  car.emiAmount = calculateEmi(car.principal, car.annualRate, car.totalInstallments, 'monthly', 'reducing_monthly', 'rupee_nearest');
  const personal = mk(2, {
    name: 'Demo Personal Loan', category: 'Personal', lender: 'Demo Credit', loanType: 'personal', principal: '300000.00',
    sanctionedAmount: '300000.00', disbursedAmount: '300000.00', annualRate: '12.50', totalInstallments: 36, rateType: 'fixed',
    startDate: addMonths(today, -8, 20), firstEmiDate: addMonths(today, -7, 20), emiDueDay: 20, sanctionDate: addMonths(today, -8, 15),
    trackingStartDate: addMonths(today, -8, 20),
  });
  personal.emiAmount = calculateEmi(personal.principal, personal.annualRate, personal.totalInstallments, 'monthly', 'reducing_monthly', 'rupee_nearest');
  const loans = [home, car, personal];
  const payments: Payment[] = [];
  loans.forEach((loan, li) => {
    const rows = computeLoan(loan, [], [], loan.startDate, { mode: 'contract', skipBaseline: true }).rows.filter((r) => r.dueDate < today);
    rows.forEach((r, ri) => {
      // the personal loan's latest installment is left unpaid to demonstrate overdue tracking
      if (li === 2 && ri === rows.length - 1) return;
      const late = li === 1 && ri % 5 === 4;
      payments.push({ ...blankPayment(loan.id, r.dueDate), txnDate: late ? addDays(r.dueDate, 6) : addDays(r.dueDate, -(ri % 3)), installmentNo: r.no,
        amount: r.scheduledAmount, reference: `DEMO-${li + 1}-${r.no}`, notes: 'Demo payment' });
    });
  });
  payments.push({ ...blankPayment(home.id, addMonths(today, -6, 15)), type: 'prepayment', amount: '200000.00', reference: 'DEMO-PREPAY', notes: 'Demo prepayment' });
  const adjustments: Adjustment[] = [{ ...blankAdjustment(home.id, addMonths(today, -10, 1)), annualRate: '8.75', recalc: 'keep_emi', note: 'Demo repo-rate revision' }];
  return { loans, payments, adjustments };
}

export function blankBill(today: ISODate): Bill {
  const ts = nowTs();
  return {
    id: newId(), createdAt: ts, updatedAt: ts, name: '', category: 'electricity', payee: '', amount: '', variable: false, frequency: 'monthly',
    dueDay: parts(today)[2], startDate: today, endDate: null, active: true, reminderEnabled: true, reminderOffsets: null, notes: '',
  };
}

export function blankBillPayment(billId: string, dueDate: ISODate, today: ISODate, amount: string): BillPayment {
  const ts = nowTs();
  return { id: newId(), createdAt: ts, updatedAt: ts, billId, dueDate, paidDate: today, amount, notes: '' };
}

export function blankDebt(today: ISODate, direction: Debt['direction'] = 'lent'): Debt {
  const ts = nowTs();
  return { id: newId(), createdAt: ts, updatedAt: ts, direction, person: '', amount: '', date: today, dueDate: null, reminderEnabled: true, notes: '' };
}

export function blankDebtRepayment(debtId: string, today: ISODate, amount: string): DebtRepayment {
  const ts = nowTs();
  return { id: newId(), createdAt: ts, updatedAt: ts, debtId, date: today, amount, notes: '' };
}
