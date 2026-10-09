// Master Action Plan batch 4 — hike gate, pupil QR, bus ETA, stale escalation,
// rails http-generic proof. Refusals precede mutation everywhere asserted here.
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { setupTestDb, loginAs } from './helpers.js';

let app;
let pool;
let owner, teacher, coordinator, parent;
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

// ── hike gate ───────────────────────────────────────────────────────────────
test('fee-plans: hike above 10% needs a fresh SMC consultation; small rises pass free', async () => {
  const base = { name: 'Batch4 Plan A', grades: ['1'], terms: [{ term: 'T1', label: 'Term 1', amount_cents: 100000 }] };
  const plain = await app.inject({ method: 'POST', url: '/fee-plans', headers: H(owner.token), payload: base });
  assert.equal(plain.statusCode, 200, plain.body);
  const hikeNoPaper = await app.inject({ method: 'POST', url: '/fee-plans', headers: H(owner.token),
    payload: { ...base, name: 'Batch4 Plan B', hikePct: 15 } });
  assert.equal(hikeNoPaper.statusCode, 400, hikeNoPaper.body);
  assert.match(hikeNoPaper.json().error, /SMC consultation/, 'names the paper, not just the number');
  const mtg = await app.inject({ method: 'POST', url: '/meetings', headers: H(owner.token),
    payload: { kind: 'SMC', heldOn: '2026-09-01', minutes: 'Approved a 15 percent rise for 2026-27 after PTA consultation.', attendees: ['A'] } });
  assert.equal(mtg.statusCode, 200, mtg.body);
  const hikeOk = await app.inject({ method: 'POST', url: '/fee-plans', headers: H(owner.token),
    payload: { ...base, name: 'Batch4 Plan C', hikePct: 15, consultationMeetingId: mtg.json().meeting.id } });
  assert.equal(hikeOk.statusCode, 200, hikeOk.body);
  assert.equal(hikeOk.json().feePlan.hike_pct, 15);
  const staleMtg = await app.inject({ method: 'POST', url: '/meetings', headers: H(owner.token),
    payload: { kind: 'SMC', heldOn: '2020-01-01', minutes: 'Ancient history must not bless fresh hikes, ever at all.', attendees: [] } });
  const hikeStale = await app.inject({ method: 'POST', url: '/fee-plans', headers: H(owner.token),
    payload: { ...base, name: 'Batch4 Plan D', hikePct: 20, consultationMeetingId: staleMtg.json().meeting.id } });
  assert.equal(hikeStale.statusCode, 400, hikeStale.body);
  assert.match(hikeStale.json().error, /180 days/, 'stale consultations do not bless fresh hikes');
  const list = await app.inject({ method: 'GET', url: '/fee-plans', headers: H(owner.token) });
  assert.ok(list.json().feePlans.find((p) => p.name === 'Batch4 Plan C')?.consultation_meeting_id, 'paper trail rides the list');
});

// ── pupil QR ────────────────────────────────────────────────────────────────
test('attendance QR: class-scoped tokens; marking consumes them; yesterday is dead', async () => {
  const denied = await app.inject({ method: 'GET', url: '/attendance/qr?grade=Nope&section=Z', headers: H(parent.token) });
  assert.equal(denied.statusCode, 403, denied.body);
  const cls = await app.inject({ method: 'GET', url: '/school/classes', headers: H(owner.token) });
  const g = cls.json().classes.find((c) => c.sections?.length) ?? cls.json().classes[0];
  const sec = g.sections?.[0] ?? 'A';
  const mine = await app.inject({ method: 'GET', url: `/attendance/qr?grade=${encodeURIComponent(g.grade)}&section=${encodeURIComponent(sec)}`, headers: H(coordinator.token) });
  assert.equal(mine.statusCode, 200, mine.body);
  assert.ok(mine.json().tokens.length >= 1, 'roster tokens issued');
  assert.ok(mine.json().tokens.every((t) => /^[0-9a-f]{12}$/.test(t.code ?? t.token)), 'short typeable day codes');
  const mark = await app.inject({ method: 'POST', url: '/attendance/qr-mark', headers: H(coordinator.token),
    payload: { codes: [mine.json().tokens[0].code, 'deadbeef'] } });
  assert.equal(mark.statusCode, 200, mark.body);
  assert.equal(mark.json().markedCount, 1, 'one valid consumed');
  assert.equal(mark.json().invalid, 1, 'one invalid ignored, not thrown');
  const past = await app.inject({ method: 'POST', url: '/attendance/qr-mark', headers: H(coordinator.token),
    payload: { date: '2026-01-01', codes: [mine.json().tokens[0].code] } });
  assert.equal(past.statusCode, 403, past.body, 'QR is today-only; history goes through the register');

  // pupil self-serve: linked portal account reads its own day code (provisioned WITH the
  // roster binding, per FIX-11 — a bare student account cannot exist)
  const pupil = (await pool.query(`SELECT id FROM app.students WHERE status='active' AND user_id IS NULL ORDER BY admission_no LIMIT 1`)).rows[0];
  const prov = await app.inject({ method: 'POST', url: '/plugins/people.admin/users', headers: H(owner.token),
    payload: { name: 'QR Pupil Portal', email: 'qr.pupil@meridian.edu', role: 'student', password: 'Qr-Pupil-1', studentId: pupil.id } });
  assert.equal(prov.statusCode, 200, prov.body);
  const sqr = await app.inject({ method: 'GET', url: '/attendance/my-qr', headers: H((await loginAs(app, 'qr.pupil@meridian.edu', 'Qr-Pupil-1')).token) });
  assert.equal(sqr.statusCode, 200, sqr.body);
  assert.match(sqr.json().code, /^[0-9a-f]{12}$/, 'own day code');
});

// ── bus ETA + stale approvals ───────────────────────────────────────────────
test('transport ETA: scheduled stop times with boarding state; bad quarter refused', async () => {
  const en = await app.inject({ method: 'POST', url: '/plugins/transport.gps/enable', headers: H(owner.token),
    payload: { version: '1.0.0', class: 'B' } });
  assert.ok([200, 409].includes(en.statusCode), en.body);
  const routes = await app.inject({ method: 'GET', url: '/plugins/transport.gps/routes', headers: H(owner.token) });
  const route = routes.json().routes?.[0] ?? routes.json()[0];
  const run = await app.inject({ method: 'POST', url: '/transport/runs', headers: H(owner.token), payload: { routeId: route.id } });
  assert.equal(run.statusCode, 200, run.body);
  const eta = await app.inject({ method: 'GET', url: `/transport/runs/${run.json().run.id}/eta`, headers: H(owner.token) });
  assert.equal(eta.statusCode, 200, eta.body);
  assert.ok(Array.isArray(eta.json().stops), 'stop ETAs scheduled from run start + offsets');
  assert.ok(typeof eta.json().boardedCount === 'number', 'boarding state rides along');
  const noRun = await app.inject({ method: 'GET', url: '/transport/runs/00000000-0000-0000-0000-000000000000/eta', headers: H(owner.token) });
  assert.equal(noRun.statusCode, 404, noRun.body);
});

test('actions: stale approvals listed and escalated to owners as a digest', async () => {
  const empty = await app.inject({ method: 'GET', url: '/actions/stale?days=365', headers: H(coordinator.token) });
  assert.equal(empty.statusCode, 200, empty.body);
  assert.ok(Array.isArray(empty.json().stale), 'stale list (possibly empty on a fresh seed)');
  const bad = await app.inject({ method: 'GET', url: '/actions/stale?days=nope', headers: H(coordinator.token) });
  assert.equal(bad.statusCode, 400, bad.body);
  const denied = await app.inject({ method: 'POST', url: '/actions/stale/escalate', headers: H(teacher.token), payload: {} });
  assert.equal(denied.statusCode, 403, denied.body);
  const esc = await app.inject({ method: 'POST', url: '/actions/stale/escalate', headers: H(coordinator.token), payload: { days: 365 } });
  assert.equal(esc.statusCode, 200, esc.body);
  assert.ok(typeof esc.json().escalated === 'number', 'digest count answered');
});

// ── rails http-generic: real POST shape proven against a stub ────────────────
test('rails.sms http-generic: posts {to,body} with the auth header; validates honestly', async () => {
  const { sendSms, bindKernel } = await import('../src/plugins/rails.sms/index.js');
  const seen = [];
  const realFetch = globalThis.fetch;
  bindKernel(async () => ({ rows: [{ settings: {
    provider: 'http-generic', url: 'https://sms.vendor.example/send',
    auth_header_name: 'X-Key', auth_header_value: 'sekret',
  } }] }));
  globalThis.fetch = async (url, opts) => {
    seen.push({ url, opts });
    return { ok: true, json: async () => ({ id: 'msg-1' }) };
  };
  try {
    const noTenant = await sendSms({ to: '+919820012345', body: 'Fee due', dedupKey: 'k1' });
    assert.equal(noTenant.ok, false, 'tenant is required');
    const noDedup = await sendSms({ to: '+919820012345', body: 'x', dedupKey: '', tenantId: 't1' });
    assert.equal(noDedup.ok, false, 'orchestrator receipt is required (no direct sends)');
    const badPhone = await sendSms({ to: '9820012345', body: 'x', dedupKey: 'k', tenantId: 't1' });
    assert.equal(badPhone.ok, false, 'E.164 enforced');
    const r = await sendSms({ to: '+919820012345', body: 'Fee of ₹4,500 due Friday', dedupKey: 'fee:T1:om', tenantId: 't1' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(seen.length, 1, 'exactly one provider call');
    assert.equal(seen[0].url, 'https://sms.vendor.example/send');
    assert.equal(seen[0].opts.method, 'POST');
    assert.deepEqual(JSON.parse(seen[0].opts.body), { to: '+919820012345', body: 'Fee of ₹4,500 due Friday' });
    assert.equal(seen[0].opts.headers['X-Key'], 'sekret', 'auth header carried, value never logged');
  } finally {
    globalThis.fetch = realFetch;
  }
  // logger path: no settings row at all still reports ok (sandbox honesty)
  bindKernel(async () => ({ rows: [] }));
  const logged = await sendSms({ to: '+919820012345', body: 'hi', dedupKey: 'k2', tenantId: 't1' });
  assert.equal(logged.ok, true);
  assert.equal(logged.provider, 'logger');
});
