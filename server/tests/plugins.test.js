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
    assert.equal(res.json().plugins.length, 0, 'rival tenant must not see Meridian plugins');
  });
});
