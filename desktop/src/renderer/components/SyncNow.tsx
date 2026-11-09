import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { call } from '../lib/api';
import { useStore } from '../lib/store';

interface SyncAllResult {
  phoneRequestedAt: number | null;
  folder: { totals: { added: number; updated: number; deleted: number } } | null;
  folderError: string;
}
interface Peers { peers: { deviceName: string; lastSyncAt: string | null; lastResult: string }[] }

const WAIT_MS = 90_000;

/**
 * Syncs now: the sync folder straight away, and a paired phone as soon as its app is open on the
 * same Wi-Fi (the PC asks; the phone checks every few seconds while EMI Tracker is open on it).
 */
export function SyncNowButton({ className = 'btn' }: { className?: string }) {
  const { toast } = useStore();
  const [busy, setBusy] = useState(false);
  const [waitingSince, setWaitingSince] = useState<number | null>(null);

  useEffect(() => {
    if (waitingSince === null) return;
    const t = setInterval(async () => {
      const s = await call<Peers>('lan:status').catch(() => null);
      const done = s?.peers.find((p) => p.lastSyncAt && Date.parse(p.lastSyncAt) >= waitingSince);
      if (done) {
        setWaitingSince(null);
        toast({ kind: 'success', title: `Synced with ${done.deviceName}`, body: done.lastResult });
      } else if (Date.now() - waitingSince > WAIT_MS) {
        setWaitingSince(null);
        toast({ kind: 'info', title: 'Your phone has not answered yet', body: 'Open EMI Tracker on the phone (same Wi-Fi) — it syncs within a few seconds. The request stays open for 10 minutes.' });
      }
    }, 2000);
    return () => clearInterval(t);
  }, [waitingSince, toast]);

  const run = async () => {
    setBusy(true);
    try {
      const r = await call<SyncAllResult>('sync:all');
      if (r.folder) toast({ kind: 'success', title: 'Sync folder updated', body: `${r.folder.totals.added} added · ${r.folder.totals.updated} updated · ${r.folder.totals.deleted} removed` });
      if (r.folderError) toast({ kind: 'error', title: 'Folder sync failed', body: r.folderError });
      if (r.phoneRequestedAt) setWaitingSince(r.phoneRequestedAt);
    } catch (e) {
      toast({ kind: 'error', title: 'Sync failed', body: (e as Error).message });
    } finally { setBusy(false); }
  };

  const waiting = waitingSince !== null;
  return (
    <button className={className} onClick={run} disabled={busy || waiting} title="Sync with your phone over Wi-Fi and with your sync folder">
      <RefreshCw className={busy || waiting ? 'spin' : undefined} />{busy ? 'Syncing…' : waiting ? 'Waiting for phone…' : 'Sync now'}
    </button>
  );
}
