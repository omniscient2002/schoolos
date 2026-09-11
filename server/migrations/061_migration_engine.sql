-- 061_migration_engine.sql — Wave 4 · L1-4.1: the real migration engine.
-- Staged loads become inspectable rows (per-row status + error text) instead of
-- a counter; the source row keeps a sample_json preview for the UI; commit is
-- the ONLY path that can set status='verified' (the stage door can no longer
-- flip it by hand).
ALTER TABLE app.migration_sources
  ADD COLUMN IF NOT EXISTS sample_json jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS app.migration_rows (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES app.tenants(id),
  source_id           uuid NOT NULL REFERENCES app.migration_sources(id) ON DELETE CASCADE,
  row_no              int NOT NULL,
  kind                text NOT NULL DEFAULT 'student' CHECK (kind IN ('student','guardian','fee')),
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
  status              text NOT NULL DEFAULT 'staged' CHECK (status IN ('staged','ok','error')),
  error               text,
  committed_student_id uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, row_no)
);
CREATE INDEX IF NOT EXISTS migration_rows_source_idx ON app.migration_rows (tenant_id, source_id, status);

-- 049 RLS pattern (verbatim).
ALTER TABLE app.migration_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.migration_rows FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.migration_rows;
CREATE POLICY tenant_isolation ON app.migration_rows
  USING (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('schoolos.tenant_id', true)::uuid);

-- 054 grant law: explicit grants, never default privileges.
-- NOTE (bootstrap interaction): scripts/bootstrap.js rebaselines ALL app-schema
-- grants to SELECT/INSERT/UPDATE (no table-level DELETE — 054 matrix), and runs
-- AFTER migrate in test setup, so a table-level DELETE grant here is wiped at
-- every test setup. The staged-set replacement therefore deletes through a
-- scoped SECURITY DEFINER helper (same style as audit_log's kernel-function
-- writes), guarded to the caller's tenant — never through a wide table grant.
GRANT SELECT, INSERT, UPDATE ON app.migration_rows TO schoolos_app;

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
  IF src_tenant <> current_setting('schoolos.tenant_id', true)::uuid THEN
    RAISE EXCEPTION 'cross-tenant purge denied';
  END IF;
  DELETE FROM app.migration_rows WHERE source_id = p_source AND status <> 'ok';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION app.purge_staged_rows(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.purge_staged_rows(uuid) TO schoolos_app;
