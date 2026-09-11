// L2-2.1 (Wave 2) — password change door + force_change enforcement + session
// epoch revocation (migration 055). Pins: change flow, restricted mustChange
// session (403 on staff doors, 200 on /me + /me/password), old sessions revoked
// on epoch bump, reissued token carries the new epoch, PeopleAdmin temp-password
// flow stays self-service end to end.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setupTestDb } from './helpers.js';

// T101/T103: the OTP dev echo is OPT-IN — arm it before src/config.js loads
process.env.NODE_ENV = 'development';
process.env.OTP_DEV_ECHO = '1';

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

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
  // the forced flow exercises the PeopleAdmin temp-password door — enable the plugin
  const t = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  await sql(`UPDATE app.plugins SET status='enabled' WHERE tenant_id=$1 AND plugin_id='people.admin'`, [t]);
});

const login = async (email, password) => app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });

describe('L2-2.1 · password change + force_change + session epoch', () => {
  test('change flow: verify current → new hash + epoch bump → fresh token; old password dies', async () => {
    const l = await login('principal@meridian.edu', 'schoolos-demo');
    assert.equal(l.statusCode, 200);
    const oldToken = l.json().token;
    assert.ok(!('ep' in app.jwt.decode(oldToken) ? false : true), 'sanity'); // no-op guard
    assert.equal(app.jwt.decode(oldToken).ep, 1, 'pre-change token carries epoch 1');

    const bad = await app.inject({ method: 'POST', url: '/me/password', payload: { currentPassword: 'wrong-password', newPassword: 'brand-new-pw-1' }, headers: H(oldToken) });
    assert.equal(bad.statusCode, 401, 'wrong current password refused');

    const short = await app.inject({ method: 'POST', url: '/me/password', payload: { currentPassword: 'schoolos-demo', newPassword: 'short' }, headers: H(oldToken) });
    assert.equal(short.statusCode, 400, 'length floor enforced');

    const ch = await app.inject({ method: 'POST', url: '/me/password', payload: { currentPassword: 'schoolos-demo', newPassword: 'brand-new-pw-1' }, headers: H(oldToken) });
    assert.equal(ch.statusCode, 200, ch.body);
    const newToken = ch.json().token;
    assert.equal(app.jwt.decode(newToken).ep, 2, 'reissued token carries the new epoch');

    // the OLD token (epoch 1) is dead the moment the epoch moved
    const stale = await app.inject({ method: 'GET', url: '/me', headers: H(oldToken) });
    assert.equal(stale.statusCode, 401, 'pre-change session revoked');
    // the REISSUED token works
    const fresh = await app.inject({ method: 'GET', url: '/me', headers: H(newToken) });
    assert.equal(fresh.statusCode, 200);
    // credentials rotated
    const oldLogin = await login('principal@meridian.edu', 'schoolos-demo');
    assert.equal(oldLogin.statusCode, 401, 'old password no longer verifies');
    const newLogin = await login('principal@meridian.edu', 'brand-new-pw-1');
    assert.equal(newLogin.statusCode, 200, 'new password signs in');
    assert.equal(app.jwt.decode(newLogin.json().token).ep, 2);
  });

  test('epoch bump revokes OTHER sessions, not just the caller\'s', async () => {
    const a = await login('itadmin@meridian.edu', 'schoolos-demo');
    const b = await login('itadmin@meridian.edu', 'schoolos-demo');
    assert.equal(a.statusCode, 200); assert.equal(b.statusCode, 200);
    const ch = await app.inject({ method: 'POST', url: '/me/password', payload: { currentPassword: 'schoolos-demo', newPassword: 'it-new-pw-99' }, headers: H(a.json().token) });
    assert.equal(ch.statusCode, 200, ch.body);
    const other = await app.inject({ method: 'GET', url: '/me', headers: H(b.json().token) });
    assert.equal(other.statusCode, 401, 'a second session from BEFORE the change is revoked');
    const self = await app.inject({ method: 'GET', url: '/me', headers: H(ch.json().token) });
    assert.equal(self.statusCode, 200, 'the reissued session survives');
    // restore the demo password so later suites' fixtures stay coherent
    const back = await app.inject({ method: 'POST', url: '/me/password', payload: { currentPassword: 'it-new-pw-99', newPassword: 'schoolos-demo' }, headers: H(ch.json().token) });
    assert.equal(back.statusCode, 200, back.body);
  });

  test('forced flow: PeopleAdmin temp password → restricted session → self-service change', async () => {
    const o = await login('owner@meridian.edu', 'schoolos-demo');
    const provision = await app.inject({ method: 'POST', url: '/plugins/people.admin/users', payload: {
      email: 'forced.lane@meridian.edu', name: 'Forced Lane', role: 'coordinator' }, headers: H(o.json().token) });
    assert.equal(provision.statusCode, 200, provision.body);
    const temp = provision.json().temporaryPassword;
    assert.ok(temp, 'temp password shown once');
    const row = (await sql(`SELECT force_change FROM app.users WHERE email='forced.lane@meridian.edu'`)).rows[0];
    assert.equal(row.force_change, true, 'force_change stamped at provisioning (046)');

    const l = await login('forced.lane@meridian.edu', temp);
    assert.equal(l.statusCode, 403, 'login answers 403-with-reason while force_change is pending');
    assert.equal(l.json().mustChange, true);
    assert.match(l.json().error, /temporary password/i);
    const restricted = l.json().token;
    assert.equal(app.jwt.decode(restricted).mustChange, true, 'restricted claim present');

    // restricted session: staff doors refuse, /me + /me/password stay open
    const staff = await app.inject({ method: 'GET', url: '/students', headers: H(restricted) });
    assert.equal(staff.statusCode, 403, 'mustChange session cannot open staff doors');
    const me = await app.inject({ method: 'GET', url: '/me', headers: H(restricted) });
    assert.equal(me.statusCode, 200, '/me allowed (profile surfaces)');
    const mePw = await app.inject({ method: 'POST', url: '/me/password', payload: { currentPassword: temp, newPassword: 'my-own-pw-123' }, headers: H(restricted) });
    assert.equal(mePw.statusCode, 200, mePw.body);
    assert.equal(mePw.json().mustChange, false);
    const full = mePw.json().token;
    assert.ok(!app.jwt.decode(full).mustChange, 'restriction lifted on the reissued token');

    // the staff door opens on the new session; the temp password is dead
    const roster = await app.inject({ method: 'GET', url: '/students', headers: H(full) });
    assert.equal(roster.statusCode, 200);
    const tempLogin = await login('forced.lane@meridian.edu', temp);
    assert.equal(tempLogin.statusCode, 401, 'temp password no longer verifies (force_change cleared)');
  });

  test('epoch is stamped by OTP/SSO sessions too (no stale-epoch lockout)', async () => {
    // bump the teacher's epoch via a password change, then sign in via OTP (dev echo)
    const t = await login('teacher@meridian.edu', 'schoolos-demo');
    const ch = await app.inject({ method: 'POST', url: '/me/password', payload: { currentPassword: 'schoolos-demo', newPassword: 'teacher-pw-777' }, headers: H(t.json().token) });
    assert.equal(ch.statusCode, 200, ch.body);
    const req = await app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone: '+919845000108' } });
    assert.equal(req.statusCode, 200);
    const code = req.json().devCode;
    assert.ok(code, 'OTP_DEV_ECHO armed in development');
    const v = await app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { phone: '+919845000108', code } });
    assert.equal(v.statusCode, 200, v.body);
    assert.equal(app.jwt.decode(v.json().token).ep, 2, 'OTP session carries the CURRENT epoch');
    const me = await app.inject({ method: 'GET', url: '/me', headers: H(v.json().token) });
    assert.equal(me.statusCode, 200, 'OTP session is not rejected as stale');
    // restore demo password for later suites
    const back = await app.inject({ method: 'POST', url: '/me/password', payload: { currentPassword: 'teacher-pw-777', newPassword: 'schoolos-demo' }, headers: H(ch.json().token) });
    assert.equal(back.statusCode, 200, back.body);
  });
});
