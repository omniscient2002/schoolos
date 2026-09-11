// Migration engine (Wave 4 · L1-4.1): staged rows → validate → commit, real
// per-row error table, idempotent students+guardians+fees landing, commit as
// the ONLY path to 'verified', and a trust receipt with a REAL differenceCents.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';
import pg from 'pg';

let app;
let sql;
let ownerToken, teacherToken;
let tenantA, srcId;
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

const cleanRow = (n, extra = {}) => ({
  rowNo: n,
  data: {
    name: `Migrated Student ${n}`, grade: '6', section: 'B',
    guardianName: `Guardian ${n}`, guardianPhone: '+91900000700' + String(10 + n).slice(-2),
    fees: [{ term: 'Term 1', label: 'Admission fee', amountCents: 500000, dueOn: '2026-04-10', paidCents: 500000 },
           { term: 'Term 1', label: 'Tuition', amountCents: 300000, dueOn: '2026-07-10' }],
    ...extra,
  },
});

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
  ownerToken = (await loginAs(app, 'owner@meridian.edu')).token;
  teacherToken = (await loginAs(app, 'teacher@meridian.edu')).token;
  tenantA = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  const mk = await app.inject({ method: 'POST', url: '/migration/sources', payload: { name: 'Legacy school file', kind: 'csv' }, headers: H(ownerToken) });
  assert.equal(mk.statusCode, 200, mk.body);
  srcId = mk.json().source.id;
});
after(async () => { await app?.close(); });

test('ME · stage-rows: rows land staged, sample_json preview set, row_count real', async () => {
  const r = await app.inject({ method: 'POST', url: `/migration/sources/${srcId}/stage-rows`, payload: { rows: [cleanRow(1), cleanRow(2)] }, headers: H(ownerToken) });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().staged, 2);
  assert.equal(r.json().total, 2);
  const src = (await sql(`SELECT row_count, sample_json FROM app.migration_sources WHERE id=$1`, [srcId])).rows[0];
  assert.equal(src.row_count, 2);
  assert.equal(src.sample_json.preview.length, 2);
  assert.equal(src.sample_json.stagedCount, 2);
});

test('ME · validate: per-row errors land in the error table with honest reasons', async () => {
  // re-stage with one broken row (bad phone)
  await app.inject({ method: 'POST', url: `/migration/sources/${srcId}/stage-rows`, payload: { rows: [cleanRow(1), cleanRow(2), cleanRow(3, { guardianPhone: 'not-a-phone' })] }, headers: H(ownerToken) });
  const v = await app.inject({ method: 'POST', url: `/migration/sources/${srcId}/validate`, payload: {}, headers: H(ownerToken) });
  assert.equal(v.statusCode, 200, v.body);
  assert.equal(v.json().errors, 1);
  assert.equal(v.json().clean, 2);
  assert.match(v.json().first[0].error, /phone/);
  const flagged = (await sql(`SELECT flagged FROM app.migration_sources WHERE id=$1`, [srcId])).rows[0].flagged;
  assert.equal(flagged, 1);
});

test('ME · commit refuses while row errors exist (409)', async () => {
  const r = await app.inject({ method: 'POST', url: `/migration/sources/${srcId}/commit`, payload: {}, headers: H(ownerToken) });
  assert.equal(r.statusCode, 409);
  assert.match(r.json().error, /fix 1 row error/);
});

test('ME · commit: students+guardians+fees land; source verified; re-commit is idempotent', async () => {
  await app.inject({ method: 'POST', url: `/migration/sources/${srcId}/stage-rows`, payload: { rows: [cleanRow(1), cleanRow(2)] }, headers: H(ownerToken) });
  const v = await app.inject({ method: 'POST', url: `/migration/sources/${srcId}/validate`, payload: {}, headers: H(ownerToken) });
  assert.equal(v.json().errors, 0);
  const r = await app.inject({ method: 'POST', url: `/migration/sources/${srcId}/commit`, payload: {}, headers: H(ownerToken) });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().created, 2);
  assert.equal(r.json().status, 'verified');
  const src = (await sql(`SELECT status, imported FROM app.migration_sources WHERE id=$1`, [srcId])).rows[0];
  assert.equal(src.status, 'verified');
  assert.equal(src.imported, 2);
  // scope all counts to THIS source (the seed world already ships source='migration' students)
  const refp = `mig:${srcId}:%`;
  const students = (await sql(`SELECT id, admission_no FROM app.students WHERE tenant_id=$1 AND source='migration' AND source_ref LIKE $2 ORDER BY source_ref`, [tenantA, refp])).rows;
  assert.equal(students.length, 2);
  assert.match(students[0].admission_no, /^MIG-[0-9A-F]{8}-1$/);
  const fees = (await sql(`SELECT label, paid_cents, status FROM app.fee_obligations WHERE source_ref LIKE $1 ORDER BY source_ref LIMIT 4`, [refp])).rows;
  assert.equal(fees.length, 4); // 2 students × 2 fees
  const paid = fees.find((f) => f.label === 'Admission fee');
  assert.equal(paid.status, 'paid'); // imported fees respect paid history
  const g = (await sql(`SELECT count(*)::int n FROM app.guardians g JOIN app.students s ON s.id=g.student_id WHERE s.tenant_id=$1 AND s.source='migration' AND s.source_ref LIKE $2`, [tenantA, refp])).rows[0].n;
  assert.equal(g, 2);
  // idempotent replay
  const again = await app.inject({ method: 'POST', url: `/migration/sources/${srcId}/commit`, payload: {}, headers: H(ownerToken) });
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().created, 0);
  assert.equal(again.json().skipped, 2);
  const still = (await sql(`SELECT count(*)::int n FROM app.students WHERE tenant_id=$1 AND source='migration' AND source_ref LIKE $2`, [tenantA, refp])).rows[0].n;
  assert.equal(still, 2, 'no duplicate students');
});

test('ME · stage door can no longer hand-set verified', async () => {
  const r = await app.inject({ method: 'POST', url: `/migration/sources/${srcId}/stage`, payload: { to: 'shadow' }, headers: H(ownerToken) });
  assert.equal(r.statusCode, 200); // legitimate stages still work
  const bad = await app.inject({ method: 'POST', url: `/migration/sources/${srcId}/stage`, payload: { to: 'verified' }, headers: H(ownerToken) });
  assert.equal(bad.statusCode, 400);
});

test('ME · trust receipt: real differenceCents, requires a committed import', async () => {
  // hermetic 409 case: reset every source (seed ships some) so nothing is verified
  await sql(`UPDATE app.migration_sources SET status='shadow', imported=0 WHERE tenant_id=$1`, [tenantA]);
  const mk2 = await app.inject({ method: 'POST', url: '/migration/sources', payload: { name: 'Empty source', kind: 'csv' }, headers: H(ownerToken) });
  await app.inject({ method: 'POST', url: `/migration/sources/${mk2.json().source.id}/stage`, payload: { to: 'shadow' }, headers: H(ownerToken) });
  const none = await app.inject({ method: 'POST', url: '/migration/activate', payload: {}, headers: H(ownerToken) });
  assert.equal(none.statusCode, 409);
  assert.match(none.json().error, /nothing to activate/);
  // restore THIS source to its earned verified state → activate proceeds
  await sql(`UPDATE app.migration_sources SET status='verified', imported=2 WHERE id=$1`, [srcId]);
  const act = await app.inject({ method: 'POST', url: '/migration/activate', payload: {}, headers: H(ownerToken) });
  assert.equal(act.statusCode, 200, act.body);
  const want = (await sql(`SELECT COALESCE(SUM(amount_cents),0)::bigint t, COALESCE(SUM(paid_cents),0)::bigint p FROM app.fee_obligations WHERE tenant_id=$1`, [tenantA])).rows[0];
  assert.equal(act.json().trustReceipt.differenceCents, (BigInt(want.t) - BigInt(want.p)).toString(), 'differenceCents is the real gap, not a hardcoded 0');
  const activated = (await sql(`SELECT status FROM app.migration_sources WHERE id=$1`, [srcId])).rows[0].status;
  assert.equal(activated, 'activated');
});

test('ME · role gates: teacher refused on stage-rows/validate/commit', async () => {
  for (const door of ['stage-rows', 'validate', 'commit']) {
    const r = await app.inject({ method: 'POST', url: `/migration/sources/${srcId}/${door}`, payload: door === 'stage-rows' ? { rows: [cleanRow(9)] } : {}, headers: H(teacherToken) });
    assert.equal(r.statusCode, 403, `${door}: ${r.statusCode}`);
  }
});
