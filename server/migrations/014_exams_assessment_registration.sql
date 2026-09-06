-- 014: exams.assessment — early catalog registration (plugin factory, docs/11 §2.2)
-- Decision (orchestrator ask): the frontend registry carries an 'exams' core card
-- that defers to "exams.assessment registers in wave 3". Registering the metadata
-- NOW keeps the server/frontend mirror honest (UI agent's explicit ask) and is
-- harmless: the row lands status='registered' (not enabled), mounts NO doors (the
-- runtime module is the wave-3 build unit), and touches no money/PII flows.
-- One-migration-per-plugin preserved: this is exams.assessment's ONLY registration
-- migration; the wave-3 build unit adds the module + tests, no new registration.
--
-- Idempotent like 011/013: no-ops where applied; provisions fully on a bare kernel.

-- ── 1. Registry row (authored here first; 009 never provisioned this plugin) ───
INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, manifest, permissions, entitlement, trust_level, event_budget, ai_budget)
SELECT t.id, v.plugin_id, v.version, v.class, 'registered', v.manifest, v.permissions, v.entitlement, 'T1', v.event_budget, v.ai_budget
FROM app.tenants t
CROSS JOIN (VALUES
  ('exams.assessment', '1.0.0', 'D',
   '{"id":"exams.assessment","name":"Assessment & Report Cards","version":"1.0.0","kernel":">=1.0.0 <2.0.0","class":"D","trust":"T1","description":"Examination primitives: marks entry, moderation, deterministic report-card assembly, exam publication with approval before any guardian-visible surface. Marks are sensitive academic records — all writes audited, publication approval-required, weightage totals enforced (consumes the CBSE pack validation rules).","permissions":["students.read","attendance.read","events.emit","audit.request"],"events":{"subscribe":[{"type":"attendance.marked","schema":">=1.0 <2"}],"publish":[{"type":"exam.published","schema":"v1"},{"type":"exam.marks.updated","schema":"v1"}]},"ai":{"request":["draft.exam_summary"],"modes":["transformation"],"grounding":"required","note":"drafts only; publication rides the action spine with approval"},"slots":["settings","reports"],"routes":[],"widgets":[],"settingsSchema":{"type":"object","properties":{"grade_scale":{"type":"string","enum":["cbse_10_point","percent","gpa_4"],"default":"cbse_10_point"},"weightage_lock_days":{"type":"integer","minimum":1,"maximum":30,"default":7,"description":"Days before exam publication when weightage edits freeze"},"report_card_template":{"type":"string"}}},"data":{"schema":"plugin_exams","core_refs":["students.id"],"retention":{"on_uninstall":"export_then_purge_30d"},"residency":["IN"]},"regions":["IN"],"residency":"IN","billing":{"model":"pack","pack":"academics"},"dependencies":[],"policy_refs":["CBSE pack obligations","Platform §3 (plugin governance)"],"defaultEnabled":false,"lifecycle":{"deactivate":"pending publications flushed; marks frozen read-only","health":"marks-integrity probe"}}'::jsonb,
   '["students.read","attendance.read","events.emit","audit.request"]'::jsonb,
   '{"plan":"pack","billing":"seat-based"}'::jsonb,
   jsonb_build_object('events_per_min',60,'payload_max_bytes',65536,'subscriber_max',25,'fanout_max',50,'chain_depth_max',5,'replay_max',10000,'scheduled_per_day',1000),
   '{"calls_per_day":1000,"tokens_per_day":200000,"tools_per_day":100}'::jsonb)
) AS v(plugin_id, version, class, manifest, permissions, entitlement, event_budget, ai_budget)
WHERE NOT EXISTS (
  SELECT 1 FROM app.plugins p WHERE p.tenant_id = t.id AND p.plugin_id = v.plugin_id);

-- ── 2. Capability contract: exams.publish (deterministic, approval-gated) ──────
INSERT INTO app.capability_contracts (tenant_id, plugin_id, capability_id, version, kind, contract, enforced)
SELECT NULL, v.plugin_id, v.capability_id, v.version, v.kind, v.contract, v.enforced
FROM (VALUES
  ('exams.assessment', 'exams.publish', '1.0.0', 'command',
   '{"description":"Deterministic exam publication: assembles report cards from marks + weightage (validated by the CBSE pack rules), freezes the snapshot, and raises an approval-required action before anything is guardian-visible. No cross-tenant reads; marks edits audited per write.","read_scopes":["graph.read:students","attendance.read:section","plugin_cbse.calendar"],"write_scopes":["plugin_exams.marks"],"event_inputs":["attendance.marked@>=1.0"],"event_outputs":["exam.published.v1","exam.marks.updated.v1"],"side_effects":[{"type":"action.raise","approval":"required","policy_ref":"Assessment publication"},{"type":"ledger.audit","approval":"never","policy_ref":"Platform §2.4"}],"policy_refs":["CBSE pack obligations","Platform §3 (plugin governance)"],"audit":{"level":"full","includes":["rule","inputs_digest","decision","actor","approval"]},"data_classification":["pii:student_records"],"compat":{"kernel":">=1.0 <2.0"},"regions":["IN"],"residency":"IN"}'::jsonb,
   '{"audit":"full","invariants":["deterministic_only","weightage_total_enforced","approval_before_publish","no_cross_tenant_marks"]}'::jsonb)
) AS v(plugin_id, capability_id, version, kind, contract, enforced)
WHERE NOT EXISTS (
  SELECT 1 FROM app.capability_contracts x
  WHERE x.tenant_id IS NULL AND x.capability_id = v.capability_id AND x.version = v.version);

-- ── 3. Guarded registration audit entry (same hash chain as 001/009/010-013) ───
WITH cands AS (
  SELECT t.id AS tenant_id,
         COALESCE((SELECT a.hash FROM app.audit_log a
                    WHERE a.tenant_id = t.id
                    ORDER BY a.created_at DESC, a.id DESC LIMIT 1), 'GENESIS') AS prev_hash,
         to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at_iso
  FROM app.tenants t
  WHERE NOT EXISTS (
    SELECT 1 FROM app.audit_log x
    WHERE x.tenant_id = t.id AND x.record_type = 'Plugin' AND x.record_ref = 'exams.assessment@1.0.0')
), mat AS (
  SELECT c.tenant_id, c.prev_hash, c.at_iso,
    '{"tenant":"' || c.tenant_id::text
    || '","actor":"migration 014 (plugin factory)","actorRole":"system","action":"Plugin registered: exams.assessment (wave-3 #1 early registration)","recordType":"Plugin","recordRef":"exams.assessment@1.0.0","outcome":"metadata-only registration (registered, not enabled) · frontend mirror honesty per orchestrator decision · runtime module + doors land in the wave-3 build unit","at":"' || c.at_iso || '"}' AS material
  FROM cands c
), hashed AS (
  SELECT m.tenant_id, m.prev_hash, m.at_iso, m.material,
         encode(sha256(convert_to(m.prev_hash || m.material, 'UTF8')), 'hex') AS row_hash
  FROM mat m
)
SELECT * FROM hashed
CROSS JOIN LATERAL app.audit_append(
  hashed.tenant_id, 'migration 014 (plugin factory)', 'system',
  'Plugin registered: exams.assessment (wave-3 #1 early registration)',
  'Plugin', 'exams.assessment@1.0.0',
  'metadata-only early registration: frontend registry mirror honesty; runtime is wave-3',
  'Platform §3.1 (plugin governance)', false, 'low',
  'registered, not enabled · mounts no doors · wave-3 build unit adds module + tests',
  hashed.prev_hash, hashed.row_hash, hashed.at_iso::timestamptz);
