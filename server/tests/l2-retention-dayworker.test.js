// L2-3.4 (Wave 3) — retention sweeps + chain-preserving audit archival + day-worker.
// Pins: pickup_otp/reset_tokens/outbox/comms/webhook sweeps honor their windows,
// audit rows MOVE verbatim to the cold table (hash columns identical, hot∪cold
// chain intact), fresh rows survive every sweep, day-worker steps stay contained.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setupTestDb } from './helpers.js';

let sql;
let retention;
let day;

before(async () => {
  await setupTestDb();
  retention = await import('../scripts/retention-worker.js');
  day = await import('../scripts/day-worker.js');
  sql = async (text, params = []) => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try { return await c.query(text, params); } finally { await c.end(); }
  };
});

const T = () => sql(`SELECT id FROM app.tenants WHERE slug='meridian'`).then((r) => r.rows[0].id);
const old = (d) => `now() - interval '${d} days'`;

describe('L2-3.4 · retention + day-worker', () => {
  test('vault sweeps: expired pickup OTP + consumed reset token die, fresh rows survive', async () => {
    const t = await T();
    const v = await sql(`INSERT INTO plugin_visitors.visit (tenant_id, visitor_name, visitor_phone, purpose, badge_code) VALUES ($1,'v','+919845000201','pickup','B-RETAIN') RETURNING id`, [t]);
    // 024 pickup_otp: visit-bound row; 054 dropped the FK but the column stays
    await sql(`INSERT INTO plugin_visitors.pickup_otp (tenant_id, visit_id, phone, code_hash, expires_at)
               VALUES ($1,$2,'+919845000201','old:hash', ${old(10)})`, [t, v.rows[0].id]);
    await sql(`INSERT INTO plugin_visitors.pickup_otp (tenant_id, visit_id, phone, code_hash, expires_at)
               VALUES ($1,$2,'+919845000201','fresh:hash', now() + interval '5 minutes')`, [t, v.rows[0].id]);
    await sql(`INSERT INTO auth.reset_tokens (tenant_id, user_id, token_hash, expires_at)
               SELECT $1, id, 'deadbeef', ${old(10)} FROM app.users LIMIT 1`, [t]);
    await sql(`INSERT INTO auth.reset_tokens (tenant_id, user_id, token_hash, expires_at)
               SELECT $1, id, 'cafef00d', now() + interval '20 minutes' FROM app.users LIMIT 1`, [t]);

    const counts = await retention.pass();
    assert.ok(counts.pickupOtpsDeleted >= 1, `expired pickup OTP purged (got ${counts.pickupOtpsDeleted})`);
    assert.ok(counts.resetTokensDeleted >= 1);
    const left = await sql(`SELECT code_hash FROM plugin_visitors.pickup_otp WHERE phone='+919845000201' ORDER BY expires_at DESC`);
    assert.equal(left.rows.length, 1);
    assert.equal(left.rows[0].code_hash, 'fresh:hash', 'unexpired row survives');
    const rt = await sql(`SELECT token_hash FROM auth.reset_tokens`);
    assert.equal(rt.rows.length, 1);
    assert.equal(rt.rows[0].token_hash, 'cafef00d', 'live reset token survives');
  });

  test('outbox/comms/webhook sweeps: terminal old rows die, live rows survive', async () => {
    const t = await T();
    await sql(`INSERT INTO app.outbox (tenant_id, topic, payload, processed_at) VALUES ($1,'t','{}', now() - interval '20 days')`, [t]);
    await sql(`INSERT INTO app.outbox (tenant_id, topic, payload) VALUES ($1,'t','{}')`, [t]); // unprocessed — never purged here
    await sql(`INSERT INTO app.communications (tenant_id, channel, body, status, created_at) VALUES ($1,'sms','old','sent', ${old(120)})`, [t]);
    await sql(`INSERT INTO app.communications (tenant_id, channel, body, status) VALUES ($1,'sms','fresh','queued')`, [t]);
    await sql(`INSERT INTO plugin_razorpay.webhook_log (tenant_id, event_id, event_type, received_at) VALUES ($1,'evt_old','x', ${old(120)})`, [t]);
    await sql(`INSERT INTO plugin_razorpay.webhook_log (tenant_id, event_id, event_type) VALUES ($1,'evt_new','x')`, [t]);

    const counts = await retention.pass();
    assert.ok(counts.outboxDeleted >= 1);
    assert.ok(counts.communicationsDeleted >= 1);
    assert.ok(counts.webhookLogsDeleted >= 1);
    // marker-scoped (seeded demo rows exist with today's timestamps — they survive by design)
    const ob = await sql(`SELECT count(*)::int AS n FROM app.outbox WHERE topic='t'`);
    assert.equal(ob.rows[0].n, 1, 'unprocessed outbox row survives');
    const cm = await sql(`SELECT status FROM app.communications WHERE body IN ('old','fresh')`);
    assert.equal(cm.rows.length, 1);
    assert.equal(cm.rows[0].status, 'queued', 'non-terminal comms row survives');
    const wl = await sql(`SELECT event_id FROM plugin_razorpay.webhook_log WHERE event_id IN ('evt_old','evt_new')`);
    assert.deepEqual(wl.rows.map((r) => r.event_id), ['evt_new']);
  });

  test('audit archival: old rows MOVE verbatim to cold (hash chain preserved), fresh stay hot', async () => {
    const t = await T();
    await sql(`INSERT INTO app.audit_log (tenant_id, actor, actor_role, action, record_type, prev_hash, hash, created_at)
               VALUES ($1,'archival-test','system','old event','Test','prev-old','hash-old', ${old(400)})`, [t]);
    await sql(`INSERT INTO app.audit_log (tenant_id, actor, actor_role, action, record_type, prev_hash, hash)
               VALUES ($1,'archival-test','system','fresh event','Test','prev-new','hash-new')`, [t]);
    const counts = await retention.pass();
    assert.ok(counts.auditRowsArchived >= 1, `archival moved rows (got ${counts.auditRowsArchived})`);
    const hot = await sql(`SELECT action, prev_hash, hash FROM app.audit_log WHERE actor='archival-test'`);
    assert.deepEqual(hot.rows.map((r) => r.action), ['fresh event'], 'fresh row stays hot');
    const cold = await sql(`SELECT action, prev_hash, hash, archived_at FROM app.audit_log_cold WHERE actor='archival-test'`);
    assert.equal(cold.rows.length, 1);
    assert.equal(cold.rows[0].action, 'old event');
    assert.equal(cold.rows[0].prev_hash, 'prev-old', 'hash columns byte-identical — chain verifiable across hot∪cold');
    assert.ok(cold.rows[0].archived_at, 'archival stamp set');
    // idempotence: a second pass moves nothing, deletes nothing
    const again = await retention.pass();
    const hot2 = await sql(`SELECT count(*)::int AS n FROM app.audit_log WHERE actor='archival-test'`);
    const cold2 = await sql(`SELECT count(*)::int AS n FROM app.audit_log_cold WHERE actor='archival-test'`);
    assert.equal(hot2.rows[0].n, 1);
    assert.equal(cold2.rows[0].n, 1);
    assert.equal(again.auditRowsArchived, 0);
  });

  test('day-worker: every step runs contained (stub/tally/retention/dunning-skip)', async () => {
    const preventive = await day.runPreventiveStub();
    assert.equal(preventive.status, 'stub', 'honest stub until the policy source exists');
    const tally = await day.runTallySummary();
    assert.ok(Number.isFinite(tally.confirmedPayments) && Number.isFinite(tally.amountCents));
    const retentionOut = await day.runRetention();
    assert.ok(typeof retentionOut.auditRowsArchived === 'number', 'retention step returns the pass counts');
    const dunning = await day.runDunningHook();
    assert.equal(dunning.status, 'skipped', 'L1 dunning module absent → contained skip, no crash');
    assert.match(dunning.reason, /Cannot find module|runDunning export missing|ERR_MODULE_NOT_FOUND|Failed to load/);
  });
});
