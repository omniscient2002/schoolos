-- 124 · FORCE ROW LEVEL SECURITY on the exams / hr / clinic plugin tables (F7 / J3).
--
-- These schemas had RLS ENABLED but not FORCED (migrations 025/029), so the table owner bypassed the
-- policy. The app role is not the owner, so the practical exposure was small, but FORCE is the
-- defense-in-depth default every other domain table already carries (113). Idempotent: only tables
-- that are not already forced are touched.

BEGIN;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch, c.relname AS tbl
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'r'
       AND n.nspname IN ('plugin_exams', 'plugin_hr', 'plugin_clinic')
       AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.sch, r.tbl);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', r.sch, r.tbl);
  END LOOP;
END $$;

COMMIT;
