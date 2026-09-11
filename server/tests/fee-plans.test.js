// Fee plan templates & bulk generation (Wave 2 · L1-2.2): template CRUD door,
// single-statement generation to every active student in scope, idempotent
// regeneration (ON CONFLICT skip), the paid_cents invariant (D-5/D-21 — paid
// rows are never overwritten), owner-only void with payment guard, RLS
// isolation, and role gates.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';
import pg from 'pg';

let app;
let sql;
let ownerToken, financeToken, teacherToken;
let tenantA, tenantB;
let tpl;             // the main test template
let populatedGrade;  // most-populated active grade in the seed world
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.ready();
  sql = async (text, params = []) => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try { return await c.query(text, params); } finally { await c.end(); } // throw-safe: a rejected query must not leak the client
  };
  ownerToken = (await loginAs(app, 'owner@meridian.edu')).token;
  financeToken = (await loginAs(app, 'finance@meridian.edu')).token;
  teacherToken = (await loginAs(app, 'teacher@meridian.edu')).token;
  tenantA = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  tenantB = (await sql(`INSERT INTO app.tenants (slug, name) VALUES ('feeplan-probe', 'Fee-plan RLS probe tenant') RETURNING id`)).rows[0].id;
  populatedGrade = (await sql(`SELECT grade FROM app.students WHERE status='active' GROUP BY grade ORDER BY count(*) DESC LIMIT 1`)).rows[0].grade;
});
after(async () => { await app?.close(); });

const asAppRole = async (tenantId, text, params = []) => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('schoolos.tenant_id', $1, true)`, [tenantId]);
    await c.query('SET LOCAL ROLE schoolos_app');
    return await c.query(text, params);
  } finally {
    await c.query('ROLLBACK');
    await c.end();
  }
};
const scopeCount = async (grades) =>
  (await sql(`SELECT count(*)::int n FROM app.students WHERE status='active' AND grade = ANY($1)`, [grades])).rows[0].n;

test('FP · create + list: owner creates a template; GET lists it with 0 generated', async () => {
  const r = await app.inject({ method: 'POST', url: '/fee-plans', payload: {
    name: 'Term 2 tuition', grades: [populatedGrade],
    terms: [
      { term: 'Term 2', label: 'Plan tuition — July', amount_cents: 1250000, due_on: '2026-07-05' },
      { term: 'Term 2', label: 'Plan tuition — November', amount_cents: 1250000, due_on: '2026-11-05' },
    ],
  }, headers: H(ownerToken) });
  assert.equal(r.statusCode, 200, r.body);
  tpl = r.json().feePlan;
  const list = await app.inject({ method: 'GET', url: '/fee-plans', headers: H(ownerToken) });
  assert.equal(list.statusCode, 200);
  const row = list.json().feePlans.find((p) => p.id === tpl.id);
  assert.ok(row, 'template listed');
  assert.equal(row.obligations_generated, 0);
});

test('FP · validation: empty grades/terms, negative amount, bad due_on, unknown academicYearId → 400', async () => {
  const base = { name: 'FP invalid', grades: [populatedGrade], terms: [{ term: 'Term 1', label: 'x', amount_cents: 100 }] };
  for (const payload of [
    { ...base, grades: [] },
    { ...base, terms: [] },
    { ...base, terms: [{ term: 'Term 1', label: 'x', amount_cents: -5 }] },
    { ...base, terms: [{ term: 'Term 1', label: 'x', amount_cents: 100, due_on: 'junk' }] },
    { ...base, academicYearId: '00000000-0000-0000-0000-000000000000' },
  ]) {
    const r = await app.inject({ method: 'POST', url: '/fee-plans', payload, headers: H(ownerToken) });
    assert.equal(r.statusCode, 400, `expected 400 for ${JSON.stringify(payload)}, got ${r.statusCode}`);
  }
});

test('FP · generation: one statement fans the template out to every active student in scope', async () => {
  const want = await scopeCount([populatedGrade]);
  assert.ok(want > 0, 'seed world must have active students in the populated grade');
  const r = await app.inject({ method: 'POST', url: `/fee-plans/${tpl.id}/generate`, payload: {}, headers: H(ownerToken) });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().students, want);
  assert.equal(r.json().terms, 2);
  assert.equal(r.json().inserted, want * 2);
  assert.equal(r.json().skipped, 0);
});

test('FP · regeneration is idempotent: everything skipped, nothing overwritten', async () => {
  const before = await sql(`SELECT count(*)::int n, coalesce(sum(paid_cents),0)::bigint paid FROM app.fee_obligations WHERE source_ref=$1`, [`feeplan:${tpl.id}`]);
  const r = await app.inject({ method: 'POST', url: `/fee-plans/${tpl.id}/generate`, payload: {}, headers: H(financeToken) });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().inserted, 0);
  assert.equal(r.json().skipped, r.json().students * r.json().terms);
  const after = await sql(`SELECT count(*)::int n, coalesce(sum(paid_cents),0)::bigint paid FROM app.fee_obligations WHERE source_ref=$1`, [`feeplan:${tpl.id}`]);
  assert.deepEqual([after.rows[0].n, after.rows[0].paid], [before.rows[0].n, before.rows[0].paid], 'row count and paid total unchanged');
});

test('FP · paid_cents invariant: paying a generated obligation then regenerating leaves it untouched', async () => {
  const open = (await sql(`SELECT id, student_id, amount_cents FROM app.fee_obligations WHERE source_ref=$1 AND status='open' LIMIT 1`, [`feeplan:${tpl.id}`])).rows[0];
  assert.ok(open, 'an open generated obligation exists');
  const pay = await app.inject({ method: 'POST', url: '/fees/payments', payload: { obligationId: open.id, method: 'upi' }, headers: H(ownerToken) });
  assert.equal(pay.statusCode, 200, pay.body);
  const conf = await app.inject({ method: 'POST', url: `/fees/payments/${pay.json().payment.id}/confirm`, payload: { gatewayRef: 'GATEWAY-VERIFY123' }, headers: H(ownerToken) });
  assert.equal(conf.statusCode, 200, conf.body);
  assert.equal(conf.json().payment.status, 'confirmed');
  const paid = (await sql(`SELECT paid_cents, status FROM app.fee_obligations WHERE id=$1`, [open.id])).rows[0];
  assert.equal(paid.status, 'paid');
  const regen = await app.inject({ method: 'POST', url: `/fee-plans/${tpl.id}/generate`, payload: {}, headers: H(ownerToken) });
  assert.equal(regen.statusCode, 200);
  assert.equal(regen.json().inserted, 0, 'regeneration creates nothing new');
  const paidAfter = (await sql(`SELECT paid_cents, status FROM app.fee_obligations WHERE id=$1`, [open.id])).rows[0];
  assert.deepEqual(paidAfter, paid, 'paid obligation byte-identical after regeneration');
});

test('FP · void: open obligation voids (owner-only, audited); paid obligation refuses; unknown 404', async () => {
  const open = (await sql(`SELECT id FROM app.fee_obligations WHERE source_ref=$1 AND status='open' LIMIT 1`, [`feeplan:${tpl.id}`])).rows[0];
  const v = await app.inject({ method: 'POST', url: `/fees/obligations/${open.id}/void`, payload: {}, headers: H(ownerToken) });
  assert.equal(v.statusCode, 200, v.body);
  assert.equal(v.json().obligation.status, 'void');
  const again = await app.inject({ method: 'POST', url: `/fees/obligations/${open.id}/void`, payload: {}, headers: H(ownerToken) });
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().already, true, 'idempotent re-void');
  const paid = (await sql(`SELECT id FROM app.fee_obligations WHERE source_ref=$1 AND status='paid' LIMIT 1`, [`feeplan:${tpl.id}`])).rows[0];
  const pv = await app.inject({ method: 'POST', url: `/fees/obligations/${paid.id}/void`, payload: {}, headers: H(ownerToken) });
  assert.equal(pv.statusCode, 409, 'paid obligations cannot be voided — refund first');
  const nf = await app.inject({ method: 'POST', url: `/fees/obligations/00000000-0000-0000-0000-000000000000/void`, payload: {}, headers: H(ownerToken) });
  assert.equal(nf.statusCode, 404);
});

test('FP · role gates: teacher refused on create/generate/void; finance may create', async () => {
  const t1 = await app.inject({ method: 'POST', url: '/fee-plans', payload: { name: 'FP teacher', grades: [populatedGrade], terms: [{ term: 'T', label: 'x', amount_cents: 1 }] }, headers: H(teacherToken) });
  assert.equal(t1.statusCode, 403);
  const t2 = await app.inject({ method: 'POST', url: `/fee-plans/${tpl.id}/generate`, payload: {}, headers: H(teacherToken) });
  assert.equal(t2.statusCode, 403);
  const t3 = await app.inject({ method: 'POST', url: `/fees/obligations/00000000-0000-0000-0000-000000000000/void`, payload: {}, headers: H(teacherToken) });
  assert.equal(t3.statusCode, 403);
  const f = await app.inject({ method: 'POST', url: '/fee-plans', payload: { name: 'FP finance', grades: [populatedGrade], terms: [{ term: 'Term 2', label: 'finance plan', amount_cents: 500 }], }, headers: H(financeToken) });
  assert.equal(f.statusCode, 200);
});

test('FP · cross-tenant isolation: tenant B sees zero templates; cross-tenant INSERT rejected', async () => {
  const see = await asAppRole(tenantB, `SELECT count(*)::int n FROM app.fee_plan_templates`);
  assert.equal(see.rows[0].n, 0, 'tenant B must see zero of meridian templates');
  await assert.rejects(
    () => asAppRole(tenantB, `INSERT INTO app.fee_plan_templates (tenant_id, name, grades, terms)
                            VALUES ($1, 'FP smuggle', '{1-A}', '[]'::jsonb)`, [tenantA]),
    (e) => e.code === '42501', 'WITH CHECK must reject a row wearing another tenant id',
  );
});

test('FP · idempotency key is database law: raw duplicate (tenant, student, term, label) → 23505', async () => {
  const row = (await sql(`SELECT tenant_id, student_id, term, label FROM app.fee_obligations WHERE source_ref=$1 LIMIT 1`, [`feeplan:${tpl.id}`])).rows[0];
  await assert.rejects(
    () => sql(`INSERT INTO app.fee_obligations (tenant_id, student_id, term, label, amount_cents)
               VALUES ($1,$2,$3,$4,999)`, [row.tenant_id, row.student_id, row.term, row.label]),
    (e) => e.code === '23505',
    'fee_obl_student_term_label_uidx must reject raw duplicates',
  );
});
