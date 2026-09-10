// T207 — UI↔door parity gate (audit §23 R2.10, the guardrail that kills the
// two-universes regression). Sibling of permission-matrix.js (same scanner, kept
// separate so the matrix's fail-on-unguarded contract stays clean); both run in CI.
//
// For every WRITE door (non-GET, minus webhook/ops) it greps app/src for callers:
//   · wired        — a caller exists OUTSIDE app/src/services (a screen/component),
//                    OR the door's URL lives in an exported service wrapper that a
//                    screen actually imports (call chain: screen → wrapper → door)
//   · wrapper-only — callers exist only inside app/src/services (a liveApi wrapper
//                    no screen reaches — the audit's orphan-with-decoy class)
//   · orphan       — no caller anywhere
// Plus the hard regression class: any app/src file importing the mock plane
// (`services` / `services/index`) — the write theater that fakes success toasts.
//
// Scope note: this gate proves CALLER existence, not screen reachability — the
// audit's DARK class (wired screens with no nav entry) stays with fe-map review.
//
// DEFAULT IS REPORT-ONLY (yellow list printed, exit 0) — the sprint's lanes are
// actively re-pointing screens, so the first run must not red the pipeline. Run
// `node scripts/parity-gate.js --enforce` (final gate / post-sprint CI) to fail on
// any wrapper-only/orphan door or mock import.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRoutes } from './permission-matrix.js';

const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP_SRC = join(SERVER_ROOT, '..', 'app', 'src');
const ENFORCE = process.argv.includes('--enforce');

const walk = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) out.push(p);
  }
  return out;
};

// ── 1. server write doors (same scanner the permission matrix uses) ──────────
const routeFiles = [join(SERVER_ROOT, 'src', 'app.js'), join(SERVER_ROOT, 'src', 'routes.js'),
  ...readdirSync(join(SERVER_ROOT, 'src', 'plugins'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_') && statSync(join(SERVER_ROOT, 'src', 'plugins', e.name, 'index.js')).isFile())
    .map((e) => join(SERVER_ROOT, 'src', 'plugins', e.name, 'index.js'))];
const doors = scanRoutes(routeFiles)
  .filter((r) => r.method !== 'GET')
  .filter((r) => !r.path.endsWith('/webhook') && !['/health', '/ready', '/metrics'].includes(r.path))
  // normalize plugin routes declared with inline template conditionals, e.g.
  // `/users/:id/${suspend ? 'suspend' : 'activate'}` → `/users/:id/`
  .map((r) => ({ ...r, path: r.path.replace(/\$\{[^}]*\}/g, '').replace(/\/+$/, '') || r.path }));

// door matcher: exact paths need a boundary after them (so `/migration/sources`
// doesn't match inside `/migration/sources/:id/stage`); parametrized paths match
// head + tail-literal joints (covers `/cases/${id}/status` template calls).
const splitParams = (path) => {
  const head = path.split(/[:$]/)[0].replace(/[/:]+$/, '');
  const segs = path.split('/').filter(Boolean);
  const tail = segs.length && !segs[segs.length - 1].includes(':') ? `/${segs[segs.length - 1]}` : '';
  return { head: head || path, tail, hasParams: /[:$]/.test(path) };
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const doorMatcher = (door) => {
  const { head, tail, hasParams } = splitParams(door.path);
  if (!hasParams) {
    const re = new RegExp(`${esc(door.path)}(?=['"\x60?$]|$)`);
    return (body) => re.test(body);
  }
  return (body) => body.includes(head) && (!tail || body.includes(tail));
};

// ── 2. client corpus ─────────────────────────────────────────────────────────
const files = walk(APP_SRC);
const rel = (p) => relative(APP_SRC, p);
const contents = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));
const inServices = (f) => rel(f).startsWith('services');

// Demo-build-only screens (App.tsx:122-126): DEMO_BUILD folds false in production,
// Rollup tree-shakes them out of dist — their callers never ship. Parity.md's
// DEMO-ONLY verdict class. Keep in sync with the ternaries in App.tsx.
const DEMO_ONLY = new Set(['screens/Demo.tsx', 'screens/DemoDay.tsx', 'screens/DemoParent.tsx', 'screens/DemoSummary.tsx', 'screens/LiveMode.tsx']);
const tierOf = (f) => inServices(f) ? 'svc' : DEMO_ONLY.has(rel(f)) ? 'demo' : 'ui';

// exported wrappers per service file: name → body span (URL match ⇒ that export)
const exportSpans = new Map();
for (const [f, src] of contents) {
  if (!inServices(f)) continue;
  const re = /export\s+(?:async\s+)?(?:const|function)\s+([A-Za-z0-9_$]+)/g;
  const spans = [];
  let m;
  while ((m = re.exec(src))) spans.push({ name: m[1], start: m.index });
  spans.forEach((s, i) => { s.end = i + 1 < spans.length ? spans[i + 1].start : src.length; });
  exportSpans.set(f, spans);
}
const exportUsedInUI = (svcFile, name) => {
  const base = rel(svcFile).replace(/\.[jt]sx?$/, '').split('/').pop();
  for (const [f, src] of contents) {
    if (inServices(f) || DEMO_ONLY.has(rel(f))) continue; // demo screens never ship
    if (new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*['"][^'"]*\\b${base}\\b['"]`).test(src)) return true;
    if (new RegExp(`import\\s+\\*\\s+as\\s+\\w+\\s+from\\s+['"][^'"]*\\b${base}\\b['"]`).test(src)
      && new RegExp(`\\b${name}\\b`).test(src)) return true;
  }
  return false;
};

const verdicts = [];
for (const door of doors) {
  const match = doorMatcher(door);
  const hits = { ui: [], svc: [], demo: [] };
  for (const [f, src] of contents) {
    if (match(src)) hits[tierOf(f)].push(f);
  }
  const via = new Set();
  if (!hits.ui.length) {
    for (const [f, spans] of exportSpans) {
      const src = contents.get(f);
      for (const s of spans) if (match(src.slice(s.start, s.end)) && exportUsedInUI(f, s.name)) via.add(s.name);
    }
  }
  const verdict = hits.ui.length || via.size ? 'wired' : hits.svc.length ? 'wrapper-only' : hits.demo.length ? 'demo-only' : 'orphan';
  verdicts.push({ door, verdict, ui: hits.ui.map(rel), svc: hits.svc.map(rel), demo: hits.demo.map(rel), via: [...via] });
}

// ── 3. mock-plane imports (the regression class) ─────────────────────────────
// Screens import the mock brain as a directory (`from '../services'`) or explicitly
// (`services/index` / `services/index.js`).
const mockImporters = files
  .filter((f) => !rel(f).startsWith('services/'))
  .filter((f) => /from\s+['"][^'"]*\/services(\/index(\.js)?)?['"]/.test(contents.get(f)))
  .map(rel);

// ── 4. report ────────────────────────────────────────────────────────────────
const count = (v) => verdicts.filter((x) => x.verdict === v).length;
console.log(`parity gate: ${doors.length} write doors · wired ${count('wired')} · wrapper-only ${count('wrapper-only')} · demo-only ${count('demo-only')} · orphan ${count('orphan')} · mock-plane importers ${mockImporters.length}`);

const wiredViaWrapper = verdicts.filter((x) => x.verdict === 'wired' && x.via.length);
if (wiredViaWrapper.length) {
  console.log(`— wired via imported wrappers —`);
  for (const v of wiredViaWrapper) console.log(`  ${v.door.method} ${v.door.path} — via ${v.via.join(', ')}`);
}
const yellow = verdicts.filter((x) => x.verdict !== 'wired');
if (yellow.length) {
  console.log(`— YELLOW (no reachable UI caller) —`);
  for (const v of yellow) {
    const where = v.verdict === 'wrapper-only'
      ? `wrapper in ${v.svc.slice(0, 2).map((s) => s.split('/').pop()).join(', ')}${v.svc.length > 2 ? ` +${v.svc.length - 2}` : ''}`
      : v.verdict === 'demo-only'
        ? `demo-build screen only (${v.demo.map((s) => s.split('/').pop()).join(', ')}) — tree-shaken from production dist`
        : 'no caller found';
    console.log(`  ${v.door.method} ${v.door.path} — ${v.verdict} (${where}) [${v.door.file}]`);
  }
}
if (mockImporters.length) {
  console.log(`— MOCK PLANE imports (screens writing to services/index — no HTTP) —`);
  for (const f of mockImporters) console.log(`  ${f}`);
}

if (ENFORCE && (yellow.length || mockImporters.length)) {
  console.error(`parity gate ENFORCE: ${yellow.length} unwired door(s), ${mockImporters.length} mock importer(s) — FAIL`);
  process.exit(1);
}
console.log(ENFORCE ? 'parity gate: enforce mode — clean' : 'parity gate: report-only (run with --enforce to fail on the yellow list)');
