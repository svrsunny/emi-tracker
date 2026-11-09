/**
 * Backup, validation, encryption and restore. Format: docs/BACKUP_AND_RESTORE.md.
 *
 * - Plain backup: JSON snapshot with a SHA-256 checksum of the canonical, id-sorted data.
 * - Encrypted backup: the snapshot JSON encrypted with AES-256-GCM; key from the user's
 *   passphrase via PBKDF2-HMAC-SHA256 (210,000 iterations, random 16-byte salt). The
 *   passphrase is never stored. Android uses the identical algorithm and parameters.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson, countRecords, normalizeData } from '../shared/snapshot';
import {
  ENCRYPTED_FORMAT, SNAPSHOT_FORMAT, SNAPSHOT_FORMAT_VERSION, type EncryptedEnvelope, type Snapshot, type SnapshotData,
} from '../shared/types';
import { snapshotSchema } from '../shared/validation';
import { SCHEMA_VERSION, writeFileAtomic } from './db';
import type { Repo } from './repo';

export const PBKDF2_ITERATIONS = 210_000;

export interface AppInfo { name: string; version: string; platform: 'desktop' | 'android' }

export type BackupErrorCode =
  | 'needs_passphrase' | 'bad_passphrase' | 'not_a_backup' | 'corrupt' | 'unsupported_version' | 'checksum_mismatch' | 'invalid';

export class BackupError extends Error {
  constructor(public readonly code: BackupErrorCode, message: string) { super(message); }
}

export function checksumOf(data: SnapshotData): string {
  return crypto.createHash('sha256').update(canonicalJson(normalizeData(data)), 'utf8').digest('hex');
}

export function buildSnapshot(repo: Repo, kind: Snapshot['kind'], app: AppInfo): Snapshot {
  const data = normalizeData(repo.snapshotData());
  const local = repo.local();
  return {
    format: SNAPSHOT_FORMAT, formatVersion: SNAPSHOT_FORMAT_VERSION, schemaVersion: SCHEMA_VERSION, kind,
    createdAt: new Date().toISOString(), app, deviceId: local.deviceId, deviceName: local.deviceName,
    counts: countRecords(data), checksum: checksumOf(data), data,
  };
}

export function encrypt(plaintext: string, passphrase: string, kind: Snapshot['kind']): EncryptedEnvelope {
  if (passphrase.length < 8) throw new BackupError('invalid', 'Passphrase must be at least 8 characters');
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return {
    format: ENCRYPTED_FORMAT, formatVersion: 1, kdf: 'PBKDF2-HMAC-SHA256', iterations: PBKDF2_ITERATIONS,
    salt: salt.toString('base64'), iv: iv.toString('base64'), cipher: 'AES-256-GCM', ciphertext: ct.toString('base64'),
    createdAt: new Date().toISOString(), kind,
  };
}

export function decrypt(env: EncryptedEnvelope, passphrase: string): string {
  const key = crypto.pbkdf2Sync(passphrase, Buffer.from(env.salt, 'base64'), env.iterations, 32, 'sha256');
  const all = Buffer.from(env.ciphertext, 'base64');
  if (all.length < 17) throw new BackupError('corrupt', 'Encrypted backup is truncated');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(env.iv, 'base64'));
  decipher.setAuthTag(all.subarray(all.length - 16));
  try {
    return Buffer.concat([decipher.update(all.subarray(0, all.length - 16)), decipher.final()]).toString('utf8');
  } catch {
    throw new BackupError('bad_passphrase', 'Wrong passphrase, or the encrypted file was modified');
  }
}

export function serialize(s: Snapshot, passphrase?: string): string {
  const json = JSON.stringify(s, null, 1);
  return passphrase ? JSON.stringify(encrypt(json, passphrase, s.kind), null, 1) : json;
}

/** Upgrade older snapshot format versions to the current one. */
export function migrateSnapshot(obj: Record<string, unknown>): Record<string, unknown> {
  const v = Number(obj.formatVersion);
  if (!Number.isInteger(v) || v < 1) throw new BackupError('invalid', 'Missing format version');
  if (v > SNAPSHOT_FORMAT_VERSION) throw new BackupError('unsupported_version', `Backup format v${v} is newer than this app supports (v${SNAPSHOT_FORMAT_VERSION}). Update the app first.`);
  // v1 is current; future migrations go here in order (v1 -> v2 -> ...).
  return obj;
}

export function isEncryptedText(text: string): boolean {
  try { return (JSON.parse(text) as { format?: string }).format === ENCRYPTED_FORMAT; } catch { return false; }
}

/** Parse, decrypt, migrate and fully validate a backup file's text. */
export function parseBackupText(text: string, passphrase?: string): Snapshot {
  let obj: Record<string, unknown>;
  try { obj = JSON.parse(text); } catch { throw new BackupError('corrupt', 'File is not valid JSON — it may be truncated or corrupted'); }
  if (obj?.format === ENCRYPTED_FORMAT) {
    if (!passphrase) throw new BackupError('needs_passphrase', 'This backup is encrypted. Enter its passphrase.');
    const env = obj as unknown as EncryptedEnvelope;
    if (env.formatVersion !== 1 || env.cipher !== 'AES-256-GCM') throw new BackupError('unsupported_version', 'Unsupported encryption format');
    const inner = decrypt(env, passphrase);
    try { obj = JSON.parse(inner); } catch { throw new BackupError('corrupt', 'Decrypted content is not valid JSON'); }
  }
  if (obj?.format !== SNAPSHOT_FORMAT) throw new BackupError('not_a_backup', 'This file is not an EMI Tracker backup');
  obj = migrateSnapshot(obj);
  const r = snapshotSchema.safeParse(obj);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new BackupError('invalid', `Backup failed validation at ${i?.path.join('.')}: ${i?.message}`);
  }
  const snap = r.data as Snapshot;
  // verify against the file's own data, independent of how this app models it
  if (checksumOf((obj as { data: SnapshotData }).data) !== snap.checksum) throw new BackupError('checksum_mismatch', 'Checksum mismatch — the backup was modified or is corrupted');
  // referential integrity inside the backup
  const loanIds = new Set(snap.data.loans.map((l) => l.id));
  const orphan = [...snap.data.payments, ...snap.data.adjustments].find((x) => !loanIds.has(x.loanId));
  if (orphan) throw new BackupError('invalid', 'Backup contains records that reference a missing loan');
  return snap;
}

export function backupFileName(label: string, encrypted: boolean, at = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
  return `emi-tracker-${label}-${stamp}${encrypted ? '.emibackup' : '.json'}`;
}

export interface BackupResult { path: string; size: number; checksum: string; counts: Record<string, number>; encrypted: boolean }

/** Write a backup and verify it by reading it back. */
export function writeBackup(repo: Repo, dir: string, app: AppInfo, opts: { kind?: Snapshot['kind']; label?: string; passphrase?: string } = {}): BackupResult {
  const kind = opts.kind ?? 'backup';
  const snap = buildSnapshot(repo, kind, app);
  const text = serialize(snap, opts.passphrase);
  fs.mkdirSync(dir, { recursive: true });
  let file = path.join(dir, backupFileName(opts.label ?? kind, !!opts.passphrase));
  for (let n = 1; fs.existsSync(file); n++) file = file.replace(/(\.\w+)$/, `-${n}$1`);
  try {
    writeFileAtomic(file, text);
    const verify = parseBackupText(fs.readFileSync(file, 'utf8'), opts.passphrase);
    if (verify.checksum !== snap.checksum) throw new BackupError('checksum_mismatch', 'Verification after writing failed');
  } catch (e) {
    repo.addBackupHistory({ kind: opts.label ?? kind, path: file, size: 0, encrypted: !!opts.passphrase, checksum: snap.checksum, counts: snap.counts, ok: false, message: (e as Error).message });
    throw e;
  }
  const size = fs.statSync(file).size;
  repo.addBackupHistory({ kind: opts.label ?? kind, path: file, size, encrypted: !!opts.passphrase, checksum: snap.checksum, counts: snap.counts, ok: true, message: 'Verified' });
  if (kind === 'backup') repo.setLocal({ lastBackupAt: new Date().toISOString() });
  repo.addAudit('backup', null, 'create', `Created ${opts.passphrase ? 'encrypted ' : ''}${kind} (${snap.counts.loans} loans, ${snap.counts.payments} payments)`, null, null);
  return { path: file, size, checksum: snap.checksum, counts: snap.counts, encrypted: !!opts.passphrase };
}

/** Delete old automatic backups beyond `keep` (only automatic files this app created in `dir`). */
export function pruneBackups(dir: string, keep: number): number {
  if (!fs.existsSync(dir)) return 0;
  const files = fs.readdirSync(dir).filter((f) => /^emi-tracker-auto-\d{8}-\d{6}(-\d+)?\.(json|emibackup)$/.test(f)).sort().reverse();
  let removed = 0;
  for (const f of files.slice(Math.max(1, keep))) {
    fs.unlinkSync(path.join(dir, f));
    removed++;
  }
  return removed;
}

export interface RestorePreview {
  createdAt: string;
  kind: string;
  app: AppInfo;
  deviceName: string;
  schemaVersion: number;
  formatVersion: number;
  counts: Record<string, number>;
  current: Record<string, number>;
  encrypted: boolean;
  checksum: string;
}

export function previewRestore(repo: Repo, text: string, passphrase?: string): RestorePreview {
  const s = parseBackupText(text, passphrase);
  return {
    createdAt: s.createdAt, kind: s.kind, app: s.app, deviceName: s.deviceName, schemaVersion: s.schemaVersion,
    formatVersion: s.formatVersion, counts: s.counts, current: repo.counts(), encrypted: isEncryptedText(text), checksum: s.checksum,
  };
}

export interface RestoreReport {
  restored: Record<string, number>;
  recoveryBackup: string;
  checksumVerified: boolean;
  integrity: { ok: boolean; message: string; foreignKeyErrors: number };
}

/**
 * Destructive restore: validate, take a recovery backup, replace data in one transaction,
 * then verify record counts, checksum and database integrity. Any failure rolls back to the
 * pre-restore state.
 */
export function restore(repo: Repo, text: string, recoveryDir: string, app: AppInfo, passphrase?: string): RestoreReport {
  const snap = parseBackupText(text, passphrase);
  const recovery = writeBackup(repo, recoveryDir, app, { kind: 'recovery' });
  const previous = repo.snapshotData();
  try {
    repo.replaceAll(snap.data);
    const after = normalizeData(repo.snapshotData());
    const counts = countRecords(after);
    const sameCounts = Object.entries(snap.counts).every(([k, v]) => counts[k] === v);
    const verified = checksumOf(after) === snap.checksum;
    const integrity = repo.db.integrity();
    if (!sameCounts || !verified || !integrity.ok) throw new Error('Post-restore verification failed');
    repo.addAudit('backup', null, 'restore', `Restored backup from ${snap.createdAt} (${counts.loans} loans, ${counts.payments} payments). Recovery backup: ${path.basename(recovery.path)}`, null, null);
    return { restored: counts, recoveryBackup: recovery.path, checksumVerified: verified, integrity };
  } catch (e) {
    repo.replaceAll(previous);
    throw new BackupError('invalid', `Restore failed and was rolled back: ${(e as Error).message}`);
  }
}
