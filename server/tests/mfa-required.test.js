// C2 · mandatory MFA for privileged roles (config-gated).
//
// REQUIRE_MFA_ROLES is read at config import time, so it is set at module scope BEFORE the app is
// dynamically imported in `before`. Empty by default → no behaviour change; when set, a role in the
// list with no enrolled second factor is restricted to the enrolment door.
process.env.REQUIRE_MFA_ROLES = 'owner';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';

let app;
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.ready();
});
after(async () => { await app?.close(); });

test('C2 · a privileged role without MFA is restricted to enrolment; /me still works', async () => {
  const owner = await loginAs(app, 'owner@meridian.edu');
  const me = await app.inject({ method: 'GET', url: '/me', headers: H(owner.token) });
  assert.equal(me.statusCode, 200, '/me is always reachable so the client can see the requirement');
  const gated = await app.inject({ method: 'GET', url: '/audit', headers: H(owner.token) });
  assert.equal(gated.statusCode, 403, gated.body);
  assert.equal(gated.json().mfaEnrollRequired, true, 'the refusal names the enrolment requirement');
  // the enrolment door is reachable
  const enroll = await app.inject({ method: 'POST', url: '/me/mfa/enroll', headers: H(owner.token), payload: { password: 'schoolos-demo' } });
  assert.notEqual(enroll.statusCode, 403, `enrolment door must be reachable: ${enroll.body}`);
});

test('C2 · a role NOT in REQUIRE_MFA_ROLES is unaffected', async () => {
  const teacher = await loginAs(app, 'teacher@meridian.edu');
  const r = await app.inject({ method: 'GET', url: '/me', headers: H(teacher.token) });
  assert.equal(r.statusCode, 200, 'a non-listed role is not gated');
});
