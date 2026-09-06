-- 013: accounting.tally — per-plugin migration (plugin factory, docs/11 §2.2)
-- Unit: wave-2 #1 · accounting.tally (Tally reconciliation rails, Class B, T1)
--
-- Independence contract: idempotent like 011 — (a) no-ops where 009 already
-- provisioned the catalog, (b) fully provisions accounting.tally on a bare
-- kernel. Registry row + capability contract copied VERBATIM from 009 (single
-- source of governance truth); the runtime module
-- (server/src/plugins/accounting.tally/) reads it on mount.
--
-- Data plane: accounting.tally owns NO tables. Day-book reads app.payments
-- (status='confirmed', kernel-owned); export history reads app.audit_log.
-- Plugin runtime mounts: GET /plugins/accounting.tally/daybook,
-- POST /plugins/accounting.tally/export, GET /plugins/accounting.tally/exports.
-- Policy: reads money, exports vouchers, NEVER posts (009 invariants
-- read_only_on_ledger; voucher_totals_match_ledger enforced by construction —
-- vouchers are rendered from the same GROUP BY that feeds the response totals).

-- ── 1. Registry row (verbatim manifest from 009; guard makes replay a no-op) ───
INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, manifest, permissions, entitlement, trust_level, event_budget, ai_budget)
SELECT t.id, v.plugin_id, v.version, v.class, 'registered', v.manifest, v.permissions, v.entitlement, 'T1', v.event_budget, v.ai_budget
FROM app.tenants t
CROSS JOIN (VALUES
  ('accounting.tally', '1.0.0', 'B',
   '{"id":"accounting.tally","name":"Tally Reconciliation","version":"1.0.0","kernel":">=1.0.0 <2.0.0","class":"B","trust":"T1","description":"Tally reconciliation rails: daily voucher export from the kernel fee ledger, ledger-mapping settings, Tally-importable output. Read-only on money — the ledger is kernel-owned; the plugin exports, it never posts.","permissions":["fees.read","events.emit","audit.request"],"events":{"subscribe":[{"type":"payment.captured","schema":">=1.0 <2"}],"publish":[{"type":"tally.export.completed","schema":"v1"}]},"eventSubscriptions":["payment.captured"],"slots":["settings"],"routes":[],"widgets":[],"settingsSchema":{"type":"object","properties":{"tally_url":{"type":"string","description":"Tally XML RPC endpoint on the accountant machine"},"company_name":{"type":"string","description":"Tally company vouchers post into"},"export_hour":{"type":"integer","minimum":0,"maximum":23,"default":20,"description":"Scheduled daily export hour (declared kernel scheduler job, capped)"},"ledger_mapping":{"type":"object","description":"Fee head to Tally ledger name map (kernel fee heads, read-only)"}},"required":["tally_url","company_name"]},"data":{"schema":"plugin_tally","core_refs":["fee_obligations.id"],"retention":{"on_uninstall":"export_then_purge_30d"},"residency":["IN"]},"regions":["IN"],"residency":"IN","billing":{"model":"rails","metered":["vouchers_exported"]},"dependencies":[],"defaultEnabled":false}'::jsonb,
   '["fees.read","events.emit","audit.request"]'::jsonb,
   '{"plan":"rails","billing":"usage-metered"}'::jsonb,
   jsonb_build_object('events_per_min',60,'payload_max_bytes',65536,'subscriber_max',25,'fanout_max',50,'chain_depth_max',5,'replay_max',10000,'scheduled_per_day',100),
   '{}'::jsonb)
) AS v(plugin_id, version, class, manifest, permissions, entitlement, event_budget, ai_budget)
WHERE NOT EXISTS (
  SELECT 1 FROM app.plugins p WHERE p.tenant_id = t.id AND p.plugin_id = v.plugin_id);

-- ── 2. Capability contract: tally.voucher.export (verbatim from 009, guarded) ──
INSERT INTO app.capability_contracts (tenant_id, plugin_id, capability_id, version, kind, contract, enforced)
SELECT NULL, v.plugin_id, v.capability_id, v.version, v.kind, v.contract, v.enforced
FROM (VALUES
  ('accounting.tally', 'tally.voucher.export', '1.0.0', 'command',
   '{"description":"Daily voucher export from the kernel fee ledger into Tally-ready output; ledger mapping is tenant settings. The plugin reads money and exports — it never posts to the ledger.","read_scopes":["money.read:obligations"],"write_scopes":["plugin_tally.exports"],"event_inputs":["payment.captured@>=1.0"],"event_outputs":["tally.export.completed.v1"],"side_effects":[{"type":"artifact.put","approval":"never","policy_ref":"Platform §5.2"}],"policy_refs":["Platform §5.2","Fees §4.2"],"audit":{"level":"digest","includes":["window","voucher_count","content_hash"]},"data_classification":["financial"],"latency_sla":{"p95_ms":5000,"timeout_ms":30000},"compat":{"kernel":">=1.0 <2.0"},"regions":["IN"],"residency":"IN"}'::jsonb,
   '{"audit":"digest","invariants":["read_only_on_ledger","scheduled_job_declared","voucher_totals_match_ledger"]}'::jsonb)
) AS v(plugin_id, capability_id, version, kind, contract, enforced)
WHERE NOT EXISTS (
  SELECT 1 FROM app.capability_contracts x
  WHERE x.tenant_id IS NULL AND x.capability_id = v.capability_id AND x.version = v.version);

-- ── 3. Guarded registration audit entry (same hash chain as 001/009/010/011) ───
WITH cands AS (
  SELECT t.id AS tenant_id,
         COALESCE((SELECT a.hash FROM app.audit_log a
                    WHERE a.tenant_id = t.id
                    ORDER BY a.created_at DESC, a.id DESC LIMIT 1), 'GENESIS') AS prev_hash,
         to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at_iso
  FROM app.tenants t
  WHERE NOT EXISTS (
    SELECT 1 FROM app.audit_log x
    WHERE x.tenant_id = t.id AND x.record_type = 'Plugin' AND x.record_ref = 'accounting.tally@1.0.0')
), mat AS (
  SELECT c.tenant_id, c.prev_hash, c.at_iso,
    '{"tenant":"' || c.tenant_id::text
    || '","actor":"migration 013 (plugin factory)","actorRole":"system","action":"Plugin unit registered: accounting.tally (wave-2 #1)","recordType":"Plugin","recordRef":"accounting.tally@1.0.0","outcome":"read-only day-book voucher export live · reads money, never posts · plugin module src/plugins/accounting.tally mounted by loader","at":"' || c.at_iso || '"}' AS material
  FROM cands c
), hashed AS (
  SELECT m.tenant_id, m.prev_hash, m.at_iso, m.material,
         encode(sha256(convert_to(m.prev_hash || m.material, 'UTF8')), 'hex') AS row_hash
  FROM mat m
)
SELECT * FROM hashed
CROSS JOIN LATERAL app.audit_append(
  hashed.tenant_id, 'migration 013 (plugin factory)', 'system',
  'Plugin unit registered: accounting.tally (wave-2 #1)',
  'Plugin', 'accounting.tally@1.0.0',
  'per-plugin migration: read-only day-book voucher export under the kernel ledger',
  'Platform §5.2 (artifacts) · Fees §4.2', false, 'low',
  'reads money, exports vouchers, never posts · module src/plugins/accounting.tally mounted by loader',
  hashed.prev_hash, hashed.row_hash, hashed.at_iso::timestamptz);
