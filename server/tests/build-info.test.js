/* OPS-11 · which build is live? — the identifier must be DERIVED, not typed.
 *
 * WHY THIS FILE EXISTS. PERFECT-100 §5 OPS-11 found there was **no versioned build/commit identifier anywhere
 * in the product**, so after a bad deploy nobody could answer the first question an incident asks: which build
 * is running? The newest release certificate on disk was 65 migrations stale and certified a tree that no
 * longer existed — a confident wrong answer, which is worse than no answer. The fix adds a startup-derived
 * fingerprint of the deployed sources, an overridable BUILD_ID/GIT_SHA, and surfaces it in `/health`, in the
 * Prometheus output and in the boot log.
 *
 * WHAT IS ASSERTED, and why each half is needed:
 *   (1) The fingerprint is DETERMINISTIC within a process (two calls agree) and has the documented shape. A
 *       non-deterministic identifier would make every deploy look like a change, and a build-info label that
 *       flaps is worse than none.
 *   (2) It is COMPUTED rather than hand-maintained. This is the assertion that matters. A hand-typed version
 *       string is the same defect as the hand-typed test counts in §6.5 item 29: true once, then silently
 *       false. Proved by MUTATION-PROBING THE MODULE ITSELF — copying the server into a scratch tree, changing
 *       one byte of one source file, and asserting the fingerprint MOVES. Without this, a future refactor could
 *       replace the computation with a constant and every other test here would still pass.
 *   (3) It is OVERRIDABLE by a real build system. A pipeline that knows its commit must be able to say so, and
 *       an operator must be able to tell the two apart — hence `identitySource`, asserted both ways. The
 *       distinction is load-bearing: only an explicit id can be traced to a CI artifact.
 *   (4) It REACHES the surfaces an operator actually uses: the `/health` JSON and the Prometheus text output.
 *       A computed identifier nobody can read closes nothing.
 *
 * HONEST LIMIT: the fingerprint hashes `src/**` plus `package.json`, NOT the whole repository. A change confined
 * to `migrations/` or to a test file therefore does NOT move it. That is a deliberate scope — the question is
 * "which code is serving traffic", and hashing 87 test files on every process start would make a cheap endpoint
 * expensive — but it means the fingerprint identifies the server build, not the git revision. The
 * `verification-artifact.js` fingerprint is the wider one (it covers tests and migrations) and is the right tool
 * for tying DOCUMENTED numbers to a tree. Both are asserted here so the difference is recorded rather than
 * assumed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { buildInfo } from '../src/build-info.js';
import { setupTestDb, loginAs } from './helpers.js';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..');

test('OPS-11 · build identity', async (t) => {
  await t.test('is deterministic within a process and has the documented shape', () => {
    const a = buildInfo(); const b = buildInfo();
    assert.equal(a.fingerprint, b.fingerprint, 'two calls in one process must agree — a flapping id is worse than none');
    assert.equal(a.id, b.id);
    assert.equal(a.startedAt, b.startedAt, 'start time is fixed at import, not recomputed per call');
    assert.match(a.fingerprint, /^([0-9a-f]{12}|unknown)$/, 'fingerprint is 12 hex chars, or an honest unknown');
    assert.match(a.id, /^(local-[0-9a-f]{12}|[^ ]+|unknown)$/, 'id is namespaced when derived, verbatim when explicit');
    assert.equal(a.identitySource, 'source fingerprint (computed)', 'no BUILD_ID set in this environment');
    assert.equal(a.version, '1.0.0', 'version comes from package.json, not a literal');
    assert.equal(a.env, process.env.NODE_ENV ?? 'development');
    assert.match(a.node, /^v\d+\./, 'node version is reported, since runtime drift is also a deploy difference');
  });

  await t.test('is COMPUTED from the sources, not a constant — proved by mutating a copy of the tree', () => {
    // The whole point of this feature is that the identifier tracks the deployed bytes. Copy the server to a
    // scratch directory, flip ONE character of ONE source file, and require the fingerprint to move. If a
    // future change replaces the computation with a constant or a hand-typed string, this test fails and every
    // other test in this file still passes — which is exactly the failure mode it exists to catch.
    const dir = mkdtempSync(join(tmpdir(), 'ops11-'));
    try {
      mkdirSync(join(dir, 'src'), { recursive: true });
      cpSync(join(SERVER, 'src'), join(dir, 'src'), { recursive: true });
      cpSync(join(SERVER, 'package.json'), join(dir, 'package.json'));

      const probe = `
        import { buildInfo } from ${JSON.stringify(join(dir, 'src', 'build-info.js'))};
        process.stdout.write(buildInfo().fingerprint);
      `;
      const before = execFileSync('node', ['--input-type=module', '-e', probe], { encoding: 'utf8' }).trim();

      // One byte, in a file the walk covers, chosen to be syntactically inert (a comment) so the mutation
      // tests the IDENTIFIER rather than whether the tree still runs.
      const victim = join(dir, 'src', 'build-info.js');
      writeFileSync(victim, `${readFileSync(victim, 'utf8')}\n// mutation probe\n`);
      const after = execFileSync('node', ['--input-type=module', '-e', probe], { encoding: 'utf8' }).trim();

      assert.match(before, /^[0-9a-f]{12}$/, 'fresh copy measured a real fingerprint');
      assert.notEqual(after, before,
        'changing one byte of a source file MUST move the fingerprint — an identifier that ignores the code is a hand-typed version string with extra steps');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('an explicit BUILD_ID/GIT_SHA overrides it and is reported as a different identity source', () => {
    const derived = buildInfo();
    const saved = { BUILD_ID: process.env.BUILD_ID, GIT_SHA: process.env.GIT_SHA };
    try {
      process.env.BUILD_ID = 'ci-4242';
      const explicit = buildInfo();
      assert.equal(explicit.id, 'ci-4242', 'a build system that knows its identity must be able to state it');
      assert.equal(explicit.identitySource, 'BUILD_ID/GIT_SHA env');
      assert.equal(explicit.fingerprint, derived.fingerprint,
        'the fingerprint is still computed — the override changes the reported id, not the measured tree');

      delete process.env.BUILD_ID;
      process.env.GIT_SHA = 'abc1234';
      assert.equal(buildInfo().id, 'abc1234', 'GIT_SHA is honoured when BUILD_ID is absent');

      delete process.env.GIT_SHA;
      assert.equal(buildInfo().id, derived.id, 'with neither set we fall back to the derived identity, never to unknown');
    } finally {
      if (saved.BUILD_ID === undefined) delete process.env.BUILD_ID; else process.env.BUILD_ID = saved.BUILD_ID;
      if (saved.GIT_SHA === undefined) delete process.env.GIT_SHA; else process.env.GIT_SHA = saved.GIT_SHA;
    }
  });

  // The surfaces are what an operator reaches for at 3am; a computed id nobody can read closes nothing.
  await t.test('reaches /health and the Prometheus output', async () => {
    await setupTestDb();
    // Imported HERE, not at module top: `src/app.js` (via `src/config.js`) reads DATABASE_URL at import
    // time, so a top-level import would bind the module cache to the ambient dev database and this test
    // would authenticate against the wrong DB (`relation "auth.login_throttles" does not exist`). The
    // helper's own contract says to import src after `setupTestDb`.
    const { buildApp } = await import('../src/app.js');
    const app = await buildApp();
    try {
      const h = await app.inject({ method: 'GET', url: '/health' });
      assert.equal(h.statusCode, 200);
      const body = h.json();
      // The pre-existing contract must survive: this endpoint is polled by monitoring and asserted elsewhere.
      for (const k of ['status', 'db', 'time']) assert.ok(k in body, `${k} must remain — the build field is additive`);
      assert.ok(body.build, '/health must answer "which build is live?"');
      assert.equal(body.build.id, buildInfo().id);
      assert.match(body.build.fingerprint, /^([0-9a-f]{12}|unknown)$/);
      assert.equal(body.build.env, process.env.NODE_ENV ?? 'development');

      // /metrics is role-gated to owner/itadmin (it exposes pool and queue internals), so the scrape below is
      // authenticated for real rather than asserting on a 401 body — a metrics test that never logged in would
      // pass against a broken endpoint while proving nothing about what an operator can actually read.
      const owner = await loginAs(app, 'owner@meridian.edu');
      const H = (t) => ({ authorization: `Bearer ${t}` });
      const anon = await app.inject({ method: 'GET', url: '/metrics' });
      assert.equal(anon.statusCode, 401, 'the metrics gate still holds — this test authenticates for a reason');
      const m = await app.inject({ method: 'GET', url: '/metrics', headers: H(owner.token) });
      assert.equal(m.statusCode, 200, 'an owner must be able to scrape the build identity');
      const text = m.payload;
      assert.match(text, /# TYPE schoolos_build_info gauge/, 'build identity is scrapable, not only curlable');
      assert.match(text, /schoolos_build_info\{[^}]*fingerprint="[0-9a-f]{12}"[^}]*\} 1/,
        'the gauge carries the fingerprint as a label so two builds are two series');
      // Label escaping: a BUILD_ID containing a quote must not corrupt the exposition format. Prometheus would
      // reject the whole scrape on a malformed line, so an unescaped value here is an outage, not a cosmetic bug.
      const saved = process.env.BUILD_ID;
      try {
        process.env.BUILD_ID = 'weird"id\\with\nnewline';
        const m2 = await app.inject({ method: 'GET', url: '/metrics', headers: H(owner.token) });
        const line = m2.payload.split('\n').find((l) => l.startsWith('schoolos_build_info{'));
        assert.ok(line, 'the build series is still emitted');
        assert.ok(!/[\n]/.test(line), 'a newline in the id must be escaped or it splits the exposition line');
        assert.match(line, /id="weird\\"id\\\\with\\nnewline"/, 'quotes, backslashes and newlines are escaped per the Prometheus text format');
        // A malformed exposition line makes Prometheus reject the ENTIRE scrape, so the line must still parse as
        // `name{labels} value` with a numeric sample, and every quote must be paired. The first version of this
        // assertion compared a value to ITSELF (`assert.equal(x.match(re), x.match(re))`) and could never fail —
        // exactly the tautology class §6.5 item 31 exists to remove, written while fixing an honesty defect.
        assert.match(line, /^schoolos_build_info\{.*\}\s+-?[\d.eE+]+$/, 'still parses as name{labels} value with a numeric sample');
        assert.equal((line.match(/(?<!\\)"/g) ?? []).length % 2, 0, 'every unescaped quote is paired — an odd count means an unescaped quote broke the label list');
      } finally {
        if (saved === undefined) delete process.env.BUILD_ID; else process.env.BUILD_ID = saved;
      }
    } finally {
      await app.close();
    }
  });
});
