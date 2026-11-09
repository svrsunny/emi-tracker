import { useState } from 'react';
import { FolderOpen, Moon, Monitor, Plus, Sparkles, Sun, Trash2 } from 'lucide-react';
import { newId, nowTs } from '../../shared/defaults';
import { makeFormatters } from '../../shared/format';
import type { Preferences } from '../../shared/types';
import { call, type LocalSettings } from '../lib/api';
import { useRouter } from '../lib/router';
import { AppLockSettings } from '../components/AppLockSettings';
import { useAction, useStore } from '../lib/store';
import { PALETTES } from '../components/heatmap';
import { Callout, Card, Confirm, Select, Switch, TextInput } from '../components/ui';

const ACCENTS = ['#4f8cff', '#34c38f', '#a78bfa', '#f1b44c', '#f46a6a', '#22b8cf', '#e879f9', '#94a3b8'];
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY'];
const ZONES = ['', 'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney', 'UTC'];

export function Settings() {
  const { data, prefs, savePrefs, toast } = useStore();
  const { go } = useRouter();
  const act = useAction();
  const [p, setP] = useState<Preferences>(prefs);
  const [thr, setThr] = useState(prefs.heatmapThresholds.join(', '));
  const [reset, setReset] = useState(false);
  const [catName, setCatName] = useState('');
  const set = <K extends keyof Preferences>(k: K, v: Preferences[K]) => setP((x) => ({ ...x, [k]: v }));
  const local = data.local;
  const setLocal = (patch: Partial<LocalSettings>) => act(() => call('local:set', patch), 'Saved');
  const preview = makeFormatters(p);
  const dirty = JSON.stringify(p) !== JSON.stringify(prefs) || thr !== prefs.heatmapThresholds.join(', ');

  const save = async () => {
    const t = thr.split(',').map((x) => Math.round(+x.trim())).filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
    if (t.length !== 4) { toast({ kind: 'error', title: 'Enter exactly four ascending heatmap thresholds' }); return; }
    try { await savePrefs({ ...p, heatmapThresholds: t }); toast({ kind: 'success', title: 'Settings saved' }); }
    catch (e) { toast({ kind: 'error', title: 'Could not save settings', body: (e as Error).message }); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><h1 className="page-title">Settings</h1><p className="page-sub">Preferences sync to your other devices; startup and folder settings stay on this PC.</p></div>
        <div className="row"><button className="btn" disabled={!dirty} onClick={() => { setP(prefs); setThr(prefs.heatmapThresholds.join(', ')); }}>Discard</button><button className="btn primary" disabled={!dirty} onClick={save}>Save settings</button></div>
      </div>
      <div className="grid g2">
        <Card title="Appearance">
          <div className="col">
            <div className="field"><span className="field-label">Theme</span>
              <div className="btn-group" role="radiogroup" aria-label="Theme">
                {([['dark', 'Dark', Moon], ['light', 'Light', Sun], ['system', 'System', Monitor]] as const).map(([v, label, Icon]) => (
                  <button key={v} role="radio" aria-checked={p.theme === v} className={p.theme === v ? 'on' : ''} onClick={() => set('theme', v)}><Icon size={13} style={{ verticalAlign: -2 }} /> {label}</button>
                ))}
              </div>
            </div>
            <div className="field"><span className="field-label">Accent colour</span>
              <div className="row wrap">{ACCENTS.map((a) => <button key={a} aria-label={`Accent ${a}`} aria-pressed={p.accent === a} onClick={() => set('accent', a)} style={{ width: 26, height: 26, borderRadius: 8, background: a, border: p.accent === a ? '2px solid var(--text)' : '2px solid transparent', cursor: 'pointer' }} />)}
                <input type="color" value={p.accent} onChange={(e) => set('accent', e.target.value)} aria-label="Custom accent" style={{ width: 34, height: 28, border: 0, background: 'none' }} /></div>
            </div>
          </div>
        </Card>
        <Card title="Currency & formats" sub={`Preview: ${preview.money(1234567.891)} · ${preview.date('2025-03-09')}`}>
          <div className="form-grid">
            <Select label="Currency" value={p.currency} onChange={(v) => set('currency', v)} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
            <Select label="Number grouping" value={p.locale} onChange={(v) => set('locale', v)} options={[{ value: 'en-IN', label: 'Indian (12,34,567)' }, { value: 'en-US', label: 'International (1,234,567)' }, { value: 'de-DE', label: 'European (1.234.567)' }]} />
            <Select label="Decimal places" value={p.decimals} onChange={(v) => set('decimals', v)} options={[{ value: 2, label: '2 (₹1,234.50)' }, { value: 0, label: '0 (₹1,235)' }, { value: 1, label: '1' }]} hint="Display only — calculations always use paisa precision" />
            <Select label="Date format" value={p.dateFormat} onChange={(v) => set('dateFormat', v)} options={[{ value: 'DD MMM YYYY', label: '09 Mar 2025' }, { value: 'DD/MM/YYYY', label: '09/03/2025' }, { value: 'MM/DD/YYYY', label: '03/09/2025' }, { value: 'YYYY-MM-DD', label: '2025-03-09' }]} />
            <Select label="First day of week" value={p.weekStart} onChange={(v) => set('weekStart', v)} options={[{ value: 1, label: 'Monday' }, { value: 0, label: 'Sunday' }]} />
            <Select label="Time zone" value={p.timeZone} onChange={(v) => set('timeZone', v)} options={ZONES.map((z) => ({ value: z, label: z || `System (${Intl.DateTimeFormat().resolvedOptions().timeZone})` }))} hint="Decides what “today” is for due dates and reminders" />
          </div>
        </Card>
        <Card title="Heatmaps">
          <div className="form-grid">
            <Select label="Colour palette" value={p.heatmapPalette} onChange={(v) => set('heatmapPalette', v)} options={Object.keys(PALETTES).map((k) => ({ value: k as Preferences['heatmapPalette'], label: k[0].toUpperCase() + k.slice(1) }))} />
            <TextInput label="Intensity thresholds (daily amount)" value={thr} onChange={setThr} hint="Four ascending amounts, e.g. 0, 5000, 25000, 75000. Monthly views scale ×4." />
          </div>
          <div className="row" style={{ gap: 3, marginTop: 10 }}><i className="heat-cell" style={{ background: 'var(--heat-0)', display: 'inline-block' }} />{PALETTES[p.heatmapPalette].map((c) => <i key={c} className="heat-cell" style={{ background: c, display: 'inline-block' }} />)}</div>
        </Card>
        <Card title="Dashboard & lists">
          <div className="form-grid">
            <Select label="Default dashboard range" value={p.dashboardRange} onChange={(v) => set('dashboardRange', v)} options={[{ value: '3m', label: 'Last 3 months' }, { value: '6m', label: 'Last 6 months' }, { value: '12m', label: 'Last 12 months' }, { value: 'ytd', label: 'Year to date' }, { value: 'all', label: 'All time' }]} />
            <Select label="Default loan sorting" value={p.loanSort} onChange={(v) => set('loanSort', v)} options={[{ value: 'next_due', label: 'Next due date' }, { value: 'outstanding', label: 'Outstanding' }, { value: 'closure', label: 'Closure date' }, { value: 'rate', label: 'Interest rate' }, { value: 'name', label: 'Name' }]} />
            <Select label="Default loan filter" value={p.loanFilter} onChange={(v) => set('loanFilter', v)} options={[{ value: 'active', label: 'Active' }, { value: 'closed', label: 'Closed' }, { value: 'archived', label: 'Archived' }, { value: 'all', label: 'All' }]} />
          </div>
          <div className="row" style={{ marginTop: 10 }}><button className="btn sm" onClick={() => go('/')}>Arrange dashboard widgets…</button><button className="btn sm" onClick={() => go('/reminders')}>Reminder preferences…</button></div>
        </Card>
        <Card title="Categories" sub="Your custom loan categories">
          <div className="row wrap" style={{ marginBottom: 10 }}>
            {data.categories.map((c) => <span key={c.id} className="tag" style={{ borderColor: c.color }}>{c.name}<button className="btn ghost icon sm" style={{ width: 18, height: 18 }} aria-label={`Delete ${c.name}`} onClick={() => act(() => call('category:delete', { id: c.id }))}><Trash2 size={11} /></button></span>)}
            {!data.categories.length && <span className="small faint">No custom categories.</span>}
          </div>
          <div className="row">
            <input className="input" placeholder="New category" value={catName} onChange={(e) => setCatName(e.target.value)} aria-label="New category name" />
            <button className="btn" disabled={!catName.trim()} onClick={async () => { const ts = nowTs(); await act(() => call('category:save', { id: newId(), createdAt: ts, updatedAt: ts, name: catName.trim(), color: p.accent }), 'Category added'); setCatName(''); }}><Plus />Add</button>
          </div>
        </Card>
        <AppLockSettings />
        <Card title="Startup & background (this PC)">
          <Switch checked={local.minimizeToTray} onChange={(v) => setLocal({ minimizeToTray: v })} label="Keep running in the tray when the window is closed" hint="Needed for reminders, auto-backup and auto-sync while the window is closed" />
          <Switch checked={local.launchAtStartup} onChange={(v) => setLocal({ launchAtStartup: v })} label="Start with Windows" hint="Starts minimized to the tray (installed app only)" />
          <Switch checked={local.startHidden} onChange={(v) => setLocal({ startHidden: v })} label="Always start minimized to tray" />
        </Card>
        <Card title="Privacy & storage">
          <div className="col small">
            <Callout kind="ok">Offline mode is enforced: the app blocks every outbound network request. No accounts, telemetry, analytics or update checks.</Callout>
            <div className="row between"><span className="muted">Data folder</span><button className="btn sm" onClick={() => call('app:openDataDir')}><FolderOpen />Open</button></div>
            <div className="mono tiny" style={{ wordBreak: 'break-all' }}>{data.paths.db}</div>
            <div className="row"><button className="btn sm" onClick={() => go('/backup')}>Backup & export…</button><button className="btn sm" onClick={() => go('/help')}>Database diagnostics…</button></div>
          </div>
        </Card>
        <Card title="About & updates">
          <div className="col small">
            <div>EMI Tracker <b>v{data.app.version}</b> for Windows</div>
            <div className="muted">There is no online update checker. To update, install a newer version over this one; a backup is taken automatically before the new version touches your data.</div>
            <div className="divider" />
            <div className="row wrap">
              <button className="btn sm" onClick={() => act(() => call('demo:load'), 'Demo loans added')}><Sparkles />Add demo loans</button>
              <button className="btn sm danger" onClick={() => setReset(true)}><Trash2 />Erase all data…</button>
            </div>
          </div>
        </Card>
      </div>
      {reset && (
        <Confirm title="Erase all loan data?" danger typeToConfirm="DELETE ALL DATA" confirmLabel="Erase everything" onClose={() => setReset(false)}
          onConfirm={async () => { setReset(false); await act(() => call('data:resetAll', { confirm: 'DELETE ALL DATA' }), 'All data erased — a recovery backup was saved'); }}>
          <Callout kind="danger">Removes every loan, payment, reminder and notification on this PC. A recovery backup is written first. If sync is on, the data will come back from your other devices on the next sync — turn sync off first if that is not what you want.</Callout>
        </Confirm>
      )}
    </div>
  );
}
