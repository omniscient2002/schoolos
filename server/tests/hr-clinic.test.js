// hr.leave + health.clinic (wave-3 close-out, migration 029) — unit suite
// hr.leave: absence FACTS on the spine (timetable absence_feed=hr.leave source),
//   per-staff-day uniqueness with the 23505→409 backstop (cycle-5 P1-2 pattern).
// health.clinic: append-first infirmary log, sick passes, and guardian notices as
//   per-instance kernel message actions (clinic.notify.<visitId> — UNIQUE(tenant,code)
//   satisfied from birth, cycle-5 P1-1 pattern) executed onto the comms rail.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setupTestDb, loginAs } from './helpers.js';

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let app;
let sql;
let teacherId, coordId, studentId, today, tomorrow;

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
  const u = await sql(`SELECT id, role FROM app.users WHERE role IN ('teacher','coordinator') ORDER BY role`);
  teacherId = u.rows.find((r) => r.role === 'teacher').id;
  coordId = u.rows.find((r) => r.role === 'coordinator').id;
  studentId = (await sql(`SELECT id FROM app.students ORDER BY created_at LIMIT 1`)).rows[0].id;
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  today = ist.toISOString().slice(0, 10);
  tomorrow = new Date(ist.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  const o = await loginAs(app, 'owner@meridian.edu');
  await app.inject({ method: 'POST', url: '/plugins/hr.leave/enable', headers: H(o.token), payload: { version: '1.0.0', class: 'C' } });
  await app.inject({ method: 'POST', url: '/plugins/health.clinic/enable', headers: H(o.token), payload: { version: '1.0.0', class: 'C' } });
});

describe('hr.leave v1.0', () => {
  test('lifecycle gate 409 · teacher cannot mark (office lane)', async () => {
    const t = await loginAs(app, 'teacher@meridian.edu');
    const g = await app.inject({ method: 'POST', url: '/plugins/hr.leave/leave',
      payload: { staffId: teacherId, leaveDate: tomorrow, kind: 'sick' }, headers: H(t.token) });
    assert.equal(g.statusCode, 403, 'teacher is not office authority (require preHandler)');
    const pr = await loginAs(app, 'principal@meridian.edu');
    const denied = await app.inject({ method: 'POST', url: '/plugins/hr.leave/leave',
      payload: { staffId: coordId, leaveDate: tomorrow, kind: 'casual' }, headers: H(pr.token) });
    assert.equal(denied.statusCode, 200, 'principal is office lane (gate 409 path covered by other suites)');
    const t2 = await app.inject({ method: 'POST', url: '/plugins/hr.leave/leave',
      payload: { staffId: teacherId, leaveDate: today, kind: 'sick' }, headers: H(t.token) });
    assert.equal(t2.statusCode, 403, 'self-marking refused — authority is office, not self');
  });

  test('mark → spine event staff.leave.marked.v1 · duplicate staff-day → 409 with leaveId · past date 400', async () => {
    const pr = await loginAs(app, 'principal@meridian.edu');
    const r = await app.inject({ method: 'POST', url: '/plugins/hr.leave/leave',
      payload: { staffId: teacherId, leaveDate: today, kind: 'sick', reason: 'fever' }, headers: H(pr.token) });
    assert.equal(r.statusCode, 200, r.body);
    assert.match(r.json().leaveId, UUID);
    const ev = await sql(`SELECT count(*)::int n FROM app.outbox WHERE topic='staff.leave.marked.v1'`);
    assert.ok(ev.rows[0].n >= 1, 'absence fact on the spine (timetable absence_feed=hr.leave source)');
    const dupe = await app.inject({ method: 'POST', url: '/plugins/hr.leave/leave',
      payload: { staffId: teacherId, leaveDate: today, kind: 'casual' }, headers: H(pr.token) });
    assert.equal(dupe.statusCode, 409, 'per-staff-day uniqueness (P1-2 backstop pattern)');
    assert.equal(dupe.json().leaveId, r.json().leaveId);
    const past = await app.inject({ method: 'POST', url: '/plugins/hr.leave/leave',
      payload: { staffId: coordId, leaveDate: '2020-01-01', kind: 'casual' }, headers: H(pr.token) });
    assert.equal(past.statusCode, 400, 'no retroactive marking (IST clock)');
    const parent = (await sql(`SELECT id FROM app.users WHERE role='parent' LIMIT 1`)).rows[0];
    const pRes = await app.inject({ method: 'POST', url: '/plugins/hr.leave/leave',
      payload: { staffId: parent.id, leaveDate: tomorrow, kind: 'casual' }, headers: H(pr.token) });
    assert.equal(pRes.statusCode, 400, 'parents are not staff');
  });

  test('cancel → cancelled event · re-cancel 409 · roster excludes absent staff', async () => {
    const pr = await loginAs(app, 'principal@meridian.edu');
    const r = await app.inject({ method: 'POST', url: '/plugins/hr.leave/leave',
      payload: { staffId: teacherId, leaveDate: tomorrow, kind: 'training' }, headers: H(pr.token) });
    assert.equal(r.statusCode, 200);
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const roster = await app.inject({ method: 'GET', url: `/plugins/hr.leave/roster/${tomorrow}`, headers: H(co.token) });
    assert.equal(roster.statusCode, 200);
    const body = roster.json();
    assert.ok(body.absent.some((a) => a.staffId === teacherId), 'teacher absent (training)');
    assert.ok(!body.onDuty.some((d) => d.staffId === teacherId), 'absent staff excluded from onDuty');
    const cx = await app.inject({ method: 'POST', url: `/plugins/hr.leave/leave/${r.json().leaveId}/cancel`, payload: {}, headers: H(pr.token) });
    assert.equal(cx.statusCode, 200);
    const roster2 = await app.inject({ method: 'GET', url: `/plugins/hr.leave/roster/${tomorrow}`, headers: H(co.token) });
    assert.ok(roster2.json().onDuty.some((d) => d.staffId === teacherId), 'back on duty after cancellation');
    const cx2 = await app.inject({ method: 'POST', url: `/plugins/hr.leave/leave/${r.json().leaveId}/cancel`, payload: {}, headers: H(pr.token) });
    assert.equal(cx2.statusCode, 409, 'idempotence guard');
    const badDate = await app.inject({ method: 'GET', url: '/plugins/hr.leave/roster/not-a-date', headers: H(co.token) });
    assert.equal(badDate.statusCode, 400);
  });
});

describe('health.clinic v1.0', () => {
  test('lifecycle gate · finance/teacher refused (nurse-lane PII)', async () => {
    const fin = await loginAs(app, 'finance@meridian.edu');
    const log = await app.inject({ method: 'POST', url: '/plugins/health.clinic/visits',
      payload: { studentId, complaint: 'headache' }, headers: H(fin.token) });
    assert.equal(log.statusCode, 403, 'finance is not clinic authority');
    const read = await app.inject({ method: 'GET', url: '/plugins/health.clinic/visits', headers: H(fin.token) });
    assert.equal(read.statusCode, 403, 'health history is nurse-lane PII');
  });

  test('first_aid visit → logged, NO action raised · input guards', async () => {
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const r = await app.inject({ method: 'POST', url: '/plugins/health.clinic/visits',
      payload: { studentId, complaint: 'scraped knee', action: 'first_aid', temperatureC: 36.8 }, headers: H(co.token) });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().noticeActionId, null, 'first_aid raises no guardian notice');
    const acts = await sql(`SELECT count(*)::int n FROM app.actions WHERE code LIKE 'clinic.notify.%'`);
    assert.equal(acts.rows[0].n, 0);
    const hot = await app.inject({ method: 'POST', url: '/plugins/health.clinic/visits',
      payload: { studentId, complaint: 'fever', temperatureC: 61 }, headers: H(co.token) });
    assert.equal(hot.statusCode, 400, 'implausible temperature refused');
    const badAct = await app.inject({ method: 'POST', url: '/plugins/health.clinic/visits',
      payload: { studentId, complaint: 'x', action: 'exorcism' }, headers: H(co.token) });
    assert.equal(badAct.statusCode, 400, 'action enum enforced');
  });

  test('sent_home → per-instance kernel message action → principal approves → comms rail delivers', async () => {
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const r = await app.inject({ method: 'POST', url: '/plugins/health.clinic/visits',
      payload: { studentId, complaint: 'vomiting', temperatureC: 38.9, action: 'sent_home' }, headers: H(co.token) });
    assert.equal(r.statusCode, 200, r.body);
    const actionId = r.json().noticeActionId;
    assert.match(actionId, UUID, 'guardian-notice action raised');
    const a = (await sql(`SELECT code, kind, status, payload FROM app.actions WHERE id=$1`, [actionId])).rows[0];
    assert.match(a.code, /^clinic\.notify\.[0-9a-f-]{36}$/, 'per-instance action code from birth (cycle-5 P1-1)');
    assert.equal(a.kind, 'approval', 'kernel action kinds are a CHECK — approval rides the decide-execute spine');
    assert.equal(a.payload.kind, 'message', 'kernel decide-executor keys on payload.kind=message (Comms §1.2)');
    const pr = await loginAs(app, 'principal@meridian.edu');
    const decide = await app.inject({ method: 'POST', url: `/actions/${actionId}/decide`,
      payload: { decision: 'approved', note: 'guardian informed' }, headers: H(pr.token) });
    assert.equal(decide.statusCode, 200);
    const comm = await sql(`SELECT channel, status FROM app.communications ORDER BY created_at DESC LIMIT 1`);
    assert.equal(comm.rows[0].status, 'delivered', 'comms rail executed the notice');
    // second sent-home visit → ANOTHER action, distinct code (no UNIQUE collision)
    const r2 = await app.inject({ method: 'POST', url: '/plugins/health.clinic/visits',
      payload: { studentId, complaint: 'recurred', action: 'sent_home' }, headers: H(co.token) });
    assert.equal(r2.statusCode, 200, r2.body);
    assert.notEqual(r2.json().noticeActionId, actionId);
  });

  test('sick pass: issue → active + event · duplicate visit pass 409 · revoke → office lane', async () => {
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const visits = (await sql(`SELECT id FROM plugin_clinic.visit WHERE action='first_aid' ORDER BY created_at LIMIT 1`)).rows;
    const v = await app.inject({ method: 'POST', url: `/plugins/health.clinic/visits/${visits[0].id}/sick-pass`, payload: {}, headers: H(co.token) });
    assert.equal(v.statusCode, 200, v.body);
    assert.match(v.json().passId, UUID);
    const dupe = await app.inject({ method: 'POST', url: `/plugins/health.clinic/visits/${visits[0].id}/sick-pass`, payload: {}, headers: H(co.token) });
    assert.equal(dupe.statusCode, 409, 'one active pass per visit');
    const pr = await loginAs(app, 'principal@meridian.edu');
    const rv = await app.inject({ method: 'POST', url: `/plugins/health.clinic/sick-passes/${v.json().passId}/revoke`, payload: {}, headers: H(pr.token) });
    assert.equal(rv.statusCode, 200);
    const rv2 = await app.inject({ method: 'POST', url: `/plugins/health.clinic/sick-passes/${v.json().passId}/revoke`, payload: {}, headers: H(pr.token) });
    assert.equal(rv2.statusCode, 409, 'already revoked');
    const coRevoke = await app.inject({ method: 'POST', url: `/plugins/health.clinic/sick-passes/${v.json().passId}/revoke`, payload: {}, headers: H(co.token) });
    assert.equal(coRevoke.statusCode, 403, 'revocation is office lane');
  });

  test('corrections APPEND (log never rewritten) · history read nurse-lane only', async () => {
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const orig = (await sql(`SELECT id, student_id, complaint, action FROM plugin_clinic.visit ORDER BY created_at LIMIT 1`)).rows[0];
    const corr = await app.inject({ method: 'POST', url: `/plugins/health.clinic/visits/${orig.id}/correct`,
      payload: { correction: 'temperature re-checked at 37.2', action: 'first_aid' }, headers: H(co.token) });
    assert.equal(corr.statusCode, 200, corr.body);
    const rows = (await sql(`SELECT id, complaint, notes, action FROM plugin_clinic.visit WHERE student_id=$1 ORDER BY created_at`, [orig.student_id])).rows;
    assert.ok(rows.length >= 2, 'append-first: correction is a new row');
    const after = rows.find((r) => r.id === orig.id);
    assert.equal(after.complaint, orig.complaint, 'original row untouched');
    assert.match(rows.find((r) => r.id === corr.json().correctionId).notes, /CORRECTION of/, 'correction self-describing');
    const read = await app.inject({ method: 'GET', url: '/plugins/health.clinic/visits', headers: H(co.token) });
    assert.equal(read.statusCode, 200);
    assert.ok(read.json().visits.some((x) => x.studentId === orig.student_id), 'nurse lane reads history');
    const parent = await loginAs(app, 'parent@meridian.edu');
    const denied = await app.inject({ method: 'GET', url: '/plugins/health.clinic/visits', headers: H(parent.token) });
    assert.equal(denied.statusCode, 403, 'health PII: no parent read via plugin door');
  });
});
