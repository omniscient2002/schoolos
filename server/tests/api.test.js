// Integration tests: auth, RLS isolation, business invariants, audit integrity.
// IMPORTANT: src modules are imported dynamically so tests point at the test DB.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setupTestDb, TEST_URL, loginAs } from './helpers.js';

let app;

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.ready();
  // PLG-10: `/transport/events` now resolves an ENABLED `transport.gps` provider before it budgets and
  // emits, so the transport-policy assertions below only describe a live deployment once the module is
  // switched on. Enabling it here keeps the test honest about the real precondition.
  const owner = await loginAs(app, 'owner@meridian.edu');
  const on = await app.inject({ method: 'POST', url: '/plugins/transport.gps/enable', headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' }, payload: {} });
  assert.equal(on.statusCode, 200, `transport.gps must enable for the transport-policy suite: ${on.body}`);
});

after(async () => { if (app) await app.close(); });

describe('auth', () => {
  test('rejects bad credentials', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'principal@meridian.edu', password: 'wrong' } });
    assert.equal(res.statusCode, 401);
  });
  test('issues JWT and /me for valid credentials', async () => {
    const { token, user } = await loginAs(app);
    assert.ok(token);
    assert.equal(user.role, 'principal');
    const me = await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${token}` } });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().email, 'principal@meridian.edu');
  });
  test('blocks unauthenticated access to tenant data', async () => {
    const res = await app.inject({ method: 'GET', url: '/students' });
    assert.equal(res.statusCode, 401);
  });
});

describe('role scoping', () => {
  test('teacher cannot confirm payments', async () => {
    const t = await loginAs(app, 'teacher@meridian.edu');
    const res = await app.inject({ method: 'POST', url: '/fees/payments/00000000-0000-0000-0000-000000000000/confirm', payload: {}, headers: { authorization: `Bearer ${t.token}` } });
    assert.equal(res.statusCode, 403);
  });
  test('parent cannot mark attendance', async () => {
    const p = await loginAs(app, 'parent@meridian.edu');
    const res = await app.inject({ method: 'POST', url: '/attendance/mark', payload: { marks: [] }, headers: { authorization: `Bearer ${p.token}` } });
    assert.equal(res.statusCode, 403);
  });
});

describe('RLS tenant isolation', () => {
  test('a second tenant cannot see Meridian data', async () => {
    const client = new pg.Client({ connectionString: TEST_URL });
    await client.connect();
    const tb = (await client.query(`INSERT INTO app.tenants (slug, name) VALUES ('rival','Rival Academy') RETURNING id`)).rows[0];
    const { hashPassword } = await import('../src/auth.js');
    await client.query(
      `INSERT INTO app.users (tenant_id, email, name, role, password_hash) VALUES ($1,'boss@rival.edu','Boss','principal',$2)`,
      [tb.id, hashPassword('rival-pw')]);
    await client.end();
    const rival = await loginAs(app, 'boss@rival.edu', 'rival-pw');
    const res = await app.inject({ method: 'GET', url: '/students', headers: { authorization: `Bearer ${rival.token}` } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().students.length, 0, 'rival principal must see zero Meridian students');
    const ev = await app.inject({ method: 'GET', url: '/events', headers: { authorization: `Bearer ${rival.token}` } });
    assert.equal(ev.json().events.length, 0, 'rival principal must see zero Meridian events');
  });
});

describe('fee invariant', () => {
  test('payment confirm is idempotent and settled obligations refuse new payments', async () => {
    const f = await loginAs(app, 'finance@meridian.edu');
    const H = { authorization: `Bearer ${f.token}` };
    const obs = (await app.inject({ method: 'GET', url: '/fees/obligations?status=open', headers: H })).json().obligations;
    assert.ok(obs.length > 0);
    const target = obs[0];
    const init = (await app.inject({ method: 'POST', url: '/fees/payments', payload: { obligationId: target.id }, headers: H })).json().payment;
    const c1 = await app.inject({ method: 'POST', url: `/fees/payments/${init.id}/confirm`, payload: { gatewayRef: 'T-1' }, headers: H });
    assert.equal(c1.statusCode, 200);
    const c2 = await app.inject({ method: 'POST', url: `/fees/payments/${init.id}/confirm`, payload: { gatewayRef: 'T-1' }, headers: H });
    assert.equal(c2.json().already, true, 'second confirm must be a no-op (idempotent)');
    const p2 = await app.inject({ method: 'POST', url: '/fees/payments', payload: { obligationId: target.id }, headers: H });
    assert.equal(p2.statusCode, 409, 'settled obligation must refuse new payments');
  });
});

describe('work order state machine', () => {
  test('rejects out-of-order transitions', async () => {
    const fac = await loginAs(app, 'facilities@meridian.edu');
    const H = { authorization: `Bearer ${fac.token}` };
    const wos = (await app.inject({ method: 'GET', url: '/work-orders', headers: H })).json().workOrders;
    const wo = wos.find(w => w.status === 'reported');
    assert.ok(wo, 'seed has a reported WO');
    const skip = await app.inject({ method: 'POST', url: `/work-orders/${wo.id}/status`, payload: { to: 'repairing' }, headers: H });
    assert.equal(skip.statusCode, 409, 'reported → repairing must be rejected');
    const ok = await app.inject({ method: 'POST', url: `/work-orders/${wo.id}/status`, payload: { to: 'assigned' }, headers: H });
    assert.equal(ok.statusCode, 200);
  });
});

describe('transport policy', () => {
  test('delay ≥ 10 min raises an approval-required parent-notice action', async () => {
    const tr = await loginAs(app, 'transport@meridian.edu');
    const res = await app.inject({ method: 'POST', url: '/transport/events', payload: { routeCode: 'Route 4', kind: 'gps_delay', delayMins: 12 }, headers: { authorization: `Bearer ${tr.token}` } });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.action, 'action raised');
    assert.equal(body.action.status, 'open');
    assert.equal(body.action.policy_ref, 'Transport §3.1');
  });
  test('small delay raises nothing', async () => {
    const tr = await loginAs(app, 'transport@meridian.edu');
    const res = await app.inject({ method: 'POST', url: '/transport/events', payload: { routeCode: 'Route 9', kind: 'gps_delay', delayMins: 4 }, headers: { authorization: `Bearer ${tr.token}` } });
    const body = res.json();
    assert.equal(body.action, null);
  });
});

describe('audit ledger', () => {
  test('append-only for the app role, hash-chained across entries', async () => {
    const appRoleUrl = TEST_URL.replace('schoolos:', 'schoolos_app:').replace('schoolos_dev_pw', 'schoolos_app_pw');
    const client = new pg.Client({ connectionString: appRoleUrl });
    await client.connect();
    await assert.rejects(
      () => client.query(`UPDATE app.audit_log SET outcome='tampered' WHERE id = (SELECT id FROM app.audit_log LIMIT 1)`),
      /permission denied/,
      'app role must not be able to UPDATE the audit ledger');
    await client.end();
    // chain integrity — per tenant (the chain is per tenant by design)
    const own = new pg.Client({ connectionString: TEST_URL });
    await own.connect();
    const perTenant = (await own.query(
      `WITH w AS (
         SELECT tenant_id,
                (prev_hash = lag(hash) OVER (PARTITION BY tenant_id ORDER BY created_at, id)) AS link_ok
         FROM app.audit_log
       )
       SELECT tenant_id, count(*)::int AS n, bool_and(link_ok) AS chain_ok
       FROM w WHERE link_ok IS NOT NULL GROUP BY tenant_id`)).rows;
    await own.end();
    assert.ok(perTenant.length >= 1);
    for (const t of perTenant) {
      assert.ok(t.n >= 1, 'each tenant has ledger entries');
      if (t.n > 1) assert.equal(t.chain_ok, true, `hash chain must link within tenant ${t.tenant_id}`);
    }
  });
});
