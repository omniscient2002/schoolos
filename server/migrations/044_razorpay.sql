-- 044 · payments.razorpay — Razorpay order rails (Wave A). Per-plugin factory
-- migration (docs/11 §2.2) following 015 (payments.upi) verbatim in shape:
--   · plugin_razorpay.order_log  — the rail's link to kernel app.payments facts
--     (UNIQUE (tenant_id, razorpay_order_id); the rail records FACTS, it never
--     settles money — kernel confirm stays the only settlement, Fees §4.2).
--   · plugin_razorpay.webhook_log — gateway replay dedupe, same idempotency
--     contract as plugin_upi.webhook_log: UNIQUE (tenant_id, event_id), a replay
--     is a 200 no-op with zero side effects.
--   · registry row (all tenants, 'registered' — lifecycle-gated until enabled) +
--     guarded hash-chained ledger entry (011/015 pattern). All statements
--     idempotent: replay no-ops on a provisioned database. The plugin's capability
--     contract ('payments.razorpay') is seeded platform-level by 045 — this file
--     stays data-plane + registry, per the Wave-A migration lane split.
-- Runtime module: server/src/plugins/payments.razorpay/ (mounted by the loader).

-- ── 1. Data plane ───────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS plugin_razorpay;
CREATE TABLE IF NOT EXISTS plugin_razorpay.order_log (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES app.tenants(id),
  payment_id         uuid NOT NULL REFERENCES app.payments(id),
  razorpay_order_id  text NOT NULL,
  razorpay_payment_id text,
  status             text NOT NULL DEFAULT 'created',
  payload            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, razorpay_order_id)
);
CREATE TABLE IF NOT EXISTS plugin_razorpay.webhook_log (
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

-- ── 2. Registry row (all tenants, 'registered'; guard makes replay a no-op) ─────
INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, manifest, permissions, entitlement, trust_level, event_budget, ai_budget)
SELECT t.id, v.plugin_id, v.version, v.class, 'registered', v.manifest, v.permissions, v.entitlement, 'T2', v.event_budget, v.ai_budget
FROM app.tenants t
CROSS JOIN (VALUES
  ('payments.razorpay', '1.0.0', 'B',
   '{"id":"payments.razorpay","name":"Razorpay Order Rails","version":"1.0.0","kernel":">=1.0.0 <2.0.0","class":"B","trust":"T2","description":"Razorpay order rails for fee collection: creates gateway orders against open fee obligations, records signed-webhook facts in order_log. Money-touching: never auto-moves money — orders and webhook facts only; settlement confirm is staff-only through the kernel action spine (fee.payment.settle, Fees §4.2).","permissions":["fees.read","events.emit","audit.request"],"money":{"moves_money":false,"invariant":"Never auto-moves money without kernel approval semantics: creates orders, records signed-webhook facts, and lets the kernel settle the ledger (staff confirm, Fees §4.2)."},"events":{"subscribe":[{"type":"fee.due","schema":">=1.0 <2"}],"publish":[{"type":"razorpay.order.created","schema":"v1"},{"type":"payment.captured","schema":"v1"},{"type":"payment.failed","schema":"v1"}]},"eventSubscriptions":["fee.due"],"slots":["settings"],"routes":[],"widgets":[],"settingsSchema":{"type":"object","properties":{"key_id":{"type":"string","description":"Razorpay key id (rzp_test_/rzp_live_…) — or RAZORPAY_KEY_ID env"},"key_secret":{"type":"string","description":"Razorpay key secret — or RAZORPAY_KEY_SECRET env; prefer settings over env per tenant"},"webhook_secret":{"type":"string","description":"Webhook HMAC secret (the RAZORPAY_WEBHOOK_SECRET env fallback covers boot-guard parity with payments.upi)"},"webhook_freshness_mins":{"type":"integer","minimum":1,"maximum":120,"default":15,"description":"reject webhook events older than this (stale-replay defense)"}},"required":[]},"data":{"schema":"plugin_razorpay","core_refs":["payments.id","fee_obligations.id"],"retention":{"on_uninstall":"export_then_purge_30d"},"residency":["IN"]},"regions":["IN"],"residency":"IN","billing":{"model":"rails","metered":["orders_created","webhooks_received"]},"dependencies":[],"defaultEnabled":false}'::jsonb,
   '["fees.read","events.emit","audit.request"]'::jsonb,
   '{"plan":"rails","billing":"usage-metered"}'::jsonb,
   jsonb_build_object('events_per_min',120,'payload_max_bytes',65536,'subscriber_max',25,'fanout_max',50,'chain_depth_max',5,'replay_max',10000,'scheduled_per_day',100),
   '{}'::jsonb)
) AS v(plugin_id, version, class, manifest, permissions, entitlement, event_budget, ai_budget)
WHERE NOT EXISTS (
  SELECT 1 FROM app.plugins p WHERE p.tenant_id = t.id AND p.plugin_id = v.plugin_id);

-- ── 3. Grants (010/018 parity: the app role serves the plugin's own doors) ──────
GRANT USAGE ON SCHEMA plugin_razorpay TO schoolos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA plugin_razorpay TO schoolos_app;

-- ── 4. Guarded registration audit entry (same hash chain as 011/015) ────────────
WITH cands AS (
  SELECT t.id AS tenant_id,
         COALESCE((SELECT a.hash FROM app.audit_log a
                    WHERE a.tenant_id = t.id
                    ORDER BY a.created_at DESC, a.id DESC LIMIT 1), 'GENESIS') AS prev_hash,
         to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at_iso
  FROM app.tenants t
  WHERE NOT EXISTS (
    SELECT 1 FROM app.audit_log x
    WHERE x.tenant_id = t.id AND x.record_type = 'Plugin' AND x.record_ref = 'payments.razorpay@1.0.0')
), mat AS (
  SELECT c.tenant_id, c.prev_hash, c.at_iso,
    '{"tenant":"' || c.tenant_id::text
    || '","actor":"migration 044 (plugin factory)","actorRole":"system","action":"Plugin unit registered: payments.razorpay (Wave A)","recordType":"Plugin","recordRef":"payments.razorpay@1.0.0","outcome":"Razorpay order rails provisioned · order_log + webhook dedupe live · settlement stays kernel-only (Fees §4.2) · module src/plugins/payments.razorpay mounted by loader","at":"' || c.at_iso || '"}' AS material
  FROM cands c
), hashed AS (
  SELECT m.tenant_id, m.prev_hash, m.at_iso, m.material,
         encode(sha256(convert_to(m.prev_hash || m.material, 'UTF8')), 'hex') AS row_hash
  FROM mat m
)
SELECT * FROM hashed
CROSS JOIN LATERAL app.audit_append(
  hashed.tenant_id, 'migration 044 (plugin factory)', 'system',
  'Plugin unit registered: payments.razorpay (Wave A)',
  'Plugin', 'payments.razorpay@1.0.0',
  'per-plugin migration: Razorpay order rails beneath the kernel fee ledger',
  'Platform §3.1 (plugin governance) · Fees §4.2', false, 'medium',
  'orders + signed-webhook facts live · settlement kernel-only · order_log + webhook dedupe provisioned',
  hashed.prev_hash, hashed.row_hash, hashed.at_iso::timestamptz);
