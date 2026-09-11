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
  tenantA = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  examId = (await sql(
    `INSERT INTO plugin_exams.exam (tenant_id, name, term, class_grade) VALUES ($1,'TC Board Policy Exam','term-1','6') RETURNING id`,
    [tenantA])).rows[0].id;
});
after(async () => { await app?.close(); });

test('BP · valid policy stores and reads back, honestly labeled validation-only', async () => {
  const r = await app.inject({ method: 'POST', url: `/exams/${examId}/board-policy`, payload: good, headers: H(ownerToken) });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().boardPolicy.board, 'CBSE');
  assert.match(r.json().note, /validation only/);
  const g = await app.inject({ method: 'GET', url: `/exams/${examId}/board-policy`, headers: H(teacherToken) });
  assert.equal(g.statusCode, 200);
  assert.equal(g.json().boardPolicy.components.internal, 20);
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
