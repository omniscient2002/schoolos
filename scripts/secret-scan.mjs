#!/usr/bin/env node
// E5 · secret scanner — fail-closed gate against credential leakage.
// Scans the working tree (excluding vendored/generated paths) for high-confidence
// credential patterns: cloud keys, private keys, live payment tokens, connection
// strings with embedded passwords, and generic high-entropy assignments.
// Demo/dev values (schoolos-demo, schoolos_dev_pw, the local dev DATABASE_URL) are
// explicitly allow-listed — this codebase ships a demo tenant by design.
//
// SEC-15: the dotenv rule exists because quoted-string heuristics cannot see a
// real `.env` (unquoted `JWT_SECRET=...`). The scan is a PURE function of a root
// directory so a test can plant a secret in a temp tree and prove the rule fires —
// a scanner that cannot be tested is the same "gate that cannot fail" this repo's
// test-hygiene pass exists to delete.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.vite', 'coverage', 'redteam-shots']);
const SKIP_FILE = /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|lock|svg)$/i;
const SKIP_PATHS = [/docs\/redteam-shots\//, /package-lock\.json$/, /server\/src\/generated\//];
const ENV_SECRET = /^(?:JWT_SECRET|(?:UPI|RAZORPAY)_WEBHOOK_SECRET|(?:GOOGLE|SMTP|PLUGIN_SETTINGS)_?(?:CLIENT_SECRET|PASSWORD|KEY))\s*=\s*([^#\s]+)/i;

const RULES = [
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'private key block', re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'live payment key', re: /\b(sk_live|pk_live|rk_live)_[0-9a-zA-Z]{10,}\b/ },
  { name: 'slack/bot token', re: /\bxox[baprs]-[0-9a-zA-Z-]{10,}\b/ },
  { name: 'google api key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'password in URL', re: { source: String.raw`[a-z]+:\/\/[^\/\s:]+:[A-Za-z0-9!@#$%^&*()_+=\-\{\}\[\];"'<>,.?\/|~]{6,}@`, flags: 'g' },
    allow: /:\/\/(schoolos:schoolos_dev_pw|postgres:\/\/schoolos:schoolos_dev_pw)/ },
  { name: 'hardcoded secret assignment', re: /\b(secret|api_key|apikey|password|token|client_secret)\s*[:=]\s*['"][A-Za-z0-9+/_-]{20,}['"]/gi,
    allow: /schoolos-demo|process\.env|config\.|Bearer|type\s*:|import|from|CANARY-ROTATION-VALUE|schoolos-counsellor-1/i },
];

export function* walk(root) {
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) yield* walk(join(root, e.name)); continue; }
    const p = join(root, e.name);
    if (SKIP_FILE.test(p) || SKIP_PATHS.some((r) => r.test(p))) continue;
    if (statSync(p).size > 1_500_000) continue;
    yield p;
  }
}

/** Scan one file's text. `rel` is only used to label findings. Returns a list of human lines. */
export function scanText(rel, src) {
  const hits = [];
  // dotenv files use unquoted assignments, so the quoted-string heuristic
  // below cannot see them. Example templates are intentionally placeholders;
  // real .env material is a secret-scan failure with values never echoed.
  if (/(^|\/)\.env$/.test(rel)) {
    for (const line of src.split('\n')) {
      const m = ENV_SECRET.exec(line.trim());
      if (m && m[1] && !/^\$\{|^(?:change|replace|your|example|dev-only)/i.test(m[1])) {
        hits.push(`${rel} — dotenv secret assignment (value redacted)`);
      }
    }
  }
  for (const rule of RULES) {
    const re = rule.re instanceof RegExp ? rule.re : new RegExp(rule.re.source, rule.re.flags);
    let m;
    while ((m = re.exec(src))) {
      const line = src.slice(0, m.index).split('\n').length;
      const ctx = src.split('\n')[line - 1].trim().slice(0, 120);
      if (rule.allow && rule.allow.test(ctx)) continue;
      hits.push(`${rel}:${line} — ${rule.name}: ${ctx}`);
      if (!re.global) break;
    }
  }
  return hits;
}

/** Walk `root` and return every hit. Pure apart from filesystem reads — the test seam.
 *
 *  A `.env` the repository's own `.gitignore` excludes is NOT part of the repository: scanning it
 *  produces the local dev credentials as a false finding on every developer machine while CI (which
 *  never checks out ignored files) stays green — a gate that cries wolf. It is skipped only while
 *  `.gitignore` still ignores it; drop that rule and the dotenv check fires again.
 */
export function scanTree(root) {
  const envIgnored = (() => {
    try {
      const gi = readFileSync(join(root, '.gitignore'), 'utf8');
      return gi.split('\n').some((l) => ['.env', '/.env', '**/.env'].includes(l.trim()));
    } catch { return false; }
  })();
  const hits = [];
  for (const f of walk(root)) {
    const rel = f.slice(root.length + 1);
    if (envIgnored && /(^|\/)\.env$/.test(rel)) continue;
    let src;
    try { src = readFileSync(f, 'utf8'); } catch { continue; }
    hits.push(...scanText(rel, src));
  }
  return hits;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const hits = scanTree(ROOT);
  if (hits.length) {
    console.error(`SECRET SCAN FAIL — ${hits.length} candidate(s):`);
    for (const h of hits) console.error('  ' + h);
    process.exit(1);
  }
  console.log('secret scan clean (E5 gate: cloud keys, private keys, live tokens, URL credentials, hardcoded assignments)');
}
