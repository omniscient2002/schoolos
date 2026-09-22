// STU-GAP-9 / J-S4 · server-enforced idle for student kiosk sessions.
//
// The kiosk UI counts down, but the server must end a shared/stolen session too. A gap between
// authenticated requests beyond the idle window answers 401 with `idleExpired`. This file sets a
// tiny window so the expiry is observable without a 10-minute wait.
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

test('STU-GAP-9 · a student session expires server-side after the idle window', async () => {
  process.env.STUDENT_IDLE_TIMEOUT_MS = '80';
  try {
    const s = await loginAs(app, 'student@meridian.edu');
    const first = await app.inject({ method: 'GET', url: '/me', headers: H(s.token) });
    assert.equal(first.statusCode, 200, first.body);
    await new Promise((r) => setTimeout(r, 160));
    const expired = await app.inject({ method: 'GET', url: '/me', headers: H(s.token) });
    assert.equal(expired.statusCode, 401, expired.body);
    assert.equal(expired.json().idleExpired, true, 'the refusal names the idle expiry');
  } finally { delete process.env.STUDENT_IDLE_TIMEOUT_MS; }
});

test('STU-GAP-9 · a staff session is not subject to the student idle window', async () => {
  process.env.STUDENT_IDLE_TIMEOUT_MS = '80';
  try {
    const t = await loginAs(app, 'teacher@meridian.edu');
    await new Promise((r) => setTimeout(r, 160));
    const ok = await app.inject({ method: 'GET', url: '/me', headers: H(t.token) });
    assert.equal(ok.statusCode, 200, 'staff sessions keep their normal TTL');
  } finally { delete process.env.STUDENT_IDLE_TIMEOUT_MS; }
});
