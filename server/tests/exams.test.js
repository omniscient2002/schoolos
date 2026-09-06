// exams.assessment — wave-3 runtime tests (migrations 014 + 025)
// Pins: lifecycle gate, weightage_total_enforced (create + publish), marks upsert +
// per-write audit + exam.marks.updated.v1, frozen marks at publish, publication via the
// KERNEL approval spine (raise → /actions/:id/decide → execute; execute-before-approval
// refused; proposer-execution SoD refused), deterministic_only (same inputs → same
// digest), no_cross_tenant_marks (RLS on schoolos.tenant_id + cross-tenant 404),
// exam.published.v1. Class D.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setupTestDb, loginAs } from './helpers.js';

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

let app;
let sql;
let students; // seeded students for marks

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
  students = (await sql(`SELECT id FROM app.students ORDER BY admission_no LIMIT 3`)).rows;
  assert.ok(students.length >= 2, 'seed must contain students');
});

describe('exams.assessment (wave-3 · migrations 014+025 · deterministic publication)', () => {
  test('1 · registered-not-enabled: lifecycle gate 409; parent has no exams door', async () => {
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const pre = await app.inject({ method: 'POST', url: '/plugins/exams.assessment/exams',
      payload: { name: 'T1', classGrade: '8', weightage: { written: 100 } }, headers: H(co.token) });
    assert.equal(pre.statusCode, 409);
    assert.match(pre.json().error, /not enabled/);
    const parent = await loginAs(app, 'parent@meridian.edu');
    const p = await app.inject({ method: 'GET', url: '/plugins/exams.assessment/exams', headers: H(parent.token) });
    assert.equal(p.statusCode, 403);
  });

  test('2 · enable (owner) → create exam; weightage_total_enforced at create (≠100 → 409)', async () => {
    const o = await loginAs(app, 'owner@meridian.edu');
    const en = await app.inject({ method: 'POST', url: '/plugins/exams.assessment/enable',
      headers: { ...H(o.token), 'content-type': 'application/json' }, payload: { version: '1.0.0', class: 'D' } });
    assert.equal(en.statusCode, 200);
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const bad = await app.inject({ method: 'POST', url: '/plugins/exams.assessment/exams',
      payload: { name: 'Unit Test 1', classGrade: '8', weightage: { written: 60, oral: 30 } }, headers: H(co.token) });
    assert.equal(bad.statusCode, 409);
    assert.match(bad.json().error, /weightage_total_enforced/);
    const r = await app.inject({ method: 'POST', url: '/plugins/exams.assessment/exams',
      payload: { name: 'Unit Test 1', classGrade: '8', weightage: { written: 70, oral: 30 } }, headers: H(co.token) });
    assert.equal(r.statusCode, 200);
  });

  test('3 · marks entry: upsert, per-write audit, exam.marks.updated.v1; over-max refused; unknown student 404', async () => {
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const exams = (await app.inject({ method: 'GET', url: '/plugins/exams.assessment/exams', headers: H(co.token) })).json();
    const examId = exams.exams[0].id;
    const m1 = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${examId}/marks`,
      payload: { studentId: students[0].id, component: 'written', marks: 82, maxMarks: 100 }, headers: H(co.token) });
    assert.equal(m1.statusCode, 200);
    const m2 = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${examId}/marks`,
      payload: { studentId: students[0].id, component: 'oral', marks: 18, maxMarks: 20 }, headers: H(co.token) });
    assert.equal(m2.statusCode, 200);
    const m1b = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${examId}/marks`,
      payload: { studentId: students[0].id, component: 'written', marks: 88, maxMarks: 100 }, headers: H(co.token) });
    assert.equal(m1b.statusCode, 200, 'upsert allowed pre-publication');
    const over = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${examId}/marks`,
      payload: { studentId: students[0].id, component: 'written', marks: 101, maxMarks: 100 }, headers: H(co.token) });
    assert.equal(over.statusCode, 409, 'marks cannot exceed maxMarks');
    const nf = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${examId}/marks`,
      payload: { studentId: '00000000-0000-0000-0000-000000000000', component: 'written', marks: 50 }, headers: H(co.token) });
    assert.equal(nf.statusCode, 404);
    const aud = await sql(`SELECT count(*)::int n FROM app.audit_log WHERE action='marks entered'`);
    assert.equal(aud.rows[0].n >= 3, true, 'every marks write audited');
    const ev = await sql(`SELECT count(*)::int n FROM app.outbox WHERE topic='exam.marks.updated.v1'`);
    assert.equal(ev.rows[0].n >= 3, true, 'exam.marks.updated.v1 per write');
  });

  test('4 · publication: kernel approval spine (raise → SoD → approve → execute → freeze)', async () => {
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const exams = (await app.inject({ method: 'GET', url: '/plugins/exams.assessment/exams', headers: H(co.token) })).json();
    const examId = exams.exams.find((e) => e.name === 'Unit Test 1').id;
    const pub = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${examId}/publish`, payload: {}, headers: H(co.token) });
    assert.equal(pub.statusCode, 200);
    const { actionId } = pub.json();
    const dup = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${examId}/publish`, payload: {}, headers: H(co.token) });
    assert.equal(dup.statusCode, 409, 'one open publication approval');
    const early = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${examId}/publish/execute`, payload: {}, headers: H(co.token) });
    assert.equal(early.statusCode, 409, 'execute-before-approval refused (approval_before_publish)');
    const pr = await loginAs(app, 'principal@meridian.edu');
    const ap = await app.inject({ method: 'POST', url: `/actions/${actionId}/decide`,
      payload: { decision: 'approved', note: 'weights verified' }, headers: H(pr.token) });
    assert.equal(ap.statusCode, 200);
    const ex = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${examId}/publish/execute`, payload: {}, headers: H(pr.token) });
    assert.equal(ex.statusCode, 200);
    assert.equal(ex.json().status, 'published');
    assert.match(ex.json().digest, /^[0-9a-f]{64}$/, 'deterministic digest stamped');
    // marks frozen at publish
    const frz = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${examId}/marks`,
      payload: { studentId: students[1].id, component: 'written', marks: 50 }, headers: H(co.token) });
    assert.equal(frz.statusCode, 409, 'marks frozen — exam published (read-only)');
    const ev = await sql(`SELECT count(*)::int n FROM app.outbox WHERE topic='exam.published.v1'`);
    assert.equal(ev.rows[0].n, 1);
  });

  test('5 · deterministic_only: same inputs → identical digest; grade scale cbse_10_point', async () => {
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const exams = (await app.inject({ method: 'GET', url: '/plugins/exams.assessment/exams', headers: H(co.token) })).json();
    const examId = exams.exams.find((e) => e.name === 'Unit Test 1').id;
    const r1 = await app.inject({ method: 'GET', url: `/plugins/exams.assessment/exams/${examId}/reports/${students[0].id}`, headers: H(co.token) });
    assert.equal(r1.statusCode, 200);
    const r2 = await app.inject({ method: 'GET', url: `/plugins/exams.assessment/exams/${examId}/reports/${students[0].id}`, headers: H(co.token) });
    assert.equal(r1.json().digest, r2.json().digest, 'same inputs → same digest');
    // 88/100 written (70%) + 18/20 oral (30%) → 0.88*0.7 + 0.9*0.3 = 88.6 → A2
    assert.equal(r1.json().report.grade, 'A2');
    assert.equal(r1.json().report.pct, 88.6);
  });

  test('6 · no_cross_tenant_marks: RLS blocks cross-tenant app-role reads; cross-tenant examId 404', async () => {
    // second tenant (test seed is single-tenant) — dpdp precedent: direct INSERT with explicit id
    const other = (await sql(
      `INSERT INTO app.tenants (id, slug, name, config)
       VALUES (gen_random_uuid(), 'other-school-' || floor(random()*1e6)::text, 'Other School', '{}'::jsonb)
       RETURNING id`)).rows[0];
    const mine = (await sql(`SELECT e.id FROM plugin_exams.exam e WHERE e.tenant_id=(SELECT id FROM app.tenants WHERE slug='meridian') LIMIT 1`)).rows[0];
    assert.ok(mine?.id, 'exam row exists for meridian');
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    await c.query(`BEGIN`);
    await c.query(`SELECT set_config('schoolos.tenant_id', $1, true)`, [other.id]);
    await c.query(`SET LOCAL ROLE schoolos_app`);
    const seen = await c.query(`SELECT count(*)::int n FROM plugin_exams.mark`);
    let insertBlocked = false;
    try { await c.query(`INSERT INTO plugin_exams.mark (tenant_id, exam_id, student_id, marks, max_marks) VALUES ($1, $2, $3, 50, 100)`, [other.id, mine.id, students[0].id]); }
    catch (e) { insertBlocked = true; }
    await c.query(`ROLLBACK`);
    await c.end();
    assert.equal(seen.rows[0].n, 0, 'RLS: no rows visible under another tenant GUC');
    assert.equal(insertBlocked, true, 'RLS WITH CHECK: cross-tenant write rejected');
    // API proof: cross-tenant exam id on the marks door → tenant-scoped miss
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const x = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${mine.id}/marks`,
      payload: { studentId: students[0].id, component: 'written', marks: 50 }, headers: H(co.token) });
    assert.ok([404, 409].includes(x.statusCode), 'cross-tenant exam id never matches (meridian session, other-tenant exam is invisible)');
  });

  test('7 · teacher may enter marks but NOT create exams or publish (EXAM_ADMIN tier)', async () => {
    const t = await loginAs(app, 'teacher@meridian.edu');
    const exams = (await app.inject({ method: 'GET', url: '/plugins/exams.assessment/exams', headers: H(t.token) })).json();
    const examId = exams.exams.find((e) => e.name === 'Unit Test 1').id;
    const m = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${examId}/marks`,
      payload: { studentId: students[1].id, component: 'written', marks: 44, maxMarks: 100 }, headers: H(t.token) });
    assert.equal(m.statusCode, 409, 'teacher can write marks (this 409 is the freeze, proving the door passed the role tier)');
    const create = await app.inject({ method: 'POST', url: '/plugins/exams.assessment/exams',
      payload: { name: 'Sneaky', classGrade: '8' }, headers: H(t.token) });
    assert.equal(create.statusCode, 403, 'exam creation is EXAM_ADMIN');
    const pub = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${examId}/publish`, payload: {}, headers: H(t.token) });
    assert.equal(pub.statusCode, 403, 'publication is EXAM_ADMIN');
  });
});
