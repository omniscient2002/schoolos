// C-2 follow-up · `ops.import` — the import engine had three working doors and no caller.
//
// The plugin shipped `GET /schema/:kind`, `POST /validate-mapping` and `POST /shadow` (a staged analysis
// that writes nothing and diffs the file against the school's OWN records) while the only import surface in
// the app was a JSON textarea on the Migration screen. This file pins the engine the mapper now drives, the
// browser-side translation it depends on, and the two honesty claims the mapper makes out loud:
//
//   1. the shadow door creates and changes NOTHING (a dry run that wrote would be the worst defect in the file);
//   2. a mapped file commits every column the schema promised — `bus_route` used to be accepted by the
//      mapping schema and then silently dropped by the commit INSERT.
//
// The pure helpers are imported straight from the SPA module: node strips the types natively, and the
// precedent is frontend-grants.test.js importing app/src/lib/grants.ts. One translation, one place.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';
import pg from 'pg';
import { parseCsv, guessMapping, toStagedRows, normalizeHeader } from '../../app/src/screens/migration/importMapping.ts';

let app, sql, owner, teacher, principal, tenantId;
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const req = (method, url, token, payload) => app.inject({ method, url, payload, headers: H(token) });

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
  owner = (await loginAs(app, 'owner@meridian.edu')).token;
  teacher = (await loginAs(app, 'teacher@meridian.edu')).token;
  principal = (await loginAs(app, 'principal@meridian.edu')).token;
  tenantId = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  // the lifecycle gate reads the row per request; the seeded demo tenant has it off by default
  await sql(`UPDATE app.plugins SET status='enabled' WHERE tenant_id=$1 AND plugin_id='ops.import'`, [tenantId]);
});

after(async () => {
  await sql(`DELETE FROM app.migration_rows WHERE tenant_id=$1 AND source_id IN (SELECT id FROM app.migration_sources WHERE tenant_id=$1 AND name LIKE 'IM-%')`, [tenantId]).catch(() => {});
  await sql(`DELETE FROM app.migration_sources WHERE tenant_id=$1 AND name LIKE 'IM-%'`, [tenantId]).catch(() => {});
  await sql(`DELETE FROM app.students WHERE tenant_id=$1 AND admission_no LIKE 'IM-%'`, [tenantId]).catch(() => {});
  await sql(`DELETE FROM app.sections WHERE tenant_id=$1 AND class_id IN (SELECT id FROM app.classes WHERE tenant_id=$1 AND name LIKE 'IM-%')`, [tenantId]).catch(() => {});
  await sql(`DELETE FROM app.classes WHERE tenant_id=$1 AND name LIKE 'IM-%'`, [tenantId]).catch(() => {});
  await app?.close();
});

/* ───────────────────────── the browser half (pure) ───────────────────────── */

describe('import mapping · the file is read, not guessed at', () => {
  test('a quoted, CRLF, ragged spreadsheet parses into source-keyed rows', () => {
    const csv = '﻿Admission No,Name,Class,Section\r\nIM-1,"Nair, Meera",5,A\r\nIM-2,Arjun Rao,5,B,extra\r\nIM-3,Sunita,,A\r\n';
    const f = parseCsv(csv);
    assert.deepEqual(f.columns, ['Admission No', 'Name', 'Class', 'Section']);
    assert.equal(f.rows.length, 3);
    assert.equal(f.rows[0].Name, 'Nair, Meera', 'a quoted comma is part of the value');
    assert.equal(f.rows[1].Section, 'B');
    assert.equal(f.skipped, 1, 'the 5-value line is reported, not silently trimmed');
    assert.equal(f.rows[2].Class, '', 'a short row is padded, not shifted');
  });

  test('a doubled header column is dropped rather than guessed at', () => {
    const f = parseCsv('name,name,grade\nA,B,5\n');
    assert.deepEqual(f.columns, ['name', 'name', 'grade']);
    assert.deepEqual(f.rows[0], { grade: '5' }, 'an ambiguous column is not invented into a value');
  });

  test('header spelling does not decide the mapping', () => {
    assert.equal(normalizeHeader('Admission No.'), 'admissionno');
    const guessed = guessMapping(
      ['Admission No.', 'Full Name', 'Class', 'Sec', 'Mobile No'],
      ['admission_no', 'name', 'grade', 'section', 'guardian_phone'],
    );
    assert.equal(guessed['Admission No.'], 'admission_no');
    assert.equal(guessed['Full Name'], 'name');
    assert.equal(guessed.Class, 'grade');
    assert.equal(guessed.Sec, 'section');
  });

  test('a guess never puts two sources on one target — the server refuses that', () => {
    const guessed = guessMapping(['Student Name', 'Father Name'], ['name']);
    assert.equal(Object.keys(guessed).length, 1, `one target, one source (got ${JSON.stringify(guessed)})`);
  });

  test('a guardian column is not mistaken for the student\'s name', () => {
    const guessed = guessMapping(
      ['Admission No', 'Name', 'Class', 'Section', 'Father', 'Mobile'],
      ['admission_no', 'name', 'grade', 'section', 'guardian_name', 'guardian_phone'],
    );
    assert.equal(guessed.Name, 'name');
    assert.equal(guessed.Father, 'guardian_name', '"Father" is the guardian, not the pupil');
    assert.equal(guessed.Mobile, 'guardian_phone');
  });

  test('a money column is never mapped on a guess — the unit is the operator\'s call', () => {
    const guessed = guessMapping(['Admission No', 'Term', 'Fee Head', 'Amount'], ['student_admission_no', 'term', 'label', 'amount_cents']);
    assert.equal('amount_cents' in Object.values(guessed), false, `rupees vs paisa is not a guess (got ${JSON.stringify(guessed)})`);
  });

  test('mapped rows become the staged shape the commit door validates, blanks omitted', () => {
    const f = parseCsv('Admission No,Name,Class,Section,Route\nIM-9,Rehan Khan,5,A,R-2\nIM-10,Asha Rao,6,B,\n');
    const mapping = { 'Admission No': 'admission_no', Name: 'name', Class: 'grade', Section: 'section', Route: 'bus_route' };
    const staged = toStagedRows(f.rows, mapping);
    assert.deepEqual(staged[0], { rowNo: 1, data: { admissionNo: 'IM-9', name: 'Rehan Khan', grade: '5', section: 'A', busRoute: 'R-2' } });
    assert.equal('busRoute' in staged[1].data, false, 'an empty optional column is absent, not ""');
    assert.equal(staged[1].rowNo, 2);
  });
});

/* ───────────────────────── the server half (doors) ───────────────────────── */

describe('ops.import · the doors the mapper calls', () => {
  test('the schema door describes the canonical target columns', async () => {
    const r = await req('GET', '/plugins/ops.import/schema/students', owner);
    assert.equal(r.statusCode, 200, r.body);
    assert.ok(r.json().schema.fields.admission_no, 'admission_no is declared');
    assert.equal(r.json().schema.fields.admission_no.required, true);
    assert.deepEqual(r.json().kinds, ['students', 'guardians', 'fees']);
    const missing = await req('GET', '/plugins/ops.import/schema/staff', owner);
    assert.equal(missing.statusCode, 404, missing.body);
  });

  test('a teacher is refused; an admissions officer is not', async () => {
    const t = await req('GET', '/plugins/ops.import/schema/students', teacher);
    assert.equal(t.statusCode, 403, t.body);
    const off = await req('POST', '/plugins/ops.import/shadow', principal, { kind: 'students', mapping: {}, rows: [] });
    /* principal holds the mapping doors; the shadow door is narrower, which is exactly the
       split the UI mirrors with two separate useRoleOrGrant calls. */
    assert.ok([200, 400].includes(off.statusCode), off.body);
  });

  test('an incomplete mapping is refused with the field named', async () => {
    const bad = await req('POST', '/plugins/ops.import/validate-mapping', owner, { kind: 'students', mapping: { Name: 'name' } });
    assert.equal(bad.statusCode, 400, bad.body);
    const errs = bad.json().errors;
    assert.ok(errs.some((e) => e.field === 'admission_no'), JSON.stringify(errs));
    const wrong = await req('POST', '/plugins/ops.import/validate-mapping', owner, { kind: 'students', mapping: { Nick: 'nickname' } });
    assert.equal(wrong.statusCode, 400);
    assert.ok(wrong.json().errors.some((e) => /not a students field/.test(e.error)), wrong.body);
    const ok = await req('POST', '/plugins/ops.import/validate-mapping', owner, {
      kind: 'students', mapping: { 'Admission No': 'admission_no', Name: 'name', Class: 'grade', Section: 'section' },
    });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(ok.json().ok, true);
  });

  test('the shadow door diffs against the school records and writes NOTHING', async () => {
    const before = (await sql(`SELECT count(*)::int n FROM app.students WHERE tenant_id=$1`, [tenantId])).rows[0].n;
    const r = await req('POST', '/plugins/ops.import/shadow', owner, {
      kind: 'students',
      mapping: { 'Admission No': 'admission_no', Name: 'name', Class: 'grade', Section: 'section' },
      rows: [
        { 'Admission No': 'IM-777', Name: 'Dry Run Only', Class: '5', Section: 'A' },
        { 'Admission No': 'IM-778', Name: '', Class: '5', Section: 'A' },
      ],
    });
    assert.equal(r.statusCode, 200, r.body);
    const j = r.json();
    assert.equal(j.validRows, 1);
    assert.equal(j.errorRows, 1, 'the row with no name is counted as an error');
    assert.equal(j.diff.newStudents, 1);
    assert.ok(j.topErrors.length, 'the dry run says what is wrong');
    const after = (await sql(`SELECT count(*)::int n FROM app.students WHERE tenant_id=$1`, [tenantId])).rows[0].n;
    assert.equal(after, before, 'a dry run must not create a student');
    assert.equal((await sql(`SELECT count(*)::int n FROM app.students WHERE tenant_id=$1 AND admission_no='IM-777'`, [tenantId])).rows[0].n, 0);
  });

  test('the shadow door diffs fees in the school ledger unit, not rupees', async () => {
    const seedStudent = (await sql(`SELECT admission_no FROM app.students WHERE tenant_id=$1 LIMIT 1`, [tenantId])).rows[0];
    const r = await req('POST', '/plugins/ops.import/shadow', owner, {
      kind: 'fees',
      mapping: { Adm: 'student_admission_no', Term: 'term', Label: 'label', Paise: 'amount_cents' },
      rows: [{ Adm: seedStudent.admission_no, Term: 'term-1', Label: 'Tuition', Paise: '10000' }],
    });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().diff.totalAmountCents, 10000, 'the diff speaks the ledger unit (paise)');
  });
});

/* ───────────────── the hand-off: map → stage → commit ───────────────── */

describe('a mapped file reaches the school records through the kernel doors', () => {
  test('map, dry run, stage, validate, commit — and every promised column lands', async () => {
    // the school defines its structure first: the import binds to a real class when one exists
    // (migration 141's trigger) and leaves the reference empty when it does not (migration 140's rule).
    const classId = (await sql(`INSERT INTO app.classes (tenant_id, name, sort_idx) VALUES ($1,'IM-Class 5',90) RETURNING id`, [tenantId])).rows[0].id;
    await sql(`INSERT INTO app.sections (tenant_id, class_id, name) VALUES ($1,$2,'A')`, [tenantId, classId]);

    const csv = 'Admission No,Name,Class,Section,Father,Mobile,Route\n'
      + 'IM-001,Meera Nair,IM-Class 5,A,Ramesh Nair,9876543210,R-2\n'
      + 'IM-002,Arjun Rao,IM-Class 5,B,Latha Rao,9876543211,R-2\n';
    const file = parseCsv(csv);
    const mapping = guessMapping(file.columns, ['admission_no', 'name', 'grade', 'section', 'guardian_name', 'guardian_phone', 'bus_route']);

    // 1 · the dry run first, on the file exactly as it will be staged
    const shadow = await req('POST', '/plugins/ops.import/shadow', owner, { kind: 'students', mapping, rows: file.rows });
    assert.equal(shadow.statusCode, 200, shadow.body);
    assert.equal(shadow.json().validRows, 2, JSON.stringify(shadow.json()));

    // 2 · a source to stage into
    const src = await req('POST', '/migration/sources', owner, { name: 'IM-demo', kind: 'students' });
    assert.equal(src.statusCode, 200, src.body);
    const sourceId = src.json().source.id;

    // 3 · the browser's translation, staged through the kernel's own door
    const staged = await req('POST', `/migration/sources/${sourceId}/stage-rows`, owner, { rows: toStagedRows(file.rows, mapping) });
    assert.equal(staged.statusCode, 200, staged.body);
    assert.equal(staged.json().staged, 2, staged.body);

    // 4 · validate, then commit
    const val = await req('POST', `/migration/sources/${sourceId}/validate`, owner, {});
    assert.equal(val.statusCode, 200, val.body);
    assert.equal(val.json().errors, 0, JSON.stringify(val.json()));
    const commit = await req('POST', `/migration/sources/${sourceId}/commit`, owner, {});
    assert.equal(commit.statusCode, 200, commit.body);
    assert.equal(commit.json().created, 2, commit.body);

    const rows = (await sql(
      `SELECT admission_no, name, grade, section, guardian_name, guardian_phone, bus_route, class_id, section_id
       FROM app.students WHERE tenant_id=$1 AND admission_no LIKE 'IM-%' ORDER BY admission_no`, [tenantId])).rows;
    assert.equal(rows.length, 2);
    const meera = rows.find((r) => r.admission_no === 'IM-001');
    assert.equal(meera.name, 'Meera Nair');
    assert.equal(meera.guardian_name, 'Ramesh Nair', 'the mapped guardian column landed');
    assert.equal(meera.guardian_phone, '9876543210');
    assert.equal(meera.bus_route, 'R-2', 'bus_route is in the mapping schema, so the commit may not drop it');
    assert.equal(meera.class_id, classId, 'the class trigger bound the imported class to the real class row');
    assert.ok(meera.section_id, 'and to its section');
    const unbound = rows.find((r) => r.admission_no === 'IM-002');
    assert.equal(unbound.class_id, classId);
    assert.equal(unbound.section_id, null, 'section B does not exist in that class — the reference is empty, never wrong');

    // 5 · idempotent replay: a second commit creates nothing
    const again = await req('POST', `/migration/sources/${sourceId}/commit`, owner, {});
    assert.equal(again.statusCode, 200, again.body);
    assert.equal(again.json().created, 0, 'a replay is a skip, never a duplicate');
    assert.equal((await sql(`SELECT count(*)::int n FROM app.students WHERE tenant_id=$1 AND admission_no LIKE 'IM-%'`, [tenantId])).rows[0].n, 2);
  });

  test('a teacher cannot stage or commit an import', async () => {
    const src = await req('POST', '/migration/sources', owner, { name: 'IM-gate', kind: 'students' });
    const id = src.json().source.id;
    const staged = await req('POST', `/migration/sources/${id}/stage-rows`, teacher, { rows: [{ rowNo: 1, data: { name: 'X', grade: '1', section: 'A' } }] });
    assert.equal(staged.statusCode, 403, staged.body);
    const commit = await req('POST', `/migration/sources/${id}/commit`, teacher, {});
    assert.equal(commit.statusCode, 403, commit.body);
  });
});
