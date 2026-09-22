// M3/M4/F2/G5 — the timetable is buildable from the app.
//
// The audit found `ops.timetable` shipped only read/substitute/autofill doors: a self-signup school
// could never write a period or a slot, and slots were section-agnostic with a free-text teacher name.
// This pins the write doors (period + slot CRUD, soft-retire, clash prevention, section-aware slots,
// first-period register owner), the role gates, the no-DELETE law and two-tenant isolation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTestDb, loginAs } from './helpers.js';
import pg from 'pg';

const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let app, sql, owner, coordinator, teacher, tenantA, otherTenant;
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
  owner = (await loginAs(app, 'owner@meridian.edu')).token;
  coordinator = (await loginAs(app, 'coordinator@meridian.edu')).token;
  teacher = (await loginAs(app, 'teacher@meridian.edu')).token;
  tenantA = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  // The plugin ships registered; enable it for the fixture tenant so the lifecycle gate opens.
  await sql(`UPDATE app.plugins SET status='enabled' WHERE tenant_id=$1 AND plugin_id='ops.timetable'`, [tenantA]);
  // A second tenant to prove RLS isolation (its rows must never surface for Meridian).
  otherTenant = (await sql(
    `INSERT INTO app.tenants (slug, name) VALUES ('tt-other','TT Other') RETURNING id`)).rows[0].id;
});

after(async () => {
  await sql(`DELETE FROM app.timetable_slots WHERE tenant_id=$1`, [otherTenant]).catch(() => {});
  await sql(`DELETE FROM app.timetable_periods WHERE tenant_id=$1`, [otherTenant]).catch(() => {});
  await sql(`DELETE FROM app.tenants WHERE id=$1`, [otherTenant]).catch(() => {});
  await app?.close();
});

test('TW · a period can be created; duplicate seq is a 409, bad time a 400', async () => {
  const bad = await req('POST', '/plugins/ops.timetable/periods', owner, { seq: 'X1', label: 'Bad', start_time: '8:00', end_time: '08:45' });
  assert.equal(bad.statusCode, 400, bad.body);
  const ok = await req('POST', '/plugins/ops.timetable/periods', owner, { seq: 'TW1', label: 'TW Period', start_time: '08:00', end_time: '08:45', sort_idx: 100 });
  assert.equal(ok.statusCode, 200, ok.body);
  const id = ok.json().period.id;
  const dup = await req('POST', '/plugins/ops.timetable/periods', owner, { seq: 'TW1', label: 'Again', start_time: '09:00', end_time: '09:45' });
  assert.equal(dup.statusCode, 409, dup.body);
  const edit = await req('PATCH', `/plugins/ops.timetable/periods/${id}`, owner, { label: 'TW Period edited' });
  assert.equal(edit.statusCode, 200, edit.body);
  assert.equal(edit.json().period.label, 'TW Period edited');
});

test('TW · seed-default is opt-in and idempotent (Meridian already has a grid)', async () => {
  const r = await req('POST', '/plugins/ops.timetable/periods/seed-default', owner, {});
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().created, 0, 'nothing is added to a school that already has periods');
});

test('TW · slot create is section-aware; a duplicate class-period is refused', async () => {
  const periods = await req('GET', '/plugins/ops.timetable/periods', owner);
  const periodId = periods.json().periods[0].id;
  const first = await req('POST', '/plugins/ops.timetable/slots', owner,
    { period_id: periodId, day_of_week: 'Saturday', subject: 'TW Maths', teacher_name: 'Ms TW', room: 'R-TW', grade: 'TW-G', section: 'A' });
  assert.equal(first.statusCode, 200, first.body);
  const dup = await req('POST', '/plugins/ops.timetable/slots', owner,
    { period_id: periodId, day_of_week: 'Saturday', subject: 'TW Science', teacher_name: 'Mr TW', room: 'R-TW2', grade: 'TW-G', section: 'A' });
  assert.equal(dup.statusCode, 409, dup.body);
  assert.match(dup.json().error, /already has TW Maths in that period/);
  const teacherClash = await req('POST', '/plugins/ops.timetable/slots', owner,
    { period_id: periodId, day_of_week: 'Saturday', subject: 'TW Art', teacher_name: 'Ms TW', room: 'R-TW3', grade: 'TW-G', section: 'B' });
  assert.equal(teacherClash.statusCode, 409, teacherClash.body);
  assert.match(teacherClash.json().error, /already teaching/);
  const forced = await req('POST', '/plugins/ops.timetable/slots', owner,
    { period_id: periodId, day_of_week: 'Saturday', subject: 'TW Art', teacher_name: 'Ms TW', room: 'R-TW3', grade: 'TW-G', section: 'B', force: true });
  assert.equal(forced.statusCode, 200, forced.body);
});

test('TW · the grid returns a class-section slice with its school-wide fallback', async () => {
  const r = await req('GET', '/plugins/ops.timetable/grid?grade=TW-G&section=A', owner);
  assert.equal(r.statusCode, 200, r.body);
  const mine = r.json().slots.filter((s) => s.grade === 'TW-G' && s.section === 'A');
  assert.equal(mine.length, 1, 'the class-section slot is present');
  assert.equal(mine[0].subject, 'TW Maths');
  assert.ok(r.json().slots.some((s) => s.grade == null), 'school-wide slots still overlay');
});

test('TW · first-period-teacher derives the register owner from period 1', async () => {
  const periods = (await req('GET', '/plugins/ops.timetable/periods', owner)).json().periods;
  const firstNonBreak = periods.find((p) => !p.is_break);
  // place a period-0 (sort 0) slot for the class on Monday so it is the day's first period
  const p1 = (await sql(
    `INSERT INTO app.timetable_periods (tenant_id, seq, label, start_time, end_time, is_break, sort_idx)
     VALUES ($1,'TW0','TW Zero','07:00','07:40',false,0)
     ON CONFLICT (tenant_id, seq) DO UPDATE SET sort_idx=0 RETURNING id`, [tenantA])).rows[0].id;
  await req('POST', '/plugins/ops.timetable/slots', owner,
    { period_id: p1, day_of_week: 'Monday', subject: 'TW Register', teacher_name: 'Ms Register', grade: 'TW-G', section: 'A' });
  const r = await req('GET', '/plugins/ops.timetable/first-period-teacher?grade=TW-G&section=A&dayOfWeek=Monday', owner);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().firstPeriod?.teacher_name, 'Ms Register');
  assert.ok(firstNonBreak, 'seed grid has a non-break period');
});

test('TW · retire is a status update, not a delete; retired rows leave the grid', async () => {
  const before = await req('GET', '/plugins/ops.timetable/slots?grade=TW-G&section=A', owner);
  const slot = before.json().slots.find((s) => s.subject === 'TW Maths');
  assert.ok(slot, 'the slot exists before retirement');
  const ret = await req('POST', `/plugins/ops.timetable/slots/${slot.id}/retire`, owner, {});
  assert.equal(ret.statusCode, 200, ret.body);
  const after = await req('GET', '/plugins/ops.timetable/slots?grade=TW-G&section=A', owner);
  assert.ok(!after.json().slots.some((s) => s.id === slot.id), 'retired slot is gone from reads');
  const raw = await sql(`SELECT retired_at FROM app.timetable_slots WHERE id=$1`, [slot.id]);
  assert.ok(raw.rows[0].retired_at, 'the row still exists with retired_at set');
});

test('TW · role gates: coordinator writes, teacher cannot', async () => {
  const periods = (await req('GET', '/plugins/ops.timetable/periods', owner)).json().periods;
  const periodId = periods[0].id;
  const teacherWrite = await req('POST', '/plugins/ops.timetable/periods', teacher, { seq: 'TW9', label: 'Nope', start_time: '10:00', end_time: '10:45' });
  assert.equal(teacherWrite.statusCode, 403, teacherWrite.body);
  const coordWrite = await req('POST', '/plugins/ops.timetable/periods', coordinator, { seq: 'TW2', label: 'Coord', start_time: '10:00', end_time: '10:45' });
  assert.equal(coordWrite.statusCode, 200, coordWrite.body);
  const coordRetire = await req('POST', `/plugins/ops.timetable/periods/${periodId}/retire`, coordinator, {});
  assert.equal(coordRetire.statusCode, 403, 'retire is owner/principal only');
});

test('TW · RLS: another tenant\'s periods never surface', async () => {
  await sql(`INSERT INTO app.timetable_periods (tenant_id, seq, label, start_time, end_time, sort_idx)
             VALUES ($1,'ZZ','Other Tenant','01:00','01:45',1)`, [otherTenant]);
  const r = await req('GET', '/plugins/ops.timetable/periods', owner);
  assert.equal(r.statusCode, 200, r.body);
  assert.ok(!r.json().periods.some((p) => p.seq === 'ZZ'), 'the other tenant\'s period is invisible');
});

test('TW · the plugin holds no table-level DELETE (retirement is a status)', async () => {
  const src = readFileSync(join(SERVER_ROOT, 'src', 'plugins', 'ops.timetable', 'index.js'), 'utf8');
  assert.ok(!/DELETE\s+FROM\s+app\.timetable/i.test(src), 'no DELETE against the timetable tables');
});
