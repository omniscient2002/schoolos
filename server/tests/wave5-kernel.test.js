// Wave-5 kernel doors (L1-5.1 + L1-5.2, D-36 GO / D-38):
//   GET /admissions/followups  — deterministic lead ranking (followups-1), PII
//   masked like the funnel door, enrolled/dropped never rank.
//   GET /reports/fees/summary  — whole-collection aggregate (billed/collected/
//   outstanding/voided per term) that ops.bi's overdue-only aging lacks.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';
import pg from 'pg';

let app;
let sql;
let ownerToken, coordinatorToken, financeToken, teacherToken;
let tenantA, ayId;
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
  coordinatorToken = (await loginAs(app, 'coordinator@meridian.edu')).token;
  financeToken = (await loginAs(app, 'finance@meridian.edu')).token;
  teacherToken = (await loginAs(app, 'teacher@meridian.edu')).token;
  tenantA = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  // seed leads across stages/ages (distinct enough that the rule order is total)
  const lead = async (name, stage, daysAgo) => (await sql(
    `INSERT INTO plugin_admissions.lead (tenant_id, student_name, guardian_name, guardian_phone, class_applied, source, stage, updated_at)
     VALUES ($1,$2,'Guardian '||$2,'+919000123456','6','walk-in',$3, now() - ($4 || ' days')::interval) RETURNING id`,
    [tenantA, name, stage, String(daysAgo)])).rows[0].id;
  await lead('TC Stuck Offer', 'offer', 9);          // stuck, weight 2.5 → score 22.5 (top)
  await lead('TC Stuck Inquiry', 'inquiry', 12);     // stuck, weight 1.0 → score 12
  await lead('TC Fresh Assessment', 'assessment', 3); // not stuck, score 6
  await lead('TC Fresh Visit', 'school-visit', 4);   // not stuck, score 4.8
  await lead('TC Enrolled', 'enrolled', 30);         // excluded
  await lead('TC Dropped', 'dropped', 30);           // excluded
  // seed fee obligations for the summary
  ayId = (await sql(
    `INSERT INTO app.academic_years (tenant_id, name, starts_on, ends_on, is_current)
     VALUES ($1,'TC AY 2026','2026-04-01','2027-03-31', true) RETURNING id`, [tenantA])).rows[0].id;
  const obl = (term, amount, paid, status, ay) => sql(
    `INSERT INTO app.fee_obligations (tenant_id, student_id, term, label, amount_cents, paid_cents, status, academic_year_id, source_ref)
     SELECT $1, id, $2, 'TC fee ' || $5, $3, $4, $5, $6, 'tc-summary' FROM app.students WHERE tenant_id=$1 AND status='active' LIMIT 1`,
    [tenantA, term, amount, paid, status, ay]);
  // unique term names: the seed world ships its own ledger, so exact per-term
  // assertions use terms no seed row can collide with; whole-tenant totals are
  // asserted against ground truth read from the DB in the same run.
  await obl('TCT5', 100000n, 100000n, 'paid', ayId);
  await obl('TCT5', 100000n, 40000n, 'partial', ayId);
  await obl('TCT5', 100000n, 0n, 'open', ayId);
  await obl('TCT5', 100000n, 0n, 'void', null);      // voided + no AY: excluded from AY filter, excluded from outstanding
  await obl('TCT6', 50000n, 0n, 'open', ayId);       // not_due but billed
});
after(async () => { await app?.close(); });

test('FU · deterministic ranking: stuck-first then score desc; terminal stages excluded', async () => {
  const r = await app.inject({ method: 'GET', url: '/admissions/followups', headers: H(ownerToken) });
  assert.equal(r.statusCode, 200, r.body);
  const j = r.json();
  assert.equal(j.ruleVersion, 'followups-1');
  assert.match(j.rule, /no model/);
  const q = j.queue;
  assert.equal(q.length, 4, 'enrolled/dropped never rank');
  assert.equal(q[0].studentName, 'TC Stuck Offer');
  assert.equal(q[0].score, 22.5);
  assert.equal(q[1].studentName, 'TC Stuck Inquiry');
  assert.equal(q[2].studentName, 'TC Fresh Assessment');
  assert.equal(q[3].studentName, 'TC Fresh Visit');
  assert.ok(q.slice(0, 2).every(x => x.stuck) && q.slice(2).every(x => !x.stuck));
});

test('FU · PII masking mirrors the funnel door; masked roles cannot see contacts', async () => {
  const full = await app.inject({ method: 'GET', url: '/admissions/followups', headers: H(coordinatorToken) });
  assert.equal(full.json().masked, false);
  assert.equal(full.json().queue[0].guardianName, 'Guardian TC Stuck Offer');
  assert.match(full.json().queue[0].guardianPhone, /^\+919000123456$/);
  const masked = await app.inject({ method: 'GET', url: '/admissions/followups', headers: H(financeToken) });
  assert.equal(masked.json().masked, true);
  assert.equal(masked.json().queue[0].guardianName, null);
  assert.equal(masked.json().queue[0].guardianPhone, '90xxxx56', 'funnel-style mask — last 10 digits of E.164');
  const t = await app.inject({ method: 'GET', url: '/admissions/followups', headers: H(teacherToken) });
  assert.equal(t.json().masked, true);
});

test('FS · whole-collection summary: billed/collected/outstanding/void per term', async () => {
  const r = await app.inject({ method: 'GET', url: '/reports/fees/summary', headers: H(financeToken) });
  assert.equal(r.statusCode, 200, r.body);
  const j = r.json();
  const t5 = j.terms.find(x => x.term === 'TCT5');
  assert.equal(t5.obligations, 4);
  assert.equal(Number(t5.billed_cents), 400000);
  assert.equal(Number(t5.collected_cents), 140000);
  assert.equal(Number(t5.outstanding_cents), 160000, 'partial 60k + open 100k; voided 100k excluded');
  assert.equal(t5.voided, 1);
  assert.equal(t5.fully_paid, 1);
  const t6 = j.terms.find(x => x.term === 'TCT6');
  assert.equal(Number(t6.billed_cents), 50000);
  assert.equal(Number(t6.outstanding_cents), 50000, 'not_due still counts as outstanding');
  // whole-tenant totals: the seed world's ledger is in scope too — assert the
  // door equals ground truth read from the same DB (hermetic, not hand-pinned)
  const gt = (await sql(
    `SELECT COALESCE(SUM(amount_cents),0)::text billed, COALESCE(SUM(paid_cents),0)::text collected,
            COALESCE(SUM(amount_cents - paid_cents) FILTER (WHERE status IN ('open','partial')),0)::text outstanding,
            count(*)::int n FROM app.fee_obligations WHERE tenant_id=$1`, [tenantA])).rows[0];
  assert.equal(j.totals.billed_cents, Number(gt.billed));
  assert.equal(j.totals.collected_cents, Number(gt.collected));
  assert.equal(j.totals.outstanding_cents, Number(gt.outstanding));
  assert.equal(j.totals.obligations, gt.n);
  assert.equal(j.collectionPct, gt.billed > 0n ? Math.round((Number(gt.collected) / Number(gt.billed)) * 1000) / 10 : null);
  assert.match(j.note, /D-5\/D-21/);
});

test('FS · academic-year filter and validation; teacher refused', async () => {
  const ay = await app.inject({ method: 'GET', url: `/reports/fees/summary?academicYearId=${ayId}`, headers: H(ownerToken) });
  assert.equal(ay.statusCode, 200);
  assert.equal(ay.json().terms.length, 2, 'my two terms only — seed rows carry the seed AY');
  const ayt5 = ay.json().terms.find(x => x.term === 'TCT5');
  assert.equal(ayt5.obligations, 3, 'paid+partial+open; void/AY-less row filtered out of its term too');
  assert.equal(ay.json().collectionPct, 40, '140000/350000 within my AY');
  assert.equal(ay.json().academicYearId, ayId);
  const bad = await app.inject({ method: 'GET', url: '/reports/fees/summary?academicYearId=not-a-uuid', headers: H(ownerToken) });
  assert.equal(bad.statusCode, 400);
  const t = await app.inject({ method: 'GET', url: '/reports/fees/summary', headers: H(teacherToken) });
  assert.equal(t.statusCode, 403, 'school-wide aggregates are staff-desk only');
});
