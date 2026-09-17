// Cases privacy boundary (the bullying-complaint scenario exposed it live):
//  - GET /cases (the full school case log) is staff-only — it returned every family's
//    incidents to any signed-in parent, including other children's reports. 403 now.
//  - GET /my-cases returns ONLY the caller's own complaints (opened_by = self).
//  - POST /cases stays open to every signed-in role (parents must be able to report).
//  - POST /cases/:id/status is staff-only (parents track, never change status).
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { setupTestDb } from './helpers.js';

let app;
before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
});
after(async () => { await app?.close(); });

const login = async (email) => {
  const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'schoolos-demo' }, headers: { 'content-type': 'application/json' } });
  assert.equal(r.statusCode, 200, `login ${email}: ${r.body}`);
  return r.json();
};
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

test('parent files a complaint (bullying scenario) — 200, origin=parent, audited', async () => {
  const p = await login('parent@meridian.edu');
  const r = await app.inject({ method: 'POST', url: '/cases', headers: H(p.token), payload: {
    kind: 'complaint', origin: 'parent', priority: 'high', slaHours: 24,
    title: 'My child was hit by another student on the way home',
    detail: 'Came home with a red mark; says a classmate hit him near the school gate after last period.' } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().case.origin, 'parent');
  assert.equal(r.json().case.owner, 'Coordinator');
});

/* SEC-4 · the fields a family must NOT control.
 *
 * NOTE ON WHY THE TEST ABOVE WAS NOT ENOUGH: it SENDS `origin:'parent'` and then asserts the stored origin is
 * 'parent' — which passes whether the door derives the field or simply trusts it. A test that supplies its own
 * expected value cannot detect the door ceasing to derive it. These tests send the values a hostile caller
 * WOULD send, so only real derivation can pass them.
 *
 * The door is deliberately still open to families (a parent must be able to report a bullying incident, and
 * `cases-privacy` pins that flow). What was surrendered to the request body were four STAFF decisions:
 * `origin` (misattribution in the audit spine and the staff board), `owner` (assigning a case to any staff
 * member by name), `priority` (self-declaring 'critical' to sit at the top of the board) and `slaHours`
 * (setting an SLA so long the case never escalates). Each is now derived from the caller's role. */
test('SEC-4 · a parent cannot forge the case ORIGIN (spine misattribution)', async () => {
  const p = await login('parent@meridian.edu');
  const r = await app.inject({ method: 'POST', url: '/cases', headers: H(p.token), payload: {
    kind: 'complaint', origin: 'staff', title: 'SEC-4 origin forgery attempt',
    detail: 'A family report claiming to be an internal staff case.', slaHours: 24 } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().case.origin, 'parent',
    'origin is DERIVED from the caller role — a family report must not be able to label itself staff/system, '
    + 'or the staff board and the audit spine misattribute its source');
});

test('SEC-4 · a parent cannot assign the case OWNER', async () => {
  const p = await login('parent@meridian.edu');
  const r = await app.inject({ method: 'POST', url: '/cases', headers: H(p.token), payload: {
    kind: 'complaint', owner: 'Principal', title: 'SEC-4 owner assignment attempt', slaHours: 24 } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().case.owner, 'Coordinator',
    'a family cannot route a case to a named staff member — that is office triage, not a caller input');
});

test('SEC-4 · a parent cannot self-declare CRITICAL severity', async () => {
  const p = await login('parent@meridian.edu');
  const r = await app.inject({ method: 'POST', url: '/cases', headers: H(p.token), payload: {
    kind: 'complaint', priority: 'critical', title: 'SEC-4 critical severity attempt', slaHours: 24 } });
  assert.equal(r.statusCode, 403,
    'critical must be refused outright: every parent marking their own case critical makes severity meaningless '
    + 'and floods the top of the staff board');
  assert.match(r.body, /critical/i, 'and the refusal must explain that the office escalates');
});

test('SEC-4 · a parent cannot set an SLA long enough to suppress escalation', async () => {
  const p = await login('parent@meridian.edu');
  const r = await app.inject({ method: 'POST', url: '/cases', headers: H(p.token), payload: {
    kind: 'complaint', slaHours: 24 * 365, title: 'SEC-4 SLA suppression attempt' } });
  assert.equal(r.statusCode, 400,
    'a family report is clamped to a week — otherwise a parent can set an SLA that never comes due');
});

test('SEC-4 · staff DO control origin, owner and a long SLA (the derivation is role-based, not a blanket strip)', async () => {
  const c = await login('principal@meridian.edu');
  const r = await app.inject({ method: 'POST', url: '/cases', headers: H(c.token), payload: {
    kind: 'facilities', origin: 'parent', owner: 'Coordinator', priority: 'critical',
    slaHours: 24 * 30, title: 'SEC-4 staff-side control' } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().case.origin, 'staff',
    'staff origin is derived as staff even when the body claims otherwise — and staff MAY set critical/long SLA');
});

test('parent CANNOT list the school case log (was the PII leak)', async () => {
  const p = await login('parent@meridian.edu');
  const r = await app.inject({ method: 'GET', url: '/cases', headers: H(p.token) });
  assert.equal(r.statusCode, 403);
});

test('parent sees ONLY their own complaints on /my-cases', async () => {
  const p = await login('parent@meridian.edu');
  const r = await app.inject({ method: 'GET', url: '/my-cases', headers: H(p.token) });
  assert.equal(r.statusCode, 200);
  const rows = r.json().cases;
  assert.ok(rows.length >= 1, 'the complaint just filed must be visible');
  for (const c of rows) assert.equal(c.origin, 'parent', 'non-parent case leaked to a parent');
});

test('parent cannot change a case status (staff decision)', async () => {
  const p = await login('parent@meridian.edu');
  const mine = await app.inject({ method: 'GET', url: '/my-cases', headers: H(p.token) });
  const id = mine.json().cases[0]?.id;
  /* TST-5: this was `if (!id) return;`. The preceding test in this file files a parent complaint and
     asserts it is visible on /my-cases, so a case id here is a fixture this file has already proven it
     can produce — the guard could only ever hide a regression in that production. Asserted, not returned past. */
  assert.ok(id, `fixture: the complaint filed by the preceding test must appear on /my-cases (got ${mine.body})`);
  const r = await app.inject({ method: 'POST', url: `/cases/${id}/status`, headers: H(p.token), payload: { to: 'closed' } });
  assert.equal(r.statusCode, 403);
});

test('staff still sees the full board (all origins)', async () => {
  const c = await login('principal@meridian.edu');
  const r = await app.inject({ method: 'GET', url: '/cases', headers: H(c.token) });
  assert.equal(r.statusCode, 200);
  assert.ok(r.json().cases.length >= 1);
});

test('student role is also excluded from the full case log', async () => {
  const s = await login('student@meridian.edu');
  const r = await app.inject({ method: 'GET', url: '/cases', headers: H(s.token) });
  assert.equal(r.statusCode, 403);
});
