-- 120 · OWNER / PRINCIPAL — staff appraisals (docs/OWNER-PRINCIPAL-PERFECT-100.md, PRD-11).
--
-- WHAT THIS ADDS
--   · OPP-PRD-11  `app.staff_appraisals` — a per-staff, per-cycle appraisal with a rating, strengths,
--                 improvements and a draft → shared → acknowledged lifecycle. The principal's view of
--                 the staff they run; previously absent entirely.
--
-- LAWS OBEYED
--   · DAT-1: composite (tenant_id, id) UNIQUE + a tenant-aligned FK on the appraised staff member.
--   · D-35: the app role gets SELECT/INSERT/UPDATE, never DELETE.
--   · 074: every policy routes through app.current_tenant().
--   · Idempotent: IF NOT EXISTS; runs on an empty database and on a replay.

BEGIN;

CREATE TABLE IF NOT EXISTS app.staff_appraisals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id),
  staff_user_id uuid NOT NULL,
  cycle         text NOT NULL,
  rating        integer CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5)),
  strengths     text,
  improvements  text,
  reviewer_id   uuid,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','shared','acknowledged')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, staff_user_id, cycle)
);

ALTER TABLE app.staff_appraisals ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.staff_appraisals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.staff_appraisals;
CREATE POLICY tenant_isolation ON app.staff_appraisals
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.staff_appraisals TO schoolos_app;

ALTER TABLE app.staff_appraisals DROP CONSTRAINT IF EXISTS staff_appraisals_tenant_id_id_key;
ALTER TABLE app.staff_appraisals ADD CONSTRAINT staff_appraisals_tenant_id_id_key UNIQUE (tenant_id, id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_appraisals_staff_fkey') THEN
    ALTER TABLE app.staff_appraisals ADD CONSTRAINT staff_appraisals_staff_fkey
      FOREIGN KEY (tenant_id, staff_user_id) REFERENCES app.users(tenant_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS staff_appraisals_tenant_cycle_idx ON app.staff_appraisals (tenant_id, cycle, status);

COMMIT;
