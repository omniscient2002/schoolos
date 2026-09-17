// RFC 6238 TOTP (SHA-1, 6 digits, 30s step) — pure node:crypto, no new deps
// (L2-3.2). Base32 per RFC 4648 (no padding, A–Z2–7).
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateSecret(bytes = 20) {
  let value = 0, bits = 0, out = '';
  for (const byte of randomBytes(bytes)) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s) {
  let value = 0, bits = 0;
  const out = [];
  for (const ch of String(s).toUpperCase().replace(/=+$/, '').replace(/\s/g, '')) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

// HOTP (RFC 4226) at a given 30s time step — TOTP is HOTP(K, T).
export function totpAt(secretB32, timeStep) {
  const key = base32Decode(secretB32);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(timeStep));
  const h = createHmac('sha1', key).update(counter).digest();
  const off = h[h.length - 1] & 0xf;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

export function verifyTotp(secretB32, code, { window = 1, stepSeconds = 30, now = Date.now() } = {}) {
  return verifyTotpStep(secretB32, code, { window, stepSeconds, now }) !== null;
}

export function verifyTotpStep(secretB32, code, { window = 1, stepSeconds = 30, now = Date.now() } = {}) {
  if (!/^\d{6}$/.test(String(code ?? ''))) return null;
  const step = Math.floor(now / 1000 / stepSeconds);
  for (let d = -window; d <= window; d++) {
    if (totpAt(secretB32, step + d) === String(code)) return step + d;
  }
  return null;
}

export function otpauthUri({ secret, account, issuer = 'SchoolOS' }) {
  return `otpauth://totp/${encodeURIComponent(issuer + ":" + account)}`
    + `?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export function constantTimeEqual(a, b) {
  const ab = Buffer.from(String(a ?? '')); const bb = Buffer.from(String(b ?? ''));
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
