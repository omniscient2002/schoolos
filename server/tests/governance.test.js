// Governance tests — docs/12 §10/§12: envelope v2, event budgets + circuit breaker,
// drain protocol, lineage. Fresh schoolos_test per file (setupTestDb).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setupTestDb, loginAs } from './helpers.js';

let app;

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.ready();
});

after(async () => { if (app) await app.close(); });

const sql = (text, params = []) => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  return c.connect().then(() => c.query(text, params)).then(async r => { await c.end(); return r; });
};

describe('event spine & governance (docs/12)', () => {
  test('envelope v2: emitted_by, subject, payload, lineage link', async () => {
    const p = await loginAs(app);
    const res = await app.inject({ method: 'POST', url: '/transport/events', payload: { routeCode: 'Route 7', kind: 'gps_delay', delayMins: 12 }, headers: { authorization: `Bearer ${p.token}` } });
    assert.equal(res.statusCode, 200);
    const action = res.json().action;
    assert.ok(action, 'policy raised approval action');
    const ev = await sql(`SELECT emitted_by, subject, schema_version, payload FROM app.events WHERE type='transport' ORDER BY created_at DESC LIMIT 1`);
    assert.equal(ev.rows[0].emitted_by, 'plugin:transport');
    assert.equal(ev.rows[0].subject, 'route:Route 7');
    assert.equal(ev.rows[0].schema_version, 1);
    assert.equal(ev.rows[0].payload.riders, 75);
    const link = await sql(`SELECT action_id, relation, policy_ref FROM app.event_action_link WHERE action_id=$1`, [action.id]);
    assert.equal(link.rows.length, 1);
    assert.equal(link.rows[0].policy_ref, 'Transport §3.1');
    // lineage endpoint resolves event → action
    const lin = await app.inject({ method: 'GET', url: '/events/lineage?limit=5', headers: { authorization: `Bearer ${p.token}` } });
    const entry = lin.json().lineage.find(e => e.links && e.links.some(l => l.action_id === action.id));
    assert.ok(entry, 'lineage view links the event to its action');
    assert.equal(entry.emitted_by, 'plugin:transport');
  });

  test('event budgets trip the circuit breaker (docs/12 §10)', async () => {
    const o = await loginAs(app, 'owner@meridian.edu');
    const H = { authorization: `Bearer ${o.token}`, 'content-type': 'application/json' };
    await app.inject({ method: 'POST', url: '/plugins/transport/enable', payload: { version: '1.4.0', class: 'B' }, headers: H });
    // age out earlier test events so the per-minute window starts clean
    await sql(`UPDATE app.events SET created_at = now() - interval '5 minutes' WHERE emitted_by='plugin:transport'`);
    await sql(`UPDATE app.plugins SET event_budget='{"events_per_min":2}'::jsonb WHERE plugin_id='transport'`);
    const mk = () => app.inject({ method: 'POST', url: '/transport/events', payload: { routeCode: 'Route 4', kind: 'gps_delay', delayMins: 3 }, headers: { authorization: `Bearer ${o.token}` } });
    assert.equal((await mk()).statusCode, 200);
    assert.equal((await mk()).statusCode, 200);
    const third = await mk();
    assert.equal(third.statusCode, 429);
    assert.equal(third.json().code, 'BUDGET_EXHAUSTED');
    const fourth = await mk();
    assert.equal(fourth.statusCode, 429);
    assert.equal(fourth.json().code, 'BREAKER_OPEN', 'breaker stays open below limit once tripped');
    const st = await sql(`SELECT breaker_state FROM app.plugins WHERE plugin_id='transport'`);
    assert.equal(st.rows[0].breaker_state.open, true);
    // reset so later suites/files see defaults
    await sql(`UPDATE app.plugins SET breaker_state='{"open":false}'::jsonb, event_budget='{}'::jsonb WHERE plugin_id='transport'`);
  });

  test('capability contracts: kernel primitives registered and enforced (docs/12 §4)', async () => {
    const p = await loginAs(app);
    const res = await app.inject({ method: 'GET', url: '/plugins', headers: { authorization: `Bearer ${p.token}` } });
    const contracts = res.json().contracts ?? [];
    for (const cap of ['money.ledger.post', 'work.wo.transition', 'artifact.store.put', 'comms.send', 'audit.chain.append']) {
      const row = contracts.find(x => x.capability_id === cap);
      assert.ok(row, `${cap} registered`);
      assert.ok(row.contract.policy_refs?.length, `${cap} constitution-linked`);
    }
    const audit = contracts.find(x => x.capability_id === 'audit.chain.append');
    assert.ok(audit.enforced.invariants.includes('insert_revoked_for_app_role'), 'audit contract carries its enforced invariant');
  });

  test('drain protocol: disable hands open actions back, never abandons (docs/12 §12)', async () => {
    const o = await loginAs(app, 'owner@meridian.edu');
    const H = { authorization: `Bearer ${o.token}`, 'content-type': 'application/json' };
    await app.inject({ method: 'POST', url: '/plugins/library/enable', payload: { version: '1.0.0', class: 'A' }, headers: H });
    const t = (await sql(`SELECT id FROM app.tenants LIMIT 1`)).rows[0].id;
    await sql(`INSERT INTO app.actions (tenant_id, code, kind, title, status, owner, owner_role, policy_ref)
               VALUES ($1, 'act_lib_drain', 'reminder', 'Chase overdue library books', 'open', 'Library', 'library', 'Library §1.1')`, [t]);
    const res = await app.inject({ method: 'POST', url: '/plugins/library/disable', payload: {}, headers: H });
    assert.equal(res.statusCode, 200);
    assert.ok(res.json().drained.actions_reassigned >= 1, 'drain report counts hand-backs');
    const a = await sql(`SELECT owner, owner_role FROM app.actions WHERE code='act_lib_drain'`);
    assert.equal(a.rows[0].owner_role, 'principal');
    assert.match(a.rows[0].owner, /drain hand-back/);
    const aud = await sql(`SELECT outcome FROM app.audit_log WHERE action LIKE 'Plugin disabled%' ORDER BY created_at DESC LIMIT 1`);
    assert.match(aud.rows[0].outcome, /DRAIN: \d+ open action/);
  });
});
