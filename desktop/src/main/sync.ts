/**
 * Offline file-based sync between devices (desktop <-> Android, or several desktops).
 *
 * Every device writes its full snapshot to `<sync folder>/emi-tracker-sync-<deviceId>.json`
 * (or `.emisync` when encrypted). A sync run reads every other device's file, validates it,
 * merges it into the local database (record-level last-writer-wins on `updatedAt`, deletions
 * via tombstones), then rewrites this device's file. The app never transfers the files
 * itself: the folder can be a USB drive, a network share, or any folder the user's own tools
 * replicate. No network code is involved. See docs/BACKUP_AND_RESTORE.md#sync.
 */
import fs from 'node:fs';
import path from 'node:path';
import { mergeData, normalizeData, type MergeStats } from '../shared/snapshot';
import type { Snapshot } from '../shared/types';
import { buildSnapshot, parseBackupText, serialize, type AppInfo } from './backup';
import { writeFileAtomic } from './db';
import type { Repo } from './repo';

export const SYNC_FILE_RE = /^emi-tracker-sync-([A-Za-z0-9-]+)\.(json|emisync)$/;

export interface SyncPeerResult { file: string; deviceName: string; createdAt: string | null; ok: boolean; message: string; stats?: MergeStats }
export interface SyncReport { at: string; folder: string; peers: SyncPeerResult[]; wrote: string; totals: MergeStats }

export function syncFileName(deviceId: string, encrypted: boolean): string {
  return `emi-tracker-sync-${deviceId}.${encrypted ? 'emisync' : 'json'}`;
}

export function syncNow(repo: Repo, folder: string, app: AppInfo, passphrase?: string): SyncReport {
  if (!folder || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw new Error('Sync folder is not available. Connect the drive or choose the folder again.');
  const local = repo.local();
  const totals: MergeStats = { added: 0, updated: 0, deleted: 0, unchanged: 0, preferencesUpdated: false };
  const peers: SyncPeerResult[] = [];
  let merged = normalizeData(repo.snapshotData());
  let changed = false;

  for (const file of fs.readdirSync(folder).sort()) {
    const m = SYNC_FILE_RE.exec(file);
    if (!m || m[1] === local.deviceId) continue;
    try {
      const snap = parseBackupText(fs.readFileSync(path.join(folder, file), 'utf8'), passphrase);
      if (snap.kind !== 'sync') throw new Error('Not a sync file');
      const { data, stats } = mergeData(merged, snap.data);
      merged = data;
      totals.added += stats.added; totals.updated += stats.updated; totals.deleted += stats.deleted; totals.unchanged += stats.unchanged;
      totals.preferencesUpdated ||= stats.preferencesUpdated;
      if (stats.added || stats.updated || stats.deleted || stats.preferencesUpdated) changed = true;
      peers.push({ file, deviceName: snap.deviceName, createdAt: snap.createdAt, ok: true, message: 'Merged', stats });
    } catch (e) {
      peers.push({ file, deviceName: '', createdAt: null, ok: false, message: (e as Error).message });
    }
  }
  if (changed) {
    repo.applyMerged(merged);
    repo.addAudit('sync', null, 'merge', `Synced from ${peers.filter((p) => p.ok).length} device(s): +${totals.added} new, ${totals.updated} updated, ${totals.deleted} deleted`, null, null);
  }
  const out = path.join(folder, syncFileName(local.deviceId, !!passphrase));
  // remove this device's file in the other encoding so peers do not read a stale copy
  const other = path.join(folder, syncFileName(local.deviceId, !passphrase));
  if (fs.existsSync(other)) fs.unlinkSync(other);
  writeFileAtomic(out, serialize(buildSnapshot(repo, 'sync', app), passphrase));
  const at = new Date().toISOString();
  const failed = peers.filter((p) => !p.ok).length;
  repo.setLocal({ lastSyncAt: at, lastSyncResult: failed ? `${failed} device file(s) could not be read` : `OK — ${peers.length} other device(s)` });
  return { at, folder, peers, wrote: out, totals };
}

/** Merges one device's snapshot into the local database (used by Wi-Fi sync). */
export function mergeRemote(repo: Repo, snap: Snapshot, source: string): MergeStats {
  const { data, stats } = mergeData(normalizeData(repo.snapshotData()), snap.data);
  if (stats.added || stats.updated || stats.deleted || stats.preferencesUpdated) {
    repo.applyMerged(data);
    repo.addAudit('sync', null, 'merge', `Wi-Fi sync with ${source}: +${stats.added} new, ${stats.updated} updated, ${stats.deleted} deleted`, null, null);
  }
  return stats;
}
