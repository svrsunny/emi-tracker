/**
 * A minimal, independent implementation of the phone side of Wi-Fi sync (protocol v1), used to
 * drive the real desktop server in end-to-end tests. Mirrors the Android client.
 */
import crypto from 'node:crypto';

export class FakePhone {
  key: Buffer | null = null;
  constructor(readonly deviceId: string, readonly deviceName = 'E2E Phone') {}

  async pair(base: string, code: string): Promise<{ status: number }> {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const myPub = publicKey.export({ type: 'spki', format: 'der' });
    const start = await post(base, '/pair/start', { deviceId: this.deviceId, deviceName: this.deviceName, pub: myPub.toString('base64') });
    if (start.status !== 200) return start;
    const pcPub = Buffer.from(start.body.pub as string, 'base64');
    const shared = crypto.diffieHellman({ privateKey, publicKey: crypto.createPublicKey({ key: pcPub, format: 'der', type: 'spki' }) });
    const salt = crypto.createHash('sha256').update(code).digest();
    const key = Buffer.from(crypto.hkdfSync('sha256', shared, salt, Buffer.concat([Buffer.from('emi-tracker-pair-v1'), myPub, pcPub]), 32));
    const mac = (who: string) => crypto.createHmac('sha256', key).update(`emi-tracker-pair-v1:${who}`).digest('base64');
    const fin = await post(base, '/pair/finish', { deviceId: this.deviceId, proof: mac('phone') });
    if (fin.status === 200) {
      if (fin.body.proof !== mac('pc')) throw new Error('PC proof mismatch');
      this.key = key;
    }
    return fin;
  }

  async sync(base: string, snapshotText: string): Promise<{ status: number; body?: Record<string, unknown>; snapshot?: { kind: string; data: { loans: { name: string }[] } } }> {
    const key = this.key!;
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', key, iv);
    c.setAAD(Buffer.from(`emi-sync-req:${this.deviceId}`));
    const data = Buffer.concat([c.update(snapshotText, 'utf8'), c.final(), c.getAuthTag()]);
    const r = await post(base, '/sync', { deviceId: this.deviceId, iv: iv.toString('base64'), data: data.toString('base64') });
    if (r.status !== 200) return r;
    const buf = Buffer.from(r.body.data as string, 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(r.body.iv as string, 'base64'));
    d.setAAD(Buffer.from(`emi-sync-res:${this.deviceId}`));
    d.setAuthTag(buf.subarray(buf.length - 16));
    const text = Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]).toString('utf8');
    return { status: 200, snapshot: JSON.parse(text) };
  }
}

async function post(base: string, route: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}
