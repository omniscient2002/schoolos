// Action Plan 4.3 (match, never auto-settle): the mismatch queue — disputed
// filter, gateway-fact match signal, sweep history. A7 stands: no webhook or
// sweep moves money here; every assertion below would fail if one did.
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { setupTestDb, loginAs } from './helpers.js';

let app;
let pool;
let owner, finance, parent;
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  pool = (await import('../src/db.js')).pool;
  owner = await loginAs(app, 'owner@meridian.edu');
  finance = await loginAs(app, 'finance@meridian.edu');
  parent = await loginAs(app, 'parent@meridian.edu');
});

after(async () => { await app?.close(); });

const tenantOf = async () =>
  (await pool.query(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;

test('queue: recon=disputed filters; anything else 400s', async () => {
  const all = await app.inject({ method: 'GET', url: '/payments', headers: H(finance.token) });
  assert.equal(all.statusCode, 200, all.body);
  const bad = await app.inject({ method: 'GET', url: '/payments?recon=everything', headers: H(finance.token) });
  assert.equal(bad.statusCode, 400, bad.body);
  const q = await app.inject({ method: 'GET', url: '/payments?recon=disputed', headers: H(finance.token) });
  assert.equal(q.statusCode, 200, q.body);
  for (const p of q.json().payments) assert.equal(p.reconciliation_status, 'disputed', 'the queue lists disputes only');
});

test('match signal: captured vs recorded vs silent rail, per payment', async () => {
  const tenantId = await tenantOf();
  const student = (await pool.query(`SELECT id FROM app.students WHERE status='active' LIMIT 1`)).rows[0];
  const mkObligation = async (label, cents) => (await pool.query(
    `INSERT INTO app.fee_obligations (tenant_id, student_id, term, label, amount_cents)
     VALUES ($1,$2,'Term 9',$3,$4) RETURNING id`, [tenantId, student.id, label, cents])).rows[0];
  const start = async (obligationId, method) => (await app.inject({
    method: 'POST', url: '/fees/payments', headers: H(owner.token), payload: { obligationId, method } })).json().payment;

  const oCap = await mkObligation('ReconQ captured', 50000);
  const pCap = await start(oCap.id, 'razorpay');
  await pool.query(
    `INSERT INTO plugin_razorpay.order_log (tenant_id, payment_id, razorpay_order_id, razorpay_payment_id, status, amount_cents)
     VALUES ($1,$2,'order_RECONQ1','pay_RECONQ1','captured',50000)`, [tenantId, pCap.id]);

  const oRec = await mkObligation('ReconQ recorded', 60000);
  const pRec = await start(oRec.id, 'razorpay');
  await pool.query(
    `INSERT INTO plugin_razorpay.order_log (tenant_id, payment_id, razorpay_order_id, status, amount_cents)
     VALUES ($1,$2,'order_RECONQ2','created',60000)`, [tenantId, pRec.id]);

  const oSilent = await mkObligation('ReconQ silent', 70000);
  const pSilent = await start(oSilent.id, 'razorpay');

  const list = (await app.inject({ method: 'GET', url: '/payments?limit=500', headers: H(finance.token) })).json().payments;
  const byId = new Map(list.map((p) => [p.id, p]));
  assert.equal(byId.get(pCap.id)?.gateway_fact, 'captured', 'rail captured → match signal on');
  assert.equal(byId.get(pRec.id)?.gateway_fact, 'recorded', 'rail spoke but did not capture → recorded');
  assert.equal(byId.get(pSilent.id)?.gateway_fact, null, 'silent rail → no signal, and no settlement either');
  assert.ok(['initiated', 'open', 'pending'].includes(byId.get(pCap.id)?.status) || byId.get(pCap.id)?.status !== 'confirmed',
    'the captured webhook settled nothing by itself (A7 holds)');
});

test('match signal: UPI webhook facts light up their payment', async () => {
  const tenantId = await tenantOf();
  const student = (await pool.query(`SELECT id FROM app.students WHERE status='active' LIMIT 1`)).rows[0];
  const ob = (await pool.query(
    `INSERT INTO app.fee_obligations (tenant_id, student_id, term, label, amount_cents)
     VALUES ($1,$2,'Term 9','ReconQ upi',80000) RETURNING id`, [tenantId, student.id])).rows[0];
  const pay = (await app.inject({ method: 'POST', url: '/fees/payments', headers: H(owner.token),
    payload: { obligationId: ob.id, method: 'upi' } })).json().payment;
  await pool.query(
    `INSERT INTO plugin_upi.webhook_log (tenant_id, gateway, event_id, event_type, payload, signature_verified)
     VALUES ($1,'upi',$2,'payment.captured',$3::jsonb,true)`,
    [tenantId, `upi-reconq-${pay.id}`,
      JSON.stringify({ payload: { payment: { entity: { id: 'pay_UPIRECONQ', notes: { paymentId: pay.id } } } } })]);
  const list = (await app.inject({ method: 'GET', url: '/payments?limit=500', headers: H(finance.token) })).json().payments;
  assert.equal(list.find((p) => p.id === pay.id)?.gateway_fact, 'captured', 'UPI capture fact links to its payment');
});

test('history: manual sweep records its run; the queue header can read it back', async () => {
  const before = (await app.inject({ method: 'GET', url: '/payments/recon-runs?limit=50', headers: H(finance.token) })).json().runs.length;
  const sweep = await app.inject({ method: 'POST', url: '/payments/reconcile', headers: H(finance.token), payload: {} });
  assert.equal(sweep.statusCode, 200, sweep.body);
  const runs = (await app.inject({ method: 'GET', url: '/payments/recon-runs', headers: H(finance.token) })).json().runs;
  assert.equal(runs.length, before + 1, 'one sweep, one history row');
  assert.equal(runs[0].source, 'manual');
  assert.ok(Number(runs[0].total) >= 0 && 'ghost' in runs[0], 'class counts ride the row');
  const badLimit = await app.inject({ method: 'GET', url: '/payments/recon-runs?limit=500', headers: H(finance.token) });
  assert.equal(badLimit.statusCode, 400, badLimit.body);
  const parentNo = await app.inject({ method: 'GET', url: '/payments/recon-runs', headers: H(parent.token) });
  assert.equal(parentNo.statusCode, 403, 'sweep history is the money desk, not the family portal');
});

test('worker: runReconciliation records per-tenant history, clean sweeps included', async () => {
  const { runReconciliation } = await import('../scripts/reconcile-payments.js');
  const before = (await pool.query(`SELECT count(*)::int AS n FROM app.recon_runs`)).rows[0].n;
  const report = await runReconciliation();
  assert.ok(Array.isArray(report.tenants), 'worker report shape');
  const after = (await pool.query(`SELECT count(*)::int AS n FROM app.recon_runs`)).rows[0].n;
  const tenants = (await pool.query(`SELECT count(*)::int AS n FROM app.tenants`)).rows[0].n;
  assert.equal(after - before, tenants, 'every swept tenant gets a row — "last run clean" is signal too');
});
