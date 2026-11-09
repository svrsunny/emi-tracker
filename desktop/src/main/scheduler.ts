/**
 * Background work while the app is running (window open or minimized to the tray):
 * reminder delivery, automatic backups and automatic sync. Runs every minute and on
 * resume from sleep. Nothing here can run while the app is closed or Windows is off —
 * see docs/NOTIFICATIONS.md.
 */
import { computeLoan, type LoanComputation } from '../shared/engine';
import { makeFormatters } from '../shared/format';
import { dueReminders, wallTime, type PlannedReminder } from '../shared/reminders';
import { newId } from '../shared/defaults';
import type { NotificationRecord } from '../shared/types';
import type { Repo } from './repo';

export interface Notifier {
  /** Show a native notification; returns false when unsupported or disabled by the OS. */
  native(r: PlannedReminder, opts: { silent: boolean; urgency: 'low' | 'normal' | 'critical' }): boolean;
  inApp(n: NotificationRecord): void;
}

export interface TickResult { delivered: number; at: string }

export function computeAll(repo: Repo, asOf: string): Map<string, LoanComputation> {
  const adjustments = repo.adjustments();
  const payments = repo.payments();
  return new Map(repo.loans().map((l) => [l.id, computeLoan(l, adjustments, payments, asOf, { skipBaseline: true })]));
}

export function reminderTick(repo: Repo, notifier: Notifier, now = new Date()): TickResult {
  const prefs = repo.preferences().value;
  const local = repo.local();
  const wall = wallTime(now, prefs.timeZone || undefined);
  const asOf = wall.slice(0, 10);
  const fmt = makeFormatters(prefs);
  const due = dueReminders({
    now: wall, settings: prefs.reminders, loans: repo.loans(), comps: computeAll(repo, asOf), adjustments: repo.adjustments(),
    custom: repo.customReminders(), bills: repo.bills(), billPayments: repo.billPayments(), debts: repo.debts(), debtRepayments: repo.debtRepayments(), history: repo.notifications(20000), lastBackupDate: local.lastBackupAt ? local.lastBackupAt.slice(0, 10) : null,
    formatMoney: fmt.money, formatDate: fmt.date,
  });
  const s = prefs.reminders;
  let delivered = 0;
  for (const r of due) {
    const existing = repo.notificationByKey(r.key);
    let channel: NotificationRecord['channel'] = 'in_app';
    if (s.channels.native) {
      const ok = notifier.native(r, { silent: !s.sound, urgency: s.priority === 'high' ? 'critical' : s.priority === 'low' ? 'low' : 'normal' });
      if (ok) channel = 'native';
    }
    const ts = new Date().toISOString();
    const rec: NotificationRecord = {
      id: existing?.id ?? newId(), createdAt: existing?.createdAt ?? ts, updatedAt: ts, key: r.key, category: r.category, title: r.title,
      body: r.body, loanId: r.loanId, scheduledFor: r.at, deliveredAt: wall, state: 'sent', snoozedUntil: null, channel, late: r.late,
      deviceId: local.deviceId,
    };
    repo.saveNotification(rec);
    if (s.channels.inApp || channel === 'in_app') notifier.inApp(rec);
    delivered++;
  }
  return { delivered, at: wall };
}
