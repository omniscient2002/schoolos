-- 135 · a normalized school structure: classes, sections, subjects (F3).
--
-- The audit found `app.classes` / `app.subjects` did not exist — class structure lived only in
-- `app.tenants.config.setup.sections` (JSONB) and subjects were free text, which is the root cause
-- behind text-matching scopes. This is ADDITIVE and idempotent: it creates real, RLS-scoped tables,
-- backfills them from the tenant config and the live roster, and leaves the JSONB + text columns in
-- place as a denormalized cache during transition. The `/school/classes` door now keeps the tables in
-- sync on every save. No DELETE anywhere (D-35); retirement is `active = false`.

BEGIN;

CREATE TABLE IF NOT EXISTS app.classes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  name        text NOT NULL,
  sort_idx    integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name),
  -- legal FK target for the composite child reference (PostgreSQL requires the exact column list)
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS app.sections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  class_id    uuid NOT NULL,
  name        text NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, class_id, name),
  FOREIGN KEY (tenant_id, class_id) REFERENCES app.classes (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS sections_class_idx ON app.sections (tenant_id, class_id);

CREATE TABLE IF NOT EXISTS app.subjects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  name        text NOT NULL,
  code        text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

-- RLS (tenant_isolation, ENABLE + FORCE) — same shape as the plugin tables (021).
DO $$
DECLARE t text; sch text; tbl text;
BEGIN
  FOREACH t IN ARRAY ARRAY['app.classes','app.sections','app.subjects']
  LOOP
    sch := split_part(t, '.', 1);
    tbl := split_part(t, '.', 2);
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', sch, tbl);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', sch, tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I.%I', sch, tbl);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I.%I
      USING (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)$p$, sch, tbl);
  END LOOP;
END $$;

-- No DELETE for the app role (D-35); bootstrap grants the rest, this keeps the migration self-sufficient.
GRANT SELECT, INSERT, UPDATE ON app.classes, app.sections, app.subjects TO schoolos_app;

-- ── Backfill from the tenant config (the source of truth until now) ─────────────────────────────────
INSERT INTO app.classes (tenant_id, name, sort_idx)
SELECT t.id, c.grade, c.ord
FROM app.tenants t
CROSS JOIN LATERAL (
  SELECT (elem->>'grade') AS grade, (ordinality - 1) AS ord
  FROM jsonb_array_elements(COALESCE(t.config->'setup'->'sections', '[]'::jsonb)) WITH ORDINALITY AS x(elem, ordinality)
  WHERE COALESCE(elem->>'grade', '') <> ''
) c
ON CONFLICT (tenant_id, name) DO NOTHING;

INSERT INTO app.sections (tenant_id, class_id, name)
SELECT t.id, cl.id, s.name
FROM app.tenants t
JOIN app.classes cl ON cl.tenant_id = t.id
CROSS JOIN LATERAL (
  SELECT jsonb_array_elements_text(elem->'sections') AS name
  FROM jsonb_array_elements(COALESCE(t.config->'setup'->'sections', '[]'::jsonb)) AS x(elem)
  WHERE elem->>'grade' = cl.name
) s
WHERE COALESCE(s.name, '') <> ''
ON CONFLICT (tenant_id, class_id, name) DO NOTHING;

-- ── Backfill from the live roster (grades/sections students already carry) ──────────────────────────
INSERT INTO app.classes (tenant_id, name)
SELECT DISTINCT tenant_id, grade FROM app.students
WHERE grade IS NOT NULL AND grade <> ''
ON CONFLICT (tenant_id, name) DO NOTHING;

INSERT INTO app.sections (tenant_id, class_id, name)
SELECT DISTINCT s.tenant_id, c.id, s.section
FROM app.students s
JOIN app.classes c ON c.tenant_id = s.tenant_id AND c.name = s.grade
WHERE s.section IS NOT NULL AND s.section <> ''
ON CONFLICT (tenant_id, class_id, name) DO NOTHING;

-- ── Backfill subjects from the free-text places that already use them ───────────────────────────────
INSERT INTO app.subjects (tenant_id, name)
SELECT DISTINCT tenant_id, subject FROM app.timetable_slots
WHERE subject IS NOT NULL AND subject <> ''
ON CONFLICT (tenant_id, name) DO NOTHING;

DO $$ BEGIN
  IF to_regclass('teacher.homework') IS NOT NULL THEN
    INSERT INTO app.subjects (tenant_id, name)
    SELECT DISTINCT tenant_id, subject FROM teacher.homework
    WHERE subject IS NOT NULL AND subject <> ''
    ON CONFLICT (tenant_id, name) DO NOTHING;
  END IF;
END $$;

COMMIT;
