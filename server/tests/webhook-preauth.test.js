// SEC-21 — the payment webhook doors must not do payload-driven work before verification.
//
// WHAT WAS WRONG (razorpay rail, verified in the source before fixing):
//   The handler built its HMAC candidate list as [env secret] + [the RESOLVED tenant's
//   webhook_secret], and resolved the tenant from ids the CALLER supplies (order_log by
//   razorpay_order_id, then app.payments by notes.paymentId). In a per-tenant-secret deployment
//   (no env secret) that made the pre-verification answer depend entirely on the payload:
//     * an order id that resolved to a secret-bearing tenant  → 401 "could not be verified"
//     * an order id that resolved to nothing                  → 403 "Payments are not set up yet"
//   So an unauthenticated caller could probe which order ids exist AND which schools have the rail
//   configured, at two indexed owner-path queries + one settings read per guess, with a timing signal
//   to match. Both rails also FAILED OPEN on a missing timestamp: `if (ts != null)` made replay
//   defence opt-in by the sender, so a signed body with the timestamp field removed bypassed the
//   freshness window completely — the one case the window exists to catch.
//
// The assertions below are ordered so the FIRST one fails if verification ever moves back after
// payload-driven work, and the rest prove the fix is not vacuous (a door that refuses everything
// would pass the oracle test but destroy the product).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import pg from 'pg';
import { setupTestDb } from './helpers.js';

const RAIL = 'payments.razorpay';
const SECRET_A = 'sec21-tenant-a-secret';
const SECRET_B = 'sec21-tenant-b-secret';

let app;
let sql;
let A; // tenant that OWNS the order id used in the probes
let B; // a second school, used for the cross-tenant binding test
let orderA; // order id belonging to A
const sign = (body, secret) => createHmac('sha256', secret).update(Buffer.from(body)).digest('hex');

const post = (body, headers = {}) => app.inject({
  method: 'POST', url: `/plugins/${RAIL}/webhook`, payload: body,
  headers: { 'content-type': 'application/json', ...headers },
});
const unsigned = (orderId) => JSON.stringify({
  event: 'payment.captured',
  payload: { payment: { entity: { id: `pay_${Math.random().toString(36).slice(2)}`, order_id: orderId, created_at: Math.floor(Date.now() / 1000) } } },
});

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  // SEC-21 exercises the PER-TENANT secret path, so the env secret must be absent: with an env secret
  // present the candidates never touch the payload at all and the oracle cannot occur.
  //
  // ORDER MATTERS: src/config.js loads .env at import time, and this repo's .env really does define
  // RAZORPAY_WEBHOOK_SECRET — so deleting it BEFORE the import silently restores it, the env branch
  // wins, and every assertion below would be testing the wrong code path while still passing the
  // checks it thinks it is making. The guard assertion turns that mistake into a loud failure.
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
  assert.equal(process.env.RAZORPAY_WEBHOOK_SECRET, undefined,
    'this file must exercise the per-tenant secret path — unset the env secret AFTER the app import');
  app = await buildApp({ logger: false });
  await app.ready();
  const { pool } = await import('../src/db.js');
  sql = (text, params = []) => pool.query(text, params);

  A = (await sql(`SELECT id FROM app.tenants ORDER BY created_at LIMIT 1`)).rows[0].id;
  B = (await sql(`INSERT INTO app.tenants (id, slug, name, config)
                  VALUES (gen_random_uuid(), $1, 'SEC-21 Second School', '{}'::jsonb) RETURNING id`,
                 [`sec21-b-${Date.now()}`])).rows[0].id;
  orderA = `order_SEC21_${Date.now()}`;

  // A real, resolvable order for tenant A, and the kernel payment row behind it.
  const stu = (await sql(`SELECT id FROM app.students WHERE status='active' LIMIT 1`)).rows[0];
  const obl = (await sql(
    `INSERT INTO app.fee_obligations (tenant_id, student_id, term, label, due_on, amount_cents, status)
     VALUES ($1,$2,'SEC21','SEC-21 probe fixture', now() + interval '30 days', 100000, 'open') RETURNING id`,
    [A, stu.id])).rows[0];
  const pay = (await sql(
    `INSERT INTO app.payments (tenant_id, student_id, obligation_id, amount_cents, method, status)
     VALUES ($1,$2,$3,100000,'razorpay','initiated') RETURNING id`, [A, stu.id, obl.id])).rows[0];
  await sql(`INSERT INTO plugin_razorpay.order_log (tenant_id, payment_id, razorpay_order_id, status)
             VALUES ($1,$2,$3,'created')`, [A, pay.id, orderA]);

  // Both rails enabled with a PER-TENANT secret and a distinct one per school. The catalog rows are
  // created LAZILY (on signup / the self-heal in GET /plugins), so they are seeded through the
  // production path rather than a hand-rolled app.plugins INSERT that could drift from it.
  const { ensurePluginCatalog } = await import('../src/plugin-catalog.js');
  for (const [t, secret] of [[A, SECRET_A], [B, SECRET_B]]) {
    await ensurePluginCatalog({ query: (text, params) => sql(text, params) }, t);
    const upd = await sql(
      `UPDATE app.plugins SET status='enabled', settings = COALESCE(settings,'{}'::jsonb) || jsonb_build_object('webhook_secret',$2::text)
        WHERE tenant_id=$1 AND plugin_id=$3`, [t, secret, RAIL]);
    assert.equal(upd.rowCount, 1, `the ${RAIL} row must exist for the seeded catalog`);
  }
});
after(async () => { await app?.close(); });

describe('SEC-21: the pre-verification answer does not depend on the payload', () => {
  test('THE REGRESSION GATE — an unsigned probe gets ONE answer, resolving order id or not', async () => {
    const real = await post(unsigned(orderA), { 'x-razorpay-signature': 'ab'.repeat(32) });
    const fake = await post(unsigned('order_DOES_NOT_EXIST_AT_ALL'), { 'x-razorpay-signature': 'ab'.repeat(32) });

    // Before the fix these were 401 and 403 respectively — an unauthenticated existence oracle.
    assert.equal(real.statusCode, fake.statusCode,
      `an unauthenticated caller must not be able to tell a real order id from a fake one (got ${real.statusCode} vs ${fake.statusCode})`);
    assert.equal(real.body, fake.body, 'and the bodies must be byte-identical, not merely the same status');

    // Which answer it is matters less than its uniformity — but it must be a refusal.
    assert.equal(real.statusCode, 401, `an unsigned request must be refused (got ${real.body})`);
    assert.doesNotMatch(real.body, /not set up/i,
      'the "rail not configured" answer must not be reachable from a payload-shaped guess');
  });

  test('an unsigned probe is refused identically whether or not any secret exists', async () => {
    // Disable both rails' secrets so the candidate set is empty; the answer must still be a refusal
    // that reveals nothing, and turning the rail off must not become a payload-dependent signal.
    await sql(`UPDATE app.plugins SET settings = settings - 'webhook_secret' WHERE plugin_id=$1`, [RAIL]);
    try {
      const real = await post(unsigned(orderA), { 'x-razorpay-signature': 'ab'.repeat(32) });
      const fake = await post(unsigned('order_DOES_NOT_EXIST_AT_ALL'), { 'x-razorpay-signature': 'ab'.repeat(32) });
      assert.equal(real.statusCode, 403, 'with no secret anywhere the rail is OFF (the documented fail-closed contract)');
      assert.equal(real.statusCode, fake.statusCode);
      assert.equal(real.body, fake.body, 'turning the rail off must not be observable per-payload');
    } finally {
      for (const [t, secret] of [[A, SECRET_A], [B, SECRET_B]]) {
        await sql(`UPDATE app.plugins SET settings = settings || jsonb_build_object('webhook_secret',$2::text)
                    WHERE tenant_id=$1 AND plugin_id=$3`, [t, secret, RAIL]);
      }
    }
  });

  test('a missing signature and a wrong signature are indistinguishable', async () => {
    const none = await post(unsigned(orderA));
    const wrong = await post(unsigned(orderA), { 'x-razorpay-signature': 'deadbeef'.repeat(8) });
    const malformed = await post(unsigned(orderA), { 'x-razorpay-signature': 'not-hex-at-all' });
    assert.equal(none.statusCode, 401);
    assert.equal(wrong.statusCode, 401);
    assert.equal(malformed.statusCode, 401, 'a non-hex signature must not be a distinguishable error');
    assert.equal(none.body, wrong.body);
    assert.equal(none.body, malformed.body);
  });

  test('NOT VACUOUS — a correctly signed event still lands, with its facts recorded', async () => {
    const body = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: `pay_SEC21_ok_${Date.now()}`, order_id: orderA, created_at: Math.floor(Date.now() / 1000) } } },
    });
    const r = await post(body, { 'x-razorpay-signature': sign(body, SECRET_A) });
    assert.equal(r.statusCode, 200, `a properly signed event must still be accepted: ${r.body}`);
    const evId = JSON.parse(body).payload.payment.entity.id;
    const facts = (await sql(`SELECT signature_verified FROM plugin_razorpay.webhook_log WHERE event_id=$1`, [`payment.captured:${evId}`])).rows;
    assert.equal(facts.length, 1, 'the fact must be recorded');
    assert.equal(facts[0].signature_verified, true);
  });

  test('a per-tenant secret cannot inject facts into ANOTHER school', async () => {
    // The second half of SEC-21: school B holds its own valid secret. Without a binding between the
    // secret that proved the event and the tenant the payload resolves to, B could sign a body naming
    // A's order id and have the resulting fact written into A's ledger — cross-tenant forgery by any
    // party holding any one school's key.
    const body = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: `pay_SEC21_cross_${Date.now()}`, order_id: orderA, created_at: Math.floor(Date.now() / 1000) } } },
    });
    const evId = JSON.parse(body).payload.payment.entity.id;
    const r = await post(body, { 'x-razorpay-signature': sign(body, SECRET_B) });
    assert.equal(r.statusCode, 403, `B's signature over A's order must be refused (got ${r.statusCode}: ${r.body})`);
    assert.match(r.body, /does not belong to the school that signed it/);
    const leaked = (await sql(`SELECT count(*)::int n FROM plugin_razorpay.webhook_log WHERE event_id=$1`, [`payment.captured:${evId}`])).rows[0].n;
    assert.equal(leaked, 0, 'a cross-tenant signature must write NO fact');

    // and the same body signed by the RIGHT school still works — the binding must not over-block
    const okBody = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: `pay_SEC21_own_${Date.now()}`, order_id: orderA, created_at: Math.floor(Date.now() / 1000) } } },
    });
    const ok = await post(okBody, { 'x-razorpay-signature': sign(okBody, SECRET_A) });
    assert.equal(ok.statusCode, 200, `A's own signature must still be accepted: ${ok.body}`);
  });
});

describe('SEC-21: freshness cannot be skipped by omitting the timestamp', () => {
  test('a signed event with NO timestamp is refused, not waved through', async () => {
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: `pay_SEC21_nots_${Date.now()}`, order_id: orderA } } } });
    const evId = JSON.parse(body).payload.payment.entity.id;
    const r = await post(body, { 'x-razorpay-signature': sign(body, SECRET_A) });
    assert.equal(r.statusCode, 400, `omitting the timestamp must not bypass freshness (got ${r.statusCode}: ${r.body})`);
    assert.match(r.body, /no timestamp/);
    const n = (await sql(`SELECT count(*)::int n FROM plugin_razorpay.webhook_log WHERE event_id=$1`, [`payment.captured:${evId}`])).rows[0].n;
    assert.equal(n, 0, 'a rejected event records no facts');
  });

  test('the body.timestamp fallback is still honoured (the check is not simply always-fail)', async () => {
    const body = JSON.stringify({
      timestamp: Math.floor(Date.now() / 1000),
      event: 'payment.captured',
      payload: { payment: { entity: { id: `pay_SEC21_bts_${Date.now()}`, order_id: orderA } } },
    });
    const r = await post(body, { 'x-razorpay-signature': sign(body, SECRET_A) });
    assert.equal(r.statusCode, 200, `a top-level timestamp is a legitimate freshness source: ${r.body}`);
  });

  test('a stale timestamp is still refused', async () => {
    const body = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: `pay_SEC21_stale_${Date.now()}`, order_id: orderA, created_at: Math.floor(Date.now() / 1000) - 7200 } } },
    });
    const r = await post(body, { 'x-razorpay-signature': sign(body, SECRET_A) });
    assert.equal(r.statusCode, 400);
    assert.match(r.body, /too old/);
  });
});
