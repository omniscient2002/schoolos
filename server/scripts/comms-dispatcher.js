#!/usr/bin/env node
// Comms dispatcher (Wave A) — the queue drain docs/DATA-FLOW §20 flagged missing:
// kernel-approved sends land in app.communications as status='queued' and nothing
// consumed them. Model: scripts/outbox-worker.js (042 retry semantics) —
//   · claim due rows FOR UPDATE SKIP LOCKED so many workers can run concurrently,
//   · resolve the rail by channel: 'sms' → rails.sms.sendSms,
//     'whatsapp' → rails.whatsapp.sendWhatsapp, anything else → durable log-only
//     line (the honest v1 for channels without a rail),
//   · rails RETURN {ok, provider, ref, error} and insert nothing — THIS worker
//     owns the row bookkeeping: success → status='sent' + sent_at; failure →
//     attempts bump + last_error + exponential next_attempt_at backoff; the
//     attempts cap parks the row as status='failed' (outbox parity).
// Failure semantics mirror outbox-worker.js exactly: attempts counted for EVERY
// claimed row before its rail runs, backoff paces poison rows, a PG-level error
// aborts the whole tick (claimed rows roll back unmarked — at-least-once).
// Graceful SIGTERM/SIGINT: stop claiming, finish, exit.
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { config } from '../src/config.js';
import { sendSms as smsSend, bindKernel as bindSms } from '../src/plugins/rails.sms/index.js';
import { sendWhatsapp as waSend, bindKernel as bindWa } from '../src/plugins/rails.whatsapp/index.js';
import { sendEmail as emailSend, bindKernel as bindEmail } from '../src/plugins/rails.email/index.js';

const INTERVAL_MS = Number(process.env.COMMS_POLL_MS ?? 2000);
const MAX_ATTEMPTS = Number(process.env.COMMS_MAX_ATTEMPTS ?? 8);
const BATCH = Number(process.env.COMMS_BATCH ?? 20);
const BACKOFF_BASE_MS = Number(process.env.COMMS_BACKOFF_BASE_MS ?? 2000);
const BACKOFF_MAX_MS = Number(process.env.COMMS_BACKOFF_MAX_MS ?? 300000);
const PARKED_PREFIX = 'max attempts reached — parked for inspection: ';
// PRD-13: a sandbox carrier's "success" is not a delivery, and in production it must never be
// recorded as one. Kept distinct from PARKED_PREFIX so an operator can tell "we gave up retrying"
// from "there was never a carrier to retry with".
const SANDBOX_PREFIX = 'undeliverable — sandbox carrier in production: ';

/** The sandbox rule lives in src/plugins/_shared/delivery-honesty.js so that the doors which send
 *  DIRECTLY and write their own ledger row (the reset door, and any future one) cannot invent their
 *  own version of it. Re-exported from here because this is where callers already look. */
export { isSandboxCarrier, isSandboxResult } from '../src/plugins/_shared/delivery-honesty.js';
import { isSandboxResult, sandboxAllowed } from '../src/plugins/_shared/delivery-honesty.js';
import { toE164 as sharedToE164 } from '../src/plugins/_shared/phone.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 4 });
const WORKER_ID = randomUUID();
let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { stopping = true; setTimeout(() => process.exit(0), 8000).unref(); });

// Rails resolve per-tenant settings through the kernel owner path — bind this
// process's owner pool as their q (register() does the same in the API process).
bindSms((text, params) => pool.query(text, params));
bindWa((text, params) => pool.query(text, params));
bindEmail((text, params) => pool.query(text, params));

// 043 adds attempts/last_error/next_attempt_at; tolerate a pre-043 database so
// the worker never hard-crashes on boot (outbox-worker ensureSchema parity).
async function ensureSchema() {
  const r = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema='app' AND table_name='communications' AND column_name='next_attempt_at'`);
  if (!r.rows[0]) {
    await pool.query(`ALTER TABLE app.communications ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 1`);
    await pool.query(`ALTER TABLE app.communications ADD COLUMN IF NOT EXISTS last_error text`);
    await pool.query(`ALTER TABLE app.communications ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz`);
    console.error('comms dispatcher: added 043 columns to app.communications (043 not applied to this database yet — run scripts/migrate.js)');
  }
  await pool.query(`ALTER TABLE app.communications ADD COLUMN IF NOT EXISTS claimed_at timestamptz`);
  await pool.query(`ALTER TABLE app.communications ADD COLUMN IF NOT EXISTS claimed_by text`);
}

const backoffMs = (attempts) => Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_MAX_MS);

// audience_json entries are usually phone strings ([g.phone] in kernel sends) or
// {phone|to|mobile|name} objects; normalize the first usable one to E.164.
// Shared with every door that hands a number to a rail — see src/plugins/_shared/phone.js. The local
// copy this replaces knew nothing about Indian subscriber numbers, so a bare 10-digit audience entry
// became `+9876500099` (a wrong-country number) instead of `+919876500099`.
const toE164 = sharedToE164;
// The first-recipient helpers that used to live here are gone (PRD-13): `recipientOf` picked ONE
// address and the row was then recorded 'sent', so a 300-guardian notice reached one person. The
// audience was always a list. `recipientsOf` / `recipientEmailsOf` below are the honest replacement —
// keep it that way rather than reintroducing a single-address shortcut.

// audience entries may also carry email addresses (email-channel rows) — accept a bare string or an
// {email|to} object. The rule is the project's existing one (`src/onboarding.js:26` EMAIL_RE and the
// reset door at `src/app.js:563` carry the same pattern — noted for cleanup rather than copied silently).
//
// RESTORED after a self-inflicted deletion: removing the dead single-recipient helpers took this
// definition with them, and `l2-rails-live`'s email test caught it immediately (`toEmail is not a
// function`). Kept here rather than in a shared module because it is two lines and the two existing
// copies are byte-identical — unlike the phone rule, where the copies actually disagreed.
const toEmail = (v) => {
  const s = String(v ?? '').trim();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? s : null;
};

/** Every usable recipient in the audience, in order, de-duplicated.
 *
 *  PRD-13: `recipientOf` returns only the FIRST one, and the caller then marked the whole row 'sent' —
 *  so a notice queued for 300 guardians reached exactly one and the ledger said it was delivered. The
 *  row's audience has always been a LIST; treating it as a single address was the fabrication. Capped so
 *  one row cannot monopolise a tick. The cap REFUSES rather than truncates: silently dropping the tail
 *  and then reporting "50/50 recipients" would be the same lie in a new place, so an over-cap audience
 *  comes back ok:false with a reason the operator can act on. */
const MAX_RECIPIENTS = Number(process.env.COMMS_MAX_RECIPIENTS ?? 500);
/* TST-4: the drain path was only ever tested by a test that RE-IMPLEMENTED these three steps inline, so
   it passed with this whole file deleted. Exporting the real tick (and a shutdown, so a test process can
   end without a stranded pool) is what makes the dispatcher itself testable. */
export const shutdown = () => pool.end();
export function recipientsOf(row) {
  const aud = Array.isArray(row.audience_json) ? row.audience_json : [];
  const out = [];
  for (const entry of aud) {
    const hit = entry && typeof entry === 'object'
      ? toE164(entry.phone ?? entry.to ?? entry.mobile ?? entry.number)
      : toE164(entry);
    if (hit && !out.includes(hit)) out.push(hit);
    if (out.length >= MAX_RECIPIENTS) break;
  }
  return out;
}

/** Did we truncate? Callers must refuse rather than send a prefix and call it a whole delivery. */
export const overRecipientCap = (row) => {
  const aud = Array.isArray(row.audience_json) ? row.audience_json : [];
  return aud.length > MAX_RECIPIENTS;
};

/** Same, for the email channel. */
export function recipientEmailsOf(row) {
  const aud = Array.isArray(row.audience_json) ? row.audience_json : [];
  const out = [];
  for (const entry of aud) {
    const hit = entry && typeof entry === 'object' ? toEmail(entry.email ?? entry.to) : toEmail(entry);
    if (hit && !out.includes(hit)) out.push(hit);
    if (out.length >= MAX_RECIPIENTS) break;
  }
  return out;
}

/** Send to EVERY recipient and report the truth about how many were reached.
 *
 *  Returns a rail-shaped result the caller already understands, with two extra fields:
 *    sentCount / totalCount. All reached → ok:true with `ref` naming the count, so the persisted receipt
 *  says "12/12" and a reader never has to guess. PARTIAL is not success: it comes back ok:false with the
 *  first error, so the row lands in the retry/park path and its last_error says "2 of 3 delivered" — a
 *  broadcast that half-arrived must not read `sent` on any screen. */
export async function fanOut(send, targets, label) {
  const total = targets.length;
  let sent = 0;
  let firstError = null;
  let provider = null;
  let ref = null;
  for (const to of targets) {
    const r = await send(to);
    if (r?.provider) provider = r.provider;
    if (r?.ok) {
      sent += 1;
      if (ref == null) ref = r.ref ?? null;
    } else if (firstError == null) {
      firstError = r?.error ?? 'provider error';
    }
  }
  const count = `${sent}/${total} ${label}`;
  if (sent === total && total > 0) return { ok: true, provider, ref: ref == null ? count : `${ref} (${count})`, error: null, sentCount: sent, totalCount: total };
  return {
    ok: false, provider, ref: null, sentCount: sent, totalCount: total,
    error: sent === 0
      ? String(firstError ?? 'no recipient accepted')
      : `${sent} of ${total} ${label} delivered; first failure: ${firstError}`,
  };
}

async function dispatch(row) {
  // kernel channel spellings vary ('whatsapp', 'WhatsApp' from the action path) —
  // match case-insensitively; rows without a dedup_key (e.g. FEE_RECEIPT) take the
  // row id as their deterministic dedup identity.
  const ch = String(row.channel ?? '').toLowerCase();
  const dedupKey = row.dedup_key ?? `comm_${row.id}`;
  if ((ch === 'sms' || ch === 'whatsapp' || ch === 'email') && overRecipientCap(row)) {
    return {
      ok: false, provider: null, ref: null, sentCount: 0, totalCount: Array.isArray(row.audience_json) ? row.audience_json.length : 0,
      error: `audience of ${Array.isArray(row.audience_json) ? row.audience_json.length : 0} exceeds the per-row cap of ${MAX_RECIPIENTS} — nothing was sent; split the notice or raise COMMS_MAX_RECIPIENTS`,
    };
  }
  if (ch === 'sms' || ch === 'whatsapp') {
    const targets = recipientsOf(row);
    if (targets.length > 0) {
      // params: audience entries may be objects (named params); strings fall back
      // to the kernel-rendered body via sendWhatsapp's registry→body degradation.
      const aud = Array.isArray(row.audience_json) ? row.audience_json : [];
      const params = aud.find((e) => e && typeof e === 'object' && !Array.isArray(e)) ?? null;
      return fanOut(
        ch === 'sms'
          ? (to) => smsSend({ to, body: row.body, dedupKey, tenantId: row.tenant_id })
          : (to) => waSend({ to, template: row.template ?? null, params, body: row.body, dedupKey, tenantId: row.tenant_id }),
        targets, 'recipients');
    }
  }
  if (ch === 'email') {
    const targets = recipientEmailsOf(row);
    if (targets.length > 0) {
      // subject: template name when present, else a neutral honest line
      const subject = row.template
        ? `SchoolOS · ${String(row.template).replace(/[_-]+/g, ' ').toLowerCase()}`
        : 'A message from your school (SchoolOS)';
      return fanOut(
        (to) => emailSend({ to, subject, body: row.body, dedupKey, tenantId: row.tenant_id }),
        targets, 'addresses');
    }
  }
  // No rail for this channel, or no resolvable E.164 recipient (e.g. generic
  // receipt rows with empty audience_json) — the durable log line IS the v1
  // delivery: the queue still drains (graceful degradation), the reason is on
  // the record, and a data gap can never poison the queue into parked failures.
  //
  // CORRECTION (PRD-13): "the reason is on the record" was not true as written — the caller's success
  // path deliberately sets last_error = NULL, so `provider='log-only'` was the ONLY surviving trace,
  // next to a status that read 'sent'. Since PRD-13 a log-only result is undeliverable in PRODUCTION
  // and carries its reason in last_error; in a sandbox it still drains as before, and the sandbox
  // population is counted by schoolos_comms_sandbox_sent so it is never invisible either way.
  console.log(JSON.stringify({ kind: 'comms.dispatch.logonly', id: row.id, tenant: row.tenant_id, channel: row.channel, template: row.template ?? null, dedupKey: row.dedup_key ?? null, bodyLen: String(row.body ?? '').length, reason: ch === 'email' ? 'no email address in audience_json' : 'no E.164 recipient in audience_json' }));
  return { ok: true, provider: 'log-only', ref: row.id, error: null, sentCount: 0, totalCount: 0 };
}

// One row's rail call + bookkeeping (exported for tests; tick's loop body).
// Outcomes: 'sent' | 'retry' | 'parked' | 'undeliverable'.
// 'sent' means "handed to the carrier named in `provider`" — which in a sandbox is the logger, and in
// production is now guaranteed to be a real one. 'undeliverable' is terminal sandbox-in-production
// (PRD-13); 'parked' is "retried to the cap and still failing". Provider receipts (058) are persisted
// on success — provider + provider_ref answer "who carried it, with what ref".
export async function processClaimedRow(c, row, { maxAttempts = MAX_ATTEMPTS, allowSandbox = sandboxAllowed(config.env) } = {}) {
  const attempts = row.attempts + 1; // counted unconditionally, before the rail runs
  const r = await dispatch(row);
  if (r?.ok) {
    // ── PRD-13 · COMMS HONESTY. This is the exact point where the ledger used to lie. ────────────
    // `dispatch` returns ok for a SANDBOX carrier — rails.sms/rails.email return ok:true with
    // provider 'logger' whenever no real provider is configured, which covers every tenant without
    // credentials AND every tenant whose settings read failed, and the log-only branch below returns
    // ok:true by construction. Stamping status='sent' on that is the fabrication: the row, the UI and
    // any audit read "sent" while nothing left the building. SEC-0 already recorded the same
    // realisation for the RESET door ("sandbox is the permanent default for any tenant without SMTP
    // credentials ... so this was never a developer-only state") and gated that door on the channel
    // existing; this is the same rule at the choke point every other message passes through.
    //
    // In production a sandbox result is NOT a delivery: it is terminal, it never sets sent_at, and the
    // reason is on the record. In a sandbox it stays exactly as it was — the sandbox tests pin that
    // path deliberately, and the fix is not to pretend dev is production.
    const carrier = r.provider;
    if (!allowSandbox && isSandboxResult(r)) {
      const why = `the "${String(carrier || 'log-only')}" carrier only writes a log line — no message would reach ${row.channel} recipient; configure a real provider for this school's rail`;
      await c.query(
        `UPDATE app.communications SET status='failed', attempts=$2, next_attempt_at=NULL,
                last_error=$3 || $4, provider=$5, sent_at=NULL, claimed_at=NULL, claimed_by=NULL
         WHERE id=$1`,
        [row.id, attempts, SANDBOX_PREFIX, why, String(carrier || 'log-only')]);
      return { outcome: 'undeliverable', attempts, provider: carrier, error: why };
    }
    await c.query(
      `UPDATE app.communications SET status='sent', sent_at=now(), attempts=$2, last_error=NULL,
              next_attempt_at=NULL, provider=$3, provider_ref=$4, claimed_at=NULL, claimed_by=NULL WHERE id=$1`,
      [row.id, attempts, String(r.provider ?? 'unknown'), r.ref != null ? String(r.ref) : null]);
    return { outcome: 'sent', attempts, provider: r.provider, ref: r.ref };
  }
  const errText = String(r?.error ?? 'unknown failure');
  if (attempts >= maxAttempts) {
    // park like the outbox relay: status='failed', error says why, no retry date
    // (status='failed' IS the dead-letter state — the DLQ is a query, not a table)
    await c.query(
      `UPDATE app.communications SET status='failed', attempts=$2, next_attempt_at=NULL,
              last_error=$3 || left($4, 500), provider=$5, claimed_at=NULL, claimed_by=NULL
       WHERE id=$1`, [row.id, attempts, PARKED_PREFIX, errText, String(r?.provider ?? 'unknown')]);
    return { outcome: 'parked', attempts, error: errText };
  }
  await c.query(
    `UPDATE app.communications SET attempts=$2, last_error=left($3, 500), provider=$4,
            next_attempt_at = now() + ($5 || ' milliseconds')::interval, claimed_at=NULL, claimed_by=NULL
     WHERE id=$1`, [row.id, attempts, errText, String(r?.provider ?? 'unknown'), String(backoffMs(attempts))]);
  return { outcome: 'retry', attempts, nextMs: backoffMs(attempts), error: errText };
}

export async function tick() {
  const c = await pool.connect();
  let claimReleased = false;
  let due = { rows: [] };
  try {
    await c.query('BEGIN');
    due = await c.query(
      `SELECT id, tenant_id, channel, template, body, audience_json, dedup_key, attempts
       FROM app.communications
       WHERE status='queued'
         AND (next_attempt_at IS NULL OR next_attempt_at <= now())
         AND attempts < $1
         AND (claimed_at IS NULL OR claimed_at < now() - interval '10 minutes')
       ORDER BY created_at
       LIMIT $2
       FOR UPDATE SKIP LOCKED`, [MAX_ATTEMPTS, BATCH]);
    if (due.rows.length) await c.query(`UPDATE app.communications SET claimed_at=now(), claimed_by=$1 WHERE id = ANY($2::uuid[])`, [WORKER_ID, due.rows.map((r) => r.id)]);
    await c.query('COMMIT');
    c.release();
    claimReleased = true;
    let okCount = 0;
    // Provider calls happen outside the claim transaction. Each row gets its
    // own short bookkeeping transaction, so a slow rail cannot hold locks on a
    // whole batch or block another dispatcher.
    for (const row of due.rows) {
      const rowClient = await pool.connect();
      try {
        const res = await processClaimedRow(rowClient, row);
        if (res.outcome === 'sent') okCount++;
      } catch (e) {
        console.error(`comms dispatcher row ${row.id} failed:`, e.message);
      } finally { rowClient.release(); }
    }
    if (okCount !== due.rows.length) console.error(`comms dispatcher: ${okCount} sent, ${due.rows.length - okCount} scheduled for retry`);
    else if (okCount) console.error(`comms dispatcher: sent ${okCount}`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('comms dispatcher tick failed:', e.message);
  } finally {
    // The committed claim path releases c above; rollback paths still own it.
    if (!claimReleased) c.release();
  }
}

// CLI guard: `node scripts/comms-dispatcher.js` runs the worker; importing the
// module (tests, tooling) only gets the exported functions — no loop, no pool churn.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`comms dispatcher on ${INTERVAL_MS}ms poll (batch ${BATCH}, max attempts ${MAX_ATTEMPTS}, backoff ${BACKOFF_BASE_MS}→${BACKOFF_MAX_MS}ms)`);
  await ensureSchema();
  while (!stopping) {
    await tick().catch((e) => console.error('dispatcher fatal:', e));
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  console.log('comms dispatcher stopped');
  await pool.end();
}
