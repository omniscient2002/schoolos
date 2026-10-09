-- 143 · Action Plan batch 2: UDISE infra + PTA/SMC meetings + health/meals + staff CPD +
-- fee counter PINs + announcement acks + student APAAR id.
--
-- WHAT THIS ADDS
--   · `app.school_infra` — one row per tenant: UDISE-facing counts (classrooms, labs,
--     toilets, water, playground, boundary, library volumes). Read by office, written by
--     owner/principal/itadmin; the UDISE export can now validate against it.
--   · `app.mtgs` — PTA/SMC meetings (kind, date, minutes, attendees). The fee-hike
--     consultation record lives here, not in chat history.
--   · `app.health_checks` — RBSK/vaccination/general checkups per pupil (clinic lane).
--   · `app.meals` — PM-POSHAN daily serving log (one row per date).
--   · `app.staff_trainings` — CPD ledger (NISHTHA/TET/in-house hours + provider + date).
--   · `app.fee_pins` — per-staff 4-digit counter PIN (scrypt hash only, like passwords) so a
--     borrowed/unlocked phone cannot record a cash payment.
--   · `app.announcement_acks` — diary/circular read+sign receipts (announcement × user, once).
--   · `app.students.apaar_id` — nullable national pupil id (unique per tenant where present).
--
-- LAWS OBEYED
--   · DAT-1: composite (tenant_id, id) UNIQUE everywhere; secrets hashed, never stored.
--   · D-35: app role gets SELECT/INSERT/UPDATE, never DELETE.
--   · 074: every policy routes through app.current_tenant().
--   · Idempotent: IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.

BEGIN;

CREATE TABLE IF NOT EXISTS app.school_infra (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES app.tenants(id),
  classrooms        integer NOT NULL DEFAULT 0 CHECK (classrooms >= 0),
  labs              integer NOT NULL DEFAULT 0 CHECK (labs >= 0),
  toilets_boys      integer NOT NULL DEFAULT 0 CHECK (toilets_boys >= 0),
  toilets_girls     integer NOT NULL DEFAULT 0 CHECK (toilets_girls >= 0),
  drinking_water    boolean NOT NULL DEFAULT false,
  playground        boolean NOT NULL DEFAULT false,
  boundary_wall     boolean NOT NULL DEFAULT false,
  library_volumes   integer NOT NULL DEFAULT 0 CHECK (library_volumes >= 0),
  updated_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS app.mtgs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  kind        text NOT NULL CHECK (kind IN ('PTA','SMC')),
  held_on     date NOT NULL,
  minutes     text NOT NULL,
  attendees   jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS app.health_checks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  student_id  uuid NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('RBSK','vaccination','general')),
  detail      text NOT NULL,
  checked_on  date NOT NULL,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS app.meals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  served_on   date NOT NULL,
  menu        text NOT NULL,
  veg_count   integer NOT NULL DEFAULT 0 CHECK (veg_count >= 0),
  total_count integer NOT NULL DEFAULT 0 CHECK (total_count >= 0),
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, served_on),
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS app.staff_trainings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES app.tenants(id),
  user_id      uuid NOT NULL,
  title        text NOT NULL,
  hours        numeric(6,2) NOT NULL DEFAULT 0 CHECK (hours >= 0),
  provider     text,
  completed_on date,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS app.fee_pins (
  user_id    uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES app.tenants(id),
  pin_hash   text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS app.announcement_acks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES app.tenants(id),
  announcement_id uuid NOT NULL,
  user_id         uuid NOT NULL,
  signed_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, announcement_id, user_id),
  UNIQUE (tenant_id, id)
);

ALTER TABLE app.students ADD COLUMN IF NOT EXISTS apaar_id text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'students_apaar_unique') THEN
    ALTER TABLE app.students ADD CONSTRAINT students_apaar_unique UNIQUE (tenant_id, apaar_id);
  END IF;
END $$;

ALTER TABLE app.school_infra ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.school_infra FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.school_infra;
CREATE POLICY tenant_isolation ON app.school_infra
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.school_infra TO schoolos_app;

ALTER TABLE app.mtgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.mtgs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.mtgs;
CREATE POLICY tenant_isolation ON app.mtgs
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.mtgs TO schoolos_app;

ALTER TABLE app.health_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.health_checks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.health_checks;
CREATE POLICY tenant_isolation ON app.health_checks
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.health_checks TO schoolos_app;

ALTER TABLE app.meals ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.meals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.meals;
CREATE POLICY tenant_isolation ON app.meals
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.meals TO schoolos_app;

ALTER TABLE app.staff_trainings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.staff_trainings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.staff_trainings;
CREATE POLICY tenant_isolation ON app.staff_trainings
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.staff_trainings TO schoolos_app;

ALTER TABLE app.fee_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.fee_pins FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.fee_pins;
CREATE POLICY tenant_isolation ON app.fee_pins
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.fee_pins TO schoolos_app;

ALTER TABLE app.announcement_acks ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.announcement_acks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.announcement_acks;
CREATE POLICY tenant_isolation ON app.announcement_acks
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.announcement_acks TO schoolos_app;

COMMIT;
