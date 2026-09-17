// Plugin loader contract (docs/11 §2.2 plugin-native factory):
//   - plugins drop in as src/plugins/<id>/ with manifest.js + index.js — no core edits
//   - loader validation fails loud on bad ids / broken modules
//   - registry surface honors redteam P1-1 (id validation) + P1-2 (settings redaction)
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setupTestDb, loginAs } from './helpers.js';

let app;

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.ready();
});

after(async () => { if (app) await app.close(); });

const H = (t) => ({ authorization: `Bearer ${t}` });

describe('plugin loader (drop-in factory)', () => {
  test('all plugin directories mount with zero core wiring', async () => {
    const o = await loginAs(app, 'owner@meridian.edu');
    // one representative door per mounted plugin — non-404 proves the loader registered it
    const probes = [
      ['GET', '/plugins/comms.whatsapp/templates', null],
      ['POST', '/plugins/payments.upi/links', {}],   // mounted + validation (400: obligationId required)
      ['GET', '/plugins/transport.gps/positions', null],
      ['GET', '/plugins/ops.timetable/grid', null],
    ];
    for (const [method, url, payload] of probes) {
      const r = await app.inject({ method, url, headers: H(o.token), payload });
      assert.notEqual(r.statusCode, 404, `${method} ${url} must be mounted by the loader`);
      assert.ok(r.statusCode < 500, `${method} ${url} must not blow up (got ${r.statusCode})`);
    }
  });

  test('loader validation: bad ids and broken modules fail loud; a good drop-in mounts', async () => {
    const { loadPlugins } = await import('../src/plugins/loader.js');
    const dir = join(process.cwd(), 'tests', '.loader-fixture');
    rmSync(dir, { recursive: true, force: true });
    const fakeApp = { log: { warn() {}, error() {}, info() {} }, get() {}, post() {} };
    // The loader now hands each plugin `scopedKernel(kernel, id, permissions)`, and that facade requires
    // the kernel's audit seam (`audit.request`) to exist to be able to record a refusal. A stub kernel must
    // therefore model that contract — the real kernel always carries auditLog.
    const fakeKernel = { auditLog: async () => ({ id: 'fixture-audit' }) };

    // Bad_Id: id fails the registry namespace regex (redteam P1-1 rule, loader side)
    mkdirSync(join(dir, 'Bad_Id'), { recursive: true });
    writeFileSync(join(dir, 'Bad_Id', 'index.js'), 'export function register() {}');
    // no.register: manifest only, no register() export
    mkdirSync(join(dir, 'no.register'), { recursive: true });
    writeFileSync(join(dir, 'no.register', 'manifest.js'), 'export default { id: "no.register" };');
    writeFileSync(join(dir, 'no.register', 'index.js'), 'export const x = 1;');
    await assert.rejects(
      () => loadPlugins(fakeApp, fakeKernel, { dir }),
      (e) => /invalid plugin id/.test(e.message) && /export register\(app, kernel\)/.test(e.message),
      'broken plugins must fail the boot loudly — never half-mount');

    // a good drop-in mounts cleanly (manifest.js + index.js per the factory contract)
    rmSync(join(dir, 'Bad_Id'), { recursive: true, force: true });
    rmSync(join(dir, 'no.register'), { recursive: true, force: true });
    mkdirSync(join(dir, 'good.plugin'), { recursive: true });
    writeFileSync(join(dir, 'good.plugin', 'manifest.js'), "export default { id: 'good.plugin' };");
    writeFileSync(join(dir, 'good.plugin', 'index.js'), `
      export function register(app) { app.get('/fixture/ping', async () => ({ ok: true })); }`);
    const { loaded, failed } = await loadPlugins(fakeApp, fakeKernel, { dir });
    assert.equal(failed.length, 0);
    assert.deepEqual(loaded.map(l => l.id), ['good.plugin']);
    assert.equal(loaded[0].manifest.id, 'good.plugin');

    rmSync(dir, { recursive: true, force: true });
  });

  test('redteam P1-1: traversal-style plugin ids are rejected at the registry', async () => {
    const o = await loginAs(app, 'owner@meridian.edu');
    // orchestrator cycle-2 pattern: ^[a-z0-9][a-z0-9.-]{2,63}$ — traversal at any
    // depth, uppercase, spaces, short ids and underscore ids all bounce
    for (const id of ['..%2F..%2Fkernel', 'UPPER.case', 'has%20space', 'x', '_underscore']) {
      const r = await app.inject({ method: 'POST', url: `/plugins/${id}/enable`,
        headers: { ...H(o.token), 'content-type': 'application/json' }, payload: { class: 'A' } });
      assert.equal(r.statusCode, 400, `${id} must be rejected (got ${r.statusCode})`);
      assert.match(r.json().error, /invalid plugin id/);
    }
    // registry stays clean — no malformed row was created
    const list = await app.inject({ method: 'GET', url: '/plugins', headers: H(o.token) });
    assert.equal(list.json().plugins.some(p => p.plugin_id.includes('..')), false);
    // exams.assessment early registration (orchestrator decision): metadata-only row,
    // registered (not enabled), class D — keeps the frontend 'exams' card mirror honest
    const exams = list.json().plugins.find(p => p.plugin_id === 'exams.assessment');
    assert.ok(exams, 'exams.assessment must be registered in the catalog');
    assert.equal(exams.class, 'D');
    assert.equal(exams.status, 'registered');
    /* PLG-4 UPDATE (2026-09-15): the enable door no longer reads `version`/`class`/`manifest`/`permissions`
     * from the body AT ALL — they come from the on-disk manifest — so there is no client input left to
     * validate. The old assertions here (bad version → 400, 70 KB manifest → 413, mixed permission array →
     * 400) encoded the trust-the-body contract that change removed; keeping them would pin a vulnerability.
     * The property that survives is STRONGER and is asserted directly: a hostile body cannot change what is
     * recorded. (version/class/permission metadata is pinned in tests/plg-enable-metadata.test.js.) */
    // PLG-2b: pack.cbse declares `exams.assessment@1.0.1` as a dependency, and the enable door refuses
    // before it is enabled. Satisfy the dependency so this test can exercise the body-ignoring property.
    const dep = await app.inject({ method: 'POST', url: '/plugins/exams.assessment/enable', headers: { ...H(o.token), 'content-type': 'application/json' }, payload: {} });
    assert.equal(dep.statusCode, 200, `dependency enable failed: ${dep.body}`);
    const hostile = await app.inject({ method: 'POST', url: '/plugins/pack.cbse/enable',
      headers: { ...H(o.token), 'content-type': 'application/json' },
      payload: { class: 'A', version: 'not-semver', manifest: { blob: 'x'.repeat(70000) }, permissions: ['students.read', 42] } });
    assert.equal(hostile.statusCode, 200, 'the body is ignored, so a hostile one neither fails nor misleads');
    assert.equal(hostile.json().plugin.manifest.blob, undefined, 'the body manifest is never stored');
    assert.notEqual(hostile.json().plugin.version, 'not-semver', 'the stored version is the manifest\'s, not the body\'s');
  });

  test('redteam P1-2: settings is owner/itadmin-only; lesser roles get {hasSettings, keys}', async () => {
    /* SEC-6 UPDATE (2026-09-14): this test used to save an invented key, `redteam_canary`, which
     * `/plugins/:id/settings` no longer accepts — undeclared keys are now a 400 instead of being persisted
     * silently, which is exactly the SEC-6 defect. The payload below therefore uses keys the module DOES
     * declare (both of `pack.cbse`'s are required: affiliation_no, academic_year).
     *
     * The property under test is UNCHANGED and still enforced: a value written by the owner must not be
     * visible to a teacher or a parent, and the owner must still read it back. The assertion on `keys` is
     * stronger than before rather than weaker — the module declares five settings and its defaults are
     * materialised, so the surfaced key list is now compared against the whole declared set instead of the
     * single key this test happened to invent. */
    const o = await loginAs(app, 'owner@meridian.edu');
    const canary = 'SECRET-CANARY-loader-7f3';
    await app.inject({ method: 'POST', url: '/plugins/pack.cbse/settings',
      headers: { ...H(o.token), 'content-type': 'application/json' },
      payload: { affiliation_no: '1130001', academic_year: canary } });
    // teacher (not privileged) must never see the value…
    const t = await loginAs(app, 'teacher@meridian.edu');
    const asTeacher = await app.inject({ method: 'GET', url: '/plugins', headers: H(t.token) });
    assert.equal(JSON.stringify(asTeacher.json()).includes(canary), false, 'canary must not leak to teacher');
    const cbseTeacher = asTeacher.json().plugins.find(p => p.plugin_id === 'pack.cbse');
    assert.equal(cbseTeacher.settings, undefined);
    assert.equal(cbseTeacher.hasSettings, true, 'hasSettings flag survives redaction');
    // Compared as a SET: `keys` is built from Object.keys of the stored settings, so its order follows
    // insertion (payload keys, then defaults) rather than the schema. Order is not the property under test.
    assert.deepEqual([...cbseTeacher.keys].sort(),
      ['academic_year', 'affiliation_no', 'board', 'report_card_template', 'weightage_strict'],
      'keys are surfaced without values — the whole declared set, defaults included');
    assert.ok(cbseTeacher.settings_schema, 'manifest schema still guides lesser roles');
    // parent role (orchestrator verification bar): no settings values either
    const p = await loginAs(app, 'parent@meridian.edu');
    const asParent = await app.inject({ method: 'GET', url: '/plugins', headers: H(p.token) });
    assert.equal(JSON.stringify(asParent.json()).includes(canary), false, 'canary must not leak to parent');
    assert.equal(asParent.json().plugins.every(pl => pl.settings === undefined), true, 'no settings values for parent');
    // …and the owner still can (management surface unchanged)
    const asOwner = await app.inject({ method: 'GET', url: '/plugins', headers: H(o.token) });
    const cbseOwner = asOwner.json().plugins.find(p => p.plugin_id === 'pack.cbse');
    assert.equal(cbseOwner.settings?.academic_year, canary);
    // cleanup: reset the canary so downstream suites see a clean registry. `pack.cbse` requires
    // affiliation_no and academic_year, so an empty payload is no longer a legal save — reset to a plain value.
    await app.inject({ method: 'POST', url: '/plugins/pack.cbse/settings',
      headers: { ...H(o.token), 'content-type': 'application/json' },
      payload: { affiliation_no: '1130001', academic_year: '2026-27' } });
  });
});
