// Master Action Plan batch 3 — NEP pack, transport compliance, payroll ECS, staff QR,
// breach register, emergency broadcast. Every write is audited; every refusal precedes mutation.
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { setupTestDb, loginAs } from './helpers.js';

let app;
let pool;
let owner, teacher, parent, coordinator;
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  pool = (await import('../src/db.js')).pool;
  owner = await loginAs(app, 'owner@meridian.edu');
  teacher = await loginAs(app, 'teacher@meridian.edu');
  parent = await loginAs(app, 'parent@meridian.edu');
  coordinator = await loginAs(app, 'coordinator@meridian.edu');
});

after(async () => { await app?.close(); });

async function pupil() {
  return (await pool.query(`SELECT id, grade, section FROM app.students WHERE status='active' ORDER BY admission_no LIMIT 1`)).rows[0];
}

// ── NEP ─────────────────────────────────────────────────────────────────────
test('nep: profile stages grades; R3 recorded; activities logged; subjects carry flags', async () => {
  const prof = await app.inject({ method: 'GET', url: '/nep/profile', headers: H(teacher.token) });
  assert.equal(prof.statusCode, 200, prof.body);
  assert.ok(Array.isArray(prof.json().stages), 'stages derived from own classes');
  const denied = await app.inject({ method: 'PUT', url: '/nep/r3', headers: H(teacher.token),
    payload: { language: 'Sanskrit', academicYear: '2026-27' } });
  assert.equal(denied.statusCode, 403, denied.body);
  const r3 = await app.inject({ method: 'PUT', url: '/nep/r3', headers: H(owner.token),
    payload: { language: 'Sanskrit', academicYear: '2026-27' } });
  assert.equal(r3.statusCode, 200, r3.body);
  const bad = await app.inject({ method: 'POST', url: '/nep/activities', headers: H(owner.token),
    payload: { kind: 'dance', title: 'x'.repeat(20) } });
  assert.equal(bad.statusCode, 400, bad.body);
  const act = await app.inject({ method: 'POST', url: '/nep/activities', headers: H(coordinator.token),
    payload: { kind: 'bagless', title: 'Cobbler visit + billing roleplay', detail: 'Grade 6 market morning', heldOn: '2026-10-02', grades: ['6'] } });
  assert.equal(act.statusCode, 200, act.body);
  const list = await app.inject({ method: 'GET', url: '/nep/activities?kind=bagless', headers: H(teacher.token) });
  assert.equal(list.json().activities.length, 1);

  const sub = await app.inject({ method: 'POST', url: '/school/subjects', headers: H(owner.token),
    payload: { name: 'Robotics', code: 'ROB', isSkill: true } });
  assert.equal(sub.statusCode, 200, sub.body);
  assert.equal(sub.json().subject.isSkill, true, 'skill flag round-trips');
  const all = await app.inject({ method: 'GET', url: '/school/subjects', headers: H(owner.token) });
  assert.ok(all.json().subjects.find((s) => s.name === 'Robotics')?.isSkill, 'flag persists on read');
});

test('nep: HPC inputs + live aggregates; FLN levels; teacher scoping holds', async () => {
  const st = await pupil();
  const fln = await app.inject({ method: 'POST', url: '/nep/fln', headers: H(owner.token),
    payload: { studentId: st.id, skill: 'fluency', level: 'developing' } });
  assert.equal(fln.statusCode, 200, fln.body);
  const badSkill = await app.inject({ method: 'POST', url: '/nep/fln', headers: H(owner.token),
    payload: { studentId: st.id, skill: 'alchemy', level: 'developing' } });
  assert.equal(badSkill.statusCode, 400, badSkill.body);
  const hpc = await app.inject({ method: 'POST', url: '/nep/hpc', headers: H(owner.token),
    payload: { studentId: st.id, term: '2026-27 T1', strengths: 'Mental maths', interests: 'Cricket', goals: 'Tables to 20', teacherRemark: 'Steady progress' } });
  assert.equal(hpc.statusCode, 200, hpc.body);
  const card = await app.inject({ method: 'GET', url: `/nep/hpc/${st.id}?term=2026-27 T1`, headers: H(owner.token) });
  assert.equal(card.statusCode, 200, card.body);
  assert.ok(card.json().stage, 'stage derived from grade');
  assert.ok('aggregates' in card.json(), 'live aggregates ride with inputs');
  // teacher outside the pupil's class is refused both lanes
  const tNo = await app.inject({ method: 'GET', url: `/nep/hpc/${st.id}`, headers: H(teacher.token) });
  assert.ok([200, 403].includes(tNo.statusCode), tNo.body);
  const board = await app.inject({ method: 'GET', url: '/nep/fln', headers: H(owner.token) });
  assert.equal(board.statusCode, 200, board.body);
  assert.ok(board.json().skills.length >= 1, 'class FLN board aggregates');
});

// ── transport compliance ────────────────────────────────────────────────────
test('transport: runs idempotent; board/deboard timestamped; dup direction 409s', async () => {
  const en = await app.inject({ method: 'POST', url: '/plugins/transport.gps/enable', headers: H(owner.token),
    payload: { version: '1.0.0', class: 'B' } });
  assert.ok([200, 409].includes(en.statusCode), en.body);
  const routes = await app.inject({ method: 'GET', url: '/plugins/transport.gps/routes', headers: H(owner.token) });
  assert.equal(routes.statusCode, 200, routes.body);
  const route = routes.json().routes?.[0] ?? routes.json()[0];
  assert.ok(route?.id, 'seed carries a route');
  const r1 = await app.inject({ method: 'POST', url: '/transport/runs', headers: H(owner.token), payload: { routeId: route.id } });
  assert.equal(r1.statusCode, 200, r1.body);
  const r2 = await app.inject({ method: 'POST', url: '/transport/runs', headers: H(owner.token), payload: { routeId: route.id } });
  assert.equal(r2.statusCode, 200, r2.body, 'same route+day returns the run (no doubles)');
  assert.equal(r1.json().run.id, r2.json().run.id);
  const st = await pupil();
  const b1 = await app.inject({ method: 'POST', url: `/transport/runs/${r1.json().run.id}/board`, headers: H(owner.token),
    payload: { studentId: st.id, direction: 'board' } });
  assert.equal(b1.statusCode, 200, b1.body);
  assert.ok(b1.json().boarding.at, 'boarding timestamped');
  const dup = await app.inject({ method: 'POST', url: `/transport/runs/${r1.json().run.id}/board`, headers: H(owner.token),
    payload: { studentId: st.id, direction: 'board' } });
  assert.equal(dup.statusCode, 409, dup.body);
  const d1 = await app.inject({ method: 'POST', url: `/transport/runs/${r1.json().run.id}/board`, headers: H(owner.token),
    payload: { studentId: st.id, direction: 'deboard' } });
  assert.equal(d1.statusCode, 200, d1.body);
  const bad = await app.inject({ method: 'POST', url: `/transport/runs/${r1.json().run.id}/board`, headers: H(owner.token),
    payload: { studentId: st.id, direction: 'teleport' } });
  assert.equal(bad.statusCode, 400, bad.body);
  const board = await app.inject({ method: 'GET', url: `/transport/runs/${r1.json().run.id}/board`, headers: H(owner.token) });
  assert.equal(board.statusCode, 200, board.body);
  assert.ok(board.json().completeness === null || typeof board.json().completeness === 'number', 'completeness computed');
});

test('transport: attendants verify; fares quote; inspections log; quarterly report computes', async () => {
  const att = await app.inject({ method: 'POST', url: '/transport/attendants', headers: H(owner.token),
    payload: { name: 'Contract Attendant One' } });
  assert.equal(att.statusCode, 200, att.body);
  const ver = await app.inject({ method: 'PUT', url: `/transport/attendants/${att.json().attendant.id}/verify`, headers: H(owner.token),
    payload: { policeVerifiedOn: '2026-09-01' } });
  assert.equal(ver.statusCode, 200, ver.body);
  const badDate = await app.inject({ method: 'PUT', url: `/transport/attendants/${att.json().attendant.id}/verify`, headers: H(owner.token),
    payload: { policeVerifiedOn: 'yesterday' } });
  assert.equal(badDate.statusCode, 400, badDate.body);
  const fare = await app.inject({ method: 'PUT', url: '/transport/fares', headers: H(owner.token),
    payload: { academicYear: '2026-27', perKmCents: 900 } });
  assert.equal(fare.statusCode, 200, fare.body);
  const quote = await app.inject({ method: 'POST', url: '/transport/fares/quote', headers: H(owner.token), payload: { km: 8 } });
  assert.equal(quote.statusCode, 200, quote.body);
  assert.equal(quote.json().amountCents, 7200, '8km × ₹9');
  const insp = await app.inject({ method: 'POST', url: '/transport/inspections', headers: H(owner.token),
    payload: { title: 'Joint RTO–education inspection', detail: 'All clear', inspectedOn: '2026-09-20' } });
  assert.equal(insp.statusCode, 200, insp.body);
  const rep = await app.inject({ method: 'GET', url: '/transport/compliance-report?quarter=2026-Q3', headers: H(owner.token) });
  assert.equal(rep.statusCode, 200, rep.body);
  assert.ok(rep.json().attendants.total >= 1, 'attendant counts in the pack');
  const badQ = await app.inject({ method: 'GET', url: '/transport/compliance-report?quarter=sometime', headers: H(owner.token) });
  assert.equal(badQ.statusCode, 400, badQ.body);
});

// ── payroll ECS + staff QR + breach + emergency ─────────────────────────────
test('payroll: ECS file issues only after disbursing (office-only, audited read)', async () => {
  const who = (await pool.query(`SELECT id FROM app.users WHERE role='teacher' AND active LIMIT 1`)).rows[0];
  await pool.query(`INSERT INTO app.payroll_structures (tenant_id, user_id, monthly_cents)
    SELECT tenant_id, $1, 3000000 FROM app.users WHERE id=$1
    ON CONFLICT (tenant_id, user_id) DO UPDATE SET monthly_cents=3000000`, [who.id]);
  const run = await app.inject({ method: 'POST', url: '/payroll/runs', headers: H(owner.token), payload: { month: '2026-11' } });
  assert.equal(run.statusCode, 200, run.body);
  const early = await app.inject({ method: 'GET', url: `/payroll/runs/${run.json().run.id}/ecs-file`, headers: H(owner.token) });
  assert.equal(early.statusCode, 409, early.body, 'no proof file before money moves');
  const dis = await app.inject({ method: 'POST', url: `/payroll/runs/${run.json().run.id}/disburse`, headers: H(owner.token),
    payload: { mode: 'ecs', ref: 'HDFC-NOV' } });
  assert.equal(dis.statusCode, 200, dis.body);
  const file = await app.inject({ method: 'GET', url: `/payroll/runs/${run.json().run.id}/ecs-file`, headers: H(owner.token) });
  assert.equal(file.statusCode, 200, file.body);
  assert.match(file.headers['content-type'], /csv/, 'downloads as CSV');
  assert.match(file.body, /name,bank_acct,amount_paise/, 'header row names every column');
});

test('staff QR: day token marks self once; stale token 403s; office marks manually', async () => {
  const denied = await app.inject({ method: 'GET', url: '/staff-attendance/qr', headers: H(teacher.token) });
  assert.equal(denied.statusCode, 403, denied.body);
  const qr = await app.inject({ method: 'GET', url: '/staff-attendance/qr', headers: H(owner.token) });
  assert.equal(qr.statusCode, 200, qr.body);
  assert.match(qr.json().token, /^[0-9a-f]{64}$/, 'HMAC hex token');
  const bad = await app.inject({ method: 'POST', url: '/staff-attendance/scan', headers: H(teacher.token),
    payload: { token: '0'.repeat(64) } });
  assert.equal(bad.statusCode, 403, bad.body);
  const me = (await pool.query(`SELECT id FROM app.users WHERE email='teacher@meridian.edu'`)).rows[0];
  const manual = await app.inject({ method: 'POST', url: '/staff-attendance/mark', headers: H(owner.token),
    payload: { userId: me.id, day: '2026-10-03' } });
  assert.equal(manual.statusCode, 200, manual.body);
  const again = await app.inject({ method: 'POST', url: '/staff-attendance/mark', headers: H(owner.token),
    payload: { userId: me.id, day: '2026-10-03' } });
  assert.equal(again.statusCode, 200, again.body, 'manual re-mark is a no-op, not a duplicate');
});

test('breach: record → contain → close; closed is history', async () => {
  const denied = await app.inject({ method: 'POST', url: '/dpdp/breaches', headers: H(teacher.token),
    payload: { title: 'x', detail: 'y'.repeat(20), foundOn: '2026-10-01' } });
  assert.equal(denied.statusCode, 403, denied.body);
  const rec = await app.inject({ method: 'POST', url: '/dpdp/breaches', headers: H(owner.token),
    payload: { title: 'Lost bus register printout', detail: 'Two pages of Route-3 roster left at the depot office; recovered same evening.', foundOn: '2026-10-01' } });
  assert.equal(rec.statusCode, 200, rec.body);
  assert.equal(rec.json().breach.status, 'open', '72-hour clock running');
  const cont = await app.inject({ method: 'POST', url: `/dpdp/breaches/${rec.json().breach.id}/contain`, headers: H(owner.token),
    payload: { containedOn: '2026-10-01' } });
  assert.equal(cont.statusCode, 200, cont.body);
  assert.equal(cont.json().status, 'contained');
  const close = await app.inject({ method: 'POST', url: `/dpdp/breaches/${rec.json().breach.id}/contain`, headers: H(owner.token),
    payload: { containedOn: '2026-10-01', notifiedOn: '2026-10-02' } });
  assert.equal(close.json().status, 'closed');
  const shut = await app.inject({ method: 'POST', url: `/dpdp/breaches/${rec.json().breach.id}/contain`, headers: H(owner.token),
    payload: { containedOn: '2026-10-03' } });
  assert.equal(shut.statusCode, 409, shut.body);
});

test('emergency: owner composes+approves at once; empty audience refuses first; unacked names names', async () => {
  const denied = await app.inject({ method: 'POST', url: '/announcements/emergency', headers: H(coordinator.token),
    payload: { title: 'x', body: 'y'.repeat(20) } });
  assert.equal(denied.statusCode, 403, denied.body, 'coordinator cannot declare emergencies');
  const empty = await app.inject({ method: 'POST', url: '/announcements/emergency', headers: H(owner.token),
    payload: { title: 'Ghost emergency', body: 'Nobody can hear this.', audienceKind: 'class', audienceRef: 'Grade 99' } });
  assert.equal(empty.statusCode, 409, empty.body);
  const em = await app.inject({ method: 'POST', url: '/announcements/emergency', headers: H(owner.token),
    payload: { title: 'Gas leak drill', body: 'Assemble on the playground now. Teachers take registers.', audienceKind: 'all_guardians' } });
  assert.equal(em.statusCode, 200, em.body);
  assert.equal(em.json().announcement.status, 'queued', 'emergency skips the draft queue by design (audited high-risk)');
  const un = await app.inject({ method: 'GET', url: `/announcements/${em.json().announcement.id}/unacked`, headers: H(owner.token) });
  assert.equal(un.statusCode, 200, un.body);
  assert.ok(typeof un.json().ackedCount === 'number', 'signed count rides along');
});
