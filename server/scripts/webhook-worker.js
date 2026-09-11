#!/usr/bin/env node
// Webhook delivery worker (L2-4.1, Wave 4) — the outbound half of the event spine.
//   1. enqueueFromEvents: recent app.events rows → delivery rows for matching
//      active subscriptions (topic match, '*' wildcard; NOT EXISTS + UNIQUE(sub,
//      event) = at-least-once exactly-once-scheduled; 1h window keeps scans small).
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

const INTERVAL_MS = Number(process.env.WEBHOOK_POLL_MS ?? 5000);
const MAX_ATTEMPTS = Number(process.env.WEBHOOK_MAX_ATTEMPTS ?? 8);
const BATCH = Number(process.env.WEBHOOK_BATCH ?? 25);
const BACKOFF_BASE_MS = Number(process.env.WEBHOOK_BACKOFF_BASE_MS ?? 2000);
const BACKOFF_MAX_MS = Number(process.env.WEBHOOK_BACKOFF_MAX_MS ?? 300000);
const EVENT_WINDOW = '1 hour';
const PARKED_PREFIX = 'max attempts reached — parked for inspection: ';

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 4 });
let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { stopping = true; setTimeout(() => process.exit(0), 8000).unref(); });

export function signPayload(secret, body, timestamp = Math.floor(Date.now() / 1000)) {
  return `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

export async function enqueueFromEvents(c) {
  // source = app.outbox (topic + payload — the delivery spine); app.events is the
  // activity feed (no payload). Window-bounded; UNIQUE(sub, event) dedups replays.
  const r = await c.query(
    `INSERT INTO app.webhook_deliveries (tenant_id, subscription_id, event_id, topic, payload)
     SELECT o.tenant_id, s.id, o.id, o.topic, o.payload
     FROM app.outbox o
     JOIN app.webhook_subscriptions s ON s.tenant_id = o.tenant_id AND s.active
     WHERE o.created_at > now() - interval '${EVENT_WINDOW}'
       AND ('*' = ANY(s.events) OR o.topic = ANY(s.events))
     ON CONFLICT (subscription_id, event_id) DO NOTHING`);
  return r.rowCount ?? 0;
}

async function deliver(client, sub, delivery) {
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

// CLI guard: `node scripts/webhook-worker.js` loops; imports get functions only.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`webhook worker on ${INTERVAL_MS}ms poll (batch ${BATCH}, max attempts ${MAX_ATTEMPTS}, backoff ${BACKOFF_BASE_MS}→${BACKOFF_MAX_MS}ms)`);
  while (!stopping) {
    const c = await pool.connect().catch(() => null);
    if (c) {
      try {
        await c.query('BEGIN');
        const r = await tick(c);
        await c.query('COMMIT');
        if (r.enqueued || r.claimed) console.log(JSON.stringify({ kind: 'webhook.tick', at: new Date().toISOString(), ...r }));
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        console.error('webhook worker tick failed:', e.message);
      } finally { c.release(); }
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  console.log('webhook worker stopped');
  await pool.end();
}
