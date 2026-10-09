-- 141 · the class/section reference trigger follows a class CHANGE (P2-3, correcting 140).
--
-- 140's trigger resolved `class_id` only when it arrived NULL. On an INSERT that is right, but a
-- class transfer (the "Change a class" door, `POST /students/:id/promote`, the transfer import)
-- UPDATEs `grade` on a row that already carries a reference — so the pupil kept the reference to
-- their old class while the text said otherwise. A reference that can outlive the text it was
-- derived from is worse than no reference: it is a lie that reads as a join.
--
-- The rule, stated once: the TEXT decides. `grade` / `section` are what every door sends and what
-- every report reads, so a change to either re-derives the reference. A reference survives only
-- while it agrees with the text and belongs to the pupil's class.
--
-- APPEND-ONLY. 140 is already applied and its checksum is recorded; editing it would be exactly
-- the silent history rewrite the runner refuses, so the corrected body lands here.

BEGIN;

CREATE OR REPLACE FUNCTION app.sync_student_class_ref() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- A grade (or class) change invalidates the class reference; a section or class change
  -- invalidates the section reference. Re-derive rather than carry a stale id forward.
  IF TG_OP = 'INSERT' THEN
    NEW.class_id := NULL;
    NEW.section_id := NULL;
  ELSE
    IF NEW.grade IS DISTINCT FROM OLD.grade THEN
      NEW.class_id := NULL;
      NEW.section_id := NULL;
    ELSIF NEW.section IS DISTINCT FROM OLD.section OR NEW.class_id IS DISTINCT FROM OLD.class_id THEN
      NEW.section_id := NULL;
    END IF;
  END IF;

  IF NEW.class_id IS NULL AND NEW.grade IS NOT NULL AND btrim(NEW.grade) <> '' THEN
    SELECT c.id INTO NEW.class_id FROM app.classes c
     WHERE c.tenant_id = NEW.tenant_id AND c.name = btrim(NEW.grade) LIMIT 1;
  END IF;

  IF NEW.section_id IS NULL AND NEW.class_id IS NOT NULL
     AND NEW.section IS NOT NULL AND btrim(NEW.section) <> '' THEN
    SELECT sec.id INTO NEW.section_id FROM app.sections sec
     WHERE sec.tenant_id = NEW.tenant_id AND sec.class_id = NEW.class_id
       AND sec.name = btrim(NEW.section) LIMIT 1;
  END IF;

  -- A section reference must belong to the pupil's class; anything else is dropped rather than
  -- pointing at the wrong class's section.
  IF NEW.section_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM app.sections sec
         WHERE sec.id = NEW.section_id AND sec.tenant_id = NEW.tenant_id
           AND sec.class_id = NEW.class_id) THEN
    NEW.section_id := NULL;
  END IF;

  RETURN NEW;
END $$;

COMMIT;