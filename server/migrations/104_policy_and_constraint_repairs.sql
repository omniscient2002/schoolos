-- 104 · DATX-7 / DATX-9 / DATX-15 (PERFECT-100 §9.2)
--
--   DATX-7  app.capability_contracts.contracts_read is `USING (true)`, so the app role reads every
--           tenant's rows. The table is mostly PLATFORM rows (tenant_id NULL) plus a tenant's own — scope
--           the policy to exactly that.
--   DATX-9  19 constraints from 088/092/101 were created NOT VALID and never validated, so historical
--           rows stay unconstrained with no retry path. Validate the clean set (idempotent; anything that
--           cannot validate is WARNED, never silently skipped).
--   DATX-15 app.oauth_states is `USING (true) FOR ALL TO schoolos_app` with SELECT/INSERT/DELETE grants,
--           while every code path uses `sysq` (owner). Deny the app role entirely — least privilege.

-- ── DATX-7 ───────────────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS contracts_read ON app.capability_contracts;
CREATE POLICY contracts_read ON app.capability_contracts
  FOR SELECT TO schoolos_app
  USING (tenant_id IS NULL OR tenant_id = app.current_tenant()::uuid);

-- ── DATX-15 ──────────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON app.oauth_states FROM schoolos_app;
DROP POLICY IF EXISTS oauth_states_preauth ON app.oauth_states;
CREATE POLICY oauth_states_kernel_only ON app.oauth_states
  FOR ALL TO schoolos_app USING (false) WITH CHECK (false);

-- ── DATX-9 ───────────────────────────────────────────────────────────────────────────────────────
-- Validate every CHECK/FK that is still NOT VALID in the application schemas. Idempotent: a validated
-- constraint is no longer `NOT convalidated`. A constraint that cannot validate on a database carrying
-- historical dirt is WARNED with its reason instead of aborting the whole migration, so the clean set
-- converges and the dirty set stays visible.
DO $mig$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch, c.relname AS tbl, con.conname AS name
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE NOT con.convalidated
       AND con.contype IN ('c', 'f')
       AND n.nspname IN ('app', 'auth', 'library', 'teacher', 'plugin_visitors', 'plugin_dpdp', 'ptm', 'family', 'student')
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %I.%I VALIDATE CONSTRAINT %I', r.sch, r.tbl, r.name);
    EXCEPTION WHEN others THEN
      RAISE WARNING 'DATX-9: %.% constraint % could not be validated (%). Historical rows preserved; fix the data and re-run.', r.sch, r.tbl, r.name, SQLERRM;
    END;
  END LOOP;
END
$mig$;
