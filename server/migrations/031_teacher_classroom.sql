-- 031_teacher_classroom.sql — TeacherOS lane TS-1 (retry): teacher.classroom v1.0.0
-- teacher.homework: what was assigned, to which class, by whom (privacy pin: a teacher
--   sees ONLY homework rows with created_by = self; review belongs to the assigning
--   teacher alone — never a colleague).
-- teacher.submission: the student's one-shot answer — UNIQUE(homework_id, student_id)
--   from birth, so a second submit is a 409, not an overwrite. Late detection is
--   decided at insert time (submitted_at > due_at → 'late'). student_id is always the
--   signed-in student's own id (no student_id picker, ever).
-- teacher.leave_request: staff leave (family.view 034 already builds CHILD leave) —
--   rides a per-instance kernel action teacher.leave.<requestId> (UNIQUE(tenant,code)
--   from birth, cycle-5 P1-1); the coordinator approves on the kernel decide door and
--   the decision is mirrored into this row on the next /teacher/leave/mine read.
-- All doors RLS tenant-scoped (house pattern, 001 §tenant_isolation).
BEGIN;

CREATE SCHEMA IF NOT EXISTS teacher;
GRANT USAGE ON SCHEMA teacher TO schoolos_app;

CREATE TABLE IF NOT EXISTS teacher.homework (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  class_grade text NOT NULL,
  subject text NOT NULL,
  title text NOT NULL,
  detail text,
  attachment_ref text,
  due_at timestamptz NOT NULL,
  created_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teacher.submission (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  homework_id uuid NOT NULL REFERENCES teacher.homework(id) ON DELETE CASCADE,
  student_id uuid NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('text','link')),
  content text NOT NULL,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','late','reviewed','graded','resubmit_requested')),
  grade text,
  feedback text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  UNIQUE (homework_id, student_id)
);

CREATE TABLE IF NOT EXISTS teacher.leave_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  teacher_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('sick','casual','earned','duty','comp_off','other')),
  from_date date NOT NULL,
  to_date date NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by uuid,
  decided_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (to_date >= from_date)
);

-- RLS: tenant isolation (house pattern, 001 §tenant_isolation)
DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['homework','submission','leave_request'] LOOP
    EXECUTE format('ALTER TABLE teacher.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON teacher.%I', t);
    EXECUTE format($f$CREATE POLICY tenant_isolation ON teacher.%I
      USING (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)$f$, t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON teacher.homework, teacher.submission, teacher.leave_request TO schoolos_app;

-- two extra demo cast members so the role pins are testable with real logins:
--   a second teacher (review belongs to the assigning teacher ALONE) and a second
--   8-grade student (UNIQUE is per (homework, student) pair, not per homework).
-- Fixed-salt scrypt hashes of the demo password — same format seed.js writes.
INSERT INTO app.users (tenant_id, email, name, role, password_hash)
SELECT u.tenant_id, v.email, v.name, v.role, v.password_hash
FROM app.users u
CROSS JOIN (VALUES
  ('teacher2@meridian.edu', 'Vikram Menon', 'teacher',
   'b7e2c4a0918d6f5e3a2c1b0d9e8f7a6c:8d8cc15e5e5073003db7731c0a672aeeb00c21897c68fc5ced7a9480768b1679aeff31e2fe5eb31810516bd0bdc27d6f52c48931e1f69c22f79035ca99a82b21'),
  ('student2@meridian.edu', 'Diya Nair', 'student',
   '4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c:55e39beec59d57bc2109c10bdfaac04c2a3f8a4e7269dc339a50d8d6b3754eab4de85b94a6508628a5faea3b1d7f809afeb07e9e961166900ae5aef6ca27ec8f')
) AS v(email, name, role, password_hash)
WHERE u.email = 'owner@meridian.edu'
  AND NOT EXISTS (SELECT 1 FROM app.users x WHERE x.tenant_id = u.tenant_id AND x.email = v.email);

-- Diya Nair is an 8-grade roster student by name-match (034 child_link convention);
-- pin her to a real 8 row so submissions resolve (idempotent).
UPDATE app.students s
SET guardian_name = COALESCE(s.guardian_name, 'Guardian of Diya Nair')
WHERE s.tenant_id = (SELECT tenant_id FROM app.users WHERE email='owner@meridian.edu')
  AND s.name = 'Diya Nair' AND s.grade = '8';

-- factory registry row (plugin factory provisions its own rows — 018/024/029/032/034 precedent)
INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, manifest, permissions)
SELECT t.id, 'teacher.classroom', '1.0.0', 'C', 'registered',
  '{"id":"teacher.classroom","name":"Classroom & Homework","version":"1.0.0","kernel":">=1.0.0 <2.0.0","class":"C","trust":"T1","description":"The teacher classroom lane: post homework per class and subject with due dates, one-shot student submissions (text or link) with automatic late detection (submitted_at > due_at → late), the assigning-teacher-only review desk (reviewed / graded / resubmit_requested with grade and feedback), and the pending/reviewed/late/missing inbox. Teacher staff leave rides per-instance kernel actions (teacher.leave.<requestId>, coordinator decides on the kernel door). Privacy pins: students can ONLY submit and always as themselves (UNIQUE(homework_id,student_id) — a second submit is refused, resubmission is requested by the teacher, not allowed through this door); teachers see ONLY the homework they assigned and their own inbox; review belongs to the assigning teacher alone. Contracts: homework.v1, submission.v1, staff.leave.requested.v1.","permissions":["students.read","events.emit","audit.request"],"events":{"subscribe":[],"publish":[{"type":"homework.v1","schema":"v1"},{"type":"submission.v1","schema":"v1"},{"type":"staff.leave.requested.v1","schema":"v1"}]},"eventSubscriptions":[],"slots":[],"routes":[],"widgets":[],"settingsSchema":{"type":"object","properties":{}},"data":{"schema":"teacher.homework, teacher.submission, teacher.leave_request","core_refs":["students.id","users.id"],"retention":{"on_uninstall":"export_then_purge_30d"},"residency":["IN"]},"regions":["IN"],"residency":"IN","billing":{"model":"pack","pack":"teacher"},"dependencies":[],"defaultEnabled":false}'::jsonb,
  '["students.read","events.emit","audit.request"]'::jsonb
FROM app.tenants t
WHERE NOT EXISTS (SELECT 1 FROM app.plugins p WHERE p.plugin_id='teacher.classroom');

INSERT INTO app.capability_contracts (tenant_id, capability_id, plugin_id, version, contract)
SELECT t.id, v.cap, 'teacher.classroom', '1.0.0',
  jsonb_build_object('events', v.cap, 'schema', 'v1', 'source', 'teacher.classroom', 'note', v.note)
FROM app.tenants t
CROSS JOIN (VALUES
  ('homework.v1',             'teacher posts class homework (class_grade, subject, due_at); created_by pins authorship'),
  ('submission.v1',           'student one-shot submission with late detection; review outcome recorded by the assigning teacher'),
  ('staff.leave.requested.v1','teacher self leave raised as per-instance kernel action teacher.leave.<requestId>; coordinator decides')
) AS v(cap, note)
WHERE NOT EXISTS (SELECT 1 FROM app.capability_contracts c WHERE c.plugin_id='teacher.classroom' AND c.capability_id=v.cap);

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
    WHERE x.tenant_id = t.id AND x.record_type = 'Plugin' AND x.record_ref = 'teacher-classroom@1')
), mat AS (
  SELECT c.tenant_id, c.prev_hash, c.at_iso,
    '{"tenant":"' || c.tenant_id::text
    || '","actor":"migration 031 (plugin factory)","actorRole":"system","action":"TeacherOS lane TS-1 (retry) registered: teacher.classroom v1.0.0 (homework posting with due dates · one-shot student submissions with late detection · assigning-teacher-only review desk with grades and resubmit requests · pending/reviewed/late/missing inbox · staff leave via per-instance kernel actions)","recordType":"Plugin","recordRef":"teacher-classroom@1","outcome":"students can ONLY submit, always as themselves (UNIQUE(homework_id,student_id) — a second submit is a 409, resubmission is requested by the teacher, never through this door) · teachers see only homework with created_by=self · review belongs to the assigning teacher alone · submissions RLS tenant-scoped · leave decisions ride the kernel decide door","at":"' || c.at_iso || '"}' AS material
  FROM cands c
), hashed AS (
  SELECT m.tenant_id, m.prev_hash, m.at_iso, m.material,
         encode(sha256(convert_to(m.prev_hash || m.material, 'UTF8')), 'hex') AS row_hash
  FROM mat m
)
SELECT * FROM hashed
CROSS JOIN LATERAL app.audit_append(
  hashed.tenant_id, 'migration 031 (plugin factory)', 'system',
  'TeacherOS lane TS-1 (retry): teacher.classroom v1.0.0 (homework · one-shot submissions · review desk · inbox · staff leave)',
  'Plugin', 'teacher-classroom@1',
  'students can ONLY submit, always as themselves · UNIQUE(homework_id,student_id) one-shot · late detection at insert · assigning-teacher-only review · teacher inbox scoped to created_by · staff leave via per-instance kernel actions',
  'TEACHEROS-PLAN · DPDP Act 2023 · Platform §2.4', false, 'high',
  'teacher.classroom 1.0.0 · TS-1 data plane live (migration 031)',
  hashed.prev_hash, hashed.row_hash, hashed.at_iso::timestamptz);

COMMIT;
