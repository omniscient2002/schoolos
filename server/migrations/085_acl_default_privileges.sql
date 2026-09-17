-- 085 · the app schema's DEFAULT PRIVILEGES are now stated, not inherited (PERFECT-100 §6.1 item 2 / D-35).
-- Claimed via .coop/help.md.
--
-- THE LANDMINE. `pg_default_acl` held a row that appears in NO repo file and sits OUTSIDE the migration
-- checksum ledger:
--     postgres | schema=app | type=r | {schoolos_app=arwd/postgres}
-- `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app` grants the app role **INSERT, SELECT, UPDATE and
-- DELETE** on every FUTURE table created in `app` by the `postgres` role. D-35's law is that the app role gets
-- no table-level DELETE, so this rule silently re-arms a privilege the project deliberately removed. It also
-- defeats migration 054, which revokes only `FOR ROLE schoolos`:
--     054: ALTER DEFAULT PRIVILEGES FOR ROLE schoolos IN SCHEMA app REVOKE ALL ON TABLES FROM schoolos_app;
-- A default privilege is keyed by the role that CREATES the object, so revoking the `schoolos` rule left
-- `postgres`'s rule intact. Measured on the dev database, the three rows were:
--     postgres | app | r | {schoolos_app=arwd/postgres}     ← grants DELETE (violates D-35)
--     schoolos | app | S | {schoolos_app=rU/schoolos}       ← sequences: nextval
--     schoolos | app | r | {schoolos_app=arw/schoolos}      ← tables: no DELETE, correct
--
-- WHY THIS IS A STATEMENT OF INTENT, NOT JUST A REVOKE. Revoking the `postgres` rule alone leaves the posture
-- resting on "the migration runner happens to connect as `schoolos`". That is true today — measured: all 46
-- `app` tables are owned by `schoolos` — but it is a property of the connection string, not of the schema, and
-- nobody wrote it down. Worse, the previous partial fix ("revoke the 12 existing grants") could not survive a
-- re-bootstrap, which re-runs on a fresh volume: `scripts/bootstrap.js:40` re-grants
-- `SELECT, INSERT, UPDATE ON ALL TABLES`, which is correct for tables that exist and says NOTHING about tables
-- created later. So this migration states the default privileges EXPLICITLY for the owning role — future
-- tables are born with exactly SELECT/INSERT/UPDATE and no DELETE — and removes the `postgres` rule so a
-- runner connecting as the wrong role cannot resurrect it.
--
-- WHY NOT `REVOKE ALL`: a default privilege of "no grants at all" would make every future table INVISIBLE to
-- the app role until some later migration remembered to grant it, so the next migration that forgets turns
-- into a 500 in production rather than a missing DELETE. Stating the three intended verbs is the D-35 posture
-- AND the working baseline, which is why the ACL test asserts these sets EXACTLY rather than merely asserting
-- the absence of DELETE — an `arw` set that lost its INSERT would be a different outage.

-- ── 1. state the intended default privileges for the schema-owning role ────────────────────────────────
ALTER DEFAULT PRIVILEGES FOR ROLE schoolos IN SCHEMA app
  REVOKE ALL ON TABLES FROM schoolos_app;
ALTER DEFAULT PRIVILEGES FOR ROLE schoolos IN SCHEMA app
  GRANT SELECT, INSERT, UPDATE ON TABLES TO schoolos_app;
-- Sequences need nextval for every serial/identity column; `USAGE` is what 054's baseline established.
ALTER DEFAULT PRIVILEGES FOR ROLE schoolos IN SCHEMA app
  REVOKE ALL ON SEQUENCES FROM schoolos_app;
ALTER DEFAULT PRIVILEGES FOR ROLE schoolos IN SCHEMA app
  GRANT USAGE, SELECT ON SEQUENCES TO schoolos_app;

-- ── 2. the stray `postgres` rule is revoked by BOOTSTRAP, not here ────────────────────────────────────
-- `ALTER DEFAULT PRIVILEGES FOR ROLE postgres` can only be run by the `postgres` role or a superuser, and the
-- migration runner connects with `DATABASE_URL` (role `schoolos`) — this migration attempts it nowhere, because
-- an attempt can only fail. The project already has the right role for it: `scripts/bootstrap.js:10-13`
-- connects with `ADMIN_DATABASE_URL` "as the superuser (role + grant management)", and it is the same file that
-- already establishes the schema's grant baseline — so the revoke lives there, next to the other
-- superuser-only grant work. This matches §6.1 item 2's own wording, which asks for exactly that split:
-- "re-state every revoke in a NEW numbered migration (immune to re-bootstrap)" — i.e. THIS file — plus the
-- superuser revoke.
--
-- The CI assertion added with this migration (`tests/acl-default-privileges.test.js`) fails while any
-- `postgres`-owned default ACL granting DML to `schoolos_app` exists, so the case bootstrap cannot repair is
-- still loud rather than silent.

-- ── 3. VERIFY: the schema now states its own posture, and no DML-granting stray survives ───────────────
DO $$
DECLARE
  bad integer;
  stated integer;
BEGIN
  -- (a) The rule THIS migration states must not grant DELETE to the app role. Scoped to the `schoolos` rows
  --     deliberately: a `postgres`-owned row is not repairable from the migration role, so failing the whole
  --     migration on it would block every future migration until a superuser intervened — the assertion in CI
  --     is the right place for that condition, and it fails there instead (see the header). What is asserted
  --     here is what this file can actually guarantee.
  SELECT count(*) INTO bad
    FROM pg_default_acl d
    JOIN pg_namespace n ON n.oid = d.defaclnamespace
   WHERE n.nspname = 'app'
     AND d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = 'schoolos')
     AND EXISTS (
       SELECT 1 FROM aclexplode(d.defaclacl) a
        WHERE a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'schoolos_app')
          AND a.privilege_type = 'DELETE');
  IF bad > 0 THEN
    RAISE EXCEPTION '085: % stated default ACL row(s) for schoolos in schema app still grant DELETE to '
                    'schoolos_app (D-35) — the app role must never hold table-level DELETE', bad;
  END IF;

  -- (b) The intended posture must actually be STATED for the owning role. Asserting only "no DELETE" would be
  --     satisfied by an empty default ACL, which is the fail-later outage described in the header.
  SELECT count(*) INTO stated
    FROM pg_default_acl d
    JOIN pg_namespace n ON n.oid = d.defaclnamespace
   WHERE n.nspname = 'app'
     AND d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = 'schoolos')
     AND d.defaclobjtype = 'r';
  IF stated = 0 THEN
    RAISE EXCEPTION '085: no table default ACL is stated for role schoolos in schema app — future tables would '
                    'be created with no app-role grants at all (checked %, and none found)', stated;
  END IF;
END $$;
