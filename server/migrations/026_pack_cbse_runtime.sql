-- 026: pack.cbse runtime (plugindev, wave-3 policy pair completion)
-- Registry manifest + capability contract cbse.assessment.validate were provisioned by
-- 009 (rules-not-code: the pack ADDS obligations, never relaxes kernel safeguards).
-- 026 ships the runtime: deterministic validation over exams.assessment data (weightage
-- totals, CBSE attendance norm, report integrity), kernel-obligation raise on weightage
-- violations (guard weightage_total <> 100, per-instance action code), and OASIS-ready
-- board export (affiliation + academic-year required, published exams only).
-- NO DATA PLANE by design ("no own writes"): the pack is stateless — validation runs and
-- exports are computed on demand and audited through the kernel audit ledger (audit
-- level: full for validation per the 009 contract; digest for exports, tally precedent).
-- The plugin_cbse schema therefore contains no tables; nothing to grant or RLS.

-- Guarded ledger entry (hash chain as 001/009-025) — once per tenant.
WITH cands AS (
  SELECT t.id AS tenant_id,
         COALESCE((SELECT a.hash FROM app.audit_log a
                    WHERE a.tenant_id = t.id
                    ORDER BY a.created_at DESC, a.id DESC LIMIT 1), 'GENESIS') AS prev_hash,
         to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at_iso
  FROM app.tenants t
  WHERE NOT EXISTS (
    SELECT 1 FROM app.audit_log x
    WHERE x.tenant_id = t.id AND x.record_type = 'Plugin' AND x.record_ref = 'pack.cbse@1.0.0-runtime')
), mat AS (
  SELECT c.tenant_id, c.prev_hash, c.at_iso,
    '{"tenant":"' || c.tenant_id::text
    || '","actor":"migration 026 (plugin factory)","actorRole":"system","action":"Plugin unit shipped: pack.cbse v1.0 (wave-3 policy pair)","recordType":"Plugin","recordRef":"pack.cbse@1.0.0-runtime","outcome":"deterministic validation primitives (R1 weightage_total · R2 grade_scale · R3 marks_bounds · R4 eligibility_floor≥75 · R5 report_integrity · R6 board_identity) · kernel obligation raise on weightage violations (action.raise, guard weightage_total<>100, per-exam code) · OASIS-ready export (published-only, affiliation+year required) · NO data plane (no own writes)","at":"' || c.at_iso || '"}' AS material
  FROM cands c
), hashed AS (
  SELECT m.tenant_id, m.prev_hash, m.at_iso, m.material,
         encode(sha256(convert_to(m.prev_hash || m.material, 'UTF8')), 'hex') AS row_hash
  FROM mat m
)
SELECT * FROM hashed
CROSS JOIN LATERAL app.audit_append(
  hashed.tenant_id, 'migration 026 (plugin factory)', 'system',
  'Plugin unit shipped: pack.cbse v1.0 (wave-3 policy pair)',
  'Plugin', 'pack.cbse@1.0.0-runtime',
  'validation · obligation raise · OASIS export · stateless (no own writes)',
  'CBSE pack obligations · Platform §3 (plugin governance) · docs/10 §plugin-architecture', false, 'medium',
  'contract cbse.assessment.validate from 009 unchanged',
  hashed.prev_hash, hashed.row_hash, hashed.at_iso::timestamptz);
