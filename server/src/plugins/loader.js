// Plugin loader — the ONE registration point (docs/11 §2.2 plugin-native factory).
// Adding a plugin = dropping a folder: src/plugins/<id>/manifest.js + index.js with
// register(app, kernel). No core edits. Enable/disable remains registry-driven
// (app.plugins via /plugins endpoints + drain protocol); the loader only mounts doors.
//
// Guards: directory name must be a valid plugin id (same regex the registry routes
// enforce — redteam P1-1), manifest.id (if exported) must match the directory,
// register() must be a function. A failing plugin fails LOUD (boot error), never silent.
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// registry namespace: comms.whatsapp · pack.cbse · ops.timetable · com.vendor.thing
// cycle-3 pattern: letter-first (digit-run ids like '9lives' are out), underscore excluded.
export const PLUGIN_ID_RE = /^[a-z][a-z0-9.-]{2,63}$/;
export const validPluginId = (id) => typeof id === 'string' && PLUGIN_ID_RE.test(id);

export async function loadPlugins(app, kernel, { dir = dirname(fileURLToPath(import.meta.url)) } = {}) {
  const loaded = [];
  const failed = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
    const id = entry.name;
    try {
      if (!validPluginId(id)) throw new Error(`invalid plugin id (must match ${PLUGIN_ID_RE})`);
      // charter layout: manifest.js (governance truth) + index.js (register(app, kernel))
      let manifest;
      try {
        const m = await import(pathToFileURL(join(dir, id, 'manifest.js')).href);
        manifest = m.default;
      } catch {
        throw new Error('missing manifest.js with a default-export manifest');
      }
      if (!manifest || typeof manifest !== 'object') throw new Error('manifest.js must default-export an object');
      if (manifest.id !== id) throw new Error(`manifest.id "${manifest.id}" ≠ directory "${id}"`);
      const mod = await import(pathToFileURL(join(dir, id, 'index.js')).href);
      if (typeof mod.register !== 'function') throw new Error('index.js must export register(app, kernel)');
      mod.register(app, kernel);
      loaded.push({ id, manifest });
    } catch (e) {
      failed.push({ id, error: e.message });
    }
  }
  loaded.sort((a, b) => a.id.localeCompare(b.id));
  if (failed.length) {
    // fail loud: a plugin that cannot mount must never half-exist
    throw new Error(`plugin load failures: ${failed.map(f => `${f.id}: ${f.error}`).join(' · ')}`);
  }
  return { loaded, failed };
}
