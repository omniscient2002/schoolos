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
  if (!id) return;
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
