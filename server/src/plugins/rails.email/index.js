// rails.email — the Communication Orchestrator's EMAIL rail (Wave 2, L2-2.2).
// Headless by rule (rails.sms parity): NO public HTTP door. The only surface is
// the internal sendEmail function; sends are queued-drained or system-triggered
// (password reset), never a side door around approval.
//
// Provider is settings-driven (per-tenant app.plugins.settings, owner-path read):
//   provider = 'logger' (default, sandbox) — structured log line + { ok: true };
//     ok means "accepted for delivery", never "carrier confirmed" (D-26: ships
//     sandbox-verified; real sends light up the moment SMTP credentials exist).
//   provider = 'smtp' — minimal raw SMTP client (node:net, STARTTLS via node:tls).
//     Settings: host (required), port (587 default), secure (implicit TLS, 465),
//     username, password (secret-class, never logged), from_address (required).
// Degrades gracefully when unconfigured: no settings row → logger.
// Failures are RETURNED, never thrown (rails.sms parity).
const ID = 'rails.email';
export { default as manifest } from './manifest.js';
import { decryptSettings } from '../../settings-crypto.js';
import net from 'node:net';
import tls from 'node:tls';

const redactSecrets = (s) => String(s ?? '')
  .replace(/(password|secret|token)\s*[=:]\s*\S+/gi, '$1=[redacted]');

let kernelQ = null;
export function bindKernel(ownerQuery) { kernelQ = ownerQuery; }

async function readSettings(tenantId) {
  try {
    const r = await kernelQ(`SELECT settings FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`, [tenantId, ID]);
    return decryptSettings(r.rows[0]?.settings ?? {}, tenantId);
  } catch (e) {
    console.error(`${ID}: settings read failed — degrading to logger provider:`, e.message);
    return {};
  }
}

// ── minimal raw SMTP client (RFC 5321 subset; no vendor SDK, no heavy deps) ──
// Speaks: EHLO, STARTTLS (socket upgrade), optional AUTH LOGIN, MAIL FROM,
// RCPT TO, DATA, QUIT. Responses may be multiline ("250-x … 250 y"): a response
// ends at the first line matching /^\d{3} / (code + space, no dash).
function smtpSend(s, { to, subject, body }) {
  return new Promise((resolve) => {
    const port = Number(s.port) || (s.secure ? 465 : 587);
    const state = { stage: 'greeting', buf: '', done: false, lines: [] }; // S0 fix H1: multiline accumulator
    const finish = (r) => { if (state.done) return; state.done = true; try { state.socket?.end(); } catch { /* noop */ } resolve(r); };
    const fail = (error) => finish({ ok: false, provider: 'smtp', sandbox: false, ref: null, error });

    const write = (line) => { try { state.socket.write(`${line}\r\n`); } catch (e) { fail(String(e?.message ?? 'socket write failed')); } };

    const startStage = {
      greeting(text, code) { if (code !== 220) return fail(`SMTP greeting refused: ${firstLine(text)}`); write('EHLO schoolos.local'); setStage('ehlo'); },
    };
    // ehlo runs twice (plain, then after STARTTLS); shared body via makeEhlo()
    const makeEhlo = (nextStage) => (text, code) => {
      if (code !== 250) return fail(`EHLO refused: ${firstLine(text)}`);
      if (!state.tlsActive && /starttls/i.test(text)) { write('STARTTLS'); setStage('starttls'); return; } // S0 fix H2: runtime state, not the settings flag — no second STARTTLS inside TLS
      if (s.username && s.password) { write('AUTH LOGIN'); setStage('auth_user'); return; }
      write(`MAIL FROM:<${String(s.from_address ?? '').replace(/[\r\n<>]/g, '')}>`); setStage('mail_from'); // S0 fix H22
    };
    const stages = {
      ehlo: makeEhlo('ehlo2'),
      ehlo2: makeEhlo('ehlo2'),
      starttls(text, code) {
        if (code !== 220) return fail(`STARTTLS refused: ${firstLine(text)}`);
        // upgrade the raw socket in place; resume the command stream over TLS
        const raw = state.socket;
        const sec = tls.connect({ socket: raw, rejectUnauthorized: s.reject_unauthorized !== false }, () => { /* resumed by data events */ });
        state.socket = sec;
        state.tlsActive = true; // S0 fix H2
        attach(sec);
        write('EHLO schoolos.local');
        setStage('ehlo2');
      },
      auth_user(text, code) { if (code !== 334) return fail(`SMTP AUTH refused: ${firstLine(text)}`); write(Buffer.from(String(s.username)).toString('base64')); setStage('auth_pass'); },
      auth_pass(text, code) { if (code !== 235) return fail('SMTP AUTH rejected (credentials)'); write(`MAIL FROM:<${s.from_address}>`); setStage('mail_from'); },
      mail_from(text, code) { if (code !== 250) return fail(`MAIL FROM refused: ${firstLine(text)}`); write(`RCPT TO:<${to}>`); setStage('rcpt_to'); },
      rcpt_to(text, code) { if (code !== 250 && code !== 251) return fail(`RCPT TO refused: ${firstLine(text)}`); write('DATA'); setStage('data'); },
      data(text, code) {
        if (code !== 354) return fail(`DATA refused: ${firstLine(text)}`);
        write(`From: SchoolOS <${s.from_address}>`);
        write(`To: <${to}>`);
        write(`Subject: ${String(subject ?? '').replace(/[\r\n]+/g, ' ')}`);
        write('MIME-Version: 1.0');
        write('Content-Type: text/plain; charset=utf-8');
        write('');
        write(String(body ?? '').replace(/(^|\r\n)\./g, '$1..')); // dot-stuffing (RFC 5321 §4.5.2)
        write('.');
        setStage('accepted');
      },
      accepted(text, code) { if (code !== 250) return fail(`message refused: ${firstLine(text)}`); finish({ ok: true, provider: 'smtp', sandbox: false, ref: `smtp_${Date.now()}`, error: null }); },
    };
    const setStage = (name) => { state.stage = name; };
    const firstLine = (t) => String(t).split('\r\n')[0].trim().slice(0, 120);

    const attach = (socket) => {
      socket.setEncoding('utf8');
      socket.on('data', (chunk) => {
        if (state.done) return;
        state.buf += chunk;
        // dispatch once per COMPLETE response (final line = "NNN ")
        let idx;
        while ((idx = state.buf.indexOf('\r\n')) !== -1) {
          const line = state.buf.slice(0, idx);
          state.buf = state.buf.slice(idx + 2);
          // S0 fix H1 (HIGH): only code+SPACE terminates a response — dash lines are
          // continuations (EHLO capabilities). Treating "250-…" as complete meant
          // STARTTLS was never seen on :587 and leftover lines desynced the state
          // machine against real providers.
          state.lines.push(line);
          if (!/^\d{3} /.test(line)) continue;
          const text = state.lines.join('\n'); state.lines = [];
          const code = parseInt(text.slice(0, 3), 10);
          const handler = stages[state.stage] ?? startStage[state.stage];
          if (!handler) return fail(`unexpected SMTP stage ${state.stage}`);
          handler(text, code); // full accumulated response (all EHLO capability lines)
          return; // one command → one response; the rest waits for the next turn
        }
      });
      socket.on('error', (e) => { if (!state.done) fail(String(e?.message ?? 'socket error')); });
    };

    const socket = s.secure
      ? tls.connect({ host: s.host, port, rejectUnauthorized: s.reject_unauthorized !== false }, () => { /* greeting arrives as data */ })
      : net.connect({ host: s.host, port }, () => { /* greeting arrives as data */ });
    state.socket = socket;
    socket.setTimeout(8000, () => fail('SMTP timeout after 8s'));
    attach(socket);
  });
}

/**
 * sendEmail({ to, subject, body, dedupKey, tenantId }) — internal rail function
 * (NOT a door). Resolves the tenant's settings, dispatches per provider, and
 * RETURNS { ok, provider, ref, sandbox, error } — inserts nothing itself; the
 * caller records the delivery artifact. The dedup key is the receipt of
 * authorization (orchestrator approval, or a system-trigger token for
 * self-service flows like password reset).
 */
export async function sendEmail({ to, subject, body, dedupKey, tenantId }) {
  if (!tenantId) return { ok: false, provider: 'logger', sandbox: true, ref: null, error: 'sendEmail requires tenantId' };
  if (!dedupKey) return { ok: false, provider: 'logger', sandbox: true, ref: null, error: 'sendEmail requires dedupKey (approval receipt)' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(to ?? ''))) {
    return { ok: false, provider: 'logger', sandbox: true, ref: null, error: 'recipient must be a valid email address' };
  }
  const s = await readSettings(tenantId);
  const provider = ['logger', 'smtp'].includes(s.provider) ? s.provider : 'logger';
  let r;
  try {
    r = provider === 'smtp'
      ? (!s.host || !s.from_address
        ? { ok: false, provider: 'smtp', sandbox: false, ref: null, error: 'provider smtp needs host + from_address in plugin settings' }
        : await smtpSend(s, { to, subject, body }))
      : { ok: true, provider: 'logger', sandbox: true, ref: `email_log_${dedupKey}`, error: null };
  } catch (e) {
    r = { ok: false, provider, sandbox: provider === 'logger', ref: null, error: String(e?.cause?.message ?? e?.message ?? 'provider call failed') };
  }
  // One structured line per attempt — grep-able, secret-free (rails.sms parity).
  console.log(JSON.stringify({
    kind: 'rails.email.send', plugin: ID, tenant: tenantId, dedupKey,
    to: String(to).replace(/(.{2}).*(@.*)/, '$1***$2'), bodyLen: String(body ?? '').length,
    subject: String(subject ?? '').slice(0, 80),
    ok: r.ok, provider: r.provider, sandbox: !!r.sandbox, ref: r.ref ?? null,
    error: r.error ? redactSecrets(r.error).slice(0, 300) : null,
  }));
  return r;
}

// Loader contract: register(app, kernel) — the rail mounts no doors; it only
// binds the kernel q for owner-path settings reads.
export function register(app, kernel) {
  bindKernel(kernel.sysq);
}
