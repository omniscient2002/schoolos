-- 128 · auto-concession rules on fee plans (D3).
--
-- The design (§6.1) applies sibling/staff concessions during billing-run GENERATION; before this they
-- only applied through the decide door on a named obligation. This column holds the per-plan rule
-- (`{kind:'sibling', percent, min_children}`) that generation applies to matching students.
-- Idempotent.

BEGIN;

ALTER TABLE app.fee_plan_templates ADD COLUMN IF NOT EXISTS auto_concession jsonb;

COMMIT;
