/* §6.5 item 29 (TST-3's red half) — the honesty generator must itself be honest.
 *
 * `scripts/verification-artifact.js` exists to replace hand-typed pass counts with a MEASURED artifact, on
 * three stated rules: (1) it writes the artifact even when the suite is red, (2) it never invents a number
 * (UNMEASURED instead), (3) it stamps what it measured. The tool went untested while carrying exactly the
 * defect class it was built to prevent: its first parsing version reported "Failures (0)" over a log holding
 * seven failures, and its green line said "not determined" over a log that literally read "pass 663 / fail 0".
 *
 * These tests drive the real CLI against CRAFTED logs, so they assert the tool's behaviour rather than
 * re-testing its regexes in isolation:
 *   · a GREEN log yields a GREEN artifact (the false-negative that printed "not determined");
 *   · a RED log yields a non-zero exit AND an artifact that says so (rule 1 — the failure is not deleted);
 *   · a log with no runner tally says UNMEASURED, never a fabricated 0.
 *
 * They write to a temp output by copying the repo's `docs/VERIFICATION.md` aside first, because the tool's
 * output path is fixed — restoring it in `finally` keeps the developer's artifact intact.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = join(HERE, '..');
const REPO_ROOT = join(SERVER_ROOT, '..');
const ARTIFACT = join(REPO_ROOT, 'docs', 'VERIFICATION.md');
const GENERATOR = join(SERVER_ROOT, 'scripts', 'verification-artifact.js');

/** Run the generator against a crafted log, returning { exitCode, artifact }. */
function generate(logText) {
  const dir = mkdtempSync(join(tmpdir(), 'schoolos-va-'));
  const logPath = join(dir, 'fixture.log');
  writeFileSync(logPath, logText);
  let exitCode = 0;
  try {
    // No DATABASE_URL: DB facts become UNMEASURED (honest) and the tool never contends with a live suite.
    execFileSync('node', [GENERATOR, '--no-run', '--log', logPath], {
      cwd: SERVER_ROOT, encoding: 'utf8', env: { ...process.env, DATABASE_URL: '' },
    });
  } catch (e) {
    exitCode = typeof e.status === 'number' ? e.status : 1;
  }
  return { exitCode, artifact: readFileSync(ARTIFACT, 'utf8') };
}

describe('§6.5 item 29 · the verification generator reports what the log actually says', () => {
  let saved = null;
  before(() => { if (existsSync(ARTIFACT)) saved = readFileSync(ARTIFACT, 'utf8'); });
  after(() => { if (saved !== null) writeFileSync(ARTIFACT, saved); });

  // The exact summary shape node:test emits — anchored on the ℹ glyph.
  const summary = (t, p, f) => `ℹ tests ${t}\nℹ suites 3\nℹ pass ${p}\nℹ fail ${f}\nℹ cancelled 0\nℹ skipped 0\n`;

  test('a green log produces a GREEN artifact and exits 0', () => {
    const { exitCode, artifact } = generate(summary(42, 42, 0));
    assert.equal(exitCode, 0, 'a green log must exit 0');
    assert.match(artifact, /Suite was GREEN|Suite is GREEN/,
      'a log reading pass 42 / fail 0 must not yield "status not determined" — that false negative is the '
      + 'first defect this tool shipped with');
    assert.match(artifact, /\*\*pass\*\* \| \*\*42\*\*/, 'the pass count must be the measured one');
  });

  test('a red log still writes the artifact, says NOT GREEN, and exits non-zero', () => {
    // Rule 1, the load-bearing one: an artifact that only appears on success turns "file absent" into
    // "suite red" and invites deleting the evidence. The failure must be recorded, not hidden.
    const { exitCode, artifact } = generate(summary(5, 3, 2));
    assert.notEqual(exitCode, 0, 'a red log must exit non-zero so CI gates on the generator');
    assert.match(artifact, /NOT GREEN|IS NOT GREEN/, 'the artifact must state the run was not green');
    assert.match(artifact, /\*\*fail\*\* \| \*\*2\*\*/, 'the failure count must be the measured one, not zero');
  });

  test('a log with no runner tally says UNMEASURED, never a fabricated number', () => {
    // Rule 2: a number that cannot be obtained is UNMEASURED — never omitted, never guessed.
    const { artifact } = generate('some output with no tally lines at all\n');
    assert.match(artifact, /UNMEASURED/, 'an absent tally must surface as UNMEASURED');
    assert.match(artifact, /status not determined|not determined/i,
      'with no tally the green status must be undetermined, and said so');
    assert.ok(!/\*\*pass\*\* \| \*\*0\*\*/.test(artifact),
      'a missing tally must NOT be rendered as a real pass 0 — that is the exact fabricated-clean-bill defect');
  });
});
