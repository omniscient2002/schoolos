-- 047: library — Wave B unit 2: the school library desk (books, loans, fines).
-- (plugin factory, docs/11 §2.2 — 018/020/024/034/046 precedent: the plugin's own
-- numbered migration provisions its data plane, registry row and capability contract).
--
-- Data plane (schema `library`):
--   · library.book   — the catalog. code UNIQUE(tenant,code) for spine-label lookups;
--     status ∈ (available,retired) is the catalog lifecycle (retire door).
--   · library.loan   — one row per issued copy. Availability is DERIVED, never stored:
--     open loans (status='issued' AND returned_at IS NULL) < copies_total ⇒ issuable
--     (computed in the issue door's availability check and in catalog reads).
--     fine_cents is computed at RETURN time (days_overdue × fine_per_day_cents setting,
--     default 500 = ₹5/day) and never edited afterwards. status ∈ (issued,returned,lost).
--
-- Staffing per school-office norms: owner / principal / coordinator / facilities.
-- (No teacher door — library issue/return is an office function, not a classroom one.)
-- Idempotent like 011/013/015/018-024.

CREATE SCHEMA IF NOT EXISTS library;
GRANT USAGE ON SCHEMA library TO schoolos_app;

-- ── 1. Catalog ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS library.book (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES app.tenants(id),
  code         text NOT NULL,
  title        text NOT NULL,
  author       text,
  category     text,
  copies_total integer NOT NULL CHECK (copies_total >= 0),
  status       text NOT NULL DEFAULT 'available' CHECK (status IN ('available','retired')),
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS book_tenant_title_idx ON library.book (tenant_id, title);

-- ── 2. Loans (append-style lifecycle; never hard-deleted by the app role) ───────
CREATE TABLE IF NOT EXISTS library.loan (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES app.tenants(id),
  book_id    uuid NOT NULL REFERENCES library.book(id),
  student_id uuid NOT NULL REFERENCES app.students(id),
  issued_by  uuid REFERENCES app.users(id),
  issued_at  timestamptz NOT NULL DEFAULT now(),
  due_on     date NOT NULL,
  returned_at timestamptz,
  fine_cents integer NOT NULL DEFAULT 0 CHECK (fine_cents >= 0),
  status     text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','returned','lost')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS loan_tenant_student_idx ON library.loan (tenant_id, student_id);
CREATE INDEX IF NOT EXISTS loan_tenant_status_idx ON library.loan (tenant_id, status, due_on);

-- ── 3. RLS (verbatim tenant_isolation pattern from 001_init.sql:352-361) ────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['book','loan'] LOOP
    EXECUTE format('ALTER TABLE library.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE library.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON library.%I', t);
    EXECUTE format($f$CREATE POLICY tenant_isolation ON library.%I
      USING (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)$f$, t);
  END LOOP;
END $$;

-- Library is a lending desk: the app role reads, issues and returns — never deletes.
-- (Loan rows are the loan ledger; book rows are the catalog. Retire is an UPDATE.)
GRANT SELECT, INSERT, UPDATE ON library.book, library.loan TO schoolos_app;

-- ── 4. Registry row (factory-authored, guarded) ─────────────────────────────────
INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, manifest, permissions, settings)
SELECT t.id, 'library', '1.0.0', 'C', 'registered', '{
  "id": "library",
  "name": "Library Desk",
  "version": "1.0.0",
  "kernel": ">=1.0.0 <2.0.0",
  "class": "C",
  "trust": "T1",
  "description": "The school library desk: catalog with per-title copy counts, issue/return against active students, availability derived from open loans (never stored), overdue fines computed at return (days_overdue × fine_per_day_cents, default ₹5/day) and an overdue chase list. Staffed per school-office norms (owner/principal/coordinator/facilities — no teacher door); students see only their own loans. Catalog lifecycle: retire keeps history, removes future issues.",
  "permissions": ["students.read", "events.emit", "audit.request"],
  "events": {"subscribe": [], "publish": [
    {"type": "library.book.added", "schema": "v1"},
    {"type": "library.loan.issued", "schema": "v1"},
    {"type": "library.loan.returned", "schema": "v1"}]},
  "eventSubscriptions": [],
  "slots": ["settings"],
  "routes": [],
  "widgets": [],
  "settingsSchema": {"type": "object", "properties": {
    "fine_per_day_cents": {"type": "integer", "minimum": 0, "maximum": 100000, "default": 500, "description": "Overdue fine per day, in paise (₹1 = 100 paise)"}}},
  "data": {"schema": "library.book, library.loan", "core_refs": ["students.id", "users.id"], "retention": {"on_uninstall": "export_then_purge_30d"}, "residency": ["IN"]},
  "regions": ["IN"],
  "residency": "IN",
  "dependencies": [],
  "defaultEnabled": false
}'::jsonb, '["students.read","events.emit","audit.request"]'::jsonb, '{"fine_per_day_cents":500}'::jsonb
FROM app.tenants t
WHERE NOT EXISTS (SELECT 1 FROM app.plugins p WHERE p.tenant_id = t.id AND p.plugin_id = 'library');

-- ── 5. Capability contract (009 §2 style, guarded) ──────────────────────────────
INSERT INTO app.capability_contracts (tenant_id, plugin_id, capability_id, version, kind, contract, enforced)
SELECT t.id, 'library', 'library.lending', '1.0.0', 'capability', '{
  "description": "Library lending desk: catalog management with copy counts, issue/return against active students, availability derived from open loans (copies_total − open loans), overdue fines computed deterministically at return and an overdue chase list. Students read only their own loans. Retired books keep their loan history but cannot be issued again.",
  "read_scopes": ["library.read:catalog", "graph.read:students"],
  "write_scopes": ["library.book", "library.loan"],
  "event_outputs": ["library.book.added.v1", "library.loan.issued.v1", "library.loan.returned.v1"],
  "side_effects": [
    {"type": "fine.compute", "approval": "never", "policy_ref": "Library desk norms", "note": "deterministic at return: max(0, days_overdue) × fine_per_day_cents (default 500)"},
    {"type": "ledger.audit", "approval": "never", "policy_ref": "Platform §2.4"}
  ],
  "policy_refs": ["Library desk norms", "Platform §2.4"],
  "audit": {"level": "full", "includes": ["actor", "book", "student", "fine"]},
  "data_classification": ["pii:student_records"],
  "compat": {"kernel": ">=1.0 <2.0"},
  "regions": ["IN"],
  "residency": "IN"
}'::jsonb, '{"audit":"full","invariants":["availability_derived_never_stored","student_must_be_active","no_issue_from_retired_book","fine_computed_once_at_return","student_self_scope_only","no_delete_for_app_role"]}'::jsonb
FROM app.tenants t
WHERE NOT EXISTS (SELECT 1 FROM app.capability_contracts c
                  WHERE c.tenant_id = t.id AND c.capability_id = 'library.lending' AND c.version = '1.0.0');

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
    WHERE x.tenant_id = t.id AND x.record_type = 'Plugin' AND x.record_ref = 'library@1.0.0-runtime')
), mat AS (
  SELECT c.tenant_id, c.prev_hash, c.at_iso,
    '{"tenant":"' || c.tenant_id::text
    || '","actor":"migration 047 (plugin factory)","actorRole":"system","action":"Plugin unit shipped: library v1.0 (lending desk)","recordType":"Plugin","recordRef":"library@1.0.0-runtime","outcome":"library.book + library.loan data plane · availability derived from open loans · fines computed at return · owner/principal/coordinator/facilities staffing · tenant-isolated (001 pattern)","at":"' || c.at_iso || '"}' AS material
  FROM cands c
), hashed AS (
  SELECT m.tenant_id, m.prev_hash, m.at_iso, m.material,
         encode(sha256(convert_to(m.prev_hash || m.material, 'UTF8')), 'hex') AS row_hash
  FROM mat m
)
SELECT * FROM hashed
CROSS JOIN LATERAL app.audit_append(
  hashed.tenant_id, 'migration 047 (plugin factory)', 'system',
  'Plugin unit shipped: library v1.0 (lending desk)',
  'Plugin', 'library@1.0.0-runtime',
  'catalog + loan data plane · derived availability · deterministic fines · office staffing',
  'Library desk norms · Platform §3.1', false, 'low',
  'data plane provisioned · registry + contract authored by the factory (018/020/024 precedent)',
  hashed.prev_hash, hashed.row_hash, hashed.at_iso::timestamptz);
