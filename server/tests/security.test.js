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
  // PLG-10: the transport event door needs an enabled provider before it will budget and emit, so RT-002's
  // "raise an action" premise only holds with transport.gps switched on. Enabled directly on the owner
  // connection rather than through `/auth/login`: this file's Track F deliberately exhausts the login
  // limiter (20/min), and spending part of that budget here would make the limiter assertion order-fragile.
  const { pool } = await import('../src/db.js');
  const tenant = (await pool.query(`SELECT id FROM app.tenants ORDER BY created_at LIMIT 1`)).rows[0].id;
  await pool.query(`UPDATE app.plugins SET status='enabled' WHERE tenant_id=$1 AND plugin_id='transport.gps'`, [tenant]);
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
    /* TST-5: this was `if (!open) return;`. seed.js deliberately leaves the demo child's Term 2
       installment unsettled (`paid_cents=0, status='open'` on Aarav's September row) precisely so the
       money-path story exists — an open obligation is a FIXTURE of this test, not a happy accident.
       When the seed stops producing one, this invariant (a parent may initiate but must NEVER confirm)
       has to fail loudly instead of retiring itself. */
    assert.ok(students[0], 'fixture: the parent must see their own child through /students (the RT-005 filter)');
    const open = (list.json().obligations ?? []).find(o => o.status === 'open');
    assert.ok(open, `fixture: the demo child must carry an open fee obligation for the money-path pin (obligations: ${list.body})`);
    const init = await app.inject({ method: 'POST', url: '/fees/payments', payload: { obligationId: open.id }, headers: { authorization: `Bearer ${pa.token}` } });
    assert.equal(init.statusCode, 200, 'parent may initiate (self-service)');
    const conf = await app.inject({ method: 'POST', url: `/fees/payments/${init.json().payment.id}/confirm`, payload: { gatewayRef: 'PARENT-SAYS-PAID' }, headers: { authorization: `Bearer ${pa.token}` } });
    assert.equal(conf.statusCode, 403, 'parent must not confirm — money path is staff-only');
  });

  test('RT-004: double-pay is impossible (open-payment unique + overpay CHECK)', async () => {
    const pr = await loginAs(app, 'principal@meridian.edu');
    // RT-003 has just left an open payment on the parent's own child, so this pin needs a DIFFERENT
    // student. seed.js pins 'Diya Nair' as a distinct uniquely-named student, which makes the lookup
    // deterministic. TST-5: the two bare `return`s that used to wrap these assertions are gone — the
    // variable was even called `aarav` while holding Diya, i.e. written against a different student
    // than the comment claimed, and nothing ever failed because nothing ever asserted.
    const st = await app.inject({ method: 'GET', url: '/students?search=Diya', headers: { authorization: `Bearer ${pr.token}` } });
    const diya = (st.json().students ?? []).find(s => s.name.startsWith('Diya'));
    assert.ok(diya, `fixture: student 'Diya Nair' is pinned by seed.js and must be findable (got ${st.body})`);
    const fin = await loginAs(app, 'finance@meridian.edu');
    const list = await app.inject({ method: 'GET', url: `/fees/obligations?studentId=${diya.id}`, headers: { authorization: `Bearer ${fin.token}` } });
    const open = (list.json().obligations ?? []).find(o => o.status === 'open');
    assert.ok(open, `fixture: 'Diya Nair' must carry an open obligation for the double-pay pin (obligations: ${list.body})`);
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
    // recompute the newest hash from stored columns only.
    // SEC-20 (migration 075): the hashing formula now lives in the DATABASE, because the old writer
    // computed it in JS and app.audit_append stored the supplied value VERBATIM while validating only
    // prev_hash — so any app-role caller could pick its own hash and the chain still linked. Asking
    // the database for the formula is strictly stronger than a hand-rolled copy, which could drift
    // from the writer without any test noticing. hash_version=1 rows predate the fix and CANNOT be
    // recomputed (the material itself changed); they are asserted as the named legacy class they are,
    // never silently passed as verified.
    const row = (await c.query(`SELECT * FROM app.audit_log ORDER BY created_at DESC, id DESC LIMIT 1`)).rows[0];
    if (row.prev_hash && row.hash) {
      if (row.hash_version >= 2) {
        const dbHash = (await c.query(
          `SELECT app.audit_row_hash(prev_hash, tenant_id, actor, actor_role, action, record_type, record_ref,
                                     reason, policy_ref, ai_involved, risk, outcome, ip, created_at) AS h
             FROM app.audit_log WHERE id=$1`, [row.id])).rows[0].h;
        assert.equal(dbHash, row.hash, 'hash must recompute from stored columns');
        // The pre-075 JS material must NOT reproduce a pinned row: proves hashing really moved into
        // the database rather than the trigger merely copying the caller's value.
        const legacy = JSON.stringify({ tenant: row.tenant_id, actor: row.actor, actorRole: row.actor_role, action: row.action, recordType: row.record_type, recordRef: row.record_ref, outcome: row.outcome, at: new Date(row.created_at).toISOString() });
        assert.notEqual(createHash('sha256').update(row.prev_hash + legacy).digest('hex'), row.hash,
          'a hash-pinned row must not reproduce under the superseded JS material');
      } else {
        assert.equal(row.hash_version, 1, 'an unrecomputable row must be explicitly marked legacy');
      }
    }
    await c.end();
  });

  test('RT-7 #5: principal cannot approve a coordinator-owned action (staff leave); owner still may', async () => {
    const { randomUUID } = await import('node:crypto');
    const { pool } = await import('../src/db.js');
    const user = (email) => pool.query(`SELECT id, tenant_id, role, name FROM app.users WHERE email=$1`, [email]).then((r) => r.rows[0]);
    // tokens minted directly — Track F above deliberately exhausts the /auth/login bucket
    const tokenFor = (u) => app.jwt.sign({ sub: u.id, role: u.role, tenant: u.tenant_id, name: u.name, jti: randomUUID() });
    const tenant = (await user('owner@meridian.edu')).tenant_id;
    const teacher = (await pool.query(`SELECT id FROM app.users WHERE tenant_id=$1 AND email='teacher@meridian.edu'`, [tenant])).rows[0].id;
    // coordinator-owned approval actions exactly as teacher.classroom raises staff leave
    const mk = (code) => pool.query(
      `INSERT INTO app.actions (tenant_id, code, kind, title, status, owner, owner_role, payload)
       VALUES ($1,$2,'approval','Staff leave (RT-7)','open','Coordinator','coordinator',$3::jsonb) RETURNING id`,
      [tenant, code, JSON.stringify({ kind: 'task', proposed_by: teacher })]).then((r) => r.rows[0].id);
    const a1 = await mk('sec.rt7.leave.prin');
    const a2 = await mk('sec.rt7.leave.owner');
    const denied = await app.inject({ method: 'POST', url: `/actions/${a1}/decide`, payload: { decision: 'approved', note: 'principal stamp' }, headers: { authorization: `Bearer ${tokenFor(await user('principal@meridian.edu'))}` } });
    assert.equal(denied.statusCode, 403, `principal approval of coordinator-owned action refused (got ${denied.statusCode}: ${denied.body})`);
    assert.match(denied.json().error, /Segregation of duties — ask the owner to decide this/);
    const row = await pool.query(`SELECT status FROM app.actions WHERE id=$1`, [a1]);
    assert.equal(row.rows[0].status, 'open', 'no side effects — action stays pending');
    // the owner keeps full authority over the coordinator desk's actions
    const ok = await app.inject({ method: 'POST', url: `/actions/${a2}/decide`, payload: { decision: 'approved', note: 'owner authority' }, headers: { authorization: `Bearer ${tokenFor(await user('owner@meridian.edu'))}` } });
    assert.equal(ok.statusCode, 200, ok.body);
    const done = await pool.query(`SELECT status FROM app.actions WHERE id=$1`, [a2]);
    assert.equal(done.rows[0].status, 'approved', 'owner decision recorded');
  });
});

// ── PERFECT-100 §5.1 SEC-3 / §5.5 API-1: two doors leaked tenant-wide data to
// non-staff roles. Both are pinned here so the regression cannot return silently.
// Tokens are minted directly (the same idiom RT-7 #5 uses above) because Track F
// deliberately exhausts the /auth/login bucket — and these are authorization
// tests, not authentication tests, so the login path is not what is under test.
const mintedSessions = async () => {
  const { randomUUID } = await import('node:crypto');
  const { pool } = await import('../src/db.js');
  const user = (email) => pool.query(`SELECT id, tenant_id, role, name FROM app.users WHERE email=$1`, [email]).then((r) => r.rows[0]);
  const tokenFor = (u) => app.jwt.sign({ sub: u.id, role: u.role, tenant: u.tenant_id, name: u.name, jti: randomUUID() });
  return { user, tokenFor };
};

describe('PERFECT-100 SEC-3 + API-1: whole-school data is staff-only', () => {
  test('SEC-3: a student cannot read the whole-school attendance register', async () => {
    const { user, tokenFor } = await mintedSessions();
    const stu = tokenFor(await user('student@meridian.edu'));
    const res = await app.inject({ method: 'GET', url: '/attendance?grade=8', headers: { authorization: `Bearer ${stu}` } });
    assert.equal(res.statusCode, 403, `student must not read the school register (got ${res.statusCode}: ${res.body})`);
    assert.match(res.json().error, /staff-only/);
    assert.equal(res.json().rows, undefined, 'no register rows are returned in the refusal');

    // and the two legitimate readers are undisturbed by the new gate
    const te = tokenFor(await user('teacher@meridian.edu'));
    const staffRes = await app.inject({ method: 'GET', url: '/attendance?grade=8', headers: { authorization: `Bearer ${te}` } });
    assert.equal(staffRes.statusCode, 200, `teacher keeps the register (got ${staffRes.statusCode}: ${staffRes.body})`);
    const pa = tokenFor(await user('parent@meridian.edu'));
    const par = await app.inject({ method: 'GET', url: '/attendance', headers: { authorization: `Bearer ${pa}` } });
    assert.equal(par.statusCode, 200, par.body);
    assert.equal(par.json().scoped, 'own_children', 'parent scope is unchanged by the gate');
  });

  test('API-1: the tenant event lineage feed is not readable by student or parent', async () => {
    // the feed carries emitted_by/subject/correlation_id, and its labels embed OTHER
    // families' data (payment amounts, PTM bookings, book issues, safety reports).
    const { user, tokenFor } = await mintedSessions();
    for (const email of ['student@meridian.edu', 'parent@meridian.edu']) {
      const t = tokenFor(await user(email));
      const res = await app.inject({ method: 'GET', url: '/events/lineage', headers: { authorization: `Bearer ${t}` } });
      assert.equal(res.statusCode, 403, `${email} must not read /events/lineage (got ${res.statusCode}: ${res.body})`);
      assert.equal(res.json().lineage, undefined, 'no lineage rows in the refusal');
    }
    // the staff door that was always correct still works, and the two feeds now agree
    const pr = tokenFor(await user('principal@meridian.edu'));
    const feed = await app.inject({ method: 'GET', url: '/events', headers: { authorization: `Bearer ${pr}` } });
    const lin = await app.inject({ method: 'GET', url: '/events/lineage', headers: { authorization: `Bearer ${pr}` } });
    assert.equal(feed.statusCode, 200, feed.body);
    assert.equal(lin.statusCode, 200, `staff keep lineage (got ${lin.statusCode}: ${lin.body})`);
    assert.ok(Array.isArray(lin.json().lineage), 'lineage shape unchanged for staff');
  });
});
