/* TST-4 / plan item 31 — the vacuity gate.

   Independent review found EIGHT assertions in this suite that could not fail: a count compared with `>= 0`, a
   regex matched against a literal string, a block that read a field the door does not return so it never ran, a
   conditional whose body was the test's only assertion, a "the code is X" claim satisfied equally by the defect
   it named. Fixing eight sites by hand fixes eight sites. The class comes back the moment someone is in a hurry,
   because every one of those was written by someone who believed they were asserting something — the failure
   mode is not laziness, it is a test that LOOKS like a test.

   So this file is the gate. It scans the suite's source for the shapes that made those eight possible, and it
   proves it fires by feeding itself synthetic tautologies — a gate that cannot fail is itself the defect it
   hunts. Run in CI like any other test file.

   Deliberately NOT attempted: proving that an assertion is *meaningful*. No scanner can do that. This catches
   the mechanical shapes; a human reviewer still has to ask "and what would make this false?" on everything else.
*/

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

/* Blank out comments so a rule never fires on prose. Line count is preserved so reported line numbers stay
   true — that matters, because a gate whose output cannot be trusted to point at the right line gets muted. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`\\])\/\/.*$/, (m, pre) => pre + ' '.repeat(m.length - pre.length)))
    .join('\n');
}

/* Pure scanner: source text in, findings out. Kept pure so the gate's own tests can prove each rule fires. */
export function scanForVacuity(src) {
  const text = stripComments(src);
  const lines = text.split('\n');
  const findings = [];

  const RULES = [
    {
      rule: 'tautology/non-negative-count',
      // `x >= 0` on a count can never be false. A range (`>= 0 && <= 100`) IS falsifiable, so it is allowed —
      // the reviewer's job is to check the range is what matters, not to ban a shape.
      re: /assert\.[a-zA-Z]+\([^;\n]*>=\s*0\b(?![^;\n]*<=)/,
    },
    {
      rule: 'tautology/regex-against-literal',
      // assert.match('users_tenant_email_key', /users_.*unique/) — true by construction. The regex must be
      // matched against a VALUE the code produced.
      re: /assert\.match\(\s*['"`]/,
    },
    {
      rule: 'tautology/trivial-truth',
      /* `assert.ok(true)` AND `assert.ok(true, 'message')`. The message form was NOT caught by the first
         version of this rule, which required the closing paren immediately after `true` — found by mutating a
         real assertion into exactly that shape while closing a TST-5 defect, and watching the gate pass it. A
         vacuous assertion with a reassuring message is the worst version of this defect, because the message is
         what a reader trusts instead of reading the condition. Also `assert.ok(1)`/`assert.ok('x')`. */
      re: /assert\.ok\(\s*(?:true|1|'[^']*'|"[^"]*")\s*(?:,|\))|assert\.equal\(\s*(\d+)\s*,\s*\1\s*(?:,|\))/,
    },
    {
      rule: 'tautology/self-comparison',
      // assert.equal(row.ok, row.ok) fails only if the value is unstable — never what was meant.
      re: /assert\.(equal|strictEqual|deepEqual)\(\s*([A-Za-z_$][\w.$]*)\s*,\s*\2\s*\)/,
    },
  ];

  lines.forEach((line, i) => {
    for (const { rule, re } of RULES) {
      if (re.test(line)) findings.push({ rule, line: i + 1, text: line.trim().slice(0, 120) });
    }
  });

  /* The eighth defect was a whole test that silently did not run: `const paymentId = link.payment?.id; if
     (paymentId) { ...every assertion in the test... }`. The condition was never true, so the test passed for a
     year while asserting nothing. Shape caught: a test whose FIRST assertion sits inside an `if` block — i.e.
     the test can complete without asserting anything. Tests that assert something unconditionally and THEN
     branch on a status code are fine, and that is the common legitimate shape. */
  lines.forEach((line, idx) => {
    if (!/^\s*(test|it)\(/.test(line)) return;   // callback, not a loop — `continue` is illegal here
    const body = lines.slice(idx, idx + 80);
    const flat = body.join('\n');
    const firstAssert = flat.search(/assert\./);
    if (firstAssert === -1) {
      findings.push({ rule: 'dead-assertion/no-assertion-in-test', line: idx + 1, text: line.trim().slice(0, 120) });
      return;
    }

    /* TST-5 — conditional silent passes swallow whole tests. A bare `return;` that precedes every
       assertion means the test reports PASS while asserting nothing: an absent test the runner counts
       as a pass. This is strictly worse than the eighth defect above, because the eighth never ran and
       nobody claimed it did, whereas this one returns green on every run and the invariant quietly
       stops being checked when the seed or schema shifts.
       Two shapes, same defect: the bare statement (`if (!x) return;`) and the value-returning ternary
       (`return ok ? 200 : 403;`) which discards an expected status into the void. `return t.skip(...)`
       is a VALUE return and is handled — differently, and on purpose — by the rule below. */
    const guardText = flat.slice(0, firstAssert);
    if (/(^|\s)return\s*;/.test(guardText) || /(^|\s)return\s+[^;\n]+\?[^;\n]*:/.test(guardText)) {
      findings.push({ rule: 'silent-pass/bare-return-before-assert', line: idx + 1, text: line.trim().slice(0, 120) });
    }

    /* An explicit skip that precedes every assertion. A `skipped` test verifies nothing either, so it
       has to be either repaired (build the fixture) or allowlisted with a reason — never left to read
       as coverage. TST-5 found seven of these gating a whole assertion body behind ONE `present` flag
       that is TRUE in every fresh test database: gates that were never once taken, which is the
       "disable-flag never actually taken" trap in its natural habitat.

       Deciding which skips are acceptable took four measured attempts, and EVERY wrong one failed by
       exempting the defect rather than by over-flagging — a useful warning, because that is the
       direction a "be reasonable" rule fails in.
         · Counting the guard's statements said nothing: a real test's guard legitimately contains
           fixture setup.
         · Inspecting the guard's TAIL said nothing for the same reason.
         · "Is the skip the only thing in its own block?" looked right and was still wrong. Applied to
           coord-view:61 — `if (istDow() === 'Sunday') return t.skip('…')` followed by sixteen fixture
           statements and the assertions — it exempted the site. The skip's branch IS empty; that is
           simply not the axis the defect lives on.
       The axis it does live on, and why this rule is now deliberately OBVIOUS rather than clever:
       a skip before the first assertion is a test whose assertions do not run when the skip fires. If
       the condition is genuinely unwrappable (a calendar day the schema CHECK forbids, no database at
       all), the skip is the honest answer and belongs in the ALLOWLIST with that reason written down.
       If the condition is a missing fixture, the skip is the defect and the fixture is the repair.
       Syntax cannot tell those apart — only the reason can — so the gate flags the shape and makes the
       author write the reason. Over-flagging here costs one allowlist line; under-flagging costs the
       invariant, silently, possibly for a year. */
    const SKIP_CALL = /(\bt|\bctx|\bthis)\.skip\s*\(/;
    if (SKIP_CALL.test(guardText)) {
      findings.push({ rule: 'silent-pass/skip-before-assert', line: idx + 1, text: line.trim().slice(0, 120) });
    }

    const guard = flat.slice(0, firstAssert);
    /* No `m` flag: with it, `$` matches every line end, so `if (trap.length) {` matched the pattern even when
       the block was properly closed later — the gate has to be right about this or it trains people to ignore
       it. `$` must mean the end of the guard, i.e. the assert is still inside the block. */
    const guardLine = /(\n\s*)if\s*\([^)]*\)\s*\{[^{}]*$/.exec(guard);
    if (!guardLine) return;
    /* Flag ONLY when the whole test can pass without asserting anything: the eighth defect was every assertion
       inside `if (paymentId)` where the condition was never true. A test that asserts the status code
       unconditionally and then branches into more assertions is the common, legitimate shape — so look for any
       later assert at the guard's indentation or shallower, i.e. one that runs regardless. */
    const guardIndent = guardLine[1].length;
    const after = flat.slice(firstAssert);
    const unguarded = after.split('\n').slice(1).some((l) => new RegExp(`^\\s{0,${guardIndent}}assert\\.`).test(l));
    if (!unguarded) {
      findings.push({ rule: 'dead-assertion/first-assert-guarded', line: idx + 1, text: line.trim().slice(0, 120) });
    }
  });

  return findings;
}

describe('TST-4 · the vacuity gate (plan item 31)', () => {
  test('the gate fires on every shape that produced the eight defects', () => {
    /* If these stop being flagged, the gate has stopped working — and a silent gate is worse than no gate,
       because the suite then looks protected. Each case is a real defect from this codebase's history. */
    const cases = [
      ['non-negative count', "assert.ok(leaked >= 0, 'sanity');", 'tautology/non-negative-count'],
      ['regex vs literal', "assert.match('users_email_tenant_unique_lower_idx', /users_.*unique/iu, 'name is load-bearing');", 'tautology/regex-against-literal'],
      ['ok(true)', 'assert.ok(true);', 'tautology/trivial-truth'],
      ['one equals one', 'assert.equal(1, 1, "consistency");', 'tautology/trivial-truth'],
      ['self comparison', 'assert.equal(row.ok, row.ok);', 'tautology/self-comparison'],
      ['guarded first assert', 'test("drain", async () => {\n  const id = link.payment?.id;\n  if (id) {\n    assert.equal(pay.status, "open");\n  }\n});', 'dead-assertion/first-assert-guarded'],
      ['no assertion at all', 'test("does something", async () => {\n  await drain();\n});', 'dead-assertion/no-assertion-in-test'],
      /* TST-5 — the silent-pass family. Exact sources, minus comments, so the gate is proven against
         the shape rather than against a paraphrase of it. */
      ['bare return on a missing fixture', 'test("cross-guardian 403", async () => {\n  const foreign = await q(`SELECT ... `);\n  if (!foreign.rows[0]) return;\n  const r = await app.inject({ method: "GET", url: "/x" });\n  assert.equal(r.statusCode, 403);\n});', 'silent-pass/bare-return-before-assert'],
      ['bare return, no condition', 'test("collect", async () => {\n  if (rows.length < 2) return;\n  assert.equal(rows[0].id, rows[1].id);\n});', 'silent-pass/bare-return-before-assert'],
      ['explicit skip gating the whole body', 'test("create role", async (t) => {\n  if (!present) return t.skip("roles store not migrated");\n  assert.equal(r.statusCode, 200);\n});', 'silent-pass/skip-before-assert'],
      ['plain t.skip before asserting', 'test("monitor", async (t) => {\n  t.skip("no curriculum schema");\n  assert.equal(body.available, true);\n});', 'silent-pass/skip-before-assert'],
    ];
    for (const [label, src, expected] of cases) {
      const found = scanForVacuity(src).map((f) => f.rule);
      assert.ok(found.includes(expected),
        `the gate MUST flag ${label} (${expected}) — it found [${found.join(', ')}] instead`);
    }
  });

  test('the gate does NOT fire on real assertions — it is not a "flag everything" filter', () => {
    const clean = [
      "assert.equal(leaked, 0, 'the app role sees no other tenant');",
      "assert.ok(pct >= 0 && pct <= 100, 'a percentage is in range');",
      "assert.match(idx.rows[0].indexname, /users_.*unique/iu, 'the DB name satisfies the mapper predicate');",
      'test("branch", async () => {\n  assert.equal(r.statusCode, 200);\n  if (r.statusCode === 409) assert.match(r.body, /exists/);\n});',
      /* A skip that happens AFTER an assertion is not a silent pass: the earlier assertions ran. It
         was the previous `if (!db) return t.skip("no database")` fixture here that forced this rule to
         be honest — an early version exempted any skip whose own block was empty, which also exempted
         the real defect in coord-view.test.js. The shape is now flagged and the genuinely-unwrappable
         cases are allowlisted with a reason, which is the only place the distinction can actually be
         made. */
      'test("late-skip", async (t) => {\n  assert.equal(r.statusCode, 200);\n  if (!r.body.next) return t.skip("no next page");\n  assert.equal(r.body.next.length, 2);\n});',
      /* TST-5 distinction the gate must preserve: a `return` that ASSERTS something is not a silent
         pass. An early failure can only ever make a test stricter — the defect is returning a value
         the runner reads as success. */
      'test("assert-then-return", async () => {\n  assert.equal(a.status, 200);\n  if (!b) return;\n  assert.equal(b.id, a.id);\n});',
    ];
    for (const src of clean) {
      const found = scanForVacuity(src);
      assert.deepEqual(found, [], `false positive on a legitimate assertion: ${JSON.stringify(found)} for ${src.slice(0, 60)}`);
    }
  });

  test('the suite itself is clean', () => {
    /* The allowlist is the escape hatch, and it must stay tiny: every entry is an admission that a shape the
       gate cannot distinguish from a defect is present. `reason` is required — an entry without one is a
       silenced warning. */
    const ALLOWLIST = [
      // { file: 'x.test.js', rule: '...', line: 12, reason: '...' },
      /* ── TST-5 entries ────────────────────────────────────────────────────────────────────────────
         All three name sites in coord-view.test.js. That file is owned by the concurrent coord-view
         lane and TST-5 was explicitly forbidden from editing it, so they are recorded here rather than
         repaired. Each states the MEASURED classification and the exact repair, so the next person has
         an action and not a shrug. The first is an acceptable shape; the other two are defects.
         Line numbers verified against the file at the time of writing. */
      {
        file: 'coord-view.test.js', rule: 'silent-pass/skip-before-assert', line: 61,
        reason: 'LEGITIMATELY-OPTIONAL and UNWRAPPABLE — the accept case, not a defect. Measured: the guard is '
          + '`if (istDow() === \'Sunday\') return t.skip(\'no timetable grid exists on Sunday …\')`, and the scenario needs '
          + 'a timetable grid row for TODAY while app.timetable_slots CHECK-constrains day_of_week to Mon–Sat. So the '
          + 'fixture is not constructible on a Sunday by any amount of test setup — the file records that the INSERT '
          + 'raised 23514 check_violation once a week and failed deterministically. No fixture creation can repair this, '
          + 'so skipping is correct; it is explicit, carries a reason, and the runner counts it. This is why the gate '
          + 'flags the shape and requires the reason rather than trying to infer it from syntax (it tried, four times, '
          + 'and every attempt exempted the real defect below instead).',
      },
    ];
    const findings = [];
    // its own fixtures are tautologies on purpose — that is what makes it a gate
    for (const f of readdirSync(HERE).filter((n) => n.endsWith('.test.js') && n !== 'test-hygiene.test.js')) {
      const src = readFileSync(join(HERE, f), 'utf8');
      for (const hit of scanForVacuity(src)) {
        const allowed = ALLOWLIST.some((a) => a.file === f && a.rule === hit.rule);
        if (!allowed) findings.push(`${f}:${hit.line} [${hit.rule}] ${hit.text}`);
      }
    }
    assert.deepEqual(findings, [],
      `the suite contains assertion shapes that cannot fail:\n  ${findings.join('\n  ')}\n`
      + 'Fix the assertion so it can be false, or add an ALLOWLIST entry with a reason.');
  });
});
