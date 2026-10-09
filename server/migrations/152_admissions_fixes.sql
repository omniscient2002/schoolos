-- 152 · admissions fixes (A15/A3/A9).
--
-- A15: side exits carry a reason — stage_history.reason stores it.
-- A3: RTE claim lifecycle — one row-chain per (tenant, claim_ref):
--     UNIQUE (tenant_id, claim_ref) WHERE claim_ref IS NOT NULL.
-- A9: age eligibility needs a birth date on the lead — lead.dob (optional).
-- Idempotent.

ALTER TABLE plugin_admissions.stage_history ADD COLUMN IF NOT EXISTS reason text;

DO $$ BEGIN
  -- A3 race backstop: an identical row twice is a double-submit, not a chain step.
  -- (One UNIQUE per ref would forbid chains entirely — claimed→partial→received
  -- legitimately share a ref, so uniqueness covers the full row shape instead.)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rte_claim_row_uidx') THEN
    ALTER TABLE app.rte_reimbursements ADD CONSTRAINT rte_claim_row_uidx
      UNIQUE (tenant_id, claim_ref, academic_year, status, amount_cents);
  END IF;
END $$;

ALTER TABLE plugin_admissions.lead ADD COLUMN IF NOT EXISTS dob date;
