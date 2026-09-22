// J7 · every declared `billing.metered` counter is actually incremented.
//
// The manifests declared `positions_ingested` (transport.gps), `messages_sent` (the rails) and
// `messages_delivered` (comms.whatsapp) while nothing counted them, so "usage-metered" was a label with
// no number behind it. This pins the two seams that were missing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setupTestDb, loginAs } from './helpers.js';

let app;
let pool;
let owner;
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.ready();
  pool = (await import('../src/db.js')).pool;
  owner = await loginAs(app, 'owner@meridian.edu');
  await app.inject({ method: 'POST', url: '/plugins/transport.gps/enable', headers: H(owner.token), payload: { version: '1.0.0', class: 'B' } });
});
after(async () => { await app?.close(); });

test('J7 · transport.gps meters positions_ingested on each ingest', async () => {
  const route = (await pool.query(`SELECT code FROM app.routes LIMIT 1`)).rows[0];
  assert.ok(route, 'a seeded route exists');
  const r = await app.inject({ method: 'POST', url: '/plugins/transport.gps/positions', headers: H(owner.token),
    payload: { routeCode: route.code, lat: 12.93, lng: 77.62, delayMins: 3 } });
  assert.equal(r.statusCode, 200, r.body);
  const tenantId = (await app.inject({ method: 'GET', url: '/me', headers: H(owner.token) })).json().tenantId;
  const u = (await pool.query(`SELECT count FROM app.plugin_usage WHERE tenant_id=$1 AND plugin_id='transport.gps' AND metric='positions_ingested'`, [tenantId])).rows[0];
  assert.ok(u && Number(u.count) >= 1, 'transport.gps positions_ingested is metered');
});

test('J7 · a delivered message meters the rail (messages_sent) and comms.whatsapp (messages_delivered)', async () => {
  const tenantId = (await pool.query(`SELECT id FROM app.tenants ORDER BY created_at LIMIT 1`)).rows[0].id;
  // a sandbox SMS rail so the dispatcher can deliver without a carrier
  await pool.query(`INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, settings)
                    VALUES ($1,'rails.sms','1.0.0','B','enabled','{"provider":"logger"}'::jsonb)
                    ON CONFLICT (tenant_id, plugin_id) DO UPDATE SET settings='{"provider":"logger"}'::jsonb`, [tenantId]);
  const row = (await pool.query(
    `INSERT INTO app.communications (tenant_id, audience_kind, audience_json, channel, template, body, status, dedup_key, attempts)
     VALUES ($1,'guardian','["+919845000099"]'::jsonb,'sms','J7','meter probe','queued',$2,0)
     RETURNING id, tenant_id, channel, template, body, audience_json, dedup_key, attempts`,
    [tenantId, `j7_${Math.random().toString(36).slice(2)}`])).rows[0];
  const dispatch = await import('../scripts/comms-dispatcher.js');
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    const res = await dispatch.processClaimedRow(c, row, { allowSandbox: true });
    await c.query('COMMIT');
    assert.equal(res.outcome, 'sent', JSON.stringify(res));
  } finally { await c.end(); }
  const u = (await pool.query(`SELECT count FROM app.plugin_usage WHERE tenant_id=$1 AND plugin_id='rails.sms' AND metric='messages_sent'`, [tenantId])).rows[0];
  assert.ok(u && Number(u.count) >= 1, 'rails.sms messages_sent is metered');
});
