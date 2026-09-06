-- 015: payments.upi — per-plugin migration (plugin factory, docs/11 §2.2)
-- Unit: wave-1 #2 · payments.upi (UPI collection rails, Class B, T1)
--
-- Independence contract: idempotent like 011/013 — (a) no-ops on databases
-- where 009/010 already provisioned the artifacts, (b) fully provisions
-- payments.upi on a bare kernel. Registry row + capability contract copied
-- VERBATIM from 009 (extracted programmatically); the webhook_log DDL is
-- copied verbatim from 010 §5 (CREATE SCHEMA/TABLE IF NOT EXISTS).
-- Runtime module: server/src/plugins/payments.upi/ (mounted by the loader).
--
-- Data plane: plugin_upi.webhook_log — idempotency key UNIQUE (tenant_id,
-- event_id) so gateway replays are no-ops. Settlement stays kernel-only
-- (Fees §4.2): this rail creates links and records FACTS, it never moves money.

-- ── 1. Webhook idempotency table (verbatim DDL from 010 §5) ────────────────────
CREATE SCHEMA IF NOT EXISTS plugin_upi;
CREATE TABLE IF NOT EXISTS plugin_upi.webhook_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  gateway     text NOT NULL DEFAULT 'razorpay',
  event_id    text NOT NULL,
  event_type  text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  signature_verified boolean NOT NULL DEFAULT true,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, event_id)
);

-- ── 2. Registry row (verbatim manifest from 009; guard makes replay a no-op) ───
INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, manifest, permissions, entitlement, trust_level, event_budget, ai_budget)
SELECT t.id, v.plugin_id, v.version, v.class, 'registered', v.manifest, v.permissions, v.entitlement, 'T1', v.event_budget, v.ai_budget
FROM app.tenants t
CROSS JOIN (VALUES
  ('payments.upi', '1.0.0', 'B',
   '{"id":"payments.upi","name":"UPI Payment Rails","version":"1.0.0","kernel":">=1.0.0 <2.0.0","class":"B","trust":"T1","description":"UPI collection rails via a Razorpay-style gateway: payment links on fee obligations, signed webhook capture, reconciliation against the kernel fee ledger, Tally-ready export. Money-touching: never auto-moves money — links and webhook facts only; settlement confirm is staff-only through the kernel action spine (fee.payment.settle, Fees §4.2).","permissions":["fees.read","events.emit","actions.raise","audit.request"],"money":{"moves_money":false,"invariant":"Never auto-moves money without kernel approval semantics: creates links, records signed-webhook facts, and lets the kernel settle the ledger (staff confirm, Fees §4.2)."},"events":{"subscribe":[{"type":"fee.due","schema":">=1.0 <2"}],"publish":[{"type":"payment.link.created","schema":"v1"},{"type":"payment.captured","schema":"v1"},{"type":"payment.failed","schema":"v1"}]},"eventSubscriptions":["fee.due"],"slots":["settings"],"routes":[],"widgets":[],"settingsSchema":{"type":"object","properties":{"gateway":{"type":"string","enum":["razorpay","cashfree","phonepe"],"default":"razorpay"},"key_id":{"type":"string","description":"Gateway key id placeholder (rzp_live_REPLACE_ME) — provision per tenant"},"key_secret_ref":{"type":"string","description":"Vault reference for the gateway secret — the secret itself never lives in settings"},"webhook_secret_ref":{"type":"string","description":"Vault reference for webhook HMAC verification"},"reconciliation_window_mins":{"type":"integer","default":30,"description":"Max drift between gateway capture and ledger post before a reconciliation case is raised"}},"required":["gateway","key_id"]},"data":{"schema":"plugin_upi","core_refs":["fee_obligations.id"],"retention":{"on_uninstall":"export_then_purge_30d"},"residency":["IN"]},"regions":["IN"],"residency":"IN","billing":{"model":"rails","metered":["transactions_captured"]},"dependencies":[],"defaultEnabled":false}'::jsonb,
   '["fees.read","events.emit","actions.raise","audit.request"]'::jsonb,
   '{"plan":"rails","billing":"usage-metered"}'::jsonb,
   jsonb_build_object('events_per_min',120,'payload_max_bytes',65536,'subscriber_max',25,'fanout_max',50,'chain_depth_max',5,'replay_max',10000,'scheduled_per_day',100),
   '{}'::jsonb)
) AS v(plugin_id, version, class, manifest, permissions, entitlement, event_budget, ai_budget)
WHERE NOT EXISTS (
  SELECT 1 FROM app.plugins p WHERE p.tenant_id = t.id AND p.plugin_id = v.plugin_id);

-- ── 3. Capability contract: upi.payment.collect (verbatim from 009, guarded) ───
INSERT INTO app.capability_contracts (tenant_id, plugin_id, capability_id, version, kind, contract, enforced)
SELECT NULL, v.plugin_id, v.capability_id, v.version, v.kind, v.contract, v.enforced
FROM (VALUES
  ('payments.upi', 'upi.payment.collect', '1.0.0', 'command',
   '{"description":"UPI collection rails via a Razorpay-style gateway: create payment links on fee obligations, verify signed webhooks, reconcile against the kernel fee ledger, Tally-ready export. Creates links and records facts; settlement confirm is staff-only through the kernel action spine.","read_scopes":["money.read:obligations"],"write_scopes":["plugin_upi.links","plugin_upi.webhooks"],"event_inputs":["fee.due@>=1.0"],"event_outputs":["payment.link.created.v1","payment.captured.v1","payment.failed.v1"],"side_effects":[{"type":"payment.link.create","approval":"never","policy_ref":"Fees §4.2"},{"type":"ledger.post","approval":"required","policy_ref":"Fees §4.2","note":"settle only via kernel fee.payment.settle (staff confirm)"}],"policy_refs":["Fees §4.2"],"audit":{"level":"full","includes":["actor","obligation","gateway_ref","webhook_verified"]},"data_classification":["financial","pii:guardian_contact"],"idempotency":{"key":"webhook.id","window":"24h"},"compat":{"kernel":">=1.0 <2.0"},"regions":["IN"],"residency":"IN"}'::jsonb,
   '{"audit":"full","invariants":["never_auto_moves_money","settle_kernel_only","webhook_signature_required","gateway_ref_honesty","paid_cents<=amount_cents"]}'::jsonb)
) AS v(plugin_id, capability_id, version, kind, contract, enforced)
WHERE NOT EXISTS (
  SELECT 1 FROM app.capability_contracts x
  WHERE x.tenant_id IS NULL AND x.capability_id = v.capability_id AND x.version = v.version);

-- ── 4. Guarded registration audit entry (same hash chain as 001/009-014) ───────
WITH cands AS (
  SELECT t.id AS tenant_id,
         COALESCE((SELECT a.hash FROM app.audit_log a
                    WHERE a.tenant_id = t.id
                    ORDER BY a.created_at DESC, a.id DESC LIMIT 1), 'GENESIS') AS prev_hash,
         to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at_iso
  FROM app.tenants t
  WHERE NOT EXISTS (
    SELECT 1 FROM app.audit_log x
    WHERE x.tenant_id = t.id AND x.record_type = 'Plugin' AND x.record_ref = 'payments.upi@1.0.0')
), mat AS (
  SELECT c.tenant_id, c.prev_hash, c.at_iso,
    '{"tenant":"' || c.tenant_id::text
    || '","actor":"migration 015 (plugin factory)","actorRole":"system","action":"Plugin unit registered: payments.upi (wave-1 #2)","recordType":"Plugin","recordRef":"payments.upi@1.0.0","outcome":"UPI links + signed-webhook facts live · settlement stays kernel-only (Fees §4.2) · webhook_log idempotency provisioned · module src/plugins/payments.upi mounted by loader","at":"' || c.at_iso || '"}' AS material
  FROM cands c
), hashed AS (
  SELECT m.tenant_id, m.prev_hash, m.at_iso, m.material,
         encode(sha256(convert_to(m.prev_hash || m.material, 'UTF8')), 'hex') AS row_hash
  FROM mat m
)
SELECT * FROM hashed
CROSS JOIN LATERAL app.audit_append(
  hashed.tenant_id, 'migration 015 (plugin factory)', 'system',
  'Plugin unit registered: payments.upi (wave-1 #2)',
  'Plugin', 'payments.upi@1.0.0',
  'per-plugin migration: UPI collection rails beneath the kernel fee ledger',
  'Platform §3.1 (plugin governance) · Fees §4.2', false, 'medium',
  'links + webhook facts live · settlement kernel-only · webhook_log idempotency provisioned',
  hashed.prev_hash, hashed.row_hash, hashed.at_iso::timestamptz);
