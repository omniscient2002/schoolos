/* ============================================================
   GET /dataset — the demo dataset, served from generated bundles
   (esbuild IIFE of the former frontend mock). Evaluation happens
   ONCE on the server, Dates become ISO strings in JSON transit,
   and the client revives them. Deterministic across restarts.
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DIR = path.join(__dirname, 'generated');

function evalModule(name) {
  const code = fs.readFileSync(path.join(DIR, name + '.js'), 'utf8');
  const sandbox = { console, Date, Math, JSON, result: null };
  vm.createContext(sandbox);
  vm.runInContext(code + '\nresult = MOCK_' + name.toUpperCase() + ';', sandbox, { filename: name + '.js' });
  return sandbox.result;
}

let cache = null;
function dataset() {
  if (cache) return cache;
  const seed = evalModule('seed');
  const maintenance = evalModule('maintenance');
  const reception = evalModule('reception');
  const scenarios = evalModule('scenarios');
  cache = { seed, maintenance, reception, scenarios };
  return cache;
}

// drop functions — the wire carries data, not behavior
function dataOnly(obj, depth = 0) {
  if (obj == null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return obj.toISOString();
  if (depth > 6) return null;
  if (Array.isArray(obj)) return obj.map(v => dataOnly(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'function') continue;
    out[k] = dataOnly(v, depth + 1);
  }
  return out;
}

function serializeDataset() {
  const d = dataset();
  const out = {};
  for (const mod of Object.keys(d)) {
    for (const [k, v] of Object.entries(d[mod])) {
      if (typeof v === 'function') continue;
      out[k] = dataOnly(v);
    }
  }
  return out;
}

export { serializeDataset as dataset };
