// F1/F2 — the parent exam read model.
//
// F1: the parent doors used to serve the FROZEN report snapshot, so a moderated result (90 · A2) read
// as the pre-moderation 57 · C1. Moderation must supersede the snapshot on every plane; the parent
// doors now share `_shared/exam-report.js` with the staff report door.
// F2: `upcoming` must exclude published exams (a published exam was in both lists).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers.js';
import pg from 'pg';

let app, sql, tenantId, parent, child;
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const req = (method, url, token, payload) => app.inject({ method, url, payload, headers: H(token) });
const login = async (email) => {
  const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'schoolos-demo' }, headers: { 'content-type': 'application/json' } });
  assert.equal(r.statusCode, 200, `login ${email}: ${r.body}`);
  return r.json();
};

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
  tenantId = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  // enable family.view (its lifecycle gate) through the real owner door
  const owner = await login('owner@meridian.edu');
  await req('POST', '/plugins/family.view/enable', owner.token, { version: '1.0.0', class: 'C' });
  parent = await login('parent@meridian.edu');
  child = (await sql(
    `SELECT cl.student_id, s.grade FROM family.child_link cl
       JOIN app.students s ON s.id=cl.student_id JOIN app.users u ON u.id=cl.user_id
      WHERE u.email='parent@meridian.edu' ORDER BY cl.created_at LIMIT 1`)).rows[0];
  assert.ok(child, 'seed must link parent@meridian.edu to a child');
});

after(async () => { await app?.close(); });

/** Insert a published report + an approved moderation overlay directly (this pins the READ model). */
async function seedReport({ name, snapshot, adjusted }) {
  const exam = (await sql(
    `INSERT INTO plugin_exams.exam (tenant_id, name, term, class_grade, status, published_at)
     VALUES ($1,$2,'term-1',$3,'published', now()) RETURNING id`, [tenantId, name, child.grade])).rows[0].id;
  const report = (await sql(
    `INSERT INTO plugin_exams.report (tenant_id, exam_id, student_id, snapshot, digest)
     VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING id`,
    [tenantId, exam, child.student_id, JSON.stringify(snapshot), 'a'.repeat(64)])).rows[0].id;
  if (adjusted) {
    await sql(
      `INSERT INTO plugin_exams.moderation (tenant_id, report_id, reason, status, adjusted_snapshot, decided_by, decided_at)
       VALUES ($1,$2,'F1 test','approved',$3::jsonb,'principal@meridian.edu', now())`,
      [tenantId, report, JSON.stringify({ snapshot: adjusted, digest: 'b'.repeat(64) })]);
  }
  return { exam, report };
}

test('F1 · the parent academics door serves the approved moderation overlay, not the frozen snapshot', async () => {
  await seedReport({ name: 'F1 Moderated', snapshot: { pct: 57, grade: 'C1', points: 6 }, adjusted: { pct: 90 } });
  const r = await req('GET', `/parent/child/${child.student_id}/academics`, parent.token);
  assert.equal(r.statusCode, 200, r.body);
  const row = r.json().reports.find((x) => x.exam === 'F1 Moderated');
  assert.ok(row, 'the moderated report is listed');
  assert.equal(row.pct, 90, 'the moderated pct is served, not the frozen 57');
  assert.equal(row.grade, 'A2', 'the grade is re-derived on the tenant scale (90 → A2)');
  assert.equal(row.moderated, true, 'the payload states it is moderated');
});

test('F1 · the parent exams door serves the overlay too', async () => {
  const r = await req('GET', `/parent/child/${child.student_id}/exams`, parent.token);
  assert.equal(r.statusCode, 200, r.body);
  const row = r.json().published.find((x) => x.exam === 'F1 Moderated');
  assert.ok(row, 'the moderated report is in the published list');
  assert.equal(row.total_pct, 90);
  assert.equal(row.grade, 'A2');
  assert.equal(row.moderated, true);
});

test('F1 · an unmoderated report still serves its frozen snapshot', async () => {
  await seedReport({ name: 'F1 Plain', snapshot: { pct: 72, grade: 'B1', points: 8 } });
  const r = await req('GET', `/parent/child/${child.student_id}/academics`, parent.token);
  const row = r.json().reports.find((x) => x.exam === 'F1 Plain');
  assert.equal(row.pct, 72);
  assert.equal(row.grade, 'B1');
  assert.equal(row.moderated, false);
});

test('F2 · a published exam is not also listed as upcoming', async () => {
  const draft = (await sql(
    `INSERT INTO plugin_exams.exam (tenant_id, name, term, class_grade, status)
     VALUES ($1,'F2 Draft','term-1',$2,'draft') RETURNING id`, [tenantId, child.grade])).rows[0].id;
  const r = await req('GET', `/parent/child/${child.student_id}/exams`, parent.token);
  assert.equal(r.statusCode, 200, r.body);
  const upcoming = r.json().upcoming;
  assert.ok(upcoming.some((e) => e.id === draft), 'the draft exam is upcoming');
  assert.ok(!upcoming.some((e) => e.name === 'F1 Moderated'), 'the published exam is NOT in upcoming');
});
