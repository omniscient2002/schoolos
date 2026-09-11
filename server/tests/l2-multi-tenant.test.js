// L2-4.2 (Wave 4) — multi-school resolution: full picker contract.
// Pins: login/OTP 409s carry schools [{tenantId, name}] (replacing the count),
// /me/tenants lists memberships post-auth, /me/switch re-issues the session
// against the chosen tenant's row (role is per-tenant), no-membership → 403.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setupTestDb } from './helpers.js';

// T101: the OTP dev echo is OPT-IN — arm it before src/config.js loads
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
  // plant school B with the SAME person (different role — roles are per-tenant)
  tenantB = (await sql(`INSERT INTO app.tenants (name, slug) VALUES ('Sprint L2 B','sprint-l2-b') RETURNING id`)).rows[0].id;
  const a = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  await sql(`INSERT INTO app.users (tenant_id, email, name, role, password_hash, phone) VALUES ($1,$2,'Switcher','coordinator','x:y',$3)`, [a, A.email, A.phone]);
  await sql(`INSERT INTO app.users (tenant_id, email, name, role, password_hash, phone) VALUES ($1,$2,'Switcher','teacher','x:y',$3)`, [tenantB, A.email, A.phone]);
  // the D-37b scoped-login test verifies the password for real — mirror the seed hash
  await sql(`UPDATE app.users SET password_hash=(SELECT password_hash FROM app.users WHERE email='principal@meridian.edu') WHERE email=$1`, [A.email]);
});

const A = { email: 'switcher@meridian.edu', phone: '+919855500999', password: 'schoolos-demo' };
let tenantB;

describe('L2-4.2 · multi-school resolution', () => {
  test('login 409 carries the full picker (ids + names, not a count)', async () => {
    const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: A.email, password: A.password } });
    assert.equal(r.statusCode, 409);
    assert.equal(r.json().multiTenant, true);
    const schools = r.json().schools;
    assert.equal(schools.length, 2);
    const names = schools.map((s) => s.name).sort();
    assert.deepEqual(names, ['Meridian International Academy', 'Sprint L2 B']);
    assert.ok(schools.every((s) => /^[0-9a-f-]{36}$/.test(s.tenantId)));
  });

  test('scoped OTP (tenantId param) → session in school A → /me/tenants lists both', async () => {
    const req = await app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone: A.phone, tenantId: (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id } });
    assert.equal(req.statusCode, 200);
    const v = await app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { phone: A.phone, code: req.json().devCode, tenantId: (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id } });
    assert.equal(v.statusCode, 200, v.body);
    const token = v.json().token;
    assert.equal(v.json().user.role, 'coordinator', 'school A role');
    const list = await app.inject({ method: 'GET', url: '/me/tenants', headers: H(token) });
    assert.equal(list.statusCode, 200);
    const tenants = list.json().tenants;
    assert.equal(tenants.length, 2);
    assert.ok(tenants.some((x) => x.role === 'coordinator') && tenants.some((x) => x.role === 'teacher'), 'roles are per-tenant');
  });

  test('/me/switch re-issues the session against the chosen tenant', async () => {
    const req = await app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone: A.phone, tenantId: (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id } });
    const v = await app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { phone: A.phone, code: req.json().devCode, tenantId: (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id } });
    const tokenA = v.json().token;
    // S0 fix A4: password-carrying accounts must present their password to switch
    const noPw = await app.inject({ method: 'POST', url: '/me/switch', payload: { tenantId: tenantB }, headers: H(tokenA) });
    assert.equal(noPw.statusCode, 403);
    assert.equal(noPw.json().passwordRequired, true, 'switch demands the current password');
    const sw = await app.inject({ method: 'POST', url: '/me/switch', payload: { tenantId: tenantB, currentPassword: A.password }, headers: H(tokenA) });
    assert.equal(sw.statusCode, 200, sw.body);
    const claims = app.jwt.decode(sw.json().token);
    assert.equal(claims.tenant, tenantB);
    assert.equal(claims.role, 'teacher', 'school B role applied');
    const me = await app.inject({ method: 'GET', url: '/me', headers: H(sw.json().token) });
    assert.equal(me.statusCode, 200);
    // the OLD session (school A) still works — switch re-issues, it does not revoke
    const meA = await app.inject({ method: 'GET', url: '/me', headers: H(tokenA) });
    assert.equal(meA.statusCode, 200, 'switch is additive, not a logout');
    // no membership → 403
    const stranger = (await sql(`INSERT INTO app.tenants (name, slug) VALUES ('Stranger School','stranger-l2') RETURNING id`)).rows[0].id;
    const denied = await app.inject({ method: 'POST', url: '/me/switch', payload: { tenantId: stranger, currentPassword: A.password }, headers: H(tokenA) });
    assert.equal(denied.statusCode, 403);
    assert.match(denied.json().error, /No active account/);
  });
  test('D-37b: /auth/login honors body.tenantId (picker parity with the OTP doors)', async () => {
    const a = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
    // unscoped → 409 full picker; scoped → straight in with the right role
    const unscoped = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: A.email, password: A.password } });
    assert.equal(unscoped.statusCode, 409);
    const scoped = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: A.email, password: A.password, tenantId: a } });
    assert.equal(scoped.statusCode, 200, scoped.body);
    assert.equal(scoped.json().user.role, 'coordinator', 'school A role on scoped login');
    // scoped to school B → teacher role (per-tenant roles, same person)
    const scopedB = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: A.email, password: A.password, tenantId: tenantB } });
    assert.equal(scopedB.statusCode, 200);
    assert.equal(scopedB.json().user.role, 'teacher');
    // scoped to a school with no membership → uniform invalid-credentials
    const stranger = (await sql(`INSERT INTO app.tenants (name, slug) VALUES ('No-Member School','no-member-l2') RETURNING id`)).rows[0].id;
    const denied = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: A.email, password: A.password, tenantId: stranger } });
    assert.equal(denied.statusCode, 401, 'a planted tenantId cannot widen membership');
  });
});
