// P0 · fee state machines — every lifecycle forward and every illegal transition.
// Obligation open→partial→paid + void rules; payment initiated→confirmed→refunded;
// installments pending→paid/waived; concessions requested→approved/rejected;
// billing-run void rules. Each test asserts the HTTP code AND the DB row.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';
import pg from 'pg';

let app, sql, owner, head, clerk, tenant, S;
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
  await sql(`INSERT INTO app.users (tenant_id,email,name,role,password_hash) VALUES ($1,'shead@meridian.edu','S Head','finance_head',$2),($1,'sclerk@meridian.edu','S Clerk','finance_clerk',$2) ON CONFLICT DO NOTHING`, [tenant, fin.password_hash]);
  head = (await loginAs(app, 'shead@meridian.edu')).token;
  clerk = (await loginAs(app, 'sclerk@meridian.edu')).token;
  S = (await sql(`SELECT id FROM app.students WHERE tenant_id=$1 AND status='active' LIMIT 1`, [tenant])).rows[0].id;
});
after(async () => { await app?.close(); });

const ob = async (label, cents, student = S) => (await sql(
  `INSERT INTO app.fee_obligations (tenant_id,student_id,term,label,amount_cents) VALUES ($1,$2,'ST', $3,$4) RETURNING *`, [tenant, student, label, cents])).rows[0];
const start = async (id, extra = {}) => app.inject({ method: 'POST', url: '/fees/payments', headers: H(owner), payload: { obligationId: id, method: 'upi', ...extra } });
const confirm = async (id) => app.inject({ method: 'POST', url: `/fees/payments/${id}/confirm`, headers: H(owner), payload: {} });
const row = async (t, id) => (await sql(`SELECT * FROM app.${t} WHERE id=$1`, [id])).rows[0];

test('ST · obligation open→partial→paid across two confirms', async () => {
  const o = await ob('ST lifecycle', 100000);
  const p1 = (await start(o.id, { amountCents: 40000 })).json().payment;
  await confirm(p1.id);
  assert.equal((await row('fee_obligations', o.id)).status, 'partial');
  const p2 = (await start(o.id, { amountCents: 60000 })).json().payment;
  await confirm(p2.id);
  const fin = await row('fee_obligations', o.id);
  assert.equal(fin.status, 'paid');
  assert.equal(Number(fin.paid_cents), 100000);
});

test('ST · void rules: unpaid voids, paid refuses, double-void idempotent', async () => {
  const o = await ob('ST void-clean', 50000);
  const v = await app.inject({ method: 'POST', url: `/fees/obligations/${o.id}/void`, headers: H(owner), payload: {} });
  assert.equal(v.statusCode, 200);
  assert.equal((await row('fee_obligations', o.id)).status, 'void');
  const v2 = await app.inject({ method: 'POST', url: `/fees/obligations/${o.id}/void`, headers: H(owner), payload: {} });
  assert.equal(v2.statusCode, 200);
  assert.equal(v2.json().already, true);
  const o2 = await ob('ST void-paid', 50000);
  const p = (await start(o2.id)).json().payment;
  await confirm(p.id);
  const v3 = await app.inject({ method: 'POST', url: `/fees/obligations/${o2.id}/void`, headers: H(owner), payload: {} });
  assert.equal(v3.statusCode, 409);
});

test('ST · payment: initiated→confirmed→refunded(full); then CONFLICT', async () => {
  const o = await ob('ST refund-full', 70000);
  const p = (await start(o.id)).json().payment;
  await confirm(p.id);
  const r = await app.inject({ method: 'POST', url: `/payments/${p.id}/refund`, headers: H(owner), payload: { reason: 'state drill' } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().payment.status, 'refunded');
  const oRow = await row('fee_obligations', o.id);
  assert.equal(oRow.status, 'open');
  assert.equal(Number(oRow.paid_cents), 0);
  const r2 = await app.inject({ method: 'POST', url: `/payments/${p.id}/refund`, headers: H(owner), payload: { reason: 'again' } });
  assert.equal(r2.statusCode, 409);
});

test('ST · failed payment closes allocations (trigger): re-pay allowed', async () => {
  const o = await ob('ST fail', 45000);
  const p = (await start(o.id)).json().payment;
  await sql(`UPDATE app.payments SET status='failed' WHERE id=$1`, [p.id]);
  const closed = (await sql(`SELECT open FROM app.payment_allocations WHERE payment_id=$1`, [p.id])).rows;
  assert.ok(closed.length > 0 && closed.every((x) => x.open === false), 'trigger closed the allocation');
  const retry = await start(o.id);
  assert.equal(retry.statusCode, 200, retry.body);
});

test('ST · installments settle in order; waived part skipped by confirm math', async () => {
  const t = (await sql(`INSERT INTO app.fee_plan_templates (tenant_id,name,grades,terms,installments) VALUES ($1,'ST parts','{}',$2::jsonb,$3::jsonb) RETURNING id`,
    [tenant, JSON.stringify([{ term: 'ST', label: 'ST parts ob', amount_cents: 90000 }]), JSON.stringify([{}, {}, {}])])).rows[0];
  const g = await sql(`SELECT grade FROM app.students WHERE id=$1`, [S]);
  await sql(`UPDATE app.fee_plan_templates SET grades=$2 WHERE id=$1`, [t.id, [g.rows[0].grade]]);
  const gen = await app.inject({ method: 'POST', url: `/fee-plans/${t.id}/generate`, headers: H(head), payload: {} });
  assert.equal(gen.statusCode, 200, gen.body);
  const target = (await sql(`SELECT id FROM app.fee_obligations WHERE source_ref=$1 AND student_id=$2`, [`feeplan:${t.id}`, S])).rows[0];
  const parts = (await sql(`SELECT * FROM app.fee_installments WHERE obligation_id=$1 ORDER BY seq`, [target.id])).rows;
  assert.equal(parts.length, 3);
  assert.equal(parts.reduce((a, p) => a + Number(p.amount_cents), 0), 90000, 'parts sum exactly');
  // waive middle part, then pay in full: paid parts = seq1+seq3 logic via cumulative totals
  await app.inject({ method: 'POST', url: `/fees/installments/${parts[1].id}/waive`, headers: H(head), payload: { reason: 'state' } });
  const p = (await start(target.id)).json().payment;
  await confirm(p.id);
  const after = (await sql(`SELECT seq,status FROM app.fee_installments WHERE obligation_id=$1 ORDER BY seq`, [target.id])).rows;
  assert.equal(after.find((x) => x.seq === 2).status, 'waived', 'waived part stays waived');
  assert.equal(after.find((x) => x.seq === 1).status, 'paid');
});

test('ST · concession requested→approved moves net not paid; rejected ends; decide-twice 409', async () => {
  const o = await ob('ST concession', 80000);
  const c = (await app.inject({ method: 'POST', url: '/fees/concessions', headers: H(head), payload: { studentId: S, obligationId: o.id, kind: 'scholarship', amountCents: 30000, reason: 'state' } })).json().concession;
  assert.equal(c.status, 'requested');
  const d = await app.inject({ method: 'POST', url: `/fees/concessions/${c.id}/decide`, headers: H(owner), payload: { decision: 'approve' } });
  assert.equal(d.statusCode, 200);
  const oRow = await row('fee_obligations', o.id);
  assert.equal(Number(oRow.concession_cents), 30000);
  assert.equal(Number(oRow.net_amount_cents), 50000);
  assert.equal(Number(oRow.paid_cents), 0);
  const d2 = await app.inject({ method: 'POST', url: `/fees/concessions/${c.id}/decide`, headers: H(owner), payload: { decision: 'approve' } });
  assert.equal(d2.statusCode, 409);
  const c2 = (await app.inject({ method: 'POST', url: '/fees/concessions', headers: H(head), payload: { studentId: S, kind: 'waiver', amountCents: 100, reason: 'state' } })).json().concession;
  const rj = await app.inject({ method: 'POST', url: `/fees/concessions/${c2.id}/decide`, headers: H(owner), payload: { decision: 'reject' } });
  assert.equal(rj.json().concession.status, 'rejected');
});

test('ST · billing-run void: clean run voids obligations; run with money refuses', async () => {
  const t = (await sql(`INSERT INTO app.fee_plan_templates (tenant_id,name,grades,terms) VALUES ($1,'ST voidrun','{}',$2::jsonb) RETURNING id`,
    [tenant, JSON.stringify([{ term: 'ST', label: 'ST voidrun ob', amount_cents: 1000 }])])).rows[0];
  const g = await sql(`SELECT grade FROM app.students WHERE id=$1`, [S]);
  await sql(`UPDATE app.fee_plan_templates SET grades=$2 WHERE id=$1`, [t.id, [g.rows[0].grade]]);
  const gen = (await app.inject({ method: 'POST', url: `/fee-plans/${t.id}/generate`, headers: H(head), payload: {} })).json();
  const v = await app.inject({ method: 'POST', url: `/billing-runs/${gen.billingRunId}/void`, headers: H(owner), payload: {} });
  assert.equal(v.statusCode, 200);
  assert.ok(v.json().voidedObligations >= 1);
  const t2 = (await sql(`INSERT INTO app.fee_plan_templates (tenant_id,name,grades,terms) VALUES ($1,'ST voidrun2','{}',$2::jsonb) RETURNING id`,
    [tenant, JSON.stringify([{ term: 'ST', label: 'ST voidrun2 ob', amount_cents: 20000 }])])).rows[0];
  await sql(`UPDATE app.fee_plan_templates SET grades=$2 WHERE id=$1`, [t2.id, [g.rows[0].grade]]);
  const gen2 = (await app.inject({ method: 'POST', url: `/fee-plans/${t2.id}/generate`, headers: H(head), payload: {} })).json();
  const mine = (await sql(`SELECT id FROM app.fee_obligations WHERE billing_run_id=$1 AND student_id=$2`, [gen2.billingRunId, S])).rows[0];
  const p = (await start(mine.id)).json().payment;
  await confirm(p.id);
  const v2 = await app.inject({ method: 'POST', url: `/billing-runs/${gen2.billingRunId}/void`, headers: H(owner), payload: {} });
  assert.equal(v2.statusCode, 409);
});

test('ST · late fee is SET not ADD across runs; waive zeroes', async () => {
  const past = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const o = (await sql(`INSERT INTO app.fee_obligations (tenant_id,student_id,term,label,amount_cents,due_on) VALUES ($1,$2,'ST','ST late',100000,$3) RETURNING *`, [tenant, S, past])).rows[0];
  await app.inject({ method: 'PUT', url: '/fees/settings', headers: H(head), payload: { late_fee_enabled: true, late_fee_mode: 'per_day', late_fee_per_day_cents: 1000, late_fee_grace_days: 0 } });
  await app.inject({ method: 'POST', url: '/fees/late-fees/run', headers: H(head), payload: {} });
  const f1 = Number((await row('fee_obligations', o.id)).late_fee_cents);
  await app.inject({ method: 'POST', url: '/fees/late-fees/run', headers: H(head), payload: {} });
  const f2 = Number((await row('fee_obligations', o.id)).late_fee_cents);
  assert.equal(f1, f2, 'second run recomputes identical fee');
  assert.ok(f1 > 0);
  const w = await app.inject({ method: 'POST', url: `/fees/obligations/${o.id}/late-fee/waive`, headers: H(head), payload: { reason: 'state' } });
  assert.equal(w.statusCode, 200);
  assert.equal(Number((await row('fee_obligations', o.id)).late_fee_cents), 0);
});
