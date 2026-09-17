// FEX-17 — one test that asserts, for EVERY plugin, the three platform contracts:
//   · every route carries the lifecycle gate
//   · every declared permission is in the kernel vocabulary
//   · a declared settingsSchema is an object with typed property entries
// It reuses the real route scanner, so it cannot drift from the CI permission-matrix gate.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { scanRoutes } from '../scripts/permission-matrix.js';
import { unknownPermissions, KERNEL_PERMISSIONS } from '../src/plugin-permissions.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGINS = join(HERE, '..', 'src', 'plugins');
const pluginIds = readdirSync(PLUGINS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== '_shared')
  .map((d) => d.name);

describe('FEX-17 · plugin conformance (gate, permissions, schema)', () => {
  test('every plugin route carries the lifecycle gate', () => {
    const files = pluginIds.map((id) => join(PLUGINS, id, 'index.js')).filter(existsSync);
    const routes = scanRoutes(files);
    assert.ok(routes.length > 100, `expected the plugin surface to be large, saw ${routes.length} routes`);
    // The only reviewed exceptions are the PUBLIC_ALLOWLIST webhook receivers (HMAC-verified in-handler,
    // classified `public` by the scanner) — an inbound gateway callback must not depend on the enable gate.
    const ungated = routes.filter((r) => !r.lifecycle && r.cls !== 'public');
    assert.deepEqual(ungated.map((r) => `${r.method} ${r.path} (${r.file})`), [],
      'every plugin route must pass through makeLifecycleGate — an ungated route is invisible to enable/disable');
  });

  test('every manifest declares only kernel permissions', async () => {
    for (const id of pluginIds) {
      const mf = join(PLUGINS, id, 'manifest.js');
      if (!existsSync(mf)) continue;
      const mod = await import(pathToFileURL(mf).href);
      const declared = mod.default?.permissions ?? [];
      const unknown = unknownPermissions(declared);
      assert.deepEqual(unknown, [], `${id} declares permission(s) outside the vocabulary: ${unknown.join(', ')}`);
      for (const p of declared) assert.ok(KERNEL_PERMISSIONS.includes(p), `${id}: ${p}`);
    }
  });

  test('a declared settingsSchema is an object with typed properties', async () => {
    const TYPES = ['string', 'integer', 'number', 'boolean', 'array', 'object'];
    for (const id of pluginIds) {
      const mf = join(PLUGINS, id, 'manifest.js');
      if (!existsSync(mf)) continue;
      const mod = await import(pathToFileURL(mf).href);
      const schema = mod.default?.settingsSchema;
      if (schema == null) continue;
      assert.equal(schema.type, 'object', `${id}: settingsSchema.type must be "object"`);
      assert.ok(schema.properties && typeof schema.properties === 'object', `${id}: settingsSchema needs properties`);
      for (const [key, field] of Object.entries(schema.properties)) {
        assert.ok(TYPES.includes(field?.type), `${id}.${key}: field type must be one of ${TYPES.join('/')}`);
      }
    }
  });
});
