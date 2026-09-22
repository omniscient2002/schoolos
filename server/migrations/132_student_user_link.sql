-- 132 · a stable student ↔ user link (F1).
--
-- Student identity was name-match (duplicate names tie-break on lowest admission_no) across submissions,
-- the missing-inbox and the parent homework bridge. This adds `app.students.user_id`, a composite FK to
-- app.users, and backfills it where the name match is UNAMBIGUOUS (exactly one roster row and one
-- student-role user with that name in the tenant). New students are linked at creation. Idempotent.

BEGIN;

ALTER TABLE app.students ADD COLUMN IF NOT EXISTS user_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'students_user_fkey') THEN
    ALTER TABLE app.students ADD CONSTRAINT students_user_fkey
      FOREIGN KEY (tenant_id, user_id) REFERENCES app.users (tenant_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS students_user_uidx ON app.students (tenant_id, user_id) WHERE user_id IS NOT NULL;

UPDATE app.students s SET user_id = u.id
  FROM app.users u
 WHERE s.user_id IS NULL AND u.tenant_id = s.tenant_id AND u.role = 'student'
   AND lower(u.name) = lower(s.name)
   AND (SELECT count(*) FROM app.students d WHERE d.tenant_id = s.tenant_id AND lower(d.name) = lower(s.name)) = 1
   AND (SELECT count(*) FROM app.users u2 WHERE u2.tenant_id = s.tenant_id AND u2.role = 'student' AND lower(u2.name) = lower(s.name)) = 1;

COMMIT;
