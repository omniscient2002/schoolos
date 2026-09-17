// cycle-6 P2/P3 hardening regression pins (migration 030 + module fixes) — final
// numbered unit of the lane.
// S0 repair (D-44, cross-zone — full-gate run): the visitors pickup pin reads
// devCode, which the fail-closed dev-echo contract only echoes when OTP_DEV_ECHO is
// armed BEFORE the app import (same as l2-auth-session). Arming it here restores the
// pin's original purpose: OTP must be a 6-digit CSPRNG draw, echoed in dev only.
process.env.OTP_DEV_ECHO = '1';
process.env.NODE_ENV = 'development';
// P2-1: moderation adjustedSnapshot is bounded (finite pct in [0,100] via
//   Number.isFinite — pct:0 is legitimate) and grade/points are RE-DERIVED via the
//   module's gradeOf on the exam's scale; the read path re-derives again before
//   serving (trust nothing stored, even pre-hardening overlays).
// P2-2: shared uuid-param guard (src/plugins/_shared/uuid-param.js) across 7 :id
//   doors in 5 modules — garbage ids die with 400, never a Postgres 22P02 → 500.
// P3:  dpdp normalize-before-validate (16-char spaced variants accepted) · visitors
//   OTP via crypto.randomInt · guardian-lookup ILIKE wildcard escape · hr
//   RELEASE-before-return (behavior unchanged; verified by the existing suite) ·
//   clinic correction escalation re-fires the guardian notice.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setupTestDb, loginAs } from './helpers.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const HERE = dirname(fileURLToPath(import.meta.url));

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

let app;
let sql;
let examId, studentId, teacherId;

// the rate limiter is real (by design) — cache tokens instead of re-logging-in per test
const _loginAs = loginAs;
const tokenCache = {};
const cachedLogin = async (a, email) => tokenCache[email] ?? (tokenCache[email] = await _loginAs(a, email));

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
  const o = await cachedLogin(app, 'owner@meridian.edu');
  for (const p of ['ops.visitors', 'exams.assessment', 'pack.dpdp', 'admissions.funnel', 'hr.leave', 'health.clinic']) {
    const r = await app.inject({ method: 'POST', url: `/plugins/${p}/enable`, headers: H(o.token), payload: { version: '1.0.0', class: 'C' } });
    assert.equal(r.statusCode, 200, `${p} enable: ${r.body}`);
  }
  studentId = (await sql(`SELECT id FROM app.students ORDER BY created_at LIMIT 1`)).rows[0].id;
  teacherId = (await sql(`SELECT id FROM app.users WHERE role='teacher' LIMIT 1`)).rows[0].id;
});

describe('P2-2 · uuid-param guards (garbage :id → 400, never 22P02/500)', () => {
  const cases = [
    ['coordinator@meridian.edu', '/plugins/ops.visitors/visitors/zzz/checkin', {}],
    ['coordinator@meridian.edu', '/plugins/admissions.funnel/leads/zzz/stage', { to: 'form' }],
    ['coordinator@meridian.edu', '/plugins/health.clinic/visits/zzz/correct', { correction: 'x' }],
    ['principal@meridian.edu', '/plugins/hr.leave/leave/zzz/cancel', {}],
    ['principal@meridian.edu', '/plugins/exams.assessment/exams/zzz/publish', {}],
    ['coordinator@meridian.edu', '/plugins/pack.dpdp/dsr/zzz/execute', {}],
  ];
  for (const [who, url, payload] of cases) {
    test(`${url}`, async () => {
      const u = await cachedLogin(app, who);
      const r = await app.inject({ method: 'POST', url, payload, headers: H(u.token) });
      assert.equal(r.statusCode, 400, `expected 400: ${r.body}`);
      assert.match(r.json().error, /valid ID/); // plain-language copy pass (was /uuid/)
    });
  }
  test('multi-param door: garbage studentId on the moderate route → 400', async () => {
    const pr = await cachedLogin(app, 'principal@meridian.edu');
    const good = '00000000-0000-4000-8000-000000000000';
    const r = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${good}/reports/zzz/moderate`,
      payload: { reason: 'test' }, headers: H(pr.token) });
    assert.equal(r.statusCode, 400);
    const r2 = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/zzz/reports/${good}/moderate`,
      payload: { reason: 'test' }, headers: H(pr.token) });
    assert.equal(r2.statusCode, 400);
  });
});

describe('P2-1 · moderation bounds + re-derivation (trust nothing stored)', () => {
  before(async () => {
    // build a published exam with one report (spine path, per the exams suite pattern)
    const t = await cachedLogin(app, 'principal@meridian.edu'); // exams creation is EXAM_ADMIN lane (teacher-create 403 per cycle 6)
    const mk = await app.inject({ method: 'POST', url: '/plugins/exams.assessment/exams',
      payload: { name: 'RT6 Hardening T1', term: 'Term 1', classGrade: '8', subject: 'Mathematics',
        examDate: '2026-09-07', maxMarks: 100, weightage: { written: 100 } }, headers: H(t.token) });
    assert.equal(mk.statusCode, 200, mk.body);
    examId = mk.json().examId;
    await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${examId}/marks`,
      payload: { studentId, component: 'written', marks: 82, maxMarks: 100 }, headers: H(t.token) });
    const pr = await cachedLogin(app, 'principal@meridian.edu');
    const pub = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${examId}/publish`, payload: {}, headers: H(pr.token) });
    assert.equal(pub.statusCode, 200, pub.body);
    // SoD: the raising principal may not execute — a second principal decides the
    // publication action first (exams suite precedent)
    const actionId = (await sql(`SELECT action_id FROM plugin_exams.exam WHERE id=$1`, [examId])).rows[0].action_id;
    const o2 = await cachedLogin(app, 'owner@meridian.edu');
    const dec = await app.inject({ method: 'POST', url: `/actions/${actionId}/decide`,
      payload: { decision: 'approved', note: 'publication approved' }, headers: H(o2.token) });
    assert.equal(dec.statusCode, 200, dec.body);
    const ex = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${examId}/publish/execute`, payload: {}, headers: H(o2.token) }); // executor ≠ proposer
    assert.equal(ex.statusCode, 200, ex.body);
  });

  const propose = async () => {
    // sweep still-open proposals from earlier tests (a 400 at decide leaves them open);
    // the sweeper (owner) must differ from the proposer (coordinator) per SoD
    const ow = await cachedLogin(app, 'owner@meridian.edu');
    const open = (await sql(`SELECT id FROM plugin_exams.moderation WHERE report_id=(SELECT id FROM plugin_exams.report WHERE exam_id=$1) AND status='proposed'`, [examId])).rows;
    for (const row of open) {
      const d = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/moderations/${row.id}/decide`,
        payload: { decision: 'rejected', note: 'swept by the harness' }, headers: H(ow.token) });
      assert.equal(d.statusCode, 200, d.body);
    }
    const pr = await cachedLogin(app, 'principal@meridian.edu');
    const co = await cachedLogin(app, 'coordinator@meridian.edu');
    const p = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/exams/${examId}/reports/${studentId}/moderate`,
      payload: { reason: 'recheck requested' }, headers: H(co.token) });
    assert.equal(p.statusCode, 200, p.body);
    return { pr, mid: p.json().moderationId };
  };

  test('pct:99999 → 400 at approve (bounds enforced)', async () => {
    const { pr, mid } = await propose();
    const d = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/moderations/${mid}/decide`,
      payload: { decision: 'approved', adjustedSnapshot: { pct: 99999, grade: 'A1', points: 10 } }, headers: H(pr.token) });
    assert.equal(d.statusCode, 400, `expected 400: ${d.body}`);
    assert.match(d.json().error, /0 to 100/); // plain-language copy pass (was /[0,100]/)
  });

  test('pct:0 → 400-free path approved (Number.isFinite, NOT truthiness)', async () => {
    const { pr, mid } = await propose();
    const d = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/moderations/${mid}/decide`,
      payload: { decision: 'approved', adjustedSnapshot: { pct: 0 } }, headers: H(pr.token) });
    assert.equal(d.statusCode, 200, `pct:0 is a legitimate adjustment: ${d.body}`);
    const read = await app.inject({ method: 'GET', url: `/plugins/exams.assessment/exams/${examId}/reports/${studentId}`, headers: H(pr.token) });
    assert.equal(read.json().report.pct, 0, 'zero adjustment served');
    assert.equal(read.json().report.grade, 'E', 'grade re-derived for 0% (cbse_10_point)');
    assert.equal(read.json().moderated, true);
  });

  test('hand-supplied grade mismatch → 400 (re-derivation wins)', async () => {
    const { pr, mid } = await propose();
    const d = await app.inject({ method: 'POST', url: `/plugins/exams.assessment/moderations/${mid}/decide`,
      payload: { decision: 'approved', adjustedSnapshot: { pct: 50, grade: 'A1' } }, headers: H(pr.token) });
    assert.equal(d.statusCode, 400, `expected 400: ${d.body}`);
    assert.match(d.json().error, /does not follow from/); // plain-language copy pass (was /mismatch/)
  });

  test('read-path defense: even a poisoned overlay cannot serve an absurd grade', async () => {
    // simulate a pre-hardening overlay written directly into a moderation row
    const { createHash } = await import('node:crypto');
    const poisoned = { snapshot: { pct: 99999, grade: 'A1', points: 10 }, digest: createHash('sha256').update('x').digest('hex') };
    await sql(`UPDATE plugin_exams.moderation SET status='approved', adjusted_snapshot=$2::jsonb WHERE id=(
      SELECT id FROM plugin_exams.moderation WHERE report_id=(SELECT id FROM plugin_exams.report WHERE exam_id=$1) ORDER BY decided_at DESC LIMIT 1)`,
      [examId, JSON.stringify(poisoned)]);
    const pr = await cachedLogin(app, 'principal@meridian.edu');
    const read = await app.inject({ method: 'GET', url: `/plugins/exams.assessment/exams/${examId}/reports/${studentId}`, headers: H(pr.token) });
    assert.equal(read.statusCode, 200);
    assert.equal(read.json().moderated, false, 'poisoned overlay NOT served as moderation');
    assert.ok(read.json().report.pct <= 100, 'served pct is bounded');
  });

  test('overlay carries the audit chain (correctsReportId + originalDigest)', async () => {
    const mo = (await sql(`SELECT adjusted_snapshot FROM plugin_exams.moderation WHERE status='approved' AND adjusted_snapshot->>'correctsReportId' IS NOT NULL ORDER BY decided_at DESC LIMIT 1`)).rows[0];
    const o = typeof mo.adjusted_snapshot === 'string' ? JSON.parse(mo.adjusted_snapshot) : mo.adjusted_snapshot; // a post-fix overlay
    assert.match(o.correctsReportId, /^[0-9a-f-]{36}$/, 'report linkage on the overlay');
    assert.match(o.originalDigest, /^[0-9a-f]{64}$/, 'original digest preserved');
  });
});

describe('P3 hygiene pins', () => {
  test('P3-1 · dpdp: 16-char spaced subjectRef accepted (normalize BEFORE validate)', async () => {
    const co = await cachedLogin(app, 'coordinator@meridian.edu');
    const r = await app.inject({ method: 'POST', url: '/plugins/pack.dpdp/consent',
      payload: { subjectRef: '+91 98000 770004', purpose: 'admissions_enquiry', decision: 'granted' }, headers: H(co.token) });
    assert.equal(r.statusCode, 200, `spaced 16-char must pass: ${r.body}`);
    const row = (await sql(`SELECT subject_ref FROM plugin_dpdp.consent WHERE subject_ref='+9198000770004'`)).rows[0];
    assert.ok(row, 'stored normalized');
    const garbage = await app.inject({ method: 'POST', url: '/plugins/pack.dpdp/consent',
      payload: { subjectRef: 'not-a-phone', purpose: 'admissions_enquiry', decision: 'granted' }, headers: H(co.token) });
    assert.equal(garbage.statusCode, 400, 'normalized-form validation still refuses garbage');
  });

  test('P3-2 · visitors: OTP is drawn from the CSPRNG (structure unchanged; 6-digit, hashed, consumed)', async () => {
    const co = await cachedLogin(app, 'coordinator@meridian.edu');
    const v = await app.inject({ method: 'POST', url: '/plugins/ops.visitors/visitors',
      payload: { visitorName: 'P3 Parent', visitorPhone: '9876500444', purpose: 'pickup', studentId }, headers: H(co.token) });
    const vid = v.json().visitId;
    await app.inject({ method: 'POST', url: `/plugins/ops.visitors/visitors/${vid}/checkin`, payload: {}, headers: H(co.token) });
    const p = await app.inject({ method: 'POST', url: `/plugins/ops.visitors/visitors/${vid}/pickup`, payload: {}, headers: H(co.token) });
    assert.match(p.json().devCode, /^\d{6}$/, '6-digit code');
    /* TST-4: the old comment claimed this pinned `randomInt(100000, 1000000)`, but `Math.random()` produces
       six digits too — the assertion was satisfied by the defect it named. Randomness is not observable from
       one draw, so the honest pin is a source check (the same form the library/frontend tests use): the pickup
       code must come from the CSPRNG, and a fallback to Math.random must not exist in the file at all. */
    const pickupSrc = readFileSync(join(HERE, '../src/plugins/ops.visitors/index.js'), 'utf8');
    assert.match(pickupSrc, /randomInt\(/, 'the pickup code must be drawn from node:crypto randomInt');
    assert.ok(!/Math\.random\(/.test(pickupSrc), 'no Math.random anywhere in the visitor plugin — it is not a CSPRNG');
    assert.match(pickupSrc, /scryptSync\(/, 'and the code is stored as a salted scrypt hash, not plaintext');
    // L1 sprint T102: pickup OTPs live in plugin_visitors.pickup_otp (P0-1 vault split)
    const vault = await sql(`SELECT code_hash, consumed_at FROM plugin_visitors.pickup_otp WHERE id=(SELECT otp_request_id FROM plugin_visitors.visit WHERE id=$1)`, [vid]);
    assert.match(vault.rows[0].code_hash, /^[^:]+:[0-9a-f]{128}$/, 'scrypt+salt hash in the vault');
  });

  test('P3-5 · guardian-lookup: wildcards are literal (q=% matches nothing)', async () => {
    const co = await cachedLogin(app, 'coordinator@meridian.edu');
    const r = await app.inject({ method: 'GET', url: '/plugins/ops.visitors/guardian-lookup?q=%25', headers: H(co.token) });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().matches.length, 0, 'a bare % is a literal, not a wildcard');
    const underscore = await app.inject({ method: 'GET', url: '/plugins/ops.visitors/guardian-lookup?q=Guardian%20of%20_', headers: H(co.token) });
    assert.equal(underscore.json().matches.length, 0, 'a bare _ is a literal too');
  });

  test('P3-3 · clinic correction escalation re-fires the guardian notice', async () => {
    const co = await cachedLogin(app, 'coordinator@meridian.edu');
    const v = await app.inject({ method: 'POST', url: '/plugins/health.clinic/visits',
      payload: { studentId, complaint: 'mild bruise', action: 'rest' }, headers: H(co.token) });
    assert.equal(v.statusCode, 200, v.body);
    const before = (await sql(`SELECT count(*)::int n FROM app.actions WHERE code LIKE 'clinic.notify.%'`)).rows[0].n;
    const corr = await app.inject({ method: 'POST', url: `/plugins/health.clinic/visits/${v.json().visitId}/correct`,
      payload: { correction: 'condition worsened — guardian pickup needed', action: 'sent_home' }, headers: H(co.token) });
    assert.equal(corr.statusCode, 200, corr.body);
    assert.match(corr.json().noticeActionId, /^[0-9a-f-]{36}$/, 'escalation re-fired the notice');
    const a = (await sql(`SELECT code, payload FROM app.actions WHERE id=$1`, [corr.json().noticeActionId])).rows[0];
    assert.match(a.code, new RegExp(`^clinic\\.notify\\.${corr.json().correctionId}$`), 'per-instance code on the correction row');
    assert.equal(a.payload.kind, 'message');
    const after = (await sql(`SELECT count(*)::int n FROM app.actions WHERE code LIKE 'clinic.notify.%'`)).rows[0].n;
    assert.equal(after, before + 1);
    // non-escalating correction fires nothing
    const corr2 = await app.inject({ method: 'POST', url: `/plugins/health.clinic/visits/${v.json().visitId}/correct`,
      payload: { correction: 'stable, resting' }, headers: H(co.token) });
    assert.equal(corr2.json().noticeActionId, null, 'no escalation, no notice');
  });
});
