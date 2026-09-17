/* DAT-3 · the delivery stage that no gauge measured.
 *
 * THE DEFECT (PERFECT-100 §5, DAT-3). `schoolos_outbox_pending` counts `app.outbox.processed_at IS NULL`, and
 * the relay stamps `processed_at` when it has finished its own deliverable. For the log relay that deliverable
 * is emitting the event to the log sink, which is a real delivery to a real sink — so the column is not lying,
 * and an earlier reading of this finding as "processed_at is a lie" was wrong.
 *
 * What was actually missing is the stage AFTER the relay. The webhook fan-out lives in
 * `app.webhook_deliveries`, with its own retry and DLQ, and NOTHING read it: not a gauge, not the health probe,
 * not an alert. The one check that mentioned webhooks (`webhook_undiscovered`) reads `app.outbox.discovered_at`,
 * which only answers "did the fan-out SCAN this event" — it is structurally blind to an event that was scanned,
 * queued for a paying subscriber, and then never delivered.
 *
 * So the failure mode is precise and was reachable in production: every subscriber delivery failing, while an
 * operator watching the only queue signal reads `outbox_pending 0` — a clean, drained, healthy-looking queue.
 * Same class of success-shaped silence migration 073 had to undo for parked rows, in the one place nobody had
 * looked.
 *
 * These tests pin the three gauges and the probe check, and — most importantly — pin the REGRESSION: a failed
 * delivery must be visible even when the outbox is completely drained, which is exactly the state in which the
 * old signal said everything was fine.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';

let app;
let owner;
let tenantId;
let subId;

const metric = (body, name) => {
  const m = body.match(new RegExp(`^${name} (-?\\d+(?:\\.\\d+)?)$`, 'm'));
  return m ? Number(m[1]) : null;
};

/** Insert a delivery row directly: the worker's own retry/DLQ logic is not what is under test here, the
 *  VISIBILITY of its states is. */
async function insertDelivery(c, { status, nextAttemptAt, topic = 'dat3.probe', createdAgoMs = 0 }) {
  const ev = await c.query(
    `INSERT INTO app.outbox (tenant_id, topic, payload, processed_at) VALUES ($1,$2,'{}'::jsonb,now()) RETURNING id`,
    [tenantId, topic]);
  // `event_id` is NOT NULL, so a delivery needs an event row — and that event is immediately marked settled
  // because the relay HAS emitted it. That is precisely the production state this test is about: the outbox is
  // legitimately clean while the delivery stage behind it fails.
  const d = await c.query(
    `INSERT INTO app.webhook_deliveries
       (tenant_id, subscription_id, event_id, topic, payload, status, attempts, next_attempt_at, created_at)
     VALUES ($1,$2,$3,$4,'{}'::jsonb,$5,1,$6, now() - ($7 || ' milliseconds')::interval) RETURNING id`,
    [tenantId, subId, ev.rows[0].id, topic, status, nextAttemptAt, String(createdAgoMs)]);
  return d.rows[0].id;
}

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.ready();
  owner = await loginAs(app, 'owner@meridian.edu');
  const { pool } = await import('../src/db.js');
  tenantId = (await pool.query(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  // A paying school's integration: an ACTIVE subscriber that exists to receive events.
  subId = (await pool.query(
    `INSERT INTO app.webhook_subscriptions (tenant_id, url, events, sign_secret, active)
     VALUES ($1,'https://si.example.edu/hooks',ARRAY['*']::text[],'s3cret',true) RETURNING id`,
    [tenantId])).rows[0].id;
});

after(async () => { await app?.close(); });

const metrics = async () => {
  const r = await app.inject({ method: 'GET', url: '/metrics', headers: { authorization: `Bearer ${owner.token}` } });
  assert.equal(r.statusCode, 200, 'the owner must be able to read /metrics');
  return r.body;
};

describe('DAT-3 · webhook delivery is measured, not assumed', () => {
  test('the delivery gauges are exposed at all — the stage existed with no gauge', async () => {
    const body = await metrics();
    for (const n of ['schoolos_webhook_deliveries_queued', 'schoolos_webhook_deliveries_failed',
      'schoolos_webhook_deliveries_stalled']) {
      assert.notEqual(metric(body, n), null,
        `${n} must be exported — its absence is the defect: app.webhook_deliveries had no reader`);
    }
  });

  test('THE REGRESSION: a failed delivery is visible while the outbox reads a clean, drained 0', async () => {
    const { pool } = await import('../src/db.js');
    // Drain the outbox exactly the way the relay does when it has successfully emitted everything.
    await pool.query(`UPDATE app.outbox SET processed_at = now() WHERE processed_at IS NULL`);
    const drained = await metrics();
    assert.equal(metric(drained, 'schoolos_outbox_pending'), 0,
      'premise: the outbox gauge must read a healthy 0 — this is the reading that hid the defect');
    assert.equal(metric(drained, 'schoolos_outbox_parked'), 0, 'premise: nothing parked either');

    await insertDelivery(pool, { status: 'failed', nextAttemptAt: null });
    const after = await metrics();
    assert.equal(metric(after, 'schoolos_webhook_deliveries_failed'), 1,
      'a subscriber delivery that gave up must be counted');
    assert.equal(metric(after, 'schoolos_outbox_pending'), 0,
      'and the outbox gauge STILL reads 0 — which is the whole point: the old signal cannot see this');
  });

  test('the probe fires on the state the outbox check cannot see (discovered but undelivered)', async () => {
    const { CHECKS } = await import('../scripts/health-probe.js');
    const { pool } = await import('../src/db.js');
    const r = await CHECKS.webhook_undelivered((sql, p) => pool.query(sql, p));
    assert.ok(r.value >= 1, `webhook_undelivered must be non-zero, got ${JSON.stringify(r)}`);
    assert.ok(r.failed >= 1, 'it must break the number down: failed deliveries are reported separately');
  });

  test('a queued delivery that is due and stale counts as STALLED, not merely queued', async () => {
    const { pool } = await import('../src/db.js');
    // Overdue by an hour: the worker is wedged or not running. `next_attempt_at` NULL is the same alarm —
    // there is no future attempt scheduled, so nothing will ever move this row. `createdAgoMs` models the
    // OPSX-16 age grace: a freshly-queued row is "due", not "stalled", until it has been due for 10 minutes.
    await insertDelivery(pool, { status: 'queued', nextAttemptAt: new Date(Date.now() - 3600_000), createdAgoMs: 3600_000 });
    await insertDelivery(pool, { status: 'queued', nextAttemptAt: null, createdAgoMs: 3600_000 });
    const body = await metrics();
    assert.ok(metric(body, 'schoolos_webhook_deliveries_stalled') >= 2,
      'a due-and-unretried delivery is a stall, not ordinary backlog — the two are different alarms');
  });

  test('a scheduled retry is backlog, NOT a stall — the alarm must not cry wolf', async () => {
    const { pool } = await import('../src/db.js');
    const beforeBody = await metrics();
    const beforeStalled = metric(beforeBody, 'schoolos_webhook_deliveries_stalled');
    // A legitimate in-flight retry: status queued, next attempt scheduled in the future. A gauge that counted
    // this as stalled would fire on every ordinary transient receiver outage and be ignored within a week.
    await insertDelivery(pool, { status: 'queued', nextAttemptAt: new Date(Date.now() + 300_000) });
    const afterBody = await metrics();
    assert.equal(metric(afterBody, 'schoolos_webhook_deliveries_stalled'), beforeStalled,
      'a delivery with a future retry scheduled is backlog; it must not raise the stall alarm');
    assert.ok(metric(afterBody, 'schoolos_webhook_deliveries_queued') >= 3,
      'but it MUST still be counted as queued, so backlog is visible without being alarming');
  });

  test('the probe SKIPS rather than fabricating a healthy 0 when the table is absent', async () => {
    const { CHECKS } = await import('../scripts/health-probe.js');
    // A probe that cannot run must report that, never a 0 that reads as "nothing wrong" — the house rule
    // stated at the top of health-probe.js.
    const fakeQ = async () => ({ rows: [] }); // information_schema says the table does not exist
    const r = await CHECKS.webhook_undelivered(fakeQ);
    assert.ok(r.skipped, 'an unreadable signal must be reported as skipped, not returned as a zero');
    assert.equal(r.value, undefined, 'a skipped check must not carry a numeric value at all');
  });
});
