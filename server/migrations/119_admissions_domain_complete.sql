-- 119: admissions.funnel — domain completion (waitlist, scheduling, documents,
-- admission_year column, DB-enforced lattice, version bump).
--
-- Closes the data-model findings from ADMISSIONS-PERFECT-100: the lattice lived only in
-- JavaScript (B-1/B-2), the session key was buried in `notes` JSONB (B-3), and there was
-- no scheduling/activity or document surface (E-3/E-4) and no waitlist (E-6).
-- Idempotent like 011/013/015/018-024/046.
--
-- Invariants preserved: no core-student writes from the plugin; no money surfaces; PII
-- stays in plugin_admissions (purgeable); tenant-isolated RLS.

-- ── 1. admission_year as a real, checked column (was notes->>'admission_year') ────
ALTER TABLE plugin_admissions.lead ADD COLUMN IF NOT EXISTS admission_year text;
UPDATE plugin_admissions.lead
   SET admission_year = COALESCE(notes->>'admission_year', '')
 WHERE admission_year IS NULL;
ALTER TABLE plugin_admissions.lead ALTER COLUMN admission_year SET DEFAULT '';
ALTER TABLE plugin_admissions.lead DROP CONSTRAINT IF EXISTS lead_admission_year_shape;
ALTER TABLE plugin_admissions.lead ADD CONSTRAINT lead_admission_year_shape
  CHECK (admission_year = '' OR admission_year ~ '^\d{4}-\d{2}$');

-- ── 2. DB-enforced stage lattice (waitlisted added) ──────────────────────────────
ALTER TABLE plugin_admissions.lead DROP CONSTRAINT IF EXISTS lead_stage_valid;
ALTER TABLE plugin_admissions.lead ADD CONSTRAINT lead_stage_valid
  CHECK (stage IN ('enquiry','form','interaction','offer','waitlisted','enrolled','rejected','withdrawn'));

ALTER TABLE plugin_admissions.stage_history DROP CONSTRAINT IF EXISTS stage_history_to_valid;
ALTER TABLE plugin_admissions.stage_history ADD CONSTRAINT stage_history_to_valid
  CHECK (to_stage IN ('enquiry','form','interaction','offer','waitlisted','enrolled','rejected','withdrawn'));

ALTER TABLE plugin_admissions.stage_history DROP CONSTRAINT IF EXISTS stage_history_from_valid;
ALTER TABLE plugin_admissions.stage_history ADD CONSTRAINT stage_history_from_valid
  CHECK (from_stage IS NULL OR from_stage IN ('enquiry','form','interaction','offer','waitlisted','enrolled','rejected','withdrawn'));

-- ── 3. dedupe guard now keys on the real column (waitlisted is still open) ───────
DROP INDEX IF EXISTS plugin_admissions.lead_unique_open_enquiry;
DROP INDEX IF EXISTS plugin_admissions.lead_open_unique;
CREATE UNIQUE INDEX IF NOT EXISTS lead_unique_open_enquiry
  ON plugin_admissions.lead (tenant_id, guardian_phone, class_applied, admission_year)
  WHERE stage IN ('enquiry','form','interaction','offer','waitlisted');

-- ── 4. documents attached at admission (file ids from files.store) ───────────────
ALTER TABLE plugin_admissions.lead ADD COLUMN IF NOT EXISTS documents jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE plugin_admissions.lead DROP CONSTRAINT IF EXISTS lead_documents_array;
ALTER TABLE plugin_admissions.lead ADD CONSTRAINT lead_documents_array
  CHECK (jsonb_typeof(documents) = 'array');

-- ── 5. visit / interview / call scheduling + outcomes ────────────────────────────
CREATE TABLE IF NOT EXISTS plugin_admissions.lead_activity (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES app.tenants(id),
  lead_id      uuid NOT NULL REFERENCES plugin_admissions.lead(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('visit','interview','call','note')),
  scheduled_at timestamptz,
  completed_at timestamptz,
  outcome      text,
  notes        text,
  actor        text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_activity_tenant_lead
  ON plugin_admissions.lead_activity (tenant_id, lead_id, created_at DESC);

ALTER TABLE plugin_admissions.lead_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_admissions.lead_activity FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON plugin_admissions.lead_activity;
CREATE POLICY tenant_isolation ON plugin_admissions.lead_activity
  USING (tenant_id = app.current_tenant()::uuid)
  WITH CHECK (tenant_id = app.current_tenant()::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON plugin_admissions.lead_activity TO schoolos_app;

-- ── 6. registry version + grant bump (code manifest is the source; keeps rows in step) ─
UPDATE app.plugins
   SET version = '1.3.0',
       permissions = '["events.emit","audit.request","actions.raise","comms.send"]'::jsonb,
       updated_at = now()
 WHERE plugin_id = 'admissions.funnel';

-- ── 7. Guarded ledger entry (hash chain, 018/022 pattern) ────────────────────────
WITH cands AS (
  SELECT t.id AS tenant_id,
         COALESCE((SELECT a.hash FROM app.audit_log a
                    WHERE a.tenant_id = t.id
                    ORDER BY a.created_at DESC, a.id DESC LIMIT 1), 'GENESIS') AS prev_hash,
         to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at_iso
  FROM app.tenants t
  WHERE NOT EXISTS (
    SELECT 1 FROM app.audit_log x
    WHERE x.tenant_id = t.id AND x.record_type = 'Plugin' AND x.record_ref = 'admissions.funnel@1.3.0')
), mat AS (
  SELECT c.tenant_id, c.prev_hash, c.at_iso,
    '{"tenant":"' || c.tenant_id::text
    || '","actor":"migration 119 (plugin factory)","actorRole":"system","action":"Plugin unit upgraded: admissions.funnel v1.3 (domain completion)","recordType":"Plugin","recordRef":"admissions.funnel@1.3.0","outcome":"DB-enforced lattice (incl. waitlisted) · admission_year real column · lead_activity scheduling (visit/interview/call/note) · documents jsonb · dedupe index on the real session key","at":"' || c.at_iso || '"}' AS material
  FROM cands c
), hashed AS (
  SELECT m.tenant_id, m.prev_hash, m.at_iso, m.material,
         encode(sha256(convert_to(m.prev_hash || m.material, 'UTF8')), 'hex') AS row_hash
  FROM mat m
)
SELECT * FROM hashed
CROSS JOIN LATERAL app.audit_append(
  hashed.tenant_id, 'migration 119 (plugin factory)', 'system',
  'Plugin unit upgraded: admissions.funnel v1.3 (domain completion)',
  'Plugin', 'admissions.funnel@1.3.0',
  'DB lattice + waitlist · scheduling activity · documents · real admission_year',
  'Platform §3.1 (plugin governance) · DPDP consent obligations', false, 'low',
  'schema extended idempotently · no core-student writes introduced · no money surfaces',
  hashed.prev_hash, hashed.row_hash, hashed.at_iso::timestamptz);
