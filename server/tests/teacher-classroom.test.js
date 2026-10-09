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

  // DEL-3: an approved leave carries a generated handover packet (substitute + periods).
  const approvedReq = mine1.json().requests.find((l) => l.id === leave1.requestId);
  assert.ok(approvedReq.handover, 'the approved request carries a handover packet');
  assert.ok(Array.isArray(approvedReq.handover.classes), 'the packet lists the affected periods');
  const pendingReq = mine1.json().requests.find((l) => l.id === leave2.requestId);
  assert.equal(pendingReq.handover, null, 'an undecided request has no handover');

  // ── DAT-6: the projection above CHANGED the leave record (pending → approved) and it did so inside
  // a GET, writing no ledger row — so "who changed this leave request, when, and on what authority" had
  // no answer in the ledger. It is now recorded, ONCE PER REAL TRANSITION.
  const projected = await pool.query(
    `SELECT outcome, risk, actor, record_type FROM app.audit_log
      WHERE action='Leave decision projected onto request' AND record_ref=$1
      ORDER BY created_at DESC, ctid DESC`, [leave1.requestId]);
  assert.equal(projected.rows.length, 1,
    'THE REGRESSION GATE: the pending→approved transition must be recorded exactly once');
  assert.match(projected.rows[0].outcome, /set to "approved"/, 'the row must name the state it moved to');
  assert.equal(projected.rows[0].risk, 'medium');
  assert.equal(projected.rows[0].record_type, 'LeaveRequest');

  // The mirror runs on every poll of the leave screen. A repeated GET changes nothing, so it must
  // record nothing — otherwise the ledger fills with one row per page load and the real transition
  // becomes unfindable. This pins the rowCount guard, not just the presence of the audit call.
  const mine2 = await app.inject({ method: 'GET', url: '/teacher/leave/mine', headers: H(teacher.token) });
  assert.equal(mine2.statusCode, 200);
  const again = await pool.query(
    `SELECT count(*)::int AS n FROM app.audit_log
      WHERE action='Leave decision projected onto request' AND record_ref=$1`, [leave1.requestId]);
  assert.equal(again.rows[0].n, 1, 'a repeated GET is a no-op and must NOT inflate the ledger');

  // the dismissal direction is a different branch and gets its own row, with its own wording
  const dismiss = await app.inject({ method: 'POST', url: `/actions/${leave2.actionId}/decide`, headers: H(coordinator.token),
    payload: { decision: 'dismissed', note: 'clashes with exam week' } });
  assert.equal(dismiss.statusCode, 200, dismiss.body);
  await app.inject({ method: 'GET', url: '/teacher/leave/mine', headers: H(teacher.token) });
  const rejRow = await pool.query(
    `SELECT outcome FROM app.audit_log
      WHERE action='Leave decision projected onto request' AND record_ref=$1
      ORDER BY created_at DESC, ctid DESC`, [leave2.requestId]);
  assert.equal(rejRow.rows.length, 1);
  assert.match(rejRow.rows[0].outcome, /set to "rejected"/,
    'a DISMISSED kernel decision projects to a REJECTED leave row — the ledger must say so');
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

// ── the 082 FK regression: `student_id` must hold an app.students id, not the submitter's user id ──
// These pin the WRITE side of the contract directly. The round-trip tests above prove the teacher can
// read the row back; they cannot tell a roster id from a user id, because the pre-082 read path
// joined `app.users` and would happily name a user-keyed row. The FK is the structural truth, so it
// is asserted where it lives. Before the fix these fail with 500 (Postgres 23503 escaping the door,
// which only catches the 23505 duplicate).

test('FK pin: the stored student_id IS an app.students id of the signed-in student', async () => {
  const { pool } = await import('../src/db.js');
  const row = (await pool.query(
    `SELECT s.student_id, st.id AS roster_id, st.name AS roster_name, su.id AS user_id, su.name AS user_name
     FROM teacher.submission s
     LEFT JOIN app.students st ON st.id = s.student_id AND st.tenant_id = s.tenant_id
     LEFT JOIN app.users    su ON su.id = s.student_id AND su.tenant_id = s.tenant_id
     WHERE s.id = $1`, [subId])).rows[0];
  assert.ok(row, 'the submission from the earlier test is on file');
  // the composite FK (tenant_id, student_id) → app.students(tenant_id, id) is what 082 added; this
  // join resolving to a roster row is the same predicate Postgres enforces on insert.
  assert.equal(row.roster_id, row.student_id, 'student_id joins app.students — it is a roster id');
  assert.equal(row.roster_name, 'Diya Nair');
  // and it is NOT the submitting user's id (the bug: `req.user.id` written here)
  const who = (await pool.query(`SELECT id, name FROM app.users WHERE email='student2@meridian.edu'`)).rows[0];
  assert.notEqual(row.student_id, who.id, 'student_id must never be the submitting USER id');
  assert.equal(row.user_id, null, 'student_id does not resolve as a user id');
  assert.equal(who.name, 'Diya Nair', 'the user and roster row share a name — which is why the name match works');
});

test('a submitter whose login matches NO roster student is a clean 4xx, never a 500', async () => {
  const { pool } = await import('../src/db.js');
  const { hashPassword } = await import('../src/auth.js');
  // A distinctive name guarantees no roster match — the point of the case is that the SIGNED-IN user
  // exists (so auth passes) while no app.students row can be resolved for them. Guarded so the test
  // would fail loudly rather than silently stop testing anything if the seed ever contains it.
  const NAME = 'Qq Unlinked Probe';
  const existing = (await pool.query(
    `SELECT count(*)::int AS n FROM app.students WHERE lower(name)=lower($1)`, [NAME])).rows[0].n;
  assert.equal(existing, 0, 'probe name must not collide with the seeded roster');
  const tenantId = (await pool.query(`SELECT tenant_id FROM app.users WHERE email='owner@meridian.edu'`)).rows[0].tenant_id;
  const u = (await pool.query(
    `INSERT INTO app.users (tenant_id, email, name, role, password_hash) VALUES ($1,$2,$3,'student',$4) RETURNING id`,
    [tenantId, 'unlinked.student@meridian.edu', NAME, hashPassword('schoolos-demo')])).rows[0];

  const hw = await app.inject({ method: 'POST', url: '/plugins/teacher.classroom/homework', headers: H(teacher.token),
    payload: { class_grade: '8', subject: 'Biology', title: 'Unlinked submitter probe', due_at: future(2) } });
  assert.equal(hw.statusCode, 200, hw.body);
  const hwUnlinked = hw.json().homeworkId;

  const unlinked = await loginAs(app, 'unlinked.student@meridian.edu');
  const before = (await pool.query(`SELECT count(*)::int AS n FROM teacher.submission WHERE homework_id=$1`, [hwUnlinked])).rows[0].n;

  const r = await app.inject({ method: 'POST', url: `/plugins/teacher.classroom/homework/${hwUnlinked}/submit`, headers: H(unlinked.token),
    payload: { content_type: 'text', content: 'work by an account with no roster row' } });

  // ── THE REGRESSION GATE ── the old code wrote the user id straight into the FK column, so this
  // came back 500 {"error":"internal error"} with the audit row unreachable. A data problem the
  // school must see has to be reported as one.
  assert.notEqual(r.statusCode, 500, `a resolvable-student failure must not be an internal error: ${r.body}`);
  assert.ok(r.statusCode >= 400 && r.statusCode < 500, `clean 4xx expected, got ${r.statusCode}: ${r.body}`);
  assert.equal(r.statusCode, 409);
  assert.match(r.json().error, /isn't linked to a student/,
    'the message must say the LOGIN is unlinked, not that the homework is missing');
  assert.match(r.json().error, /school office/);
  const after = (await pool.query(`SELECT count(*)::int AS n FROM teacher.submission WHERE homework_id=$1`, [hwUnlinked])).rows[0].n;
  assert.equal(after, before, 'no submission row is written when no student can be resolved');
  assert.equal(after, 0, 'and nothing was filed against the unlinked account');
  // the account is real and the failure is about the ROSTER link, not about the homework
  assert.ok(u.id, 'the unlinked user exists');
});

test('the door files work against the SUBMITTER\'S OWN roster row — no body override, no cross-student write', async () => {
  const { pool } = await import('../src/db.js');
  const other = (await pool.query(
    `SELECT id, name FROM app.students
      WHERE grade='8' AND lower(name) <> lower('Diya Nair')
      ORDER BY admission_no ASC, id ASC LIMIT 1`)).rows[0];
  assert.ok(other, 'a roster student other than the submitter exists in grade 8');
  const hw = await app.inject({ method: 'POST', url: '/plugins/teacher.classroom/homework', headers: H(teacher.token),
    payload: { class_grade: '8', subject: 'History', title: 'Identity spoof probe', due_at: future(2) } });
  const hwSpoof = hw.json().homeworkId;
  // a student cannot choose whose submission this is: the body carries another student's id and name
  const r = await app.inject({ method: 'POST', url: `/plugins/teacher.classroom/homework/${hwSpoof}/submit`, headers: H(student.token),
    payload: { content_type: 'text', content: 'filed as me',
               student_id: other.id, studentId: other.id, name: other.name } });
  assert.equal(r.statusCode, 200, r.body);
  const row = (await pool.query(
    `SELECT s.student_id, st.name AS roster_name FROM teacher.submission s
     LEFT JOIN app.students st ON st.id = s.student_id AND st.tenant_id = s.tenant_id
     WHERE s.id=$1`, [r.json().submissionId])).rows[0];
  assert.equal(row.roster_name, 'Diya Nair', 'the row is filed against the SIGNED-IN student');
  assert.notEqual(row.student_id, other.id, 'the body cannot re-point the submission at another student');
});

test('GET /teacher/home → command-center aggregate (now/next/needsAttention/glance/suggestions)', async () => {
  const r = await app.inject({ method: 'GET', url: '/teacher/home', headers: H(teacher.token) });
  assert.equal(r.statusCode, 200, r.body);
  const agg = r.json();
  for (const k of ['now', 'next', 'needsAttention', 'glance', 'suggestions']) assert.ok(k in agg, `${k} present`);
  assert.ok(Array.isArray(agg.next) && Array.isArray(agg.needsAttention) && Array.isArray(agg.suggestions));
  assert.equal(typeof agg.glance.periods, 'number');
  assert.ok(agg.needsAttention.some((n) => n.kind === 'submission'), 'pending submission surfaced as a need');
  assert.ok(agg.suggestions.length >= 1, 'a suggestion is offered when work is waiting');
});

test('submissions inbox contract: rows carry id/homework_title/content_ref; state defaults to all', async () => {
  const all = await app.inject({ method: 'GET', url: '/plugins/teacher.classroom/submissions', headers: H(teacher.token) });
  assert.equal(all.statusCode, 200, all.body);
  const rows = all.json().submissions;
  assert.ok(rows.length >= 1, 'default (all) view returns rows');
  const row = rows.find((s) => s.id === subId);
  assert.ok(row, 'the UI `id` field is present on submitted rows');
  assert.equal(row.submission_id, subId, 'submission_id kept for the existing pins');
  assert.ok(row.homework_title, 'homework_title present');
  assert.ok('content_ref' in row && 'content_type' in row, 'work columns present');
});

test('missing view rows carry a stable id + status so the inbox does not crash', async () => {
  const r = await app.inject({ method: 'GET', url: '/plugins/teacher.classroom/submissions?state=missing', headers: H(teacher.token) });
  assert.equal(r.statusCode, 200, r.body);
  for (const s of r.json().submissions) {
    assert.equal(s.status, 'missing');
    assert.ok(typeof s.id === 'string' && s.id.length > 0, 'stable id present');
    assert.equal(s.content_type, 'text', 'renderable content_type');
  }
});

/* ── PERFECT-100 hardening pins (TEST-1, API-8) ─────────────────────────────── */

test('attachment hardening: javascript:/data:/protocol-relative refused, plain name accepted', async () => {
  const post = (attachment) => app.inject({ method: 'POST', url: '/plugins/teacher.classroom/homework', headers: H(teacher.token),
    payload: { class_grade: '8', subject: 'Maths', title: `attach-${Math.random().toString(36).slice(2, 8)}`, due_at: future(2), attachment } });
  assert.equal((await post('javascript:alert(1)')).statusCode, 400, 'javascript: scheme refused');
  assert.equal((await post('data:text/html,<script>1</script>')).statusCode, 400, 'data: scheme refused');
  assert.equal((await post('//evil.example/x')).statusCode, 400, 'protocol-relative refused');
  assert.equal((await post('worksheet.pdf')).statusCode, 200, 'a plain file name is allowed');
  assert.equal((await post('https://example.com/worksheet.pdf')).statusCode, 200, 'an https link is allowed');
});

test('review can request a resubmission (resubmit_requested) and it is reflected on the row', async () => {
  const r = await app.inject({ method: 'POST', url: `/plugins/teacher.classroom/submissions/${subId}/review`,
    headers: H(teacher.token), payload: { status: 'resubmit_requested', feedback: 'Please redo question 3' } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().status, 'resubmit_requested');
});

test('homework list honours the ?class= filter (API-8)', async () => {
  const r = await app.inject({ method: 'GET', url: '/plugins/teacher.classroom/homework?class=8', headers: H(teacher.token) });
  assert.equal(r.statusCode, 200, r.body);
  for (const h of r.json().homework) assert.equal(h.class_grade, '8', 'only the requested class is returned');
});

/* ── PRD-2/PRD-3 new-door pins (lessons, duty, workload, roster) ─────────────── */

test('lessons: create → list → reflect (append-only reflection)', async () => {
  const create = await app.inject({ method: 'POST', url: '/plugins/teacher.classroom/lessons', headers: H(teacher.token),
    payload: { class_grade: '8', subject: 'Mathematics', lesson_date: '2026-09-20', topic: 'Equivalent fractions', objectives: ['Explain equivalence'] } });
  assert.equal(create.statusCode, 200, create.body);
  const id = create.json().lessonId;
  const list = await app.inject({ method: 'GET', url: '/plugins/teacher.classroom/lessons?date=2026-09-20', headers: H(teacher.token) });
  assert.equal(list.statusCode, 200, list.body);
  assert.ok(list.json().lessons.some((l) => l.id === id), 'the lesson is listed for its date');
  const refl = await app.inject({ method: 'POST', url: `/plugins/teacher.classroom/lessons/${id}/reflect`, headers: H(teacher.token),
    payload: { worked: 'Worked example landed', next: 'Word problems' } });
  assert.equal(refl.statusCode, 200, refl.body);
  assert.equal(refl.json().status, 'reflected');
  assert.equal((await app.inject({ method: 'POST', url: `/plugins/teacher.classroom/lessons/${id}/reflect`, headers: H(teacher.token), payload: {} })).statusCode, 400);
});

test('duty roster + my workload return the fairness shape (PRD-3)', async () => {
  const duty = await app.inject({ method: 'GET', url: '/duty/roster?window=week', headers: H(teacher.token) });
  assert.equal(duty.statusCode, 200, duty.body);
  assert.equal(duty.json().window, 'week');
  assert.ok(Array.isArray(duty.json().duties));
  const wl = await app.inject({ method: 'GET', url: '/workload/mine', headers: H(teacher.token) });
  assert.equal(wl.statusCode, 200, wl.body);
  const w = wl.json().workload;
  assert.equal(typeof w.periods, 'number');
  assert.ok(w.fair_band && typeof w.fair_band.min === 'number' && typeof w.fair_band.max === 'number');
  assert.equal(typeof w.overload, 'boolean');
  assert.ok(!('rank' in w) && !('score' in w), 'workload is never a rank or a score');
});

test('teacher roster is scoped to assigned classes and refuses students/parents', async () => {
  const r = await app.inject({ method: 'GET', url: '/plugins/teacher.classroom/roster', headers: H(teacher.token) });
  assert.equal(r.statusCode, 200, r.body);
  assert.ok(Array.isArray(r.json().students));
  assert.equal((await app.inject({ method: 'GET', url: '/plugins/teacher.classroom/roster', headers: H(student.token) })).statusCode, 403);
});

test('F-16 · bound pupil account submits against its own roster row (structural identity, not name)', async () => {
  const { pool } = await import('../src/db.js');
  const tenant = (await pool.query(`SELECT tenant_id FROM app.users WHERE email='owner@meridian.edu'`)).rows[0].tenant_id;
  const stu = (await pool.query(`SELECT id FROM app.users WHERE tenant_id=$1 AND email='student2@meridian.edu'`, [tenant])).rows[0];
  const diyas = (await pool.query(`SELECT id, section, admission_no FROM app.students WHERE tenant_id=$1 AND lower(name)='diya nair' AND grade='8' AND status='active' ORDER BY admission_no`, [tenant])).rows;
  assert.ok(diyas.length >= 2, 'seed carries same-name Diyas in grade 8');
  // bind to the LAST namesake — the name path would have picked the FIRST
  const bound = diyas[diyas.length - 1];
  await pool.query(`UPDATE app.students SET user_id=$2 WHERE tenant_id=$1 AND id=$3`, [tenant, stu.id, bound.id]);
  const mk = await app.inject({ method: 'POST', url: '/plugins/teacher.classroom/homework', headers: H(teacher.token),
    payload: { class_grade: '8', subject: 'Mathematics', title: 'F-16 structural submit', due_at: future(2) } });
  assert.equal(mk.statusCode, 200, mk.body);
  const hw = mk.json().homeworkId;
  const r = await app.inject({ method: 'POST', url: `/plugins/teacher.classroom/homework/${hw}/submit`, headers: H(student.token),
    payload: { content_type: 'text', content: 'bound submission' } });
  assert.equal(r.statusCode, 200, r.body);
  const sub = await pool.query(`SELECT student_id FROM teacher.submission WHERE id=$1`, [r.json().submissionId]);
  assert.equal(sub.rows[0].student_id, bound.id, 'submission filed against the bound row, not the lowest-admission_no namesake');
  // a bound pupil submitting to another grade's homework is refused as different-class
  const mk6 = await app.inject({ method: 'POST', url: '/plugins/teacher.classroom/homework', headers: H(teacher.token),
    payload: { class_grade: '6', subject: 'Mathematics', title: 'F-16 wrong grade', due_at: future(2) } });
  assert.equal(mk6.statusCode, 200, mk6.body);
  const wrong = await app.inject({ method: 'POST', url: `/plugins/teacher.classroom/homework/${mk6.json().homeworkId}/submit`, headers: H(student.token),
    payload: { content_type: 'text', content: 'should not file' } });
  assert.equal(wrong.statusCode, 400, wrong.body);
  assert.equal(wrong.json().error, 'This homework is for a different class');
});
