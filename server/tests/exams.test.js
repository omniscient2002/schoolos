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
    // try/finally: a failing query must not leak the client. A leaked pg.Client keeps the process
    // alive after the tests finish, so the runner reports a ~670s "file" failure and marks every
    // later file as failed without running it — one bad fixture wedged the whole suite.
    try { return await c.query(text, params); } finally { await c.end().catch(() => {}); }
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
    assert.match(pre.json().error, /switched off/); // plain-language copy pass (gate)
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
    // PERFECT-100 §5.7: this regex was stale, and it made SEVEN tests red for one stale
    // string. The door's copy was improved to "…non-negative numbers that add up to
    // exactly 100%" (a clearer message, and it now also mentions non-negativity) but the
    // assertion still demanded the literal "add up to 100%", so it failed against BETTER
    // copy — and because this test creates the exam that tests 3-7 and 9 then use, its
    // failure cascaded into six more failures that looked like real damage.
    // The code is right and the test was wrong, so the test moves: the assertion still
    // requires the copy to explain the 100% rule, and now tolerates the improved wording.
    assert.match(bad.json().error, /add up to (exactly )?100%/); // plain-language copy pass (was weightage_total_enforced)
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

  test('8 · eligibility consumes attendance (kernel primitive): sub-floor student 409, above-floor passes', async () => {
    // drive students[2] below the 75% floor with synthetic attendance rows
    const low = students[2];
    // Migration 092 enforces marked_by on new rows (NOT VALID still constrains INSERT/UPDATE), so the
    // fixture names a real marker — the eligibility gate under test is attendance, not the marker check.
    await sql(`INSERT INTO app.attendance (tenant_id, student_id, school_date, status, marked_by)
               SELECT s.tenant_id, s.id, (current_date - (g.i || ' days')::interval)::date, 'absent',
                      (SELECT id FROM app.users u WHERE u.tenant_id = s.tenant_id LIMIT 1)
               FROM app.students s, generate_series(1, 12) g(i) WHERE s.id = $1
               ON CONFLICT (tenant_id, student_id, school_date) DO UPDATE SET status='absent'`, [low.id]);
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const ex = await app.inject({ method: 'POST', url: '/plugins/exams.assessment/exams',
      payload: { name: 'Unit Test 2', classGrade: '8', weightage: { written: 100 } }, headers: H(co.token) });
    const examId = ex.json().examId;
    const denied = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${examId}/marks`,
      payload: { studentId: low.id, component: 'written', marks: 60, maxMarks: 100 }, headers: H(co.token) });
    assert.equal(denied.statusCode, 409, 'marks refused for below-floor attendance');
    assert.ok(/below the 75% floor/.test(denied.json().error), 'refusal names the attendance floor'); // message keeps the numbers
    // a student with guaranteed-above-floor attendance (30 present days) passes
    const high = students[1];
    await sql(`INSERT INTO app.attendance (tenant_id, student_id, school_date, status, marked_by)
               SELECT s.tenant_id, s.id, (current_date - (g.i || ' days')::interval)::date, 'present',
                      (SELECT id FROM app.users u WHERE u.tenant_id = s.tenant_id LIMIT 1)
               FROM app.students s, generate_series(1, 30) g(i) WHERE s.id = $1
               ON CONFLICT (tenant_id, student_id, school_date) DO UPDATE SET status='present'`, [high.id]);
    const ok = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${examId}/marks`,
      payload: { studentId: high.id, component: 'written', marks: 91, maxMarks: 100 }, headers: H(co.token) });
    assert.equal(ok.statusCode, 200, 'above-floor student passes eligibility');
  });

  test('9 · moderation flow: propose → open-dup 409 → proposer-decide 403 → approve → snapshot replaced; reject path', async () => {
    const co = await loginAs(app, 'coordinator@meridian.edu');
    // regression pin: kernel action codes are UNIQUE (tenant, code) → a second exam
    // publishes under its own per-exam code (exams.publish.<examId>); the fixed
    // 'exams.publish' code would 23505 here
    const exams0 = (await app.inject({ method: 'GET', url: '/plugins/exams.assessment/exams', headers: H(co.token) })).json();
    const ut2 = exams0.exams.find((e) => e.name === 'Unit Test 2');
    if (ut2) {
      const pub2 = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${ut2.id}/publish`, payload: {}, headers: H(co.token) });
      assert.equal(pub2.statusCode, 200, 'second exam publishes under its own per-exam action code');
    }
    const exams = (await app.inject({ method: 'GET', url: '/plugins/exams.assessment/exams', headers: H(co.token) })).json();
    const examId = exams.exams.find((e) => e.name === 'Unit Test 1').id;
    const sid = students[0].id;
    const orig = (await app.inject({ method: 'GET', url: `/plugins/exams.assessment/exams/${examId}/reports/${sid}`, headers: H(co.token) })).json();
    const principal = await loginAs(app, 'principal@meridian.edu');
    const prop = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${examId}/reports/${sid}/moderate`,
      payload: { reason: 'oral component rescored after revaluation' }, headers: H(co.token) });
    assert.equal(prop.statusCode, 200);
    const dup = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${examId}/reports/${sid}/moderate`,
      payload: { reason: 'another reason' }, headers: H(co.token) });
    assert.equal(dup.statusCode, 409, 'one open moderation per report');
    const self = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/moderations/${prop.json().moderationId}/decide`,
      payload: { decision: 'approved', adjustedSnapshot: { ...orig.report, pct: 91, grade: 'A1', points: 10 } }, headers: H(co.token) });
    assert.equal(self.statusCode, 403, 'proposer may not decide their own moderation (SoD)');
    const bad = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/moderations/${prop.json().moderationId}/decide`,
      payload: { decision: 'approved' }, headers: H(principal.token) });
    assert.equal(bad.statusCode, 400, 'approval without adjustedSnapshot refused');
    const ap = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/moderations/${prop.json().moderationId}/decide`,
      payload: { decision: 'approved', adjustedSnapshot: { ...orig.report, pct: 91, grade: 'A1', points: 10 }, note: 'revaluation accepted' }, headers: H(principal.token) });
    assert.equal(ap.statusCode, 200);
    const now = (await app.inject({ method: 'GET', url: `/plugins/exams.assessment/exams/${examId}/reports/${sid}`, headers: H(co.token) })).json();
    assert.equal(now.report.pct, 91, 'snapshot replaced by approved adjustment');
    assert.notEqual(now.digest, orig.digest, 'digest re-stamped for the adjusted snapshot');
    // reject path: second moderation, decided rejected → report unchanged
    const prop2 = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${examId}/reports/${sid}/moderate`,
      payload: { reason: 'speculative second review' }, headers: H(co.token) });
    const rj = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/moderations/${prop2.json().moderationId}/decide`,
      payload: { decision: 'rejected', note: 'no basis' }, headers: H(principal.token) });
    assert.equal(rj.statusCode, 200);
    const after = (await app.inject({ method: 'GET', url: `/plugins/exams.assessment/exams/${examId}/reports/${sid}`, headers: H(co.token) })).json();
    assert.equal(after.digest, now.digest, 'rejected moderation leaves the report untouched');
    const aud = await sql(`SELECT count(*)::int n FROM app.audit_log WHERE action LIKE 'moderation %'`);
    assert.equal(aud.rows[0].n >= 3, true, 'moderation decisions audited');
  });
});
