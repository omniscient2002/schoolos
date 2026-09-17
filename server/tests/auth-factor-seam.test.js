// PERFECT-100 §9.2 AUTH-2 / AUTH-3 — the identity seam must behave the same on
// every sign-in factor.
//
//   AUTH-2: the OTP-verify and SSO SELECTs omitted `force_change`, so a temp-password
//           account that signed in by phone/Google got an UNRESTRICTED session — the
//           `!!undefined === false` trap. D-37(c) promises one shared issue path.
//   AUTH-3: the MFA challenge was minted only on the password branch, so a staff
//           account with an enabled TOTP factor could be downgraded to a single factor
//           by signing in with a phone code or Google instead.
//
// Both are proved behaviourally here: a real OTP is requested and verified, and a real
// TOTP secret is stored, so the assertions exercise the doors rather than the SQL text.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setupTestDb } from './helpers.js';
import { generateSecret, totpAt } from '../src/totp.js';

// Development posture: the OTP echo and the SSO simulator are the only channels a
// self-contained test can drive without configuring a carrier.
process.env.NODE_ENV = 'development';
process.env.OTP_DEV_ECHO = '1';
process.env.AUTH_DEV_SSO = '1';

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const nextCode = (s) => totpAt(s, Math.floor(Date.now() / 1000 / 30) + 1);

let app;
let sql;
let tenant;
let fcUser;
let mfaUser;
let secret;

const otpLogin = async (phone) => {
  const req = await app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone, tenantId: tenant } });
  assert.equal(req.statusCode, 200, req.body);
  return app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { phone, code: req.json().devCode, tenantId: tenant } });
};

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  const { hashPassword } = await import('../src/auth.js');
  app = await buildApp({ logger: false });
  await app.ready();
  sql = async (text, params = []) => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try { return await c.query(text, params); } finally { await c.end(); }
  };
  tenant = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;

  fcUser = (await sql(
    `INSERT INTO app.users (tenant_id, email, name, role, password_hash, phone, force_change)
     VALUES ($1,'seam-fc@meridian.edu','Seam ForceChange','teacher',$2,'+919855502001',true) RETURNING id`,
    [tenant, hashPassword('temp-pw-0001')])).rows[0].id;

  mfaUser = (await sql(
    `INSERT INTO app.users (tenant_id, email, name, role, password_hash, phone)
     VALUES ($1,'seam-mfa@meridian.edu','Seam MFA','teacher',$2,'+919855502002') RETURNING id`,
    [tenant, hashPassword('seam-pw-0002')])).rows[0].id;
  secret = generateSecret();
  await sql(`INSERT INTO auth.mfa_secrets (user_id, tenant_id, secret, enabled) VALUES ($1,$2,$3,true)`, [mfaUser, tenant, secret]);
});

describe('AUTH-2 · force_change is stamped on the OTP and SSO issue paths', () => {
  test('phone-OTP login carries the restricted mustChange claim and cannot reach a staff door', async () => {
    const v = await otpLogin('+919855502001');
    assert.equal(v.statusCode, 200, v.body);
    assert.equal(app.jwt.decode(v.json().token).mustChange, true,
      'a temp-password account must be restricted no matter which factor signed it in');
    // the restriction is enforced, not decorative: a non-password door refuses
    const blocked = await app.inject({ method: 'GET', url: '/students', headers: H(v.json().token) });
    assert.equal(blocked.statusCode, 403);
    assert.equal(blocked.json().mustChange, true);
  });

  test('dev SSO issues the same restricted claim for a force_change account', async () => {
    const r = await app.inject({ method: 'POST', url: '/auth/google/demo', payload: { email: 'seam-fc@meridian.edu' } });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(app.jwt.decode(r.json().token).mustChange, true, 'SSO must not be the way around the temp-password gate');
  });
});

describe('AUTH-3 · an enabled second factor cannot be bypassed by OTP or SSO', () => {
  test('phone OTP on an MFA-enrolled account answers the challenge, not a session', async () => {
    const v = await otpLogin('+919855502002');
    assert.equal(v.statusCode, 401, 'a phone code is a weaker factor and must not downgrade the account');
    assert.equal(v.json().mfaRequired, true);
    assert.ok(v.json().challengeToken, 'a challenge token is offered');
    assert.equal(v.json().token, undefined, 'no full session was issued');
    // the challenge is real: completing it with the current TOTP yields the session
    const ok = await app.inject({ method: 'POST', url: '/me/mfa/verify', payload: { challengeToken: v.json().challengeToken, code: nextCode(secret) } });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.ok(ok.json().token, 'second factor completes the sign-in');
  });

  test('Google SSO on an MFA-enrolled account answers the challenge too', async () => {
    const r = await app.inject({ method: 'POST', url: '/auth/google/demo', payload: { email: 'seam-mfa@meridian.edu' } });
    assert.equal(r.statusCode, 401, 'SSO must not bypass the TOTP factor');
    assert.equal(r.json().mfaRequired, true);
    assert.ok(r.json().challengeToken);
  });
});
