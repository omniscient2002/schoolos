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
import { ADMIN as ADMISSIONS_ADMIN, FULL_PII as ADMISSIONS_FULL_PII } from '../src/plugins/_shared/admissions-access.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* Shared role constants that doors spread (`require(...ADMIN)`). The scanner's local
   `const [A-Z_]+ = [...]` extraction only sees a file's OWN literals, so a role list
   hoisted into a shared module (admissions-access.js) would otherwise read as an empty
   spread and demote a real role-gated door to UNGUARDED. These seed the resolver; a
   file-local definition of the same name still overrides (built after the seed). */
const SHARED_CONSTS = {
  ADMIN: ADMISSIONS_ADMIN,
  ADMISSIONS_ADMIN,
  FULL_PII: ADMISSIONS_FULL_PII,
};

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
  { path: '/me/reset-request', why: 'password-reset request (L2-2.2): rate-limited 5/min, anti-enumeration uniform 200, channel-gated 503; issues a single-use sha256-stored token — no data access' },
  { path: '/me/reset-confirm', why: 'password-reset confirm (L2-2.2): rate-limited 10/min, single-use race-safe token consume + epoch bump; no session required by design' },
  { path: '/me/mfa/verify', why: 'dual-path door (L2-3.2): authed enrollment-confirm OR pre-auth login challenge (5-min mfaPending token limited to this door); rate-limited 10/min' },
  { path: '/plugins/payments.upi/webhook', why: 'HMAC-signature verified in-handler (UPI_WEBHOOK_SECRET), raw-body parser' },
  { path: '/plugins/payments.razorpay/webhook', why: 'HMAC-signature verified in-handler (RAZORPAY_WEBHOOK_SECRET / settings webhook_secret), raw-body parser, replay dedupe' },
];

const GUARD_RE = /preHandler:\s*(\[[^\]]*\]|[\w$.]+(?:\(([^()]|\([^()]*\))*\))?)/s;

export function scanRoutes(files) {
  const routes = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const id = src.match(/const ID = '([^']+)'/)?.[1] ?? null;
    // role-set consts: const GUARDIAN = ['parent','guardian']; file-local overrides shared.
    const consts = { ...SHARED_CONSTS };
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
        /* S0 fix B12: the scanner must recognize the project's auth-wrapping
           helper preHandlers, not just inline app.authenticate — adminOnly()
           (api-keys/webhooks) and any future *Auth() helper authenticate
           internally, so they ARE guards. Unrecognized helpers still classify
           unguarded (the gate stays strict). */
        const hasAuth = /app\.authenticate|requireRole|adminOnly|optionalAuth|\brequire\(|\bme\b/.test(body);
        const lifecycle = /lifecycleGate/.test(body);
        /* Roles are lowercase with underscores (`finance_head`, `finance_clerk`); the old `[a-z]+`
           silently dropped those two roles from every fee door they are actually gated on, which made
           the generated matrix under-report them (and led a reviewer to think the maker/checker roles
           were un-gated). Plugin ids contain dots and are excluded by the character class anyway. */
        const quoted = [...body.matchAll(/'([a-z][a-z0-9_]*)'/g)].map((r) => r[1]).filter((r) => r !== 'plugins');
        const spread = [...body.matchAll(/\.\.\.([A-Z_]+)/g)].flatMap((r) => consts[r[1]] ?? []);
        const roles = [...new Set([...quoted, ...spread])];
        route.lifecycle = lifecycle;
        route.roles = roles;
        route.cls = roles.length ? 'role-gated' : hasAuth ? 'auth' : 'unguarded';
        /* S0 fix B12: the demotion check must accept the same helper set —
           adminOnly()/optionalAuth() authenticate internally (their body text
           doesn't mention app.authenticate, but they ARE auth guards). */
        if (hasAuth && !roles.length && !/app\.authenticate|adminOnly|optionalAuth|\bme\b|requireRole/.test(body)) route.cls = 'unguarded';
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

/* ── L3-4.2 custom-mask lint ─────────────────────────────────────────────────────
   Custom roles store {allow:[],deny:[]} patterns ("GET /fees", "POST /students/*").
   lintMaskPatterns checks a stored mask against the SCANNED route list — a pattern
   that matches no registered door is a typo that silently grants/refuses nothing,
   which is exactly the kind of dead permission that rots. Offline (no DB): the CRUD
   door in routes.js performs the same validation against the LIVE route set via its
   onRoute registry; this helper keeps the two matchers honest (one implementation). */
export function lintMaskPatterns(mask, routes) {
  const routePairs = routes.map((r) => [r.method, r.path]);
  const problems = [];
  for (const kind of ['allow', 'deny']) {
    for (const p of (mask?.[kind] ?? [])) {
      const sp = p.indexOf(' ');
      const [pm, pp] = [p.slice(0, sp), p.slice(sp + 1)];
      const hit = routePairs.some(([rm, ru]) => {
        if (pm !== '*' && pm !== rm) return false;
        if (pp.endsWith('*')) return ru.startsWith(pp.slice(0, -1));
        return ru === pp || ru.startsWith(pp + '/');
      });
      if (!hit) problems.push({ kind, pattern: p, error: 'matches no registered route' });
    }
  }
  return { ok: problems.length === 0, problems };
}

export async function main() {
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
  // L3-4.2: when a database with app.roles is reachable, lint every stored custom
  // mask against the scanned routes; offline (check runs before any DB), skip honestly.
  try {
    const { pool } = await import('../src/db.js');
    const pr = await pool.query(`SELECT to_regclass('app.roles') IS NOT NULL AS ok`);
    if (pr.rows[0]?.ok) {
      const roles = (await pool.query(`SELECT key, permissions FROM app.roles`)).rows;
      let bad = 0;
      for (const r of roles) {
        const lint = lintMaskPatterns(r.permissions, routes);
        if (!lint.ok) { bad++; for (const p of lint.problems) console.error(`CUSTOM ROLE LINT — ${r.key}: ${p.kind} "${p.pattern}" ${p.error}`); }
      }
      if (bad) { console.error(`PERMISSION MATRIX FAIL — ${bad} custom role(s) with dead patterns`); process.exit(1); }
      console.log(`custom roles lint OK: ${roles.length} role(s)`);
    } else {
      console.log('custom roles lint skipped: app.roles not on this database (migration pending)');
    }
    await pool.end();
  } catch (e) {
    console.log(`custom roles lint skipped (${String(e.message ?? e).slice(0, 80)})`);
  }
  console.log(`permission matrix OK: ${s.total} routes · ${s.roleGated} role-gated · ${s.auth} auth · ${s.public} public · docs/PERMISSION-MATRIX.md written`);
}

import { argv } from 'node:process';
if (argv[1] && argv[1].endsWith('permission-matrix.js')) main().catch((e) => { console.error(e); process.exit(1); });
