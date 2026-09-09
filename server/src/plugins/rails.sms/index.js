// rails.sms — the Communication Orchestrator's SMS rail (Wave A).
// Headless by rule (docs/11 §2.3, comms.whatsapp parity): NO public HTTP door.
// The only surface is an internal kernel-style send function the comms
// dispatcher (scripts/comms-dispatcher.js) calls with rows claimed from
// app.communications — sends are NOT direct, they drain the approved queue.
//
// Provider is settings-driven (per-tenant row app.plugins.settings, read via the
// kernel q() owner path exactly like ops.visitors:22-27):
//   provider = 'logger' (default) — structured log line + { ok: true }; the rail
//     is honest: ok means "accepted for delivery", never "carrier confirmed".
//   provider = 'http-generic' — POST { to, body } as JSON to settings url with a
//     settings-named auth header (value never logged). Generic by design: no
//     vendor SDK, TRAI/DLT compliance stays the operator's provider contract.
// Degrades gracefully when unconfigured: no settings row → logger.
// Recipients must be E.164 (+XXXXXXXXXX); failures are RETURNED, never thrown.
const ID = 'rails.sms';
export { default as manifest } from './manifest.js';

const E164_RE = /^\+[1-9]\d{7,14}$/; // ITU-T E.164: + then 8–15 digits, no leading 0
const redactSecrets = (s) => String(s ?? '').replace(/(auth_header_value)\s*[=:]\s*\S+/gi, '$1=[redacted]');

// kernel q binding: register() wires it on mount; the dispatcher (a separate
// process, loader-free) calls bindKernel(q) before its first tick. Reading the
// settings column is an owner-path read — never the constrained app role.
let kernelQ = null;
export function bindKernel(q) { kernelQ = q; }

async function readSettings(tenantId) {
  try {
    const r = await kernelQ(`SELECT settings FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`, [tenantId, ID]);
    return r.rows[0]?.settings ?? {};
  } catch (e) {
    console.error(`${ID}: settings read failed — degrading to logger provider:`, e.message);
    return {};
  }
}

async function sendViaHttp(s, { to, body }) {
  if (!s.url || !/^https:\/\//i.test(s.url)) {
    return { ok: false, provider: 'http-generic', ref: null, error: 'provider http-generic needs an https url in plugin settings' };
  }
  if (!s.auth_header_name || !s.auth_header_value) {
    return { ok: false, provider: 'http-generic', ref: null, error: 'provider http-generic needs auth_header_name + auth_header_value in plugin settings' };
  }
  const headers = {
    'content-type': 'application/json',
    [String(s.auth_header_name).slice(0, 128)]: String(s.auth_header_value),
  };
  if (s.sender_header_name && s.sender_header_value) {
    headers[String(s.sender_header_name).slice(0, 128)] = String(s.sender_header_value);
  }
  const res = await fetch(s.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ to, body: String(body ?? '') }),
    signal: AbortSignal.timeout(8000), // capability latency_sla.timeout_ms
  });
  if (!res.ok) {
    return { ok: false, provider: 'http-generic', ref: null, error: `provider answered HTTP ${res.status}` };
  }
  // best-effort provider reference: id/ref/message_id are the common response shapes
  let ref = null;
  try {
    const j = await res.json();
    ref = j?.id ?? j?.message_id ?? j?.ref ?? j?.data?.id ?? null;
    if (ref != null) ref = String(ref);
  } catch { /* non-JSON 2xx body — still accepted */ }
  return { ok: true, provider: 'http-generic', ref, error: null };
}

/**
 * sendSms({ to, body, dedupKey, tenantId }) — internal rail function (NOT a door).
 * Resolves the tenant's settings, dispatches per provider, and RETURNS
 * { ok, provider, ref, error } — it inserts nothing itself; row bookkeeping
 * (status/attempts/last_error/next_attempt_at) is the dispatcher's.
 * The dedup key IS the receipt of approval (the kernel Communication
 * Orchestrator stamps app.communications.dedup_key) — a send without one is
 * refused, so this rail can never be a side door around approval.
 */
export async function sendSms({ to, body, dedupKey, tenantId }) {
  if (!tenantId) return { ok: false, provider: 'logger', ref: null, error: 'sendSms requires tenantId (queue rows carry it)' };
  if (!dedupKey) return { ok: false, provider: 'logger', ref: null, error: 'sendSms requires dedupKey (approval receipt from the orchestrator)' };
  if (!E164_RE.test(String(to ?? ''))) {
    return { ok: false, provider: 'logger', ref: null, error: 'recipient must be E.164 (+countrycode…)' };
  }
  const s = await readSettings(tenantId);
  const provider = ['logger', 'http-generic'].includes(s.provider) ? s.provider : 'logger';
  let r;
  try {
    r = provider === 'http-generic'
      ? await sendViaHttp(s, { to, body })
      : { ok: true, provider: 'logger', ref: `sms_log_${dedupKey}`, error: null };
  } catch (e) {
    r = { ok: false, provider, ref: null, error: String(e?.cause?.message ?? e?.message ?? 'provider call failed') };
  }
  // One structured line per attempt — grep-able, secret-free (P1-2 posture).
  console.log(JSON.stringify({
    kind: 'rails.sms.send', plugin: ID, tenant: tenantId, dedupKey,
    to: `…${String(to).slice(-4)}`, bodyLen: String(body ?? '').length,
    ok: r.ok, provider: r.provider, ref: r.ref ?? null,
    error: r.error ? redactSecrets(r.error).slice(0, 300) : null,
  }));
  return r;
}

// Loader contract: register(app, kernel) — the rail mounts no doors; it only
// binds the kernel q for owner-path settings reads.
export function register(app, kernel) {
  bindKernel(kernel.q);
}
