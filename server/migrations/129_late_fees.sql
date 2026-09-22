-- 129 · late fees (D2).
--
-- The design (§ late fees) had only a placeholder (`{enabled:false, per_day_cents:0, cap_cents:0}`) with
-- no computation. This adds a per-obligation `late_fee_cents` and folds it into the generated
-- `net_amount_cents`, so the payable amount reflects a late fee without mutating `amount_cents`.
-- Idempotent.

BEGIN;

ALTER TABLE app.fee_obligations ADD COLUMN IF NOT EXISTS late_fee_cents bigint NOT NULL DEFAULT 0;

-- Rebuild the generated column to include the late fee. Drop + re-add (a generated expression cannot be
-- altered in place); the dependency on the CHECK constraints is re-created below.
ALTER TABLE app.fee_obligations DROP COLUMN IF EXISTS net_amount_cents;
ALTER TABLE app.fee_obligations ADD COLUMN net_amount_cents bigint
  GENERATED ALWAYS AS (amount_cents - concession_cents - waived_cents + late_fee_cents) STORED;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'obligations_late_fee_nonneg') THEN
    ALTER TABLE app.fee_obligations ADD CONSTRAINT obligations_late_fee_nonneg CHECK (late_fee_cents >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'obligations_paid_lte_net') THEN
    ALTER TABLE app.fee_obligations ADD CONSTRAINT obligations_paid_lte_net CHECK (paid_cents <= net_amount_cents);
  END IF;
END $$;

COMMIT;
