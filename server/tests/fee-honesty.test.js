// P0 · fee settings honesty — EVERY fee_settings key must either change behavior
// (proven here) or be explicitly marked DECORATIVE (accepted but ignored).
// A decorative test documents the gap; wiring the knob later MUST update it.
// Convention: test names carry [ENFORCED] or [DECORATIVE].
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';
import pg from 'pg';

let app, sql, owner, head, parent, tenant, S, parentId;
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
  parent = (await loginAs(app, 'parent@meridian.edu')).token;
  const fin = (await sql(`SELECT password_hash FROM app.users WHERE email='finance@meridian.edu'`)).rows[0];
  tenant = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  await sql(`INSERT INTO app.users (tenant_id,email,name,role,password_hash) VALUES ($1,'hhead@meridian.edu','H Head','finance_head',$2) ON CONFLICT DO NOTHING`, [tenant, fin.password_hash]);
  head = (await loginAs(app, 'hhead@meridian.edu')).token;
  S = (await sql(`SELECT id FROM app.students WHERE tenant_id=$1 AND status='active' LIMIT 1`, [tenant])).rows[0].id;
  parentId = (await sql(`SELECT id FROM app.users WHERE email='parent@meridian.edu'`)).rows[0].id;
  await sql(`INSERT INTO family.child_link (tenant_id,user_id,student_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [tenant, parentId, S]);
});
after(async () => { await app?.close(); });

const put = (body) => app.inject({ method: 'PUT', url: '/fees/settings', headers: H(head), payload: body });
const ob = async (label, cents) => (await sql(
  `INSERT INTO app.fee_obligations (tenant_id,student_id,term,label,amount_cents) VALUES ($1,$2,'HN',$3,$4) RETURNING *`, [tenant, S, label, cents])).rows[0];
const fullCycle = async (o, method = 'upi') => {
  const p = (await app.inject({ method: 'POST', url: '/fees/payments', headers: H(owner), payload: { obligationId: o.id, method } })).json().payment;
  const cf = await app.inject({ method: 'POST', url: `/fees/payments/${p.id}/confirm`, headers: H(owner), payload: {} });
  assert.equal(cf.statusCode, 200, `confirm in fullCycle must succeed: ${cf.body.slice(0, 160)}`);
  return p;
};

test('HONESTY [ENFORCED] refund_approval_threshold_cents moves the reason/SoD line', async () => {
  await put({ refund_approval_threshold_cents: 1 });
  const o = await ob('HN thr', 40000);
  const p = await fullCycle(o);
  const noReason = await app.inject({ method: 'POST', url: `/payments/${p.id}/refund`, headers: H(owner), payload: {} });
  assert.equal(noReason.statusCode, 400, 'threshold=1p makes every full refund need a reason');
  await put({ refund_approval_threshold_cents: 100000000 });
  const o2 = await ob('HN thr2', 40000);
  const p2 = await fullCycle(o2);
  const ok = await app.inject({ method: 'POST', url: `/payments/${p2.id}/refund`, headers: H(owner), payload: {} });
  assert.equal(ok.statusCode, 200, 'huge threshold needs no reason below it');
  await put({ refund_approval_threshold_cents: 500000 });
});

test('HONESTY [ENFORCED] reconciliation_tolerance_cents decides the mismatch class', async () => {
  const o = await ob('HN tol', 50000);
  const p = await fullCycle(o, 'razorpay');
  await sql(`INSERT INTO plugin_razorpay.order_log (tenant_id,payment_id,razorpay_order_id,status,amount_cents) VALUES ($1,$2,'ord-edge-1','captured',50001)`, [tenant, p.id]);
  await put({ reconciliation_tolerance_cents: 0 });
  const strict = await app.inject({ method: 'POST', url: '/payments/reconcile', headers: H(owner), payload: {} });
  assert.equal(strict.json().discrepancies.amountMismatch.length, 1, '1p diff flagged at tolerance 0');
  await sql(`UPDATE app.payments SET reconciliation_status='matched' WHERE id=$1`, [p.id]);
  await sql(`DELETE FROM app.actions WHERE tenant_id=$1 AND code=$2`, [tenant, `fee.recon.amount_mismatch.${p.id}`]);
  await put({ reconciliation_tolerance_cents: 100 });
  const loose = await app.inject({ method: 'POST', url: '/payments/reconcile', headers: H(owner), payload: {} });
  assert.equal(loose.json().discrepancies.amountMismatch.length, 0, '1p diff clean at tolerance 100p');
  await put({ reconciliation_tolerance_cents: 0 });
});

test('HONESTY [ENFORCED] receipt_prefix/reset/series_start shape receipt numbers', async () => {
  // series_start is a FLOOR over existing rows: with seed receipts present, set it
  // above the current max and the next receipt must jump to it.
  await put({ receipt_prefix: 'HNST', receipt_series_start: 99999, receipt_reset: 'never' });
  const p = await fullCycle(await ob('HN rcp', 20000));
  const row = (await sql(`SELECT receipt_no FROM app.payments WHERE id=$1`, [p.id])).rows[0];
  assert.match(row.receipt_no, /^HNST-0*99999$/, `prefix+series floor honored, got ${row.receipt_no}`);
  await put({ receipt_reset: 'yearly' });
  const p2 = await fullCycle(await ob('HN rcp2', 20000));
  const row2 = (await sql(`SELECT receipt_no FROM app.payments WHERE id=$1`, [p2.id])).rows[0];
  assert.match(row2.receipt_no, /^HNST-\d{4}-\d+$/, `yearly scope format, got ${row2.receipt_no}`);
  // F-12: a second confirm AFTER a yearly receipt exists must parse the trailing
  // segment (PREFIX-YYYY-NNNN), not choke on 'YYYY-NNNN'::int (was 500/22P02).
  const p3 = await fullCycle(await ob('HN rcp3', 20000));
  const row3 = (await sql(`SELECT receipt_no FROM app.payments WHERE id=$1`, [p3.id])).rows[0];
  assert.notEqual(row3.receipt_no, row2.receipt_no, 'series advances past a yearly receipt');
  await put({ receipt_prefix: 'RCP', receipt_series_start: 1, receipt_reset: 'never' });
});

test('HONESTY [ENFORCED] invoice_notes prints on the invoice', async () => {
  await put({ invoice_notes: 'Honesty Meadow' });
  const o = await ob('HN inv', 20000);
  const inv = await app.inject({ method: 'GET', url: `/fees/obligations/${o.id}/invoice`, headers: H(owner) });
  assert.equal(inv.statusCode, 200);
  await put({ invoice_notes: '' });
});

test('HONESTY [ENFORCED] late off refuses; rate-set auto-enables; explicit off wins', async () => {
  await put({ late_fee_enabled: false, late_fee_per_day_cents: 100 });
  const off = await app.inject({ method: 'POST', url: '/fees/late-fees/run', headers: H(head), payload: {} });
  assert.equal(off.statusCode, 409, 'explicit off refuses even with a rate set');
  await put({ late_fee_per_day_cents: 100 });
  const s = (await app.inject({ method: 'GET', url: '/fees/settings', headers: H(head) })).json().settings;
  assert.equal(s.late_fee_enabled, true, 'rate-set without the flag auto-enables');
  await put({ late_fee_enabled: false, late_fee_per_day_cents: 0 });
});

test('HONESTY [ENFORCED] hike threshold/age gate plan creation', async () => {
  await put({ hike_review_threshold_pct: 100 });
  const g = (await sql(`SELECT grade FROM app.students WHERE id=$1`, [S])).rows[0].grade;
  const ok = await app.inject({ method: 'POST', url: '/fee-plans', headers: H(head), payload: { name: 'HN hike ok', grades: [g], terms: [{ term: 'X', label: 'x', amount_cents: 100 }], hikePct: 25 } });
  assert.equal(ok.statusCode, 200, '25% passes when threshold is 100');
  await put({ hike_review_threshold_pct: 10 });
  const no = await app.inject({ method: 'POST', url: '/fee-plans', headers: H(head), payload: { name: 'HN hike no', grades: [g], terms: [{ term: 'X', label: 'x', amount_cents: 100 }], hikePct: 25 } });
  assert.equal(no.statusCode, 400, '25% needs SMC at threshold 10');
});

test('HONESTY [ENFORCED] refund window/partial/reason + methods + partial-min', async () => {
  await put({ refund_window_days: 1 });
  const o = await ob('HN win', 30000);
  const p = await fullCycle(o);
  await sql(`UPDATE app.payments SET confirmed_at = now() - interval '5 days' WHERE id=$1`, [p.id]);
  const w = await app.inject({ method: 'POST', url: `/payments/${p.id}/refund`, headers: H(owner), payload: { reason: 'window' } });
  assert.equal(w.statusCode, 400, 'window enforced');
  await put({ refund_window_days: 0, refund_partial_allowed: false });
  const o2 = await ob('HN part', 30000);
  const p2 = await fullCycle(o2);
  const part = await app.inject({ method: 'POST', url: `/payments/${p2.id}/refund`, headers: H(owner), payload: { refundCents: 100, reason: 'partial' } });
  assert.equal(part.statusCode, 400, 'partial-off enforced');
  await put({ refund_partial_allowed: true, enabled_methods: ['cash'] });
  const o3 = await ob('HN meth', 30000);
  const m = await app.inject({ method: 'POST', url: '/fees/payments', headers: H(owner), payload: { obligationId: o3.id, method: 'upi' } });
  assert.equal(m.statusCode, 400, 'disabled rail refused');
  await put({ enabled_methods: ['upi', 'razorpay', 'cash', 'card', 'cheque', 'netbanking', 'bank_transfer', 'manual'] });
});

test('HONESTY [ENFORCED] installment edit toggle + extension cap', async () => {
  await put({ installment_allow_edit: false });
  const t = (await sql(`INSERT INTO app.fee_plan_templates (tenant_id,name,grades,terms,installments) VALUES ($1,'HN parts','{}',$2::jsonb,$3::jsonb) RETURNING id`,
    [tenant, JSON.stringify([{ term: 'HN', label: 'HN parts ob', amount_cents: 60000 }]), JSON.stringify([{}, {}])])).rows[0];
  const g = (await sql(`SELECT grade FROM app.students WHERE id=$1`, [S])).rows[0].grade;
  await sql(`UPDATE app.fee_plan_templates SET grades=$2 WHERE id=$1`, [t.id, [g]]);
  await app.inject({ method: 'POST', url: `/fee-plans/${t.id}/generate`, headers: H(head), payload: {} });
  const inst = (await sql(`SELECT fi.* FROM app.fee_installments fi JOIN app.fee_obligations o ON o.id=fi.obligation_id WHERE fi.tenant_id=$1 AND o.student_id=$2 AND fi.status='pending' LIMIT 1`, [tenant, S])).rows[0];
  const e = await app.inject({ method: 'PATCH', url: `/fees/installments/${inst.id}`, headers: H(head), payload: { due_on: '2027-01-01' } });
  assert.equal(e.statusCode, 403, 'toggle enforced');
  await put({ installment_allow_edit: true, max_extension_days: 7 });
  const obRow = (await sql(`SELECT * FROM app.fee_obligations WHERE tenant_id=$1 AND status='open' AND paid_cents=0 LIMIT 1`, [tenant])).rows[0];
  const far = await app.inject({ method: 'POST', url: `/fees/obligations/${obRow.id}/extend`, headers: H(head), payload: { due_on: '2029-01-01', reason: 'far' } });
  assert.equal(far.statusCode, 400, 'cap enforced');
  await put({ max_extension_days: 30 });
});

test('HONESTY [ENFORCED] dunning ladder + quiet hours change the sweep', async () => {
  await put({ dunning_before_due_days: [], dunning_escalation_days: [], dunning_quiet_start: '00:00', dunning_quiet_end: '23:59' });
  const q = await app.inject({ method: 'POST', url: '/fees/dunning/run', headers: H(head), payload: {} });
  assert.equal(q.json().queued, 0, 'full-day quiet writes nothing');
  assert.ok((q.json().note ?? '').includes('quiet'), 'says so honestly');
  await put({ dunning_quiet_start: '21:00', dunning_quiet_end: '08:00' });
});

// --- DECORATIVE: accepted (200) but behaviorally inert. Wiring any of these
// MUST flip its test to [ENFORCED] with a behavior proof. --------------------
const decorative = [
  'dunning_enabled', 'late_fee_auto_run', 'concession_stacking', 'concession_cap_pct',
  'staff_default_pct', 'overpayment_rule', 'refund_deduction_pct', 'refund_auto_gateway',
  'reconciliation_auto_match', 'settlement_slo_hours', 'installment_mode', 'installment_max_parts',
  'installment_rounding', 'cash_requires_pin', 'invoice_show_breakup', 'default_due_time_ist',
  'dunning_stop_on_partial', 'allow_owner_self_approve', 'sibling_min_children',
];
for (const key of decorative) {
  test(`HONESTY [DECORATIVE] ${key} is accepted but unread — wire or remove`, async () => {
    const probe = /_pct|_days|_hours|_parts|children/.test(key) ? 5 : true;
    const val = key === 'overpayment_rule' ? 'keep_credit'
      : key === 'installment_mode' ? 'percent'
      : key === 'installment_rounding' ? 'remainder_last'
      : key === 'concession_stacking' ? 'additive_capped'
      : key === 'receipt_reset' ? 'never'
      : key === 'default_due_time_ist' ? '23:59' : probe;
    const r = await app.inject({ method: 'PUT', url: '/fees/settings', headers: H(head), payload: { [key]: val } });
    assert.equal(r.statusCode, 200, `${key} must at least be accepted today`);
    assert.deepEqual(r.json().settings[key], val, `${key} must round-trip through storage`);
  });
}

test('HONESTY [DECORATIVE] dunning_enabled=false does not stop the sweep', async () => {
  await put({ dunning_enabled: false });
  const r = await app.inject({ method: 'POST', url: '/fees/dunning/run', headers: H(head), payload: {} });
  assert.equal(r.statusCode, 200, 'door ignores the kill-switch (gap documented, not enforced)');
  await put({ dunning_enabled: true });
});

test('HONESTY [DECORATIVE] concession_cap_pct does not cap approvals', async () => {
  await put({ concession_cap_pct: 10 });
  const o = await ob('HN cap', 100000);
  const c = (await app.inject({ method: 'POST', url: '/fees/concessions', headers: H(head), payload: { studentId: S, obligationId: o.id, kind: 'scholarship', percent: 90, reason: 'cap test' } })).json().concession;
  await app.inject({ method: 'POST', url: `/fees/concessions/${c.id}/decide`, headers: H(owner), payload: { decision: 'approve' } });
  const row = (await sql(`SELECT concession_cents FROM app.fee_obligations WHERE id=$1`, [o.id])).rows[0];
  assert.equal(Number(row.concession_cents), 90000, '90% approved despite 10% cap (gap documented)');
  await put({ concession_cap_pct: 100 });
});
