// AUTH-5 (PERFECT-100 §9.2) — webhook targets must be public, or an owner/itadmin can point the worker
// at cloud metadata (169.254.169.254), a private service (10.x/172.16-31.x/192.168.x), a link-local or
// CGNAT address, and have the server make the request for them (SSRF).
//
// The old check was scheme + a literal loopback comparison. `https://169.254.169.254/…`, `https://10.0.0.5/`
// and `https://[fd00::1]/` all passed. This resolves the host (when it is a name) and rejects any address
// in a private / loopback / link-local / CGNAT / multicast / unspecified range.
//
// Loopback is DELIBERATELY still allowed for `http://` only: the test suite and local sandbox run real
// webhook receivers on 127.0.0.1, and the product documents that as the sandbox affordance. Everything
// else private is refused on both schemes.
import { lookup } from 'node:dns/promises';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function isPrivateIp(raw) {
  const ip = String(raw).toLowerCase().replace(/^\[|\]$/g, '');
  if (ip.includes(':')) {
    // IPv6
    if (ip === '::1' || ip === '::') return true;
    if (ip.startsWith('fe80:') || ip.startsWith('fec0:')) return true;   // link-local
    if (/^f[cd][0-9a-f]{2}:/.test(ip)) return true;                      // unique local fc00::/7
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return true; // not an address we recognise — fail closed
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;            // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;   // private
  if (a === 192 && b === 168) return true;            // private
  if (a === 100 && b >= 64 && b <= 127) return true;  // CGNAT
  if (a >= 224) return true;                          // multicast / reserved
  return false;
}

/** Resolve a URL's host and decide whether the worker may POST to it. Returns { ok, reason? }. */
export async function assertPublicWebhookUrl(rawUrl, { allowLoopback = true } = {}) {
  let u;
  try { u = new URL(String(rawUrl ?? '')); } catch { return { ok: false, reason: 'not a valid URL' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, reason: 'must be http(s)' };
  const host = u.hostname;
  const loopbackLiteral = LOOPBACK_HOSTS.has(host.toLowerCase());
  if (loopbackLiteral && !(allowLoopback && u.protocol === 'http:')) {
    return { ok: false, reason: 'loopback is allowed for http sandbox receivers only' };
  }
  if (u.protocol === 'http:' && !loopbackLiteral) return { ok: false, reason: 'plain http is allowed for loopback hosts only' };
  // A literal IP needs no DNS; a name must resolve, and EVERY answer must be public.
  const literal = host.startsWith('[') ? host.slice(1, -1) : host;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(literal) || literal.includes(':')) {
    if (!loopbackLiteral && isPrivateIp(literal)) return { ok: false, reason: 'private or reserved address' };
    return { ok: true };
  }
  let addrs;
  try { addrs = await lookup(host, { all: true }); } catch { return { ok: false, reason: 'host did not resolve' }; }
  if (!addrs.length) return { ok: false, reason: 'host did not resolve' };
  for (const a of addrs) {
    if (isPrivateIp(a.address)) return { ok: false, reason: `resolves to a private/reserved address (${a.address})` };
  }
  return { ok: true };
}
