// pack.dpdp — DPDP compliance pack tests (migration 023; contract dpdp.consent.ledger)
// Pins: lifecycle gate, immutable consent ledger (withdrawal = appended superseding
// artifact), expiry computed at read, SAR export/erasure through the KERNEL approval
// spine (raise → /actions/:id/decide → execute; execute-before-approval refused,
// self-approval refused), decision trail preserved through erasure, core students
// never written, DPDP-not-a-finance-surface role tier. Events: consent.recorded.v1 ·
// sar.opened.v1 · sar.fulfilled.v1.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setupTestDb, loginAs } from './helpers.js';

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

let app;
let sql;
let coreBaseline; // seed ships students named 'Aarav Mehta' — assert delta, not zero

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
  coreBaseline = (await sql(`SELECT count(*)::int n FROM app.students WHERE name='Aarav Mehta'`)).rows[0].n;
});

describe('pack.dpdp (DPDP compliance pack · migration 023 · contract dpdp.consent.ledger)', () => {
  test('1 · DPDP is not a finance surface + registered-not-enabled lifecycle gate', async () => {
    const fin = await loginAs(app, 'finance@meridian.edu');
    const finTry = await app.inject({ method: 'POST', url: '/plugins/pack.dpdp/consent',
      payload: { subjectRef: '9811100111', purpose: 'admissions_enquiry', decision: 'granted' }, headers: H(fin.token) });
    assert.equal(finTry.statusCode, 403, 'finance has no DPDP door (DPO tier = owner/principal/itadmin/coordinator)');
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const pre = await app.inject({ method: 'POST', url: '/plugins/pack.dpdp/consent',
      payload: { subjectRef: '9811100111', purpose: 'admissions_enquiry', decision: 'granted' }, headers: H(co.token) });
    assert.equal(pre.statusCode, 409, 'registered-not-enabled → lifecycle gate 409');
  });

  test('2 · enable (owner) → coordinator captures consent → immutable artifact + consent.recorded.v1', async () => {
    const o = await loginAs(app, 'owner@meridian.edu');
    const en = await app.inject({ method: 'POST', url: '/plugins/pack.dpdp/enable',
      headers: { ...H(o.token), 'content-type': 'application/json' }, payload: { version: '1.0.0', class: 'C' } });
    assert.equal(en.statusCode, 200);
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const r = await app.inject({ method: 'POST', url: '/plugins/pack.dpdp/consent',
      payload: { subjectRef: '9811100111', purpose: 'admissions_enquiry', decision: 'granted', channel: 'walk-in' }, headers: H(co.token) });
    assert.equal(r.statusCode, 200);
    assert.match(r.json().validUntil, /^\d{4}-\d{2}-\d{2}T/, 'validUntil stamped from retention schedule');
    const n = await sql(`SELECT count(*)::int n FROM plugin_dpdp.consent WHERE subject_ref='+919811100111'`); // P2-1: stored E.164
    assert.equal(n.rows[0].n, 1);
    const ev = await sql(`SELECT count(*)::int n FROM app.outbox WHERE topic='consent.recorded.v1'`);
    assert.equal(ev.rows[0].n >= 1, true, 'consent.recorded.v1 on the event spine');
    const st = await app.inject({ method: 'GET', url: '/plugins/pack.dpdp/consent/state?subjectRef=9811100111', headers: H(co.token) });
    assert.equal(st.json().states[0].state, 'granted');
  });

  test('3 · consent_immutable: withdrawal APPENDS a superseding artifact; decision trail intact', async () => {
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const w = await app.inject({ method: 'POST', url: '/plugins/pack.dpdp/consent',
      payload: { subjectRef: '9811100111', purpose: 'admissions_enquiry', decision: 'withdrawn' }, headers: H(co.token) });
    assert.equal(w.statusCode, 200);
    const rows = await sql(`SELECT decision FROM plugin_dpdp.consent WHERE subject_ref='+919811100111' ORDER BY created_at ASC`);
    assert.equal(rows.rows.length, 2, 'append-only: two artifacts, no in-place update');
    assert.equal(rows.rows[0].decision, 'granted', 'original artifact untouched');
    assert.equal(rows.rows[1].decision, 'withdrawn');
    const st = await app.inject({ method: 'GET', url: '/plugins/pack.dpdp/consent/state?subjectRef=9811100111', headers: H(co.token) });
    assert.equal(st.json().states[0].state, 'withdrawn', 'latest artifact wins');
    const g2 = await app.inject({ method: 'POST', url: '/plugins/pack.dpdp/consent',
      payload: { subjectRef: '9811100111', purpose: 'admissions_enquiry', decision: 'granted' }, headers: H(co.token) });
    assert.equal(g2.statusCode, 200);
    const st2 = await app.inject({ method: 'GET', url: '/plugins/pack.dpdp/consent/state?subjectRef=9811100111', headers: H(co.token) });
    assert.equal(st2.json().states[0].state, 'granted', 're-grant after withdrawal → granted (new artifact)');
  });

  test('4 · expiry computed at read (retention schedule) — aged artifact reads expired', async () => {
    await sql(`UPDATE plugin_dpdp.consent SET valid_until = now() - interval '1 hour' WHERE subject_ref='+919811100111' AND decision='granted'`);
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const st = await app.inject({ method: 'GET', url: '/plugins/pack.dpdp/consent/state?subjectRef=9811100111', headers: H(co.token) });
    assert.equal(st.json().states[0].state, 'expired', 'valid_until in the past → expired at read');
  });

  test('5 · SAR export: raise → kernel approval action (open) + sar.opened.v1 + SLA stamped; duplicate open 409', async () => {
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const r = await app.inject({ method: 'POST', url: '/plugins/pack.dpdp/dsr',
      payload: { kind: 'export', subjectRef: '9811100111' }, headers: H(co.token) });
    assert.equal(r.statusCode, 200);
    const { sarId, actionId } = r.json();
    assert.match(r.json().slaDueAt, /^\d{4}-\d{2}-\d{2}T/, 'sar_sla_tracked');
    const act = await sql(`SELECT code, kind, status, owner_role FROM app.actions WHERE id=$1`, [actionId]);
    assert.match(act.rows[0].code, /^dpdp\.dsr\.export\.[0-9a-f-]{36}$/, 'per-instance action code (P1-1)');
    assert.equal(act.rows[0].kind, 'approval');
    assert.equal(act.rows[0].status, 'open');
    assert.equal(act.rows[0].owner_role, 'principal');
    const ev = await sql(`SELECT count(*)::int n FROM app.outbox WHERE topic='sar.opened.v1'`);
    assert.equal(ev.rows[0].n >= 1, true, 'sar.opened.v1 on the spine');
    const dup = await app.inject({ method: 'POST', url: '/plugins/pack.dpdp/dsr',
      payload: { kind: 'export', subjectRef: '9811100111' }, headers: H(co.token) });
    assert.equal(dup.statusCode, 409, 'duplicate open SAR refused');
    assert.equal(dup.json().sarId, sarId, 'recoverable 409 returns the open SAR');
  });

  test('6 · execute BEFORE kernel approval refused; then approve (principal) → execute → bundle fulfilled', async () => {
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const list = await app.inject({ method: 'GET', url: '/plugins/pack.dpdp/dsr', headers: H(co.token) });
    const sar = list.json().sars.find((x) => x.kind === 'export' && x.status === 'open');
    const early = await app.inject({ method: 'POST', url: `/plugins/pack.dpdp/dsr/${sar.sarId}/execute`, payload: {}, headers: H(co.token) });
    assert.equal(early.statusCode, 409);
    assert.match(early.json().error, /needs approval first/); // plain-language copy pass
    const coSelf = await app.inject({ method: 'POST', url: `/actions/${sar.actionId}/decide`,
      payload: { decision: 'approved' }, headers: H(co.token) });
    assert.equal(coSelf.statusCode, 403, 'proposer may not approve (kernel SoD)');
    const pr = await loginAs(app, 'principal@meridian.edu');
    const ap = await app.inject({ method: 'POST', url: `/actions/${sar.actionId}/decide`,
      payload: { decision: 'approved', note: 'verified data principal' }, headers: H(pr.token) });
    assert.equal(ap.statusCode, 200);
    const ex = await app.inject({ method: 'POST', url: `/plugins/pack.dpdp/dsr/${sar.sarId}/execute`, payload: {}, headers: H(pr.token) });
    assert.equal(ex.statusCode, 200);
    assert.ok(ex.json().bundle.consentArtifacts.length >= 3, 'bundle carries the consent artifacts');
    const ev = await sql(`SELECT count(*)::int n FROM app.outbox WHERE topic='sar.fulfilled.v1'`);
    assert.equal(ev.rows[0].n >= 1, true, 'sar.fulfilled.v1 on the spine');
    const dl = await app.inject({ method: 'GET', url: `/plugins/pack.dpdp/dsr/${sar.sarId}/export`, headers: H(pr.token) });
    assert.equal(dl.statusCode, 200, 'bundle deliverable post-fulfilment');
  });

  test('7 · SAR erasure: kernel-approved → identity redacted, decision TRAIL preserved, core students untouched', async () => {
    await sql(`INSERT INTO plugin_admissions.lead (tenant_id, student_name, guardian_name, guardian_phone, class_applied, source, created_by, notes)
      SELECT id, 'Dsar Kid', 'G. Parent', '+919822200222', '5', 'walk-in', NULL, jsonb_build_object('admission_year','2026-27') FROM app.tenants LIMIT 1`); // P2-1: fixture stored E.164
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const cr = await app.inject({ method: 'POST', url: '/plugins/pack.dpdp/consent',
      payload: { subjectRef: '9822200222', purpose: 'admissions_enquiry', decision: 'granted' }, headers: H(co.token) });
    assert.equal(cr.statusCode, 200);
    const r = await app.inject({ method: 'POST', url: '/plugins/pack.dpdp/dsr',
      payload: { kind: 'erasure', subjectRef: '9822200222' }, headers: H(co.token) });
    assert.equal(r.statusCode, 200);
    const { sarId, actionId } = r.json();
    const pr = await loginAs(app, 'principal@meridian.edu');
    const ap = await app.inject({ method: 'POST', url: `/actions/${actionId}/decide`,
      payload: { decision: 'approved', note: 'erasure verified' }, headers: H(pr.token) });
    assert.equal(ap.statusCode, 200);
    const ex = await app.inject({ method: 'POST', url: `/plugins/pack.dpdp/dsr/${sarId}/execute`, payload: {}, headers: H(pr.token) });
    assert.equal(ex.statusCode, 200);
    assert.ok(ex.json().bundle.consentRowsRedacted >= 1);
    assert.equal(ex.json().bundle.admissionsLeadsRedacted, 1);
    const cons = await sql(`SELECT subject_ref, decision FROM plugin_dpdp.consent WHERE subject_ref='9822200222'`);
    assert.equal(cons.rows.length, 0, 'identity redacted — no rows under the raw ref');
    const redacted = await sql(`SELECT decision FROM plugin_dpdp.consent WHERE subject_ref LIKE '[erased:%'`);
    assert.equal(redacted.rows.length >= 1, true, 'artifact row survives with identity redacted');
    assert.equal(redacted.rows[0].decision, 'granted', 'decision trail preserved');
    const lead = await sql(`SELECT guardian_name, guardian_phone FROM plugin_admissions.lead WHERE student_name='Dsar Kid'`);
    assert.equal(lead.rows[0].guardian_name, null, 'admissions PII redacted');
    assert.match(lead.rows[0].guardian_phone, /^\[erased:/, 'guardian phone redacted');
    const coreKids = await sql(`SELECT count(*)::int n FROM app.students WHERE name='Aarav Mehta'`);
    assert.equal(coreKids.rows[0].n, coreBaseline, 'pack never writes app.students (delta 0 vs pre-test baseline)');
    const st = await app.inject({ method: 'GET', url: '/plugins/pack.dpdp/consent/state?subjectRef=9822200222', headers: H(co.token) });
    assert.equal(st.json().states.length, 0, 'state lookup finds nothing under the erased identity');
  });

  test('8 · parent denied DPDP doors; SAR list SLA tracking present', async () => {
    const parent = await loginAs(app, 'parent@meridian.edu');
    const pd = await app.inject({ method: 'GET', url: '/plugins/pack.dpdp/dsr', headers: H(parent.token) });
    assert.equal(pd.statusCode, 403);
    const pc = await app.inject({ method: 'POST', url: '/plugins/pack.dpdp/consent',
      payload: { subjectRef: '9833300333', purpose: 'x', decision: 'granted' }, headers: H(parent.token) });
    assert.equal(pc.statusCode, 403);
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const list = await app.inject({ method: 'GET', url: '/plugins/pack.dpdp/dsr', headers: H(co.token) });
    assert.equal(list.statusCode, 200);
    assert.ok(list.json().sars.every((s) => 'slaDueAt' in s && 'overdue' in s), 'sar_sla_tracked in every row');
  });

  test('9 · registry mirror: pack.dpdp settings schema carries the retention hooks', async () => {
    const reg = await sql(`SELECT manifest->'settingsSchema'->'properties' ? 'consent_validity_days' AS a,
      manifest->'settingsSchema'->'properties' ? 'dsr_sla_days' AS b FROM app.plugins WHERE plugin_id='pack.dpdp'`);
    assert.equal(reg.rows[0].a, true);
    assert.equal(reg.rows[0].b, true);
  });
});
