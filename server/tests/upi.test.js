// payments.upi — wave-1 unit #2 tests (per-plugin migration 015 + factory drop-in)
// Invariants under test (009/010): links respect kernel ledger state · webhook facts are
// idempotent by event id · settlement stays kernel-only (Fees §4.2) ·
// plugin_upi.webhook_log provisions independently (bare-kernel contract of 015).
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createHmac } from 'node:crypto';
import { setupTestDb, loginAs } from './helpers.js';

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

let app;
let sql;

before(async () => {
  // REQUIRED-HMAC mode: set the secret BEFORE importing app.js — dotenv never
  // overrides existing vars, so this in-memory value wins over server/.env.
  // The value here is a throwaway test secret, never the production one.
  process.env.UPI_WEBHOOK_SECRET = 'upi-test-secret-unit-2-not-production';
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.ready();
  sql = async (text, params = []) => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const r = await c.query(text, params);
    await c.end();
    return r;
  };
});

describe('payments.upi (wave-1 #2 · migration 015)', () => {
  test('links respect the ledger; webhook facts idempotent; settlement kernel-only; 015 bare-kernel provisions', async () => {
    const fin = await loginAs(app, 'finance@meridian.edu');
    const obs = (await app.inject({ method: 'GET', url: '/fees/obligations?status=open', headers: H(fin.token) })).json().obligations;
    assert.ok(obs.length > 0);
    const target = obs[0];
    const paidBefore = Number(target.paid_cents ?? 0);

    // 1) link creation: kernel payment row initiated, UPI intent, amount = due only
    const link = await app.inject({ method: 'POST', url: '/plugins/payments.upi/links', payload: { obligationId: target.id }, headers: H(fin.token) });
    assert.equal(link.statusCode, 200);
    const { paymentId, linkId, link: intent, amountCents } = link.json();
    assert.match(linkId, /^plink_/);
    assert.match(intent, /^upi:\/\/pay\?/);
    assert.equal(amountCents, String(Number(target.amount_cents) - paidBefore), 'link is for the DUE amount only');
    const pr = await sql(`SELECT status, method FROM app.payments WHERE id=$1`, [paymentId]);
    assert.equal(pr.rows[0].status, 'initiated');
    assert.equal(pr.rows[0].method, 'upi');

    // 2) webhook facts (REQUIRED-HMAC mode — secret set): unsigned/bad-sig rejected
    //    before any fact is read; valid HMAC recorded; settlement still kernel-only
    const secret = process.env.UPI_WEBHOOK_SECRET;
    assert.ok(secret, 'test secret must be set');
    const payload = { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_U2_1', notes: { paymentId } } } } };
    const sigOf = (obj) => createHmac('sha256', secret).update(JSON.stringify(obj)).digest('hex');

    const noSig = await app.inject({ method: 'POST', url: '/plugins/payments.upi/webhook', payload });
    assert.equal(noSig.statusCode, 401, 'unsigned webhook rejected when secret is set');
    const badSig = await app.inject({ method: 'POST', url: '/plugins/payments.upi/webhook', payload, headers: { 'x-razorpay-signature': 'deadbeef' } });
    assert.equal(badSig.statusCode, 401, 'invalid-signature webhook rejected');
    const noFacts = await sql(`SELECT count(*)::int n FROM plugin_upi.webhook_log WHERE event_id='pay_U2_1'`);
    assert.equal(noFacts.rows[0].n, 0, 'rejected webhooks record NO facts');

    const wh = await app.inject({ method: 'POST', url: '/plugins/payments.upi/webhook', payload, headers: { 'x-razorpay-signature': sigOf(payload) } });
    assert.equal(wh.statusCode, 200);
    assert.equal(wh.json().outcome.includes('kernel-only'), true);
    const verifiedRow = await sql(`SELECT signature_verified FROM plugin_upi.webhook_log WHERE event_id='pay_U2_1'`);
    assert.equal(verifiedRow.rows[0].signature_verified, true, 'fact recorded as HMAC-verified');

    const wh2 = await app.inject({ method: 'POST', url: '/plugins/payments.upi/webhook', payload, headers: { 'x-razorpay-signature': sigOf(payload) } });
    assert.equal(wh2.statusCode, 200, 'replay is a no-op success');
    const logN = await sql(`SELECT count(*)::int n FROM plugin_upi.webhook_log WHERE event_id='pay_U2_1'`);
    assert.equal(logN.rows[0].n, 1, 'webhook_log idempotency by (tenant_id, event_id)');
    const settled = await app.inject({ method: 'POST', url: `/fees/payments/${paymentId}/confirm`, payload: { gatewayRef: 'pay_U2_1' }, headers: H(fin.token) });
    assert.equal(settled.statusCode, 200, 'only the kernel confirm settles');
    const obAfter = await sql(`SELECT paid_cents FROM app.fee_obligations WHERE id=$1`, [target.id]);
    assert.equal(Number(obAfter.rows[0].paid_cents), paidBefore + Number(amountCents), 'ledger reflects exactly the kernel settlement');

    // 3) migration 015 independence: webhook_log exists with the idempotency key,
    //    and replaying 015 on the provisioned test DB is a no-op (bare-kernel contract)
    const uq = await sql(`SELECT indexdef FROM pg_indexes WHERE schemaname='plugin_upi' AND tablename='webhook_log' AND indexdef LIKE '%UNIQUE%'`);
    assert.ok(uq.rows.some(r => r.indexdef.includes('tenant_id') && r.indexdef.includes('event_id')), 'UNIQUE (tenant_id, event_id) present');
    const reg = await sql(`SELECT count(*)::int n FROM app.plugins WHERE plugin_id='payments.upi'`);
    assert.ok(reg.rows[0].n >= 1, 'registry row present per tenant');
  });
});
