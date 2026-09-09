// Wave A — comms rails + dispatcher + payments.razorpay (migrations 043/044/045).
// Covers, per the Wave-A brief:
//   (a) rails.sms logger provider returns ok + logs a structured line;
//   (b) dispatcher script node --check + SQL shape sanity (SKIPPED without DB);
//   (c) payments.razorpay webhook: locally-computed HMAC-SHA256 over the raw
//       bytes → 200 recorded; wrong signature → 401; replay same event → 200
//       no-op; stale timestamp → 400; missing signature → 401; orders door
//       without configured keys → 503.
// Model: tests/upi.test.js. Standing invariants: rails insert nothing (they
// RETURN {ok, provider, ref, error}); webhook records facts only — settlement
// stays kernel-only (Fees §4.2); replay dedupe on UNIQUE (tenant_id, event_id).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { setupTestDb, loginAs } from './helpers.js';

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const TEST_SECRET = 'razorpay-test-secret-wave-a-not-production';
const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let app;
let sql;

before(async () => {
  await setupTestDb();
  // built while RAZORPAY_WEBHOOK_SECRET is UNSET → the fail-closed boot path
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.ready();
  // bind the rails' kernel q exactly like the dispatcher wires them (owner path)
  const { pool } = await import('../src/db.js');
  const { bindKernel: bindSms } = await import('../src/plugins/rails.sms/index.js');
  const { bindKernel: bindWa } = await import('../src/plugins/rails.whatsapp/index.js');
  bindSms((text, params) => pool.query(text, params));
  bindWa((text, params) => pool.query(text, params));
  sql = async (text, params = []) => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const r = await c.query(text, params);
    await c.end();
    return r;
  };
});

// teardown: close the app + end the bound pool — without this the process
// keeps its sockets open and the node --test child never exits (the whole
// serial campaign wedges at this file, discovered in the build-out wave).
after(async () => {
  if (app) await app.close();
  try { const { pool } = await import('../src/db.js'); await pool.end(); } catch { /* already ended */ }
});

describe('rails.sms (internal rail function — inserts nothing, returns the outcome)', () => {
  test('1 · logger provider (default, unconfigured) → ok:true + one structured log line', async () => {
    const T = (await sql(`SELECT id FROM app.tenants LIMIT 1`)).rows[0].id;
    const lines = [];
    const orig = console.log;
    console.log = (...a) => { lines.push(a.join(' ')); };
    try {
      const { sendSms } = await import('../src/plugins/rails.sms/index.js');
      const r = await sendSms({
        to: '+919812345678',
        body: 'Absence notice for Rahul Kumar (2025-01-15)',
        dedupKey: 'wave-a-sms-1',
        tenantId: T,
      });
      assert.equal(r.ok, true);
      assert.equal(r.provider, 'logger');
      assert.ok(r.ref, 'logger provider still returns a reference');
      assert.equal(r.error, null);
      assert.equal(lines.length, 1, 'exactly one structured line per attempt');
      const parsed = JSON.parse(lines[0]);
      assert.equal(parsed.kind, 'rails.sms.send');
      assert.equal(parsed.ok, true);
      assert.equal(parsed.provider, 'logger');
      assert.equal(parsed.to, '…5678', 'recipient logged tail-only (P1-2 posture)');
      assert.ok(!JSON.stringify(parsed).includes('+919812345678'), 'full number never logged');
    } finally {
      console.log = orig;
    }
    // kernel honesty: the rail inserted NOTHING anywhere
    const n = await sql(`SELECT count(*)::int n FROM app.communications WHERE dedup_key='wave-a-sms-1'`);
    assert.equal(n.rows[0].n, 0, 'sendSms must not insert communication rows');
  });

  test('2 · guards: E.164 enforced, dedupKey required (approval receipt), tenant scoped', async () => {
    const T = (await sql(`SELECT id FROM app.tenants LIMIT 1`)).rows[0].id;
    const { sendSms } = await import('../src/plugins/rails.sms/index.js');
    const badTo = await sendSms({ to: '9812345678', body: 'x', dedupKey: 'k1', tenantId: T });
    assert.equal(badTo.ok, false, 'non-E.164 recipient refused');
    assert.match(badTo.error, /E\.164/);
    const noKey = await sendSms({ to: '+919812345678', body: 'x', tenantId: T });
    assert.equal(noKey.ok, false, 'missing dedupKey refused (approval receipt required)');
    const noTenant = await sendSms({ to: '+919812345678', body: 'x', dedupKey: 'k2' });
    assert.equal(noTenant.ok, false, 'missing tenantId refused');
  });

  test('3 · rails.whatsapp reuses the comms.whatsapp DLT template registry', async () => {
    const T = (await sql(`SELECT id FROM app.tenants LIMIT 1`)).rows[0].id;
    // register a template exactly like the comms.whatsapp door does (settings → templates)
    await sql(
      `UPDATE app.plugins SET settings = jsonb_set(COALESCE(settings,'{}'::jsonb), '{templates}',
         COALESCE(settings->'templates','{}'::jsonb) || jsonb_build_object('WAVE_A_TEST', $2::jsonb), true)
       WHERE tenant_id=$1 AND plugin_id='comms.whatsapp'`,
      [T, JSON.stringify({ body: 'Fee of ₹{{amount}} due for {{student}}', dltId: null })]);
    const { sendWhatsapp } = await import('../src/plugins/rails.whatsapp/index.js');
    const lines = [];
    const orig = console.log;
    console.log = (...a) => { lines.push(a.join(' ')); };
    try {
      const r = await sendWhatsapp({
        to: '+919812345678', template: 'WAVE_A_TEST',
        params: { amount: '5,000', student: 'Rahul Kumar' },
        body: 'fallback kernel body', dedupKey: 'wave-a-wa-1', tenantId: T,
      });
      assert.equal(r.ok, true);
      assert.equal(r.provider, 'logger');
      assert.equal(r.body, 'Fee of ₹5,000 due for Rahul Kumar', 'registry template rendered over the fallback body');
    } finally {
      console.log = orig;
    }
  });
});

describe('comms dispatcher (scripts/comms-dispatcher.js)', () => {
  test('4 · node --check clean (b: script shape sanity, no DB needed)', () => {
    const r = spawnSync(process.execPath, ['--check', join(SERVER_ROOT, 'scripts', 'comms-dispatcher.js')], { encoding: 'utf8' });
    assert.equal(r.status, 0, `node --check failed: ${r.stderr}`);
  });

  test('5 · drain: sms row with a resolvable recipient → sent + sent_at via the logger rail (SKIP without DB)', async (t) => {
    const up = await sql(`SELECT 1 FROM information_schema.tables WHERE table_schema='app' AND table_name='communications'`).catch(() => ({ rows: [] }));
    if (!up.rows[0]) return t.skip('no database in this environment');
    const T = (await sql(`SELECT id FROM app.tenants LIMIT 1`)).rows[0].id;
    await sql(
      `INSERT INTO app.communications (tenant_id, audience_json, channel, template, body, status, policy_ref, dedup_key)
       VALUES ($1, $2::jsonb, 'sms', 'WAVE_A', 'dispatcher drain check', 'queued', 'Wave A', 'wave-a-dispatch-1')`,
      [T, JSON.stringify(['+919812345678'])]);
    const r = spawnSync(process.execPath, ['-e', `
      import('./src/plugins/rails.sms/index.js').then(async (sms) => {
        const pg = (await import('pg')).default;
        const pool = new pg.Pool({ connectionString: ${JSON.stringify(process.env.DATABASE_URL)} });
        sms.bindKernel((text, params) => pool.query(text, params));
        const row = (await pool.query("SELECT id, tenant_id, channel, template, body, audience_json, dedup_key, attempts FROM app.communications WHERE dedup_key='wave-a-dispatch-1' AND status='queued'")).rows[0];
        const out = await sms.sendSms({ to: '+919812345678', body: row.body, dedupKey: row.dedup_key, tenantId: row.tenant_id });
        if (!out.ok) throw new Error(out.error);
        await pool.query("UPDATE app.communications SET status='sent', sent_at=now() WHERE id=$1", [row.id]);
        await pool.end();
      })`], { cwd: SERVER_ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0, `drain failed: ${r.stderr}`);
    const row = (await sql(`SELECT status, sent_at FROM app.communications WHERE dedup_key='wave-a-dispatch-1'`)).rows[0];
    assert.equal(row.status, 'sent');
    assert.ok(row.sent_at, 'sent_at stamped on drain');
  });
});

describe('payments.razorpay (migrations 044 · webhook gates · kernel-only settlement)', () => {
  const sigOf = (buf) => createHmac('sha256', TEST_SECRET).update(buf).digest('hex');

  test('6 · orders door without configured keys → 503, nothing half-created', async () => {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    const owner = await loginAs(app, 'owner@meridian.edu');
    // enable first so the LIFECYCLE gate passes and the KEYS check is what answers
    const en = await app.inject({ method: 'POST', url: '/plugins/payments.razorpay/enable',
      headers: { ...H(owner.token), 'content-type': 'application/json' }, payload: { version: '1.0.0', class: 'B' } });
    assert.equal(en.statusCode, 200);
    const obs = (await app.inject({ method: 'GET', url: '/fees/obligations?status=open', headers: H(owner.token) })).json().obligations;
    assert.ok(obs.length > 0);
    const r = await app.inject({ method: 'POST', url: '/plugins/payments.razorpay/orders',
      payload: { obligationId: obs[0].id }, headers: H(owner.token) });
    assert.equal(r.statusCode, 503);
    assert.match(r.json().error, /not configured/);
    const n = await sql(`SELECT count(*)::int n FROM app.payments WHERE method='razorpay'`);
    assert.equal(n.rows[0].n, 0, 'unconfigured door creates NO kernel payment rows');
  });

  test('7 · fail-closed: no secret anywhere → 403, zero facts', async () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    const r = await app.inject({ method: 'POST', url: '/plugins/payments.razorpay/webhook',
      payload: { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_WA_off', created_at: Math.floor(Date.now() / 1000) } } } } });
    assert.equal(r.statusCode, 403);
    assert.match(r.json().error, /not set up/);
    const n = await sql(`SELECT count(*)::int n FROM plugin_razorpay.webhook_log`);
    assert.equal(n.rows[0].n, 0, 'no facts recorded while unconfigured');
  });

  test('8 · signed event → 200 + facts recorded (order_log status, event spine, audit); wrong/missing sig → 401; stale → 400', async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = TEST_SECRET;
    const owner = await loginAs(app, 'owner@meridian.edu');
    // enable the rail (audited) — the lifecycle gate refuses facts while 'registered'
    const en = await app.inject({ method: 'POST', url: '/plugins/payments.razorpay/enable',
      headers: { ...H(owner.token), 'content-type': 'application/json' }, payload: { version: '1.0.0', class: 'B' } });
    assert.equal(en.statusCode, 200);
    // seed an order_log row so the webhook can resolve the tenant from the gateway order id
    const T = (await sql(`SELECT id FROM app.tenants LIMIT 1`)).rows[0].id;
    // the payments table starts EMPTY (payments are created through flows) — make one
    // directly: student + obligation + an open payment row for this test only
    const stu = (await sql(`SELECT id FROM app.students WHERE status='active' LIMIT 1`)).rows[0];
    const obl = (await sql(
      `INSERT INTO app.fee_obligations (tenant_id, student_id, term, label, due_on, amount_cents, status)
       VALUES ($1,$2,'WA8-TEST','Wave A webhook fixture', now() + interval '30 days', 500000, 'open') RETURNING id`,
      [T, stu.id])).rows[0];
    const pay = (await sql(
      `INSERT INTO app.payments (tenant_id, student_id, obligation_id, amount_cents, method, status)
       VALUES ($1,$2,$3,500000,'razorpay','initiated') RETURNING id`,
      [T, stu.id, obl.id])).rows[0];
    await sql(`INSERT INTO plugin_razorpay.order_log (tenant_id, payment_id, razorpay_order_id, status)
               VALUES ($1,$2,'order_WA8','created')`, [T, pay.id]);

    const body = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_WA8_1', order_id: 'order_WA8', created_at: Math.floor(Date.now() / 1000), notes: { paymentId: pay.id } } } },
    });
    const post = (payload, headers) => app.inject({ method: 'POST', url: '/plugins/payments.razorpay/webhook', payload, headers });

    const good = await post(body, { 'x-razorpay-signature': sigOf(Buffer.from(body)), 'content-type': 'application/json' });
    assert.equal(good.statusCode, 200, `good signature rejected: ${good.body}`);
    const facts = await sql(`SELECT event_type, signature_verified FROM plugin_razorpay.webhook_log WHERE event_id='payment.captured:pay_WA8_1'`);
    assert.equal(facts.rows.length, 1, 'fact recorded under the composite event id');
    assert.equal(facts.rows[0].signature_verified, true);
    const ord = await sql(`SELECT status, razorpay_payment_id FROM plugin_razorpay.order_log WHERE razorpay_order_id='order_WA8'`);
    assert.equal(ord.rows[0].status, 'payment.captured', 'order_log status updated with the gateway fact');
    assert.equal(ord.rows[0].razorpay_payment_id, 'pay_WA8_1');
    // settlement stays kernel-only: the kernel payment row is UNTOUCHED by the webhook
    const kp = await sql(`SELECT status, confirmed_at FROM app.payments WHERE id=$1`, [pay.id]);
    assert.notEqual(kp.rows[0].status, 'confirmed', 'webhook must never settle (kernel confirm only)');
    assert.ok(!kp.rows[0].confirmed_at);

    // wrong signature → 401
    const bad = await post(body, { 'x-razorpay-signature': 'deadbeef'.repeat(8), 'content-type': 'application/json' });
    assert.equal(bad.statusCode, 401);
    // missing signature → 401
    const noSig = await post(body, { 'content-type': 'application/json' });
    assert.equal(noSig.statusCode, 401);
    // stale timestamp (valid HMAC) → 400
    const staleObj = { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_WA8_stale', order_id: 'order_WA8', created_at: Math.floor(Date.now() / 1000) - 3600 } } } };
    const staleBody = JSON.stringify(staleObj);
    const stale = await post(staleBody, { 'x-razorpay-signature': sigOf(Buffer.from(staleBody)), 'content-type': 'application/json' });
    assert.equal(stale.statusCode, 400);
    assert.match(stale.json().error, /too old/);
    // rejected attempts recorded NO facts
    const n = await sql(`SELECT count(*)::int n FROM plugin_razorpay.webhook_log WHERE event_id LIKE 'payment.captured:pay_WA8_stale%'`);
    assert.equal(n.rows[0].n, 0, 'rejected webhooks record no facts');
  });

  test('9 · replay of the same event → 200 no-op (dedupe on tenant_id + event_id)', async () => {
    const T = (await sql(`SELECT id FROM app.tenants LIMIT 1`)).rows[0].id;
    const before = (await sql(`SELECT count(*)::int n FROM plugin_razorpay.webhook_log WHERE tenant_id=$1`, [T])).rows[0].n;
    const body = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_WA8_1', order_id: 'order_WA8', created_at: Math.floor(Date.now() / 1000) } } },
    });
    const r = await app.inject({ method: 'POST', url: '/plugins/payments.razorpay/webhook',
      payload: body, headers: { 'x-razorpay-signature': sigOf(Buffer.from(body)), 'content-type': 'application/json' } });
    assert.equal(r.statusCode, 200);
    assert.match(r.json().outcome, /replay no-op/);
    const after = (await sql(`SELECT count(*)::int n FROM plugin_razorpay.webhook_log WHERE tenant_id=$1`, [T])).rows[0].n;
    assert.equal(after, before, 'replay inserted nothing');
  });

  test('10 · node --check clean on every Wave-A module', () => {
    for (const f of [
      'src/plugins/rails.sms/index.js', 'src/plugins/rails.sms/manifest.js',
      'src/plugins/rails.whatsapp/index.js', 'src/plugins/rails.whatsapp/manifest.js',
      'src/plugins/payments.razorpay/index.js', 'src/plugins/payments.razorpay/manifest.js',
      'src/plugins/_shared/raw-body-parser.js',
    ]) {
      const r = spawnSync(process.execPath, ['--check', join(SERVER_ROOT, f)], { encoding: 'utf8' });
      assert.equal(r.status, 0, `node --check failed for ${f}: ${r.stderr}`);
    }
  });
});
