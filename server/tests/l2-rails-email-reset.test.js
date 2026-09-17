// L2-2.2 (Wave 2) — self-service password reset plumbing + rails.email.
// Pins: sandbox send (logger provider) end to end, single-use + expiry semantics,
// anti-enumeration unknown-email 200, no-channel 503 (comms honesty), unconfigured
// smtp 503 + failed comms row, epoch revocation on reset, rail guard rails.
//
// SEC-0 (PERFECT-100 §5.1): this file previously RECOVERED the raw reset token by
// scraping it out of app.communications.body and asserted that the ledger "carries
// the raw token" — i.e. the suite codified the vulnerability. The token must never
// be persisted (that table is served with SELECT * to six tenant roles), so the
// tests now mint their own token and the ledger assertion is inverted.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import pg from 'pg';
import { setupTestDb } from './helpers.js';

const H = (t) => (t ? { authorization: `Bearer ${t}`, 'content-type': 'application/json' } : { 'content-type': 'application/json' });
// same construction the kernel uses for auth.reset_tokens.token_hash
const sha256hex = (s) => createHash('sha256').update(s).digest('hex');

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
  // idempotent: the seed's plugin catalog already seats `rails.email` for the tenant (OFF), so a blind
  // INSERT collided on (tenant_id, plugin_id) and killed this file's before() hook.
  // PLG-10: the reset door gates on the `auth.password_reset` CAPABILITY read from the row's STORED
  // MANIFEST, so the fixture must persist the real on-disk manifest — a manifest-less row is answered 503.
  const railManifest = await (await import('../src/plugin-permissions.js')).declaredManifest('rails.email');
  await sql(`INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, settings, manifest)
             VALUES ($1,'rails.email','1.0.0','B','enabled','{"provider":"logger"}'::jsonb,$2::jsonb)
             ON CONFLICT (tenant_id, plugin_id) DO UPDATE SET status='enabled', settings='{"provider":"logger"}'::jsonb, manifest=EXCLUDED.manifest`, [t.id, JSON.stringify(railManifest)]);
});

const requestReset = (email, tenantId) => app.inject({
  method: 'POST', url: '/me/reset-request',
  payload: tenantId ? { email, tenantId } : { email },
});

// A test-owned reset token. Deliberately NOT read from the ledger: the ledger must
// never contain one, and the redemption door is exercised on its own semantics.
const mintToken = async (email, minutes = 30) => {
  const u = await sql(`SELECT id, tenant_id FROM app.users WHERE email=$1`, [email]);
  assert.ok(u.rows[0], `mintToken: no such user ${email}`);
  const raw = randomBytes(32).toString('hex');
  await sql(`INSERT INTO auth.reset_tokens (tenant_id, user_id, token_hash, expires_at)
             VALUES ($1,$2,$3, now() + make_interval(mins => $4))`,
    [u.rows[0].tenant_id, u.rows[0].id, sha256hex(raw), minutes]);
  return raw;
};

const latestCommsRow = async () => {
  const r = await sql(`SELECT body, status FROM app.communications
                       WHERE template='PASSWORD_RESET' ORDER BY created_at DESC, id DESC LIMIT 1`);
  return r.rows[0] ?? null;
};

describe('L2-2.2 · password reset + rails.email', () => {
  test('sandbox send → single-use confirm → old password dead, new works, reuse refused', async () => {
    const liveBefore = await sql(`SELECT count(*)::int AS n FROM auth.reset_tokens WHERE consumed_at IS NULL`);
    const req = await requestReset('principal@meridian.edu');
    assert.equal(req.statusCode, 200, req.body);
    assert.equal(req.json().sent, true);

    // ── SEC-0 (PERFECT-100 §5.1) ─────────────────────────────────────────────
    // This block replaces the old assertion that the comms ledger "carries the raw
    // token". A live, single-use owner credential must never be persisted, because
    // GET /communications serves app.communications with SELECT * to six roles.
    // NOTE: assertions ride on THIS test's reset request on purpose — the door is
    // rate-limited to 5/min per IP, so a separate test for it would 429 the file.
    const liveAfter = await sql(`SELECT count(*)::int AS n FROM auth.reset_tokens WHERE consumed_at IS NULL`);
    assert.equal(liveAfter.rows[0].n, liveBefore.rows[0].n + 1, 'a live reset token really was minted');
    const row = await latestCommsRow();
    assert.ok(row, 'a comms row is written as delivery evidence');
    assert.equal(row.status, 'sent');
    assert.doesNotMatch(row.body, /[0-9a-f]{64}/i, 'no raw reset token may persist in app.communications');
    assert.match(row.body, /redacted — delivered by email/, 'the code is explicitly redacted, not silently dropped');
    // ─────────────────────────────────────────────────────────────────────────

    const token = await mintToken('principal@meridian.edu');
    assert.equal(token.length, 64, 'a 64-hex single-use code');
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
    const token = await mintToken('coordinator@meridian.edu');
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
    // PRD-4 rewrote this copy to be actionable (it names the switch: one toggle under Plugins). The assertion
    // keeps asking for the same thing — a refusal that says the channel is off and does not pretend a message
    // was sent — against the wording that now ships.
    assert.match(r.json().error, /no email channel switched on/i);
    const after = await sql(`SELECT count(*)::int AS n FROM auth.reset_tokens`);
    assert.equal(after.rows[0].n, before.rows[0].n, 'no token minted when the channel is down');
    // restore for the next test (with the real manifest, so the capability gate resolves again)
    const railManifest = await (await import('../src/plugin-permissions.js')).declaredManifest('rails.email');
    await sql(`INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, settings, manifest)
               VALUES ($1,'rails.email','1.0.0','B','enabled','{"provider":"logger"}'::jsonb,$2::jsonb)
               ON CONFLICT (tenant_id, plugin_id) DO UPDATE SET status='enabled', settings='{"provider":"logger"}'::jsonb, manifest=EXCLUDED.manifest`, [t.id, JSON.stringify(railManifest)]);
  });

  test('smtp provider with missing settings → 503 + failed comms row (code-complete adapter, D-26)', async () => {
    const { rows: [t] } = await MERIDIAN();
    await sql(`UPDATE app.plugins SET settings='{"provider":"smtp"}'::jsonb WHERE tenant_id=$1 AND plugin_id='rails.email'`, [t.id]);
    const r = await requestReset('transport@meridian.edu');
    assert.equal(r.statusCode, 503);
    assert.match(r.json().error, /host \+ from_address/, 'honest provider-settings failure copy');
    const failed = await sql(`SELECT status, body FROM app.communications WHERE template='PASSWORD_RESET' ORDER BY created_at DESC LIMIT 1`);
    assert.equal(failed.rows[0].status, 'failed', 'delivery failure recorded in the comms ledger');
    // SEC-0 closes the previously-noted-but-unasserted gap here: the FAILURE path
    // persists a body too, so it must be redacted on exactly the same terms as a
    // successful send. A token that never reached a human is still a live credential.
    assert.doesNotMatch(failed.rows[0].body, /[0-9a-f]{64}/i, 'failed sends leak no code either');
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
