import { describe, expect, it } from 'vitest';
import { computeLoan } from '../../src/shared/engine';
import { adjustTime, customOccurrences, dueReminders, DEFAULT_REMINDER_SETTINGS, upcomingReminders, type PlannerInput } from '../../src/shared/reminders';
import type { NotificationRecord } from '../../src/shared/types';
import { makeLoan, pay } from './fixtures';

const loan = makeLoan();
function input(now: string, extra: Partial<PlannerInput> = {}): PlannerInput {
  const asOf = now.slice(0, 10);
  const payments = extra.history ? [] : [];
  return {
    now, settings: { ...DEFAULT_REMINDER_SETTINGS, quietEnabled: false }, loans: [loan],
    comps: new Map([[loan.id, computeLoan(loan, [], payments, asOf)]]), adjustments: [], custom: [], bills: [], billPayments: [], history: [],
    lastBackupDate: asOf, formatMoney: (a) => `₹${a}`, formatDate: (d) => d, ...extra,
  };
}

describe('reminder planning', () => {
  it('fires upcoming reminders at the offsets at the configured time', () => {
    const before = dueReminders(input('2024-01-25T08:59'));
    expect(before.filter((r) => r.category === 'emi_upcoming')).toHaveLength(0);
    const at9 = dueReminders(input('2024-01-25T09:00'));
    expect(at9.map((r) => r.key)).toContain('emi_upcoming:L1:1:2024-02-01:7');
  });

  it('due-today and overdue with repeat interval and max count', () => {
    expect(dueReminders(input('2024-02-01T09:05')).some((r) => r.category === 'emi_due')).toBe(true);
    const s = { ...DEFAULT_REMINDER_SETTINGS, quietEnabled: false, overdueRepeatDays: 2, maxRepeats: 2, catchUpDays: 30 };
    const keys = dueReminders(input('2024-02-20T10:00', { settings: s })).filter((r) => r.category === 'emi_overdue' && r.key.includes(':1:')).map((r) => r.key);
    expect(keys).toEqual(['emi_overdue:L1:1:2024-02-01:0', 'emi_overdue:L1:1:2024-02-01:1']);
  });

  it('never duplicates a delivered reminder', () => {
    const first = dueReminders(input('2024-01-25T09:00'));
    const history = first.map((r) => ({ key: r.key, state: 'sent' as const, snoozedUntil: null }));
    expect(dueReminders(input('2024-01-25T09:30', { history }))).toHaveLength(0);
  });

  it('redelivers a snoozed reminder only after the snooze ends', () => {
    const key = 'emi_upcoming:L1:1:2024-02-01:7';
    const history: Pick<NotificationRecord, 'key' | 'state' | 'snoozedUntil'>[] = [{ key, state: 'snoozed', snoozedUntil: '2024-01-25T10:00' }];
    expect(dueReminders(input('2024-01-25T09:30', { history })).some((r) => r.key === key)).toBe(false);
    expect(dueReminders(input('2024-01-25T10:01', { history })).some((r) => r.key === key)).toBe(true);
  });

  it('recalculates when the EMI is paid (no reminder for a paid installment)', () => {
    const paid = computeLoan(loan, [], [pay({ installmentNo: 1, txnDate: '2024-01-20', amount: '8884.88', type: 'advance' })], '2024-01-25');
    const r = dueReminders(input('2024-01-25T09:00', { comps: new Map([[loan.id, paid]]) }));
    expect(r.some((x) => x.key.startsWith('emi_upcoming:L1:1:'))).toBe(false);
  });

  it('catches up missed reminders within the window and marks them late', () => {
    const r = dueReminders(input('2024-01-27T12:00'));
    const k = r.find((x) => x.key === 'emi_upcoming:L1:1:2024-02-01:7');
    expect(k?.late).toBe(true);
    const tooOld = dueReminders(input('2024-01-31T12:00', { settings: { ...DEFAULT_REMINDER_SETTINGS, quietEnabled: false, catchUpDays: 2 } }));
    expect(tooOld.some((x) => x.key === 'emi_upcoming:L1:1:2024-02-01:7')).toBe(false);
  });

  it('quiet hours and weekday restrictions shift delivery', () => {
    const s = { ...DEFAULT_REMINDER_SETTINGS, quietEnabled: true, quietStart: '22:00', quietEnd: '08:00' };
    expect(adjustTime('2024-01-25T23:00', s)).toBe('2024-01-26T08:00');
    expect(adjustTime('2024-01-25T06:00', s)).toBe('2024-01-25T08:00');
    const weekdaysOnly = { ...s, quietEnabled: false, weekdays: [false, true, true, true, true, true, false] };
    expect(adjustTime('2024-01-27T09:00', weekdaysOnly)).toBe('2024-01-29T09:00'); // Saturday -> Monday
  });

  it('disabled categories and per-loan opt-out', () => {
    const s = { ...DEFAULT_REMINDER_SETTINGS, quietEnabled: false, categories: { ...DEFAULT_REMINDER_SETTINGS.categories, emi_upcoming: false } };
    expect(dueReminders(input('2024-01-25T09:00', { settings: s })).some((r) => r.category === 'emi_upcoming')).toBe(false);
    const off = { ...loan, reminderEnabled: false };
    expect(dueReminders(input('2024-01-25T09:00', { loans: [off] })).some((r) => r.loanId === 'L1')).toBe(false);
  });

  it('backup reminder after the interval; custom reminders repeat', () => {
    expect(dueReminders(input('2024-01-25T09:00', { lastBackupDate: '2024-01-10' })).some((r) => r.category === 'backup')).toBe(true);
    const custom = { id: 'c1', createdAt: '', updatedAt: '', title: 'Insurance', description: '', date: '2024-01-31', time: '10:00', repeat: 'monthly' as const, loanId: null, enabled: true };
    expect(customOccurrences(custom, '2024-01-01', '2024-04-30')).toEqual(['2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30']);
    const up = upcomingReminders(input('2024-01-25T09:00', { custom: [custom] }), 40);
    expect(up.some((r) => r.key === 'custom:c1:2024-02-29')).toBe(true);
  });
});
