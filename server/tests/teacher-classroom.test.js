// TeacherOS lane TS-1 (retry) — teacher.classroom flow + role/privacy pins.
// The /my-cases lesson institutionalized: every scope is pinned by test, never assumed.
// Pins: enable rides the owner lifecycle door · students can ONLY submit (one-shot —
// double submit is 409 with the plain resubmission copy) · late decided at insert ·
// review belongs to the assigning teacher alone (colleague = 403, student = 403) ·
// teacher sees only created_by=self homework · staff leave raises per-instance kernel
// actions (2 requests → 2 DISTINCT codes) · RLS tenant scope · plain-language errors.
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { setupTestDb, loginAs } from './helpers.js';

let app;
let owner, teacher, teacher2, student, coordinator; // tokens cached (login limiter: 20/min)
let hwId, subId, hwLateId, lateSubId, leave1, leave2;
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const future = (days) => new Date(Date.now() + days * 864e5).toISOString();
const past = (days) => new Date(Date.now() - days * 864e5).toISOString();

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  owner = await loginAs(app, 'owner@meridian.edu');
  // Migration 031 seeds the extra demo cast (teacher2 Vikram Menon, student2 Diya Nair)
  // on live databases; on a FRESH database it applies before seed.js (which replays only
  // 009–030), so the fixtures are guaranteed here idempotently — same scrypt format.
  {
    const { pool } = await import('../src/db.js');
    const { hashPassword } = await import('../src/auth.js');
    const tenantId = (await pool.query(`SELECT tenant_id FROM app.users WHERE email='owner@meridian.edu'`)).rows[0].tenant_id;
    for (const [email, name, role] of [
      ['teacher2@meridian.edu', 'Vikram Menon', 'teacher'],
      ['student2@meridian.edu', 'Diya Nair', 'student'],
    ]) {
      await pool.query(
        `INSERT INTO app.users (tenant_id, email, name, role, password_hash) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (tenant_id, email) DO NOTHING`,
        [tenantId, email, name, role, hashPassword('schoolos-demo')]);
    }
  }
  teacher = await loginAs(app, 'teacher@meridian.edu');
  teacher2 = await loginAs(app, 'teacher2@meridian.edu');   // 031 fixture (Vikram Menon)
  student = await loginAs(app, 'student2@meridian.edu');    // 031 fixture (Diya Nair)
  coordinator = await loginAs(app, 'coordinator@meridian.edu');
  // enable through the real lifecycle door (registry row from migration 031 / enable-upsert)
  const en = await app.inject({ method: 'POST', url: '/plugins/teacher.classroom/enable',
    headers: H(owner.token), payload: { version: '1.0.0', class: 'C' } });
  assert.equal(en.statusCode, 200, `enable via owner door: ${en.body}`);
});
after(async () => { await app?.close(); });

test('teacher posts homework → 200, audited, listed under mine=1 with zero submissions', async () => {
  const r = await app.inject({ method: 'POST', url: '/plugins/teacher.classroom/homework', headers: H(teacher.token),
    payload: { class_grade: '8', subject: 'Mathematics', title: 'Fractions worksheet 3', detail: 'Complete Q1–Q12', due_at: future(2) } });
  assert.equal(r.statusCode, 200, r.body);
  hwId = r.json().homeworkId;
  assert.ok(/^[0-9a-f-]{36}$/.test(hwId), 'homeworkId is a uuid');
  const list = await app.inject({ method: 'GET', url: '/plugins/teacher.classroom/homework?mine=1', headers: H(teacher.token) });
  assert.equal(list.statusCode, 200, list.body);
  const mine = list.json().homework.find((h) => h.id === hwId);
  assert.ok(mine, 'own homework listed');
  assert.equal(mine.submission_count, 0);
  assert.equal(mine.status, 'open');
});

test('student submits text → 200; teacher sees the submission with the student name', async () => {
  const r = await app.inject({ method: 'POST', url: `/plugins/teacher.classroom/homework/${hwId}/submit`, headers: H(student.token),
    payload: { content_type: 'text', content: 'Q1–Q12 done, sums attached in notebook' } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().status, 'submitted');
  subId = r.json().submissionId;
  const view = await app.inject({ method: 'GET', url: `/plugins/teacher.classroom/homework/${hwId}`, headers: H(teacher.token) });
  assert.equal(view.statusCode, 200, view.body);
  const sub = view.json().submissions.find((s) => s.id === subId);
  assert.ok(sub, 'submission visible to the assigning teacher');
  assert.equal(sub.student_name, 'Diya Nair');
});

test('double submit → 409 with the plain resubmission copy (one-shot UNIQUE holds)', async () => {
  const r = await app.inject({ method: 'POST', url: `/plugins/teacher.classroom/homework/${hwId}/submit`, headers: H(student.token),
    payload: { content_type: 'text', content: 'trying to send again' } });
  assert.equal(r.statusCode, 409, r.body);
  assert.equal(r.json().error, 'Already submitted — resubmission is requested by your teacher, not allowed here');
});

test('past-due homework → submit lands as late (decided at insert); inbox agrees', async () => {
  const mk = await app.inject({ method: 'POST', url: '/plugins/teacher.classroom/homework', headers: H(teacher.token),
    payload: { class_grade: '8', subject: 'Science', title: 'Water cycle diagram', due_at: past(1) } });
  assert.equal(mk.statusCode, 200, mk.body);
  hwLateId = mk.json().homeworkId;
  const r = await app.inject({ method: 'POST', url: `/plugins/teacher.classroom/homework/${hwLateId}/submit`, headers: H(student.token),
    payload: { content_type: 'link', content: 'https://docs.example.com/diya/water-cycle' } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().status, 'late', 'submitted_at > due_at ⇒ late');
  lateSubId = r.json().submissionId;
  const late = await app.inject({ method: 'GET', url: '/plugins/teacher.classroom/submissions?state=late', headers: H(teacher.token) });
  assert.equal(late.statusCode, 200, late.body);
  assert.ok(late.json().submissions.some((s) => s.submission_id === lateSubId), 'late inbox lists it');
  const pending = await app.inject({ method: 'GET', url: '/plugins/teacher.classroom/submissions?state=pending', headers: H(teacher.token) });
  assert.equal(pending.statusCode, 200);
  assert.ok(pending.json().submissions.some((s) => s.submission_id === lateSubId), 'unreviewed late work is pending too');
});

test('assigning teacher reviews graded with grade + feedback → 200; reviewed inbox lists it', async () => {
  const r = await app.inject({ method: 'POST', url: `/plugins/teacher.classroom/submissions/${lateSubId}/review`, headers: H(teacher.token),
    payload: { status: 'graded', grade: '18/20', feedback: 'Good evaporation labels — add condensation arrows' } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().status, 'graded');
  const reviewed = await app.inject({ method: 'GET', url: '/plugins/teacher.classroom/submissions?state=reviewed', headers: H(teacher.token) });
  assert.equal(reviewed.statusCode, 200);
  assert.ok(reviewed.json().submissions.some((s) => s.submission_id === lateSubId), 'reviewed inbox lists it');
});

test('role gates: student cannot review or create homework; another teacher cannot review or open it', async () => {
  const sRev = await app.inject({ method: 'POST', url: `/plugins/teacher.classroom/submissions/${subId}/review`, headers: H(student.token),
    payload: { status: 'reviewed' } });
  assert.equal(sRev.statusCode, 403, `student review → 403: ${sRev.body}`);
  const sPost = await app.inject({ method: 'POST', url: '/plugins/teacher.classroom/homework', headers: H(student.token),
    payload: { class_grade: '8', subject: 'Art', title: 'Self portrait', due_at: future(1) } });
  assert.equal(sPost.statusCode, 403, 'students can ONLY submit');
  const t2Rev = await app.inject({ method: 'POST', url: `/plugins/teacher.classroom/submissions/${subId}/review`, headers: H(teacher2.token),
    payload: { status: 'reviewed' } });
  assert.equal(t2Rev.statusCode, 403, 'another teacher cannot review');
  assert.match(t2Rev.json().error, /Only the teacher who assigned this homework/, 'pin says why, plainly');
  const t2View = await app.inject({ method: 'GET', url: `/plugins/teacher.classroom/homework/${hwId}`, headers: H(teacher2.token) });
  assert.equal(t2View.statusCode, 404, 'another teacher\'s homework is invisible (no data in the error)');
  const t2List = await app.inject({ method: 'GET', url: '/plugins/teacher.classroom/homework?mine=1', headers: H(teacher2.token) });
  assert.equal(t2List.statusCode, 200);
  assert.ok(!t2List.json().homework.some((h) => h.id === hwId), 'teacher2 list never shows teacher1 homework');
});

test('inbox state=missing lists class-8 roster students without submissions (submitter excluded)', async () => {
  const { pool } = await import('../src/db.js');
  const roster = await pool.query(`SELECT count(*)::int AS n FROM app.students WHERE grade='8'`);
  const r = await app.inject({ method: 'GET', url: '/plugins/teacher.classroom/submissions?state=missing', headers: H(teacher.token) });
  assert.equal(r.statusCode, 200, r.body);
  const rows = r.json().submissions;
  assert.ok(rows.length >= 50, `missing roster rows present (got ${rows.length} of ${roster.rows[0].n})`);
  for (const row of rows) assert.equal(row.homework_id, hwLateId, 'missing rows ride the overdue homework');
  assert.ok(!rows.some((s) => s.student_name === 'Diya Nair'), 'the student who submitted is never missing');
  assert.ok(rows.some((s) => s.student_name === 'Aarav Sharma'), 'roster students without submissions are listed');
});

test('staff leave ×2 → two DISTINCT per-instance kernel actions; coordinator decides; mine mirrors it', async () => {
  const r1 = await app.inject({ method: 'POST', url: '/teacher/leave', headers: H(teacher.token),
    payload: { kind: 'sick', from_date: '2026-09-10', to_date: '2026-09-11', reason: 'fever' } });
  const r2 = await app.inject({ method: 'POST', url: '/teacher/leave', headers: H(teacher.token),
    payload: { kind: 'casual', from_date: '2026-09-15', to_date: '2026-09-15', reason: 'family function' } });
  assert.equal(r1.statusCode, 200, r1.body);
  assert.equal(r2.statusCode, 200, r2.body);
  leave1 = r1.json();
  leave2 = r2.json();
  assert.notEqual(leave1.actionId, leave2.actionId, 'per-instance codes differ (UNIQUE(tenant,code) holds)');
  assert.notEqual(leave1.requestId, leave2.requestId);
  const { pool } = await import('../src/db.js');
  const outbox = await pool.query(`SELECT count(*)::int AS n FROM app.outbox WHERE topic='staff.leave.requested.v1'`);
  assert.ok(outbox.rows[0].n >= 2, 'staff.leave.requested.v1 emitted per request');
  const mine0 = await app.inject({ method: 'GET', url: '/teacher/leave/mine', headers: H(teacher.token) });
  assert.equal(mine0.statusCode, 200, mine0.body);
  assert.ok(mine0.json().leave.every((l) => l.status === 'pending'), 'both pending before decision');
  const decide = await app.inject({ method: 'POST', url: `/actions/${leave1.actionId}/decide`, headers: H(coordinator.token),
    payload: { decision: 'approved', note: 'Get well soon' } });
  assert.equal(decide.statusCode, 200, `coordinator decides on kernel door: ${decide.body}`);
  const mine1 = await app.inject({ method: 'GET', url: '/teacher/leave/mine', headers: H(teacher.token) });
  const approved = mine1.json().leave.find((l) => l.id === leave1.requestId);
  const stillPending = mine1.json().leave.find((l) => l.id === leave2.requestId);
  assert.equal(approved.status, 'approved', 'kernel decision mirrored into the leave row');
  assert.equal(stillPending.status, 'pending', 'the other request is untouched');
});

test('RLS tenant scope: a foreign tenant setting sees zero classroom rows', async () => {
  const { pool, withUser } = await import('../src/db.js');
  const ten = await pool.query(`SELECT tenant_id FROM app.users WHERE email='teacher@meridian.edu'`);
  const realTenant = ten.rows[0].tenant_id;
  const foreign = await withUser(randomUUID(), 'teacher', (c) =>
    c.query(`SELECT count(*)::int AS n FROM teacher.homework`));
  assert.equal(foreign.rows[0].n, 0, 'RLS hides other tenants (current_setting policy)');
  const own = await withUser(realTenant, 'teacher', (c) =>
    c.query(`SELECT count(*)::int AS n FROM teacher.homework`));
  assert.ok(own.rows[0].n >= 2, 'own tenant rows visible under the same policy');
});

test('plain errors: validation copy, bad uuid param, unknown state, unknown homework', async () => {
  const noTitle = await app.inject({ method: 'POST', url: '/plugins/teacher.classroom/homework', headers: H(teacher.token),
    payload: { class_grade: '8', subject: 'Mathematics', due_at: future(1) } });
  assert.equal(noTitle.statusCode, 400);
  assert.match(noTitle.json().error, /short title/);
  const badType = await app.inject({ method: 'POST', url: `/plugins/teacher.classroom/homework/${hwId}/submit`, headers: H(student.token),
    payload: { content_type: 'file', content: 'x' } });
  assert.equal(badType.statusCode, 400);
  assert.match(badType.json().error, /text or a link/);
  const badId = await app.inject({ method: 'POST', url: '/plugins/teacher.classroom/homework/not-a-uuid/submit', headers: H(student.token),
    payload: { content_type: 'text', content: 'x' } });
  assert.equal(badId.statusCode, 400);
  assert.equal(badId.json().error, 'This record needs a valid ID');
  const badState = await app.inject({ method: 'GET', url: '/plugins/teacher.classroom/submissions?state=everything', headers: H(teacher.token) });
  assert.equal(badState.statusCode, 400);
  const badKind = await app.inject({ method: 'POST', url: '/teacher/leave', headers: H(teacher.token),
    payload: { kind: 'sabbatical', from_date: '2026-09-10', to_date: '2026-09-11', reason: 'x' } });
  assert.equal(badKind.statusCode, 400);
  const gone = await app.inject({ method: 'GET', url: `/plugins/teacher.classroom/homework/${randomUUID()}`, headers: H(teacher.token) });
  assert.equal(gone.statusCode, 404);
  assert.match(gone.json().error, /couldn't find that homework/);
});

test('migration 031 replays idempotently ×2 (registry, contracts, ledger stay singletons)', async () => {
  const { pool } = await import('../src/db.js');
  const { readFileSync } = await import('node:fs');
  const sql = readFileSync(new URL('../migrations/031_teacher_classroom.sql', import.meta.url), 'utf8');
  await pool.query(sql); // second application (migrate.js already ran it once)
  await pool.query(sql); // third, for good measure — still ×2 idempotent
  const reg = await pool.query(`SELECT count(*)::int AS n FROM app.plugins WHERE plugin_id='teacher.classroom'`);
  const contracts = await pool.query(`SELECT count(*)::int AS n FROM app.capability_contracts WHERE plugin_id='teacher.classroom'`);
  const ledger = await pool.query(`SELECT count(*)::int AS n FROM app.audit_log WHERE record_ref='teacher-classroom@1'`);
  const users = await pool.query(`SELECT count(*)::int AS n FROM app.users WHERE email IN ('teacher2@meridian.edu','student2@meridian.edu')`);
  assert.equal(reg.rows[0].n, 1, 'registry row singleton');
  assert.equal(contracts.rows[0].n, 3, 'three capability contracts (homework/submission/staff.leave)');
  assert.equal(ledger.rows[0].n, 1, 'guarded ledger entry singleton');
  assert.equal(users.rows[0].n, 2, 'demo cast fixtures singleton');
});

test('RT-7 #3: cross-class submit refused — a grade-8 student cannot submit a grade-6 homework', async () => {
  const r = await app.inject({ method: 'POST', url: '/plugins/teacher.classroom/homework', headers: H(teacher.token),
    payload: { class_grade: '6', subject: 'Science', title: 'Cross-class gate probe', due_at: future(2) } });
  assert.equal(r.statusCode, 200, r.body);
  const hw6 = r.json().homeworkId;
  const s = await app.inject({ method: 'POST', url: `/plugins/teacher.classroom/homework/${hw6}/submit`, headers: H(student.token),
    payload: { content_type: 'text', content: 'wrong class' } });
  assert.equal(s.statusCode, 400, `cross-class submit refused (got ${s.statusCode}: ${s.body})`);
  assert.equal(s.json().error, 'This homework is for a different class');
  const view = await app.inject({ method: 'GET', url: `/plugins/teacher.classroom/homework/${hw6}`, headers: H(teacher.token) });
  assert.equal(view.statusCode, 200, view.body);
  assert.equal(view.json().submissions.length, 0, 'no submission row was created');
});
