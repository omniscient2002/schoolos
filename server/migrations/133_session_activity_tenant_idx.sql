-- 133 · tenant-leading index on auth.session_activity (DATX-11).
--
-- 126 created the table with an index on last_seen_at only, so the index-hygiene gate correctly flagged
-- it: RLS scans need a tenant-leading index to start from. Idempotent.

BEGIN;

CREATE INDEX IF NOT EXISTS session_activity_tenant_idx ON auth.session_activity (tenant_id, last_seen_at);

COMMIT;
