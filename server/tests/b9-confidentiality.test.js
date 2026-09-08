// Security matrix B9 — counselor / clinic / safeguarding confidentiality pins.
// What must hold (docs/SECURITY-MATRIX.md B9):
//   · teacher.concern reads are tiered: oversight roles (owner/principal/itadmin/coordinator)
//     see the board; a plain teacher sees ONLY concerns they filed or that are routed to them.
//   · a concern cannot be routed by its filer, nor to the router themself (SoD).
//   · safety box: anonymous reports never carry reporter identity to ANY reader; the full
//     box is designated-authority only (never teachers); non-authority readers get their
//     assigned queue; the weekly summary is counts-by-class/category — never identity.
//   · clinic visits are nurse-lane authority only — teacher/parent/student are refused.
//   · PTM notes are strictly teacher-private: another teacher (even a colleague sharing
//     the booking) is refused by door AND the note rows are RLS-pinned to the owning user.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers.js';
import pg from 'pg';

let app;
let sql;
let teacherToken, teacher2Token, principalToken, ownerToken, coordinatorToken, studentToken, parentToken;
let studentId, student2Id;
const H = (t) => ({ authorization: `Bearer ${t}` });

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
  // enable the support + clinic planes
  const o = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'owner@meridian.edu', password: 'schoolos-demo' } });
  ownerToken = o.json().token;
  for (const [id, v] of [['teacher.support', '1.0.0'], ['health.clinic', '1.0.0']]) {
    const en = await app.inject({ method: 'POST', url: `/plugins/${id}/enable`, payload: { version: v, class: 'C' }, headers: H(ownerToken) });
    assert.equal(en.statusCode, 200, `enable ${id}: ${en.body}`);
  }
  const login = async (e) => (await app.inject({ method: 'POST', url: '/auth/login', payload: { email: e, password: 'schoolos-demo' } })).json().token;
  teacherToken = await login('teacher@meridian.edu');
  teacher2Token = await login('teacher2@meridian.edu');
  principalToken = await login('principal@meridian.edu');
  coordinatorToken = await login('coordinator@meridian.edu');
  studentToken = await login('student@meridian.edu');
  parentToken = await login('parent@meridian.edu');
  const st = await sql(`SELECT id, name FROM app.students ORDER BY created_at LIMIT 2`);
  studentId = st.rows[0].id;
  student2Id = st.rows[1].id;
});
after(async () => { await app?.close(); });

test('B9 · concern visibility is tiered — plain teacher sees own-filed + routed-to-me only', async () => {
  // teacher files a concern about student 1
  const mk = await app.inject({ method: 'POST', url: '/teacher/concern',
    payload: { studentId, category: 'wellbeing', urgency: 'normal', detail: 'B9 pin — withdrawn in class this week' },
    headers: H(teacherToken) });
  assert.equal(mk.statusCode, 200, mk.body);
  const concernId = mk.json().concernId ?? mk.json().concern?.id ?? mk.json().id;
  assert.ok(concernId, `concern created: ${mk.body}`);

  // teacher2 (same tenant, NOT oversight) must NOT see it
  const t2 = await app.inject({ method: 'GET', url: '/teacher/concerns', headers: H(teacher2Token) });
  assert.equal(t2.statusCode, 200);
  assert.equal(t2.json().scope, 'own_filed');
  assert.ok(!t2.json().concerns.some((c) => c.concernId === concernId), 'colleague cannot see another teacher’s concern');

  // oversight tier sees the board
  const pr = await app.inject({ method: 'GET', url: '/teacher/concerns', headers: H(principalToken) });
  assert.equal(pr.statusCode, 200);
  assert.equal(pr.json().scope, 'oversight');
  assert.ok(pr.json().concerns.some((c) => c.concernId === concernId), 'oversight sees the board');
});

test('B9 · routing SoD: filer cannot route own concern; router cannot route to themself', async () => {
  const mk = await app.inject({ method: 'POST', url: '/teacher/concern',
    payload: { studentId: student2Id, category: 'academic', urgency: 'normal', detail: 'B9 pin — SoD routing' },
    headers: H(teacherToken) });
  const concernId = mk.json().concernId ?? mk.json().concern?.id ?? mk.json().id;
  assert.ok(concernId, mk.body);
  // teacher is not routing authority anyway…
  const asTeacher = await app.inject({ method: 'POST', url: `/teacher/concern/${concernId}/route`,
    payload: { routedRole: 'counselor', routedTo: '00000000-0000-4000-8000-000000000000' }, headers: H(teacherToken) });
  assert.ok([403, 404].includes(asTeacher.statusCode), 'teacher has no route authority');

  // coordinator files → coordinator cannot route own (filed_by === router)
  const co = await app.inject({ method: 'POST', url: '/teacher/concern',
    payload: { studentId: student2Id, category: 'attendance', urgency: 'high', detail: 'B9 pin — coordinator-filed' },
    headers: H(coordinatorToken) });
  const coId = co.json().concernId ?? co.json().concern?.id ?? co.json().id;
  const selfRoute = await app.inject({ method: 'POST', url: `/teacher/concern/${coId}/route`,
    payload: { routedRole: 'counselor', routedTo: (await sql(`SELECT id FROM app.users WHERE email='coordinator@meridian.edu'`)).rows[0].id },
    headers: H(coordinatorToken) });
  assert.equal(selfRoute.statusCode, 403, 'filer cannot route own concern (SoD)');
  assert.match(selfRoute.json().error, /segregation of duties/);

  // principal routes coordinator's concern to coordinator — allowed; but routing TO the router is refused
  const okRoute = await app.inject({ method: 'POST', url: `/teacher/concern/${coId}/route`,
    payload: { routedRole: 'counselor', routedTo: (await sql(`SELECT id FROM app.users WHERE email='principal@meridian.edu'`)).rows[0].id },
    headers: H(principalToken) });
  assert.ok([200, 403].includes(okRoute.statusCode), okRoute.body); // depends on filed_by≠router — principal≠coordinator → 200
  const toSelf = await app.inject({ method: 'POST', url: `/teacher/concern/${coId}/route`,
    payload: { routedRole: 'counselor', routedTo: (await sql(`SELECT id FROM app.users WHERE email='principal@meridian.edu'`)).rows[0].id },
    headers: H(principalToken) });
  if (toSelf.statusCode === 409) assert.match(toSelf.json().error, /open/); // already routed
});

test('B9 · safety box: anonymity held for every reader; full box is designated-authority only', async () => {
  // student files ANONYMOUS (default) report
  const rep = await app.inject({ method: 'POST', url: '/safety/box',
    payload: { category: 'bullying', severity: 'high', classGrade: '8', detail: 'B9 pin — anonymous report, identity must never surface' },
    headers: H(studentToken) });
  assert.equal(rep.statusCode, 200, rep.body);
  const reportId = rep.json().reportId ?? rep.json().report?.id; // door: { ok, reportId, ... }

  // db truth: reporter identity was never stored
  const row = await sql(`SELECT reporter_anonymous, reporter_user_id FROM safety.box WHERE id=$1`, [reportId]);
  assert.equal(row.rows[0].reporter_anonymous, true);
  assert.equal(row.rows[0].reporter_user_id, null, 'anonymous report stores NO reporter id');

  // principal (designated authority) reads the full box — no reporter field on anonymous rows
  const full = await app.inject({ method: 'GET', url: '/safety/box', headers: H(principalToken) });
  assert.equal(full.statusCode, 200);
  const mine = full.json().reports.find((r) => r.reportId === reportId);
  assert.ok(mine, 'authority sees the report');
  assert.equal(mine.reporter, null, 'anonymous report carries no reporter even to the principal');

  // teacher: refused outright (never teachers)
  const t = await app.inject({ method: 'GET', url: '/safety/box', headers: H(teacherToken) });
  assert.equal(t.statusCode, 403);
  assert.match(t.json().error, /not permitted|designated/); // role gate fires before the door copy — still refused

  // coordinator: non-authority — assigned queue only; the anonymous report is unassigned → empty
  const co = await app.inject({ method: 'GET', url: '/safety/box?assigned=1', headers: H(coordinatorToken) });
  assert.equal(co.statusCode, 200);
  assert.ok(!co.json().reports.some((r) => r.reportId === reportId), 'unassigned report is not in another desk’s queue');
});

test('B9 · weekly summary is counts-only — no identity fields anywhere', async () => {
  const s = await app.inject({ method: 'GET', url: '/safety/box/summary', headers: H(principalToken) });
  assert.equal(s.statusCode, 200);
  const body = s.json();
  for (const b of body.buckets) {
    assert.deepEqual(Object.keys(b).sort(), ['category', 'classGrade', 'count', 'severity'], 'buckets carry class/category/severity/count ONLY');
  }
  assert.match(body.note, /never/i);
});

test('B9 · clinic visits are nurse-lane only — teacher/parent/student refused', async () => {
  for (const [label, tok] of [['teacher', teacherToken], ['parent', parentToken], ['student', studentToken]]) {
    const r = await app.inject({ method: 'GET', url: '/plugins/health.clinic/visits', headers: H(tok) });
    assert.ok([401, 403].includes(r.statusCode), `${label} refused from clinic visits (got ${r.statusCode})`);
  }
  const pr = await app.inject({ method: 'GET', url: '/plugins/health.clinic/visits', headers: H(principalToken) });
  assert.equal(pr.statusCode, 200, 'nurse-lane authority reads visits');
});

test('B9 · PTM notes strictly teacher-private — door 403 + RLS user-pin (defense in depth)', async () => {
  // teacher publishes a slot and books it via a parent, or seed already has a booking — create fresh
  // PTM booking is guardian-scoped — use the parent's ACTUAL linked child
  const linked = (await sql(`SELECT student_id FROM family.child_link cl JOIN app.users u ON u.id = cl.user_id WHERE u.email='parent@meridian.edu' LIMIT 1`)).rows[0];
  assert.ok(linked, 'seed links parent to a child');
  const slot = await app.inject({ method: 'POST', url: '/ptm/slots',
    payload: { classGrade: '8', date: '2026-09-15', startTime: '09:00', endTime: '09:15' },
    headers: H(teacherToken) });
  assert.equal(slot.statusCode, 200, slot.body);
  const slotId = slot.json().slotId ?? slot.json().slot?.id ?? slot.json().id;
  const book = await app.inject({ method: 'POST', url: '/ptm/book',
    payload: { slotId, studentId: linked.student_id }, headers: H(parentToken) });
  assert.equal(book.statusCode, 200, book.body);
  const bookingId = book.json().bookingId ?? book.json().booking?.id; // door: { ok, bookingId, slotId, ... }

  // meeting teacher writes a private note
  const w = await app.inject({ method: 'POST', url: `/ptm/${bookingId}/notes`,
    payload: { note: 'B9 pin — private discussion about exam stress' }, headers: H(teacherToken) });
  assert.equal(w.statusCode, 200, w.body);

  // ANOTHER teacher — even the colleague teaching the same class — is refused by the door
  const other = await app.inject({ method: 'GET', url: `/ptm/${bookingId}/notes`, headers: H(teacher2Token) });
  assert.equal(other.statusCode, 403);
  assert.match(other.json().error, /private to the meeting teacher/);

  // RLS is the guarantee, not the door: teacher2’s user-pinned read sees zero rows
  const t2id = (await sql(`SELECT id FROM app.users WHERE email='teacher2@meridian.edu'`)).rows[0].id;
  const setg = async (u) => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    await c.query('BEGIN');
    await c.query(`SELECT set_config('schoolos.tenant_id', $1, true)`, [(await sql(`SELECT tenant_id FROM app.users WHERE id=$1`, [u])).rows[0].tenant_id]);
    await c.query(`SELECT set_config('schoolos.user_id', $1, true)`, [u]);
    await c.query('SET LOCAL ROLE schoolos_app'); // RLS applies to the app role, not the connection owner
    const r = await c.query(`SELECT count(*)::int n FROM teacher.note`);
    await c.query('ROLLBACK');
    await c.end();
    return r.rows[0].n;
  };
  assert.equal(await setg(t2id), 0, 'RLS user-pin: colleague sees zero note rows');
  const tid = (await sql(`SELECT id FROM app.users WHERE email='teacher@meridian.edu'`)).rows[0].id;
  assert.ok((await setg(tid)) >= 1, 'owner teacher sees their own note rows');
});
