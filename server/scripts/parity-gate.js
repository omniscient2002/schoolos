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
    // Dynamic imports — `import('../services/x').then(({ name }) => …)` / `await import('…')`
    // plus a use of the wrapper name. The batch 2–4 screens load complianceApi
    // lazily; a lazy caller is still a caller, so the gate must see it.
    if (new RegExp(`import\\(\\s*['"][^'"]*\\b${base}\\b[^'"]*['"]\\s*\\)`).test(src)
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
// API-only / non-UI doors. FEX-2 flips this gate to `--enforce`, which is only honest if the doors that
// genuinely have no in-app caller are named with a reason rather than silently excluded. Each pattern below
// is a door type that is reached by a machine, an owner/admin API, an email link, or a plugin screen whose
// import is dynamic (so this static wrapper-resolution cannot see it); plugin doors are additionally
// covered by `plugin-conformance.test.js`.
const API_ONLY_ALLOWLIST = [
  { re: /^(POST|DELETE) \/(api-keys|webhooks)(\/|$)/, why: 'machine/owner API — ItAdmin shows read-only, disabled controls (OPSX-4)' },
  { re: /^POST \/(ai\/call|ai\/eval|workflow-rules|academic-years|class-assignments|fees\/dunning\/run|timetable\/clash-check)$/, why: 'owner/admin API door with no shipped screen (called by scripts/workers)' },
  { re: /^(DELETE \/(workflow-rules|class-assignments)\/:|POST \/academic-years\/:id\/activate$)/, why: 'owner/admin API door with no shipped screen' },
  { re: /^POST \/(me\/reset-request|me\/reset-confirm)$/, why: 'email-link-driven reset flow; no in-app caller by design' },
  { re: /^POST \/auth\/google\/demo$/, why: 'demo SSO only; the disabled Google button is the honest UI' },
  { re: /^POST \/transport\/events$/, why: 'called by the transport worker/kernel; the UI badge is read-only' },
  { re: /^POST \/payments\/([^/]+\/refund|reconcile)$/, why: 'owner/finance API; refunds run from the gateway/ops tooling' },
  { re: /^(POST|DELETE) \/(plugins\/|student\/|ptm\/|safety\/|teacher\/|interventions\/|parent\/leave-request|coord\/duty\/allocate)/, why: 'plugin runtime door reached from its own plugin screen (dynamic import); covered by plugin-conformance' },
  /* Named rather than swept into the generic plugin line, because this one is a DESIGN decision and
     deserves to be re-read when the import story changes: `ops.import` is the mapping validator and
     shadow loader, and its own manifest says the engine is "importable by the kernel migration doors;
     commit authority stays with the kernel". The SPA drives the KERNEL doors on /migration (source →
     stage → analyze), so a second screen for the engine would be two import surfaces over one job.
     If a school-facing mapping UI is ever built, this line goes with it. */
  { re: /^(GET|POST) \/plugins\/ops\.import\//, why: 'engine-only by design — the /migration screen drives the kernel import doors, which hold commit authority (manifest: "importable by the kernel migration doors")' },
  { re: /^PUT \/plugins\/library\/desk\/settings\/notifications$/, why: 'backward-compat alias of /desk/settings (same saveDeskSettings handler); the sectioned desk screen saves via /desk/settings' },
  { re: /^POST \/parent\/requests\/[^/]+\/transition$/, why: 'school/office ticket-transition door — the parent request center is read-only to parents by design; the office surface lands with the PU-2 flows' },
  /* ── GET doors (TEST-2: the gate now scans reads too). Each reason names why no shipped screen
     calls it: an owner/admin console read, an ops/export tool, a machine/callback path, or a plugin
     read reached through a dynamic import that this static resolver cannot see. ───────────────── */
  { re: /^GET \/(auth\/google\/(start|callback)|api-keys|webhooks|ai\/calls|workflow-rules|class-assignments|academic-years|fees\/entitlements|communications|audit\/verify|events\/lineage|usage)$/, why: 'owner/admin or machine read — surfaced by ops tooling or the ItAdmin console, not a per-role screen' },
  { re: /^GET \/plugins\/(accounting\.tally|comms\.whatsapp|exams\.assessment|health\.clinic|hr\.leave|ops\.import|ops\.timetable|ops\.udise|ops\.visitors|pack\.cbse|pack\.dpdp|transport\.gps)\//, why: 'plugin read door reached from its own plugin screen (dynamic import) or an export/ops tool; covered by plugin-conformance' },
  { re: /^GET \/plugins\/library\/(copies|scan)$/, why: 'librarian desk read reached through the dynamic library desk screen; covered by plugin-conformance' },
  { re: /^GET \/plugins\/files\.store(\/|$)/, why: 'file registry read reached through the dynamic documents screen; covered by plugin-conformance' },
  { re: /^GET \/plugins\/people\.admin\/students\/:id\/history$/, why: 'roster-history read reached through the dynamic people console; covered by plugin-conformance' },
  { re: /^GET \/admissions\/followups$/, why: 'admissions funnel read reached through the dynamic admissions screen; covered by plugin-conformance' },
  { re: /^(GET|POST|DELETE) \/parent\/links(\/|$)/, why: 'school-office guardian-link management API — the office console lands with the People roster work; the parent read-plane never calls it' },
  { re: /^GET \/parent\/child\/:id\/academics$/, why: 'published-report read reached from the per-child flow hub (assignments/exams tabs read the same published reports); no dedicated academics tab yet' },
  { re: /^GET \/teacher\/usage$/, why: 'the copilot budget ledger is shown inline on each ask/draft response; the standalone usage read is a governance/ops view' },
  { re: /^GET \/safety\/box\/summary$/, why: 'weekly pattern summary is an oversight read (counts only); the safety-box screen shows the report list' },
  /* owner/principal spine (migration 116) — its UI lane is in flight; these are the owner/principal
     console reads/writes that lane wires. Named here so the shared gate stays honest in the interim. */
  { re: /^(GET|POST) \/delegations$/, why: 'owner/principal delegation console (OPP-OVR-2) — UI lane in flight' },
  { re: /^POST \/owner\/actions$/, why: 'owner/principal action raise (OPP spine) — UI lane in flight' },
  { re: /^GET \/reports\/snapshots$/, why: 'board/inspection pack read (OPP-DAT-2) — UI lane in flight' },
  /* Public page by design: the MPD desk renders its URL as an outbound link for
     inspectors (a browser opens it, the app never fetches it) — no in-app caller
     is the correct shape, not a gap. */
  { re: /^GET \/public\/disclosure$/, why: 'unauthenticated public disclosure page — opened via outbound link from the MPD desk, never fetched by the app' },
  /* Tenant-configurability pass (fees settings/rules + admissions repair): finance
     policy doors whose desk screens land with the finance UI lane. Covered by the
     fee drill suites (role 93/93 + edge 37/37) and admissions-fixes (14/14) until
     the screens ship — then these lines go with the buttons. */
  { re: /^(GET|POST) \/fees\/(discount-rules|late-rules)$/, why: 'finance policy catalogue API — no desk screen yet; covered by fee drills' },
  { re: /^POST \/fee-plans\/:id\/(preview|clone)$/, why: 'fee-plan desk API (dry-run + year rollover) — screen buttons land with the finance UI lane; covered by fee drills' },
  { re: /^POST \/fees\/obligations\/:id\/(extend|late-fee\/waive)$/, why: 'obligation relief API — desk actions land with the finance UI lane; covered by fee drills' },
  { re: /^(PATCH|POST) \/fees\/installments\/:id(\/waive)?$/, why: 'installment edit/waive API — desk actions land with the finance UI lane; covered by fee drills' },
];
const allowReason = (door) => API_ONLY_ALLOWLIST.find((a) => a.re.test(`${door.method} ${door.path}`));
const yellowAll = verdicts.filter((x) => x.verdict !== 'wired');
const yellow = yellowAll.filter((x) => !allowReason(x.door));

if (yellowAll.length) {
  console.log(`— YELLOW (no reachable UI caller): ${yellow.length} unresolved, ${yellowAll.length - yellow.length} allowlisted API-only —`);
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
if (ENFORCE && (yellowAll.length - yellow.length)) {
  console.log(`parity gate: ${yellowAll.length - yellow.length} door(s) allowlisted as API-only (reasons in scripts/parity-gate.js)`);
}
console.log(ENFORCE ? 'parity gate: enforce mode — clean' : 'parity gate: report-only (run with --enforce to fail on the yellow list)');
