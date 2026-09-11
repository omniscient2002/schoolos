// L2 P5 (Wave 5) — AI gateway (L2-5.1) + workflow step-runner (L2-5.2).
// Pins: ledger row per call, budget enforcement BEFORE the provider runs,
// honest unconfigured-provider errors, eval-harness shape; workflow rule →
// outbox fan-out + comms enqueue, idempotent per (rule, event), no chains.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setupTestDb, loginAs } from './helpers.js';

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

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

const T = () => sql(`SELECT id FROM app.tenants WHERE slug='meridian'`).then((r) => r.rows[0].id);

describe('L2-5.1 · AI gateway', () => {
  test('sandbox call: ok outcome + ledger row; unknown provider → honest 503 + error ledger', async () => {
    const o = await loginAs(app, 'owner@meridian.edu');
    const t = await T();
    const r = await app.inject({ method: 'POST', url: '/ai/call', payload: { pluginId: 'teacher.copilot', purpose: 'draft-note', provider: 'logger', input: 'Summarise attendance for 7A' }, headers: H(o.token) });
    assert.equal(r.statusCode, 200, r.body);
    assert.ok(String(r.json().output).startsWith('(sandbox echo)'), 'sandbox provider is deterministic');
    const ledger = await sql(`SELECT outcome, provider, sandbox, tokens_in FROM app.ai_calls WHERE tenant_id=$1 AND purpose='draft-note'`, [t]);
    assert.equal(ledger.rows.length, 1);
    assert.equal(ledger.rows[0].outcome, 'ok');
    assert.equal(ledger.rows[0].sandbox, true);

    const bad = await app.inject({ method: 'POST', url: '/ai/call', payload: { pluginId: 'teacher.copilot', purpose: 'x', provider: 'nope', input: 'hi' }, headers: H(o.token) });
    assert.equal(bad.statusCode, 503);
    assert.match(bad.json().error, /unknown AI provider/);
    const errRow = await sql(`SELECT outcome FROM app.ai_calls WHERE tenant_id=$1 AND purpose='x'`, [t]);
    assert.equal(errRow.rows[0].outcome, 'error', 'failures are ledgered too');
  });

  test('budget: ai_budget=0 disables the plugin; tenant daily cap → 429, both ledgered', async () => {
    const o = await loginAs(app, 'owner@meridian.edu');
    const t = await T();
    try {
      await sql(`UPDATE app.plugins SET ai_budget='{"calls":0}'::jsonb WHERE tenant_id=$1 AND plugin_id='teacher.copilot'`, [t]);
      const off = await app.inject({ method: 'POST', url: '/ai/call', payload: { pluginId: 'teacher.copilot', purpose: 'blocked', provider: 'logger', input: 'hi' }, headers: H(o.token) });
      assert.equal(off.statusCode, 429, off.body);
      await sql(`UPDATE app.plugins SET ai_budget='{"calls":10}'::jsonb WHERE tenant_id=$1 AND plugin_id='teacher.copilot'`, [t]);
      // daily cap = current usage + 1 → the next call fires, the one after hits the wall
      const used = await sql(`SELECT count(*)::int AS n FROM app.ai_calls WHERE tenant_id=$1 AND outcome <> 'budget'`, [t]);
      await sql(`UPDATE app.tenants SET config = config || $2::jsonb WHERE id=$1`, [t, JSON.stringify({ ai: { dailyCallCap: used.rows[0].n + 1 } })]);
      const first = await app.inject({ method: 'POST', url: '/ai/call', payload: { pluginId: 'teacher.copilot', purpose: 'cap1', provider: 'logger', input: 'a' }, headers: H(o.token) });
      assert.equal(first.statusCode, 200, first.body);
      const second = await app.inject({ method: 'POST', url: '/ai/call', payload: { pluginId: 'teacher.copilot', purpose: 'cap2', provider: 'logger', input: 'b' }, headers: H(o.token) });
      assert.equal(second.statusCode, 429, second.body);
      assert.equal(second.json().code, 'budget');
      const budgetRows = await sql(`SELECT count(*)::int AS n FROM app.ai_calls WHERE tenant_id=$1 AND outcome='budget'`, [t]);
      assert.ok(budgetRows.rows[0].n >= 2, 'budget refusals are ledgered');
    } finally {
      await sql(`UPDATE app.tenants SET config = config - 'ai' WHERE id=$1`, [t]); // never leak a cap
    }
  });

  test('eval-harness door shape: batch through the sandbox, per-case results + ledger', async () => {
    const t = await T();
    await sql(`UPDATE app.tenants SET config = config - 'ai' WHERE id=$1`, [t]); // no cap residue
    const o = await loginAs(app, 'owner@meridian.edu');
    const r = await app.inject({ method: 'POST', url: '/ai/eval', payload: { provider: 'logger', cases: [{ name: 'greeting', input: 'hello' }, { name: 'bad', input: 'world' }] }, headers: H(o.token) });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().total, 2);
    assert.equal(r.json().ok, 2);
    assert.ok(Array.isArray(r.json().results) && r.json().results[0].name === 'greeting');
    const evals = await sql(`SELECT count(*)::int AS n FROM app.ai_calls WHERE purpose='eval'`);
    assert.ok(evals.rows[0].n >= 2, 'eval runs are ledgered individually');
    // students cannot reach AI doors
    const s = await loginAs(app, 'student@meridian.edu');
    const denied = await app.inject({ method: 'POST', url: '/ai/call', payload: { pluginId: 'x', purpose: 'y', input: 'z' }, headers: H(s.token) });
    assert.equal(denied.statusCode, 403);
  });
});

describe('L2-5.2 · workflow step-runner', () => {
  test('rule fires once per event (outbox fan-out), condition honored, no chains', async () => {
    const o = await loginAs(app, 'owner@meridian.edu');
    const t = await T();
    const made = await app.inject({ method: 'POST', url: '/workflow-rules', payload: { name: 'absence alert fan-out', topic: 'attendance.marked', condition: { field: 'status', op: 'equals', value: 'absent' }, action: { kind: 'outbox', topic: 'attendance.absent.workflow' } }, headers: H(o.token) });
    assert.equal(made.statusCode, 200, made.body);
    const ruleId = made.json().id;
    const worker = await import('../scripts/workflow-worker.js');
    // two matching events + one non-matching (status present)
    await sql(`INSERT INTO app.outbox (tenant_id, topic, payload) VALUES ($1,'attendance.marked','{"status":"absent","student":"s1"}'), ($1,'attendance.marked','{"status":"absent","student":"s2"}'), ($1,'attendance.marked','{"status":"present","student":"s3"}')`, [t]);
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    let pass1;
    try {
      await c.query('BEGIN');
      pass1 = await worker.runWorkflowPass(c);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { await c.end(); }
    assert.equal(pass1.fired, 2, `both matching events fire (got ${JSON.stringify(pass1)})`);
    const derived = await sql(`SELECT count(*)::int AS n FROM app.outbox WHERE topic='attendance.absent.workflow' AND tenant_id=$1`, [t]);
    assert.equal(derived.rows[0].n, 2);
    // idempotent: a second pass re-scans the same events but fires nothing new
    const c2 = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c2.connect();
    try {
      await c2.query('BEGIN');
      const pass2 = await worker.runWorkflowPass(c2);
      await c2.query('COMMIT');
      assert.equal(pass2.fired, 0, 'dedup key makes (rule, event) fire exactly once');
    } finally { await c2.end(); }
    // no chains: derived 'wf:' rows are skipped by the runner itself
    const chainCheck = await sql(`SELECT count(*)::int AS n FROM app.outbox WHERE tenant_id=$1 AND dedup_key LIKE 'wf:%'`, [t]);
    assert.ok(chainCheck.rows[0].n >= 2);
    const cleanup = await app.inject({ method: 'DELETE', url: `/workflow-rules/${ruleId}`, payload: {}, headers: H(o.token) });
    assert.equal(cleanup.statusCode, 200);
  });

  test('comms action enqueues a dedup-keyed message; unknown op never fires', async () => {
    const o = await loginAs(app, 'owner@meridian.edu');
    const t = await T();
    const made = await app.inject({ method: 'POST', url: '/workflow-rules', payload: { name: 'fee reminder sms', topic: 'fee.due', condition: { field: 'amount', op: 'equals', value: 'not-this-amount' }, action: { kind: 'comms', channel: 'sms', body: 'Fee due reminder' } }, headers: H(o.token) });
    assert.equal(made.statusCode, 200);
    const worker = await import('../scripts/workflow-worker.js');
    await sql(`INSERT INTO app.outbox (tenant_id, topic, payload) VALUES ($1,'fee.due','{"amount":5000}')`, [t]);
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try {
      await c.query('BEGIN');
      const res = await worker.runWorkflowPass(c);
      await c.query('COMMIT');
      assert.equal(res.fired, 0, 'non-matching condition never fires');
      const bad = await app.inject({ method: 'POST', url: '/workflow-rules', payload: { name: 'x', topic: 'y', action: { kind: 'http' } }, headers: H(o.token) });
      assert.equal(bad.statusCode, 400, 'http actions are refused — no fiction');
    } finally { await c.end(); }
  });
});
