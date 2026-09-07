// pack.cbse — wave-3 policy-pair tests (009 contract + migration 026)
// Pins: lifecycle gate, rules catalog, six deterministic rules (R1–R6), the 009-mandated
// kernel obligation raise on weightage_total <> 100 (per-exam code + cbse.obligation.due.v1),
// validation digest stability, OASIS export (R6-gated, published-only, content-hashed,
// digest-level audit), teacher/finance/parent 403. Class C — the pack has NO data plane.
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

describe('pack.cbse (wave-3 · 009 contract + 026 · rules not code)', () => {
  test('1 · registered-not-enabled: lifecycle gate 409; teacher/finance/parent 403 on every door', async () => {
    const pre = await app.inject({ method: 'GET', url: '/plugins/pack.cbse/rules', headers: H((await loginAs(app, 'coordinator@meridian.edu')).token) });
    assert.equal(pre.statusCode, 409);
    assert.match(pre.json().error, /switched off/); // plain-language copy pass (gate)
    await app.inject({ method: 'POST', url: '/plugins/pack.cbse/enable',
      headers: H((await loginAs(app, 'owner@meridian.edu')).token), payload: { version: '1.0.0', class: 'C' } });
    for (const role of ['teacher@meridian.edu', 'finance@meridian.edu', 'parent@meridian.edu']) {
      const r = await app.inject({ method: 'GET', url: '/plugins/pack.cbse/rules', headers: H((await loginAs(app, role)).token) });
      assert.equal(r.statusCode, 403, `${role} is outside the CBSE tier`);
    }
  });

  test('2 · rules catalog: six board rules, deterministic; R1 title weightage_total', async () => {
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const r1 = await app.inject({ method: 'GET', url: '/plugins/pack.cbse/rules', headers: H(co.token) });
    const r2 = await app.inject({ method: 'GET', url: '/plugins/pack.cbse/rules', headers: H(co.token) });
    assert.equal(r1.statusCode, 200);
    assert.equal(r1.body, r2.body, 'catalog is deterministic');
    const rules = r1.json().rules;
    assert.equal(rules.length, 6);
    assert.equal(rules.find((x) => x.id === 'R1').title, 'weightage_total');
  });

  test('3 · R1 fail → kernel obligation raised under per-exam code + cbse.obligation.due.v1; reuse while open', async () => {
    const o = await loginAs(app, 'owner@meridian.edu');
    // exams rail needed: create a non-compliant exam (weightage 60/30 = 90)
    await app.inject({ method: 'POST', url: '/plugins/exams.assessment/enable',
      headers: H(o.token), payload: { version: '1.0.0', class: 'D' } });
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const bad = await app.inject({ method: 'POST', url: '/plugins/exams.assessment/exams',
      payload: { name: 'CBSE Bad Plan', classGrade: '8', weightage: { written: 60, oral: 30 } }, headers: H(co.token) });
    assert.equal(bad.statusCode, 409, 'exams.create itself refuses Σ≠100 (safeguard stays kernel)');
    // the pack validates an exam that EXISTS; create a compliant one, then corrupt the
    // stored weightage directly (simulating any path that left non-compliant data — the
    // pack re-derives, it never trusts)
    const good = await (await app.inject({ method: 'POST', url: '/plugins/exams.assessment/exams',
      payload: { name: 'CBSE Good Plan', classGrade: '8', weightage: { written: 100 } }, headers: H(co.token) })).json();
    await sql(`UPDATE plugin_exams.exam SET weightage='{"written":60,"oral":30}'::jsonb WHERE id=$1`, [good.examId]);
    const v = await app.inject({ method: 'GET', url: `/plugins/pack.cbse/validate/exam/${good.examId}`, headers: H(co.token) });
    assert.equal(v.statusCode, 200);
    const body = v.json();
    assert.equal(body.rules.find((d) => d.id === 'R1').decision, 'fail');
    assert.ok(body.obligation?.actionId, 'kernel obligation raised (009 action.raise, guard weightage_total<>100)');
    const act = (await sql(`SELECT code, status, policy_ref FROM app.actions WHERE id=$1`, [body.obligation.actionId])).rows[0];
    assert.equal(act.status, 'open');
    assert.equal(act.policy_ref, 'CBSE pack obligations');
    assert.match(act.code, /^cbse\.weightage\./, 'per-exam action code (UNIQUE tenant+code kernel constraint)');
    const v2 = await app.inject({ method: 'GET', url: `/plugins/pack.cbse/validate/exam/${good.examId}`, headers: H(co.token) });
    assert.equal(v2.json().obligation.reused, true, 'open obligation reused, not duplicated');
    const ev = await sql(`SELECT count(*)::int n FROM app.outbox WHERE topic='cbse.obligation.due.v1'`);
    assert.equal(ev.rows[0].n >= 1, true);
    // full-level audit per the 009 contract
    const aud = await sql(`SELECT count(*)::int n FROM app.audit_log WHERE action='assessment validated (CBSE pack)'`);
    assert.equal(aud.rows[0].n >= 2, true);
  });

  test('4 · all-pass exam: six decisions, digest stable across reads, no obligation', async () => {
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const exams = (await app.inject({ method: 'GET', url: '/plugins/exams.assessment/exams', headers: H(co.token) })).json();
    const examId = exams.exams.find((e) => e.name === 'CBSE Good Plan').id;
    // remediation: the data behind the open obligation gets fixed (obligation stays open
    // and decided-by-humans — the pack only raises and re-derives)
    await sql(`UPDATE plugin_exams.exam SET weightage='{"written":100}'::jsonb WHERE id=$1`, [examId]);
    const v = await app.inject({ method: 'GET', url: `/plugins/pack.cbse/validate/exam/${examId}`, headers: H(co.token) });
    const b = v.json();
    assert.equal(b.counts.fail, 0);
    assert.equal(b.counts.warn >= 1, true, 'R5 warn pre-publication, R6 warn unconfigured');
    const v2 = await app.inject({ method: 'GET', url: `/plugins/pack.cbse/validate/exam/${examId}`, headers: H(co.token) });
    assert.equal(b.digest, v2.json().digest, 'deterministic_only: same inputs → same validation digest');
    assert.equal(b.obligation, null, 'no obligation when R1 passes');
  });

  test('5 · OASIS export: R6-gated (settings required), published-only, content-hashed, digest audit', async () => {
    const o = await loginAs(app, 'owner@meridian.edu');
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const exams = (await app.inject({ method: 'GET', url: '/plugins/exams.assessment/exams', headers: H(co.token) })).json();
    const examId = exams.exams.find((e) => e.name === 'CBSE Good Plan').id;
    const gated = await app.inject({ method: 'GET', url: `/plugins/pack.cbse/export/oasis/${examId}`, headers: H(co.token) });
    assert.equal(gated.statusCode, 409);
    assert.match(gated.json().error, /affiliation number/); // plain-language copy pass (was /R6/)
    await app.inject({ method: 'POST', url: '/plugins/pack.cbse/settings',
      headers: H(o.token), payload: { affiliation_no: '1130001', academic_year: '2026-27' } });
    const draft = await app.inject({ method: 'GET', url: `/plugins/pack.cbse/export/oasis/${examId}`, headers: H(co.token) });
    assert.equal(draft.statusCode, 409, 'draft exam never exports');
    assert.match(draft.json().error, /Publish this exam first/); // plain-language copy pass (was /not published/)
    // publish via the kernel spine
    const pub = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${examId}/publish`, payload: {}, headers: H(co.token) });
    const principal = await loginAs(app, 'principal@meridian.edu');
    await app.inject({ method: 'POST', url: `/actions/${pub.json().actionId}/decide`,
      payload: { decision: 'approved', note: 'board-ready' }, headers: H(principal.token) });
    const ex = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${examId}/publish/execute`, payload: {}, headers: H(principal.token) });
    assert.equal(ex.statusCode, 200);
    const exp = await app.inject({ method: 'GET', url: `/plugins/pack.cbse/export/oasis/${examId}`, headers: H(co.token) });
    assert.equal(exp.statusCode, 200);
    const b = exp.json();
    assert.match(b.csv, /^BOARD,CBSE\nAFFILIATION_NO,1130001\n/);
    assert.ok(b.contentHash, 'sha256 content hash stamped');
    const aud = await sql(`SELECT outcome FROM app.audit_log WHERE action='OASIS export generated' ORDER BY created_at DESC LIMIT 1`);
    assert.match(aud.rows[0].outcome, /content_hash=/, 'digest-level export audit (tally precedent)');
  });
});
