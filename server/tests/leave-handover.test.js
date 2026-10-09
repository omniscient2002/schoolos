// I1/I2/I3 — the teacher-leave handover packet and decision projection.
//
// I1: `runTeacherLeaveOutcome` built the date string from a `pg` Date object → Invalid Date → 0 periods.
// I2: cover matched `teacher_name` free-text, not `teacher_id`.
// I3: the leave row lagged the kernel decision until the teacher's next poll.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';
import pg from 'pg';

let app, sql, teacher, coordinator, tenantId, teacherId;
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const req = (method, url, token, payload) => app.inject({ method, url, payload, headers: H(token) });

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
  const owner = await loginAs(app, 'owner@meridian.edu');
  teacher = await loginAs(app, 'teacher@meridian.edu');
  coordinator = await loginAs(app, 'coordinator@meridian.edu');
  // the teacher.classroom doors are lifecycle-gated — switch the module on (audited owner door)
  const en = await req('POST', '/plugins/teacher.classroom/enable', owner.token, { version: '1.0.0', class: 'C' });
  assert.ok([200, 409].includes(en.statusCode), `enable: ${en.body}`);
  // L6: the cover proposal is decided on the coordinator desk, so that lane must be on too.
  const enCoord = await req('POST', '/plugins/coord.view/enable', owner.token, { version: '1.0.0', class: 'C' });
  assert.ok([200, 409].includes(enCoord.statusCode), `enable coord: ${enCoord.body}`);
  tenantId = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  teacherId = (await sql(`SELECT id FROM app.users WHERE tenant_id=$1 AND email='teacher@meridian.edu'`, [tenantId])).rows[0].id;
  // a Monday period + a slot owned by this teacher (I2: matched by teacher_id, not name)
  const period = (await sql(
    `INSERT INTO app.timetable_periods (tenant_id, seq, label, start_time, end_time, is_break, sort_idx)
     VALUES ($1,'LH','LH Period','08:00','08:45',false,50)
     ON CONFLICT (tenant_id, seq) DO UPDATE SET label=EXCLUDED.label RETURNING id`, [tenantId])).rows[0].id;
  await sql(
    `INSERT INTO app.timetable_slots (tenant_id, period_id, day_of_week, subject, teacher_name, teacher_id, room, grade, section)
     VALUES ($1,$2,'Monday','LH Mathematics','Seed Teacher Name',$3,'LH-R1','8','A')`,
    [tenantId, period, teacherId]);
  // L6: a second teacher on a DIFFERENT day is free in the absent teacher's Monday period, so the
  // deterministic ranking has a candidate to propose as cover.
  await sql(
    `INSERT INTO app.timetable_slots (tenant_id, period_id, day_of_week, subject, teacher_name, room, grade, section)
     VALUES ($1,$2,'Tuesday','LH Mathematics','Cover Teacher','LH-R2','8','B')`,
    [tenantId, period]);
});

after(async () => { await app?.close(); });

test('I1/I2/I3 · an approved leave produces a non-empty handover and the row updates immediately', async () => {
  const raised = await req('POST', '/teacher/leave', teacher.token, { kind: 'sick', from_date: '2026-09-14', to_date: '2026-09-14', reason: 'fever' });
  assert.equal(raised.statusCode, 200, raised.body);
  const { requestId, actionId } = raised.json();

  const decide = await req('POST', `/actions/${actionId}/decide`, coordinator.token, { decision: 'approved', note: 'get well' });
  assert.equal(decide.statusCode, 200, decide.body);
  const execution = decide.json().execution;
  assert.ok(execution, 'the decide returned an execution');
  assert.equal(execution.type, 'leave_handover', `expected a handover execution, got ${JSON.stringify(execution)}`);
  assert.ok(execution.periods >= 1, `I1/I2: the handover must list the affected period (got ${execution.periods})`);

  // I3: the row is approved NOW, before any GET projection.
  const row = (await sql(`SELECT status FROM teacher.leave_request WHERE id=$1`, [requestId])).rows[0];
  assert.equal(row.status, 'approved', 'I3: the decision is projected into the row at decide time');

  const packet = (await sql(`SELECT classes FROM teacher.handover_packet WHERE leave_request_id=$1`, [requestId])).rows[0];
  assert.ok(packet, 'a handover packet was written');
  assert.ok(Array.isArray(packet.classes) && packet.classes.length >= 1, 'the packet lists the affected periods');
  assert.equal(packet.classes[0].subject, 'LH Mathematics', 'the matched slot is the teacher_id-owned one');

  // L6: approval also raises a coordinator-owned substitution proposal, ranked by the SAME
  // deterministic helper the timetable desk uses.
  const sub = (await sql(
    `SELECT id, kind, owner_role, status, payload FROM app.actions WHERE tenant_id=$1 AND code=$2`,
    [tenantId, `teacher.leave.sub.${requestId}`])).rows[0];
  assert.ok(sub, 'a substitution proposal was raised on leave approval');
  assert.equal(sub.kind, 'substitution');
  assert.equal(sub.owner_role, 'coordinator');
  assert.equal(sub.status, 'open');
  assert.ok(Array.isArray(sub.payload.assignments) && sub.payload.assignments.length >= 1, 'the proposal lists the affected periods');
  assert.equal(sub.payload.assignments[0].date, '2026-09-14');
  assert.equal(sub.payload.assignments[0].substitute, 'Cover Teacher', 'a free teacher is suggested as cover');

  // Approving the proposal on the coordinator desk ASSIGNS the cover and stamps the packet.
  const cover = await req('POST', '/coord/substitution/decide', coordinator.token, { action_id: sub.id, decision: 'approved', note: 'covering' });
  assert.equal(cover.statusCode, 200, cover.body);
  assert.ok(cover.json().assigned >= 1, 'approving the proposal writes the substitution rows');
  const subRow = (await sql(
    `SELECT substitute FROM app.timetable_substitutions WHERE tenant_id=$1 AND slot_id=$2 AND date='2026-09-14'`,
    [tenantId, sub.payload.assignments[0].slot_id])).rows[0];
  assert.ok(subRow, 'a substitution row was written for the affected slot');
  assert.equal(subRow.substitute, 'Cover Teacher');
  const stamped = (await sql(`SELECT substitute_name FROM teacher.handover_packet WHERE leave_request_id=$1`, [requestId])).rows[0];
  assert.equal(stamped.substitute_name, 'Cover Teacher', 'the handover packet is stamped with the assigned substitute');
});
