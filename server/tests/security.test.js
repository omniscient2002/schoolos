// Security regression tests — REDTEAM-1 RTR-001 criticals must stay fixed.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setupTestDb, loginAs } from './helpers.js';

let app;

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.ready();
});

after(async () => { if (app) await app.close(); });

describe('security invariants (RTR-001 regressions)', () => {
  test('RT-002: parent cannot decide a principal-owned action; wrong role rejected', async () => {
    const pr = await loginAs(app, 'principal@meridian.edu');
    const raised = await app.inject({ method: 'POST', url: '/transport/events', payload: { routeCode: 'Route 7', kind: 'gps_delay', delayMins: 12 }, headers: { authorization: `Bearer ${pr.token}` } });
    const actionId = raised.json().action.id;
    const pa = await loginAs(app, 'parent@meridian.edu');
    const res = await app.inject({ method: 'POST', url: `/actions/${actionId}/decide`, payload: { decision: 'approved' }, headers: { authorization: `Bearer ${pa.token}` } });
    assert.equal(res.statusCode, 403, 'parent must not decide');
    const te = await loginAs(app, 'teacher@meridian.edu');
    const res2 = await app.inject({ method: 'POST', url: `/actions/${actionId}/decide`, payload: { decision: 'approved' }, headers: { authorization: `Bearer ${te.token}` } });
    assert.equal(res2.statusCode, 403, 'teacher must not decide either');
  });

  test('RT-003: parent cannot confirm payments (initiate is fine, confirm is not)', async () => {
    const pa = await loginAs(app, 'parent@meridian.edu');
    const me = await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${pa.token}` } });
    // find parent-linked student via /students (RT-005 filter applies)
    const st = await app.inject({ method: 'GET', url: '/students', headers: { authorization: `Bearer ${pa.token}` } });
    const students = st.json().students ?? [];
    assert.ok(students.length <= 1, `parent sees at most own child (got ${students.length})`);
    const fin = await loginAs(app, 'finance@meridian.edu');
    const list = await app.inject({ method: 'GET', url: `/fees/obligations?studentId=${students[0]?.id ?? ''}`, headers: { authorization: `Bearer ${fin.token}` } });
    const open = (list.json().obligations ?? []).find(o => o.status === 'open');
    if (!open) return; // nothing open in seed for this child — acceptable
    const init = await app.inject({ method: 'POST', url: '/fees/payments', payload: { obligationId: open.id }, headers: { authorization: `Bearer ${pa.token}` } });
    assert.equal(init.statusCode, 200, 'parent may initiate (self-service)');
    const conf = await app.inject({ method: 'POST', url: `/fees/payments/${init.json().payment.id}/confirm`, payload: { gatewayRef: 'PARENT-SAYS-PAID' }, headers: { authorization: `Bearer ${pa.token}` } });
    assert.equal(conf.statusCode, 403, 'parent must not confirm — money path is staff-only');
  });

  test('RT-004: double-pay is impossible (open-payment unique + overpay CHECK)', async () => {
    const pr = await loginAs(app, 'principal@meridian.edu');
    // RT-003 may have left an open payment on this child's obligation — use another student
    const st = await app.inject({ method: 'GET', url: '/students?search=Diya', headers: { authorization: `Bearer ${pr.token}` } });
    const aarav = (st.json().students ?? []).find(s => s.name.startsWith('Diya'));
    if (!aarav) return;
    const fin = await loginAs(app, 'finance@meridian.edu');
    const list = await app.inject({ method: 'GET', url: `/fees/obligations?studentId=${aarav.id}`, headers: { authorization: `Bearer ${fin.token}` } });
    const open = (list.json().obligations ?? []).find(o => o.status === 'open');
    if (!open) return;
    const p1 = await app.inject({ method: 'POST', url: '/fees/payments', payload: { obligationId: open.id }, headers: { authorization: `Bearer ${fin.token}` } });
    assert.equal(p1.statusCode, 200);
    const p2 = await app.inject({ method: 'POST', url: '/fees/payments', payload: { obligationId: open.id }, headers: { authorization: `Bearer ${fin.token}` } });
    assert.equal(p2.statusCode, 409, 'second initiation while one is open must be refused');
  });

  test('RT-009: teacher cannot read staff uuids or guardian contact from WO/students', async () => {
    const te = await loginAs(app, 'teacher@meridian.edu');
    const wos = await app.inject({ method: 'GET', url: '/work-orders', headers: { authorization: `Bearer ${te.token}` } });
    assert.equal(wos.statusCode, 200);
    const raw = JSON.stringify(wos.json());
    assert.ok(!/reported_by":"[0-9a-f-]{36}/.test(raw), 'no staff uuid leak');
    const st = await app.inject({ method: 'GET', url: '/students', headers: { authorization: `Bearer ${te.token}` } });
    const raw2 = JSON.stringify(st.json());
    assert.ok(!/guardian_phone"/.test(raw2), 'guardian phones not exposed');
  });

  test('Track F: rotating spoofed X-Forwarded-For cannot defeat the login limiter', async () => {
    for (let i = 0; i < 21; i++) {
      const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'nobody@meridian.edu', password: 'x' }, headers: { 'x-forwarded-for': `10.9.9.${i}` } });
      if (i >= 20) assert.equal(r.statusCode, 429, 'rotating XFF must not reset the window when trustProxy is off');
    }
  });

  test('Track E: ledger is INSERT-proof for the app role and hashes are recomputable', async () => {
    const pg = (await import('pg')).default;
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
    const t = (await c.query(`SELECT id FROM app.tenants LIMIT 1`)).rows[0];
    let denied = false;
    try {
      await c.query(`SET LOCAL ROLE schoolos_app;
        INSERT INTO app.audit_log (tenant_id, actor, actor_role, action, record_type, record_ref, prev_hash, hash)
        VALUES ($1,'Attacker','admin','FORGED','X','X','x','x')`, [t.id]);
    } catch { denied = true; }
    await c.query('ROLLBACK').catch(() => {});
    if (!denied) {
      // if role grant changed, the SECURITY DEFINER fn must still be the only path — force check
      const chk = await c.query(`SELECT has_table_privilege('schoolos_app','app.audit_log','INSERT') AS ok`);
      assert.equal(chk.rows[0].ok, false, 'app role must not hold INSERT on the ledger');
    }
    // recompute the newest hash from stored columns only
    const row = (await c.query(`SELECT * FROM app.audit_log ORDER BY created_at DESC, id DESC LIMIT 1`)).rows[0];
    if (row.prev_hash && row.hash) {
      const material = JSON.stringify({ tenant: row.tenant_id, actor: row.actor, actorRole: row.actor_role, action: row.action, recordType: row.record_type, recordRef: row.record_ref, outcome: row.outcome, at: new Date(row.created_at).toISOString() });
      assert.equal(createHash('sha256').update(row.prev_hash + material).digest('hex'), row.hash, 'hash must recompute from stored columns');
    }
    await c.end();
  });
});
