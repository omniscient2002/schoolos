/* DAT-6 — the attendance register: a count is not evidence.

   The register said the register door logs only "N students on <date>". That answers "did anything happen",
   which is not the question an auditor, a parent complaint or a dispute asks. The per-student rows written here
   are the mutation record; this file pins them, and pins that a no-op re-submit is NOT recorded as a mutation.
*/
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const brief = (r) => `HTTP ${r.statusCode} ${String(r.body ?? '').slice(0, 160)}`;

describe('DAT-6 · attendance leaves per-student audit evidence', () => {
  let app; let pool; let principal; let tenantId; let students;
  const sql = (text, params) => pool.query(text, params);
  const rows = async (needle) => (await sql(
    `SELECT action, actor FROM app.audit_log WHERE tenant_id=$1 AND action ILIKE $2 ORDER BY created_at DESC`,
    [tenantId, `%${needle}%`])).rows;

  before(async () => {
    await setupTestDb();
    const { buildApp } = await import('../src/app.js');
    app = await buildApp({ logger: false });
    pool = (await import('../src/db.js')).pool;
    principal = await loginAs(app, 'principal@meridian.edu');
    tenantId = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
    // app.students has no `active` column — status is derived from enrolment (a retired student is one who left)
    students = (await sql(`SELECT id FROM app.students WHERE tenant_id=$1 ORDER BY created_at LIMIT 2`, [tenantId])).rows.map((r) => r.id);
    assert.equal(students.length, 2, 'fixture: two active students');
  });

  test('each marked student gets a row naming the change, and the old summary row is not the evidence', async () => {
    const date = '2031-03-04';
    await sql(`DELETE FROM app.attendance WHERE tenant_id=$1 AND school_date=$2::date`, [tenantId, date]);
    const before = (await rows('Attendance for')).length;
    const res = await app.inject({ method: 'POST', url: '/attendance/mark', headers: H(principal.token), payload: {
      date, marks: students.map((id) => ({ studentId: id, status: 'present' })) } });
    assert.equal(res.statusCode, 200, brief(res));

    const after = await rows('Attendance for');
    assert.equal(after.length, before + 2, `one row per changed student, not one per request: ${JSON.stringify(after.slice(0, 3))}`);
    for (const id of students) {
      const mine = after.filter((r) => r.action.includes(id));
      assert.equal(mine.length, 1, `the student ${id} is named in exactly one new row`);
      assert.match(mine[0].action, /recorded present/, 'and the row says what was recorded');
    }
    assert.ok(after[0].actor, 'the actor is on the row — "who" is half of what an audit row is for');
    assert.match(after[0].action, new RegExp(date), 'and the date it applies to, so a dispute can be answered');
  });

  test('a re-submit that changes nothing is not recorded as a mutation', async () => {
    const date = '2031-03-05';
    await sql(`DELETE FROM app.attendance WHERE tenant_id=$1 AND school_date=$2::date`, [tenantId, date]);
    const payload = { date, marks: students.map((id) => ({ studentId: id, status: 'present' })) };
    await app.inject({ method: 'POST', url: '/attendance/mark', headers: H(principal.token), payload });
    const first = (await rows('Attendance for')).length;

    const again = await app.inject({ method: 'POST', url: '/attendance/mark', headers: H(principal.token), payload });
    assert.equal(again.statusCode, 200, brief(again));
    assert.equal((await rows('Attendance for')).length, first,
      'a no-op re-submit adds nothing: the ledger records acts, not clicks');
  });

  test('changing one student\'s status adds exactly one row, and it names the transition', async () => {
    const date = '2031-03-06';
    await sql(`DELETE FROM app.attendance WHERE tenant_id=$1 AND school_date=$2::date`, [tenantId, date]);
    await app.inject({ method: 'POST', url: '/attendance/mark', headers: H(principal.token), payload: {
      date, marks: students.map((id) => ({ studentId: id, status: 'present' })) } });
    const before = (await rows('Attendance for')).length;

    const res = await app.inject({ method: 'POST', url: '/attendance/mark', headers: H(principal.token), payload: {
      date, marks: [{ studentId: students[0], status: 'absent' }, { studentId: students[1], status: 'present' }] } });
    assert.equal(res.statusCode, 200, brief(res));
    const after = await rows('Attendance for');
    assert.equal(after.length, before + 1, 'only the student who changed is recorded');
    assert.match(after[0].action, /present → absent/, 'and the row is a transition, not a snapshot');
    assert.ok(after[0].action.includes(students[0]), 'naming the student it applies to');
  });
});
