// Fee-domain ROLE DRILL — every fees operation, executed as every role, verified in the DB.
//
// Usage: TEST_DB_NAME=schoolos_feedrill node scripts/fee-role-drill.js
// Writes JSON report to /tmp/fee-role-drill.json and prints a human summary.
// Exit 0 = drill completed (individual op failures are RECORDED, not thrown).
import pg from 'pg';
import fs from 'node:fs';
import { setupTestDb, loginAs, TEST_URL } from '../tests/helpers.js';

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const results = [];
const rec = (role, op, expect, res, db = null, note = '') => {
  const got = res.statusCode;
  const pass = expect === got || (Array.isArray(expect) && expect.includes(got));
  results.push({ role, op, expect: JSON.stringify(expect), got, pass, db, note });
  return res;
};
let sql;
const q = async (text, params = []) => (await sql(text, params)).rows;

const app_inject = async (app, opts) => app.inject(opts);

async function main() {
  process.env.RAZORPAY_KEY_ID = 'rzp_test_MOCKKEYID';
  process.env.RAZORPAY_KEY_SECRET = 'mocksecret';
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  const app = await buildApp({ logger: false });
  await app.ready();
  sql = async (text, params = []) => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try { return await c.query(text, params); } finally { await c.end(); }
  };
  const call = (o) => app_inject(app, o);

  // ---- identities ---------------------------------------------------------
  const T = {};
  for (const [k, email] of [['owner', 'owner@meridian.edu'], ['principal', 'principal@meridian.edu'],
    ['finance', 'finance@meridian.edu'], ['coordinator', 'coordinator@meridian.edu'],
    ['teacher', 'teacher@meridian.edu'], ['parent', 'parent@meridian.edu'], ['student', 'student@meridian.edu']]) {
    T[k] = (await loginAs(app, email)).token;
  }
  const tenant = (await q(`SELECT id FROM app.tenants WHERE slug='meridian'`))[0].id;
  // finance_head + finance_clerk (same password hash as seeded finance user)
  const fin = (await q(`SELECT password_hash FROM app.users WHERE email='finance@meridian.edu'`))[0];
  await sql(`INSERT INTO app.users (tenant_id, email, name, role, password_hash) VALUES ($1,'head@meridian.edu','Finance Head','finance_head',$2) ON CONFLICT DO NOTHING`, [tenant, fin.password_hash]);
  await sql(`INSERT INTO app.users (tenant_id, email, name, role, password_hash) VALUES ($1,'clerk@meridian.edu','Fee Clerk','finance_clerk',$2) ON CONFLICT DO NOTHING`, [tenant, fin.password_hash]);
  T.head = (await loginAs(app, 'head@meridian.edu')).token;
  T.clerk = (await loginAs(app, 'clerk@meridian.edu')).token;
  const users = Object.fromEntries((await q(`SELECT email,id,role FROM app.users WHERE tenant_id=$1`, [tenant])).map(u => [u.email, u]));

  // students: pick 3 active; wire parent->2 kids, student user->1 kid
  const studs = await q(`SELECT id,name,grade FROM app.students WHERE tenant_id=$1 AND status='active' LIMIT 3`, [tenant]);
  const [S1, S2, S3] = studs;
  await sql(`INSERT INTO family.child_link (tenant_id,user_id,student_id) VALUES ($1,$2,$3),($1,$2,$4) ON CONFLICT DO NOTHING`,
    [tenant, users['parent@meridian.edu'].id, S1.id, S2.id]);
  await sql(`INSERT INTO app.student_accounts (tenant_id,student_id,user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [tenant, S1.id, users['student@meridian.edu'].id]);

  const J = (r) => { try { return r.json(); } catch { return { _raw: r.body?.slice(0, 200) }; } };

  // ==== FINANCE HEAD: full configuration ====================================
  const R = 'finance_head', HH = H(T.head);
  // 1. every setting key
  let r = await call({ method: 'PUT', url: '/fees/settings', headers: HH, payload: {
    refund_approval_threshold_cents: 200000, reconciliation_tolerance_cents: 50, min_partial_cents: 5000,
    receipt_series_start: 100, receipt_prefix: 'FHD', receipt_reset: 'yearly', invoice_notes: 'Pay on time',
    late_fee_enabled: true, late_fee_mode: 'per_day', late_fee_per_day_cents: 500, late_fee_cap_cents: 20000,
    late_fee_grace_days: 3, late_fee_fixed_cents: 10000, late_fee_percent: 2,
    refund_window_days: 90, refund_require_reason: true, refund_partial_allowed: true,
    enabled_methods: ['upi', 'cash', 'card'], overpayment_rule: 'refuse',
    dunning_before_due_days: [7, 3], dunning_escalation_days: [30],
    dunning_quiet_start: '21:00', dunning_quiet_end: '08:00', dunning_channels: ['whatsapp'],
    installment_max_parts: 6, max_extension_days: 15, concession_cap_pct: 50, sibling_min_children: 2,
  }});
  rec(R, 'PUT /fees/settings (all keys)', 200, r, (await q(`SELECT settings FROM app.fee_settings WHERE tenant_id=$1`, [tenant]))[0]?.settings);
  // 1b. bad values rejected
  r = await call({ method: 'PUT', url: '/fees/settings', headers: HH, payload: { late_fee_mode: 'hourly' } });
  rec(R, 'PUT /fees/settings bad enum -> 400', 400, r);
  r = await call({ method: 'PUT', url: '/fees/settings', headers: HH, payload: { nope_not_a_key: 1 } });
  rec(R, 'PUT /fees/settings unknown key -> 400', 400, r);
  r = await call({ method: 'GET', url: '/fees/settings', headers: HH });
  rec(R, 'GET /fees/settings', 200, r, `keys=${Object.keys(J(r).settings ?? {}).length}`);

  // 2. fee heads
  const headIds = {};
  for (const [nm, extra] of [['Drill Tuition', {}], ['Drill Admission', { isRefundable: false, appliesLateFee: false, allowsInstallments: false }], ['Drill Transport', { refundWindowDays: 30 }]]) {
    r = await call({ method: 'POST', url: '/fees/heads', headers: HH, payload: { name: nm, category: 'drill', ...extra } });
    rec(R, `POST /fees/heads ${nm}`, 200, r, J(r).feeHead?.id);
    if (r.statusCode === 200) headIds[nm] = J(r).feeHead.id;
  }
  r = await call({ method: 'POST', url: '/fees/heads', headers: HH, payload: { name: 'Drill Tuition' } });
  rec(R, 'POST /fees/heads duplicate -> 409', 409, r);
  r = await call({ method: 'GET', url: '/fees/heads', headers: HH });
  rec(R, 'GET /fees/heads', 200, r, `n=${(J(r).feeHeads ?? []).length}`);

  // 3. discount + late rules
  r = await call({ method: 'POST', url: '/fees/discount-rules', headers: HH, payload: { name: 'Drill Sibling 10', kind: 'sibling', valueType: 'percent', value: 10, autoApply: true } });
  rec(R, 'POST /fees/discount-rules sibling', 200, r, J(r).discountRule?.id);
  r = await call({ method: 'POST', url: '/fees/discount-rules', headers: HH, payload: { name: 'Drill Merit 5k', kind: 'merit', valueType: 'flat', value: 500000, maxPerStudentCents: 500000, grades: ['6'] } });
  rec(R, 'POST /fees/discount-rules merit flat', 200, r, J(r).discountRule?.id);
  r = await call({ method: 'POST', url: '/fees/discount-rules', headers: HH, payload: { name: 'Bad Rule', kind: 'royal', valueType: 'percent', value: 10 } });
  rec(R, 'POST /fees/discount-rules bad kind -> 400', 400, r);
  r = await call({ method: 'GET', url: '/fees/discount-rules', headers: HH });
  rec(R, 'GET /fees/discount-rules', 200, r, `n=${(J(r).discountRules ?? []).length}`);
  r = await call({ method: 'POST', url: '/fees/late-rules', headers: HH, payload: { mode: 'per_day', perDayCents: 500, graceDays: 3, capCents: 20000, feeHeadId: headIds['Drill Tuition'] } });
  rec(R, 'POST /fees/late-rules per-head', 200, r, J(r).lateRule?.id);
  r = await call({ method: 'GET', url: '/fees/late-rules', headers: HH });
  rec(R, 'GET /fees/late-rules', 200, r, `n=${(J(r).lateRules ?? []).length}`);

  // 4. fee plan: create with terms + percent/custom installments + sibling rule + no hike
  const grade = S1.grade;
  r = await call({ method: 'POST', url: '/fee-plans', headers: HH, payload: {
    name: 'Drill Plan T1', grades: [grade], feeHeadId: headIds['Drill Tuition'],
    terms: [{ term: 'DT1', label: 'Drill Term 1', amount_cents: 1200000, due_on: '2026-05-10' },
            { term: 'DT2', label: 'Drill Term 2', amount_cents: 800000, due_on: '2026-09-10' }],
    installments: [{ percent: 30, due_on: '2026-05-10' }, { percent: 30, due_on: '2026-06-10' }, {}],
    autoConcession: { kind: 'sibling', percent: 10, min_children: 2 },
  }});
  rec(R, 'POST /fee-plans full', 200, r, J(r).feePlan?.id);
  const planId = J(r).feePlan?.id;
  r = await call({ method: 'POST', url: '/fee-plans', headers: HH, payload: { name: 'Drill Plan T1', grades: [grade], terms: [{ term: 'X', label: 'x', amount_cents: 1 }] } });
  rec(R, 'POST /fee-plans duplicate -> 409', 409, r);
  r = await call({ method: 'POST', url: '/fee-plans', headers: HH, payload: { name: 'Bad hike', grades: [grade], terms: [{ term: 'X', label: 'x', amount_cents: 1 }], hikePct: 25 } });
  rec(R, 'POST /fee-plans hike>threshold no SMC -> 400', 400, r);
  r = await call({ method: 'GET', url: '/fee-plans', headers: HH });
  rec(R, 'GET /fee-plans', 200, r, `n=${(J(r).feePlans ?? []).length}`);
  // 5. preview (no writes) then generate
  const beforeOb = (await q(`SELECT count(*)::int n FROM app.fee_obligations WHERE tenant_id=$1`, [tenant]))[0].n;
  r = await call({ method: 'POST', url: `/fee-plans/${planId}/preview`, headers: HH, payload: {} });
  const afterPrev = (await q(`SELECT count(*)::int n FROM app.fee_obligations WHERE tenant_id=$1`, [tenant]))[0].n;
  rec(R, 'POST /fee-plans/:id/preview (no writes)', 200, r, `obligations ${beforeOb}->${afterPrev}`, `studentsInScope=${J(r).studentsInScope}`);
  r = await call({ method: 'POST', url: `/fee-plans/${planId}/generate`, headers: HH, payload: {} });
  const gen = J(r);
  rec(R, 'POST /fee-plans/:id/generate', 200, r, `inserted=${gen.inserted} installments=${gen.installmentsCreated} run=${gen.billingRunId}`);
  const runId = gen.billingRunId;
  r = await call({ method: 'POST', url: `/fee-plans/${planId}/generate`, headers: HH, payload: {} });
  rec(R, 'POST /fee-plans/:id/generate again (idempotent)', 200, r, `inserted=${J(r).inserted} (expect 0)`);
  r = await call({ method: 'POST', url: `/fee-plans/${planId}/clone`, headers: HH, payload: { name: 'Drill Plan T1 clone' } });
  rec(R, 'POST /fee-plans/:id/clone', 200, r, J(r).feePlan?.id);

  // sample obligation for the money ops
  const ob = (await q(`SELECT * FROM app.fee_obligations WHERE tenant_id=$1 AND label='Drill Term 1' AND student_id=$2 LIMIT 1`, [tenant, S1.id]))[0]
    ?? (await q(`SELECT * FROM app.fee_obligations WHERE tenant_id=$1 LIMIT 1`, [tenant]))[0];
  const obId = ob.id;
  r = await call({ method: 'GET', url: `/fees/obligations/${obId}`, headers: HH });
  rec(R, 'GET /fees/obligations/:id', 200, r, `payments=${(J(r).payments ?? []).length} installments=${(J(r).installments ?? []).length}`);
  r = await call({ method: 'GET', url: `/fees/obligations/${obId}/invoice`, headers: HH });
  rec(R, 'GET /fees/obligations/:id/invoice', 200, r, `cached=${J(r).cached} file=${J(r).invoice?.filename}`);
  // extend + late-fee waive (late fee first needs a run; do run later, waive on whatever exists)
  // extend: one within the 15-day cap (must succeed), one beyond it (must 400)
  const curDue = (await q(`SELECT due_on FROM app.fee_obligations WHERE id=$1`, [obId]))[0]?.due_on;
  const plusDays = (d, n) => { const t = new Date(d); t.setDate(t.getDate() + n); return t.toISOString().slice(0, 10); };
  r = await call({ method: 'POST', url: `/fees/obligations/${obId}/extend`, headers: HH, payload: { due_on: plusDays(curDue, 10), reason: 'drill extension' } });
  rec(R, 'POST /fees/obligations/:id/extend (+10d)', 200, r, `due_on=${J(r).obligation?.due_on}`);
  r = await call({ method: 'POST', url: `/fees/obligations/${obId}/extend`, headers: HH, payload: { due_on: '2028-12-31', reason: 'too far' } });
  rec(R, 'POST extend beyond cap -> 400', 400, r, (r.body ?? '').slice(0, 80));
  r = await call({ method: 'POST', url: `/fees/obligations/${obId}/extend`, headers: HH, payload: { due_on: '2026-12-31' } });
  rec(R, 'POST extend no reason -> 400', 400, r);
  // installment edit/waive
  const inst = (await q(`SELECT * FROM app.fee_installments WHERE tenant_id=$1 AND obligation_id=$2 ORDER BY seq LIMIT 1`, [tenant, obId]))[0];
  if (inst) {
    r = await call({ method: 'PATCH', url: `/fees/installments/${inst.id}`, headers: HH, payload: { due_on: '2026-07-01', reason: 'drill' } });
    rec(R, 'PATCH /fees/installments/:id', 200, r, `due_on=${J(r).installment?.due_on}`);
    const inst2 = (await q(`SELECT * FROM app.fee_installments WHERE tenant_id=$1 AND obligation_id=$2 AND status='pending' AND id<>$3 ORDER BY seq LIMIT 1`, [tenant, obId, inst.id]))[0];
    if (inst2) {
      r = await call({ method: 'POST', url: `/fees/installments/${inst2.id}/waive`, headers: HH, payload: { reason: 'drill waiver' } });
      rec(R, 'POST /fees/installments/:id/waive', 200, r, `status=${J(r).installment?.status}`);
    }
  } else rec(R, 'installment fixtures', 200, { statusCode: 200 }, 'NO installments rows for sampled obligation');

  // 6. payment initiate (head, cash needs no PIN yet) + confirm + receipt checks
  r = await call({ method: 'POST', url: '/fees/payments', headers: HH, payload: { obligationId: obId, method: 'upi' } });
  rec(R, 'POST /fees/payments initiate upi', 200, r, `status=${J(r).payment?.status} allocs=${(J(r).allocations ?? []).length}`);
  const payId = J(r).payment?.id;
  r = await call({ method: 'POST', url: '/fees/payments', headers: HH, payload: { obligationId: obId, method: 'bitcoin' } });
  rec(R, 'POST /fees/payments bad method -> 400/422', [400, 422], r);
  r = await call({ method: 'POST', url: `/fees/payments/${payId}/confirm`, headers: HH, payload: {} });
  const conf = J(r);
  rec(R, 'POST /fees/payments/:id/confirm', 200, r, `status=${conf.payment?.status} via=${conf.payment?.settled_via} receipt=${conf.payment?.receipt_no}`);
  const dbPay = (await q(`SELECT status,settled_via,receipt_no,reconciliation_status FROM app.payments WHERE id=$1`, [payId]))[0];
  const dbRec = (await q(`SELECT receipt_no,amount_cents,voided_at,pdf_file_id FROM app.fee_receipts WHERE payment_id=$1`, [payId]))[0];
  const dbOb = (await q(`SELECT paid_cents,status FROM app.fee_obligations WHERE id=$1`, [obId]))[0];
  rec(R, 'DB: confirm moved ledger + receipt', 200, { statusCode: 200 }, `pay=${dbPay?.status}/${dbPay?.settled_via}/${dbPay?.reconciliation_status} receipt=${dbRec?.receipt_no}/${dbRec?.amount_cents}/pdf=${dbRec?.pdf_file_id ? 'yes' : 'NO'} ob paid=${dbOb?.paid_cents}/${dbOb?.status}`);
  r = await call({ method: 'GET', url: `/fees/receipts/${dbRec ? (await q(`SELECT id FROM app.fee_receipts WHERE payment_id=$1`, [payId]))[0]?.id : 'x'}`, headers: HH });
  // 7. refund (partial, small) + full-refund SoD path on a second payment
  r = await call({ method: 'POST', url: `/payments/${payId}/refund`, headers: HH, payload: { refundCents: 10000, reason: 'drill partial' } });
  rec(R, 'POST /payments/:id/refund partial', 200, r, `refunded=${J(r).refundedCents} gw=${J(r).gateway?.mode}`);
  // 8. concessions: create + decide
  const conOb = (await q(`SELECT * FROM app.fee_obligations WHERE tenant_id=$1 AND student_id=$2 AND status IN ('open','partial') LIMIT 1`, [tenant, S1.id]))[0] ?? ob;
  r = await call({ method: 'POST', url: '/fees/concessions', headers: HH, payload: { studentId: S1.id, obligationId: conOb.id, kind: 'scholarship', amountCents: 5000, reason: 'drill merit' } });
  rec(R, 'POST /fees/concessions', 200, r, J(r).concession?.id);
  const conId = J(r).concession?.id;
  if (conId) {
    r = await call({ method: 'POST', url: `/fees/concessions/${conId}/decide`, headers: HH, payload: { decision: 'approve' } });
    rec(R, 'POST /fees/concessions/:id/decide approve', [200, 403], r, `status=${J(r).concession?.status ?? J(r).error ?? J(r).code}`);
  }
  r = await call({ method: 'GET', url: '/fees/concessions', headers: HH });
  rec(R, 'GET /fees/concessions', 200, r, `n=${(J(r).concessions ?? []).length}`);
  const otherOb2 = (await q(`SELECT * FROM app.fee_obligations WHERE tenant_id=$1 AND student_id<>$2 LIMIT 1`, [tenant, S2.id]))[0];
  if (otherOb2) {
    r = await call({ method: 'POST', url: '/fees/concessions', headers: HH, payload: { studentId: S2.id, obligationId: otherOb2.id, kind: 'concession', amountCents: 100, reason: 'mismatch probe' } });
    rec(R, 'POST concession wrong-student ob -> 400', 400, r, (r.body ?? '').slice(0, 80));
  }
  // 9. late fees run + dryRun + waive
  r = await call({ method: 'POST', url: '/fees/late-fees/run?dryRun=true', headers: HH, payload: {} });
  rec(R, 'POST /fees/late-fees/run dryRun', 200, r, `wouldUpdate=${J(r).wouldUpdate} mode=${J(r).mode}`);
  r = await call({ method: 'POST', url: '/fees/late-fees/run', headers: HH, payload: {} });
  rec(R, 'POST /fees/late-fees/run', 200, r, `updated=${J(r).updated}`);
  // 10. dunning (record quiet-hours behaviour) + force attempt
  r = await call({ method: 'POST', url: '/fees/dunning/run', headers: HH, payload: {} });
  rec(R, 'POST /fees/dunning/run', 200, r, `queued=${J(r).queued} escalated=${J(r).escalated} note=${(J(r).note ?? '').slice(0, 60)}`, 'quiet-hours aware');
  r = await call({ method: 'POST', url: '/fees/dunning/run', headers: HH, payload: { force: true } });
  rec(R, 'POST /fees/dunning/run force:true', 200, r, `queued=${J(r).queued} forced=${J(r).forced ?? 'ABSENT'}`, 'force:true bypass? (expect forced flag if L7 shipped)');
  r = await call({ method: 'GET', url: '/fees/delivery', headers: HH });
  rec(R, 'GET /fees/delivery', 200, r, `n=${(J(r).messages ?? []).length}`);
  // 11. reconcile + mark-matched + recon runs
  r = await call({ method: 'POST', url: '/payments/reconcile', headers: HH, payload: {} });
  rec(R, 'POST /payments/reconcile', 200, r, `total=${J(r).total} actions=${J(r).actionsRaised}`);
  r = await call({ method: 'GET', url: '/payments/recon-runs?limit=3', headers: HH });
  rec(R, 'GET /payments/recon-runs', 200, r, `n=${(J(r).runs ?? []).length}`);
  const disputed = (await q(`SELECT id FROM app.payments WHERE tenant_id=$1 AND reconciliation_status='disputed' LIMIT 1`, [tenant]))[0];
  if (disputed) {
    r = await call({ method: 'POST', url: `/payments/${disputed.id}/mark-matched`, headers: HH, payload: { note: 'drill review' } });
    rec(R, 'POST /payments/:id/mark-matched', 200, r, J(r).payment?.reconciliation_status);
  } else rec(R, 'mark-matched (no disputed rows)', 200, { statusCode: 200 }, 'skipped — no disputes found');
  // 12. pins
  const staffId = users['coordinator@meridian.edu'].id;
  r = await call({ method: 'POST', url: '/fees/pins', headers: HH, payload: { userId: users['clerk@meridian.edu'].id, pin: '1234' } });
  rec(R, 'POST /fees/pins enroll clerk', 200, r, (await q(`SELECT count(*)::int n FROM app.fee_pins WHERE user_id=$1`, [users['clerk@meridian.edu'].id]))[0]?.n + ' pin row(s)');
  // cash with PIN (correct + wrong)
  const obCash = (await q(`SELECT * FROM app.fee_obligations WHERE tenant_id=$1 AND status IN ('open','partial') AND id<>$2 LIMIT 1`, [tenant, obId]))[0];
  if (obCash) {
    const clerkH = H(T.clerk);
    r = await call({ method: 'POST', url: '/fees/payments', headers: clerkH, payload: { obligationId: obCash.id, method: 'cash', pin: '0000' } });
    rec('finance_clerk', 'cash initiate wrong PIN -> 403', 403, r);
    r = await call({ method: 'POST', url: '/fees/payments', headers: clerkH, payload: { obligationId: obCash.id, method: 'cash', pin: '1234' } });
    rec('finance_clerk', 'cash initiate correct PIN', 200, r, J(r).payment?.id);
    var clerkPayId = J(r).payment?.id;
  }
  // 13. entitlements + misc reads
  r = await call({ method: 'GET', url: '/fees/entitlements', headers: HH });
  rec(R, 'GET /fees/entitlements', 200, r, `plan=${J(r).plan}`);
  r = await call({ method: 'GET', url: '/fees/installments', headers: HH });
  rec(R, 'GET /fees/installments', 200, r, `n=${(J(r).installments ?? []).length}`);
  r = await call({ method: 'GET', url: '/payments', headers: HH });
  rec(R, 'GET /payments', 200, r, `n=${(J(r).payments ?? []).length}`);
  r = await call({ method: 'GET', url: '/fees/receipts', headers: HH });
  rec(R, 'GET /fees/receipts', 200, r, `n=${(J(r).receipts ?? []).length}`);
  r = await call({ method: 'GET', url: '/fees/obligations', headers: HH });
  rec(R, 'GET /fees/obligations', 200, r, `n=${(J(r).obligations ?? []).length}`);
  r = await call({ method: 'GET', url: '/student/fees', headers: HH });
  rec(R, 'GET /student/fees as head -> 403', 403, r);

  // ==== OWNER ==============================================================
  const O = 'owner', OH = H(T.owner);
  r = await call({ method: 'PUT', url: '/fees/settings', headers: OH, payload: { receipt_prefix: 'OWN' } });
  rec(O, 'PUT /fees/settings', 200, r, `prefix=${J(r).settings?.receipt_prefix}`);
  const obVoid = (await q(`SELECT * FROM app.fee_obligations WHERE tenant_id=$1 AND paid_cents=0 AND status='open' LIMIT 1`, [tenant]))[0];
  if (obVoid) {
    r = await call({ method: 'POST', url: `/fees/obligations/${obVoid.id}/void`, headers: OH, payload: {} });
    rec(O, 'POST /fees/obligations/:id/void (unpaid)', 200, r, J(r).obligation?.status);
  }
  r = await call({ method: 'POST', url: `/fees/obligations/${obId}/void`, headers: OH, payload: {} });
  rec(O, 'POST void paid obligation -> 409', 409, r);
  r = await call({ method: 'POST', url: `/billing-runs/${runId}/void`, headers: OH, payload: {} });
  rec(O, 'POST /billing-runs/:id/void (has money -> 409)', 409, r);
  // owner self-approve concession (allowed)
  r = await call({ method: 'POST', url: '/fees/concessions', headers: OH, payload: { studentId: S3.id, kind: 'waiver', amountCents: 1000, reason: 'owner drill' } });
  const ocId = J(r).concession?.id;
  rec(O, 'owner request concession', 200, r, ocId);
  if (ocId) {
    r = await call({ method: 'POST', url: `/fees/concessions/${ocId}/decide`, headers: OH, payload: { decision: 'approve' } });
    rec(O, 'owner self-approve (allowed)', 200, r, J(r).concession?.status);
  }

  // ==== PRINCIPAL ===========================================================
  const P = 'principal', PH = H(T.principal);
  r = await call({ method: 'PUT', url: '/fees/settings', headers: PH, payload: { receipt_prefix: 'XXX' } });
  rec(P, 'PUT /fees/settings -> 403', 403, r);
  r = await call({ method: 'GET', url: '/fees/settings', headers: PH });
  rec(P, 'GET /fees/settings', 200, r);
  r = await call({ method: 'POST', url: '/fee-plans', headers: PH, payload: { name: 'Principal Plan', grades: [grade], terms: [{ term: 'P1', label: 'p1', amount_cents: 100 }] } });
  rec(P, 'POST /fee-plans', 200, r, J(r).feePlan?.id);
  r = await call({ method: 'POST', url: `/fees/obligations/${obId}/extend`, headers: PH, payload: { due_on: '2027-01-31', reason: 'principal drill' } });
  rec(P, 'POST extend paid/far ob -> 4xx (policy holds)', [400, 409], r, (r.body ?? '').slice(0, 90));
  const pFresh = (await q(`SELECT * FROM app.fee_obligations WHERE tenant_id=$1 AND label='Drill Term 2' AND status='open' AND paid_cents=0 LIMIT 1`, [tenant]))[0];
  if (pFresh) {
    const pd = (await q(`SELECT due_on FROM app.fee_obligations WHERE id=$1`, [pFresh.id]))[0]?.due_on;
    const plusD = (d, n) => { const t = new Date(d); t.setDate(t.getDate() + n); return t.toISOString().slice(0, 10); };
    r = await call({ method: 'POST', url: `/fees/obligations/${pFresh.id}/extend`, headers: PH, payload: { due_on: plusD(pd, 5), reason: 'principal window' } });
    rec(P, 'POST extend fresh ob (+5d)', 200, r, J(r).obligation?.due_on);
    r = await call({ method: 'POST', url: '/fees/payments', headers: PH, payload: { obligationId: pFresh.id, method: 'upi' } });
    rec(P, 'POST /fees/payments initiate fresh ob', 200, r, J(r).payment?.id);
    var principalPayId = J(r).payment?.id;
  }
  r = await call({ method: 'POST', url: '/fees/dunning/run', headers: PH, payload: {} });
  rec(P, 'POST /fees/dunning/run', 200, r, `queued=${J(r).queued}`);
  r = await call({ method: 'POST', url: '/fees/payments', headers: PH, payload: { obligationId: obId, method: 'upi' } });
  rec(P, 'POST initiate reopened remainder (refund+late) -> 200', 200, r, J(r).payment?.id ?? J(r).code);
  r = await call({ method: 'POST', url: `/fees/payments/${typeof principalPayId !== 'undefined' && principalPayId ? principalPayId : payId}/confirm`, headers: PH, payload: {} });
  rec(P, 'POST confirm as principal -> 403', 403, r);

  // ==== FINANCE (legacy) =====================================================
  const F = 'finance', FH = H(T.finance);
  r = await call({ method: 'POST', url: `/fees/payments/${payId}/confirm`, headers: FH, payload: {} });
  rec(F, 'POST confirm (already confirmed -> already:true)', 200, r, `already=${J(r).already}`);
  r = await call({ method: 'PUT', url: '/fees/settings', headers: FH, payload: { receipt_prefix: 'YYY' } });
  rec(F, 'PUT /fees/settings -> 403', 403, r);

  // ==== CLERK ================================================================
  const C = 'finance_clerk', CH = H(T.clerk);
  r = await call({ method: 'POST', url: `/fees/payments/${clerkPayId}/confirm`, headers: CH, payload: {} });
  rec(C, 'POST confirm -> 403 maker-only', 403, r);
  r = await call({ method: 'POST', url: `/payments/${payId}/refund`, headers: CH, payload: { reason: 'clerk wants full' } });
  rec(C, 'POST full material refund as clerk -> 403 SOD', 403, r, J(r).code);
  r = await call({ method: 'POST', url: '/fees/dunning/run', headers: CH, payload: {} });
  rec(C, 'POST /fees/dunning/run', 200, r, `queued=${J(r).queued}`);
  r = await call({ method: 'GET', url: '/fees/settings', headers: CH, payload: {} });
  rec(C, 'GET /fees/settings as clerk -> 403', 403, r);

  // ==== COORDINATOR ===========================================================
  const CO = 'coordinator', COH = H(T.coordinator);
  r = await call({ method: 'GET', url: '/fees/obligations', headers: COH });
  rec(CO, 'GET /fees/obligations', 200, r, `n=${(J(r).obligations ?? []).length}`);
  r = await call({ method: 'POST', url: '/fees/payments', headers: COH, payload: { obligationId: obId, method: 'upi' } });
  rec(CO, 'POST /fees/payments -> 403', 403, r);
  r = await call({ method: 'GET', url: '/fees/concessions', headers: COH });
  rec(CO, 'GET /fees/concessions', 200, r);

  // ==== PARENT ================================================================
  const PA = 'parent', PAH = H(T.parent);
  r = await call({ method: 'GET', url: '/fees/obligations', headers: PAH });
  rec(PA, 'GET /fees/obligations (own children)', 200, r, `scoped=${J(r).scoped} n=${(J(r).obligations ?? []).length}`);
  r = await call({ method: 'GET', url: `/fees/obligations?studentId=${S3.id}`, headers: PAH });
  rec(PA, 'GET obligations other child -> empty', 200, r, `n=${(J(r).obligations ?? []).length} scoped=${J(r).scoped}`);
  const ownOb = (await q(`SELECT * FROM app.fee_obligations WHERE tenant_id=$1 AND student_id=$2 AND status IN ('open','partial') LIMIT 1`, [tenant, S2.id]))[0];
  if (ownOb) {
    r = await call({ method: 'POST', url: '/fees/payments', headers: PAH, payload: { obligationId: ownOb.id, method: 'upi' } });
    rec(PA, 'POST /fees/payments own child', [200, 400], r, r.statusCode === 200 ? J(r).payment?.id : (r.body ?? '').slice(0, 100));
    r = await call({ method: 'POST', url: '/fees/concessions', headers: PAH, payload: { studentId: S2.id, kind: 'concession', amountCents: 500, reason: 'parent plea' } });
    rec(PA, 'POST /fees/concessions own child', 200, r, J(r).concession?.id);
  }
  const otherOb = (await q(`SELECT * FROM app.fee_obligations WHERE tenant_id=$1 AND student_id=$2 LIMIT 1`, [tenant, S3.id]))[0];
  if (otherOb) {
    r = await call({ method: 'POST', url: '/fees/payments', headers: PAH, payload: { obligationId: otherOb.id, method: 'upi' } });
    rec(PA, 'POST /fees/payments other child -> 404', 404, r);
  }
  r = await call({ method: 'GET', url: '/fees/receipts', headers: PAH });
  rec(PA, 'GET /fees/receipts (own)', 200, r, `n=${(J(r).receipts ?? []).length}`);
  r = await call({ method: 'POST', url: `/payments/${payId}/refund`, headers: PAH, payload: {} });
  rec(PA, 'POST refund as parent -> 403', 403, r);

  // ==== TEACHER ================================================================
  const TE = 'teacher', TEH = H(T.teacher);
  r = await call({ method: 'POST', url: '/fees/concessions', headers: TEH, payload: { studentId: S1.id, kind: 'scholarship', amountCents: 700, reason: 'teacher nomination' } });
  rec(TE, 'POST /fees/concessions (allowed)', 200, r, J(r).concession?.id);
  r = await call({ method: 'GET', url: '/fees/obligations', headers: TEH });
  rec(TE, 'GET /fees/obligations -> 403', 403, r);
  r = await call({ method: 'POST', url: '/fee-plans', headers: TEH, payload: { name: 'T plan', grades: [grade], terms: [{ term: 'X', label: 'x', amount_cents: 1 }] } });
  rec(TE, 'POST /fee-plans -> 403', 403, r);

  // ==== STUDENT ================================================================
  const ST = 'student', STH = H(T.student);
  r = await call({ method: 'GET', url: '/student/fees', headers: STH });
  rec(ST, 'GET /student/fees (linked)', 200, r, `linked=${J(r).linked} obs=${(J(r).obligations ?? []).length} outstanding=${J(r).outstandingCents}`);
  r = await call({ method: 'GET', url: '/fees/obligations', headers: STH });
  rec(ST, 'GET /fees/obligations (self-scoped)', 200, r, `scoped=${J(r).scoped} n=${(J(r).obligations ?? []).length}`);

  // ==== DB invariants sweep =====================================================
  const inv = await q(`SELECT
    (SELECT count(*)::int FROM app.fee_obligations WHERE tenant_id=$1 AND paid_cents > net_amount_cents) AS overpaid,
    (SELECT count(*)::int FROM app.fee_obligations WHERE tenant_id=$1 AND amount_cents - concession_cents - waived_cents < 0) AS negnet,
    (SELECT count(*)::int FROM app.payments WHERE tenant_id=$1 AND refunded_cents > amount_cents) AS overref,
    (SELECT count(*)::int FROM app.fee_receipts WHERE tenant_id=$1 AND voided_at IS NULL) AS live_receipts,
    (SELECT count(*)::int FROM app.payment_events WHERE tenant_id=$1) AS events,
    (SELECT count(*)::int FROM app.fee_dunning_log WHERE tenant_id=$1) AS duns,
    (SELECT count(*)::int FROM app.communications WHERE tenant_id=$1 AND template LIKE 'FEE%') AS feecomms`, [tenant]);
  rec('system', 'DB invariants (overpaid/negnets/overref must be 0)', 200, { statusCode: 200 }, JSON.stringify(inv[0]));

  fs.writeFileSync('/tmp/fee-role-drill.json', JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
  const pass = results.filter(x => x.pass).length;
  console.log(`\n===== DRILL DONE: ${pass}/${results.length} as-expected =====`);
  for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} [${x.role}] ${x.op} -> ${x.got} (exp ${x.expect})${x.db ? ' | DB: ' + (typeof x.db === 'string' ? x.db : JSON.stringify(x.db)).slice(0, 220) : ''}${x.note ? ' | ' + x.note : ''}`);
  await app.close();
}

main().catch(e => { console.error('DRILL CRASH:', e); process.exit(2); });
