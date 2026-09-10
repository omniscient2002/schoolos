-- 054 · security sprint (L1 lane; D-1: several independent security fixes share
-- this file — they are independent and order-tolerant within it).
--
--   T102 (§7 P0-1) · Visitor pickup OTPs leave the LOGIN vault. ops.visitors had
--     drifted into INSERTing guardian pickup codes into app.auth_otps (the login
--     OTP vault, 008) — a front-desk pickup code could then be redeemed at
--     /auth/otp/verify for a full guardian session. plugin_visitors.pickup_otp
--     (024) is the purpose-built, kernel-only vault for exactly this; 054 hardens
--     it (FORCE RLS + partial index), repoints the vault reference comment, and
--     PURGES every pickup row that already landed in the login vault.
--   T106 (§8 D-2) · RLS on plugin_razorpay.order_log / webhook_log (missed by the
--     049 sweep; money-adjacent gateway payloads) + DELETE stripped from the
--     plugin rail's grants (code paths use SELECT/INSERT/UPDATE only).
--   T107 (§8 D-1) · Grant re-baseline: kill the 005 default-privilege trap and
--     re-grant intended rights per table. Zero DELETEs are exercised by the app
--     role anywhere in schema app (grep-verified: only student.world's own schema
--     and two owner-path q() sites use DELETE), so the re-baseline grants
--     SELECT/INSERT/UPDATE broadly and tightens the ledger/vault/config tables.
--   T108 (§8 D-12) · Case-insensitive email uniqueness inside a tenant. The index
--     name is load-bearing: onboarding.js maps 23505 whose constraint matches
--     /users_.*unique|unique.*users_/i to a 409 — keep the shape.
--   T109 (§8 D-14) · audit_append pins p_tenant to the caller's
--     schoolos.tenant_id GUC unless the session role can bypass RLS (owner paths:
--     migrations, seed, bootstrap). The app role can no longer forge an audit row
--     into another tenant's hash chain.

-- ── T102 ─ visitor pickup OTP vault split ──────────────────────────────────────
ALTER TABLE plugin_visitors.pickup_otp FORCE ROW LEVEL SECURITY;
-- The vault is FK-FREE on purpose (008 kernel-vault parity): the handler holds
-- `FOR UPDATE` on plugin_visitors.visit inside the withUser transaction while the
-- vault INSERT rides the owner-path connection — an FK to visit would demand a
-- KEY SHARE lock on that same row from the second connection and deadlock into a
-- 55P03 lock timeout (verified live). The visit→vault reference rides
-- visit.otp_request_id (plain uuid, 024's original design).
ALTER TABLE plugin_visitors.pickup_otp
  DROP CONSTRAINT IF EXISTS pickup_otp_visit_id_fkey;
-- partial index: the only open-code lookup shape (desk retries / retention sweeps)
CREATE INDEX IF NOT EXISTS pickup_otp_phone_open_idx
  ON plugin_visitors.pickup_otp (phone, created_at DESC)
  WHERE consumed_at IS NULL;
COMMENT ON COLUMN plugin_visitors.visit.otp_request_id IS
  'plugin_visitors.pickup_otp row id (pickup vault reference; 054 split it out of app.auth_otps — P0-1)';

-- Purge pickup OTPs that already landed in the LOGIN vault (pre-054 rows).
-- Marker: visit.otp_request_id points at the vault row the desk raised.
DELETE FROM app.auth_otps o
  USING plugin_visitors.visit v
  WHERE v.otp_request_id = o.id;

-- ── T106 ─ RLS on the Razorpay rail (049 pattern, verbatim predicates) ─────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('plugin_razorpay', 'order_log'),
      ('plugin_razorpay', 'webhook_log')
    ) AS v(sch, tbl)
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.sch, r.tbl);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', r.sch, r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I.%I', r.sch, r.tbl);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I.%I
        USING (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)
    $f$, r.sch, r.tbl);
  END LOOP;
END $$;
REVOKE DELETE ON plugin_razorpay.order_log  FROM schoolos_app;
REVOKE DELETE ON plugin_razorpay.webhook_log FROM schoolos_app;

-- ── T108 ─ case-insensitive email uniqueness per tenant ───────────────────────
-- Drops nothing: 001's case-sensitive UNIQUE (tenant_id, email) stays.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_tenant_unique_lower_idx
  ON app.users (tenant_id, lower(email));

-- ── T109 ─ audit_append tenant pin ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app.audit_append(
  p_tenant uuid, p_actor text, p_actor_role text, p_action text,
  p_record_type text, p_record_ref text, p_reason text, p_policy_ref text,
  p_ai boolean, p_risk text, p_outcome text, p_prev_hash text, p_hash text, p_at timestamptz
) RETURNS app.audit_log
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app
AS $fn$
DECLARE
  prev text;
  row app.audit_log;
  ctx text;
BEGIN
  -- T109 (D-14): a caller reaching this function directly must not be able to
  -- forge rows into another tenant's chain. The pool connects as the `schoolos`
  -- owner and request paths flip to the app role via SET ROLE — so the invoker
  -- is detected through the `role` GUC (session_user would ALWAYS read as the
  -- bypassing pool owner and void the pin). Effective invoker = the SET ROLE
  -- target when one is active, else the session login. Exempt only when that
  -- effective role can bypass RLS (owner paths: migrations, seed, bootstrap).
  IF NOT COALESCE((
    SELECT rolsuper OR rolbypassrls FROM pg_roles
     WHERE rolname = COALESCE(NULLIF(current_setting('role', true), 'none'), session_user)), false) THEN
    ctx := current_setting('schoolos.tenant_id', true);
    IF ctx IS NULL OR ctx = '' OR ctx !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       OR ctx::uuid IS DISTINCT FROM p_tenant THEN
      RAISE EXCEPTION 'audit_append: tenant pin violated (p_tenant % not allowed for this session)', p_tenant
        USING ERRCODE = '42501';
    END IF;
  END IF;
  SELECT hash INTO prev FROM app.audit_log
   WHERE tenant_id = p_tenant ORDER BY created_at DESC, id DESC LIMIT 1;
  IF prev IS NULL THEN prev := 'GENESIS'; END IF;
  IF p_prev_hash IS NOT NULL AND p_prev_hash <> prev THEN
    RAISE EXCEPTION 'audit chain conflict: expected prev %, got %', prev, p_prev_hash;
  END IF;
  INSERT INTO app.audit_log (tenant_id, actor, actor_role, action, record_type, record_ref,
    reason, policy_ref, ai_involved, risk, outcome, prev_hash, hash, created_at)
  VALUES (p_tenant, p_actor, p_actor_role, p_action, p_record_type, p_record_ref,
    p_reason, p_policy_ref, p_ai, p_risk, p_outcome, prev, p_hash, p_at)
  RETURNING * INTO row;
  RETURN row;
END;
$fn$;
ALTER FUNCTION app.audit_append OWNER TO schoolos;
REVOKE ALL ON FUNCTION app.audit_append FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.audit_append TO schoolos_app;

-- ── T107 ─ grant re-baseline for schema app (runs LAST within this file) ──────
-- 1. Kill the 005 trap: future schoolos-created tables are born with NO app-role
--    grants; migrations must grant what their code paths need (D-1: migrations
--    are L1-only this sprint).
ALTER DEFAULT PRIVILEGES FOR ROLE schoolos IN SCHEMA app
  REVOKE ALL ON TABLES FROM schoolos_app;
-- 2. Blank-slate the existing grants, then re-grant intended rights per table.
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM schoolos_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA app TO schoolos_app;
-- 3. Append-only ledger: reads through the door; writes ONLY via audit_append
--    (SECURITY DEFINER — 006 intent, which the broad grants kept undoing).
REVOKE ALL ON app.audit_log FROM schoolos_app;
GRANT SELECT ON app.audit_log TO schoolos_app;
-- 4. Kernel-only secrets (owner-path q() exclusively for WRITES; RLS denies rows):
REVOKE ALL ON app.auth_otps FROM schoolos_app;            -- login OTP vault (008): no access at all
-- oauth_states / schema_migrations keep their documented READ contracts (040 and
-- the 001/005 posture the wave-c suite pins): app-role SELECT only — writes stay
-- owner-path (INSERT/UPDATE/DELETE revoked by the re-baseline above).
REVOKE INSERT, UPDATE, DELETE ON app.oauth_states FROM schoolos_app;
REVOKE INSERT, UPDATE, DELETE ON app.schema_migrations FROM schoolos_app;
REVOKE ALL ON app.ops_counters FROM schoolos_app;         -- metrics flush (050)
-- 5. Tenant config: readable by the app role (RLS tenant_self pins the row),
--    writable only through the owner path (signup) — the app role updates the
--    school profile via /onboard/school (withUser → UPDATE needed).
REVOKE INSERT, DELETE ON app.tenants FROM schoolos_app;
-- 6. Capability contracts are platform-global reads (007); writes are migration-only.
REVOKE INSERT, UPDATE, DELETE ON app.capability_contracts FROM schoolos_app;
-- 7. Constrained-role hygiene outside schema app: the denylist is readable per
--    tenant (049's RLS pin — the wave-c contract) but no longer writable or
--    deletable by the app role (P2: in-tenant DELETE retained since 038);
--    revocations themselves ride the owner path (authenticate + logout via q()).
REVOKE ALL ON auth.revoked_token FROM schoolos_app;
GRANT SELECT ON auth.revoked_token TO schoolos_app;
