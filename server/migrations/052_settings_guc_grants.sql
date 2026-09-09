-- 052: grants audit / safety net (Wave C).
-- Audit (psql, has_table_privilege('schoolos_app', …)) of every table the new
-- waves' doors read, BEFORE this migration:
--   family.child_link        SELECT/INSERT/UPDATE ✓ already granted (034:92)
--   app.users                SELECT/INSERT/UPDATE ✓ already granted (bootstrap
--                            schema grants; force_change column: NOT PRESENT yet)
--   app.oauth_states         SELECT/INSERT/DELETE ✓ already granted (040:10)
--   app.files                TABLE DOES NOT EXIST YET (Waves A/B own it)
--   app.enrollment_history   TABLE DOES NOT EXIST YET (Waves A/B own it)
--   library.*                SCHEMA DOES NOT EXIST YET (Waves A/B own it)
-- Nothing was missing on tables that exist today → nothing to REVOKE (and the
-- spec forbids REVOKEs anyway). This migration adds the CONDITIONAL grants for
-- the Wave A/B surfaces so that in any environment where they already exist
-- (043-048 applied ahead of 052, or a hand-created table) the app role is
-- covered with the same shape bootstrap.js uses for schema app.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'app.files',
    'app.enrollment_history'
  ] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %s TO schoolos_app', t);
    END IF;
  END LOOP;

  -- library plane: when the schema lands, its tables are readable
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'library') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA library TO schoolos_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA library TO schoolos_app';
  END IF;

  -- app.users.force_change (Wave A/B column): table-level privileges already
  -- cover a future column, but if it arrives after this migration, mirror 023's
  -- column-scoped grant pattern so exactly the doors that need it can write it.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'app' AND table_name = 'users' AND column_name = 'force_change'
  ) THEN
    EXECUTE 'GRANT UPDATE (force_change) ON app.users TO schoolos_app';
  END IF;
END $$;
