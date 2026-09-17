/* PLG-1 — the manifest is the ceiling, the row is the grant, and both are now enforced.

   The register said `permissions[]` was "written at seed time, then overwritten from the request body on enable,
   and read only for display. Zero permission-check helpers exist anywhere." That last sentence is the whole
   defect: a documented contract with no mechanism. These tests pin the mechanism, and they pin the thing that
   made the old behaviour indefensible — an API caller authoring its own consent.
*/

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';
import {
  KERNEL_PERMISSIONS, PERMISSION_SEAM, declaredPermissions, unknownPermissions,
  grantedFor, covers, firstMissing,
} from '../src/plugin-permissions.js';

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

describe('PLG-1 · permissions are the ceiling, the row is the grant', () => {
  let app; let pool; let owner; let tenantId;
  const sql = (text, params) => pool.query(text, params);

  before(async () => {
    await setupTestDb();
    const { buildApp } = await import('../src/app.js');
    app = await buildApp({ logger: false });
    pool = (await import('../src/db.js')).pool;
    owner = await loginAs(app, 'owner@meridian.edu');
    // loginAs returns a token, not a tenant id — read the seeded tenant the way the other suites do
    tenantId = (await pool.query(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  });

  test('the vocabulary, the seam map and every manifest agree — no drift, no invented word', async () => {
    // A permission invented in a manifest must be refused at boot, so the vocabulary is the contract.
    assert.deepEqual(unknownPermissions(['students.read', 'root.everything']), ['root.everything']);
    assert.deepEqual(unknownPermissions([]), []);
    // every permission the seam map claims to enforce must be in the vocabulary, and vice versa: a seam entry
    // for a word nobody can declare is how the docs drifted three ways in the first place.
    for (const p of Object.keys(PERMISSION_SEAM)) assert.ok(KERNEL_PERMISSIONS.includes(p), `${p} has a seam but is not declarable`);
    for (const p of KERNEL_PERMISSIONS) assert.ok(PERMISSION_SEAM[p], `${p} is declarable but has no seam entry (not even 'unenforced')`);
    // every manifest on disk declares only known permissions (PLG-1's boot check, asserted here over all of them)
    const { readdirSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const dir = join(dirname(fileURLToPath(import.meta.url)), '../src/plugins');
    // plugin ids CONTAIN dots (ops.visitors), so filter on "is a directory", not on the name
    const ids = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('_')).map((d) => d.name);
    assert.ok(ids.length >= 29, `expected the full plugin set, found ${ids.length}`);
    let declaredCount = 0;
    for (const id of ids) {
      const declared = await declaredPermissions(id);
      assert.ok(declared !== null, `${id} has no manifest.js — the loader mounts one, so this resolver must find it`);
      assert.deepEqual(unknownPermissions(declared), [], `${id} declares a permission outside the kernel vocabulary`);
      if (declared.length) declaredCount++;
    }
    assert.ok(declaredCount >= 29, `all ${ids.length} plugins must declare their needs; only ${declaredCount} do`);
  });

  test('covers / firstMissing — the truth table the gate depends on', () => {
    assert.equal(covers(['a', 'b'], ['a']), true);
    assert.equal(covers(['a'], ['a', 'b']), false);
    assert.equal(covers([], []), true, 'a plugin that declares nothing needs nothing (it is not a free pass)');
    assert.equal(covers([], ['a']), false);
    assert.equal(firstMissing(['a'], ['a', 'b']), 'b');
    assert.equal(firstMissing(['a', 'b'], ['a', 'b']), null);
    // non-vacuity: these are two different answers, so the assertions above discriminate
    assert.notEqual(covers(['a'], ['a']), covers(['a'], ['a', 'b']));
  });

  test('the enable door stores the MANIFEST declaration, never the caller\'s set', async () => {
    const declared = await declaredPermissions('library');
    assert.ok(declared.length >= 3, 'library must declare its needs');
    // The caller asks for less than the plugin needs — the old code stored exactly this.
    const res = await app.inject({
      method: 'POST', url: '/plugins/library/enable', headers: H(owner.token),
      payload: { version: '1.0.0', class: 'C', permissions: ['students.read'] },
    });
    assert.equal(res.statusCode, 200, res.body);
    const row = (await sql(`SELECT permissions FROM app.plugins WHERE tenant_id=$1 AND plugin_id='library'`, [tenantId])).rows[0];
    assert.deepEqual([...row.permissions].sort(), [...declared].sort(),
      'the stored grant is the on-disk declaration: consent in the ledger is the manifest, not the request');
    assert.notDeepEqual([...row.permissions].sort(), ['students.read'], 'the caller\'s smaller set must NOT be stored');

    // and asking for MORE must not widen it either — that is the same cheat in the other direction
    const res2 = await app.inject({
      method: 'POST', url: '/plugins/library/enable', headers: H(owner.token),
      payload: { version: '1.0.0', class: 'C', permissions: [...declared, 'payments.write'] },
    });
    assert.equal(res2.statusCode, 200, res2.body);
    const row2 = (await sql(`SELECT permissions FROM app.plugins WHERE tenant_id=$1 AND plugin_id='library'`, [tenantId])).rows[0];
    assert.ok(!row2.permissions.includes('payments.write'), 'a caller cannot grant itself a permission the plugin never declared');
  });

  test('a door refuses while the stored grant does not cover the declaration', async () => {
    // realistic drift: the row is short a permission the manifest declares (a new plugin version, or an operator
    // hand-editing the registry). This is the enforcement — and it names the gap rather than saying "forbidden".
    const declared = await declaredPermissions('library');
    await sql(`UPDATE app.plugins SET permissions=$2::jsonb WHERE tenant_id=$1 AND plugin_id='library'`,
      [tenantId, JSON.stringify(declared.slice(1))]);
    const drift = (await sql(`SELECT permissions FROM app.plugins WHERE tenant_id=$1 AND plugin_id='library'`, [tenantId])).rows[0].permissions;
    assert.notDeepEqual([...drift].sort(), [...declared].sort(), 'fixture: the stored grant is genuinely short');
    const denied = await app.inject({ method: 'GET', url: '/plugins/library/books', headers: H(owner.token) });
    assert.equal(denied.statusCode, 403, `a short grant must refuse the door: ${denied.statusCode} ${String(denied.body).slice(0, 160)}`);
    assert.equal(denied.json().code, 'PERMISSION_DENIED');
    assert.equal(denied.json().permission, declared[0], 'the refusal names the permission that is missing');
    assert.match(denied.json().error, /ask the school owner/i);

    // re-enabling records the manifest's set again, and the door opens
    await app.inject({ method: 'POST', url: '/plugins/library/enable', headers: H(owner.token), payload: { version: '1.0.0', class: 'C' } });
    const ok = await app.inject({ method: 'GET', url: '/plugins/library/books', headers: H(owner.token) });
    assert.equal(ok.statusCode, 200, `after re-enable the grant covers the declaration: ${String(ok.body).slice(0, 160)}`);
  });

  test('grantedFor never empties a catalog-only row, and never invents one', () => {
    assert.deepEqual(grantedFor('library', ['students.read'], ['fees.read']), ['students.read'], 'the manifest wins');
    assert.deepEqual(grantedFor('ghost.plugin', null, ['fees.read']), ['fees.read'], 'no manifest on disk: keep what the row had');
    assert.deepEqual(grantedFor('ghost.plugin', null, null), [], 'and never invent a grant for a row that had none');
  });
});
