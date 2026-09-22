// PLG-4 (PERFECT-100 §5.3) — the enable door resolves registry metadata from the MANIFEST, not the request body.
//
// THE DEFECT: `POST /plugins/:id/enable` took `version`, `class`, `manifest` and `permissions` from the request
// body. `permissions` was already ignored for storage (PLG-1), but version/class/manifest still were — so a
// caller could record library (really class C) as class A, at an invented version, with an invented manifest.
// Since the row records the consent the whole plugin model trusts, the audit trail could be client-authored.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const brief = (r) => `HTTP ${r.statusCode} ${String(r.body ?? '').slice(0, 160)}`;

let app; let pool; let owner;
before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  pool = (await import('../src/db.js')).pool;
  owner = await loginAs(app, 'owner@meridian.edu');
});
after(async () => { await app?.close(); });

describe('PLG-4 · enable metadata comes from the manifest', () => {
  test('a body claiming another class/version/manifest cannot change what is recorded', async () => {
    // Delete the seeded row first so the INSERT path is exercised: the seed pre-registers every catalog plugin,
    // and `ON CONFLICT` does not update `class`, so without this the body's class is irrelevant either way and
    // the assertion would pass even against the old trust-the-body code (found by mutation, not by reading).
    const t = (await pool.query(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
    await pool.query(`DELETE FROM app.plugins WHERE tenant_id=$1 AND plugin_id='library'`, [t]);
    const r = await app.inject({ method: 'POST', url: '/plugins/library/enable', headers: H(owner.token), payload: {
      class: 'A', version: '9.9.9',
      manifest: { id: 'library', evil: true },
      permissions: ['students.read'],
    } });
    assert.equal(r.statusCode, 200, brief(r));
    const p = r.json().plugin;
    assert.equal(p.class, 'C', 'the manifest says class C; the body said A and must not win');
    assert.equal(p.version, '2.0.0', 'the manifest version, not the body\'s 9.9.9');
    assert.equal(p.manifest.id, 'library');
    assert.equal(p.manifest.evil, undefined, 'the body manifest must not be stored');
    assert.deepEqual([...p.permissions].sort(), ['audit.request', 'events.emit', 'students.read', 'users.read'],
      'the stored grant is the manifest declaration, not the body permission');
  });

  test('an id with no module on disk is refused, not fabricated into a registry row', async () => {
    const r = await app.inject({ method: 'POST', url: '/plugins/does.not.exist/enable', headers: H(owner.token), payload: { class: 'A' } });
    assert.equal(r.statusCode, 404, brief(r));
    const row = await pool.query(`SELECT 1 FROM app.plugins WHERE plugin_id='does.not.exist'`);
    assert.equal(row.rowCount, 0, 'no row may be created for a plugin that does not exist');
  });
});
