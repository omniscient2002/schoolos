-- 024: ops.visitors — gate pass + guardian-verified pickup (plugindev unit)
-- Class C plugin registered here (no prior contract exists — 018-admissions precedent:
-- the plugin factory authors its own row + contract via the migration).
-- Safety posture (invariants):
--   · pickup_requires_guardian_otp — student pickup raises a 6-digit OTP to the
--     student's PRIMARY guardian phone; the pass cannot reach 'verified' without it.
--   · no_release_without_verification — completing a pickup visit is refused unless
--     guardian-verified (fail-closed; audited override by owner/principal only).
--   · otp_vault_kernel_pattern — OTP secrets ride the 008 kernel pattern: hashed
--     (scrypt+salt), short TTL, attempt-bounded, consumed-on-success, stored in
--     plugin_visitors.pickup_otp under RLS that denies the app role entirely
--     (USING (false)) — only the kernel/owner connection may read or write secrets.
--   · uniform lifecycle gate on every door (P2-1 closure posture).
-- Idempotent like 011/013/015/018-023.

CREATE SCHEMA IF NOT EXISTS plugin_visitors;
GRANT USAGE ON SCHEMA plugin_visitors TO schoolos_app;

-- visitor passes (non-secret; normal app-role DML)
CREATE TABLE IF NOT EXISTS plugin_visitors.visit (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id),
  visitor_name  text NOT NULL,
  visitor_phone text,
  purpose       text NOT NULL,                    -- pickup · meeting · vendor · delivery · other
  detail        text,
  student_ref   uuid,                             -- app.students.id (pickup flow; no hard FK — plugin isolation)
  status        text NOT NULL DEFAULT 'expected'
                CHECK (status IN ('expected','checked_in','pickup_pending','verified','completed','denied','cancelled')),
  badge_code    text NOT NULL,                    -- front-desk badge reference
  verified_at   timestamptz,                      -- guardian OTP verified (pickup flow)
  otp_request_id uuid,                            -- app.auth_otps row id (vault reference)
  otp_attempts  int NOT NULL DEFAULT 0,           -- failed pickup-code attempts on this visit
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS visit_badge_idx ON plugin_visitors.visit (tenant_id, badge_code);
CREATE INDEX IF NOT EXISTS visit_status_idx ON plugin_visitors.visit (tenant_id, status, created_at DESC);
GRANT SELECT, INSERT, UPDATE ON plugin_visitors.visit TO schoolos_app;

-- OTP vault — kernel pattern (008 §app.auth_otps): the app role is denied entirely;
-- reads/writes happen ONLY via the kernel/owner connection path (module uses kernel.q).
CREATE TABLE IF NOT EXISTS plugin_visitors.pickup_otp (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  visit_id    uuid NOT NULL REFERENCES plugin_visitors.visit(id),
  phone       text NOT NULL,                      -- guardian phone (primary contact)
  code_hash   text NOT NULL,                      -- salt:scrypt(code, salt, 64)
  attempts    int NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pickup_otp_visit_idx ON plugin_visitors.pickup_otp (visit_id, created_at DESC);
ALTER TABLE plugin_visitors.pickup_otp ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pickup_otp_kernel_only ON plugin_visitors.pickup_otp;
CREATE POLICY pickup_otp_kernel_only ON plugin_visitors.pickup_otp FOR ALL TO schoolos_app USING (false);
-- no grants on pickup_otp to schoolos_app at all: owner connection only.

-- Registry rows (guarded; front-desk gate-pass + verified-pickup capability)
INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, manifest, permissions, settings)
SELECT t.id, 'ops.visitors', '1.0.0', 'C', 'registered', '{
  "id": "ops.visitors",
  "version": "1.0.0",
  "class": "C",
  "description": "Campus gate pass with guardian-verified student pickup. Front desk logs visitors, issues badges; student pickup raises an OTP to the primary guardian (kernel OTP-vault pattern, scrypt-hashed, TTL + attempt-bounded); release is fail-closed without verification.",
  "policyRefs": ["Student safety · guardian pickup verification", "Platform §2.4"],
  "settingsSchema": {"type": "object", "properties": {
    "pickup_otp_ttl_minutes": {"type": "integer", "minimum": 1, "maximum": 30, "default": 5, "description": "Pickup OTP validity in minutes"},
    "pickup_otp_max_attempts": {"type": "integer", "minimum": 1, "maximum": 10, "default": 5, "description": "Max OTP attempts per code"}}}
}'::jsonb, '[]'::jsonb, '{}'::jsonb
FROM app.tenants t
WHERE NOT EXISTS (SELECT 1 FROM app.plugins p WHERE p.tenant_id = t.id AND p.plugin_id = 'ops.visitors');

-- Capability contract (009 §2 style)
INSERT INTO app.capability_contracts (tenant_id, plugin_id, capability_id, version, kind, contract, enforced)
SELECT t.id, 'ops.visitors', 'visitors.gate.pass', '1.0.0', 'capability', '{
  "description": "Campus visitor gate pass: expected/checked-in/badge lifecycle with guardian-verified student pickup through the kernel OTP-vault pattern. Release is fail-closed without guardian verification.",
  "read_scopes": [],
  "write_scopes": ["plugin_visitors.visit", "auth_otps.raise"],
  "event_outputs": ["visitor.logged.v1", "visitor.checked_in.v1", "visitor.pickup.requested.v1", "visitor.pickup.verified.v1", "visitor.completed.v1"],
  "side_effects": [
    {"type": "otp.raise", "approval": "never", "policy_ref": "Student safety · guardian pickup"},
    {"type": "ledger.audit", "approval": "never", "policy_ref": "Platform §2.4"}
  ],
  "policy_refs": ["Student safety · guardian pickup verification", "Platform §2.4"],
  "audit": {"level": "full", "includes": ["actor", "visitor_ref", "pickup_state"]},
  "data_classification": ["pii:guardian_contact"],
  "compat": {"kernel": ">=1.0 <2.0"},
  "regions": ["IN"],
  "residency": "IN"
}'::jsonb, '{"audit":"full","invariants":["pickup_requires_guardian_otp","no_release_without_verification","otp_vault_kernel_pattern"]}'::jsonb
FROM app.tenants t
WHERE NOT EXISTS (SELECT 1 FROM app.capability_contracts c
                  WHERE c.tenant_id = t.id AND c.capability_id = 'visitors.gate.pass' AND c.version = '1.0.0');

-- Guarded ledger entry (hash chain as 001/009-023) — once per tenant.
WITH cands AS (
  SELECT t.id AS tenant_id,
         COALESCE((SELECT a.hash FROM app.audit_log a
                    WHERE a.tenant_id = t.id
                    ORDER BY a.created_at DESC, a.id DESC LIMIT 1), 'GENESIS') AS prev_hash,
         to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at_iso
  FROM app.tenants t
  WHERE NOT EXISTS (
    SELECT 1 FROM app.audit_log x
    WHERE x.tenant_id = t.id AND x.record_type = 'Plugin' AND x.record_ref = 'ops.visitors@1.0.0-runtime')
), mat AS (
  SELECT c.tenant_id, c.prev_hash, c.at_iso,
    '{"tenant":"' || c.tenant_id::text
    || '","actor":"migration 024 (plugin factory)","actorRole":"system","action":"Plugin unit shipped: ops.visitors v1.0 (gate pass + guardian-verified pickup)","recordType":"Plugin","recordRef":"ops.visitors@1.0.0-runtime","outcome":"plugin_visitors.visit data plane · pickup OTP vault (kernel pattern, RLS-denied to app role) · events visitor.logged/checked_in/pickup.requested/pickup.verified/completed · fail-closed release without guardian verification","at":"' || c.at_iso || '"}' AS material
  FROM cands c
), hashed AS (
  SELECT m.tenant_id, m.prev_hash, m.at_iso, m.material,
         encode(sha256(convert_to(m.prev_hash || m.material, 'UTF8')), 'hex') AS row_hash
  FROM mat m
)
SELECT * FROM hashed
CROSS JOIN LATERAL app.audit_append(
  hashed.tenant_id, 'migration 024 (plugin factory)', 'system',
  'Plugin unit shipped: ops.visitors v1.0 (gate pass + guardian-verified pickup)',
  'Plugin', 'ops.visitors@1.0.0-runtime',
  'gate pass data plane · guardian OTP vault (kernel pattern) · fail-closed pickup release',
  'Student safety · guardian pickup verification · Platform §3.1', false, 'medium',
  'data plane provisioned · registry + contract authored by the factory (018 precedent)',
  hashed.prev_hash, hashed.row_hash, hashed.at_iso::timestamptz);
