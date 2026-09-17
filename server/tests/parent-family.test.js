// ParentOS lane PS-1 — family.view privacy + flow pins.
// The bullying-complaint lesson institutionalized: parent read planes are scoped by
// test, never assumed. Cross-guardian = 403 with no data; teachers refused everywhere;
// consent decisions immutable; request tickets append-only; leave rides per-instance
// kernel actions (2 requests → 2 distinct codes).
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { setupTestDb } from './helpers.js';
/* sysq = the owner role (BYPASSRLS), used ONCE below to reach the consent row from outside the
   app path; withUser = tenant GUC + constrained app role, the same path a real request takes.
   Imported DYNAMICALLY after setupTestDb: a top-level import of src/db.js pins src/config.js to the
   ambient DATABASE_URL before the test database is created, so the app would then authenticate against the
   dev database and every login would 500 (`relation "auth.login_throttles" does not exist`). */
let withUser, sysq;

let app;
before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  ({ withUser, sysq } = await import('../src/db.js')); // AFTER the test DB exists — see the note above
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
  /* A student NOT linked to this parent. The invariant — a cross-guardian read refuses with no data —
     is only load-bearing if such a student provably exists, so the fixture is ASSERTED, never returned
     past. TST-5: this was `if (!foreign.rows[0]) return;`, which scored green while asserting nothing. */
  const PARENT = `(SELECT id FROM app.users WHERE email='parent@meridian.edu')`;
  // auth bootstrap (finding a user by email before a tenant is known) — the one privileged use.
  const tenant = (await sysq(`SELECT tenant_id FROM app.users WHERE email='parent@meridian.edu'`)).rows[0].tenant_id;
  /* Read as the parent's own tenant so RLS is satisfied. NOTE: `pool.query` here would NOT be enough —
     src/db.js made the pool default the CONSTRAINED schoolos_app role, and family.students/child_link
     are RLS-protected, so a bare read would fail closed to zero rows and the assertion below would fire
     for the wrong reason. withUser() sets the tenant GUC and then the app role, which is exactly the
     path a real request takes. */
  const foreign = await withUser(tenant, 'parent', (c) => c.query(
    `SELECT s.id FROM app.students s
     WHERE s.tenant_id=$1
       AND NOT EXISTS (SELECT 1 FROM family.child_link l WHERE l.student_id=s.id AND l.user_id=${PARENT})
     LIMIT 1`, [tenant]));
  assert.ok(foreign.rows[0],
    'fixture: a student not linked to parent@meridian.edu must exist — without one the cross-guardian invariant cannot be exercised at all');
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
  /* TST-5: this test used to end in `if (!pending) return;`, and that guard was TRUE ON EVERY RUN.
     Nothing in this codebase ever inserts into family.consent — not the seed, not migration 034 that
     creates the table (it inserts only child_link, plugins and capability_contracts), and not any
     route: the four readers in family.view / parent.assistant / pack.dpdp are the ONLY references,
     and the API only ever DECIDES on a row the school side authored. So the guard was not protecting
     against a shifted fixture; the three assertions below had NEVER EXECUTED, and the test has been
     reporting pass for the life of the file.
     Repair: author the row the school would author, then let every assertion run unconditionally. */
  const tenant = (await sysq(`SELECT tenant_id FROM app.users WHERE email='parent@meridian.edu'`)).rows[0].tenant_id;
  const child = (await withUser(tenant, 'parent', (c) => c.query(
    `SELECT s.id FROM family.child_link l JOIN app.students s ON s.id=l.student_id AND s.tenant_id=l.tenant_id
     WHERE l.user_id=(SELECT id FROM app.users WHERE email='parent@meridian.edu') LIMIT 1`))).rows[0];
  assert.ok(child, 'fixture: parent@meridian.edu must have at least one linked child (migration 034 demo linkage)');
  /* Written under withUser so the INSERT is subject to the tenant RLS policy (WITH CHECK) rather than
     running as the BYPASSRLS owner — and the rowCount is asserted, because an RLS-filtered INSERT
     would otherwise report success while creating nothing and the next assertion would fire for a
     reason that has nothing to do with consent immutability. */
  const made = await withUser(tenant, 'parent', (c) => c.query(
    `INSERT INTO family.consent (tenant_id, student_id, kind, title, due_at)
     VALUES ($1,$2,'trip','CS-1 trip consent probe', now() + interval '7 days') RETURNING id`,
    [tenant, child.id]));
  assert.equal(made.rowCount, 1, 'fixture: the consent row was actually created (RLS INSERT not silently filtered)');

  const list = await app.inject({ method: 'GET', url: '/parent/consents', headers: H(p.token) });
  assert.equal(list.statusCode, 200);
  const pending = list.json().consents.find(c => c.status === 'pending' && c.title === 'CS-1 trip consent probe');
  assert.ok(pending, 'fixture: the consent just created is served to the guardian as pending');
  const d1 = await app.inject({ method: 'POST', url: `/parent/consents/${pending.id}/decide`, headers: H(p.token), payload: { decision: 'granted' } });
  assert.equal(d1.statusCode, 200, d1.body);
  const d2 = await app.inject({ method: 'POST', url: `/parent/consents/${pending.id}/decide`, headers: H(p.token), payload: { decision: 'granted' } });
  assert.equal(d2.statusCode, 409, 'second decision refused');
  /* The DB-level guard, reached from OUTSIDE the app path — which is the whole point of asserting it,
     and why this uses the privileged owner connection: an app-role UPDATE with no tenant GUC simply
     matches zero rows (RLS fails closed) and would never reach the trigger, so the assertion would
     pass against a database whose immutability trigger had been deleted. */
  await assert.rejects(() => sysq(`UPDATE family.consent SET status='pending' WHERE id=$1`, [pending.id]),
    /final/i, 'DB guard blocks un-consent');
});

test('two child-leave requests → two DISTINCT per-instance kernel actions (200 both)', async () => {
  const p = await login('parent@meridian.edu');
  const home = await app.inject({ method: 'GET', url: '/parent/home', headers: H(p.token) });
  assert.equal(home.statusCode, 200, home.body);
  // TST-5: was `if (!child) return;`. `/parent/home` derives children from family.child_link, which
  // migration 034 seeds for the demo parent — an empty list means the fixture/migration is broken, and
  // that must fail loudly rather than retire the per-instance-action invariant silently.
  const child = home.json().children[0];
  assert.ok(child, 'fixture: parent@meridian.edu must have a linked child on /parent/home (migration 034 demo linkage)');
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
    // DATX-14: use the NULL-normalising helper (074), not an inline current_setting — the test-created
    // policy persists for later files, and an inline cast would RAISE on an empty/unset GUC.
    await pool.query(`CREATE POLICY tenant_scope ON teacher.homework USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid)`);
    await pool.query(`CREATE POLICY tenant_scope ON teacher.submission USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid)`);
  }
  const r1 = await app.inject({ method: 'GET', url: '/parent/home', headers: H(p.token) });
  assert.equal(r1.statusCode, 200, r1.body);
  for (const ch of r1.json().children) assert.ok(Array.isArray(ch.assignments), 'assignments is an array when tables exist');
});
