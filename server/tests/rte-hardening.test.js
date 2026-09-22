// PERFECT-100 §9.2 RTE P2 batch — kernel route hardening.
//   RTE-4  /transport/events gated BEFORE the insert (a rejected event must not commit)
//   RTE-5  a voided obligation cannot be resurrected by confirming a payment against it
//   RTE-8/9 malformed query params are 400, never a raw 22P02/22007 500
//   RTE-11 me-only admin reads are staff-gated
//   RTE-12 the owner is the unconditional decider for finance-owned actions
//   RTE-13 unassign is capped like assign
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setupTestDb, loginAs } from './helpers.js';

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json', 'x-step-up-password': 'schoolos-demo' });
let app; let sql; let tenantId;
let owner, finance, coordinator, parent, student;

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
  owner = await loginAs(app, 'owner@meridian.edu');
  finance = await loginAs(app, 'finance@meridian.edu');
  coordinator = await loginAs(app, 'coordinator@meridian.edu');
  parent = await loginAs(app, 'parent@meridian.edu');
  student = await loginAs(app, 'student@meridian.edu');
  tenantId = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
});

after(async () => { await app?.close(); });

describe('RTE · kernel route hardening', () => {
  test('RTE-4 · a transport event rejected by the provider gate writes nothing', async () => {
    const routeCode = (await sql(`SELECT code FROM app.routes LIMIT 1`)).rows[0].code;
    const before = Number((await sql(`SELECT count(*)::int n FROM app.transport_events`)).rows[0].n);
    // switch the provider off
    await sql(`UPDATE app.plugins SET status='disabled' WHERE tenant_id=$1 AND plugin_id='transport.gps'`, [tenantId]);
    const r = await app.inject({ method: 'POST', url: '/transport/events', payload: { routeCode, kind: 'gps_delay', delayMins: 3 }, headers: H(coordinator.token) });
    assert.equal(r.statusCode, 409, r.body);
    const after = Number((await sql(`SELECT count(*)::int n FROM app.transport_events`)).rows[0].n);
    assert.equal(after, before, 'a rejected event must not be committed — the insert used to run first');
    await sql(`UPDATE app.plugins SET status='enabled' WHERE tenant_id=$1 AND plugin_id='transport.gps'`, [tenantId]);
  });

  test('RTE-5 · confirming a payment against a VOIDED obligation is refused', async () => {
    const ob = (await sql(`INSERT INTO app.fee_obligations (tenant_id, student_id, term, label, amount_cents)
                           SELECT $1, id, 'Term 2', 'RTE5 void case', 100000 FROM app.students WHERE tenant_id=$1 AND status='active' LIMIT 1 RETURNING id`,
    [tenantId])).rows[0].id;
    const pay = await app.inject({ method: 'POST', url: '/fees/payments', payload: { obligationId: ob }, headers: H(finance.token) });
    assert.equal(pay.statusCode, 200, pay.body);
    const paymentId = pay.json().payment.id;
    const voided = await app.inject({ method: 'POST', url: `/fees/obligations/${ob}/void`, payload: {}, headers: H(owner.token) });
    assert.equal(voided.statusCode, 200, voided.body);
    const conf = await app.inject({ method: 'POST', url: `/fees/payments/${paymentId}/confirm`, payload: {}, headers: H(finance.token) });
    assert.equal(conf.statusCode, 409, conf.body);
    const row = (await sql(`SELECT status, paid_cents FROM app.fee_obligations WHERE id=$1`, [ob])).rows[0];
    assert.equal(row.status, 'void', 'the voided obligation must not be resurrected');
    assert.equal(Number(row.paid_cents), 0);
  });

  test('RTE-8/9 · malformed query params are 400, not a raw 500', async () => {
    const cases = [
      ['/attendance?date=2026%2F01%2F01', owner.token],
      ['/fees/obligations?studentId=abc', finance.token],
      ['/work-orders?assetId=abc', coordinator.token],
      ['/events?since=foo', owner.token],
    ];
    for (const [url, token] of cases) {
      const r = await app.inject({ method: 'GET', url, headers: H(token) });
      assert.equal(r.statusCode, 400, `${url} → ${r.statusCode} ${r.body}`);
    }
  });

  test('RTE-11 · me-only admin reads are staff-gated', async () => {
    for (const url of ['/fee-plans', '/assets', '/migration/sources']) {
      const fam = await app.inject({ method: 'GET', url, headers: H(parent.token) });
      assert.equal(fam.statusCode, 403, `parent must not read ${url}: ${fam.body}`);
      const stu = await app.inject({ method: 'GET', url, headers: H(student.token) });
      assert.equal(stu.statusCode, 403, `student must not read ${url}: ${stu.body}`);
    }
    assert.equal((await app.inject({ method: 'GET', url: '/fee-plans', headers: H(finance.token) })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/migration/sources', headers: H(owner.token) })).statusCode, 200);
  });

  test('RTE-12 · the OWNER may decide a finance-owned action', async () => {
    const id = (await sql(`INSERT INTO app.actions (tenant_id, code, kind, title, detail, why, priority, status, owner, owner_role, policy_ref, ai_involved, source_event, payload)
                           VALUES ($1,'rte12_fin','approval','Finance policy','d','d','normal','open','Finance','finance','Fees §1',false,'rte12','{}'::jsonb) RETURNING id`,
    [tenantId])).rows[0].id;
    const r = await app.inject({ method: 'POST', url: `/actions/${id}/decide`, payload: { decision: 'approved' }, headers: H(owner.token) });
    assert.equal(r.statusCode, 200, r.body);
  });

  test('RTE-13 · unassign is capped like assign', async () => {
    const ids = Array.from({ length: 201 }, () => '00000000-0000-0000-0000-000000000000');
    const r = await app.inject({ method: 'POST', url: '/roles/librarian/unassign', payload: { userIds: ids }, headers: H(owner.token) });
    assert.equal(r.statusCode, 400, r.body);
  });

  test('RTE-14 · a student is still refused the school roster (mask-aware path)', async () => {
    const r = await app.inject({ method: 'GET', url: '/students', headers: H(student.token) });
    assert.equal(r.statusCode, 403, r.body);
  });
});
