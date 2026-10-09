// Admissions fixes A1–A15 — one pinned test per fix (plus the A7/A12 schema/clock
// proofs). Follows the repo's admissions-test conventions: fresh DB per file,
// enable through the audited owner door, wide-open session window.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setupTestDb, loginAs } from './helpers.js';

let app, sql, tenant;
let owner, principal, fin, coord, adm;
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
  owner = (await loginAs(app, 'owner@meridian.edu')).token;
  principal = (await loginAs(app, 'principal@meridian.edu')).token;
  fin = (await loginAs(app, 'finance@meridian.edu')).token;
  coord = (await loginAs(app, 'coordinator@meridian.edu')).token;
  adm = (await loginAs(app, 'admissions@meridian.edu')).token;
  tenant = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  const en = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/enable', headers: H(owner), payload: { version: '1.0.0', class: 'C' } });
  assert.ok([200, 409].includes(en.statusCode), `enable: ${en.body}`);
  const set = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/settings', headers: H(owner), payload: { admission_year: '2026-27', cycle_start: '01-01', cycle_end: '12-31' } });
  assert.equal(set.statusCode, 200, `settings: ${set.body}`);
});
after(async () => { await app?.close(); });

let phone = 0;
const freshPhone = () => `9${String(800000000 + (phone += 1)).slice(-9)}`;
const capture = async (name, cls = '6', extra = {}) => {
  const r = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/leads', headers: H(coord),
    payload: { studentName: name, guardianName: `G ${name}`, guardianPhone: freshPhone(), classApplied: cls, ...extra } });
  assert.equal(r.statusCode, 200, `capture ${name}: ${r.body}`);
  return r.json().leadId;
};
const move = (id, to, token, extra = {}) => app.inject({ method: 'POST', url: `/plugins/admissions.funnel/leads/${id}/stage`, headers: H(token), payload: { to, ...extra } });
const walkTo = async (id, token, target = 'enrolled', reason) => {
  const path = { enrolled: ['form', 'interaction', 'offer', 'enrolled'], offer: ['form', 'interaction', 'offer'] }[target];
  for (const s of path) {
    const extra = (s === 'rejected' || s === 'withdrawn') ? { reason: reason ?? 'fix drill' } : {};
    const r = await move(id, s, token, extra);
    assert.equal(r.statusCode, 200, `walk ${s}: ${r.body}`);
  }
};
const openActionFor = async (leadId) =>
  (await sql(`SELECT id, code FROM app.actions WHERE tenant_id=$1 AND status='open' AND payload->>'leadId'=$2 AND code LIKE 'students.create.%'`, [tenant, leadId])).rows[0];
const decide = (actionId, decision, token, note) => app.inject({ method: 'POST', url: `/actions/${actionId}/decide`, headers: H(token), payload: { decision, note } });

test('A15 · side exits need a reason; reason lands on the history trail', async () => {
  const id = await capture('A15 Kid');
  const bare = await move(id, 'rejected', coord);
  assert.equal(bare.statusCode, 400, 'rejected without reason refused');
  assert.match(bare.json().error, /reason/);
  const ok = await move(id, 'rejected', coord, { reason: 'duplicate application' });
  assert.equal(ok.statusCode, 200);
  const h = (await app.inject({ method: 'GET', url: `/plugins/admissions.funnel/leads/${id}/history`, headers: H(coord) })).json();
  assert.ok(h.history.some((x) => x.to_stage === 'rejected' && /duplicate/.test(x.reason ?? '')), 'reason stored');
});

test('A4 · document attach verifies the file belongs to this school', async () => {
  const id = await capture('A4 Kid');
  const ghost = await app.inject({ method: 'POST', url: `/plugins/admissions.funnel/leads/${id}/documents`, headers: H(coord),
    payload: { fileId: '11111111-2222-3333-4444-555555555555', label: 'TC' } });
  assert.equal(ghost.statusCode, 404, 'unknown file refused');
  const f = (await sql(`INSERT INTO app.files (tenant_id,filename,mime,bytes,sha256,storage_path,scope) VALUES ($1,'tc.pdf','application/pdf',10,'abc','t/x.pdf','general') RETURNING id`, [tenant])).rows[0];
  const good = await app.inject({ method: 'POST', url: `/plugins/admissions.funnel/leads/${id}/documents`, headers: H(coord),
    payload: { fileId: f.id, label: 'TC' } });
  assert.equal(good.statusCode, 200, good.body);
  assert.equal(good.json().documents.length, 1);
});

test('A1 · dismissed conversion returns the lead to offer; re-raise + approve converts', async () => {
  const id = await capture('A1 Kid');
  await walkTo(id, coord);
  const act = await openActionFor(id);
  assert.ok(act && act.code === `students.create.${id}`, 'first raise keeps the exact code');
  const dis = await decide(act.id, 'dismissed', principal, 'not this year');
  assert.equal(dis.statusCode, 200, dis.body);
  const lead = (await sql(`SELECT stage FROM plugin_admissions.lead WHERE id=$1`, [id])).rows[0];
  assert.equal(lead.stage, 'offer', 'dismissal recovered the lead to offer');
  const hist = (await sql(`SELECT from_stage,to_stage FROM plugin_admissions.stage_history WHERE lead_id=$1 ORDER BY at`, [id])).rows;
  assert.ok(hist.some((h) => h.from_stage === 'enrolled' && h.to_stage === 'offer'), 'recovery trail recorded');
  await move(id, 'enrolled', coord);
  const act2 = await openActionFor(id);
  assert.ok(act2 && act2.code !== act.code && act2.code.startsWith(`students.create.${id}.`), `re-raise suffixed, got ${act2?.code}`);
  const ok = await decide(act2.id, 'approved', principal, 'second look');
  assert.equal(ok.statusCode, 200, ok.body);
  const st = (await sql(`SELECT id FROM app.students WHERE tenant_id=$1 AND source='admissions' AND source_ref=$2`, [tenant, id])).rows[0];
  assert.ok(st, 'student created after re-raise + approve');
});

test('A14 · repair door reopens historically stranded leads — and nothing else', async () => {
  const id = await capture('A14 Kid');
  await walkTo(id, coord);
  // a pre-A1 dismissal: decide dismissed through the real door (recovers via A1
  // today, but strand it by hand to prove the repair door for historic rows)
  const act = await openActionFor(id);
  await decide(act.id, 'dismissed', principal, 'old path');
  await sql(`UPDATE plugin_admissions.lead SET stage='enrolled' WHERE id=$1`, [id]);
  const noReason = await app.inject({ method: 'POST', url: `/plugins/admissions.funnel/leads/${id}/reopen`, headers: H(owner), payload: {} });
  assert.equal(noReason.statusCode, 400, 'repair needs a reason');
  const r = await app.inject({ method: 'POST', url: `/plugins/admissions.funnel/leads/${id}/reopen`, headers: H(owner), payload: { reason: 'pre-fix stranding' } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal((await sql(`SELECT stage FROM plugin_admissions.lead WHERE id=$1`, [id])).rows[0].stage, 'offer');
  const live = await capture('A14 Live');
  await walkTo(live, coord);
  const refuse = await app.inject({ method: 'POST', url: `/plugins/admissions.funnel/leads/${live}/reopen`, headers: H(owner), payload: { reason: 'nope' } });
  assert.equal(refuse.statusCode, 409, 'open-action leads are decided, not reopened');
  const finTry = await app.inject({ method: 'POST', url: `/plugins/admissions.funnel/leads/${live}/reopen`, headers: H(fin), payload: { reason: 'nope' } });
  assert.equal(finTry.statusCode, 403, 'repair is owner/principal only');
});

test('A2 · executor refuses unknown classes and duplicate children', async () => {
  const bad = await capture('A2 Faraway', 'Grade 99');
  await walkTo(bad, coord);
  const act = await openActionFor(bad);
  const dec = await decide(act.id, 'approved', principal, 'try');
  assert.equal(dec.statusCode, 409, 'unknown class refused at conversion');
  assert.match(dec.body, /not one of this school's classes/);
  const seed = (await sql(`SELECT name FROM app.students WHERE tenant_id=$1 AND status='active' LIMIT 1`, [tenant])).rows[0];
  const dup = await capture(seed.name);
  await walkTo(dup, coord);
  const act2 = await openActionFor(dup);
  const dec2 = await decide(act2.id, 'approved', principal, 'try');
  assert.equal(dec2.statusCode, 409, 'second student for the same child refused');
  assert.match(dec2.body, /already enrolled/);
});

test('A3 · RTE claim lifecycle: open-first, capped receives, closed-after-received', async () => {
  const base = { academicYear: '2026-27', amountCents: 50000, claimRef: 'A3-CLM-1' };
  const early = await app.inject({ method: 'POST', url: '/rte/reimbursements', headers: H(fin), payload: { ...base, status: 'received' } });
  assert.equal(early.statusCode, 409, 'cannot receive before claiming');
  const open = await app.inject({ method: 'POST', url: '/rte/reimbursements', headers: H(fin), payload: { ...base, status: 'claimed' } });
  assert.equal(open.statusCode, 200, open.body);
  const over = await app.inject({ method: 'POST', url: '/rte/reimbursements', headers: H(fin), payload: { ...base, amountCents: 60000, status: 'partial' } });
  assert.equal(over.statusCode, 409, 'cannot receive more than claimed');
  const part = await app.inject({ method: 'POST', url: '/rte/reimbursements', headers: H(fin), payload: { ...base, amountCents: 20000, status: 'partial' } });
  assert.equal(part.statusCode, 200, part.body);
  const done = await app.inject({ method: 'POST', url: '/rte/reimbursements', headers: H(fin), payload: { ...base, amountCents: 30000, status: 'received' } });
  assert.equal(done.statusCode, 200, done.body);
  const after = await app.inject({ method: 'POST', url: '/rte/reimbursements', headers: H(fin), payload: { ...base, amountCents: 100, status: 'partial' } });
  assert.equal(after.statusCode, 409, 'closed claims take no further rows');
  const dup = await app.inject({ method: 'POST', url: '/rte/reimbursements', headers: H(fin), payload: { ...base, amountCents: 20000, status: 'partial' } });
  assert.equal(dup.statusCode, 409, 'closed (and identical-row race backstop holds)');
});

test('A6 · RTE lottery import needs no fees tier (statutory flow)', async () => {
  await sql(`UPDATE app.tenants SET plan='core' WHERE id=$1`, [tenant]);
  try {
    const r = await app.inject({ method: 'POST', url: '/rte/lottery/import', headers: H(owner), payload: { academicYear: '2026-27',
      rows: [{ name: 'A6 RTE Child', grade: '6', section: 'A', dob: '2020-04-11', gender: 'male', guardianName: 'A6 G', guardianPhone: '9000000001', category: 'EWS' }] } });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().imported.length, 1, JSON.stringify(r.json().failed));
    const waiver = (await sql(`SELECT status, percent FROM app.fee_concessions WHERE tenant_id=$1 AND kind='waiver' ORDER BY created_at DESC LIMIT 1`, [tenant])).rows[0];
    assert.equal(waiver?.status, 'approved', 'statutory waiver still auto-approved');
    assert.equal(Number(waiver?.percent), 100);
  } finally {
    await sql(`UPDATE app.tenants SET plan='trial' WHERE id=$1`, [tenant]);
  }
});

test('A7 · enrollment_term is rejected as unknown (decorative removed)', async () => {
  const r = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/settings', headers: H(owner),
    payload: { admission_year: '2026-27', cycle_start: '01-01', cycle_end: '12-31', enrollment_term: '2027-28' } });
  assert.equal(r.statusCode, 400, 'undeclared keys are rejected by SEC-6 validation');
  const ok = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/settings', headers: H(owner),
    payload: { admission_year: '2026-27', cycle_start: '01-01', cycle_end: '12-31' } });
  assert.equal(ok.statusCode, 200);
});

test('A10 · source catalogue closes capture when configured', async () => {
  const set = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/settings', headers: H(owner),
    payload: { admission_year: '2026-27', cycle_start: '01-01', cycle_end: '12-31', sources: ['walk-in', 'referral'], default_source: 'walk-in' } });
  assert.equal(set.statusCode, 200, set.body);
  const bad = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/leads', headers: H(coord),
    payload: { studentName: 'A10 Off', guardianPhone: freshPhone(), classApplied: '6', source: 'carrier-pigeon' } });
  assert.equal(bad.statusCode, 400, 'off-catalogue source refused');
  assert.match(bad.json().error, /walk-in, referral/);
  const good = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/leads', headers: H(coord),
    payload: { studentName: 'A10 On', guardianPhone: freshPhone(), classApplied: '6', source: 'referral' } });
  assert.equal(good.statusCode, 200, good.body);
  await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/settings', headers: H(owner),
    payload: { admission_year: '2026-27', cycle_start: '01-01', cycle_end: '12-31' } });
});

test('A8 · seat capacity stops offers, suggests waitlist', async () => {
  const set = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/settings', headers: H(owner),
    payload: { admission_year: '2026-27', cycle_start: '01-01', cycle_end: '12-31', class_capacity: 1 } });
  assert.equal(set.statusCode, 200, set.body);
  // grade 6 holds 75 seed pupils — any fresh offer must refuse
  const id2 = await capture('A8 Full2');
  for (const s of ['form', 'interaction']) {
    const r = await move(id2, s, coord);
    assert.equal(r.statusCode, 200, r.body);
  }
  const over = await move(id2, 'offer', coord);
  assert.equal(over.statusCode, 409, 'full class refuses the offer');
  assert.match(over.json().error, /waitlisted/);
  const wait = await move(id2, 'waitlisted', coord);
  assert.equal(wait.statusCode, 409, 'waitlisted branches off offer, not interaction');
  await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/settings', headers: H(owner),
    payload: { admission_year: '2026-27', cycle_start: '01-01', cycle_end: '12-31', class_capacity: 0 } });
});

test('A9 · dob validated at capture; age bands enforced at conversion', async () => {
  const bad = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/leads', headers: H(coord),
    payload: { studentName: 'A9 Bad', guardianPhone: freshPhone(), classApplied: '6', dob: 'not-a-date' } });
  assert.equal(bad.statusCode, 400, 'malformed dob refused');
  const id = await capture('A9 Band', '6', { dob: '2020-04-11' });
  const stored = (await sql(`SELECT dob FROM plugin_admissions.lead WHERE id=$1`, [id])).rows[0];
  assert.ok(stored.dob, 'dob stored on the lead');
  await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/settings', headers: H(owner),
    payload: { admission_year: '2026-27', cycle_start: '01-01', cycle_end: '12-31', age_bands: { 6: { min: 10, max: 12 } } } });
  await walkTo(id, coord);
  const act = await openActionFor(id);
  const dec = await decide(act.id, 'approved', principal, 'try');
  assert.equal(dec.statusCode, 409, 'under-age conversion refused');
  assert.match(dec.body, /outside class/);
  await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/settings', headers: H(owner),
    payload: { admission_year: '2026-27', cycle_start: '01-01', cycle_end: '12-31', age_bands: {} } });
});

test('A11 · offer letter encloses the class fee table', async () => {
  await app.inject({ method: 'POST', url: '/fee-plans', headers: H(fin),
    payload: { name: 'A11 plan', grades: ['6'], terms: [{ term: 'T1', label: 'A11 tuition', amount_cents: 120000 }] } });
  const id = await capture('A11 Fee');
  await walkTo(id, coord, 'offer');
  const r = await app.inject({ method: 'GET', url: `/plugins/admissions.funnel/leads/${id}/offer-letter`, headers: H(coord) });
  assert.equal(r.statusCode, 200, r.body);
  assert.ok((r.json().feeLines ?? []).length >= 1, 'fee lines resolved for the class');
  assert.match(r.json().letter, /A11 tuition/, 'letter encloses the price');
});

test('A13 · upcoming interviews surface through the SLA sweep', async () => {
  const id = await capture('A13 Meet');
  const when = new Date(Date.now() + 24 * 3600e3).toISOString();
  const a = await app.inject({ method: 'POST', url: `/plugins/admissions.funnel/leads/${id}/activities`, headers: H(coord),
    payload: { kind: 'interview', scheduledAt: when, notes: 'round one' } });
  assert.equal(a.statusCode, 200, a.body);
  const sweep = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/sla/run', headers: H(owner), payload: {} });
  assert.equal(sweep.statusCode, 200, sweep.body);
  assert.ok(sweep.json().reminded >= 1, 'interview reminded');
  const n = (await sql(`SELECT title FROM app.notifications WHERE tenant_id=$1 AND ref=$2`, [tenant, `activity:${a.json().activity.id}`])).rows[0];
  assert.ok(n && /Upcoming interview/.test(n.title), 'notification names the interview');
});

test('A5 · day-worker admissions step runs the shared sweep (contained)', async () => {
  const day = await import('../scripts/day-worker.js');
  assert.equal(typeof day.runAdmissionsFollowupHook, 'function', 'step exported');
  const out = await day.runAdmissionsFollowupHook();
  assert.equal(out.status, 'ok', JSON.stringify(out));
  assert.equal(typeof out.scanned, 'number');
  const contained = await day.runAdmissionsFollowupHook({ runSla: async () => { throw new Error('synthetic sla failure'); } });
  assert.equal(contained.status, 'skipped', 'a failing sweep is reported, never thrown');
  assert.match(contained.reason, /synthetic sla failure/);
});
