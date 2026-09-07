-- 032: TeacherOS lane TS-2 (server-support) — concerns · anonymous safety box ·
-- doubt routing · interventions · PTM + private teacher notes (plugin factory).
-- Runtime module: server/src/plugins/teacher.support/ (mounted by the loader).
-- Sibling lane: 031 (TS-1) owns teacher.homework/submission/lesson/leave — this unit
-- touches only its OWN schemas/tables; `teacher` schema is created IF NOT EXISTS so
-- either lane may land first (both are idempotent).
--
-- Contents:
--   §1  schemas + data planes (RLS everywhere, audited writes at the doors):
--       teacher.concern (+teacher.concern_status_event APPEND-ONLY — no UPDATE/DELETE
--         grant to the app role; status transitions are event rows, never rewrites)
--       safety.box   — anonymous student reports; NO reporter identity when anonymous
--         (CHECK enforces reporter_anonymous ⇒ reporter_user_id IS NULL; the door also
--         audits anonymous submissions with actor 'anonymous (student)' so the ledger
--         never re-identifies a promised-anonymous reporter — safety_anonymous_audit)
--       support.doubt + support.faq (deterministic timetable routing, no AI)
--       intervention.plan (+intervention.plan_event APPEND-ONLY, same grant shape)
--       ptm.slot + ptm.booking
--       teacher.note — STRICT teacher-only RLS: the policy reads
--         schoolos.user_id (set per-transaction by the note doors via set_config) —
--         even a tenant-matched row is invisible unless the GUC names its owner
--   §2  registry row teacher.support 1.0.0 + capability contracts
--   §3  guarded ledger entry teacher-support@1
-- Lessons carried: per-instance kernel action codes from birth (cycle-5 P1-1 —
-- UNIQUE(tenant_id, code) on app.actions; safety.page.<boxId> / concern.escalate.<id>
-- are instance-keyed), plain-language doors, IST clock, no AI anywhere in the routing.

-- ── §1 · schemas ────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS teacher;
CREATE SCHEMA IF NOT EXISTS safety;
CREATE SCHEMA IF NOT EXISTS support;
CREATE SCHEMA IF NOT EXISTS intervention;
CREATE SCHEMA IF NOT EXISTS ptm;
GRANT USAGE ON SCHEMA teacher, safety, support, intervention, ptm TO schoolos_app;

-- teacher.concern — one-tap staff flag (P10). Current-status pointer lives on the row;
-- every transition appends a status_event row (append-only ledger — the history is
-- never UPDATEd or DELETEd: the app role has no such grant on the events table).
CREATE TABLE IF NOT EXISTS teacher.concern (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id),
  student_id    uuid,                              -- app.students.id (nullable: whole-class flags)
  filed_by      uuid NOT NULL,                     -- app.users.id (staff filer)
  category      text NOT NULL
                CHECK (category IN ('academic','attendance','behaviour','wellbeing','safety','engagement')),
  urgency       text NOT NULL DEFAULT 'normal'
                CHECK (urgency IN ('low','normal','high','critical')),
  detail        text NOT NULL,
  evidence_ref  text,
  status        text NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','routed','in_support','closed')),
  routed_to     uuid,                              -- app.users.id (counselor/principal designee)
  routed_role   text CHECK (routed_role IN ('counselor','principal')),
  routed_by     uuid,
  outcome       text CHECK (outcome IN ('resolved','monitoring','referred_out','escalated')),
  outcome_note  text,
  closed_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS concern_tenant_status_idx ON teacher.concern (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS concern_filed_by_idx ON teacher.concern (tenant_id, filed_by);
CREATE INDEX IF NOT EXISTS concern_routed_to_idx ON teacher.concern (tenant_id, routed_to);
CREATE INDEX IF NOT EXISTS concern_student_idx ON teacher.concern (tenant_id, student_id);

CREATE TABLE IF NOT EXISTS teacher.concern_status_event (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  concern_id  uuid NOT NULL REFERENCES teacher.concern(id),
  from_status text,
  to_status   text NOT NULL,
  note        text,
  actor_id    uuid,                                -- app.users.id; NULL = system
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS concern_event_concern_idx ON teacher.concern_status_event (concern_id, created_at);
-- append-only: SELECT + INSERT only — no UPDATE/DELETE grant exists to lose
GRANT SELECT, INSERT ON teacher.concern, teacher.concern_status_event TO schoolos_app;
ALTER TABLE teacher.concern ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS teacher_concern_tenant_isolation ON teacher.concern;
CREATE POLICY teacher_concern_tenant_isolation ON teacher.concern
  USING (tenant_id = current_setting('schoolos.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('schoolos.tenant_id')::uuid);
ALTER TABLE teacher.concern_status_event ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS teacher_concern_event_tenant_isolation ON teacher.concern_status_event;
CREATE POLICY teacher_concern_event_tenant_isolation ON teacher.concern_status_event
  USING (tenant_id = current_setting('schoolos.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('schoolos.tenant_id')::uuid);

-- safety.box — anonymous student reports (M9.1). Designated-authority read doors;
-- teachers NEVER (door + assign-door both refuse the teacher role). Weekly summary is
-- class/category counts only. Anonymity is structural: no reporter columns besides the
-- nullable identified-reporter pair, and the CHECK makes anonymous ⇒ reporter NULL.
CREATE TABLE IF NOT EXISTS safety.box (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES app.tenants(id),
  reporter_anonymous boolean NOT NULL DEFAULT true,
  reporter_user_id   uuid,                         -- app.users.id ONLY for identified reports
  class_grade        text NOT NULL,
  category           text NOT NULL
                     CHECK (category IN ('bullying','harassment','ragging','abuse','self_harm','substance','facility','transport','other')),
  detail             text NOT NULL,
  severity           text NOT NULL
                     CHECK (severity IN ('low','medium','high','serious')),
  status             text NOT NULL DEFAULT 'submitted'
                     CHECK (status IN ('submitted','assigned','closed')),
  assigned_to        uuid,                         -- app.users.id (counselor designee; never a teacher)
  assigned_by        uuid,
  page_action_id     uuid,                         -- app.actions.id (safety.page.<boxId>)
  closed_at          timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT safety_box_anonymous_has_no_reporter
    CHECK (NOT reporter_anonymous OR reporter_user_id IS NULL)
);
CREATE INDEX IF NOT EXISTS safety_box_tenant_status_idx ON safety.box (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS safety_box_assigned_idx ON safety.box (tenant_id, assigned_to);
GRANT SELECT, INSERT, UPDATE ON safety.box TO schoolos_app;
ALTER TABLE safety.box ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS safety_box_tenant_isolation ON safety.box;
CREATE POLICY safety_box_tenant_isolation ON safety.box
  USING (tenant_id = current_setting('schoolos.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('schoolos.tenant_id')::uuid);

-- support.doubt / support.faq — deterministic doubt routing (timetable subject →
-- teacher; no AI). asked_by keeps the asker's user id for own-doubt reads; student_id
-- is best-effort (students are not 1:1 with users in the seed corpus).
CREATE TABLE IF NOT EXISTS support.doubt (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id),
  asked_by      uuid NOT NULL,                     -- app.users.id
  student_id    uuid,                              -- app.students.id when resolvable
  subject       text NOT NULL,
  topic         text,
  question      text NOT NULL,
  status        text NOT NULL DEFAULT 'routed'
                CHECK (status IN ('routed','answered','promoted')),
  routed_to     uuid,                              -- app.users.id (teacher)
  routed_reason text,
  answered_by   uuid,
  answer        text,
  answered_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS doubt_tenant_status_idx ON support.doubt (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS doubt_routed_to_idx ON support.doubt (tenant_id, routed_to);
CREATE INDEX IF NOT EXISTS doubt_asked_by_idx ON support.doubt (tenant_id, asked_by);

CREATE TABLE IF NOT EXISTS support.faq (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES app.tenants(id),
  subject         text NOT NULL,
  topic           text,
  question        text NOT NULL,
  answer          text NOT NULL,
  source_doubt_id uuid NOT NULL REFERENCES support.doubt(id),
  promoted_by     uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_doubt_id)             -- one FAQ per doubt (promote is idempotent-blocked)
);
CREATE INDEX IF NOT EXISTS faq_tenant_subject_idx ON support.faq (tenant_id, subject);
GRANT SELECT, INSERT, UPDATE ON support.doubt, support.faq TO schoolos_app;
ALTER TABLE support.doubt ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS support_doubt_tenant_isolation ON support.doubt;
CREATE POLICY support_doubt_tenant_isolation ON support.doubt
  USING (tenant_id = current_setting('schoolos.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('schoolos.tenant_id')::uuid);
ALTER TABLE support.faq ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS support_faq_tenant_isolation ON support.faq;
CREATE POLICY support_faq_tenant_isolation ON support.faq
  USING (tenant_id = current_setting('schoolos.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('schoolos.tenant_id')::uuid);

-- intervention.plan (+ append-only plan_event) — Identified→Planned→In-progress→
-- Reassessed→Improved/Continue/Escalate lifecycle (P10).
CREATE TABLE IF NOT EXISTS intervention.plan (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  student_id  uuid NOT NULL,                       -- app.students.id
  owner_id    uuid NOT NULL,                       -- app.users.id (owning teacher)
  objective   text NOT NULL,
  activity    text NOT NULL,
  target_end  date,
  status      text NOT NULL DEFAULT 'identified'
              CHECK (status IN ('identified','planned','in_progress','reassessed','improved','continue','escalate')),
  outcome     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS intervention_plan_student_idx ON intervention.plan (tenant_id, student_id);
CREATE INDEX IF NOT EXISTS intervention_plan_owner_idx ON intervention.plan (tenant_id, owner_id);

CREATE TABLE IF NOT EXISTS intervention.plan_event (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  plan_id     uuid NOT NULL REFERENCES intervention.plan(id),
  from_status text,
  to_status   text NOT NULL,
  note        text,
  actor_id    uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS intervention_event_plan_idx ON intervention.plan_event (plan_id, created_at);
GRANT SELECT, INSERT, UPDATE ON intervention.plan TO schoolos_app;
GRANT SELECT, INSERT ON intervention.plan_event TO schoolos_app;  -- append-only
ALTER TABLE intervention.plan ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS intervention_plan_tenant_isolation ON intervention.plan;
CREATE POLICY intervention_plan_tenant_isolation ON intervention.plan
  USING (tenant_id = current_setting('schoolos.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('schoolos.tenant_id')::uuid);
ALTER TABLE intervention.plan_event ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS intervention_event_tenant_isolation ON intervention.plan_event;
CREATE POLICY intervention_event_tenant_isolation ON intervention.plan_event
  USING (tenant_id = current_setting('schoolos.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('schoolos.tenant_id')::uuid);

-- ptm.slot / ptm.booking — office/teacher publish slots, guardians book their own child.
CREATE TABLE IF NOT EXISTS ptm.slot (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  teacher_id  uuid NOT NULL,                       -- app.users.id
  slot_date   date NOT NULL,                       -- IST calendar day
  start_time  text NOT NULL,                       -- 'HH:MM' (IST wall clock)
  end_time    text NOT NULL,
  status      text NOT NULL DEFAULT 'open'
              CHECK (status IN ('open','booked','cancelled')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (teacher_id, slot_date, start_time)
);
CREATE INDEX IF NOT EXISTS ptm_slot_tenant_date_idx ON ptm.slot (tenant_id, slot_date);

CREATE TABLE IF NOT EXISTS ptm.booking (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  slot_id     uuid NOT NULL REFERENCES ptm.slot(id),
  student_id  uuid NOT NULL,                       -- app.students.id (guardian's own child)
  guardian_id uuid NOT NULL,                       -- app.users.id (booking parent)
  booked_at   timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slot_id)                                 -- one booking per slot
);
CREATE INDEX IF NOT EXISTS ptm_booking_guardian_idx ON ptm.booking (tenant_id, guardian_id);
GRANT SELECT, INSERT, UPDATE ON ptm.slot, ptm.booking TO schoolos_app;
ALTER TABLE ptm.slot ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ptm_slot_tenant_isolation ON ptm.slot;
CREATE POLICY ptm_slot_tenant_isolation ON ptm.slot
  USING (tenant_id = current_setting('schoolos.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('schoolos.tenant_id')::uuid);
ALTER TABLE ptm.booking ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ptm_booking_tenant_isolation ON ptm.booking;
CREATE POLICY ptm_booking_tenant_isolation ON ptm.booking
  USING (tenant_id = current_setting('schoolos.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('schoolos.tenant_id')::uuid);

-- teacher.note — STRICT teacher-only RLS. Tenant isolation is not enough (any staff
-- role shares the tenant GUC), so the policy ALSO requires schoolos.user_id — a
-- per-transaction GUC the note doors set from the authenticated caller. The app role
-- cannot read/write another teacher's notes even with the tenant GUC set; the
-- kernel/owner connection (q) remains the only bypass (backoffice/migration lane).
CREATE TABLE IF NOT EXISTS teacher.note (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  teacher_id  uuid NOT NULL,                       -- app.users.id (owner of the note)
  booking_id  uuid,                                -- ptm.booking.id when meeting-scoped
  student_id  uuid,                                -- app.students.id when student-scoped
  note        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS teacher_note_booking_idx ON teacher.note (tenant_id, booking_id);
CREATE INDEX IF NOT EXISTS teacher_note_teacher_idx ON teacher.note (tenant_id, teacher_id);
GRANT SELECT, INSERT ON teacher.note TO schoolos_app;
ALTER TABLE teacher.note ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS teacher_note_strict_owner ON teacher.note;
CREATE POLICY teacher_note_strict_owner ON teacher.note
  USING (tenant_id = current_setting('schoolos.tenant_id')::uuid
         AND teacher_id = nullif(current_setting('schoolos.user_id', true), '')::uuid)
  WITH CHECK (tenant_id = current_setting('schoolos.tenant_id')::uuid
         AND teacher_id = nullif(current_setting('schoolos.user_id', true), '')::uuid);

-- ── §2 · registry row + capability contracts (018/021/024/029 precedent) ───────
INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, manifest, permissions)
SELECT t.id, 'teacher.support', '1.0.0', 'C', 'registered',
  '{"id":"teacher.support","name":"Teacher Support & Safeguarding","version":"1.0.0","kernel":">=1.0.0 <2.0.0","class":"C","trust":"T1","description":"One-tap concerns with append-only status events and coordinator routing (counselor/principal designees), the anonymous student safety box (reporter identity never stored for anonymous reports; serious severity raises the per-instance kernel page safety.page.<boxId> to the principal; designated-authority reads only — never teachers; weekly pattern summary counts classes/categories, never people), deterministic doubt routing over timetable data (no AI) with FAQ promotion, intervention plans with an append-only lifecycle, and PTM slots/bookings with strictly teacher-private notes (RLS-pinned to schoolos.user_id). Comms templates: concern.routed.v1, ptm.invite.v1.","permissions":["students.read","users.read","events.emit","audit.request"],"events":{"subscribe":[],"publish":[{"type":"concern.filed","schema":"v1"},{"type":"concern.routed","schema":"v1"},{"type":"concern.closed","schema":"v1"},{"type":"safety.report.filed","schema":"v1"},{"type":"safety.page.raised","schema":"v1"},{"type":"doubt.routed","schema":"v1"},{"type":"doubt.answered","schema":"v1"},{"type":"doubt.faq.promoted","schema":"v1"},{"type":"intervention.status.changed","schema":"v1"},{"type":"ptm.slot.published","schema":"v1"},{"type":"ptm.booked","schema":"v1"}]},"eventSubscriptions":[],"slots":["settings","reports"],"routes":[],"widgets":[],"settingsSchema":{"type":"object","properties":{"escalate_on_critical":{"type":"boolean","default":true,"description":"Raise the per-instance concern.escalate.<id> kernel action when a concern is critical or safety-category"},"page_on_serious":{"type":"boolean","default":true,"description":"Raise the per-instance safety.page.<boxId> kernel page to the principal when a safety report is serious"}}},"data":{"schema":"teacher.concern(+status_events), safety.box, support.doubt, support.faq, intervention.plan(+events), ptm.slot, ptm.booking, teacher.note (RLS-scoped; notes teacher-only)","core_refs":["students.id","users.id"],"retention":{"on_uninstall":"export_then_purge_30d","note":"safety box follows safeguarding retention norms; export-then-purge on uninstall"},"residency":["IN"]},"regions":["IN"],"residency":"IN","billing":{"model":"pack","pack":"operations"},"dependencies":[],"defaultEnabled":false}'::jsonb,
  '["students.read","users.read","events.emit","audit.request"]'::jsonb
FROM app.tenants t
WHERE NOT EXISTS (SELECT 1 FROM app.plugins p WHERE p.plugin_id='teacher.support' AND p.tenant_id = t.id);

INSERT INTO app.capability_contracts (tenant_id, capability_id, plugin_id, version, contract)
SELECT t.id, v.cap, 'teacher.support', '1.0.0',
  jsonb_build_object('events', v.cap, 'schema', 'v1', 'source', 'teacher.support',
    'note', v.note)
FROM app.tenants t
CROSS JOIN (VALUES
  ('concern.filed.v1',              'teacher one-tap concern flag; status transitions append teacher.concern_status_event rows (append-only)'),
  ('concern.routed.v1',             'coordinator routes to a counselor/principal designee; comms template concern.routed.v1 (staff queue notice)'),
  ('safety.report.filed.v1',        'anonymous student safety report; reporter identity never stored when anonymous (CHECK-pinned)'),
  ('safety.page.raised.v1',         'serious severity raises kernel action safety.page.<boxId> (UNIQUE(tenant,code) per-instance, cycle-5 P1-1)'),
  ('doubt.routed.v1',               'deterministic timetable subject→teacher routing; no AI'),
  ('doubt.faq.promoted.v1',         'answered doubt promoted to support.faq (UNIQUE(tenant,source_doubt_id))'),
  ('intervention.status.changed.v1','append-only intervention.plan_event lifecycle'),
  ('ptm.booked.v1',                 'guardian books own child; comms template ptm.invite.v1 (transactional receipt)'),
  ('teacher.note.private.v1',       'PTM notes RLS-pinned to schoolos.user_id — strictly teacher-only')
) AS v(cap, note)
WHERE NOT EXISTS (SELECT 1 FROM app.capability_contracts c WHERE c.plugin_id='teacher.support' AND c.capability_id=v.cap AND c.tenant_id = t.id);

-- ── §3 · guarded ledger entry (024/029 precedent) ───────────────────────────────
WITH cands AS (
  SELECT t.id AS tenant_id,
         COALESCE((SELECT a.hash FROM app.audit_log a
                    WHERE a.tenant_id = t.id
                    ORDER BY a.created_at DESC, a.id DESC LIMIT 1), 'GENESIS') AS prev_hash,
         to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at_iso
  FROM app.tenants t
  WHERE NOT EXISTS (
    SELECT 1 FROM app.audit_log x
    WHERE x.tenant_id = t.id AND x.record_type = 'Plugin' AND x.record_ref = 'teacher-support@1')
), mat AS (
  SELECT c.tenant_id, c.prev_hash, c.at_iso,
    '{"tenant":"' || c.tenant_id::text
    || '","actor":"migration 032 (plugin factory)","actorRole":"system","action":"TeacherOS lane TS-2 registered: teacher.support v1.0.0 (one-tap concerns with append-only status events · anonymous safety box with structural no-reporter anonymity + per-instance principal page safety.page.<boxId> · deterministic doubt routing + FAQ · intervention plans with append-only lifecycle · PTM slots/bookings + strictly teacher-private notes)","recordType":"Plugin","recordRef":"teacher-support@1","outcome":"teacher/safety/support/intervention/ptm data planes RLS-scoped · concern+plan event tables append-only by grant · teacher.note RLS-pinned to schoolos.user_id · per-instance kernel action codes from birth · comms templates concern.routed.v1 + ptm.invite.v1","at":"' || c.at_iso || '"}' AS material
  FROM cands c
), hashed AS (
  SELECT m.tenant_id, m.prev_hash, m.at_iso, m.material,
         encode(sha256(convert_to(m.prev_hash || m.material, 'UTF8')), 'hex') AS row_hash
  FROM mat m
)
SELECT * FROM hashed
CROSS JOIN LATERAL app.audit_append(
  hashed.tenant_id, 'migration 032 (plugin factory)', 'system',
  'TeacherOS lane TS-2: teacher.support v1.0.0 (concerns · safety box · doubts · interventions · PTM)',
  'Plugin', 'teacher-support@1',
  'append-only concern/plan lifecycles · structural safety-box anonymity · designated-only box reads (never teachers) · teacher-private notes · per-instance action codes',
  'TEACHEROS-PLAN §3-5 · M9.1/M9.2 · M13.2 · DPDP Act 2023 · Platform §2.4', false, 'high',
  'teacher.support 1.0.0 · TS-2 data plane live (migration 032)',
  hashed.prev_hash, hashed.row_hash, hashed.at_iso::timestamptz);
