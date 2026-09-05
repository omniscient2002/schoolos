-- SchoolOS schema v1 — multi-tenant, audit-first.
-- Convention: every tenant table has tenant_id + created_at; RLS enforces isolation.
-- The audit ledger and outbox are append-only (trigger-guarded).

CREATE SCHEMA IF NOT EXISTS app;

-- ============ tenants & users ============
CREATE TABLE IF NOT EXISTS app.tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text UNIQUE NOT NULL,
  name        text NOT NULL,
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id),
  email         text NOT NULL,
  name          text NOT NULL,
  role          text NOT NULL CHECK (role IN ('owner','principal','coordinator','finance','admissions','transport','facilities','technician','teacher','itadmin','parent','student')),
  password_hash text NOT NULL,            -- scrypt: salt:hex
  pg_role       text NOT NULL DEFAULT 'schoolos_app',
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);
CREATE INDEX IF NOT EXISTS users_tenant_idx ON app.users(tenant_id);

-- ============ people & enrollment ============
CREATE TABLE IF NOT EXISTS app.students (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  admission_no text NOT NULL,
  name        text NOT NULL,
  grade       text NOT NULL,
  section     text NOT NULL,
  guardian_name text,
  guardian_phone text,
  bus_route   text,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','alumni','transferred')),
  source      text NOT NULL DEFAULT 'migration',   -- provenance
  source_ref  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, admission_no)
);
CREATE INDEX IF NOT EXISTS students_tenant_grade_idx ON app.students(tenant_id, grade, section);

CREATE TABLE IF NOT EXISTS app.guardians (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  student_id  uuid NOT NULL REFERENCES app.students(id),
  name        text NOT NULL,
  phone       text NOT NULL,
  relation    text NOT NULL DEFAULT 'guardian',
  is_primary  boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS guardians_student_idx ON app.guardians(student_id);

-- ============ attendance ============
CREATE TABLE IF NOT EXISTS app.attendance (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  student_id  uuid NOT NULL REFERENCES app.students(id),
  school_date date NOT NULL,
  status      text NOT NULL CHECK (status IN ('present','absent','late','leave')),
  marked_by   uuid REFERENCES app.users(id),
  marked_at   timestamptz NOT NULL DEFAULT now(),
  note        text,
  UNIQUE (tenant_id, student_id, school_date)
);
CREATE INDEX IF NOT EXISTS attendance_date_idx ON app.attendance(tenant_id, school_date);

-- ============ fees ============
CREATE TABLE IF NOT EXISTS app.fee_plans (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  student_id  uuid NOT NULL REFERENCES app.students(id),
  term        text NOT NULL,
  total_cents bigint NOT NULL,
  installments int NOT NULL DEFAULT 3,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, student_id, term)
);

CREATE TABLE IF NOT EXISTS app.fee_obligations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  student_id  uuid NOT NULL REFERENCES app.students(id),
  term        text NOT NULL,
  label       text NOT NULL,
  due_on      date,
  amount_cents bigint NOT NULL,
  paid_cents  bigint NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','partial','paid','void')),
  source_ref  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fee_obl_student_idx ON app.fee_obligations(tenant_id, student_id);

CREATE TABLE IF NOT EXISTS app.payments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  student_id  uuid NOT NULL REFERENCES app.students(id),
  obligation_id uuid REFERENCES app.fee_obligations(id),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  method      text NOT NULL DEFAULT 'upi',
  gateway_ref text,
  status      text NOT NULL DEFAULT 'created' CHECK (status IN ('created','initiated','confirmed','failed','refunded')),
  receipt_no  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);
CREATE INDEX IF NOT EXISTS payments_obligation_idx ON app.payments(obligation_id);

-- ============ transport ============
CREATE TABLE IF NOT EXISTS app.routes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  code        text NOT NULL,
  name        text NOT NULL,
  vehicle     text,
  capacity    int NOT NULL DEFAULT 40,
  permit_capacity int,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS app.route_stops (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  route_id    uuid NOT NULL REFERENCES app.routes(id) ON DELETE CASCADE,
  seq         int NOT NULL,
  name        text NOT NULL,
  eta_offset_mins int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS app.transport_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  route_id    uuid NOT NULL REFERENCES app.routes(id),
  kind        text NOT NULL,   -- gps_delay | breakdown | boarding
  delay_mins  int,
  note        text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

-- ============ maintenance (assets & work orders) ============
CREATE TABLE IF NOT EXISTS app.assets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  code        text NOT NULL,
  name        text NOT NULL,
  category    text NOT NULL,
  building    text, room text,
  status      text NOT NULL DEFAULT 'operational' CHECK (status IN ('operational','watch','degraded','down','maintenance','retired')),
  health_score int NOT NULL DEFAULT 100,
  installed_on date,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS app.work_orders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  code        text NOT NULL,
  title       text NOT NULL,
  description text,
  category    text NOT NULL,
  priority    text NOT NULL CHECK (priority IN ('emergency','critical','high','medium','low')),
  status      text NOT NULL DEFAULT 'reported' CHECK (status IN ('reported','assigned','accepted','en-route','on-site','repairing','verification','resolved','closed','cancelled')),
  asset_id    uuid REFERENCES app.assets(id),
  assigned_to uuid REFERENCES app.users(id),
  reported_by uuid REFERENCES app.users(id),
  sla_due_at  timestamptz,
  sla_breached boolean NOT NULL DEFAULT false,
  cost_cents  bigint NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS wo_status_idx ON app.work_orders(tenant_id, status);

CREATE TABLE IF NOT EXISTS app.wo_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  wo_id       uuid NOT NULL REFERENCES app.work_orders(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  note        text,
  actor_id    uuid REFERENCES app.users(id),
  created_at  timestamptz DEFAULT now()
);

-- ============ cases & actions ============
CREATE TABLE IF NOT EXISTS app.cases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  code        text NOT NULL,
  kind        text NOT NULL,
  title       text NOT NULL,
  detail      text,
  priority    text NOT NULL DEFAULT 'normal' CHECK (priority IN ('critical','high','normal','low')),
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','triaged','in-progress','resolved','closed')),
  owner       text,
  opened_by   uuid REFERENCES app.users(id),
  origin      text NOT NULL DEFAULT 'staff',
  sla_due_at  timestamptz,
  linked_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS app.actions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  code        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('approval','incident','case','exception','recommendation','reminder')),
  title       text NOT NULL,
  detail      text,
  why         text,
  priority    text NOT NULL DEFAULT 'normal' CHECK (priority IN ('critical','high','normal','low')),
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','approved','dismissed','resolved','completed','expired')),
  owner       text,
  owner_role  text,
  policy_ref  text,
  ai_involved boolean NOT NULL DEFAULT false,
  source_event text,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  deadline    timestamptz,
  decided_by  uuid REFERENCES app.users(id),
  decided_at  timestamptz,
  decision_note text,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (tenant_id, code)
);

-- ============ events, comms, notifications ============
CREATE TABLE IF NOT EXISTS app.events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  type        text NOT NULL,
  label       text NOT NULL,
  severity    text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warn','critical')),
  ref         text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_tenant_time_idx ON app.events(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS app.communications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  audience_kind text NOT NULL DEFAULT 'guardian',
  audience_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  channel     text NOT NULL DEFAULT 'whatsapp',
  template    text,
  body        text NOT NULL,
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','delivered','failed')),
  policy_ref  text,
  dedup_key   text,
  approved_by uuid REFERENCES app.users(id),
  sent_at     timestamptz,
  delivered_at timestamptz,
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  user_id     uuid REFERENCES app.users(id),
  "group"     text NOT NULL DEFAULT 'updates',
  title       text NOT NULL,
  body        text,
  ref         text,
  read_at     timestamptz,
  created_at  timestamptz DEFAULT now()
);

-- ============ audit ledger (append-only) ============
CREATE TABLE IF NOT EXISTS app.audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  actor       text NOT NULL,
  actor_role  text NOT NULL,
  action      text NOT NULL,
  record_type text NOT NULL,
  record_ref  text,
  reason      text,
  policy_ref  text,
  ai_involved boolean NOT NULL DEFAULT false,
  risk        text NOT NULL DEFAULT 'low' CHECK (risk IN ('low','medium','high')),
  outcome     text,
  ip          inet,
  prev_hash   text,
  hash        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_tenant_time_idx ON app.audit_log(tenant_id, created_at DESC);

-- ============ outbox (transactional events for workers) ============
CREATE TABLE IF NOT EXISTS app.outbox (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  topic       text NOT NULL,
  payload     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_unprocessed_idx ON app.outbox(processed_at) WHERE processed_at IS NULL;

-- ============ migration registry (Golden Loop 1) ============
CREATE TABLE IF NOT EXISTS app.migration_sources (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  name        text NOT NULL,
  kind        text NOT NULL,
  row_count   int NOT NULL DEFAULT 0,
  imported    int NOT NULL DEFAULT 0,
  flagged     int NOT NULL DEFAULT 0,
  skipped     int NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','analyzed','mapped','health-check','shadow','verified','activated')),
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz DEFAULT now()
);

-- ============ memory (institutional decisions) ============
CREATE TABLE IF NOT EXISTS app.memory_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  kind        text NOT NULL DEFAULT 'decision',
  title       text NOT NULL,
  body        text,
  evidence    jsonb NOT NULL DEFAULT '[]'::jsonb,
  decided_by  text,
  decided_at  timestamptz DEFAULT now(),
  expected    text,
  actual      text
);

-- ============ RLS: enable + policies ============
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','students','guardians','attendance','fee_plans','fee_obligations','payments',
    'routes','route_stops','transport_events','assets','work_orders','wo_events',
    'cases','actions','events','communications','notifications','audit_log','outbox',
    'migration_sources','memory_entries'
  ] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      DROP POLICY IF EXISTS tenant_isolation ON app.%I
    $f$, t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON app.%I
        USING (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)
    $f$, t);
  END LOOP;
END $$;

-- The outbox is written by triggers/policies as the app role; allow insert+select+update(processed).
-- audit_log: no UPDATE/DELETE policy at all → append-only even for the app role.

-- ============ roles ============
-- The `schoolos_app` role is created by scripts/bootstrap.js (superuser required).
-- This migration only grants privileges if the role exists.

-- NOTE: `ALTER ROLE schoolos BYPASSRLS` is applied by the bootstrap script (superuser required).
