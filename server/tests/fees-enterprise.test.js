// Fees enterprise (docs/FEES-PERFECT-100.md batches 1–4): the finance split roles and separation of
// duties, manual settlement provenance (no fabricated gateway reference), immutable receipts, the
// payments list, partial refunds, concessions, reconciliation audit + amount mismatch, and fee.due.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';
import pg from 'pg';

let app;
let sql;
let ownerToken, financeToken, clerkToken, teacherToken;
let tenantA, studentId;
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

before(async () => {
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
  studentId = (await sql(`SELECT id FROM app.students WHERE tenant_id=$1 AND status='active' LIMIT 1`, [tenantA])).rows[0].id;
  // a finance_clerk with the same credential hash as the seeded finance user (maker-only role)
  const fin = (await sql(`SELECT password_hash FROM app.users WHERE email='finance@meridian.edu'`)).rows[0];
  await sql(`INSERT INTO app.users (tenant_id, email, name, role, password_hash) VALUES ($1,'clerk@meridian.edu','Fee Clerk','finance_clerk',$2) ON CONFLICT DO NOTHING`, [tenantA, fin.password_hash]);
  clerkToken = (await loginAs(app, 'clerk@meridian.edu')).token;
});
after(async () => { await app?.close(); });

const obligation = async (label, cents) => (await sql(
  `INSERT INTO app.fee_obligations (tenant_id, student_id, term, label, amount_cents)
   VALUES ($1,$2,'Term 2',$3,$4) RETURNING id`, [tenantA, studentId, label, cents])).rows[0];

const startPayment = async (obligationId, method = 'upi') => {
  const r = await app.inject({ method: 'POST', url: '/fees/payments', payload: { obligationId, method }, headers: H(ownerToken) });
  assert.equal(r.statusCode, 200, r.body);
  return r.json().payment;
};

test('FEES · manual settlement records provenance, never a fabricated gateway reference', async () => {
  const o = await obligation('Ent manual settle', 120000);
  const p = await startPayment(o.id);
  const conf = await app.inject({ method: 'POST', url: `/fees/payments/${p.id}/confirm`, payload: {}, headers: H(ownerToken) });
  assert.equal(conf.statusCode, 200, conf.body);
  assert.equal(conf.json().payment.settled_via, 'manual');
  assert.equal(conf.json().payment.gateway_ref, 'MANUAL', 'a cash settlement stores the reserved sentinel, not a gateway-shaped string');
  const rec = (await sql(`SELECT receipt_no, amount_cents, voided_at FROM app.fee_receipts WHERE payment_id=$1`, [p.id])).rows[0];
  assert.ok(rec, 'an immutable receipt row is written');
  assert.equal(Number(rec.amount_cents), 120000);
  const cm = (await sql(`SELECT audience_json, dedup_key FROM app.communications WHERE dedup_key=$1`, [`receipt:${p.id}`])).rows[0];
  assert.ok(cm, 'FEE_RECEIPT is written with a dedup key');
  assert.ok(Array.isArray(cm.audience_json) && cm.audience_json.length > 0, 'and real recipients, so it is deliverable');
});

test('FEES · D6 · confirm is a checker act: the maker (finance_clerk) is refused, the head/legacy finance may', async () => {
  const o = await obligation('D6 checker parity', 90000);
  const p = await startPayment(o.id);
  const clerk = await app.inject({ method: 'POST', url: `/fees/payments/${p.id}/confirm`, payload: {}, headers: H(clerkToken) });
  assert.equal(clerk.statusCode, 403, 'finance_clerk is the maker and cannot confirm its own settlement');
  const fin = await app.inject({ method: 'POST', url: `/fees/payments/${p.id}/confirm`, payload: {}, headers: H(financeToken) });
  assert.equal(fin.statusCode, 200, fin.body);
});

test('FEES · GET /payments lists payments with settlement provenance', async () => {
  const r = await app.inject({ method: 'GET', url: '/payments', headers: H(financeToken) });
  assert.equal(r.statusCode, 200, r.body);
  assert.ok(r.json().payments.length >= 1);
  const row = r.json().payments.find((x) => x.settled_via === 'manual');
  assert.ok(row, 'the manual settlement is visible');
  assert.equal(row.reconciliation_status, 'manual');
});

test('FEES · receipts door returns the receipt; teacher is refused', async () => {
  const r = await app.inject({ method: 'GET', url: '/fees/receipts', headers: H(financeToken) });
  assert.equal(r.statusCode, 200, r.body);
  assert.ok(r.json().receipts.length >= 1);
  const one = r.json().receipts[0];
  const detail = await app.inject({ method: 'GET', url: `/fees/receipts/${one.id}`, headers: H(financeToken) });
  assert.equal(detail.statusCode, 200, detail.body);
  assert.equal(detail.json().receipt.receipt_no, one.receipt_no);
  const denied = await app.inject({ method: 'GET', url: '/fees/receipts', headers: H(teacherToken) });
  assert.equal(denied.statusCode, 403);
});

test('FEES · partial refund reverses exactly the requested amount and keeps the payment confirmed', async () => {
  const o = await obligation('Ent partial refund', 300000);
  const p = await startPayment(o.id);
  await app.inject({ method: 'POST', url: `/fees/payments/${p.id}/confirm`, payload: {}, headers: H(ownerToken) });
  const r = await app.inject({ method: 'POST', url: `/payments/${p.id}/refund`, payload: { refundCents: 100000, reason: 'goodwill' }, headers: H(ownerToken) });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().refundedCents, 100000);
  const pay = (await sql(`SELECT status, refunded_cents FROM app.payments WHERE id=$1`, [p.id])).rows[0];
  assert.equal(pay.status, 'confirmed', 'a partial refund leaves the payment confirmed');
  assert.equal(Number(pay.refunded_cents), 100000);
  const ob = (await sql(`SELECT paid_cents, status FROM app.fee_obligations WHERE id=$1`, [o.id])).rows[0];
  assert.equal(Number(ob.paid_cents), 200000);
  assert.equal(ob.status, 'partial');
});

test('FEES · separation of duties: a clerk cannot approve a material refund; the head can', async () => {
  const o = await obligation('Ent SoD refund', 600000);
  const p = await startPayment(o.id);
  await app.inject({ method: 'POST', url: `/fees/payments/${p.id}/confirm`, payload: {}, headers: H(ownerToken) });
  const clerk = await app.inject({ method: 'POST', url: `/payments/${p.id}/refund`, payload: { reason: 'requested by parent' }, headers: H(clerkToken) });
  assert.equal(clerk.statusCode, 403, clerk.body);
  assert.equal(clerk.json().code, 'SOD_REQUIRED');
  const head = await app.inject({ method: 'POST', url: `/payments/${p.id}/refund`, payload: { reason: 'approved by head' }, headers: H(financeToken) });
  assert.equal(head.statusCode, 200, head.body);
});

test('FEES · a refund above the threshold requires a reason', async () => {
  const o = await obligation('Ent refund reason', 600000);
  const p = await startPayment(o.id);
  await app.inject({ method: 'POST', url: `/fees/payments/${p.id}/confirm`, payload: {}, headers: H(ownerToken) });
  const r = await app.inject({ method: 'POST', url: `/payments/${p.id}/refund`, payload: {}, headers: H(ownerToken) });
  assert.equal(r.statusCode, 400, r.body);
  assert.match(r.json().error, /reason is required/i);
});

test('FEES · concession request + approval reduces the obligation net, never paid_cents', async () => {
  const o = await obligation('Ent concession', 200000);
  const req = await app.inject({ method: 'POST', url: '/fees/concessions', payload: { studentId, obligationId: o.id, kind: 'sibling', amountCents: 50000, reason: 'sibling discount' }, headers: H(financeToken) });
  assert.equal(req.statusCode, 200, req.body);
  const id = req.json().concession.id;
  const dec = await app.inject({ method: 'POST', url: `/fees/concessions/${id}/decide`, payload: { decision: 'approve' }, headers: H(ownerToken) });
  assert.equal(dec.statusCode, 200, dec.body);
  const ob = (await sql(`SELECT amount_cents, concession_cents, net_amount_cents, paid_cents FROM app.fee_obligations WHERE id=$1`, [o.id])).rows[0];
  assert.equal(Number(ob.concession_cents), 50000);
  assert.equal(Number(ob.net_amount_cents), 150000);
  assert.equal(Number(ob.paid_cents), 0, 'a concession never moves paid_cents');
});

test('FEES · a concession cannot be approved by its own requester', async () => {
  const o = await obligation('Ent concession SoD', 100000);
  const req = await app.inject({ method: 'POST', url: '/fees/concessions', payload: { studentId, obligationId: o.id, kind: 'concession', amountCents: 10000 }, headers: H(financeToken) });
  const id = req.json().concession.id;
  const self = await app.inject({ method: 'POST', url: `/fees/concessions/${id}/decide`, payload: { decision: 'approve' }, headers: H(financeToken) });
  assert.equal(self.statusCode, 403, self.body);
  assert.equal(self.json().code, 'SOD_REQUIRED');
});

test('FEES · reconciliation writes an audit row and detects an amount mismatch', async () => {
  const o = await obligation('Ent recon mismatch', 400000);
  const p = await startPayment(o.id, 'razorpay');
  await app.inject({ method: 'POST', url: `/fees/payments/${p.id}/confirm`, payload: { gatewayRef: 'order_ENTMISMATCH' }, headers: H(ownerToken) });
  await sql(`INSERT INTO plugin_razorpay.order_log (tenant_id, payment_id, razorpay_order_id, razorpay_payment_id, status, amount_cents)
             VALUES ($1,$2,'order_ENTMISMATCH','pay_ENTMISMATCH','captured', 399999)`, [tenantA, p.id]);
  const before = (await sql(`SELECT count(*)::int n FROM app.audit_log WHERE tenant_id=$1 AND action='Ran payment reconciliation sweep'`, [tenantA])).rows[0].n;
  const r = await app.inject({ method: 'POST', url: '/payments/reconcile', payload: {}, headers: H(financeToken) });
  assert.equal(r.statusCode, 200, r.body);
  assert.ok(r.json().discrepancies.amountMismatch.some((x) => x.id === p.id), 'the amount mismatch is reported');
  const after = (await sql(`SELECT count(*)::int n FROM app.audit_log WHERE tenant_id=$1 AND action='Ran payment reconciliation sweep'`, [tenantA])).rows[0].n;
  assert.equal(after - before, 1, 'the sweep is audited');
});

test('FEES · an overdue fee emits fee.due, the event the rails subscribe to', async () => {
  const o = await obligation('Ent fee due event', 90000);
  await sql(`UPDATE app.fee_obligations SET due_on=(now() AT TIME ZONE 'Asia/Kolkata')::date - 3 WHERE id=$1`, [o.id]);
  // ensure dunning is not in quiet hours at any hour of the day: a window two minutes from now.
  const istMin = (() => { const d = new Date(Date.now() + 5.5 * 3600 * 1000); return d.getUTCHours() * 60 + d.getUTCMinutes(); })();
  const hm = (t) => { const x = ((t % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };
  await sql(`INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, manifest, permissions, settings)
             VALUES ($1,'comms.whatsapp','1.0.0','B','enabled','{"capabilities":["comms.whatsapp.templates"]}'::jsonb,'[]'::jsonb,$2::jsonb)
             ON CONFLICT (tenant_id, plugin_id) DO UPDATE SET status='enabled', settings=EXCLUDED.settings, manifest=EXCLUDED.manifest`,
  [tenantA, JSON.stringify({ quiet_hours: { start: hm(istMin + 2), end: hm(istMin + 3) } })]);
  const before = (await sql(`SELECT count(*)::int n FROM app.outbox WHERE tenant_id=$1 AND topic='fee.due'`, [tenantA])).rows[0].n;
  const r = await app.inject({ method: 'POST', url: '/fees/dunning/run', payload: {}, headers: H(ownerToken) });
  assert.equal(r.statusCode, 200, r.body);
  const after = (await sql(`SELECT count(*)::int n FROM app.outbox WHERE tenant_id=$1 AND topic='fee.due'`, [tenantA])).rows[0].n;
  assert.ok(after > before, 'a fee.due event was published to the outbox');
});

test('FEES · D2 · late fees are applied to overdue obligations from the policy', async () => {
  const set = await app.inject({ method: 'PUT', url: '/fees/settings', headers: H(ownerToken), payload: { late_fee_per_day_cents: 500, late_fee_grace_days: 0, late_fee_cap_cents: 0 } });
  assert.equal(set.statusCode, 200, set.body);
  const stu = (await sql(`SELECT id FROM app.students WHERE tenant_id=$1 AND status='active' LIMIT 1`, [tenantA])).rows[0];
  const o = (await sql(`INSERT INTO app.fee_obligations (tenant_id, student_id, term, label, due_on, amount_cents)
    VALUES ($1,$2,'Term 2','D2 late fee probe', (('now' AT TIME ZONE 'Asia/Kolkata')::date - 5), 100000) RETURNING id`, [tenantA, stu.id])).rows[0];
  const r = await app.inject({ method: 'POST', url: '/fees/late-fees/run', headers: H(ownerToken), payload: {} });
  assert.equal(r.statusCode, 200, r.body);
  assert.ok(r.json().updated >= 1);
  const row = (await sql(`SELECT late_fee_cents, amount_cents, net_amount_cents FROM app.fee_obligations WHERE id=$1`, [o.id])).rows[0];
  assert.equal(Number(row.late_fee_cents), 2500, '5 days × ₹5');
  assert.equal(Number(row.net_amount_cents), Number(row.amount_cents) + 2500, 'the late fee is in the payable net');
});

test('FEES · D1 · an obligation renders an invoice document (idempotent)', async () => {
  const o = await obligation('D1 invoice probe', 70000);
  const first = await app.inject({ method: 'GET', url: `/fees/obligations/${o.id}/invoice`, headers: H(ownerToken) });
  assert.equal(first.statusCode, 200, first.body);
  assert.ok(first.json().invoice.fileId, 'an invoice artifact is generated');
  assert.equal(first.json().cached, false);
  const second = await app.inject({ method: 'GET', url: `/fees/obligations/${o.id}/invoice`, headers: H(ownerToken) });
  assert.equal(second.json().cached, true, 'the artifact is reused');
  assert.equal(second.json().invoice.fileId, first.json().invoice.fileId);
});
