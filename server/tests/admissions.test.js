// admissions.funnel — wave-2 #1 tests (migration 018 + factory drop-in)
// Pins: registration/lifecycle gates, lead capture, stage lattice enforcement,
// terminal immutability, PII masking by role, no-core-students invariant,
// history trail, funnel summary. 018 registers the plugin 'registered' — the
// suite enables it through the audited owner door (same as the upi suite).
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

describe('admissions.funnel (wave-2 #1 · migration 018)', () => {
  let leadId;

  test('1 · registered-not-enabled: doors refuse before enable (per-module lifecycle gate)', async () => {
    const fin = await loginAs(app, 'finance@meridian.edu');
    const r = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/leads',
      payload: { studentName: 'Test Kid', guardianPhone: '9876543210', classApplied: '6' }, headers: H(fin.token) });
    assert.equal(r.statusCode, 409, 'plugin row registered → lifecycle gate 409 (P2-1 closed for this module)');
    assert.match(r.json().error, /not enabled/);
  });

  test('2 · enable (owner, audited) → capture lead → history starts at inquiry', async () => {
    const o = await loginAs(app, 'owner@meridian.edu');
    const en = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/enable',
      headers: { ...H(o.token), 'content-type': 'application/json' }, payload: { version: '1.0.0', class: 'C' } });
    assert.equal(en.statusCode, 200);
    const fin = await loginAs(app, 'finance@meridian.edu');
    const r = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/leads',
      payload: { studentName: 'Aarav Mehta', guardianName: 'Rohit Mehta', guardianPhone: '9876543210', classApplied: '6', source: 'referral' }, headers: H(fin.token) });
    assert.equal(r.statusCode, 200);
    leadId = r.json().leadId;
    const h = await app.inject({ method: 'GET', url: `/plugins/admissions.funnel/leads/${leadId}/history`, headers: H(fin.token) });
    assert.equal(h.statusCode, 200);
    assert.equal(h.json().history.length, 1);
    assert.equal(h.json().history[0].to_stage, 'inquiry');
  });

  test('3 · stage lattice enforced server-side: skips and unknowns 409/400', async () => {
    const fin = await loginAs(app, 'finance@meridian.edu');
    const skip = await app.inject({ method: 'POST', url: `/plugins/admissions.funnel/leads/${leadId}/stage`,
      payload: { to: 'offer' }, headers: H(fin.token) });
    assert.equal(skip.statusCode, 409, 'inquiry → offer is illegal');
    const bad = await app.inject({ method: 'POST', url: `/plugins/admissions.funnel/leads/${leadId}/stage`,
      payload: { to: 'hired' }, headers: H(fin.token) });
    assert.equal(bad.statusCode, 400, 'unknown stage → 400');
    const ok = await app.inject({ method: 'POST', url: `/plugins/admissions.funnel/leads/${leadId}/stage`,
      payload: { to: 'applied' }, headers: H(fin.token) });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().from, 'inquiry');
  });

  test('4 · full happy path → enrolled; enrollment does NOT write core students', async () => {
    const fin = await loginAs(app, 'finance@meridian.edu');
    for (const to of ['interview', 'offer', 'enrolled']) {
      const r = await app.inject({ method: 'POST', url: `/plugins/admissions.funnel/leads/${leadId}/stage`,
        payload: { to }, headers: H(fin.token) });
      assert.equal(r.statusCode, 200, `transition to ${to}`);
    }
    const coreKids = await sql(`SELECT count(*)::int n FROM app.students WHERE name='Aarav Mehta'`);
    assert.equal(coreKids.rows[0].n, coreBaseline, 'funnel never writes core students (delta 0 vs pre-test baseline)');
    const h = await app.inject({ method: 'GET', url: `/plugins/admissions.funnel/leads/${leadId}/history`, headers: H(fin.token) });
    assert.equal(h.json().history.length, 5, 'inquiry → applied → interview → offer → enrolled trail');
    assert.equal(h.json().history.at(-1).to_stage, 'enrolled');
  });

  test('5 · terminal immutability + teacher masked view + parent denial', async () => {
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
    assert.equal(cl.guardianName, 'Rohit Mehta');
    const fl = (await app.inject({ method: 'GET', url: '/plugins/admissions.funnel/leads', headers: H(fin.token) })).json().leads.find((x) => x.id === leadId);
    assert.match(fl.guardianPhone, /^98xxxx10$/, 'finance sees masked phone (no admissions need)');
    assert.equal(fl.guardianName, null, 'finance sees no guardian name');
  });

  test('6 · funnel summary + double transition conflict + history immutability after terminal', async () => {
    const fin = await loginAs(app, 'finance@meridian.edu');
    const s = await app.inject({ method: 'GET', url: '/plugins/admissions.funnel/summary', headers: H(fin.token) });
    assert.equal(s.statusCode, 200);
    assert.equal(s.json().byStage.enrolled, 1);
    assert.equal(s.json().total >= 1, true);
    // a second lead: inquiry → withdrawn (side exit) → attempt to revive must 409
    const c = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/leads',
      payload: { studentName: 'Diya Sharma', guardianPhone: '9123456780', classApplied: '3' }, headers: H(fin.token) });
    const l2 = c.json().leadId;
    const w = await app.inject({ method: 'POST', url: `/plugins/admissions.funnel/leads/${l2}/stage`,
      payload: { to: 'withdrawn' }, headers: H(fin.token) });
    assert.equal(w.statusCode, 200);
    const revive = await app.inject({ method: 'POST', url: `/plugins/admissions.funnel/leads/${l2}/stage`,
      payload: { to: 'applied' }, headers: H(fin.token) });
    assert.equal(revive.statusCode, 409, 'withdrawn is terminal — immutable');
  });

  test('7 · registry mirror: admissions.funnel row + contract exist (018)', async () => {
    const reg = await sql(`SELECT status FROM app.plugins WHERE plugin_id='admissions.funnel'`);
    assert.equal(reg.rows.length, 1, 'exactly one registry row (test tenant)');
    const ct = await sql(`SELECT count(*)::int n FROM app.capability_contracts WHERE capability_id='admissions.capture' AND tenant_id IS NULL`);
    assert.equal(ct.rows[0].n >= 1, true, 'capability contract registered');
  });
});
