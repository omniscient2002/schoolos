-- fee-consistency.sql · L5 ledger-balance pack (plan §4-L1).
-- Every query returns violating ROWS (empty = healthy) except the summary.
-- Usage: psql $DATABASE_URL -v tenant='<uuid>' -f fee-consistency.sql
--   (omit -v tenant to sweep ALL tenants; scope column identifies each).
-- Designed to run identically in CI (seeded/scale fixture) and as a daily
-- production cron monitor — any row out is a page, not a report.
\pset footer off

-- C1 · paid exceeds net (CHECK-backed; behavior must agree too)
SELECT 'C1' AS check, tenant_id AS scope, id AS ref, paid_cents, net_amount_cents
  FROM app.fee_obligations
 WHERE (:'tenant' IS NULL OR tenant_id = :'tenant'::uuid)
   AND paid_cents > net_amount_cents;

-- C2 · negative net (reductions exceed amount)
SELECT 'C2' AS check, tenant_id AS scope, id AS ref, amount_cents, concession_cents, waived_cents
  FROM app.fee_obligations
 WHERE (:'tenant' IS NULL OR tenant_id = :'tenant'::uuid)
   AND amount_cents - concession_cents - waived_cents < 0;

-- C3 · over-refunded payments
SELECT 'C3' AS check, tenant_id AS scope, id AS ref, amount_cents, refunded_cents
  FROM app.payments
 WHERE (:'tenant' IS NULL OR tenant_id = :'tenant'::uuid)
   AND refunded_cents > amount_cents;

-- C4 · confirmed payment whose allocations do not sum to its amount
-- (legacy single-obligation payments carry no allocation rows — excluded)
SELECT 'C4' AS check, p.tenant_id AS scope, p.id AS ref, p.amount_cents,
       COALESCE(SUM(pa.amount_cents), 0) AS allocated_cents
  FROM app.payments p LEFT JOIN app.payment_allocations pa
    ON pa.payment_id = p.id AND pa.tenant_id = p.tenant_id
 WHERE (:'tenant' IS NULL OR p.tenant_id = :'tenant'::uuid)
   AND p.status = 'confirmed'
   AND EXISTS (SELECT 1 FROM app.payment_allocations x WHERE x.payment_id = p.id)
 GROUP BY p.tenant_id, p.id, p.amount_cents
HAVING COALESCE(SUM(pa.amount_cents), 0) <> p.amount_cents;

-- C5 · confirmed payment without exactly one live receipt (voided iff fully refunded)
SELECT 'C5' AS check, p.tenant_id AS scope, p.id AS ref, p.status,
       COUNT(r.id) FILTER (WHERE r.voided_at IS NULL) AS live_receipts
  FROM app.payments p LEFT JOIN app.fee_receipts r
    ON r.payment_id = p.id AND r.tenant_id = p.tenant_id
 WHERE (:'tenant' IS NULL OR p.tenant_id = :'tenant'::uuid)
   AND p.status = 'confirmed'
 GROUP BY p.tenant_id, p.id, p.status
HAVING COUNT(r.id) FILTER (WHERE r.voided_at IS NULL) <> 1;

-- C6 · net disagrees with the generated expression (guards against backfills)
SELECT 'C6' AS check, tenant_id AS scope, id AS ref, net_amount_cents,
       (amount_cents - concession_cents - waived_cents + late_fee_cents) AS recomputed
  FROM app.fee_obligations
 WHERE (:'tenant' IS NULL OR tenant_id = :'tenant'::uuid)
   AND net_amount_cents <> (amount_cents - concession_cents - waived_cents + late_fee_cents);

-- C7 · open-allocation exclusivity broken (more than one open per obligation)
SELECT 'C7' AS check, tenant_id AS scope, obligation_id AS ref, COUNT(*) AS open_allocs
  FROM app.payment_allocations
 WHERE (:'tenant' IS NULL OR tenant_id = :'tenant'::uuid)
   AND open
 GROUP BY tenant_id, obligation_id
HAVING COUNT(*) > 1;

-- C8 · confirmed payment with NO trail (payment_events missing confirmed/initated)
SELECT 'C8' AS check, p.tenant_id AS scope, p.id AS ref
  FROM app.payments p
 WHERE (:'tenant' IS NULL OR p.tenant_id = :'tenant'::uuid)
   AND p.status IN ('confirmed', 'refunded')
   AND NOT EXISTS (SELECT 1 FROM app.payment_events e
                    WHERE e.payment_id = p.id AND e.kind IN ('initiated', 'confirmed'));

-- C9 · duplicate receipt numbers within a tenant
SELECT 'C9' AS check, tenant_id AS scope, receipt_no AS ref, COUNT(*) AS n
  FROM app.fee_receipts
 WHERE (:'tenant' IS NULL OR tenant_id = :'tenant'::uuid)
 GROUP BY tenant_id, receipt_no
HAVING COUNT(*) > 1;

-- C10 · installment schedule does not cover its obligation (F-13 mirror:
-- all-explicit under-coverage must not exist post-fix; open part required)
SELECT 'C10' AS check, o.tenant_id AS scope, o.id AS ref, o.amount_cents,
       COALESCE(SUM(i.amount_cents), 0) AS parts_cents, COUNT(i.id) AS parts
  FROM app.fee_obligations o JOIN app.fee_installments i
    ON i.obligation_id = o.id AND i.tenant_id = o.tenant_id
 WHERE (:'tenant' IS NULL OR o.tenant_id = :'tenant'::uuid)
 GROUP BY o.tenant_id, o.id, o.amount_cents
HAVING COALESCE(SUM(i.amount_cents), 0) <> o.amount_cents;
