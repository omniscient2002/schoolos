-- 145 · Action Plan batch 4: fee-hike consultation linkage on plan templates.
--
-- A fee rise above 10% must cite the SMC consultation that approved it (kind SMC,
-- held within 180 days) — the minutes live in app.mtgs, not in chat history. The
-- columns ride the template so every generated run inherits the paper trail.

BEGIN;

ALTER TABLE app.fee_plan_templates ADD COLUMN IF NOT EXISTS hike_pct numeric(5,2);
ALTER TABLE app.fee_plan_templates ADD COLUMN IF NOT EXISTS consultation_meeting_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fee_plan_hike_range') THEN
    ALTER TABLE app.fee_plan_templates
      ADD CONSTRAINT fee_plan_hike_range CHECK (hike_pct IS NULL OR (hike_pct >= 0 AND hike_pct <= 100));
  END IF;
END $$;

COMMIT;
