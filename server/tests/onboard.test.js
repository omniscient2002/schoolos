// Onboarding suite — self-serve school signup (Platform §1.1, migration 053).
// Covers: happy path (tenant + owner + audit + event in ONE transaction),
// slug dedupe, per-tenant email uniqueness, kill-switch refusal, validation,
// school-profile update, /onboard/status checklist, the IT-admin handover
// (owner provisions an itadmin via people.admin, itadmin provisions a teacher),
// and the RLS guarantee that the new tenant is isolated from its neighbours.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers.js';

let app;
let base; // http://127.0.0.1:<port>

before(async () => {
  await setupTestDb(); // per-file fresh DB (suite law: every file owns its world)
  process.env.SELF_SIGNUP_ENABLED = 'true';
  process.env.TRUST_PROXY = 'true'; // per-test unique X-Forwarded-For → the 3/min door is exercisable without waiting
  const { buildApp } = await import('../src/app.js');
  const { q, withUser, pool } = await import('../src/db.js');
  globals.q = q; globals.withUser = withUser;
  app = await buildApp({ logger: false });
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${app.server.address().port}`;
});

const globals = {};
let app2; // kill-switch instance (06) — kept open during the run on purpose
after(async () => {
  if (app) await app.close().catch(() => {});
  // closing app2 fires its onClose → pool.end — safe HERE, the run is over;
  // an unclosed listening server would hold the event loop and wedge the suite
  if (app2) await app2.close().catch(() => {});
  try { const { pool } = await import('../src/db.js'); await pool.end(); } catch { /* already ended */ }
});

let ipCounter = 41;
const signup = (body) => fetch(`${base}/onboard/signup`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.50.0.${ipCounter++}` },
  body: JSON.stringify(body),
});
const authed = (token, path, opts = {}) => fetch(`${base}${path}`, {
  ...opts, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(opts.headers ?? {}) },
});

test('01 · signup creates tenant + owner + audit + event in one transaction', async () => {
  const r = await signup({ schoolName: 'Onboard Test Academy', ownerName: 'Ravi Sharma', ownerEmail: 'ravi@onboard.test', ownerPassword: 'onboard-pass-1' });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(body.token, 'auto-login token issued');
  assert.equal(body.user.role, 'owner');
  assert.equal(body.tenant.slug, 'onboard-test-academy');

  const t = (await globals.q(`SELECT id, onboarded_at, onboarded_via, config->'setup'->>'source' AS src FROM app.tenants WHERE slug='onboard-test-academy'`)).rows[0];
  assert.ok(t?.id, 'tenant row exists');
  assert.equal(t.onboarded_via, 'self-signup');
  assert.ok(t.onboarded_at, 'onboarded_at stamped');
  assert.equal(t.src, 'self-signup');

  const u = (await globals.q(`SELECT role, active FROM app.users WHERE tenant_id=$1 AND email='ravi@onboard.test'`, [t.id])).rows[0];
  assert.equal(u?.role, 'owner');
  assert.equal(u.active, true);

  // the audit row is IN the new tenant's chain and lands with the transaction
  const a = (await globals.q(`SELECT action, actor FROM app.audit_log WHERE tenant_id=$1`, [t.id])).rows;
  assert.ok(a.some(x => x.action === 'Tenant onboarded (self-signup)'), 'hash-chained onboard audit row');
  const e = (await globals.q(`SELECT type FROM app.events WHERE tenant_id=$1`, [t.id])).rows;
  assert.ok(e.some(x => x.type === 'platform'), 'onboarding event on the spine');
});

test('02 · duplicate school name → slug deduped, both tenants exist', async () => {
  const r = await signup({ schoolName: 'Onboard Test Academy', ownerName: 'Sana Khan', ownerEmail: 'sana@onboard2.test', ownerPassword: 'onboard-pass-2' });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.tenant.slug, 'onboard-test-academy-2');
  const n = (await globals.q(`SELECT count(*)::int AS n FROM app.tenants WHERE slug LIKE 'onboard-test-academy%'`)).rows[0].n;
  assert.equal(n, 2);
});

test('03 · same email in a NEW school is allowed at signup (per-tenant uniqueness)', async () => {
  const r = await signup({ schoolName: 'Second Home School', ownerName: 'Ravi Sharma', ownerEmail: 'ravi@onboard.test', ownerPassword: 'onboard-pass-1' });
  assert.equal(r.status, 200);
  const n = (await globals.q(`SELECT count(*)::int AS n FROM app.users u JOIN app.tenants t ON t.id=u.tenant_id WHERE u.email='ravi@onboard.test'`)).rows[0].n;
  assert.equal(n, 2, 'email now exists in 2 tenants');
});

test('03b · AMBIGUITY GUARD: that email can no longer sign in without disambiguation (409, never wrong-tenant)', async () => {
  const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.60.0.3b' }, body: JSON.stringify({ email: 'ravi@onboard.test', password: 'onboard-pass-1' }) });
  assert.equal(r.status, 409, 'multi-tenant email → choose-your-school, not silent first-row pick');
  const b = await r.json();
  assert.equal(b.multiTenant, true);
  assert.ok(b.schools.length >= 2); // L2-4.2 picker contract: schools is now [{tenantId, name}]
});

test('04 · signup always creates a NEW tenant (never merges into an existing one)', async () => {
  const r = await signup({ schoolName: 'Clash Academy', ownerName: 'Clone Ravi', ownerEmail: 'clash.owner@onboard.test', ownerPassword: 'onboard-pass-3' });
  assert.equal(r.status, 200, 'fresh email + new school = new tenant');
  const b = await r.json();
  assert.equal(b.tenant.slug, 'clash-academy');
});

test('05 · validation: short password / bad email / tiny name → 400', async () => {
  for (const body of [
    { schoolName: 'Valid School', ownerName: 'X Y', ownerEmail: 'x@y.test', ownerPassword: 'short' },
    { schoolName: 'Valid School', ownerName: 'X Y', ownerEmail: 'not-an-email', ownerPassword: 'long-enough-1' },
    { schoolName: 'ab', ownerName: 'X Y', ownerEmail: 'x@y.test', ownerPassword: 'long-enough-1' },
  ]) {
    const r = await signup(body);
    assert.equal(r.status, 400, `400 for ${JSON.stringify(body).slice(0, 60)}`);
  }
});

test('06 · kill-switch: SELF_SIGNUP_ENABLED=false → 403 (need a second app instance)', async () => {
  // in-process second app with the switch off
  const prev = process.env.SELF_SIGNUP_ENABLED;
  process.env.SELF_SIGNUP_ENABLED = 'false';
  const { buildApp } = await import('../src/app.js');
  app2 = await buildApp({ logger: false });
  await app2.listen({ port: 0, host: '127.0.0.1' });
  const base2 = `http://127.0.0.1:${app2.server.address().port}`;
  const r = await fetch(`${base2}/onboard/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ schoolName: 'Blocked School', ownerName: 'B B', ownerEmail: 'b@b.test', ownerPassword: 'blocked-123' }) });
  assert.equal(r.status, 403);
  const b = await r.json();
  assert.match(b.error, /paused/i);
  // DELIBERATE: app2 is NOT closed — app.close() fires the module's onClose
  // hook which ends the SHARED singleton pool, killing app1's connections
  // (07-11 would all 500). The pool is ended exactly once in after().
  process.env.SELF_SIGNUP_ENABLED = prev;
});

test('07 · new owner session: /me works, /onboard/status gives checklist', async () => {
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.60.0.7' }, body: JSON.stringify({ email: 'sana@onboard2.test', password: 'onboard-pass-2' }) });
  const loginBody = await login.json();
  assert.equal(login.status, 200, `login status ${login.status}: ${JSON.stringify(loginBody).slice(0, 140)}`);
  const { token } = loginBody;

  const me = await authed(token, '/me');
  assert.equal(me.status, 200);

  const st = await authed(token, '/onboard/status');
  assert.equal(st.status, 200);
  const body = await st.json();
  assert.equal(body.school.slug, 'onboard-test-academy-2');
  const itadminStep = body.checklist.find(c => c.id === 'itadmin');
  assert.equal(itadminStep.done, false, 'no itadmin yet');
});

test('08 · HANDOVER: owner provisions itadmin → itadmin provisions teacher', async () => {
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.60.0.8' }, body: JSON.stringify({ email: 'sana@onboard2.test', password: 'onboard-pass-2' }) });
  const { token } = await login.json();
  const me = await (await authed(token, '/me')).json();

  const t = (await globals.q(`SELECT id FROM app.tenants WHERE slug='onboard-test-academy-2'`)).rows[0];
  const cfg = (await globals.q(`SELECT status FROM app.plugins WHERE tenant_id=$1 AND plugin_id='people.admin'`, [t.id])).rows[0];
  if (cfg?.status !== 'enabled') {
    const en = await authed(token, '/plugins/people.admin/enable', { method: 'POST', body: JSON.stringify({ version: '1.0.0', class: 'B' }) });
    assert.ok([200, 409].includes(en.status), `enable door: ${en.status}`);
  }

  const mk = await authed(token, '/plugins/people.admin/users', { method: 'POST', body: JSON.stringify({ name: 'Ira Iyer', email: 'itadmin@onboard.test', role: 'itadmin' }) });
  assert.equal(mk.status, 200, 'owner can create the itadmin (handover done)');
  const mkBody = await mk.json();
  assert.ok(mkBody.tempPassword ?? mkBody.temporaryPassword, 'temp password shown once');

  const itLogin = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.60.0.12' }, body: JSON.stringify({ email: 'itadmin@onboard.test', password: mkBody.tempPassword ?? mkBody.temporaryPassword }) });
  assert.ok([200, 403].includes(itLogin.status), `itadmin signs in with the temp password: ${itLogin.status}`);
  // S0 repair (D-44, cross-zone — Unit C review): the restricted-session
  // contract answers 403 {mustChange, token} for temp-password logins; the
  // handover completes by setting a real password first, exactly like the UI.
  const itFirst = await itLogin.json();
  let itTok = itFirst.token;
  if (itFirst.mustChange) {
    const setPw = await authed(itFirst.token, '/me/password', { method: 'POST', body: JSON.stringify({ currentPassword: mkBody.tempPassword ?? mkBody.temporaryPassword, newPassword: 'it-admin-pass-9' }) });
    assert.equal(setPw.status, 200, `itadmin sets a real password: ${setPw.status}`);
    itTok = (await setPw.json()).token;
  }

  const teacher = await authed(itTok, '/plugins/people.admin/users', { method: 'POST', body: JSON.stringify({ name: 'Tara Teacher', email: 'teacher1@onboard.test', role: 'teacher' }) });
  assert.equal(teacher.status, 200, 'itadmin continues provisioning (delegation works)');

  const ownerTry = await authed(token, '/plugins/people.admin/users', { method: 'POST', body: JSON.stringify({ name: 'Second Owner', email: 'owner2@onboard.test', role: 'owner' }) });
  assert.equal(ownerTry.status, 403, 'owner-refusal guard intact: NO door creates a second owner');
});

test('09 · RLS: the onboarded owner cannot see the demo tenant (isolation from birth)', async () => {
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.60.0.9' }, body: JSON.stringify({ email: 'sana@onboard2.test', password: 'onboard-pass-2' }) });
  const { token } = await login.json();
  const students = await authed(token, '/students');
  assert.equal(students.status, 200);
  const body = await students.json();
  const rows = body.students ?? body.rows ?? [];
  assert.equal(rows.length, 0, 'empty tenant sees zero students — not the demo school\'s');
});

test('10 · owner updates school profile → audited', async () => {
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.60.0.10' }, body: JSON.stringify({ email: 'sana@onboard2.test', password: 'onboard-pass-2' }) });
  const { token } = await login.json();
  const r = await authed(token, '/onboard/school', { method: 'POST', body: JSON.stringify({ address: '1 Test Lane, Pune', board: 'CBSE' }) });
  assert.equal(r.status, 200);
  const t = (await globals.q(`SELECT config->>'address' AS addr, config->>'board' AS board FROM app.tenants WHERE slug='onboard-test-academy-2'`)).rows[0];
  assert.equal(t.addr, '1 Test Lane, Pune');
  assert.equal(t.board, 'CBSE');
  const a = (await globals.q(`SELECT count(*)::int AS n FROM app.audit_log WHERE tenant_id=(SELECT id FROM app.tenants WHERE slug='onboard-test-academy-2') AND action='Updated school profile'`)).rows[0].n;
  assert.ok(a >= 1, 'profile update audited');
});

test('11 · non-owner cannot update the school profile', async () => {
  const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.60.0.11' }, body: JSON.stringify({ email: 'teacher@meridian.edu', password: 'schoolos-demo' }) });
  const { token } = await r.json();
  const upd = await authed(token, '/onboard/school', { method: 'POST', body: JSON.stringify({ board: 'HACKED' }) });
  assert.equal(upd.status, 403, 'only owners touch the tenant profile');
});
