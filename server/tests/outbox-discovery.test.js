// DAT-4 / DAT-14 — outbox discovery must be STATE-based, not time-windowed (migration 076).
//
// One shape caused both findings, in two different consumers:
//
//   webhook-worker.js:  WHERE o.created_at > now() - interval '1 hour'          (DAT-4)
//   workflow-worker.js: WHERE created_at  > now() - interval '1 hour' LIMIT 50  (DAT-14)
//
// and two consequences followed from that one choice:
//
//   · OUTAGE = PERMANENT LOSS. A worker down for 61 minutes came back, saw nothing older than an
//     hour, and never looked again. The events in the gap were not late, they were gone — no gap
//     metric, no alert, and "at-least-once delivery" true only while nothing went wrong for an hour.
//   · STARVATION WITH NO CURSOR. The workflow runner re-read the SAME oldest 50 rows every tick
//     forever, so past the first 50 matching rows nothing could ever be processed. The LIMIT did not
//     bound the work per tick; it bounded what could ever be done at all.
//
// These tests are written so the OLD code fails them, not merely so the new code passes: the
// out-of-window test asserts a row three hours old is scheduled at all, and the starvation test
// inserts 60 matching rows and demands all 60, which a LIMIT 50 with no cursor cannot reach however
// many times it runs.
//
// They also pin the semantics the fix must NOT break: a subscriber that arrives late must not receive
// an unbounded backlog of everything that ever happened, and the marker must be TRANSACTIONAL — a
// crashed pass has to re-evaluate, because a marker committed before the work is the same silent loss
// in a new costume.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setupTestDb } from './helpers.js';

let sql;
let tenantId;
let appRef = null;

/** One worker pass in its own transaction, exactly as the CLI loop runs it. */
async function withTx(fn) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { await c.end(); }
}

/** Deliberately ROLLED BACK — for proving the marker is not committed ahead of the work. */
async function withRollback(fn) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('ROLLBACK');
    return r;
  } finally { await c.end(); }
}

before(async () => {
  await setupTestDb();
  const { pool } = await import('../src/db.js');
  sql = (t, p = []) => pool.query(t, p);
  tenantId = (await sql(`SELECT id FROM app.tenants ORDER BY created_at LIMIT 1`)).rows[0].id;
  // Stand in for 076's backfill of a real database: everything that existed before this file ran
  // counts as already considered, so every assertion below is about the rows THIS file inserts.
  await sql(`UPDATE app.outbox SET discovered_at = now() WHERE discovered_at IS NULL`);
  await sql(`UPDATE app.outbox SET workflow_scanned_at = now() WHERE workflow_scanned_at IS NULL`);
  void appRef;
});
after(async () => { await appRef?.close(); });

describe('DAT-4: the webhook fan-out discovers by state, so an outage of any length is recoverable', () => {
  test('an event three hours old is still scheduled for delivery', async () => {
    await sql(`INSERT INTO app.webhook_subscriptions (tenant_id, url, events, sign_secret)
               VALUES ($1,'https://receiver.invalid/old-hook',$2,'sec-old')`, [tenantId, ['discovery.old']]);
    // THE REGRESSION GATE. 3h > the old 1-hour window, which is exactly the case the window dropped.
    const o = (await sql(`INSERT INTO app.outbox (tenant_id, topic, payload, created_at)
                          VALUES ($1,'discovery.old','{}', now() - interval '3 hours') RETURNING id`,
      [tenantId])).rows[0];

    const worker = await import('../scripts/webhook-worker.js');
    const scheduled = await withTx((c) => worker.enqueueFromEvents(c));
    assert.equal(scheduled, 1,
      'an event older than the deleted window must STILL be scheduled — this is the whole fix');

    const d = (await sql(`SELECT status, payload FROM app.webhook_deliveries WHERE event_id=$1`, [o.id])).rows;
    assert.equal(d.length, 1, 'exactly one delivery row');
    assert.equal(d[0].status, 'queued');
  });

  test('the considered row is marked, the replay is a no-op, and work stays bounded', async () => {
    const worker = await import('../scripts/webhook-worker.js');
    // idempotent: the previous test already scheduled this event
    assert.equal(await withTx((c) => worker.enqueueFromEvents(c)), 0,
      'at-least-once, scheduled exactly once');

    // A row that matches NO subscription is still marked considered — otherwise an event nobody
    // subscribes to would be rescanned on every tick forever, and the scan would stop being bounded
    // by outstanding work.
    const lone = (await sql(`INSERT INTO app.outbox (tenant_id, topic, payload)
                             VALUES ($1,'nobody.listens','{}') RETURNING id`, [tenantId])).rows[0];
    assert.equal(await withTx((c) => worker.enqueueFromEvents(c)), 0, 'no matching subscription');
    const marked = await sql(`SELECT discovered_at FROM app.outbox WHERE id=$1`, [lone.id]);
    assert.ok(marked.rows[0].discovered_at,
      'a row with no subscriber must still be marked, or it is rescanned forever');

    // and a LATE subscriber does not receive an unbounded backlog of history
    await sql(`INSERT INTO app.webhook_subscriptions (tenant_id, url, events, sign_secret)
               VALUES ($1,'https://receiver.invalid/late-hook',$2,'sec-late')`, [tenantId, ['nobody.listens']]);
    assert.equal(await withTx((c) => worker.enqueueFromEvents(c)), 0,
      'a subscription created now must not be handed everything that ever happened');
    const none = await sql(`SELECT count(*)::int AS n FROM app.webhook_deliveries d
                            JOIN app.webhook_subscriptions s ON s.id=d.subscription_id WHERE s.url='https://receiver.invalid/late-hook'`);
    assert.equal(none.rows[0].n, 0);
  });
});

describe('DAT-14: the workflow runner advances, so nothing is starved behind the batch limit', () => {
  const N = 60; // > the default batch of 50 — the old code could never get past the first 50

  test(`all ${N} matching events fire, not just the first page`, async () => {
    await sql(`UPDATE app.outbox SET workflow_scanned_at = now() WHERE workflow_scanned_at IS NULL`);
    await sql(`INSERT INTO app.workflow_rules (tenant_id, name, topic, enabled, action)
               VALUES ($1,'starvation probe','starvation.probe',true,$2::jsonb)`,
      [tenantId, JSON.stringify({ kind: 'outbox', topic: 'starvation.fired' })]);
    await sql(`INSERT INTO app.outbox (tenant_id, topic, payload)
               SELECT $1, 'starvation.probe', '{}'::jsonb FROM generate_series(1,$2)`, [tenantId, N]);

    const worker = await import('../scripts/workflow-worker.js');
    let fired = 0;
    const passes = [];
    for (let i = 0; i < 6 && fired < N; i++) {
      const r = await withTx((c) => worker.runWorkflowPass(c));
      passes.push(r);
      fired += r.fired;
    }
    assert.equal(fired, N,
      `THE REGRESSION GATE: every one of the ${N} events must fire. A LIMIT 50 with no cursor re-reads the same first 50 forever and can never exceed 50 — passes were ${JSON.stringify(passes)}`);

    const derived = (await sql(`SELECT count(*)::int AS n FROM app.outbox WHERE topic='starvation.fired'`)).rows[0].n;
    assert.equal(derived, N, 'one derived event per source event, no more and no fewer');
  });

  test('a rolled-back pass re-evaluates — the marker is transactional, not best-effort', async () => {
    await sql(`UPDATE app.outbox SET workflow_scanned_at = now() WHERE workflow_scanned_at IS NULL`);
    await sql(`INSERT INTO app.workflow_rules (tenant_id, name, topic, enabled, action)
               VALUES ($1,'rollback probe','rollback.probe',true,$2::jsonb)`,
      [tenantId, JSON.stringify({ kind: 'outbox', topic: 'rollback.fired' })]);
    const o = (await sql(`INSERT INTO app.outbox (tenant_id, topic, payload)
                          VALUES ($1,'rollback.probe','{}') RETURNING id`, [tenantId])).rows[0];
    const worker = await import('../scripts/workflow-worker.js');

    const first = await withRollback((c) => worker.runWorkflowPass(c));
    assert.equal(first.fired, 1, 'the action is applied inside the transaction');

    // If the marker had been committed ahead of the work, this row would now look "done" while
    // nothing survived the rollback — the exact silent-loss shape 076 exists to remove.
    const scan = await sql(`SELECT workflow_scanned_at FROM app.outbox WHERE id=$1`, [o.id]);
    assert.equal(scan.rows[0].workflow_scanned_at, null,
      'a rolled-back pass must leave the event UNSCANNED, not falsely consumed');

    const second = await withTx((c) => worker.runWorkflowPass(c));
    assert.equal(second.fired, 1, 'so the next pass fires it — nothing was lost to the crash');
    const derived = (await sql(`SELECT count(*)::int AS n FROM app.outbox WHERE topic='rollback.fired'`)).rows[0].n;
    assert.equal(derived, 1);
  });

  test('the runner does not scan its own derived rows (no rule chains)', async () => {
    // 'wf:' rows are stamped workflow_scanned_at at insert because they are evaluated by
    // construction; this pins that they are excluded from the page as well as skipped in the loop.
    const left = (await sql(`SELECT count(*)::int AS n FROM app.outbox
                             WHERE dedup_key LIKE 'wf:%' AND workflow_scanned_at IS NULL`)).rows[0].n;
    assert.equal(left, 0, 'every derived row must already carry its marker');
  });
});
