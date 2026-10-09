// L1 · "configured" must mean "delivers somewhere other than the log".
//
// The rails default to `provider: 'logger'` — they write a structured line and answer ok, which is
// right for a sandbox and useless for a school. `/capabilities` reported `configured = true` whenever
// the rail was merely ENABLED, so the services board showed a green "SMS · Connected · provider:
// logger" over a school whose absence notices, dunning reminders and fee receipts were going
// nowhere. Same defect class as Reception's "Desk online" badge (T1–T11), different screen.
//
// This pins the state machine the board now renders:
//   provider unset or 'logger' → configured false, sandbox true   (accepts, sends nothing)
//   a real provider named       → configured true,  sandbox false  (delivers)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';
import pg from 'pg';

let app, sql, owner, tenantId;
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
  owner = (await loginAs(app, 'owner@meridian.edu')).token;
  tenantId = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  /* both rails on, both left on their default provider — the exact state that used to read
     "Connected" */
  await sql(`UPDATE app.plugins SET status='enabled' WHERE tenant_id=$1 AND plugin_id IN ('rails.sms','rails.email','comms.whatsapp')`, [tenantId]);
});

after(async () => {
  await sql(`UPDATE app.plugins SET status='disabled' WHERE tenant_id=$1 AND plugin_id IN ('rails.sms','rails.email','comms.whatsapp')`, [tenantId]).catch(() => {});
  await app?.close();
});

const caps = async () => (await app.inject({ method: 'GET', url: '/capabilities', headers: H(owner) })).json();

describe('L1 · a rail on the logger provider is not "connected"', () => {
  test('an enabled rail with no provider reports sandbox, not connected', async () => {
    const c = await caps();
    assert.equal(c.rails.sms.configured, false, 'nothing is delivered over the logger provider');
    assert.equal(c.rails.sms.sandbox, true, 'and the board is told which state it is in');
    assert.equal(c.rails.whatsapp.configured, false);
    assert.equal(c.rails.whatsapp.sandbox, true);
  });

  test('a rail naming a real provider reports connected', async () => {
    await sql(
      `UPDATE app.plugins SET settings = jsonb_set(COALESCE(settings,'{}'::jsonb), '{provider}', '"http-generic"')
       WHERE tenant_id=$1 AND plugin_id='rails.sms'`, [tenantId]);
    const c = await caps();
    assert.equal(c.rails.sms.configured, true, 'a named provider delivers, so the badge may say so');
    assert.equal(c.rails.sms.provider, 'http-generic');
    assert.equal(c.rails.sms.sandbox, false);
    await sql(`UPDATE app.plugins SET settings = settings - 'provider' WHERE tenant_id=$1 AND plugin_id='rails.sms'`, [tenantId]);
  });

  test('the literal provider name "logger" is treated as sandbox even when set explicitly', async () => {
    await sql(
      `UPDATE app.plugins SET settings = jsonb_set(COALESCE(settings,'{}'::jsonb), '{provider}', '"LOGGER"')
       WHERE tenant_id=$1 AND plugin_id='rails.sms'`, [tenantId]);
    const c = await caps();
    assert.equal(c.rails.sms.configured, false, 'case must not decide whether a message is sent');
    await sql(`UPDATE app.plugins SET settings = settings - 'provider' WHERE tenant_id=$1 AND plugin_id='rails.sms'`, [tenantId]);
  });

  test('the services board does not promise delivery in the sandbox state', async () => {
    const src = await import('node:fs').then(fs => fs.readFileSync(
      new URL('../../app/src/screens/RailsBoard.tsx', import.meta.url), 'utf8'));
    assert.ok(src.includes('Sandbox'), 'the board renders a sandbox state');
    assert.ok(/not sending|logged, not sent/.test(src), 'and says in words that nothing is sent');
  });
});