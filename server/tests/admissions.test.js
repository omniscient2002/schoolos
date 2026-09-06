// admissions.funnel — wave-2 #1 tests (migrations 018 + 021: India-admissions semantics)
// Pins: lifecycle gate, enquiry→form→interaction→offer lattice, stage.transitioned
// events, duplicate-enquiry guard, Feb–Jun session window (settings-driven),
// offer.accepted → students.create KERNEL approval action (no plugin-direct core
// writes), PII tiers, registry mirror. 018/021 register 'registered' — the suite
// enables through the audited owner door.
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

describe('admissions.funnel (wave-2 #1 · migrations 018+021 · India-admissions semantics)', () => {
  let leadId;

  test('1 · registered-not-enabled: doors refuse before enable (per-module lifecycle gate)', async () => {
    const fin = await loginAs(app, 'finance@meridian.edu');
    const r = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/leads',
      payload: { studentName: 'Test Kid', guardianPhone: '9876543210', classApplied: '6' }, headers: H(fin.token) });
    assert.equal(r.statusCode, 409, 'plugin row registered → lifecycle gate 409 (P2-1 closed for this module)');
    assert.match(r.json().error, /not enabled/);
  });

  test('2 · enable (owner, audited) → capture enquiry → history starts at enquiry', async () => {
    const o = await loginAs(app, 'owner@meridian.edu');
    const en = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/enable',
      headers: { ...H(o.token), 'content-type': 'application/json' }, payload: { version: '1.0.0', class: 'C' } });
    assert.equal(en.statusCode, 200);
    const fin = await loginAs(app, 'finance@meridian.edu');
    const r = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/leads',
      payload: { studentName: 'Aarav Mehta', guardianName: 'Rohit Mehta', guardianPhone: '9876543210', classApplied: '6', source: 'referral' }, headers: H(fin.token) });
    assert.equal(r.statusCode, 200);
    leadId = r.json().leadId;
    assert.match(r.json().admissionYear, /^\d{4}-\d{2}$/, 'session year resolved (settings or Apr–Mar default)');
    const h = await app.inject({ method: 'GET', url: `/plugins/admissions.funnel/leads/${leadId}/history`, headers: H(fin.token) });
    assert.equal(h.statusCode, 200);
    assert.equal(h.json().history.length, 1);
    assert.equal(h.json().history[0].to_stage, 'enquiry');
  });

  test('3 · duplicate-enquiry guard: same guardian+class+session → 409 with the existing leadId', async () => {
    const fin = await loginAs(app, 'finance@meridian.edu');
    const dup = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/leads',
      payload: { studentName: 'Second Entry Same Kid', guardianPhone: '9876543210', classApplied: '6' }, headers: H(fin.token) });
    assert.equal(dup.statusCode, 409, 'duplicate open enquiry refused');
    assert.equal(dup.json().leadId, leadId, 'recoverable 409 carries the existing lead');
  });

  test('4 · stage lattice enforced server-side: skips and unknowns 409/400', async () => {
    const fin = await loginAs(app, 'finance@meridian.edu');
    const skip = await app.inject({ method: 'POST', url: `/plugins/admissions.funnel/leads/${leadId}/stage`,
      payload: { to: 'offer' }, headers: H(fin.token) });
    assert.equal(skip.statusCode, 409, 'enquiry → offer is illegal');
    const bad = await app.inject({ method: 'POST', url: `/plugins/admissions.funnel/leads/${leadId}/stage`,
      payload: { to: 'hired' }, headers: H(fin.token) });
    assert.equal(bad.statusCode, 400, 'unknown stage → 400');
    const ok = await app.inject({ method: 'POST', url: `/plugins/admissions.funnel/leads/${leadId}/stage`,
      payload: { to: 'form' }, headers: H(fin.token) });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().from, 'enquiry');
  });

  test('5 · offer.accepted → students.create KERNEL approval action; core students untouched', async () => {
    const fin = await loginAs(app, 'finance@meridian.edu');
    for (const to of ['interaction', 'offer', 'enrolled']) {
      const r = await app.inject({ method: 'POST', url: `/plugins/admissions.funnel/leads/${leadId}/stage`,
        payload: { to }, headers: H(fin.token) });
      assert.equal(r.statusCode, 200, `transition to ${to}`);
    }
    // offer.accepted raised the kernel approval action — plugin-direct write it is not
    const act = await sql(`SELECT code, kind, status, owner_role, payload FROM app.actions WHERE payload->>'leadId'=$1`, [leadId]);
    assert.equal(act.rows.length, 1, 'exactly one students.create action');
    assert.equal(act.rows[0].code, 'students.create');
    assert.equal(act.rows[0].kind, 'approval');
    assert.equal(act.rows[0].status, 'open');
    assert.equal(act.rows[0].owner_role, 'principal');
    const coreKids = await sql(`SELECT count(*)::int n FROM app.students WHERE name='Aarav Mehta'`);
    assert.equal(coreKids.rows[0].n, coreBaseline, 'funnel never writes core students (delta 0 vs pre-test baseline)');
    const h = await app.inject({ method: 'GET', url: `/plugins/admissions.funnel/leads/${leadId}/history`, headers: H(fin.token) });
    assert.equal(h.json().history.length, 5, 'enquiry → form → interaction → offer → enrolled trail');
    const ev = await sql(`SELECT count(*)::int n FROM app.outbox WHERE topic='admission.stage.transitioned' AND payload->>'leadId'=$1`, [leadId]);
    assert.equal(ev.rows[0].n, 4, 'stage.transitioned events on every move');
    const oa = await sql(`SELECT count(*)::int n FROM app.outbox WHERE topic='admission.offer.accepted' AND payload->>'leadId'=$1`, [leadId]);
    assert.equal(oa.rows[0].n, 1, 'offer.accepted event emitted with the action ref');
  });

  test('6 · terminal immutability + teacher masked view + parent denial + PII tiers', async () => {
    const fin = await loginAs(app, 'finance@meridian.edu');
    const t = await app.inject({ method: 'POST', url: `/plugins/admissions.funnel/leads/${leadId}/stage`,
      payload: { to: 'rejected' }, headers: H(fin.token) });
    assert.equal(t.statusCode, 409, 'enrolled is terminal — immutable');
    const teacher = await loginAs(app, 'teacher@meridian.edu');
    const tv = await app.inject({ method: 'GET', url: '/plugins/admissions.funnel/leads', headers: H(teacher.token) });
    assert.equal(tv.statusCode, 200, 'teacher may view (masked)');
    const tl = tv.json().leads.find((x) => x.id === leadId);
    assert.equal(tl.guardianName, null, 'teacher sees no guardian name');
    assert.match(tl.guardianPhone, /^98xxxx10$/, 'teacher sees masked phone');
    assert.equal(tl.guardianPhone.includes('9876543210'), false, 'no full PII to teacher');
    const parent = await loginAs(app, 'parent@meridian.edu');
    const pd = await app.inject({ method: 'GET', url: '/plugins/admissions.funnel/leads', headers: H(parent.token) });
    assert.equal(pd.statusCode, 403, 'parent denied the funnel entirely');
    // full-PII tier = admissions office (coordinator), NOT finance (fees don't need guardian phones)
    const coordinator = await loginAs(app, 'coordinator@meridian.edu');
    const cv = await app.inject({ method: 'GET', url: '/plugins/admissions.funnel/leads', headers: H(coordinator.token) });
    const cl = cv.json().leads.find((x) => x.id === leadId);
    assert.equal(cl.guardianPhone, '9876543210', 'coordinator (admissions office) sees full PII');
    const fl = (await app.inject({ method: 'GET', url: '/plugins/admissions.funnel/leads', headers: H(fin.token) })).json().leads.find((x) => x.id === leadId);
    assert.match(fl.guardianPhone, /^98xxxx10$/, 'finance sees masked phone (no admissions need)');
    assert.equal(fl.guardianName, null, 'finance sees no guardian name');
  });

  test('7 · session window: outside cycle → 409; covering cycle → capture succeeds', async () => {
    const o = await loginAs(app, 'owner@meridian.edu');
    // narrow window that excludes today (deterministic without clock mocking)
    const setOut = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/settings',
      headers: { ...H(o.token), 'content-type': 'application/json' },
      payload: { admission_year: '2026-27', cycle_start: '12-01', cycle_end: '12-31' } });
    assert.equal(setOut.statusCode, 200);
    const fin = await loginAs(app, 'finance@meridian.edu');
    const out = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/leads',
      payload: { studentName: 'Off Cycle Kid', guardianPhone: '9111100000', classApplied: '2' }, headers: H(fin.token) });
    assert.equal(out.statusCode, 409);
    assert.match(out.json().error, /outside the admission window/);
    // window covering the whole year → capture succeeds
    const setIn = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/settings',
      headers: { ...H(o.token), 'content-type': 'application/json' },
      payload: { admission_year: '2026-27', cycle_start: '01-01', cycle_end: '12-31' } });
    assert.equal(setIn.statusCode, 200);
    const inR = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/leads',
      payload: { studentName: 'Off Cycle Kid', guardianPhone: '9111100000', classApplied: '2' }, headers: H(fin.token) });
    assert.equal(inR.statusCode, 200, 'capture inside the configured window');
    assert.equal(inR.json().admissionYear, '2026-27', 'session year from settings');
  });

  test('8 · funnel summary + withdrawn terminal + registry/contract mirror (018+021)', async () => {
    const fin = await loginAs(app, 'finance@meridian.edu');
    const s = await app.inject({ method: 'GET', url: '/plugins/admissions.funnel/summary', headers: H(fin.token) });
    assert.equal(s.statusCode, 200);
    assert.equal(s.json().byStage.enrolled, 1);
    const c = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/leads',
      payload: { studentName: 'Diya Sharma', guardianPhone: '9123456780', classApplied: '3' }, headers: H(fin.token) });
    const l2 = c.json().leadId;
    const w = await app.inject({ method: 'POST', url: `/plugins/admissions.funnel/leads/${l2}/stage`,
      payload: { to: 'withdrawn' }, headers: H(fin.token) });
    assert.equal(w.statusCode, 200);
    const revive = await app.inject({ method: 'POST', url: `/plugins/admissions.funnel/leads/${l2}/stage`,
      payload: { to: 'form' }, headers: H(fin.token) });
    assert.equal(revive.statusCode, 409, 'withdrawn is terminal — immutable');
    const reg = await sql(`SELECT manifest->'settingsSchema'->'properties' ? 'admission_year' AS has FROM app.plugins WHERE plugin_id='admissions.funnel'`);
    assert.equal(reg.rows[0].has, true, '021 manifest refresh present (admission_year)');
    const evT = await sql(`SELECT count(*)::int n FROM app.outbox WHERE topic='admission.stage.transitioned'`);
    assert.equal(evT.rows[0].n >= 5, true, 'stage.transitioned is the funnel event stream');
  });
});
