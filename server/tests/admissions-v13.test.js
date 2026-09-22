// admissions.funnel v1.3 — domain-completion tests (migration 119/120).
// Pins: edit door, waitlisted lattice, visit/interview scheduling, documents,
// offer letter, health/orphan probe, SLA sweep, guardian comms on offer,
// the admissions role reaching its own funnel (C-1), and class normalisation (B-4).
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
    const r = await c.query(text, params);
    await c.end();
    return r;
  };
  const o = await loginAs(app, 'owner@meridian.edu');
  const en = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/enable', headers: H(o.token), payload: {} });
  assert.equal(en.statusCode, 200, en.body);
});

describe('admissions.funnel v1.3 — domain completion', () => {
  test('1 · admissions role reaches its own funnel (C-1) and can capture', async () => {
    const adm = await loginAs(app, 'admissions@meridian.edu');
    const r = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/leads',
      payload: { studentName: 'Adm Role Kid', guardianPhone: '9800000001', classApplied: 'Grade 6' }, headers: H(adm.token) });
    assert.equal(r.statusCode, 200, r.body);
    const list = await app.inject({ method: 'GET', url: '/plugins/admissions.funnel/leads', headers: H(adm.token) });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().masked, false, 'admissions is a FULL_PII tier');
    const lead = list.json().leads.find((x) => x.id === r.json().leadId);
    assert.equal(lead.guardianPhone, '+919800000001', 'full guardian phone for the admissions desk');
  });

  test('2 · edit door corrects a lead; class normalisation strips "Grade"', async () => {
    const adm = await loginAs(app, 'admissions@meridian.edu');
    const c = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/leads',
      payload: { studentName: 'Typo Kid', guardianPhone: '9800000002', classApplied: 'Grade 7' }, headers: H(adm.token) });
    const id = c.json().leadId;
    const e = await app.inject({ method: 'PATCH', url: `/plugins/admissions.funnel/leads/${id}`,
      payload: { studentName: 'Correct Kid', guardianPhone: '9800000003' }, headers: H(adm.token) });
    assert.equal(e.statusCode, 200, e.body);
    assert.equal(e.json().lead.student_name, 'Correct Kid');
    assert.equal(e.json().lead.guardian_phone, '+919800000003');
    // convert and assert the parsed grade is the bare "7", not "Grade 7" (B-4)
    for (const to of ['form', 'interaction', 'offer', 'enrolled']) {
      await app.inject({ method: 'POST', url: `/plugins/admissions.funnel/leads/${id}/stage`, payload: { to }, headers: H(adm.token) });
    }
    const o = await loginAs(app, 'owner@meridian.edu');
    const acts = await sql(`SELECT id FROM app.actions WHERE payload->>'leadId'=$1 AND status='open'`, [id]);
    await app.inject({ method: 'POST', url: `/actions/${acts.rows[0].id}/decide`, payload: { decision: 'approved' }, headers: H(o.token) });
    const s = await sql(`SELECT grade, section FROM app.students WHERE source_ref=$1`, [id]);
    assert.equal(s.rows[0].grade, '7', 'free-text "Grade 7" normalises to "7"');
  });

  test('3 · waitlisted is a real lattice state and can convert', async () => {
    const adm = await loginAs(app, 'admissions@meridian.edu');
    const c = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/leads',
      payload: { studentName: 'Waitlist Kid', guardianPhone: '9800000004', classApplied: '3' }, headers: H(adm.token) });
    const id = c.json().leadId;
    for (const to of ['form', 'interaction', 'offer', 'waitlisted']) {
      const r = await app.inject({ method: 'POST', url: `/plugins/admissions.funnel/leads/${id}/stage`, payload: { to }, headers: H(adm.token) });
      assert.equal(r.statusCode, 200, `${to}: ${r.body}`);
    }
    const toEnrolled = await app.inject({ method: 'POST', url: `/plugins/admissions.funnel/leads/${id}/stage`, payload: { to: 'enrolled' }, headers: H(adm.token) });
    assert.equal(toEnrolled.statusCode, 200, toEnrolled.body);
    assert.ok(toEnrolled.json().actionId, 'waitlisted → enrolled raises the conversion action');
  });

  test('4 · visit/interview scheduling + documents attach', async () => {
    const adm = await loginAs(app, 'admissions@meridian.edu');
    const c = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/leads',
      payload: { studentName: 'Sched Kid', guardianPhone: '9800000005', classApplied: '4' }, headers: H(adm.token) });
    const id = c.json().leadId;
    const a = await app.inject({ method: 'POST', url: `/plugins/admissions.funnel/leads/${id}/activities`,
      payload: { kind: 'interview', scheduledAt: new Date(Date.now() + 86400000).toISOString(), outcome: 'pending' }, headers: H(adm.token) });
    assert.equal(a.statusCode, 200, a.body);
    const list = await app.inject({ method: 'GET', url: `/plugins/admissions.funnel/leads/${id}/activities`, headers: H(adm.token) });
    assert.equal(list.json().activities.length, 1);
    assert.equal(list.json().activities[0].kind, 'interview');
    const d = await app.inject({ method: 'POST', url: `/plugins/admissions.funnel/leads/${id}/documents`,
      payload: { fileId: '11111111-2222-3333-4444-555555555555', label: 'Birth certificate' }, headers: H(adm.token) });
    assert.equal(d.statusCode, 200, d.body);
    assert.equal(d.json().documents.length, 1);
    assert.equal(d.json().documents[0].label, 'Birth certificate');
  });

  test('5 · offer letter is available only after an offer and names the student', async () => {
    const adm = await loginAs(app, 'admissions@meridian.edu');
    const c = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/leads',
      payload: { studentName: 'Letter Kid', guardianName: 'R. Letter', guardianPhone: '9800000006', classApplied: '5' }, headers: H(adm.token) });
    const id = c.json().leadId;
    const early = await app.inject({ method: 'GET', url: `/plugins/admissions.funnel/leads/${id}/offer-letter`, headers: H(adm.token) });
    assert.equal(early.statusCode, 409, 'no offer yet → 409');
    for (const to of ['form', 'interaction', 'offer']) {
      await app.inject({ method: 'POST', url: `/plugins/admissions.funnel/leads/${id}/stage`, payload: { to }, headers: H(adm.token) });
    }
    const letter = await app.inject({ method: 'GET', url: `/plugins/admissions.funnel/leads/${id}/offer-letter`, headers: H(adm.token) });
    assert.equal(letter.statusCode, 200, letter.body);
    assert.match(letter.json().letter, /Letter Kid/);
    assert.match(letter.json().letter, /OFFER OF ADMISSION/);
  });

  test('6 · offer transition queues a guardian notice (F-4), not a send', async () => {
    const adm = await loginAs(app, 'admissions@meridian.edu');
    const c = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/leads',
      payload: { studentName: 'Notice Kid', guardianPhone: '9800000007', classApplied: '6' }, headers: H(adm.token) });
    const id = c.json().leadId;
    for (const to of ['form', 'interaction', 'offer']) {
      await app.inject({ method: 'POST', url: `/plugins/admissions.funnel/leads/${id}/stage`, payload: { to }, headers: H(adm.token) });
    }
    const rows = (await sql(`SELECT template, status, audience_json FROM app.communications WHERE dedup_key=$1`, [`admission.offer:${id}`])).rows;
    assert.equal(rows.length, 1, 'exactly one queued offer notice');
    assert.equal(rows[0].template, 'ADMISSION_OFFER');
    assert.equal(rows[0].status, 'queued', 'queued — delivery is the dispatcher\'s job');
    assert.deepEqual(rows[0].audience_json, ['+919800000007']);
  });

  test('7 · health probe reports the lattice and reconciles orphans', async () => {
    const o = await loginAs(app, 'owner@meridian.edu');
    const h = await app.inject({ method: 'GET', url: '/plugins/admissions.funnel/health', headers: H(o.token) });
    assert.equal(h.statusCode, 200, h.body);
    assert.equal(h.json().probe, 'stage-lattice');
    assert.equal(typeof h.json().openLeads, 'number');
    assert.ok(h.json().stages.enquiry, 'stage counts present');
    // force a stranded enrolled lead (no student, no open action) and re-probe
    const adm = await loginAs(app, 'admissions@meridian.edu');
    const c = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/leads',
      payload: { studentName: 'Stranded Kid', guardianPhone: '9800000008', classApplied: '2' }, headers: H(adm.token) });
    const id = c.json().leadId;
    for (const to of ['form', 'interaction', 'offer', 'enrolled']) {
      await app.inject({ method: 'POST', url: `/plugins/admissions.funnel/leads/${id}/stage`, payload: { to }, headers: H(adm.token) });
    }
    // dismiss the action so the lead is stranded at enrolled
    const act = (await sql(`SELECT id FROM app.actions WHERE payload->>'leadId'=$1 AND status='open'`, [id])).rows[0];
    await app.inject({ method: 'POST', url: `/actions/${act.id}/decide`, payload: { decision: 'dismissed' }, headers: H(o.token) });
    const h2 = await app.inject({ method: 'GET', url: '/plugins/admissions.funnel/health', headers: H(o.token) });
    assert.equal(h2.json().healthy, false);
    assert.ok(h2.json().orphans.strandedEnrolled.some((x) => x.id === id), 'stranded enrolled lead surfaced');
  });

  test('8 · SLA sweep escalates a stuck lead once per day', async () => {
    const adm = await loginAs(app, 'admissions@meridian.edu');
    const c = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/leads',
      payload: { studentName: 'Stuck Kid', guardianPhone: '9800000009', classApplied: '8' }, headers: H(adm.token) });
    const id = c.json().leadId;
    await sql(`UPDATE plugin_admissions.lead SET updated_at = now() - interval '10 days' WHERE id=$1`, [id]);
    const o = await loginAs(app, 'owner@meridian.edu');
    const run = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/sla/run', headers: H(o.token), payload: {} });
    assert.equal(run.statusCode, 200, run.body);
    assert.ok(run.json().raised >= 1);
    const notes = await sql(`SELECT count(*)::int n FROM app.notifications WHERE ref=$1`, [id]);
    assert.equal(notes.rows[0].n, 1, 'one escalation notification for the stuck lead');
    // second run the same day is idempotent
    const run2 = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/sla/run', headers: H(o.token), payload: {} });
    assert.ok(run2.json().skipped >= 1, 'second sweep skips the lead already chased today');
    const notes2 = await sql(`SELECT count(*)::int n FROM app.notifications WHERE ref=$1`, [id]);
    assert.equal(notes2.rows[0].n, 1, 'no duplicate notification');
  });

  test('9 · default workflow rule seeds an admission follow-up pipeline (F-2)', async () => {
    const r = await sql(`SELECT count(*)::int n FROM app.workflow_rules WHERE topic='admission.enquiry.captured'`);
    assert.ok(r.rows[0].n >= 1, 'default admissions workflow rule present');
  });
});
