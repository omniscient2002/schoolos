-- 049: RLS tenant isolation for the naked PII tables (Wave C security hardening).
-- Before this migration the plugin PII planes shipped WITHOUT row-level security:
-- every table below carries a tenant_id column, but only the application's
-- WHERE tenant_id=$1 discipline stood between tenants (psql-verified pre-049:
--   relrowsecurity = f, relforcerowsecurity = f, policies = 0 on all nine targets).
-- 001_init.sql:341-363 pinned the core app.* tables with the standard pattern;
-- 049 applies the SAME pattern to everything that was missed.
--
-- Owner paths are unaffected: scripts/bootstrap.js grants the `schoolos` role
-- (the migration + owner-path pool role) BYPASSRLS, so scripts/migrate.js,
-- scripts/seed.js and every owner-path q() ride straight through. Request paths
-- run through withUser() (src/db.js), which sets `schoolos.tenant_id` +
-- `schoolos.role` for the transaction and SET LOCAL ROLE schoolos_app — so the
-- policies below evaluate per-request with the real caller's tenant.

-- ── the five tenant_id-bearing PII tables (001 pattern, verbatim predicates) ──
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('plugin_dpdp',      'consent'),        -- DPDP consent ledger (023)
      ('plugin_dpdp',      'sar'),            -- subject-access requests (023)
      ('plugin_admissions','lead'),           -- guardian PII funnel (018)
      ('plugin_admissions','stage_history'),  -- funnel decision trail (018)
      ('plugin_visitors',  'visit')           -- campus gate passes (024)
    ) AS v(sch, tbl)
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.sch, r.tbl);
    -- FORCE so even the table owner is subject to the policy; the BYPASSRLS
    -- attribute on the owner role keeps owner paths unaffected (001 parity).
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', r.sch, r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I.%I', r.sch, r.tbl);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I.%I
        USING (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)
    $f$, r.sch, r.tbl);
  END LOOP;
END $$;

-- ── app.tenants: the tenant row itself is pinned to its own GUC ────────────────
ALTER TABLE app.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_self ON app.tenants;
CREATE POLICY tenant_self ON app.tenants
  USING (id = current_setting('schoolos.tenant_id', true)::uuid)
  WITH CHECK (id = current_setting('schoolos.tenant_id', true)::uuid);

-- ── auth.revoked_token (038): defense in depth ────────────────────────────────
-- Denylist lookups and revocations go via the owner path today (src/app.js
-- authenticate + logout), so this policy is pure hardening: if a future door
-- moves the lookup to withUser, a caller can only ever see — or write — their
-- own tenant's revocations. The jti index keeps the owner-path lookup O(1).
ALTER TABLE auth.revoked_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.revoked_token FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON auth.revoked_token;
CREATE POLICY tenant_isolation ON auth.revoked_token
  USING (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('schoolos.tenant_id', true)::uuid);

-- ── app.oauth_states (040): GLOBAL BY DESIGN — pre-auth surface ───────────────
-- No tenant_id: states are created before any authentication exists. The value
-- is an opaque CSPRNG token, single-use and 10-minute TTL'd at the callback
-- (src/app.js /auth/google/*); authenticity comes from TTL + single-use, not
-- from row visibility, so the app role gets full visibility. Table grants have
-- existed since 040; this policy is what makes them safe to actually use.
ALTER TABLE app.oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.oauth_states FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS oauth_states_preauth ON app.oauth_states;
CREATE POLICY oauth_states_preauth ON app.oauth_states
  FOR ALL TO schoolos_app
  USING (true) WITH CHECK (true);

-- ── app.schema_migrations: admin-only registry ────────────────────────────────
-- The app role must never read it. migrate.js runs on the owner connection
-- (BYPASSRLS), so the runner is unaffected — verified: scripts/migrate.js uses
-- config.databaseUrl directly (the schoolos owner role). USING(false) turns the
-- bootstrap-time table grant (scripts/bootstrap.js GRANT ... ON ALL TABLES IN
-- SCHEMA app) inert at the row level without revoking anything.
ALTER TABLE app.schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.schema_migrations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_role_denied ON app.schema_migrations;
CREATE POLICY app_role_denied ON app.schema_migrations
  FOR ALL TO schoolos_app
  USING (false) WITH CHECK (false);

-- Post-apply verification (psql):
--   SELECT n.nspname||'.'||c.relname AS rel, c.relrowsecurity AS rls,
--          c.relforcerowsecurity AS forced, count(p.oid) AS policies
--   FROM pg_class c
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--   LEFT JOIN pg_policy p ON p.polrelid = c.oid
--   WHERE (n.nspname, c.relname) IN (
--     ('plugin_dpdp','consent'),('plugin_dpdp','sar'),
--     ('plugin_admissions','lead'),('plugin_admissions','stage_history'),
--     ('plugin_visitors','visit'),('app','tenants'),('auth','revoked_token'),
--     ('app','oauth_states'),('app','schema_migrations'))
--   GROUP BY 1,2,3 ORDER BY 1;
--   → expect rls = t, forced = t, policies = 1 on every row.
