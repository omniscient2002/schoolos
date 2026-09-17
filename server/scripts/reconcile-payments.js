// Reconciliation worker stub (Wave 3 · L1-3.1): cron-able settlement sweep.
// Runs the SAME three discrepancy classes as POST /payments/reconcile across
// ALL tenants on the owner path, emits app.events rows, prints a report, and
// exits 1 when anything needs a human. No gateway calls — reads local facts
// only (kernel ledger vs plugin_razorpay.order_log). Schedule: daily.
//   node scripts/reconcile-payments.js
//
// OPS-20 / TST-1: the sweep is exported and the process side effects live behind a
// CLI guard, so a test can drive it against a fixture and assert the event spine
// actually received a correctly-shaped `warn` event. Before this, importing the
// module ran the whole all-tenant sweep and `process.exit()`-ed the test runner.
import { pathToFileURL } from 'node:url';
import { sysq, tx } from '../src/db.js';
import { emitEvent } from '../src/audit.js';

// Reconciliation is an all-tenant maintenance job; `sysq` is the explicit
// privileged path, rather than an unreviewable owner Client created here.
const q = sysq;

const emit = async (tenantId, label, ref) => tx(async (c) => {
  await emitEvent(c, tenantId, { type: 'fees', label, severity: 'warn', ref }, `fees.reconciliation`, null,
    { emittedBy: 'worker:reconcile-payments', subject: `payment:${ref}` });
});

/** Sweep every tenant for ledger↔rail discrepancies. Returns `{ tenants, total }`. */
export async function runReconciliation() {
  const report = { tenants: [], total: 0 };
  const tenants = (await q(`SELECT id, slug FROM app.tenants ORDER BY slug`)).rows;
  for (const t of tenants) {
    const ghost = (await q(
      `SELECT p.id, p.amount_cents, ol.status AS rail_status, ol.razorpay_order_id
       FROM app.payments p JOIN plugin_razorpay.order_log ol ON ol.payment_id = p.id
       WHERE p.tenant_id=$1 AND p.method='razorpay' AND p.status='confirmed' AND ol.status <> 'captured'`, [t.id])).rows;
    const missing = (await q(
      `SELECT p.id, p.status AS ledger_status, ol.razorpay_order_id
       FROM app.payments p JOIN plugin_razorpay.order_log ol ON ol.payment_id = p.id
       WHERE p.tenant_id=$1 AND p.method='razorpay' AND ol.status='captured' AND p.status NOT IN ('confirmed','refunded')`, [t.id])).rows;
    const orphan = (await q(
      `SELECT p.id FROM app.payments p
       WHERE p.tenant_id=$1 AND p.method='razorpay' AND p.status='confirmed'
         AND NOT EXISTS (SELECT 1 FROM plugin_razorpay.order_log ol WHERE ol.payment_id = p.id)`, [t.id])).rows;
    const n = ghost.length + missing.length + orphan.length;
    if (n === 0) continue;
    for (const g of ghost) await emit(t.id, `reconciliation.discrepancy — confirmed locally, rail says ${g.rail_status} (order ${g.razorpay_order_id})`, g.id);
    for (const m of missing) await emit(t.id, `reconciliation.discrepancy — rail captured, ledger still ${m.ledger_status} (order ${m.razorpay_order_id})`, m.id);
    for (const w of orphan) await emit(t.id, `reconciliation.discrepancy — confirmed with no rail order log entry`, w.id);
    report.tenants.push({ slug: t.slug, ghostLocalConfirmed: ghost.length, missingLocalConfirmation: missing.length, orphanNoRailLog: orphan.length });
    report.total += n;
  }
  return report;
}

// CLI guard: `node scripts/reconcile-payments.js` runs the sweep; importing gets the function and no
// side effects. Exit contract preserved for cron wrappers: 1 when a discrepancy needs a human, else 0.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runReconciliation();
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.total > 0 ? 1 : 0);
}
