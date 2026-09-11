// L3-4.1 — ops.import engine: mapping validator · row-level error collection ·
// shadow-load (zero domain writes) · dry-run diff summary. Pins: unknown kind → 400/404;
// required-field and duplicate-mapping errors; row coercion (uppercase section, phone
// shape, integer cents, date shape); shadow diff against REAL records (collision count,
// class distribution, unresolved guardians/fees) with NOTHING written (row counts before
// == after); audit + event on shadow runs. Style: tests/wave-b.test.js · WRITE-ONLY
// in-lane (D-10 — the orchestrator runs the suite).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { setupTestDb, loginAs } from './helpers.js';

let app;
let pool;
let owner, coordinator, parent;
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  pool = (await import('../src/db.js')).pool;
  owner = await loginAs(app, 'owner@meridian.edu');
  coordinator = await loginAs(app, 'coordinator@meridian.edu');
  parent = await loginAs(app, 'parent@meridian.edu');
  const tenantId = (await pool.query(`SELECT tenant_id FROM app.users WHERE email='owner@meridian.edu'`)).rows[0].tenant_id;
  const heal = await app.inject({ method: 'GET', url: '/plugins', headers: H(owner.token) });
  assert.equal(heal.statusCode, 200, heal.body);
  const row = (await pool.query(`SELECT plugin_id FROM app.plugins WHERE tenant_id=$1 AND plugin_id='ops.import'`, [tenantId])).rows[0];
  assert.ok(row, 'ops.import present in the tenant registry');
  const en = await app.inject({ method: 'POST', url: '/plugins/ops.import/enable', headers: H(owner.token), payload: { version: '1.0.0', class: 'B' } });
  assert.equal(en.statusCode, 200, en.body);
  const beforeCounts = {
    students: (await pool.query(`SELECT count(*)::int AS c FROM app.students WHERE tenant_id=$1`, [tenantId])).rows[0].c,
    guardians: (await pool.query(`SELECT count(*)::int AS c FROM app.guardians WHERE tenant_id=$1`, [tenantId])).rows[0].c,
    fees: (await pool.query(`SELECT count(*)::int AS c FROM app.fee_obligations WHERE tenant_id=$1`, [tenantId])).rows[0].c,
  };
  globalThis.__oi = { tenantId, beforeCounts };
});

after(async () => { await app?.close(); });

describe('ops.import engine (L3-4.1)', () => {
  test('schema door: canonical fields per kind; unknown kind 404; parent 403', async () => {
    const s = await app.inject({ method: 'GET', url: '/plugins/ops.import/schema/students', headers: H(coordinator.token) });
    assert.equal(s.statusCode, 200, s.body);
    assert.ok(s.json().schema.fields.admission_no.required);
    const g = await app.inject({ method: 'GET', url: '/plugins/ops.import/schema/fees', headers: H(coordinator.token) });
    assert.equal(g.json().schema.fields.amount_cents.type, 'integer');
    const unk = await app.inject({ method: 'GET', url: '/plugins/ops.import/schema/vehicles', headers: H(coordinator.token) });
    assert.equal(unk.statusCode, 404);
    const par = await app.inject({ method: 'GET', url: '/plugins/ops.import/schema/students', headers: H(parent.token) });
    assert.equal(par.statusCode, 403);
  });

  test('mapping validator: required gaps, unknown targets, double-mapped target/source, duplicate source', async () => {
    const bad1 = await app.inject({ method: 'POST', url: '/plugins/ops.import/validate-mapping', headers: H(owner.token),
      payload: { kind: 'students', mapping: { 'Student Name': 'name' } } });
    assert.equal(bad1.statusCode, 400);
    assert.ok(bad1.json().errors.some((e) => e.field === 'admission_no'), 'missing required field reported');
    const bad2 = await app.inject({ method: 'POST', url: '/plugins/ops.import/validate-mapping', headers: H(owner.token),
      payload: { kind: 'students', mapping: { Admission: 'admission_no', Name: 'name', Grade: 'grade', Section: 'section', Ghost: 'notAField', Name2: 'name' } } });
    assert.equal(bad2.statusCode, 400);
    assert.ok(bad2.json().errors.some((e) => /not a students field/.test(e.error)), 'unknown target rejected');
    assert.ok(bad2.json().errors.some((e) => /mapped from two sources/.test(e.error)), 'double-mapped target rejected');
    const ok = await app.inject({ method: 'POST', url: '/plugins/ops.import/validate-mapping', headers: H(owner.token),
      payload: { kind: 'students', mapping: { Admission: 'admission_no', Name: 'name', Grade: 'grade', Section: 'section', Phone: 'guardian_phone' } } });
    assert.equal(ok.statusCode, 200, ok.body);
  });

  test('shadow: row-level collection (per-field errors), coercions, and a REAL-records diff — writing nothing', async () => {
    const { tenantId, beforeCounts } = globalThis.__oi;
    const existingAdm = (await pool.query(`SELECT admission_no FROM app.students WHERE tenant_id=$1 ORDER BY admission_no LIMIT 1`, [tenantId])).rows[0].admission_no;
    const mapping = { Admission: 'admission_no', Name: 'name', Grade: 'grade', Section: 'section', Guardian: 'guardian_name', Phone: 'guardian_phone' };
    const rows = [
      { Admission: 'IMP-1', Name: 'New Kid One', Grade: '6', Section: 'a', Guardian: 'Guardian One', Phone: '+91 9811111111' },   // valid (section lowercased→upper)
      { Admission: existingAdm, Name: 'Collision Kid', Grade: '8', Section: 'B' },                                              // collides with records
      { Admission: 'IMP-3', Name: '', Grade: '7', Section: 'C' },                                                               // name required
      { Admission: 'IMP-4', Name: 'Bad Phone', Grade: '7', Section: 'C', Phone: 'hello' },                                      // phone shape
      { Admission: 'IMP-1', Name: 'Dup In File', Grade: '6', Section: 'A' },                                                    // duplicate admission_no in file
      { Admission: 'IMP-6', Name: 'Long Name ' + 'x'.repeat(130), Grade: '8', Section: 'B' },                                   // over cap
    ];
    const r = await app.inject({ method: 'POST', url: '/plugins/ops.import/shadow', headers: H(owner.token),
      payload: { kind: 'students', mapping, rows } });
    assert.equal(r.statusCode, 200, r.body);
    const body = r.json();
    assert.equal(body.totalRows, 6);
    assert.equal(body.validRows, 3, 'rows 2 (existing admission_no) and 5 (dup in file) are DIFF findings, not row errors — only 3 rows have field errors');
    assert.equal(body.errorRows, 3);
    assert.ok(body.topErrors.length >= 1, 'error histogram present');
    assert.equal(body.diff.collisionsWithRecords, 1, 'existing admission_no flagged');
    assert.equal(body.diff.newStudents, 2, 'IMP-1 + IMP-1-dup count as new (commit path dedupes)');
    assert.ok(body.diff.classDistribution['6-A'] >= 1, 'class distribution computed');
    assert.match(body.diff.wouldWrite, /app\.students/);
    // ZERO domain writes
    const afterCounts = {
      students: (await pool.query(`SELECT count(*)::int AS c FROM app.students WHERE tenant_id=$1`, [tenantId])).rows[0].c,
      guardians: (await pool.query(`SELECT count(*)::int AS c FROM app.guardians WHERE tenant_id=$1`, [tenantId])).rows[0].c,
      fees: (await pool.query(`SELECT count(*)::int AS c FROM app.fee_obligations WHERE tenant_id=$1`, [tenantId])).rows[0].c,
    };
    assert.deepEqual(afterCounts, beforeCounts, 'shadow mode writes NOTHING');
    const audit = (await pool.query(`SELECT outcome FROM app.audit_log WHERE action='Import shadow-run analyzed' ORDER BY created_at DESC LIMIT 1`)).rows[0];
    assert.ok(audit, 'shadow run audited');
    const ob = (await pool.query(`SELECT id FROM app.outbox WHERE tenant_id=$1 AND topic='ops.import.shadow.completed' ORDER BY created_at DESC LIMIT 1`, [tenantId])).rows[0];
    assert.ok(ob, 'shadow topic on the outbox');
    const ev = (await pool.query(`SELECT id FROM app.events WHERE tenant_id=$1 AND type='ops' AND payload->>'kind'='students' ORDER BY created_at DESC LIMIT 1`, [tenantId])).rows[0];
    assert.ok(ev, 'shadow events row carries the report payload');
  });

  test('shadow: fees diff totals by term and flags unresolved students; guardians diff resolves against records', async () => {
    const { tenantId } = globalThis.__oi;
    const realAdm = (await pool.query(`SELECT admission_no FROM app.students WHERE tenant_id=$1 ORDER BY admission_no LIMIT 1`, [tenantId])).rows[0].admission_no;
    const feeMap = { Admission: 'student_admission_no', Term: 'term', Label: 'label', Due: 'due_on', Paise: 'amount_cents' };
    const fr = await app.inject({ method: 'POST', url: '/plugins/ops.import/shadow', headers: H(owner.token),
      payload: { kind: 'fees', mapping: feeMap, rows: [
        { Admission: realAdm, Term: 'term-1', Label: 'Tuition Apr', Due: '2026-04-10', Paise: '120000' },
        { Admission: 'NOPE-404', Term: 'term-1', Label: 'Tuition May', Paise: '120000' },
        { Admission: realAdm, Term: 'term-1', Label: 'Bad Amount', Paise: '-5' },
      ] } });
    assert.equal(fr.statusCode, 200, fr.body);
    const f = fr.json();
    assert.equal(f.validRows, 2);
    assert.equal(f.diff.totalAmountCents, 240000);
    assert.equal(f.diff.rowsWithUnresolvedStudent, 1);
    assert.equal(f.diff.unresolvedAmountCents, 120000);
    assert.equal(f.diff.byTermCents['term-1'], 240000);
    const gMap = { Admission: 'student_admission_no', Name: 'name', Phone: 'phone', Relation: 'relation' };
    const gr = await app.inject({ method: 'POST', url: '/plugins/ops.import/shadow', headers: H(owner.token),
      payload: { kind: 'guardians', mapping: gMap, rows: [
        { Admission: realAdm, Name: 'Real Guardian', Phone: '+91 9822222222', Relation: 'mother' },
        { Admission: realAdm, Name: 'Bad Rel', Phone: '+91 9822222223', Relation: 'uncle' },
      ] } });
    assert.equal(gr.statusCode, 200, gr.body);
    assert.equal(gr.json().validRows, 1, 'enum violation lands per-row');
    assert.equal(gr.json().diff.studentsResolved, 1);
  });

  test('shadow refuses a bad mapping (400) and parent 403', async () => {
    const par = await app.inject({ method: 'POST', url: '/plugins/ops.import/shadow', headers: H(parent.token),
      payload: { kind: 'students', mapping: {}, rows: [] } });
    assert.equal(par.statusCode, 403);
    const badMap = await app.inject({ method: 'POST', url: '/plugins/ops.import/shadow', headers: H(owner.token),
      payload: { kind: 'students', mapping: { Name: 'name' }, rows: [] } });
    assert.equal(badMap.statusCode, 400);
  });
});
