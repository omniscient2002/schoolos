-- 011: comms.whatsapp — per-plugin migration (plugin factory, docs/11 §2.2)
-- Unit: wave-1 #1 · comms.whatsapp (WhatsApp BSP rail, Class B)
--
-- Independence contract: every statement is idempotent (conflict + NOT EXISTS
-- guards), so this file (a) no-ops on databases where 009 already provisioned
-- the catalog, and (b) fully provisions comms.whatsapp on a bare kernel.
-- The manifest/contract bodies are copied verbatim from 009 — the registry row
-- stays the single source of governance truth; the runtime module
-- (server/src/plugins/comms.whatsapp/) reads it on mount.
--
-- Data plane: comms.whatsapp owns NO tables. DLT templates live in
-- app.plugins.settings->'templates' (009 settings schema; P1-2 redaction note:
-- that column is owner/itadmin-read only via GET /plugins); delivery receipts
-- ride the kernel table app.communications (channel='whatsapp', 001 §comms).
-- Plugin runtime mounts: GET/POST /plugins/comms.whatsapp/templates, GET receipts.

-- ── 1. Registry row (verbatim manifest from 009; guard makes replay a no-op) ───
INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, manifest, permissions, entitlement, trust_level, event_budget, ai_budget)
SELECT t.id, v.plugin_id, v.version, v.class, 'registered', v.manifest, v.permissions, v.entitlement, 'T1', v.event_budget, v.ai_budget
FROM app.tenants t
CROSS JOIN (VALUES
  ('comms.whatsapp', '1.0.0', 'B',
   '{"id":"comms.whatsapp","name":"WhatsApp Business Rails","version":"1.0.0","kernel":">=1.0.0 <2.0.0","class":"B","trust":"T1","description":"WhatsApp Business rails (BSP adapter) beneath the kernel Communication Orchestrator: digest delivery with UPI pay buttons, guardian notifications, template management, DLT compliance. Headless by rule (docs/11 §2.3) — delivers approved orchestrator intents only, never sends directly.","permissions":["students.read","attendance.read","fees.read","comms.send","events.emit","audit.request"],"events":{"subscribe":[{"type":"attendance.marked","schema":">=1.0 <2"},{"type":"fee.due","schema":">=1.0 <2"},{"type":"transport.delay","schema":">=1.0 <2"}],"publish":[{"type":"whatsapp.receipt","schema":"v1"}]},"eventSubscriptions":["attendance.marked","fee.due","transport.delay"],"ai":{"request":["draft.parent_message","summarize.day"],"modes":["transformation"],"grounding":"required","note":"capabilities, never models — deterministic guard precedes any draft (docs/11 §7)"},"slots":["settings"],"routes":[],"widgets":[],"settingsSchema":{"type":"object","properties":{"bsp_provider":{"type":"string","enum":["gupshup","meta_cloud_api","aisensy","interakt"],"default":"gupshup","description":"WhatsApp Business Solution Provider"},"sender_id":{"type":"string","description":"WABA sender / phone-number id provisioned per tenant"},"dlt_entity_id":{"type":"string","description":"DLT registered entity id (TRAI compliance)"},"dlt_template_ids":{"type":"object","description":"Registered template id per kernel template (fee_digest, absence_notice, delay_notice)"},"pay_button_template":{"type":"string","description":"Template carrying the UPI pay button on fee digests"},"quiet_hours":{"type":"object","description":"Local quiet hours — the orchestrator also enforces its own"}},"required":["bsp_provider","sender_id"]},"data":{"schema":"plugin_whatsapp","core_refs":["students.id"],"retention":{"on_uninstall":"export_then_purge_30d"},"residency":["IN"]},"regions":["IN"],"residency":"IN","billing":{"model":"rails","metered":["messages_delivered"]},"dependencies":[],"defaultEnabled":false,"lifecycle":{"deactivate":"pending receipts flushed; intents handed back to the orchestrator","health":"template + DLT status probe"}}'::jsonb,
   '["students.read","attendance.read","fees.read","comms.send","events.emit","audit.request"]'::jsonb,
   '{"plan":"rails","billing":"usage-metered"}'::jsonb,
   jsonb_build_object('events_per_min',60,'payload_max_bytes',65536,'subscriber_max',25,'fanout_max',50,'chain_depth_max',5,'replay_max',10000,'scheduled_per_day',1000),
   '{"calls_per_day":2000,"tokens_per_day":400000,"tools_per_day":200}'::jsonb)
) AS v(plugin_id, version, class, manifest, permissions, entitlement, event_budget, ai_budget)
WHERE NOT EXISTS (
  SELECT 1 FROM app.plugins p WHERE p.tenant_id = t.id AND p.plugin_id = v.plugin_id);

-- ── 2. Capability contract: whatsapp.deliver (verbatim from 009, guarded) ──────
INSERT INTO app.capability_contracts (tenant_id, plugin_id, capability_id, version, kind, contract, enforced)
SELECT NULL, v.plugin_id, v.capability_id, v.version, v.kind, v.contract, v.enforced
FROM (VALUES
  ('comms.whatsapp', 'whatsapp.deliver', '1.0.0', 'command',
   '{"description":"WhatsApp Business template delivery beneath the kernel Communication Orchestrator: accepts approved intents only (consent-gated per recipient, quiet hours, dedup), renders DLT-registered templates, emits delivery receipts. Headless rail — never sends directly.","read_scopes":["comms.read:templates","graph.read:students"],"write_scopes":["plugin_whatsapp.messages"],"event_inputs":["attendance.marked@>=1.0","fee.due@>=1.0","transport.delay@>=1.0"],"event_outputs":["whatsapp.receipt.v1"],"side_effects":[{"type":"comms.send","channel":"whatsapp.template","consent":"verified","policy_ref":"Comms §1.2"},{"type":"ledger.audit","approval":"never","policy_ref":"Platform §2.4"}],"policy_refs":["Comms §1.2"],"audit":{"level":"full","includes":["template","audience_digest","actor","approval","receipt"]},"data_classification":["pii:guardian_contact"],"latency_sla":{"p95_ms":2000,"timeout_ms":8000},"compat":{"kernel":">=1.0 <2.0"},"regions":["IN"],"residency":"IN"}'::jsonb,
   '{"audit":"full","invariants":["orchestrator_intent_required","consent_verified_per_recipient","quiet_hours_respected","dlt_template_registered","receipt_emitted"]}'::jsonb)
) AS v(plugin_id, capability_id, version, kind, contract, enforced)
WHERE NOT EXISTS (
  SELECT 1 FROM app.capability_contracts x
  WHERE x.tenant_id IS NULL AND x.capability_id = v.capability_id AND x.version = v.version);

-- ── 3. Guarded registration audit entry (same hash chain as 001/009/010) ───────
WITH cands AS (
  SELECT t.id AS tenant_id,
         COALESCE((SELECT a.hash FROM app.audit_log a
                    WHERE a.tenant_id = t.id
                    ORDER BY a.created_at DESC, a.id DESC LIMIT 1), 'GENESIS') AS prev_hash,
         to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at_iso
  FROM app.tenants t
  WHERE NOT EXISTS (
    SELECT 1 FROM app.audit_log x
    WHERE x.tenant_id = t.id AND x.record_type = 'Plugin' AND x.record_ref = 'comms.whatsapp@1.0.0')
), mat AS (
  SELECT c.tenant_id, c.prev_hash, c.at_iso,
    '{"tenant":"' || c.tenant_id::text
    || '","actor":"migration 011 (plugin factory)","actorRole":"system","action":"Plugin unit registered: comms.whatsapp (wave-1 #1)","recordType":"Plugin","recordRef":"comms.whatsapp@1.0.0","outcome":"DLT template registry + receipt surface live · sends ride the orchestrator only · plugin module src/plugins/comms.whatsapp mounted by loader","at":"' || c.at_iso || '"}' AS material
  FROM cands c
), hashed AS (
  SELECT m.tenant_id, m.prev_hash, m.at_iso, m.material,
         encode(sha256(convert_to(m.prev_hash || m.material, 'UTF8')), 'hex') AS row_hash
  FROM mat m
)
SELECT * FROM hashed
CROSS JOIN LATERAL app.audit_append(
  hashed.tenant_id, 'migration 011 (plugin factory)', 'system',
  'Plugin unit registered: comms.whatsapp (wave-1 #1)',
  'Plugin', 'comms.whatsapp@1.0.0',
  'per-plugin migration: DLT template registry + receipt surface; headless rail under the Communication Orchestrator',
  'Platform §3.1 (plugin governance)', false, 'low',
  'DLT template registry + receipt surface live · sends ride the orchestrator only · plugin module src/plugins/comms.whatsapp mounted by loader',
  hashed.prev_hash, hashed.row_hash, hashed.at_iso::timestamptz);
