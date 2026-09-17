-- 083 · PRD-2 — class assignments exist, so a teacher can mark their own register.
--
-- THE REGISTER (P0): "Teachers cannot mark attendance, because there is no class-assignment model.
-- `POST /attendance/mark` is principal-office-only by design — the code says so — because nothing in the
-- schema can answer 'which classes does this teacher own'. Teachers are 403'd from the register, so the
-- single most-used daily workflow in any school requires a coordinator to do it for every class."
--
-- THE CODE AGREED WITH THE REGISTER, which is why this is a schema migration rather than a permission edit:
-- `routes.js:442-451` refused every non-principal role, and the comment explains why in as many words — the
-- only assignment-shaped surfaces that existed (`app.timetable_slots`, `app.timetable_substitutions`) carry
-- `teacher_name` but **no grade/section binding at all**, so no query could ever have answered the question.
-- Flipping the role check without this table would have replaced a 403 with an unaudited cross-class write.
--
-- WHY A NAME-BASED SHORTCUT WAS REJECTED. `app.timetable_slots.teacher_name` is free text (live values
-- include 'D. Rao', 'V. Sharma', 'Priya Iyer') and `app.users.name` holds 'Priya Iyer' — the two can be made
-- to match today by guessing, which is exactly how a correctness bug gets installed. Attendance ownership
-- keyed on a string match is a rename away from silently reverting every teacher to the principal's office,
-- and a typo away from granting a class to the wrong teacher. This table keys on `teacher_id uuid`, with the
-- tenant-aligned composite FK that 081 made possible.
--
-- THE MODEL IS "FORM TEACHER" (one owner per class), not per-subject. Daily attendance is taken once, by the
-- person who owns the class; per-subject attendance is not how Indian schools run a register, and the
-- timetable has no class column to key it from anyway (verified against the live schema, not assumed).
-- `UNIQUE (tenant_id, grade, section) WHERE active` enforces one owner per class — a partial index rather
-- than a plain one so an assignment can be retired without forfeiting the history of who held it.
--
-- THE SEED IS DELIBERATE AND BOUNDED. A table with no rows would leave the door closed in practice — the
-- same functional dead end wearing better manners — so the four seeded teachers are assigned to the twelve
-- seeded classes (6A-10C) deterministically by email order. This is demo/reference data in the same spirit as
-- migration 009's cast; a real deployment replaces it through `POST /class-assignments`. It is NOT a
-- correctness crutch: the door reads the table on every call, and the test covers the unassigned case too.
CREATE TABLE IF NOT EXISTS app.class_assignments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  teacher_id  uuid NOT NULL,
  grade       text NOT NULL,
  section     text NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  assigned_by uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Tenant-aligned composite FK (DAT-1's shape). Depends on `users_tenant_id_id_key`, added by migration 081,
-- and the DO block below fails loudly rather than silently skipping if 081 has not been applied.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'class_assignments_tenant_teacher_id_fkey') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE c.contype IN ('u','p') AND n.nspname = 'app' AND t.relname = 'users'
        AND (SELECT array_agg(a.attname::text ORDER BY k.ord)
               FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
               JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) = ARRAY['tenant_id','id']
    ) THEN
      RAISE EXCEPTION '083: app.users has no UNIQUE (tenant_id, id) — migration 081 must be applied first';
    END IF;
    ALTER TABLE app.class_assignments
      ADD CONSTRAINT class_assignments_tenant_teacher_id_fkey
      FOREIGN KEY (tenant_id, teacher_id) REFERENCES app.users (tenant_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

-- One owner per class, while still allowing a retired assignment to remain as history.
CREATE UNIQUE INDEX IF NOT EXISTS class_assignments_one_owner_per_class
  ON app.class_assignments (tenant_id, grade, section) WHERE active;

-- The door's query is (tenant_id, teacher_id, active) → classes, so index that shape.
CREATE INDEX IF NOT EXISTS class_assignments_teacher_idx
  ON app.class_assignments (tenant_id, teacher_id) WHERE active;

ALTER TABLE app.class_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.class_assignments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS class_assignments_tenant ON app.class_assignments;
CREATE POLICY class_assignments_tenant ON app.class_assignments
  USING (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('schoolos.tenant_id', true)::uuid);

-- The deterministic seed. Ordered by email so it is reproducible; only applied when the table is still
-- empty, so a deployment that has made its own assignments is never overwritten.
-- `n_teachers` is computed per tenant and the join is skipped entirely for a tenant with none: `c.rn % 0`
-- would raise `division by zero` and roll the whole migration back, so a fresh single-tenant database with no
-- teacher rows must not be able to break the file. (Empty here is a legitimate state — a school that has not
-- hired yet — and its register simply stays principal-only until an assignment exists, which is the door's
-- own documented behaviour.)
INSERT INTO app.class_assignments (tenant_id, teacher_id, grade, section)
SELECT t.tenant_id, t.id, c.grade, c.section
  FROM (
    SELECT id, tenant_id, email,
           row_number() OVER (PARTITION BY tenant_id ORDER BY email) - 1 AS rn,
           count(*)     OVER (PARTITION BY tenant_id)                   AS n_teachers
      FROM app.users WHERE role = 'teacher' AND email LIKE '%@meridian.edu'
  ) t
  JOIN (
    SELECT grade, section, row_number() OVER (ORDER BY grade, section) - 1 AS rn
      FROM (VALUES ('6','A'),('6','B'),('6','C'),('7','A'),('7','B'),('7','C'),
                   ('8','A'),('8','B'),('8','C'),('9','A'),('9','B'),('9','C'),
                   ('10','A'),('10','B'),('10','C')) AS v(grade, section)
  ) c ON t.n_teachers > 0 AND (c.rn % t.n_teachers) = t.rn
 WHERE NOT EXISTS (SELECT 1 FROM app.class_assignments);
