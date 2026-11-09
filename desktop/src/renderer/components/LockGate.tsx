import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Fingerprint, Lock } from 'lucide-react';
import { call } from '../lib/api';

export interface LockStatus {
  enabled: boolean; method: 'none' | 'pin' | 'password' | 'hello'; hello: boolean; helloAvailable: boolean; locked: boolean; lockAfterMinutes: number; lockoutSeconds: number;
}

/**
 * Shows the unlock screen instead of the app while EMI Tracker is locked. The app (and every
 * record it loaded) is unmounted while locked; the main process also refuses data requests.
 */
export function LockGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LockStatus | null>(null);
  const refresh = useCallback(() => call<LockStatus>('lock:status').then(setStatus), []);
  useEffect(() => {
    void refresh();
    return window.emi.on('lock:changed', () => void refresh());
  }, [refresh]);
  if (!status) return null;
  if (status.locked) return <LockScreen status={status} onUnlocked={refresh} />;
  return <>{children}</>;
}

function LockScreen({ status, onUnlocked }: { status: LockStatus; onUnlocked: () => void }) {
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pin = status.method === 'pin';

  // no app data while locked: follow the system theme
  useEffect(() => {
    document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }, []);

  const hello = useCallback(async () => {
    setBusy(true); setError('');
    try { await call('lock:hello'); onUnlocked(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [onUnlocked]);

  // Windows Hello opens by itself only once the window is in front (not while hidden in the tray)
  useEffect(() => {
    if (status.method !== 'hello') { input.current?.focus(); return; }
    if (document.visibilityState === 'visible' && document.hasFocus()) { void hello(); return; }
    const onFocus = () => { window.removeEventListener('focus', onFocus); void hello(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [status.method, hello]);

  const submit = async () => {
    if (!secret) return;
    setBusy(true); setError('');
    try { await call('lock:unlock', { secret }); onUnlocked(); } catch (e) { setError((e as Error).message); setSecret(''); input.current?.focus(); } finally { setBusy(false); }
  };

  return (
    <div className="lock-screen" role="dialog" aria-label="EMI Tracker is locked">
      <div className="lock-card">
        <div className="lock-icon"><Lock size={26} /></div>
        <h2 style={{ margin: '10px 0 2px' }}>EMI Tracker is locked</h2>
        <p className="muted small" style={{ margin: 0 }}>{status.method === 'hello' ? 'Unlock with Windows Hello' : `Enter your ${pin ? 'PIN' : 'password'} to continue`}</p>
        {status.method !== 'hello' && (
          <form onSubmit={(e) => { e.preventDefault(); void submit(); }} style={{ marginTop: 18 }}>
            <input ref={input} className="input lock-input" type="password" inputMode={pin ? 'numeric' : 'text'} autoComplete="off" aria-label={pin ? 'PIN' : 'Password'}
              value={secret} onChange={(e) => setSecret(pin ? e.target.value.replace(/\D/g, '').slice(0, 12) : e.target.value)} disabled={busy || status.lockoutSeconds > 0} placeholder={pin ? '••••' : 'Password'} />
            <button className="btn primary" style={{ width: '100%', marginTop: 10 }} disabled={busy || !secret}>{busy ? 'Checking…' : 'Unlock'}</button>
          </form>
        )}
        {(status.hello || status.method === 'hello') && (
          <button className="btn" style={{ width: '100%', marginTop: 10 }} onClick={hello} disabled={busy}><Fingerprint size={16} />Use Windows Hello</button>
        )}
        {error && <div className="neg small" role="alert" style={{ marginTop: 10 }}>{error}</div>}
        {status.method !== 'hello' && !status.hello && status.helloAvailable && (
          <button className="link-btn tiny faint" style={{ marginTop: 14, width: '100%', textAlign: 'center' }} onClick={hello}>Forgot your {pin ? 'PIN' : 'password'}? Verify with Windows Hello</button>
        )}
      </div>
    </div>
  );
}
