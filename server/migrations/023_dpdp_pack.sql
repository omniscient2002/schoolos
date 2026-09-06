-- 023: pack.dpdp runtime data plane (plugindev unit, FINAL numbering; registry row +
-- contract dpdp.consent.ledger already provisioned by 009 — guarded re-provision here
-- for bare-kernel DBs only)
-- DPDP Act 2023 primitives per the locked contract:
--   · consent ledger — IMMUTABLE (invariant consent_immutable): every grant/withdrawal
--     is an appended row; current state = latest row per (subject_ref, purpose); expiry
--     is computed at read (retention_schedule_linked via settings validity days).
--   · SAR workflow — export/erasure raised as KERNEL APPROVAL-GATED actions
--     (app.actions); erasure touches core domain → approval semantics, never
--     plugin-direct. On approval the pack executes what it owns (its own ledger +
--     admissions.funnel guardian PII, which declares dependencies:["pack.dpdp"]);
--     core app.students rows are NEVER written by this plugin (office lane).
-- Money-adjacent: none.

CREATE SCHEMA IF NOT EXISTS plugin_dpdp;
GRANT USAGE ON SCHEMA plugin_dpdp TO schoolos_app;

CREATE TABLE IF NOT EXISTS plugin_dpdp.consent (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES app.tenants(id),
  subject_ref  text NOT NULL,                      -- guardian phone (normalized) — the DPDP data principal ref
  subject_type text NOT NULL DEFAULT 'guardian',
  purpose      text NOT NULL,                      -- e.g. admissions_enquiry · transport_notifications
  decision     text NOT NULL CHECK (decision IN ('granted','withdrawn')),
  basis        text,                               -- e.g. consent · legitimate_use
  channel      text,                               -- e.g. walk-in · portal · phone
  actor        text,
  evidence     jsonb NOT NULL DEFAULT '{}'::jsonb, -- {recordedBy, note, sourceDoc}
  valid_from   timestamptz NOT NULL DEFAULT now(),
  valid_until  timestamptz,                        -- NULL = policy default (settings consent_validity_days)
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS consent_subject_idx ON plugin_dpdp.consent (tenant_id, subject_ref, purpose, valid_from DESC);
-- no UPDATE/DELETE grants beyond DML the pack needs: append-only ledger, insert+select only
GRANT SELECT, INSERT ON plugin_dpdp.consent TO schoolos_app;

CREATE TABLE IF NOT EXISTS plugin_dpdp.sar (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES app.tenants(id),
  kind         text NOT NULL CHECK (kind IN ('export','erasure')),
  subject_ref  text NOT NULL,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','fulfilled','dismissed')),
  action_id    uuid,                               -- app.actions approval row (kernel-gated; no hard FK — cross-schema isolation)
  sla_due_at   timestamptz,                        -- created_at + settings dsr_sla_days (invariant sar_sla_tracked)
  fulfilled_at timestamptz,
  bundle       jsonb,                              -- export bundle / erasure summary
  requested_by text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON plugin_dpdp.sar TO schoolos_app;

-- settings schema: consent_validity_days + dsr_sla_days (retention hooks). Manifest refresh
-- guarded so 009-provisioned rows gain the keys without clobbering everything else.
UPDATE app.plugins SET
  manifest = jsonb_set(manifest, '{settingsSchema,properties}',
    COALESCE(manifest->'settingsSchema'->'properties', '{}'::jsonb)
      || jsonb_build_object(
        'consent_validity_days', '{"type":"integer","minimum":1,"maximum":3650,"default":1095,"description":"Default consent validity in days (DPDP retention schedule); 1095 = 3 years"}'::jsonb,
        'dsr_sla_days', '{"type":"integer","minimum":1,"maximum":90,"default":30,"description":"SAR fulfilment SLA in days (invariant sar_sla_tracked)"}'::jsonb))
WHERE plugin_id = 'pack.dpdp';

-- Guarded registry row (bare-kernel DBs; no-ops where 009 already provisioned).
INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, manifest, permissions, settings)
SELECT t.id, 'pack.dpdp', '1.0.0', 'C', 'registered', '{
  "id": "pack.dpdp",
  "version": "1.0.0",
  "class": "C",
  "description": "DPDP Act 2023 compliance pack: immutable consent ledger, SAR (export/erasure) workflow through the kernel action spine, retention schedule hooks. Data-residency IN.",
  "policyRefs": ["DPDP Act 2023 · consent and retention", "Platform §2.4"],
  "settingsSchema": {"type": "object", "properties": {
    "consent_validity_days": {"type": "integer", "minimum": 1, "maximum": 3650, "default": 1095},
    "dsr_sla_days": {"type": "integer", "minimum": 1, "maximum": 90, "default": 30}}}
}'::jsonb, '[]'::jsonb, '{}'::jsonb
FROM app.tenants t
WHERE NOT EXISTS (SELECT 1 FROM app.plugins p WHERE p.tenant_id = t.id AND p.plugin_id = 'pack.dpdp');

-- Guarded ledger entry (hash chain as 001/009-022) — once per tenant.
WITH cands AS (
  SELECT t.id AS tenant_id,
         COALESCE((SELECT a.hash FROM app.audit_log a
                    WHERE a.tenant_id = t.id
                    ORDER BY a.created_at DESC, a.id DESC LIMIT 1), 'GENESIS') AS prev_hash,
         to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at_iso
  FROM app.tenants t
  WHERE NOT EXISTS (
    SELECT 1 FROM app.audit_log x
    WHERE x.tenant_id = t.id AND x.record_type = 'Plugin' AND x.record_ref = 'pack.dpdp@1.0.0-runtime')
), mat AS (
  SELECT c.tenant_id, c.prev_hash, c.at_iso,
    '{"tenant":"' || c.tenant_id::text
    || '","actor":"migration 023 (plugin factory)","actorRole":"system","action":"Plugin unit shipped: pack.dpdp v1.0 (DPDP compliance pack)","recordType":"Plugin","recordRef":"pack.dpdp@1.0.0-runtime","outcome":"plugin_dpdp.consent immutable ledger · plugin_dpdp.sar workflow · consent.recorded.v1 / sar.opened.v1 / sar.fulfilled.v1 events · SAR export+erasure kernel-approval-gated (erasure never plugin-direct on core) · retention hooks consent_validity_days/dsr_sla_days","at":"' || c.at_iso || '"}' AS material
  FROM cands c
), hashed AS (
  SELECT m.tenant_id, m.prev_hash, m.at_iso, m.material,
         encode(sha256(convert_to(m.prev_hash || m.material, 'UTF8')), 'hex') AS row_hash
  FROM mat m
)
SELECT * FROM hashed
CROSS JOIN LATERAL app.audit_append(
  hashed.tenant_id, 'migration 023 (plugin factory)', 'system',
  'Plugin unit shipped: pack.dpdp v1.0 (DPDP compliance pack)',
  'Plugin', 'pack.dpdp@1.0.0-runtime',
  'consent ledger (immutable) · SAR workflow · kernel-gated export/erasure · retention hooks',
  'DPDP Act 2023 · consent and retention · Platform §3.1', false, 'medium',
  'data plane provisioned · registry guarded · contract from 009 unchanged',
  hashed.prev_hash, hashed.row_hash, hashed.at_iso::timestamptz);
