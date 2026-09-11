// L3-3.1 — exam depth: bulk marks (one tx, per-row failure collection, eligibility
// per distinct student) · per-board policy (GET default/custom, PUT validated shape,
// policy flows into assembly) · recompute verifier (re-assembles from frozen marks,
// reports digest drift, never auto-corrects) · moderation queue read. Style:
// tests/exams.test.js · WRITE-ONLY in-lane (D-10 — the orchestrator runs the suite).
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

let app;
let sql;
let students; // seeded students for marks
let examId;   // published exam (freshly created + published in before())
let draftExamId; // unpublished exam for bulk-entry tests
let coordinator, principal, teacher, parent;

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.ready();
  const pg = (await import('pg')).default;
  sql = async (text, params = []) => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const r = await c.query(text, params);
    await c.end();
    return r;
  };
  students = (await sql(`SELECT id FROM app.students ORDER BY admission_no LIMIT 4`)).rows;
  assert.ok(students.length >= 3, 'seed must contain students');
  coordinator = await loginAs(app, 'coordinator@meridian.edu');
  principal = await loginAs(app, 'principal@meridian.edu');
  teacher = await loginAs(app, 'teacher@meridian.edu');
  parent = await loginAs(app, 'parent@meridian.edu');
  const owner = await loginAs(app, 'owner@meridian.edu');
  const en = await app.inject({ method: 'POST', url: '/plugins/exams.assessment/enable', headers: H(owner.token), payload: { version: '1.0.0', class: 'D' } });
  assert.equal(en.statusCode, 200, `enable: ${en.body}`);
  const mk = async (name) => {
    const r = await app.inject({ method: 'POST', url: '/plugins/exams.assessment/exams',
      headers: H(coordinator.token), payload: { name, classGrade: '8', term: 'term-1', weightage: { written: 100 } } });
    assert.equal(r.statusCode, 200, r.body);
    return r.json().examId; // create door returns { ok, examId, status, weightage }
  };
  // published exam: single component 100%, marks for 3 students, approval spine, execute by principal
  examId = await mk('L3 Depth Final');
  for (const [i, st] of students.slice(0, 3).entries()) {
    const m = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${examId}/marks`,
      headers: H(teacher.token), payload: { studentId: st.id, component: 'written', marks: 60 + i * 10, maxMarks: 100 } });
    assert.equal(m.statusCode, 200, m.body);
  }
  const pub = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${examId}/publish`, headers: H(coordinator.token), payload: {} });
  assert.equal(pub.statusCode, 200, pub.body);
  const actionId = pub.json().actionId;
  const decide = await app.inject({ method: 'POST', url: `/actions/${actionId}/decide`, headers: H(principal.token), payload: { decision: 'approved', note: 'weights verified' } });
  assert.ok([200, 201].includes(decide.statusCode), decide.body);
  const ex = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${examId}/publish/execute`, headers: H(principal.token), payload: {} });
  assert.equal(ex.statusCode, 200, ex.body);
  // draft exam for bulk tests
  draftExamId = await mk('L3 Bulk Unit');
});

describe('exams.assessment depth (L3-3.1)', () => {
  test('bulk: saves valid rows, collects bad rows per-row (missing id, marks>max, unknown student), refuses published exam outright', async () => {
    const okId = students[0].id;
    const r = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${draftExamId}/marks/bulk`,
      headers: H(teacher.token),
      payload: { rows: [
        { studentId: okId, component: 'written', marks: 55, maxMarks: 100 },
        { component: 'written', marks: 50 },                                        // no studentId
        { studentId: students[1].id, component: 'written', marks: 120, maxMarks: 100 }, // marks > max
        { studentId: '00000000-0000-0000-0000-000000000000', component: 'written', marks: 50 }, // unknown
      ] } });
    assert.equal(r.statusCode, 200, r.body);
    const body = r.json();
    assert.equal(body.saved, 1, JSON.stringify(body));
    assert.equal(body.failedRows.length, 3);
    assert.match(body.failedRows[1].error, /more than the maximum/);
    assert.match(body.failedRows[2].error, /not found/);
    // upsert: same row again updates, count stays 1
    const again = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${draftExamId}/marks/bulk`,
      headers: H(teacher.token), payload: { rows: [{ studentId: okId, component: 'written', marks: 70 }] } });
    assert.equal(again.statusCode, 200);
    assert.equal(again.json().saved, 1);
    const row = (await sql(`SELECT marks FROM plugin_exams.mark WHERE exam_id=$1 AND student_id=$2`, [draftExamId, okId])).rows[0];
    assert.equal(Number(row.marks), 70, 'upsert overwrote');
    // published exam refuses the whole batch
    const frozen = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${examId}/marks/bulk`,
      headers: H(teacher.token), payload: { rows: [{ studentId: okId, marks: 10 }] } });
    assert.equal(frozen.statusCode, 409);
    assert.match(frozen.json().error, /locked/);
  });

  test('bulk: attendance floor rejects the row (not the batch); 300-row cap; empty rows 400', async () => {
    // student with zero attendance (seeded students have attendance; fabricate a fresh one with none)
    const tenantId = (await sql(`SELECT tenant_id FROM app.users WHERE email='owner@meridian.edu'`)).rows[0].tenant_id;
    const noAtt = (await sql(
      `INSERT INTO app.students (tenant_id, admission_no, name, grade, section, source, source_ref)
       VALUES ($1,'MER-L3-B1','No Attendance Kid','8','B','migration','l3-3.1') RETURNING id`,
      [tenantId])).rows[0].id;
    const r = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${draftExamId}/marks/bulk`,
      headers: H(teacher.token),
      payload: { rows: [
        { studentId: students[0].id, component: 'oral', marks: 40 },
        { studentId: noAtt, component: 'oral', marks: 40 },
      ] } });
    assert.equal(r.statusCode, 200, r.body);
    const body = r.json();
    assert.equal(body.saved, 1, 'the eligible row still saves');
    assert.equal(body.failedRows.length, 1);
    assert.match(body.failedRows[0].error, /below the .* floor/);
    const cap = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${draftExamId}/marks/bulk`,
      headers: H(teacher.token), payload: { rows: Array.from({ length: 301 }, () => ({ studentId: students[0].id, marks: 5 })) } });
    assert.equal(cap.statusCode, 409);
    const empty = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${draftExamId}/marks/bulk`,
      headers: H(teacher.token), payload: { rows: [] } });
    assert.equal(empty.statusCode, 400);
  });

  test('recompute: no drift on untouched published reports (pre-policy); teacher 403 (MOD_TIER); draft exam 409', async () => {
    const r = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${examId}/recompute`, headers: H(coordinator.token), payload: {} });
    assert.equal(r.statusCode, 200, r.body);
    const body = r.json();
    assert.equal(body.checked, 3, JSON.stringify(body));
    assert.equal(body.drifted.length, 0, 'deterministic_only: same inputs → same digests');
    assert.equal(body.policyApplied, false, 'no policy saved yet — bare gradeOf assembly');
    const t = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${examId}/recompute`, headers: H(teacher.token), payload: {} });
    assert.equal(t.statusCode, 403);
    const d = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${draftExamId}/recompute`, headers: H(coordinator.token), payload: {} });
    assert.equal(d.statusCode, 409);
    assert.match(d.json().error, /published/i);
  });

  test('board policy: GET default (custom=false), PUT validates shape, teacher 403 on PUT, change is audited', async () => {
    const def = await app.inject({ method: 'GET', url: '/plugins/exams.assessment/board-policy', headers: H(coordinator.token) });
    assert.equal(def.statusCode, 200, def.body);
    assert.equal(def.json().custom, false);
    assert.equal(def.json().policy.scale, 'cbse_10_point');
    const par = await app.inject({ method: 'GET', url: '/plugins/exams.assessment/board-policy', headers: H(parent.token) });
    assert.equal(par.statusCode, 403);
    const putT = await app.inject({ method: 'PUT', url: '/plugins/exams.assessment/board-policy', headers: H(teacher.token),
      payload: { board: 'CBSE', scale: 'cbse_10_point', pass_pct: 35 } });
    assert.equal(putT.statusCode, 403, putT.body);
    const badScale = await app.inject({ method: 'PUT', url: '/plugins/exams.assessment/board-policy', headers: H(principal.token),
      payload: { scale: 'hogwarts', pass_pct: 33 } });
    assert.equal(badScale.statusCode, 400);
    const badPass = await app.inject({ method: 'PUT', url: '/plugins/exams.assessment/board-policy', headers: H(principal.token),
      payload: { scale: 'percent', pass_pct: 140 } });
    assert.equal(badPass.statusCode, 400);
    const badDiv = await app.inject({ method: 'PUT', url: '/plugins/exams.assessment/board-policy', headers: H(principal.token),
      payload: { scale: 'percent', pass_pct: 33, divisions: [{ label: '', min_pct: 50 }] } });
    assert.equal(badDiv.statusCode, 400);
    const put = await app.inject({ method: 'PUT', url: '/plugins/exams.assessment/board-policy', headers: H(principal.token),
      payload: { board: 'CBSE', scale: 'percent', pass_pct: 33, divisions: [{ label: 'Distinction', min_pct: 75 }, { label: 'Pass', min_pct: 33 }] } });
    assert.equal(put.statusCode, 200, put.body);
    const got = await app.inject({ method: 'GET', url: '/plugins/exams.assessment/board-policy', headers: H(coordinator.token) });
    assert.equal(got.json().custom, true);
    assert.equal(got.json().policy.pass_pct, 33);
    const audit = (await sql(`SELECT outcome FROM app.audit_log WHERE action='board policy updated' ORDER BY created_at DESC LIMIT 1`)).rows[0];
    assert.ok(audit, 'policy change is audited');
    assert.match(audit.outcome, /board CBSE/);
  });

  test('recompute: a policy change AFTER publish surfaces as drift on every report (honest, never auto-corrected)', async () => {
    const r = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${examId}/recompute`, headers: H(coordinator.token), payload: {} });
    assert.equal(r.statusCode, 200, r.body);
    const body = r.json();
    assert.equal(body.policyApplied, true);
    assert.equal(body.drifted.length, body.checked, 'policy delta ⇒ every stored digest no longer follows');
    assert.match(body.note, /does NOT auto-correct/i);
  });

  test('recompute: with the policy removed, digests match again (assembly is a pure function of its inputs)', async () => {
    await sql(`UPDATE app.plugins SET settings = settings - 'board_policy' WHERE tenant_id=(SELECT tenant_id FROM app.users WHERE email='owner@meridian.edu') AND plugin_id='exams.assessment'`);
    const r = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${examId}/recompute`, headers: H(coordinator.token), payload: {} });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().drifted.length, 0);
    assert.equal(r.json().policyApplied, false);
  });

  test('recompute: detects drift when marks diverge from the frozen snapshot', async () => {
    // tamper the FROZEN mark row directly at SQL level (owner-path pool role)
    const tampered = (await sql(
      `UPDATE plugin_exams.mark SET marks = 99 WHERE exam_id=$1 AND student_id=$2 RETURNING marks`,
      [examId, students[0].id])).rows[0];
    assert.ok(tampered, 'fixture tamper applied');
    const r = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${examId}/recompute`, headers: H(coordinator.token), payload: {} });
    assert.equal(r.statusCode, 200, r.body);
    const body = r.json();
    assert.equal(body.drifted.length, 1, 'exactly the tampered student drifts');
    assert.equal(body.drifted[0].studentId, students[0].id);
    assert.notEqual(body.drifted[0].storedDigest, body.drifted[0].recomputedDigest);
    // restore for any later reading
    await sql(`UPDATE plugin_exams.mark SET marks = 60 WHERE exam_id=$1 AND student_id=$2`, [examId, students[0].id]);
  });

  test('moderation queue: lists proposals with exam/student/proposer joins; status filter works', async () => {
    const prop = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${examId}/reports/${students[1].id}/moderate`,
      headers: H(coordinator.token), payload: { reason: 'revaluation raised the written score' } });
    assert.equal(prop.statusCode, 200, prop.body);
    const q = await app.inject({ method: 'GET', url: '/plugins/exams.assessment/moderations?status=proposed', headers: H(principal.token) });
    assert.equal(q.statusCode, 200, q.body);
    const row = q.json().moderations.find((m) => m.id === prop.json().moderationId);
    assert.ok(row, 'proposal shows in the queue');
    assert.equal(row.status, 'proposed');
    assert.equal(row.exam.id, examId);
    assert.equal(row.report.studentId, students[1].id);
    assert.ok(row.proposedBy, 'proposer name joined');
    const all = await app.inject({ method: 'GET', url: '/plugins/exams.assessment/moderations?status=all', headers: H(principal.token) });
    assert.ok(all.json().moderations.length >= 1);
    const decided = await app.inject({ method: 'GET', url: '/plugins/exams.assessment/moderations?status=rejected', headers: H(principal.token) });
    assert.equal(decided.json().moderations.length, 0, 'nothing rejected yet');
  });
});
