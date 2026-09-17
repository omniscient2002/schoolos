/* RBAC-2 — the counsellor is a real role, and the safeguarding gates are tiered.
 *
 * THE DEFECT (register §5, P1): `'counselor'` appeared in five gate lists across `teacher.support`,
 * `student.world` and the client's own `WellbeingQueue` STAFF_ROLES — but it was NOT in `auth.js` ROLES and
 * was barred as a custom-role `base_role`. So the safeguarding surfaces (the product's most sensitive) could
 * never have a dedicated role: the person doing that work had to hold `coordinator` or `itadmin`, inheriting
 * finance reads, `/audit`, clinic authority and `POST /memory` with it. Two shipped screens already
 * authorised a role the server refused to issue.
 *
 * The tests below fail on the defect: creating a `counselor` through the people console answered
 * "role must be one of …" and the wellbeing plane refused the one person it names.
 *
 * WHAT IS PINNED:
 *   1. `counselor` is issuable (13 roles) — through the real door, not by direct SQL.
 *   2. That counsellor reaches the surfaces the product promises a counsellor (wellbeing plane, the
 *      concerns board as OVERSIGHT, the child-protection box) and is refused the ones they must not have
 *      (the full fee ledger, the audit ledger).
 *   3. The safety box is readable by the SAFEGUARDING tier only: a finance user, admitted before, is now
 *      refused — least privilege on a child's protection record.
 *   4. A teacher keeps own-scope on the concerns board (filing is theirs; the board is not).
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';

let app;
let pool;
let owner;
let tenantId;
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const brief = (r) => `HTTP ${r.statusCode} ${String(r.body ?? '').slice(0, 180)}`;
const sql = (text, params) => pool.query(text, params);
const COUNSELOR = 'counsellor.accept@meridian.edu';

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  pool = (await import('../src/db.js')).pool;
  owner = await loginAs(app, 'owner@meridian.edu');
  tenantId = (await sql(`SELECT id FROM app.tenants ORDER BY created_at LIMIT 1`)).rows[0].id;
  // the plugin doors need their modules on, exactly as a school switches them on
  for (const id of ['people.admin', 'teacher.support', 'student.world']) {
    const r = await app.inject({ method: 'POST', url: `/plugins/${id}/enable`, headers: H(owner.token), payload: { class: 'C', version: '1.0.0' } });
    assert.ok([200, 409].includes(r.statusCode), `could not enable ${id}: ${brief(r)}`);
  }
});

after(async () => { await app?.close(); });

describe('RBAC-2 · the counsellor role exists', () => {
  test('the server publishes 13 roles and issues `counselor` through the people console', async () => {
    const { ROLES } = await import('../src/auth.js');
    assert.equal(ROLES.length, 13, `docs publish 13 roles; the code must agree: ${ROLES.join(', ')}`);
    assert.ok(ROLES.includes('counselor'), 'counselor is one of them');

    const created = await app.inject({ method: 'POST', url: '/plugins/people.admin/users', headers: H(owner.token), payload: {
      name: 'Anita Rao', email: COUNSELOR, role: 'counselor', password: 'schoolos-counsellor-1' } });
    assert.equal(created.statusCode, 200, `a school must be able to appoint a counsellor: ${brief(created)}`);
    const row = (await sql(`SELECT role FROM app.users WHERE email=$1`, [COUNSELOR])).rows[0];
    assert.equal(row.role, 'counselor', 'and the row carries the real role, not a substitute');
  });

  test('`counselor` is a legal custom-role base, so a counsellor can be narrowed or widened like anyone else', async () => {
    const made = await app.inject({ method: 'POST', url: '/roles', headers: H(owner.token), payload: {
      key: 'counsellor-narrow', label: 'Counsellor (narrowed)', base_role: 'counselor',
      permissions: { allow: [], deny: ['GET /safety/box'] } } });
    assert.ok([200, 201].includes(made.statusCode), `counselor must be an assignable base_role: ${brief(made)}`);
  });

  test('the counsellor reaches the wellbeing plane and the concerns board AS OVERSIGHT', async () => {
    // a concern filed by somebody else: oversight is what decides whether the counsellor sees the board
    const teacher = await loginAs(app, 'teacher@meridian.edu');
    const filed = await app.inject({ method: 'POST', url: '/teacher/concern', headers: H(teacher.token), payload: {
      studentId: (await sql(`SELECT id FROM app.students WHERE tenant_id=$1 LIMIT 1`, [tenantId])).rows[0].id,
      category: 'academic', urgency: 'low', detail: 'Struggling with the new unit; asked for extra practice.' } });
    assert.ok([200, 201].includes(filed.statusCode), brief(filed));

    const counsellor = await loginAs(app, COUNSELOR, 'schoolos-counsellor-1');
    const board = await app.inject({ method: 'GET', url: '/teacher/concerns', headers: H(counsellor.token) });
    assert.equal(board.statusCode, 200, `the counsellor is the person this board is for: ${brief(board)}`);
    assert.equal(board.json().scope, 'oversight', 'the board is read AS OVERSIGHT, not as own-scope');
    assert.ok(board.json().concerns.some((c) => c.concernId === filed.json().concernId),
      'and it therefore contains a concern they did not file');

    const wellbeing = await app.inject({ method: 'GET', url: '/student/wellbeing', headers: H(counsellor.token) });
    assert.equal(wellbeing.statusCode, 200, `the module's own comment says this is the "counselor/principal plane": ${brief(wellbeing)}`);
  });

  test('the counsellor reads the ASSIGNED safeguarding queue — and not the whole school\'s protection record', async () => {
    const counsellor = await loginAs(app, COUNSELOR, 'schoolos-counsellor-1');
    // The door's own design, which this test pins rather than assumes: the FULL box is
    // owner/principal/itadmin; every other designated role reads only what is assigned to them. A counsellor
    // who could read the whole protection record would be a widening, not a fix.
    const assigned = await app.inject({ method: 'GET', url: '/safety/box?assigned=1', headers: H(counsellor.token) });
    assert.equal(assigned.statusCode, 200, `the assigned queue is the counsellor's working surface: ${brief(assigned)}`);
    assert.equal(assigned.json().scope, 'assigned_to_me', 'and it says so');
    const full = await app.inject({ method: 'GET', url: '/safety/box', headers: H(counsellor.token) });
    assert.equal(full.statusCode, 403, `the full box stays with the designated authority: ${brief(full)}`);
    const fees = await app.inject({ method: 'GET', url: '/fees/obligations', headers: H(counsellor.token) });
    assert.equal(fees.statusCode, 403, `a counsellor has no fee mandate — and must not inherit one: ${brief(fees)}`);
    const audit = await app.inject({ method: 'GET', url: '/audit', headers: H(counsellor.token) });
    assert.equal(audit.statusCode, 403, `nor the audit ledger: ${brief(audit)}`);
  });

  test('the safety box is now the safeguarding tier only — finance, transport and lab staff are refused', async () => {
    // Before RBAC-2 the box readers were "every staff role except teacher", so the school's finance officer,
    // admissions clerk, bus coordinator and lab assistant could all read a child's protection record.
    const finance = await loginAs(app, 'finance@meridian.edu');
    const r = await app.inject({ method: 'GET', url: '/safety/box', headers: H(finance.token) });
    assert.equal(r.statusCode, 403, `least privilege on a protection record: ${brief(r)}`);
    // and the principal's office still can — the narrowing must not close the door on the school's leaders
    const principal = await loginAs(app, 'principal@meridian.edu');
    const ok = await app.inject({ method: 'GET', url: '/safety/box', headers: H(principal.token) });
    assert.equal(ok.statusCode, 200, `the principal keeps full access: ${brief(ok)}`);
  });

  test('the assignable set IS the reader set — a report cannot be parked on someone who cannot open it', async () => {
    // Review round 20, P2: narrowing the READERS left the ASSIGNMENT filter at "any staff role except
    // teacher/parent/student", so a report could be assigned to the finance office, which is refused at the
    // gate on both the read and the close doors — an assignee who can never act, with the report marked
    // `assigned` and the audit row naming them. Both lists are now the same list.
    const principal = await loginAs(app, 'principal@meridian.edu');
    // a STUDENT files (that is this door's design: `require('student')` — the box is what a pupil uses to
    // report), the principal's office assigns it
    const student = await loginAs(app, 'student@meridian.edu');
    const filed = await app.inject({ method: 'POST', url: '/safety/box', headers: H(student.token), payload: {
      classGrade: '6', category: 'bullying', severity: 'high', detail: 'Assignment-alignment probe.', anonymous: false } });
    assert.ok([200, 201].includes(filed.statusCode), brief(filed));
    const reportId = filed.json().reportId;
    const financeId = (await sql(`SELECT id FROM app.users WHERE email='finance@meridian.edu'`)).rows[0].id;
    const toFinance = await app.inject({ method: 'POST', url: `/safety/box/${reportId}/assign`, headers: H(principal.token), payload: { assignedTo: financeId } });
    assert.equal(toFinance.statusCode, 400, `assigning to a role that cannot read the report must be refused: ${brief(toFinance)}`);
    assert.match(toFinance.json().error, /designated safeguarding roles/i);
    // and a reader CAN be assigned — the check must not be vacuous
    const counsellorId = (await sql(`SELECT id FROM app.users WHERE email=$1`, [COUNSELOR])).rows[0].id;
    const toCounsellor = await app.inject({ method: 'POST', url: `/safety/box/${reportId}/assign`, headers: H(principal.token), payload: { assignedTo: counsellorId } });
    assert.equal(toCounsellor.statusCode, 200, `a safeguarding role must be assignable: ${brief(toCounsellor)}`);
    const who = await loginAs(app, COUNSELOR, 'schoolos-counsellor-1');
    const queue = await app.inject({ method: 'GET', url: '/safety/box?assigned=1', headers: H(who.token) });
    assert.equal(queue.statusCode, 200, brief(queue));
    assert.ok(queue.json().reports.some((r) => r.reportId === reportId), 'the assignee can actually open what was assigned to them');
  });

  test('a teacher still files concerns and still sees only their own (the board stays closed)', async () => {
    const teacher = await loginAs(app, 'teacher@meridian.edu');
    const list = await app.inject({ method: 'GET', url: '/teacher/concerns', headers: H(teacher.token) });
    assert.equal(list.statusCode, 200, brief(list));
    const ids = list.json().concerns.map((c) => c.id);
    const others = (await sql(
      `SELECT count(*)::int AS n FROM teacher.concern WHERE tenant_id=$1 AND filed_by <> (SELECT id FROM app.users WHERE email='teacher@meridian.edu')`,
      [tenantId])).rows[0].n;
    if (others > 0) {
      const foreign = (await sql(
        `SELECT id FROM teacher.concern WHERE tenant_id=$1 AND filed_by <> (SELECT id FROM app.users WHERE email='teacher@meridian.edu') LIMIT 1`,
        [tenantId])).rows[0].id;
      assert.ok(!ids.includes(foreign), 'a teacher must not see a colleague\'s concern (own-scope, by rule)');
    }
  });
});
