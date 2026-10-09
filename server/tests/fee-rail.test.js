// P1 · fee rail contract — gateway provenance, fail-path allocation close,
// and all four reconciliation classes with fixtures (ghost/missing/orphan
// beyond the amount-mismatch covered in fees-enterprise).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';
import pg from 'pg';

let app, sql, owner, head, tenant, S;
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.ready();
  sql = async (text, params = []) => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try { return await c.query(text, params); } finally { await c.end(); }
  };
  owner = (await loginAs(app, 'owner@meridian.edu')).token;
  const fin = (await sql(`SELECT password_hash FROM app.users WHERE email='finance@meridian.edu'`)).rows[0];
  tenant = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  await sql(`INSERT INTO app.users (tenant_id,email,name,role,password_hash) VALUES ($1,'rhead@meridian.edu','R Head','finance_head',$2) ON CONFLICT DO NOTHING`, [tenant, fin.password_hash]);
  head = (await loginAs(app, 'rhead@meridian.edu')).token;
  S = (await sql(`SELECT id FROM app.students WHERE tenant_id=$1 AND status='active' LIMIT 1`, [tenant])).rows[0].id;
});
after(async () => { await app?.close(); });

const ob = async (label, cents) => (await sql(
  `INSERT INTO app.fee_obligations (tenant_id,student_id,term,label,amount_cents) VALUES ($1,$2,'RL',$3,$4) RETURNING *`, [tenant, S, label, cents])).rows[0];
const startConfirm = async (o, method = 'razorpay') => {
  const p = (await app.inject({ method: 'POST', url: '/fees/payments', headers: H(owner), payload: { obligationId: o.id, method } })).json().payment;
  await app.inject({ method: 'POST', url: `/fees/payments/${p.id}/confirm`, headers: H(owner), payload: {} });
  return p;
};
const logOrder = (pid, oid, status, cents) => sql(
  `INSERT INTO plugin_razorpay.order_log (tenant_id,payment_id,razorpay_order_id,status,amount_cents) VALUES ($1,$2,$3,$4,$5)`, [tenant, pid, oid, status, cents]);

test('RAIL · gateway evidence decides provenance: known ref=gateway, unknown=manual', async () => {
  const o = await ob('RL prov', 55000);
  const p = (await app.inject({ method: 'POST', url: '/fees/payments', headers: H(owner), payload: { obligationId: o.id, method: 'razorpay' } })).json().payment;
  await logOrder(p.id, 'order-prov-1', 'created', 55000);
  const c = await app.inject({ method: 'POST', url: `/fees/payments/${p.id}/confirm`, headers: H(owner), payload: { gatewayRef: 'order-prov-1' } });
  assert.equal(c.json().payment.settled_via, 'gateway');
  assert.equal(c.json().payment.reconciliation_status, 'matched');
  const o2 = await ob('RL prov2', 55000);
  const p2 = (await app.inject({ method: 'POST', url: '/fees/payments', headers: H(owner), payload: { obligationId: o2.id, method: 'razorpay' } })).json().payment;
  const c2 = await app.inject({ method: 'POST', url: `/fees/payments/${p2.id}/confirm`, headers: H(owner), payload: { gatewayRef: 'order-unknown-xyz' } });
  assert.equal(c2.json().payment.settled_via, 'manual', 'unverifiable ref settles manual, never gateway');
});

test('RAIL · gateway cross-payment ref cannot launder another payment', async () => {
  const a = await ob('RL laun-a', 40000), b = await ob('RL laun-b', 40000);
  const pa = (await app.inject({ method: 'POST', url: '/fees/payments', headers: H(owner), payload: { obligationId: a.id, method: 'razorpay' } })).json().payment;
  const pb = (await app.inject({ method: 'POST', url: '/fees/payments', headers: H(owner), payload: { obligationId: b.id, method: 'razorpay' } })).json().payment;
  await logOrder(pa.id, 'order-laun-a', 'captured', 40000);
  const c = await app.inject({ method: 'POST', url: `/fees/payments/${pb.id}/confirm`, headers: H(owner), payload: { gatewayRef: 'order-laun-a' } });
  assert.equal(c.json().payment.settled_via, 'manual', 'a genuine ref belonging to payment A cannot verify payment B');
});

test('RAIL · failed rail payment closes allocations: retry allowed', async () => {
  const o = await ob('RL fail', 45000);
  const p = (await app.inject({ method: 'POST', url: '/fees/payments', headers: H(owner), payload: { obligationId: o.id, method: 'razorpay' } })).json().payment;
  await sql(`UPDATE app.payments SET status='failed' WHERE id=$1`, [p.id]);
  const closed = (await sql(`SELECT open FROM app.payment_allocations WHERE payment_id=$1`, [p.id])).rows;
  assert.ok(closed.every((x) => x.open === false), 'fail transition closes allocations (trigger)');
  const retry = await app.inject({ method: 'POST', url: '/fees/payments', headers: H(owner), payload: { obligationId: o.id, method: 'upi' } });
  assert.equal(retry.statusCode, 200, retry.body);
});

test('RAIL · reconcile classes: ghost + missing + orphan each raise one finance action', async () => {
  // ghost: ledger confirmed, rail says failed
  const g = await startConfirm(await ob('RL ghost', 30000));
  await logOrder(g.id, 'order-ghost-1', 'failed', 30000);
  // missing: rail captured, ledger still initiated
  const m = (await app.inject({ method: 'POST', url: '/fees/payments', headers: H(owner), payload: { obligationId: (await ob('RL missing', 30000)).id, method: 'razorpay' } })).json().payment;
  await logOrder(m.id, 'order-missing-1', 'captured', 30000);
  // orphan: confirmed, no rail row at all
  const op = await startConfirm(await ob('RL orphan', 30000));
  const r = await app.inject({ method: 'POST', url: '/payments/reconcile', headers: H(owner), payload: {} });
  const d = r.json().discrepancies;
  assert.ok(d.ghostLocalConfirmed.some((x) => x.id === g.id), 'ghost found');
  assert.ok(d.missingLocalConfirmation.some((x) => x.id === m.id), 'missing found');
  assert.ok(d.orphanNoRailLog.some((x) => x.id === op.id), 'orphan found');
  assert.ok(r.json().actionsRaised >= 3, 'actions raised for each');
  // second sweep raises no duplicates
  const r2 = await app.inject({ method: 'POST', url: '/payments/reconcile', headers: H(owner), payload: {} });
  assert.equal(r2.json().actionsRaised, 0, 'action codes are unique — no dupes on re-sweep');
  // mark-matched closes one
  const mm = await app.inject({ method: 'POST', url: `/payments/${g.id}/mark-matched`, headers: H(owner), payload: { note: 'rail drill' } });
  assert.equal(mm.json().payment.reconciliation_status, 'matched');
});

test('RAIL · refund without gateway keys records manual (never blocks the ledger)', async () => {
  const o = await ob('RL refman', 80000);
  const p = await startConfirm(o, 'razorpay');
  const r = await app.inject({ method: 'POST', url: `/payments/${p.id}/refund`, headers: H(owner), payload: { reason: 'rail drill' } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().gateway.mode, 'manual', 'no keys/order → recorded manual with note');
  assert.ok((r.json().gateway.note ?? '').length > 0, 'note explains the manual recording');
});
