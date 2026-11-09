import { useEffect, useState } from 'react';
import { Fingerprint, Lock } from 'lucide-react';
import { call } from '../lib/api';
import { useStore } from '../lib/store';
import { Callout, Card, Check, Select, TextInput } from './ui';
import type { LockStatus } from './LockGate';

type Method = LockStatus['method'];
const AFTER = [{ value: 0, label: 'As soon as it is hidden or minimised' }, { value: 1, label: 'After 1 minute' }, { value: 5, label: 'After 5 minutes' }, { value: 15, label: 'After 15 minutes' }, { value: 60, label: 'After 1 hour' }];

/** Settings → Security: turn the app lock on, pick PIN / password / Windows Hello, auto-lock delay. */
export function AppLockSettings() {
  const { toast } = useStore();
  const [s, setS] = useState<LockStatus | null>(null);
  const [method, setMethod] = useState<Method>('none');
  const [secret, setSecret] = useState('');
  const [confirm, setConfirm] = useState('');
  const [current, setCurrent] = useState('');
  const [hello, setHello] = useState(false);
  const [after, setAfter] = useState(5);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => call<LockStatus>('lock:status').then((x) => { setS(x); setMethod(x.method); setHello(x.hello && x.method !== 'hello'); setAfter(x.lockAfterMinutes); });
  useEffect(() => { void load(); }, []);
  if (!s) return null;

  const needsSecret = (method === 'pin' || method === 'password') && (method !== s.method || secret !== '');
  const changing = s.method !== 'none' && (method !== s.method || secret !== '' || (method !== 'hello' && hello !== s.hello));
  const needsCurrent = (s.method === 'pin' || s.method === 'password') && changing;
  const word = s.method === 'pin' ? 'PIN' : 'password';
  const save = async (confirmWithHello = false) => {
    setError('');
    if (needsSecret && secret !== confirm) { setError(`The two ${method === 'pin' ? 'PINs' : 'passwords'} do not match`); return; }
    if (needsCurrent && !confirmWithHello && !current) { setError(`Enter your current ${word} to change the lock`); return; }
    setBusy(true);
    try {
      await call('lock:set', { method, secret: secret || undefined, hello: method === 'hello' || hello, lockAfterMinutes: after, current: current || undefined, confirmWithHello });
      toast({ kind: 'success', title: method === 'none' ? 'App lock turned off' : 'App lock saved' });
      setSecret(''); setConfirm(''); setCurrent('');
      await load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Card title="App lock" sub="Ask for a PIN, password, fingerprint or face before showing your loans" actions={<Lock size={18} className="faint" />}>
      <Select label="Lock with" value={method} onChange={(v) => { setMethod(v); setSecret(''); setConfirm(''); }} options={[
        { value: 'none', label: 'Off' }, { value: 'pin', label: 'App PIN (4–12 digits)' }, { value: 'password', label: 'App password' },
        ...(s.helloAvailable || s.method === 'hello' ? [{ value: 'hello' as Method, label: 'Windows Hello (fingerprint, face or Windows PIN)' }] : []),
      ]} />
      {(method === 'pin' || method === 'password') && (
        <div className="form-grid" style={{ marginTop: 8 }}>
          <TextInput label={s.method === method ? `New ${method === 'pin' ? 'PIN' : 'password'} (leave empty to keep)` : method === 'pin' ? 'PIN' : 'Password'} type="password"
            value={secret} onChange={(v) => setSecret(method === 'pin' ? v.replace(/\D/g, '').slice(0, 12) : v)} />
          <TextInput label="Repeat it" type="password" value={confirm} onChange={(v) => setConfirm(method === 'pin' ? v.replace(/\D/g, '').slice(0, 12) : v)} />
        </div>
      )}
      {(method === 'pin' || method === 'password') && s.helloAvailable && (
        <div style={{ marginTop: 6 }}><Check checked={hello} onChange={setHello} label={<span className="row" style={{ gap: 6 }}><Fingerprint size={14} />Also unlock with Windows Hello (fingerprint or face)</span>} /></div>
      )}
      {method !== 'none' && <div style={{ marginTop: 8 }}><Select label="Lock again" value={after} onChange={setAfter} options={AFTER} hint="Also locks when Windows locks or the PC sleeps" /></div>}
      {needsCurrent && (
        <div style={{ marginTop: 8 }}>
          <TextInput label={`Current ${word}`} type="password" value={current} onChange={setCurrent} hint="Needed to change or turn off the lock" />
          {s.helloAvailable && <button className="link-btn tiny faint" style={{ marginTop: 4 }} onClick={() => void save(true)} disabled={busy}>Forgot it? Confirm with Windows Hello instead</button>}
        </div>
      )}
      {s.method === 'hello' && changing && <div className="tiny faint" style={{ marginTop: 8 }}>Saving asks Windows Hello to confirm it's you.</div>}
      {error && <div style={{ marginTop: 8 }}><Callout kind="danger">{error}</Callout></div>}
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save app lock'}</button>
        {s.enabled && <button className="btn" onClick={() => call('lock:now')}><Lock size={14} />Lock now</button>}
      </div>
      <div className="tiny faint" style={{ marginTop: 8 }}>
        Set on this PC only; your phone has its own lock. {s.helloAvailable ? 'If you forget the app PIN or password, Windows Hello lets you back in.' : 'Windows Hello is not set up on this PC, so keep your PIN or password safe.'}
        {' '}The lock protects the app's screens; your data file itself is not encrypted — use encrypted backups for copies that leave this PC.
      </div>
    </Card>
  );
}
