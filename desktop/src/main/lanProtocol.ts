/**
 * Wi-Fi sync protocol (v1), shared with the Android app (see docs/BACKUP_AND_RESTORE.md#wi-fi-sync).
 *
 * Pairing: the PC shows a 6-digit code. Phone and PC exchange ephemeral P-256 public keys and
 * derive a 256-bit pairing key K = HKDF-SHA256(ECDH secret, salt = SHA-256(code),
 * info = "emi-tracker-pair-v1" || phonePub || pcPub). Each side proves it holds K with an HMAC,
 * so a wrong code fails and someone merely listening on the Wi-Fi cannot compute K.
 * Sync: snapshots travel AES-256-GCM encrypted under K, bound to the direction and device.
 */
import crypto from 'node:crypto';
import net from 'node:net';

export const LAN_PROTOCOL = 1;
export const DEFAULT_LAN_PORT = 47830;
const INFO = 'emi-tracker-pair-v1';

export interface Sealed { iv: string; data: string }

export function newKeyPair(): { privateKey: crypto.KeyObject; pub: Buffer } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return { privateKey, pub: publicKey.export({ type: 'spki', format: 'der' }) };
}

export function deriveKey(privateKey: crypto.KeyObject, peerPub: Buffer, code: string, phonePub: Buffer, pcPub: Buffer): Buffer {
  const shared = crypto.diffieHellman({ privateKey, publicKey: crypto.createPublicKey({ key: peerPub, format: 'der', type: 'spki' }) });
  const salt = crypto.createHash('sha256').update(code, 'utf8').digest();
  return Buffer.from(crypto.hkdfSync('sha256', shared, salt, Buffer.concat([Buffer.from(INFO, 'utf8'), phonePub, pcPub]), 32));
}

export function proof(key: Buffer, who: 'phone' | 'pc'): Buffer {
  return crypto.createHmac('sha256', key).update(`${INFO}:${who}`, 'utf8').digest();
}

export function proofMatches(key: Buffer, who: 'phone' | 'pc', b64: string): boolean {
  const want = proof(key, who);
  const got = Buffer.from(b64, 'base64');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export function seal(key: Buffer, plaintext: string, aad: string): Sealed {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad, 'utf8'));
  const data = Buffer.concat([c.update(plaintext, 'utf8'), c.final(), c.getAuthTag()]);
  return { iv: iv.toString('base64'), data: data.toString('base64') };
}

/** Throws when the key is wrong or the message was altered. */
export function open(key: Buffer, s: Sealed, aad: string): string {
  const buf = Buffer.from(s.data, 'base64');
  if (buf.length < 16) throw new Error('Message too short');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(s.iv, 'base64'));
  d.setAAD(Buffer.from(aad, 'utf8'));
  d.setAuthTag(buf.subarray(buf.length - 16));
  return Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]).toString('utf8');
}

export const requestAad = (deviceId: string) => `emi-sync-req:${deviceId}`;
export const responseAad = (deviceId: string) => `emi-sync-res:${deviceId}`;

export function pairingCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Home-network addresses only: private IPv4 ranges, link-local, loopback and IPv6 unique-local. */
export function isLocalNetworkAddress(address: string | undefined): boolean {
  if (!address) return false;
  const a = address.startsWith('::ffff:') ? address.slice(7) : address;
  if (net.isIPv4(a)) {
    const [x, y] = a.split('.').map(Number);
    return x === 10 || x === 127 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 169 && y === 254);
  }
  if (net.isIPv6(a)) {
    const l = a.toLowerCase();
    return l === '::1' || /^fe[89ab]/.test(l) || /^f[cd]/.test(l);
  }
  return false;
}
