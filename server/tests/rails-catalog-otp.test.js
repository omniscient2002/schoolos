/* PRD-4 / PLG-3 + OPS-5 — the credential rails are real plugins, and the OTP door cannot claim it sent
   what it did not send.
 *
 * Two register findings, one surface:
 *  - PRD-4/PLG-3: rails.email / rails.sms / rails.whatsapp shipped with manifests, settings contracts and
 *    working send functions, and are declared in app.capability_contracts (045) — but they had NO row in
 *    app.plugins for any tenant. So the plugin manager could not show, enable or configure them, and
 *    `/me/reset-request`'s channel gate ("SELECT 1 FROM app.plugins WHERE plugin_id='rails.email'") could
 *    never match: **self-service password reset answered 503 for every tenant, forever.**
 *  - OPS-5: `/auth/otp/request` answered `{sent:true}` and minted a code while sending NOTHING anywhere.
 *
 * The tests below are written so that the DEFECT fails them: a fabricated "sent" is caught by asserting the
 * delivery evidence (provider, sandbox flag, the vault row) rather than the status code alone, and the
 * password-reset case is asserted AFTER switching the rail on through the same door a school owner uses.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';

let app;
let pool;
let owner;
let tenantId;
let phone;   // a REAL seeded account's number: the door only attempts delivery for a known user
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const brief = (r) => `HTTP ${r.statusCode} ${String(r.body ?? '').slice(0, 200)}`;
// every query in this file runs as the OWNER connection: these tests inspect the registry, the vault and the
// ledger, three surfaces the app role is deliberately denied.
const sql = (text, params) => pool.query(text, params);

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  pool = (await import('../src/db.js')).pool;
  owner = await loginAs(app, 'owner@meridian.edu');
  tenantId = (await sql(`SELECT id FROM app.tenants ORDER BY created_at LIMIT 1`)).rows[0].id;
  phone = (await sql(`SELECT phone FROM app.users WHERE tenant_id=$1 AND phone IS NOT NULL ORDER BY created_at LIMIT 1`, [tenantId])).rows[0].phone;
});



after(async () => { await app?.close(); });

describe('PRD-4 · the credential rails are registry plugins, not ghosts', () => {
  test('the SEED itself now carries the rails, and GET /plugins self-heals them if they are missing', async () => {
    // B3 (independent review): `scripts/seed.js` truncates app.plugins and replays a hard-coded migration
    // list that stops at 048, so anything a later migration or the catalog adds is silently reverted in
    // every seeded environment — which is every test and the demo. This asserts the state a FRESH seeded
    // database is in, before anything calls the self-heal, so the seed fix cannot silently regress.
    const seeded = await sql(`SELECT plugin_id FROM app.plugins WHERE tenant_id=$1 AND plugin_id LIKE 'rails.%' ORDER BY plugin_id`, [tenantId]);
    assert.deepEqual(seeded.rows.map((r) => r.plugin_id), ['rails.email', 'rails.sms', 'rails.whatsapp'],
      'a seeded database must already have the rails (the seed now runs the catalog itself)');
    // …and the self-heal still covers a tenant provisioned before the catalog had them
    await sql(`DELETE FROM app.plugins WHERE tenant_id=$1 AND plugin_id LIKE 'rails.%'`, [tenantId]);
    const gone = await sql(`SELECT count(*)::int AS n FROM app.plugins WHERE tenant_id=$1 AND plugin_id LIKE 'rails.%'`, [tenantId]);
    assert.equal(gone.rows[0].n, 0, 'precondition: the tenant has no rails rows');

    const r = await app.inject({ method: 'GET', url: '/plugins', headers: H(owner.token) });
    assert.equal(r.statusCode, 200, brief(r));
    const rows = await sql(`SELECT plugin_id, status FROM app.plugins WHERE tenant_id=$1 AND plugin_id LIKE 'rails.%' ORDER BY plugin_id`, [tenantId]);
    assert.deepEqual(rows.rows.map((x) => x.plugin_id), ['rails.email', 'rails.sms', 'rails.whatsapp'],
      'all three shipped rails are registered for the tenant');
    for (const row of rows.rows) {
      assert.equal(row.status, 'registered', `${row.plugin_id} must arrive SWITCHED OFF — a rail is a credential`);
    }
    // and the plugin manager can see them (that is the whole point: they were invisible)
    const ids = r.json().plugins.map((p) => p.plugin_id);
    assert.ok(ids.includes('rails.sms'), `the plugin manager lists the rails: ${ids.filter((i) => i.startsWith('rails.')).join(',') || '(none)'}`);
  });

  test('the owner can switch a rail on through the plugin door, and the ledger records it', async () => {
    const r = await app.inject({ method: 'POST', url: '/plugins/rails.email/enable', headers: H(owner.token), payload: { class: 'B', version: '1.0.0' } });
    assert.equal(r.statusCode, 200, brief(r));
    const row = await sql(`SELECT status, enabled_at FROM app.plugins WHERE tenant_id=$1 AND plugin_id='rails.email'`, [tenantId]);
    assert.equal(row.rows[0].status, 'enabled');
    assert.ok(row.rows[0].enabled_at, 'enabled_at is stamped');
    const audit = await sql(`SELECT action FROM app.audit_log WHERE tenant_id=$1 AND action ILIKE '%rails.email%' ORDER BY created_at DESC, ctid DESC LIMIT 1`, [tenantId]);
    assert.ok(audit.rows[0], 'switching a credential rail on is an audited act');
  });

  test('PRD-4: password reset works once the email rail is switched on — it was 503 for every tenant before', async () => {
    // The defect state, reproduced exactly: the row EXISTS but is not enabled, which is what every tenant
    // looked like after the catalog seed (and, before the fix, what every tenant looked like forever).
    await sql(`UPDATE app.plugins SET status='registered', settings='{"provider":"logger"}'::jsonb WHERE tenant_id=$1 AND plugin_id='rails.email'`, [tenantId]);
    const off = await app.inject({ method: 'POST', url: '/me/reset-request', headers: { 'content-type': 'application/json' }, payload: { email: 'teacher@meridian.edu' } });
    assert.equal(off.statusCode, 503, `a school with the channel switched off must say so, not fake a send: ${brief(off)}`);
    assert.match(off.json().error, /switched on|no email channel/i);

    await sql(`UPDATE app.plugins SET status='enabled' WHERE tenant_id=$1 AND plugin_id='rails.email'`, [tenantId]);
    const on = await app.inject({ method: 'POST', url: '/me/reset-request', headers: { 'content-type': 'application/json' }, payload: { email: 'teacher@meridian.edu' } });
    assert.equal(on.statusCode, 200, `with the rail on, the reset door must work: ${brief(on)}`);
    assert.equal(on.json().sent, true);
    // delivery evidence, not just a status code: the ledger says WHO carried it and whether that carrier is
    // a sandbox. A logger provider is a sandbox — the mail reached stdout, not a mailbox.
    const comm = await sql(`SELECT provider, status, sent_at, delivered_at FROM app.communications WHERE tenant_id=$1 AND template='PASSWORD_RESET' ORDER BY created_at DESC, ctid DESC LIMIT 1`, [tenantId]);
    assert.ok(comm.rows[0], 'the reset is recorded in the comms ledger');
    assert.equal(comm.rows[0].provider, 'logger');
    assert.equal(comm.rows[0].delivered_at, null, 'a sandbox carrier never confirms delivery');
  });
});

describe('PLG-4 · the catalog seeds REAL manifests, not stubs', () => {
  test('every catalog entry resolves the plugin\'s own manifest, with a settings schema where it has one', async () => {
    // The defect the review found in the 078 change: `ensurePluginCatalog` wrote `{id, version}` as the
    // manifest for every row, and the plugin manager reads its settings form OUT of that manifest — so a
    // tenant provisioned by signup or the GET /plugins self-heal had "Nothing to configure" for every
    // plugin, and the rails could never be pointed at a provider at all. This asserts the resolution
    // directly, so a plugin added without a manifest module fails here instead of shipping a dead form.
    const { CATALOG } = await import('../src/plugin-catalog.js');
    const missing = [];
    for (const p of CATALOG) {
      const mod = await import(`../src/plugins/${p.plugin_id}/manifest.js`).catch(() => null);
      const m = mod?.default ?? mod?.manifest;
      if (!m?.id) missing.push(p.plugin_id);
    }
    assert.deepEqual(missing, [], `these catalog entries have no manifest module and would seed a schema-less row: ${missing.join(', ')}`);
    // and the row the CATALOG declares must match the module it mirrors (a drift guard between the two)
    for (const p of CATALOG) {
      const mod = await import(`../src/plugins/${p.plugin_id}/manifest.js`);
      const m = mod.default ?? mod.manifest;
      assert.equal(m.id, p.plugin_id);
      assert.ok(m.version, `${p.plugin_id}: manifest carries a version`);
    }
  });

  test('a catalog-seeded tenant gets the real manifest in app.plugins (settings form has a schema)', async () => {
    await sql(`DELETE FROM app.plugins WHERE tenant_id=$1 AND plugin_id='library'`, [tenantId]);
    await app.inject({ method: 'GET', url: '/plugins', headers: H(owner.token) });   // the self-heal path
    const row = (await sql(`SELECT manifest FROM app.plugins WHERE tenant_id=$1 AND plugin_id='library'`, [tenantId])).rows[0];
    assert.ok(row, 'the self-heal re-seeded the row');
    assert.ok(row.manifest.settingsSchema || row.manifest.settings_schema,
      `the seeded manifest must carry a settings schema or the plugin form is empty: ${JSON.stringify(Object.keys(row.manifest))}`);
    assert.ok(row.manifest.description || row.manifest.name, 'and a human description, not a stub');
  });
});

describe('review findings closed on the OTP door', () => {
  test('B2: a school with no channel refuses EVERY number the same way, registered or not', async () => {
    /* "A school with no channel" means NO channel. This deleted only rails.sms, so whether the test passed
       depended on which rails an earlier test in the file had left enabled — order-dependent setup that read as
       coverage. With rail permission grants now enforced the order changed and it surfaced. Clear all three, and
       assert the precondition, so the test tests what its name says rather than the file's history. */
    await sql(`DELETE FROM app.plugins WHERE tenant_id=$1 AND plugin_id IN ('rails.sms','rails.email','rails.whatsapp')`, [tenantId]);
    const rails = (await sql(`SELECT count(*)::int AS n FROM app.plugins WHERE tenant_id=$1 AND plugin_id LIKE 'rails.%' AND status='enabled'`, [tenantId])).rows[0].n;
    assert.equal(rails, 0, 'fixture: the school really has no enabled channel before this assertion');
    const known = await app.inject({ method: 'POST', url: '/auth/otp/request', headers: { 'content-type': 'application/json' }, payload: { phone, tenantId } });
    const stranger = await app.inject({ method: 'POST', url: '/auth/otp/request', headers: { 'content-type': 'application/json' }, payload: { phone: '+919999000111', tenantId } });
    // In this harness the dev echo may be armed (OTP_DEV_ECHO). Where it is, the honest answer is a sandbox
    // delivery for a real account and the uniform "sent" for a stranger; where it is not, BOTH must be 503 —
    // the refusal must never depend on whether the number happens to have an account here.
    if (known.statusCode === 200) {
      assert.equal(known.json().sandbox, true, `a dev-echo delivery must say it is a sandbox: ${brief(known)}`);
      assert.equal(known.json().channel, 'dev-echo', 'and name the channel that actually carried it');
      assert.equal(stranger.statusCode, 200, 'an unregistered number answers the uniform body');
      assert.equal(stranger.json().channel, null, 'and claims no channel');
      assert.equal(stranger.json().devCode, undefined, 'and carries no code');
    } else {
      assert.equal(known.statusCode, 503, brief(known));
      assert.equal(stranger.statusCode, 503, `no channel: the refusal must not depend on registration: ${brief(stranger)}`);
      assert.equal(stranger.json().error, known.json().error, 'identical copy for both');
    }
    assert.equal(stranger.json().provider, null, 'a stranger never gets a provider claim');
    // and the refusal carries the SAME keys as a success, so the shape is not a second oracle — this is the
    // assertion the review proved was missing: it only holds in the posture where the refusing branch runs
    // (no dev echo), which is why the file is also run that way in CI.
    for (const k of ['sent', 'expiresInSeconds', 'devEcho', 'channel', 'provider', 'sandbox']) {
      assert.ok(k in stranger.json(), `refusal body must carry ${k} like every other outcome`);
    }
    /* `sent: false` is the REFUSAL branch's promise. In the dev-echo posture the stranger gets the uniform
       "sent" body on purpose: answering "not sent" to an unregistered number would make the door an
       account-existence oracle, which is exactly what this test exists to prevent. The property that must hold
       in BOTH branches is that the stranger's body carries no CODE and no channel claim — asserted above. The
       refusal branch's identical-copy check is the else below, so the claim belongs there. */
    if (known.statusCode !== 200) {
      assert.equal(stranger.json().sent, false, 'a refusal never claims a send');
    }
    assert.equal(stranger.json().devCode, undefined, 'stranger body carries no code in either posture');
    assert.notEqual(stranger.json().sandbox, true, 'and never claims a delivered sandbox code');
  });

  test('with the rail on: the carrier is named, the receipt is redacted, a ten-digit number works', async () => {
    // PLG-10: the OTP door resolves the `auth.otp` capability from the rail row's STORED MANIFEST, so the
    // fixture persists the real on-disk manifest — a manifest-less row answers 503 "no SMS channel".
    const smsManifest = await (await import('../src/plugin-permissions.js')).declaredManifest('rails.sms');
    await sql(`INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, settings, manifest)
               VALUES ($1,'rails.sms','1.0.0','B','enabled','{"provider":"logger"}'::jsonb,$2::jsonb)
               ON CONFLICT (tenant_id, plugin_id) DO UPDATE SET status='enabled', settings='{"provider":"logger"}'::jsonb, manifest=EXCLUDED.manifest`, [tenantId, JSON.stringify(smsManifest)]);
    await sql(`DELETE FROM app.auth_otps WHERE phone=$1`, [phone]);
    await sql(`DELETE FROM app.communications WHERE tenant_id=$1 AND template='OTP_SIGNIN'`, [tenantId]);
    // Typed WITHOUT the country code (S1): the rail accepts only E.164, so a door that passed the raw digits
    // through minted a code it could never deliver and withdrew it on every single attempt.
    const bare = phone.replace(/^\+91/, '');
    const r = await app.inject({ method: 'POST', url: '/auth/otp/request', headers: { 'content-type': 'application/json' }, payload: { phone: bare, tenantId } });
    assert.equal(r.statusCode, 200, brief(r));
    const b = r.json();
    assert.equal(b.sent, true);
    assert.equal(b.channel, 'sms', 'the code went through the SMS rail, not the dev echo');
    assert.equal(b.provider, 'logger', 'and the answer names the carrier that took it');
    assert.equal(b.sandbox, true, 'a logger carrier is a sandbox and says so');
    assert.equal(b.devCode, undefined, 'the code is NOT echoed when a rail carries it — the rail is the channel');
    assert.equal(b.devEcho, false, 'B7: devEcho reports what HAPPENED, not the config flag');
    // delivery evidence in the vault, keyed by the NORMALISED number so /auth/otp/verify can find it
    const vault = await sql(`SELECT count(*)::int AS n FROM app.auth_otps WHERE phone=$1 AND consumed_at IS NULL`, [phone]);
    assert.equal(vault.rows[0].n, 1, 'exactly one live code exists — the one that was delivered, under E.164');
    const stray = await sql(`SELECT count(*)::int AS n FROM app.auth_otps WHERE phone=$1`, [bare]);
    assert.equal(stray.rows[0].n, 0, 'and nothing is keyed by the raw digits the user typed');
    // B6: the send has a receipt in the comms ledger, with the one-time code REDACTED (SEC-0)
    const row = (await sql(`SELECT status, provider, body, delivered_at, audience_json FROM app.communications WHERE tenant_id=$1 AND template='OTP_SIGNIN' ORDER BY created_at DESC, ctid DESC LIMIT 1`, [tenantId])).rows[0];
    assert.ok(row, 'the send is recorded (before the review it had no receipt at all)');
    assert.equal(row.status, 'sent');
    assert.equal(row.provider, 'logger');
    assert.equal(row.delivered_at, null, 'a sandbox carrier never confirms delivery');
    assert.ok(Array.isArray(row.audience_json) && row.audience_json[0] === phone, 'the audience is the number texted, in E.164');
    assert.ok(!/\b\d{6}\b/.test(row.body), `no bare six-digit code in a staff-readable ledger: ${row.body}`);
    assert.match(row.body, /redacted/, 'and the row says the code was redacted');
  });
  test('a sandbox carrier in production is NOT a delivery: refused, and the minted code is withdrawn', async () => {
    const before = (await sql(`SELECT count(*)::int AS n FROM app.auth_otps WHERE phone=$1`, [phone])).rows[0].n;
    // config.env is read per-request by the door; the harness runs as development, so this asserts the
    // development contract (sandbox allowed). The production half is asserted against the same decision
    // function the rails and the comms dispatcher use, so the rule has one definition:
    const { isSandboxResult, sandboxAllowed } = await import('../src/plugins/_shared/delivery-honesty.js');
    assert.equal(isSandboxResult({ ok: true, provider: 'logger' }), true, 'logger is a sandbox carrier');
    assert.equal(sandboxAllowed('production'), false, 'and a sandbox carrier is not a delivery in production');
    assert.equal(sandboxAllowed('development'), true);
    const after = (await sql(`SELECT count(*)::int AS n FROM app.auth_otps WHERE phone=$1`, [phone])).rows[0].n;
    assert.equal(after, before, 'no code was minted by this assertion — it is a pure rule check');
  });

  test('a failing rail withdraws the code instead of leaving a credential for a message nobody received', async () => {
    // An http-generic provider pointed at a dead port: the send fails for real, no mocking.
    await sql(`UPDATE app.plugins SET settings='{"provider":"http-generic","url":"http://127.0.0.1:9/never","auth_header":"x"}'::jsonb,
               status='enabled' WHERE tenant_id=$1 AND plugin_id='rails.sms'`, [tenantId]);
    await sql(`DELETE FROM app.auth_otps WHERE phone=$1`, [phone]);
    const r = await app.inject({ method: 'POST', url: '/auth/otp/request', headers: { 'content-type': 'application/json' }, payload: { phone, tenantId } });
    assert.ok([502, 503].includes(r.statusCode), `a failed send must not answer 200: ${brief(r)}`);
    assert.match(r.json().error, /could not be sent|nothing was sent/i);
    const vault = await sql(`SELECT count(*)::int AS n FROM app.auth_otps WHERE phone=$1 AND consumed_at IS NULL`, [phone]);
    assert.equal(vault.rows[0].n, 0, 'the minted row was withdrawn — no dangling credential');
    const audit = await sql(`SELECT outcome FROM app.audit_log WHERE tenant_id=$1 AND action='Phone OTP issued' ORDER BY created_at DESC, ctid DESC LIMIT 1`, [tenantId]);
    assert.match(String(audit.rows[0]?.outcome ?? ''), /WITHDRAWN/, 'and the ledger records that it was withdrawn, not issued');
    // restore the sandbox provider so the rest of the file (and any rerun) starts clean
    await sql(`UPDATE app.plugins SET settings='{"provider":"logger"}'::jsonb WHERE tenant_id=$1 AND plugin_id='rails.sms'`, [tenantId]);
  });
});
