/**
 * Electron main process. Security posture: context isolation on, node integration off,
 * sandboxed renderer, no remote content, every outbound network request blocked and counted,
 * and a narrow IPC surface whose payloads are validated with zod (see ipc.ts).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  app, BrowserWindow, dialog, Menu, Notification, nativeImage, powerMonitor, safeStorage, session, Tray, type WebContents,
} from 'electron';
import { newId } from '../shared/defaults';
import { writeBackup, pruneBackups, type AppInfo } from './backup';
import { Db } from './db';
import { registerIpc } from './ipc';
import { applyLanSettings, stopLan } from './lan';
import { idleCheck, initLock, lockNow, windowHidden, windowShown } from './lock';
import { Repo } from './repo';
import { reminderTick, type Notifier } from './scheduler';
import { syncNow } from './sync';
import { log } from './log';

const isDev = !!process.env.VITE_DEV_SERVER_URL;
const DEV_URL = process.env.VITE_DEV_SERVER_URL ?? '';

if (process.env.EMI_TRACKER_DATA_DIR) app.setPath('userData', path.resolve(process.env.EMI_TRACKER_DATA_DIR));
app.setAppUserModelId('com.emitracker.desktop');

export const state = {
  repo: null as Repo | null,
  win: null as BrowserWindow | null,
  tray: null as Tray | null,
  quitting: false,
  blockedRequests: 0,
  lastTick: null as string | null,
  lastTickDelivered: 0,
  schedulerRunning: false,
  lastAutoBackupError: '',
};

export const appInfo = (): AppInfo => ({ name: 'EMI Tracker', version: app.getVersion(), platform: 'desktop' });

export const paths = () => {
  const data = app.getPath('userData');
  return {
    data,
    db: path.join(data, 'emi-tracker.sqlite'),
    attachments: path.join(data, 'attachments'),
    recovery: path.join(data, 'recovery-backups'),
    // a custom data folder (tests, portable use) keeps its backups beside the data, never in Documents
    defaultBackups: process.env.EMI_TRACKER_DATA_DIR ? path.join(data, 'backups') : path.join(app.getPath('documents'), 'EMI Tracker Backups'),
    wasm: app.isPackaged ? path.join(process.resourcesPath, 'sql-wasm.wasm') : path.join(__dirname, 'sql-wasm.wasm'),
    preload: path.join(__dirname, '..', 'preload', 'preload.js'),
    renderer: path.join(__dirname, '..', 'renderer', 'index.html'),
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
  };
};

// ------------------------------------------------------------------ sync secret (DPAPI)
export function getSyncSecret(): string | undefined {
  const r = state.repo?.db.get("SELECT value FROM kv WHERE key = 'syncSecret'");
  if (!r || !safeStorage.isEncryptionAvailable()) return undefined;
  try { return safeStorage.decryptString(Buffer.from(String(r.value), 'base64')); } catch { return undefined; }
}
export function setSyncSecret(passphrase: string | null): void {
  const repo = state.repo!;
  repo.db.tx(() => {
    if (!passphrase) repo.db.run("DELETE FROM kv WHERE key = 'syncSecret'");
    else {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows secure storage is unavailable; encrypted sync cannot remember the passphrase');
      const blob = safeStorage.encryptString(passphrase).toString('base64');
      repo.db.run("INSERT INTO kv (key, value, updated_at) VALUES ('syncSecret', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", [blob, new Date().toISOString()]);
    }
  });
}

// ------------------------------------------------------------------ offline enforcement
function enforceOffline(): void {
  const allowed = (url: string) => url.startsWith('file:') || url.startsWith('devtools:') || url.startsWith('data:') || url.startsWith('blob:')
    || (isDev && (url.startsWith(DEV_URL) || url.startsWith(DEV_URL.replace('http', 'ws'))));
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    if (allowed(details.url)) return cb({});
    state.blockedRequests++;
    log('network', `blocked outbound request to ${safeHost(details.url)}`);
    cb({ cancel: true });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  app.on('web-contents-created', (_e, contents: WebContents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (ev, url) => { if (!allowed(url)) ev.preventDefault(); });
    contents.on('will-attach-webview', (ev) => ev.preventDefault());
  });
}

function safeHost(url: string): string {
  try { return new URL(url).host || 'unknown'; } catch { return 'invalid-url'; }
}

// ------------------------------------------------------------------ window & tray
function createWindow(show: boolean): BrowserWindow {
  const p = paths();
  const dark = (state.repo?.preferences().value.theme ?? 'dark') !== 'light';
  const win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 980, minHeight: 640, show: false,
    backgroundColor: dark ? '#0b0f17' : '#f5f7fb', title: 'EMI Tracker',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: dark ? '#0b0f17' : '#f5f7fb', symbolColor: dark ? '#c9d2e3' : '#2b3445', height: 40 },
    icon: fs.existsSync(p.icon) ? p.icon : undefined,
    webPreferences: {
      preload: p.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
      allowRunningInsecureContent: false, spellcheck: false, devTools: isDev || !app.isPackaged,
    },
  });
  win.once('ready-to-show', () => { if (show) win.show(); });
  // app lock: time spent hidden or minimised counts towards auto-lock
  win.on('hide', windowHidden);
  win.on('minimize', windowHidden);
  win.on('show', windowShown);
  win.on('restore', windowShown);
  win.on('close', (e) => {
    if (!state.quitting && state.repo?.local().minimizeToTray) {
      e.preventDefault();
      win.hide();
    }
  });
  if (isDev) void win.loadURL(DEV_URL);
  else void win.loadFile(p.renderer);
  return win;
}

export function showWindow(route?: string): void {
  if (!state.win || state.win.isDestroyed()) state.win = createWindow(true);
  if (state.win.isMinimized()) state.win.restore();
  state.win.show();
  state.win.focus();
  if (route) state.win.webContents.send('navigate', route);
}

function createTray(): void {
  const p = paths();
  const img = fs.existsSync(p.icon) ? nativeImage.createFromPath(p.icon).resize({ width: 16, height: 16 }) : nativeImage.createEmpty();
  state.tray = new Tray(img);
  state.tray.setToolTip('EMI Tracker — reminders active');
  state.tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open EMI Tracker', click: () => showWindow() },
    { label: 'Payments', click: () => showWindow('/payments') },
    { label: 'Reminders', click: () => showWindow('/reminders') },
    { label: 'Lock now', click: () => lockNow() },
    { type: 'separator' },
    { label: 'Quit (reminders stop)', click: () => { state.quitting = true; app.quit(); } },
  ]));
  state.tray.on('click', () => showWindow());
}

export function broadcast(channel: 'notification' | 'data:changed' | 'navigate' | 'lock:changed', payload?: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload);
}

export const notifier: Notifier = {
  native(r, opts) {
    if (!Notification.isSupported()) return false;
    const n = new Notification({ title: r.title, body: r.body, silent: opts.silent, urgency: opts.urgency, timeoutType: opts.urgency === 'critical' ? 'never' : 'default' });
    n.on('click', () => showWindow(r.loanId ? `/loans/${r.loanId}` : '/reminders'));
    n.show();
    return true;
  },
  inApp(rec) { broadcast('notification', rec); },
};

// ------------------------------------------------------------------ background loop
export function runBackgroundTick(): void {
  const repo = state.repo;
  if (!repo) return;
  try {
    const r = reminderTick(repo, notifier);
    state.lastTick = r.at;
    state.lastTickDelivered += r.delivered;
  } catch (e) {
    log('scheduler', `reminder tick failed: ${(e as Error).message}`);
  }
  idleCheck(powerMonitor.getSystemIdleTime());
  const local = repo.local();
  const nowMs = Date.now();
  if (local.autoBackup && (!local.lastBackupAt || nowMs - Date.parse(local.lastBackupAt) >= local.autoBackupHours * 3600_000) && repo.loans().length) {
    try {
      writeBackup(repo, local.backupDir, appInfo(), { label: 'auto' });
      pruneBackups(local.backupDir, local.backupKeep);
      state.lastAutoBackupError = '';
    } catch (e) {
      state.lastAutoBackupError = (e as Error).message;
      log('backup', `automatic backup failed: ${(e as Error).message}`);
    }
  }
  if (local.syncEnabled && local.syncFolder && (!local.lastSyncAt || nowMs - Date.parse(local.lastSyncAt) >= local.syncIntervalMinutes * 60_000)) {
    try {
      const passphrase = local.syncEncrypted ? getSyncSecret() : undefined;
      if (local.syncEncrypted && !passphrase) throw new Error('Sync passphrase is not set');
      const rep = syncNow(repo, local.syncFolder, appInfo(), passphrase);
      if (rep.totals.added || rep.totals.updated || rep.totals.deleted || rep.totals.preferencesUpdated) broadcast('data:changed');
    } catch (e) {
      repo.setLocal({ lastSyncAt: new Date().toISOString(), lastSyncResult: `Failed: ${(e as Error).message}` });
    }
  }
}

// ------------------------------------------------------------------ startup
async function start(): Promise<void> {
  const p = paths();
  fs.mkdirSync(p.data, { recursive: true });
  const db = await Db.open(p.db, p.wasm, (from) => {
    // keep a byte-for-byte copy of the database before a schema migration
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.mkdirSync(p.recovery, { recursive: true });
    fs.copyFileSync(p.db, path.join(p.recovery, `pre-migration-v${from}-${stamp}.sqlite`));
  });
  const repo = new Repo(db, () => state.repo?.local().deviceId ?? 'unknown');
  state.repo = repo;
  const local = repo.local();
  if (!local.deviceId) repo.setLocal({ deviceId: newId(), deviceName: `${os.hostname()} (Windows)`, backupDir: p.defaultBackups });
  if (!repo.local().backupDir) repo.setLocal({ backupDir: p.defaultBackups });

  // backup before running a new app version against existing data
  const lastVersion = repo.db.get("SELECT value FROM kv WHERE key = 'lastRunVersion'")?.value;
  if (lastVersion && lastVersion !== app.getVersion() && repo.loans().length) {
    try { writeBackup(repo, p.recovery, appInfo(), { kind: 'recovery', label: `pre-upgrade-${String(lastVersion)}` }); } catch (e) { log('backup', `pre-upgrade backup failed: ${(e as Error).message}`); }
  }
  repo.db.tx(() => repo.db.run("INSERT INTO kv (key, value, updated_at) VALUES ('lastRunVersion', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", [app.getVersion(), new Date().toISOString()]));

  enforceOffline();
  initLock((locked) => broadcast('lock:changed', locked));
  registerIpc();
  await applyLanSettings();
  Menu.setApplicationMenu(null);
  const hidden = process.argv.includes('--hidden') || repo.local().startHidden;
  state.win = createWindow(!hidden);
  createTray();
  state.schedulerRunning = true;
  setTimeout(runBackgroundTick, 5000);
  setInterval(runBackgroundTick, 60_000);
  powerMonitor.on('resume', () => setTimeout(runBackgroundTick, 3000));
  powerMonitor.on('unlock-screen', () => setTimeout(runBackgroundTick, 3000));
  powerMonitor.on('lock-screen', () => lockNow());
  powerMonitor.on('suspend', () => lockNow());
  log('app', `started v${app.getVersion()} (schema ${db.version()})`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(start).catch((e) => {
    log('app', `startup failed: ${(e as Error).message}`);
    dialog.showErrorBox('EMI Tracker could not start', `${(e as Error).message}\n\nYour data folder: ${app.getPath('userData')}\nRecovery backups are kept in the "recovery-backups" subfolder.`);
    app.quit();
  });
  app.on('before-quit', () => { state.quitting = true; void stopLan(); });
  app.on('window-all-closed', () => {
    if (!state.repo?.local().minimizeToTray) app.quit();
  });
}

