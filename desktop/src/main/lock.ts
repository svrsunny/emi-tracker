/**
 * App lock. When on, the app starts locked and locks again after it has been hidden or the PC
 * idle for the chosen time, or when Windows locks. While locked the IPC layer refuses every
 * data channel, so the window cannot show anything until you unlock.
 *
 * Unlock with an app PIN or password (stored only as a salted scrypt hash in this PC's
 * database, never synced) and/or Windows Hello (fingerprint, face or your Windows PIN), which
 * is also the way back in if the app PIN is forgotten.
 * This guards the app's screens; it does not encrypt the database file itself.
 */
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { z } from 'zod';
import { log } from './log';
import { state } from './main';

export type LockMethod = 'none' | 'pin' | 'password' | 'hello';
interface Stored { method: LockMethod; salt: string; hash: string; hello: boolean; lockAfterMinutes: number; failed: number; lockoutUntil: number }
export interface LockStatus {
  enabled: boolean; method: LockMethod; hello: boolean; helloAvailable: boolean; locked: boolean; lockAfterMinutes: number; lockoutSeconds: number;
}

const DEFAULT: Stored = { method: 'none', salt: '', hash: '', hello: false, lockAfterMinutes: 5, failed: 0, lockoutUntil: 0 };
let locked = false;
let hiddenAt: number | null = null;
let helloAvailable: boolean | null = null;
let onChange: (locked: boolean) => void = () => {};

function repo() {
  if (!state.repo) throw new Error('Database not ready');
  return state.repo;
}

function load(): Stored {
  const r = repo().db.get("SELECT value FROM kv WHERE key = 'appLock'");
  return r ? { ...DEFAULT, ...(JSON.parse(String(r.value)) as Partial<Stored>) } : DEFAULT;
}

function save(s: Stored): void {
  repo().db.tx(() => repo().db.run("INSERT INTO kv (key, value, updated_at) VALUES ('appLock', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    [JSON.stringify(s), new Date().toISOString()]));
}

const hashSecret = (secret: string, salt: string) => crypto.scryptSync(secret.normalize('NFKC'), Buffer.from(salt, 'base64'), 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('base64');

function secretMatches(s: Stored, secret: string): boolean {
  if (!s.hash) return false;
  const a = Buffer.from(hashSecret(secret, s.salt), 'base64'), b = Buffer.from(s.hash, 'base64');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const lockEnabled = () => load().method !== 'none';
export const isLocked = () => locked;

export function initLock(changed: (locked: boolean) => void): void {
  onChange = changed;
  locked = lockEnabled();
}

function setLocked(v: boolean): void {
  if (locked === v) return;
  locked = v;
  onChange(v);
}

export function lockNow(): void { if (lockEnabled()) setLocked(true); }

/** Window hidden / minimised: remember when, so showing it again after the delay locks. */
export function windowHidden(): void { hiddenAt ??= Date.now(); }
export function windowShown(): void {
  const s = load();
  if (s.method !== 'none' && hiddenAt !== null && Date.now() - hiddenAt >= s.lockAfterMinutes * 60_000) setLocked(true);
  hiddenAt = null;
}
/** Called every minute with the PC's idle time. */
export function idleCheck(idleSeconds: number): void {
  const s = load();
  if (s.method !== 'none' && s.lockAfterMinutes > 0 && idleSeconds >= s.lockAfterMinutes * 60) setLocked(true);
}

export async function lockStatus(): Promise<LockStatus> {
  const s = load();
  return {
    enabled: s.method !== 'none', method: s.method, hello: s.method === 'hello' || s.hello, helloAvailable: await windowsHelloAvailable(), locked,
    lockAfterMinutes: s.lockAfterMinutes, lockoutSeconds: Math.max(0, Math.ceil((s.lockoutUntil - Date.now()) / 1000)),
  };
}

/** Too many wrong attempts: wait 30 s, doubling up to 15 minutes. */
function failed(s: Stored): never {
  const n = s.failed + 1;
  const wait = n >= 5 ? Math.min(15 * 60_000, 30_000 * 2 ** (n - 5)) : 0;
  save({ ...s, failed: n, lockoutUntil: wait ? Date.now() + wait : 0 });
  throw new Error(wait ? `Wrong ${s.method === 'pin' ? 'PIN' : 'password'}. Try again in ${Math.round(wait / 1000)} seconds.` : `Wrong ${s.method === 'pin' ? 'PIN' : 'password'}`);
}

export function unlockWithSecret(secret: string): boolean {
  const s = load();
  if (s.method !== 'pin' && s.method !== 'password') throw new Error('Use Windows Hello to unlock');
  if (Date.now() < s.lockoutUntil) throw new Error(`Too many attempts. Try again in ${Math.ceil((s.lockoutUntil - Date.now()) / 1000)} seconds.`);
  if (!secretMatches(s, secret)) failed(s);
  save({ ...s, failed: 0, lockoutUntil: 0 });
  setLocked(false);
  return true;
}

/** Windows Hello also works when the app PIN is forgotten: it proves you are the Windows user. */
export async function unlockWithHello(): Promise<boolean> {
  if (!(await windowsHelloAvailable())) throw new Error('Windows Hello is not set up on this PC');
  const ok = await verifyWithHello('Unlock EMI Tracker');
  if (!ok) throw new Error('Windows Hello did not verify you');
  const s = load();
  save({ ...s, failed: 0, lockoutUntil: 0 });
  setLocked(false);
  return true;
}

export const lockSettingsSchema = z.object({
  method: z.enum(['none', 'pin', 'password', 'hello']),
  secret: z.string().max(128).optional(),
  hello: z.boolean(),
  lockAfterMinutes: z.number().int().min(0).max(240),
  current: z.string().max(128).optional(), // the current PIN / password, required to change an existing PIN or password lock
  confirmWithHello: z.boolean().optional(), // forgot the current PIN / password: confirm the change with Windows Hello instead
}).superRefine((v, ctx) => {
  if (v.method === 'pin' && !/^\d{4,12}$/.test(v.secret ?? '')) ctx.addIssue({ code: 'custom', path: ['secret'], message: 'PIN must be 4 to 12 digits' });
  if (v.method === 'password' && (v.secret ?? '').length < 6) ctx.addIssue({ code: 'custom', path: ['secret'], message: 'Password must be at least 6 characters' });
});

/** Turns the lock on, changes it or turns it off. Changing an existing lock needs the current secret or Windows Hello. */
export async function setLockSettings(input: z.infer<typeof lockSettingsSchema>): Promise<LockStatus> {
  const cur = load();
  if (cur.method !== 'none') {
    const onlyTiming = input.method === cur.method && !input.secret && input.hello === cur.hello;
    // a PIN / password lock is confirmed with that PIN / password; Windows Hello only for a Hello lock or when asked for
    const secretLock = cur.method === 'pin' || cur.method === 'password';
    if (!onlyTiming) {
      if (secretLock && !input.confirmWithHello) {
        if (Date.now() < cur.lockoutUntil) throw new Error(`Too many attempts. Try again in ${Math.ceil((cur.lockoutUntil - Date.now()) / 1000)} seconds.`);
        if (!input.current) throw new Error(`Enter your current ${cur.method === 'pin' ? 'PIN' : 'password'} to change the lock`);
        if (!secretMatches(cur, input.current)) failed(cur);
      } else if (!(await verifyWithHello('Confirm to change the EMI Tracker app lock'))) throw new Error('Windows Hello did not confirm the change');
    }
  }
  if ((input.method === 'hello' || input.hello) && !(await windowsHelloAvailable())) throw new Error('Windows Hello is not set up on this PC. Set it up in Windows Settings → Accounts → Sign-in options.');
  let next: Stored = { ...cur, method: input.method, hello: input.method === 'hello' || input.hello, lockAfterMinutes: input.lockAfterMinutes, failed: 0, lockoutUntil: 0 };
  if (input.method === 'pin' || input.method === 'password') {
    if (input.secret) { const salt = crypto.randomBytes(16).toString('base64'); next = { ...next, salt, hash: hashSecret(input.secret, salt) }; }
    else if (cur.method !== input.method) throw new Error(`Enter a ${input.method === 'pin' ? 'PIN' : 'password'}`);
  } else next = { ...next, salt: '', hash: '' };
  save(next);
  log('lock', `app lock set to ${next.method}${next.hello ? ' + Windows Hello' : ''}`);
  return lockStatus();
}

// ------------------------------------------------------------------ Windows Hello (UserConsentVerifier via PowerShell; no extra dependencies)
/**
 * The prompt is attached to the EMI Tracker window (IUserConsentVerifierInterop). Asked for from the
 * hidden PowerShell process alone, Windows treats it as a background request: the dialog can open
 * behind the app and fingerprint / face are not offered, only the Windows PIN.
 */
const HELLO_INTEROP = `Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
[ComImport, Guid("39E050C3-4E74-441A-8DC0-B81104DF949C"), InterfaceType(ComInterfaceType.InterfaceIsIInspectable)]
public interface IUserConsentVerifierInterop { IntPtr RequestVerificationForWindowAsync(IntPtr appWindow, [MarshalAs(UnmanagedType.HString)] string message, [In] ref Guid riid); }
public static class HelloInterop {
  [DllImport("combase.dll", PreserveSig=false)] static extern void RoGetActivationFactory([MarshalAs(UnmanagedType.HString)] string id, [In] ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object factory);
  public static object Request(IntPtr hwnd, string message, Guid riid) {
    Guid iid = typeof(IUserConsentVerifierInterop).GUID; object f;
    RoGetActivationFactory("Windows.Security.Credentials.UI.UserConsentVerifier", ref iid, out f);
    IntPtr p = ((IUserConsentVerifierInterop)f).RequestVerificationForWindowAsync(hwnd, message, ref riid);
    try { return Marshal.GetObjectForIUnknown(p); } finally { Marshal.Release(p); }
  }
}
"@`;

function appWindowHandle(): string {
  const w = state.win;
  if (!w || w.isDestroyed() || !w.isVisible()) return '0';
  const h = w.getNativeWindowHandle();
  return (h.length >= 8 ? h.readBigUInt64LE(0) : BigInt(h.readUInt32LE(0))).toString();
}

function runHello(mode: 'check' | 'verify', message = ''): Promise<string> {
  const msg = message.replace(/'/g, "''");
  const hwnd = mode === 'verify' ? appWindowHandle() : '0';
  // never prompt for a hidden window: the dialog would pop up out of nowhere
  if (mode === 'verify' && hwnd === '0') return Promise.resolve('Canceled');
  if (mode === 'verify') state.win?.focus();
  const script = `$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null=[Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime]
$null=[Windows.Foundation.IAsyncOperation\`1,Windows.Foundation,ContentType=WindowsRuntime]
$asTask=[System.WindowsRuntimeSystemExtensions].GetMethods()|Where-Object{$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'}|Select-Object -First 1
function Await($op,$t){$task=$asTask.MakeGenericMethod($t).Invoke($null,@($op));$task.Wait();$task.Result}
$result=[Windows.Security.Credentials.UI.UserConsentVerificationResult]
if('${mode}' -eq 'check'){Await ([Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()) ([Windows.Security.Credentials.UI.UserConsentVerifierAvailability])}
else{
${HELLO_INTEROP}
$op=[HelloInterop]::Request([IntPtr][Int64]'${hwnd}','${msg}',[Windows.Foundation.IAsyncOperation\`1].MakeGenericType($result).GUID)
Await $op $result}`;
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve('NotSupported');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: mode === 'check' ? 20_000 : 120_000 }, (err, stdout) => resolve(err ? 'Error' : String(stdout).trim()));
  });
}

export async function windowsHelloAvailable(): Promise<boolean> {
  helloAvailable ??= (await runHello('check')) === 'Available';
  return helloAvailable;
}

let verifying: Promise<boolean> | null = null;
/** One prompt at a time: a second request while the dialog is open waits for the same answer. */
function verifyWithHello(message: string): Promise<boolean> {
  verifying ??= runHello('verify', message).then((r) => r === 'Verified').finally(() => { verifying = null; });
  return verifying;
}
