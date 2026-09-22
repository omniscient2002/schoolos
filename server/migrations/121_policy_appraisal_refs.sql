-- 121 · tenant-aligned references for the policy/appraisal tables (119/120).
--
-- 119 (`app.policy_documents.updated_by`) and 120 (`app.staff_appraisals.reviewer_id`) reference
-- app.users but carried no FK, so the DAT-2 census correctly flagged them as unaccounted. The columns
-- have parents, so the right answer is a constraint (082 pattern). Both are nullable, so a NULL never
-- trips the FK. Guarded on table existence so a deployment that has not applied 119/120 still migrates.
-- Idempotent.

BEGIN;

DO $$
BEGIN
  IF to_regclass('app.policy_documents') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'policy_documents_updated_by_fkey') THEN
    ALTER TABLE app.policy_documents ADD CONSTRAINT policy_documents_updated_by_fkey
      FOREIGN KEY (tenant_id, updated_by) REFERENCES app.users(tenant_id, id) ON DELETE RESTRICT;
  END IF;

  IF to_regclass('app.staff_appraisals') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_appraisals_reviewer_fkey') THEN
    ALTER TABLE app.staff_appraisals ADD CONSTRAINT staff_appraisals_reviewer_fkey
      FOREIGN KEY (tenant_id, reviewer_id) REFERENCES app.users(tenant_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

COMMIT;
