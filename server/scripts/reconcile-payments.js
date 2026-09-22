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
import { findDiscrepancies, raiseDiscrepancyActions, CLASSES } from '../src/fees/reconcile.js';

// Reconciliation is an all-tenant maintenance job; `sysq` is the explicit
// privileged path, rather than an unreviewable owner Client created here.
const q = sysq;

const emit = async (tenantId, label, ref) => tx(async (c) => {
  await emitEvent(c, tenantId, { type: 'fees', label, severity: 'warn', ref }, `fees.reconciliation`, null,
    { emittedBy: 'worker:reconcile-payments', subject: `payment:${ref}` });
});

/** Sweep every tenant for ledger↔rail discrepancies. Returns `{ tenants, total }`.
 *
 * FEE-DEL-5: the four classes and their SQL come from `src/fees/reconcile.js` — the SAME definition the
 * HTTP door uses, so worker and door always report identical findings. FEE-SEC-5: every finding also raises
 * an owned Action Center card (finance_head) and marks the payment disputed, so a worker sweep is never a
 * silent log line. `toleranceCents` mirrors the tenant's reconciliation setting; the worker applies 0 unless
 * the caller passes a resolver.
 */
export async function runReconciliation({ toleranceFor } = {}) {
  const report = { tenants: [], total: 0, actionsRaised: 0 };
  const tenants = (await q(`SELECT id, slug FROM app.tenants ORDER BY slug`)).rows;
  for (const t of tenants) {
    const toleranceCents = typeof toleranceFor === 'function' ? await toleranceFor(t.id) : 0;
    const found = await findDiscrepancies(q, t.id, { toleranceCents });
    if (found.total === 0) continue;
    for (const klass of CLASSES) {
      for (const p of (found[klass === 'amount_mismatch' ? 'mismatch' : klass] ?? [])) {
        await q(`UPDATE app.payments SET reconciliation_status='disputed' WHERE id=$1 AND tenant_id=$2`, [p.id, t.id]);
        const label = klass === 'amount_mismatch'
          ? `reconciliation.discrepancy — amount mismatch: ledger ₹${Number(p.ledger_cents) / 100} vs rail ₹${Number(p.rail_cents) / 100} (order ${p.razorpay_order_id})`
          : klass === 'ghost'
            ? `reconciliation.discrepancy — confirmed locally, rail says ${p.rail_status} (order ${p.razorpay_order_id})`
            : klass === 'missing'
              ? `reconciliation.discrepancy — rail captured, ledger still ${p.ledger_status} (order ${p.razorpay_order_id})`
              : `reconciliation.discrepancy — confirmed with no rail order log entry`;
        await emit(t.id, label, p.id);
      }
    }
    const raised = await raiseDiscrepancyActions(q, t.id, found);
    report.actionsRaised += raised;
    report.tenants.push({
      slug: t.slug, ghostLocalConfirmed: found.ghost.length, missingLocalConfirmation: found.missing.length,
      orphanNoRailLog: found.orphan.length, amountMismatch: found.mismatch.length, actionsRaised: raised });
    report.total += found.total;
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
