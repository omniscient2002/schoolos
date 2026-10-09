// Fix batch 1 — honest-flags regressions (docs/HONEST-FLAGS.md F-09, F-15, F-19).
// Pins: TOTP verification is constant-time; POST /ai/call writes an audit row
// (it was the only mutating door without one); auth audit rows carry the caller IP
// (migration 148 overload of app.audit_append).
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setupTestDb } from './helpers.js';
import { totpAt, generateSecret, verifyTotpStep, constantTimeEqual } from '../src/totp.js';

let app;
let sql;

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
});

const login = async (email, password) => app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
const tenantOf = async (email) => (await sql(`SELECT tenant_id FROM app.users WHERE email=$1`, [email])).rows[0].tenant_id;

describe('F-09 · TOTP verification is constant-time', () => {
  test('constantTimeEqual: equal → true, length mismatch → false, near-miss → false', () => {
    assert.equal(constantTimeEqual('123456', '123456'), true);
    assert.equal(constantTimeEqual('123456', '12345'), false);
    assert.equal(constantTimeEqual('123456', '123457'), false);
  });
  test('verifyTotpStep accepts the current code and rejects a wrong one', () => {
    const secret = generateSecret();
    const step = Math.floor(Date.now() / 1000 / 30);
    const code = totpAt(secret, step);
    assert.notEqual(verifyTotpStep(secret, code), null);
    assert.equal(verifyTotpStep(secret, '000000'), null);
    assert.equal(verifyTotpStep(secret, 'not-a-code'), null);
  });
});

describe('F-15 · POST /ai/call writes an audit row', () => {
  test('staff AI call → ai_calls ledger row AND audit row', async () => {
    const l = await login('principal@meridian.edu', 'schoolos-demo');
    assert.equal(l.statusCode, 200, l.body);
    const token = l.json().token;
    const tenant = await tenantOf('principal@meridian.edu');
    const call = await app.inject({ method: 'POST', url: '/ai/call',
      payload: { pluginId: 'teacher.copilot', purpose: 'test-audit', input: 'hello' },
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
    assert.equal(call.statusCode, 200, call.body);
    const ledger = await sql(`SELECT outcome FROM app.ai_calls WHERE tenant_id=$1 AND plugin_id='teacher.copilot' ORDER BY created_at DESC LIMIT 1`, [tenant]);
    assert.equal(ledger.rows[0]?.outcome, 'ok');
    const audit = await sql(`SELECT action, record_ref FROM app.audit_log WHERE tenant_id=$1 AND action LIKE 'AI call%' ORDER BY created_at DESC LIMIT 1`, [tenant]);
    assert.match(audit.rows[0]?.action ?? '', /^AI call \(ok\)/);
    assert.match(audit.rows[0]?.record_ref ?? '', /teacher\.copilot/);
  });
});

describe('F-19 · auth audit rows carry the caller IP', () => {
  test('login audit row has a non-null ip', async () => {
    const l = await login('principal@meridian.edu', 'schoolos-demo');
    assert.equal(l.statusCode, 200, l.body);
    const tenant = await tenantOf('principal@meridian.edu');
    const row = await sql(`SELECT ip, action FROM app.audit_log WHERE tenant_id=$1 AND action LIKE 'Signed in%' ORDER BY created_at DESC LIMIT 1`, [tenant]);
    assert.ok(row.rows[0], 'expected a sign-in audit row');
    assert.ok(row.rows[0].ip != null, `expected ip to be populated, got ${row.rows[0].ip}`);
  });
});
