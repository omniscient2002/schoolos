#!/usr/bin/env node
// Outbox relay (ops audit P0-2): the event spine's at-least-once delivery.
// Polls app.outbox for due rows with FOR UPDATE SKIP LOCKED so many workers can
// run concurrently. Subscribers today: structured log emission (Phase-2 comms
// BSP rails subscribe the same way).
//
// Failure semantics (re-scan cycle-1 P2 fix, supersedes the bump-on-rollback
// approach which left clean-commit failures uncounted):
//   · attempts is incremented for EVERY claimed row BEFORE its subscriber runs
//     — success and failure alike. No path can leave a row at a stale count,
//     so MAX_ATTEMPTS and parking are always reachable.
//   · next_attempt_at paces retries: delay = min(BASE * 2^(attempts-1), MAX).
//     A poison row cannot monopolize batch slots at the raw poll rate, and it
//     parks after MAX_ATTEMPTS failures in the SAME transaction that observed
//     the cap — no orphan window, no separate marker pass.
//   · A PG-level error (bad UPDATE, lost connection) aborts the whole tick
//     transaction: every claimed row rolls back unmarked and is re-claimed
//     next tick — correct at-least-once behavior.
//   · next_attempt_at is ensured at startup (042 adds it; this guard covers a
//     worker pointed at a database migrated before 042).
import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { config } from '../src/config.js';

const INTERVAL_MS = Number(process.env.OUTBOX_POLL_MS ?? 2000);
const MAX_ATTEMPTS = Number(process.env.OUTBOX_MAX_ATTEMPTS ?? 8);
const BATCH = Number(process.env.OUTBOX_BATCH ?? 20);
const BACKOFF_BASE_MS = Number(process.env.OUTBOX_BACKOFF_BASE_MS ?? 2000);
const BACKOFF_MAX_MS = Number(process.env.OUTBOX_BACKOFF_MAX_MS ?? 300000);
const PARKED_PREFIX = 'max attempts reached — parked for inspection: ';

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 4 });
let stopping = false;

// ── 042 adds next_attempt_at; tolerate a pre-042 database so the worker never
// hard-crashes on boot (the column is only used when it exists).
export async function ensureSchema() {
  const r = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema='app' AND table_name='outbox' AND column_name='next_attempt_at'`);
  if (!r.rows[0]) {
    await pool.query(`ALTER TABLE app.outbox ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz`);
    console.error('outbox relay: added app.outbox.next_attempt_at (042 not applied to this database yet — run scripts/migrate.js)');
  }
  // 073 adds parked_at (see that migration): failure must not look like idleness.
  const p = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema='app' AND table_name='outbox' AND column_name='parked_at'`);
  if (!p.rows[0]) {
    await pool.query(`ALTER TABLE app.outbox ADD COLUMN IF NOT EXISTS parked_at timestamptz`);
    console.error('outbox relay: added app.outbox.parked_at (073 not applied to this database yet — run scripts/migrate.js)');
  }
}

export const backoffMs = (attempts) => Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_MAX_MS);

// ── subscribers ───────────────────────────────────────────────────────────────
// v1: durable log emission. Phase-2 rails (WhatsApp BSP submit, email) attach here;
// failures throw → row is retried with backoff.
//
// Exported and INJECTABLE so the relay's failure path is testable at all. With the
// subscriber hardcoded to console.log — which cannot throw — nothing could ever fail,
// so parking, backoff and the processed_at lie were unreachable from any test. That is
// why this component had zero automated verification of its semantics.
export const defaultDeliver = async (row) => {
  const line = `${JSON.stringify({ kind: 'outbox.relay', topic: row.topic, id: row.id, tenant: row.tenant_id, emittedBy: row.emitted_by, payload: row.payload })}\n`;
  await new Promise((resolve, reject) => {
    const onError = (err) => { process.stdout.off('error', onError); reject(err); };
    process.stdout.once('error', onError);
    process.stdout.write(line, (err) => {
      process.stdout.off('error', onError);
      if (err) reject(err); else resolve();
    });
  });
};

export async function tick({ deliver = defaultDeliver } = {}) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const due = await c.query(
      `SELECT id, topic, payload, attempts, emitted_by FROM app.outbox
       WHERE processed_at IS NULL AND parked_at IS NULL AND attempts < $1
         AND (next_attempt_at IS NULL OR next_attempt_at <= now())
         AND (last_error IS NULL OR last_error NOT LIKE 'max attempts%')
       ORDER BY created_at
       LIMIT $2
       FOR UPDATE SKIP LOCKED`, [MAX_ATTEMPTS, BATCH]);
    let okCount = 0;
    for (const row of due.rows) {
      const attempts = row.attempts + 1; // counted unconditionally, before delivery
      try {
        await deliver(row);
        await c.query(`UPDATE app.outbox SET processed_at = now(), attempts = $2, last_error = NULL, next_attempt_at = NULL WHERE id=$1`, [row.id, attempts]);
        okCount++;
      } catch (rowErr) {
        if (attempts >= MAX_ATTEMPTS) {
          // §4 H5: park on parked_at and DELIBERATELY leave processed_at NULL. The old
          // code set processed_at here, which made the only queue gauge FALL as rows
          // failed — a total relay failure was indistinguishable from an idle system.
          await c.query(
            `UPDATE app.outbox SET parked_at = now(), attempts = $2, next_attempt_at = NULL,
                    last_error = $3 || left($4, 500)
             WHERE id=$1`, [row.id, attempts, PARKED_PREFIX, String(rowErr?.message ?? rowErr)]);
        } else {
          await c.query(
            `UPDATE app.outbox SET attempts = $2, last_error = left($3, 500),
                    next_attempt_at = now() + ($4 || ' milliseconds')::interval
             WHERE id=$1`, [row.id, attempts, String(rowErr?.message ?? rowErr), String(backoffMs(attempts))]);
        }
      }
    }
    await c.query('COMMIT');
    if (okCount !== due.rows.length) console.error(`outbox relay: ${okCount} delivered, ${due.rows.length - okCount} scheduled for retry`);
    else if (okCount) console.error(`outbox relay: processed ${okCount}`);
    return { claimed: due.rows.length, delivered: okCount };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('outbox relay tick failed:', e.message);
    return { claimed: 0, delivered: 0, error: e.message };
  } finally {
    c.release();
  }
}

// ── CLI entry point ────────────────────────────────────────────────────────────
// §5.9 / ops P0: this file used to run its poll loop at MODULE SCOPE, so it could not
// be imported — the event spine's core component therefore had ZERO automated
// verification (importing it to test `tick` started a second relay instead). The loop
// now runs only when this file is the process entry point, so `import { tick }` is safe.
// Same idiom as scripts/retention-worker.js, which exports `pass()`.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, async () => { stopping = true; setTimeout(() => process.exit(0), 8000).unref(); });
  }
  console.log(`outbox relay on ${INTERVAL_MS}ms poll (batch ${BATCH}, max attempts ${MAX_ATTEMPTS}, backoff ${BACKOFF_BASE_MS}→${BACKOFF_MAX_MS}ms)`);
  await ensureSchema();
  while (!stopping) {
    await tick().catch((e) => console.error('relay fatal:', e));
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  console.log('outbox relay stopped');
  await pool.end();
}
