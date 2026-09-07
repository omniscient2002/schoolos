-- 028: UI-lane batch (plugindev, riding with pack.cbse + cycle-5 remediation per dispatch)
-- Contents:
--   §1  registry bump ops.visitors 1.0.0 → 1.0.1 (verify-door status codes 401→409/422
--       for OTP-state failures — 401 stays auth-only, per the global session-expiry
--       convention; + guardian-lookup door for the desk pickup roster)
--   §2  guarded ledger entry ui-lane@1
-- Seed-only items (no migration surface): guardians for ALL students (was 15 of 25
-- 8-B); F1 decision recorded in the handoff — reseed-before-RC is the audit-accumulation
-- answer; no visitors delete door (append-only trails stay append-only).

-- ── §1 · registry bump ───────────────────────────────────────────────────────────
UPDATE app.plugins SET version='1.0.1', manifest = jsonb_set(manifest, '{version}', '"1.0.1"')
 WHERE plugin_id='ops.visitors';

-- ── §1.5 · guardian backfill (converges existing DBs with the extended seed) ─────
-- One primary guardian for EVERY student; students already covered (incl. the pinned
-- drill phones …0176/…0177) are skipped — deterministic phones over the missing set.
INSERT INTO app.guardians (tenant_id, student_id, name, phone, relation, is_primary)
SELECT s.tenant_id, s.id, 'Guardian of ' || s.name,
       '+91 97' || lpad(((20000000 + row_number() OVER (ORDER BY s.id)) % 100000000)::text, 8, '0'),
       'mother', true
FROM app.students s
WHERE NOT EXISTS (SELECT 1 FROM app.guardians g WHERE g.student_id = s.id AND g.is_primary);

-- ── §2 · guarded ledger entry ────────────────────────────────────────────────────
WITH cands AS (
  SELECT t.id AS tenant_id,
         COALESCE((SELECT a.hash FROM app.audit_log a
                    WHERE a.tenant_id = t.id
                    ORDER BY a.created_at DESC, a.id DESC LIMIT 1), 'GENESIS') AS prev_hash,
         to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at_iso
  FROM app.tenants t
  WHERE NOT EXISTS (
    SELECT 1 FROM app.audit_log x
    WHERE x.tenant_id = t.id AND x.record_type = 'Plugin' AND x.record_ref = 'ui-lane@1')
), mat AS (
  SELECT c.tenant_id, c.prev_hash, c.at_iso,
    '{"tenant":"' || c.tenant_id::text
    || '","actor":"migration 028 (plugin factory)","actorRole":"system","action":"UI-lane batch: ops.visitors verify-door OTP-state failures 401→409/422 (401 stays auth-only — session-expiry convention) · guardian-lookup door for the desk pickup roster (app.guardians is the source of truth; dataset ids are fixture keys) · seed: primary guardians for ALL students · F1 decision: reseed-before-RC, no delete door","recordType":"Plugin","recordRef":"ui-lane@1","outcome":"ops.visitors 1.0.1 · pickup flow demo-complete · UI wrapper removal unblocked","at":"' || c.at_iso || '"}' AS material
  FROM cands c
), hashed AS (
  SELECT m.tenant_id, m.prev_hash, m.at_iso, m.material,
         encode(sha256(convert_to(m.prev_hash || m.material, 'UTF8')), 'hex') AS row_hash
  FROM mat m
)
SELECT * FROM hashed
CROSS JOIN LATERAL app.audit_append(
  hashed.tenant_id, 'migration 028 (plugin factory)', 'system',
  'UI-lane batch (verify-door codes · guardian lookup · seed coverage · F1 decision)',
  'Plugin', 'ui-lane@1',
  'OTP-state 409/422 · guardian-lookup door · seed guardians for all · reseed-as-answer',
  'Platform §2.4 · UI integration notes 2026-09-07', false, 'low',
  'ops.visitors 1.0.1 · UI to remove the 401-swallowing wrapper after this ships',
  hashed.prev_hash, hashed.row_hash, hashed.at_iso::timestamptz);
