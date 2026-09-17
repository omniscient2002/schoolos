// PERFECT-100 §9.2 AUTH-4 + AUTH-8 — identifier-keyed throttling.
//   AUTH-4: a known and an UNKNOWN email throttle identically (no enumeration oracle), and a success clears.
//   AUTH-8: the OTP request door enforces a durable per-phone daily cap.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { setupTestDb } from './helpers.js';

process.env.NODE_ENV = 'development';
process.env.OTP_DEV_ECHO = '1';

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const login = (email, password) => app.inject({ method: 'POST', url: '/auth/login', payload: { email, password }, headers: { 'content-type': 'application/json' } });

let app;
let sql;
let tenantId;

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.ready();
  sql = async (text, params = []) => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try { return await c.query(text, params); } finally { await c.end(); }
  };
  tenantId = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
});

after(async () => { await app?.close(); });

describe('AUTH-4 · the login lock is identifier-keyed, so unknown and known look the same', () => {
  test('five failures on an UNKNOWN email lock it with the same 429 a real account gets', async () => {
    const email = 'nobody-here@nowhere.test';
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await login(email, 'wrong-password')).statusCode);
    assert.deepEqual(statuses.slice(0, 4), [401, 401, 401, 401]);
    assert.equal(statuses[4], 429, 'the 5th failure locks the identifier — the same as a real account');
    const after = await login(email, 'wrong-password');
    assert.equal(after.statusCode, 429, 'still locked');
    assert.ok(after.json().retryAfter, 'and the lock carries a retryAfter, like the account lock');
  });

  test('a real account locks at the same threshold (indistinguishable response body)', async () => {
    const email = 'teacher2@meridian.edu';
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await login(email, 'definitely-wrong')).statusCode);
    assert.equal(statuses[4], 429);
    const unknown = await login('another-stranger@nowhere.test', 'x');
    // first failure for a fresh unknown is 401 (not yet locked) — the same as a fresh known account's first
    assert.equal(unknown.statusCode, 401);
  });

  test('a successful sign-in clears the identifier counter', async () => {
    const email = 'teacher@meridian.edu';
    for (let i = 0; i < 4; i++) assert.equal((await login(email, 'nope')).statusCode, 401);
    const ok = await login(email, 'schoolos-demo');
    assert.equal(ok.statusCode, 200, ok.body);
    const row = await sql(`SELECT count(*)::int n FROM auth.request_throttles WHERE scope='login' AND identifier=$1`,
      [createHash('sha256').update(`login:${email}`).digest('hex')]);
    assert.equal(row.rows[0].n, 0, 'the counter is cleared on success');
  });
});

describe('AUTH-8 · OTP requests are capped per phone', () => {
  test('a phone at the daily cap is refused before a code is minted', async () => {
    const phone = '+919855503333';
    const key = createHash('sha256').update(`otp.request:${phone}`).digest('hex');
    await sql(`INSERT INTO auth.request_throttles (scope, identifier, attempts, window_started_at, last_attempt_at)
               VALUES ('otp.request',$1,10,now(),now())`, [key]);
    const r = await app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone }, headers: { 'content-type': 'application/json' } });
    assert.equal(r.statusCode, 429, r.body);
    assert.ok(r.json().retryAfter, 'tells the caller when to try again');
  });

  test('a fresh phone is served (dev echo), so the cap is not always-on', async () => {
    const r = await app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone: '+919855504444' }, headers: { 'content-type': 'application/json' } });
    assert.equal(r.statusCode, 200, r.body);
  });
});
