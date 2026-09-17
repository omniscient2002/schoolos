// The outbox relay — previously the LEAST verifiable component in the system.
//
// PERFECT-100 §5.9 / ops P0: `scripts/outbox-worker.js` ran its poll loop at MODULE
// SCOPE, so it could not be imported at all (importing it to test `tick` started a
// second relay), and its only subscriber was `console.log`, which cannot throw. Between
// those two facts, the relay's failure semantics — backoff and parking — had ZERO
// automated verification, while the relay is the spine every event depends on.
//
// §4 H5 is the defect this file exists to pin: the park path set `processed_at = now()`
// and the only queue gauge counts `processed_at IS NULL`, so PARKING A FAILURE DROVE THE
// QUEUE GAUGE DOWN. A total relay outage was metrically identical to a healthy idle
// system. The assertions below are written so that reverting that line fails the test.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { setupTestDb } from './helpers.js';

let app;
let pool;
let sql;
let worker;
let tenant;
let owner;

before(async () => {
  await setupTestDb();
  // Read at module import by the worker — so it must be set before the dynamic import.
  // 2 makes the park path reachable in one failed delivery.
  process.env.OUTBOX_MAX_ATTEMPTS = '2';
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.ready();
  pool = (await import('../src/db.js')).pool;
  sql = async (text, params = []) => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try { return await c.query(text, params); } finally { await c.end(); }
  };
  worker = await import('../scripts/outbox-worker.js');
  tenant = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  owner = (await sql(`SELECT id, role, tenant_id, name FROM app.users WHERE email='owner@meridian.edu'`)).rows[0];
});

after(async () => { await app?.close(); });

// tokens are minted directly: /auth/login is 20/min and other suites exhaust that bucket
const tokenFor = (u) => app.jwt.sign({ sub: u.id, role: u.role, tenant: u.tenant_id, name: u.name, jti: randomUUID() });

const enqueue = async (topic = 'test.topic', payload = {}) => {
  const id = randomUUID();
  await sql(`INSERT INTO app.outbox (id, tenant_id, topic, payload, emitted_by) VALUES ($1,$2,$3,$4::jsonb,'test')`,
    [id, tenant, topic, JSON.stringify(payload)]);
  return id;
};
const rowState = async (id) => (await sql(
  `SELECT processed_at, parked_at, attempts, last_error, next_attempt_at FROM app.outbox WHERE id=$1`, [id])).rows[0];

describe('outbox relay — importability and delivery', () => {
  test('the relay can be imported without starting a second relay (was impossible)', async () => {
    // The regression this guards: a module-scope `while (!stopping) await tick()` here
    // meant `import` started a poll loop, which is why nothing could test `tick`.
    // Reaching this assertion at all proves the loop no longer runs on import.
    assert.equal(typeof worker.tick, 'function', 'tick is exported');
    assert.equal(typeof worker.ensureSchema, 'function', 'ensureSchema is exported');
    assert.equal(typeof worker.backoffMs, 'function', 'backoffMs is exported');
    assert.equal(typeof worker.defaultDeliver, 'function', 'the subscriber is injectable');
  });

  test('a deliverable row is marked processed, with no park', async () => {
    const id = await enqueue();
    const out = await worker.tick();
    assert.ok(out.claimed >= 1, `tick claimed the row (got ${JSON.stringify(out)})`);
    const s = await rowState(id);
    assert.ok(s.processed_at, 'processed_at set on real delivery');
    assert.equal(s.parked_at, null, 'not parked');
    assert.equal(s.attempts, 1, 'attempts counted exactly once');
  });

  test('backoff doubles and is capped', () => {
    assert.equal(worker.backoffMs(1), 2000, 'first retry waits the base');
    assert.equal(worker.backoffMs(2), 4000);
    assert.equal(worker.backoffMs(3), 8000);
    assert.equal(worker.backoffMs(99), 300000, 'capped at BACKOFF_MAX_MS');
  });

  test('a failing delivery is RETRIED with a future next_attempt_at, not parked', async () => {
    const id = await enqueue('test.retry');
    const boom = async () => { throw new Error('subscriber down'); };
    await worker.tick({ deliver: boom });
    const s = await rowState(id);
    assert.equal(s.processed_at, null, 'a failed row is NOT processed');
    assert.equal(s.parked_at, null, 'not parked after its first failure');
    assert.equal(s.attempts, 1);
    assert.match(s.last_error, /subscriber down/, 'the real error is recorded');
    assert.ok(s.next_attempt_at && new Date(s.next_attempt_at).getTime() > Date.now() - 1000,
      'retry scheduled in the future (backoff), so a poison row cannot monopolize the poll');
  });
});

describe('PERFECT-100 §4 H5 — a failed relay must never look like an idle one', () => {
  test('at MAX_ATTEMPTS the row PARKS and processed_at STAYS NULL (the core fix)', async () => {
    const id = await enqueue('test.poison');
    const boom = async () => { throw new Error('permanent subscriber failure'); };

    // OUTBOX_MAX_ATTEMPTS=2: first failure schedules a retry, second parks.
    await worker.tick({ deliver: boom });
    assert.equal((await rowState(id)).parked_at, null, 'still retrying after failure 1');

    // clear the backoff wait so the second attempt is claimable now
    await sql(`UPDATE app.outbox SET next_attempt_at = now() - interval '1 second' WHERE id=$1`, [id]);
    await worker.tick({ deliver: boom });

    const s = await rowState(id);
    assert.ok(s.parked_at, 'parked at MAX_ATTEMPTS');
    // THE ASSERTION THAT MATTERS: the old code set processed_at here, which is what made
    // the only queue gauge FALL as the relay failed. If someone reverts that line, this
    // fails — and it is the difference between "queue draining, all good" and "we are
    // dropping every event".
    assert.equal(s.processed_at, null, 'a parked row is NOT processed — it was never delivered');
    assert.match(s.last_error, /max attempts/i, 'the park reason is on the row');
  });

  test('the parked row is counted as PARKED, and is excluded from pending', async () => {
    const parked = (await sql(`SELECT count(*)::int AS n FROM app.outbox WHERE parked_at IS NOT NULL`)).rows[0].n;
    assert.ok(parked >= 1, 'the poison row is visible as parked');
    // the two predicates must be mutually exclusive — that is the whole model
    const both = (await sql(
      `SELECT count(*)::int AS n FROM app.outbox WHERE parked_at IS NOT NULL AND processed_at IS NOT NULL`)).rows[0].n;
    assert.equal(both, 0, 'no row is ever both parked and processed');
  });

  test('/metrics exposes schoolos_outbox_parked — failure is now a POSITIVE signal', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics', headers: { authorization: `Bearer ${tokenFor(owner)}` } });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.body;
    assert.match(body, /schoolos_outbox_parked \d+/, 'the parked gauge is emitted');
    const parked = Number((body.match(/schoolos_outbox_parked (\d+)/) ?? [])[1]);
    assert.ok(parked >= 1, `parked failures are reported, not hidden (got ${parked})`);
    assert.match(body, /schoolos_outbox_pending \d+/, 'pending is still emitted');
  });

  test('migration 073 RECLASSIFIES rows parked by the old worker (the real artifact, not a no-op)', async () => {
    // The dev database's outbox was empty when 073 ran, so its backfill path never
    // executed against real data. This runs the ACTUAL migration file against a
    // synthetic legacy row — a row the OLD worker parked, which therefore carries
    // processed_at (the lie) and the park marker in last_error (the only surviving
    // evidence). Without this, the fix would silently apply to future failures only.
    const { readFileSync } = await import('node:fs');
    const migration = readFileSync(new URL('../migrations/073_outbox_parked_at.sql', import.meta.url), 'utf8');

    const legacy = await enqueue('test.legacy-parked');
    await sql(`UPDATE app.outbox
                  SET processed_at = now() - interval '1 hour', attempts = 99,
                      last_error = 'max attempts reached — parked for inspection: old-style park'
                WHERE id=$1`, [legacy]);
    const before = await rowState(legacy);
    assert.ok(before.processed_at && !before.parked_at, 'fixture reproduces the old, lying state');

    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try { await c.query(migration); } finally { await c.end(); }

    const after = await rowState(legacy);
    assert.ok(after.parked_at, 'the legacy park is now visible as PARKED');
    assert.equal(after.processed_at, null,
      'and processed_at is cleared — the row was never delivered, so leaving it set would preserve the exact lie this migration removes');
  });
});
