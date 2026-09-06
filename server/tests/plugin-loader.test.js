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

    // Bad_Id: id fails the registry namespace regex (redteam P1-1 rule, loader side)
    mkdirSync(join(dir, 'Bad_Id'), { recursive: true });
    writeFileSync(join(dir, 'Bad_Id', 'index.js'), 'export function register() {}');
    // no.register: manifest only, no register() export
    mkdirSync(join(dir, 'no.register'), { recursive: true });
    writeFileSync(join(dir, 'no.register', 'manifest.js'), 'export default { id: "no.register" };');
    writeFileSync(join(dir, 'no.register', 'index.js'), 'export const x = 1;');
    await assert.rejects(
      () => loadPlugins(fakeApp, {}, { dir }),
      (e) => /invalid plugin id/.test(e.message) && /export register\(app, kernel\)/.test(e.message),
      'broken plugins must fail the boot loudly — never half-mount');

    // a good drop-in mounts cleanly (manifest.js + index.js per the factory contract)
    rmSync(join(dir, 'Bad_Id'), { recursive: true, force: true });
    rmSync(join(dir, 'no.register'), { recursive: true, force: true });
    mkdirSync(join(dir, 'good.plugin'), { recursive: true });
    writeFileSync(join(dir, 'good.plugin', 'manifest.js'), "export default { id: 'good.plugin' };");
    writeFileSync(join(dir, 'good.plugin', 'index.js'), `
      export function register(app) { app.get('/fixture/ping', async () => ({ ok: true })); }`);
    const { loaded, failed } = await loadPlugins(fakeApp, {}, { dir });
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
    // redteam P2-1: registry hygiene on the enable door
    const badV = await app.inject({ method: 'POST', url: '/plugins/pack.cbse/enable',
      headers: { ...H(o.token), 'content-type': 'application/json' }, payload: { class: 'C', version: 'not-semver' } });
    assert.equal(badV.statusCode, 400);
    const badM = await app.inject({ method: 'POST', url: '/plugins/pack.cbse/enable',
      headers: { ...H(o.token), 'content-type': 'application/json' }, payload: { class: 'C', manifest: { blob: 'x'.repeat(70000) } } });
    assert.equal(badM.statusCode, 413);
    const badP = await app.inject({ method: 'POST', url: '/plugins/pack.cbse/enable',
      headers: { ...H(o.token), 'content-type': 'application/json' }, payload: { class: 'C', permissions: ['students.read', 42] } });
    assert.equal(badP.statusCode, 400);
  });

  test('redteam P1-2: settings is owner/itadmin-only; lesser roles get {hasSettings, keys}', async () => {
    const o = await loginAs(app, 'owner@meridian.edu');
    const canary = 'SECRET-CANARY-loader-7f3';
    await app.inject({ method: 'POST', url: '/plugins/pack.cbse/settings',
      headers: { ...H(o.token), 'content-type': 'application/json' },
      payload: { redteam_canary: canary } });
    // teacher (not privileged) must never see the value…
    const t = await loginAs(app, 'teacher@meridian.edu');
    const asTeacher = await app.inject({ method: 'GET', url: '/plugins', headers: H(t.token) });
    assert.equal(JSON.stringify(asTeacher.json()).includes(canary), false, 'canary must not leak to teacher');
    const cbseTeacher = asTeacher.json().plugins.find(p => p.plugin_id === 'pack.cbse');
    assert.equal(cbseTeacher.settings, undefined);
    assert.equal(cbseTeacher.hasSettings, true, 'hasSettings flag survives redaction');
    assert.deepEqual(cbseTeacher.keys, ['redteam_canary'], 'keys are surfaced without values');
    assert.ok(cbseTeacher.settings_schema, 'manifest schema still guides lesser roles');
    // parent role (orchestrator verification bar): no settings values either
    const p = await loginAs(app, 'parent@meridian.edu');
    const asParent = await app.inject({ method: 'GET', url: '/plugins', headers: H(p.token) });
    assert.equal(JSON.stringify(asParent.json()).includes(canary), false, 'canary must not leak to parent');
    assert.equal(asParent.json().plugins.every(pl => pl.settings === undefined), true, 'no settings values for parent');
    // …and the owner still can (management surface unchanged)
    const asOwner = await app.inject({ method: 'GET', url: '/plugins', headers: H(o.token) });
    const cbseOwner = asOwner.json().plugins.find(p => p.plugin_id === 'pack.cbse');
    assert.equal(cbseOwner.settings?.redteam_canary, canary);
    // cleanup: clear the canary so downstream suites see a clean registry
    await app.inject({ method: 'POST', url: '/plugins/pack.cbse/settings',
      headers: { ...H(o.token), 'content-type': 'application/json' }, payload: {} });
  });
});
