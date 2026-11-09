import { useEffect, useState } from 'react';
import { CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { call } from '../lib/api';
import { useStore } from '../lib/store';
import { AuditList } from './LoanDetail';
import { Callout, Card, Kv, Tabs } from '../components/ui';

interface Diagnostics {
  app: { version: string }; electron: string; chrome: string; node: string; schemaVersion: number;
  integrity: { ok: boolean; message: string; foreignKeyErrors: number }; counts: Record<string, number>; dataDir: string; dbFile: string; dbSize: number;
  blockedRequests: number; engineChecks: { loanId: string; name: string; reconciles: boolean; warnings: number }[]; log: { at: string; area: string; message: string }[]; safeStorage: boolean;
}

export function Help() {
  const [tab, setTab] = useState<'guide' | 'diagnostics' | 'audit'>('guide');
  return (
    <div className="page">
      <div className="page-head"><div><h1 className="page-title">Help & diagnostics</h1><p className="page-sub">How EMI Tracker calculates, stores and protects your data</p></div></div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'guide', label: 'Guide' }, { value: 'diagnostics', label: 'Diagnostics' }, { value: 'audit', label: 'Audit log' }]} />
      {tab === 'guide' && <Guide />}
      {tab === 'diagnostics' && <DiagnosticsView />}
      {tab === 'audit' && <AuditList />}
    </div>
  );
}

function Guide() {
  return (
    <div className="grid g2">
      <Card title="Getting started">
        <ol className="small" style={{ paddingLeft: 18, margin: 0, lineHeight: 1.8 }}>
          <li>Add each loan with the wizard (All Loans → Add loan). Enter the EMI from your lender statement for exact figures.</li>
          <li>If EMIs were paid before you started tracking, mark them as <i>paid before tracking</i> — they show as estimates.</li>
          <li>Record each payment as it happens (Payment Tracker → Record payment). Use the lender's principal / interest split when you have it.</li>
          <li>Enter the lender's outstanding balance occasionally to reconcile.</li>
          <li>Set up reminders, back up regularly, and optionally sync with the Android app.</li>
        </ol>
      </Card>
      <Card title="Keyboard">
        <ul className="small" style={{ paddingLeft: 18, margin: 0, lineHeight: 1.8 }}>
          <li><span className="mono">Ctrl+K</span> — search loans, payments, references and pages</li>
          <li><span className="mono">Tab / Shift+Tab</span> — move between controls; focus is always visible</li>
          <li>Heatmaps — arrow keys move between days, <span className="mono">Enter</span> opens the day</li>
          <li><span className="mono">Esc</span> — close dialogs</li>
        </ul>
      </Card>
      <Card title="How figures are calculated">
        <div className="col small">
          <div><b>Outstanding principal</b> is calculated from your recorded payments — never copied from the lender. Differences are shown in Lender reconciliation.</div>
          <div><b>Total paid</b> = principal repaid + interest paid + fees & penalties + any unapplied excess. Upfront fees and pre-EMI interest are included.</div>
          <div><b>Future cash outflow</b> = remaining scheduled EMIs (with the final EMI adjusted) + overdue amounts + estimated charges. It is larger than outstanding principal because it includes future interest.</div>
          <div><b>Closure dates</b> run the amortization forward from the actual balance month by month — they are not balance ÷ EMI.</div>
          <div>Money is computed with decimal arithmetic at 40 digits and rounded half-up to the paisa when posted.</div>
          <div>Labels: <span className="tag est">Estimate</span> means assumed or incomplete data; <span className="tag proj">Projected</span> means a future or hypothetical figure.</div>
        </div>
      </Card>
      <Card title="Privacy">
        <div className="col small">
          <div>Everything is stored in a local SQLite database on this PC. No internet connection is used: the app blocks all outbound requests and loads no remote fonts, scripts or images.</div>
          <div>Logs contain only event descriptions — never amounts, names or account numbers.</div>
          <div>Encrypted backups use AES-256-GCM; passphrases are never stored. The sync passphrase is protected with Windows DPAPI.</div>
        </div>
      </Card>
    </div>
  );
}

function DiagnosticsView() {
  const { data } = useStore();
  const [d, setD] = useState<Diagnostics | null>(null);
  const load = () => void call<Diagnostics>('diagnostics:get').then(setD);
  useEffect(load, [data]);
  if (!d) return <p className="muted">Running checks…</p>;
  const ok = (b: boolean) => (b ? <span className="pos"><CheckCircle2 size={13} /> OK</span> : <span className="neg"><XCircle size={13} /> Problem</span>);
  return (
    <div className="grid g2">
      <Card title="Database" actions={<button className="btn sm" onClick={load}><RefreshCw />Re-run</button>}>
        <Kv items={[['Integrity check', ok(d.integrity.ok)], ['Foreign key violations', d.integrity.foreignKeyErrors], ['Schema version', d.schemaVersion], ['Size', `${(d.dbSize / 1024).toFixed(1)} KB`],
          ...Object.entries(d.counts).map(([k, v]) => [k, v] as [string, number])]} />
        <div className="mono tiny faint" style={{ marginTop: 8, wordBreak: 'break-all' }}>{d.dbFile}</div>
      </Card>
      <Card title="Offline & privacy">
        <Kv items={[['Outbound requests blocked this session', d.blockedRequests], ['Network access', <span key="n" className="pos">Disabled by design</span>], ['Windows secure storage (DPAPI)', d.safeStorage ? 'Available' : 'Unavailable'], ['App', `v${d.app.version}`], ['Electron / Chromium / Node', `${d.electron} / ${d.chrome} / ${d.node}`]]} />
        {d.blockedRequests > 0 && <div style={{ marginTop: 8 }}><Callout kind="warn">Something tried to reach the network and was blocked. No data left this PC.</Callout></div>}
      </Card>
      <Card title="Financial consistency" sub="Total paid = principal + interest + fees + unapplied, per loan">
        {d.engineChecks.length ? <Kv items={d.engineChecks.map((c) => [c.name, <span key={c.loanId}>{ok(c.reconciles)}{c.warnings ? <span className="warn small"> · {c.warnings} warning(s)</span> : null}</span>])} /> : <p className="muted">No loans.</p>}
      </Card>
      <Card title="Recent events" sub="Event descriptions only — no financial data">
        <div className="table-wrap" style={{ maxHeight: 260 }}>
          <table className="data"><tbody>{d.log.map((l, i) => <tr key={i}><td className="nowrap tiny muted">{l.at.slice(11, 19)}</td><td className="tiny">{l.area}</td><td className="tiny">{l.message}</td></tr>)}</tbody></table>
        </div>
      </Card>
    </div>
  );
}
