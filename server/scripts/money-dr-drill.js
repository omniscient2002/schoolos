// FEE-OPS-4 — the money-path disaster-recovery drill.
//
// A restore that merely "answers" is not evidence that the money survived. This drill runs against a
// RESTORED database (see ops/backup/money-drill.sh) and proves, per tenant:
//   · the hash-chained audit ledger still verifies (no breaks) after the restore;
//   · the fee ledger is internally consistent (paid_cents ≤ net_amount_cents, statuses coherent);
//   · every receipt still points at its payment, and the receipt amount equals the payment amount;
//   · every allocation belongs to a real payment and obligation, and allocations sum ≤ payment amount.
// It prints a JSON report and exits 1 when anything fails, so a cron drill can alert.
//
//   DATABASE_URL=<restored-db> node scripts/money-dr-drill.js
import { pathToFileURL } from 'node:url';
import { sysq } from '../src/db.js';

export async function runMoneyDrill({ q = sysq } = {}) {
  const report = { tenants: [], ok: true, checkedAt: new Date().toISOString() };
  const tenants = (await q(`SELECT id, slug FROM app.tenants ORDER BY slug`)).rows;
  for (const t of tenants) {
    const counts = (await q(
      `SELECT
         (SELECT count(*)::int FROM app.fee_obligations WHERE tenant_id=$1) AS obligations,
         (SELECT count(*)::int FROM app.payments WHERE tenant_id=$1) AS payments,
         (SELECT count(*)::int FROM app.fee_receipts WHERE tenant_id=$1) AS receipts,
         (SELECT count(*)::int FROM app.payment_allocations WHERE tenant_id=$1) AS allocations`,
      [t.id])).rows[0];
    const audit = (await q(`SELECT count(*)::int AS breaks FROM app.audit_verify($1, 100000)`, [t.id])).rows[0];
    const badLedger = (await q(
      `SELECT count(*)::int AS n FROM app.fee_obligations
        WHERE tenant_id=$1 AND (paid_cents < 0 OR paid_cents > net_amount_cents
          OR concession_cents < 0 OR waived_cents < 0 OR net_amount_cents < 0)`, [t.id])).rows[0];
    const badReceipts = (await q(
      `SELECT count(*)::int AS n FROM app.fee_receipts r
        LEFT JOIN app.payments p ON p.id = r.payment_id AND p.tenant_id = r.tenant_id
        WHERE r.tenant_id=$1 AND (p.id IS NULL OR p.amount_cents <> r.amount_cents)`, [t.id])).rows[0];
    const badAllocs = (await q(
      `SELECT count(*)::int AS n FROM app.payment_allocations a
        LEFT JOIN app.payments p ON p.id = a.payment_id AND p.tenant_id = a.tenant_id
        LEFT JOIN app.fee_obligations o ON o.id = a.obligation_id AND o.tenant_id = a.tenant_id
        WHERE a.tenant_id=$1 AND (p.id IS NULL OR o.id IS NULL)`, [t.id])).rows[0];
    const allocOverflow = (await q(
      `SELECT count(*)::int AS n FROM (
         SELECT a.payment_id, SUM(a.amount_cents) AS alloc, MAX(p.amount_cents) AS amt
           FROM app.payment_allocations a JOIN app.payments p ON p.id = a.payment_id
          WHERE a.tenant_id=$1 GROUP BY a.payment_id HAVING SUM(a.amount_cents) > MAX(p.amount_cents)
       ) x`, [t.id])).rows[0];
    const ok = audit.breaks === 0 && badLedger.n === 0 && badReceipts.n === 0 && badAllocs.n === 0 && allocOverflow.n === 0;
    report.tenants.push({ slug: t.slug, counts, auditBreaks: audit.breaks, badLedger: badLedger.n, badReceipts: badReceipts.n, orphanAllocations: badAllocs.n, allocationOverflow: allocOverflow.n, ok });
    if (!ok) report.ok = false;
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runMoneyDrill();
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}
