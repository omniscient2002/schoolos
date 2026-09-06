// payments.upi — wave-1 unit #2 tests (per-plugin migration 015 + factory drop-in)
// Red-team cycle-3 P0/P1 blocking requirements, all pinned here:
//   1. fail-closed: secret unset → 403 'webhook not configured'; set → missing/invalid sig 401
//   2. raw-bytes MAC (HMAC over req.rawBody, never re-serialized JSON)
//   3. replay dedupes webhook_log AND event spine AND audit (one audit row per unique event)
//   4. freshness: stale events rejected (15 min default, settings-overridable)
//   5. malformed JSON → 400, never 500
//   6. lifecycle: webhook for a non-enabled plugin row → 409
//   7. letter-first id regex (9lives-class ids rejected) — pinned in plugin-loader.test.js
//   8. residue cleanup migration — 016 (asserted by hand in dev DB; ledger retained)
// Standing invariants: settlement stays kernel-only (Fees §4.2); 015 bare-kernel contract.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createHmac } from 'node:crypto';
import { setupTestDb, loginAs } from './helpers.js';

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const TEST_SECRET = 'upi-test-secret-unit-2-not-production';

let app;
let sql;

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });   // built while the secret is UNSET → fail-closed path
  await app.ready();
  sql = async (text, params = []) => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const r = await c.query(text, params);
    await c.end();
    return r;
  };
});

describe('payments.upi (wave-1 #2 · migration 015 · cycle-3 hardening)', () => {
  const payloadFor = (paymentId, eventId, createdAt) => ({
    event: 'payment.captured',
    payload: { payment: { entity: { id: eventId, created_at: createdAt, notes: { paymentId } } } },
  });
  const sigOf = (obj) => createHmac('sha256', TEST_SECRET).update(JSON.stringify(obj)).digest('hex');

  test('1 · fail-closed: no secret → webhook refused entirely, zero facts', async () => {
    // dotenv loaded server/.env at import — clear it to exercise the unconfigured path
    delete process.env.UPI_WEBHOOK_SECRET;
    const r = await app.inject({ method: 'POST', url: '/plugins/payments.upi/webhook',
      payload: { event: 'payment.captured', eventId: 'pay_U2_off' } });
    assert.equal(r.statusCode, 403);
    assert.match(r.json().error, /not configured/);
    const n = await sql(`SELECT count(*)::int n FROM plugin_upi.webhook_log`);
    assert.equal(n.rows[0].n, 0, 'no facts recorded while unconfigured');
  });

  test('2 · HMAC required + lifecycle gate + freshness + spine/audit dedupe + kernel-only settlement', async () => {
    // activate the required-HMAC mode on the SAME app (webhook reads env per request)
    process.env.UPI_WEBHOOK_SECRET = TEST_SECRET;

    const fin = await loginAs(app, 'finance@meridian.edu');
    const obs = (await app.inject({ method: 'GET', url: '/fees/obligations?status=open', headers: H(fin.token) })).json().obligations;
    assert.ok(obs.length > 0);
    const target = obs[0];
    const paidBefore = Number(target.paid_cents ?? 0);

    // LINK-DOOR lifecycle gate: the row is 'registered' → the links door 409s (P2-1)
    const o = await loginAs(app, 'owner@meridian.edu');
    const preLink = await app.inject({ method: 'POST', url: '/plugins/payments.upi/links', payload: { obligationId: target.id }, headers: H(fin.token) });
    assert.equal(preLink.statusCode, 409, 'links door refuses while the plugin row is not enabled');
    assert.match(preLink.json().error, /not enabled/);

    // owner enables the rail (audited) — now the links door serves
    const en = await app.inject({ method: 'POST', url: '/plugins/payments.upi/enable',
      headers: { ...H(o.token), 'content-type': 'application/json' }, payload: { version: '1.0.0', class: 'B' } });
    assert.equal(en.statusCode, 200);

    // link: for the DUE amount only, kernel payment row initiated
    const link = await app.inject({ method: 'POST', url: '/plugins/payments.upi/links', payload: { obligationId: target.id }, headers: H(fin.token) });
    assert.equal(link.statusCode, 200);
    const { paymentId, amountCents } = link.json();
    assert.equal(amountCents, String(Number(target.amount_cents) - paidBefore));

    // WEBHOOK lifecycle gate: disable the row again → even a VALID HMAC is 409
    const fresh = payloadFor(paymentId, 'pay_U2_1', Math.floor(Date.now() / 1000));
    const dis = await app.inject({ method: 'POST', url: '/plugins/payments.upi/disable',
      headers: { ...H(o.token), 'content-type': 'application/json' }, payload: {} });
    assert.equal(dis.statusCode, 200);
    const preEnable = await app.inject({ method: 'POST', url: '/plugins/payments.upi/webhook',
      payload: fresh, headers: { 'x-razorpay-signature': sigOf(fresh) } });
    assert.equal(preEnable.statusCode, 409, 'webhook for a non-enabled plugin row is 409');
    const preRows = await sql(`SELECT count(*)::int n FROM plugin_upi.webhook_log WHERE event_id='pay_U2_1'`);
    assert.equal(preRows.rows[0].n, 0, 'lifecycle-gated webhook records no facts');

    // re-enable (audited) — now facts may flow
    const en2 = await app.inject({ method: 'POST', url: '/plugins/payments.upi/enable',
      headers: { ...H(o.token), 'content-type': 'application/json' }, payload: { version: '1.0.0', class: 'B' } });
    assert.equal(en2.statusCode, 200);

    // HMAC gate: unsigned and bad-signature both 401, no facts
    const noSig = await app.inject({ method: 'POST', url: '/plugins/payments.upi/webhook', payload: fresh });
    assert.equal(noSig.statusCode, 401);
    const badSig = await app.inject({ method: 'POST', url: '/plugins/payments.upi/webhook', payload: fresh, headers: { 'x-razorpay-signature': 'deadbeef' } });
    assert.equal(badSig.statusCode, 401);
    const noFacts = await sql(`SELECT count(*)::int n FROM plugin_upi.webhook_log WHERE event_id='pay_U2_1'`);
    assert.equal(noFacts.rows[0].n, 0, 'rejected webhooks record NO facts');

    // FRESHNESS gate: valid HMAC but stale timestamp → 400
    const stale = payloadFor(paymentId, 'pay_U2_stale', Math.floor(Date.now() / 1000) - 3600);
    const staleR = await app.inject({ method: 'POST', url: '/plugins/payments.upi/webhook',
      payload: stale, headers: { 'x-razorpay-signature': sigOf(stale) } });
    assert.equal(staleR.statusCode, 400);
    assert.match(staleR.json().error, /stale/);

    // valid fresh HMAC → fact recorded, verified
    const wh = await app.inject({ method: 'POST', url: '/plugins/payments.upi/webhook',
      payload: fresh, headers: { 'x-razorpay-signature': sigOf(fresh) } });
    assert.equal(wh.statusCode, 200);
    assert.equal(wh.json().outcome.includes('kernel-only'), true);
    const vrow = await sql(`SELECT signature_verified FROM plugin_upi.webhook_log WHERE event_id='pay_U2_1'`);
    assert.equal(vrow.rows[0].signature_verified, true, 'fact recorded as HMAC-verified');

    // REPLAY: 200 no-op — webhook_log, event spine AND audit all deduped
    const wh2 = await app.inject({ method: 'POST', url: '/plugins/payments.upi/webhook',
      payload: fresh, headers: { 'x-razorpay-signature': sigOf(fresh) } });
    assert.equal(wh2.statusCode, 200);
    assert.match(wh2.json().outcome, /replay no-op/);
    const logN = await sql(`SELECT count(*)::int n FROM plugin_upi.webhook_log WHERE event_id='pay_U2_1'`);
    assert.equal(logN.rows[0].n, 1, 'webhook_log dedupe');
    const evN = await sql(`SELECT count(*)::int n FROM app.events WHERE payload->>'eventId'='pay_U2_1'`);
    assert.equal(evN.rows[0].n, 1, 'event spine dedupe');
    const audN = await sql(`SELECT count(*)::int n FROM app.audit_log WHERE action LIKE 'UPI webhook%' AND record_ref=$1`, [paymentId]);
    assert.equal(audN.rows[0].n, 1, 'one audit row per unique event');

    // settlement stays kernel-only: only the kernel confirm moves the ledger
    const settled = await app.inject({ method: 'POST', url: `/fees/payments/${paymentId}/confirm`, payload: { gatewayRef: 'pay_U2_1' }, headers: H(fin.token) });
    assert.equal(settled.statusCode, 200);
    const obAfter = await sql(`SELECT paid_cents FROM app.fee_obligations WHERE id=$1`, [target.id]);
    assert.equal(Number(obAfter.rows[0].paid_cents), paidBefore + Number(amountCents), 'ledger delta == kernel settlement exactly');
  });

  test('3 · JSON guard: malformed bodies are 4xx, never 5xx (even with a VALID signature)', async () => {
    process.env.UPI_WEBHOOK_SECRET = TEST_SECRET;
    const bad1 = await app.inject({ method: 'POST', url: '/plugins/payments.upi/webhook',
      payload: '{"broken":', headers: { 'content-type': 'application/json' } });
    assert.equal(bad1.statusCode, 400, 'malformed application/json → 400');
    // the real red-team shape: garbage body WITH a valid HMAC over its raw bytes
    const garbage = 'not json at all';
    const bad2 = await app.inject({ method: 'POST', url: '/plugins/payments.upi/webhook',
      payload: garbage, headers: { 'content-type': 'text/plain',
        'x-razorpay-signature': createHmac('sha256', TEST_SECRET).update(garbage).digest('hex') } });
    assert.equal(bad2.statusCode, 400, 'signed text/plain garbage → 400 (parse wrapped)');
    assert.match(bad2.json().error, /malformed/);
  });

  test('4 · letter-first id regex: digit-run ids bounced at the enable door', async () => {
    const o = await loginAs(app, 'owner@meridian.edu');
    for (const id of ['9lives', '1abc.def']) {
      const r = await app.inject({ method: 'POST', url: `/plugins/${id}/enable`,
        headers: { ...H(o.token), 'content-type': 'application/json' }, payload: { class: 'A' } });
      assert.equal(r.statusCode, 400, `digit-first id must be rejected: ${id}`);
    }
  });

  test('5 · links door: duplicate open attempt is 409 with the existing paymentId, never 23505→500', async () => {
    process.env.UPI_WEBHOOK_SECRET = TEST_SECRET;
    const fin = await loginAs(app, 'finance@meridian.edu');
    const obs = (await app.inject({ method: 'GET', url: '/fees/obligations?status=open', headers: H(fin.token) })).json().obligations;
    const target = obs[0];
    const l1 = await app.inject({ method: 'POST', url: '/plugins/payments.upi/links', payload: { obligationId: target.id }, headers: H(fin.token) });
    assert.equal(l1.statusCode, 200);
    const l2 = await app.inject({ method: 'POST', url: '/plugins/payments.upi/links', payload: { obligationId: target.id }, headers: H(fin.token) });
    assert.equal(l2.statusCode, 409, 'second link while attempt open → 409 (not 500)');
    assert.ok(l2.json().paymentId, '409 carries the existing paymentId (recoverable)');
    const l3 = await app.inject({ method: 'POST', url: '/plugins/payments.upi/links', payload: { obligationId: target.id }, headers: H(fin.token) });
    assert.equal(l3.statusCode, 409, 'stable, no new payment rows');
  });
});
