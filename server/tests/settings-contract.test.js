// L3-5.1 — plugin-settings schema → form contract. Pins the ONE implementation
// both sides use: formFieldsFromSchema (UI descriptors), validateSettingsAgainstSchema
// (typed server-side validation: required, unknown keys refused, caps, enums, secret
// flagging — never echoes secret values), canonicalSchema (camelCase convention,
// snake tolerated), and the settings-form doors wired into L3's plugins. Pure tests
// need no DB; door tests ride the lane DB. Style: tests/wave-b.test.js.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { setupTestDb, loginAs } from './helpers.js';
import { canonicalSchema, formFieldsFromSchema, validateSettingsAgainstSchema, isSecretKey } from '../src/settings-contract.js';
import udiseManifest from '../src/plugins/ops.udise/manifest.js';

let app, owner, itadmin, coordinator;
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  owner = await loginAs(app, 'owner@meridian.edu');
  itadmin = owner; // owner passes the owner-tier doors; itadmin tier identical shape
  coordinator = await loginAs(app, 'coordinator@meridian.edu');
  const en = await app.inject({ method: 'POST', url: '/plugins/ops.udise/enable', headers: H(owner.token), payload: { version: '1.0.0', class: 'B' } });
  assert.equal(en.statusCode, 200, en.body);
});

after(async () => { await app?.close(); });

describe('settings contract: pure functions (L3-5.1)', () => {
  test('canonicalSchema: camelCase convention wins, snake_case tolerated, junk refused', () => {
    assert.equal(canonicalSchema({ settingsSchema: { type: 'object', properties: { a: { type: 'string' } } } }).properties.a.type, 'string');
    assert.equal(canonicalSchema({ settings_schema: { type: 'object', properties: { b: { type: 'integer' } } } }).properties.b.type, 'integer');
    assert.equal(canonicalSchema(null), null);
    assert.equal(canonicalSchema({ settingsSchema: { type: 'string' } }), null, 'non-object schemas are not a settings contract');
  });

  test('formFieldsFromSchema: typed descriptors with required/defaults/secrets/options', () => {
    const schema = { type: 'object',
      properties: {
        school_code: { type: 'string', maxLength: 11, description: 'UDISE code' },
        api_secret: { type: 'string', default: '' },
        retries: { type: 'integer', minimum: 0, maximum: 5, default: 2 },
        mode: { type: 'string', enum: ['push', 'pull'] },
        tags: { type: 'array', items: { type: 'string' }, maxItems: 3 },
        loud: { type: 'boolean' },
      },
      required: ['school_code'] };
    const f = formFieldsFromSchema(schema);
    assert.deepEqual(f.map((x) => x.key), ['school_code', 'api_secret', 'retries', 'mode', 'tags', 'loud'], 'manifest authoring order preserved');
    const by = Object.fromEntries(f.map((x) => [x.key, x]));
    assert.equal(by.school_code.required, true);
    assert.equal(by.school_code.maxLength, 11);
    assert.equal(by.api_secret.secret, true, 'secret keys flagged for write-only UI');
    assert.equal(by.retries.type, 'integer');
    assert.equal(by.retries.default, 2);
    assert.deepEqual(by.mode.options.map((o) => o.value), ['push', 'pull']);
    assert.equal(by.mode.type, 'choice');
    assert.equal(by.tags.type, 'list');
    assert.equal(by.loud.type, 'boolean');
  });

  test('validateSettingsAgainstSchema: unknown keys refused, required enforced, types coerced/bounded, secrets never echoed', () => {
    const schema = udiseManifest.settingsSchema;
    const ok = validateSettingsAgainstSchema(schema, { udise_code: ' 19090100107 ', school_name: 'Meridian' });
    assert.equal(ok.ok, true, JSON.stringify(ok.errors));
    assert.equal(ok.normalized.udise_code, '19090100107', 'strings trimmed');
    assert.equal(ok.secretKeys.length, 0);
    const unknown = validateSettingsAgainstSchema(schema, { udise_code: 'x', nope: '1' });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.errors[0].key, 'nope');
    assert.match(unknown.errors[0].error, /not a setting this module declares/);
    const missing = validateSettingsAgainstSchema(schema, {});
    assert.equal(missing.ok, false);
    assert.ok(missing.errors.some((e) => e.key === 'udise_code'));
    // a secret-bearing schema: values normalize for STORAGE but the validate DOOR never returns them
    const sec = { type: 'object', properties: { webhook_signing: { type: 'string' } }, required: ['webhook_signing'] };
    assert.equal(isSecretKey('webhook_signing'), true);
    const secOut = validateSettingsAgainstSchema(sec, { webhook_signing: 's3cret' });
    assert.equal(secOut.ok, true);
    assert.equal(secOut.secretKeys[0], 'webhook_signing', 'caller knows which keys to strip from reads');
    assert.equal(secOut.normalized.webhook_signing, 's3cret', 'storage keeps the value; read doors use secretKeys to strip');
  });

  test('integer/array/boolean bounds: out-of-range refused with the field named', () => {
    const schema = { type: 'object', properties: {
      max: { type: 'integer', minimum: 0, maximum: 100 },
      tags: { type: 'array', items: { type: 'string' }, maxItems: 2 },
      on: { type: 'boolean' },
    } };
    const hi = validateSettingsAgainstSchema(schema, { max: 101 });
    assert.match(hi.errors[0].error, /at most 100/);
    const many = validateSettingsAgainstSchema(schema, { tags: ['a', 'b', 'c'] });
    assert.match(many.errors[0].error, /at most 2/);
    const notBool = validateSettingsAgainstSchema(schema, { on: 'yes' });
    assert.match(notBool.errors[0].error, /true or false/);
    const good = validateSettingsAgainstSchema(schema, { max: '42', tags: ['a'], on: true });
    assert.equal(good.ok, true);
    assert.equal(good.normalized.max, 42, 'numeric strings coerce for integer fields');
  });
});

describe('settings-form doors (L3-5.1 live wiring)', () => {
  test('GET /plugins/ops.udise/settings-form serves descriptors; coordinator (non-admin) 403', async () => {
    const r = await app.inject({ method: 'GET', url: '/plugins/ops.udise/settings-form', headers: H(owner.token) });
    assert.equal(r.statusCode, 200, r.body);
    const body = r.json();
    assert.equal(body.pluginId, 'ops.udise');
    assert.ok(body.fields.some((f) => f.key === 'udise_code' && f.required), 'udise_code surfaced as required');
    assert.equal(JSON.stringify(body).includes('schoolos_dev_pw'), false);
    const par = await app.inject({ method: 'GET', url: '/plugins/ops.udise/settings-form', headers: H(coordinator.token) });
    assert.equal(par.statusCode, 403, 'settings are the admin surface');
  });

  test('POST settings-form/validate: good payload ok; unknown key refused; secret values NEVER echoed', async () => {
    const good = await app.inject({ method: 'POST', url: '/plugins/ops.udise/settings-form/validate', headers: H(owner.token),
      payload: { udise_code: '19090100107' } });
    assert.equal(good.statusCode, 200, good.body);
    assert.equal(good.json().ok, true);
    assert.equal(good.body.includes('19090100107'), false, 'normalized values are not returned — nothing to echo, nothing to leak');
    const bad = await app.inject({ method: 'POST', url: '/plugins/ops.udise/settings-form/validate', headers: H(owner.token),
      payload: { udise_code: '19090100107', mystery: true } });
    assert.equal(bad.statusCode, 200, 'validation is a 200 report, not an error status');
    assert.equal(bad.json().ok, false);
    assert.equal(bad.json().errors[0].key, 'mystery');
  });
});
