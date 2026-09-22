-- 130 · tenant-aligned FKs for the columns added by 126/127 (DAT-2 census).
--
-- `auth.session_activity.user_id` (126) and `app.billing_runs.voided_by` (127) look like references but
-- carried no FK, so the DAT-2 census correctly flagged them. Both parents exist (app.users carries
-- UNIQUE (tenant_id, id) from 081); this adds the composite FK. Nullable `voided_by` never trips it.
-- Guarded on table/constraint existence; idempotent.

BEGIN;

DO $$
BEGIN
  IF to_regclass('auth.session_activity') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'session_activity_user_fkey') THEN
    ALTER TABLE auth.session_activity ADD CONSTRAINT session_activity_user_fkey
      FOREIGN KEY (tenant_id, user_id) REFERENCES app.users (tenant_id, id) ON DELETE CASCADE;
  END IF;

  IF to_regclass('app.billing_runs') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='app' AND table_name='billing_runs' AND column_name='voided_by')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_runs_voided_by_fkey') THEN
    ALTER TABLE app.billing_runs ADD CONSTRAINT billing_runs_voided_by_fkey
      FOREIGN KEY (tenant_id, voided_by) REFERENCES app.users (tenant_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

COMMIT;
