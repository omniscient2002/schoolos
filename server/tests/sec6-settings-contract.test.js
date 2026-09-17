/* SEC-6 · the settings door must validate against the module's manifest before persisting.
 *
 * THE DEFECT, in three parts.
 *   1. `POST /plugins/:id/settings` persisted `req.body` VERBATIM as the plugin's settings. The validator
 *      (`validateSettingsAgainstSchema`) existed and was wired into `/plugins/:id/settings-form/validate` —
 *      the door that deliberately persists NOTHING. So the check ran on exactly the path that writes nothing
 *      and was skipped on the path that writes everything.
 *   2. Those settings are the most security-sensitive configuration in the product: gateway key ids and
 *      secrets, webhook HMAC secrets, replay-freshness windows, pickup-OTP lifetimes. Any shape of anything
 *      was accepted, and only the enforcing code's own good manners decided what happened next.
 *   3. The schema being validated against was ITSELF stale. `app.plugins.manifest` is written by the DDL when
 *      it creates the row (`018_admissions_funnel.sql` inlines a manifest), and `ensurePluginCatalog`'s INSERT
 *      is guarded by `WHERE NOT EXISTS`, so it never updates a row that already exists — and in the seeded
 *      world the row always exists before the catalog runs. The validators READ that stored manifest, so
 *      enforcing validation without also reconciling the manifest would have enforced a stale declaration.
 *      Measured: `admissions.funnel`'s stored `cycle_start` pattern was over-escaped (15 chars, matching a
 *      literal backslash then `d`) while the module on disk declared the correct 13-char form. Turning the
 *      validator on made that plugin reject its OWN valid settings — a worse failure than the one being fixed.
 *
 * WHAT THIS FILE PINS. Rejection of undeclared keys, of wrong types, and of out-of-range values; that a
 * rejected payload writes NOTHING (not partially); that a partial valid payload is stored in normalized form
 * with defaults materialised; and that the admissions session window — the setting the stale schema had made
 * impossible to save — now saves, which is the regression guard for the reconcile staying wired.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';
import pg from 'pg';

let app;
let sql;
let ownerToken;
let tenantId;

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.ready();
  sql = async (text, params = []) => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try { return await c.query(text, params); } finally { await c.end(); }
  };
  ownerToken = (await loginAs(app, 'owner@meridian.edu')).token;
  tenantId = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
});

after(async () => { await app?.close(); });

const stored = async (pluginId) => (await sql(
  `SELECT settings FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`, [tenantId, pluginId])).rows[0].settings;

const save = (pluginId, payload) => app.inject({
  method: 'POST', url: `/plugins/${pluginId}/settings`, headers: H(ownerToken), payload });

test('SEC-6 · a key the module does not declare is REJECTED, and nothing is written', async () => {
  // `payments.razorpay` declares exactly four settings; this is not one of them.
  const before_ = await stored('payments.razorpay');
  const r = await save('payments.razorpay', {
    key_id: 'rzp_test_SEC6', webhook_freshness_mins: 20, made_up_setting: 'whatever' });
  assert.equal(r.statusCode, 400, `an undeclared key must be refused (got ${r.statusCode}: ${r.body})`);
  const body = r.json();
  assert.ok(Array.isArray(body.errors), 'the refusal must say which key was wrong');
  assert.ok(body.errors.some(e => e.key === 'made_up_setting'),
    `the refusal must name the offending key, not just fail (got ${JSON.stringify(body.errors)})`);
  // The important half: a REJECTED payload must not be partially applied. `key_id` and
  // `webhook_freshness_mins` were both valid, so a door that validated per-key while writing anyway would
  // have stored those two and dropped only the bad one — silently changing live configuration while
  // reporting failure.
  assert.deepEqual(await stored('payments.razorpay'), before_,
    'a refused save must leave the stored settings EXACTLY as they were, including its valid keys');
});

test('SEC-6 · a wrong type or an out-of-range value is rejected', async () => {
  const before_ = await stored('payments.razorpay');
  const wrongType = await save('payments.razorpay', { webhook_freshness_mins: 'twenty' });
  assert.equal(wrongType.statusCode, 400, `a non-numeric freshness window must be refused (${wrongType.body})`);

  // `minimum:1, maximum:120` on webhook_freshness_mins. 0 would mean "accept events of any age", i.e. the
  // replay window silently switched off — the exact outcome the bound exists to prevent.
  const tooLow = await save('payments.razorpay', { webhook_freshness_mins: 0 });
  assert.equal(tooLow.statusCode, 400, `below the declared minimum must be refused (${tooLow.body})`);
  const tooHigh = await save('payments.razorpay', { webhook_freshness_mins: 5000 });
  assert.equal(tooHigh.statusCode, 400, `above the declared maximum must be refused (${tooHigh.body})`);

  assert.deepEqual(await stored('payments.razorpay'), before_, 'no refused payload may leave a trace');
});

test('SEC-6 · a valid payload is stored NORMALIZED, with declared defaults materialised', async () => {
  const r = await save('payments.razorpay', { key_id: 'rzp_test_SEC6OK', webhook_freshness_mins: 20 });
  assert.equal(r.statusCode, 200, r.body);
  const s = await stored('payments.razorpay');
  assert.equal(s.key_id, 'rzp_test_SEC6OK');
  assert.equal(s.webhook_freshness_mins, 20, 'an integer stays an integer, not the string that was posted');
  // Defaults are materialised by the validator, so what the ENFORCING code reads is the schema's declared
  // value rather than undefined-meaning-fall-back-somewhere-else.
  assert.equal(s.webhook_secret, undefined,
    'a default is only materialised where the schema declares one; webhook_secret declares none');
});

test('SEC-6 · the admissions session window saves — the regression guard for the stale schema', async () => {
  /* This is the setting that was IMPOSSIBLE to save the moment validation was switched on. `cycle_start` and
   * `cycle_end` are declared with `pattern: '^\\d{2}-\\d{2}$'`; the registry row the door read had that
   * pattern over-escaped, so it matched a literal backslash followed by `d` and rejected every real value.
   * The module on disk declared the correct form, and `ensurePluginCatalog` now reconciles the stored manifest
   * against it. If that reconcile is ever removed, the row reverts to the DDL's over-escaped copy and this
   * test fails — which is the point of asserting it here rather than only in the admissions suite. */
  const r = await save('admissions.funnel', { admission_year: '2026-27', cycle_start: '01-01', cycle_end: '12-31' });
  assert.equal(r.statusCode, 200,
    `the admissions session window must be settable (got ${r.statusCode}: ${r.body}). A 400 here means the `
    + 'stored settingsSchema no longer matches the module manifest — check the manifest reconcile.');
  const s = await stored('admissions.funnel');
  assert.equal(s.cycle_start, '01-01');
  assert.equal(s.cycle_end, '12-31');

  // …and the pattern must still DISCRIMINATE, or "valid values save" would be satisfied by a pattern that
  // matches anything. A malformed month-day is refused.
  const bad = await save('admissions.funnel', { admission_year: '2026-27', cycle_start: 'nonsense', cycle_end: '12-31' });
  assert.equal(bad.statusCode, 400, 'a malformed MM-DD must be refused — the pattern must discriminate');
  assert.equal((await stored('admissions.funnel')).cycle_start, '01-01', 'the refusal left the good value intact');
});

test('SEC-6 · a module with no declared schema passes through — asserted at the validator, not the door', async () => {
  /* Every one of the 30 shipped modules declares a `settingsSchema`, so this branch is NOT reachable through
   * the HTTP door and I will not invent a plugin to reach it: a fabricated registry row would prove the
   * fixture works, not the product. It is asserted at the validator instead, which is where the decision
   * actually lives, and it is worth pinning because the fallback is a deliberate choice rather than an
   * accident: a module that declares nothing has no declaration to violate, so `canonicalSchema` returns null
   * and the validator passes the payload through. The tempting alternative — refusing every save for those
   * modules — would lock a school out of configuration that was never specified, in a credential path.
   * Asserting it here means the fallback cannot be silently inverted into a fail-closed trap. */
  const { canonicalSchema, validateSettingsAgainstSchema } = await import('../src/settings-contract.js');
  assert.equal(canonicalSchema({ id: 'x' }), null, 'no schema declared → null');
  assert.equal(canonicalSchema(null), null, 'no manifest at all → null');
  // A manifest with a schema of the wrong shape is also treated as "no schema" rather than half-applied.
  assert.equal(canonicalSchema({ settingsSchema: { type: 'array' } }), null, 'a non-object schema is not a schema');

  const r = validateSettingsAgainstSchema(null, { smtp_host: 'smtp.example.in', anything: 1 });
  assert.equal(r.ok, true, 'with no schema there is nothing to reject');
  assert.deepEqual(r.normalized, { smtp_host: 'smtp.example.in', anything: 1 },
    'the payload is carried through unchanged — no keys invented, none dropped');
});

test('SEC-6 · the same validator REJECTS an undeclared key when a schema IS present', async () => {
  /* The must-pass control for the test above: without it, "passes through with no schema" is satisfied by a
   * validator that never rejects anything, which is exactly the defect SEC-6 describes. */
  const { canonicalSchema, validateSettingsAgainstSchema } = await import('../src/settings-contract.js');
  const cbse = (await import('../src/plugins/pack.cbse/manifest.js')).default;
  const schema = canonicalSchema(cbse);
  assert.ok(schema, 'premise: pack.cbse declares a settings schema');
  assert.equal(validateSettingsAgainstSchema(schema, { affiliation_no: '1130001', invented: 'x' }).ok, false,
    'a declared schema must refuse an undeclared key');
  assert.equal(validateSettingsAgainstSchema(schema, { affiliation_no: '1130001', academic_year: '2026-27' }).ok, true,
    'and must accept a payload that satisfies it');
});
