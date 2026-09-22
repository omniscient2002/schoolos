// Academic-year entity (Wave 2 · L1-2.1): create/list/activate doors, the
// single-current invariant (partial unique index — enforced against raw SQL, not
// just doors), RLS tenant isolation, role gates, and the academic_year_id stamp
// on the money/academic tables.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';
import pg from 'pg';

let app;
let sql;
let ownerToken, principalToken, financeToken, teacherToken;
let tenantA, tenantB;
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

before(async () => {
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
  ownerToken = (await loginAs(app, 'owner@meridian.edu')).token;
  principalToken = (await loginAs(app, 'principal@meridian.edu')).token;
  financeToken = (await loginAs(app, 'finance@meridian.edu')).token;
  teacherToken = (await loginAs(app, 'teacher@meridian.edu')).token;
  tenantA = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  tenantB = (await sql(`INSERT INTO app.tenants (slug, name) VALUES ('ay-probe', 'Academic-year RLS probe tenant') RETURNING id`)).rows[0].id;
});
after(async () => { await app?.close(); });

// b9/wave-c pattern: fresh connection, tenant GUC, SET LOCAL ROLE schoolos_app, rollback.
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

test('AY · create + list: owner creates a year, calendar lists it, nothing current yet', async () => {
  const r = await app.inject({ method: 'POST', url: '/academic-years', payload: { name: 'AY 2026-27', starts_on: '2026-04-01', ends_on: '2027-03-31' }, headers: H(ownerToken) });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().year.is_current, false);
  const list = await app.inject({ method: 'GET', url: '/academic-years', headers: H(ownerToken) });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().years.length, 1);
  assert.equal(list.json().currentAcademicYearId, null);
});

test('AY · academic_year_id stamped on the fee-plan templates, fee_obligations and plugin_exams.exam', async () => {
  // FEES-109: the dead legacy `app.fee_plans` table was dropped; the live plan table is
  // `app.fee_plan_templates`, which carries academic_year_id (migration 058).
  const r = await sql(`SELECT table_schema, table_name FROM information_schema.columns
                       WHERE column_name='academic_year_id'
                         AND (table_schema, table_name) IN (('app','fee_plan_templates'),('app','fee_obligations'),('plugin_exams','exam'))`);
  assert.equal(r.rows.length, 3, `expected stamp on all three tables, got: ${JSON.stringify(r.rows)}`);
});

test('AY · create-with-current: second year born current; exactly one current', async () => {
  const r = await app.inject({ method: 'POST', url: '/academic-years', payload: { name: 'AY 2027-28', starts_on: '2027-04-01', ends_on: '2028-03-31', is_current: true }, headers: H(principalToken) });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().year.is_current, true);
  const list = await app.inject({ method: 'GET', url: '/academic-years', headers: H(principalToken) });
  assert.equal(list.json().currentAcademicYearId, r.json().year.id);
  const cur = await sql(`SELECT count(*)::int n FROM app.academic_years WHERE is_current`);
  assert.equal(cur.rows[0].n, 1, 'exactly one current year');
});

test('AY · activate door switches current atomically and is idempotent', async () => {
  const list = await app.inject({ method: 'GET', url: '/academic-years', headers: H(ownerToken) });
  const first = list.json().years.find((y) => y.name === 'AY 2026-27');
  const act = await app.inject({ method: 'POST', url: `/academic-years/${first.id}/activate`, payload: {}, headers: H(ownerToken) });
  assert.equal(act.statusCode, 200, act.body);
  assert.equal(act.json().is_current, true);
  const cur = await sql(`SELECT name FROM app.academic_years WHERE is_current`);
  assert.deepEqual(cur.rows.map((x) => x.name), ['AY 2026-27'], 'the activated year is the ONLY current one');
  const again = await app.inject({ method: 'POST', url: `/academic-years/${first.id}/activate`, payload: {}, headers: H(ownerToken) });
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().already, true, 'idempotent re-activation');
});

test('AY · two-current rejection: a RAW app-role write cannot create a second current (index law)', async () => {
  await assert.rejects(
    () => asAppRole(tenantA, `INSERT INTO app.academic_years (tenant_id, name, starts_on, ends_on, is_current)
                              VALUES ($1, 'AY rogue', '2028-04-01', '2029-03-31', true)`, [tenantA]),
    (e) => e.code === '23505',
    'partial unique index academic_years_one_current_idx must reject a second current',
  );
});

test('AY · cross-tenant isolation: tenant B sees none of tenant A years; cross-tenant INSERT rejected', async () => {
  const see = await asAppRole(tenantB, `SELECT count(*)::int n FROM app.academic_years`);
  assert.equal(see.rows[0].n, 0, 'tenant B must see zero of meridian years');
  await assert.rejects(
    () => asAppRole(tenantB, `INSERT INTO app.academic_years (tenant_id, name, starts_on, ends_on) VALUES ($1, 'AY smuggle', '2026-04-01', '2027-03-31')`, [tenantA]),
    (e) => e.code === '42501',
    'WITH CHECK must reject a row wearing another tenant id',
  );
});

test('AY · cross-tenant activate is 404 (existence stays private)', async () => {
  const other = (await sql(`INSERT INTO app.academic_years (tenant_id, name, starts_on, ends_on)
                            VALUES ($1, 'AY other-tenant', '2026-04-01', '2027-03-31') RETURNING id`, [tenantB])).rows[0].id;
  const r = await app.inject({ method: 'POST', url: `/academic-years/${other}/activate`, payload: {}, headers: H(ownerToken) });
  assert.equal(r.statusCode, 404);
});

test('AY · role gates: teacher refused; finance may create but not activate', async () => {
  const t = await app.inject({ method: 'POST', url: '/academic-years', payload: { name: 'AY teacher', starts_on: '2029-04-01', ends_on: '2030-03-31' }, headers: H(teacherToken) });
  assert.equal(t.statusCode, 403);
  const ta = await app.inject({ method: 'POST', url: `/academic-years/00000000-0000-0000-0000-000000000000/activate`, payload: {}, headers: H(teacherToken) });
  assert.equal(ta.statusCode, 403);
  const f = await app.inject({ method: 'POST', url: '/academic-years', payload: { name: 'AY finance', starts_on: '2029-04-01', ends_on: '2030-03-31' }, headers: H(financeToken) });
  assert.equal(f.statusCode, 200);
  const fa = await app.inject({ method: 'POST', url: `/academic-years/00000000-0000-0000-0000-000000000000/activate`, payload: {}, headers: H(financeToken) });
  assert.equal(fa.statusCode, 403);
});

test('AY · validation: inverted range, bad dates, missing name, duplicate name → 4xx', async () => {
  const inv = await app.inject({ method: 'POST', url: '/academic-years', payload: { name: 'AY inverted', starts_on: '2027-03-31', ends_on: '2026-04-01' }, headers: H(ownerToken) });
  assert.equal(inv.statusCode, 400);
  const bad1 = await app.inject({ method: 'POST', url: '/academic-years', payload: { name: 'AY bad date', starts_on: 'April', ends_on: '2027-03-31' }, headers: H(ownerToken) });
  assert.equal(bad1.statusCode, 400);
  const bad2 = await app.inject({ method: 'POST', url: '/academic-years', payload: { starts_on: '2026-04-01', ends_on: '2027-03-31' }, headers: H(ownerToken) });
  assert.equal(bad2.statusCode, 400);
  const dup = await app.inject({ method: 'POST', url: '/academic-years', payload: { name: 'AY 2026-27', starts_on: '2026-04-01', ends_on: '2027-03-31' }, headers: H(ownerToken) });
  assert.equal(dup.statusCode, 409);
});

test('AY · resolution helper: app.current_academic_year_id returns the current year', async () => {
  const want = (await sql(`SELECT id FROM app.academic_years WHERE is_current`)).rows[0].id;
  const got = (await sql(`SELECT app.current_academic_year_id($1) id`, [tenantA])).rows[0].id;
  assert.equal(got, want);
  const none = (await sql(`SELECT app.current_academic_year_id($1) id`, [tenantB])).rows[0].id;
  assert.equal(none, null, 'tenant B has no current year yet');
});
