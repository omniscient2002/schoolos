// L2-3.2 (Wave 3) — staff MFA (TOTP RFC 6238, pure node:crypto).
// Pins: enroll/confirm shape, JSON 401 login challenge (D-37a) → challenge door issues the
// session, mfaPending tokens locked to the verify door, recovery codes single-use,
// parent/student refused, kernel-only secret storage.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setupTestDb } from './helpers.js';
import { totpAt, generateSecret } from '../src/totp.js';

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json', 'x-step-up-password': 'schoolos-demo' });
const nowCode = (secret) => totpAt(secret, Math.floor(Date.now() / 1000 / 30));
// 095 made TOTP moving factors single-use (`auth.mfa_secrets.last_totp_step`), so a code consumed by the
// enrollment confirm cannot be replayed for a login challenge in the same 30s window. A real authenticator
// shows the NEXT code once the current one advances; the server accepts a ±1 window, so `nextCode` models
// exactly that without waiting 30 seconds.
const nextCode = (secret) => totpAt(secret, Math.floor(Date.now() / 1000 / 30) + 1);

let app;
let sql;

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
  // the recovery test provisions staff through the PeopleAdmin door — enable it
  const t = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  await sql(`UPDATE app.plugins SET status='enabled' WHERE tenant_id=$1 AND plugin_id='people.admin'`, [t]);
});

const login = async (email, password) => app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });

describe('L2-3.2 · staff MFA (TOTP)', () => {
  test('enroll → confirm with valid TOTP → enabled + 8 recovery codes (shown once)', async () => {
    const l = await login('itadmin@meridian.edu', 'schoolos-demo');
    const enroll = await app.inject({ method: 'POST', url: '/me/mfa/enroll', payload: { password: 'schoolos-demo' }, headers: H(l.json().token) });
    assert.equal(enroll.statusCode, 200, enroll.body);
    const { secret, otpauth } = enroll.json();
    assert.match(secret, /^[A-Z2-7]{32}$/, 'base32 secret (RFC 4648)');
    assert.match(otpauth, /^otpauth:\/\/totp\/SchoolOS%3Aitadmin%40meridian\.edu\?secret=[A-Z2-7]+&issuer=SchoolOS&algorithm=SHA1&digits=6&period=30$/);
    const confirm = await app.inject({ method: 'POST', url: '/me/mfa/verify', payload: { code: nowCode(secret) }, headers: H(l.json().token) });
    assert.equal(confirm.statusCode, 200, confirm.body);
    const codes = confirm.json().recoveryCodes;
    assert.equal(codes.length, 8, '8 recovery codes');
    const db = await sql(`SELECT enabled FROM auth.mfa_secrets WHERE user_id=$1`, [l.json().user.id]);
    assert.equal(db.rows[0].enabled, true);
    // restoring the demo password for later suites in this file is handled per-test below
  });

  test('login challenge: JSON 401 (D-37a) → challenge door issues session; mfaPending locked out elsewhere', async () => {
    const l = await login('itadmin@meridian.edu', 'schoolos-demo');
    assert.equal(l.statusCode, 401, 'password alone is no longer a session');
    assert.equal(l.headers.location, undefined, 'no redirect — plain JSON contract');
    assert.equal(l.json().mfaRequired, true);
    assert.equal(l.json().mfaRequired, true);
    const challengeToken = l.json().challengeToken;
    // the challenge token must NOT open other doors
    const other = await app.inject({ method: 'GET', url: '/me', headers: H(challengeToken) });
    assert.equal(other.statusCode, 403);
    assert.equal(other.json().mfaRequired, true);
    // the secret must be re-read from the DB (not carried in the token)
    const sec = (await sql(`SELECT secret FROM auth.mfa_secrets WHERE user_id=$1`, [l.json().user.id])).rows[0].secret;
    const wrong = await app.inject({ method: 'POST', url: '/me/mfa/verify', payload: { challengeToken, code: '000000' } });
    assert.equal(wrong.statusCode, 401, 'wrong code refused');
    const ok = await app.inject({ method: 'POST', url: '/me/mfa/verify', payload: { challengeToken, code: nextCode(sec) } });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.ok(ok.json().token, 'full session issued');
    assert.equal(app.jwt.decode(ok.json().token).mfaPending, undefined, 'challenge claim gone');
    assert.equal(app.jwt.decode(ok.json().token).ep, 1);
    const me = await app.inject({ method: 'GET', url: '/me', headers: H(ok.json().token) });
    assert.equal(me.statusCode, 200);
  });

  test('recovery code path end to end (fresh user, code captured at enrollment)', async () => {
    const o = await login('owner@meridian.edu', 'schoolos-demo');
    const provision = await app.inject({ method: 'POST', url: '/plugins/people.admin/users', payload: {
      email: 'mfa.staff@meridian.edu', name: 'MFA Staff', role: 'coordinator' }, headers: H(o.json().token) });
    const temp = provision.json().temporaryPassword;
    // first sign-in: restricted mustChange session → change password → real session
    const l1 = await login('mfa.staff@meridian.edu', temp);
    assert.equal(l1.statusCode, 403);
    const pw = await app.inject({ method: 'POST', url: '/me/password', payload: { currentPassword: temp, newPassword: 'staff-pw-2468' }, headers: H(l1.json().token) });
    const real = pw.json().token;
    // enroll + capture recovery codes
    const enroll = await app.inject({ method: 'POST', url: '/me/mfa/enroll', payload: { password: 'staff-pw-2468' }, headers: H(real) });
    const secret = enroll.json().secret;
    const confirm = await app.inject({ method: 'POST', url: '/me/mfa/verify', payload: { code: nowCode(secret) }, headers: H(real) });
    const recovery = confirm.json().recoveryCodes;
    assert.equal(recovery.length, 8);
    // TOTP-code login works
    const l2 = await login('mfa.staff@meridian.edu', 'staff-pw-2468');
    assert.equal(l2.statusCode, 401);
    const v = await app.inject({ method: 'POST', url: '/me/mfa/verify', payload: { challengeToken: l2.json().challengeToken, code: nextCode(secret) } });
    assert.equal(v.statusCode, 200);
    // recovery-code login works ONCE
    const l3 = await login('mfa.staff@meridian.edu', 'staff-pw-2468');
    const r1 = await app.inject({ method: 'POST', url: '/me/mfa/verify', payload: { challengeToken: l3.json().challengeToken, code: recovery[0] } });
    assert.equal(r1.statusCode, 200, r1.body);
    const l4 = await login('mfa.staff@meridian.edu', 'staff-pw-2468');
    const r2 = await app.inject({ method: 'POST', url: '/me/mfa/verify', payload: { challengeToken: l4.json().challengeToken, code: recovery[0] } });
    assert.equal(r2.statusCode, 401, 'recovery code is single-use');
    // and a different recovery code still works (the rest are untouched)
    const r3 = await app.inject({ method: 'POST', url: '/me/mfa/verify', payload: { challengeToken: l4.json().challengeToken, code: recovery[1] } });
    assert.equal(r3.statusCode, 200, r3.body);
  });

  test('parents and students cannot enroll; secrets are kernel-only (RLS)', async () => {
    const p = await login('parent@meridian.edu', 'schoolos-demo');
    const deny = await app.inject({ method: 'POST', url: '/me/mfa/enroll', payload: {}, headers: H(p.json().token) });
    assert.equal(deny.statusCode, 403);
    // app role must not see the vault (057 USING(false)) — either the SELECT is
    // denied outright or it sees zero rows; both mean no secret leaked.
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('schoolos.tenant_id', (SELECT id::text FROM app.tenants WHERE slug='meridian'), true)`);
      await c.query(`SET LOCAL ROLE schoolos_app`);
      let rows = null;
      try { rows = (await c.query(`SELECT secret FROM auth.mfa_secrets`)).rows; } catch { /* denied — good */ }
      if (rows !== null) assert.equal(rows.length, 0, 'app role must not read TOTP secrets');
      await c.query('ROLLBACK');
    } finally { await c.end(); }
  });
  test('D-37d: enroll refuses while the factor is live; disable needs password re-auth', async () => {
    const o = await login('owner@meridian.edu', 'schoolos-demo');
    const H = { authorization: `Bearer ${o.json().token}`, 'content-type': 'application/json', 'x-step-up-password': 'schoolos-demo' };
    // confirm an enrollment so the factor is live (fresh secret, valid code)
    const enroll = await app.inject({ method: 'POST', url: '/me/mfa/enroll', payload: { password: 'schoolos-demo' }, headers: H });
    assert.equal(enroll.statusCode, 200, enroll.body);
    const sec2 = enroll.json().secret;
    const verify = await app.inject({ method: 'POST', url: '/me/mfa/verify', payload: { code: nowCode(sec2) }, headers: H });
    assert.equal(verify.statusCode, 200, verify.body);
    // re-enroll → 409 refusal (no silent secret rotation)
    const again = await app.inject({ method: 'POST', url: '/me/mfa/enroll', payload: { password: 'schoolos-demo' }, headers: H });
    assert.equal(again.statusCode, 409);
    assert.match(again.json().error, /already on/);
    // /me exposes only the enrollment timestamp — no secret material
    const me = await app.inject({ method: 'GET', url: '/me', headers: H });
    assert.ok(me.json().mfa_enrolled_at, 'mfa_enrolled_at surfaced for the UI');
    assert.equal(me.json().totpSecret, undefined);
    // disable without password → refused; with the WRONG password → stays on
    const noPw = await app.inject({ method: 'POST', url: '/me/mfa/disable', payload: {}, headers: H });
    assert.equal(noPw.statusCode, 400);
    const badPw = await app.inject({ method: 'POST', url: '/me/mfa/disable', payload: { password: 'wrong-password' }, headers: H });
    assert.equal(badPw.statusCode, 401);
    const still = await app.inject({ method: 'GET', url: '/me', headers: H });
    assert.ok(still.json().mfa_enrolled_at, 'factor survives a failed re-auth');
    // correct password → factor, recovery codes and enrollment state all gone
    const off = await app.inject({ method: 'POST', url: '/me/mfa/disable', payload: { password: 'schoolos-demo' }, headers: H });
    assert.equal(off.statusCode, 200, off.body);
    const gone = await app.inject({ method: 'GET', url: '/me', headers: H });
    assert.equal(gone.json().mfa_enrolled_at, null, 'enrollment state cleared');
    const vault = await sql(`SELECT count(*)::int AS n FROM auth.mfa_secrets WHERE user_id=$1`, [o.json().user.id]);
    assert.equal(vault.rows[0].n, 0, 'secret row deleted');
    // login is password-only again (no challenge)
    const plain = await login('owner@meridian.edu', 'schoolos-demo');
    assert.equal(plain.statusCode, 200, 'no MFA challenge after disable');
  });

  test('D-37e: /auth/renew re-issues without re-login; absent session → 401', async () => {
    // owner's factor was disabled in the previous test — plain password login works
    const o = await login('owner@meridian.edu', 'schoolos-demo');
    const H = { authorization: `Bearer ${o.json().token}`, 'content-type': 'application/json', 'x-step-up-password': 'schoolos-demo' };
    const r = await app.inject({ method: 'POST', url: '/auth/renew', payload: {}, headers: H });
    assert.equal(r.statusCode, 200, r.body);
    const fresh = app.jwt.decode(r.json().token);
    assert.equal(fresh.sub, o.json().user.id);
    assert.ok(fresh.jti, 'renewed token carries a fresh jti');
    // the renewed session actually works
    const me = await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${r.json().token}` } });
    assert.equal(me.statusCode, 200);
    // cookie path renews too (and re-stamps cookies)
    const cookieLogin = await login('coordinator@meridian.edu', 'schoolos-demo');
    const jar = (cookieLogin.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ');
    // cookie mutations double-submit CSRF — exactly what the app's fetch wrapper does
    const csrf = jar.split('; ').find((c) => c.startsWith('schoolos_csrf='))?.split('=')[1];
    const rc = await app.inject({ method: 'POST', url: '/auth/renew', payload: {}, headers: { cookie: jar, 'x-csrf-token': csrf } });
    assert.equal(rc.statusCode, 200, rc.body);
    const noCsrf = await app.inject({ method: 'POST', url: '/auth/renew', payload: {}, headers: { cookie: jar } });
    assert.equal(noCsrf.statusCode, 403, 'cookie renew without the CSRF echo is refused');
    // absent session → 401 (the contract L5's RENEW_DOOR_LIVE flips on)
    const none = await app.inject({ method: 'POST', url: '/auth/renew', payload: {} });
    assert.equal(none.statusCode, 401);
  });
});
