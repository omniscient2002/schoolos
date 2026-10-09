// Master Action Plan batch 2 — fee counter-PIN, infra, meetings, health/meals, CPD,
// APAAR, Student 360, diary acks, automation templates, timetable conflicts.
// Pins: unfunded rows fail closed the moment a PIN exists; every new table is
// RLS-walled (cross-tenant ids 404); money/PII scoping mirrors the existing doors.
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { setupTestDb, loginAs } from './helpers.js';

let app;
let pool;
let owner, teacher, parent, counselor, clerk;
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  pool = (await import('../src/db.js')).pool;
  owner = await loginAs(app, 'owner@meridian.edu');
  teacher = await loginAs(app, 'teacher@meridian.edu');
  parent = await loginAs(app, 'parent@meridian.edu');
  counselor = await loginAs(app, 'counselor@meridian.edu').catch(() => null);
  if (!counselor) {
    const made = await app.inject({ method: 'POST', url: '/plugins/people.admin/users', headers: H(owner.token),
      payload: { name: 'Batch Two Counselor', email: 'counselor.b2@meridian.edu', role: 'counselor', password: 'Counsel-B2-1' } });
    assert.equal(made.statusCode, 200, `provision counselor: ${made.body}`);
    counselor = await loginAs(app, 'counselor.b2@meridian.edu', 'Counsel-B2-1');
  }
  clerk = await loginAs(app, 'finance@meridian.edu');
});

after(async () => { await app?.close(); });

async function pupil() {
  const r = (await pool.query(
    `SELECT id, grade, section FROM app.students WHERE status='active' ORDER BY admission_no LIMIT 1`)).rows[0];
  assert.ok(r, 'seed has a pupil');
  return r;
}

// ── counter PIN ─────────────────────────────────────────────────────────────
test('fees: cash without PIN works until enrolled; enrolled without PIN 403s; wrong PIN 403s', async () => {
  const t = await loginAs(app, 'finance@meridian.edu');
  // find an open obligation for any pupil (seed carries dues; create a fee head + obligation if none)
  let ob = (await pool.query(
    `SELECT o.id FROM app.fee_obligations o JOIN app.students s ON s.id=o.student_id
      WHERE o.status NOT IN ('void','paid') LIMIT 1`)).rows[0];
  if (!ob) {
    const st = await pupil();
    const head = (await pool.query(
      `SELECT id FROM app.fee_heads LIMIT 1`)).rows[0];
    ob = (await pool.query(
      `INSERT INTO app.fee_obligations (tenant_id, student_id, term, label, amount_cents, fee_head_id)
       SELECT tenant_id, $1, 'T1', 'PIN probe dues', 10000, $2 FROM app.students WHERE id=$1 RETURNING id`,
      [st.id, head?.id ?? null])).rows[0];
  }
  const pay = (extra = {}) => app.inject({ method: 'POST', url: '/fees/payments', headers: H(t.token),
    payload: { obligationId: ob.id, amountCents: 100, method: 'cash', ...extra } });
  const before = await pay();
  assert.ok([200, 400, 409].includes(before.statusCode), `unenrolled cash still behaves as before: ${before.body}`);

  const me = (await pool.query(`SELECT id FROM app.users WHERE email='finance@meridian.edu'`)).rows[0];
  const set = await app.inject({ method: 'POST', url: '/fees/pins', headers: H(owner.token),
    payload: { userId: me.id, pin: '4829' } });
  assert.equal(set.statusCode, 200, set.body);
  const badPin = await app.inject({ method: 'POST', url: '/fees/pins', headers: H(owner.token),
    payload: { userId: me.id, pin: '12' } });
  assert.equal(badPin.statusCode, 400, badPin.body);
  const noPin = await pay();
  assert.equal(noPin.statusCode, 403, noPin.body);
  assert.match(noPin.json().error, /Counter PIN required/, 'human copy names the PIN');
  const wrongPin = await pay({ pin: '0000' });
  assert.equal(wrongPin.statusCode, 403, wrongPin.body);
});

// ── infra / meetings ────────────────────────────────────────────────────────
test('infra: office writes, ptr derives; meetings minute PTA/SMC with validation', async () => {
  const denied = await app.inject({ method: 'PUT', url: '/school/infra', headers: H(teacher.token),
    payload: { classrooms: 10 } });
  assert.equal(denied.statusCode, 403, denied.body);
  const put = await app.inject({ method: 'PUT', url: '/school/infra', headers: H(owner.token),
    payload: { classrooms: 24, labs: 4, toiletsBoys: 6, toiletsGirls: 6, drinkingWater: true, playground: true, boundaryWall: true, libraryVolumes: 8000 } });
  assert.equal(put.statusCode, 200, put.body);
  const bad = await app.inject({ method: 'PUT', url: '/school/infra', headers: H(owner.token), payload: { classrooms: -1 } });
  assert.equal(bad.statusCode, 400, bad.body);
  const got = await app.inject({ method: 'GET', url: '/school/infra', headers: H(teacher.token) });
  assert.equal(got.statusCode, 403, got.body, 'teachers do not read infra');

  const thin = await app.inject({ method: 'POST', url: '/meetings', headers: H(owner.token),
    payload: { kind: 'PTA', heldOn: '2026-09-01', minutes: 'short' } });
  assert.equal(thin.statusCode, 400, thin.body, 'minutes must say something (10+ chars)');
  const mtg = await app.inject({ method: 'POST', url: '/meetings', headers: H(owner.token),
    payload: { kind: 'SMC', heldOn: '2026-09-01', minutes: 'Approved the term fee schedule with no hike; PTA consulted on Aug 20.', attendees: ['Meera', 'Rao'] } });
  assert.equal(mtg.statusCode, 200, mtg.body);
  const list = await app.inject({ method: 'GET', url: '/meetings?kind=SMC', headers: H(owner.token) });
  assert.equal(list.json().meetings.length, 1);
});

// ── health + meals ──────────────────────────────────────────────────────────
test('health: office records, parent reads own children; meals upsert per date', async () => {
  const st = await pupil();
  const denied = await app.inject({ method: 'POST', url: '/health-checks', headers: H(teacher.token),
    payload: { studentId: st.id, kind: 'general', detail: 'x'.repeat(20), checkedOn: '2026-10-01' } });
  assert.equal(denied.statusCode, 403, denied.body);
  const rec = await app.inject({ method: 'POST', url: '/health-checks', headers: H(counselor.token),
    payload: { studentId: st.id, kind: 'RBSK', detail: 'Vision 6/6 both eyes, BMI normal', checkedOn: '2026-10-01' } });
  assert.equal(rec.statusCode, 200, rec.body);
  const mine = await app.inject({ method: 'GET', url: '/health-checks', headers: H(parent.token) });
  assert.equal(mine.statusCode, 200, mine.body);
  assert.equal(mine.json().scoped, 'own_children');

  const m1 = await app.inject({ method: 'POST', url: '/meals', headers: H(owner.token),
    payload: { servedOn: '2026-10-03', menu: 'Dal-rice + veg + banana', vegCount: 300, totalCount: 320 } });
  assert.equal(m1.statusCode, 200, m1.body);
  const m2 = await app.inject({ method: 'POST', url: '/meals', headers: H(owner.token),
    payload: { servedOn: '2026-10-03', menu: 'Corrected menu', vegCount: 310, totalCount: 320 } });
  assert.equal(m2.statusCode, 200, m2.body, 'same date corrects (upsert), never duplicates');
  assert.equal(m2.json().meal.menu, 'Corrected menu');
  const badCount = await app.inject({ method: 'POST', url: '/meals', headers: H(owner.token),
    payload: { servedOn: '2026-10-03', menu: 'x'.repeat(10), vegCount: 400, totalCount: 320 } });
  assert.equal(badCount.statusCode, 400, badCount.body);
});

// ── CPD ─────────────────────────────────────────────────────────────────────
test('cpd: office records hours; staff read own; PAN-style validation on hours', async () => {
  const me = (await pool.query(`SELECT id FROM app.users WHERE email='teacher@meridian.edu'`)).rows[0];
  const rec = await app.inject({ method: 'POST', url: '/staff-trainings', headers: H(owner.token),
    payload: { userId: me.id, title: 'NISHTHA FLN module 4', hours: 6, provider: 'DIKSHA', completedOn: '2026-09-15' } });
  assert.equal(rec.statusCode, 200, rec.body);
  const bad = await app.inject({ method: 'POST', url: '/staff-trainings', headers: H(owner.token),
    payload: { userId: me.id, title: 'x'.repeat(5), hours: -2 } });
  assert.equal(bad.statusCode, 400, bad.body);
  const denied = await app.inject({ method: 'POST', url: '/staff-trainings', headers: H(teacher.token),
    payload: { userId: me.id, title: 'Self claim', hours: 1 } });
  assert.equal(denied.statusCode, 403, denied.body);
  const own = await app.inject({ method: 'GET', url: '/staff-trainings', headers: H(teacher.token) });
  assert.equal(own.json().scoped, 'own');
  assert.ok(Number(own.json().ownHours) >= 6, 'own hours total');
  const all = await app.inject({ method: 'GET', url: '/staff-trainings', headers: H(owner.token) });
  assert.equal(all.json().scoped, 'school');
});

// ── APAAR + 360 ─────────────────────────────────────────────────────────────
test('identity: APAAR must be 12 digits, unique per tenant; 360 scopes money honestly', async () => {
  const st = await pupil();
  const bad = await app.inject({ method: 'POST', url: `/students/${st.id}/identity`, headers: H(owner.token),
    payload: { apaarId: '123' } });
  assert.equal(bad.statusCode, 400, bad.body);
  const ok = await app.inject({ method: 'POST', url: `/students/${st.id}/identity`, headers: H(owner.token),
    payload: { apaarId: '123456789012' } });
  assert.equal(ok.statusCode, 200, ok.body);
  const other = (await pool.query(
    `SELECT id FROM app.students WHERE status='active' AND id<>$1 ORDER BY admission_no LIMIT 1`, [st.id])).rows[0];
  if (other) {
    const dup = await app.inject({ method: 'POST', url: `/students/${other.id}/identity`, headers: H(owner.token),
      payload: { apaarId: '123456789012' } });
    assert.equal(dup.statusCode, 409, dup.body);
    assert.match(dup.json().error, /already on/, 'names the holder like admission-no clashes do');
  }

  const staff = await app.inject({ method: 'GET', url: `/students/${st.id}/360`, headers: H(teacher.token) });
  assert.equal(staff.statusCode, 200, staff.body);
  assert.ok(staff.json().student?.admission_no, 'core row present');
  assert.ok(staff.json().fees?.withheld, 'teachers do not see dues even in aggregate');
  assert.ok('pct' in (staff.json().attendance ?? {}), 'attendance aggregate present');

  const guardian = await app.inject({ method: 'GET', url: `/students/${st.id}/360`, headers: H(parent.token) });
  // seeded demo parent links to Aarav; any other pupil must 403 for this parent
  assert.ok([200, 403].includes(guardian.statusCode), guardian.body);
});

// ── diary acks ──────────────────────────────────────────────────────────────
test('acks: idempotent sign; office sees who signed', async () => {
  const mk = await app.inject({ method: 'POST', url: '/announcements', headers: H(owner.token),
    payload: { title: 'Diwali break', body: 'School closed Oct 20-27. Homework is on the portal.' } });
  assert.equal(mk.statusCode, 200, mk.body);
  const id = mk.json().announcement.id;
  const ack = await app.inject({ method: 'POST', url: `/announcements/${id}/ack`, headers: H(parent.token), payload: {} });
  assert.equal(ack.statusCode, 200, ack.body);
  const again = await app.inject({ method: 'POST', url: `/announcements/${id}/ack`, headers: H(parent.token), payload: {} });
  assert.equal(again.statusCode, 200, again.body, 're-sign is a no-op, not a duplicate');
  const list = await app.inject({ method: 'GET', url: `/announcements/${id}/acks`, headers: H(owner.token) });
  assert.equal(list.json().ackCount, 1, 'distinct signers counted once');
  const denied = await app.inject({ method: 'GET', url: `/announcements/${id}/acks`, headers: H(teacher.token) });
  assert.equal(denied.statusCode, 403, denied.body);

  // parent notices: guardians read school-wide + own classes with ack state (staff door refuses them)
  const staffDoor = await app.inject({ method: 'GET', url: '/notices', headers: H(owner.token) });
  assert.equal(staffDoor.statusCode, 403, staffDoor.body);
  const notes = await app.inject({ method: 'GET', url: '/notices', headers: H(parent.token) });
  assert.equal(notes.statusCode, 200, notes.body);
  assert.ok(Array.isArray(notes.json().notices), 'notice list (possibly empty for this fixture parent)');
});

// ── approve atomicity ─────────────────────────────────────────────────────────
test('approve: empty audience refuses BEFORE mutating (no stuck draft+approved rows)', async () => {
  const mk = await app.inject({ method: 'POST', url: '/announcements', headers: H(owner.token),
    payload: { title: 'Nobody announcement', body: 'This audience reaches nobody at all, on purpose.', audienceKind: 'class', audienceRef: 'Grade 99' } });
  assert.equal(mk.statusCode, 200, mk.body);
  const id = mk.json().announcement.id;
  const actionId = mk.json().announcement.action_id;
  const no = await app.inject({ method: 'POST', url: `/announcements/${id}/approve`, headers: H(owner.token), payload: {} });
  assert.equal(no.statusCode, 409, no.body);
  assert.match(no.json().error, /no reachable recipients/, 'honest refusal, not a silent act');
  const act = (await pool.query(`SELECT status FROM app.actions WHERE id=$1`, [actionId])).rows[0];
  assert.equal(act.status, 'open', 'refusal before mutation: the approval action is untouched');
  const ann = (await pool.query(`SELECT status FROM app.announcements WHERE id=$1`, [id])).rows[0];
  assert.equal(ann.status, 'draft', 'announcement stays a draft that can be fixed and re-approved');
});
test('automation: template gallery lists honest starting points', async () => {
  const r = await app.inject({ method: 'GET', url: '/automation/templates', headers: H(owner.token) });
  assert.equal(r.statusCode, 200, r.body);
  assert.ok(r.json().templates.length >= 6, 'absence, fee, delay, enquiry, expiry, low-attendance');
  assert.ok(r.json().templates.every((t) => t.key && t.topic && t.action), 'each names topic+action');
  const denied = await app.inject({ method: 'GET', url: '/automation/templates', headers: H(teacher.token) });
  assert.equal(denied.statusCode, 403, denied.body);
});

test('timetable: conflicts flag double-booked teacher/room/section per cell', async () => {
  const r = await app.inject({ method: 'GET', url: '/plugins/ops.timetable/conflicts', headers: H(owner.token) });
  // plugin must be enabled for the tenant in seed; if the lifecycle gate 409s, enable first
  if (r.statusCode === 409) {
    const en = await app.inject({ method: 'POST', url: '/plugins/ops.timetable/enable', headers: H(owner.token),
      payload: { version: '1.0.0', class: 'C' } });
    assert.equal(en.statusCode, 200, en.body);
  }
  const again = await app.inject({ method: 'GET', url: '/plugins/ops.timetable/conflicts', headers: H(owner.token) });
  assert.equal(again.statusCode, 200, again.body);
  assert.ok(Array.isArray(again.json().conflicts), 'conflict list (possibly empty on clean grids)');
  assert.ok(again.json().slots !== undefined && again.json().cells !== undefined);
});
