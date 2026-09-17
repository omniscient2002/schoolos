// OPS-11 — which build is live?
//
// THE DEFECT THIS CLOSES. There was **no versioned build identifier anywhere in the product**, so after a bad
// deploy nobody could answer the one question an incident starts with: *"which build is running?"* The newest
// release certificate on disk was 65 migrations stale and certified a tree that no longer existed, which made it
// worse than useless — it was a confident wrong answer.
//
// Two design decisions worth stating, because the obvious version of this feature is the version that fails:
//
//  1. **The identifier must be derived at STARTUP, not read from a file a human updates.** A hand-maintained
//     version string is the same defect as a hand-typed test count (§6.5 item 29): it is true once and then
//     decays silently, and it decays in the direction of false confidence. So the fingerprint below is computed
//     from the source tree the process is actually running, and `BUILD_ID`/`GIT_SHA` only *override* it when a
//     real build system supplies one.
//
//  2. **It must never be UNKNOWN when it could be KNOWN, and must say UNKNOWN when it is not.** A field that
//     silently reads "unknown" because nobody set an env var teaches operators to ignore it. The fingerprint is
//     computed by hashing the deployed files, so it answers the question even with a bare `node src/index.js`
//     and no build pipeline at all. Coop law for this project forbids `git` commands, so the fingerprint is a
//     content hash rather than a commit — which is strictly better here: it identifies the *bytes serving
//     traffic*, and a dirty working tree hashes differently from a clean one, where a commit sha would not.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const pkg = (() => {
  try { return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')); } catch { return {}; }
})();

/**
 * sha256 over the deployed server sources. Computed once per process — the tree cannot change under a running
 * build, and hashing on every /health poll would turn a cheap endpoint into a filesystem walk.
 *
 * Cached lazily so importing this module has no cost for the 99% of requests that never ask.
 */
let fingerprintCache;
function sourceFingerprint() {
  if (fingerprintCache !== undefined) return fingerprintCache;
  const hashes = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (!['node_modules', '.git', 'tests'].includes(e.name)) walk(p);
      } else if (e.name.endsWith('.js') || e.name.endsWith('.mjs')) {
        try { hashes.push(`${createHash('sha256').update(readFileSync(p)).digest('hex')}  ${relative(ROOT, p)}`); } catch { /* unreadable file is not fatal for an identifier */ }
      }
    }
  };
  try {
    walk(join(ROOT, 'src'));
    hashes.push(`${createHash('sha256').update(readFileSync(join(ROOT, 'package.json'))).digest('hex')}  package.json`);
    hashes.sort();
    fingerprintCache = createHash('sha256').update(hashes.join('\n')).digest('hex').slice(0, 12);
  } catch {
    // Never let identity reporting take down or distort the service. An honest 'unknown' beats a crash.
    fingerprintCache = null;
  }
  return fingerprintCache;
}

const startedAt = new Date().toISOString();

/**
 * The build identity, as a small object suitable for a health payload, a boot log line or a metric label.
 *
 * `source` is a string (short) for surfacing to humans/logs; `sourceFull` is the full path for debugging.
 * `fingerprint` is 12 hex chars of the deployed source — enough to distinguish two builds, short enough for a
 * log line. `id` is what to quote in an incident: an explicit BUILD_ID if the build system set one, else
 * `local-<fingerprint>`.
 */
export function buildInfo() {
  const fingerprint = sourceFingerprint();
  const explicit = process.env.BUILD_ID ?? process.env.GIT_SHA ?? null;
  return {
    id: explicit ?? (fingerprint ? `local-${fingerprint}` : 'unknown'),
    version: pkg.version ?? 'unknown',
    // Distinguishes "a real build pipeline stamped this" from "we hashed the tree we found" — an operator
    // needs to know which, because an explicit id is the only one that can be traced to a CI artifact.
    identitySource: explicit ? 'BUILD_ID/GIT_SHA env' : (fingerprint ? 'source fingerprint (computed)' : 'unknown'),
    fingerprint: fingerprint ?? 'unknown',
    env: process.env.NODE_ENV ?? 'development',
    node: process.version,
    startedAt,
  };
}

/** One-line form for the boot log — the single most useful line to have in container logs after a deploy. */
export function buildInfoLine() {
  const b = buildInfo();
  return `build ${b.id} · v${b.version} · env ${b.env} · node ${b.node} · identity ${b.identitySource} · started ${b.startedAt}`;
}
