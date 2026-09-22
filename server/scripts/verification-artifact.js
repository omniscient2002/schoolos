// §6.5 item 29 — the reported numbers become a GENERATED artifact instead of hand-written claims.
//
// WHY THIS EXISTS. `docs/RELEASE-CERT.md` claimed "114/114 pass (15 files)" and
// `docs/FEATURES-STATUS.md` claimed "183/183" while the suite actually had 87 files and 637 top-level
// tests, and the one full-run log on disk ended EXIT=1. Every one of those numbers was typed by hand,
// which means every one of them was true once and then decayed silently — the same failure mode as a
// stale register row, except this one is in the documents a customer or an investor reads.
//
// THE THREE RULES THIS SCRIPT FOLLOWS, each of which is a mistake the project has already made:
//
//  1. IT WRITES THE ARTIFACT EVEN WHEN THE SUITE IS RED. A generator that only runs on success
//     produces an artifact whose existence implies green — which is a false green with extra steps,
//     and it deletes the evidence of the failure. This script records failures and exits non-zero.
//
//  2. IT NEVER INVENTS A NUMBER. Counts come from the runner's own summary lines, from the filesystem,
//     or from the database. If a count cannot be obtained, the artifact says UNMEASURED — it does not
//     omit the row and it does not guess.
//
//  3. IT STAMPS WHAT IT MEASURED. The fingerprint is a sha256 over the tracked source files, so a reader
//     can tell whether the artifact describes the tree they are looking at, and a `git`-free project can
//     still answer "which revision was this?" (coop law: this lane runs no git commands).
//
// Usage:
//   node scripts/verification-artifact.js            # run the suite, then write the artifact
//   node scripts/verification-artifact.js --no-run   # re-derive from the last log (fast, for CI re-stamp)
//   node scripts/verification-artifact.js --log <p>  # derive from a specific log file
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(ROOT, '..');
const OUT = join(REPO, 'docs', 'VERIFICATION.md');
const LOG_DIR = join(REPO, '.coop', 'logs');

const argv = process.argv.slice(2);
const noRun = argv.includes('--no-run');
const logArgIdx = argv.indexOf('--log');
const logPath = logArgIdx >= 0 ? argv[logArgIdx + 1] : join(REPO, 'server', 'test-run.log');

// ── 1. Run the suite (or reuse the last log) ────────────────────────────────
let exitCode = null;
if (!noRun) {
  const db = process.env.TEST_DB_NAME ?? 'schoolos_test';
  // The exact posture CI uses. Recorded in the artifact so a reader can reproduce the run.
  const command = `NODE_ENV=test OTP_DEV_ECHO= TEST_DB_NAME=${db} node --test --test-concurrency=1 --test-timeout=120000 tests/*.test.js`;
  process.stderr.write(`running: ${command}\n`);
  try {
    const out = execFileSync('bash', ['-lc', command], { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    writeFileSync(logPath, out);
    exitCode = 0;
  } catch (e) {
    // A red suite is still a measurement. Record it verbatim — this is rule 1.
    writeFileSync(logPath, `${e.stdout ?? ''}${e.stderr ?? ''}`);
    exitCode = typeof e.status === 'number' ? e.status : 1;
    process.stderr.write(`suite exited ${exitCode} — the artifact will record the failure, not hide it\n`);
  }
}

if (!existsSync(logPath)) {
  process.stderr.write(`no log at ${logPath} — cannot derive counts\n`);
  process.exit(2);
}
const log = readFileSync(logPath, 'utf8');

// ── 2. Parse the runner's own summary ───────────────────────────────────────
// node:test prints "ℹ tests 637" / "ℹ pass 637" / "ℹ fail 0" / "ℹ cancelled 0". Anchored to the
// summary glyph so a test whose NAME contains "tests 5" cannot be mistaken for the tally.
function tally(label) {
  const m = log.match(new RegExp(`^\\u2139 ${label} (\\d+)\\s*$`, 'm'));
  return m ? Number(m[1]) : null;
}
const counts = {
  tests: tally('tests'), suites: tally('suites'), pass: tally('pass'),
  fail: tally('fail'), cancelled: tally('cancelled'), skipped: tally('skipped'), todo: tally('todo'),
};
// Failure names. node:test's default reporter marks a failed TEST as "  ✖ name (12.3ms)" (two-space
// indent) and a failed SUITE as "✖ name (20643ms)" (no indent) — so failing tests and failing suites must
// be separated or one failure is counted twice and the two numbers cannot be reconciled.
//
// This parser was WRONG on its first version: it looked for TAP's "not ok N - name", which this reporter
// never emits, so it printed "Failures (0)" over a log containing 7 failures — a false green produced by
// the very file whose job is to prevent false greens. The reconciliation below is the fix for the CLASS of
// that bug, not just the instance: the artifact now cross-checks its own parse against the runner's tally
// and says so loudly when they disagree, instead of trusting either one.
// The "(12.3ms)" timing suffix is OPTIONAL and this is not a detail — some failure lines carry no timing
// at all (a test that failed in a `before` hook, for instance), and the first version of this regex
// required it. That version extracted 1 of 7 failures and reported "Failures (1)". The reconciliation
// check below is what caught it, which is the argument for having the check rather than trusting the parse.
const failLines = [...log.matchAll(/^ {2}✖ (.+?)(?: \(\d[\d.]*ms\))?\s*$/gm)].map((m) => m[1].trim());
const failedSuites = [...log.matchAll(/^✖ (.+?)(?: \(\d[\d.]*ms\))?\s*$/gm)].map((m) => m[1].trim());
// Reconciliation: does the number of failure lines we extracted equal the runner's own `fail` tally?
const parseAgrees = counts.fail === null ? null : failLines.length === counts.fail;

// ── 3. Count what is countable from the tree and the database ───────────────
const count = (fn) => { try { return fn(); } catch { return null; } };
const ls = (d, re) => (existsSync(join(ROOT, d)) ? readdirSync(join(ROOT, d)).filter((f) => re.test(f)) : []);

const testFiles = ls('tests', /\.test\.js$/).length;
const migrations = ls('migrations', /\.sql$/).length;
const plugins = count(() => readdirSync(join(ROOT, 'src', 'plugins')).filter((d) => {
  try { return statSync(join(ROOT, 'src', 'plugins', d)).isDirectory(); } catch { return false; }
}).length);

// Top-level test()/it() call count — a SECOND, independent measure of suite size. It differs from the
// runner's `tests` tally on purpose: the runner counts nested subtests, this counts declared cases, and
// showing both is how a reader sees that "how many tests" depends on what you count. The old hand-written
// docs quoted neither.
const declared = count(() => {
  let n = 0;
  for (const f of ls('tests', /\.test\.js$/)) {
    n += (readFileSync(join(ROOT, 'tests', f), 'utf8').match(/^\s*(?:test|it)\(/gm) ?? []).length;
  }
  return n;
});

// Live-database facts (46 tables / 103 policies / 1 DELETE grant) come from the dev DB when reachable.
// B4/J6: these were reported UNMEASURED whenever the generator ran without DATABASE_URL exported in its
// own environment (a bare `npm run verify-artifact`, or a CI step that inherited no DB env). The
// generator must not depend on the caller having exported the URL — it reads the same `server/.env` the
// rest of the app uses, so the ledger/RLS rows are measured on every run, not just inside CI.
function databaseUrl() {
  // An EXPLICIT empty value means "do not touch a database" (the generator's own test sets it) — honour
  // that rather than falling through to .env. Only an UNSET variable triggers the .env fallback.
  if (process.env.DATABASE_URL !== undefined) return process.env.DATABASE_URL || null;
  try {
    const envPath = join(ROOT, '.env');
    if (existsSync(envPath)) {
      const line = readFileSync(envPath, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL='));
      if (line) return line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* fall through to UNMEASURED */ }
  return null;
}
function psql(sql) {
  const url = databaseUrl();
  if (!url) return null;
  try {
    const out = execFileSync('psql', [url, '-Atc', sql], { encoding: 'utf8' }).trim();
    return out === '' ? null : Number(out);
  } catch { return null; }
}
const dbFacts = {
  appTables: psql(`select count(*) from information_schema.tables where table_schema='app'`),
  policies: psql(`select count(*) from pg_policies`),
  deleteGrants: psql(`select count(*) from information_schema.role_table_grants
                      where grantee='schoolos_app' and privilege_type='DELETE'`),
  migrationLedger: psql(`select count(*) from app.schema_migrations`),
  // F7/J3: a table can ENABLE RLS without FORCE, which lets the table OWNER bypass its own policy.
  // Measuring both closes the "is FORCE actually applied?" question the artifact previously left open.
  rlsEnabled: psql(`select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname in ('app','auth','family','plugin_exams','plugin_hr','plugin_clinic','plugin_visitors','plugin_dpdp')
                      and c.relkind='r' and c.relrowsecurity`),
  rlsForced: psql(`select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
                   where n.nspname in ('app','auth','family','plugin_exams','plugin_hr','plugin_clinic','plugin_visitors','plugin_dpdp')
                     and c.relkind='r' and c.relforcerowsecurity`),
};

// ── 4. Fingerprint the tree (no git — coop law) ─────────────────────────────
const SOURCE_DIRS = ['src', 'tests', 'scripts', 'migrations'];
const hashes = [];
const walk = (dir) => {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!['node_modules', '.git'].includes(e.name)) walk(p); }
    else if (/\.(js|mjs|sql|json)$/.test(e.name)) {
      hashes.push(`${createHash('sha256').update(readFileSync(p)).digest('hex')}  ${relative(ROOT, p)}`);
    }
  }
};
for (const d of SOURCE_DIRS) walk(join(ROOT, d));
// package.json files carry the test command itself, so a change to how the suite runs must move the
// fingerprint too — otherwise the artifact could describe a different command than the tree defines.
for (const p of [join(ROOT, 'package.json'), join(REPO, 'package.json')]) {
  if (existsSync(p)) hashes.push(`${createHash('sha256').update(readFileSync(p)).digest('hex')}  ${relative(ROOT, p)}`);
}
hashes.sort();
const fingerprint = createHash('sha256').update(hashes.join('\n')).digest('hex');
const latestMtime = count(() => {
  let newest = 0;
  for (const line of hashes) {
    const p = join(ROOT, line.split('  ')[1]);
    const t = statSync(p).mtimeMs;
    if (t > newest) newest = t;
  }
  return new Date(newest).toISOString();
});

// ── 5. Emit ─────────────────────────────────────────────────────────────────
const unmeasured = (v) => (v === null || v === undefined ? '**UNMEASURED**' : String(v));
const cell = (v) => (v === null || v === undefined ? '**UNMEASURED**' : String(v));
// Green is a property of the COUNTS, not of whether this invocation ran the suite. The first version of
// this line required `exitCode !== null` (i.e. a live run), so re-deriving from an existing log printed
// "Green status not determined" even over a log that literally said "pass 663 / fail 0" — an artifact
// that refuses to state what its own table shows is the same false-negative class it exists to prevent.
const green = counts.fail === null || counts.cancelled === null
  ? null
  : counts.fail === 0 && counts.cancelled === 0 && (exitCode === null || exitCode === 0);
const derived = exitCode === null;

const md = `# Verification artifact (generated)

> Generated by \`server/scripts/verification-artifact.js\` — **do not edit by hand; it will be overwritten.**
> Every number below is measured from the test runner's own output, the filesystem, or the live database.
> Where a number could not be obtained the artifact says UNMEASURED rather than omitting it.

| Field | Value |
|---|---|
| Generated at | ${new Date().toISOString()} |
| Source fingerprint | \`${fingerprint.slice(0, 16)}…\` (sha256 over ${hashes.length} files in src/, tests/, scripts/, migrations/) |
| Newest tracked source mtime | ${latestMtime ?? '**UNMEASURED**'} |
| Suite command | \`NODE_ENV=test OTP_DEV_ECHO= TEST_DB_NAME=${process.env.TEST_DB_NAME ?? 'schoolos_test'} node --test --test-concurrency=1 --test-timeout=120000 tests/*.test.js\` |
| Run log | \`${relative(REPO, logPath)}\` |
| Runner exit code | ${exitCode === null ? '**UNMEASURED** (derived from an existing log)' : exitCode} |

## Suite result

| Measure | Count |
|---|---|
| Runner-reported tests | ${cell(counts.tests)} |
| Runner-reported suites | ${cell(counts.suites)} |
| **pass** | **${cell(counts.pass)}** |
| **fail** | **${cell(counts.fail)}** |
| cancelled | ${cell(counts.cancelled)} |
| skipped | ${unmeasured(counts.skipped)} |
| Declared \`test()\`/\`it()\` cases (independent count) | ${unmeasured(declared)} |
| Test files | ${testFiles} |

${green === true ? (derived ? '**Suite was GREEN in the recorded run** (derived from an existing log; the runner exit code is not in this artifact).' : '**Suite is GREEN per this run.**') : green === false ? (derived ? '**THE RECORDED RUN WAS NOT GREEN — see the failures below. This artifact exists precisely so a red run cannot be mistaken for a green one.**' : '**SUITE IS NOT GREEN — see the failures below.**') : '**Green status not determined** (the log carries no runner tally).'}

${parseAgrees === false
  ? `> **THE FAILURE LIST BELOW IS INCOMPLETE — DO NOT TREAT IT AS THE FAILURE SET.** The runner reported **${counts.fail}** failed test(s) and this script extracted **${failLines.length}** name(s). The reporter does not distinguish a failed test from a **cancelled** test (both render as \`✖\`), and it prints a failing test at more than one nesting depth, so a name list derived from the rendered output cannot be reconciled against the tally. **The authoritative failure set is the run log at \`${relative(REPO, logPath)}\`; the names below are a partial convenience index only.** This limitation is recorded rather than papered over because an under-reporting failure list is worse than no list — it reads as completeness.`
  : parseAgrees === true ? `> Parse reconciled: the ${failLines.length} failure name(s) below account for the runner's \`fail ${counts.fail}\` tally.` : '> Parse reconciliation not possible (no runner tally in this log).'}

${counts.fail === null ? '### Failed tests\n\nRunner tally absent from this log — see the run log.\n' : counts.fail === 0 ? '### Failed tests (0)\n\nNone reported by the runner.\n' : `### Failed test names extracted (${failLines.length} — PARTIAL, see the warning above)\n\n${failLines.length ? failLines.map((f) => `- ${f}`).join('\n') : '_(none extractable from this reporter output)_'}\n`}
${failedSuites.length ? `### Failing/cancelled suite blocks (${failedSuites.length})\n\n${failedSuites.map((f) => `- ${f}`).join('\n')}\n` : ''}
## Surface counts

| Surface | Count | Source of truth |
|---|---|---|
| Top-level routes | see \`docs/PERMISSION-MATRIX.md\` (generated by \`scripts/permission-matrix.js\`) | route scan |
| Plugin modules | ${unmeasured(plugins)} | \`src/plugins/*/\` |
| Migrations on disk | ${unmeasured(migrations)} | \`migrations/*.sql\` |
| Migration ledger rows (live DB) | ${unmeasured(dbFacts.migrationLedger)} | \`app.schema_migrations\` |
| \`app\` tables (live DB) | ${unmeasured(dbFacts.appTables)} | \`information_schema\` |
| RLS policies (live DB) | ${unmeasured(dbFacts.policies)} | \`pg_policies\` |
| Tables with RLS enabled (live DB) | ${unmeasured(dbFacts.rlsEnabled)} | \`pg_class.relrowsecurity\` |
| Tables with RLS FORCED (live DB) | ${unmeasured(dbFacts.rlsForced)} | \`pg_class.relforcerowsecurity\` |
| Tables the app role may DELETE (live DB) | ${unmeasured(dbFacts.deleteGrants)} | \`information_schema.role_table_grants\` |

## How to read this

- **The fingerprint is the revision.** This project's lane rules forbid \`git\` commands, so the sha256 over
  the tracked source files is what ties this artifact to a specific tree. If the fingerprint no longer
  matches the working tree, the numbers below are history, not current state.
- **Compare, don't trust.** The runner-reported test count and the declared-case count are both shown
  because they do not agree, and neither is wrong: the runner counts nested subtests, the second counts
  declared cases. A document that quotes one number without saying which is being counted is the defect
  this artifact replaces.
- **A red run still writes this file.** That is deliberate. An artifact that only appears when the suite
  is green turns "the file is absent" into "the suite is red" and invites deleting the evidence.

---

*Replaces the hand-written pass counts formerly in \`docs/RELEASE-CERT.md\`, \`docs/RELEASE-NOTES.md\` and
\`docs/FEATURES-STATUS.md\`. Those figures (114/114, 183/183) were typed by hand and had been wrong for
some time — the suite had ${testFiles} files, not 15, by the time anyone re-measured.*
`;

if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
writeFileSync(OUT, md);
process.stderr.write(`wrote ${relative(REPO, OUT)}\n`);
// Non-zero when the suite was not green, so CI can gate on the GENERATOR rather than on a stale file.
if (exitCode !== null && exitCode !== 0) process.exit(exitCode);
if (counts.fail !== null && counts.fail > 0) process.exit(1);
