/**
 * SQLite storage via sql.js (SQLite compiled to WebAssembly — no native modules).
 *
 * The database lives in memory and is persisted to a single file after every committed
 * transaction using write-to-temp + fsync + atomic rename, so a crash mid-write never leaves a
 * torn database. Each record is stored with indexed key columns plus its full JSON document;
 * foreign keys enforce that payments and adjustments always reference an existing loan.
 */
import fs from 'node:fs';
import path from 'node:path';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';

export const SCHEMA_VERSION = 4;

interface Migration { version: number; name: string; up: string }

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'core tables',
    up: `
      CREATE TABLE loans (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE adjustments (id TEXT PRIMARY KEY, loan_id TEXT NOT NULL REFERENCES loans(id) ON DELETE RESTRICT,
        effective_date TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE payments (id TEXT PRIMARY KEY, loan_id TEXT NOT NULL REFERENCES loans(id) ON DELETE RESTRICT,
        txn_date TEXT NOT NULL, installment_no INTEGER, type TEXT NOT NULL, amount TEXT NOT NULL, status TEXT NOT NULL,
        updated_at TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX idx_payments_loan ON payments(loan_id, txn_date);
      CREATE TABLE custom_reminders (id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE notifications (id TEXT PRIMARY KEY, key TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX idx_notifications_key ON notifications(key);
      CREATE TABLE audit (id TEXT PRIMARY KEY, at TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT, data TEXT NOT NULL);
      CREATE INDEX idx_audit_at ON audit(at);
      CREATE TABLE categories (id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
    `,
  },
  {
    version: 2,
    name: 'sync support: tombstones and backup history',
    up: `
      CREATE TABLE tombstones (id TEXT NOT NULL, tbl TEXT NOT NULL, deleted_at TEXT NOT NULL, PRIMARY KEY (tbl, id));
      CREATE TABLE backup_history (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, kind TEXT NOT NULL, path TEXT NOT NULL,
        size INTEGER NOT NULL, encrypted INTEGER NOT NULL, checksum TEXT NOT NULL, counts TEXT NOT NULL, ok INTEGER NOT NULL, message TEXT NOT NULL);
    `,
  },
  {
    version: 3,
    name: 'recurring bills',
    up: `
      CREATE TABLE bills (id TEXT PRIMARY KEY, name TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE bill_payments (id TEXT PRIMARY KEY, bill_id TEXT NOT NULL REFERENCES bills(id) ON DELETE RESTRICT,
        due_date TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX idx_bill_payments_bill ON bill_payments(bill_id, due_date);
    `,
  },
  {
    version: 4,
    name: 'lending and borrowing',
    up: `
      CREATE TABLE debts (id TEXT PRIMARY KEY, person TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE debt_repayments (id TEXT PRIMARY KEY, debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE RESTRICT,
        date TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX idx_debt_repayments_debt ON debt_repayments(debt_id, date);
    `,
  },
];

let SQL: SqlJsStatic | null = null;

export async function loadSqlJs(wasmPath?: string): Promise<SqlJsStatic> {
  if (!SQL) {
    SQL = await initSqlJs(wasmPath ? { locateFile: () => wasmPath } : undefined);
  }
  return SQL;
}

export type Row = Record<string, string | number | null | Uint8Array>;

export class Db {
  private inTx = false;

  private constructor(public readonly db: Database, public readonly file: string | null) {}

  /** Open (or create) a database file. `file = null` gives a transient in-memory database. */
  static async open(file: string | null, wasmPath?: string, onBeforeMigrate?: (fromVersion: number) => void): Promise<Db> {
    const SQL = await loadSqlJs(wasmPath);
    let db: Database;
    if (file && fs.existsSync(file)) {
      db = new SQL.Database(fs.readFileSync(file));
      const check = db.exec('PRAGMA integrity_check')[0]?.values?.[0]?.[0];
      if (check !== 'ok') throw new Error('Database integrity check failed');
    } else {
      db = new SQL.Database();
    }
    db.run('PRAGMA foreign_keys = ON');
    const d = new Db(db, file);
    const from = d.version();
    if (from < SCHEMA_VERSION && from > 0 && onBeforeMigrate) onBeforeMigrate(from);
    d.migrate();
    return d;
  }

  static async fromBytes(bytes: Uint8Array, wasmPath?: string): Promise<Db> {
    const SQL = await loadSqlJs(wasmPath);
    const db = new SQL.Database(bytes);
    db.run('PRAGMA foreign_keys = ON');
    const d = new Db(db, null);
    d.migrate();
    return d;
  }

  version(): number {
    const has = this.all("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'");
    if (!has.length) return 0;
    const r = this.get('SELECT MAX(version) AS v FROM schema_migrations');
    return Number(r?.v ?? 0);
  }

  private migrate(): void {
    this.db.run('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
    const current = this.version();
    const pending = MIGRATIONS.filter((m) => m.version > current);
    if (!pending.length) return;
    this.tx(() => {
      for (const m of pending) {
        this.db.exec(m.up);
        this.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [m.version, m.name, new Date().toISOString()]);
      }
    });
  }

  all(sql: string, params: (string | number | null)[] = []): Row[] {
    const st = this.db.prepare(sql);
    try {
      st.bind(params);
      const out: Row[] = [];
      while (st.step()) out.push(st.getAsObject() as Row);
      return out;
    } finally {
      st.free();
    }
  }

  get(sql: string, params: (string | number | null)[] = []): Row | undefined {
    return this.all(sql, params)[0];
  }

  run(sql: string, params: (string | number | null)[] = []): void {
    this.db.run(sql, params);
  }

  /** Run `fn` atomically; persist on commit, roll back on any error. Nested calls join. */
  tx<T>(fn: () => T): T {
    if (this.inTx) return fn();
    this.inTx = true;
    this.db.run('BEGIN');
    try {
      const result = fn();
      this.db.run('COMMIT');
      this.inTx = false;
      this.persist();
      return result;
    } catch (e) {
      try { this.db.run('ROLLBACK'); } catch { /* already rolled back */ }
      this.inTx = false;
      throw e;
    }
  }

  export(): Uint8Array {
    return this.db.export();
  }

  persist(): void {
    if (!this.file) return;
    writeFileAtomic(this.file, this.db.export());
  }

  integrity(): { ok: boolean; message: string; foreignKeyErrors: number } {
    const msg = String(this.db.exec('PRAGMA integrity_check')[0]?.values?.[0]?.[0] ?? 'unknown');
    const fk = this.db.exec('PRAGMA foreign_key_check')[0]?.values?.length ?? 0;
    return { ok: msg === 'ok' && fk === 0, message: msg, foreignKeyErrors: fk };
  }

  close(): void {
    this.db.close();
  }
}

export function writeFileAtomic(file: string, data: Uint8Array | string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, typeof data === 'string' ? Buffer.from(data, 'utf8') : data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}
