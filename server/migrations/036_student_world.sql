-- 036_student_world.sql — StudentOS lane SS-1: student.world v1.0.0
-- The student world on school computers/kiosks (NO personal phones — §78/§79): the
-- student's own home view, homework split digital/paper, own results with plain-language
-- explains, and the self-study plane: mistake notes, flashcards, study tasks, print jobs.
-- Print jobs are SCHOOL-CONTROLLED (office/teacher print them) — the student queues, the
-- school discharges. Wellbeing requests route to the counselor/principal plane.
--
-- Session isolation invariants (§78/§79, shared school computers):
--   · user-owned tables are creator_user_id-scoped and the RLS policy ALSO pins
--     schoolos.user_id (set per-transaction by the student doors via set_config — 032
--     teacher.note precedent). Tenant match alone is never enough for a student's rows.
--   · no cross-student read/write exists anywhere; staff doors only exist for the print
--     queue and the wellbeing plane, both tenant-RLS'd and role-gated at the door.
-- All doors refuse while the plugin row is not enabled (lifecycle gate); all writes audited.
BEGIN;

CREATE SCHEMA IF NOT EXISTS student;
GRANT USAGE ON SCHEMA student TO schoolos_app;

-- ── mistake notes: what went wrong + the correction (exam-prep review plane) ───
CREATE TABLE IF NOT EXISTS student.mistake_note (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id),
  creator_user_id uuid NOT NULL,                     -- app.users.id (strict owner)
  student_id    uuid,                                -- app.students.id when resolvable (demo name-match)
  subject       text NOT NULL,
  topic         text NOT NULL,
  what_wrong    text NOT NULL,
  correction    text NOT NULL,
  lesson        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ── flashcards: own decks (front/back, optional subject/topic for sorting) ─────
CREATE TABLE IF NOT EXISTS student.flashcard (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id),
  creator_user_id uuid NOT NULL,
  student_id    uuid,
  deck          text NOT NULL,
  front         text NOT NULL,
  back          text NOT NULL,
  subject       text,
  topic         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ── study tasks: own checklist (title, due date, done toggle) ──────────────────
CREATE TABLE IF NOT EXISTS student.study_task (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id),
  creator_user_id uuid NOT NULL,
  student_id    uuid,
  title         text NOT NULL,
  due_date      date,
  done          boolean NOT NULL DEFAULT false,
  done_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ── print jobs: student QUEUES, school prints (office/teacher discharges) ──────
-- kind ∈ the printable set; payload carries door-assembled content snapshots. The app
-- role may move status queued→printed (staff door) / queued→cancelled (student door);
-- printed rows are history.
CREATE TABLE IF NOT EXISTS student.print_job (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id),
  creator_user_id uuid NOT NULL,
  student_id    uuid,                                -- resolved student (names the printout)
  kind          text NOT NULL CHECK (kind IN ('timetable','study_plan','checklist','portfolio','mistake_sheet','flashcards','noticeboard')),
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','printed','cancelled')),
  printed_by    uuid,
  printed_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ── wellbeing requests: counselor/principal plane ──────────────────────────────
-- anonymous ⇒ no student identity stored (CHECK-enforced; safety.box precedent) and the
-- audit entry for an anonymous filing is actor 'anonymous (student)' so the ledger never
-- re-identifies a promised-anonymous student.
CREATE TABLE IF NOT EXISTS student.wellbeing_request (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id),
  creator_user_id uuid,                              -- NULL when anonymous
  student_id    uuid,
  category      text NOT NULL CHECK (category IN ('academic_pressure','friendship','bullying','family','health','other')),
  detail        text NOT NULL,
  anonymous     boolean NOT NULL DEFAULT false,
  status        text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','in_support','resolved')),
  handled_by    uuid,
  handled_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wellbeing_anonymous_has_no_identity CHECK (anonymous = false OR (creator_user_id IS NULL AND student_id IS NULL))
);

CREATE INDEX IF NOT EXISTS mistake_tenant_user_idx   ON student.mistake_note (tenant_id, creator_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS flashcard_tenant_user_idx ON student.flashcard (tenant_id, creator_user_id, deck);
CREATE INDEX IF NOT EXISTS task_tenant_user_idx      ON student.study_task (tenant_id, creator_user_id, done, due_date);
CREATE INDEX IF NOT EXISTS print_tenant_status_idx   ON student.print_job (tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS wellbeing_tenant_idx      ON student.wellbeing_request (tenant_id, status, created_at DESC);

-- ── RLS: tenant isolation everywhere (house pattern, 001 §tenant_isolation); the three
-- user-owned study tables ALSO pin schoolos.user_id so a student's rows are invisible to
-- any other user of the same tenant at the DATABASE layer, not just at the door.
DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mistake_note','flashcard','study_task','print_job','wellbeing_request'] LOOP
    EXECUTE format('ALTER TABLE student.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON student.%I', t);
    EXECUTE format($f$CREATE POLICY tenant_isolation ON student.%I
      USING (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)$f$, t);
  END LOOP;
  -- §78/§79 session isolation: strictly-user-owned rows also require the owner GUC
  FOREACH t IN ARRAY ARRAY['mistake_note','flashcard','study_task'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS owner_scoped ON student.%I', t);
    EXECUTE format($f$CREATE POLICY owner_scoped ON student.%I
      USING (creator_user_id = current_setting('schoolos.user_id', true)::uuid)
      WITH CHECK (creator_user_id = current_setting('schoolos.user_id', true)::uuid)$f$, t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON student.mistake_note, student.flashcard, student.study_task TO schoolos_app;
GRANT SELECT, INSERT, UPDATE ON student.print_job, student.wellbeing_request TO schoolos_app;

-- ── factory registry row (plugin factory provisions its own rows — 018/024/029/032/034 precedent)
INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, manifest, permissions)
SELECT t.id, 'student.world', '1.0.0', 'C', 'registered',
  '{"id":"student.world","name":"Student World","version":"1.0.0","kernel":">=1.0.0 <2.0.0","class":"C","trust":"T1","description":"The student world on school computers/kiosks (no personal phones): own home view (next class from the timetable grid + current IST period, today counts, upcoming test, needs-attention, progress directions, bag-for-tomorrow), homework split digital/paper (paper = complete in notebook, teacher marks receipt — no submission flow), own published results with plain-language explains, and the self-study plane: mistake notes, flashcards, study tasks, and school-controlled print jobs (student queues, office/teacher prints) plus a print-ready weekly noticeboard. Wellbeing requests route to the counselor/principal plane; anonymous filings store no student identity. Session isolation on shared machines: user-owned rows are RLS-pinned to schoolos.user_id, every /student/* response is no-store, and GET /student/session drives the kiosk idle-countdown. Contracts: student.home.v1, student.print.v1, student.wellbeing.v1.","permissions":["students.read","events.emit","audit.request"],"events":{"subscribe":[],"publish":[{"type":"student.home.v1","schema":"v1"},{"type":"student.print.v1","schema":"v1"},{"type":"student.wellbeing.v1","schema":"v1"}]},"eventSubscriptions":[],"slots":["settings","reports"],"routes":[],"widgets":[],"settingsSchema":{"type":"object","properties":{"student_idle_timeout_minutes":{"type":"integer","minimum":1,"maximum":120,"default":10}}},"data":{"schema":"student.mistake_note, student.flashcard, student.study_task, student.print_job, student.wellbeing_request","core_refs":["students.id","users.id"],"retention":{"on_uninstall":"export_then_purge_30d"},"residency":["IN"]},"regions":["IN"],"residency":"IN","billing":{"model":"pack","pack":"student"},"dependencies":[],"defaultEnabled":false}'::jsonb,
  '["students.read","events.emit","audit.request"]'::jsonb
FROM app.tenants t
WHERE NOT EXISTS (SELECT 1 FROM app.plugins p WHERE p.plugin_id='student.world');

INSERT INTO app.capability_contracts (tenant_id, capability_id, plugin_id, version, contract)
SELECT t.id, v.cap, 'student.world', '1.0.0',
  jsonb_build_object('events', v.cap, 'schema', 'v1', 'source', 'student.world', 'note', v.note)
FROM app.tenants t
CROSS JOIN (VALUES
  ('student.home.v1','own-data-only kiosk home: next class, today, attention, progress, bag'),
  ('student.print.v1','school-controlled print queue — student queues, staff discharge'),
  ('student.wellbeing.v1','counselor/principal wellbeing plane; anonymous = no identity stored')
) AS v(cap, note)
WHERE NOT EXISTS (SELECT 1 FROM app.capability_contracts c WHERE c.plugin_id='student.world' AND c.capability_id=v.cap);

-- guarded ledger entry (024/029/032/034 precedent — chain-selection must match audit_append's verifier)
WITH cands AS (
  SELECT t.id AS tenant_id,
         COALESCE((SELECT a.hash FROM app.audit_log a
                    WHERE a.tenant_id = t.id
                    ORDER BY a.created_at DESC, a.id DESC LIMIT 1), 'GENESIS') AS prev_hash,
         to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at_iso
  FROM app.tenants t
  WHERE NOT EXISTS (
    SELECT 1 FROM app.audit_log x
    WHERE x.tenant_id = t.id AND x.record_type = 'Plugin' AND x.record_ref = 'student-world@1')
), mat AS (
  SELECT c.tenant_id, c.prev_hash, c.at_iso,
    '{"tenant":"' || c.tenant_id::text
    || '","actor":"migration 036 (plugin factory)","actorRole":"system","action":"StudentOS lane SS-1 registered: student.world v1.0.0 (kiosk home view · homework digital/paper split · own results with plain explains · mistake notes · flashcards · study tasks · school-controlled print queue · weekly print-ready noticeboard · wellbeing plane)","recordType":"Plugin","recordRef":"student-world@1","outcome":"user-owned rows RLS-pinned to schoolos.user_id (§78/§79 session isolation on shared machines) · no cross-student access anywhere · paper homework needs no submission (notebook + teacher receipt) · print jobs school-controlled · anonymous wellbeing stores no identity · graceful degradation when TeacherOS tables are absent","at":"' || c.at_iso || '"}' AS material
  FROM cands c
), hashed AS (
  SELECT m.tenant_id, m.prev_hash, m.at_iso, m.material,
         encode(sha256(convert_to(m.prev_hash || m.material, 'UTF8')), 'hex') AS row_hash
  FROM mat m
)
SELECT * FROM hashed
CROSS JOIN LATERAL app.audit_append(
  hashed.tenant_id, 'migration 036 (plugin factory)', 'system',
  'StudentOS lane SS-1: student.world v1.0.0 (kiosk student world · self-study plane · school-controlled printing · wellbeing)',
  'Plugin', 'student-world@1',
  'owner-scoped RLS via schoolos.user_id · no cross-student access · anonymous wellbeing stores no identity',
  'STUDENTOS-PLAN §78/§79 (shared-machine session isolation) · DPDP Act 2023 · Platform §2.4', false, 'high',
  'student.world 1.0.0 · SS-1 data plane live (migration 036)',
  hashed.prev_hash, hashed.row_hash, hashed.at_iso::timestamptz);

COMMIT;
