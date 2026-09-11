// Admissions→student executor (Wave 2 · L1-2.3): approving a students.create.<leadId>
// action creates the core student (+guardian rows from the lead), an
// enrollment_history admission row, and an audit trail — idempotent via the
// action's one-decision 409 and the (source='admissions', source_ref=leadId)
// structural lookup. Drives the REAL funnel lattice (enquiry→…→offer→enrolled).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';
import pg from 'pg';

let app;
let sql;
let ownerToken, principalToken;
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
  ownerToken = (await loginAs(app, 'owner@meridian.edu')).token;
  principalToken = (await loginAs(app, 'principal@meridian.edu')).token;
  // the funnel door is lifecycle-gated — switch Admissions on for the tenant
  // (enable = audited owner door; class is the plugin's governance class A–E)
  const en = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/enable', payload: { version: '1.0.0', class: 'C' }, headers: H(ownerToken) });
  assert.ok([200, 409].includes(en.statusCode), `enable: ${en.statusCode} ${en.body}`);
});
after(async () => { await app?.close(); });

// drive enquiry → form → interaction → offer → enrolled; the last hop raises the
// students.create.<leadId> kernel action and returns its id.
const convertLead = async (studentName, phone) => {
  const mk = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/leads', payload: {
    studentName, guardianName: `Guardian of ${studentName}`, guardianPhone: phone, classApplied: '5-A', source: 'walk-in',
  }, headers: H(ownerToken) });
  assert.equal(mk.statusCode, 200, mk.body);
  const leadId = mk.json().leadId;
  assert.ok(leadId, `lead id missing in ${mk.body}`);
  for (const to of ['form', 'interaction', 'offer', 'enrolled']) {
    const st = await app.inject({ method: 'POST', url: `/plugins/admissions.funnel/leads/${leadId}/stage`, payload: { to }, headers: H(ownerToken) });
    assert.equal(st.statusCode, 200, `${to}: ${st.body}`);
  }
  const act = await sql(`SELECT id, code FROM app.actions WHERE code=$1 AND status='open'`, [`students.create.${leadId}`]);
  assert.equal(act.rows.length, 1, 'exactly one open students.create action for the lead');
  return { leadId, actionId: act.rows[0].id };
};

test('AE · approve → student exists with guardian + enrollment_history admission row', async () => {
  const { leadId, actionId } = await convertLead('Aarav Executor', '+919000005001');
  const r = await app.inject({ method: 'POST', url: `/actions/${actionId}/decide`, payload: { decision: 'approved', note: 'admissions approved' }, headers: H(ownerToken) });
  assert.equal(r.statusCode, 200, r.body);
  const ex = r.json().execution;
  assert.equal(ex.type, 'student');
  assert.match(ex.admissionNo, /^ADM-\d{4}(-\d{2})?-[0-9A-F-]+$/i);
  assert.equal(ex.grade, '5');
  assert.equal(ex.section, 'A');
  const s = (await sql(`SELECT admission_no, name, grade, section, guardian_name, guardian_phone, status, source, source_ref
                        FROM app.students WHERE id=$1`, [ex.id])).rows[0];
  assert.equal(s.source, 'admissions');
  assert.equal(s.source_ref, leadId);
  assert.equal(s.status, 'active');
  assert.equal(s.name, 'Aarav Executor');
  assert.equal(s.grade, '5');
  assert.equal(s.section, 'A');
  const g = (await sql(`SELECT name, phone, is_primary FROM app.guardians WHERE student_id=$1`, [ex.id])).rows[0];
  assert.equal(g.name, 'Guardian of Aarav Executor');
  assert.equal(g.phone, '+919000005001');
  assert.equal(g.is_primary, true);
  const eh = (await sql(`SELECT from_grade, from_section, to_grade, to_section, reason FROM app.enrollment_history WHERE student_id=$1`, [ex.id])).rows[0];
  assert.equal(eh.to_grade, '5');
  assert.equal(eh.reason.includes('students.create.'), true, 'history row carries the action provenance');
  const a = (await sql(`SELECT status FROM app.actions WHERE id=$1`, [actionId])).rows[0];
  assert.equal(a.status, 'approved');
});

test('AE · double-approve is a 409 (one decision per action, atomic)', async () => {
  const { actionId } = await convertLead('Bhavana Executor', '+919000005002');
  const first = await app.inject({ method: 'POST', url: `/actions/${actionId}/decide`, payload: { decision: 'approved' }, headers: H(ownerToken) });
  assert.equal(first.statusCode, 200);
  const second = await app.inject({ method: 'POST', url: `/actions/${actionId}/decide`, payload: { decision: 'approved' }, headers: H(ownerToken) });
  assert.equal(second.statusCode, 409, 'the decide door refuses a second decision');
  const secondLead = (await sql(`SELECT source_ref FROM app.students WHERE source='admissions' ORDER BY created_at DESC LIMIT 1`)).rows[0];
  // and exactly ONE student row exists per converted lead
  const { leadId } = { leadId: secondLead.source_ref };
  const n = (await sql(`SELECT count(*)::int n FROM app.students WHERE source='admissions' AND source_ref=$1`, [leadId])).rows[0].n;
  assert.equal(n, 1, 'no duplicate student from a re-decided action');
});

test('AE · segregation of duties: principal cannot approve the unattributed admissions raise; owner can', async () => {
  const { actionId } = await convertLead('Chitra Executor', '+919000005003');
  const p = await app.inject({ method: 'POST', url: `/actions/${actionId}/decide`, payload: { decision: 'approved' }, headers: H(principalToken) });
  assert.equal(p.statusCode, 403, 'principal (owning desk, unattributed raise) must not self-approve');
  const o = await app.inject({ method: 'POST', url: `/actions/${actionId}/decide`, payload: { decision: 'approved' }, headers: H(ownerToken) });
  assert.equal(o.statusCode, 200, 'owner remains the second authority');
});

test('AE · per-instance codes: a SECOND lead converts cleanly after the first (P1-1 regression pin)', async () => {
  const a1 = await convertLead('Dev Executor', '+919000005004');
  const r1 = await app.inject({ method: 'POST', url: `/actions/${a1.actionId}/decide`, payload: { decision: 'approved' }, headers: H(ownerToken) });
  assert.equal(r1.statusCode, 200, r1.body);
  const a2 = await convertLead('Esha Executor', '+919000005005');
  const r2 = await app.inject({ method: 'POST', url: `/actions/${a2.actionId}/decide`, payload: { decision: 'approved' }, headers: H(ownerToken) });
  assert.equal(r2.statusCode, 200, r2.body);
  assert.notEqual(r1.json().execution.id, r2.json().execution.id, 'two distinct students');
});
