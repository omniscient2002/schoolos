-- 153 · transport at Indian-school scale: fleet registry, crew, shifts, route fares.
--
-- WHAT THIS FIXES (audit 2026-10-09):
--   · No vehicle/driver record existed: `routes.vehicle` was free text ("KA-01-TR"), so fitness / PUC /
--     insurance / permit expiry, GPS+CCTV+governor fitment and driver licence/verification could not be
--     tracked — the exact registers an RTO / district-committee inspection asks for.
--   · One run per route per day (UNIQUE tenant,route,ran_on): a school running a morning pickup AND an
--     afternoon drop could not record the second trip. `shift` (pickup|drop|extra) joins the key.
--   · Boarding had no stop: a timestamp without a place cannot answer "where did the child board".
--   · Fares were one linear ₹/km rate: Indian schools charge per ROUTE per TERM (slab, one-way/two-way).
--     `app.route_fares` carries that; the per-km rate stays as the estimator fallback.
--   · `route_stops.seq` had no uniqueness: concurrent adds could share a seq. Now UNIQUE per route.
--   · New tables follow the house idiom: RLS + FORCE + tenant_isolation, app-role grants (no DELETE —
--     retirement, never deletion), composite (tenant_id,id) uniques so child FKs are tenant-aligned
--     (migration 081), indexes for the RLS-filtered scans (106 precedent).
-- ADDITIVE + IDEMPOTENT: every DDL is IF NOT EXISTS / guarded on pg_constraint. Re-running is a no-op.

-- ── 1 · parents for composite FKs ─────────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('app','route_stops'),
      ('app','vehicles'),
      ('app','drivers')
    ) AS v(sch, tbl) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE c.contype IN ('u','p') AND n.nspname = r.sch AND t.relname = r.tbl
        AND (SELECT array_agg(a.attname::text ORDER BY k.ord)
               FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
               JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum)
            = ARRAY['tenant_id','id']
    ) THEN
      EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I UNIQUE (tenant_id, id)',
                     r.sch, r.tbl, r.tbl || '_tenant_id_id_key');
    END IF;
  END LOOP;
END $$;

-- ── 2 · vehicles: the fleet register ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.vehicles (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES app.tenants(id),
  reg_no             text NOT NULL,
  reg_norm           text GENERATED ALWAYS AS (regexp_replace(upper(reg_no), '[^A-Z0-9]', '', 'g')) STORED,
  kind               text NOT NULL DEFAULT 'owned' CHECK (kind IN ('owned','contract')),
  capacity           int  NOT NULL DEFAULT 40 CHECK (capacity >= 1 AND capacity <= 120),
  permit_capacity    int  CHECK (permit_capacity IS NULL OR (permit_capacity >= 1 AND permit_capacity <= 120)),
  permit_valid_till  date,
  fitness_valid_till date,
  insurance_valid_till date,
  puc_valid_till     date,
  gps_fitted         boolean NOT NULL DEFAULT false,
  cctv_fitted        boolean NOT NULL DEFAULT false,
  speed_governor_fitted boolean NOT NULL DEFAULT false,
  fire_ext_valid_till date,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active','maintenance','retired')),
  retired_at         timestamptz,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, reg_norm)
);

-- ── 3 · drivers: licence + verification on record ─────────────────────────────
CREATE TABLE IF NOT EXISTS app.drivers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES app.tenants(id),
  name                text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  licence_no          text NOT NULL,
  licence_valid_till  date,
  experience_years    int CHECK (experience_years IS NULL OR (experience_years >= 0 AND experience_years <= 60)),
  medical_valid_till  date,
  police_verified_on  date,
  police_valid_till   date,
  phone               text,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  retired_at          timestamptz,
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, licence_no)
);

-- ── 4 · routes gain an optional fleet link (free-text vehicle stays as fallback) ──
ALTER TABLE app.routes ADD COLUMN IF NOT EXISTS vehicle_id uuid;
ALTER TABLE app.routes ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'routes_tenant_vehicle_id_fkey') THEN
    ALTER TABLE app.routes ADD CONSTRAINT routes_tenant_vehicle_id_fkey
      FOREIGN KEY (tenant_id, vehicle_id) REFERENCES app.vehicles (tenant_id, id) ON DELETE NO ACTION;
  END IF;
END $$;

-- ── 5 · runs: shift joins the day key; crew rides along ───────────────────────
ALTER TABLE app.bus_runs ADD COLUMN IF NOT EXISTS shift text NOT NULL DEFAULT 'pickup'
  CHECK (shift IN ('pickup','drop','extra'));
ALTER TABLE app.bus_runs ADD COLUMN IF NOT EXISTS vehicle_id uuid;
ALTER TABLE app.bus_runs ADD COLUMN IF NOT EXISTS driver_id uuid;
ALTER TABLE app.bus_runs ADD COLUMN IF NOT EXISTS attendant_id uuid;
ALTER TABLE app.bus_runs ADD COLUMN IF NOT EXISTS note text;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bus_runs_tenant_id_route_id_ran_on_key') THEN
    ALTER TABLE app.bus_runs DROP CONSTRAINT bus_runs_tenant_id_route_id_ran_on_key;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bus_runs_day_shift_key') THEN
    ALTER TABLE app.bus_runs ADD CONSTRAINT bus_runs_day_shift_key
      UNIQUE (tenant_id, route_id, ran_on, shift);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bus_runs_tenant_vehicle_id_fkey') THEN
    ALTER TABLE app.bus_runs ADD CONSTRAINT bus_runs_tenant_vehicle_id_fkey
      FOREIGN KEY (tenant_id, vehicle_id) REFERENCES app.vehicles (tenant_id, id) ON DELETE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bus_runs_tenant_driver_id_fkey') THEN
    ALTER TABLE app.bus_runs ADD CONSTRAINT bus_runs_tenant_driver_id_fkey
      FOREIGN KEY (tenant_id, driver_id) REFERENCES app.drivers (tenant_id, id) ON DELETE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bus_runs_tenant_attendant_id_fkey') THEN
    ALTER TABLE app.bus_runs ADD CONSTRAINT bus_runs_tenant_attendant_id_fkey
      FOREIGN KEY (tenant_id, attendant_id) REFERENCES app.attendants (tenant_id, id) ON DELETE NO ACTION;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS bus_runs_day_idx ON app.bus_runs (tenant_id, ran_on DESC);
CREATE INDEX IF NOT EXISTS bus_runs_route_day_idx ON app.bus_runs (tenant_id, route_id, ran_on DESC);

-- ── 6 · boarding: the stop is part of the fact ────────────────────────────────
ALTER TABLE app.boarding ADD COLUMN IF NOT EXISTS stop_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'boarding_tenant_stop_id_fkey') THEN
    ALTER TABLE app.boarding ADD CONSTRAINT boarding_tenant_stop_id_fkey
      FOREIGN KEY (tenant_id, stop_id) REFERENCES app.route_stops (tenant_id, id) ON DELETE NO ACTION;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS boarding_run_idx ON app.boarding (tenant_id, run_id);

-- ── 7 · route stops: seq is dense and unique per route ────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'route_stops_route_seq_key') THEN
    ALTER TABLE app.route_stops ADD CONSTRAINT route_stops_route_seq_key
      UNIQUE (tenant_id, route_id, seq);
  END IF;
END $$;

-- ── 8 · route fares: per-route per-term slabs (the way schools actually charge) ──
CREATE TABLE IF NOT EXISTS app.route_fares (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id),
  route_id      uuid NOT NULL,
  academic_year text NOT NULL CHECK (char_length(academic_year) BETWEEN 1 AND 12),
  trip          text NOT NULL DEFAULT 'two_way' CHECK (trip IN ('one_way','two_way')),
  amount_cents  integer NOT NULL CHECK (amount_cents >= 0),
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, route_id, academic_year, trip),
  UNIQUE (tenant_id, id)
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'route_fares_tenant_route_id_fkey') THEN
    ALTER TABLE app.route_fares ADD CONSTRAINT route_fares_tenant_route_id_fkey
      FOREIGN KEY (tenant_id, route_id) REFERENCES app.routes (tenant_id, id) ON DELETE NO ACTION;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS route_fares_route_idx ON app.route_fares (tenant_id, route_id, academic_year);

-- ── 9 · attendants: verification carries an expiry, not just a date ──────────
ALTER TABLE app.attendants ADD COLUMN IF NOT EXISTS police_valid_till date;
ALTER TABLE app.attendants ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE app.attendants ADD COLUMN IF NOT EXISTS retired_at timestamptz;

-- ── 10 · inspections: kind + optional vehicle link ────────────────────────────
ALTER TABLE app.inspections ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'joint'
  CHECK (kind IN ('joint','fitness','permit','puc','insurance','gps_cctv','internal','other'));
ALTER TABLE app.inspections ADD COLUMN IF NOT EXISTS vehicle_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inspections_tenant_vehicle_id_fkey') THEN
    ALTER TABLE app.inspections ADD CONSTRAINT inspections_tenant_vehicle_id_fkey
      FOREIGN KEY (tenant_id, vehicle_id) REFERENCES app.vehicles (tenant_id, id) ON DELETE NO ACTION;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS inspections_vehicle_idx ON app.inspections (tenant_id, vehicle_id);

-- ── 11 · RLS + grants (house pattern: no DELETE for the app role) ────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vehicles','drivers','route_fares'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON app.%I', t);
    EXECUTE format($f$CREATE POLICY tenant_isolation ON app.%I
      USING (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)$f$, t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON app.vehicles, app.drivers, app.route_fares TO schoolos_app;
CREATE INDEX IF NOT EXISTS vehicles_reg_idx ON app.vehicles (tenant_id, reg_norm) WHERE retired_at IS NULL;
CREATE INDEX IF NOT EXISTS drivers_active_idx ON app.drivers (tenant_id) WHERE retired_at IS NULL AND status = 'active';
