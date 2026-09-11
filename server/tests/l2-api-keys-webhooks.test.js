// L2-4.1 (Wave 4) — scoped API keys + outbound signed webhooks.
// Pins: raw key shown once + hash-only storage, X-API-Key read-only scoped
// default-deny doors, revoke kills at next use, webhook delivery signed with
// HMAC (t + '.' + body), at-least-once dedup, retry→parked semantics.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';
import { setupTestDb, loginAs } from './helpers.js';

let app;
let sql;
let receiver;
let received = [];

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
  receiver = http.createServer((req, res) => {
    let body = '';
    req.on('data', (ch) => { body += ch; });
    req.on('end', () => {
      received.push({ url: req.url, headers: req.headers, body });
      if (req.url === '/flaky') { res.statusCode = 500; res.end('no'); } else { res.statusCode = 200; res.end('ok'); }
    });
  });
  await new Promise((r) => receiver.listen(0, '127.0.0.1', r));
});

after(async () => { receiver.close(); });

const T = () => sql(`SELECT id FROM app.tenants WHERE slug='meridian'`).then((r) => r.rows[0].id);

describe('L2-4.1 · scoped API keys', () => {
  let rawKey;
  let keyId;

  test('create: raw shown once, hash stored, scopes respected', async () => {
    const o = await loginAs(app, 'owner@meridian.edu');
    const r = await app.inject({ method: 'POST', url: '/api-keys', payload: { name: 'read-only integrator', scopes: ['core.read'] }, headers: { authorization: `Bearer ${o.token}`, 'content-type': 'application/json' } });
    assert.equal(r.statusCode, 200, r.body);
    rawKey = r.json().key;
    keyId = r.json().id;
    assert.match(rawKey, /^sk_[0-9a-f]{48}$/);
    const row = await sql(`SELECT key_hash, scopes FROM app.api_keys WHERE id=$1`, [keyId]);
    assert.notEqual(row.rows[0].key_hash, rawKey, 'raw key never stored');
    assert.equal(row.rows[0].key_hash, crypto.createHash('sha256').update(rawKey).digest('hex'));

    const me = await app.inject({ method: 'GET', url: '/me', headers: { 'x-api-key': rawKey } });
    assert.equal(me.statusCode, 200, me.body);
    assert.equal(me.json().role, 'api', 'synthetic principal');
    const ds = await app.inject({ method: 'GET', url: '/dataset', headers: { 'x-api-key': rawKey } });
    assert.equal(ds.statusCode, 200, ds.body);
    const lastUsed = await sql(`SELECT last_used_at FROM app.api_keys WHERE id=$1`, [keyId]);
    assert.ok(lastUsed.rows[0].last_used_at, 'last_used_at stamped');
  });

  test('denials: mutation refused, missing scope refused, unscoped door refused, bad/revoked 401', async () => {
    const mutation = await app.inject({ method: 'POST', url: '/api-keys', payload: {}, headers: { 'x-api-key': rawKey } });
    assert.equal(mutation.statusCode, 403);
    assert.match(mutation.json().error, /read-only/);
    const unscoped = await app.inject({ method: 'GET', url: '/students', headers: { 'x-api-key': rawKey } });
    assert.equal(unscoped.statusCode, 403);
    assert.match(unscoped.json().error, /scoped read doors/);
    const bad = await app.inject({ method: 'GET', url: '/me', headers: { 'x-api-key': 'sk_nope' } });
    assert.equal(bad.statusCode, 401);
    const o = await loginAs(app, 'owner@meridian.edu');
    const rv = await app.inject({ method: 'DELETE', url: `/api-keys/${keyId}`, headers: { authorization: `Bearer ${o.token}` } });
    assert.equal(rv.statusCode, 200, rv.body);
    const dead = await app.inject({ method: 'GET', url: '/me', headers: { 'x-api-key': rawKey } });
    assert.equal(dead.statusCode, 401, 'revoked key dies at next use');
  });
});

describe('L2-4.1 · outbound webhooks', () => {
  test('subscription → outbox event → signed delivery → dedup on replay', async () => {
    const o = await loginAs(app, 'owner@meridian.edu');
    const url = `http://127.0.0.1:${receiver.address().port}/hook`;
    const sub = await app.inject({ method: 'POST', url: '/webhooks', payload: { url, events: ['smoke.event'] }, headers: { authorization: `Bearer ${o.token}`, 'content-type': 'application/json' } });
    assert.equal(sub.statusCode, 200, sub.body);
    const { signSecret } = sub.json();
    const t = await T();
    await sql(`INSERT INTO app.outbox (tenant_id, topic, payload) VALUES ($1,'smoke.event','{"n":1}')`, [t]);

    const worker = await import('../scripts/webhook-worker.js');
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    let res;
    try {
      await c.query('BEGIN');
      res = await worker.tick(c);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { await c.end(); }
    assert.equal(res.enqueued, 1, JSON.stringify(res));
    assert.equal(res.delivered, 1);

    const hit = received.find((r) => r.url === '/hook');
    assert.ok(hit, 'receiver got the POST');
    const sig = hit.headers['x-schoolos-signature'];
    const [, tv1] = sig.split(',');
    const ts = sig.split(',')[0].slice(2);
    const expected = crypto.createHmac('sha256', signSecret).update(`${ts}.${hit.body}`).digest('hex');
    assert.ok(sig.endsWith(expected), 'HMAC signature verifies');

    // replay the same event → no duplicate delivery row
    const c2 = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c2.connect();
    try {
      await c2.query('BEGIN');
      const again = await worker.enqueueFromEvents(c2);
      assert.equal(again, 0, 'at-least-once scheduled exactly once');
      await c2.query('COMMIT');
    } finally { await c2.end(); }
  });

  test('receiver failure → retry scheduled; persistent failure → parked (DLQ state)', async () => {
    const o = await loginAs(app, 'itadmin@meridian.edu');
    const url = `http://127.0.0.1:${receiver.address().port}/flaky`;
    const sub = await app.inject({ method: 'POST', url: '/webhooks', payload: { url, events: ['flaky.event'] }, headers: { authorization: `Bearer ${o.token}`, 'content-type': 'application/json' } });
    const t = await T();
    await sql(`INSERT INTO app.outbox (tenant_id, topic, payload) VALUES ($1,'flaky.event','{}')`, [t]);
    const worker = await import('../scripts/webhook-worker.js');
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try {
      await c.query('BEGIN');
      await worker.tick(c);
      const r1 = await c.query(`SELECT status, attempts, next_attempt_at FROM app.webhook_deliveries d JOIN app.webhook_subscriptions s ON s.id=d.subscription_id WHERE s.url=$1`, [url]);
      assert.equal(r1.rows[0].status, 'queued', 'failure schedules a retry');
      assert.ok(r1.rows[0].next_attempt_at, 'backoff stamped');
      // simulate exhaustion: set attempts to max-1 and re-run → parked
      await c.query(`UPDATE app.webhook_deliveries SET attempts=7, next_attempt_at=now() WHERE subscription_id=(SELECT id FROM app.webhook_subscriptions WHERE url=$1)`, [url]);
      await worker.processDueDeliveries(c, { maxAttempts: 8 });
      const r2 = await c.query(`SELECT status, attempts, last_error FROM app.webhook_deliveries d JOIN app.webhook_subscriptions s ON s.id=d.subscription_id WHERE s.url=$1`, [url]);
      assert.equal(r2.rows[0].status, 'failed', 'parked = dead-letter state');
      assert.match(r2.rows[0].last_error, /max attempts reached/);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { await c.end(); }
  });
});
