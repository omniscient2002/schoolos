-- 077 · SEC-2b (UPDATE / SELECT half) — least privilege at COLUMN granularity.
-- Claimed via .coop/help.md. Companion to 072, which closed the DELETE half.
--
-- THE DEFECT: 072 proved the app role must not hold table-level DELETE, but the same
-- over-grant existed for UPDATE and SELECT, where the damage is quieter:
--   · table-level UPDATE on `app.users`  — the table carrying `password_hash` AND `role`.
--     Table-level means EVERY column, including the ones that decide identity and
--     privilege. A bug or an injection that reaches an UPDATE could set `role='principal'`
--     (privilege escalation) or move a row to another `tenant_id`.
--   · table-level UPDATE on `app.enrollment_history` — documented as "written once, never
--     edited". A grant that permits editing a write-once ledger is not least privilege.
--   · table-level UPDATE on `app.files` — written once on upload, never mutated.
--   · table-level SELECT on `app.webhook_subscriptions` — the row holds `sign_secret`,
--     which signs EVERY outbound webhook for that tenant. Anyone who can read it can forge
--     webhooks the tenant's own systems will trust.
--
-- THE RULE: a grant should name the operations the product actually performs, at the
-- granularity it performs them. Postgres supports column-level grants precisely so that
-- "this role may update a user's active flag" does not have to mean "this role may
-- rewrite any user field, including their role".
--
-- EXACT COLUMN LIST, DERIVED FROM THE CODE, NOT FROM GUESSWORK. Every UPDATE against
-- `app.users` in the repository (verified by grep across src/ and scripts/):
--   people.admin/index.js:166  active
--   people.admin/index.js:188  password_hash, force_change
--   app.js:390                 auth_provider
--   app.js:498                 password_hash, session_epoch, force_change
--   app.js:600                 password_hash, session_epoch, force_change
--   app.js:642 / app.js:693    mfa_enrolled_at
--   routes.js:304 / routes.js:316  role_key
-- => {active, password_hash, force_change, auth_provider, session_epoch, mfa_enrolled_at, role_key}
-- and NOTABLY NOT `role`, `id`, `email`, `tenant_id` or `created_at`.
--
-- Some of those updates run on the owner path (`sysq`) and so do not need an app-role
-- grant at all; the columns are granted regardless, because which helper a route uses is
-- an implementation detail that has already changed once in this session (SEC-1) and a
-- refactor must not turn a privilege decision into a runtime 500.
--
-- `app.files` and `app.enrollment_history` are INSERT-only in the entire codebase
-- (files.store/index.js:133; people.admin/index.js:216,395; routes.js:955), so UPDATE is
-- revoked outright rather than narrowed.
--
-- DELIBERATELY OUT OF SCOPE (recorded so it is not mistaken for an oversight):
-- `schoolos_app` keeps table-level SELECT on `app.users`, which includes `password_hash`.
-- Login and password verification legitimately need to read it, and `SELECT *` sites would
-- break under a column-scoped grant, so narrowing that is its own change with its own blast
-- radius. Tracked as a residual in docs/PERFECT-100.md rather than smuggled in here.
--
-- Idempotent: revoke-then-grant always converges to the same ACL.
--
-- NOT FIXABLE HERE: the stray `postgres`-owned default ACL in schema `app`
-- ({schoolos_app=arwd/postgres}) re-grants full DML to the app role on every table created
-- BY postgres, and a migration cannot remove it (that needs superuser or membership in
-- `postgres`; `schoolos` is neither). It appears in no repo file and sits outside the
-- migration checksum ledger. As superuser, run:
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app REVOKE ALL ON TABLES FROM schoolos_app;
-- `tests/acl-column-scope.test.js` guards the EFFECT (no table-level UPDATE/SELECT on these
-- tables) because that is the testable symptom, and goes red the moment the trap re-arms.

-- ── app.users: UPDATE narrowed to the columns the product actually writes ────────────
REVOKE UPDATE ON app.users FROM schoolos_app;
GRANT UPDATE (active, password_hash, force_change, auth_provider, session_epoch, mfa_enrolled_at, role_key)
  ON app.users TO schoolos_app;

-- ── write-once ledgers: no UPDATE at all ────────────────────────────────────────────
REVOKE UPDATE ON app.enrollment_history FROM schoolos_app;
REVOKE UPDATE ON app.files FROM schoolos_app;

-- ── app.webhook_subscriptions: SELECT narrowed so sign_secret is unreadable ──────────
-- The relay/worker that signs payloads runs as the owner (scripts/webhook-worker.js reads
-- sign_secret on the owner connection), and every request-path read of this table already
-- uses `sysq` (app.js:767,773). So the constrained role never needs the secret itself.
REVOKE SELECT ON app.webhook_subscriptions FROM schoolos_app;
GRANT SELECT (id, tenant_id, url, events, active, created_at) ON app.webhook_subscriptions TO schoolos_app;
