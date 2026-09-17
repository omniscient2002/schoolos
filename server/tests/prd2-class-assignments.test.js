/* PRD-2 — a teacher can mark their own class's register, and only their own.
 *
 * The register (P0): "Teachers cannot mark attendance, because there is no class-assignment model …
 * Teachers are 403'd from the register, so the single most-used daily workflow in any school requires a
 * coordinator to do it for every class."
 *
 * The code agreed, and said so out loud at `routes.js:442-451`: the only assignment-shaped surfaces that
 * existed (`app.timetable_slots`, `app.timetable_substitutions`) carry `teacher_name` but no grade/section
 * binding at all, so no query could ever answer "which classes does this teacher own". That comment is why
 * this fix is a migration (083) plus a door change, rather than a permission edit — asserting the authority
 * without the data is precisely what the blanket 403 was there to prevent.
 *
 * WHAT THIS FILE HAS TO PROVE, and the second and third matter as much as the first:
 *   1. a teacher CAN mark the register for a class they own — the feature now works;
 *   2. a teacher CANNOT mark another class, and the refusal is per-student, not a blanket denial that would
 *      also block a legitimate mixed-class admin action by the office;
 *   3. authority is not delegable by the teacher: they cannot assign themselves a class;
 *   4. the class of record is derived from the STUDENT ROWS, never from the request payload's opinion — a
 *      client that asserts "this is 8A" while sending another class's ids is the exact attack this stops.
 *
 * The last one is the reason the check is not simply "does the payload's grade/section match mine". It would
 * have passed every other test in this file.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';
import { istToday } from '../src/ist.js'; // DAT-7: the door defaults to the IST school day, not UTC

let app;
let principal, teacher, teacher2, studentUser;
let cls;   // { ownedGrade, ownedSection, otherGrade, otherSection }
let tenantId;
// Request helpers. `content-type: application/json` on a BODYLESS request makes Fastify try to parse an empty
// body and answer 400 {"error":"Unexpected end of JSON input"} — which is what my DELETE was hitting while I
// went hunting for a bug in the door. The door was right; the helper was lying about the request. So the
// content-type is attached only where a body is actually sent, and the helper is at module scope because a
// version defined inside `before()` is invisible to the tests.
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const inj = (opts, t) => app.inject({ ...opts, headers: { authorization: `Bearer ${t}`, ...(opts.payload ? { 'content-type': 'application/json' } : {}) } });

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.ready();
  principal = await loginAs(app, 'principal@meridian.edu');
  teacher = await loginAs(app, 'teacher@meridian.edu');
  teacher2 = await loginAs(app, 'teacher2@meridian.edu');

  const { pool } = await import('../src/db.js');
  // Pin the fixtures rather than inheriting whatever migration 083 seeded, so this test states its own
  // premise. Two DISTINCT classes, so "another class" is a real class and not a typo.
  const rows = (await pool.query(
    `SELECT grade, section, count(*)::int n FROM app.students
      WHERE status='active' GROUP BY 1,2 HAVING count(*) > 1 ORDER BY grade, section LIMIT 2`)).rows;
  assert.equal(rows.length, 2, 'the seed must provide at least two populated classes');
  cls = { ownedGrade: rows[0].grade, ownedSection: rows[0].section,
          otherGrade: rows[1].grade, otherSection: rows[1].section };

  // Retire every assignment for the two teachers, then assign exactly one class. Done through SQL (the door
  // under test is the assignment door itself, so using it here would make a failure ambiguous).
  // NOTE: `loginAs` returns a session, not a `tenantId` field — the first version of this read
  // `principal.tenantId`, which is `undefined`, so the assignment was written with a NULL tenant and the
  // "own class" test failed for a reason of my own making rather than because the door was wrong. The tenant
  // is resolved from the database, which is what every other test in this suite does.
  const t1row = (await pool.query(`SELECT id, tenant_id FROM app.users WHERE email='teacher@meridian.edu'`)).rows[0];
  tenantId = t1row.tenant_id;
  await pool.query(`UPDATE app.class_assignments SET active=false WHERE teacher_id=$1`, [t1row.id]);
  await pool.query(`INSERT INTO app.class_assignments (tenant_id, teacher_id, grade, section) VALUES ($1,$2,$3,$4)`,
    [tenantId, t1row.id, cls.ownedGrade, cls.ownedSection]);
  const seeded = (await pool.query(
    `SELECT count(*)::int n FROM app.class_assignments WHERE teacher_id=$1 AND active`, [t1row.id])).rows[0].n;
  assert.equal(seeded, 1, 'premise: the teacher must own exactly one class before the door is exercised');
});

after(async () => {
  const { pool } = await import('../src/db.js');
  await pool.end().catch(() => {});
});

const roster = async (grade, section) => {
  const { pool } = await import('../src/db.js');
  return (await pool.query(
    `SELECT id FROM app.students WHERE grade=$1 AND section=$2 AND status='active' ORDER BY admission_no LIMIT 3`,
    [grade, section])).rows.map((r) => r.id);
};

const mark = (token, ids) => app.inject({
  method: 'POST', url: '/attendance/mark', headers: H(token),
  payload: { marks: ids.map((studentId) => ({ studentId, status: 'present' })) },
});

describe('PRD-2 · a teacher owns a register, and the boundary is per-student', () => {
  test('a teacher marks their OWN class — the workflow the register said did not exist', async () => {
    const ids = await roster(cls.ownedGrade, cls.ownedSection);
    const res = await mark(teacher.token, ids);
    assert.equal(res.statusCode, 200, `own class must be markable: ${res.body}`);
    assert.equal(res.json().marked, ids.length);

    const { pool } = await import('../src/db.js');
    const today = istToday();
    const written = (await pool.query(
      `SELECT count(*)::int n FROM app.attendance
        WHERE student_id = ANY($1::uuid[]) AND school_date = $2::date AND status='present'`,
      [ids, today])).rows[0].n;
    assert.equal(written, ids.length,
      'the marks must actually be persisted for TODAY at the status sent, not merely accepted. (Asserting an '
      + 'absolute row count instead would re-test the seed: the test database already holds attendance for '
      + 'these students from the seed, so the absolute figure is not this door\'s to explain.)');
  });

  test('a teacher is REFUSED for another class, and told which class is theirs', async () => {
    const ids = await roster(cls.otherGrade, cls.otherSection);
    const res = await mark(teacher.token, ids);
    assert.equal(res.statusCode, 403, `another class must be refused: ${res.body}`);
    const msg = res.json().error;
    assert.match(msg, /your own class/i, `the refusal must say why: ${msg}`);
    assert.match(msg, new RegExp(cls.otherGrade + '-' + cls.otherSection),
      `the refusal must name the offending class: ${msg}`);
    assert.match(msg, new RegExp(cls.ownedGrade + '-' + cls.ownedSection),
      `and it must tell the teacher which class IS theirs, or the 403 is a dead end: ${msg}`);
  });

  test('a MIXED submission is refused whole — no partial write of the owned students', async () => {
    // The dangerous half-implementation accepts the rows the teacher owns and silently drops the rest, which
    // is a register that looks marked and is not. All-or-nothing is the only honest behaviour.
    const mine = await roster(cls.ownedGrade, cls.ownedSection);
    const theirs = await roster(cls.otherGrade, cls.otherSection);
    const res = await mark(teacher.token, [...mine, ...theirs]);
    assert.equal(res.statusCode, 403, `a mixed submission must be refused: ${res.body}`);

    const { pool } = await import('../src/db.js');
    // Assert on what the door actually writes. `app.audit_log` stores the record as a uuid COLUMN named
    // `record_id` is NOT guaranteed either, so this asserts the register itself did not move for the ids the
    // teacher does not own — which is the harm being prevented (a partially-written register that looks
    // marked).
    const today = istToday();
    const snap = async () => (await pool.query(
      `SELECT count(*)::int n FROM app.attendance WHERE student_id = ANY($1::uuid[]) AND school_date=$2::date`,
      [theirs, today])).rows[0].n;
    const before = await snap();
    const mixed = await mark(teacher.token, [...mine, ...theirs]);
    assert.equal(mixed.statusCode, 403);
    const after = await snap();
    assert.equal(after, before,
      'a refused mixed submission must not write ANY rows — accepting the owned students and dropping the rest '
      + 'produces a register that looks marked and is not');
  });

  test('the class of record comes from the STUDENT rows, not from the request payload', async () => {
    // THE ASSERTION THAT MATTERS. Owned class ids, but the payload claims the other class. If the check ever
    // reads the payload's grade/section instead of resolving the students, this passes and everything above
    // still passes — which is exactly how such a bug ships.
    const ids = await roster(cls.ownedGrade, cls.ownedSection);
    const res = await app.inject({
      method: 'POST', url: '/attendance/mark', headers: H(teacher.token),
      payload: { grade: cls.otherGrade, section: cls.otherSection,
                 marks: ids.map((studentId) => ({ studentId, status: 'present' })) },
    });
    // Either answer is acceptable ONLY if the students were what decided it: the write must be authorised on
    // the students' real class. What must NOT happen is a 200 for ids the teacher does not own.
    if (res.statusCode === 200) {
      const { pool } = await import('../src/db.js');
      const wrong = (await pool.query(
        `SELECT count(*)::int n FROM app.attendance a JOIN app.students s ON s.id = a.student_id
          WHERE a.student_id = ANY($1::uuid[]) AND (s.grade, s.section) <> ($2,$3)`,
        [ids, cls.ownedGrade, cls.ownedSection])).rows[0].n;
      assert.equal(wrong, 0, 'a 200 must never cover a student outside the caller\'s own class');
    } else {
      assert.equal(res.statusCode, 403);
    }
    // And the inverse: claiming to be the OWNER of the other class must not grant it.
    const theirs = await roster(cls.otherGrade, cls.otherSection);
    const spoof = await app.inject({
      method: 'POST', url: '/attendance/mark', headers: H(teacher.token),
      payload: { grade: cls.ownedGrade, section: cls.ownedSection,
                 marks: theirs.map((studentId) => ({ studentId, status: 'present' })) },
    });
    assert.equal(spoof.statusCode, 403,
      'a payload that claims the caller\'s own class while carrying another class\'s students must be refused');
  });

  test('a teacher with NO assignment is refused, with a message that says what to do', async () => {
    const { pool } = await import('../src/db.js');
    const t2 = (await pool.query(`SELECT id FROM app.users WHERE email='teacher2@meridian.edu'`)).rows[0].id;
    await pool.query(`UPDATE app.class_assignments SET active=false WHERE teacher_id=$1`, [t2]);
    const ids = await roster(cls.ownedGrade, cls.ownedSection);
    const res = await mark(teacher2.token, ids);
    assert.equal(res.statusCode, 403, `unassigned teacher must be refused: ${res.body}`);
    assert.match(res.json().error, /assign|administrator/i,
      `the message must tell them how to become able to mark, not just refuse: ${res.body}`);
  });
});

describe('PRD-2 · assignment is an administrative act, and the door is audited', () => {
  test('the principal assigns a class, and the teacher can then mark it', async () => {
    const { pool } = await import('../src/db.js');
    const t2 = (await pool.query(`SELECT id FROM app.users WHERE email='teacher2@meridian.edu'`)).rows[0].id;
    const res = await app.inject({
      method: 'POST', url: '/class-assignments', headers: H(principal.token),
      payload: { teacherId: t2, grade: cls.otherGrade, section: cls.otherSection },
    });
    assert.equal(res.statusCode, 200, `principal must be able to assign: ${res.body}`);
    const ids = await roster(cls.otherGrade, cls.otherSection);
    const now = await mark(teacher2.token, ids);
    assert.equal(now.statusCode, 200, `the assigned teacher must now be able to mark: ${now.body}`);
  });

  test('a TEACHER cannot assign themselves a class — authority is not delegable', async () => {
    const { pool } = await import('../src/db.js');
    const tid = (await pool.query(`SELECT id FROM app.users WHERE email='teacher@meridian.edu'`)).rows[0].id;
    const res = await app.inject({
      method: 'POST', url: '/class-assignments', headers: H(teacher.token),
      payload: { teacherId: tid, grade: '11', section: 'Z' },
    });
    assert.equal(res.statusCode, 403, `self-assignment must be refused: ${res.body}`);
    const n = (await pool.query(
      `SELECT count(*)::int n FROM app.class_assignments WHERE grade='11' AND section='Z'`)).rows[0].n;
    assert.equal(n, 0, 'and nothing may have been written');
  });

  test('assigning a class takes it from the previous holder, and records the handover', async () => {
    const { pool } = await import('../src/db.js');
    const t2 = (await pool.query(`SELECT id FROM app.users WHERE email='teacher2@meridian.edu'`)).rows[0].id;
    // teacher2 currently owns otherGrade; hand it to teacher instead
    const t1 = (await pool.query(`SELECT id FROM app.users WHERE email='teacher@meridian.edu'`)).rows[0].id;
    const res = await app.inject({
      method: 'POST', url: '/class-assignments', headers: H(principal.token),
      payload: { teacherId: t1, grade: cls.otherGrade, section: cls.otherSection },
    });
    assert.equal(res.statusCode, 200, res.body);
    // "one owner per class" is the invariant: exactly one ACTIVE row for that class
    const active = (await pool.query(
      `SELECT teacher_id FROM app.class_assignments WHERE grade=$1 AND section=$2 AND active`,
      [cls.otherGrade, cls.otherSection])).rows;
    assert.equal(active.length, 1, `exactly one active owner per class, found ${active.length}`);
    assert.equal(active[0].teacher_id, t1, 'and it must be the new holder');
    const audit = (await pool.query(
      `SELECT count(*)::int n FROM app.audit_log WHERE action LIKE 'Class %reassigned%'`)).rows[0].n;
    assert.ok(audit >= 1, 'a handover must be audited — it changes who may write the register');
  });

  test('retiring an assignment reverts the class to the principal office', async () => {
    const { pool } = await import('../src/db.js');
    // Establish the precondition HERE rather than inheriting it from the previous test — this test is about
    // retiring an assignment, not about the order the file happens to run in.
    const t1 = (await pool.query(`SELECT id FROM app.users WHERE email='teacher@meridian.edu'`)).rows[0].id;
    await pool.query(`UPDATE app.class_assignments SET active=false WHERE grade=$1 AND section=$2`,
      [cls.otherGrade, cls.otherSection]);
    await pool.query(`INSERT INTO app.class_assignments (tenant_id, teacher_id, grade, section) VALUES ($1,$2,$3,$4)`,
      [tenantId, t1, cls.otherGrade, cls.otherSection]);
    const a = (await pool.query(
      `SELECT id FROM app.class_assignments WHERE grade=$1 AND section=$2 AND active`,
      [cls.otherGrade, cls.otherSection])).rows[0];
    assert.ok(a, 'precondition: the class must have an active owner before it can be retired');
    const res = await inj({ method: 'DELETE', url: `/class-assignments/${a.id}` }, principal.token);
    assert.equal(res.statusCode, 200, res.body);
    const ids = await roster(cls.otherGrade, cls.otherSection);
    const after = await mark(teacher.token, ids);
    assert.equal(after.statusCode, 403, 'once retired, the teacher must lose the register');
    // and it is retired, not deleted — the history of who held it must survive
    const gone = (await pool.query(`SELECT active FROM app.class_assignments WHERE id=$1`, [a.id])).rows[0];
    assert.ok(gone, 'the row must still exist');
    assert.equal(gone.active, false, 'retired, not deleted: the record of who held the register survives');
  });

  test('a teacher cannot assign to a non-teacher account', async () => {
    const { pool } = await import('../src/db.js');
    const s = (await pool.query(`SELECT id FROM app.users WHERE role='student' LIMIT 1`)).rows[0].id;
    const res = await app.inject({
      method: 'POST', url: '/class-assignments', headers: H(principal.token),
      payload: { teacherId: s, grade: '12', section: 'A' },
    });
    assert.equal(res.statusCode, 404, `a student is not a class owner: ${res.body}`);
    assert.match(res.json().error, /not a teacher/i);
  });
});

describe('PLGX-2 · the ops.timetable autofill door honours the same class ownership', () => {
  // The kernel register door binds a teacher to app.class_assignments (PRD-2/083). The plugin's
  // attendance/autofill surface accepts a body-supplied grade/section, so without the same check it
  // re-opens the bypass the kernel closed. This establishes its own precondition rather than inheriting
  // the order of the describes above.
  const autofill = (token, payload) => app.inject({
    method: 'POST', url: '/plugins/ops.timetable/attendance/autofill', headers: H(token), payload,
  });

  before(async () => {
    const { pool } = await import('../src/db.js');
    await pool.query(`UPDATE app.plugins SET status='enabled', updated_at=now() WHERE tenant_id=$1 AND plugin_id='ops.timetable'`, [tenantId]);
    const t1 = (await pool.query(`SELECT id FROM app.users WHERE email='teacher@meridian.edu'`)).rows[0].id;
    await pool.query(`UPDATE app.class_assignments SET active=false WHERE teacher_id=$1`, [t1]);
    await pool.query(`INSERT INTO app.class_assignments (tenant_id, teacher_id, grade, section) VALUES ($1,$2,$3,$4)`,
      [tenantId, t1, cls.ownedGrade, cls.ownedSection]);
  });

  test('teacher may autofill their own class; another class and a bad date are refused', async () => {
    const today = istToday();
    const own = await autofill(teacher.token, { date: today, grade: cls.ownedGrade, section: cls.ownedSection });
    assert.equal(own.statusCode, 200, `own class must autofill: ${own.body}`);
    const other = await autofill(teacher.token, { date: today, grade: cls.otherGrade, section: cls.otherSection });
    assert.equal(other.statusCode, 403, `another class must be refused: ${other.body}`);
    assert.match(other.json().error, /assigned to you/i);
    const bad = await autofill(teacher.token, { date: '2026/01/01', grade: cls.ownedGrade, section: cls.ownedSection });
    assert.equal(bad.statusCode, 400, 'a malformed date must be refused, not 500');
    // the principal's office may autofill any class
    const office = await autofill(principal.token, { date: today, grade: cls.otherGrade, section: cls.otherSection });
    assert.equal(office.statusCode, 200, `the office may autofill any class: ${office.body}`);
  });
});
