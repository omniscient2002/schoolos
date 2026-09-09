// Wave C — RLS tenant isolation + metrics/capabilities door pins.
// What must hold (049/050/051/052 + src/app.js Wave C edits):
//   · the previously-naked PII tables (plugin_dpdp.consent/sar,
//     plugin_admissions.lead/stage_history, plugin_visitors.visit) are RLS-pinned:
//     as the app role with a tenant GUC, tenant A rows are invisible to tenant B,
//     and a cross-tenant INSERT is rejected by WITH CHECK.
//   · app.tenants shows a caller only their own row; auth.revoked_token is pinned
//     the same way (defense in depth — owner path serves it today).
//   · app.oauth_states is readable/writable by the app role (global pre-auth
//     surface; authenticity = 10-min TTL + single-use) and app.schema_migrations
//     is fully invisible to the app role.
//   · GET /metrics speaks Prometheus text and is owner/itadmin only.
//   · GET /capabilities is the decoupling contract: configured/enabled rails.
//   · every response carries the Wave C security headers (HSTS only under
//     FORCES_HTTPS=true).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { setupTestDb } from './helpers.js';
import pg from 'pg';

let app;
let sql;
let ownerToken, itadminToken, teacherToken;
let tenantA, tenantB;
const H = (t) => ({ authorization: `Bearer ${t}` });

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.ready();
  sql = async (text, params = []) => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const r = await c.query(text, params);
    await c.end();
    return r;
  };
  const login = async (e) => (await app.inject({ method: 'POST', url: '/auth/login', payload: { email: e, password: 'schoolos-demo' } })).json().token;
  ownerToken = await login('owner@meridian.edu');
  itadminToken = await login('itadmin@meridian.edu');
  teacherToken = await login('teacher@meridian.edu');
  tenantA = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  tenantB = (await sql(`INSERT INTO app.tenants (slug, name) VALUES ('wavec-probe', 'Wave C RLS probe tenant') RETURNING id`)).rows[0].id;

  // Probe rows: SAME distinctive values in BOTH tenants — isolation means each
  // tenant's probe sees exactly ONE of each, never the twin row.
  for (const t of [tenantA, tenantB]) {
    await sql(`INSERT INTO plugin_dpdp.consent (tenant_id, subject_ref, purpose, decision)
               VALUES ($1, '+919000000001', 'wavec_probe', 'granted')`, [t]);
    await sql(`INSERT INTO plugin_dpdp.sar (tenant_id, kind, subject_ref, requested_by, sla_due_at)
               VALUES ($1, 'export', '+919000000003', 'wavec@test', now() + interval '30 days')`, [t]);
    const lead = (await sql(`INSERT INTO plugin_admissions.lead (tenant_id, student_name, guardian_phone, class_applied)
               VALUES ($1, 'Wave C Probe', '+919000000002', 'WaveC') RETURNING id`, [t])).rows[0].id;
    await sql(`INSERT INTO plugin_admissions.stage_history (tenant_id, lead_id, from_stage, to_stage, actor)
               VALUES ($1, $2, NULL, 'wavec_stage', 'wavec@test')`, [t, lead]);
    await sql(`INSERT INTO plugin_visitors.visit (tenant_id, visitor_name, purpose, badge_code)
               VALUES ($1, 'Wave C Visitor', 'meeting', 'WC-PROBE')`, [t]);
  }
});
after(async () => { await app?.close(); });

// b9 pattern: fresh connection, tenant GUC, SET LOCAL ROLE schoolos_app, rollback.
const asAppRole = async (tenantId, text, params = []) => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('schoolos.tenant_id', $1, true)`, [tenantId]);
    await c.query(`SELECT set_config('schoolos.role', 'owner', true)`);
    await c.query('SET LOCAL ROLE schoolos_app'); // RLS applies to the app role
    return await c.query(text, params);
  } finally {
    await c.query('ROLLBACK');
    await c.end();
  }
};
const count = async (tenantId, rel, where = 'true') =>
  (await asAppRole(tenantId, `SELECT count(*)::int n FROM ${rel} WHERE ${where}`)).rows[0].n;

test('Wave C · RLS coverage: all nine targets enabled + forced, one policy each', async () => {
  const cov = await sql(`
    SELECT n.nspname||'.'||c.relname AS rel, c.relrowsecurity rls, c.relforcerowsecurity forced, count(p.oid)::int policies
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_policy p ON p.polrelid=c.oid
    WHERE (n.nspname, c.relname) IN (
      ('plugin_dpdp','consent'),('plugin_dpdp','sar'),
      ('plugin_admissions','lead'),('plugin_admissions','stage_history'),
      ('plugin_visitors','visit'),('app','tenants'),('auth','revoked_token'),
      ('app','oauth_states'),('app','schema_migrations'))
    GROUP BY 1,2,3`);
  const expect = ['plugin_dpdp.consent', 'plugin_dpdp.sar', 'plugin_admissions.lead',
    'plugin_admissions.stage_history', 'plugin_visitors.visit', 'app.tenants',
    'auth.revoked_token', 'app.oauth_states', 'app.schema_migrations'];
  assert.equal(cov.rows.length, 9, 'every target table present');
  for (const row of cov.rows) {
    assert.equal(row.rls, true, `${row.rel} rls enabled`);
    assert.equal(row.forced, true, `${row.rel} rls forced`);
    assert.equal(row.policies, 1, `${row.rel} has exactly one policy`);
  }
  assert.deepEqual(cov.rows.map((r) => r.rel).sort(), expect.sort());
});

test('Wave C · admissions lead: tenant A row invisible to tenant B (both directions)', async () => {
  assert.equal(await count(tenantA, 'plugin_admissions.lead', `guardian_phone='+919000000002'`), 1, 'own tenant sees exactly its row');
  assert.equal(await count(tenantB, 'plugin_admissions.lead', `guardian_phone='+919000000002'`), 1, 'tenant B sees exactly its row');
  // and the app role can NEVER write a row pinned to another tenant (WITH CHECK)
  await assert.rejects(
    () => asAppRole(tenantA,
      `INSERT INTO plugin_admissions.lead (tenant_id, student_name, guardian_phone, class_applied)
       VALUES ($1, 'Smuggled', '+919000000009', 'WaveC')`, [tenantB]),
    (e) => e.code === '42501', 'cross-tenant INSERT rejected');
});

test('Wave C · dpdp consent invisible cross-tenant + WITH CHECK holds', async () => {
  assert.equal(await count(tenantA, 'plugin_dpdp.consent', `purpose='wavec_probe'`), 1);
  assert.equal(await count(tenantB, 'plugin_dpdp.consent', `purpose='wavec_probe'`), 1);
  await assert.rejects(
    () => asAppRole(tenantB,
      `INSERT INTO plugin_dpdp.consent (tenant_id, subject_ref, purpose, decision)
       VALUES ($1, '+919000000004', 'wavec_probe', 'granted')`, [tenantA]),
    (e) => e.code === '42501', 'cross-tenant consent INSERT rejected');
});

test('Wave C · visitors visit invisible cross-tenant', async () => {
  assert.equal(await count(tenantA, 'plugin_visitors.visit', `badge_code='WC-PROBE'`), 1);
  assert.equal(await count(tenantB, 'plugin_visitors.visit', `badge_code='WC-PROBE'`), 1);
});

test('Wave C · sar + stage_history invisible cross-tenant', async () => {
  assert.equal(await count(tenantA, 'plugin_dpdp.sar', `subject_ref='+919000000003'`), 1);
  assert.equal(await count(tenantB, 'plugin_dpdp.sar', `subject_ref='+919000000003'`), 1);
  assert.equal(await count(tenantA, 'plugin_admissions.stage_history', `to_stage='wavec_stage'`), 1);
  assert.equal(await count(tenantB, 'plugin_admissions.stage_history', `to_stage='wavec_stage'`), 1);
});

test('Wave C · app.tenants: the app role sees only its own tenant row', async () => {
  assert.equal(await count(tenantA, 'app.tenants'), 1, 'two tenants exist, only one visible');
});

test('Wave C · revoked_token pinned; oauth_states app-readable; schema_migrations invisible', async () => {
  const jti = 'wavec-' + crypto.randomUUID();
  // Seed on the owner-path connection: asAppRole() ROLLBACKs every statement it
  // runs (b9 probe hygiene), so a seed written through it would be discarded
  // before the visibility probes below could ever see it.
  await sql(`INSERT INTO auth.revoked_token (jti, tenant_id, exp) VALUES ($1, $2, now() + interval '1 hour')`, [jti, tenantA]);
  assert.equal(await count(tenantA, 'auth.revoked_token', `jti='${jti}'`), 1, 'own-tenant revocation visible');
  assert.equal(await count(tenantB, 'auth.revoked_token', `jti='${jti}'`), 0, 'revocation invisible cross-tenant');

  const state = 'wavec-' + crypto.randomUUID();
  await sql(`INSERT INTO app.oauth_states (state) VALUES ($1)`, [state]);
  assert.equal(await count(tenantA, 'app.oauth_states', `state='${state}'`), 1, 'pre-auth state readable by app role (USING true)');

  assert.equal(await count(tenantA, 'app.schema_migrations'), 0, 'migration registry invisible to the app role');
  assert.equal(await count(tenantB, 'app.schema_migrations'), 0, 'migration registry invisible to the app role');
});

test('Wave C · /metrics is owner/itadmin-only Prometheus text', async () => {
  const unauth = await app.inject({ method: 'GET', url: '/metrics' });
  assert.ok([401, 403].includes(unauth.statusCode), 'unauthenticated refused');
  const teacher = await app.inject({ method: 'GET', url: '/metrics', headers: H(teacherToken) });
  assert.equal(teacher.statusCode, 403, 'teacher refused');
  const it = await app.inject({ method: 'GET', url: '/metrics', headers: H(itadminToken) });
  assert.equal(it.statusCode, 200, 'itadmin admitted');
  assert.ok(String(it.headers['content-type']).startsWith('text/plain'), 'prometheus text format');
  for (const metric of ['schoolos_uptime_seconds', 'schoolos_requests_total', 'schoolos_errors_total',
    'schoolos_pg_pool_total', 'schoolos_outbox_pending', 'schoolos_comms_queued',
    'schoolos_events_last_hour', 'schoolos_schema_migrations']) {
    assert.match(it.body, new RegExp(`^# TYPE ${metric} (gauge|counter)$`, 'm'), `metric ${metric} present`);
    assert.match(it.body, new RegExp(`^${metric} \\d+$`, 'm'), `metric ${metric} has a value`);
  }
});

test('Wave C · /capabilities is the decoupling contract', async () => {
  const unauth = await app.inject({ method: 'GET', url: '/capabilities' });
  assert.ok([401, 403].includes(unauth.statusCode), 'unauthenticated refused');
  const r = await app.inject({ method: 'GET', url: '/capabilities', headers: H(itadminToken) });
  assert.equal(r.statusCode, 200, r.body);
  const { rails } = r.json();
  assert.equal(rails.files.configured, true, 'files rail is kernel-native');
  assert.equal(rails.sms.configured, false, 'no SMS provider configured in tests');
  assert.equal(rails.library.enabled, false, 'no library plugin registered yet');
  assert.equal(rails.transport.enabled, false, 'transport.gps registered but not enabled');
});

test('Wave C · security headers on every response; HSTS only under FORCES_HTTPS', async () => {
  const r = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['x-frame-options'], 'DENY');
  assert.equal(r.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.equal(r.headers['permissions-policy'], 'camera=(), microphone=(), geolocation=()');
  assert.equal(r.headers['strict-transport-security'], undefined, 'no HSTS without FORCES_HTTPS');
});
