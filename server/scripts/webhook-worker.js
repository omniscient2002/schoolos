#!/usr/bin/env node
// Webhook delivery worker (L2-4.1, Wave 4) — the outbound half of the event spine.
//   1. enqueueFromEvents: UNDISCOVERED app.outbox rows (state-based, migration
//      076) → delivery rows for matching active subscriptions (topic match, '*'
//      wildcard; UNIQUE(sub, event) = at-least-once exactly-once-scheduled).
//   2. processDueDeliveries: claim FOR UPDATE SKIP LOCKED → POST the event JSON
//      with an HMAC signature (X-SchoolOS-Signature: t=<unix>,v1=hmac_sha256(secret,
//      t + '.' + body)) → bookkeeping mirrors outbox/comms: attempts counted per
//      claim, exponential backoff, attempts cap parks status='failed' (DLQ-as-query).
// Importable (tests/day-tooling): exports { enqueueFromEvents, processDueDeliveries,
// signPayload } — the CLI guard keeps `node scripts/webhook-worker.js` the only
// looping path. 8s send timeout; secrets never logged.
import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { createHmac } from 'node:crypto';
import { config } from '../src/config.js';
import { assertPublicWebhookUrl } from '../src/plugins/_shared/webhook-target.js';

const INTERVAL_MS = Number(process.env.WEBHOOK_POLL_MS ?? 5000);
const MAX_ATTEMPTS = Number(process.env.WEBHOOK_MAX_ATTEMPTS ?? 8);
const BATCH = Number(process.env.WEBHOOK_BATCH ?? 25);
const BACKOFF_BASE_MS = Number(process.env.WEBHOOK_BACKOFF_BASE_MS ?? 2000);
const BACKOFF_MAX_MS = Number(process.env.WEBHOOK_BACKOFF_MAX_MS ?? 300000);
// DAT-4/076: the discovery page size. Bounded so one tick cannot try to catch up an unbounded
// backlog, but large enough that a normal tick drains everything outstanding.
const SCAN_BATCH = Number(process.env.WEBHOOK_SCAN_BATCH ?? 500);
const PARKED_PREFIX = 'max attempts reached — parked for inspection: ';

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 4 });
let stopping = false;
// OPSX-17: signal handlers are installed INSIDE the CLI guard below, not at import — importing this module
// in a test used to mutate the test process's signal handling.

export function signPayload(secret, body, timestamp = Math.floor(Date.now() / 1000)) {
  return `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

export async function enqueueFromEvents(c, { scanBatch = SCAN_BATCH } = {}) {
  // DAT-4 (migration 076): discovery is STATE-based, not time-windowed.
  //
  // The previous implementation read `app.outbox WHERE o.created_at > now() - interval '1 hour'`.
  // A worker down for 61 minutes came back, saw nothing older than an hour, and never looked again —
  // so every event in the gap was not late, it was GONE, with no gap metric and no alert. The window
  // did not bound the scan; it bounded what could ever be processed.
  //
  // Three statements rather than one clever CTE, deliberately. The single-statement form (a
  // data-modifying CTE whose insert count is read back) reads better and is exactly the kind of SQL
  // that fails silently — migration 076's sibling work hit that with FOR UPDATE-in-a-CTE returning
  // NULL. Separately, each step here is obviously what it says.
  //
  // Step 1 CLAIMS a page with FOR UPDATE SKIP LOCKED, so two workers never schedule the same page;
  // rows the relay currently holds are skipped and retried next tick, and because discovered_at stays
  // NULL for them nothing is lost.
  const page = await c.query(
    `SELECT id, tenant_id, topic, payload FROM app.outbox
      WHERE discovered_at IS NULL
      ORDER BY created_at
      LIMIT $1
      FOR UPDATE SKIP LOCKED`, [scanBatch]);
  if (!page.rows.length) return 0;
  const ids = page.rows.map((r) => r.id);

  // Step 2 schedules per matching ACTIVE subscription. UNIQUE(subscription_id, event_id) keeps this
  // at-least-once scheduled exactly once even if the page is somehow replayed.
  const r = await c.query(
    `INSERT INTO app.webhook_deliveries (tenant_id, subscription_id, event_id, topic, payload)
     SELECT o.tenant_id, s.id, o.id, o.topic, o.payload
       FROM app.outbox o
       JOIN app.webhook_subscriptions s ON s.tenant_id = o.tenant_id AND s.active
        AND ('*' = ANY(s.events) OR o.topic = ANY(s.events))
      WHERE o.id = ANY($1::uuid[])
     ON CONFLICT (subscription_id, event_id) DO NOTHING`, [ids]);

  // Step 3 marks the WHOLE page discovered — including rows that matched no subscription. "Discovered"
  // means "considered", not "delivered": without this, an event nobody subscribes to would be
  // rescanned every 5 seconds forever. It is also what stops a late subscriber receiving an unbounded
  // backlog of everything that ever happened.
  await c.query(`UPDATE app.outbox SET discovered_at = now() WHERE id = ANY($1::uuid[])`, [ids]);

  // Returns the number of DELIVERY rows scheduled (the previous contract), not the number of outbox
  // rows considered — callers log this as `enqueued`, and silently redefining it would make an idle
  // queue and a busy one with no subscribers read the same in the logs.
  return r.rowCount ?? 0;
}

async function deliver(client, sub, delivery) {
  // AUTH-5: re-check at delivery time. A subscription registered before this fix, or a DNS name that
  // re-points at a private address after registration, must not become an SSRF.
  const target = await assertPublicWebhookUrl(sub.url, { allowLoopback: true });
  if (!target.ok) return { ok: false, code: null, error: `refused webhook target: ${target.reason}` };
  const body = JSON.stringify({
    id: delivery.event_id, topic: delivery.topic, tenant_id: delivery.tenant_id,
    payload: delivery.payload, created_at: delivery.created_at,
  });
  let res;
  try {
    res = await fetch(sub.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-schoolos-topic': delivery.topic,
        'x-schoolos-signature': signPayload(sub.sign_secret, body),
      },
      body,
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    return { ok: false, code: null, error: String(e?.cause?.message ?? e?.message ?? 'delivery failed') };
  }
  if (!res.ok) return { ok: false, code: res.status, error: `receiver answered HTTP ${res.status}` };
  return { ok: true, code: res.status, error: null };
}

export async function processDueDeliveries(c, { maxAttempts = MAX_ATTEMPTS } = {}) {
  const due = await c.query(
    `SELECT d.id, d.tenant_id, d.event_id, d.topic, d.payload, d.attempts, d.created_at,
            s.url, s.sign_secret
     FROM app.webhook_deliveries d
     JOIN app.webhook_subscriptions s ON s.id = d.subscription_id AND s.active
     WHERE d.status='queued'
       AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= now())
       AND d.attempts < $1
     ORDER BY d.created_at
     LIMIT $2
     FOR UPDATE OF d SKIP LOCKED`, [maxAttempts, BATCH]);
  let okCount = 0;
  for (const d of due.rows) {
    const attempts = d.attempts + 1; // counted per claim, before the send
    const r = await deliver(c, d, d);
    const backoff = Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_MAX_MS);
    if (r.ok) {
      await c.query(
        `UPDATE app.webhook_deliveries SET status='delivered', delivered_at=now(), attempts=$2,
                response_code=$3, last_error=NULL, next_attempt_at=NULL WHERE id=$1`,
        [d.id, attempts, r.code]);
      okCount++;
    } else if (attempts >= maxAttempts) {
      await c.query(
        `UPDATE app.webhook_deliveries SET status='failed', attempts=$2, next_attempt_at=NULL,
                last_error=$3 || left($4, 500), response_code=$5 WHERE id=$1`,
        [d.id, attempts, PARKED_PREFIX, r.error, r.code]);
    } else {
      await c.query(
        `UPDATE app.webhook_deliveries SET attempts=$2, last_error=left($3, 500), response_code=$4,
                next_attempt_at = now() + ($5 || ' milliseconds')::interval WHERE id=$1`,
        [d.id, attempts, r.error, r.code, String(backoff)]);
    }
  }
  return { claimed: due.rows.length, delivered: okCount };
}

export async function tick(c) {
  const enqueued = await enqueueFromEvents(c);
  const res = await processDueDeliveries(c);
  return { enqueued, ...res };
}

/* OPSX-7: discovery and delivery run in SEPARATE transactions on the production path.
 *
 * `enqueueFromEvents` takes `FOR UPDATE` locks on the `app.outbox` page it scans. The old CLI loop ran
 * `tick()` inside ONE transaction, so those outbox locks were held across `processDueDeliveries`' up to
 * BATCH (25) sequential 8-second POSTs — up to ~200s. The outbox relay's own discovery uses
 * `FOR UPDATE SKIP LOCKED`, so it skipped the locked page and event EMISSION starved behind webhook
 * DELIVERY. Committing discovery first releases the outbox locks before any network call; delivery then
 * runs in its own transaction. (The delivery rows are still locked for the duration of their sends, which
 * only affects a second webhook worker claiming the same deliveries — it SKIP LOCKEDs them — not the
 * relay.) */
function inTx(poolOrClient, fn) {
  return (async () => {
    const c = await poolOrClient.connect();
    try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
    catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
    finally { c.release(); }
  })();
}

export async function tickOnce(conn = pool) {
  const enqueued = await inTx(conn, (c) => enqueueFromEvents(c));
  const res = await inTx(conn, (c) => processDueDeliveries(c));
  return { enqueued, ...res };
}

// CLI guard: `node scripts/webhook-worker.js` loops; imports get functions only.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { stopping = true; setTimeout(() => process.exit(0), 8000).unref(); });
  console.log(`webhook worker on ${INTERVAL_MS}ms poll (batch ${BATCH}, max attempts ${MAX_ATTEMPTS}, backoff ${BACKOFF_BASE_MS}→${BACKOFF_MAX_MS}ms)`);
  while (!stopping) {
    try {
      const r = await tickOnce(pool);
      if (r.enqueued || r.claimed) console.log(JSON.stringify({ kind: 'webhook.tick', at: new Date().toISOString(), ...r }));
    } catch (e) {
      console.error('webhook worker tick failed:', e.message);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  console.log('webhook worker stopped');
  await pool.end();
}
