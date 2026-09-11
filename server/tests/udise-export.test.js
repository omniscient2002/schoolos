// L3-3.2 — ops.udise: UDISE+-style statistical export. Pins: lifecycle gate (409
// off) · parent 403 · refuses without the UDISE code (configured-first) · deterministic
// CSV (two exports byte-identical) · counts match SQL ground truth · on-roll only
// (transferred students excluded) · gender split honestly not_recorded (no fabricated
// split) · staff + infrastructure sections match ground truth · audit + event. Style:
// tests/wave-b.test.js · WRITE-ONLY in-lane (D-10 — the orchestrator runs the suite).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { setupTestDb, loginAs } from './helpers.js';

let app;
let pool;
let owner, coordinator, teacher, parent;
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  pool = (await import('../src/db.js')).pool;
  owner = await loginAs(app, 'owner@meridian.edu');
  coordinator = await loginAs(app, 'coordinator@meridian.edu');
  teacher = await loginAs(app, 'teacher@meridian.edu');
  parent = await loginAs(app, 'parent@meridian.edu');
  const tenantId = (await pool.query(`SELECT tenant_id FROM app.users WHERE email='owner@meridian.edu'`)).rows[0].tenant_id;
  // born-at-signup catalog (L3 added the row) → self-heal gives the row to seeded tenants too
  const heal = await app.inject({ method: 'GET', url: '/plugins', headers: H(owner.token) });
  assert.equal(heal.statusCode, 200, heal.body);
  const row = (await pool.query(`SELECT plugin_id, class FROM app.plugins WHERE tenant_id=$1 AND plugin_id='ops.udise'`, [tenantId])).rows[0];
  assert.ok(row, 'ops.udise present in the tenant registry (catalog + self-heal)');
  const en = await app.inject({ method: 'POST', url: '/plugins/ops.udise/enable', headers: H(owner.token), payload: { version: '1.0.0', class: 'B' } });
  assert.equal(en.statusCode, 200, en.body);
  // stamp the UDISE code (the office would do this through the settings UI)
  await pool.query(`UPDATE app.plugins SET settings = settings || '{"udise_code":"19090100107","school_name":"Meridian International Academy"}'::jsonb WHERE tenant_id=$1 AND plugin_id='ops.udise'`, [tenantId]);
  // one student transferred out — must leave the on-roll counts
  const someone = (await pool.query(`SELECT id FROM app.students WHERE tenant_id=$1 AND status='active' AND name <> 'Aarav Sharma' ORDER BY admission_no LIMIT 1`, [tenantId])).rows[0];
  await pool.query(`UPDATE app.students SET status='transferred', bus_route=NULL WHERE id=$1`, [someone.id]);
  globalThis.__ud = { tenantId };
});

after(async () => { await app?.close(); });

describe('ops.udise export (L3-3.2)', () => {
  test('columns door documents the mapping (incl. the honest gender caveat)', async () => {
    const r = await app.inject({ method: 'GET', url: '/plugins/ops.udise/columns', headers: H(coordinator.token) });
    assert.equal(r.statusCode, 200, r.body);
    assert.match(JSON.stringify(r.json()), /not_recorded/);
    assert.match(JSON.stringify(r.json()), /students\.gender/);
  });

  test('parent/teacher 403 (office-tier export)', async () => {
    for (const who of [parent, teacher]) {
      const r = await app.inject({ method: 'GET', url: '/plugins/ops.udise/export', headers: H(who.token) });
      assert.equal(r.statusCode, 403, r.body);
    }
  });

  test('refuses without the UDISE code (configured-first), bad year format 400', async () => {
    const { tenantId } = globalThis.__ud;
    await pool.query(`UPDATE app.plugins SET settings = settings - 'udise_code' WHERE tenant_id=$1 AND plugin_id='ops.udise'`, [tenantId]);
    const no = await app.inject({ method: 'GET', url: '/plugins/ops.udise/export', headers: H(owner.token) });
    assert.equal(no.statusCode, 409, no.body);
    assert.match(no.json().error, /UDISE code/i);
    await pool.query(`UPDATE app.plugins SET settings = settings || '{"udise_code":"19090100107"}'::jsonb WHERE tenant_id=$1 AND plugin_id='ops.udise'`, [tenantId]);
    const bad = await app.inject({ method: 'GET', url: '/plugins/ops.udise/export?year=2026/27', headers: H(owner.token) });
    assert.equal(bad.statusCode, 400, bad.body);
    assert.match(bad.json().error, /2026-27/);
  });

  test('export CSV: counts match SQL ground truth, on-roll only, gender honestly not_recorded, deterministic bytes', async () => {
    const { tenantId } = globalThis.__ud;
    const year = '2026-27';
    const r1 = await app.inject({ method: 'GET', url: `/plugins/ops.udise/export?year=${year}`, headers: H(owner.token) });
    assert.equal(r1.statusCode, 200, r1.body);
    assert.match(r1.headers['content-type'], /text\/csv/);
    const r2 = await app.inject({ method: 'GET', url: `/plugins/ops.udise/export?year=${year}`, headers: H(owner.token) });
    assert.equal(r2.body, r1.body, 'deterministic: two exports byte-identical');
    const lines = r1.body.trim().split(/\r?\n/);
    const enr = lines.filter((l) => l.includes(',enrollment,'));
    const staff = lines.filter((l) => l.includes(',staff,'));
    const infra = lines.filter((l) => l.includes(',infrastructure,'));
    // ground truth (the transferred student already excluded by status='active')
    const truth = (await pool.query(
      `SELECT grade, section, count(*)::int AS total FROM app.students WHERE tenant_id=$1 AND status='active' GROUP BY grade, section ORDER BY length(grade), grade, section`,
      [tenantId])).rows;
    assert.equal(enr.length, truth.length, 'one enrollment row per grade-section');
    let csvTotal = 0;
    for (const [i, t] of truth.entries()) {
      const cells = enr[i].split(',');
      assert.equal(cells[0], '19090100107');
      assert.equal(cells[1], year);
      assert.equal(cells[3], 'enrollment', 'record_type column');
      assert.equal(cells[4], t.grade);
      assert.equal(Number(cells[5]), t.total);
      assert.equal(Number(cells[9]), t.total, 'not_recorded carries the true count');
      assert.equal(Number(cells[6]), 0, 'boys stays 0 — no fabricated split');
      csvTotal += Number(cells[5]);
    }
    const onRoll = (await pool.query(`SELECT count(*)::int AS c FROM app.students WHERE tenant_id=$1 AND status='active'`, [tenantId])).rows[0].c;
    assert.equal(csvTotal, onRoll, 'on-roll totals reconcile');
    // staff + infra rows exist and staff counts reconcile
    const staffTruth = (await pool.query(`SELECT role, count(*)::int AS n FROM app.users WHERE tenant_id=$1 AND active=true GROUP BY role ORDER BY role`, [tenantId])).rows;
    assert.equal(staff.length, staffTruth.length);
    for (const [i, t] of staffTruth.entries()) {
      const cells = staff[i].split(',');
      assert.equal(cells[4], t.role);
      assert.equal(Number(cells[5]), t.n);
    }
    const infraTruth = (await pool.query(`SELECT count(DISTINCT category)::int AS c FROM app.assets WHERE tenant_id=$1`, [tenantId])).rows[0].c;
    assert.equal(infra.length, infraTruth);
    // audit + event
    const audit = (await pool.query(`SELECT outcome FROM app.audit_log WHERE action='UDISE+ export generated' ORDER BY created_at DESC LIMIT 1`)).rows[0];
    assert.ok(audit, 'export is in the audit ledger');
    // topic rides app.outbox (the events row itself is keyed by type, not topic)
    const ob = (await pool.query(`SELECT id FROM app.outbox WHERE tenant_id=$1 AND topic='udise.export.completed' ORDER BY created_at DESC LIMIT 1`, [tenantId])).rows[0];
    assert.ok(ob, 'udise.export.completed on the outbox');
    const ev = (await pool.query(`SELECT id FROM app.events WHERE tenant_id=$1 AND type='ops' AND payload->>'udiseCode' IS NOT NULL ORDER BY created_at DESC LIMIT 1`, [tenantId])).rows[0];
    assert.ok(ev, 'events row carries the export payload');
    // json format carries the same csv + meta
    const j = await app.inject({ method: 'GET', url: `/plugins/ops.udise/export?year=${year}&format=json`, headers: H(owner.token) });
    assert.equal(j.statusCode, 200);
    assert.equal(j.json().csv, r1.body, 'json format wraps the same deterministic CSV');
    assert.equal(j.json().meta.onRollTotal, onRoll);
  });
});
