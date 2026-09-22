-- 127 · billing-run lifecycle status (D7).
--
-- `app.billing_runs` recorded only that a run happened; the design's `POST /billing-runs/:id/void` needs
-- a status and an auditable void. Idempotent.

BEGIN;

ALTER TABLE app.billing_runs ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'posted';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_runs_status_check') THEN
    ALTER TABLE app.billing_runs ADD CONSTRAINT billing_runs_status_check CHECK (status IN ('posted','void'));
  END IF;
END $$;
ALTER TABLE app.billing_runs ADD COLUMN IF NOT EXISTS voided_by uuid;
ALTER TABLE app.billing_runs ADD COLUMN IF NOT EXISTS voided_at timestamptz;

COMMIT;
