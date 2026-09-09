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
import { config } from '../src/config.js';
import { sendSms as smsSend, bindKernel as bindSms } from '../src/plugins/rails.sms/index.js';
import { sendWhatsapp as waSend, bindKernel as bindWa } from '../src/plugins/rails.whatsapp/index.js';

const INTERVAL_MS = Number(process.env.COMMS_POLL_MS ?? 2000);
const MAX_ATTEMPTS = Number(process.env.COMMS_MAX_ATTEMPTS ?? 8);
const BATCH = Number(process.env.COMMS_BATCH ?? 20);
const BACKOFF_BASE_MS = Number(process.env.COMMS_BACKOFF_BASE_MS ?? 2000);
const BACKOFF_MAX_MS = Number(process.env.COMMS_BACKOFF_MAX_MS ?? 300000);
const PARKED_PREFIX = 'max attempts reached — parked for inspection: ';

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 4 });
let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { stopping = true; setTimeout(() => process.exit(0), 8000).unref(); });

// Rails resolve per-tenant settings through the kernel owner path — bind this
// process's owner pool as their q (register() does the same in the API process).
bindSms((text, params) => pool.query(text, params));
bindWa((text, params) => pool.query(text, params));

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
}

const backoffMs = (attempts) => Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_MAX_MS);

// audience_json entries are usually phone strings ([g.phone] in kernel sends) or
// {phone|to|mobile|name} objects; normalize the first usable one to E.164.
const toE164 = (v) => {
  const d = String(v ?? '').replace(/[\s()\-–]/g, '');
  if (!/^\+?\d{8,15}$/.test(d)) return null;
  return d.startsWith('+') ? d : `+${d}`;
};
const recipientOf = (row) => {
  const aud = Array.isArray(row.audience_json) ? row.audience_json : [];
  for (const entry of aud) {
    if (entry && typeof entry === 'object') {
      const hit = toE164(entry.phone ?? entry.to ?? entry.mobile ?? entry.number);
      if (hit) return hit;
    } else {
      const hit = toE164(entry);
      if (hit) return hit;
    }
  }
  return null;
};

async function dispatch(row) {
  // kernel channel spellings vary ('whatsapp', 'WhatsApp' from the action path) —
  // match case-insensitively; rows without a dedup_key (e.g. FEE_RECEIPT) take the
  // row id as their deterministic dedup identity.
  const ch = String(row.channel ?? '').toLowerCase();
  const dedupKey = row.dedup_key ?? `comm_${row.id}`;
  const to = recipientOf(row);
  if ((ch === 'sms' || ch === 'whatsapp') && to) {
    if (ch === 'sms') {
      return smsSend({ to, body: row.body, dedupKey, tenantId: row.tenant_id });
    }
    // params: audience entries may be objects (named params); strings fall back
    // to the kernel-rendered body via sendWhatsapp's registry→body degradation.
    const aud = Array.isArray(row.audience_json) ? row.audience_json : [];
    const params = aud.find((e) => e && typeof e === 'object' && !Array.isArray(e)) ?? null;
    return waSend({ to, template: row.template ?? null, params, body: row.body, dedupKey, tenantId: row.tenant_id });
  }
  // No rail for this channel, or no resolvable E.164 recipient (e.g. generic
  // receipt rows with empty audience_json) — the durable log line IS the v1
  // delivery: the queue still drains (graceful degradation), the reason is on
  // the record, and a data gap can never poison the queue into parked failures.
  console.log(JSON.stringify({ kind: 'comms.dispatch.logonly', id: row.id, tenant: row.tenant_id, channel: row.channel, template: row.template ?? null, dedupKey: row.dedup_key ?? null, bodyLen: String(row.body ?? '').length, reason: to ? 'no rail for channel' : 'no E.164 recipient in audience_json' }));
  return { ok: true, provider: 'log-only', ref: row.id, error: null };
}

async function tick() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const due = await c.query(
      `SELECT id, tenant_id, channel, template, body, audience_json, dedup_key, attempts
       FROM app.communications
       WHERE status='queued'
         AND (next_attempt_at IS NULL OR next_attempt_at <= now())
         AND attempts < $1
       ORDER BY created_at
       LIMIT $2
       FOR UPDATE SKIP LOCKED`, [MAX_ATTEMPTS, BATCH]);
    let okCount = 0;
    for (const row of due.rows) {
      const attempts = row.attempts + 1; // counted unconditionally, before the rail runs
      const r = await dispatch(row);
      if (r?.ok) {
        await c.query(
          `UPDATE app.communications SET status='sent', sent_at=now(), attempts=$2, last_error=NULL, next_attempt_at=NULL WHERE id=$1`,
          [row.id, attempts]);
        okCount++;
      } else if (attempts >= MAX_ATTEMPTS) {
        // park like the outbox relay: status='failed', error says why, no retry date
        await c.query(
          `UPDATE app.communications SET status='failed', attempts=$2, next_attempt_at=NULL,
                  last_error=$3 || left($4, 500)
           WHERE id=$1`, [row.id, attempts, PARKED_PREFIX, String(r?.error ?? 'unknown failure')]);
      } else {
        await c.query(
          `UPDATE app.communications SET attempts=$2, last_error=left($3, 500),
                  next_attempt_at = now() + ($4 || ' milliseconds')::interval
           WHERE id=$1`, [row.id, attempts, String(r?.error ?? 'unknown failure'), String(backoffMs(attempts))]);
      }
    }
    await c.query('COMMIT');
    if (okCount !== due.rows.length) console.error(`comms dispatcher: ${okCount} sent, ${due.rows.length - okCount} scheduled for retry`);
    else if (okCount) console.error(`comms dispatcher: sent ${okCount}`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('comms dispatcher tick failed:', e.message);
  } finally {
    c.release();
  }
}

console.log(`comms dispatcher on ${INTERVAL_MS}ms poll (batch ${BATCH}, max attempts ${MAX_ATTEMPTS}, backoff ${BACKOFF_BASE_MS}→${BACKOFF_MAX_MS}ms)`);
await ensureSchema();
while (!stopping) {
  await tick().catch((e) => console.error('dispatcher fatal:', e));
  await new Promise((r) => setTimeout(r, INTERVAL_MS));
}
console.log('comms dispatcher stopped');
await pool.end();
