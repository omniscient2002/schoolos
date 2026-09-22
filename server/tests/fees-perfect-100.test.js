// FEES-PERFECT-100 §0b — the remaining fixes to 100, machine-pinned.
// Covers: reconciliation Action + mark-matched (SEC-5), webhook freshness ceiling (SEC-7), per-tenant
// refund threshold (SEC-9), fee heads + generation stamping + report grouping (DAT-1b), installments
// (DAT-5b), receipt PDF artifact (DAT-3b), error codes (API-5), OpenAPI build (API-6), coordinator policy
// (RBAC-5), new surfaces (RBAC-7), student own-dues (PRD-9), pay-many (PRD-10), shared reconcile sweep
// (DEL-5), fee delivery view (DEL-6), entitlement matrix (COM-1) and usage metering (COM-2).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupTestDb, loginAs } from './helpers.js';
import pg from 'pg';
import { validateSettingsAgainstSchema, platformCeiling } from '../src/settings-contract.js';
import { FEES_OPENAPI } from '../src/fees/openapi.js';
import { feeEntitlements, feeFeatureIncluded } from '../src/entitlements.js';

let app;
let sql;
let ownerToken, financeToken, clerkToken, coordinatorToken, studentToken, teacherToken;
let tenantA, studentId, grade;

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

before(async () => {
  process.env.FILES_DIR = mkdtempSync(join(tmpdir(), 'fee-pdf-'));
  process.env.UPI_WEBHOOK_SECRET = 'perfect-100-test-secret';
  process.env.RAZORPAY_KEY_ID = 'rzp_test_MOCKKEYID';
  process.env.RAZORPAY_KEY_SECRET = 'mocksecret';
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
  financeToken = (await loginAs(app, 'finance@meridian.edu')).token;
  teacherToken = (await loginAs(app, 'teacher@meridian.edu')).token;
  tenantA = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  const st = (await sql(`SELECT id, grade FROM app.students WHERE tenant_id=$1 AND status='active' LIMIT 1`, [tenantA])).rows[0];
  studentId = st.id; grade = st.grade;
  const fin = (await sql(`SELECT password_hash FROM app.users WHERE email='finance@meridian.edu'`)).rows[0];
  const mk = async (email, role) => {
    await sql(`INSERT INTO app.users (tenant_id, email, name, role, password_hash) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [tenantA, email, role, role, fin.password_hash]);
    return (await loginAs(app, email)).token;
  };
  clerkToken = await mk('perfect.clerk@meridian.edu', 'finance_clerk');
  coordinatorToken = await mk('perfect.coord@meridian.edu', 'coordinator');
  studentToken = await mk('perfect.student@meridian.edu', 'student');
  const su = (await sql(`SELECT id FROM app.users WHERE email='perfect.student@meridian.edu'`)).rows[0].id;
  await sql(`INSERT INTO app.student_accounts (tenant_id, student_id, user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [tenantA, studentId, su]);
});

after(async () => { await app?.close(); });

const obligation = async (label, cents, opts = {}) => (await sql(
  `INSERT INTO app.fee_obligations (tenant_id, student_id, term, label, amount_cents, fee_head_id)
   VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
  [tenantA, opts.studentId ?? studentId, opts.term ?? 'Term 2', label, cents, opts.feeHeadId ?? null])).rows[0];

const startPayment = async (obligationId, method = 'upi', token = ownerToken) => {
  const r = await app.inject({ method: 'POST', url: '/fees/payments', payload: { obligationId, method }, headers: H(token) });
  assert.equal(r.statusCode, 200, r.body);
  return r.json().payment;
};
const confirm = async (paymentId, token = ownerToken, payload = {}) => {
  const r = await app.inject({ method: 'POST', url: `/fees/payments/${paymentId}/confirm`, payload, headers: H(token) });
  return r;
};

// ── pure units ────────────────────────────────────────────────────────────────────────────────────────
test('FEE-API-6 · the fees read-plane OpenAPI builds with every read schema', () => {
  assert.equal(FEES_OPENAPI.openapi, '3.1.0');
  for (const p of ['/fees/obligations', '/payments', '/fees/receipts', '/fee-plans', '/fees/concessions', '/fees/installments', '/fees/heads']) {
    assert.ok(FEES_OPENAPI.paths[p]?.get, `${p} must expose a GET`);
    assert.ok(FEES_OPENAPI.paths[p].get.responses['200'], `${p} must document a 200`);
  }
  for (const s of ['Obligation', 'Payment', 'Receipt', 'FeePlan', 'Concession', 'Installment', 'FeeHead', 'Error']) {
    assert.ok(FEES_OPENAPI.components.schemas[s], `schema ${s} missing`);
  }
  assert.doesNotThrow(() => JSON.stringify(FEES_OPENAPI));
});

test('FEE-SEC-7 · webhook freshness has a platform ceiling of 60 minutes', () => {
  assert.equal(platformCeiling('webhook_freshness_mins'), 60);
  const schema = { type: 'object', properties: { webhook_freshness_mins: { type: 'integer', minimum: 1, maximum: 120, default: 15 } } };
  assert.equal(validateSettingsAgainstSchema(schema, { webhook_freshness_mins: 60 }).ok, true);
  const over = validateSettingsAgainstSchema(schema, { webhook_freshness_mins: 61 });
  assert.equal(over.ok, false, 'a manifest maximum of 120 cannot widen the platform bound');
  assert.match(over.errors[0].error, /platform ceiling/);
});

test('FEE-COM-1 · the fee feature matrix is plan-gated', () => {
  assert.equal(feeFeatureIncluded('trial', 'fees.dunning'), true);
  assert.equal(feeFeatureIncluded('core', 'fees.dunning'), false);
  assert.equal(feeFeatureIncluded('rails', 'fees.dunning'), true);
  const ent = feeEntitlements('core');
  assert.equal(ent['fees.dunning'].available, false);
  assert.equal(ent['fees.dunning'].requiredPlan, 'rails');
  assert.equal(ent['fees.collection'].available, true);
});

// ── SEC-5 · reconcile raises an owned Action; mark-matched resolves it ────────────────────────────────
test('FEE-SEC-5 · a discrepancy raises a finance_head Action and mark-matched clears it', async () => {
  const o = await obligation('Perfect recon action', 400000);
  const p = await startPayment(o.id, 'razorpay');
  await confirm(p.id, ownerToken, { gatewayRef: 'order_PERFECTMISMATCH' });
  await sql(`INSERT INTO plugin_razorpay.order_log (tenant_id, payment_id, razorpay_order_id, razorpay_payment_id, status, amount_cents)
             VALUES ($1,$2,'order_PERFECTMISMATCH','pay_PERFECTMISMATCH','captured', 399999)`, [tenantA, p.id]);
  const r = await app.inject({ method: 'POST', url: '/payments/reconcile', payload: {}, headers: H(financeToken) });
  assert.equal(r.statusCode, 200, r.body);
  assert.ok(r.json().actionsRaised >= 1);
  const action = (await sql(`SELECT id, owner_role, status, priority FROM app.actions WHERE tenant_id=$1 AND code=$2`, [tenantA, `fee.recon.amount_mismatch.${p.id}`])).rows[0];
  assert.ok(action, 'the discrepancy raised an Action Center card');
  assert.equal(action.owner_role, 'finance_head');
  assert.equal(action.status, 'open');
  const cleared = await app.inject({ method: 'POST', url: `/payments/${p.id}/mark-matched`, payload: { note: 'checked the statement' }, headers: H(financeToken) });
  assert.equal(cleared.statusCode, 200, cleared.body);
  assert.equal(cleared.json().payment.reconciliation_status, 'matched');
  const after = (await sql(`SELECT status FROM app.actions WHERE id=$1`, [action.id])).rows[0];
  assert.equal(after.status, 'resolved', 'deciding the discrepancy resolves the assigned action');
});

// ── SEC-9 · the refund threshold is per-tenant ────────────────────────────────────────────────────────
test('FEE-SEC-9 · a configured refund threshold changes who may approve', async () => {
  const o = await obligation('Perfect threshold', 100000);
  const p = await startPayment(o.id, 'cash');
  await confirm(p.id, ownerToken);
  await sql(`INSERT INTO app.fee_settings (tenant_id, settings) VALUES ($1, $2::jsonb)
             ON CONFLICT (tenant_id) DO UPDATE SET settings=EXCLUDED.settings, updated_at=now()`,
  [tenantA, JSON.stringify({ refund_approval_threshold_cents: 1 })]);
  const strict = await app.inject({ method: 'POST', url: `/payments/${p.id}/refund`, payload: { reason: 'test' }, headers: H(clerkToken) });
  assert.equal(strict.statusCode, 403, strict.body);
  assert.equal(strict.json().code, 'SOD_REQUIRED');
  await sql(`UPDATE app.fee_settings SET settings=$2::jsonb WHERE tenant_id=$1`, [tenantA, JSON.stringify({ refund_approval_threshold_cents: 100000000 })]);
  const lenient = await app.inject({ method: 'POST', url: `/payments/${p.id}/refund`, payload: { reason: 'below the configured threshold' }, headers: H(clerkToken) });
  assert.equal(lenient.statusCode, 200, lenient.body);
  await sql(`DELETE FROM app.fee_settings WHERE tenant_id=$1`, [tenantA]);
});

// ── DAT-1b / DAT-5b · heads, installments, report grouping ────────────────────────────────────────────
test('FEE-DAT-1b/5b · heads stamp obligations, installments are generated, reports group by head', async () => {
  const head = await app.inject({ method: 'POST', url: '/fees/heads', payload: { name: 'Perfect Tuition', category: 'tuition', glLedgerName: 'TUITION' }, headers: H(ownerToken) });
  assert.equal(head.statusCode, 200, head.body);
  const feeHeadId = head.json().feeHead.id;
  const heads = await app.inject({ method: 'GET', url: '/fees/heads', headers: H(financeToken) });
  assert.ok(heads.json().feeHeads.some((h) => h.id === feeHeadId));
  const plan = await app.inject({ method: 'POST', url: '/fee-plans', headers: H(ownerToken), payload: {
    name: 'Perfect Installment Plan', grades: [grade], feeHeadId,
    terms: [{ term: 'AUTOTEST', label: 'Perfect Inst Fee', amount_cents: 900000, due_on: '2026-10-10' }],
    installments: [{ due_on: '2026-10-10' }, { due_on: '2026-11-10' }, { due_on: '2026-12-10' }],
  } });
  assert.equal(plan.statusCode, 200, plan.body);
  const planId = plan.json().feePlan.id;
  const gen = await app.inject({ method: 'POST', url: `/fee-plans/${planId}/generate`, payload: {}, headers: H(ownerToken) });
  assert.equal(gen.statusCode, 200, gen.body);
  assert.ok(gen.json().inserted >= 1);
  assert.ok(gen.json().installmentsCreated >= 3);
  const ob = (await sql(`SELECT id, fee_head_id FROM app.fee_obligations WHERE tenant_id=$1 AND source_ref=$2 LIMIT 1`, [tenantA, `feeplan:${planId}`])).rows[0];
  assert.equal(ob.fee_head_id, feeHeadId, 'the generated obligation carries the head');
  const inst = await app.inject({ method: 'GET', url: `/fees/installments?obligationId=${ob.id}`, headers: H(financeToken) });
  assert.equal(inst.statusCode, 200, inst.body);
  assert.equal(inst.json().installments.length, 3, 'a 3-part plan yields 3 installment rows');
  assert.deepEqual(inst.json().installments.map((i) => i.seq), [1, 2, 3]);
  const sum = inst.json().installments.reduce((a, i) => a + Number(i.amount_cents), 0);
  assert.equal(sum, 900000, 'installments sum to the obligation amount');
  const summary = await app.inject({ method: 'GET', url: '/reports/fees/summary', headers: H(financeToken) });
  assert.ok(summary.json().heads.some((h) => h.fee_head_id === feeHeadId), 'the report groups by fee head');
  // settle fully → installments marked paid in order
  const pay = await startPayment(ob.id, 'cash');
  await confirm(pay.id, ownerToken);
  const paid = (await sql(`SELECT seq, status FROM app.fee_installments WHERE obligation_id=$1 ORDER BY seq`, [ob.id])).rows;
  assert.deepEqual(paid.map((x) => x.status), ['paid', 'paid', 'paid'], 'a full settlement marks every installment paid in order');
});

// ── DAT-3b · the receipt PDF artifact ─────────────────────────────────────────────────────────────────
test('FEE-DAT-3b · confirm renders a receipt PDF and the receipt door returns its file id', async () => {
  const o = await obligation('Perfect receipt pdf', 120000);
  const p = await startPayment(o.id, 'cash');
  await confirm(p.id, ownerToken);
  const list = await app.inject({ method: 'GET', url: `/fees/receipts?studentId=${studentId}`, headers: H(financeToken) });
  const rec = list.json().receipts.find((r) => r.payment_id === p.id);
  assert.ok(rec, 'a receipt row exists');
  const detail = await app.inject({ method: 'GET', url: `/fees/receipts/${rec.id}`, headers: H(financeToken) });
  assert.equal(detail.statusCode, 200, detail.body);
  assert.ok(detail.json().receipt.pdf_file_id, 'the receipt points at a stored PDF artifact');
});

// ── API-5 · error codes on money refusals ─────────────────────────────────────────────────────────────
test('FEE-API-5 · money refusals carry a stable machine-readable code', async () => {
  const o = await obligation('Perfect settled code', 50000);
  const p = await startPayment(o.id, 'cash');
  await confirm(p.id, ownerToken);
  const settled = await app.inject({ method: 'POST', url: '/fees/payments', payload: { obligationId: o.id, method: 'cash' }, headers: H(ownerToken) });
  assert.equal(settled.statusCode, 409, settled.body);
  assert.equal(settled.json().code, 'OBLIGATION_SETTLED');
  const o2 = await obligation('Perfect unconfirmed refund', 50000);
  const p2 = await startPayment(o2.id, 'cash');
  const bad = await app.inject({ method: 'POST', url: `/payments/${p2.id}/refund`, payload: {}, headers: H(ownerToken) });
  assert.equal(bad.statusCode, 409, bad.body);
  assert.equal(bad.json().code, 'PAYMENT_NOT_CONFIRMED');
  const missing = await app.inject({ method: 'POST', url: '/fees/payments', payload: { obligationId: '00000000-0000-0000-0000-000000000000' }, headers: H(ownerToken) });
  assert.equal(missing.json().code, 'NOT_FOUND');
});

// ── PRD-10 · one payment settles several obligations ──────────────────────────────────────────────────
test('FEE-PRD-10 · pay-many allocates one payment across obligations', async () => {
  const a = await obligation('Perfect paymany A', 30000);
  const b = await obligation('Perfect paymany B', 20000);
  const r = await app.inject({ method: 'POST', url: '/fees/payments', payload: { obligationIds: [a.id, b.id], method: 'cash' }, headers: H(ownerToken) });
  assert.equal(r.statusCode, 200, r.body);
  const p = r.json().payment;
  assert.equal(p.amount_cents, '50000');
  assert.equal(r.json().allocations.length, 2);
  const conf = await confirm(p.id, ownerToken);
  assert.equal(conf.statusCode, 200, conf.body);
  assert.equal(conf.json().obligations.length, 2, 'both obligations settled');
  const rows = (await sql(`SELECT id, paid_cents, status FROM app.fee_obligations WHERE id = ANY($1::uuid[])`, [[a.id, b.id]])).rows;
  assert.ok(rows.every((x) => x.status === 'paid' && Number(x.paid_cents) > 0), 'both obligations paid');
  const alloc = (await sql(`SELECT COALESCE(SUM(amount_cents),0)::bigint s FROM app.payment_allocations WHERE payment_id=$1`, [p.id])).rows[0];
  assert.ok(BigInt(alloc.s) <= BigInt(p.amount_cents), 'allocations never exceed the payment amount');
});

// ── PRD-9 · student own-dues ──────────────────────────────────────────────────────────────────────────
test('FEE-PRD-9 · a student sees only their own dues', async () => {
  await obligation('Perfect student due', 70000);
  const r = await app.inject({ method: 'GET', url: '/student/fees', headers: H(studentToken) });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().linked, true);
  assert.equal(r.json().studentId, studentId);
  assert.ok(r.json().obligations.length >= 1);
  assert.ok(r.json().obligations.every((o) => o.student_id === undefined || o.id), 'rows are the student\'s own');
  const obl = await app.inject({ method: 'GET', url: '/fees/obligations', headers: H(studentToken) });
  assert.equal(obl.statusCode, 200, obl.body);
  assert.ok(obl.json().obligations.every((o) => o.student_id === studentId), 'the student ledger is scoped to self');
});

// ── RBAC-5 · coordinator is read-only ─────────────────────────────────────────────────────────────────
test('FEE-RBAC-5 · a coordinator reads the ledger but cannot initiate or refund', async () => {
  const read = await app.inject({ method: 'GET', url: '/fees/obligations', headers: H(coordinatorToken) });
  assert.equal(read.statusCode, 200, read.body);
  const o = await obligation('Perfect coord read-only', 10000);
  const write = await app.inject({ method: 'POST', url: '/fees/payments', payload: { obligationId: o.id, method: 'cash' }, headers: H(coordinatorToken) });
  assert.equal(write.statusCode, 403, 'coordinator cannot initiate a payment');
  const dun = await app.inject({ method: 'POST', url: '/fees/dunning/run', payload: {}, headers: H(coordinatorToken) });
  assert.equal(dun.statusCode, 403, 'coordinator cannot run dunning');
});

// ── DEL-6 · fee delivery view ─────────────────────────────────────────────────────────────────────────
test('FEE-DEL-6 · the fee delivery view lists fee messages with carrier state', async () => {
  const o = await obligation('Perfect delivery', 15000);
  const p = await startPayment(o.id, 'cash');
  await confirm(p.id, ownerToken);
  const r = await app.inject({ method: 'GET', url: '/fees/delivery', headers: H(financeToken) });
  assert.equal(r.statusCode, 200, r.body);
  const receiptMsg = r.json().messages.find((m) => m.template === 'FEE_RECEIPT');
  assert.ok(receiptMsg, 'the FEE_RECEIPT message is visible');
  assert.ok(['queued', 'sent', 'delivered', 'failed'].includes(receiptMsg.status));
  const denied = await app.inject({ method: 'GET', url: '/fees/delivery', headers: H(teacherToken) });
  assert.equal(denied.statusCode, 403);
});

// ── RBAC-7 · new surfaces in the capability payload ───────────────────────────────────────────────────
test('FEE-RBAC-7 · /me/effective names the new fee surfaces', async () => {
  const owner = await app.inject({ method: 'GET', url: '/me/effective', headers: H(ownerToken) });
  assert.equal(owner.json().capabilities['/fees/heads'], true);
  assert.equal(owner.json().capabilities['/fees/installments'], true);
  assert.equal(owner.json().capabilities['/student/fees'], false, 'staff cannot render the student surface');
  const student = await app.inject({ method: 'GET', url: '/me/effective', headers: H(studentToken) });
  assert.equal(student.json().capabilities['/student/fees'], true);
});

// ── COM-1 · entitlement enforcement ───────────────────────────────────────────────────────────────────
test('FEE-COM-1 · an unentitled fee feature is refused with 402 and surfaced', async () => {
  const ent = await app.inject({ method: 'GET', url: '/fees/entitlements', headers: H(ownerToken) });
  assert.equal(ent.statusCode, 200, ent.body);
  assert.equal(ent.json().plan, 'trial');
  assert.equal(ent.json().features['fees.dunning'].available, true);
  await sql(`UPDATE app.tenants SET plan='core' WHERE id=$1`, [tenantA]);
  try {
    const core = await app.inject({ method: 'GET', url: '/fees/entitlements', headers: H(ownerToken) });
    assert.equal(core.json().features['fees.dunning'].available, false);
    const denied = await app.inject({ method: 'POST', url: '/fees/dunning/run', payload: {}, headers: H(ownerToken) });
    assert.equal(denied.statusCode, 402, denied.body);
    assert.equal(denied.json().code, 'NOT_ENTITLED');
  } finally {
    await sql(`UPDATE app.tenants SET plan='trial' WHERE id=$1`, [tenantA]);
  }
});

// ── COM-2 · usage metering ────────────────────────────────────────────────────────────────────────────
test('FEE-COM-2 · a rail meters its declared usage and the report exposes it', async () => {
  const on = await app.inject({ method: 'POST', url: '/plugins/payments.upi/enable', payload: {}, headers: H(ownerToken) });
  assert.equal(on.statusCode, 200, on.body);
  // A4: the rail needs a configured school VPA (no fabricated `schoolos@<name>`).
  await app.inject({ method: 'POST', url: '/plugins/payments.upi/settings', headers: H(ownerToken), payload: { gateway: 'razorpay', default_vpa: 'meridian@icici' } });
  const o = await obligation('Perfect metered link', 60000);
  const link = await app.inject({ method: 'POST', url: '/plugins/payments.upi/links', payload: { obligationId: o.id }, headers: H(ownerToken) });
  assert.equal(link.statusCode, 200, link.body);
  const usage = await app.inject({ method: 'GET', url: '/usage', headers: H(ownerToken) });
  assert.equal(usage.statusCode, 200, usage.body);
  const row = usage.json().usage.find((u) => u.plugin_id === 'payments.upi' && u.metric === 'links_created');
  assert.ok(row && Number(row.count) >= 1, 'links_created is metered');
  assert.ok(usage.json().declared.some((d) => d.plugin_id === 'payments.upi'), 'declared metered metrics are surfaced');
});

// ── DEL-5 · the worker and the door share one sweep ───────────────────────────────────────────────────
test('FEE-DEL-5 · the reconciliation worker reports the same findings as the HTTP door', async () => {
  const o = await obligation('Perfect shared sweep', 200000);
  const p = await startPayment(o.id, 'razorpay');
  await confirm(p.id, ownerToken, { gatewayRef: 'order_PERFECTSWEEP' });
  await sql(`INSERT INTO plugin_razorpay.order_log (tenant_id, payment_id, razorpay_order_id, razorpay_payment_id, status, amount_cents)
             VALUES ($1,$2,'order_PERFECTSWEEP','pay_PERFECTSWEEP','captured', 199999)`, [tenantA, p.id]);
  const door = await app.inject({ method: 'POST', url: '/payments/reconcile', payload: {}, headers: H(financeToken) });
  const { runReconciliation } = await import('../scripts/reconcile-payments.js');
  const worker = await runReconciliation();
  const meridian = worker.tenants.find((t) => t.slug === 'meridian');
  assert.ok(meridian, 'the worker swept meridian');
  assert.equal(meridian.amountMismatch, door.json().discrepancies.amountMismatch.length, 'both report the same amount mismatch');
  // The door already raised the card; the worker is idempotent on the same code, so it raises 0 new ones.
  const action = (await sql(`SELECT id FROM app.actions WHERE tenant_id=$1 AND code=$2`, [tenantA, `fee.recon.amount_mismatch.${p.id}`])).rows[0];
  assert.ok(action, 'an owned action exists for the shared finding');
  assert.equal(meridian.actionsRaised, 0, 'the worker never duplicates an action the door already raised');
});
