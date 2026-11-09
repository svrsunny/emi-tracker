/**
 * Wi-Fi sync server. When turned on, the PC listens on the home network for phones that were
 * paired with a 6-digit code. Requests from outside the local network are refused, every
 * snapshot is encrypted with the pairing key, and the merge is the same record-level merge as
 * folder sync. The phone always starts the exchange; the PC never connects anywhere.
 */
import http from 'node:http';
import os from 'node:os';
import { safeStorage } from 'electron';
import { z } from 'zod';
import { buildSnapshot, parseBackupText, serialize } from './backup';
import {
  deriveKey, isLocalNetworkAddress, LAN_PROTOCOL, newKeyPair, open, pairingCode, proof, proofMatches, requestAad, responseAad, seal,
} from './lanProtocol';
import { log } from './log';
import { appInfo, broadcast, state } from './main';
import { mergeRemote } from './sync';

const PAIR_WINDOW_MS = 5 * 60_000;
const MAX_PAIR_ATTEMPTS = 5;
const MAX_BODY = 64 * 1024 * 1024;
const SYNC_REQUEST_MS = 10 * 60_000;

export interface LanPeer { deviceId: string; deviceName: string; key: string; pairedAt: string; lastSyncAt: string | null; lastResult: string }
export interface LanStatus {
  enabled: boolean; running: boolean; port: number; error: string; addresses: string[];
  pairing: { code: string; expiresAt: number } | null;
  peers: Omit<LanPeer, 'key'>[];
  syncRequestedAt: number | null;
}

class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }

let server: http.Server | null = null;
let runningPort = 0;
let lastError = '';
let pairing: { code: string; expiresAt: number; attempts: number } | null = null;
const pending = new Map<string, { key: Buffer; deviceName: string; at: number }>();
let syncRequestedAt: number | null = null;

// ---------------------------------------------------------------- paired phones (keys protected with DPAPI)
function repo() {
  if (!state.repo) throw new Error('Database not ready');
  return state.repo;
}

function loadPeers(): LanPeer[] {
  const r = repo().db.get("SELECT value FROM kv WHERE key = 'lanPeers'");
  return r ? (JSON.parse(String(r.value)) as LanPeer[]) : [];
}

function savePeers(peers: LanPeer[]): void {
  repo().db.tx(() => repo().db.run("INSERT INTO kv (key, value, updated_at) VALUES ('lanPeers', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    [JSON.stringify(peers), new Date().toISOString()]));
}

function peerKey(p: LanPeer): Buffer {
  return Buffer.from(safeStorage.decryptString(Buffer.from(p.key, 'base64')), 'base64');
}

function updatePeer(deviceId: string, patch: Partial<LanPeer>): void {
  savePeers(loadPeers().map((p) => (p.deviceId === deviceId ? { ...p, ...patch } : p)));
}

export function removePeer(deviceId: string): void {
  savePeers(loadPeers().filter((p) => p.deviceId !== deviceId));
}

// ---------------------------------------------------------------- status & control
const VIRTUAL_ADAPTER = /vEthernet|VMware|VirtualBox|vbox|Hyper-V|WSL|Docker|Loopback|Bluetooth|ZeroTier|Tailscale|Npcap/i;

/** This PC's home-network IPv4 addresses, real Wi-Fi / Ethernet adapters first (virtual ones only as a fallback). */
export function lanAddresses(): string[] {
  const real: string[] = [];
  const virtual: string[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.') || !isLocalNetworkAddress(a.address)) continue;
      (VIRTUAL_ADAPTER.test(name) ? virtual : real).push(a.address);
    }
  }
  return real.length ? real : virtual;
}

export function lanStatus(): LanStatus {
  const local = repo().local();
  if (pairing && Date.now() > pairing.expiresAt) pairing = null;
  return {
    enabled: local.lanEnabled, running: !!server && runningPort > 0, port: runningPort || local.lanPort, error: lastError, addresses: lanAddresses(),
    pairing: pairing && { code: pairing.code, expiresAt: pairing.expiresAt },
    peers: loadPeers().map(({ key: _key, ...p }) => p),
    syncRequestedAt: phoneSyncRequested() ? syncRequestedAt : null,
  };
}

/**
 * "Sync now" on the PC. The PC never connects to the phone, so it raises a flag instead: an open
 * phone app checks /hello every few seconds and syncs when it sees it. Expires after 10 minutes.
 */
export function requestPhoneSync(): number {
  syncRequestedAt = Date.now();
  return syncRequestedAt;
}
const phoneSyncRequested = () => syncRequestedAt !== null && Date.now() - syncRequestedAt < SYNC_REQUEST_MS;

export function openPairing(): LanStatus {
  if (!server) throw new Error('Turn on Wi-Fi sync first');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows secure storage is unavailable, so the pairing key cannot be stored safely');
  pairing = { code: pairingCode(), expiresAt: Date.now() + PAIR_WINDOW_MS, attempts: 0 };
  pending.clear();
  return lanStatus();
}

export function cancelPairing(): void {
  pairing = null;
  pending.clear();
}

/** Starts, restarts or stops the server to match the saved settings. */
export async function applyLanSettings(): Promise<LanStatus> {
  const { lanEnabled, lanPort } = repo().local();
  if (server && (!lanEnabled || runningPort !== lanPort)) await stopLan();
  if (lanEnabled && !server) await startLan(lanPort);
  return lanStatus();
}

function startLan(port: number): Promise<void> {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => { void handle(req, res); });
    s.requestTimeout = 120_000;
    s.once('error', (e: NodeJS.ErrnoException) => {
      lastError = e.code === 'EADDRINUSE' ? `Port ${port} is already in use. Choose another port.` : e.message;
      log('lan', `server failed: ${lastError}`);
      server = null;
      runningPort = 0;
      resolve();
    });
    s.listen(port, '0.0.0.0', () => {
      server = s;
      runningPort = port;
      lastError = '';
      log('lan', `Wi-Fi sync listening on port ${port}`);
      resolve();
    });
  });
}

export function stopLan(): Promise<void> {
  cancelPairing();
  const s = server;
  server = null;
  runningPort = 0;
  return new Promise((resolve) => (s ? s.close(() => resolve()) : resolve()));
}

// ---------------------------------------------------------------- HTTP
async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  if (!isLocalNetworkAddress(req.socket.remoteAddress)) {
    log('lan', 'refused a connection from outside the local network');
    req.socket.destroy();
    return;
  }
  try {
    const route = `${req.method} ${(req.url ?? '').split('?')[0]}`;
    if (route === 'GET /emi-sync/hello') return send(200, { app: 'emi-tracker', protocol: LAN_PROTOCOL, syncRequested: phoneSyncRequested() });
    if (req.method !== 'POST') throw new HttpError(404, 'Not found');
    const body = JSON.parse(await readBody(req)) as unknown;
    if (route === 'POST /emi-sync/pair/start') return send(200, pairStart(body));
    if (route === 'POST /emi-sync/pair/finish') return send(200, pairFinish(body));
    if (route === 'POST /emi-sync/sync') return send(200, syncWith(body));
    throw new HttpError(404, 'Not found');
  } catch (e) {
    const status = e instanceof HttpError ? e.status : e instanceof SyntaxError || e instanceof z.ZodError ? 400 : 500;
    if (status === 500) log('lan', `request failed: ${(e as Error).message}`);
    send(status, { error: e instanceof z.ZodError ? 'Invalid request' : (e as Error).message });
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'Too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const deviceId = z.string().regex(/^[A-Za-z0-9-]{8,64}$/);

function pairStart(body: unknown) {
  const p = z.object({ deviceId, deviceName: z.string().max(100), pub: z.string().max(400) }).parse(body);
  if (!pairing || Date.now() > pairing.expiresAt) throw new HttpError(403, 'Pairing is not open. On the PC, open Backup & sync and click “Pair a phone”.');
  const phonePub = Buffer.from(p.pub, 'base64');
  const { privateKey, pub } = newKeyPair();
  let key: Buffer;
  try { key = deriveKey(privateKey, phonePub, pairing.code, phonePub, pub); } catch { throw new HttpError(400, 'Invalid key'); }
  pending.set(p.deviceId, { key, deviceName: p.deviceName.trim() || 'Phone', at: Date.now() });
  const local = repo().local();
  return { deviceId: local.deviceId, deviceName: local.deviceName, pub: pub.toString('base64') };
}

function pairFinish(body: unknown) {
  const p = z.object({ deviceId, proof: z.string().max(100) }).parse(body);
  const pend = pending.get(p.deviceId);
  if (!pairing || !pend || Date.now() > pairing.expiresAt) throw new HttpError(403, 'Pairing expired. Start again on the PC.');
  if (!proofMatches(pend.key, 'phone', p.proof)) {
    pending.delete(p.deviceId);
    if (++pairing.attempts >= MAX_PAIR_ATTEMPTS) cancelPairing();
    throw new HttpError(401, 'Wrong pairing code');
  }
  const peers = loadPeers().filter((x) => x.deviceId !== p.deviceId);
  peers.push({
    deviceId: p.deviceId, deviceName: pend.deviceName, key: safeStorage.encryptString(pend.key.toString('base64')).toString('base64'),
    pairedAt: new Date().toISOString(), lastSyncAt: null, lastResult: 'Paired',
  });
  savePeers(peers);
  repo().addAudit('sync', null, 'pair', `Paired phone “${pend.deviceName}” for Wi-Fi sync`, null, null);
  cancelPairing();
  broadcast('data:changed');
  return { proof: proof(pend.key, 'pc').toString('base64') };
}

function syncWith(body: unknown) {
  const p = z.object({ deviceId, iv: z.string().max(40), data: z.string() }).parse(body);
  const peer = loadPeers().find((x) => x.deviceId === p.deviceId);
  if (!peer) throw new HttpError(401, 'This phone is not paired with this PC. Pair it again.');
  const key = peerKey(peer);
  let text: string;
  try { text = open(key, p, requestAad(p.deviceId)); } catch { throw new HttpError(401, 'Pairing key mismatch. Pair the phone again.'); }
  const snap = parseBackupText(text);
  if (snap.kind !== 'sync') throw new HttpError(400, 'Not a sync snapshot');
  const stats = mergeRemote(repo(), snap, snap.deviceName || peer.deviceName);
  const changed = !!(stats.added || stats.updated || stats.deleted || stats.preferencesUpdated);
  const at = new Date().toISOString();
  repo().setLocal({ lastSyncAt: at, lastSyncResult: `OK — Wi-Fi sync with ${peer.deviceName}` });
  syncRequestedAt = null;
  updatePeer(peer.deviceId, { lastSyncAt: at, lastResult: `+${stats.added} new, ${stats.updated} updated, ${stats.deleted} deleted`, deviceName: snap.deviceName || peer.deviceName });
  if (changed) broadcast('data:changed');
  return { ...seal(key, serialize(buildSnapshot(repo(), 'sync', appInfo())), responseAad(p.deviceId)), stats };
}
