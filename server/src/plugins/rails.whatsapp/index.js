// rails.whatsapp — the Communication Orchestrator's WhatsApp dispatch rail (Wave A).
// Headless by rule (docs/11 §2.3, comms.whatsapp parity): NO public HTTP door.
// The only surface is an internal kernel-style send function the comms
// dispatcher (scripts/comms-dispatcher.js) calls with rows claimed from
// app.communications — sends are NOT direct, they drain the approved queue.
//
// Difference from rails.sms: template registry reuse. comms.whatsapp (door
// `POST /plugins/comms.whatsapp/templates`, migration 011) keeps DLT templates in
// that plugin's settings → 'templates' map ({ name: { body, dltId } }). This rail
// reads the SAME registry (settings key template_registry_from, default
// 'comms.whatsapp'), renders {template} with {params} ($1-style and {{key}} both),
// and passes the rendered body to the provider. An unregistered template name
// degrades to the raw body (the dispatcher's rows carry a rendered kernel body).
//
// Provider is settings-driven on THIS plugin's row (kernel q() owner path):
//   provider = 'logger' (default) — structured log line + { ok: true }.
//   provider = 'http-generic' — POST { to, body, template, params } as JSON to
//     settings url with a settings-named auth header. No vendor SDK.
//   provider = 'cloud-api' — WhatsApp Cloud API (Graph) text message:
//     POST https://graph.facebook.com/<version>/<phone_number_id>/messages with a
//     Bearer access_token (secret-class, never logged). Settings: phone_number_id,
//     access_token, api_version (default v20.0). L2-3.3 (D-26: code-complete;
//     lights up when the owner's BSP credentials exist).
// Degrades gracefully when unconfigured: no settings row → logger.
// Recipients must be E.164; failures are RETURNED, never thrown.
const ID = 'rails.whatsapp';
export { default as manifest } from './manifest.js';

const E164_RE = /^\+[1-9]\d{7,14}$/; // ITU-T E.164: + then 8–15 digits, no leading 0
const redactSecrets = (s) => String(s ?? '').replace(/(auth_header_value)\s*[=:]\s*\S+/gi, '$1=[redacted]');

// kernel q binding: register() wires it on mount; the dispatcher (a separate
// process, loader-free) calls bindKernel(q) before its first tick.
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

// ── DLT template registry reuse (comms.whatsapp settings → 'templates') ─────────
async function readTemplate(tenantId, templateName) {
  if (!templateName) return null;
  try {
    const from = 'comms.whatsapp'; // registry owner (manifest documents the reuse)
    // registry rows are { body, dltId } objects — take .body, never the JSON blob
    // (a literal `{"body":…}` string sent to a guardian would be a real send bug).
    const r = await kernelQ(
      `SELECT COALESCE(settings->'templates'->>$1, settings->'templates'->$1->>'body') AS body
         FROM app.plugins WHERE tenant_id=$2 AND plugin_id=$3`,
      [String(templateName), tenantId, from]);
    const raw = r.rows[0]?.body ?? null;
    if (raw && raw.trimStart().startsWith('{')) {
      try { return JSON.parse(raw)?.body ?? raw; } catch { return raw; }
    }
    return raw;
  } catch {
    return null; // registry unreadable/absent → degrade to the kernel-rendered body
  }
}

// Renders both common template dialects: $1/$2 positional and {{key}} named.
function renderTemplate(tpl, params) {
  let out = String(tpl);
  const list = Array.isArray(params) ? params : null;
  out = out.replace(/\$\{(\d+)\}|\{(\d+)\}/g, (m, a, b) => {
    const i = Number(a ?? b) - 1;
    return list && list[i] != null ? String(list[i]) : m;
  });
  const map = params && typeof params === 'object' && !Array.isArray(params) ? params : {};
  out = out.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k) => (map[k] != null ? String(map[k]) : m));
  return out;
}

async function sendViaHttp(s, { to, body, template, params }) {
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
    body: JSON.stringify({ to, body: String(body ?? ''), template: template ?? null, params: params ?? null }),
    signal: AbortSignal.timeout(8000), // capability latency_sla.timeout_ms
  });
  if (!res.ok) {
    return { ok: false, provider: 'http-generic', ref: null, error: `provider answered HTTP ${res.status}` };
  }
  let ref = null;
  try {
    const j = await res.json();
    ref = j?.id ?? j?.message_id ?? j?.ref ?? j?.data?.id ?? null;
    if (ref != null) ref = String(ref);
  } catch { /* non-JSON 2xx body — still accepted */ }
  return { ok: true, provider: 'http-generic', ref, error: null };
}

// ── WhatsApp Cloud API (Graph) text messages ──────────────────────────────────
async function sendViaCloudApi(s, { to, body }) {
  if (!s.phone_number_id || !s.access_token) {
    return { ok: false, provider: 'cloud-api', ref: null, error: 'provider cloud-api needs phone_number_id + access_token in plugin settings' };
  }
  const version = String(s.api_version ?? 'v20.0').replace(/^v?/i, 'v');
  const res = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(String(s.phone_number_id))}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${String(s.access_token)}` },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body: String(body ?? '') },
    }),
    signal: AbortSignal.timeout(8000), // capability latency_sla.timeout_ms
  });
  if (!res.ok) {
    return { ok: false, provider: 'cloud-api', ref: null, error: `provider answered HTTP ${res.status}` };
  }
  let ref = null;
  try {
    const j = await res.json();
    ref = j?.messages?.[0]?.id ?? null; // wamid — the provider receipt
    if (ref != null) ref = String(ref);
  } catch { /* non-JSON 2xx body — still accepted */ }
  return { ok: true, provider: 'cloud-api', ref, error: null };
}

/**
 * sendWhatsapp({ to, template, params, body, dedupKey, tenantId }) — internal rail
 * function (NOT a door). Resolves the tenant's settings + the DLT registry body,
 * dispatches per provider, and RETURNS { ok, provider, ref, body, error } — it
 * inserts nothing itself; row bookkeeping is the dispatcher's. The dedup key IS
 * the receipt of approval — a send without one is refused.
 */
export async function sendWhatsapp({ to, template, params, body, dedupKey, tenantId }) {
  if (!tenantId) return { ok: false, provider: 'logger', ref: null, body, error: 'sendWhatsapp requires tenantId (queue rows carry it)' };
  if (!dedupKey) return { ok: false, provider: 'logger', ref: null, body, error: 'sendWhatsapp requires dedupKey (approval receipt from the orchestrator)' };
  if (!E164_RE.test(String(to ?? ''))) {
    return { ok: false, provider: 'logger', ref: null, body, error: 'recipient must be E.164 (+countrycode…)' };
  }
  const s = await readSettings(tenantId);
  const provider = ['logger', 'http-generic', 'cloud-api'].includes(s.provider) ? s.provider : 'logger';
  // template registry reuse: the registered DLT body wins; queue body is the fallback
  const tplBody = await readTemplate(tenantId, template);
  const finalBody = tplBody ? renderTemplate(tplBody, params) : String(body ?? '');
  let r;
  try {
    r = provider === 'http-generic'
      ? await sendViaHttp(s, { to, body: finalBody, template, params })
      : provider === 'cloud-api'
        ? await sendViaCloudApi(s, { to, body: finalBody })
        : { ok: true, provider: 'logger', ref: `wa_log_${dedupKey}`, error: null };
  } catch (e) {
    r = { ok: false, provider, ref: null, error: String(e?.cause?.message ?? e?.message ?? 'provider call failed') };
  }
  // One structured line per attempt — grep-able, secret-free (P1-2 posture).
  console.log(JSON.stringify({
    kind: 'rails.whatsapp.send', plugin: ID, tenant: tenantId, dedupKey,
    to: `…${String(to).slice(-4)}`, template: template ?? null, bodyLen: finalBody.length,
    ok: r.ok, provider: r.provider, ref: r.ref ?? null,
    error: r.error ? redactSecrets(r.error).slice(0, 300) : null,
  }));
  return { ok: r.ok, provider: r.provider, ref: r.ref, body: finalBody, error: r.error };
}

// Loader contract: register(app, kernel) — the rail mounts no doors; it only
// binds the kernel q for owner-path settings reads.
export function register(app, kernel) {
  bindKernel(kernel.q);
}
