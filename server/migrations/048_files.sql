-- 048: files.store — Wave B unit 3: private file storage (documents never web-served).
-- (plugin factory, docs/11 §2.2 — 018/020/024/034/046 precedent: the plugin's own
-- numbered migration provisions its data plane, registry row and capability contract).
--
-- Data plane:
--   · app.files — metadata ONLY. Bytes live on disk under FILES_DIR (default
--     <repo>/server/storage/<tenant_id>/), a path that is NOT web-served: every read
--     goes through the download door's access check, and the disk name is a server-side
--     uuid (original filename rides the metadata row). storage_path is stored RELATIVE
--     to the storage base so the tree can move without rewriting rows.
--   · scope ∈ (general, homework, student) — 'student' rows are pinned to one
--     student via ref_id and gated to that child's guardians + the child themself.
--
-- App-role grants are SELECT/INSERT ONLY: metadata rows are never edited or deleted
-- through the application (retention is an owner-path concern, like the GPS purge).
-- Idempotent like 011/013/015/018-024.

CREATE TABLE IF NOT EXISTS app.files (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES app.tenants(id),
  uploader_id  uuid REFERENCES app.users(id),
  filename     text NOT NULL,                 -- original client filename (display only)
  mime         text NOT NULL,                 -- validated against the door whitelist
  bytes        integer NOT NULL CHECK (bytes >= 0),
  sha256       text NOT NULL,                 -- integrity digest over the exact bytes
  storage_path text NOT NULL,                 -- RELATIVE to the storage base: <tenant>/<uuid>.<ext>
  scope        text NOT NULL CHECK (scope IN ('general','homework','student')),
  ref_id       uuid,                          -- student id / homework id for scoped files
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS files_tenant_scope_idx ON app.files (tenant_id, scope, created_at DESC);
CREATE INDEX IF NOT EXISTS files_tenant_ref_idx ON app.files (tenant_id, ref_id);

-- ── RLS (verbatim tenant_isolation pattern from 001_init.sql:352-361) ───────────
ALTER TABLE app.files ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.files FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.files;
CREATE POLICY tenant_isolation ON app.files
  USING (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('schoolos.tenant_id', true)::uuid);

-- Metadata is append-only through the app role: no UPDATE, no DELETE.
GRANT SELECT, INSERT ON app.files TO schoolos_app;

-- ── Registry row (factory-authored, guarded) ────────────────────────────────────
INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, manifest, permissions, settings)
SELECT t.id, 'files.store', '1.0.0', 'B', 'registered', '{
  "id": "files.store",
  "name": "File Storage",
  "version": "1.0.0",
  "kernel": ">=1.0.0 <2.0.0",
  "class": "B",
  "trust": "T1",
  "description": "Private file storage: uploads are validated (5MB cap, mime whitelist PDF/PNG/JPEG/WebP/CSV/DOCX with extension agreement, sha256 integrity digest) and stored under the server-owned FILES_DIR tree — never web-served. Every read flows through the download door: uploader plus owner/principal/itadmin always; scope=student additionally admits that child''s guardians (family.child_link) and the student themself (name-match identity pin). Downloads are audited. Accepts multipart/form-data and JSON base64 payloads.",
  "permissions": ["files.write", "students.read", "events.emit", "audit.request"],
  "events": {"subscribe": [], "publish": [
    {"type": "files.stored", "schema": "v1"}]},
  "eventSubscriptions": [],
  "slots": [],
  "routes": [],
  "widgets": [],
  "settingsSchema": {"type": "object", "properties": {}},
  "data": {"schema": "app.files", "core_refs": ["users.id", "students.id"], "retention": {"on_uninstall": "export_then_purge_30d"}, "residency": ["IN"]},
  "regions": ["IN"],
  "residency": "IN",
  "dependencies": [],
  "defaultEnabled": false
}'::jsonb, '["files.write","students.read","events.emit","audit.request"]'::jsonb, '{}'::jsonb
FROM app.tenants t
WHERE NOT EXISTS (SELECT 1 FROM app.plugins p WHERE p.tenant_id = t.id AND p.plugin_id = 'files.store');

-- ── Capability contract (009 §2 style, guarded) ─────────────────────────────────
INSERT INTO app.capability_contracts (tenant_id, plugin_id, capability_id, version, kind, contract, enforced)
SELECT t.id, 'files.store', 'files.private.storage', '1.0.0', 'capability', '{
  "description": "Private, per-tenant file storage: validated uploads (size cap, mime whitelist with extension agreement, sha256 digest) written to a non-web-served server-owned tree with server-side uuid names; scoped access checks on every download (uploader / owner-principal-itadmin / scope=student guardians and the student themself); audited downloads; metadata list without bytes. Metadata is append-only for the app role.",
  "read_scopes": ["files.read:own_tenant"],
  "write_scopes": ["app.files.insert", "files.tree.write"],
  "event_outputs": ["files.stored.v1"],
  "side_effects": [
    {"type": "filesystem.write", "approval": "never", "policy_ref": "Platform §2.4 · DPDP data minimisation", "note": "bytes never leave the tenant subdirectory; downloads audited"},
    {"type": "ledger.audit", "approval": "never", "policy_ref": "Platform §2.4"}
  ],
  "policy_refs": ["Platform §2.4 (identity & access)", "DPDP Act 2023 · data minimisation"],
  "audit": {"level": "full", "includes": ["actor", "file", "scope", "access_decision"]},
  "data_classification": ["pii:student_records", "pii:staff_records"],
  "compat": {"kernel": ">=1.0 <2.0"},
  "regions": ["IN"],
  "residency": "IN"
}'::jsonb, '{"audit":"full","invariants":["bytes_never_web_served","mime_whitelist_with_extension_agreement","sha256_over_exact_bytes","scoped_download_access","download_audited","metadata_append_only"]}'::jsonb
FROM app.tenants t
WHERE NOT EXISTS (SELECT 1 FROM app.capability_contracts c
                  WHERE c.tenant_id = t.id AND c.capability_id = 'files.private.storage' AND c.version = '1.0.0');

-- ── Guarded ledger entry (hash chain, 001/009-024 pattern) — once per tenant ────
WITH cands AS (
  SELECT t.id AS tenant_id,
         COALESCE((SELECT a.hash FROM app.audit_log a
                    WHERE a.tenant_id = t.id
                    ORDER BY a.created_at DESC, a.id DESC LIMIT 1), 'GENESIS') AS prev_hash,
         to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at_iso
  FROM app.tenants t
  WHERE NOT EXISTS (
    SELECT 1 FROM app.audit_log x
    WHERE x.tenant_id = t.id AND x.record_type = 'Plugin' AND x.record_ref = 'files.store@1.0.0-runtime')
), mat AS (
  SELECT c.tenant_id, c.prev_hash, c.at_iso,
    '{"tenant":"' || c.tenant_id::text
    || '","actor":"migration 048 (plugin factory)","actorRole":"system","action":"Plugin unit shipped: files.store v1.0 (private file storage)","recordType":"Plugin","recordRef":"files.store@1.0.0-runtime","outcome":"app.files append-only metadata plane + non-web-served FILES_DIR tree · validated uploads (5MB, mime whitelist, sha256) · scoped audited downloads (guardian/self on student scope) · tenant-isolated (001 pattern)","at":"' || c.at_iso || '"}' AS material
  FROM cands c
), hashed AS (
  SELECT m.tenant_id, m.prev_hash, m.at_iso, m.material,
         encode(sha256(convert_to(m.prev_hash || m.material, 'UTF8')), 'hex') AS row_hash
  FROM mat m
)
SELECT * FROM hashed
CROSS JOIN LATERAL app.audit_append(
  hashed.tenant_id, 'migration 048 (plugin factory)', 'system',
  'Plugin unit shipped: files.store v1.0 (private file storage)',
  'Plugin', 'files.store@1.0.0-runtime',
  'files metadata plane · non-web-served storage tree · validated uploads · scoped audited downloads',
  'Platform §2.4 (identity & access) · DPDP data minimisation', false, 'medium',
  'data plane provisioned · registry + contract authored by the factory (018/024 precedent)',
  hashed.prev_hash, hashed.row_hash, hashed.at_iso::timestamptz);
