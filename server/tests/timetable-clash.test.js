// Timetable clash-check (Wave 4 · L1-4.2): teacher/room double-booking against
// the weekly grid + the substitution overlay (effective teacher for a date),
// honest section-not-applicable note (v1 grid is section-agnostic), role gates.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';
import pg from 'pg';

let app;
let sql;
let ownerToken, coordinatorToken, teacherToken;
let tenantA, periodId, slotRao;
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const check = (t, payload) => app.inject({ method: 'POST', url: '/timetable/clash-check', payload, headers: H(t) });

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
  ownerToken = (await loginAs(app, 'owner@meridian.edu')).token;
  coordinatorToken = (await loginAs(app, 'coordinator@meridian.edu')).token;
  teacherToken = (await loginAs(app, 'teacher@meridian.edu')).token;
  tenantA = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  // self-contained fixture: the seed world already ships a period grid — upsert
  // our own period and make this (period, Monday) set deterministic.
  periodId = (await sql(
    `INSERT INTO app.timetable_periods (tenant_id, seq, label, start_time, end_time, sort_idx)
     VALUES ($1,'99','TC Probe P1','08:00','08:45',99)
     ON CONFLICT (tenant_id, seq) DO UPDATE SET label=EXCLUDED.label RETURNING id`, [tenantA])).rows[0].id;
  await sql(`DELETE FROM app.timetable_substitutions WHERE slot_id IN (SELECT id FROM app.timetable_slots WHERE period_id=$1)`, [periodId]);
  await sql(`DELETE FROM app.timetable_slots WHERE period_id=$1`, [periodId]);
  slotRao = (await sql(
    `INSERT INTO app.timetable_slots (tenant_id, period_id, day_of_week, subject, teacher_name, room)
     VALUES ($1,$2,'Monday','TC Mathematics','Ms Rao TC','R-TC-101') RETURNING id`, [tenantA, periodId])).rows[0].id;
  await sql(
    `INSERT INTO app.timetable_slots (tenant_id, period_id, day_of_week, subject, teacher_name, room)
     VALUES ($1,$2,'Monday','TC Science','Mr Bose TC','R-TC-101')`, [tenantA, periodId]); // same room, different teacher
});
after(async () => { await app?.close(); });

test('TC · teacher clash detected on the weekly grid', async () => {
  const r = await check(ownerToken, { dayOfWeek: 'Monday', periodSeq: '99', proposals: [{ teacherName: 'Ms Rao TC' }] });
  assert.equal(r.statusCode, 200, r.body);
  const res = r.json().results[0];
  assert.equal(res.teacherClashes.length, 1);
  assert.equal(res.teacherClashes[0].via, 'grid');
  assert.equal(res.teacherClashes[0].subject, 'TC Mathematics');
  assert.equal(res.clean, false);
});

test('TC · room clash detected (different teacher, same room)', async () => {
  const r = await check(ownerToken, { dayOfWeek: 'Monday', periodId, proposals: [{ teacherName: 'Ms Iyer TC', room: 'r-tc-101' }] });
  assert.equal(r.statusCode, 200);
  const res = r.json().results[0];
  assert.equal(res.teacherClashes.length, 0, 'Ms Iyer teaches nothing here');
  assert.equal(res.roomClashes.length, 2, 'case-insensitive room match — R-TC-101 hosts two grid slots');
  assert.equal(res.clean, false);
});

test('TC · clean proposal passes on both axes', async () => {
  const r = await check(coordinatorToken, { dayOfWeek: 'Tuesday', periodSeq: '99', proposals: [{ teacherName: 'Ms Iyer TC', room: 'R-TC-202' }] });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().results[0].clean, true);
  assert.match(r.json().note, /section-agnostic/);
});

test('TC · substitution overlay: the substitute is busy that date; the absent teacher is free', async () => {
  const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  await sql(`INSERT INTO app.timetable_substitutions (tenant_id, slot_id, date, absent_teacher, substitute)
             VALUES ($1,$2,$3,'Ms Rao TC','Mr Verma TC')`, [tenantA, slotRao, date]);
  const subBusy = await check(ownerToken, { dayOfWeek: 'Monday', periodSeq: '99', date, proposals: [{ teacherName: 'Mr Verma TC' }] });
  assert.equal(subBusy.json().results[0].substitutionClashes.length, 1, 'Verma is covering Rao that period');
  assert.equal(subBusy.json().results[0].substitutionClashes[0].absentTeacher, 'Ms Rao TC');
  const absentFree = await check(ownerToken, { dayOfWeek: 'Monday', periodSeq: '99', date, proposals: [{ teacherName: 'Ms Rao TC' }] });
  assert.equal(absentFree.json().results[0].substitutionClashes.length, 0, 'the absent teacher is not effective that day');
  // without a date, the grid still sees Rao's own slot (she normally teaches it)
  const noDate = await check(ownerToken, { dayOfWeek: 'Monday', periodSeq: '99', proposals: [{ teacherName: 'Ms Rao TC' }] });
  assert.equal(noDate.json().results[0].teacherClashes.length, 1);
});

test('TC · cancelled substitutions are ignored', async () => {
  const date = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  await sql(`INSERT INTO app.timetable_substitutions (tenant_id, slot_id, date, absent_teacher, substitute, status)
             VALUES ($1,$2,$3,'Ms Rao TC','Mr Verma TC','cancelled')`, [tenantA, slotRao, date]);
  const r = await check(ownerToken, { dayOfWeek: 'Monday', periodSeq: '99', date, proposals: [{ teacherName: 'Mr Verma TC' }] });
  assert.equal(r.json().results[0].substitutionClashes.length, 0);
});

test('TC · validation and role gates', async () => {
  assert.equal((await check(ownerToken, { dayOfWeek: 'Funday', proposals: [{ teacherName: 'X' }] })).statusCode, 400);
  assert.equal((await check(ownerToken, { dayOfWeek: 'Monday', periodSeq: '9', proposals: [{ teacherName: 'X' }] })).statusCode, 404);
  assert.equal((await check(ownerToken, { dayOfWeek: 'Monday', proposals: [{}] })).statusCode, 400);
  assert.equal((await check(teacherToken, { dayOfWeek: 'Monday', periodSeq: '99', proposals: [{ teacherName: 'X' }] })).statusCode, 403);
  assert.equal((await check(coordinatorToken, { dayOfWeek: 'Monday', periodSeq: '99', proposals: [{ teacherName: 'X' }] })).statusCode, 200);
});
