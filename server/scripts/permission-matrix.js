// §43 permission-matrix generator — the ONE tool that knows every door's guard.
// Scans src/app.js, src/routes.js and every plugin index.js for app.<verb>() route
// declarations, classifies each guard (public allowlist · webhook-hmac · auth ·
// role-gated), and fails on any route that ships without a guard and without a
// conscious allowlist entry. Also emits docs/PERMISSION-MATRIX.md as the auditable
// artifact. Security-matrix RT follow-up: new public endpoints must be added to
// PUBLIC_ALLOWLIST below or CI (npm run check) fails.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Routes deliberately reachable WITHOUT a session. Every entry is a reviewed security
// decision — do not extend this list without a threat-model note.
export const PUBLIC_ALLOWLIST = [
  { path: '/health', why: 'liveness probe, no data' },
  { path: '/ready', why: 'readiness probe (503 unless DB answers) — no data, orchestration-only' },
  { path: '/auth/login', why: 'credential exchange (rate-limited 20/min)' },
  { path: '/auth/otp/request', why: 'OTP issue (rate-limited 5/min)' },
  { path: '/auth/otp/verify', why: 'OTP exchange (rate-limited 10/min)' },
  { path: '/auth/google/start', why: 'OAuth redirect' },
  { path: '/auth/google/callback', why: 'OAuth callback' },
  { path: '/auth/google/demo', why: 'demo-mode SSO' },
  { path: '/onboard/signup', why: 'self-serve tenant onboarding (053): creates an EMPTY tenant + first owner only; kill-switch SELF_SIGNUP_ENABLED, rate-limited 3/min, hash-chained audit from row one; NO data access' },
  { path: '/plugins/payments.upi/webhook', why: 'HMAC-signature verified in-handler (UPI_WEBHOOK_SECRET), raw-body parser' },
  { path: '/plugins/payments.razorpay/webhook', why: 'HMAC-signature verified in-handler (RAZORPAY_WEBHOOK_SECRET / settings webhook_secret), raw-body parser, replay dedupe' },
];

const GUARD_RE = /preHandler:\s*(\[[^\]]*\]|[\w$.]+(?:\(([^()]|\([^()]*\))*\))?)/s;

export function scanRoutes(files) {
  const routes = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const id = src.match(/const ID = '([^']+)'/)?.[1] ?? null;
    // role-set consts: const GUARDIAN = ['parent','guardian'];
    const consts = {};
    for (const m of src.matchAll(/const ([A-Z_]+) = \[([^\]]*)\]/g))
      consts[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((r) => r[1]);

    const re = /app\.(get|post|put|patch|delete)\(/g;
    let m;
    while ((m = re.exec(src))) {
      // balanced-paren extraction of the full option list
      let i = re.lastIndex - 1, depth = 0, end = src.length - 1;
      for (; i < src.length; i++) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') { depth--; if (!depth) { end = i; break; } }
      }
      const stmt = src.slice(re.lastIndex, end);
      const pm = stmt.match(/^\s*('([^']*)'|"([^"]*)"|`([^`]*)`)/);
      if (!pm) continue;
      let path = pm[2] ?? pm[3] ?? pm[4];
      if (path.includes('${ID}') && id) path = path.replace('${ID}', id);

      const route = { file: f.replace(ROOT + '/', ''), method: m[1].toUpperCase(), path, cls: 'unguarded', roles: [], lifecycle: false };
      const ph = stmt.match(GUARD_RE);
      if (ph) {
        const body = ph[1];
        const hasAuth = /app\.authenticate|requireRole|\brequire\(|\bme\b/.test(body);
        const lifecycle = /lifecycleGate/.test(body);
        const quoted = [...body.matchAll(/'([a-z]+)'/g)].map((r) => r[1]).filter((r) => r !== 'plugins');
        const spread = [...body.matchAll(/\.\.\.([A-Z_]+)/g)].flatMap((r) => consts[r[1]] ?? []);
        const roles = [...new Set([...quoted, ...spread])];
        route.lifecycle = lifecycle;
        route.roles = roles;
        route.cls = roles.length ? 'role-gated' : hasAuth ? 'auth' : 'unguarded';
        if (hasAuth && !roles.length && !/app\.authenticate|\bme\b|requireRole/.test(body)) route.cls = 'unguarded';
      }
      const pub = PUBLIC_ALLOWLIST.find((p) => p.path === route.path);
      if (route.cls === 'unguarded') route.cls = pub ? 'public' : 'UNGUARDED';
      else if (pub) route.cls += ' (allowlisted too — review)';
      routes.push(route);
    }
  }
  return routes;
}

export function matrixSummary(routes) {
  const by = (c) => routes.filter((r) => r.cls === c || r.cls.startsWith(c + ' '));
  return {
    total: routes.length,
    roleGated: by('role-gated').length,
    auth: by('auth').length,
    public: by('public').length,
    unguarded: routes.filter((r) => r.cls === 'UNGUARDED' || r.cls.startsWith('UNGUARDED')),
  };
}

function renderMarkdown(routes) {
  const s = matrixSummary(routes);
  const rows = routes.map((r) =>
    `| ${r.method} | \`${r.path}\` | ${r.cls} | ${r.roles.join(', ') || '—'} | ${r.lifecycle ? 'yes' : '—'} | ${r.file} |`).join('\n');
  return `# Permission matrix (generated)

> Generated by \`server/scripts/permission-matrix.js\` — do not edit by hand.
> Gate: every route is role-gated, auth-only, or on the reviewed PUBLIC_ALLOWLIST.
> Counts: ${s.total} routes · ${s.roleGated} role-gated · ${s.auth} auth-only · ${s.public} public · ${s.unguarded.length} unguarded.

| Verb | Path | Guard | Roles | Plugin gate | File |
|---|---|---|---|---|---|
${rows}
`;
}

export function main() {
  const dir = (p) => join(ROOT, p);
  const files = [dir('src/app.js'), dir('src/routes.js'),
    ...readdirSync(dir('src/plugins'), { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('_') && existsSync(dir(`src/plugins/${e.name}/index.js`)))
      .map((e) => dir(`src/plugins/${e.name}/index.js`))];
  const routes = scanRoutes(files);
  const s = matrixSummary(routes);
  const DOCS = join(ROOT, '..', 'docs');
  writeFileSync(join(DOCS, 'PERMISSION-MATRIX.md'), renderMarkdown(routes));
  if (s.unguarded.length) {
    console.error(`PERMISSION MATRIX FAIL — ${s.unguarded.length} route(s) without any guard:`);
    for (const r of s.unguarded) console.error(`  ${r.method} ${r.path} (${r.file})`);
    process.exit(1);
  }
  console.log(`permission matrix OK: ${s.total} routes · ${s.roleGated} role-gated · ${s.auth} auth · ${s.public} public · docs/PERMISSION-MATRIX.md written`);
}

import { argv } from 'node:process';
if (argv[1] && argv[1].endsWith('permission-matrix.js')) main();
