// L2-3.1 (Wave 3) — httpOnly cookie sessions + CSRF double-submit.
// Pins: session cookies issued at login (HttpOnly session + readable csrf),
// cookie-authed GET works without any header, cookie-authed MUTATIONS require
// the X-CSRF-Token echo, bearer API clients stay exempt, logout clears both.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers.js';

let app;

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.ready();
});

const login = async (email, password) => app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
const jar = (res) => Object.fromEntries((res.cookies ?? []).map((c) => [c.name, c.value]));
const cookieHeader = (j) => `schoolos_session=${j.schoolos_session}; schoolos_csrf=${j.schoolos_csrf}`;

describe('L2-3.1 · cookie sessions + CSRF', () => {
  test('login issues HttpOnly session + readable csrf cookies; cookie-authed GET works', async () => {
    const l = await login('principal@meridian.edu', 'schoolos-demo');
    assert.equal(l.statusCode, 200, l.body);
    const j = jar(l);
    assert.ok(j.schoolos_session, 'session cookie present');
    assert.ok(j.schoolos_csrf, 'csrf cookie present');
    const setCookie = l.headers['set-cookie'] ?? [];
    const sessionLine = setCookie.find((c) => c.startsWith('schoolos_session='));
    assert.match(sessionLine, /HttpOnly/i, 'session cookie is HttpOnly');
    assert.match(sessionLine, /SameSite=Lax/i, 'session cookie is SameSite=Lax');
    const me = await app.inject({ method: 'GET', url: '/me', headers: { cookie: cookieHeader(j) } });
    assert.equal(me.statusCode, 200, me.body);
    assert.equal(me.json().email, 'principal@meridian.edu');
  });

  test('cookie-authed mutation requires the CSRF echo', async () => {
    const l = await login('coordinator@meridian.edu', 'schoolos-demo');
    const j = jar(l);
    const payload = { currentPassword: 'schoolos-demo', newPassword: 'coord-cookie-pw-1' };
    const none = await app.inject({ method: 'POST', url: '/me/password', payload, headers: { cookie: cookieHeader(j) } });
    assert.equal(none.statusCode, 403, 'mutation without the header refused');
    assert.match(none.json().error, /CSRF/);
    const wrong = await app.inject({ method: 'POST', url: '/me/password', payload, headers: { cookie: cookieHeader(j), 'x-csrf-token': 'deadbeef' } });
    assert.equal(wrong.statusCode, 403, 'mismatched echo refused');
    const ok = await app.inject({ method: 'POST', url: '/me/password', payload, headers: { cookie: cookieHeader(j), 'x-csrf-token': j.schoolos_csrf } });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(ok.json().mustChange, false);
  });

  test('bearer API clients are CSRF-exempt and unaffected', async () => {
    const l = await login('finance@meridian.edu', 'schoolos-demo');
    const bearer = { authorization: `Bearer ${l.json().token}`, 'content-type': 'application/json' };
    const me = await app.inject({ method: 'GET', url: '/me', headers: bearer });
    assert.equal(me.statusCode, 200);
    const pw = await app.inject({ method: 'POST', url: '/me/password', payload: { currentPassword: 'schoolos-demo', newPassword: 'finance-pw-42' }, headers: bearer });
    assert.equal(pw.statusCode, 200, 'bearer mutation needs no CSRF header');
  });

  test('logout clears the cookies and revokes the jti', async () => {
    const l = await login('technician@meridian.edu', 'schoolos-demo');
    const j = jar(l);
    const out = await app.inject({ method: 'POST', url: '/auth/logout', headers: { cookie: cookieHeader(j), 'x-csrf-token': j.schoolos_csrf } });
    assert.equal(out.statusCode, 200, out.body);
    const cleared = out.headers['set-cookie'] ?? [];
    assert.ok(cleared.some((c) => c.startsWith('schoolos_session=') && /Max-Age=0/.test(c)), 'session cookie cleared');
    assert.ok(cleared.some((c) => c.startsWith('schoolos_csrf=') && /Max-Age=0/.test(c)), 'csrf cookie cleared');
    const after = await app.inject({ method: 'GET', url: '/me', headers: { cookie: cookieHeader(j) } });
    assert.equal(after.statusCode, 401, 'revoked jti dead even with the old cookie value replayed');
  });
});
