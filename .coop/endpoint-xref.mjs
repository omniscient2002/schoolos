#!/usr/bin/env node
/* Endpoint cross-reference: backend doors vs frontend bindings (audit-only). */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '/home/cassandra/schoolOS';
const SERVER = join(ROOT, 'server/src');
const APP = join(ROOT, 'app/src');

const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

const norm = (path) => {
  let p = path
    .replace(/\$\{ID\}/g, ':pid')            // plugin file IDs resolved earlier
    .split('?')[0]                             // query strings never identify a door
    .replace(/\$\{[^}]+\}/g, ':p')           // template literals in frontend
    .replace(/:[A-Za-z][A-Za-z0-9]*/g, ':p')  // fastify params
    .replace(/\/+$/, '');
  return p;
};
const toRe = (p) => new RegExp('^' + norm(p).split('/').map(s => s.startsWith(':') ? '[^/]+' : s).join('/') + '$');

/* ---------- backend doors ---------- */
const backend = []; // {file, method, path}
const serverFiles = walk(SERVER).filter(f => f.endsWith('.js') && !f.endsWith('.test.js'));
for (const f of serverFiles) {
  const src = readFileSync(f, 'utf8');
  const idm = src.match(/const ID = ['"`]([^'"`]+)['"`]/);
  let s = src;
  if (idm) s = s.replace(/\$\{ID\}/g, idm[1]);
  if (f.endsWith('settings-contract.js')) s = s.replace(/\$\{pluginId\}/g, ':p');
  const lines = s.split('\n').map(l => l.trim()).filter(l => !l.startsWith('//') && !l.startsWith('*'));
  const joined = lines.join('\n');
  const re = /\bapp\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g;
  let m;
  while ((m = re.exec(joined))) backend.push({ file: f.replace(SERVER + '/', ''), method: m[1].toUpperCase(), path: m[2] });
}

/* ---------- frontend bindings ---------- */
const fwd = []; // {file, method, path, kind: 'api-fn'|'direct', fn?}
const appFiles = walk(APP).filter(f => /\.(ts|tsx)$/.test(f));
const fnRe = /(?:call\s*[^('"`]*\(\s*|apiGet\(\s*|apiPost\(\s*|apiPut\(\s*|apiPatch\(\s*|apiDel\(\s*)(['"`])([^'"`]+)\1/g; // generic may nest — skip to '('
// raw fetch(): fetch(`${LIVE_BASE}/path...`) or fetch('/path') — take the literal path part
const fetchRe = /fetch\(\s*(?:`\$\{[A-Za-z_]+\}|['"`])\s*(\/?[^'"`]+)/g;
const fetchPaths = (src) => { const out = []; let m; const re = new RegExp(fetchRe.source, 'g'); while ((m = re.exec(src))) { const seg = m[1]; if (seg.startsWith('/')) out.push(seg); } return out; };
const httpVerbRe = /method:\s*['"](GET|POST|PUT|PATCH|DELETE)['"]/;
for (const f of appFiles) {
  const src = readFileSync(f, 'utf8');
  // exported api functions with their path + method
  const lines = src.split('\n').map((l, idx) => ({ raw: l, t: l.trim() })).filter(x => !x.t.startsWith('//') && !x.t.startsWith('*'));
  lines.forEach((x, i) => {
    const line = x.raw;
    let m;
    const re = new RegExp(fnRe.source, 'g');
    while ((m = re.exec(line))) {
      const path = m[2];
      if (!path.startsWith('/')) continue;
      // find method within the next 2 lines (call options object)
      const ctx = lines.slice(i, i + 3).join(' ');
      const vm = ctx.match(httpVerbRe);
      const isApiFn = /export const api/.test(line) || /export const api/.test(lines[i - 1] ?? '');
      fwd.push({ file: f.replace(APP + '/', ''), method: vm ? vm[1] : 'GET', path, kind: isApiFn ? 'api-fn' : 'direct' });
    }
    for (const p2 of fetchPaths(line)) {
      const ctx = lines.slice(Math.max(0, i - 1), i + 3).map((y) => y.raw).join(' ');
      const vm = ctx.match(httpVerbRe);
      fwd.push({ file: f.replace(APP + '/', ''), method: vm ? vm[1] : 'GET', path: p2, kind: 'fetch' });
    }
  });
}

/* match forward: backend door covered by frontend? */
const fwdNorm = fwd.map(x => ({ ...x, re: toRe(x.path) }));
const uncovered = [];
for (const b of backend) {
  const bre = toRe(b.path);
  const hit = fwdNorm.find(x => (x.method === b.method || x.method === 'GET' && false) && x.re.test(norm(b.path)) && norm(b.path).match(x.re));
  // method-agnostic fallback: same path shape any method (frontend may POST via generic)
  const hitAny = fwdNorm.find(x => x.re.test(norm(b.path)));
  if (!hitAny) uncovered.push(b);
}

/* match reverse: frontend call with no backend door (method-agnostic; note method drift) */
const beNorm = backend.map(x => ({ ...x, re: toRe(x.path) }));
const phantom = []; const methodDrift = [];
for (const x of fwd) {
  const pathHit = beNorm.filter(b => b.re.test(norm(x.path)));
  if (pathHit.length === 0) phantom.push(x);
  else if (!pathHit.some(b => b.method === x.method)) methodDrift.push({ ...x, actual: pathHit.map(b => b.method).join('/') });
}

/* frontend api-fn bindings never imported by any screen/component */
const used = new Set();
for (const f of appFiles) {
  const src = readFileSync(f, 'utf8');
  for (const x of fwd.filter(y => y.kind === 'api-fn')) {
    const name = (src.match(new RegExp(`export const (api[A-Za-z0-9_]*)`, 'g')) || []);
  }
}
// simpler: collect all api fn names defined in liveApi, then grep imports across app/src
const liveApiSrc = readFileSync(join(APP, 'services/liveApi.ts'), 'utf8');
const apiNames = [...liveApiSrc.matchAll(/export const (api[A-Za-z0-9_]*)/g)].map(m => m[1]);
const unused = apiNames.filter(name => {
  for (const f of appFiles) {
    if (f.endsWith('services/liveApi.ts')) continue;
    const src = readFileSync(f, 'utf8');
    if (new RegExp(`\\b${name}\\b`).test(src)) return false;
  }
  return true;
});

const fmt = (arr) => arr.map(x => `${x.method.padEnd(6)} ${x.path}   [${x.file}]`).sort().join('\n');

console.log(`=== BACKEND DOORS: ${backend.length}  |  FRONTEND BINDINGS: ${fwd.length}  |  liveApi fns: ${apiNames.length} ===\n`);
console.log('--- A) BACKEND DOORS WITH NO FRONTEND BINDING (any method) ---');
console.log(fmt(uncovered) || '(none)');
console.log(`\n--- B) FRONTEND CALLS WITH NO BACKEND DOOR under ANY method (real phantoms) ---`);
console.log(fmt(phantom) || '(none)');
console.log(`\n--- B2) METHOD DRIFT (path exists, method differs) ---`);
console.log(fmt(methodDrift) || '(none)');
console.log(`\n--- C) liveApi FNS DEFINED BUT NEVER IMPORTED ANYWHERE (dead bindings) ---`);
console.log(unused.join('\n') || '(none)');
