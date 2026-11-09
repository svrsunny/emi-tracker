/** Wi-Fi sync protocol: key agreement, proofs, encryption and the home-network address check. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveKey, isLocalNetworkAddress, newKeyPair, open, pairingCode, proof, proofMatches, requestAad, responseAad, seal } from '../../src/main/lanProtocol';

describe('Wi-Fi sync protocol', () => {
  const phone = newKeyPair();
  const pc = newKeyPair();

  it('derives the same pairing key on both sides only with the same code', () => {
    const kPhone = deriveKey(phone.privateKey, pc.pub, '123456', phone.pub, pc.pub);
    const kPc = deriveKey(pc.privateKey, phone.pub, '123456', phone.pub, pc.pub);
    expect(kPhone.equals(kPc)).toBe(true);
    expect(kPhone.length).toBe(32);
    const wrong = deriveKey(pc.privateKey, phone.pub, '654321', phone.pub, pc.pub);
    expect(wrong.equals(kPhone)).toBe(false);
    expect(proofMatches(kPc, 'phone', proof(kPhone, 'phone').toString('base64'))).toBe(true);
    expect(proofMatches(wrong, 'phone', proof(kPhone, 'phone').toString('base64'))).toBe(false);
    expect(proofMatches(kPc, 'pc', proof(kPhone, 'phone').toString('base64'))).toBe(false); // proofs are direction-bound
  });

  it('encrypts snapshots bound to device and direction', () => {
    const k = deriveKey(phone.privateKey, pc.pub, '000001', phone.pub, pc.pub);
    const msg = JSON.stringify({ hello: 'loan ₹1,00,000' });
    const s = seal(k, msg, requestAad('dev-1'));
    expect(open(k, s, requestAad('dev-1'))).toBe(msg);
    expect(() => open(k, s, responseAad('dev-1'))).toThrow();
    expect(() => open(k, s, requestAad('dev-2'))).toThrow();
    const tampered = Buffer.from(s.data, 'base64'); tampered[0] ^= 1;
    expect(() => open(k, { iv: s.iv, data: tampered.toString('base64') }, requestAad('dev-1'))).toThrow();
    expect(() => open(Buffer.alloc(32), s, requestAad('dev-1'))).toThrow();
  });

  it('accepts only home-network addresses', () => {
    for (const a of ['192.168.1.20', '10.0.2.2', '172.16.0.5', '172.31.255.1', '169.254.3.4', '127.0.0.1', '::1', '::ffff:192.168.0.7', 'fe80::1', 'fd12:3456::1']) expect(isLocalNetworkAddress(a), a).toBe(true);
    for (const a of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '192.169.0.1', '11.0.0.1', '2001:4860::8888', '::ffff:1.1.1.1', '', undefined]) expect(isLocalNetworkAddress(a), String(a)).toBe(false);
  });

  it('makes 6-digit pairing codes', () => {
    for (let i = 0; i < 50; i++) expect(pairingCode()).toMatch(/^\d{6}$/);
  });
});

describe('Wi-Fi sync protocol: cross-platform vectors (see android core LanTest)', () => {
  const dir = path.resolve(__dirname, '..', '..', '..', 'fixtures');

  it('writes a vector the Android app must reproduce', () => {
    const phone = newKeyPair();
    const pc = newKeyPair();
    const code = '482913';
    const key = deriveKey(pc.privateKey, phone.pub, code, phone.pub, pc.pub);
    const plaintext = JSON.stringify({ note: 'Wi-Fi sync ₹ vector', n: 1 });
    fs.writeFileSync(path.join(dir, 'lan-vector.json'), JSON.stringify({
      code, phonePrivatePkcs8: phone.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
      phonePub: phone.pub.toString('base64'), pcPub: pc.pub.toString('base64'), key: key.toString('base64'),
      phoneProof: proof(key, 'phone').toString('base64'), pcProof: proof(key, 'pc').toString('base64'),
      deviceId: 'vector-phone', plaintext, sealed: seal(key, plaintext, requestAad('vector-phone')),
    }, null, 2));
  });

  it('opens a message sealed by the Android app', () => {
    const f = path.join(dir, 'lan-vector-android.json');
    if (!fs.existsSync(f)) return; // written by the Android core tests
    const v = JSON.parse(fs.readFileSync(f, 'utf8'));
    expect(open(Buffer.from(v.key, 'base64'), v.sealed, responseAad(v.deviceId))).toBe(v.plaintext);
    expect(proofMatches(Buffer.from(v.key, 'base64'), 'phone', v.phoneProof)).toBe(true);
  });
});
