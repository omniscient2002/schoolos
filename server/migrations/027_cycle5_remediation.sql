-- 027: cycle-5 remediation (plugindev, riding with pack.cbse per orchestrator dispatch)
-- Sources: handoff/2026-09-06-redteam-cycle5-dpdp-admissions.md (red team, cycle 5) +
-- the live exams 23505 discovery. Contents:
--   §1  zz.redteam5.* residue purge (rt4 precedent; outbox first — FK order)
--   §2  P2-1 backfill: normalize stored phones to digits-only E.164 (consent, SAR,
--       admissions lead) — spaced/compact input was two data principals to the ledger
--   §3  P1-2 backstop: partial unique index on open leads (the check-then-insert race
--       now degrades to the friendly 409; module catches 23505)
--   §4  registry version bumps: admissions.funnel 1.1.0→1.2.0 (P1-1/P2-1/P2-2 fixes),
--       pack.dpdp 1.0.0→1.1.0 (P1-1/P2-1 fixes) — module manifests match
--   §5  guarded ledger entry cycle5-remediation@1

-- ── §1 · rt5 residue ─────────────────────────────────────────────────────────────
CREATE TEMP TABLE _rt5_leads ON COMMIT DROP AS
  SELECT id::text AS id FROM plugin_admissions.lead WHERE student_name LIKE 'RT5 %';
CREATE TEMP TABLE _rt5_sars ON COMMIT DROP AS
  SELECT id::text AS id FROM plugin_dpdp.sar
   WHERE (status='open' AND action_id IS NULL)                    -- the P1-1 crash orphan
      OR subject_ref IN ('+919800055003', '+91 98000 55001', '+919800055001');
CREATE TEMP TABLE _rt5_ids ON COMMIT DROP AS
  SELECT id FROM _rt5_leads UNION SELECT id FROM _rt5_sars
  UNION SELECT '6eccfaea-3195-43b1-89c3-212ab5ff2d59'             -- UPI regression canary
  UNION SELECT code FROM (VALUES ('students.create'), ('dpdp.dsr.export'), ('dpdp.dsr.erasure'), ('exams.publish')) v(code) -- pre-fix static codes (legacy)
  UNION SELECT a.id::text FROM app.actions a
   WHERE a.payload->>'leadId' IN (SELECT id FROM _rt5_leads)
      OR a.payload->>'sarId'  IN (SELECT id FROM _rt5_sars);

DELETE FROM app.outbox o WHERE EXISTS (
  SELECT 1 FROM _rt5_ids v WHERE o.payload::text LIKE '%' || v.id || '%');
DELETE FROM app.events e WHERE EXISTS (
  SELECT 1 FROM _rt5_ids v WHERE e.ref = v.id OR e.payload::text LIKE '%' || v.id || '%');DELETE FROM plugin_upi.webhook_log WHERE event_id IN ('evt_rt5_raw', 'evt_rt5_replay');
DELETE FROM app.payments WHERE id IN (SELECT id::uuid FROM _rt5_ids WHERE id ~ '^[0-9a-f-]{36}$');
DELETE FROM plugin_admissions.stage_history WHERE lead_id::text IN (SELECT id FROM _rt5_leads);
DELETE FROM plugin_admissions.lead          WHERE id::text        IN (SELECT id FROM _rt5_leads);
DELETE FROM plugin_dpdp.consent
 WHERE (subject_ref = '+919800055003' AND purpose = 'zz_redteam5_probe')
    OR (subject_ref IN ('+91 98000 55001', '+919800055001') AND evidence->>'rawSubjectRef' IS NULL);
DELETE FROM plugin_dpdp.sar   WHERE id::text IN (SELECT id FROM _rt5_sars);
DELETE FROM app.actions       WHERE id::text IN (SELECT id FROM _rt5_ids WHERE id ~ '^[0-9a-f-]{36}$')
   OR code IN ('students.create', 'dpdp.dsr.export', 'dpdp.dsr.erasure', 'exams.publish');

-- ── §2 · P2-1 backfill: digits-only E.164 (skip already-erased placeholders) ─────
-- bare 10-digit → +91XXXXXXXXXX; anything else carrying separators/digits → '+' + digits
UPDATE plugin_dpdp.consent SET subject_ref =
  CASE WHEN subject_ref ~ '^\d{10}$' THEN '+91' || subject_ref
       ELSE '+' || regexp_replace(subject_ref, '\D', '', 'g') END
 WHERE subject_ref NOT LIKE '[erased%' AND subject_ref ~ '^[\d\s()\-]{6,15}$';
UPDATE plugin_dpdp.sar SET subject_ref =
  CASE WHEN subject_ref ~ '^\d{10}$' THEN '+91' || subject_ref
       ELSE '+' || regexp_replace(subject_ref, '\D', '', 'g') END
 WHERE subject_ref NOT LIKE '[erased%' AND subject_ref ~ '^[\d\s()\-]{6,15}$';
UPDATE plugin_admissions.lead SET guardian_phone =
  CASE WHEN guardian_phone ~ '^\d{10}$' THEN '+91' || guardian_phone
       ELSE '+' || regexp_replace(guardian_phone, '\D', '', 'g') END
 WHERE guardian_phone NOT LIKE '[erased%' AND guardian_phone ~ '^[\d\s()\-]{6,15}$';

-- ── §3 · P1-2 backstop: one OPEN lead per (tenant, guardian, class, session) ─────
CREATE UNIQUE INDEX IF NOT EXISTS lead_open_unique
  ON plugin_admissions.lead (tenant_id, guardian_phone, class_applied, (COALESCE(notes->>'admission_year','')))
  WHERE stage IN ('enquiry', 'form', 'interaction', 'offer');

-- ── §4 · registry version bumps (catalog truth + tenant rows) ────────────────────
UPDATE app.plugins SET version='1.2.0', manifest = jsonb_set(manifest, '{version}', '"1.2.0"')
 WHERE plugin_id='admissions.funnel';
UPDATE app.plugins SET version='1.1.0', manifest = jsonb_set(manifest, '{version}', '"1.1.0"')
 WHERE plugin_id='pack.dpdp';

-- ── §5 · guarded ledger entry ────────────────────────────────────────────────────
WITH cands AS (
  SELECT t.id AS tenant_id,
         COALESCE((SELECT a.hash FROM app.audit_log a
                    WHERE a.tenant_id = t.id
                    ORDER BY a.created_at DESC, a.id DESC LIMIT 1), 'GENESIS') AS prev_hash,
         to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at_iso
  FROM app.tenants t
  WHERE NOT EXISTS (
    SELECT 1 FROM app.audit_log x
    WHERE x.tenant_id = t.id AND x.record_type = 'Plugin' AND x.record_ref = 'cycle5-remediation@1')
), mat AS (
  SELECT c.tenant_id, c.prev_hash, c.at_iso,
    '{"tenant":"' || c.tenant_id::text
    || '","actor":"migration 027 (plugin factory)","actorRole":"system","action":"Cycle-5 remediation batch: P1-1 per-instance action codes (dpdp.dsr.<kind>.<sarId>, students.create.<leadId>) · P1-2 partial unique index lead_open_unique + 23505→409 catch · P2-1 E.164 normalization at dpdp/admissions doors + backfill · P2-2 admissionYear format+role validation · P2-3 uuid guard on /actions/:id/decide · IST session-year clock · zz.redteam5 residue purged (leads, SAR orphan, consent artifacts, static-code actions, canary payment, evt_rt5_* webhooks, spine events) · registry bumps admissions 1.2.0 / dpdp 1.1.0","recordType":"Plugin","recordRef":"cycle5-remediation@1","outcome":"red team cycle 5 findings closed; exams 025 already shipped the per-instance pattern","at":"' || c.at_iso || '"}' AS material
  FROM cands c
), hashed AS (
  SELECT m.tenant_id, m.prev_hash, m.at_iso, m.material,
         encode(sha256(convert_to(m.prev_hash || m.material, 'UTF8')), 'hex') AS row_hash
  FROM mat m
)
SELECT * FROM hashed
CROSS JOIN LATERAL app.audit_append(
  hashed.tenant_id, 'migration 027 (plugin factory)', 'system',
  'Cycle-5 remediation batch (P1-1, P1-2, P2-1, P2-2, P2-3, IST clock, residue purge)',
  'Plugin', 'cycle5-remediation@1',
  'per-instance action codes · dedupe backstop · E.164 normalization · admissionYear guard · uuid guard · rt5 residue purged',
  'CBSE pack obligations · DPDP Act 2023 · Platform §2.4 · red-team cycle 5', false, 'high',
  'admissions.funnel 1.2.0 · pack.dpdp 1.1.0 · exams.assessment already per-instance',
  hashed.prev_hash, hashed.row_hash, hashed.at_iso::timestamptz);
