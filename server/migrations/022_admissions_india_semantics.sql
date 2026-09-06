-- 021: admissions.funnel — India-admissions semantics upgrade (plugindev, orchestrator GO)
-- Upgrades the 018-registered funnel: deterministic session-window enforcement,
-- duplicate-enquiry guard, renamed stage lattice (enquiry → form → interaction → offer
-- with rejected/withdrawn side exits), offer.accepted → KERNEL-GATED students.create
-- (admissions offers create core student records — a core-domain write, so it rides
-- kernel approval semantics via app.actions, never plugin-direct writes).
-- Money-adjacent stays NO: the funnel collects no fees (payments.upi's lane).
-- Idempotent like 011/013/015/018-020. Companion code: src/plugins/admissions.funnel/.

-- ── 1. Dedupe guard: one open enquiry per (guardian_phone, class_applied, admission_year) ─
CREATE UNIQUE INDEX IF NOT EXISTS lead_unique_open_enquiry
  ON plugin_admissions.lead (tenant_id, guardian_phone, class_applied,
    COALESCE(notes->>'admission_year', ''))
  WHERE stage IN ('enquiry','form','interaction','offer');

-- ── 2. Migrate existing leads to the new lattice (idempotent) ───────────────────
-- old: inquiry → applied → interview → offer | rejected/withdrawn (018 module)
-- new: enquiry → form → interaction → offer   | rejected/withdrawn (India admissions)
UPDATE plugin_admissions.lead SET stage = CASE stage
  WHEN 'inquiry'   THEN 'enquiry'
  WHEN 'applied'   THEN 'form'
  WHEN 'interview' THEN 'interaction'
  ELSE stage END
WHERE stage IN ('inquiry','applied','interview');

UPDATE plugin_admissions.stage_history SET
  from_stage = CASE from_stage WHEN 'inquiry' THEN 'enquiry' WHEN 'applied' THEN 'form' WHEN 'interview' THEN 'interaction' ELSE from_stage END,
  to_stage   = CASE to_stage   WHEN 'inquiry' THEN 'enquiry' WHEN 'applied' THEN 'form' WHEN 'interview' THEN 'interaction' ELSE to_stage END
WHERE from_stage IN ('inquiry','applied','interview') OR to_stage IN ('inquiry','applied','interview');

-- new inserts must land on the renamed lattice too (018's column default said 'inquiry')
ALTER TABLE plugin_admissions.lead ALTER COLUMN stage SET DEFAULT 'enquiry';

-- ── 3. Registry manifest/settings-schema refresh (settings schema lives in the manifest) ─
UPDATE app.plugins SET
  manifest = jsonb_set(manifest, '{settingsSchema,properties}',
    manifest->'settingsSchema'->'properties'
      || jsonb_build_object(
        'admission_year', '{"type":"string","pattern":"^\\\\d{4}-\\\\d{2}$","default":"2026-27","description":"Admission session year (e.g. 2026-27); defaults to the current Apr–Mar cycle"}'::jsonb,
        'cycle_start',    '{"type":"string","pattern":"^\\\\d{2}-\\\\d{2}$","default":"02-01","description":"Session window start (MM-DD); Feb 1 default — India admissions cycle Feb–Jun"}'::jsonb,
        'cycle_end',      '{"type":"string","pattern":"^\\\\d{2}-\\\\d{2}$","default":"06-30","description":"Session window end (MM-DD)"}'::jsonb)),
  updated_at = now()
WHERE plugin_id = 'admissions.funnel';

-- ── 4. Guarded ledger entry ──────────────────────────────────────────────────────
WITH cands AS (
  SELECT t.id AS tenant_id,
         COALESCE((SELECT a.hash FROM app.audit_log a
                    WHERE a.tenant_id = t.id
                    ORDER BY a.created_at DESC, a.id DESC LIMIT 1), 'GENESIS') AS prev_hash,
         to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at_iso
  FROM app.tenants t
  WHERE NOT EXISTS (
    SELECT 1 FROM app.audit_log x
    WHERE x.tenant_id = t.id AND x.record_type = 'Plugin' AND x.record_ref = 'admissions.funnel@1.1.0')
), mat AS (
  SELECT c.tenant_id, c.prev_hash, c.at_iso,
    '{"tenant":"' || c.tenant_id::text
    || '","actor":"migration 021 (plugin factory)","actorRole":"system","action":"Plugin unit upgraded: admissions.funnel v1.1 (India-admissions semantics)","recordType":"Plugin","recordRef":"admissions.funnel@1.1.0","outcome":"enquiry→form→interaction→offer lattice · duplicate-enquiry guard (unique partial index) · session window Feb–Jun via settings (admission_year, cycle_start/cycle_end) · offer.accepted → kernel approval-gated students.create (no plugin-direct core writes) · no fee collection in the funnel","at":"' || c.at_iso || '"}' AS material
  FROM cands c
), hashed AS (
  SELECT m.tenant_id, m.prev_hash, m.at_iso, m.material,
         encode(sha256(convert_to(m.prev_hash || m.material, 'UTF8')), 'hex') AS row_hash
  FROM mat m
)
SELECT * FROM hashed
CROSS JOIN LATERAL app.audit_append(
  hashed.tenant_id, 'migration 021 (plugin factory)', 'system',
  'Plugin unit upgraded: admissions.funnel v1.1 (India-admissions semantics)',
  'Plugin', 'admissions.funnel@1.1.0',
  'stage lattice renamed · dedupe guard · session window settings · kernel-gated enrollment',
  'Platform §3.1 (plugin governance) · DPDP consent obligations', false, 'low',
  'settings schema extended · lattice migrated idempotently · offer.accepted gated by app.actions',
  hashed.prev_hash, hashed.row_hash, hashed.at_iso::timestamptz);
