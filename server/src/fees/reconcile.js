/* Settlement reconciliation — ONE definition of the four discrepancy classes, shared by the kernel HTTP
 * door (`POST /payments/reconcile`) and the all-tenant worker (`scripts/reconcile-payments.js`) so the two
 * can never diverge (FEE-DEL-5). The caller supplies the query function; the SQL, the classes, the Action
 * Center codes and the labels live here only.
 *
 * Classes:
 *   ghost          — ledger says confirmed, the rail says the order was not captured.
 *   missing        — the rail captured, the ledger is still unconfirmed.
 *   orphan         — ledger confirmed with no rail order-log entry at all (manual or unexplained).
 *   amount_mismatch— both sides captured, but the amounts differ beyond the tenant tolerance.
 *
 * A discrepancy is a FACT, never a money movement: the sweep marks the payment `disputed`, writes a
 * `payment_events` row, and raises ONE owned Action Center card (FEE-SEC-5) so a human is assigned it.
 * It never writes `paid_cents`.
 */

export const GHOST_SQL = `
  SELECT p.id, p.amount_cents, p.receipt_no, ol.status AS rail_status, ol.razorpay_order_id
  FROM app.payments p JOIN plugin_razorpay.order_log ol ON ol.payment_id = p.id
  WHERE p.tenant_id=$1 AND p.method='razorpay' AND p.status='confirmed' AND ol.status <> 'captured'
  ORDER BY p.confirmed_at DESC LIMIT $2`;

export const MISSING_SQL = `
  SELECT p.id, p.status AS ledger_status, p.amount_cents, ol.razorpay_order_id, ol.razorpay_payment_id
  FROM app.payments p JOIN plugin_razorpay.order_log ol ON ol.payment_id = p.id
  WHERE p.tenant_id=$1 AND p.method='razorpay' AND ol.status = 'captured' AND p.status NOT IN ('confirmed','refunded')
  ORDER BY ol.created_at DESC LIMIT $2`;

export const ORPHAN_SQL = `
  SELECT p.id, p.amount_cents, p.receipt_no, p.gateway_ref
  FROM app.payments p
  WHERE p.tenant_id=$1 AND p.method='razorpay' AND p.status='confirmed'
    AND NOT EXISTS (SELECT 1 FROM plugin_razorpay.order_log ol WHERE ol.payment_id = p.id)
  ORDER BY p.confirmed_at DESC LIMIT $2`;

export const MISMATCH_SQL = `
  SELECT p.id, p.amount_cents AS ledger_cents, ol.amount_cents AS rail_cents, ol.razorpay_order_id
  FROM app.payments p JOIN plugin_razorpay.order_log ol ON ol.payment_id = p.id
  WHERE p.tenant_id=$1 AND p.method='razorpay' AND p.status='confirmed'
    AND ol.amount_cents IS NOT NULL AND abs(ol.amount_cents - p.amount_cents) > $3
  ORDER BY p.confirmed_at DESC LIMIT $2`;

export const CLASSES = ['ghost', 'missing', 'orphan', 'amount_mismatch'];

/** Human label per class, used in the Action title. */
export const CLASS_LABEL = Object.freeze({
  ghost: 'confirmed locally, rail did not capture',
  missing: 'rail captured, ledger unconfirmed',
  orphan: 'confirmed with no rail record',
  amount_mismatch: 'ledger and rail amounts differ',
});

/** The four discrepancy classes for one tenant. Pure: caller supplies the query function. */
export async function findDiscrepancies(query, tenantId, { limit = 50, toleranceCents = 0 } = {}) {
  const ghost = (await query(GHOST_SQL, [tenantId, limit])).rows;
  const missing = (await query(MISSING_SQL, [tenantId, limit])).rows;
  const orphan = (await query(ORPHAN_SQL, [tenantId, limit])).rows;
  const mismatch = (await query(MISMATCH_SQL, [tenantId, limit, toleranceCents])).rows;
  return { ghost, missing, orphan, mismatch, total: ghost.length + missing.length + orphan.length + mismatch.length };
}

/** The finding rows for one class, normalized to `{ id, ... }`. */
export function findingsFor(report, klass) {
  return report[klass === 'amount_mismatch' ? 'mismatch' : klass] ?? [];
}

/** The stable Action code for a discrepancy. UNIQUE(tenant_id, code) makes re-runs idempotent. */
export const discrepancyCode = (klass, paymentId) => `fee.recon.${klass}.${paymentId}`;

/**
 * The Action Center card a discrepancy raises (FEE-SEC-5). Owned by the finance head so the mismatch is
 * ASSIGNED, not merely logged; `owner_role='finance_head'` is the role the desk filters on.
 */
export function discrepancyAction(tenantId, klass, payment) {
  const amount = payment.ledger_cents ?? payment.amount_cents;
  const detail = klass === 'amount_mismatch'
    ? `Ledger ₹${Number(amount) / 100} vs rail ₹${Number(payment.rail_cents) / 100} (order ${payment.razorpay_order_id ?? '—'}).`
    : `${CLASS_LABEL[klass]}${payment.razorpay_order_id ? ` (order ${payment.razorpay_order_id})` : ''}.`;
  return {
    code: discrepancyCode(klass, payment.id),
    title: `Fee reconciliation — ${CLASS_LABEL[klass]}`,
    detail,
    why: 'Money and the gateway disagree; a human must match or correct the settlement before the next collection run.',
    priority: 'high',
    owner: 'Finance',
    owner_role: 'finance_head',
    // OVR-4: the reconciliation sweep is a SYSTEM raiser (no human proposer), so it is explicitly
    // marked system-raised; the finance-head checker is a legitimate second authority, not a self-approval.
    payload: JSON.stringify({ class: klass, paymentId: payment.id, ledgerCents: String(amount ?? ''), railCents: payment.rail_cents != null ? String(payment.rail_cents) : null, orderId: payment.razorpay_order_id ?? null, raised_by_system: true }),
  };
}

/**
 * Raise one Action per discrepancy, idempotently. `query` is the caller's query function (the HTTP door's
 * transaction client or the worker's privileged query). Returns the number of NEW cards.
 */
export async function raiseDiscrepancyActions(query, tenantId, report) {
  let raised = 0;
  for (const klass of CLASSES) {
    for (const p of findingsFor(report, klass)) {
      const a = discrepancyAction(tenantId, klass, p);
      const r = await query(
        `INSERT INTO app.actions (tenant_id, code, kind, title, detail, why, priority, status, owner, owner_role, policy_ref, ai_involved, payload)
         VALUES ($1,$2,'exception',$3,$4,$5,$6,'open',$7,$8,'Fees §4.2',false,$9::jsonb)
         ON CONFLICT (tenant_id, code) DO NOTHING`,
        [tenantId, a.code, a.title, a.detail, a.why, a.priority, a.owner, a.owner_role, a.payload]);
      if (r.rowCount > 0) raised += 1;
    }
  }
  return raised;
}

/** The `payment_events.kind` a class maps to. All discrepancies are `disputed`; resolution is separate. */
export const discrepancyKind = () => 'disputed';
