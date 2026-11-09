/**
 * Money lent to or borrowed from people (friends, family): no interest, just amounts, a due date
 * and repayments. Kept apart from monthly expenses. The Android app has the same logic in
 * core/Debts.kt.
 */
import type { ISODate } from './dates';
import { dec, maxD, money, ZERO } from './money';
import type { Debt, DebtRepayment } from './types';

export type DebtStatus = 'settled' | 'overdue' | 'due' | 'pending';

export interface DebtSummary { repaid: string; pending: string; status: DebtStatus; repayments: DebtRepayment[] }

export function debtSummary(d: Debt, repayments: DebtRepayment[], asOf: ISODate): DebtSummary {
  const own = repayments.filter((r) => r.debtId === d.id).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const repaid = own.reduce((s, r) => s.plus(dec(r.amount)), ZERO);
  const pending = maxD(ZERO, dec(d.amount).minus(repaid));
  const status: DebtStatus = pending.lte(0) ? 'settled' : !d.dueDate ? 'pending' : d.dueDate < asOf ? 'overdue' : d.dueDate === asOf ? 'due' : 'pending';
  return { repaid: money(repaid), pending: money(pending), status, repayments: own };
}

export interface DebtSideStats { amount: string; repaid: string; pending: string; count: number }

/** Totals of the entries on screen, per side: amount given / taken, returned so far, still pending. */
export function debtStats(rows: { d: Debt; s: DebtSummary }[]): Record<Debt['direction'], DebtSideStats> {
  const side = (dir: Debt['direction']): DebtSideStats => {
    const xs = rows.filter((r) => r.d.direction === dir);
    const sum = (f: (r: { d: Debt; s: DebtSummary }) => string) => money(xs.reduce((t, r) => t.plus(dec(f(r))), ZERO));
    return { amount: sum((r) => r.d.amount), repaid: sum((r) => r.s.repaid), pending: sum((r) => r.s.pending), count: xs.length };
  };
  return { lent: side('lent'), borrowed: side('borrowed') };
}
