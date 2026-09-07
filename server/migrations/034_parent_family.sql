-- 034_parent_family.sql — ParentOS lane PS-1: family.view v1.0.0
-- family.child_link: the structural parent-account → child binding (TEACHEROS/PARENTOS §53
--   family members & authorization). Demo seed name-matches guardians (idempotent);
--   production bindings are owner-provisioned through the same table.
-- family.request (+events): the unified parent request center — append-only ticket statuses
--   (submitted→received→assigned→in_progress→waiting_parent→resolved→closed). Parents never
--   edit school records; corrections travel as requests (report-discrepancy).
-- family.consent: event/trip/photo consents — immutable once decided (BEFORE UPDATE guard
--   raises on any change after a decision; "pending" is never treated as consent).
-- All doors guardian-scoped via child_link; cross-guardian access = 403 (privacy pin).
BEGIN;

CREATE SCHEMA IF NOT EXISTS family;
GRANT USAGE ON SCHEMA family TO schoolos_app;

CREATE TABLE IF NOT EXISTS family.child_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  student_id uuid NOT NULL,
  relation text NOT NULL DEFAULT 'guardian',
  is_primary boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, student_id)
);

CREATE TABLE IF NOT EXISTS family.request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  guardian_id uuid NOT NULL,
  child_id uuid,
  category text NOT NULL CHECK (category IN ('leave','certificate','document','transport','activity','profile_correction','reevaluation','other')),
  title text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','received','assigned','in_progress','waiting_parent','resolved','closed')),
  owner_role text,
  sla_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS family.request_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  request_id uuid NOT NULL REFERENCES family.request(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  note text,
  actor_id uuid,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS family.consent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  student_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('trip','photo','medical','activity','transport','other')),
  title text NOT NULL,
  detail_ref text,
  due_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','granted','declined')),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- immutability of consent: once decided, the row can never change (no un-consent,
-- no silent edits; a new consent row is a new decision)
CREATE OR REPLACE FUNCTION family.consent_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'This consent decision is final — a new consent can be recorded, but an existing one is never altered';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS consent_immutable_guard ON family.consent;
CREATE TRIGGER consent_immutable_guard BEFORE UPDATE ON family.consent
  FOR EACH ROW EXECUTE FUNCTION family.consent_immutable();

-- RLS: tenant isolation (house pattern, 001 §tenant_isolation)
DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['child_link','request','request_event','consent'] LOOP
    EXECUTE format('ALTER TABLE family.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON family.%I', t);
    EXECUTE format($f$CREATE POLICY tenant_isolation ON family.%I
      USING (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)$f$, t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON family.child_link, family.request, family.consent TO schoolos_app;
GRANT SELECT, INSERT ON family.request_event TO schoolos_app;  -- append-only

-- demo linkage: parent accounts ↔ same-name guardians (idempotent; owner can
-- rebind via family.child_link — this is the §53 authorization table)
INSERT INTO family.child_link (tenant_id, user_id, student_id, relation, is_primary)
SELECT u.tenant_id, u.id, g.student_id, COALESCE(g.relation,'guardian'), COALESCE(g.is_primary,true)
FROM app.users u
JOIN app.guardians g ON g.tenant_id = u.tenant_id AND lower(g.name) = lower(u.name)
WHERE u.role = 'parent' AND u.active
ON CONFLICT (tenant_id, user_id, student_id) DO NOTHING;

-- factory registry row (plugin factory provisions its own rows — 018/024/029/032 precedent)
INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, manifest, permissions)
SELECT t.id, 'family.view', '1.0.0', 'C', 'registered',
  '{"id":"family.view","name":"Family Command Center","version":"1.0.0","kernel":">=1.0.0 <2.0.0","class":"C","trust":"T1","description":"The parent read-plane: per-child home aggregation (attendance, assignments, exams, timeline), the unified request center with append-only ticket statuses, immutable event consents (a decision can never be altered — a new decision is a new row), child leave requests via per-instance kernel actions, and the report-discrepancy flow (parents never edit school records). Guardian scoping via family.child_link; cross-guardian access is refused; teachers are refused on every door. Contracts: family.request.v1, family.consent.v1, child.leave.requested.v1.","permissions":["students.read","events.emit","audit.request"],"events":{"subscribe":[],"publish":[{"type":"family.request.v1","schema":"v1"},{"type":"family.consent.v1","schema":"v1"},{"type":"child.leave.requested.v1","schema":"v1"}]},"eventSubscriptions":[],"slots":["settings","reports"],"routes":[],"widgets":[],"settingsSchema":{"type":"object","properties":{}},"data":{"schema":"family.child_link, family.request(+events), family.consent","core_refs":["students.id","users.id"],"retention":{"on_uninstall":"export_then_purge_30d"},"residency":["IN"]},"regions":["IN"],"residency":"IN","billing":{"model":"pack","pack":"family"},"dependencies":[],"defaultEnabled":false}'::jsonb,
  '["students.read","events.emit","audit.request"]'::jsonb
FROM app.tenants t
WHERE NOT EXISTS (SELECT 1 FROM app.plugins p WHERE p.plugin_id='family.view');

INSERT INTO app.capability_contracts (tenant_id, capability_id, plugin_id, version, contract)
SELECT t.id, v.cap, 'family.view', '1.0.0',
  jsonb_build_object('events', v.cap, 'schema', 'v1', 'source', 'family.view', 'note', v.note)
FROM app.tenants t
CROSS JOIN (VALUES
  ('family.request.v1','parent request center'),
  ('family.consent.v1','immutable consent decisions'),
  ('child.leave.requested.v1','guardian-filed child leave')
) AS v(cap, note)
WHERE NOT EXISTS (SELECT 1 FROM app.capability_contracts c WHERE c.plugin_id='family.view' AND c.capability_id=v.cap);

-- guarded ledger entry (024/029/032 precedent — chain-selection must match audit_append's verifier)
WITH cands AS (
  SELECT t.id AS tenant_id,
         COALESCE((SELECT a.hash FROM app.audit_log a
                    WHERE a.tenant_id = t.id
                    ORDER BY a.created_at DESC, a.id DESC LIMIT 1), 'GENESIS') AS prev_hash,
         to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at_iso
  FROM app.tenants t
  WHERE NOT EXISTS (
    SELECT 1 FROM app.audit_log x
    WHERE x.tenant_id = t.id AND x.record_type = 'Plugin' AND x.record_ref = 'parent-family@1')
), mat AS (
  SELECT c.tenant_id, c.prev_hash, c.at_iso,
    '{"tenant":"' || c.tenant_id::text
    || '","actor":"migration 034 (plugin factory)","actorRole":"system","action":"ParentOS lane PS-1 registered: family.view v1.0.0 (per-child home/timeline/assignments/attendance/exams read plane · unified request tickets with append-only statuses · immutable event consents · child leave via per-instance kernel actions · report-discrepancy flow)","recordType":"Plugin","recordRef":"parent-family@1","outcome":"guardian scoping via family.child_link · cross-guardian 403 · consent immutable-once-decided (BEFORE UPDATE guard) · parents never edit school records · graceful degradation when TeacherOS tables are absent","at":"' || c.at_iso || '"}' AS material
  FROM cands c
), hashed AS (
  SELECT m.tenant_id, m.prev_hash, m.at_iso, m.material,
         encode(sha256(convert_to(m.prev_hash || m.material, 'UTF8')), 'hex') AS row_hash
  FROM mat m
)
SELECT * FROM hashed
CROSS JOIN LATERAL app.audit_append(
  hashed.tenant_id, 'migration 034 (plugin factory)', 'system',
  'ParentOS lane PS-1: family.view v1.0.0 (family command center read plane · request tickets · immutable consents · child leave)',
  'Plugin', 'parent-family@1',
  'guardian scoping via family.child_link · cross-guardian 403 · consent immutable-once-decided · parents never edit records',
  'PARENTOS-PLAN §data+contracts · DPDP Act 2023 · Platform §2.4', false, 'high',
  'family.view 1.0.0 · PS-1 data plane live (migration 034)',
  hashed.prev_hash, hashed.row_hash, hashed.at_iso::timestamptz);

COMMIT;
