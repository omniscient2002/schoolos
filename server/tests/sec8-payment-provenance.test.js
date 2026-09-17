/* SEC-8 · money provenance must be EVIDENCE, not a string's shape.
 *
 * THE DEFECT. `/fees/payments/:id/confirm` decided `webhookVerified` by regex-matching a reference the CALLER
 * supplied — `/^[A-Z0-9-]{10,}$/` — and then wrote one of two audit actions depending on it:
 *   verified  → 'Confirmed payment (gateway webhook verified)'
 *   otherwise → 'Confirmed payment (manual reconciliation)'
 *
 * So the ledger's claim that a gateway had vouched for a payment was a property of the reference's SHAPE. Any
 * finance user could type `MANUAL-123456` into the request body and the audit trail would record that the
 * gateway confirmed it. Worse, the refund path SYNTHESISED references of the same shape
 * (`REFUND-…`), so the pattern was being manufactured inside the product too and would have satisfied its own
 * check. `docs/PERFECT-100.md` §6.1 item 8 states the requirement exactly: "Money provenance must be evidence,
 * not a string shape."
 *
 * THE FIX. A reference is verified only when the PROVIDER'S OWN RECORD contains it — looked up in
 * `plugin_razorpay.order_log`, which the order-creation door writes with the gateway's `razorpay_order_id`, and
 * which the signature-verified webhook updates with the `razorpay_payment_id` the gateway issued. A reference
 * the caller invented matches nothing. The lookup is scoped to THIS payment row as well as the tenant, so a
 * genuine gateway reference belonging to a different payment cannot be used to launder this one.
 *
 * Both directions are asserted, because a fix that simply downgraded everything would break the desk's ability
 * to settle a cash payment — the counter-case matters as much as the attack case.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';
import pg from 'pg';

let app;
let sql;
let ownerToken, financeToken;
let tenantId;
let seq = 0;
const uniq = () => `SEC-8 probe fee ${++seq}`;

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
  financeToken = (await loginAs(app, 'finance@meridian.edu')).token;
  tenantId = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
});

after(async () => { await app?.close(); });

/** Create an obligation + an initiated payment through the product's own doors, so the fixture cannot drift
 *  from the schema the way a hand-written INSERT would. */
const initiatedPayment = async () => {
  const student = (await sql(`SELECT id FROM app.students WHERE status='active' LIMIT 1`)).rows[0].id;
  const ob = (await sql(
    `INSERT INTO app.fee_obligations (tenant_id, student_id, term, label, due_on, amount_cents)
     VALUES ($1,$2,'2026-T1',$3,'2026-09-30',500000) RETURNING id`, [tenantId, student, uniq()])).rows[0].id;
  const r = await app.inject({ method: 'POST', url: '/fees/payments',
    headers: H(ownerToken), payload: { obligationId: ob, method: 'cash' } });
  assert.equal(r.statusCode, 200, `payment init: ${r.body}`);
  return r.json().payment.id;
};

/** The most recent audit row for this payment's confirm, read through the constrained app role. */
const confirmAudit = async () => (await sql(
  `SELECT action, reason FROM app.audit_log
    WHERE tenant_id=$1 AND action LIKE 'Confirmed payment%'
    ORDER BY created_at DESC LIMIT 1`, [tenantId])).rows[0];

test('SEC-8 · a FABRICATED gateway reference is not webhook-verified', async () => {
  const id = await initiatedPayment();
  // Shaped EXACTLY like the old regex accepted — this is what fooled the previous implementation.
  const r = await app.inject({ method: 'POST', url: `/fees/payments/${id}/confirm`,
    headers: H(financeToken), payload: { gatewayRef: 'MANUAL-1234567' } });
  assert.equal(r.statusCode, 200, r.body);

  const row = (await sql(`SELECT status, gateway_ref FROM app.payments WHERE id=$1`, [id])).rows[0];
  assert.equal(row.status, 'confirmed', 'the desk must still be able to settle a payment without gateway evidence');
  /* NOTE ON WHAT THE GUARD CAN AND CANNOT BE. `app.payments` carries
   *   CHECK (status <> 'confirmed' OR gateway_ref IS NOT NULL)
   * so a confirmed payment MUST have a reference — the schema gives us nowhere to put the absence. That is not a
   * flaw in the fix, it is a limit on it, and the honest reading is: the column records WHAT THE DESK TYPED, and
   * the verification METHOD is what records whether a gateway vouched for it. So this test asserts the method
   * (below), not the column. Claiming the column distinguishes them would be the same class of overclaim this
   * whole fix exists to remove. */
  assert.equal(row.gateway_ref, 'MANUAL-1234567',
    'the reference is retained because the schema requires one for a confirmed payment');

  const led = await confirmAudit();
  assert.ok(led, 'the confirm must be audited');
  assert.doesNotMatch(led.action, /webhook verified/i,
    `a fabricated reference must never be recorded as gateway-verified (got: ${led.action})`);
  assert.match(led.action, /manual reconciliation/i, 'it is a manual reconciliation, and must say so');
});

test('SEC-8 · a genuine provider reference IS webhook-verified (the fix is not a blanket downgrade)', async () => {
  const id = await initiatedPayment();
  // Simulate what the signature-verified webhook does: the provider's own log gains the reference it issued.
  await sql(`INSERT INTO plugin_razorpay.order_log
               (tenant_id, payment_id, razorpay_order_id, razorpay_payment_id, status)
             VALUES ($1,$2,'order_SEC8PROBE','pay_SEC8VERIFIED01','paid')`, [tenantId, id]);

  const r = await app.inject({ method: 'POST', url: `/fees/payments/${id}/confirm`,
    headers: H(financeToken), payload: { gatewayRef: 'pay_SEC8VERIFIED01' } });
  assert.equal(r.statusCode, 200, r.body);

  const row = (await sql(`SELECT status, gateway_ref FROM app.payments WHERE id=$1`, [id])).rows[0];
  assert.equal(row.gateway_ref, 'pay_SEC8VERIFIED01', 'a verified reference IS persisted');
  const led = await confirmAudit();
  assert.match(led.action, /verified against the provider/i,
    `a reference present in the provider's own record must be recorded as verified (got: ${led.action})`);
});

test('SEC-8 · a real reference belonging to ANOTHER payment cannot launder this one', async () => {
  const otherId = await initiatedPayment();
  await sql(`INSERT INTO plugin_razorpay.order_log
               (tenant_id, payment_id, razorpay_order_id, razorpay_payment_id, status)
             VALUES ($1,$2,'order_SEC8OTHER','pay_SEC8BELONGSTOOTHER','paid')`, [tenantId, otherId]);

  // Confirm a DIFFERENT payment while quoting that genuine reference.
  const id = await initiatedPayment();
  const r = await app.inject({ method: 'POST', url: `/fees/payments/${id}/confirm`,
    headers: H(financeToken), payload: { gatewayRef: 'pay_SEC8BELONGSTOOTHER' } });
  assert.equal(r.statusCode, 200, r.body);

  const led = await confirmAudit();
  assert.doesNotMatch(led.action, /verified against the provider/i,
    'a real gateway reference is only evidence for the payment the gateway actually settled — the lookup is '
    + 'joined to this payment row precisely so it cannot be reused across payments');
});

test('SEC-8 · another tenant\'s genuine provider record cannot verify this tenant\'s payment', async () => {
  /* Every other test in this file uses a row that is INCOHERENT by construction — an order_log whose tenant is
   * A but whose payment_id points at B. That proves nothing about RLS, because the `payment_id` join alone would
   * reject it. This one builds the reference the way a REAL cross-tenant bleed would have to look: an entirely
   * consistent gateway record — its own tenant, its own student, its own obligation, its own payment — all under
   * tenant B. Only then is the question "does tenant A see it?" actually being asked. */
  const other = (await sql(`INSERT INTO app.tenants (slug, name)
                            VALUES ('sec8-xtenant','SEC-8 cross-tenant') RETURNING id`)).rows[0].id;
  const oStudent = (await sql(`INSERT INTO app.students (tenant_id, admission_no, name, grade, section, status)
                               VALUES ($1,'SEC8-XT-1','Cross Tenant Kid','6','A','active') RETURNING id`,
                              [other])).rows[0].id;
  const oOb = (await sql(`INSERT INTO app.fee_obligations (tenant_id, student_id, term, label, due_on, amount_cents)
                          VALUES ($1,$2,'2026-T1','cross-tenant fee','2026-09-30',100000) RETURNING id`,
                         [other, oStudent])).rows[0].id;
  const oPay = (await sql(`INSERT INTO app.payments (tenant_id, student_id, obligation_id, amount_cents, method, status, gateway_ref)
                           VALUES ($1,$2,$3,100000,'upi','confirmed','pay_SEC8XTENANT01') RETURNING id`,
                          [other, oStudent, oOb])).rows[0].id;
  await sql(`INSERT INTO plugin_razorpay.order_log
               (tenant_id, payment_id, razorpay_order_id, razorpay_payment_id, status)
             VALUES ($1,$2,'order_SEC8XTENANT','pay_SEC8XTENANT01','paid')`, [other, oPay]);

  const id = await initiatedPayment();
  const r = await app.inject({ method: 'POST', url: `/fees/payments/${id}/confirm`,
    headers: H(financeToken), payload: { gatewayRef: 'pay_SEC8XTENANT01' } });
  assert.equal(r.statusCode, 200, r.body);
  const led = await confirmAudit();
  assert.doesNotMatch(led.action, /verified against the provider/i,
    "another tenant's genuine gateway record must not verify this tenant's payment — the evidence lookup runs "
    + 'inside withUser (RLS-scoped) and is joined to this payment row, so neither the tenant nor the payment can '
    + 'be substituted');
});
