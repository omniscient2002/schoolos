#!/usr/bin/env node
// E5 · secret scanner — fail-closed gate against credential leakage.
// Scans the working tree (excluding vendored/generated paths) for high-confidence
// credential patterns: cloud keys, private keys, live payment tokens, connection
// strings with embedded passwords, and generic high-entropy assignments.
// Demo/dev values (schoolos-demo, schoolos_dev_pw, the local dev DATABASE_URL) are
// explicitly allow-listed — this codebase ships a demo tenant by design.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.vite', 'coverage', 'redteam-shots']);
const SKIP_FILE = /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|lock|svg)$/i;
const SKIP_PATHS = [/docs\/redteam-shots\//, /package-lock\.json$/, /server\/src\/generated\//];

const RULES = [
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'private key block', re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'live payment key', re: /\b(sk_live|pk_live|rk_live)_[0-9a-zA-Z]{10,}\b/ },
  { name: 'slack/bot token', re: /\bxox[baprs]-[0-9a-zA-Z-]{10,}\b/ },
  { name: 'google api key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'password in URL', re: { source: String.raw`[a-z]+:\/\/[^\/\s:]+:[A-Za-z0-9!@#$%^&*()_+=\-\{\}\[\];"'<>,.?\/|~]{6,}@`, flags: 'g' },
    allow: /:\/\/(schoolos:schoolos_dev_pw|postgres:\/\/schoolos:schoolos_dev_pw)/ },
  { name: 'hardcoded secret assignment', re: /\b(secret|api_key|apikey|password|token|client_secret)\s*[:=]\s*['"][A-Za-z0-9+/_-]{20,}['"]/gi,
    allow: /schoolos-demo|process\.env|config\.|Bearer|type\s*:|import|from/i },
];

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) yield* walk(join(dir, e.name)); continue; }
    const p = join(dir, e.name);
    if (SKIP_FILE.test(p) || SKIP_PATHS.some((r) => r.test(p))) continue;
    if (statSync(p).size > 1_500_000) continue;
    yield p;
  }
}

const hits = [];
for (const f of walk(ROOT)) {
  let src;
  try { src = readFileSync(f, 'utf8'); } catch { continue; }
  const rel = f.slice(ROOT.length + 1);
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
}

if (hits.length) {
  console.error(`SECRET SCAN FAIL — ${hits.length} candidate(s):`);
  for (const h of hits) console.error('  ' + h);
  process.exit(1);
}
console.log('secret scan clean (E5 gate: cloud keys, private keys, live tokens, URL credentials, hardcoded assignments)');
