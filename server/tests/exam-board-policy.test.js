// Per-exam board policy (Wave 4 · L1-4.3): shape-validated storage on the exam
// row — validation ONLY, honestly labeled. (The bulk-marks half of this queue
// item already ships in exams.assessment: one tx, ≤300 rows, eligibility, audit.)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';
import pg from 'pg';

let app;
let sql;
let ownerToken, principalToken, teacherToken;
let tenantA, examId;
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const good = { board: 'CBSE', rounding: 'nearest', components: { written: 80, internal: 20 }, gradingScale: [{ min: 91, grade: 'A1' }, { min: 33, grade: 'D' }], notes: 'per-exam override for the term exam' };

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
  principalToken = (await loginAs(app, 'principal@meridian.edu')).token;
  teacherToken = (await loginAs(app, 'teacher@meridian.edu')).token;
  // F5 test drives the real exam doors, so the plugin must be on.
  await app.inject({ method: 'POST', url: '/plugins/exams.assessment/enable', headers: H(ownerToken), payload: { version: '1.0.0', class: 'D' } });
  tenantA = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  examId = (await sql(
    `INSERT INTO plugin_exams.exam (tenant_id, name, term, class_grade) VALUES ($1,'TC Board Policy Exam','term-1','6') RETURNING id`,
    [tenantA])).rows[0].id;
});
after(async () => { await app?.close(); });

test('BP · valid reference policy stores and reads back (no scale ⇒ reference only)', async () => {
  const r = await app.inject({ method: 'POST', url: `/exams/${examId}/board-policy`, payload: good, headers: H(ownerToken) });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().boardPolicy.board, 'CBSE');
  assert.equal(r.json().applied, false, 'the reference shape carries no scale, so it is not applied');
  assert.match(r.json().note, /reference/);
  const g = await app.inject({ method: 'GET', url: `/exams/${examId}/board-policy`, headers: H(teacherToken) });
  assert.equal(g.statusCode, 200);
  assert.equal(g.json().boardPolicy.components.internal, 20);
});

test('BP · F5 · a per-exam policy WITH a scale is applied at report assembly', async () => {
  const co = await loginAs(app, 'coordinator@meridian.edu');
  const pr = await loginAs(app, 'principal@meridian.edu');
  const mk = await app.inject({ method: 'POST', url: '/plugins/exams.assessment/exams', headers: H(co.token),
    payload: { name: 'F5 Policy Exam', classGrade: '6', weightage: { written: 100 } } });
  assert.equal(mk.statusCode, 200, mk.body);
  const exId = (await sql(`SELECT id FROM plugin_exams.exam WHERE name='F5 Policy Exam'`)).rows[0].id;
  const bp = await app.inject({ method: 'POST', url: `/exams/${exId}/board-policy`, headers: H(ownerToken),
    payload: { board: 'CBSE', scale: 'cbse_10_point', pass_pct: 50, divisions: [{ label: 'Distinction', min_pct: 75 }] } });
  assert.equal(bp.statusCode, 200, bp.body);
  assert.equal(bp.json().applied, true, 'a scale-bearing policy is applied');
  const stu = (await sql(`SELECT id FROM app.students WHERE status='active' LIMIT 1`)).rows[0];
  await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${exId}/marks`, headers: H(co.token),
    payload: { studentId: stu.id, component: 'written', marks: 80, maxMarks: 100 } });
  const pub = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${exId}/publish`, headers: H(co.token), payload: {} });
  assert.equal(pub.statusCode, 200, pub.body);
  const dec = await app.inject({ method: 'POST', url: `/actions/${pub.json().actionId}/decide`, headers: H(pr.token), payload: { decision: 'approved' } });
  assert.equal(dec.statusCode, 200, dec.body);
  const ex = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${exId}/publish/execute`, headers: H(pr.token), payload: {} });
  assert.equal(ex.statusCode, 200, ex.body);
  const rep = (await sql(`SELECT snapshot FROM plugin_exams.report WHERE exam_id=$1 AND student_id=$2`, [exId, stu.id])).rows[0];
  assert.ok(rep, 'report assembled');
  assert.equal(rep.snapshot.pass, true, 'the per-exam policy pass decision is applied');
  assert.equal(rep.snapshot.division, 'Distinction', 'the per-exam division band is applied');
});

test('BP · shape validation: bad rounding, over-100 components, bad bands, unknown keys → 400', async () => {
  for (const payload of [
    { ...good, rounding: 'round' },
    { ...good, components: { written: 90, internal: 20 } }, // sums to 110
    { ...good, gradingScale: [{ min: 33, grade: 'D' }, { min: 91, grade: 'A1' }] }, // not descending
    { ...good, gradingScale: [{ min: 'high', grade: 'A1' }] },
    { ...good, junk: true },
    { ...good, board: '' },
    { components: { written: 50 } }, // missing board
  ]) {
    const r = await app.inject({ method: 'POST', url: `/exams/${examId}/board-policy`, payload, headers: H(ownerToken) });
    assert.equal(r.statusCode, 400, `expected 400 for ${JSON.stringify(payload)}, got ${r.statusCode} ${r.body}`);
  }
});

test('BP · exam existence and role gates: teacher cannot set; principal can; unknown 404', async () => {
  const t = await app.inject({ method: 'POST', url: `/exams/${examId}/board-policy`, payload: good, headers: H(teacherToken) });
  assert.equal(t.statusCode, 403);
  const p = await app.inject({ method: 'POST', url: `/exams/${examId}/board-policy`, payload: { board: 'ICSE' }, headers: H(principalToken) });
  assert.equal(p.statusCode, 200);
  const nf = await app.inject({ method: 'POST', url: `/exams/00000000-0000-0000-0000-000000000000/board-policy`, payload: good, headers: H(ownerToken) });
  assert.equal(nf.statusCode, 404);
  const badId = await app.inject({ method: 'POST', url: `/exams/not-a-uuid/board-policy`, payload: good, headers: H(ownerToken) });
  assert.equal(badId.statusCode, 400);
});
