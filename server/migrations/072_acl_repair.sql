-- 072 · ACL repair — revoke the excess `schoolos_app` table-level DELETE grants.
-- Closes SEC-1 / restores law D-35 ("the app role NEVER receives table-level DELETE").
-- Claimed via .coop/help.md; authored by L3 because it sits on the SEC-1 critical path.
--
-- WHY THIS EXISTS (verified against the live dev DB, read-only queries):
--   pg_default_acl carries a `postgres`-owned TABLE default ACL for schema app:
--     {schoolos_app=arwd/postgres}          <-- the 'd' is DELETE
--   while schoolos' own default ACL is correct:
--     {schoolos_app=arw/schoolos}           <-- no 'd'
--   So EVERY table created BY POSTGRES in schema app silently inherits table-level
--   DELETE for the app role. That is exactly how app.timetable_periods,
--   app.timetable_slots and app.timetable_substitutions came to hold DELETE — three
--   direct D-35 violations — and why the earlier bootstrap fix was incomplete:
--   scripts/bootstrap.js:31-32 issues ALTER DEFAULT PRIVILEGES FOR ROLE schoolos
--   only. It repairs the trap for objects created by schoolos and cannot outlive the
--   next postgres-authored CREATE TABLE.
--
-- WHAT THIS MIGRATION CANNOT DO — stated plainly, because silence here would be the
-- same class of defect this project is trying to eliminate: a migration CANNOT remove
-- that default ACL. `ALTER DEFAULT PRIVILEGES FOR ROLE postgres ...` requires
-- membership in `postgres` or superuser, and `schoolos` is neither (rolsuper=f).
-- The operator must do it once, as superuser:
--
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app
--     REVOKE ALL ON TABLES FROM schoolos_app;
--
-- Until that is run the trap stays armed. tests/acl-d35.test.js guards the EFFECT
-- rather than the cause — it fails the moment any table actually ends up with DELETE
-- again, which is the observable symptom and is testable without superuser.
--
-- Idempotent: it revokes whatever it finds, so it is safe to re-run and also repairs
-- drift on databases whose history we cannot reconstruct.

DO $$
DECLARE
  r        record;
  n_app    int := 0;
  n_other  int := 0;
BEGIN
  -- Migrations run BEFORE bootstrap in tests/helpers.js, so on a truly fresh database
  -- the constrained role may not exist yet. Nothing to revoke in that case, and the
  -- subsequent bootstrap grants only SELECT, INSERT, UPDATE — which is correct.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'schoolos_app') THEN
    RAISE NOTICE '072 acl repair: schoolos_app absent (pre-bootstrap) — nothing to revoke';
    RETURN;
  END IF;

  FOR r IN
    SELECT n.nspname AS sch, c.relname AS tbl
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'r'
       AND n.nspname NOT IN ('pg_catalog', 'information_schema')
       AND n.nspname NOT LIKE 'pg\_%'
       AND has_table_privilege('schoolos_app', c.oid, 'DELETE')
       -- DELIBERATE, REASONED EXCEPTION (not an oversight):
       -- a student may hard-delete their OWN notebook note. That door
       -- (student.world/index.js:297) runs through withStudentUser, i.e. AS
       -- schoolos_app, is scoped to creator_user_id, and rides the hash-chained
       -- audit ledger. Revoking it here would break a shipped, user-visible feature.
       -- D-35 is scoped to schema `app`; this is schema `student`. Converting the
       -- door to a SECURITY DEFINER helper (the app.purge_staged_rows precedent in
       -- 061) would let this exception be removed — tracked as a follow-up, not
       -- silently dropped.
       AND NOT (n.nspname = 'student' AND c.relname = 'mistake_note')
  LOOP
    EXECUTE format('REVOKE DELETE ON TABLE %I.%I FROM schoolos_app', r.sch, r.tbl);
    IF r.sch = 'app' THEN
      n_app := n_app + 1;
    ELSE
      n_other := n_other + 1;
    END IF;
  END LOOP;

  RAISE NOTICE '072 acl repair: revoked DELETE on % app table(s) and % table(s) outside app (student.mistake_note excluded by design)', n_app, n_other;
END $$;
