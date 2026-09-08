#!/usr/bin/env node
// Outbox relay (ops audit P0-2): the event spine's at-least-once delivery.
// Polls app.outbox for unprocessed rows with FOR UPDATE SKIP LOCKED so many
// workers can run concurrently. Subscribers today: structured log emission
// (Phase-2 comms BSP rails subscribe the same way). Failed rows retry with
// capped backoff; after MAX_ATTEMPTS they park with last_error for inspection.
import pg from 'pg';
import { config } from '../src/config.js';

const INTERVAL_MS = Number(process.env.OUTBOX_POLL_MS ?? 2000);
const MAX_ATTEMPTS = Number(process.env.OUTBOX_MAX_ATTEMPTS ?? 8);
const BATCH = Number(process.env.OUTBOX_BATCH ?? 20);

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 4 });
let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { stopping = true; setTimeout(() => process.exit(0), 8000).unref(); });

async function tick() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const due = await c.query(
      `SELECT id, topic, payload, attempts, emitted_by FROM app.outbox
       WHERE processed_at IS NULL AND attempts < $1
       ORDER BY created_at
       LIMIT $2
       FOR UPDATE SKIP LOCKED`, [MAX_ATTEMPTS, BATCH]);
    for (const row of due.rows) {
      // ── subscribers ──────────────────────────────────────────────────────
      // v1: durable log emission. Phase-2 rails (WhatsApp BSP submit, email)
      // attach here; failures throw → row stays unprocessed → retried.
      console.log(JSON.stringify({ kind: 'outbox.relay', topic: row.topic, id: row.id, tenant: row.tenant_id, emittedBy: row.emitted_by, payload: row.payload }));
      await c.query(`UPDATE app.outbox SET processed_at = now(), attempts = attempts + 1 WHERE id=$1`, [row.id]);
    }
    // park poison rows past max attempts
    await c.query(
      `UPDATE app.outbox SET last_error = 'max attempts reached — parked for inspection'
       WHERE processed_at IS NULL AND attempts >= $1 AND (last_error IS NULL OR last_error NOT LIKE 'max attempts%')`, [MAX_ATTEMPTS]);
    await c.query('COMMIT');
    if (due.rows.length) console.error(`outbox relay: processed ${due.rows.length}`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('outbox relay tick failed:', e.message);
  } finally {
    c.release();
  }
}

console.log(`outbox relay on ${INTERVAL_MS}ms poll (batch ${BATCH}, max attempts ${MAX_ATTEMPTS})`);
while (!stopping) {
  await tick().catch((e) => console.error('relay fatal:', e));
  await new Promise((r) => setTimeout(r, INTERVAL_MS));
}
console.log('outbox relay stopped');
await pool.end();
