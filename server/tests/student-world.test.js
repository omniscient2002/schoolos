// StudentOS lane SS-1 — student.world privacy + session-isolation pins.
// Students are on school computers/kiosks (NO personal phones, §78/§79): everything here
// runs as role 'student' on shared machines. Pinned by test, never assumed:
//   · OWN-ONLY — no other student's name/grades leak into any /student payload (string
//     scan of the whole home payload against the live roster);
//   · user-owned study rows (mistakes/flashcards/tasks) are pinned by the owner_scoped
//     RLS policy (schoolos.user_id) — a second student context cannot read or delete them,
//     and even a same-tenant schoolos_app read without the user GUC sees nothing;
//   · session isolation headers on every /student/* response (no-store + Clear-Site-Data);
//   · print jobs are school-controlled (student queues, staff queue + discharge);
//   · wellbeing requests: anonymous filings store no identity, teacher refused;
//   · graceful degradation when teacher.homework (031 lane) is absent.
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { setupTestDb } from './helpers.js';

let app;
before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  // enable student.world through the real lifecycle door (registry row from migration 036)
  const owner = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'owner@meridian.edu', password: 'schoolos-demo' }, headers: { 'content-type': 'application/json' } });
  const en = await app.inject({ method: 'POST', url: '/plugins/student.world/enable', headers: { authorization: `Bearer ${owner.json().token}`, 'content-type': 'application/json' }, payload: { version: '1.0.0', class: 'C' } });
  assert.equal(en.statusCode, 200, `owner enable via door failed: ${en.body}`);
});
after(async () => { await app?.close(); });

const loginCache = new Map();
const login = async (email) => {
  if (loginCache.has(email)) return loginCache.get(email); // /auth/login is rate-limited (20/min)
  const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'schoolos-demo' }, headers: { 'content-type': 'application/json' } });
  assert.equal(r.statusCode, 200, `login ${email}: ${r.body}`);
  const out = r.json();
  loginCache.set(email, out);
  return out;
};
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const HB = (t) => ({ authorization: `Bearer ${t}` }); // bodyless calls must not send a JSON content-type

test('home: own data only — shape + roster-wide string scan (no other student, no guardian PII)', async () => {
  const s = await login('student@meridian.edu');
  const r = await app.inject({ method: 'GET', url: '/student/home', headers: H(s.token) });
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  assert.ok(body.student, 'student identity resolved (demo name-match pin)');
  assert.equal(body.student.name, 'Aarav Sharma');
  assert.ok('next_class' in body && 'today' in body && Array.isArray(body.needs_attention) && Array.isArray(body.progress) && Array.isArray(body.bag_tomorrow), 'home contract shape');
  assert.ok('classes_count' in body.today && 'assignments_due' in body.today && 'upcoming_test' in body.today, 'today shape');

  // own-only pin: scan the ENTIRE payload against the live roster + guardian plane
  const raw = r.body;
  const { pool } = await import('../src/db.js');
  const others = await pool.query(
    `SELECT name, guardian_name, guardian_phone FROM app.students
     WHERE tenant_id=(SELECT tenant_id FROM app.users WHERE email='student@meridian.edu')
       AND lower(name) <> lower('Aarav Sharma') ORDER BY random() LIMIT 25`);
  assert.ok(others.rows.length > 0, 'roster has other students to leak-guard');
  for (const o of others.rows) {
    assert.ok(!raw.includes(o.name), `no other student's name in home payload (leak: ${o.name})`);
    if (o.guardian_name && o.guardian_name !== 'Kavita Sharma')
      assert.ok(!raw.includes(o.guardian_name), `no other guardian's name in payload (${o.guardian_name})`);
    assert.ok(!raw.includes(o.guardian_phone), 'no guardian phone in payload');
  }
  assert.ok(!raw.includes('guardian_phone'), 'guardian_phone key never serialized');
});

test('session isolation: every /student/* response is no-store + Clear-Site-Data (§78/§79)', async () => {
  const s = await login('student@meridian.edu');
  for (const url of ['/student/home', '/student/homework', '/student/results', '/student/tasks', '/student/print/mine', '/student/noticeboard', '/student/session']) {
    const r = await app.inject({ method: 'GET', url, headers: H(s.token) });
    assert.equal(r.statusCode, 200, url);
    assert.equal(r.headers['cache-control'], 'no-store', `${url} must be no-store on a shared machine`);
    assert.equal(r.headers['pragma'], 'no-cache', `${url} must be no-cache`);
    assert.equal(r.headers['clear-site-data'], '"cache", "storage"', `${url} must clear shared-machine cache/storage between sessions`);
  }
  // even an unauthenticated hit on a student door must not be cacheable
  const anon = await app.inject({ method: 'GET', url: '/student/home' });
  assert.equal(anon.statusCode, 401);
  assert.equal(anon.headers['cache-control'], 'no-store', 'no-store rides auth failures too (safe direction)');
});

test('session: kiosk idle-countdown contract (STUDENT_IDLE_TIMEOUT_MINUTES default 10)', async () => {
  const s = await login('student@meridian.edu');
  const r = await app.inject({ method: 'GET', url: '/student/session', headers: H(s.token) });
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  assert.equal(typeof body.idle_minutes, 'number');
  assert.ok(body.idle_minutes >= 1, 'idle_minutes sane');
  assert.equal(body.logout_url, '/auth/logout');
});

test('mistakes: CRUD own-only — second student context cannot read or delete Aarav\'s rows', async () => {
  const a = await login('student@meridian.edu');
  const created = await app.inject({ method: 'POST', url: '/student/mistakes', headers: H(a.token), payload: { subject: 'Mathematics', topic: 'Fractions', what_wrong: 'added the denominators', correction: 'use the LCM first', lesson: 'slow down on word problems' } });
  assert.equal(created.statusCode, 200, created.body);
  const mine = await app.inject({ method: 'GET', url: '/student/mistakes', headers: H(a.token) });
  assert.equal(mine.statusCode, 200);
  const row = mine.json().mistakes.find((m) => m.topic === 'Fractions');
  assert.ok(row, 'own mistake listed');

  // second student context: a student-role user whose name matches a DIFFERENT student row
  const { pool } = await import('../src/db.js');
  const other = (await pool.query(
    `SELECT name FROM app.students
     WHERE tenant_id=(SELECT tenant_id FROM app.users WHERE email='student@meridian.edu')
       AND lower(name) <> lower('Aarav Sharma') AND status='active' ORDER BY admission_no LIMIT 1`)).rows[0];
  assert.ok(other, 'a second roster student exists to impersonate');
  const { hashPassword } = await import('../src/auth.js');
  const b = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'student-b@meridian.edu', password: 'whatever' }, headers: { 'content-type': 'application/json' } });
  if (b.statusCode !== 200) {
    await pool.query(
      `INSERT INTO app.users (tenant_id, email, name, role, password_hash, phone)
       SELECT tenant_id, $1, $2, 'student', $3, '+919845000299'
       FROM app.users WHERE email='student@meridian.edu'
       ON CONFLICT (tenant_id, email) DO NOTHING`,
      ['student-b@meridian.edu', other.name, hashPassword('schoolos-demo')]);
  }
  const sb = await login('student-b@meridian.edu');
  const theirs = await app.inject({ method: 'GET', url: '/student/mistakes', headers: H(sb.token) });
  assert.equal(theirs.statusCode, 200);
  assert.ok(!JSON.stringify(theirs.json()).includes('Fractions'), 'student B cannot read student A mistake rows');
  const del = await app.inject({ method: 'DELETE', url: `/student/mistakes/${row.id}`, headers: HB(sb.token) });
  assert.equal(del.statusCode, 404, 'student B cannot delete student A row (owner-scoped)');

  // DB-layer pin: schoolos_app with the tenant GUC but WITHOUT schoolos.user_id sees nothing
  const bare = await pool.query(
    `BEGIN;
     SELECT set_config('schoolos.tenant_id', (SELECT tenant_id FROM app.users WHERE email='student@meridian.edu')::text, true);
     SELECT set_config('schoolos.role', 'student', true);
     SET LOCAL ROLE schoolos_app;
     SELECT count(*)::int AS n FROM student.mistake_note;
     ROLLBACK;`);
  // multi-statement simple query returns an ARRAY of results
  const flat = (Array.isArray(bare) ? bare : [bare]).flatMap((r) => r.rows ?? []);
  assert.equal(flat.find((r) => r && r.n != null)?.n ?? 0, 0, 'owner_scoped RLS hides rows without the user GUC');

  // Aarav can delete own
  const delOwn = await app.inject({ method: 'DELETE', url: `/student/mistakes/${row.id}`, headers: HB(a.token) });
  assert.equal(delOwn.statusCode, 200, delOwn.body);
});

test('flashcards: decks are user-owned; deck filter works', async () => {
  const a = await login('student@meridian.edu');
  const c1 = await app.inject({ method: 'POST', url: '/student/flashcards', headers: H(a.token), payload: { deck: 'Algebra', front: '2x = 4, x = ?', back: 'x = 2', subject: 'Mathematics' } });
  assert.equal(c1.statusCode, 200, c1.body);
  const missing = await app.inject({ method: 'POST', url: '/student/flashcards', headers: H(a.token), payload: { deck: 'Algebra', front: '', back: 'x = 2' } });
  assert.equal(missing.statusCode, 400, 'front is required — plain error');
  const byDeck = await app.inject({ method: 'GET', url: '/student/flashcards?deck=Algebra', headers: H(a.token) });
  assert.equal(byDeck.statusCode, 200);
  assert.ok(byDeck.json().flashcards.some((f) => f.front.includes('2x = 4')), 'own card in own deck');
  const other = await app.inject({ method: 'GET', url: '/student/flashcards?deck=History', headers: H(a.token) });
  assert.equal(other.json().flashcards.length, 0, 'other decks empty');
  const decks = await app.inject({ method: 'GET', url: '/student/flashcards', headers: H(a.token) });
  assert.ok(decks.json().decks.some((d) => d.deck === 'Algebra' && d.cards >= 1), 'deck list with counts');
});

test('tasks: create, toggle done, GET lists tasks_view (homework-derived checklist)', async () => {
  const a = await login('student@meridian.edu');
  const c = await app.inject({ method: 'POST', url: '/student/tasks', headers: H(a.token), payload: { title: 'Revise fractions before Friday test', due_date: '2026-09-11' } });
  assert.equal(c.statusCode, 200, c.body);
  const id = c.json().id;
  const t1 = await app.inject({ method: 'POST', url: '/student/tasks', headers: H(a.token), payload: { id, done: true } });
  assert.equal(t1.statusCode, 200, t1.body);
  assert.equal(t1.json().done, true, 'toggle on');
  const t2 = await app.inject({ method: 'POST', url: '/student/tasks', headers: H(a.token), payload: { id, done: false } });
  assert.equal(t2.json().done, false, 'toggle off');
  const list = await app.inject({ method: 'GET', url: '/student/tasks', headers: H(a.token) });
  assert.equal(list.statusCode, 200);
  assert.ok(list.json().tasks.some((t) => t.id === id), 'own task listed');
  assert.ok(Array.isArray(list.json().tasks_view), 'tasks_view present (empty while teacher.homework absent)');
  const foreign = await app.inject({ method: 'POST', url: '/student/tasks', headers: H((await login('student-b@meridian.edu')).token), payload: { id, done: true } });
  assert.equal(foreign.statusCode, 404, 'student B cannot toggle student A task');
});

test('print: student queues → staff queue sees name+kind → staff marks printed; students refused on staff door', async () => {
  const a = await login('student@meridian.edu');
  const q1 = await app.inject({ method: 'POST', url: '/student/print', headers: H(a.token), payload: { kind: 'timetable' } });
  assert.equal(q1.statusCode, 200, q1.body);
  assert.equal(q1.json().status, 'queued', 'school-controlled: queued for the office');
  const badKind = await app.inject({ method: 'POST', url: '/student/print', headers: H(a.token), payload: { kind: 'free_chocolates' } });
  assert.equal(badKind.statusCode, 400, 'unknown kind — plain error');
  const mine = await app.inject({ method: 'GET', url: '/student/print/mine', headers: H(a.token) });
  const job = mine.json().jobs.find((j) => j.status === 'queued');
  assert.ok(job, 'own queue status visible');

  const t = await login('teacher@meridian.edu');
  const queue = await app.inject({ method: 'GET', url: '/student/print/queue', headers: H(t.token) });
  assert.equal(queue.statusCode, 200, queue.body);
  const seen = queue.json().jobs.find((j) => j.id === job.id);
  assert.ok(seen, 'staff queue sees the job');
  assert.equal(seen.student_name, 'Aarav Sharma', 'job carries the student name');
  assert.ok(seen.class, 'job carries the class');
  const done = await app.inject({ method: 'POST', url: `/student/print/${job.id}/done`, headers: HB(t.token) });
  assert.equal(done.statusCode, 200, done.body);
  assert.equal(done.json().status, 'printed', 'staff discharge');
  const mine2 = await app.inject({ method: 'GET', url: '/student/print/mine', headers: H(a.token) });
  assert.equal(mine2.json().jobs.find((j) => j.id === job.id).status, 'printed', 'student sees printed');

  const again = await app.inject({ method: 'POST', url: `/student/print/${job.id}/done`, headers: HB(t.token) });
  assert.equal(again.statusCode, 404, 'printed is terminal — not re-dischargeable');
  const studentOnStaff = await app.inject({ method: 'GET', url: '/student/print/queue', headers: H(a.token) });
  assert.equal(studentOnStaff.statusCode, 403, 'students never see the staff queue');
});

test('noticeboard: weekly print-ready blocks (plain text lines)', async () => {
  const a = await login('student@meridian.edu');
  const r = await app.inject({ method: 'GET', url: '/student/noticeboard', headers: H(a.token) });
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  assert.ok(Array.isArray(body.blocks) && body.blocks.length >= 2, 'print-ready block list');
  for (const b of body.blocks) {
    assert.ok(b.title && Array.isArray(b.lines), 'each block has a title + plain text lines');
    for (const line of b.lines) assert.equal(typeof line, 'string', 'lines are printable text');
  }
  assert.ok(!JSON.stringify(body).includes('guardian_phone'), 'printable board carries no guardian PII');
  // staff door shares the shape
  const t = await login('coordinator@meridian.edu');
  const staff = await app.inject({ method: 'GET', url: '/student/noticeboard', headers: H(t.token) });
  assert.equal(staff.statusCode, 200, 'noticeboard is also a staff door');
});

test('wellbeing: student files (anonymous stores no identity) → staff read; teacher refused; event emitted', async () => {
  const a = await login('student@meridian.edu');
  const w = await app.inject({ method: 'POST', url: '/student/wellbeing', headers: H(a.token), payload: { category: 'bullying', detail: 'someone keeps taking my tiffin on the bus', anonymous: true } });
  assert.equal(w.statusCode, 200, w.body);
  assert.equal(w.json().anonymous, true);
  const bad = await app.inject({ method: 'POST', url: '/student/wellbeing', headers: H(a.token), payload: { category: 'cricket', detail: 'x' } });
  assert.equal(bad.statusCode, 400, 'category enum — plain error');
  const named = await app.inject({ method: 'POST', url: '/student/wellbeing', headers: H(a.token), payload: { category: 'academic_pressure', detail: 'too many tests this week', anonymous: false } });
  assert.equal(named.statusCode, 200, named.body);

  const { pool } = await import('../src/db.js');
  const ev = await pool.query(`SELECT count(*)::int AS n FROM app.events WHERE type='student' AND label ILIKE 'Wellbeing request filed%'`);
  assert.ok(ev.rows[0].n >= 2, 'student.wellbeing.v1 events emitted on the spine');

  const p = await login('principal@meridian.edu');
  const staff = await app.inject({ method: 'GET', url: '/student/wellbeing', headers: H(p.token) });
  assert.equal(staff.statusCode, 200, staff.body);
  const rows = staff.json().requests;
  const anonRow = rows.find((x) => x.id === w.json().id);
  assert.ok(anonRow, 'staff reads the anonymous request');
  assert.equal(anonRow.student, null, 'anonymous filing surfaces NO identity');
  assert.ok(!JSON.stringify(rows.filter((x) => x.anonymous)).includes('Aarav Sharma'), 'anonymous rows carry no student name (named rows legitimately do)');
  const namedRow = rows.find((x) => x.id === named.json().id);
  assert.equal(namedRow?.student, 'Aarav Sharma', 'named filing reaches the counselor plane with the student');
  const t = await login('teacher@meridian.edu');
  const refused = await app.inject({ method: 'GET', url: '/student/wellbeing', headers: H(t.token) });
  assert.equal(refused.statusCode, 403, 'teachers refused on the wellbeing plane');
});

test('graceful degradation: homework door degrades when teacher.homework absent; splits digital/paper when present', async () => {
  const a = await login('student@meridian.edu');
  const { pool } = await import('../src/db.js');
  // deterministic slate: no homework table regardless of what earlier runs left behind
  await pool.query(`DROP TABLE IF EXISTS teacher.homework CASCADE`);
  // 1) absent → empty sections, never a 500
  const r1 = await app.inject({ method: 'GET', url: '/student/homework', headers: H(a.token) });
  assert.equal(r1.statusCode, 200, r1.body);
  assert.deepEqual(r1.json().digital, [], 'digital degrades to []');
  assert.deepEqual(r1.json().paper, [], 'paper degrades to []');
  const tasks1 = await app.inject({ method: 'GET', url: '/student/tasks', headers: H(a.token) });
  assert.deepEqual(tasks1.json().tasks_view, [], 'tasks_view degrades to []');

  // 2) present (034-test shape + mode column) → digital/paper split; notebook detail = paper
  await pool.query(`DROP TABLE IF EXISTS teacher.homework CASCADE`);
  await pool.query(`CREATE TABLE teacher.homework (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, class_grade text,
    subject text, title text, detail text, mode text, due_at timestamptz,
    created_by uuid, status text DEFAULT 'open')`);
  // mirror what the real 031 lane must grant — the door reads via schoolos_app
  await pool.query(`GRANT SELECT ON teacher.homework TO schoolos_app`);
  const tenant = (await pool.query(`SELECT tenant_id FROM app.users WHERE email='student@meridian.edu'`)).rows[0].tenant_id;
  await pool.query(
    `INSERT INTO teacher.homework (tenant_id, class_grade, subject, title, detail, mode, due_at) VALUES
     ($1,'8','Science','Draw the water cycle','Diagram in your notebook', NULL, now() + interval '2 days'),
     ($1,'8','Mathematics','Worksheet 3.2','Complete the worksheet online','digital', now() + interval '2 days'),
     ($1,'8','History','Map work','Outline map in the atlas', NULL, now() + interval '1 day'),
     ($1,'9','Chemistry','Other class — must not leak','Notebook exercise', NULL, now() + interval '3 days')`,
    [tenant]);
  try {
    const r2 = await app.inject({ method: 'GET', url: '/student/homework', headers: H(a.token) });
    assert.equal(r2.statusCode, 200, r2.body);
    const hw = r2.json();
    assert.equal(hw.digital.length, 1, 'digital: mode=digital row');
    assert.ok(hw.digital[0].title.includes('Worksheet'), 'digital split correct');
    assert.equal(hw.paper.length, 2, 'paper: notebook-detail rows (own class only)');
    assert.ok(hw.paper.every((p) => p.note.includes('Complete in notebook — teacher marks receipt')), 'paper note pinned');
    assert.ok(!JSON.stringify(hw).includes('Other class'), 'no other class_grade homework leaks');
    const tasks2 = await app.inject({ method: 'GET', url: '/student/tasks', headers: H(a.token) });
    assert.equal(tasks2.json().tasks_view.length, 3, 'homework mirrors into the checklist tasks_view');
  } finally {
    await pool.query(`DROP TABLE IF EXISTS teacher.homework CASCADE`);
  }
  // 3) absent again → still 200 (degradation is stable)
  const r3 = await app.inject({ method: 'GET', url: '/student/homework', headers: H(a.token) });
  assert.equal(r3.statusCode, 200);
  assert.deepEqual(r3.json().digital, []);
});

test('role gates: teacher/parent refused on student-owned doors; lifecycle gate 409 with plain message', async () => {
  const t = await login('teacher@meridian.edu');
  for (const url of ['/student/home', '/student/results', '/student/mistakes', '/student/flashcards']) {
    const r = await app.inject({ method: 'GET', url, headers: H(t.token) });
    assert.equal(r.statusCode, 403, `${url} → 403 for teacher`);
  }
  const p = await login('parent@meridian.edu');
  const r = await app.inject({ method: 'GET', url: '/student/home', headers: H(p.token) });
  assert.equal(r.statusCode, 403, 'parent refused');

  // lifecycle gate: disabled plugin → 409, zero data, plain-language reason
  const owner = await login('owner@meridian.edu');
  const s = await login('student@meridian.edu');
  const dis = await app.inject({ method: 'POST', url: '/plugins/student.world/disable', headers: H(owner.token), payload: {} });
  assert.equal(dis.statusCode, 200, dis.body);
  const gated = await app.inject({ method: 'GET', url: '/student/home', headers: H(s.token) });
  assert.equal(gated.statusCode, 409, 'lifecycle gate refuses while disabled');
  assert.match(gated.json().error, /switched off/i, 'plain-language reason');
  const re = await app.inject({ method: 'POST', url: '/plugins/student.world/enable', headers: H(owner.token), payload: { version: '1.0.0', class: 'C' } });
  assert.equal(re.statusCode, 200, re.body);
  const back = await app.inject({ method: 'GET', url: '/student/home', headers: H(s.token) });
  assert.equal(back.statusCode, 200, 'door returns after re-enable');
});
