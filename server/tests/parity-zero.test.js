// Parity-zero: the 7 doors the enforce gate flagged as wrapper-only now have UI
// callers (or a named public-page reason). Each test pins the door's contract
// so a future regression fails here, not in a browser walk.
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { setupTestDb, loginAs } from './helpers.js';

let app;
let pool;
let owner, coordinator, teacher, parent;
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  pool = (await import('../src/db.js')).pool;
  owner = await loginAs(app, 'owner@meridian.edu');
  coordinator = await loginAs(app, 'coordinator@meridian.edu');
  teacher = await loginAs(app, 'teacher@meridian.edu');
  parent = await loginAs(app, 'parent@meridian.edu');
});

after(async () => { await app?.close(); });

// ── school infra (UDISE profile) ──────────────────────────────────────────
test('infra: office reads the profile + PTR; owner saves counts; junk refused', async () => {
  const read = await app.inject({ method: 'GET', url: '/school/infra', headers: H(coordinator.token) });
  assert.equal(read.statusCode, 200, read.body);
  assert.ok('ptr' in read.json(), 'PTR rides the read');
  const denied = await app.inject({ method: 'PUT', url: '/school/infra', headers: H(coordinator.token), payload: { classrooms: 12 } });
  assert.equal(denied.statusCode, 403, 'coordinator reads but does not write the profile');
  const bad = await app.inject({ method: 'PUT', url: '/school/infra', headers: H(owner.token), payload: { classrooms: -3 } });
  assert.equal(bad.statusCode, 400, bad.body);
  const ok = await app.inject({ method: 'PUT', url: '/school/infra', headers: H(owner.token),
    payload: { classrooms: 24, labs: 4, toiletsBoys: 6, toiletsGirls: 8, drinkingWater: true, playground: true, boundaryWall: true, libraryVolumes: 5200 } });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().infra.classrooms, 24);
  const reread = await app.inject({ method: 'GET', url: '/school/infra', headers: H(owner.token) });
  assert.equal(reread.json().infra.labs, 4, 'the save survives a fresh read');
});

// ── pupil identity (APAAR) ────────────────────────────────────────────────
test('identity: 12 digits link; bad format 400; one child one id 409; strangers 404', async () => {
  const mk = (n) => app.inject({ method: 'POST', url: '/students', headers: H(owner.token),
    payload: { name: n, grade: '6', section: 'B', guardianName: 'PZ Guardian', guardianPhone: '+91 9800001234' } });
  const a = (await mk('ParityZero A')).json().student;
  const b = (await mk('ParityZero B')).json().student;
  const bad = await app.inject({ method: 'POST', url: `/students/${a.id}/identity`, headers: H(owner.token), payload: { apaarId: '123' } });
  assert.equal(bad.statusCode, 400, bad.body);
  const ok = await app.inject({ method: 'POST', url: `/students/${a.id}/identity`, headers: H(coordinator.token), payload: { apaarId: '987654321098' } });
  assert.equal(ok.statusCode, 200, ok.body);
  const clash = await app.inject({ method: 'POST', url: `/students/${b.id}/identity`, headers: H(owner.token), payload: { apaarId: '987654321098' } });
  assert.equal(clash.statusCode, 409, clash.body);
  assert.match(clash.json().error, /ParityZero A/, 'the refusal names the holder, not just the number');
  const teacherNo = await app.inject({ method: 'POST', url: `/students/${b.id}/identity`, headers: H(teacher.token), payload: { apaarId: '111122223333' } });
  assert.equal(teacherNo.statusCode, 403, 'teachers do not handle national ids');
  const ghost = await app.inject({ method: 'POST', url: '/students/00000000-0000-0000-0000-000000000000/identity', headers: H(owner.token), payload: { apaarId: '111122223333' } });
  assert.equal(ghost.statusCode, 404, ghost.body);
});

// ── automation templates ──────────────────────────────────────────────────
test('automation templates: six named starting points over live workflow doors', async () => {
  const r = await app.inject({ method: 'GET', url: '/automation/templates', headers: H(owner.token) });
  assert.equal(r.statusCode, 200, r.body);
  const keys = r.json().templates.map((t) => t.key).sort();
  assert.deepEqual(keys, ['absence-notice', 'doc-expiry', 'enquiry-followup', 'fee-due-3d', 'gps-delay', 'low-attendance']);
  for (const t of r.json().templates) {
    assert.ok(t.name && t.topic && t.blurb && t.action?.topic, `template ${t.key} is appliable, not decorative`);
  }
  const no = await app.inject({ method: 'GET', url: '/automation/templates', headers: H(teacher.token) });
  assert.equal(no.statusCode, 403, 'template gallery is the office desk');
});

// ── fare quote + compliance pack ──────────────────────────────────────────
test('transport fares: quote refuses without a rate, then does honest arithmetic', async () => {
  await pool.query(`DELETE FROM app.fares WHERE tenant_id = (SELECT id FROM app.tenants WHERE slug='meridian')`);
  const empty = await app.inject({ method: 'POST', url: '/transport/fares/quote', headers: H(owner.token), payload: { km: 10 } });
  assert.equal(empty.statusCode, 409, empty.body);
  assert.match(empty.json().error, /sets .* first|on record/, 'the refusal names the missing rate');
  const set = await app.inject({ method: 'PUT', url: '/transport/fares', headers: H(owner.token), payload: { academicYear: '2026-27', perKmCents: 1250 } });
  assert.equal(set.statusCode, 200, set.body);
  const q = await app.inject({ method: 'POST', url: '/transport/fares/quote', headers: H(owner.token), payload: { km: 12 } });
  assert.equal(q.statusCode, 200, q.body);
  assert.equal(q.json().amountCents, 15000, '12 km at 1250c/km');
  const badKm = await app.inject({ method: 'POST', url: '/transport/fares/quote', headers: H(owner.token), payload: { km: 500 } });
  assert.equal(badKm.statusCode, 400, badKm.body);
});

test('transport compliance pack: bad quarters refused; the pack reads the registers', async () => {
  const bad = await app.inject({ method: 'GET', url: '/transport/compliance-report?quarter=soon', headers: H(owner.token) });
  assert.equal(bad.statusCode, 400, bad.body);
  const r = await app.inject({ method: 'GET', url: '/transport/compliance-report?quarter=2026-Q3', headers: H(owner.token) });
  assert.equal(r.statusCode, 200, r.body);
  for (const k of ['runs', 'boardings', 'attendants', 'inspections']) assert.ok(k in r.json(), `pack carries ${k}`);
  assert.ok(r.json().attendants.total >= 0 && r.json().attendants.verified <= r.json().attendants.total);
  const parentNo = await app.inject({ method: 'GET', url: '/transport/compliance-report?quarter=2026-Q3', headers: H(parent.token) });
  assert.equal(parentNo.statusCode, 403, 'the pack is the transport desk, not the family portal');
});

// ── staff manual presence mark ────────────────────────────────────────────
test('staff mark: office marks presence for a day; junk refused; twice is a no-op', async () => {
  const who = (await pool.query(`SELECT id FROM app.users WHERE role='teacher' AND active LIMIT 1`)).rows[0];
  const badId = await app.inject({ method: 'POST', url: '/staff-attendance/mark', headers: H(owner.token), payload: { userId: 'nope', day: '2026-10-04' } });
  assert.equal(badId.statusCode, 400, badId.body);
  const badDay = await app.inject({ method: 'POST', url: '/staff-attendance/mark', headers: H(owner.token), payload: { userId: who.id, day: 'tomorrow' } });
  assert.equal(badDay.statusCode, 400, badDay.body);
  const teacherNo = await app.inject({ method: 'POST', url: '/staff-attendance/mark', headers: H(teacher.token), payload: { userId: who.id, day: '2026-10-04' } });
  assert.equal(teacherNo.statusCode, 403, 'self-scan is the staff path; the office marks others');
  const once = await app.inject({ method: 'POST', url: '/staff-attendance/mark', headers: H(coordinator.token), payload: { userId: who.id, day: '2026-10-04' } });
  assert.equal(once.statusCode, 200, once.body);
  const twice = await app.inject({ method: 'POST', url: '/staff-attendance/mark', headers: H(coordinator.token), payload: { userId: who.id, day: '2026-10-04' } });
  assert.equal(twice.statusCode, 200, twice.body, 'one row per person per day — no duplicate, no error');
});

// ── public disclosure (allowlisted by design, pinned so it stays public) ──
test('public disclosure: no session needed — the inspector page is public by design', async () => {
  const r = await app.inject({ method: 'GET', url: '/public/disclosure?tenant=meridian' });
  assert.equal(r.statusCode, 200, r.body);
});
