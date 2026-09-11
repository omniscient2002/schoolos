// Payments live loop (Wave 3 · L1-3.1): refund door (gateway leg FIRST, ledger
// untouched on refusal), status='refunded' finally used, paid_cents reversal
// with floor-0 + status recompute, and the settlement reconciliation sweep's
// three discrepancy classes. Gateway client is MOCKED in-process (fetch swap).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';
import pg from 'pg';

let app;
let sql;
let ownerToken, financeToken, teacherToken;
let tenantA;
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

before(async () => {
  // the refund REST leg resolves keys from env fallback when no tenant settings exist
  process.env.RAZORPAY_KEY_ID = 'rzp_test_MOCKKEYID';
  process.env.RAZORPAY_KEY_SECRET = 'mocksecret';
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.ready();
  sql = async (text, params = []) => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try { return await c.query(text, params); } finally { await c.end(); }
  };
  ownerToken = (await loginAs(app, 'owner@meridian.edu')).token;
  financeToken = (await loginAs(app, 'finance@meridian.edu')).token;
  teacherToken = (await loginAs(app, 'teacher@meridian.edu')).token;
  tenantA = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
});
after(async () => { await app?.close(); });

// make a CONFIRMED payment directly through the real doors
const confirmedPayment = async (label, cents, method = 'upi') => {
  const o = (await sql(`INSERT INTO app.fee_obligations (tenant_id, student_id, term, label, amount_cents)
                        SELECT $1, id, 'Term 2', $2, $3 FROM app.students WHERE tenant_id=$1 AND status='active' LIMIT 1 RETURNING id, amount_cents`,
  [tenantA, label, cents])).rows[0];
  const pay = await app.inject({ method: 'POST', url: '/fees/payments', payload: { obligationId: o.id, method }, headers: H(ownerToken) });
  assert.equal(pay.statusCode, 200, pay.body);
  const conf = await app.inject({ method: 'POST', url: `/fees/payments/${pay.json().payment.id}/confirm`, payload: { gatewayRef: 'GATEWAY-REFUNDTEST01' }, headers: H(ownerToken) });
  assert.equal(conf.statusCode, 200, conf.body);
  return { obligationId: o.id, paymentId: pay.json().payment.id, amount: cents };
};

test('RF · manual refund: status refunded, paid_cents reversed, obligation recomputed, audit + event', async () => {
  const { obligationId, paymentId } = await confirmedPayment('Refund manual case', 250000);
  const eventsBefore = (await sql(`SELECT count(*)::int n FROM app.events WHERE tenant_id=$1`, [tenantA])).rows[0].n;
  const r = await app.inject({ method: 'POST', url: `/payments/${paymentId}/refund`, payload: { reason: 'duplicate entry by office' }, headers: H(ownerToken) });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().payment.status, 'refunded');
  assert.ok(r.json().payment.refunded_at, 'refunded_at stamped');
  assert.equal(r.json().gateway.mode, 'manual');
  const o = (await sql(`SELECT paid_cents, status FROM app.fee_obligations WHERE id=$1`, [obligationId])).rows[0];
  assert.equal(Number(o.paid_cents), 0);
  assert.equal(o.status, 'open');
  const ev = (await sql(`SELECT count(*)::int n FROM app.events WHERE tenant_id=$1 AND label LIKE 'payment.refunded%'`, [tenantA])).rows[0].n;
  assert.equal(ev, 1);
  assert.ok((await sql(`SELECT count(*)::int n FROM app.events WHERE tenant_id=$1`, [tenantA])).rows[0].n > eventsBefore);
  const aud = (await sql(`SELECT count(*)::int n FROM app.audit_log WHERE tenant_id=$1 AND action='Refunded payment'`, [tenantA])).rows[0].n;
  assert.equal(aud, 1, 'audited');
});

test('RF · gateway refund via mocked client: exact REST call, refundId recorded', async () => {
  const { obligationId, paymentId, amount } = await confirmedPayment('Refund gateway case', 180000, 'razorpay');
  await sql(`INSERT INTO plugin_razorpay.order_log (tenant_id, payment_id, razorpay_order_id, razorpay_payment_id, status)
             VALUES ($1,$2,'order_TESTGATEWAY','pay_TESTGATEWAY','captured')`, [tenantA, paymentId]);
  let captured = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    captured = { url, body: JSON.parse(opts.body) };
    return { ok: true, status: 200, json: async () => ({ id: 'rfnd_TESTGATEWAY', status: 'processed' }) };
  };
  try {
    const r = await app.inject({ method: 'POST', url: `/payments/${paymentId}/refund`, payload: { reason: 'gateway refund' }, headers: H(financeToken) });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().gateway.mode, 'gateway');
    assert.equal(r.json().gateway.refundId, 'rfnd_TESTGATEWAY');
    assert.equal(captured.url, 'https://api.razorpay.com/v1/payments/pay_TESTGATEWAY/refund');
    assert.deepEqual(captured.body, { amount: Number(amount), speed: 'normal' });
  } finally { globalThis.fetch = realFetch; }
  const p = (await sql(`SELECT status, refund_gateway_ref FROM app.payments WHERE id=$1`, [paymentId])).rows[0];
  assert.equal(p.status, 'refunded');
  assert.equal(p.refund_gateway_ref, 'rfnd_TESTGATEWAY');
  const o = (await sql(`SELECT paid_cents, status FROM app.fee_obligations WHERE id=$1`, [obligationId])).rows[0];
  assert.equal(Number(o.paid_cents), 0);
});

test('RF · gateway refusal leaves the ledger byte-identical (network leg before mutation)', async () => {
  const { obligationId, paymentId } = await confirmedPayment('Refund refused case', 90000, 'razorpay');
  await sql(`INSERT INTO plugin_razorpay.order_log (tenant_id, payment_id, razorpay_order_id, razorpay_payment_id, status)
             VALUES ($1,$2,'order_TESTREFUSE','pay_TESTREFUSE','captured')`, [tenantA, paymentId]);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: 'bad request' }) });
  try {
    const r = await app.inject({ method: 'POST', url: `/payments/${paymentId}/refund`, payload: {}, headers: H(ownerToken) });
    assert.equal(r.statusCode, 409);
    assert.match(r.json().error, /ledger untouched/);
  } finally { globalThis.fetch = realFetch; }
  const p = (await sql(`SELECT status FROM app.payments WHERE id=$1`, [paymentId])).rows[0];
  assert.equal(p.status, 'confirmed', 'payment untouched');
  const o = (await sql(`SELECT paid_cents, status FROM app.fee_obligations WHERE id=$1`, [obligationId])).rows[0];
  assert.equal(Number(o.paid_cents), 90000, 'obligation untouched');
  assert.equal(o.status, 'paid');
});

test('RF · partial-refund recompute: refunding the newest payment leaves earlier payments (partial)', async () => {
  // pre-existing partial history: 2000 of 3000 already paid (legacy/manual), so
  // the door's due is 1000; refunding that one payment must restore 2000/partial.
  const o = (await sql(`INSERT INTO app.fee_obligations (tenant_id, student_id, term, label, amount_cents, paid_cents, status)
                        SELECT $1, id, 'Term 2', 'Refund partial case', 3000, 2000, 'partial'
                        FROM app.students WHERE tenant_id=$1 AND status='active' LIMIT 1 RETURNING id`,
  [tenantA])).rows[0];
  const pay = await app.inject({ method: 'POST', url: '/fees/payments', payload: { obligationId: o.id }, headers: H(ownerToken) });
  assert.equal(pay.statusCode, 200, pay.body);
  assert.equal(Number(pay.json().payment.amount_cents), 1000, 'the door charges only the remaining due');
  const conf = await app.inject({ method: 'POST', url: `/fees/payments/${pay.json().payment.id}/confirm`, payload: {}, headers: H(ownerToken) });
  assert.equal(conf.statusCode, 200);
  const r = await app.inject({ method: 'POST', url: `/payments/${pay.json().payment.id}/refund`, payload: { reason: 'one leg reversed' }, headers: H(ownerToken) });
  assert.equal(r.statusCode, 200, r.body);
  const ob = (await sql(`SELECT paid_cents, status FROM app.fee_obligations WHERE id=$1`, [o.id])).rows[0];
  assert.equal(Number(ob.paid_cents), 2000, 'earlier payments kept');
  assert.equal(ob.status, 'partial', 'recompute: 2000 of 3000 = partial');
});

test('RF · guards: initiated 409, unknown 404, already-refunded 409, teacher 403', async () => {
  const o = (await sql(`INSERT INTO app.fee_obligations (tenant_id, student_id, term, label, amount_cents)
                        SELECT $1, id, 'Term 2', 'Refund guard case', 500 FROM app.students WHERE tenant_id=$1 AND status='active' LIMIT 1 RETURNING id`,
  [tenantA])).rows[0];
  const pay = await app.inject({ method: 'POST', url: '/fees/payments', payload: { obligationId: o.id }, headers: H(ownerToken) });
  const initiated = pay.json().payment.id;
  const r1 = await app.inject({ method: 'POST', url: `/payments/${initiated}/refund`, payload: {}, headers: H(ownerToken) });
  assert.equal(r1.statusCode, 409);
  const r2 = await app.inject({ method: 'POST', url: `/payments/00000000-0000-0000-0000-000000000000/refund`, payload: {}, headers: H(ownerToken) });
  assert.equal(r2.statusCode, 404);
  const done = await confirmedPayment('Refund guards paid', 500);
  const r3 = await app.inject({ method: 'POST', url: `/payments/${done.paymentId}/refund`, payload: {}, headers: H(teacherToken) });
  assert.equal(r3.statusCode, 403);
  const r4 = await app.inject({ method: 'POST', url: `/payments/${done.paymentId}/refund`, payload: {}, headers: H(financeToken) });
  assert.equal(r4.statusCode, 200);
  const r5 = await app.inject({ method: 'POST', url: `/payments/${done.paymentId}/refund`, payload: {}, headers: H(ownerToken) });
  assert.equal(r5.statusCode, 409, 'already refunded');
});

test('RC · reconciliation sweep: ghost / missing / orphan classes all surface + events emitted', async () => {
  // ghost: confirmed locally, rail order still 'created'
  const ghost = await confirmedPayment('Recon ghost', 300000, 'razorpay');
  await sql(`INSERT INTO plugin_razorpay.order_log (tenant_id, payment_id, razorpay_order_id, status)
             VALUES ($1,$2,'order_RECON_GHOST','created')`, [tenantA, ghost.paymentId]);
  // missing: rail captured, ledger still initiated
  const oMiss = (await sql(`INSERT INTO app.fee_obligations (tenant_id, student_id, term, label, amount_cents)
                            SELECT $1, id, 'Term 2', 'Recon missing', 400000 FROM app.students WHERE tenant_id=$1 AND status='active' LIMIT 1 RETURNING id`,
  [tenantA])).rows[0];
  const payMiss = await app.inject({ method: 'POST', url: '/fees/payments', payload: { obligationId: oMiss.id, method: 'razorpay' }, headers: H(ownerToken) });
  const missId = payMiss.json().payment.id;
  await sql(`INSERT INTO plugin_razorpay.order_log (tenant_id, payment_id, razorpay_order_id, razorpay_payment_id, status)
             VALUES ($1,$2,'order_RECON_MISS','pay_RECON_MISS','captured')`, [tenantA, missId]);
  // orphan: confirmed with no rail log row
  await confirmedPayment('Recon orphan', 200000, 'razorpay');
  const evBefore = (await sql(`SELECT count(*)::int n FROM app.events WHERE tenant_id=$1 AND label LIKE 'reconciliation.discrepancy%'`, [tenantA])).rows[0].n;
  const r = await app.inject({ method: 'POST', url: '/payments/reconcile', payload: {}, headers: H(ownerToken) });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().discrepancies.ghostLocalConfirmed.length, 1);
  assert.equal(r.json().discrepancies.missingLocalConfirmation.length, 1);
  assert.equal(r.json().discrepancies.orphanNoRailLog.length, 1);
  const evAfter = (await sql(`SELECT count(*)::int n FROM app.events WHERE tenant_id=$1 AND label LIKE 'reconciliation.discrepancy%'`, [tenantA])).rows[0].n;
  assert.equal(evAfter - evBefore, 3, 'one event per discrepancy');
  const role = await app.inject({ method: 'POST', url: '/payments/reconcile', payload: {}, headers: H(teacherToken) });
  assert.equal(role.statusCode, 403);
});
