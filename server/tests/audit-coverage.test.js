// DAT-6 — privileged mutations that left no ledger row, or left one that named nothing.
//
// The audit ledger only has value if the things an investigator would ask about are in it. Four of
// these were missing outright, and one recorded an event while withholding the only detail that
// matters:
//
//   1. POST /me/mfa/enroll minted a fresh TOTP secret AND returned it, with no ledger row — while
//      disabling MFA, enabling it and consuming a recovery code were ALL audited. So the one MFA
//      transition that issues a credential was the one nobody could see.
//   2. The phone-OTP vault lifecycle — issue, accept, reject — was entirely unlogged, so the
//      alternative sign-in factor was invisible while password logins were recorded.
//   3. GET /auth/google/callback silently re-points auth_provider to 'google' (i.e. changes HOW an
//      account authenticates) with no row at all.
//   4. POST /plugins/:id/settings is the de-facto credential-rotation path and recorded only
//      "settings saved" — naming no keys, never consulting SECRET_KEY_RE, and flagging nothing.
//
// Two constraints shape every assertion here, and both are properties of the ledger rather than of the
// fix: it is readable by several staff roles through GET /audit, so NO SECRET VALUE MAY EVER APPEAR IN
// IT (the assertion that a returned TOTP secret is absent from the row is as important as the
// assertion that the row exists); and a security ledger that records a routine login at risk:'high'
// trains people to ignore the risk column, so the transition is what gets flagged, not the event.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';

let app;
let sql;
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.ready();
  const { pool } = await import('../src/db.js');
  sql = (text, params = []) => pool.query(text, params);
});
after(async () => { await app?.close(); });

/** The newest ledger row for an action, with every text column concatenated so a secret cannot hide
 *  in a column the assertion forgot to check.
 *
 *  Ordered by created_at then ctid, NOT by id. created_at is truncated to milliseconds by the writer
 *  (migration 075 — required so a hash is reproducible), and the tie-break is a RANDOM uuid, so two
 *  rows written in the same millisecond have an arbitrary `id` order and "the newest row" would
 *  sometimes be the previous one. A physical ctid comparison is a reliable insertion-order proxy here
 *  precisely BECAUSE the ledger is append-only: nothing updates a row, so a later insert always has a
 *  higher ctid. (This bit me once: the low-risk assertion read the previous high-risk row.) */
async function ledgerRow(action) {
  return (await sql(
    `SELECT actor, actor_role, action, record_type, record_ref, risk, outcome, policy_ref, reason,
            COALESCE(actor,'')||' '||COALESCE(actor_role,'')||' '||COALESCE(action,'')||' '||
            COALESCE(record_type,'')||' '||COALESCE(record_ref,'')||' '||COALESCE(reason,'')||' '||
            COALESCE(policy_ref,'')||' '||COALESCE(outcome,'') AS all_text
       FROM app.audit_log WHERE action=$1 ORDER BY created_at DESC, ctid DESC LIMIT 1`, [action])).rows[0];
}
const countRows = async (action) =>
  (await sql(`SELECT count(*)::int n FROM app.audit_log WHERE action=$1`, [action])).rows[0].n;

describe('DAT-6: MFA enrolment is recorded, and the secret never is', () => {
  test('minting a TOTP secret writes a ledger row that does NOT contain the secret', async () => {
    const before = await countRows('MFA enrolment started');
    // a staff account with no MFA (the enrolled ones answer 409 by design)
    const u = (await sql(`SELECT u.id, u.email FROM app.users u
                           WHERE u.role='technician' AND u.active AND u.mfa_enrolled_at IS NULL
                             AND NOT EXISTS (SELECT 1 FROM auth.mfa_secrets m WHERE m.user_id=u.id)
                           LIMIT 1`)).rows[0];
    assert.ok(u, 'fixture: an MFA-free staff account must exist in the seed');
    const { pool } = await import('../src/db.js');
    const row = (await sql(`SELECT id, role, tenant_id, name FROM app.users WHERE id=$1`, [u.id])).rows[0];
    const { randomUUID } = await import('node:crypto');
    const tok = app.jwt.sign({ sub: row.id, role: row.role, tenant: row.tenant_id, name: row.name, jti: randomUUID() });
    void pool;

    const r = await app.inject({ method: 'POST', url: '/me/mfa/enroll', headers: H(tok), payload: { password: 'schoolos-demo' } });
    assert.equal(r.statusCode, 200, `enrolment must still work: ${r.body}`);
    const secret = r.json().secret;
    assert.ok(secret && secret.length >= 16, 'the response carries a real secret');

    const entry = await ledgerRow('MFA enrolment started');
    assert.ok(entry, 'THE REGRESSION GATE: enrolling a factor must leave a ledger row');
    assert.equal(entry.record_type, 'Auth');
    assert.equal(entry.risk, 'high', 'issuing an authentication factor is a high-risk event');
    assert.match(entry.outcome, /INACTIVE/i, 'the ledger must say the factor is not yet active');

    // The ledger is readable by principal/itadmin/finance through GET /audit. A recorded secret would
    // be a working credential handed to every one of them.
    assert.ok(!entry.all_text.includes(secret), 'the TOTP secret must NEVER be written to the ledger');
    // the otpauth URI embeds the secret too — make sure that did not leak either
    assert.ok(!entry.all_text.includes(r.json().otpauth), 'the otpauth URI must not be recorded either');
    assert.equal(await countRows('MFA enrolment started'), before + 1);
  });

  test('a refusal writes no row (the row records an event, not an attempt)', async () => {
    const before = await countRows('MFA enrolment started');
    const owner = await loginAs(app, 'owner@meridian.edu');
    const already = await app.inject({ method: 'POST', url: '/me/mfa/enroll', headers: H(owner.token), payload: { password: 'schoolos-demo' } });
    assert.ok([409, 200].includes(already.statusCode), `unexpected ${already.statusCode}`);
    if (already.statusCode === 409) {
      assert.equal(await countRows('MFA enrolment started'), before, 'a 409 must not fabricate a ledger row');
    }
  });
});

describe('DAT-6: the phone-OTP vault lifecycle is recorded', () => {
  const phone = '+919000000123';

  test('issue, reject and accept each leave a row — and no row contains the code', async () => {
    // fixture: a staff account reachable by phone
    const u = (await sql(`SELECT id, tenant_id, name, role FROM app.users WHERE email='coordinator@meridian.edu'`)).rows[0];
    assert.ok(u, 'fixture: coordinator exists');
    await sql(`UPDATE app.users SET phone=$2 WHERE id=$1`, [u.id, phone]);
    await sql(`DELETE FROM app.auth_otps WHERE phone=$1`, [phone]);
    // OPS-5: the door no longer reports `sent:true` when no channel can carry the code, so a test that wants
    // a code ISSUED must configure the channel first — exactly what a school does (one switch in the plugin
    // manager). Without this the door answers 503 and this gate would be asserting the wrong thing.
    await sql(`INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, settings)
               VALUES ($1,'rails.sms','1.0.0','B','enabled','{"provider":"logger"}'::jsonb)
               ON CONFLICT (tenant_id, plugin_id) DO UPDATE SET status='enabled', settings='{"provider":"logger"}'::jsonb`, [u.tenant_id]);

    const issued = await app.inject({ method: 'POST', url: '/auth/otp/request', headers: { 'content-type': 'application/json' }, payload: { phone } });
    assert.equal(issued.statusCode, 200, issued.body);
    const issueRow = await ledgerRow('Phone OTP issued');
    assert.ok(issueRow, 'THE REGRESSION GATE: issuing a one-time code must be recorded');
    assert.equal(issueRow.record_type, 'Auth');
    assert.match(issueRow.record_ref, /123$/, 'the reference keeps only the last four digits (no full phone number in the ledger)');
    assert.ok(!issueRow.all_text.includes(phone), 'the FULL phone number must not be written to the ledger');

    // wrong code → a rejected attempt and its own row
    const bad = await app.inject({ method: 'POST', url: '/auth/otp/verify', headers: { 'content-type': 'application/json' }, payload: { phone, code: '000000' } });
    assert.equal(bad.statusCode, 401);
    const rejectRow = await ledgerRow('Phone OTP rejected');
    assert.ok(rejectRow, 'a failed factor attempt is a security event and must be recorded');
    assert.match(rejectRow.outcome, /attempt 1 of/i, 'the ledger must say which attempt this was');

    // the real code → an accepted sign-in. Read it from the vault the same way the app does.
    const { devCode } = issued.json();
    let code = devCode;
    if (!code) {
      // OTP_DEV_ECHO is off: drive the accept path by planting a known code instead
      const { randomBytes, scryptSync } = await import('node:crypto');
      code = '246813';
      const salt = randomBytes(16).toString('hex');
      await sql(`UPDATE app.auth_otps SET code_hash=$2, attempts=0 WHERE phone=$1 AND consumed_at IS NULL`,
        [phone, `${salt}:${scryptSync(code, salt, 64).toString('hex')}`]);
    }
    const ok = await app.inject({ method: 'POST', url: '/auth/otp/verify', headers: { 'content-type': 'application/json' }, payload: { phone, code } });
    assert.equal(ok.statusCode, 200, `the correct code must sign in: ${ok.body}`);
    const acceptRow = await ledgerRow('Phone OTP accepted');
    assert.ok(acceptRow, 'a session issued on the phone factor must be recorded');
    assert.equal(acceptRow.risk, 'high', 'a completed alternative-factor login is high risk');
    assert.match(acceptRow.outcome, /session was issued/i);

    for (const action of ['Phone OTP issued', 'Phone OTP rejected', 'Phone OTP accepted']) {
      const entry = await ledgerRow(action);
      assert.ok(!entry.all_text.includes(code), `the one-time code must never appear in "${action}"`);
    }
  });

  test('the failure response is still uniform — adding logging must not add an oracle', async () => {
    // The whole point of the vault's single DENIED copy is that a caller learns nothing. A careless
    // audit implementation can leak through error text; this pins that it did not.
    await sql(`DELETE FROM app.auth_otps WHERE phone=$1`, [phone]);
    const noOtp = await app.inject({ method: 'POST', url: '/auth/otp/verify', headers: { 'content-type': 'application/json' }, payload: { phone, code: '111111' } });
    const unknownPhone = await app.inject({ method: 'POST', url: '/auth/otp/verify', headers: { 'content-type': 'application/json' }, payload: { phone: '+919000000999', code: '111111' } });
    assert.equal(noOtp.statusCode, unknownPhone.statusCode);
    assert.equal(noOtp.body, unknownPhone.body, 'a known phone with no live OTP must be indistinguishable from an unknown phone');
  });
});

describe('DAT-6: plugin settings writes name the keys, and flag credential rotation', () => {
  test('a SECRET-class change is recorded by key name, at high risk, with no value', async () => {
    const { ensurePluginCatalog } = await import('../src/plugin-catalog.js');
    const { pool } = await import('../src/db.js');
    const T = (await sql(`SELECT id FROM app.tenants ORDER BY created_at LIMIT 1`)).rows[0].id;
    await ensurePluginCatalog({ query: (t, p) => pool.query(t, p) }, T);
    const owner = await loginAs(app, 'owner@meridian.edu');
    const SECRET = 'CANARY-ROTATION-VALUE-7731';

    const r = await app.inject({
      method: 'POST', url: '/plugins/payments.razorpay/settings', headers: H(owner.token),
      payload: { key_id: 'rzp_test_SECRET6', key_secret: SECRET, webhook_freshness_mins: 20 },
    });
    assert.equal(r.statusCode, 200, r.body);

    const entry = await ledgerRow('Plugin settings updated: payments.razorpay');
    assert.ok(entry, 'the settings write must be recorded');
    // THE REGRESSION GATE: the old row said only "settings saved", so a rotated rail secret was
    // invisible. The key NAMES must now be present.
    assert.match(entry.outcome, /key_secret/, 'a secret-class change must name the changed key');
    assert.match(entry.outcome, /webhook_freshness_mins/, 'and the ordinary keys too');
    assert.equal(entry.risk, 'high', 'rotating a credential is a high-risk event, not a routine save');
    assert.match(entry.outcome, /SECRET-CLASS/);
    assert.match(entry.policy_ref ?? '', /credential rotation/i, 'the row must point at the rotation policy');
    // and the VALUE must not be anywhere in the row — this ledger is readable by several staff roles
    assert.ok(!entry.all_text.includes(SECRET), 'a settings VALUE must never be written to the ledger');
  });

  test('an ordinary settings edit is recorded at low risk, so "high" keeps its meaning', async () => {
    const owner = await loginAs(app, 'owner@meridian.edu');
    // Prime a known baseline first, so this test is independent of the one above (and works under
    // --test-name-pattern). The assertion is about the diff of the NEXT write.
    const base = await app.inject({
      method: 'POST', url: '/plugins/payments.razorpay/settings', headers: H(owner.token),
      payload: { key_id: 'rzp_test_SECRET6', key_secret: 'CANARY-ROTATION-VALUE-7731', webhook_freshness_mins: 20 },
    });
    assert.equal(base.statusCode, 200, base.body);
    const r = await app.inject({
      method: 'POST', url: '/plugins/payments.razorpay/settings', headers: H(owner.token),
      payload: { key_id: 'rzp_test_SECRET6', key_secret: 'CANARY-ROTATION-VALUE-7731', webhook_freshness_mins: 25 },
    });
    assert.equal(r.statusCode, 200, r.body);
    const entry = await ledgerRow('Plugin settings updated: payments.razorpay');
    assert.equal(entry.risk, 'low', 'changing one non-secret value must not be flagged as a rotation');
    assert.match(entry.outcome, /webhook_freshness_mins/);
    assert.doesNotMatch(entry.outcome, /SECRET-CLASS/);
  });

  test('the response carries only the NEW settings, never the previous ones', async () => {
    // The key-name diff has to READ the previous row, so the guard is that the previous row never
    // travels back to the client — the response is rendered by the settings screen.
    //
    // Asserting merely that a field named `prev_settings` is absent would have become VACUOUS the
    // moment that field stopped existing (it did: the diff now reads the old row in a separate locked
    // statement). So this primes a key we then REMOVE and proves the retired value cannot appear in the
    // response — an assertion that still fails if the old row is ever returned.
    //
    // SEC-6 UPDATE (2026-09-14): this used to prime with an invented key, `retired_setting`, which the
    // settings door no longer accepts — undeclared keys are now a 400 rather than silently persisted, which
    // is the whole point of SEC-6. The retire-a-key property is still tested exactly as before, using a key
    // the module DOES declare (`webhook_secret`) and a value that exists only in the first write. Nothing
    // about this assertion was weakened: it still fails if the previous row travels to the client, and it
    // now fails for a reason the door would actually permit.
    const owner = await loginAs(app, 'owner@meridian.edu');
    const primed = await app.inject({
      method: 'POST', url: '/plugins/payments.razorpay/settings', headers: H(owner.token),
      payload: { key_id: 'rzp_test_SECRET6', key_secret: 'CANARY-ROTATION-VALUE-7731', webhook_secret: 'MUST-NOT-ECHO' },
    });
    assert.equal(primed.statusCode, 200, primed.body);

    const r = await app.inject({
      method: 'POST', url: '/plugins/payments.razorpay/settings', headers: H(owner.token),
      payload: { key_id: 'rzp_test_SECRET6', key_secret: 'CANARY-ROTATION-VALUE-7731', webhook_freshness_mins: 30 },
    });
    assert.equal(r.statusCode, 200, r.body);
    const plugin = r.json().plugin;
    assert.ok(!('prev_settings' in plugin), 'no captured-old-row field may travel to the client');
    assert.ok(!r.body.includes('MUST-NOT-ECHO'),
      'a value that existed ONLY in the previous settings appeared in the response — the previous row leaked');
    assert.equal(plugin.settings.webhook_secret, undefined,
      'the response must reflect the new settings only — the retired key is absent, not carried over');
    assert.equal(plugin.settings.webhook_freshness_mins, 30);
  });
});
