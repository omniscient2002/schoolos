// Plugin registry tests: enable → visible → disable → audit trail; RLS isolation.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';

let app;

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.ready();
});

after(async () => { if (app) await app.close(); });

describe('plugin registry', () => {
  test('owner can enable a plugin; it appears with status and permissions', async () => {
    const o = await loginAs(app, 'owner@meridian.edu');
    const H = { authorization: `Bearer ${o.token}` };
    const res = await app.inject({ method: 'POST', url: '/plugins/library/enable', payload: { version: '1.0.0', class: 'A', permissions: ['students.read'] }, headers: H });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().plugin.status, 'enabled');
    const list = await app.inject({ method: 'GET', url: '/plugins', headers: H });
    const lib = list.json().plugins.find(p => p.plugin_id === 'library');
    assert.ok(lib, 'listed after enable');
    assert.equal(lib.status, 'enabled');
  });

  test('teacher cannot enable plugins (governance role-gated)', async () => {
    const t = await loginAs(app, 'teacher@meridian.edu');
    const res = await app.inject({ method: 'POST', url: '/plugins/library/disable', payload: {}, headers: { authorization: `Bearer ${t.token}` } });
    assert.equal(res.statusCode, 403);
  });

  test('disable hides the plugin but the audit trail remains', async () => {
    const o = await loginAs(app, 'owner@meridian.edu');
    const H = { authorization: `Bearer ${o.token}` };
    await app.inject({ method: 'POST', url: '/plugins/library/disable', payload: {}, headers: H });
    const list = await app.inject({ method: 'GET', url: '/plugins', headers: H });
    const lib = list.json().plugins.find(p => p.plugin_id === 'library');
    assert.equal(lib.status, 'disabled');
    const aud = await app.inject({ method: 'GET', url: '/audit?limit=50', headers: H });
    const plugEntries = aud.json().entries.filter(e => e.record_type === 'Plugin');
    assert.ok(plugEntries.length >= 2, 'enable + disable both audited');
    assert.ok(plugEntries.some(e => e.action.includes('enabled: library')));
    assert.ok(plugEntries.some(e => e.action.includes('disabled: library')));
  });

  test('plugin rows are tenant-scoped (RLS)', async () => {
    const pg = (await import('pg')).default;
    const { TEST_URL } = await import('./helpers.js');
    const { hashPassword } = await import('../src/auth.js');
    const c = new pg.Client({ connectionString: TEST_URL });
    await c.connect();
    const tb = (await c.query(`INSERT INTO app.tenants (slug, name) VALUES ('rival2','Rival Two') RETURNING id`)).rows[0];
    await c.query(`INSERT INTO app.users (tenant_id, email, name, role, password_hash) VALUES ($1,'boss2@rival.edu','Boss Two','principal',$2)`, [tb.id, hashPassword('rival2-pw')]);
    await c.end();
    const rival = await loginAs(app, 'boss2@rival.edu', 'rival2-pw');
    const res = await app.inject({ method: 'GET', url: '/plugins', headers: { authorization: `Bearer ${rival.token}` } });
    assert.equal(res.statusCode, 200);
    // Catalog self-heal seeds the rival's OWN registry (23 rows, RLS-scoped) —
    // what must NEVER leak is another tenant's rows: ids, settings and counts
    // must be the rival's own, not Meridian's. Direct cross-tenant read under
    // the rival's GUC stays the hard isolation proof.
    const rivalRows = res.json().plugins;
    assert.ok(Array.isArray(rivalRows) && rivalRows.length > 0, 'self-heal gave the rival its own catalog');
    const rivalIds = new Set(rivalRows.map(p => p.plugin_id));
    assert.ok(rivalIds.has('library') && rivalIds.has('people.admin'), 'rival sees its own catalog ids');
    const pg2 = (await import('pg')).default;
    const c2 = new pg2.Client({ connectionString: TEST_URL });
    await c2.connect();
    /* TST-4: this block used to assert `leaked >= 0` — a count is never negative, so the assertion could not
       fail — and it set the tenant GUC on the OWNER connection, which bypasses RLS, so the query it measured
       was not the query that matters. What matters is what the APP role sees when it names a tenant.
       Discriminating pair: as `schoolos_app` under the rival's GUC, another tenant's rows must be invisible;
       as the same role under the same GUC, the rival's OWN rows must be visible — otherwise the zero is just
       an empty table and proves nothing. The owner path supplies the non-vacuity check: there really is a
       Meridian `library` row to leak. */
    const asApp = async (tenantId, text, params) => {
      const c = new pg2.Client({ connectionString: TEST_URL });
      await c.connect();
      try {
        await c.query('BEGIN');
        await c.query('SET LOCAL ROLE schoolos_app');
        await c.query(`SELECT set_config('schoolos.tenant_id', $1, true)`, [tenantId]);
        const r = await c.query(text, params);
        await c.query('COMMIT');
        return r;
      } finally { await c.end(); }
    };
    const toLeak = (await c2.query(
      `SELECT count(*)::int AS n FROM app.plugins WHERE tenant_id <> $1 AND plugin_id = 'library'`, [tb.id])).rows[0].n;
    assert.ok(toLeak >= 1, 'NON-VACUITY: another tenant really does hold a library row, so the zero below is RLS');
    const leaked = (await asApp(tb.id,
      `SELECT count(*)::int AS n FROM app.plugins WHERE tenant_id <> $1 AND plugin_id = 'library'`, [tb.id])).rows[0].n;
    assert.equal(leaked, 0, 'the app role with the rival GUC sees NO other tenant\'s plugin rows');
    const own = (await asApp(tb.id,
      `SELECT count(*)::int AS n FROM app.plugins WHERE tenant_id = $1 AND plugin_id = 'library'`, [tb.id])).rows[0].n;
    assert.equal(own, 1, 'and DOES see its own — so the same query works and the isolation is the policy, not the data');
    await c2.end();
  });
});
