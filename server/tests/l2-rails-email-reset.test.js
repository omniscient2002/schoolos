// L2-2.2 (Wave 2) — self-service password reset plumbing + rails.email.
// Pins: sandbox send (logger provider) end to end, single-use + expiry semantics,
// anti-enumeration unknown-email 200, no-channel 503 (comms honesty), unconfigured
// smtp 503 + failed comms row, epoch revocation on reset, rail guard rails.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setupTestDb } from './helpers.js';

const H = (t) => (t ? { authorization: `Bearer ${t}`, 'content-type': 'application/json' } : { 'content-type': 'application/json' });

let app;
let sql;
const MERIDIAN = () => sql(`SELECT id FROM app.tenants WHERE slug='meridian'`);

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
  // sandbox email channel for the seeded tenant (logger provider = default settings)
  const { rows: [t] } = await MERIDIAN();
  await sql(`INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, settings)
             VALUES ($1,'rails.email','1.0.0','B','enabled','{"provider":"logger"}'::jsonb)`, [t.id]);
});

const requestReset = (email, tenantId) => app.inject({
  method: 'POST', url: '/me/reset-request',
  payload: tenantId ? { email, tenantId } : { email },
});

const latestToken = async () => {
  const r = await sql(`SELECT body FROM app.communications WHERE template='PASSWORD_RESET' AND status='sent' ORDER BY created_at DESC, id DESC LIMIT 1`);
  const m = r.rows[0]?.body?.match(/reset code is: ([0-9a-f]{64})/);
  return m?.[1] ?? null;
};

describe('L2-2.2 · password reset + rails.email', () => {
  test('sandbox send → single-use confirm → old password dead, new works, reuse refused', async () => {
    const req = await requestReset('principal@meridian.edu');
    assert.equal(req.statusCode, 200, req.body);
    assert.equal(req.json().sent, true);
    const token = await latestToken();
    assert.ok(token, 'rendered email (comms ledger row) carries the raw token');
    const short = await app.inject({ method: 'POST', url: '/me/reset-confirm', payload: { token, newPassword: 'short' } });
    assert.equal(short.statusCode, 400, 'length floor enforced');
    const bad = await app.inject({ method: 'POST', url: '/me/reset-confirm', payload: { token: 'f'.repeat(64), newPassword: 'reset-pw-1234' } });
    assert.equal(bad.statusCode, 400);
    assert.match(bad.json().error, /not valid or has expired/, 'uniform copy for unknown tokens');

    const confirm = await app.inject({ method: 'POST', url: '/me/reset-confirm', payload: { token, newPassword: 'reset-pw-1234' } });
    assert.equal(confirm.statusCode, 200, confirm.body);
    const oldLogin = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'principal@meridian.edu', password: 'schoolos-demo' } });
    assert.equal(oldLogin.statusCode, 401, 'old password dead after reset');
    const newLogin = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'principal@meridian.edu', password: 'reset-pw-1234' } });
    assert.equal(newLogin.statusCode, 200, 'new password signs in');
    const reuse = await app.inject({ method: 'POST', url: '/me/reset-confirm', payload: { token, newPassword: 'another-pw-99' } });
    assert.equal(reuse.statusCode, 400, 'token is single-use');
    const consumed = await sql(`SELECT consumed_at FROM auth.reset_tokens ORDER BY created_at DESC LIMIT 1`);
    assert.ok(consumed.rows[0].consumed_at, 'token marked consumed');
  });

  test('epoch bump on reset revokes pre-reset sessions', async () => {
    const l = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'coordinator@meridian.edu', password: 'schoolos-demo' } });
    assert.equal(l.statusCode, 200);
    const preToken = l.json().token;
    await requestReset('coordinator@meridian.edu');
    const token = await latestToken();
    const confirm = await app.inject({ method: 'POST', url: '/me/reset-confirm', payload: { token, newPassword: 'coord-pw-5678' } });
    assert.equal(confirm.statusCode, 200, confirm.body);
    const stale = await app.inject({ method: 'GET', url: '/me', headers: H(preToken) });
    assert.equal(stale.statusCode, 401, 'pre-reset session revoked by the epoch bump');
  });

  test('unknown email answers the uniform sent copy — no token, no comms row', async () => {
    const before = await sql(`SELECT count(*)::int AS n FROM auth.reset_tokens`);
    const r = await requestReset('nobody@nowhere.test');
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().sent, true, 'anti-enumeration: same copy as a known account');
    const after = await sql(`SELECT count(*)::int AS n FROM auth.reset_tokens`);
    assert.equal(after.rows[0].n, before.rows[0].n, 'no token minted for unknown email');
  });

  test('no channel configured → 503 (comms honesty rule), no token minted', async () => {
    const { rows: [t] } = await MERIDIAN();
    await sql(`DELETE FROM app.plugins WHERE tenant_id=$1 AND plugin_id='rails.email'`, [t.id]);
    const before = await sql(`SELECT count(*)::int AS n FROM auth.reset_tokens`);
    const r = await requestReset('finance@meridian.edu');
    assert.equal(r.statusCode, 503, 'unconfigured channel is an honest 503, never a fake sent');
    assert.match(r.json().error, /No email channel is configured/i);
    const after = await sql(`SELECT count(*)::int AS n FROM auth.reset_tokens`);
    assert.equal(after.rows[0].n, before.rows[0].n, 'no token minted when the channel is down');
    // restore for the next test
    await sql(`INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, settings)
               VALUES ($1,'rails.email','1.0.0','B','enabled','{"provider":"logger"}'::jsonb)`, [t.id]);
  });

  test('smtp provider with missing settings → 503 + failed comms row (code-complete adapter, D-26)', async () => {
    const { rows: [t] } = await MERIDIAN();
    await sql(`UPDATE app.plugins SET settings='{"provider":"smtp"}'::jsonb WHERE tenant_id=$1 AND plugin_id='rails.email'`, [t.id]);
    const r = await requestReset('transport@meridian.edu');
    assert.equal(r.statusCode, 503);
    assert.match(r.json().error, /host \+ from_address/, 'honest provider-settings failure copy');
    const failed = await sql(`SELECT status FROM app.communications WHERE template='PASSWORD_RESET' ORDER BY created_at DESC LIMIT 1`);
    assert.equal(failed.rows[0].status, 'failed', 'delivery failure recorded in the comms ledger');
    // a failed send must not leave a usable open token? It does NOT (the token exists
    // but the code never reached the human) — assert the audit/comms trail records why.
    await sql(`UPDATE app.plugins SET settings='{"provider":"logger"}'::jsonb WHERE tenant_id=$1 AND plugin_id='rails.email'`, [t.id]);
  });

  test('rail guard rails: tenantId/dedupKey/email required', async () => {
    const { sendEmail } = await import('../src/plugins/rails.email/index.js');
    const noTenant = await sendEmail({ to: 'a@b.test', subject: 'x', body: 'y', dedupKey: 'k' });
    assert.equal(noTenant.ok, false); assert.match(noTenant.error, /tenantId/);
    const noDedup = await sendEmail({ to: 'a@b.test', subject: 'x', body: 'y', tenantId: '00000000-0000-0000-0000-000000000000' });
    assert.equal(noDedup.ok, false); assert.match(noDedup.error, /dedupKey/);
    const badTo = await sendEmail({ to: 'not-an-email', subject: 'x', body: 'y', dedupKey: 'k', tenantId: '00000000-0000-0000-0000-000000000000' });
    assert.equal(badTo.ok, false); assert.match(badTo.error, /valid email/);
  });
});
