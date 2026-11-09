/**
 * The IPC surface. Only these channels exist; every payload is validated with zod before it
 * reaches the repository. File system access is limited to user-chosen paths (via native
 * dialogs) and the app's own data / attachment directories.
 */
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Notification, safeStorage, shell, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { demoData, newId } from '../shared/defaults';
import { computeLoan } from '../shared/engine';
import { wallTime } from '../shared/reminders';
import {
  adjustmentSchema, billPaymentSchema, billSchema, categorySchema, debtRepaymentSchema, debtSchema, customReminderSchema, firstError, loanSchema, paymentSchema, preferencesSchema,
} from '../shared/validation';
import type { NotificationRecord } from '../shared/types';
import { BackupError, buildSnapshot, isEncryptedText, previewRestore, restore, serialize, writeBackup } from './backup';
import { applyLanSettings, cancelPairing, lanStatus, openPairing, removePeer, requestPhoneSync } from './lan';
import { lockNow, lockSettingsSchema, lockStatus, isLocked, setLockSettings, unlockWithHello, unlockWithSecret } from './lock';
import { recentLog } from './log';
import { printDoc, renderPdf } from './pdf';
import { printDocSchema } from '../shared/print';
import { appInfo, broadcast, getSyncSecret, paths, runBackgroundTick, setSyncSecret, state } from './main';
import { ConflictError, ValidationError, type LocalSettings, type Repo } from './repo';
import { snoozeUntil } from '../shared/reminders';
import { syncNow } from './sync';

const MAX_FILE = 50 * 1024 * 1024;

type Handler = (payload: unknown, e: IpcMainInvokeEvent) => unknown | Promise<unknown>;
export type IpcResult = { ok: true; value: unknown } | { ok: false; error: string; code?: string };

function repo(): Repo {
  if (!state.repo) throw new Error('Database not ready');
  return state.repo;
}

function handle(channel: string, fn: Handler): void {
  ipcMain.handle(channel, async (e, payload): Promise<IpcResult> => {
    if (!isTrustedSender(e)) return { ok: false, error: 'Untrusted sender' };
    // while the app is locked only the unlock channels answer
    if (isLocked() && !LOCK_CHANNELS.has(channel)) return { ok: false, error: 'EMI Tracker is locked', code: 'locked' };
    try {
      return { ok: true, value: await fn(payload, e) };
    } catch (err) {
      if (err instanceof z.ZodError) return { ok: false, error: firstError(err), code: 'validation' };
      if (err instanceof ValidationError) return { ok: false, error: err.message, code: 'validation' };
      if (err instanceof ConflictError) return { ok: false, error: err.message, code: err.code };
      if (err instanceof BackupError) return { ok: false, error: err.message, code: err.code };
      return { ok: false, error: (err as Error).message || 'Unexpected error' };
    }
  });
}

function isTrustedSender(e: IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? '';
  return url.startsWith('file:') || (!!process.env.VITE_DEV_SERVER_URL && url.startsWith(process.env.VITE_DEV_SERVER_URL));
}

const LOCK_CHANNELS = new Set(['lock:status', 'lock:unlock', 'lock:hello']);

const idOnly = z.object({ id: z.string().min(1).max(100) });
const pathPayload = z.object({ path: z.string().min(1).max(2000), passphrase: z.string().max(500).optional() });

const localPatch = z.object({
  deviceName: z.string().max(100), backupDir: z.string().max(2000), autoBackup: z.boolean(), autoBackupHours: z.number().int().min(1).max(24 * 30),
  backupKeep: z.number().int().min(1).max(500), minimizeToTray: z.boolean(), launchAtStartup: z.boolean(), startHidden: z.boolean(),
  syncEnabled: z.boolean(), syncFolder: z.string().max(2000), syncIntervalMinutes: z.number().int().min(5).max(24 * 60), syncEncrypted: z.boolean(),
  lanEnabled: z.boolean(), lanPort: z.number().int().min(1024).max(65535), onboardingDone: z.boolean(),
}).partial();

function window(e: IpcMainInvokeEvent): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(e.sender) ?? undefined;
}

function readUserFile(file: string): string {
  const st = fs.statSync(file);
  if (!st.isFile()) throw new ValidationError('Not a file');
  if (st.size > MAX_FILE) throw new ValidationError('File is larger than 50 MB');
  return fs.readFileSync(file, 'utf8');
}

function loadAll() {
  const r = repo();
  const local = r.local();
  return {
    loans: r.loans(), adjustments: r.adjustments(), payments: r.payments(), customReminders: r.customReminders(),
    notifications: r.notifications(1000), categories: r.categories(), bills: r.bills(), billPayments: r.billPayments(), debts: r.debts(), debtRepayments: r.debtRepayments(), preferences: r.preferences().value, local,
    syncPassphraseSaved: !!getSyncSecret(), backupHistory: r.backupHistory(50), app: appInfo(), paths: { data: paths().data, db: paths().db },
  };
}

export function registerIpc(): void {
  handle('data:load', () => loadAll());

  // ---- loans
  handle('loan:save', (p) => repo().saveLoan(loanSchema.parse(p) as never));
  handle('loan:status', (p) => {
    const { id, status } = z.object({ id: z.string(), status: z.enum(['active', 'closed', 'foreclosed', 'archived']) }).parse(p);
    return repo().setLoanStatus(id, status);
  });
  handle('loan:delete', (p) => {
    const { id, confirmName } = z.object({ id: z.string(), confirmName: z.string().max(200) }).parse(p);
    const r = repo();
    const loan = r.loan(id);
    if (!loan) throw new ValidationError('Loan not found');
    if (confirmName.trim() !== loan.name.trim()) throw new ValidationError('Type the loan name exactly to confirm deletion');
    const backup = writeBackup(r, paths().recovery, appInfo(), { kind: 'recovery', label: 'before-delete' });
    r.deleteLoanPermanently(id, confirmName);
    return { recoveryBackup: backup.path };
  });

  // ---- payments
  handle('payment:save', (p) => {
    const { payment, allowDuplicate } = z.object({ payment: paymentSchema, allowDuplicate: z.boolean().optional() }).parse(p);
    return repo().savePayment(payment as never, { allowDuplicate });
  });
  handle('payment:reverse', (p) => {
    const { id, reason } = z.object({ id: z.string(), reason: z.string().max(500) }).parse(p);
    return repo().reversePayment(id, reason);
  });

  // ---- adjustments, reminders, categories
  handle('adjustment:save', (p) => repo().saveAdjustment(adjustmentSchema.parse(p) as never));
  handle('adjustment:delete', (p) => repo().deleteAdjustment(idOnly.parse(p).id));
  handle('reminder:save', (p) => repo().saveCustomReminder(customReminderSchema.parse(p) as never));
  handle('reminder:delete', (p) => repo().deleteCustomReminder(idOnly.parse(p).id));

  // ---- bills
  handle('bill:save', (p) => repo().saveBill(billSchema.parse(p) as never));
  handle('bill:delete', (p) => repo().deleteBill(idOnly.parse(p).id));
  handle('billPayment:save', (p) => repo().saveBillPayment(billPaymentSchema.parse(p) as never));
  handle('billPayment:delete', (p) => repo().deleteBillPayment(idOnly.parse(p).id));

  // ---- lending & borrowing
  handle('debt:save', (p) => repo().saveDebt(debtSchema.parse(p) as never));
  handle('debt:delete', (p) => repo().deleteDebt(idOnly.parse(p).id));
  handle('debtRepayment:save', (p) => repo().saveDebtRepayment(debtRepaymentSchema.parse(p) as never));
  handle('debtRepayment:delete', (p) => repo().deleteDebtRepayment(idOnly.parse(p).id));
  handle('category:save', (p) => repo().saveCategory(categorySchema.parse(p)));
  handle('category:delete', (p) => repo().deleteCategory(idOnly.parse(p).id));

  // ---- settings
  handle('prefs:set', (p) => {
    const prefs = repo().setPreferences(preferencesSchema.parse(p) as never);
    for (const w of BrowserWindow.getAllWindows()) {
      const dark = prefs.theme !== 'light';
      try { w.setTitleBarOverlay({ color: dark ? '#0b0f17' : '#f5f7fb', symbolColor: dark ? '#c9d2e3' : '#2b3445', height: 40 }); } catch { /* not supported */ }
    }
    return prefs;
  });
  handle('local:set', async (p) => {
    const patch = localPatch.parse(p) as Partial<LocalSettings>;
    if (patch.launchAtStartup !== undefined && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: patch.launchAtStartup, args: ['--hidden'] });
    }
    const next = repo().setLocal(patch);
    if (patch.lanEnabled !== undefined || patch.lanPort !== undefined) await applyLanSettings();
    return next;
  });

  // ---- app lock
  handle('lock:status', () => lockStatus());
  handle('lock:unlock', (p) => unlockWithSecret(z.object({ secret: z.string().max(128) }).parse(p).secret));
  handle('lock:hello', () => unlockWithHello());
  handle('lock:set', (p) => setLockSettings(lockSettingsSchema.parse(p)));
  handle('lock:now', () => { lockNow(); return true; });

  // ---- Wi-Fi sync (paired phones)
  handle('lan:status', () => lanStatus());
  handle('lan:pair', () => openPairing());
  handle('lan:cancelPair', () => { cancelPairing(); return lanStatus(); });
  handle('lan:removePeer', (p) => {
    const { deviceId } = z.object({ deviceId: z.string().max(64) }).parse(p);
    removePeer(deviceId);
    repo().addAudit('sync', null, 'unpair', 'Removed a paired phone from Wi-Fi sync', null, null);
    return lanStatus();
  });
  handle('audit:list', (p) => {
    const { entityId, limit } = z.object({ entityId: z.string().optional(), limit: z.number().int().min(1).max(10000).optional() }).parse(p ?? {});
    return repo().audit(limit ?? 500, entityId);
  });

  // ---- notifications
  handle('notification:update', (p) => {
    const { id, state: st, snoozeMinutes } = z.object({ id: z.string(), state: z.enum(['dismissed', 'snoozed', 'acted', 'sent']), snoozeMinutes: z.number().int().min(1).max(10080).optional() }).parse(p);
    const r = repo();
    const n = r.notifications(100000).find((x) => x.id === id);
    if (!n) throw new ValidationError('Notification not found');
    const tz = r.preferences().value.timeZone || undefined;
    const snoozedUntil = st === 'snoozed' ? snoozeUntil(wallTime(new Date(), tz), snoozeMinutes ?? r.preferences().value.reminders.snoozeMinutes) : null;
    return r.saveNotification({ ...n, state: st, snoozedUntil });
  });
  handle('notification:test', () => {
    const r = repo();
    const supported = Notification.isSupported();
    const ts = new Date().toISOString();
    const rec: NotificationRecord = {
      id: newId(), createdAt: ts, updatedAt: ts, key: `test:${ts}`, category: 'test', title: 'EMI Tracker test notification',
      body: 'Notifications are working. Reminders are delivered while EMI Tracker is running (window or tray).', loanId: null,
      scheduledFor: wallTime(new Date()), deliveredAt: wallTime(new Date()), state: 'sent', snoozedUntil: null,
      channel: supported ? 'native' : 'in_app', late: false, deviceId: r.local().deviceId,
    };
    if (supported) new Notification({ title: rec.title, body: rec.body }).show();
    r.saveNotification(rec);
    broadcast('notification', rec);
    return { nativeSupported: supported };
  });
  handle('reminders:runNow', () => { runBackgroundTick(); return { lastTick: state.lastTick }; });
  handle('reminders:diagnostics', () => {
    const login = app.isPackaged ? app.getLoginItemSettings() : null;
    return {
      nativeSupported: Notification.isSupported(), schedulerRunning: state.schedulerRunning, lastTick: state.lastTick,
      deliveredThisSession: state.lastTickDelivered, platform: `${process.platform} ${process.getSystemVersion()}`,
      launchAtLogin: login?.openAtLogin ?? false, packaged: app.isPackaged, minimizeToTray: repo().local().minimizeToTray,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  });

  // ---- backup & restore
  handle('backup:create', (p) => {
    const { passphrase } = z.object({ passphrase: z.string().min(8, 'Passphrase must be at least 8 characters').max(500).optional() }).parse(p ?? {});
    const r = repo();
    return writeBackup(r, r.local().backupDir, appInfo(), { passphrase });
  });
  handle('backup:chooseDir', async (_p, e) => {
    const res = await dialog.showOpenDialog(window(e)!, { title: 'Choose backup folder', properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled || !res.filePaths[0]) return null;
    return repo().setLocal({ backupDir: res.filePaths[0] });
  });
  handle('backup:pick', async (_p, e) => {
    const res = await dialog.showOpenDialog(window(e)!, {
      title: 'Choose a backup to restore', defaultPath: repo().local().backupDir,
      filters: [{ name: 'EMI Tracker backups', extensions: ['json', 'emibackup', 'emisync'] }], properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const text = readUserFile(res.filePaths[0]);
    return { path: res.filePaths[0], encrypted: isEncryptedText(text) };
  });
  handle('backup:preview', (p) => {
    const { path: file, passphrase } = pathPayload.parse(p);
    return previewRestore(repo(), readUserFile(file), passphrase);
  });
  handle('backup:restore', (p) => {
    const { path: file, passphrase } = pathPayload.parse(p);
    const report = restore(repo(), readUserFile(file), paths().recovery, appInfo(), passphrase);
    broadcast('data:changed');
    return report;
  });
  handle('backup:history', () => repo().backupHistory(200));
  handle('file:reveal', (p) => {
    const { path: file } = pathPayload.parse(p);
    if (fs.existsSync(file)) shell.showItemInFolder(file);
    return true;
  });
  handle('app:openDataDir', () => shell.openPath(paths().data));

  // ---- sync
  handle('sync:chooseFolder', async (_p, e) => {
    const res = await dialog.showOpenDialog(window(e)!, { title: 'Choose sync folder', properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled || !res.filePaths[0]) return null;
    return repo().setLocal({ syncFolder: res.filePaths[0] });
  });
  handle('sync:setPassphrase', (p) => {
    const { passphrase } = z.object({ passphrase: z.string().min(8, 'Passphrase must be at least 8 characters').max(500).nullable() }).parse(p);
    setSyncSecret(passphrase);
    repo().setLocal({ syncEncrypted: !!passphrase });
    return true;
  });
  const folderSync = () => {
    const r = repo();
    const local = r.local();
    const passphrase = local.syncEncrypted ? getSyncSecret() : undefined;
    if (local.syncEncrypted && !passphrase) throw new ValidationError('Set the sync passphrase first');
    try {
      const report = syncNow(r, local.syncFolder, appInfo(), passphrase);
      broadcast('data:changed');
      return report;
    } catch (e) {
      r.setLocal({ lastSyncAt: new Date().toISOString(), lastSyncResult: `Failed: ${(e as Error).message}` });
      throw e;
    }
  };
  handle('sync:now', folderSync);
  // dashboard / Wi-Fi sync "Sync now": the sync folder right away, and asks a paired phone to sync
  handle('sync:all', () => {
    const local = repo().local();
    const lan = lanStatus();
    const phone = lan.enabled && lan.running && lan.peers.length > 0;
    if (!phone && !local.syncFolder) throw new ValidationError('Set up Wi-Fi sync or a sync folder in Backup & sync first');
    const phoneRequestedAt = phone ? requestPhoneSync() : null;
    let folder: ReturnType<typeof folderSync> | null = null, folderError = '';
    if (local.syncFolder) { try { folder = folderSync(); } catch (e) { if (!phone) throw e; folderError = (e as Error).message; } }
    return { phoneRequestedAt, folder, folderError };
  });

  // ---- export / import
  handle('export:save', async (p, e) => {
    const { name, content, kind } = z.object({ name: z.string().max(200), content: z.string().max(MAX_FILE), kind: z.enum(['csv', 'json', 'html']) }).parse(p);
    const res = await dialog.showSaveDialog(window(e)!, { defaultPath: path.join(app.getPath('documents'), name), filters: [{ name: kind.toUpperCase(), extensions: [kind] }] });
    if (res.canceled || !res.filePath) return null;
    fs.writeFileSync(res.filePath, kind === 'csv' ? String.fromCharCode(0xfeff) + content : content, 'utf8');
    return res.filePath;
  });
  handle('export:fullJson', async (_p, e) => {
    const snap = buildSnapshot(repo(), 'export', appInfo());
    const res = await dialog.showSaveDialog(window(e)!, { defaultPath: path.join(app.getPath('documents'), 'emi-tracker-export.json'), filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (res.canceled || !res.filePath) return null;
    fs.writeFileSync(res.filePath, serialize(snap), 'utf8');
    return res.filePath;
  });
  handle('import:openText', async (_p, e) => {
    const res = await dialog.showOpenDialog(window(e)!, { title: 'Import', filters: [{ name: 'CSV or JSON', extensions: ['csv', 'json'] }], properties: ['openFile'] });
    if (res.canceled || !res.filePaths[0]) return null;
    return { name: path.basename(res.filePaths[0]), text: readUserFile(res.filePaths[0]) };
  });
  handle('import:apply', (p) => {
    const { loans, payments } = z.object({ loans: z.array(loanSchema).max(500), payments: z.array(paymentSchema).max(50000) }).parse(p);
    const r = repo();
    r.db.tx(() => {
      for (const l of loans) r.saveLoan(l as never);
      for (const pay of payments) r.savePayment(pay as never, { allowDuplicate: true });
      r.addAudit('system', null, 'import', `Imported ${loans.length} loan(s) and ${payments.length} payment(s)`, null, null);
    });
    return { loans: loans.length, payments: payments.length };
  });
  handle('report:pdf', async (p, e) => {
    const { name, doc } = z.object({ name: z.string().max(200), doc: printDocSchema }).parse(p);
    const win = window(e);
    if (!win) throw new Error('No window');
    const pdf = await renderPdf(doc);
    const res = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), name.replace(/[\\/:*?"<>|]/g, '-')), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (res.canceled || !res.filePath) return null;
    fs.writeFileSync(res.filePath, pdf);
    return res.filePath;
  });
  handle('report:print', (p) => printDoc(z.object({ doc: printDocSchema }).parse(p).doc));

  // ---- attachments (copied into the app's private folder)
  handle('attachment:add', async (_p, e) => {
    const res = await dialog.showOpenDialog(window(e)!, { title: 'Attach a receipt or statement', properties: ['openFile'], filters: [{ name: 'Documents', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'txt', 'csv', 'xlsx'] }] });
    if (res.canceled || !res.filePaths[0]) return null;
    const src = res.filePaths[0];
    if (fs.statSync(src).size > MAX_FILE) throw new ValidationError('Attachment is larger than 50 MB');
    const dir = paths().attachments;
    fs.mkdirSync(dir, { recursive: true });
    const name = `${newId()}-${path.basename(src).replace(/[^\w.\- ]+/g, '_')}`;
    fs.copyFileSync(src, path.join(dir, name));
    return name;
  });
  handle('attachment:open', async (p) => {
    const { name } = z.object({ name: z.string().max(300) }).parse(p);
    const file = path.join(paths().attachments, path.basename(name));
    if (!fs.existsSync(file)) throw new ValidationError('Attachment file is missing (attachments are not part of backups)');
    const err = await shell.openPath(file);
    if (err) throw new Error(err);
    return true;
  });

  // ---- demo data, diagnostics, reset
  handle('demo:load', () => {
    const r = repo();
    const today = wallTime(new Date()).slice(0, 10);
    const d = demoData(today);
    r.db.tx(() => {
      for (const l of d.loans) r.saveLoan(l);
      for (const a of d.adjustments) r.saveAdjustment(a);
      for (const p of d.payments) r.savePayment(p, { allowDuplicate: true });
    });
    return { loans: d.loans.length, payments: d.payments.length };
  });
  handle('diagnostics:get', () => {
    const r = repo();
    const p = paths();
    const today = wallTime(new Date()).slice(0, 10);
    const adjustments = r.adjustments(), payments = r.payments();
    const engineChecks = r.loans().map((l) => {
      const c = computeLoan(l, adjustments, payments, today, { skipBaseline: true });
      const s = c.summary;
      const lhs = (+s.principalRepaid + +s.interestPaid + +s.feesPaid + +s.penaltiesPaid + +s.unapplied).toFixed(2);
      return { loanId: l.id, name: l.name, reconciles: lhs === s.totalPaid, warnings: s.warnings.length };
    });
    return {
      app: appInfo(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node,
      schemaVersion: r.db.version(), integrity: r.db.integrity(), counts: r.counts(), dataDir: p.data, dbFile: p.db,
      dbSize: fs.existsSync(p.db) ? fs.statSync(p.db).size : 0, blockedRequests: state.blockedRequests, engineChecks, log: recentLog(),
      safeStorage: safeStorage.isEncryptionAvailable(),
    };
  });
  handle('data:resetAll', (p) => {
    z.object({ confirm: z.literal('DELETE ALL DATA') }).parse(p);
    const r = repo();
    const backup = writeBackup(r, paths().recovery, appInfo(), { kind: 'recovery', label: 'before-reset' });
    r.replaceAll({ loans: [], adjustments: [], payments: [], customReminders: [], notifications: [], audit: [], categories: [], bills: [], billPayments: [], debts: [], debtRepayments: [], tombstones: [], preferences: r.preferences() });
    r.addAudit('system', null, 'reset', 'All loan data was erased by the user', null, null);
    return { recoveryBackup: backup.path };
  });
}
