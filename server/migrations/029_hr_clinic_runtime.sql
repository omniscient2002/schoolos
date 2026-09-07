-- 029: wave-3 close-out — hr.leave v1.0 + health.clinic v1.0 (plugin factory)
-- Per orchestrator ledger ruling: the 12-plugin count is a catalog number, not a
-- stopping rule; hr.leave and health.clinic are in the locked list (wave 3) and ship
-- in this combined unit. Numbering re-baselined by the tree: 027 = cycle-5
-- remediation, 028 = UI lane, 029 = THIS (hr.leave + health.clinic together — both
-- lighter than dpdp per dispatch).
--   plugin_hr.leave      — staff-absence facts (marked lane, coordinator/office authority);
--                          emits staff.leave.marked.v1 — the source named by
--                          ops.timetable's absence_feed settings key ('hr.leave', 021).
--   plugin_clinic.visit  — infirmary log (append-first; corrections append)
--   plugin_clinic.sick_pass — class-release authorization tied to a clinic visit
--   guardian notice      — sent_home visits raise a per-instance kernel message action
--                          (clinic.notify.<visitId> — UNIQUE(tenant_id, code) from birth),
--                          executed by the kernel decide handler onto the comms rail
--                          (transport gps_delay precedent, routes.js:404).
-- Cycle-5 hygiene carried: per-instance action codes from birth; IST clock for
-- date/validity math; PII tiering (health history is nurse-lane, no teacher/finance).

CREATE SCHEMA IF NOT EXISTS plugin_hr;
GRANT USAGE ON SCHEMA plugin_hr TO schoolos_app;

CREATE TABLE IF NOT EXISTS plugin_hr.leave (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  staff_id    uuid NOT NULL,                       -- app.users.id (staff are users; no hard FK — plugin isolation)
  leave_date  date NOT NULL,                       -- IST calendar day of absence
  kind        text NOT NULL
              CHECK (kind IN ('sick','casual','duty','comp','unpaid','training')),
  status      text NOT NULL DEFAULT 'marked'
              CHECK (status IN ('marked','cancelled')),
  reason      text,
  marked_by   uuid,                                -- office actor who marked it
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- one absence fact per staff-day (the check-then-insert race degrades to 23505 → 409)
CREATE UNIQUE INDEX IF NOT EXISTS leave_staff_day_unique ON plugin_hr.leave (tenant_id, staff_id, leave_date)
  WHERE status = 'marked';
CREATE INDEX IF NOT EXISTS leave_date_idx ON plugin_hr.leave (tenant_id, leave_date);
GRANT SELECT, INSERT, UPDATE ON plugin_hr.leave TO schoolos_app;
ALTER TABLE plugin_hr.leave ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hr_leave_tenant_isolation ON plugin_hr.leave;
CREATE POLICY hr_leave_tenant_isolation ON plugin_hr.leave
  USING (tenant_id = current_setting('schoolos.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('schoolos.tenant_id')::uuid);

CREATE SCHEMA IF NOT EXISTS plugin_clinic;
GRANT USAGE ON SCHEMA plugin_clinic TO schoolos_app;

-- infirmary log — health data: DPDP-sensitive; corrections append a new row (audit
-- trail intact), the log itself is never rewritten
CREATE TABLE IF NOT EXISTS plugin_clinic.visit (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id),
  student_id    uuid NOT NULL,                     -- app.students.id (no hard FK — plugin isolation)
  visited_at    timestamptz NOT NULL DEFAULT now(),
  complaint     text NOT NULL,
  temperature_c numeric(4,1),
  action        text NOT NULL DEFAULT 'first_aid'
                CHECK (action IN ('rest','first_aid','sent_home','hospital_referral')),
  notes         text,
  logged_by     uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clinic_visit_student_idx ON plugin_clinic.visit (tenant_id, student_id, visited_at DESC);
GRANT SELECT, INSERT, UPDATE ON plugin_clinic.visit TO schoolos_app;
ALTER TABLE plugin_clinic.visit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clinic_visit_tenant_isolation ON plugin_clinic.visit;
CREATE POLICY clinic_visit_tenant_isolation ON plugin_clinic.visit
  USING (tenant_id = current_setting('schoolos.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('schoolos.tenant_id')::uuid);

-- sick pass — authorizes class release while under clinic care
CREATE TABLE IF NOT EXISTS plugin_clinic.sick_pass (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  visit_id    uuid NOT NULL,                       -- plugin_clinic.visit.id
  student_id  uuid NOT NULL,
  issued_at   timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz NOT NULL,
  status      text NOT NULL DEFAULT 'active'
              CHECK (status IN ('active','used','revoked','expired')),
  issued_by   uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sick_pass_visit_idx ON plugin_clinic.sick_pass (tenant_id, visit_id);
CREATE INDEX IF NOT EXISTS sick_pass_student_idx ON plugin_clinic.sick_pass (tenant_id, student_id, status);
GRANT SELECT, INSERT, UPDATE ON plugin_clinic.sick_pass TO schoolos_app;
ALTER TABLE plugin_clinic.sick_pass ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sick_pass_tenant_isolation ON plugin_clinic.sick_pass;
CREATE POLICY sick_pass_tenant_isolation ON plugin_clinic.sick_pass
  USING (tenant_id = current_setting('schoolos.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('schoolos.tenant_id')::uuid);

-- ── registry rows (factory-authored, 018/021 precedent) ─────────────────────────
INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, manifest, permissions)
SELECT t.id, 'hr.leave', '1.0.0', 'C', 'registered',
  '{"id":"hr.leave","name":"HR Leave & Duty Roster","version":"1.0.0","kernel":">=1.0.0 <2.0.0","class":"C","trust":"T1","description":"Staff leave marking and the daily duty roster. Emits staff.leave.marked.v1 / staff.leave.cancelled.v1 — the absence facts consumed by ops.timetable when its absence_feed setting is set to hr.leave (021 contract). Leave marking is an office operation (principal/owner lane); the roster read is the coordination desk lane. No communication rail use — absence is a fact, not a parent notice.","permissions":["users.read","events.emit","audit.request"],"events":{"subscribe":[],"publish":[{"type":"staff.leave.marked","schema":"v1"},{"type":"staff.leave.cancelled","schema":"v1"}]},"eventSubscriptions":[],"slots":["settings","reports"],"routes":[],"widgets":[],"settingsSchema":{"type":"object","properties":{"absence_feed_contract":{"type":"string","default":"ops.timetable absence_feed=hr.leave consumes staff.leave.marked.v1 (spine, per staff-day unique)","description":"Consumption contract note for the timetable slot"}}},"data":{"schema":"plugin_hr.leave (RLS-scoped)","core_refs":["users.id"],"retention":{"on_uninstall":"export_then_purge_30d"},"residency":["IN"]},"regions":["IN"],"residency":"IN","billing":{"model":"pack","pack":"operations"},"dependencies":[],"defaultEnabled":false}'::jsonb,
  '["users.read","events.emit","audit.request"]'::jsonb
FROM app.tenants t
WHERE NOT EXISTS (SELECT 1 FROM app.plugins p WHERE p.plugin_id='hr.leave');

INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, manifest, permissions)
SELECT t.id, 'health.clinic', '1.0.0', 'C', 'registered',
  '{"id":"health.clinic","name":"Health Clinic","version":"1.0.0","kernel":">=1.0.0 <2.0.0","class":"C","trust":"T1","description":"Infirmary log, sick passes and guardian health notices. Visits are append-first (corrections append); sent-home and hospital-referral outcomes raise a per-instance kernel approval action (clinic.notify.<visitId>) executed by the decide handler onto the comms rail — guardian notice is an approved communication, never a plugin-direct send (Comms §1.2). Health history is nurse-lane PII: no teacher/finance/parent read.","permissions":["students.read","events.emit","audit.request"],"events":{"subscribe":[],"publish":[{"type":"clinic.visit.logged","schema":"v1"},{"type":"clinic.sick_pass.issued","schema":"v1"}]},"eventSubscriptions":[],"slots":["settings","reports"],"routes":[],"widgets":[],"settingsSchema":{"type":"object","properties":{"notify_on_sent_home":{"type":"boolean","default":true,"description":"Raise the guardian-notice action when a visit ends sent_home"},"notify_on_referral":{"type":"boolean","default":true,"description":"Raise the guardian-notice action on hospital_referral"},"sick_pass_ttl_hours":{"type":"number","default":8,"description":"Sick-pass validity window (hours)"}}},"data":{"schema":"plugin_clinic.visit, plugin_clinic.sick_pass (RLS-scoped)","core_refs":["students.id"],"retention":{"on_uninstall":"export_then_purge_30d","note":"health records follow school medical-retention norms; export-then-purge on uninstall"},"residency":["IN"]},"regions":["IN"],"residency":"IN","billing":{"model":"pack","pack":"operations"},"dependencies":[],"defaultEnabled":false}'::jsonb,
  '["students.read","events.emit","audit.request"]'::jsonb
FROM app.tenants t
WHERE NOT EXISTS (SELECT 1 FROM app.plugins p WHERE p.plugin_id='health.clinic');

-- capability contracts (contract-registry pattern)
INSERT INTO app.capability_contracts (tenant_id, capability_id, plugin_id, version, contract)
SELECT t.id, v.cap, 'hr.leave', '1.0.0',
  jsonb_build_object('events', v.cap, 'schema', 'v1', 'source', 'hr.leave', 'consumer', 'ops.timetable (absence_feed=hr.leave)')
FROM app.tenants t
CROSS JOIN (VALUES ('staff.leave.marked.v1'), ('staff.leave.cancelled.v1')) AS v(cap)
WHERE NOT EXISTS (SELECT 1 FROM app.capability_contracts c WHERE c.plugin_id='hr.leave' AND c.capability_id=v.cap);

INSERT INTO app.capability_contracts (tenant_id, capability_id, plugin_id, version, contract)
SELECT t.id, v.cap, 'health.clinic', '1.0.0',
  jsonb_build_object('events', v.cap, 'schema', 'v1', 'source', 'health.clinic', 'notice_path', 'kernel message action → comms rail')
FROM app.tenants t
CROSS JOIN (VALUES ('clinic.visit.logged.v1'), ('clinic.sick_pass.issued.v1')) AS v(cap)
WHERE NOT EXISTS (SELECT 1 FROM app.capability_contracts c WHERE c.plugin_id='health.clinic' AND c.capability_id=v.cap);

-- ── guarded ledger entry (024 precedent) ─────────────────────────────────────────
WITH cands AS (
  SELECT t.id AS tenant_id,
         COALESCE((SELECT a.hash FROM app.audit_log a
                    WHERE a.tenant_id = t.id
                    ORDER BY a.created_at DESC, a.id DESC LIMIT 1), 'GENESIS') AS prev_hash,
         to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at_iso
  FROM app.tenants t
  WHERE NOT EXISTS (
    SELECT 1 FROM app.audit_log x
    WHERE x.tenant_id = t.id AND x.record_type = 'Plugin' AND x.record_ref = 'wave3-hr-clinic@1')
), mat AS (
  SELECT c.tenant_id, c.prev_hash, c.at_iso,
    '{"tenant":"' || c.tenant_id::text
    || '","actor":"migration 029 (plugin factory)","actorRole":"system","action":"Wave-3 close-out: hr.leave v1.0 (staff leave marking + duty roster, staff.leave.marked.v1 on the spine — absence_feed=hr.leave source) + health.clinic v1.0 (infirmary log, sick passes, guardian notices as per-instance kernel message actions clinic.notify.<visitId> executed onto the comms rail)","recordType":"Plugin","recordRef":"wave3-hr-clinic@1","outcome":"plugin_hr.leave · plugin_clinic.visit/sick_pass data planes · per-instance action codes from birth · IST date math · nurse-lane PII tiering","at":"' || c.at_iso || '"}' AS material
  FROM cands c
), hashed AS (
  SELECT m.tenant_id, m.prev_hash, m.at_iso, m.material,
         encode(sha256(convert_to(m.prev_hash || m.material, 'UTF8')), 'hex') AS row_hash
  FROM mat m
)
SELECT * FROM hashed
CROSS JOIN LATERAL app.audit_append(
  hashed.tenant_id, 'migration 029 (plugin factory)', 'system',
  'Wave-3 close-out: hr.leave v1.0 + health.clinic v1.0',
  'Plugin', 'wave3-hr-clinic@1',
  'staff absence facts (timetable absence_feed source) · infirmary log · sick passes · approved guardian notices',
  'Platform §2.4 · DPDP Act 2023 (health PII) · ops.timetable 021 absence_feed contract', false, 'medium',
  'hr.leave 1.0.0 · health.clinic 1.0.0 · ROADMAP COMPLETE after this unit',
  hashed.prev_hash, hashed.row_hash, hashed.at_iso::timestamptz);
