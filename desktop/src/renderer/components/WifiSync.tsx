import { useEffect, useRef, useState } from 'react';
import { Trash2, Wifi } from 'lucide-react';
import { call } from '../lib/api';
import { useAction, useStore } from '../lib/store';
import { Callout, Card, Empty, Switch, TextInput } from './ui';
import { SyncNowButton } from './SyncNow';

interface LanStatus {
  enabled: boolean; running: boolean; port: number; error: string; addresses: string[];
  pairing: { code: string; expiresAt: number } | null;
  peers: { deviceId: string; deviceName: string; pairedAt: string; lastSyncAt: string | null; lastResult: string }[];
}

/** Wi-Fi sync with paired phones: the PC listens on the home network, the phone connects. */
export function WifiSync() {
  const { data, toast } = useStore();
  const act = useAction();
  const local = data.local;
  const [s, setS] = useState<LanStatus | null>(null);
  const [port, setPort] = useState(String(local.lanPort));
  const [now, setNow] = useState(Date.now());
  const refresh = () => call<LanStatus>('lan:status').then(setS).catch(() => undefined);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => { setNow(Date.now()); void refresh(); }, s?.pairing ? 1500 : 5000);
    return () => clearInterval(t);
  }, [s?.pairing, data]);

  const peerCount = useRef<number | null>(null);
  const pair = async () => {
    const r = await act(() => call<LanStatus>('lan:pair'));
    if (r) setS(r);
  };
  useEffect(() => {
    if (!s) return;
    if (peerCount.current !== null && s.peers.length > peerCount.current) toast({ kind: 'success', title: 'Phone paired', body: s.peers[s.peers.length - 1].deviceName });
    peerCount.current = s.peers.length;
  }, [s, toast]);

  const savePort = () => {
    const n = Math.floor(+port);
    if (n >= 1024 && n <= 65535 && n !== local.lanPort) void act(() => call('local:set', { lanPort: n }), 'Port changed');
    else setPort(String(local.lanPort));
  };
  const secondsLeft = s?.pairing ? Math.max(0, Math.round((s.pairing.expiresAt - now) / 1000)) : 0;
  const address = s?.addresses.length ? s.addresses.map((a) => `${a}${s.port === 47830 ? '' : `:${s.port}`}`).join('  or  ') : null;

  return (
    <Card title="Wi-Fi sync with your phone" sub="Direct, encrypted sync when the phone and this PC are on the same Wi-Fi" actions={<Wifi size={18} className="faint" />}>
      <div className="grid g2">
        <div className="col">
          <Switch checked={local.lanEnabled} onChange={(v) => act(() => call('local:set', { lanEnabled: v }), v ? 'Wi-Fi sync is on' : 'Wi-Fi sync is off')}
            label="Allow my paired phone to sync over Wi-Fi" hint="Only devices on your home network, and only phones you pair with a code" />
          {local.lanEnabled && s && (
            <>
              {s.error ? <Callout kind="danger">{s.error}</Callout> : s.running ? (
                <div className="card tight" style={{ background: 'var(--surface-2)' }}>
                  <div className="small muted">Enter this PC address in the phone app (More → Backup & sync → Wi-Fi sync):</div>
                  <div className="mono" style={{ fontSize: 18, marginTop: 4 }}>{address ?? 'No Wi-Fi / network connection found'}</div>
                </div>
              ) : <div className="small muted">Starting…</div>}
              <div className="row wrap">
                <div style={{ width: 160 }}><TextInput label="Port" type="number" value={port} onChange={setPort} onBlur={savePort} hint="Default 47830" /></div>
                {!s.pairing && <button className="btn primary" disabled={!s.running} onClick={pair}>Pair a phone</button>}
              </div>
              {s.pairing && (
                <div className="card tight" style={{ textAlign: 'center' }}>
                  <div className="small muted">Type this code in the phone app</div>
                  <div className="mono" style={{ fontSize: 34, letterSpacing: 8, margin: '6px 0' }} aria-label="Pairing code">{s.pairing.code}</div>
                  <div className="tiny faint">Valid for {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}</div>
                  <button className="btn sm ghost" style={{ marginTop: 6 }} onClick={async () => setS(await call<LanStatus>('lan:cancelPair'))}>Cancel</button>
                </div>
              )}
            </>
          )}
        </div>
        <div className="col">
          <div className="field-label">Paired phones</div>
          {!s?.peers.length ? <Empty icon={<Wifi />} title="No phone paired yet">Turn on Wi-Fi sync, click “Pair a phone”, then enter the address and code in the phone app.</Empty> : (
            <table className="data">
              <thead><tr><th>Phone</th><th>Last sync</th><th /></tr></thead>
              <tbody>
                {s.peers.map((p) => (
                  <tr key={p.deviceId}>
                    <td>{p.deviceName}<div className="tiny faint">Paired {new Date(p.pairedAt).toLocaleDateString()}</div></td>
                    <td>{p.lastSyncAt ? new Date(p.lastSyncAt).toLocaleString() : 'Never'}<div className="tiny faint">{p.lastResult}</div></td>
                    <td className="right"><button className="btn ghost icon sm" aria-label={`Remove ${p.deviceName}`} onClick={async () => { const r = await act(() => call<LanStatus>('lan:removePeer', { deviceId: p.deviceId }), 'Phone removed'); if (r) setS(r); }}><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!!s?.peers.length && local.lanEnabled && <div style={{ marginTop: 8 }}><SyncNowButton className="btn primary" /></div>}
          <div className="tiny faint" style={{ marginTop: 8 }}>
            The phone syncs when you open its app, about every 15 minutes in the background, and when you tap Sync now on either device (with the phone app open). This PC must be on with EMI Tracker running (the tray is enough).
            Windows may ask once whether to allow EMI Tracker on private networks — choose Allow.
          </div>
        </div>
      </div>
    </Card>
  );
}
