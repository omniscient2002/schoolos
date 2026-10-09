-- 140 · the roster's class and section become REFERENCES (P2-3) + the fields an Indian school
-- cannot enrol a child without (P2-7).
--
-- WHY. `app.classes` / `app.sections` have existed since migration 135 and are already maintained
-- by `PUT /school/classes`, but `app.students.grade` / `.section` stayed free TEXT. Every
-- read therefore has to re-derive the join by string, which is the root cause behind F-2 (the
-- library borrower picker 500'd sorting `Grade NaN-A`) and F-4 (`Grade NaN-A` on the attendance
-- register) — and it keeps producing new instances of the same class of bug.
--
-- WHAT THIS DOES, and what it deliberately does not do:
--   · adds `class_id` / `section_id` as composite-FK references to the structure tables;
--   · keeps `grade` / `section` in place, still populated, as the DENORMALISED DISPLAY VALUE —
--     every screen, report and export reads them, and this is not the migration to change that;
--   · makes the ids self-maintaining with a trigger, so EVERY writer (doors, the CSV import, the
--     admissions funnel, class transfers, direct SQL in ops scripts) gets them right without
--     having to know they exist. That is the difference between a real invariant and a column
--     two writers remember to fill;
--   · adds `dob` and `gender`. Date of birth is not optional for a school in India (TCS, age-based
--     admissions, transport eligibility, meal schemes, statutory returns) and there was nowhere to
--     record it at all — not in the model, not in the form.
--
-- ADDITIVE and idempotent. The trigger never raises: a grade with no matching class (a school that
-- has not defined its structure yet — structure is optional at onboarding) leaves `class_id` NULL
-- rather than blocking the enrolment. P2-6's door-level validation is the guard that refuses a
-- class the school does not have; this is bookkeeping, not a gate.

BEGIN;

-- ── the references ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE app.students ADD COLUMN IF NOT EXISTS class_id  uuid;
ALTER TABLE app.students ADD COLUMN IF NOT EXISTS section_id uuid;

-- ── the statutory enrolment fields (P2-7) ───────────────────────────────────────────────────────
ALTER TABLE app.students ADD COLUMN IF NOT EXISTS dob     date;
ALTER TABLE app.students ADD COLUMN IF NOT EXISTS gender  text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'students_gender_check') THEN
    ALTER TABLE app.students ADD CONSTRAINT students_gender_check
      CHECK (gender IS NULL OR gender IN ('female', 'male', 'other')) NOT VALID;
  END IF;
END $$;

-- dob sanity: a date of birth is in the past and not absurd (a 5-year-old is a nursery admission,
-- and the door — not this constraint — asks for a date at all).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'students_dob_past_check') THEN
    ALTER TABLE app.students ADD CONSTRAINT students_dob_past_check
      CHECK (dob IS NULL OR (dob < CURRENT_DATE AND dob > DATE '1900-01-01')) NOT VALID;
  END IF;
END $$;

-- ── backfill from the structure tables (idempotent: only rows still unresolved) ──────────────────
UPDATE app.students s SET class_id = c.id
  FROM app.classes c
 WHERE c.tenant_id = s.tenant_id AND c.name = s.grade AND s.class_id IS NULL;

UPDATE app.students s SET section_id = sec.id
  FROM app.sections sec
 WHERE sec.tenant_id = s.tenant_id
   AND sec.class_id = s.class_id
   AND sec.name = s.section
   AND s.section_id IS NULL;

-- ── the references are real (composite FK: same tenant, no cross-school join) ───────────────────
-- `app.sections` has UNIQUE (tenant_id, class_id, name) but not the (tenant_id, id) pair a composite
-- FK needs, so add it first — the same legal-target pattern migration 135 used for classes.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'sections_tenant_id_id_key' AND contype = 'u') THEN
    ALTER TABLE app.sections ADD CONSTRAINT sections_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'students_class_fkey') THEN
    ALTER TABLE app.students ADD CONSTRAINT students_class_fkey
      FOREIGN KEY (tenant_id, class_id) REFERENCES app.classes (tenant_id, id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'students_section_fkey') THEN
    ALTER TABLE app.students ADD CONSTRAINT students_section_fkey
      FOREIGN KEY (tenant_id, section_id) REFERENCES app.sections (tenant_id, id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS students_class_idx  ON app.students (tenant_id, class_id)  WHERE class_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS students_section_idx ON app.students (tenant_id, section_id) WHERE section_id IS NOT NULL;

-- ── the invariant: text in, references out, for every writer ────────────────────────────────────
CREATE OR REPLACE FUNCTION app.sync_student_class_ref() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- grade/section are what every door sends and what every report reads, so they decide.
  IF NEW.class_id IS NULL AND NEW.grade IS NOT NULL AND btrim(NEW.grade) <> '' THEN
    SELECT c.id INTO NEW.class_id FROM app.classes c
     WHERE c.tenant_id = NEW.tenant_id AND c.name = btrim(NEW.grade) LIMIT 1;
  END IF;
  -- a section always belongs to the pupil's class: if the class reference moved, drop a section
  -- reference that no longer belongs to it rather than pointing at the wrong class's section.
  IF NEW.section_id IS NOT NULL AND NEW.class_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM app.sections sec
                    WHERE sec.id = NEW.section_id AND sec.tenant_id = NEW.tenant_id
                      AND sec.class_id = NEW.class_id) THEN
      NEW.section_id := NULL;
    END IF;
  END IF;
  IF NEW.section_id IS NULL AND NEW.class_id IS NOT NULL AND NEW.section IS NOT NULL AND btrim(NEW.section) <> '' THEN
    SELECT sec.id INTO NEW.section_id FROM app.sections sec
     WHERE sec.tenant_id = NEW.tenant_id AND sec.class_id = NEW.class_id
       AND sec.name = btrim(NEW.section) LIMIT 1;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS students_sync_class_ref ON app.students;
CREATE TRIGGER students_sync_class_ref
  BEFORE INSERT OR UPDATE OF tenant_id, grade, section, class_id, section_id ON app.students
  FOR EACH ROW EXECUTE FUNCTION app.sync_student_class_ref();

COMMIT;