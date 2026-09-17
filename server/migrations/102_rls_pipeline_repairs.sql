-- 102 · DATX-2/3/4 (PERFECT-100 §9.2) — three RLS/guard defects found by the 2026-09-17 re-audit.
--
-- These are repairs to objects created by 061, 083 and 086. Those files are applied and their checksums are
-- recorded, so they cannot be edited; and none of them is replayed by seed.js, which is why the defects
-- survived. A new numbered migration is the only correct place to fix an applied file.
--
--   DATX-2 · teacher.submission_needs_linking (086) has tenant_id but no RLS, and holds archived submission
--            content across every tenant. Any bare `q()` read sees every tenant's rows — the exact class
--            RLS exists to stop. Enable + FORCE RLS with the standard tenant policy.
--   DATX-3 · app.purge_staged_rows (061) guards with `src_tenant <> current_setting(..., true)::uuid`.
--            When the GUC is unset the right side is NULL, `<> NULL` is NULL, the IF is false, and the
--            cross-tenant guard FAILS OPEN — a delete of another tenant's staged rows. It must fail CLOSED:
--            `IS DISTINCT FROM NULLIF(current_setting(...), '')::uuid`.
--   DATX-4 · app.class_assignments.tenant (083) inlines `current_setting('schoolos.tenant_id', true)::uuid`.
--            That is the 074 hole re-introduced: an empty-string GUC raises 22P02 and an unset one raises
--            42704, turning an authorization predicate into a 500. 083 post-dates 074 and is never replayed;
--            every other policy goes through app.current_tenant(), so this one must too.
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE, CREATE OR REPLACE FUNCTION, and ENABLE/FORCE are all safe to
-- re-run (074's DO block already rewrites policies by regex, and will rewrite these to the helper form).

-- ── DATX-2: RLS on the archived-submission holding table ───────────────────────────────────────────
ALTER TABLE teacher.submission_needs_linking ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher.submission_needs_linking FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS submission_needs_linking_tenant_isolation ON teacher.submission_needs_linking;
CREATE POLICY submission_needs_linking_tenant_isolation ON teacher.submission_needs_linking
  USING (tenant_id = app.current_tenant()::uuid)
  WITH CHECK (tenant_id = app.current_tenant()::uuid);

-- ── DATX-3: the staged-row purge guard must fail closed when there is no tenant context ────────────
CREATE OR REPLACE FUNCTION app.purge_staged_rows(p_source uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
  n integer;
  src_tenant uuid;
BEGIN
  SELECT tenant_id INTO src_tenant FROM app.migration_sources WHERE id = p_source;
  IF src_tenant IS NULL THEN RETURN 0; END IF;
  -- DATX-3: NULLIF + IS DISTINCT FROM. An unset OR empty GUC now denies instead of admitting; the old
  -- `<>` comparison returned NULL and skipped the RAISE. A caller with no tenant context has no business
  -- purging staged rows at all, so denying is the correct direction.
  IF src_tenant IS DISTINCT FROM NULLIF(current_setting('schoolos.tenant_id', true), '')::uuid THEN
    RAISE EXCEPTION 'cross-tenant purge denied';
  END IF;
  DELETE FROM app.migration_rows WHERE source_id = p_source AND status <> 'ok';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION app.purge_staged_rows(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.purge_staged_rows(uuid) TO schoolos_app;

-- ── DATX-4: 083's policy must use the NULL-normalising helper like every 074-hardened policy ────────
DROP POLICY IF EXISTS class_assignments_tenant ON app.class_assignments;
CREATE POLICY class_assignments_tenant ON app.class_assignments
  USING (tenant_id = app.current_tenant()::uuid)
  WITH CHECK (tenant_id = app.current_tenant()::uuid);
