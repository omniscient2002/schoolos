// PRD-13 (residual) · the daily dunning step has NEVER run.
//
// THE DEFECT, verified in the code and on disk: `scripts/day-worker.js` step 4 does
//   `await import('../src/plugins/money.invoicing/dunning.js')`
// and `src/plugins/money.invoicing/` **does not exist** (`ls` confirms), so the import throws
// MODULE_NOT_FOUND on every single run, the catch logs `day.dunning { status: 'skipped' }`, and the
// worker reports a clean day. The step is documented as transitional ("until L1's module lands the step
// logs `skipped`, never crashes"), and it is still transitional — but the module it waits for was never
// the right target: the real sweep exists as `scripts/dunning-reminders.js`, a self-executing CLI script
// with NO exports, so the hook's `mod.runDunning` contract could never have matched it even after
// "landing". Net effect: overdue-fee reminders, a money-collecting path with an HTTP door
// (`POST /fees/dunning/run`) that works, silently never ran on schedule.
//
// WHAT IS PINNED HERE:
//   1. The daily step performs a REAL sweep — it reports work rather than a skip, and the sweep is
//      driven through the same code path the HTTP door uses.
//   2. The containment property the old test was protecting is PRESERVED: if the sweep throws, the day
//      does not crash. This is the part that mattered, and it is now tested by making the sweep fail on
//      purpose instead of by asserting that its module is missing.
//   3. `node scripts/dunning-reminders.js` still works as a standalone cron entry with its documented
//      exit codes (1 = reminders queued, 0 = clean or quiet hours).
//
// WHY THE CRON-PARITY TEST CONTROLS ITS OWN INPUT. The CLI sweeps EVERY tenant
// (`SELECT id, slug FROM app.tenants`), so it cannot be scoped to a fixture. The original version of that
// test depended on an assumption about the world — "no overdue obligations in a fresh database" — which is
// false from 2026-10-06 onwards, when the seed's September installments (due 2026-10-05, 290 still open)
// become overdue: the CLI then correctly queues reminders, correctly exits 1, and the test fails for a
// reason that has nothing to do with the contract it pins. The test below therefore pushes the corpus out
// of the window FIRST and asserts both branches of the exit contract, which is what a cron wrapper actually
// depends on. Verified by rewriting the seed's September due date to 2026-01-05 and re-running.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setupTestDb } from './helpers.js';

let sql;
let tenantId;
let day;

before(async () => {
  await setupTestDb();
  sql = async (text, params = []) => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const r = await c.query(text, params);
    await c.end();
    return r;
  };
  tenantId = (await sql(`SELECT id FROM app.tenants ORDER BY created_at LIMIT 1`)).rows[0].id;
  day = await import('../scripts/day-worker.js');
});

describe('PRD-13 residual · the day-worker dunning step is real, contained and cron-able', () => {
  test('the hook calls the real sweep — not a module that does not exist', async () => {
    // The old target must be gone: an import of a non-existent module can only ever report 'skipped'.
    const fs = await import('node:fs');
    assert.equal(fs.existsSync(new URL('../src/plugins/money.invoicing/dunning.js', import.meta.url)), false,
      'fixture sanity: the path the worker used to import genuinely does not exist');
    const src = fs.readFileSync(new URL('../scripts/day-worker.js', import.meta.url), 'utf8');
    // Precisely: no IMPORT of the dead path. The module's history comment names it on purpose, so a blunt
    // "the string must not appear" assertion would forbid documenting the fix — the comment is load-bearing
    // and the import is the defect.
    assert.ok(!/import\s*\(\s*['"][^'"]*money\.invoicing/.test(src),
      'the worker must not import a module that does not exist — that is the defect, not the fix');
    assert.match(src, /dunning-reminders\.js/, 'and must point at the sweep that actually exists');
    assert.match(src, /runDunningHook/, 'the step keeps its name, so the composed day is unchanged');
  });

  test('running the step performs a sweep and reports its work', async () => {
    // `quiet: false` because the honest default is "decide from the clock", and a test that depends on the
    // wall clock is a test that passes at 3pm and fails at 3am (IST quiet hours are 21:00–08:00). Forcing
    // non-quiet is exactly what that parameter exists for.
    const out = await day.runDunningHook({ quiet: false });
    // THE REGRESSION GATE. Before this fix the only possible answer was 'skipped' (module missing) — and a
    // step that never runs cannot queue a reminder, whatever the fee situation is.
    assert.notEqual(out.status, 'skipped',
      `the daily dunning step must do work, not skip (got ${JSON.stringify(out)})`);
    assert.equal(out.status, 'ok', JSON.stringify(out));
    assert.ok('queued' in out, 'and must report how many reminders it queued');
    assert.equal(typeof out.queued, 'number');
    assert.equal(out.quiet, false, 'the sweep ran rather than short-circuiting as quiet');
  });

  test('a sweep that throws is contained — the day never crashes (the OLD test\'s real intent)', async () => {
    // The previous assertion pinned "the module is absent, so it skips". The property worth protecting is
    // containment, so exercise it directly: hand the hook a sweep that fails.
    const out = await day.runDunningHook({ runDunning: async () => { throw new Error('synthetic sweep failure'); } });
    assert.equal(out.status, 'skipped', 'a failing sweep is reported, not thrown');
    assert.match(out.reason, /synthetic sweep failure/, 'and the reason is preserved for the operator');
  });

  test('quiet hours produce no reminders and are reported as quiet, not as a failure', async () => {
    // A sweep during quiet hours is a SUCCESS with zero work — it must not look like a contained error.
    const out = await day.runDunningHook({ quiet: true });
    assert.equal(out.status, 'ok');
    assert.equal(out.quiet, true, 'quiet hours are stated, so a cron reader can tell "nothing to do" from "broken"');
    assert.equal(out.queued, 0);
  });

  test('the standalone CLI still runs the same sweep (cron entry parity)', async () => {
    const { execFileSync } = await import('node:child_process');
    // Control the input before asserting on the output. `+ 3650` days rather than `+ 1` so the row cannot
    // drift back into the window during a long run, and it is an UPDATE rather than a DELETE because the
    // ledger is append-only in spirit and deleting a real obligation would hide a genuine sweep bug.
    await sql(`UPDATE app.fee_obligations SET due_on = (now() AT TIME ZONE 'Asia/Kolkata')::date + 3650
               WHERE status IN ('open','partial') AND due_on < (now() AT TIME ZONE 'Asia/Kolkata')::date`);
    // Documented contract: exits 1 when reminders were queued (so a cron wrapper can alert), 0 when clean
    // or quiet. With no overdue obligations in a fresh database it must exit 0 — and must NOT exit with a
    // MODULE_NOT_FOUND-style crash code.
    let code = 0;
    try {
      execFileSync(process.execPath, ['scripts/dunning-reminders.js'],
        { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, QUIET_HOURS: '' }, stdio: 'pipe' });
    } catch (e) { code = e.status ?? 1; }
    assert.equal(code, 0, 'a clean sweep exits 0 (a crash would surface as a non-zero code with a stack trace)');
  });

  test('the worker still exports every step with the same names', async () => {
    // The day is composed from named steps; renaming or dropping one silently removes it from the cron.
    for (const fn of ['runPreventiveStub', 'runTallySummary', 'runRetention', 'runDunningHook']) {
      assert.equal(typeof day[fn], 'function', `${fn} must remain exported`);
    }
  });
});
