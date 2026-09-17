// PRD-13 — the comms ledger must not assert "sent" for a message that reached nobody.
//
// THE MECHANISM, verified in the code rather than assumed. Three things combine:
//   1. `rails.sms`/`rails.email` default `provider` to `'logger'` — not only when no provider is
//      configured, but also when the settings READ FAILS ("degrading to logger provider"), so a
//      transient DB hiccup turns a real carrier into a sandbox one.
//   2. A logger provider returns `{ ok: true, provider: 'logger', ref: 'sms_log_…' }`. It succeeds,
//      because writing a log line did succeed.
//   3. The dispatcher's success path stamped `status='sent', sent_at=now(), last_error=NULL`.
// So the row, the UI and any audit read "sent" while nothing left the building — and SEC-0 already
// put this in writing for the reset door: "sandbox is the permanent default for any tenant without
// SMTP credentials ... so this was never a developer-only state".
//
// WHAT IS *NOT* THE FIX, deliberately. The sandbox tests (`l2-rails-live`, `l2-rails-email-reset`)
// pin the logger path as a legitimate SANDBOX carrier and assert `outcome: 'sent'` on purpose. Making
// the sandbox path fail everywhere would break a deliberate design and prove nothing about
// production. The defect is that PRODUCTION could silently be in sandbox mode, so that is what is
// fixed: a sandbox result is not a delivery when the runtime is production, and it is now also
// MEASURABLE everywhere via schoolos_comms_sandbox_sent.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setupTestDb, loginAs } from './helpers.js';

let app;
let sql;
let tenantId;

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.ready();
  const { pool } = await import('../src/db.js');
  sql = (t, p = []) => pool.query(t, p);
  tenantId = (await sql(`SELECT id FROM app.tenants ORDER BY created_at LIMIT 1`)).rows[0].id;
  // a sandbox rail for this tenant, exactly as the rails tests configure one
  await sql(`INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, settings)
             VALUES ($1,'rails.sms','1.0.0','B','enabled','{"provider":"logger"}'::jsonb)
             ON CONFLICT (tenant_id, plugin_id) DO UPDATE SET settings='{"provider":"logger"}'::jsonb`,
    [tenantId]);
});
after(async () => { await app?.close(); });

const queueRow = async (over = {}) => (await sql(
  `INSERT INTO app.communications (tenant_id, audience_kind, audience_json, channel, template, body, status, dedup_key, attempts)
   VALUES ($1,'guardian',$2::jsonb,$3,'PRD13',$4,'queued',$5,0) RETURNING id, tenant_id, channel, template, body, audience_json, dedup_key, attempts`,
  [tenantId, JSON.stringify(over.audience ?? ['+919845000301']), over.channel ?? 'sms',
    over.body ?? 'ledger honesty probe', `prd13_${Math.random().toString(36).slice(2)}`])).rows[0];

const claim = async (id) => (await sql(
  `SELECT id, tenant_id, channel, template, body, audience_json, dedup_key, attempts
     FROM app.communications WHERE id=$1`, [id])).rows[0];

async function run(row, opts) {
  const dispatch = await import('../scripts/comms-dispatcher.js');
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    const res = await dispatch.processClaimedRow(c, row, opts);
    await c.query('COMMIT');
    return res;
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { await c.end(); }
}

describe('PRD-13: a sandbox carrier must never be recorded as a delivery in production', () => {
  test('in production, "the logger said ok" becomes terminal undeliverable — not sent', async () => {
    const row = await queueRow();
    // allowSandbox:false is the production rule (it defaults to `config.env !== 'production'`); tests
    // cannot flip NODE_ENV because config reads it at import time, so the rule is injectable.
    const res = await run(await claim(row.id), { allowSandbox: false });

    assert.equal(res.outcome, 'undeliverable',
      `THE REGRESSION GATE: a carrier that only writes a log line is not a delivery (got ${JSON.stringify(res)})`);
    assert.equal(res.provider, 'logger');

    const after = (await sql(`SELECT status, sent_at, last_error, provider FROM app.communications WHERE id=$1`, [row.id])).rows[0];
    assert.equal(after.status, 'failed', 'terminal, and never "sent"');
    assert.equal(after.sent_at, null, 'sent_at must stay NULL — nothing was sent, so nothing is timestamped as sent');
    assert.match(after.last_error, /undeliverable — sandbox carrier in production/);
    assert.match(after.last_error, /no message would reach/i, 'the reason names the consequence, not just the state');
    assert.equal(after.provider, 'logger', 'the carrier is still recorded honestly');
  });

  test('the same row in a sandbox still drains as before — the fix is not "break the sandbox"', async () => {
    const row = await queueRow();
    const res = await run(await claim(row.id), { allowSandbox: true });
    // This is the NON-VACUOUS half: it proves the gate discriminates by environment rather than
    // failing every logger send, which is what the existing sandbox tests depend on.
    assert.equal(res.outcome, 'sent', JSON.stringify(res));
    assert.equal(res.provider, 'logger');
    const after = (await sql(`SELECT status, sent_at, provider FROM app.communications WHERE id=$1`, [row.id])).rows[0];
    assert.equal(after.status, 'sent');
    assert.ok(after.sent_at, 'sandbox sends still stamp sent_at (unchanged pre-existing behaviour)');
    assert.equal(after.provider, 'logger', 'and still name the sandbox carrier — the record says WHICH carrier');
  });

  test('the discriminator reads the rails\' own signals: a REAL carrier is never downgraded', async () => {
    const dispatch = await import('../scripts/comms-dispatcher.js');
    // Exact result shapes the rails actually return (read from rails.email/rails.sms/rails.whatsapp).
    const real = [
      { ok: true, provider: 'smtp', sandbox: false, ref: 'smtp_1' },          // rails.email, live SMTP
      { ok: true, provider: 'http-generic', ref: 'x' },                       // rails.sms/whatsapp
      { ok: true, provider: 'cloud-api', ref: 'x' },                          // rails.whatsapp
      { ok: true, provider: 'twilio', ref: 'x' },                             // a provider added later
    ];
    for (const r of real) {
      assert.equal(dispatch.isSandboxResult(r), false,
        `${r.provider} is a real hand-off and must stay "sent" in production (got ${JSON.stringify(r)})`);
    }
    const sandbox = [
      { ok: true, provider: 'logger', sandbox: true, ref: 'email_log_1' },    // rails.email default
      { ok: true, provider: 'logger', ref: 'sms_log_1' },                     // rails.sms default (no sandbox field)
      { ok: true, provider: 'log-only', ref: 'row-id' },                      // dispatcher's own branch
      { ok: true, provider: 'LOGGER', ref: 'x' },                             // case-insensitive
      { ok: true, provider: '', ref: 'x' },                                   // absent provider
    ];
    for (const r of sandbox) {
      assert.equal(dispatch.isSandboxResult(r), true,
        `${JSON.stringify(r)} reached nobody and must not be recorded as sent in production`);
    }
    assert.equal(dispatch.isSandboxCarrier('logger'), true);
    assert.equal(dispatch.isSandboxCarrier('LOGGER'), true);
    assert.equal(dispatch.isSandboxCarrier('smtp'), false);
    // and in THIS runtime (development) the default permits the sandbox, which is why every existing
    // sandbox test still passes untouched.
    assert.notEqual((await import('../src/config.js')).config.env, 'production');
  });
});

describe('PRD-13: the reset door sends directly, so it must honour the same rule', () => {
  test('a sandbox send is "sent" but NEVER "delivered"', async () => {
    // This door needs the raw code in the message (SEC-0 keeps it out of the ledger), so it calls the
    // rail directly and writes its own row — bypassing the dispatcher's gate. It therefore had the
    // strongest form of the same lie: `delivered_at=now()` stamped unconditionally, and `delivered` is
    // a stronger claim than `sent` (the schema separates them; the dispatcher only ever sets sent_at;
    // the whatsapp inbox renders delivered_at).
    await sql(`DELETE FROM app.plugins WHERE tenant_id=$1 AND plugin_id='rails.email'`, [tenantId]);
    // ON CONFLICT because the seed now runs the plugin catalog itself: a `rails.email` row already exists
    // for every seeded tenant (it arrives `registered`/OFF, as a credential must). The blind INSERT this
    // replaces collided with it and took the whole file's `before()` down — caught by the full suite, not by
    // the file in isolation. Setup is idempotent; the assertions below are unchanged.
    //
    // PLG-10: the reset door now gates on the `auth.password_reset` CAPABILITY resolved from the plugin
    // row's STORED MANIFEST (`capabilityEnabled` -> `manifest->'capabilities'`), not on the row merely
    // existing. A hand-written row with no manifest answers 503, so the fixture persists the real on-disk
    // manifest — exactly what the enable door does — or it would be testing the wrong refusal.
    const { declaredManifest } = await import('../src/plugin-permissions.js');
    const railManifest = await declaredManifest('rails.email');
    assert.ok(railManifest?.capabilities?.includes('auth.password_reset'),
      'fixture: rails.email must declare the auth.password_reset capability');
    await sql(`INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, settings, manifest)
               VALUES ($1,'rails.email','1.0.0','B','enabled','{"provider":"logger"}'::jsonb,$2::jsonb)
               ON CONFLICT (tenant_id, plugin_id) DO UPDATE SET status='enabled', settings='{"provider":"logger"}'::jsonb, manifest=EXCLUDED.manifest`,
      [tenantId, JSON.stringify(railManifest)]);

    const r = await app.inject({
      method: 'POST', url: '/me/reset-request',
      headers: { 'content-type': 'application/json' },
      payload: { email: 'coordinator@meridian.edu', tenantId },
    });
    assert.equal(r.statusCode, 200, r.body);

    const row = (await sql(
      `SELECT status, provider, sent_at, delivered_at FROM app.communications
        WHERE channel='email' AND template='PASSWORD_RESET' ORDER BY created_at DESC LIMIT 1`)).rows[0];
    assert.ok(row, 'the reset door writes a row as delivery evidence');
    assert.equal(row.provider, 'logger', 'the sandbox carrier is named honestly');
    assert.equal(row.status, 'sent', 'sandbox semantics are unchanged in a non-production runtime');
    assert.ok(row.sent_at, 'handed to the named (sandbox) provider');
    // THE REGRESSION GATE. Before this fix the door wrote `delivered_at=now()` for every send,
    // including a logger provider that delivered nothing anywhere.
    assert.equal(row.delivered_at, null,
      'a sandbox carrier cannot confirm delivery — delivered_at must stay NULL');
  });

  test('the reset door refuses rather than faking, when the sandbox is not allowed', async () => {
    // The production rule, exercised through the shared decision function the door now uses: a
    // sandbox carrier is not a delivery there, so the door must fail loudly instead of telling the
    // user a code is on its way.
    const { isSandboxResult, sandboxAllowed } = await import('../src/plugins/_shared/delivery-honesty.js');
    const loggerResult = { ok: true, provider: 'logger', sandbox: true, ref: 'email_log_x' };
    assert.equal(isSandboxResult(loggerResult), true);
    assert.equal(sandboxAllowed('production'), false, 'production must not accept a sandbox carrier');
    assert.equal(sandboxAllowed('development'), true, 'and a sandbox runtime still may');
    // a real carrier is unaffected in either runtime — otherwise the fix would break live email
    const realResult = { ok: true, provider: 'smtp', sandbox: false, ref: 'smtp_1' };
    assert.equal(isSandboxResult(realResult), false);
    assert.equal(sandboxAllowed('production'), false);
    assert.equal(isSandboxResult(realResult) && !sandboxAllowed('production'), false,
      'a real SMTP send in production must still count as sent');
  });
});

describe('PRD-13: the sandbox population is MEASURABLE, not merely made honest', () => {
  test('/metrics reports sandbox-sent and failed messages separately', async () => {
    const owner = await loginAs(app, 'owner@meridian.edu');
    const r = await app.inject({ method: 'GET', url: '/metrics', headers: { authorization: `Bearer ${owner.token}` } });
    assert.equal(r.statusCode, 200, r.body);
    // The gauge that makes the old defect visible: rows that read 'sent' but whose carrier was a
    // sandbox. Without it, a school with no provider saw only a queue that drained cleanly.
    const m = /schoolos_comms_sandbox_sent (\d+)/.exec(r.body);
    assert.ok(m, 'schoolos_comms_sandbox_sent must be exported');
    assert.ok(Number(m[1]) >= 1,
      'the rows written by the sandbox test above are "sent" to nobody and must be counted as such');
    assert.match(r.body, /schoolos_comms_failed \d+/);
    assert.match(r.body, /# HELP schoolos_comms_sandbox_sent[\s\S]*reached nobody/);
  });

  test('the gauge is a count of real rows, not a constant', async () => {
    const before = Number(/schoolos_comms_sandbox_sent (\d+)/.exec(
      (await app.inject({ method: 'GET', url: '/metrics', headers: { authorization: `Bearer ${(await loginAs(app, 'owner@meridian.edu')).token}` } })).body)[1]);
    const row = await queueRow();
    await run(await claim(row.id), { allowSandbox: true });
    const after = Number(/schoolos_comms_sandbox_sent (\d+)/.exec(
      (await app.inject({ method: 'GET', url: '/metrics', headers: { authorization: `Bearer ${(await loginAs(app, 'owner@meridian.edu')).token}` } })).body)[1]);
    assert.equal(after, before + 1, 'one more sandbox delivery = one more counted row');
  });
});
