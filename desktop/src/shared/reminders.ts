/**
 * Reminder planning. A pure function turns the current loan state + settings + delivery
 * history into reminder occurrences. Every occurrence has a deterministic dedupe key, so a
 * reminder is delivered at most once no matter how often the planner runs, across restarts
 * and across synced devices. Times are local wall-clock strings "YYYY-MM-DDTHH:MM" in the
 * user's configured time zone, compared lexicographically.
 */
import { addDays, diffDays, fmtISO, isoWeekKey, parts, daysInMonth, weekday, type ISODate } from './dates';
import { OPEN_STATUSES, type LoanComputation } from './engine';
import { billOccurrences } from './bills';
import { debtSummary } from './debts';
import type { Adjustment, Bill, BillPayment, CustomReminder, Debt, DebtRepayment, Loan, NotificationRecord, ReminderCategory, ReminderSettings } from './types';

export interface PlannedReminder {
  key: string;
  category: ReminderCategory;
  title: string;
  body: string;
  loanId: string | null;
  at: string; // local wall time YYYY-MM-DDTHH:MM after quiet-hour / weekday shifting
  late: boolean;
}

export interface PlannerInput {
  now: string; // local wall time YYYY-MM-DDTHH:MM
  settings: ReminderSettings;
  loans: Loan[];
  comps: Map<string, LoanComputation>;
  adjustments: Adjustment[];
  custom: CustomReminder[];
  bills: Bill[];
  billPayments: BillPayment[];
  debts?: Debt[];
  debtRepayments?: DebtRepayment[];
  history: Pick<NotificationRecord, 'key' | 'state' | 'snoozedUntil'>[];
  lastBackupDate: ISODate | null;
  formatMoney: (amount: string) => string;
  formatDate: (d: ISODate) => string;
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  enabled: true,
  categories: {
    emi_upcoming: true, emi_due: true, emi_overdue: true, emi_missed: true, loan_closure: true,
    summary_monthly: true, summary_weekly: false, backup: true, custom: true, rate_change: true, bill: true, debt: true,
  },
  offsets: [7, 3, 1],
  time: '09:00',
  overdueRepeatDays: 2,
  maxRepeats: 5,
  quietStart: '22:00',
  quietEnd: '08:00',
  quietEnabled: true,
  weekdays: [true, true, true, true, true, true, true],
  sound: true,
  vibrate: true,
  snoozeMinutes: 60,
  priority: 'high',
  channels: { native: true, inApp: true },
  closureLeadDays: 30,
  backupIntervalDays: 7,
  weeklySummaryDay: 1,
  catchUpDays: 3,
};

const at = (d: ISODate, t: string) => `${d}T${t}`;

function inQuiet(time: string, s: ReminderSettings): boolean {
  if (!s.quietEnabled || s.quietStart === s.quietEnd) return false;
  return s.quietStart < s.quietEnd ? time >= s.quietStart && time < s.quietEnd : time >= s.quietStart || time < s.quietEnd;
}

/** Shift an occurrence out of quiet hours and onto an allowed weekday. */
export function adjustTime(when: string, s: ReminderSettings): string {
  let date = when.slice(0, 10);
  let time = when.slice(11, 16);
  if (inQuiet(time, s)) {
    // move to the end of quiet hours (next day if the window crosses midnight and we are before midnight)
    if (s.quietStart > s.quietEnd && time >= s.quietStart) date = addDays(date, 1);
    time = s.quietEnd;
  }
  if (s.weekdays.some(Boolean)) {
    for (let i = 0; i < 7 && !s.weekdays[weekday(date)]; i++) date = addDays(date, 1);
  }
  return at(date, time);
}

function addMinutes(when: string, minutes: number): string {
  const d = when.slice(0, 10);
  const [h, m] = when.slice(11, 16).split(':').map(Number);
  const total = h * 60 + m + minutes;
  const days = Math.floor(total / 1440);
  const rem = ((total % 1440) + 1440) % 1440;
  return at(addDays(d, days), `${String(Math.floor(rem / 60)).padStart(2, '0')}:${String(rem % 60).padStart(2, '0')}`);
}

export function customOccurrences(r: CustomReminder, from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  if (r.repeat === 'none') return r.date >= from && r.date <= to ? [r.date] : [];
  const [y0, m0, d0] = parts(r.date);
  for (let i = 0; i < 5000; i++) {
    let d: ISODate;
    if (r.repeat === 'daily') d = addDays(r.date, i);
    else if (r.repeat === 'weekly') d = addDays(r.date, i * 7);
    else if (r.repeat === 'monthly') {
      const total = y0 * 12 + (m0 - 1) + i;
      const y = Math.floor(total / 12), m = (total % 12) + 1;
      d = fmtISO(y, m, Math.min(d0, daysInMonth(y, m)));
    } else {
      const y = y0 + i;
      d = fmtISO(y, m0, Math.min(d0, daysInMonth(y, m0)));
    }
    if (d > to) break;
    if (d >= from) out.push(d);
  }
  return out;
}

/** All occurrences in [now - catchUpDays, now + horizonDays], before dedupe. */
export function planOccurrences(input: PlannerInput, horizonDays: number): PlannedReminder[] {
  const s = input.settings;
  const today = input.now.slice(0, 10);
  const from = addDays(today, -Math.max(0, s.catchUpDays));
  const to = addDays(today, horizonDays);
  const out: PlannedReminder[] = [];
  if (!s.enabled) return out;
  const push = (category: ReminderCategory, key: string, date: ISODate, title: string, body: string, loanId: string | null, time = s.time) => {
    if (category !== 'test' && !s.categories[category as keyof ReminderSettings['categories']]) return;
    if (date < from || date > to) return;
    out.push({ key, category, title, body, loanId, at: adjustTime(at(date, time), s), late: false });
  };
  const fm = input.formatMoney;
  const fd = input.formatDate;

  for (const loan of input.loans) {
    if (loan.status !== 'active' || !loan.reminderEnabled) continue;
    const c = input.comps.get(loan.id);
    if (!c) continue;
    const offsets = loan.reminderOffsets ?? s.offsets;
    for (const r of c.rows) {
      if (!OPEN_STATUSES.includes(r.status) || r.status === 'unrecorded') continue;
      const amount = +r.shortfall > 0 ? r.shortfall : r.scheduledAmount;
      if (+amount <= 0) continue;
      const label = r.emiNo ? `EMI #${r.emiNo}` : `Installment ${r.no}`;
      for (const off of offsets) {
        if (off <= 0) continue;
        push('emi_upcoming', `emi_upcoming:${loan.id}:${r.no}:${r.dueDate}:${off}`, addDays(r.dueDate, -off),
          `${loan.name}: EMI due in ${off} day${off === 1 ? '' : 's'}`, `${label} of ${fm(amount)} is due on ${fd(r.dueDate)}.`, loan.id);
      }
      push('emi_due', `emi_due:${loan.id}:${r.no}:${r.dueDate}`, r.dueDate, `${loan.name}: EMI due today`,
        `${label} of ${fm(amount)} is due today.`, loan.id);
      if (r.dueDate < today && r.status !== 'due') {
        for (let k = 0; k < Math.max(1, s.maxRepeats); k++) {
          const d = addDays(r.dueDate, 1 + loan.gracePeriodDays + k * Math.max(1, s.overdueRepeatDays));
          if (d > today) break;
          push('emi_overdue', `emi_overdue:${loan.id}:${r.no}:${r.dueDate}:${k}`, d, `${loan.name}: EMI overdue`,
            `${label} of ${fm(amount)} was due on ${fd(r.dueDate)} (${diffDays(r.dueDate, d)} days ago). Record the payment once made.`, loan.id);
        }
      }
      if (r.status === 'missed') {
        push('emi_missed', `emi_missed:${loan.id}:${r.no}:${r.dueDate}`, today, `${loan.name}: missed EMI`,
          `${label} due ${fd(r.dueDate)} is marked missed. Outstanding ${fm(amount)}.`, loan.id);
      }
    }
    const close = c.summary.closureDate;
    if (close && close > today) {
      push('loan_closure', `loan_closure:${loan.id}:${close}`, addDays(close, -s.closureLeadDays), `${loan.name} closes soon`,
        `Projected last payment on ${fd(close)}. Remaining ${fm(c.summary.remainingCashOutflow)}.`, loan.id);
    }
  }

  for (const a of input.adjustments) {
    const loan = input.loans.find((l) => l.id === a.loanId);
    if (!loan || loan.status !== 'active' || a.effectiveDate <= today) continue;
    push('rate_change', `rate_change:${a.id}:${a.effectiveDate}`, addDays(a.effectiveDate, -1), `${loan.name}: ${a.kind === 'rate' ? 'rate change' : 'loan change'} tomorrow`,
      a.kind === 'rate' ? `Interest rate changes to ${a.annualRate}% from ${fd(a.effectiveDate)}.` : `A ${a.kind} change takes effect on ${fd(a.effectiveDate)}.`, loan.id);
  }

  // summaries
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (d.endsWith('-01')) push('summary_monthly', `summary_monthly:${d.slice(0, 7)}`, d, 'Monthly repayment summary', 'Your monthly loan summary is ready in EMI Tracker.', null);
    if (weekday(d) === s.weeklySummaryDay) push('summary_weekly', `summary_weekly:${isoWeekKey(d)}`, d, 'Weekly financial summary', 'Review this week\'s EMIs and payments in EMI Tracker.', null);
  }

  // backup reminder: once per elapsed interval since the last successful backup
  const interval = Math.max(1, s.backupIntervalDays);
  if (!input.lastBackupDate) {
    push('backup', `backup:never:${today}`, today, 'No backup yet', 'Create a backup so your loan records are safe.', null);
  } else {
    const since = diffDays(input.lastBackupDate, today);
    if (since >= interval) {
      const n = Math.floor(since / interval);
      push('backup', `backup:${input.lastBackupDate}:${n}`, addDays(input.lastBackupDate, n * interval), 'Backup reminder',
        `Your last backup was ${since} days ago (${fd(input.lastBackupDate)}).`, null);
    }
  }

  // bills: before the due date, on it, and once the day after if still unpaid
  for (const o of billOccurrences(input.bills.filter((b) => b.active && b.reminderEnabled), input.billPayments, from, addDays(to, 61), today)) {
    if (o.payment) continue;
    const b = o.bill;
    const amount = `${b.variable ? 'about ' : ''}${fm(b.amount)}`;
    for (const off of b.reminderOffsets ?? s.offsets) {
      if (off <= 0) continue;
      push('bill', `bill:${b.id}:${o.dueDate}:${off}`, addDays(o.dueDate, -off), `${b.name}: due in ${off} day${off === 1 ? '' : 's'}`, `${amount} is due on ${fd(o.dueDate)}.`, null);
    }
    push('bill', `bill_due:${b.id}:${o.dueDate}`, o.dueDate, `${b.name}: due today`, `${amount} is due today.`, null);
    push('bill', `bill_overdue:${b.id}:${o.dueDate}`, addDays(o.dueDate, 1), `${b.name}: unpaid`, `${amount} was due on ${fd(o.dueDate)}. Mark it paid once done.`, null);
  }

  // lending & borrowing: the day before, on and the day after the return date while money is pending
  for (const d of (input.debts ?? []).filter((x) => x.reminderEnabled && x.dueDate)) {
    const due = d.dueDate!;
    if (due < addDays(from, -1) || due > addDays(to, 1)) continue;
    const s = debtSummary(d, input.debtRepayments ?? [], today);
    if (s.status === 'settled') continue;
    const amount = fm(s.pending);
    const [soon, now, late] = d.direction === 'lent'
      ? [`Collect ${amount} from ${d.person} tomorrow`, `Collect ${amount} from ${d.person} today`, `${d.person} has not returned ${amount} yet`]
      : [`Return ${amount} to ${d.person} tomorrow`, `Return ${amount} to ${d.person} today`, `${amount} to ${d.person} was due on ${fd(due)}`];
    const body = d.direction === 'lent' ? `Lent on ${fd(d.date)}. Record it once you get it back.` : `Borrowed on ${fd(d.date)}. Record it once you repay.`;
    push('debt', `debt:${d.id}:${due}:1`, addDays(due, -1), soon, body, null);
    push('debt', `debt_due:${d.id}:${due}`, due, now, body, null);
    push('debt', `debt_overdue:${d.id}:${due}`, addDays(due, 1), late, body, null);
  }

  for (const r of input.custom) {
    if (!r.enabled) continue;
    for (const d of customOccurrences(r, from, to)) push('custom', `custom:${r.id}:${d}`, d, r.title, r.description || 'Reminder', r.loanId, r.time || s.time);
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * Reminders that should be delivered now: their time has passed, they are within the
 * catch-up window, they were never delivered (dedupe key) and are not snoozed.
 */
export function dueReminders(input: PlannerInput): PlannedReminder[] {
  const hist = new Map(input.history.map((h) => [h.key, h]));
  const catchUpFrom = at(addDays(input.now.slice(0, 10), -Math.max(0, input.settings.catchUpDays)), '00:00');
  const out: PlannedReminder[] = [];
  for (const r of planOccurrences(input, 0)) {
    if (r.at > input.now || r.at < catchUpFrom) continue;
    const h = hist.get(r.key);
    if (h && !(h.state === 'snoozed' && h.snoozedUntil && h.snoozedUntil <= input.now)) continue;
    // late when more than 30 minutes past its time (app closed / device asleep at the time)
    out.push({ ...r, late: addMinutes(r.at, 30) < input.now });
  }
  return out;
}

export function upcomingReminders(input: PlannerInput, days = 30): PlannedReminder[] {
  const delivered = new Set(input.history.map((h) => h.key));
  return planOccurrences(input, days).filter((r) => r.at > input.now && !delivered.has(r.key));
}

export function snoozeUntil(now: string, minutes: number): string {
  return addMinutes(now, minutes);
}

/** Local wall time "YYYY-MM-DDTHH:MM" of an instant in a time zone ('' = host zone). */
export function wallTime(d: Date, timeZone?: string): string {
  if (timeZone) {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
