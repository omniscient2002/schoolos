// P1 · fee RLS fuzz — EVERY fee table: tenant B sees zero of tenant A's rows,
// and a row wearing A's id is refused (42501) under B's app-role session.
// Plus door-level: B's owner gets 404 (never 403-tell, never data) on A's
// payment refund, obligation void, and concession decide.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';
import pg from 'pg';

let app, sql, tenantA, tenantB, ownerB;
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
  tenantA = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  tenantB = (await sql(`INSERT INTO app.tenants (slug,name) VALUES ('fee-rls-probe','RLS probe') RETURNING id`)).rows[0].id;
  const pw = (await sql(`SELECT password_hash FROM app.users WHERE email='owner@meridian.edu'`)).rows[0].password_hash;
  await sql(`INSERT INTO app.users (tenant_id,email,name,role,password_hash) VALUES ($1,'owner@rlsprobe.edu','Probe Owner','owner',$2)`, [tenantB, pw]);
  ownerB = (await loginAs(app, 'owner@rlsprobe.edu')).token;
});
after(async () => { await app?.close(); });

const asB = async (text, params = []) => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('schoolos.tenant_id', $1, true)`, [tenantB]);
    await c.query('SET LOCAL ROLE schoolos_app');
    return await c.query(text, params);
  } finally {
    await c.query('ROLLBACK');
    await c.end();
  }
};

const TABLES = [
  ['fee_heads', `INSERT INTO app.fee_heads (tenant_id,name) VALUES ($1,'rls-smuggle')`],
  ['fee_plan_templates', `INSERT INTO app.fee_plan_templates (tenant_id,name,grades,terms) VALUES ($1,'rls-smuggle','{G}','[]'::jsonb)`],
  ['fee_obligations', null], // needs a live student id — built in-test
  ['fee_installments', null],
  ['payments', null],
  ['payment_allocations', null],
  ['payment_events', null],
  ['fee_receipts', null],
  ['fee_concessions', null],
  ['fee_discount_rules', `INSERT INTO app.fee_discount_rules (tenant_id,name,kind,value_type,value_numeric) VALUES ($1,'rls-smuggle','other','flat',1)`],
  ['fee_late_rules', `INSERT INTO app.fee_late_rules (tenant_id,mode) VALUES ($1,'fixed')`],
  ['fee_dunning_log', null],
  ['billing_runs', null],
];

test('RLS · tenant B reads zero rows on every fee table', async () => {
  for (const [t] of TABLES) {
    const r = await asB(`SELECT count(*)::int n FROM app.${t}`);
    assert.equal(r.rows[0].n, 0, `${t}: B must see zero`);
  }
  const fam = await asB(`SELECT count(*)::int n FROM family.child_link`);
  assert.equal(fam.rows[0].n, 0, 'family.child_link: B sees zero');
});

test('RLS · cross-tenant INSERT wearing A id is refused (42501) on every fee table', async () => {
  const S = (await sql(`SELECT id FROM app.students WHERE tenant_id=$1 AND status='active' LIMIT 1`, [tenantA])).rows[0].id;
  const O = (await sql(`INSERT INTO app.fee_obligations (tenant_id,student_id,term,label,amount_cents) VALUES ($1,$2,'RLS','rls fixture',10000) RETURNING *`, [tenantA, S])).rows[0];
  const P = (await sql(`INSERT INTO app.payments (tenant_id,student_id,obligation_id,amount_cents,method,status) VALUES ($1,$2,$3,10000,'upi','initiated') RETURNING *`, [tenantA, S, O.id])).rows[0];
  const T = (await sql(`INSERT INTO app.fee_plan_templates (tenant_id,name,grades,terms) VALUES ($1,'rls-tpl','{G}','[]'::jsonb) RETURNING *`, [tenantA])).rows[0];
  const U = (await sql(`SELECT id FROM app.users WHERE tenant_id=$1 AND role='owner' LIMIT 1`, [tenantA])).rows[0].id;
  const byTable = {
    fee_obligations: `INSERT INTO app.fee_obligations (tenant_id,student_id,term,label,amount_cents) VALUES ('${tenantA}',$1,'RLS','rls-smuggle-x',10)`,
    fee_installments: `INSERT INTO app.fee_installments (tenant_id,obligation_id,seq,amount_cents) VALUES ('${tenantA}',$1,4242,10)`,
    payments: `INSERT INTO app.payments (tenant_id,student_id,amount_cents,method,status) VALUES ('${tenantA}',$1,10,'upi','initiated')`,
    payment_allocations: `INSERT INTO app.payment_allocations (tenant_id,payment_id,obligation_id,amount_cents) VALUES ('${tenantA}',$1,$2,1)`,
    payment_events: `INSERT INTO app.payment_events (tenant_id,payment_id,kind) VALUES ('${tenantA}',$1,'initiated')`,
    fee_receipts: `INSERT INTO app.fee_receipts (tenant_id,payment_id,receipt_no,student_id,amount_cents) VALUES ('${tenantA}',$1,'RLS-SMUG',$2,1)`,
    fee_concessions: `INSERT INTO app.fee_concessions (tenant_id,student_id,kind) VALUES ('${tenantA}',$1,'waiver')`,
    fee_dunning_log: `INSERT INTO app.fee_dunning_log (tenant_id,obligation_id,kind) VALUES ('${tenantA}',$1,'overdue')`,
    billing_runs: `INSERT INTO app.billing_runs (tenant_id,plan_template_id,created_by) VALUES ('${tenantA}',$1,$2)`,
  };
  const paramFor = (t) => {
    if (t === 'billing_runs') return [T.id, U];
    if (t === 'payment_allocations') return [P.id, O.id];
    if (t === 'fee_receipts') return [P.id, S];
    if (t === 'fee_obligations') return [S];
    if (t === 'fee_installments' || t === 'fee_dunning_log') return [O.id];
    if (t === 'payments' || t === 'fee_concessions') return [S];
    return [P.id]; // payment_events
  };
  for (const [t, fixed] of TABLES) {
    const text = fixed ? fixed.replace('$1', `'${tenantA}'`) : byTable[t];
    const params = fixed ? [] : paramFor(t);
    await assert.rejects(() => asB(text, params),
      (e) => e.code === '42501', `${t}: WITH CHECK must refuse A-id row under B session (got different error)`);
  }
});

test('RLS · door level: B owner gets 404 (not data, not a tell) on A money rows', async () => {
  const S = (await sql(`SELECT id FROM app.students WHERE tenant_id=$1 AND status='active' LIMIT 1`, [tenantA])).rows[0].id;
  const O = (await sql(`INSERT INTO app.fee_obligations (tenant_id,student_id,term,label,amount_cents) VALUES ($1,$2,'RLS','rls door',20000) RETURNING *`, [tenantA, S])).rows[0];
  const P = (await sql(`INSERT INTO app.payments (tenant_id,student_id,obligation_id,amount_cents,method,status,gateway_ref) VALUES ($1,$2,$3,20000,'upi','confirmed','MANUAL') RETURNING *`, [tenantA, S, O.id])).rows[0];
  const C = (await sql(`INSERT INTO app.fee_concessions (tenant_id,student_id,kind,status) VALUES ($1,$2,'waiver','requested') RETURNING *`, [tenantA, S])).rows[0];
  const B = H(ownerB);
  assert.equal((await app.inject({ method: 'GET', url: '/fees/obligations', headers: B })).json().obligations.length, 0);
  assert.equal((await app.inject({ method: 'GET', url: `/fees/obligations/${O.id}`, headers: B })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: `/fees/obligations/${O.id}/void`, headers: B, payload: {} })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: `/payments/${P.id}/refund`, headers: B, payload: { reason: 'smuggle' } })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: `/fees/concessions/${C.id}/decide`, headers: B, payload: { decision: 'approve' } })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: `/payments/${P.id}`, headers: B })).statusCode, 404);
});
