-- 046: people.admin — Wave B unit 1: enrollment history + identity administration
-- (plugin factory, docs/11 §2.2 — 018/024/034 precedent: the plugin's own numbered
-- migration provisions its data plane, registry row and capability contract).
--
-- Data plane:
--   · app.enrollment_history — append-only ledger of every class/section move.
--     Fixes the "current-class-only" gap (docs/DATA-FLOW §5/§22: a "class 8 roster in
--     2025" report is impossible to reconstruct): the transfer door writes one row per
--     move (from→to) BEFORE flipping app.students, so year-on-year reports can rebuild
--     any past roster. Append-only for the app role (SELECT/INSERT — no UPDATE/DELETE).
--   · app.users.force_change — marker stamped when a temporary password is issued
--     (provision without a supplied password, reset-password door). Forward-enforcement
--     marker: the kernel login path is owned by the kernel lane and is NOT touched here.
--
-- Invariants:
--   · owner_creation_forbidden — no door provisions the owner role (audited refusal).
--   · transfer_writes_history — a transfer without a history row cannot commit.
--   · unique_tenant_email_409 — UNIQUE(tenant_id,email) races surface as a friendly 409
--     via the SAVEPOINT pattern (teacher.classroom:139-150 precedent).
--   · tenant isolation RLS exactly per 001_init.sql:352-361 (ENABLE + FORCE + policy).
-- Idempotent like 011/013/015/018-024.

-- ── 1. Enrollment history (append-only) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.enrollment_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES app.tenants(id),
  student_id   uuid NOT NULL REFERENCES app.students(id),
  from_grade   text NOT NULL,
  from_section text NOT NULL,
  to_grade     text NOT NULL,
  to_section   text NOT NULL,
  changed_by   uuid REFERENCES app.users(id),
  reason       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS enrollment_history_student_idx
  ON app.enrollment_history (tenant_id, student_id, created_at DESC);

-- ── 2. RLS (verbatim tenant_isolation pattern from 001_init.sql:352-361) ────────
ALTER TABLE app.enrollment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.enrollment_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.enrollment_history;
CREATE POLICY tenant_isolation ON app.enrollment_history
  USING (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('schoolos.tenant_id', true)::uuid);

-- Append-only for the application role: history is written once, never edited.
GRANT SELECT, INSERT ON app.enrollment_history TO schoolos_app;

-- ── 3. force_change marker on users (temporary-password stamp) ──────────────────
ALTER TABLE app.users ADD COLUMN IF NOT EXISTS force_change boolean NOT NULL DEFAULT false;

-- ── 4. Registry row (factory-authored, guarded) ─────────────────────────────────
INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, manifest, permissions, settings)
SELECT t.id, 'people.admin', '1.0.0', 'B', 'registered', '{
  "id": "people.admin",
  "name": "People Administration",
  "version": "1.0.0",
  "kernel": ">=1.0.0 <2.0.0",
  "class": "B",
  "trust": "T1",
  "description": "Identity & roster administration: user provisioning for every role except owner (scrypt credentials, optional parent-child_link), suspend/activate (suspension makes the kernel live-row check refuse the account), forced-change temporary passwords, the student class/section transfer flow that writes an append-only enrollment_history row, and a robust CSV roster import (per-row SAVEPOINT, in-file + in-DB admission-number dedupe, 500-row cap, full report). Owner accounts cannot be created, suspended or password-reset from any door.",
  "permissions": ["users.write", "students.write", "events.emit", "audit.request"],
  "events": {"subscribe": [], "publish": [
    {"type": "people.user.created", "schema": "v1"},
    {"type": "people.user.suspended", "schema": "v1"},
    {"type": "people.user.activated", "schema": "v1"},
    {"type": "people.user.password_reset", "schema": "v1"},
    {"type": "people.student.transferred", "schema": "v1"},
    {"type": "people.import.completed", "schema": "v1"}]},
  "eventSubscriptions": [],
  "slots": [],
  "routes": [],
  "widgets": [],
  "settingsSchema": {"type": "object", "properties": {}},
  "data": {"schema": "app.users, app.students, app.enrollment_history, family.child_link", "core_refs": ["users.id", "students.id"], "retention": {"on_uninstall": "export_then_purge_30d"}, "residency": ["IN"]},
  "regions": ["IN"],
  "residency": "IN",
  "dependencies": [],
  "defaultEnabled": false
}'::jsonb, '["users.write","students.write","events.emit","audit.request"]'::jsonb, '{}'::jsonb
FROM app.tenants t
WHERE NOT EXISTS (SELECT 1 FROM app.plugins p WHERE p.tenant_id = t.id AND p.plugin_id = 'people.admin');

-- ── 5. Capability contract (009 §2 style, guarded) ──────────────────────────────
INSERT INTO app.capability_contracts (tenant_id, plugin_id, capability_id, version, kind, contract, enforced)
SELECT t.id, 'people.admin', 'people.administration', '1.0.0', 'capability', '{
  "description": "Identity & roster administration: provisioning of non-owner roles with scrypt-hashed credentials (temp password shown once, force_change stamped), suspension/activation through the kernel live-row refusal path, forced-change password resets, class/section transfer guarded by an append-only enrollment history, and a validated CSV roster import with per-row SAVEPOINT isolation. Owner accounts are structurally protected (no create, no suspend, no reset).",
  "read_scopes": ["graph.read:users", "graph.read:students"],
  "write_scopes": ["users.write", "students.write", "enrollment_history.append", "family.child_link"],
  "event_outputs": ["people.user.created.v1", "people.user.suspended.v1", "people.user.activated.v1", "people.user.password_reset.v1", "people.student.transferred.v1", "people.import.completed.v1"],
  "side_effects": [
    {"type": "credential.issue", "approval": "never", "policy_ref": "Platform §2.4 (identity & access)", "note": "temporary passwords are shown exactly once and stamped force_change"},
    {"type": "ledger.audit", "approval": "never", "policy_ref": "Platform §2.4"}
  ],
  "policy_refs": ["Platform §2.4 (identity & access)"],
  "audit": {"level": "full", "includes": ["actor", "target_user", "role", "outcome"]},
  "data_classification": ["pii:staff_records", "pii:student_records"],
  "compat": {"kernel": ">=1.0 <2.0"},
  "regions": ["IN"],
  "residency": "IN"
}'::jsonb, '{"audit":"full","invariants":["owner_creation_forbidden","owner_suspend_forbidden","temp_password_shown_once","transfer_writes_history","import_per_row_savepoint","unique_tenant_email_409"]}'::jsonb
FROM app.tenants t
WHERE NOT EXISTS (SELECT 1 FROM app.capability_contracts c
                  WHERE c.tenant_id = t.id AND c.capability_id = 'people.administration' AND c.version = '1.0.0');

-- ── 6. Guarded ledger entry (hash chain, 001/009-024 pattern) — once per tenant ─
WITH cands AS (
  SELECT t.id AS tenant_id,
         COALESCE((SELECT a.hash FROM app.audit_log a
                    WHERE a.tenant_id = t.id
                    ORDER BY a.created_at DESC, a.id DESC LIMIT 1), 'GENESIS') AS prev_hash,
         to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at_iso
  FROM app.tenants t
  WHERE NOT EXISTS (
    SELECT 1 FROM app.audit_log x
    WHERE x.tenant_id = t.id AND x.record_type = 'Plugin' AND x.record_ref = 'people.admin@1.0.0-runtime')
), mat AS (
  SELECT c.tenant_id, c.prev_hash, c.at_iso,
    '{"tenant":"' || c.tenant_id::text
    || '","actor":"migration 046 (plugin factory)","actorRole":"system","action":"Plugin unit shipped: people.admin v1.0 (identity & roster administration)","recordType":"Plugin","recordRef":"people.admin@1.0.0-runtime","outcome":"app.enrollment_history append-only ledger + users.force_change marker · provisioning/suspend/reset/transfer/import doors · owner accounts structurally protected · tenant-isolated (001 pattern)","at":"' || c.at_iso || '"}' AS material
  FROM cands c
), hashed AS (
  SELECT m.tenant_id, m.prev_hash, m.at_iso, m.material,
         encode(sha256(convert_to(m.prev_hash || m.material, 'UTF8')), 'hex') AS row_hash
  FROM mat m
)
SELECT * FROM hashed
CROSS JOIN LATERAL app.audit_append(
  hashed.tenant_id, 'migration 046 (plugin factory)', 'system',
  'Plugin unit shipped: people.admin v1.0 (identity & roster administration)',
  'Plugin', 'people.admin@1.0.0-runtime',
  'enrollment-history data plane · force_change marker · owner-protected identity doors',
  'Platform §2.4 (identity & access)', false, 'medium',
  'data plane provisioned · registry + contract authored by the factory (018/024 precedent)',
  hashed.prev_hash, hashed.row_hash, hashed.at_iso::timestamptz);
