// H7 · the signup catalog constant must not drift from the on-disk manifests.
//
// `plugin-catalog.js` seeds a new tenant's `app.plugins` rows at signup; per PLG-1 the recorded
// permissions ARE the grant, so a catalog row that under-grants (fewer permissions than the manifest
// declares) silently denies the plugin a facility it needs — while the enable door, which resolves
// from the manifest, would grant it. This test pins version/class/permissions to the manifest.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLUGIN_CATALOG } from '../src/plugin-catalog.js';

const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const setEq = (a, b) => [...a].sort().join(',') === [...b].sort().join(',');

describe('H7 · plugin catalog vs on-disk manifests', () => {
  for (const row of PLUGIN_CATALOG) {
    const manifestPath = join(SERVER_ROOT, 'src', 'plugins', row.plugin_id, 'manifest.js');
    if (!existsSync(manifestPath)) continue; // no module on disk — nothing to reconcile against
    test(`${row.plugin_id} matches its manifest`, async () => {
      const mf = (await import(`../src/plugins/${row.plugin_id}/manifest.js`)).default;
      assert.equal(String(row.version), String(mf.version), `${row.plugin_id} version drifted`);
      assert.equal(String(row.class), String(mf.class), `${row.plugin_id} class drifted`);
      assert.ok(setEq(row.permissions, mf.permissions ?? []),
        `${row.plugin_id} permissions drifted: catalog [${[...row.permissions].sort()}] vs manifest [${[...(mf.permissions ?? [])].sort()}]`);
    });
  }
});
