-- 079 · the 13th role: `counselor` in the CHECK constraints (RBAC-2)
--
-- THE DEFECT: the product is designed around a counsellor. Five server gate lists name `'counselor'`
-- (teacher.support's box readers, the concern outcome/closing paths, the safety-box door, the wellbeing
-- plane in student.world) and a shipped screen authorises it (`app/src/screens/student/WellbeingQueue.tsx`
-- STAFF_ROLES). But the role was NOT in `auth.js` ROLES **and** not in these two CHECK constraints, so it
-- could never be issued: the safeguarding surface — the most sensitive data this system holds — had no
-- dedicated, least-privileged role, and the person doing that work had to hold `coordinator` or `itadmin`,
-- inheriting the fee ledger, the audit ledger, clinic write authority and `POST /memory` along with it.
--
-- Widening the constraints is the schema half of the fix (the code half is `auth.js` ROLES,
-- `people.admin`'s derived list, and the client's RoleId). Without this migration, `auth.js` accepting the
-- role only moves the failure from a clean 400 to a 500 at the database, which is what the first attempt at
-- this fix did — measured, not guessed.
--
-- The role list is written in the SAME ORDER as `auth.js` ROLES and the DB CHECK means the two can never
-- drift silently: a role added in code but not here fails loudly at insert time, and this migration is the
-- one place that has to change with it. Idempotent (DROP IF EXISTS then ADD), so migrate replays are safe.
ALTER TABLE app.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE app.users ADD CONSTRAINT users_role_check CHECK (role = ANY (ARRAY[
  'owner'::text, 'principal'::text, 'coordinator'::text, 'counselor'::text, 'finance'::text,
  'admissions'::text, 'transport'::text, 'facilities'::text, 'technician'::text, 'teacher'::text,
  'itadmin'::text, 'parent'::text, 'student'::text]));

ALTER TABLE app.roles DROP CONSTRAINT IF EXISTS roles_base_role_check;
ALTER TABLE app.roles ADD CONSTRAINT roles_base_role_check CHECK (base_role = ANY (ARRAY[
  'owner'::text, 'principal'::text, 'coordinator'::text, 'counselor'::text, 'finance'::text,
  'admissions'::text, 'transport'::text, 'facilities'::text, 'technician'::text, 'teacher'::text,
  'itadmin'::text, 'parent'::text, 'student'::text]));
