import { useEffect, useMemo, useState } from 'react';
import { BellRing, Check as CheckIcon, Clock, Plus, Trash2, X } from 'lucide-react';
import { blankReminder } from '../../shared/defaults';
import { upcomingReminders, wallTime } from '../../shared/reminders';
import { fieldErrors, customReminderSchema } from '../../shared/validation';
import type { CustomReminder, NotificationRecord, ReminderSettings } from '../../shared/types';
import { call } from '../lib/api';
import { useRouter } from '../lib/router';
import { useAction, useStore } from '../lib/store';
import { Callout, Card, Check, Empty, Kv, Modal, Select, Switch, Tabs, TextInput } from '../components/ui';

type Tab = 'inbox' | 'upcoming' | 'history' | 'custom' | 'settings' | 'diagnostics';
const CATEGORY_LABEL: Record<keyof ReminderSettings['categories'], string> = {
  emi_upcoming: 'Upcoming EMI', emi_due: 'EMI due today', emi_overdue: 'EMI overdue (repeats)', emi_missed: 'Missed EMI', loan_closure: 'Upcoming loan closure',
  summary_monthly: 'Monthly repayment summary', summary_weekly: 'Weekly financial summary', backup: 'Backup reminder', custom: 'Custom reminders', rate_change: 'Interest rate / loan changes', bill: 'Bills', debt: 'Lending & borrowing',
};
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function Reminders() {
  const { data, comps, prefs, fmt, inbox } = useStore();
  const { asOf } = useStore();
  const [tab, setTab] = useState<Tab>(inbox.length ? 'inbox' : 'custom');
  const [adding, setAdding] = useState<CustomReminder | null>(null);
  const upcoming = useMemo(() => upcomingReminders({
    now: wallTime(new Date(), prefs.timeZone || undefined), settings: prefs.reminders, loans: data.loans, comps, adjustments: data.adjustments, custom: data.customReminders,
    bills: data.bills, billPayments: data.billPayments, debts: data.debts, debtRepayments: data.debtRepayments,
    history: data.notifications, lastBackupDate: data.local.lastBackupAt?.slice(0, 10) ?? null, formatMoney: fmt.money, formatDate: fmt.date,
  }, 45), [data, comps, prefs, fmt]);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1 className="page-title">Reminders & notifications</h1><p className="page-sub">Delivered as Windows notifications and here in the app while EMI Tracker is running (window or tray).</p></div>
        <div className="row wrap">
          <button className="btn" onClick={() => setTab('diagnostics')}><BellRing />Test & diagnostics</button>
          <button className="btn primary" onClick={() => setAdding(blankReminder(asOf))}><Plus />Add reminder</button>
        </div>
      </div>
      {!prefs.reminders.enabled && <div style={{ marginBottom: 12 }}><Callout kind="warn">All reminders are switched off. Turn them on under Settings below.</Callout></div>}
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'custom', label: `My reminders (${data.customReminders.length})` }, { value: 'inbox', label: `Inbox (${inbox.length})` }, { value: 'upcoming', label: `Upcoming (${upcoming.length})` },
        { value: 'history', label: 'History' }, { value: 'settings', label: 'Settings' }, { value: 'diagnostics', label: 'Diagnostics' },
      ]} />
      {tab === 'inbox' && <NotificationList items={inbox} empty="You're all caught up." actions />}
      {tab === 'upcoming' && (
        <Card flush>
          {!upcoming.length ? <Empty icon={<Clock />} title="Nothing scheduled">No reminders in the next 45 days with the current settings.</Empty> : (
            <table className="data"><thead><tr><th>When</th><th>Reminder</th><th>Details</th></tr></thead>
              <tbody>{upcoming.map((r) => <tr key={r.key}><td className="nowrap">{fmt.date(r.at.slice(0, 10))} {r.at.slice(11)}</td><td>{r.title}</td><td className="muted">{r.body}</td></tr>)}</tbody></table>
          )}
        </Card>
      )}
      {tab === 'history' && <NotificationList items={data.notifications} empty="No notifications delivered yet." />}
      {tab === 'custom' && <CustomReminders />}
      {tab === 'settings' && <ReminderSettingsForm />}
      {tab === 'diagnostics' && <Diagnostics />}
      {adding && <CustomReminderForm initial={adding} onClose={() => setAdding(null)} />}
    </div>
  );
}

function NotificationList({ items, empty, actions }: { items: NotificationRecord[]; empty: string; actions?: boolean }) {
  const { prefs } = useStore();
  const { go } = useRouter();
  const act = useAction();
  if (!items.length) return <Card><Empty icon={<BellRing />} title={empty} /></Card>;
  return (
    <Card flush>
      <div className="table-wrap" style={{ maxHeight: 640 }}>
        <table className="data">
          <thead><tr><th>Delivered</th><th>Notification</th><th>Channel</th><th>State</th><th /></tr></thead>
          <tbody>
            {items.map((n) => (
              <tr key={n.id}>
                <td className="nowrap muted">{n.deliveredAt.replace('T', ' ')}{n.late && <div className="tiny warn" title="The app was closed or the PC was asleep at the scheduled time">delivered late</div>}</td>
                <td><div>{n.title}</div><div className="small muted">{n.body}</div></td>
                <td className="muted">{n.channel === 'native' ? 'Windows + in-app' : 'In-app'}</td>
                <td className="muted">{n.state}{n.snoozedUntil ? ` until ${n.snoozedUntil.replace('T', ' ')}` : ''}</td>
                <td className="right nowrap">
                  {n.loanId && <button className="btn sm ghost" onClick={() => go(`/loans/${n.loanId}`)}>Open loan</button>}
                  {actions && n.state === 'sent' && (
                    <>
                      <button className="btn sm ghost" title={`Snooze ${prefs.reminders.snoozeMinutes} min`} onClick={() => act(() => call('notification:update', { id: n.id, state: 'snoozed' }), 'Snoozed')}><Clock size={14} />Snooze</button>
                      <button className="btn sm ghost" onClick={() => act(() => call('notification:update', { id: n.id, state: 'dismissed' }))}><X size={14} />Dismiss</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {actions && <div className="small faint" style={{ padding: 12 }}>Dismissing a reminder never marks an EMI as paid — record the payment to update your loan.</div>}
    </Card>
  );
}

function CustomReminders() {
  const { data, fmt } = useStore();
  const act = useAction();
  const [edit, setEdit] = useState<CustomReminder | null>(null);
  const { asOf } = useStore();
  return (
    <Card title="My reminders" sub="Your own reminders and notifications — a loan is optional" actions={<button className="btn sm primary" onClick={() => setEdit(blankReminder(asOf))}><Plus />New reminder</button>}>
      {!data.customReminders.length ? <Empty icon={<BellRing />} title="No reminders yet">Add a reminder for anything — rent, insurance renewal, a chit auction day, a bill. It doesn't need a loan.</Empty> : (
        <table className="data">
          <thead><tr><th>Title</th><th>When</th><th>Repeats</th><th>Loan</th><th>On</th><th /></tr></thead>
          <tbody>
            {data.customReminders.map((r) => (
              <tr key={r.id}>
                <td>{r.title}<div className="tiny faint">{r.description}</div></td><td>{fmt.date(r.date)} {r.time}</td><td>{r.repeat}</td>
                <td>{data.loans.find((l) => l.id === r.loanId)?.name ?? '—'}</td>
                <td><Check checked={r.enabled} onChange={(v) => act(() => call('reminder:save', { ...r, enabled: v }))} label={<span className="sr-only">Enabled</span>} /></td>
                <td className="right"><button className="btn sm ghost" onClick={() => setEdit(r)}>Edit</button><button className="btn ghost icon sm" aria-label="Delete reminder" onClick={() => act(() => call('reminder:delete', { id: r.id }), 'Reminder deleted')}><Trash2 size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {edit && <CustomReminderForm initial={edit} onClose={() => setEdit(null)} />}
    </Card>
  );
}

export function CustomReminderForm({ initial, onClose }: { initial: CustomReminder; onClose: () => void }) {
  const { data } = useStore();
  const act = useAction();
  const [r, setR] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof CustomReminder>(k: K, v: CustomReminder[K]) => setR((x) => ({ ...x, [k]: v }));
  const save = async () => {
    const v = customReminderSchema.safeParse(r);
    if (!v.success) { setErrors(fieldErrors(v.error)); return; }
    if (await act(() => call('reminder:save', r), 'Reminder saved') !== undefined) onClose();
  };
  return (
    <Modal title={initial.title ? 'Edit reminder' : 'New reminder'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="form-grid">
        <TextInput label="Title" value={r.title} onChange={(v) => set('title', v)} error={errors.title} className="full" autoFocus />
        <TextInput label="Note (shown in the notification)" value={r.description} onChange={(v) => set('description', v)} className="full" />
        <TextInput label="Date" type="date" value={r.date} onChange={(v) => set('date', v)} error={errors.date} />
        <TextInput label="Time" type="time" value={r.time} onChange={(v) => set('time', v)} error={errors.time} />
        <Select label="Repeat" value={r.repeat} onChange={(v) => set('repeat', v)} options={[{ value: 'none', label: 'Does not repeat' }, { value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly' }]} />
        <Select label="Linked loan (optional)" value={r.loanId ?? ''} onChange={(v) => set('loanId', v || null)} options={[{ value: '', label: 'None — standalone reminder' }, ...data.loans.map((l) => ({ value: l.id, label: l.name }))]} />
      </div>
    </Modal>
  );
}

function ReminderSettingsForm() {
  const { prefs, savePrefs, toast } = useStore();
  const [s, setS] = useState<ReminderSettings>(prefs.reminders);
  const [offsetsText, setOffsetsText] = useState(prefs.reminders.offsets.join(', '));
  const set = <K extends keyof ReminderSettings>(k: K, v: ReminderSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  const save = async () => {
    const offsets = [...new Set(offsetsText.split(',').map((x) => parseInt(x.trim(), 10)).filter((x) => Number.isFinite(x) && x >= 0 && x <= 60))].sort((a, b) => b - a).slice(0, 10);
    try { await savePrefs({ ...prefs, reminders: { ...s, offsets } }); toast({ kind: 'success', title: 'Reminder settings saved' }); }
    catch (e) { toast({ kind: 'error', title: 'Could not save', body: (e as Error).message }); }
  };
  return (
    <div className="grid g2">
      <Card title="Categories">
        <Switch checked={s.enabled} onChange={(v) => set('enabled', v)} label={<b>Reminders enabled</b>} />
        <div className="divider" />
        {(Object.keys(CATEGORY_LABEL) as (keyof ReminderSettings['categories'])[]).map((k) => (
          <Switch key={k} checked={s.categories[k]} onChange={(v) => set('categories', { ...s.categories, [k]: v })} label={CATEGORY_LABEL[k]} />
        ))}
      </Card>
      <Card title="Timing">
        <div className="form-grid">
          <TextInput label="Days before EMI" value={offsetsText} onChange={setOffsetsText} hint="Comma-separated, e.g. 7, 3, 1 (0 = due-day reminder is separate)" />
          <TextInput label="Notification time" type="time" value={s.time} onChange={(v) => set('time', v)} />
          <TextInput label="Repeat overdue every" type="number" value={s.overdueRepeatDays} onChange={(v) => set('overdueRepeatDays', Math.max(1, +v || 1))} suffix="days" />
          <TextInput label="Maximum overdue repeats" type="number" value={s.maxRepeats} onChange={(v) => set('maxRepeats', Math.max(1, +v || 1))} />
          <TextInput label="Snooze duration" type="number" value={s.snoozeMinutes} onChange={(v) => set('snoozeMinutes', Math.max(5, +v || 5))} suffix="min" />
          <TextInput label="Closure reminder lead" type="number" value={s.closureLeadDays} onChange={(v) => set('closureLeadDays', Math.max(1, +v || 1))} suffix="days" />
          <TextInput label="Backup reminder after" type="number" value={s.backupIntervalDays} onChange={(v) => set('backupIntervalDays', Math.max(1, +v || 1))} suffix="days" />
          <Select label="Weekly summary on" value={s.weeklySummaryDay} onChange={(v) => set('weeklySummaryDay', v)} options={DAYS.map((d, i) => ({ value: i, label: d }))} />
          <TextInput label="Deliver missed reminders up to" type="number" value={s.catchUpDays} onChange={(v) => set('catchUpDays', Math.max(0, Math.min(30, +v || 0)))} suffix="days late" />
        </div>
      </Card>
      <Card title="Quiet hours & days">
        <Switch checked={s.quietEnabled} onChange={(v) => set('quietEnabled', v)} label="Quiet hours" hint="Reminders falling inside are delivered when quiet hours end" />
        <div className="form-grid">
          <TextInput label="From" type="time" value={s.quietStart} onChange={(v) => set('quietStart', v)} />
          <TextInput label="To" type="time" value={s.quietEnd} onChange={(v) => set('quietEnd', v)} />
        </div>
        <div className="divider" />
        <div className="field-label">Deliver on</div>
        <div className="row wrap" style={{ marginTop: 6 }}>{DAYS.map((d, i) => <Check key={d} checked={s.weekdays[i]} onChange={(v) => set('weekdays', s.weekdays.map((x, j) => (j === i ? v : x)))} label={d} />)}</div>
        <div className="tiny faint" style={{ marginTop: 6 }}>Reminders on a disallowed day move to the next allowed day.</div>
      </Card>
      <Card title="Delivery">
        <Switch checked={s.channels.native} onChange={(v) => set('channels', { ...s.channels, native: v })} label="Windows desktop notifications" />
        <Switch checked={s.channels.inApp} onChange={(v) => set('channels', { ...s.channels, inApp: v })} label="In-app notifications" hint="Always on when Windows notifications are unavailable" />
        <Switch checked={s.sound} onChange={(v) => set('sound', v)} label="Notification sound" hint="Uses the Windows notification sound" />
        <Select label="Priority" value={s.priority} onChange={(v) => set('priority', v)} options={[{ value: 'high', label: 'High — stays on screen until dismissed' }, { value: 'normal', label: 'Normal' }, { value: 'low', label: 'Low' }]} />
        <div style={{ marginTop: 14 }}><button className="btn primary" onClick={save}>Save reminder settings</button></div>
      </Card>
    </div>
  );
}

interface Diag { nativeSupported: boolean; schedulerRunning: boolean; lastTick: string | null; deliveredThisSession: number; platform: string; launchAtLogin: boolean; packaged: boolean; minimizeToTray: boolean; timeZone: string }

function Diagnostics() {
  const { data, toast } = useStore();
  const act = useAction();
  const [d, setD] = useState<Diag | null>(null);
  const load = () => void call<Diag>('reminders:diagnostics').then(setD);
  useEffect(load, []);
  return (
    <div className="grid g2">
      <Card title="Test" sub="Sends a notification right now">
        <div className="row wrap">
          <button className="btn primary" onClick={async () => { const r = await act(() => call<{ nativeSupported: boolean }>('notification:test'), 'Test notification sent'); if (r && !r.nativeSupported) toast({ kind: 'error', title: 'Windows notifications are unavailable', body: 'The test was shown in the app only. Check Windows Settings → Notifications.' }); }}><BellRing />Send test notification</button>
          <button className="btn" onClick={async () => { await act(() => call('reminders:runNow'), 'Reminder check complete'); load(); }}>Check reminders now</button>
        </div>
        <div className="divider" />
        {d ? (
          <Kv items={[
            ['Windows notifications', d.nativeSupported ? <span className="pos"><CheckIcon size={13} /> Available</span> : <span className="neg">Unavailable</span>],
            ['Scheduler', d.schedulerRunning ? 'Running (checks every minute)' : 'Stopped'], ['Last check', d.lastTick?.replace('T', ' ') ?? 'Not yet'],
            ['Delivered this session', d.deliveredThisSession], ['Keeps running in tray when closed', d.minimizeToTray ? 'Yes' : 'No — reminders stop when the window closes'],
            ['Starts with Windows', d.packaged ? (d.launchAtLogin ? 'Yes' : 'No') : 'Only in the installed app'], ['Time zone', d.timeZone], ['System', d.platform],
            ['Notification history', `${data.notifications.length} record(s)`],
          ]} />
        ) : <p className="muted">Loading…</p>}
      </Card>
      <Card title="When reminders work">
        <div className="col small">
          <Callout kind="ok">Delivered while EMI Tracker is running — with its window open or minimized to the system tray.</Callout>
          <Callout kind="warn">Not delivered while the app is quit, Windows is shut down, or the PC is asleep. On the next start or wake, reminders missed within the last {data.preferences.reminders.catchUpDays} day(s) are delivered once and marked “delivered late”.</Callout>
          <Callout>Turn on <b>Settings → Start with Windows</b> and <b>Keep running in the tray</b> for the best reliability. Windows Focus Assist / Do Not Disturb can hide notification banners; they still appear in the app inbox.</Callout>
          <Callout>Each reminder has a unique key, so it is never delivered twice — even across restarts or after syncing with your phone.</Callout>
        </div>
      </Card>
    </div>
  );
}
