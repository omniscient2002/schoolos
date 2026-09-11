-- 055_academic_year.sql — Wave 2 · L1-2.1: the academic-year entity.
-- The school calendar every money/academic row can finally hang off: fee plans,
-- fee obligations and exam rows gain academic_year_id; exactly ONE year is
-- current per tenant, enforced by a partial unique index (not just door logic —
-- a raw app-role write cannot create a second current either).
-- Post-054 grant law (T107): new tables are born with NO app-role grants, so the
-- needed rights are granted HERE, explicitly, and never via default privileges.

CREATE TABLE IF NOT EXISTS app.academic_years (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  name        text NOT NULL,
  starts_on   date NOT NULL,
  ends_on     date NOT NULL,
  is_current  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT academic_years_range_check CHECK (ends_on > starts_on),
  CONSTRAINT academic_years_tenant_name_uidx UNIQUE (tenant_id, name)
);

-- Single current per tenant — the database, not the door, is the law.
CREATE UNIQUE INDEX IF NOT EXISTS academic_years_one_current_idx
  ON app.academic_years (tenant_id) WHERE is_current;

-- 049 RLS pattern (verbatim): ENABLE + FORCE + one tenant_isolation policy.
ALTER TABLE app.academic_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.academic_years FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.academic_years;
CREATE POLICY tenant_isolation ON app.academic_years
  USING (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('schoolos.tenant_id', true)::uuid);

-- 054 matrix parity: this year's writes go through owner/principal/finance doors
-- (withUser → schoolos_app); every staff role may read the calendar.
GRANT SELECT, INSERT, UPDATE ON app.academic_years TO schoolos_app;

-- Resolution helper: the ONE way callers should ask "which year is current".
-- SECURITY INVOKER on purpose — the caller's RLS/GUC context decides what it
-- sees, exactly like a direct SELECT (no privilege sidestep).
CREATE OR REPLACE FUNCTION app.current_academic_year_id(p_tenant uuid)
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM app.academic_years
   WHERE tenant_id = p_tenant AND is_current
   ORDER BY created_at DESC
   LIMIT 1
$$;

-- Stamp the money/academic rows that belong to a school year (nullable: history
-- predates the entity and stays valid).
ALTER TABLE app.fee_plans        ADD COLUMN IF NOT EXISTS academic_year_id uuid REFERENCES app.academic_years(id);
ALTER TABLE app.fee_obligations  ADD COLUMN IF NOT EXISTS academic_year_id uuid REFERENCES app.academic_years(id);
ALTER TABLE plugin_exams.exam    ADD COLUMN IF NOT EXISTS academic_year_id uuid REFERENCES app.academic_years(id);
CREATE INDEX IF NOT EXISTS fee_obl_ay_idx ON app.fee_obligations (tenant_id, academic_year_id);
CREATE INDEX IF NOT EXISTS fee_plan_ay_idx ON app.fee_plans (tenant_id, academic_year_id);
CREATE INDEX IF NOT EXISTS exam_ay_idx ON plugin_exams.exam (tenant_id, academic_year_id);
