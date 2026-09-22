-- 134 · timetable write model: retirement, section-aware slots, teacher link (M3/M4/F2/G5).
--
-- The audit found that a self-signup school cannot build a timetable: `app.timetable_periods` /
-- `app.timetable_slots` were seed-only, and slots were section-agnostic with a free-text
-- `teacher_name` (section clashes undetectable; the "first-period teacher takes attendance" model
-- impossible). This migration is ADDITIVE and idempotent:
--   · `retired_at` on periods and slots (the app role holds no DELETE — retirement is a status);
--   · `grade`/`section`/`teacher_id` on slots, so a slot belongs to one class-section period and the
--     register owner can be derived from period 1;
--   · a partial unique index that allows ONE subject per class-section period while leaving the
--     existing school-wide (NULL grade/section) rows untouched (Postgres treats NULLs as distinct);
--   · a best-effort, UNAMBIGUOUS teacher-name backfill (never guesses when the name is shared).

BEGIN;

ALTER TABLE app.timetable_periods ADD COLUMN IF NOT EXISTS retired_at timestamptz;
ALTER TABLE app.timetable_slots   ADD COLUMN IF NOT EXISTS retired_at timestamptz;
ALTER TABLE app.timetable_slots   ADD COLUMN IF NOT EXISTS grade   text;
ALTER TABLE app.timetable_slots   ADD COLUMN IF NOT EXISTS section text;
ALTER TABLE app.timetable_slots   ADD COLUMN IF NOT EXISTS teacher_id uuid;

-- teacher_id is a real reference; RESTRICT because the app role can never DELETE a user anyway, and a
-- composite SET NULL would try to null the NOT NULL tenant_id.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tt_slots_teacher_fkey') THEN
    ALTER TABLE app.timetable_slots ADD CONSTRAINT tt_slots_teacher_fkey
      FOREIGN KEY (tenant_id, teacher_id) REFERENCES app.users (tenant_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

-- Active-row indexes (reads filter `retired_at IS NULL`).
CREATE INDEX IF NOT EXISTS tt_periods_active_idx ON app.timetable_periods (tenant_id) WHERE retired_at IS NULL;
CREATE INDEX IF NOT EXISTS tt_slots_active_idx   ON app.timetable_slots (tenant_id) WHERE retired_at IS NULL;
CREATE INDEX IF NOT EXISTS tt_slots_teacher_idx  ON app.timetable_slots (tenant_id, teacher_id) WHERE retired_at IS NULL;

-- One subject per class-section period (Phase B). NULL grade/section rows are school-wide and stay
-- non-conflicting, so seeded tenants keep their existing grid.
CREATE UNIQUE INDEX IF NOT EXISTS tt_slots_class_period_uidx
  ON app.timetable_slots (tenant_id, period_id, day_of_week, grade, section)
  WHERE retired_at IS NULL;

-- Backfill teacher_id only when the free-text name maps to EXACTLY ONE teacher user in the tenant.
UPDATE app.timetable_slots s SET teacher_id = u.id
  FROM app.users u
 WHERE s.teacher_id IS NULL
   AND u.tenant_id = s.tenant_id AND u.role = 'teacher'
   AND lower(u.name) = lower(s.teacher_name)
   AND (SELECT count(*) FROM app.users u2
         WHERE u2.tenant_id = s.tenant_id AND u2.role = 'teacher' AND lower(u2.name) = lower(s.teacher_name)) = 1;

COMMIT;
