-- 125 · tenant-align plugin_admissions.lead_activity's FK to its lead (J4 / DAT-1).
--
-- 119 created `lead_activity.lead_id` with a single-column FK to `plugin_admissions.lead(id)`, so a row
-- in one tenant could point at another tenant's lead — RLS would hide it from BOTH schools rather than
-- the database refusing it. The parent carries UNIQUE (tenant_id, id) from 081, so the fix is the
-- composite FK. Idempotent; guarded on table existence.

BEGIN;

DO $$
BEGIN
  IF to_regclass('plugin_admissions.lead_activity') IS NOT NULL THEN
    ALTER TABLE plugin_admissions.lead_activity DROP CONSTRAINT IF EXISTS lead_activity_lead_id_fkey;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_activity_tenant_lead_fkey') THEN
      ALTER TABLE plugin_admissions.lead_activity ADD CONSTRAINT lead_activity_tenant_lead_fkey
        FOREIGN KEY (tenant_id, lead_id) REFERENCES plugin_admissions.lead (tenant_id, id) ON DELETE CASCADE;
    END IF;
  END IF;
END $$;

COMMIT;
