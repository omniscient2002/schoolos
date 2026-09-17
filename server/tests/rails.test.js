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
    // PLG-10: the rail resolves its template owner through the `comms.whatsapp.templates` CAPABILITY, and
    // the resolver only selects an ENABLED provider — a row carrying templates but switched off is not the
    // owner. Enable it (the seeded row already carries the manifest that declares the capability).
    await sql(
      `UPDATE app.plugins SET status='enabled', settings = jsonb_set(COALESCE(settings,'{}'::jsonb), '{templates}',
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

  test('5 · drain: the REAL dispatcher claims, sends, and books an undeliverable honestly', async () => {
    /* TST-5: this was
         const up = await sql(`SELECT 1 FROM information_schema.tables WHERE ...`
           + ` AND table_name='communications'`).catch(() => ({ rows: [] }));
         if (!up.rows[0]) return t.skip('no database in this environment');
       two failures in two lines. The `.catch(() => ({ rows: [] }))` turned ANY error — a dead
       connection, a permission fault, a typo in the catalog query — into "the table is absent", and
       the bare skip then retired the whole test. The skip's stated reason was also false: setupTestDb()
       creates the database and runs migrate, and 043_comms_dispatch.sql creates app.communications
       unconditionally, so the only way to land here is a genuinely broken fixture. Asserted instead. */
    const up = await sql(`SELECT to_regclass('app.communications') IS NOT NULL AS ok`);
    assert.ok(up.rows[0].ok,
      'fixture: app.communications must exist (migration 043) — the real dispatcher cannot be exercised without it');
    const T = (await sql(`SELECT id FROM app.tenants LIMIT 1`)).rows[0].id;

    /* TST-4: this test used to spawn an inline script that RE-IMPLEMENTED the drain — read the queued row, call
       sendSms, UPDATE status — so it passed with `scripts/comms-dispatcher.js` deleted. A test that duplicates
       the code under test verifies the duplication. The dispatcher now exports `tick()` (and `shutdown`, so a
       test process ends without a stranded pool), and this drives the real worker. */
    await sql(`DELETE FROM app.communications WHERE dedup_key IN ('wave-a-dispatch-1','wave-a-dispatch-bad')`);
    await sql(
      `INSERT INTO app.communications (tenant_id, audience_json, channel, template, body, status, policy_ref, dedup_key)
       VALUES ($1, $2::jsonb, 'sms', 'WAVE_A', 'dispatcher drain check', 'queued', 'Wave A', 'wave-a-dispatch-1'),
              ($1, '[]'::jsonb, 'sms', 'WAVE_A', 'no recipient at all', 'queued', 'Wave A', 'wave-a-dispatch-bad')`,
      [T, JSON.stringify(['+919812345678'])]);

    const { tick, shutdown, processClaimedRow } = await import('../scripts/comms-dispatcher.js');
    const dbPool = (await import('../src/db.js')).pool;
    try {
      // ── half 1: the real worker claims and drains ──────────────────────────────
      await tick();
    } catch (e) {
      await shutdown();
      throw e;
    }

    const ok = (await sql(`SELECT status, sent_at, provider, attempts FROM app.communications WHERE dedup_key='wave-a-dispatch-1'`)).rows[0];
    assert.equal(ok.status, 'sent', 'the real dispatcher drained the row');
    assert.ok(ok.sent_at, 'sent_at stamped by the dispatcher, not by the test');
    assert.equal(ok.provider, 'logger', 'and the row names the carrier that took it');

    /* ── half 2: the honesty gate, on the path the worker itself calls ───────────
       A row with no resolvable recipient has no carrier: the dispatcher writes a durable log line and reports
       provider='log-only'. In development that counts as sent (the text IS on the operator's console); in
       PRODUCTION it is not a delivery, because no message would reach anyone. That distinction is exactly what
       the old inline test could not express — it had no notion of a carrier. Driven through the exported
       `processClaimedRow` instead of a live HTTP provider, because a real network failure is timing-dependent
       and the invariant under test is the DECISION, not the socket. */
    const badRow = (await sql(`SELECT * FROM app.communications WHERE dedup_key='wave-a-dispatch-bad'`)).rows[0];
    assert.ok(badRow, 'fixture: the recipient-less row exists');
    const c = await dbPool.connect();
    let decision;
    try {
      decision = await processClaimedRow(c, badRow, { allowSandbox: false });
    } finally {
      c.release();
      await shutdown();
    }
    assert.equal(decision.outcome, 'undeliverable',
      `a carrier that only writes a log line is not a delivery in production: ${JSON.stringify(decision)}`);
    assert.match(String(decision.error ?? ''), /log line|no message would reach/i, 'and the reason names the carrier');
    const after = (await sql(`SELECT sent_at, last_error FROM app.communications WHERE dedup_key='wave-a-dispatch-bad'`)).rows[0];
    assert.equal(after.sent_at, null, 'no send timestamp for a message nobody received');
    assert.ok(after.last_error, 'and an operator can read why');
    await sql(`DELETE FROM app.communications WHERE dedup_key IN ('wave-a-dispatch-1','wave-a-dispatch-bad')`);
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
