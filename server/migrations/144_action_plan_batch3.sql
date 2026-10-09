-- 144 · Action Plan batch 3: NEP pack + transport compliance + payroll ECS (read-only door,
-- no table) + staff QR attendance + DPDP breach log + announcement priority.
--
-- WHAT THIS ADDS
--   · `app.school_r3` — Class-6 third language (R3) per academic year (OASIS R3 sync source).
--   · `app.nep_activities` — bagless-day / art-integration / skill-elective records.
--   · `app.hpc_inputs` — Holistic Progress Card term inputs per pupil (strengths, interests,
--     goals, teacher remark); the card itself is computed live from these + records.
--   · `app.fln_skills` — Foundational Literacy/Numeracy skill levels per pupil (NIPUN).
--   · `app.bus_runs` + `app.boarding` — daily run per route + board/de-board timestamps per pupil.
--   · `app.attendants` — bus attendants (staff-linked or named contractors) + police verification date.
--   · `app.fares` — per-km transport rate per academic year (quote engine reads it).
--   · `app.inspections` — transport inspection log.
--   · `app.staff_attendance` — staff presence per day (QR-scanned or office-marked).
--   · `app.breach_log` — DPDP breach register (found → contained → notified timeline).
--   · `app.announcements.priority` — normal|emergency (emergency: owner/principal, approved at once).
--   · `app.subjects.is_elective/is_skill` — skill-elective flags behind the free-text subject columns.
--
-- LAWS OBEYED
--   · DAT-1 composite UNIQUEs; D-35 no DELETE for app role; 074 app.current_tenant(); idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS app.school_r3 (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id),
  academic_year text NOT NULL,
  language      text NOT NULL,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, academic_year),
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS app.nep_activities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  kind        text NOT NULL CHECK (kind IN ('bagless','art','skill')),
  title       text NOT NULL,
  detail      text,
  held_on     date,
  grades      jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS app.hpc_inputs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES app.tenants(id),
  student_id     uuid NOT NULL,
  term           text NOT NULL,
  strengths      text,
  interests      text,
  goals          text,
  teacher_remark text,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, student_id, term),
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS app.fln_skills (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  student_id  uuid NOT NULL,
  skill       text NOT NULL CHECK (skill IN ('oral_language','print_awareness','phonics','fluency','comprehension','number_sense','measurement','shapes')),
  level       text NOT NULL CHECK (level IN ('beginner','developing','proficient')),
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, student_id, skill),
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS app.bus_runs (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  route_id  uuid NOT NULL,
  ran_on    date NOT NULL,
  started_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, route_id, ran_on),
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS app.boarding (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  run_id      uuid NOT NULL REFERENCES app.bus_runs(id),
  student_id  uuid NOT NULL,
  direction   text NOT NULL CHECK (direction IN ('board','deboard')),
  at          timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  UNIQUE (tenant_id, run_id, student_id, direction),
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS app.attendants (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES app.tenants(id),
  user_id            uuid,
  name               text NOT NULL,
  route_id           uuid,
  police_verified_on date,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS app.fares (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id),
  academic_year text NOT NULL,
  per_km_cents  integer NOT NULL CHECK (per_km_cents >= 0),
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, academic_year),
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS app.inspections (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES app.tenants(id),
  route_id     uuid,
  title        text NOT NULL,
  detail       text,
  inspected_on date NOT NULL,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS app.staff_attendance (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  user_id  uuid NOT NULL,
  day      date NOT NULL,
  source   text NOT NULL CHECK (source IN ('qr','manual')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, day),
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS app.breach_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES app.tenants(id),
  title        text NOT NULL,
  detail       text NOT NULL,
  found_on     date NOT NULL,
  contained_on date,
  notified_on  date,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','contained','closed')),
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

ALTER TABLE app.announcements ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal'
  CHECK (priority IN ('normal','emergency'));
ALTER TABLE app.subjects ADD COLUMN IF NOT EXISTS is_elective boolean NOT NULL DEFAULT false;
ALTER TABLE app.subjects ADD COLUMN IF NOT EXISTS is_skill boolean NOT NULL DEFAULT false;

ALTER TABLE app.school_r3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.school_r3 FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.school_r3;
CREATE POLICY tenant_isolation ON app.school_r3
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.school_r3 TO schoolos_app;

ALTER TABLE app.nep_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.nep_activities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.nep_activities;
CREATE POLICY tenant_isolation ON app.nep_activities
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.nep_activities TO schoolos_app;

ALTER TABLE app.hpc_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.hpc_inputs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.hpc_inputs;
CREATE POLICY tenant_isolation ON app.hpc_inputs
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.hpc_inputs TO schoolos_app;

ALTER TABLE app.fln_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.fln_skills FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.fln_skills;
CREATE POLICY tenant_isolation ON app.fln_skills
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.fln_skills TO schoolos_app;

ALTER TABLE app.bus_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.bus_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.bus_runs;
CREATE POLICY tenant_isolation ON app.bus_runs
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.bus_runs TO schoolos_app;

ALTER TABLE app.boarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.boarding FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.boarding;
CREATE POLICY tenant_isolation ON app.boarding
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.boarding TO schoolos_app;

ALTER TABLE app.attendants ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.attendants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.attendants;
CREATE POLICY tenant_isolation ON app.attendants
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.attendants TO schoolos_app;

ALTER TABLE app.fares ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.fares FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.fares;
CREATE POLICY tenant_isolation ON app.fares
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.fares TO schoolos_app;

ALTER TABLE app.inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.inspections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.inspections;
CREATE POLICY tenant_isolation ON app.inspections
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.inspections TO schoolos_app;

ALTER TABLE app.staff_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.staff_attendance FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.staff_attendance;
CREATE POLICY tenant_isolation ON app.staff_attendance
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.staff_attendance TO schoolos_app;

ALTER TABLE app.breach_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.breach_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.breach_log;
CREATE POLICY tenant_isolation ON app.breach_log
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.breach_log TO schoolos_app;

COMMIT;
