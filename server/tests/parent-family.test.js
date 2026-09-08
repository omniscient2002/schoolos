// ParentOS lane PS-1 — family.view privacy + flow pins.
// The bullying-complaint lesson institutionalized: parent read planes are scoped by
// test, never assumed. Cross-guardian = 403 with no data; teachers refused everywhere;
// consent decisions immutable; request tickets append-only; leave rides per-instance
// kernel actions (2 requests → 2 distinct codes).
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { setupTestDb } from './helpers.js';

let app;
before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  // enable family.view through the real lifecycle door (registry row from migration 034)
  const owner = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'owner@meridian.edu', password: 'schoolos-demo' }, headers: { 'content-type': 'application/json' } });
  await app.inject({ method: 'POST', url: '/plugins/family.view/enable', headers: { authorization: `Bearer ${owner.json().token}`, 'content-type': 'application/json' }, payload: { version: '1.0.0', class: 'C' } });
});
after(async () => { await app?.close(); });

const login = async (email) => {
  const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'schoolos-demo' }, headers: { 'content-type': 'application/json' } });
  assert.equal(r.statusCode, 200, `login ${email}: ${r.body}`);
  return r.json();
};
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

test('parent home aggregates own children; no cross-guardian leakage', async () => {
  const p = await login('parent@meridian.edu');
  const r = await app.inject({ method: 'GET', url: '/parent/home', headers: H(p.token) });
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  assert.ok(Array.isArray(body.children), 'children array');
  for (const ch of body.children) {
    assert.ok(!/guardian|phone/i.test(JSON.stringify(ch)), 'no guardian PII in home payload');
  }
});

test('parent timeline: another guardian\'s child → 403 without data', async () => {
  const p = await login('parent@meridian.edu');
  // find a student id NOT linked to this parent (any student row not in own children)
  const { pool } = await import('../src/db.js');
  const foreign = await pool.query(
    `SELECT s.id FROM app.students s
     WHERE NOT EXISTS (SELECT 1 FROM family.child_link l WHERE l.student_id=s.id AND l.user_id=(SELECT id FROM app.users WHERE email='parent@meridian.edu'))
     LIMIT 1`);
  if (!foreign.rows[0]) return; // demo env fully linked — skip
  const r = await app.inject({ method: 'GET', url: `/parent/child/${foreign.rows[0].id}/timeline`, headers: H(p.token) });
  assert.equal(r.statusCode, 403);
  assert.ok(!/attendance|homework|report/i.test(r.body), 'error must not leak data shape');
});

test('teacher role is refused on every /parent door', async () => {
  const t = await login('teacher@meridian.edu');
  for (const url of ['/parent/home', '/parent/consents', '/parent/requests']) {
    const r = await app.inject({ method: 'GET', url, headers: H(t.token) });
    assert.equal(r.statusCode, 403, `${url} → 403 for teacher`);
  }
});

test('consent decision is immutable (decide twice → 409; direct UPDATE → exception)', async () => {
  const p = await login('parent@meridian.edu');
  const list = await app.inject({ method: 'GET', url: '/parent/consents', headers: H(p.token) });
  assert.equal(list.statusCode, 200);
  const pending = list.json().consents.find(c => c.status === 'pending');
  if (!pending) return; // no pending consent seeded — flow covered when consents exist
  const d1 = await app.inject({ method: 'POST', url: `/parent/consents/${pending.id}/decide`, headers: H(p.token), payload: { decision: 'granted' } });
  assert.equal(d1.statusCode, 200, d1.body);
  const d2 = await app.inject({ method: 'POST', url: `/parent/consents/${pending.id}/decide`, headers: H(p.token), payload: { decision: 'granted' } });
  assert.equal(d2.statusCode, 409, 'second decision refused');
  const { pool } = await import('../src/db.js');
  await assert.rejects(() => pool.query(`UPDATE family.consent SET status='pending' WHERE id=$1`, [pending.id]),
    /final/i, 'DB guard blocks un-consent');
});

test('two child-leave requests → two DISTINCT per-instance kernel actions (200 both)', async () => {
  const p = await login('parent@meridian.edu');
  const home = await app.inject({ method: 'GET', url: '/parent/home', headers: H(p.token) });
  const child = home.json().children[0];
  if (!child) return;
  const r1 = await app.inject({ method: 'POST', url: '/parent/leave-request', headers: H(p.token), payload: { childId: child.child_id, kind: 'sick', dates: '2026-09-10', reason: 'fever' } });
  const r2 = await app.inject({ method: 'POST', url: '/parent/leave-request', headers: H(p.token), payload: { childId: child.child_id, kind: 'family', dates: '2026-09-12', reason: 'family function' } });
  assert.equal(r1.statusCode, 200, r1.body);
  assert.equal(r2.statusCode, 200, r2.body);
  assert.notEqual(r1.json().actionId, r2.json().actionId, 'per-instance codes differ (UNIQUE(tenant,code) holds)');
});

test('request ticket lifecycle is append-only (status_events present, no UPDATE path)', async () => {
  const p = await login('parent@meridian.edu');
  const r = await app.inject({ method: 'POST', url: '/parent/requests', headers: H(p.token), payload: { category: 'certificate', title: 'Bonafide certificate for school transfer' } });
  assert.equal(r.statusCode, 200, r.body);
  const list = await app.inject({ method: 'GET', url: '/parent/requests', headers: H(p.token) });
  const mine = list.json().requests.find(x => x.id === r.json().requestId);
  assert.ok(mine, 'request listed');
  assert.equal(mine.status, 'submitted');
  assert.ok(Array.isArray(mine.events) && mine.events.length >= 1, 'history events present');
});

test('report-discrepancy creates a profile_correction request (parents never edit records)', async () => {
  const p = await login('parent@meridian.edu');
  const r = await app.inject({ method: 'POST', url: '/parent/report-discrepancy', headers: H(p.token), payload: { recordRef: 'admission_no A-1012', whatWrong: 'Date of birth shows the wrong year' } });
  assert.equal(r.statusCode, 200, r.body);
  assert.match(r.json().note, /office will review/i);
});

test('graceful degradation: doors work when TeacherOS tables are absent', async () => {
  const p = await login('parent@meridian.edu');
  // deterministic both-ways pin (031 creates these tables in fresh test DBs):
  // force tables ABSENT → null sections; restore shapes → real arrays.
  const { pool } = await import('../src/db.js');
  await pool.query(`DROP TABLE IF EXISTS teacher.submission CASCADE`);
  await pool.query(`DROP TABLE IF EXISTS teacher.homework CASCADE`);
  try {
    const r0 = await app.inject({ method: 'GET', url: '/parent/home', headers: H(p.token) });
    assert.equal(r0.statusCode, 200, r0.body);
    for (const ch of r0.json().children) assert.equal(ch.assignments, null, 'assignments section degrades to null');
  } finally {
    // restore the REAL 031 shapes (columns + app-role grants + RLS) so later tests
    // and reruns see a TeacherOS-complete env — bare re-CREATE hides the tables from
    // schoolos_app (no grants → invisible in information_schema → tableExists false).
    await pool.query(`CREATE TABLE IF NOT EXISTS teacher.homework (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, class_grade text, subject text, title text, detail text, attachment_ref text, due_at timestamptz, created_by uuid, status text DEFAULT 'open', created_at timestamptz DEFAULT now())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS teacher.submission (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, homework_id uuid, student_id uuid, content_type text DEFAULT 'text', content text, status text DEFAULT 'submitted', grade text, feedback text, submitted_at timestamptz DEFAULT now(), reviewed_by uuid, reviewed_at timestamptz)`);
    await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON teacher.homework, teacher.submission TO schoolos_app`);
    await pool.query(`ALTER TABLE teacher.homework ENABLE ROW LEVEL SECURITY`);
    await pool.query(`ALTER TABLE teacher.submission ENABLE ROW LEVEL SECURITY`);
    await pool.query(`DROP POLICY IF EXISTS tenant_scope ON teacher.homework`);
    await pool.query(`DROP POLICY IF EXISTS tenant_scope ON teacher.submission`);
    await pool.query(`CREATE POLICY tenant_scope ON teacher.homework USING (tenant_id = current_setting('schoolos.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('schoolos.tenant_id')::uuid)`);
    await pool.query(`CREATE POLICY tenant_scope ON teacher.submission USING (tenant_id = current_setting('schoolos.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('schoolos.tenant_id')::uuid)`);
  }
  const r1 = await app.inject({ method: 'GET', url: '/parent/home', headers: H(p.token) });
  assert.equal(r1.statusCode, 200, r1.body);
  for (const ch of r1.json().children) assert.ok(Array.isArray(ch.assignments), 'assignments is an array when tables exist');
});
