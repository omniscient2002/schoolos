// cycle-5 remediation regression pins (migration 027 + module fixes)
// P1-1: per-instance kernel action codes — second SAR of a kind and second funnel
//       conversion must both succeed (were lifetime-500 via UNIQUE(tenant_id, code)).
// P2-1: E.164 phone normalization at dpdp + admissions doors — spaced vs compact is ONE
//       data principal (consent dedupe + erasure alignment).
// P2-2: admissionYear body validation (format + non-current-session role gate).
// P2-3: uuid guard on /actions/:id/decide (was raw 22P02 → 500).
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
});

describe('cycle-5 remediation (P1-1 · P1-2 · P2-1 · P2-2 · P2-3)', () => {
  test('P1-1 · dpdp: SECOND erasure SAR for a different subject succeeds (was lifetime 500)', async () => {
    const o = await loginAs(app, 'owner@meridian.edu');
    await app.inject({ method: 'POST', url: '/plugins/pack.dpdp/enable', headers: H(o.token), payload: { version: '1.1.0', class: 'C' } });
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const s1 = await app.inject({ method: 'POST', url: '/plugins/pack.dpdp/dsr',
      payload: { kind: 'erasure', subjectRef: '+919800055001', reason: 'subject request' }, headers: H(co.token) });
    assert.equal(s1.statusCode, 200, JSON.stringify(s1.json()));
    const s2 = await app.inject({ method: 'POST', url: '/plugins/pack.dpdp/dsr',
      payload: { kind: 'erasure', subjectRef: '+919800055002', reason: 'subject request' }, headers: H(co.token) });
    assert.equal(s2.statusCode, 200, `second erasure SAR must not 23505: ${s1.body}`);
    assert.notEqual(s1.json().sarId, s2.json().sarId);
    assert.notEqual(s1.json().actionId, s2.json().actionId);
    const codes = (await sql(`SELECT code FROM app.actions WHERE code LIKE 'dpdp.dsr.erasure.%' ORDER BY created_at`)).rows;
    assert.equal(codes.length, 2, 'two distinct per-instance codes');
    // second export SAR, different subject (A2 repro)
    const e1 = await app.inject({ method: 'POST', url: '/plugins/pack.dpdp/dsr',
      payload: { kind: 'export', subjectRef: '+919800055003' }, headers: H(co.token) });
    const e2 = await app.inject({ method: 'POST', url: '/plugins/pack.dpdp/dsr',
      payload: { kind: 'export', subjectRef: '+919800055004' }, headers: H(co.token) });
    assert.equal(e1.statusCode, 200);
    assert.equal(e2.statusCode, 200);
  });

  test('P2-1 · dpdp: spaced vs compact consent is ONE principal; erasure redacts across formats', async () => {
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const spaced = await app.inject({ method: 'POST', url: '/plugins/pack.dpdp/consent',
      payload: { subjectRef: '+91 98000 55009', purpose: 'admissions_enquiry', decision: 'granted' }, headers: H(co.token) });
    assert.equal(spaced.statusCode, 200);
    const compactDup = await app.inject({ method: 'POST', url: '/plugins/pack.dpdp/consent',
      payload: { subjectRef: '+919800055009', purpose: 'admissions_enquiry', decision: 'granted' }, headers: H(co.token) });
    assert.equal(compactDup.statusCode, 409, 'compact re-record of a spaced grant dedupes (P2-1)');
    const row = (await sql(`SELECT subject_ref, evidence->>'rawSubjectRef' AS raw FROM plugin_dpdp.consent WHERE subject_ref='+919800055009'`)).rows[0];
    assert.equal(row.subject_ref, '+919800055009', 'stored normalized');
    assert.equal(row.raw, '+91 98000 55009', 'raw preserved as evidence');
    // P2-1 end-to-end (was blocked by P1-1): compact-phone erasure redacts the spaced-recorded artifact
    const sar = await app.inject({ method: 'POST', url: '/plugins/pack.dpdp/dsr',
      payload: { kind: 'erasure', subjectRef: '+919800055009', reason: 'subject request' }, headers: H(co.token) });
    assert.equal(sar.statusCode, 200);
    const principal = await loginAs(app, 'principal@meridian.edu');
    await app.inject({ method: 'POST', url: `/actions/${sar.json().actionId}/decide`,
      payload: { decision: 'approved', note: 'verified principal' }, headers: H(principal.token) });
    const ex = await app.inject({ method: 'POST', url: `/plugins/pack.dpdp/dsr/${sar.json().sarId}/execute`, payload: {}, headers: H(principal.token) });
    assert.equal(ex.statusCode, 200, JSON.stringify(ex.json()));
    assert.equal(ex.json().bundle.consentRowsRedacted, 1, 'spaced-recorded artifact redacted by compact-phone SAR');
  });

  test('P1-1 · admissions: SECOND offer→enrolled conversion succeeds (was lifetime 500)', async () => {
    const o = await loginAs(app, 'owner@meridian.edu');
    await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/enable', headers: H(o.token), payload: { version: '1.2.0', class: 'C' } });
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const mk = async (phone, name) => {
      const lead = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/leads',
        payload: { studentName: name, guardianName: `G of ${name}`, guardianPhone: phone, classApplied: '6' }, headers: H(co.token) });
      assert.equal(lead.statusCode, 200, lead.body);
      const id = lead.json().leadId;
      for (const to of ['form', 'interaction', 'offer', 'enrolled']) {
        const st = await app.inject({ method: 'POST', url: `/plugins/admissions.funnel/leads/${id}/stage`,
          payload: { to }, headers: H(co.token) });
        assert.equal(st.statusCode, 200, `${name} → ${to}: ${st.body}`);
      }
      return id;
    };
    await mk('9811100111', 'Conv One');
    await mk('9811100222', 'Conv Two');
    const codes = (await sql(`SELECT code FROM app.actions WHERE code LIKE 'students.create.%' ORDER BY created_at`)).rows;
    assert.equal(codes.length, 2, 'two distinct per-instance conversion actions');
  });

  test('P1-2 · admissions: dedupe race degrades to 409 with leadId (partial unique backstop)', async () => {
    const co = await loginAs(app, 'coordinator@meridian.edu');
    // direct INSERT simulates the race window (module catches 23505 → 409)
    await sql(`INSERT INTO plugin_admissions.lead (tenant_id, student_name, guardian_phone, class_applied, notes)
               SELECT id, 'Race Winner', '+919822200333', '6', jsonb_build_object('admission_year','2026-27')
               FROM app.tenants LIMIT 1`);
    const race = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/leads',
      payload: { studentName: 'Race Loser', guardianPhone: '98222 00333', classApplied: '6' }, headers: H(co.token) });
    assert.equal(race.statusCode, 409, 'the loser gets the friendly 409, not a 500');
    assert.match(race.json().error, /already has an open enquiry/); // plain-language copy pass
  });

  test('P2-1 · admissions: spaced-then-compact capture dedupes to the same lead', async () => {
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const a = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/leads',
      payload: { studentName: 'Spaced Kid', guardianPhone: '98222 00444', classApplied: '7' }, headers: H(co.token) });
    assert.equal(a.statusCode, 200);
    const b = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/leads',
      payload: { studentName: 'Compact Kid', guardianPhone: '9822200444', classApplied: '7' }, headers: H(co.token) });
    assert.equal(b.statusCode, 409);
    assert.equal(b.json().leadId, a.json().leadId, 'same normalized guardian → same open lead');
  });

  test('P2-2 · admissions: admissionYear body value format-gated; non-current session needs owner/itadmin', async () => {
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const bad = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/leads',
      payload: { studentName: 'AY Bad', guardianPhone: '9822200555', classApplied: '6', admissionYear: '1999-00' }, headers: H(co.token) });
    assert.equal(bad.statusCode, 403, 'non-current session captured by coordinator refused (P2-2)');
    const worse = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/leads',
      payload: { studentName: 'AY Worse', guardianPhone: '9822200555', classApplied: '6', admissionYear: 'DROP TABLE' }, headers: H(co.token) });
    assert.equal(worse.statusCode, 400, 'malformed year refused at the door');
    const o = await loginAs(app, 'owner@meridian.edu');
    const ok = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/leads',
      payload: { studentName: 'AY Owner', guardianPhone: '9822200555', classApplied: '6', admissionYear: '2027-28' }, headers: H(o.token) });
    assert.equal(ok.statusCode, 200, 'owner may capture into a future cycle (explicit, validated)');
  });

  test('P2-3 · kernel: non-uuid action id → 400 (was 22P02 → 500)', async () => {
    const pr = await loginAs(app, 'principal@meridian.edu');
    const r = await app.inject({ method: 'POST', url: '/actions/zzz/decide',
      payload: { decision: 'approved' }, headers: H(pr.token) });
    assert.equal(r.statusCode, 400);
    assert.match(r.json().error, /valid ID/); // plain-language copy pass (was /uuid/)
  });
});
