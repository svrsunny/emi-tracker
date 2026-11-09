import { useEffect, useState } from 'react';
import { CheckCircle2, DatabaseBackup, Download, FolderOpen, Lock, RefreshCw, RotateCcw, ShieldAlert, Smartphone, Upload } from 'lucide-react';
import { toCsv } from '../../shared/csv';
import { call, type BackupHistoryItem, type LocalSettings } from '../lib/api';
import { useAction, useStore } from '../lib/store';
import { ImportDialog } from '../components/ImportDialog';
import { WifiSync } from '../components/WifiSync';
import { Callout, Card, Confirm, Kv, Modal, PAYMENT_TYPE_LABEL, Switch, TextInput } from '../components/ui';

interface Preview { createdAt: string; kind: string; app: { name: string; version: string; platform: string }; deviceName: string; schemaVersion: number; formatVersion: number; counts: Record<string, number>; current: Record<string, number>; encrypted: boolean; checksum: string }
interface RestoreReport { restored: Record<string, number>; recoveryBackup: string; checksumVerified: boolean; integrity: { ok: boolean; message: string } }
interface SyncReport { at: string; peers: { file: string; deviceName: string; ok: boolean; message: string; stats?: { added: number; updated: number; deleted: number } }[]; totals: { added: number; updated: number; deleted: number } }

const COUNT_LABELS: Record<string, string> = { loans: 'Loans', payments: 'Payments', adjustments: 'Rate / EMI changes', customReminders: 'Custom reminders', notifications: 'Notification history', audit: 'Audit entries', categories: 'Categories', tombstones: 'Deletion markers' };

export function Backup() {
  const { data, fmt, comps, reload, toast } = useStore();
  const act = useAction();
  const local = data.local;
  const [history, setHistory] = useState<BackupHistoryItem[]>(data.backupHistory);
  const [encryptOpen, setEncryptOpen] = useState(false);
  const [restoreFile, setRestoreFile] = useState<{ path: string; encrypted: boolean } | null>(null);
  const [importing, setImporting] = useState(false);
  const [syncPass, setSyncPass] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [lastSync, setLastSync] = useState<SyncReport | null>(null);

  useEffect(() => { void call<BackupHistoryItem[]>('backup:history').then(setHistory); }, [data]);
  const setLocal = (patch: Partial<LocalSettings>) => act(() => call('local:set', patch));
  const lastAge = local.lastBackupAt ? Math.floor((Date.now() - Date.parse(local.lastBackupAt)) / 86400000) : null;

  const backupNow = async (passphrase?: string) => {
    const r = await act(() => call<{ path: string; counts: Record<string, number> }>('backup:create', passphrase ? { passphrase } : {}), passphrase ? 'Encrypted backup created and verified' : 'Backup created and verified');
    if (r) setHistory(await call('backup:history'));
  };

  const exportCsv = async (kind: 'loans' | 'payments') => {
    const content = kind === 'loans'
      ? toCsv([['id', 'name', 'lender', 'category', 'type', 'status', 'principal', 'sanctioned', 'disbursed', 'annual_rate', 'rate_type', 'method', 'frequency', 'installments', 'emi', 'start_date', 'first_emi_date', 'due_day', 'outstanding_calculated', 'closure_projected', 'notes'],
        ...data.loans.map((l) => { const s = comps.get(l.id)!.summary; return [l.id, l.name, l.lender, l.category, l.loanType, l.status, l.principal, l.sanctionedAmount, l.disbursedAmount, l.annualRate, l.rateType, l.interestMethod, l.frequency, l.totalInstallments, l.emiAmount ?? s.currentEmi, l.startDate, l.firstEmiDate, l.emiDueDay, s.outstandingPrincipal, s.closureDate ?? '', l.notes]; })])
      : toCsv([['id', 'loan', 'date', 'type', 'installment', 'amount', 'principal', 'interest', 'fees', 'penalty', 'reference', 'status', 'notes'],
        ...data.payments.map((p) => { const a = comps.get(p.loanId)?.allocations[p.id]; return [p.id, data.loans.find((l) => l.id === p.loanId)?.name, p.txnDate, PAYMENT_TYPE_LABEL[p.type], p.installmentNo ?? '', p.amount, a?.principal, a?.interest, a?.fees, a?.penalty, p.reference, p.status, p.notes]; })]);
    await act(() => call('export:save', { name: `emi-tracker-${kind}.csv`, content, kind: 'csv' }));
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><h1 className="page-title">Backup, sync & restore</h1><p className="page-sub">Your data exists only on your devices. Backups are your safety net.</p></div>
        <div className="row"><button className="btn" onClick={() => setEncryptOpen(true)}><Lock />Encrypted backup</button><button className="btn primary" onClick={() => backupNow()}><DatabaseBackup />Back up now</button></div>
      </div>

      <div className="grid g3" style={{ marginBottom: 14 }}>
        <div className={`card ${lastAge === null || lastAge > 7 ? '' : 'hero'}`}>
          <div className="stat-label">Last successful backup</div>
          <div className={`stat-value ${lastAge === null ? 'neg' : lastAge > 7 ? 'warn' : 'pos'}`}>{local.lastBackupAt ? (lastAge === 0 ? 'Today' : `${lastAge} day(s) ago`) : 'Never'}</div>
          <div className="stat-foot">{local.lastBackupAt ? new Date(local.lastBackupAt).toLocaleString() : 'Create your first backup now'}</div>
        </div>
        <Card title="Backup folder" actions={<button className="btn sm" onClick={() => act(() => call('backup:chooseDir'), 'Backup folder updated')}><FolderOpen />Change</button>}>
          <div className="mono small" style={{ wordBreak: 'break-all' }}>{local.backupDir}</div>
          <div className="tiny faint" style={{ marginTop: 6 }}>Choose a folder on another drive or a USB stick for extra safety.</div>
        </Card>
        <Card title="Automatic backups">
          <Switch checked={local.autoBackup} onChange={(v) => setLocal({ autoBackup: v })} label="Back up automatically" hint="While the app is running" />
          <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <TextInput label="Every" type="number" value={local.autoBackupHours} onChange={(v) => setLocal({ autoBackupHours: Math.max(1, Math.min(720, +v || 24)) })} suffix="hours" />
            <TextInput label="Keep latest" type="number" value={local.backupKeep} onChange={(v) => setLocal({ backupKeep: Math.max(1, Math.min(500, +v || 30)) })} suffix="files" />
          </div>
        </Card>
      </div>

      <div className="grid g2" style={{ marginBottom: 14 }}>
        <Card title="Restore" sub="Replace all current data with a backup">
          <div className="col">
            <Callout kind="warn">Restoring overwrites current loans and payments. A recovery backup of your current data is created automatically first, and the restore is rolled back if verification fails.</Callout>
            <div className="row">
              <button className="btn" onClick={async () => { const f = await act(() => call<{ path: string; encrypted: boolean } | null>('backup:pick')); if (f) setRestoreFile(f); }}><RotateCcw />Choose backup to restore…</button>
            </div>
            <div className="tiny faint">Accepts .json and encrypted .emibackup files from EMI Tracker on Windows or Android.</div>
          </div>
        </Card>
        <Card title="Export & import" sub="Portable formats for spreadsheets and other tools">
          <div className="row wrap">
            <button className="btn" onClick={() => act(() => call('export:fullJson'), 'Full JSON export saved')}><Download />Full export (JSON)</button>
            <button className="btn" onClick={() => exportCsv('loans')}><Download />Loans (CSV)</button>
            <button className="btn" onClick={() => exportCsv('payments')}><Download />Payments (CSV)</button>
            <button className="btn" onClick={() => setImporting(true)}><Upload />Import CSV</button>
          </div>
          <div className="tiny faint" style={{ marginTop: 8 }}>Exports are unencrypted. Store them somewhere private.</div>
        </Card>
      </div>

      <WifiSync />

      <div style={{ marginTop: 14 }} />
      <Card title="Folder sync" sub="Sync through a folder or USB drive — works without Wi-Fi" actions={<Smartphone size={18} className="faint" />}>
        <div className="grid g2">
          <div className="col">
            <Switch checked={local.syncEnabled} onChange={(v) => setLocal({ syncEnabled: v })} label="Automatic sync" hint={`Every ${local.syncIntervalMinutes} minutes while the app runs, when the folder is available`} />
            <div className="row">
              <div className="grow mono small" style={{ wordBreak: 'break-all' }}>{local.syncFolder || <span className="faint">No sync folder chosen</span>}</div>
              <button className="btn sm" onClick={() => act(() => call('sync:chooseFolder'), 'Sync folder set')}><FolderOpen />Choose folder</button>
            </div>
            <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <TextInput label="Sync every" type="number" value={local.syncIntervalMinutes} onChange={(v) => setLocal({ syncIntervalMinutes: Math.max(5, Math.min(1440, +v || 30)) })} suffix="min" />
              <TextInput label="This device's name" value={local.deviceName} onChange={(v) => setLocal({ deviceName: v.slice(0, 100) })} />
            </div>
            <Switch checked={local.syncEncrypted} onChange={(v) => { if (v) setSyncPass(true); else void act(() => call('sync:setPassphrase', { passphrase: null }), 'Sync encryption off'); }} label="Encrypt sync files"
              hint={local.syncEncrypted ? (data.syncPassphraseSaved ? 'Passphrase saved with Windows protection (DPAPI)' : 'Passphrase missing — set it again') : 'Use the same passphrase on every device'} />
            <div className="row">
              <button className="btn primary" disabled={!local.syncFolder || syncBusy} onClick={async () => {
                setSyncBusy(true);
                try { const r = await call<SyncReport>('sync:now'); setLastSync(r); await reload(); toast({ kind: 'success', title: 'Sync complete', body: `${r.totals.added} added · ${r.totals.updated} updated · ${r.totals.deleted} removed` }); }
                catch (e) { toast({ kind: 'error', title: 'Sync failed', body: (e as Error).message }); await reload(); } finally { setSyncBusy(false); }
              }}><RefreshCw />{syncBusy ? 'Syncing…' : 'Sync now'}</button>
              <span className="small muted">{local.lastSyncAt ? `Last: ${new Date(local.lastSyncAt).toLocaleString()} — ${local.lastSyncResult}` : 'Never synced'}</span>
            </div>
            {lastSync && lastSync.peers.map((p) => <div key={p.file} className={`small ${p.ok ? 'muted' : 'neg'}`}>{p.ok ? <CheckCircle2 size={12} /> : <ShieldAlert size={12} />} {p.deviceName || p.file}: {p.message}{p.stats ? ` (+${p.stats.added}, ~${p.stats.updated}, −${p.stats.deleted})` : ''}</div>)}
          </div>
          <div className="col small">
            <Callout><b>How it works.</b> Each device writes <span className="mono">emi-tracker-sync-&lt;device&gt;.json</span> into the folder and merges the files written by your other devices. The newest edit of each record wins; deletions carry over.</Callout>
            <Callout><b>Android.</b> In the phone app open <i>More → Backup & sync</i>, choose a sync folder, and make it the same folder — e.g. copy files over USB, or use a folder your own file-sync tool already mirrors. On the same Wi-Fi, Wi-Fi sync above is simpler.</Callout>
            <Callout kind="warn">Sync files contain your full loan data. Turn on encryption if the folder is shared or leaves your PC.</Callout>
          </div>
        </div>
      </Card>

      <div style={{ marginTop: 14 }} />
      <Card flush title="Backup history" sub="Every backup is verified by reading it back and checking its SHA-256 checksum">
        <div className="table-wrap" style={{ maxHeight: 360 }}>
          <table className="data">
            <thead><tr><th>Created</th><th>Kind</th><th>Contents</th><th>Size</th><th>Result</th><th /></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td className="nowrap">{new Date(h.createdAt).toLocaleString()}</td>
                  <td>{h.kind}{h.encrypted && <span className="tag" style={{ marginLeft: 6 }}><Lock size={10} />encrypted</span>}</td>
                  <td className="muted small">{h.counts.loans} loans · {h.counts.payments} payments · {h.counts.notifications} notifications</td>
                  <td className="muted">{(h.size / 1024).toFixed(1)} KB</td>
                  <td className={h.ok ? 'pos' : 'neg'}>{h.ok ? 'Verified' : h.message}</td>
                  <td className="right"><button className="btn sm ghost" onClick={() => call('file:reveal', { path: h.path })}><FolderOpen size={13} />Show</button></td>
                </tr>
              ))}
              {!history.length && <tr><td colSpan={6} className="muted">No backups yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {encryptOpen && <PassphraseDialog title="Create encrypted backup" confirmText="Create backup" onClose={() => setEncryptOpen(false)} onSubmit={async (p) => { setEncryptOpen(false); await backupNow(p); }}
        note="The passphrase is never stored. Without it this backup cannot be restored — keep it somewhere safe." />}
      {syncPass && <PassphraseDialog title="Sync passphrase" confirmText="Turn on encryption" onClose={() => setSyncPass(false)} onSubmit={async (p) => { setSyncPass(false); await act(() => call('sync:setPassphrase', { passphrase: p }), 'Sync files will be encrypted'); }}
        note="Saved on this PC with Windows data protection so automatic sync can run. Enter the same passphrase on your other devices." />}
      {restoreFile && <RestoreFlow file={restoreFile} onClose={() => setRestoreFile(null)} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
      <div className="tiny faint" style={{ marginTop: 10 }}>Data folder: <span className="mono">{data.paths.data}</span> · Today {fmt.date(new Date().toISOString().slice(0, 10))}</div>
    </div>
  );
}

function PassphraseDialog({ title, note, confirmText, onClose, onSubmit }: { title: string; note: string; confirmText: string; onClose: () => void; onSubmit: (p: string) => void }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const err = a.length > 0 && a.length < 8 ? 'At least 8 characters' : b && a !== b ? 'Passphrases do not match' : undefined;
  return (
    <Modal title={title} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!a || a !== b || a.length < 8} onClick={() => onSubmit(a)}>{confirmText}</button></>}>
      <div className="col">
        <TextInput label="Passphrase" type="password" value={a} onChange={setA} autoFocus />
        <TextInput label="Repeat passphrase" type="password" value={b} onChange={setB} error={err} />
        <Callout kind="warn">{note}</Callout>
        <div className="tiny faint">AES-256-GCM with a key derived by PBKDF2-SHA256 (210,000 iterations).</div>
      </div>
    </Modal>
  );
}

function RestoreFlow({ file, onClose }: { file: { path: string; encrypted: boolean }; onClose: () => void }) {
  const { reload, toast } = useStore();
  const [pass, setPass] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<RestoreReport | null>(null);

  const validate = async () => {
    setError(null);
    try { setPreview(await call<Preview>('backup:preview', { path: file.path, passphrase: pass || undefined })); }
    catch (e) { setError((e as Error).message); }
  };
  useEffect(() => { if (!file.encrypted) void validate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (report) {
    return (
      <Modal title="Restore complete" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
        <div className="col">
          <Callout kind="ok">Data restored and verified: checksum {report.checksumVerified ? 'matches' : 'MISMATCH'}, database integrity {report.integrity.ok ? 'OK' : report.integrity.message}.</Callout>
          <Kv items={Object.entries(report.restored).map(([k, v]) => [COUNT_LABELS[k] ?? k, v])} />
          <div className="small muted">Your previous data was saved as a recovery backup: <span className="mono">{report.recoveryBackup}</span></div>
        </div>
      </Modal>
    );
  }
  return (
    <Modal title="Restore from backup" sub={file.path} size="wide" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button>{preview && <button className="btn danger" onClick={() => setConfirm(true)}>Restore this backup…</button>}</>}>
      <div className="col">
        {file.encrypted && !preview && (
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="grow"><TextInput label="Backup passphrase" type="password" value={pass} onChange={setPass} autoFocus /></div>
            <button className="btn primary" onClick={validate} disabled={!pass}>Unlock & validate</button>
          </div>
        )}
        {error && <Callout kind="danger">{error}</Callout>}
        {preview && (
          <>
            <Callout kind="ok">Backup is valid: structure, checksum and references verified.</Callout>
            <Kv items={[['Created', new Date(preview.createdAt).toLocaleString()], ['From', `${preview.deviceName || 'Unknown device'} · ${preview.app.platform} v${preview.app.version}`], ['Format', `v${preview.formatVersion} · schema ${preview.schemaVersion}${preview.encrypted ? ' · encrypted' : ''}`], ['Checksum', <span key="c" className="mono tiny">{preview.checksum.slice(0, 16)}…</span>]]} />
            <table className="data">
              <thead><tr><th>Records</th><th className="num">In backup</th><th className="num">Current (will be replaced)</th></tr></thead>
              <tbody>{Object.keys(COUNT_LABELS).map((k) => <tr key={k}><td>{COUNT_LABELS[k]}</td><td className="num">{preview.counts[k] ?? 0}</td><td className="num muted">{preview.current[k] ?? 0}</td></tr>)}</tbody>
            </table>
          </>
        )}
      </div>
      {confirm && (
        <Confirm title="Replace all current data?" danger confirmLabel="Restore" typeToConfirm="RESTORE" busy={busy} onClose={() => setConfirm(false)} onConfirm={async () => {
          setBusy(true);
          try { const r = await call<RestoreReport>('backup:restore', { path: file.path, passphrase: pass || undefined }); setReport(r); setConfirm(false); await reload(); }
          catch (e) { toast({ kind: 'error', title: 'Restore failed — your data is unchanged', body: (e as Error).message }); setConfirm(false); }
          finally { setBusy(false); }
        }}>
          <Callout kind="danger">Current loans, payments, reminders and settings will be replaced by the backup. A recovery backup is saved first.</Callout>
        </Confirm>
      )}
    </Modal>
  );
}
