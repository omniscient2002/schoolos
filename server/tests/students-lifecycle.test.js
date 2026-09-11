// L3-2.1 — student lifecycle doors (people.admin): PATCH core fields · withdraw ·
// promote. Pins under test: PATCH edits core fields and is audited but can NOT touch
// identity anchors or bypass the transfer door's history invariant · withdraw sets
// status='transferred', unassigns the bus, and KEEPS attendance/fees/guardian links ·
// promote advances one class with the transfer door's history-row invariant ·
// negatives: parent/student 403, coordinator 403 on withdraw (owner/principal only),
// 409s on inactive/terminal/no-op, 400s on bad input. Style: tests/wave-b.test.js ·
// WRITE-ONLY in-lane (D-10: the orchestrator runs the suite against the shared DB).
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { setupTestDb, loginAs } from './helpers.js';

let app;
let pool;
let owner, coordinator, parent, student; // tokens cached (login limiter: 20/min)
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  pool = (await import('../src/db.js')).pool;
  owner = await loginAs(app, 'owner@meridian.edu');
  coordinator = await loginAs(app, 'coordinator@meridian.edu');
  parent = await loginAs(app, 'parent@meridian.edu');
  student = await loginAs(app, 'student@meridian.edu');
  const tenantId = (await pool.query(`SELECT tenant_id FROM app.users WHERE email='owner@meridian.edu'`)).rows[0].tenant_id;
  const en = await app.inject({ method: 'POST', url: '/plugins/people.admin/enable', headers: H(owner.token), payload: { version: '1.0.0', class: 'B' } });
  assert.equal(en.statusCode, 200, `enable people.admin: ${en.body}`);
  // Aarav (8-B, bus 'Route 7', guardian + attendance + fee rows seeded) + one other active student
  const aarav = (await pool.query(`SELECT id, grade, section, bus_route FROM app.students WHERE tenant_id=$1 AND name='Aarav Sharma' AND status='active'`, [tenantId])).rows[0];
  const other = (await pool.query(`SELECT id, grade, section FROM app.students WHERE tenant_id=$1 AND status='active' AND name <> 'Aarav Sharma' ORDER BY admission_no LIMIT 1`, [tenantId])).rows[0];
  const mk = async (grade, section, admission) => (await pool.query(
    `INSERT INTO app.students (tenant_id, admission_no, name, grade, section, guardian_name, guardian_phone, source, source_ref)
     VALUES ($1,$2,$3,$4,$5,'Test Guardian','+91 9800000000','migration','l3-2.1 fixture') RETURNING id`,
    [tenantId, admission, `Fixture ${grade}-${section}`, grade, section])).rows[0].id;
  globalThis.__sl = {
    tenantId,
    aaravId: aarav.id, aaravGrade: aarav.grade, aaravSection: aarav.section, aaravBus: aarav.bus_route,
    otherId: other.id, otherGrade: other.grade, otherSection: other.section,
    lkgId: await mk('LKG', 'A', `MER-SL-1`),
    twelveId: await mk('12', 'A', `MER-SL-2`),
    weirdId: await mk('Drama', 'A', `MER-SL-3`),
    noneId: '00000000-0000-0000-0000-000000000000',
  };
  assert.equal(globalThis.__sl.aaravBus, 'Route 7', 'fixture expects Aarav to ride a bus (seed i%3===0)');
});

after(async () => { await app?.close(); });

// ── PATCH /students/:id — core fields ───────────────────────────────────────────
test('lifecycle: PATCH updates guardian phone + bus route, is audited, and emits the event', async () => {
  const { aaravId, tenantId } = globalThis.__sl;
  const r = await app.inject({ method: 'PATCH', url: `/plugins/people.admin/students/${aaravId}`, headers: H(owner.token),
    payload: { guardian_phone: '+91 9876500000', bus_route: 'Route 4' } });
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  assert.ok(body.changed.length >= 2, `both changes reported: ${JSON.stringify(body.changed)}`);
  const row = (await pool.query(`SELECT guardian_phone, bus_route FROM app.students WHERE id=$1`, [aaravId])).rows[0];
  assert.equal(row.guardian_phone, '+91 9876500000');
  assert.equal(row.bus_route, 'Route 4');
  const audit = (await pool.query(`SELECT action, outcome FROM app.audit_log WHERE record_type='Student' AND record_ref=$1 AND action='Student record updated' ORDER BY created_at DESC LIMIT 1`, [aaravId])).rows[0];
  assert.ok(audit, 'PATCH is in the audit ledger');
  assert.match(audit.outcome, /guardian_phone updated/);
  const ev = (await pool.query(`SELECT id FROM app.outbox WHERE tenant_id=$1 AND topic='people.student.updated' ORDER BY created_at DESC LIMIT 1`, [tenantId])).rows[0];
  assert.ok(ev, 'people.student.updated event emitted');
});

test('lifecycle: PATCH empty-string clears an optional field; empty name is refused', async () => {
  const { aaravId } = globalThis.__sl;
  const clr = await app.inject({ method: 'PATCH', url: `/plugins/people.admin/students/${aaravId}`, headers: H(owner.token), payload: { bus_route: '' } });
  assert.equal(clr.statusCode, 200, clr.body);
  const row = (await pool.query(`SELECT bus_route FROM app.students WHERE id=$1`, [aaravId])).rows[0];
  assert.equal(row.bus_route, null, 'empty string clears bus_route');
  const bad = await app.inject({ method: 'PATCH', url: `/plugins/people.admin/students/${aaravId}`, headers: H(owner.token), payload: { name: '   ' } });
  assert.equal(bad.statusCode, 400, bad.body);
  assert.match(bad.json().error, /name can't be empty/i);
});

test('lifecycle: PATCH can NOT change grade/section (transfer-door invariant) nor identity anchors', async () => {
  const { aaravId } = globalThis.__sl;
  const g = await app.inject({ method: 'PATCH', url: `/plugins/people.admin/students/${aaravId}`, headers: H(owner.token), payload: { grade: '9' } });
  assert.equal(g.statusCode, 409, g.body);
  assert.match(g.json().error, /transfer door/i);
  const an = await app.inject({ method: 'PATCH', url: `/plugins/people.admin/students/${aaravId}`, headers: H(owner.token), payload: { admission_no: 'MER-HACK' } });
  assert.equal(an.statusCode, 409, an.body);
  const st = await app.inject({ method: 'PATCH', url: `/plugins/people.admin/students/${aaravId}`, headers: H(owner.token), payload: { status: 'alumni' } });
  assert.equal(st.statusCode, 409, st.body);
  const none = await app.inject({ method: 'PATCH', url: `/plugins/people.admin/students/${aaravId}`, headers: H(owner.token), payload: {} });
  assert.equal(none.statusCode, 400, none.body);
});

test('lifecycle: PATCH rejects over-long values', async () => {
  const { aaravId } = globalThis.__sl;
  const r = await app.inject({ method: 'PATCH', url: `/plugins/people.admin/students/${aaravId}`, headers: H(owner.token), payload: { name: 'x'.repeat(121) } });
  assert.equal(r.statusCode, 400, r.body);
  assert.match(r.json().error, /120 characters/);
});

test('lifecycle: parent and student get 403 on PATCH (roster authority is staff-only)', async () => {
  const { aaravId } = globalThis.__sl;
  for (const who of [parent, student]) {
    const r = await app.inject({ method: 'PATCH', url: `/plugins/people.admin/students/${aaravId}`, headers: H(who.token), payload: { name: 'Renamed' } });
    assert.equal(r.statusCode, 403, `${who === parent ? 'parent' : 'student'}: ${r.body}`);
  }
});

// ── POST /students/:id/withdraw ─────────────────────────────────────────────────
test('lifecycle: withdraw sets transferred, unassigns the bus, and KEEPS attendance/fees/guardians — all in one transaction', async () => {
  const { aaravId, tenantId } = globalThis.__sl;
  const before = {
    att: (await pool.query(`SELECT count(*)::int AS c FROM app.attendance WHERE student_id=$1`, [aaravId])).rows[0].c,
    fees: (await pool.query(`SELECT count(*)::int AS c FROM app.fee_obligations WHERE student_id=$1`, [aaravId])).rows[0].c,
    guardians: (await pool.query(`SELECT count(*)::int AS c FROM app.guardians WHERE student_id=$1`, [aaravId])).rows[0].c,
  };
  const r = await app.inject({ method: 'POST', url: `/plugins/people.admin/students/${aaravId}/withdraw`, headers: H(owner.token),
    payload: { reason: 'Family relocated to Pune', effective_date: '2026-04-01', last_school: '—' } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().student.status, 'transferred');
  const row = (await pool.query(`SELECT status, bus_route FROM app.students WHERE id=$1`, [aaravId])).rows[0];
  assert.equal(row.status, 'transferred');
  assert.equal(row.bus_route, null, 'bus seat released');
  const after2 = {
    att: (await pool.query(`SELECT count(*)::int AS c FROM app.attendance WHERE student_id=$1`, [aaravId])).rows[0].c,
    fees: (await pool.query(`SELECT count(*)::int AS c FROM app.fee_obligations WHERE student_id=$1`, [aaravId])).rows[0].c,
    guardians: (await pool.query(`SELECT count(*)::int AS c FROM app.guardians WHERE student_id=$1`, [aaravId])).rows[0].c,
  };
  assert.equal(after2.att, before.att, 'attendance kept');
  assert.equal(after2.fees, before.fees, 'fees kept');
  assert.equal(after2.guardians, before.guardians, 'parent links preserved');
  const audit = (await pool.query(`SELECT risk, outcome FROM app.audit_log WHERE record_type='Student' AND record_ref=$1 AND action='Student withdrawn' ORDER BY created_at DESC LIMIT 1`, [aaravId])).rows[0];
  assert.ok(audit, 'withdrawal is in the audit ledger');
  assert.equal(audit.risk, 'high');
  assert.match(audit.outcome, /effective 2026-04-01/);
  const ev = (await pool.query(`SELECT payload FROM app.outbox WHERE tenant_id=$1 AND topic='people.student.withdrawn' ORDER BY created_at DESC LIMIT 1`, [tenantId])).rows[0];
  assert.ok(ev, 'people.student.withdrawn event emitted');
  assert.equal(ev.payload.busUnassigned, true);
  assert.equal(ev.payload.attendanceKept, true);
});

test('lifecycle: withdraw is owner/principal-only (coordinator 403, student 403) and refuses inactive/nonexistent', async () => {
  const { aaravId, noneId, otherId } = globalThis.__sl;
  const coord = await app.inject({ method: 'POST', url: `/plugins/people.admin/students/${otherId}/withdraw`, headers: H(coordinator.token), payload: { reason: 'not allowed at this rank' } });
  assert.equal(coord.statusCode, 403, coord.body);
  const stu = await app.inject({ method: 'POST', url: `/plugins/people.admin/students/${aaravId}/withdraw`, headers: H(student.token), payload: { reason: 'nope' } });
  assert.equal(stu.statusCode, 403, stu.body);
  const again = await app.inject({ method: 'POST', url: `/plugins/people.admin/students/${aaravId}/withdraw`, headers: H(owner.token), payload: { reason: 'double exit' } });
  assert.equal(again.statusCode, 409, again.body);
  assert.match(again.json().error, /transferred/);
  const ghost = await app.inject({ method: 'POST', url: `/plugins/people.admin/students/${noneId}/withdraw`, headers: H(owner.token), payload: { reason: 'ghost' } });
  assert.equal(ghost.statusCode, 404, ghost.body);
  const noReason = await app.inject({ method: 'POST', url: `/plugins/people.admin/students/${otherId}/withdraw`, headers: H(owner.token), payload: {} });
  assert.equal(noReason.statusCode, 400, noReason.body);
  const badDate = await app.inject({ method: 'POST', url: `/plugins/people.admin/students/${otherId}/withdraw`, headers: H(owner.token), payload: { reason: 'date check', effective_date: '01-04-2026' } });
  assert.equal(badDate.statusCode, 400, badDate.body);
  assert.match(badDate.json().error, /2026-04-01/);
});

// ── POST /students/:id/promote ──────────────────────────────────────────────────
test('lifecycle: promote advances one class, keeps the section, writes the history row — same invariant as transfer', async () => {
  const { otherId, otherGrade, otherSection, tenantId } = globalThis.__sl;
  const r = await app.inject({ method: 'POST', url: `/plugins/people.admin/students/${otherId}/promote`, headers: H(owner.token), payload: {} });
  assert.equal(r.statusCode, 200, r.body);
  const expected = String(Number(otherGrade) + 1);
  assert.equal(r.json().student.grade, expected);
  assert.equal(r.json().student.section, otherSection, 'section policy: keep unless told');
  const hist = (await pool.query(`SELECT from_grade, to_grade, from_section, to_section FROM app.enrollment_history WHERE student_id=$1 ORDER BY created_at DESC LIMIT 1`, [otherId])).rows[0];
  assert.equal(hist.from_grade, otherGrade);
  assert.equal(hist.to_grade, expected);
  const ev = (await pool.query(`SELECT id FROM app.outbox WHERE tenant_id=$1 AND topic='people.student.promoted' ORDER BY created_at DESC LIMIT 1`, [tenantId])).rows[0];
  assert.ok(ev, 'people.student.promoted event emitted');
});

test('lifecycle: promote honours to_section, LKG→UKG→1, refuses grade 12 and non-advancing grades', async () => {
  const { otherId, lkgId, twelveId, weirdId } = globalThis.__sl;
  const sec = await app.inject({ method: 'POST', url: `/plugins/people.admin/students/${otherId}/promote`, headers: H(owner.token), payload: { to_section: 'C' } });
  assert.equal(sec.statusCode, 200, sec.body);
  assert.equal(sec.json().student.section, 'C');
  const lkg = await app.inject({ method: 'POST', url: `/plugins/people.admin/students/${lkgId}/promote`, headers: H(owner.token), payload: {} });
  assert.equal(lkg.statusCode, 200, lkg.body);
  assert.equal(lkg.json().student.grade, 'UKG');
  const term = await app.inject({ method: 'POST', url: `/plugins/people.admin/students/${twelveId}/promote`, headers: H(owner.token), payload: {} });
  assert.equal(term.statusCode, 409, term.body);
  assert.match(term.json().error, /final class/i);
  const weird = await app.inject({ method: 'POST', url: `/plugins/people.admin/students/${weirdId}/promote`, headers: H(owner.token), payload: {} });
  assert.equal(weird.statusCode, 400, weird.body);
  assert.match(weird.json().error, /to_grade/);
  const jump = await app.inject({ method: 'POST', url: `/plugins/people.admin/students/${otherId}/promote`, headers: H(owner.token), payload: { to_grade: '12' } });
  assert.equal(jump.statusCode, 409, jump.body);
  assert.match(jump.json().error, /one class at a time/);
});

test('lifecycle: parent/student get 403 on promote; promote of a withdrawn student is 409; unknown id is 404', async () => {
  const { otherId, aaravId, noneId } = globalThis.__sl;
  const par = await app.inject({ method: 'POST', url: `/plugins/people.admin/students/${otherId}/promote`, headers: H(parent.token), payload: {} });
  assert.equal(par.statusCode, 403, par.body);
  const stu = await app.inject({ method: 'POST', url: `/plugins/people.admin/students/${otherId}/promote`, headers: H(student.token), payload: {} });
  assert.equal(stu.statusCode, 403, stu.body);
  const out = await app.inject({ method: 'POST', url: `/plugins/people.admin/students/${aaravId}/promote`, headers: H(owner.token), payload: {} });
  assert.equal(out.statusCode, 409, out.body);
  assert.match(out.json().error, /transferred/);
  const ghost = await app.inject({ method: 'POST', url: `/plugins/people.admin/students/${noneId}/promote`, headers: H(owner.token), payload: {} });
  assert.equal(ghost.statusCode, 404, ghost.body);
});
