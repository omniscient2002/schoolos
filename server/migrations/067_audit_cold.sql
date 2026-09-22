-- 067 · audit cold archive (L2-3.4, Wave 3 — claimed by L2, blocks.md).
-- Chain-preserving audit retention: rows older than the archival cutoff are
-- MOVED (verbatim, hash columns untouched) into a cold table by the retention
-- worker inside one transaction — INSERT-then-DELETE, never a bare DELETE.
-- The union hot∪cold still verifies as one chain because moved rows are
-- byte-identical. Cold reads are owner-path (REVOKE from the app role); the
-- roster-visible audit surface stays the hot table.
CREATE TABLE IF NOT EXISTS app.audit_log_cold (LIKE app.audit_log INCLUDING ALL);
ALTER TABLE app.audit_log_cold ADD COLUMN IF NOT EXISTS archived_at timestamptz NOT NULL DEFAULT now();

-- delete-tracking idempotence: a partial batch re-runs only un-moved rows
CREATE UNIQUE INDEX IF NOT EXISTS audit_cold_id_idx ON app.audit_log_cold (id);

ALTER TABLE app.audit_log_cold ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.audit_log_cold FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_cold_tenant ON app.audit_log_cold;
CREATE POLICY audit_cold_tenant ON app.audit_log_cold
  USING (tenant_id = current_setting('schoolos.tenant_id', true)::uuid);
REVOKE ALL ON app.audit_log_cold FROM schoolos_app;
