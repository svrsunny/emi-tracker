import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { BackupError, parseBackupText, pruneBackups, restore, serialize, buildSnapshot, writeBackup } from '../../src/main/backup';
import { Db, MIGRATIONS, SCHEMA_VERSION } from '../../src/main/db';
import { ConflictError, Repo, ValidationError } from '../../src/main/repo';
import { syncNow } from '../../src/main/sync';
import { computeLoan } from '../../src/shared/engine';
import { mergeData, normalizeData } from '../../src/shared/snapshot';
import { DEFAULT_PREFERENCES } from '../../src/shared/defaults';
import { makeLoan, pay } from './fixtures';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'emi-test-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const app = { name: 'EMI Tracker', version: 'test', platform: 'desktop' as const };

async function seeded(deviceId = 'dev-a') {
  const repo = new Repo(await Db.open(null), () => deviceId);
  repo.setLocal({ deviceId, deviceName: deviceId });
  const loan = repo.saveLoan(makeLoan({ id: 'L1' }));
  repo.saveLoan(makeLoan({ id: 'L2', name: 'Second', principal: '50000.00' }));
  repo.savePayment(pay({ id: 'p1', loanId: 'L1', installmentNo: 1, txnDate: '2024-02-01', amount: '8884.88' }));
  repo.savePayment(pay({ id: 'p2', loanId: 'L1', installmentNo: 2, txnDate: '2024-03-01', amount: '8884.88' }));
  repo.savePayment(pay({ id: 'p3', loanId: 'L1', type: 'prepayment', txnDate: '2024-03-05', amount: '10000.00' }));
  repo.saveCustomReminder({ id: 'r1', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '', title: 'Check statement', description: '', date: '2024-04-01', time: '09:00', repeat: 'monthly', loanId: 'L1', enabled: true });
  repo.setPreferences({ ...DEFAULT_PREFERENCES, accent: '#34c38f', heatmapPalette: 'violet' });
  return { repo, loan };
}

describe('database and migrations', () => {
  it('creates the latest schema with foreign keys', async () => {
    const db = await Db.open(null);
    expect(db.version()).toBe(SCHEMA_VERSION);
    expect(() => db.run("INSERT INTO payments (id, loan_id, txn_date, type, amount, status, updated_at, data) VALUES ('x','missing','2024-01-01','emi','1','active','t','{}')")).toThrow();
  });

  it('migrates a v1 database to the latest version, keeping data', async () => {
    const file = path.join(tmp, 'v1.sqlite');
    const { loadSqlJs } = await import('../../src/main/db');
    const SQL = await loadSqlJs();
    const raw = new SQL.Database();
    raw.run('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
    raw.exec(MIGRATIONS[0].up);
    raw.run("INSERT INTO schema_migrations VALUES (1, 'core tables', '2024-01-01')");
    const l = makeLoan({ id: 'OLD' });
    raw.run('INSERT INTO loans (id, name, status, updated_at, data) VALUES (?, ?, ?, ?, ?)', [l.id, l.name, l.status, l.updatedAt, JSON.stringify(l)]);
    fs.writeFileSync(file, raw.export());
    let migratedFrom = -1;
    const db = await Db.open(file, undefined, (v) => { migratedFrom = v; });
    expect(migratedFrom).toBe(1);
    expect(db.version()).toBe(SCHEMA_VERSION);
    expect(new Repo(db).loans()[0].id).toBe('OLD');
    expect(db.all("SELECT name FROM sqlite_master WHERE name = 'tombstones'")).toHaveLength(1);
  });

  it('persists atomically to disk and reloads', async () => {
    const file = path.join(tmp, 'persist.sqlite');
    const repo = new Repo(await Db.open(file));
    repo.saveLoan(makeLoan({ id: 'P1', name: 'Persisted' }));
    const again = new Repo(await Db.open(file));
    expect(again.loans().map((l) => l.name)).toEqual(['Persisted']);
    expect(fs.readdirSync(tmp).some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  it('rolls back a failed transaction', async () => {
    const { repo } = await seeded();
    expect(() => repo.db.tx(() => {
      repo.db.run("UPDATE loans SET name = 'changed' WHERE id = 'L1'");
      throw new Error('boom');
    })).toThrow('boom');
    expect(repo.loan('L1')!.name).toBe('Test loan');
  });
});

describe('input validation and integrity', () => {
  it('rejects invalid loans', async () => {
    const { repo } = await seeded();
    expect(() => repo.saveLoan(makeLoan({ id: 'bad', principal: '-5' }))).toThrow(ValidationError);
    expect(() => repo.saveLoan(makeLoan({ id: 'bad', firstEmiDate: '2023-12-01' }))).toThrow(/First EMI/);
    expect(() => repo.saveLoan(makeLoan({ id: 'bad', annualRate: 'abc' }))).toThrow(ValidationError);
    expect(() => repo.saveLoan(makeLoan({ id: 'bad', startDate: '2024-02-30' }))).toThrow(ValidationError);
  });
  it('rejects invalid payments and allocation overflow', async () => {
    const { repo } = await seeded();
    expect(() => repo.savePayment(pay({ loanId: 'L1', type: 'emi', installmentNo: null, amount: '100' }))).toThrow(/installment/);
    expect(() => repo.savePayment(pay({ loanId: 'L1', installmentNo: 3, amount: '100', manualAllocation: true, allocPrincipal: '90', allocInterest: '20' }))).toThrow(/exceeds/);
    expect(() => repo.savePayment(pay({ loanId: 'nope', installmentNo: 3, amount: '100' }))).toThrow(/Loan not found/);
  });
  it('prevents accidental duplicate payments unless confirmed', async () => {
    const { repo } = await seeded();
    const dup = pay({ loanId: 'L1', installmentNo: 1, txnDate: '2024-02-01', amount: '8884.88' });
    expect(() => repo.savePayment(dup)).toThrow(ConflictError);
    expect(repo.savePayment(dup, { allowDuplicate: true }).id).toBe(dup.id);
  });
  it('reverses instead of deleting payment history, with audit trail', async () => {
    const { repo } = await seeded();
    repo.reversePayment('p1', 'Entered twice');
    expect(repo.payment('p1')!.status).toBe('reversed');
    expect(repo.payments()).toHaveLength(3);
    expect(repo.audit(10, 'p1').map((a) => a.action)).toEqual(['reverse', 'create']);
    expect(() => repo.savePayment({ ...repo.payment('p1')!, amount: '1.00' })).toThrow(/reversed/);
  });
  it('permanent loan deletion requires the exact name and leaves tombstones', async () => {
    const { repo } = await seeded();
    expect(() => repo.deleteLoanPermanently('L1', 'wrong')).toThrow(/exactly/);
    repo.deleteLoanPermanently('L1', 'Test loan');
    expect(repo.loan('L1')).toBeUndefined();
    expect(repo.tombstones().filter((t) => t.table === 'payments')).toHaveLength(3);
  });
  it('audit summaries never contain amounts of other fields beyond the action', async () => {
    const { repo } = await seeded();
    repo.saveLoan({ ...repo.loan('L1')!, accountRef: '123456789012' });
    const a = repo.audit(1)[0];
    expect(a.summary).toContain('accountRef');
    expect(a.summary).not.toContain('123456789012');
  });
});

describe('backup and restore', () => {
  it('round-trips into a clean database with identical records and balances', async () => {
    const { repo } = await seeded();
    const res = writeBackup(repo, path.join(tmp, 'b1'), app);
    expect(res.counts.loans).toBe(2);
    expect(repo.local().lastBackupAt).not.toBeNull();

    const clean = new Repo(await Db.open(null));
    const report = restore(clean, fs.readFileSync(res.path, 'utf8'), path.join(tmp, 'rec1'), app);
    expect(report.checksumVerified).toBe(true);
    expect(report.integrity.ok).toBe(true);
    expect(report.restored.payments).toBe(3);
    expect(clean.preferences().value.heatmapPalette).toBe('violet');
    expect(clean.customReminders()[0].title).toBe('Check statement');
    const bal = (r: Repo) => computeLoan(r.loan('L1')!, r.adjustments(), r.payments(), '2024-03-10').summary;
    expect(bal(clean)).toEqual(bal(repo));
    expect(fs.existsSync(report.recoveryBackup)).toBe(true);
  });

  it('encrypted backups need the right passphrase', async () => {
    const { repo } = await seeded();
    const res = writeBackup(repo, path.join(tmp, 'b2'), app, { passphrase: 'correct horse battery' });
    const text = fs.readFileSync(res.path, 'utf8');
    expect(text).not.toContain('Test loan');
    expect(() => parseBackupText(text)).toThrow(expect.objectContaining({ code: 'needs_passphrase' }));
    expect(() => parseBackupText(text, 'wrong passphrase')).toThrow(expect.objectContaining({ code: 'bad_passphrase' }));
    expect(parseBackupText(text, 'correct horse battery').counts.payments).toBe(3);
  });

  it('rejects corrupted, tampered, foreign and future-version files', async () => {
    const { repo } = await seeded();
    const good = serialize(buildSnapshot(repo, 'backup', app));
    expect(() => parseBackupText(good.slice(0, good.length / 2))).toThrow(expect.objectContaining({ code: 'corrupt' }));
    expect(() => parseBackupText(good.replace('8884.88', '9999.99'))).toThrow(expect.objectContaining({ code: 'checksum_mismatch' }));
    expect(() => parseBackupText('{"hello":1}')).toThrow(expect.objectContaining({ code: 'not_a_backup' }));
    const future = JSON.parse(good); future.formatVersion = 99;
    expect(() => parseBackupText(JSON.stringify(future))).toThrow(expect.objectContaining({ code: 'unsupported_version' }));
  });

  it('a failed restore leaves current data untouched', async () => {
    const { repo } = await seeded();
    const before = normalizeData(repo.snapshotData());
    expect(() => restore(repo, '{"format":"emi-tracker-snapshot","formatVersion":1}', path.join(tmp, 'rec2'), app)).toThrow(BackupError);
    expect(normalizeData(repo.snapshotData()).payments).toEqual(before.payments);
  });

  it('prunes old automatic backups only', () => {
    const dir = path.join(tmp, 'prune');
    fs.mkdirSync(dir);
    for (let i = 1; i <= 5; i++) fs.writeFileSync(path.join(dir, `emi-tracker-auto-2024010${i}-120000.json`), '{}');
    fs.writeFileSync(path.join(dir, 'my-notes.json'), '{}');
    fs.writeFileSync(path.join(dir, 'emi-tracker-backup-20240101-120000.json'), '{}');
    expect(pruneBackups(dir, 3)).toBe(2);
    expect(fs.readdirSync(dir)).toContain('my-notes.json');
    expect(fs.readdirSync(dir)).toContain('emi-tracker-backup-20240101-120000.json');
  });
});

describe('sync merge', () => {
  it('merges edits from two devices, last writer wins, deletions propagate', async () => {
    const a = await seeded('dev-a');
    const b = new Repo(await Db.open(null), () => 'dev-b');
    b.setLocal({ deviceId: 'dev-b', deviceName: 'Phone' });
    const folder = path.join(tmp, 'syncdir');
    fs.mkdirSync(folder);

    syncNow(a.repo, folder, app);
    const first = syncNow(b, folder, { ...app, platform: 'android' });
    expect(first.totals.added).toBeGreaterThan(0);
    expect(b.loans()).toHaveLength(2);

    // concurrent edits: B renames L2 later than A records a payment
    a.repo.savePayment(pay({ id: 'p4', loanId: 'L1', installmentNo: 3, txnDate: '2024-04-01', amount: '8884.88' }));
    await new Promise((r) => setTimeout(r, 5));
    b.saveLoan({ ...b.loan('L2')!, name: 'Renamed on phone' });
    b.deleteCustomReminder('r1');
    syncNow(a.repo, folder, app);
    syncNow(b, folder, app);
    syncNow(a.repo, folder, app);

    for (const r of [a.repo, b]) {
      expect(r.loan('L2')!.name).toBe('Renamed on phone');
      expect(r.payment('p4')).toBeDefined();
      expect(r.customReminders()).toHaveLength(0);
    }
    const strip = (r: Repo) => { const d = normalizeData(r.snapshotData()); return { ...d, audit: [], notifications: [] }; };
    expect(strip(a.repo).payments).toEqual(strip(b).payments);
    expect(strip(a.repo).loans).toEqual(strip(b).loans);
  });

  it('merge is commutative and idempotent', async () => {
    const a = (await seeded('x')).repo.snapshotData();
    const bRepo = (await seeded("y")).repo;
    bRepo.saveLoan({ ...bRepo.loan('L1')!, name: 'Other name' });
    const b = bRepo.snapshotData();
    const ab = normalizeData(mergeData(a, b).data);
    const ba = normalizeData(mergeData(b, a).data);
    expect(ab.loans).toEqual(ba.loans);
    expect(normalizeData(mergeData(ab, b).data).loans).toEqual(ab.loans);
  });
});
