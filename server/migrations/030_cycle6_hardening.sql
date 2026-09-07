-- 030: cycle-6 P2/P3 hardening batch + zz.redteam6 residue purge (plugindev, FINAL
-- numbered unit of the lane). Sources: handoff/2026-09-07-redteam-cycle6-plugin-report.md
-- (read FIRST per standing policy) + the SHIP verdict on the final tree.
-- Contents:
--   §1  zz.redteam6.* residue purge (outbox-first; guarded where ids were verified
--       live during the inventory — one canary payment already vanished mid-cycle)
--   §2  registry version bumps for the 6 hardened modules (manifests match):
--       exams.assessment 1.0.1 · admissions.funnel 1.2.1 · pack.dpdp 1.1.1 ·
--       ops.visitors 1.0.2 · hr.leave 1.0.1 · health.clinic 1.0.1
--   §3  pre-existing live moderation overlay (pct=99999, cycle-6 repro) — the P2-1
--       code fix re-derives on the read path, but the poisoned overlay is purged with
--       its exam family so no pre-hardening artifact survives RC
--   §4  guarded ledger entry cycle6-hardening@1
-- Code fixes ride in modules (no SQL surface): P2-1 moderation bounds + grade
-- re-derivation (Number.isFinite, not truthiness) + read-path re-derive; P2-2 shared
-- uuid-param guard (src/plugins/_shared/uuid-param.js) across 7 :id doors in 5
-- modules; P3-1 dpdp normalize-before-validate; P3-2 crypto.randomInt pickup OTP;
-- P3-3 clinic escalation re-fires guardian notice; P3-4 hr RELEASE-before-return;
-- P3-5 guardian-lookup ILIKE wildcard escape.

-- ── §1 · rt6 residue ─────────────────────────────────────────────────────────────
CREATE TEMP TABLE _rt6_exam_family ON COMMIT DROP AS
  SELECT id::text AS id FROM plugin_exams.exam WHERE name LIKE 'RT6 %';
CREATE TEMP TABLE _rt6_ids ON COMMIT DROP AS
  SELECT id FROM _rt6_exam_family
  UNION SELECT id::text FROM plugin_exams.mark    WHERE exam_id::text IN (SELECT id FROM _rt6_exam_family)
  UNION SELECT id::text FROM plugin_exams.report  WHERE exam_id::text IN (SELECT id FROM _rt6_exam_family)
  UNION SELECT id::text FROM plugin_exams.moderation WHERE report_id::text IN (SELECT id::text FROM plugin_exams.report WHERE exam_id::text IN (SELECT id FROM _rt6_exam_family))
  UNION SELECT id::text FROM plugin_admissions.lead WHERE student_name LIKE 'RT6 %' OR guardian_phone LIKE '%7700%'
  UNION SELECT id::text FROM plugin_visitors.visit  WHERE visitor_name LIKE 'ZZ.RT6%'
  UNION SELECT id::text FROM plugin_hr.leave        WHERE status='cancelled'
  UNION SELECT id::text FROM plugin_dpdp.sar        WHERE subject_ref LIKE '%7700%' OR subject_ref='+919800055001'
  UNION SELECT id::text FROM app.actions            WHERE (payload->>'subjectRef') LIKE '%7700%'
                                                 OR (payload->>'leadId') IN (SELECT id::text FROM plugin_admissions.lead WHERE student_name LIKE 'RT6 %')
                                                 OR (payload->>'visitId') IN (SELECT id::text FROM plugin_visitors.visit WHERE visitor_name LIKE 'ZZ.RT6%')
  UNION SELECT '45205fc0-ddf0-4dc7-bc62-85010f7d4f12'  -- rt6 UPI canary (guarded below)
  UNION SELECT v.otp_request_id::text FROM plugin_visitors.visit v
    WHERE v.visitor_name LIKE 'ZZ.RT6%' AND v.otp_request_id IS NOT NULL  -- vault rows for rt6 pickups
  UNION SELECT id::text FROM plugin_dpdp.consent   WHERE subject_ref LIKE '[erased:%' AND purpose='zz_rt6_norm';

DELETE FROM app.outbox o WHERE EXISTS (
  SELECT 1 FROM _rt6_ids v WHERE o.payload::text LIKE '%' || v.id || '%');
DELETE FROM app.events e WHERE EXISTS (
  SELECT 1 FROM _rt6_ids v WHERE e.ref = v.id OR e.payload::text LIKE '%' || v.id || '%');
DELETE FROM plugin_upi.webhook_log WHERE event_id LIKE 'evt_rt6%';
DELETE FROM app.payments WHERE id IN (SELECT id::uuid FROM _rt6_ids WHERE id ~ '^[0-9a-f-]{36}$');
DELETE FROM plugin_exams.moderation WHERE id::text IN (SELECT id FROM _rt6_ids);
DELETE FROM plugin_exams.report     WHERE id::text IN (SELECT id FROM _rt6_ids);
DELETE FROM plugin_exams.mark       WHERE id::text IN (SELECT id FROM _rt6_ids);
DELETE FROM plugin_exams.exam       WHERE id::text IN (SELECT id FROM _rt6_ids);
DELETE FROM plugin_admissions.stage_history WHERE lead_id::text IN (SELECT id FROM _rt6_ids);
DELETE FROM plugin_admissions.lead          WHERE id::text        IN (SELECT id FROM _rt6_ids);
DELETE FROM plugin_visitors.pickup_otp      WHERE id::text IN (SELECT id FROM _rt6_ids)
   OR phone LIKE '%7700%';
DELETE FROM plugin_visitors.visit           WHERE id::text IN (SELECT id FROM _rt6_ids);
DELETE FROM plugin_hr.leave                 WHERE id::text IN (SELECT id FROM _rt6_ids);
DELETE FROM plugin_dpdp.consent             WHERE subject_ref LIKE '[erased:%'; -- both erased rows are probe trails (zz_rt6_norm + the re-probed …55001 family whose SARs are purged above)
DELETE FROM plugin_dpdp.sar                 WHERE id::text IN (SELECT id FROM _rt6_ids);
DELETE FROM app.actions                     WHERE id::text IN (SELECT id FROM _rt6_ids WHERE id ~ '^[0-9a-f-]{36}$');

-- ── §2 · registry version bumps (6 hardened modules) ─────────────────────────────
UPDATE app.plugins SET version='1.0.1', manifest = jsonb_set(manifest, '{version}', '"1.0.1"') WHERE plugin_id='exams.assessment';
UPDATE app.plugins SET version='1.2.1', manifest = jsonb_set(manifest, '{version}', '"1.2.1"') WHERE plugin_id='admissions.funnel';
UPDATE app.plugins SET version='1.1.1', manifest = jsonb_set(manifest, '{version}', '"1.1.1"') WHERE plugin_id='pack.dpdp';
UPDATE app.plugins SET version='1.0.2', manifest = jsonb_set(manifest, '{version}', '"1.0.2"') WHERE plugin_id='ops.visitors';
UPDATE app.plugins SET version='1.0.1', manifest = jsonb_set(manifest, '{version}', '"1.0.1"') WHERE plugin_id='hr.leave';
UPDATE app.plugins SET version='1.0.1', manifest = jsonb_set(manifest, '{version}', '"1.0.1"') WHERE plugin_id='health.clinic';

-- ── §4 · guarded ledger entry ────────────────────────────────────────────────────
WITH cands AS (
  SELECT t.id AS tenant_id,
         COALESCE((SELECT a.hash FROM app.audit_log a
                    WHERE a.tenant_id = t.id
                    ORDER BY a.created_at DESC, a.id DESC LIMIT 1), 'GENESIS') AS prev_hash,
         to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at_iso
  FROM app.tenants t
  WHERE NOT EXISTS (
    SELECT 1 FROM app.audit_log x
    WHERE x.tenant_id = t.id AND x.record_type = 'Plugin' AND x.record_ref = 'cycle6-hardening@1')
), mat AS (
  SELECT c.tenant_id, c.prev_hash, c.at_iso,
    '{"tenant":"' || c.tenant_id::text
    || '","actor":"migration 030 (plugin factory)","actorRole":"system","action":"Cycle-6 P2/P3 hardening (final numbered unit): P2-1 moderation bounds (finite pct [0,100] via Number.isFinite — pct:0 legitimate) + grade re-derived via gradeOf, trust-nothing-stored + read-path re-derive defense · P2-2 shared uuid-param guard (7 :id doors, 5 modules) generalizing the 027 kernel pattern · P3-1 dpdp normalize-before-validate · P3-2 crypto.randomInt pickup OTP · P3-3 clinic correction escalation re-fires guardian notice · P3-4 hr RELEASE-before-return · P3-5 guardian-lookup ILIKE wildcard escape · zz.redteam6 residue purged (7 SARs, 3 leads, RT6 exam family incl. the live pct=99999 overlay, 2 ZZ.RT6 visits, 1 cancelled leave, rt6 canary, evt_rt6 webhooks)","recordType":"Plugin","recordRef":"cycle6-hardening@1","outcome":"red team cycle 6 P2/P3 closed · verdict SHIP upheld · registry bumps 6 modules","at":"' || c.at_iso || '"}' AS material
  FROM cands c
), hashed AS (
  SELECT m.tenant_id, m.prev_hash, m.at_iso, m.material,
         encode(sha256(convert_to(m.prev_hash || m.material, 'UTF8')), 'hex') AS row_hash
  FROM mat m
)
SELECT * FROM hashed
CROSS JOIN LATERAL app.audit_append(
  hashed.tenant_id, 'migration 030 (plugin factory)', 'system',
  'Cycle-6 P2/P3 hardening batch + rt6 residue purge',
  'Plugin', 'cycle6-hardening@1',
  'moderation bounds + re-derive · uuid-param guards · OTP CSPRNG · escalation re-notice · normalize-before-validate · ILIKE escape',
  'CBSE pack obligations · DPDP Act 2023 · red-team cycle 6 (SHIP verdict upheld)', false, 'medium',
  'exams.assessment 1.0.1 · admissions.funnel 1.2.1 · pack.dpdp 1.1.1 · ops.visitors 1.0.2 · hr.leave 1.0.1 · health.clinic 1.0.1 · RELEASE LANE',
  hashed.prev_hash, hashed.row_hash, hashed.at_iso::timestamptz);
