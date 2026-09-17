// API-3 + API-4 (PERFECT-100 §5.5) — MFA recovery codes are single-use under CONCURRENCY, and the API
// cannot be hung by an unbounded request.
//
// API-3 THE DEFECT: `/me/mfa/verify` read `consumed_at IS NULL`, then ran an UPDATE whose result it
// DISCARDED and set `usedRecovery = true` unconditionally. Two requests carrying the same recovery code both
// passed the read and BOTH were issued a full session — so a leaked recovery code was usable more than once
// for as long as a race could be won. The existing sequential test (l2-mfa) could never see it: it exhausted
// the code before reusing it. This file races the two requests with `Promise.all`, which is the only shape
// that exercises the defect. (TST-9 records that the suite had zero concurrency tests; this is one.)
//
// API-4 THE DEFECT: the Fastify instance set neither `requestTimeout` nor `connectionTimeout`, and the Google
// SSO userinfo/token fetches carried no `AbortSignal`. A hung handler or upstream pinned a connection from the
// single 20-connection pool.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTestDb } from './helpers.js';
import { totpAt } from '../src/totp.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const nowCode = (secret) => totpAt(secret, Math.floor(Date.now() / 1000 / 30));

let app;
before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.ready();
});
after(async () => { await app?.close(); });

/** Provision a fresh staff account, set a real password, enroll MFA, return { recovery }. */
async function enrolledStaff(email, password) {
  const owner = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'owner@meridian.edu', password: 'schoolos-demo' } });
  const enable = await app.inject({ method: 'POST', url: '/plugins/people.admin/enable', headers: H(owner.json().token), payload: { class: 'B', version: '1.0.0' } });
  assert.ok([200, 409].includes(enable.statusCode), enable.body);
  const provision = await app.inject({ method: 'POST', url: '/plugins/people.admin/users', headers: H(owner.json().token), payload: { email, name: 'Race Staff', role: 'coordinator' } });
  assert.ok([200, 201].includes(provision.statusCode), provision.body);
  const temp = provision.json().temporaryPassword;
  const first = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: temp } });
  const pw = await app.inject({ method: 'POST', url: '/me/password', headers: H(first.json().token), payload: { currentPassword: temp, newPassword: password } });
  const real = pw.json().token;
  const enroll = await app.inject({ method: 'POST', url: '/me/mfa/enroll', headers: H(real), payload: { password } });
  const confirm = await app.inject({ method: 'POST', url: '/me/mfa/verify', headers: H(real), payload: { code: nowCode(enroll.json().secret) } });
  assert.equal(confirm.statusCode, 200, confirm.body);
  return { recovery: confirm.json().recoveryCodes };
}

describe('API-3 · a recovery code is single-use even when two requests race', () => {
  test('exactly one of two concurrent uses succeeds; the loser gets the uniform 401', async () => {
    const { recovery } = await enrolledStaff('race.staff@meridian.edu', 'race-pw-2468');
    const challenge = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'race.staff@meridian.edu', password: 'race-pw-2468' } });
    assert.equal(challenge.statusCode, 401);
    const challengeToken = challenge.json().challengeToken;
    const code = recovery[0];
    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: '/me/mfa/verify', payload: { challengeToken, code } }),
      app.inject({ method: 'POST', url: '/me/mfa/verify', payload: { challengeToken, code } }),
    ]);
    const ok = [a, b].filter((r) => r.statusCode === 200).length;
    assert.equal(ok, 1,
      `exactly one concurrent use may succeed, got ${ok} (statuses ${a.statusCode}/${b.statusCode}). `
      + 'Two successes is the API-3 defect: a recovery code consumed twice under a race.');
    assert.equal([a, b].filter((r) => r.statusCode === 401).length, 1, 'the loser is refused, not silently issued a session');
    // and a later sequential reuse is still refused
    const l = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'race.staff@meridian.edu', password: 'race-pw-2468' } });
    const retry = await app.inject({ method: 'POST', url: '/me/mfa/verify', payload: { challengeToken: l.json().challengeToken, code } });
    assert.equal(retry.statusCode, 401, 'the code stays consumed');
  });
});

describe('API-4 · the API cannot be hung by an unbounded request', () => {
  test('the server bounds the request and the connection', () => {
    assert.equal(app.server.requestTimeout, 30_000, 'requestTimeout must be set (API-4)');
    // Fastify maps its `connectionTimeout` option onto the Node server's socket timeout (`server.timeout`).
    assert.equal(app.server.timeout, 10_000, 'connectionTimeout must be set (API-4)');
  });

  test('the Google SSO fetches carry an AbortSignal (source check — the call is unreachable without credentials)', () => {
    const src = readFileSync(join(HERE, '../src/app.js'), 'utf8');
    const google = src.slice(src.indexOf("app.get('/auth/google/callback'"));
    assert.match(google, /AbortSignal\.timeout\(8000\)/, 'both Google fetches must be bounded');
    assert.ok((google.match(/AbortSignal\.timeout\(8000\)/g) ?? []).length >= 2, 'token exchange AND userinfo');
  });
});
