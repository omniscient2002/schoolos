-- 148 · Audit ledger carries the caller IP (F-19).
--
-- WHAT THIS ADDS
--   · A 15-argument overload of `app.audit_append(..., p_ip inet)` that stores
--     NEW.ip. The 14-argument version from 075 is left untouched, so migrations,
--     seed scripts and any direct caller keep working byte-identically.
--   · `src/audit.js` passes `entry.ip ?? null`; the BEFORE INSERT trigger
--     (`audit_pin_hash_bi`, 075) already reads NEW.ip into the hash material, so
--     the day something sets it, it is covered automatically (075 §2 said exactly
--     this). `app.audit_verify()` recomputes from stored columns, so it stays
--     consistent for both NULL and populated rows.
--   · Kernel auth doors (login/logout/switch/password/MFA/AI-call, onboarding
--     signup) pass `req.ip`. Plugin and domain doors do not — an IP is
--     meaningful on identity/session events, not on every classroom write.
--
-- LAWS OBEYED
--   · D-35: no grant changes. The function stays SECURITY DEFINER, owner schoolos.
--   · 074: tenant pin is byte-identical to 075 (same T109 comment, same check).
--   · Idempotent: CREATE OR REPLACE throughout; no DDL on tables.

BEGIN;

CREATE OR REPLACE FUNCTION app.audit_append(
  p_tenant uuid, p_actor text, p_actor_role text, p_action text,
  p_record_type text, p_record_ref text, p_reason text, p_policy_ref text,
  p_ai boolean, p_risk text, p_outcome text, p_prev_hash text, p_hash text, p_at timestamptz,
  p_ip inet DEFAULT NULL
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
  -- T109 (D-14) tenant pin — BYTE-IDENTICAL to 075. A direct caller must not be
  -- able to forge rows into another tenant's chain (see 075 for the full note on
  -- why the `role` GUC, not session_user, decides the effective invoker).
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

  -- Serialization lives HERE (075): the JS-side lock never protected migration
  -- replays or seed scripts.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text, 42));

  SELECT hash INTO prev FROM app.audit_log
   WHERE tenant_id = p_tenant ORDER BY created_at DESC, id DESC LIMIT 1;
  IF prev IS NULL THEN prev := 'GENESIS'; END IF;

  -- Kept for compatibility: a caller that read the chain earlier and lost the
  -- race is still told.
  IF p_prev_hash IS NOT NULL AND p_prev_hash <> prev THEN
    RAISE EXCEPTION 'audit chain conflict: expected prev %, got %', prev, p_prev_hash;
  END IF;

  -- prev_hash / hash / hash_version are deliberately NOT in the column list:
  -- audit_pin_hash_bi fills them (and hashes NEW.ip with the rest).
  INSERT INTO app.audit_log (tenant_id, actor, actor_role, action, record_type, record_ref,
    reason, policy_ref, ai_involved, risk, outcome, ip, created_at)
  VALUES (p_tenant, p_actor, p_actor_role, p_action, p_record_type, p_record_ref,
    p_reason, p_policy_ref, p_ai, p_risk, p_outcome, p_ip, COALESCE(p_at, now()))
  RETURNING * INTO row;
  RETURN row;
END;
$fn$;
ALTER FUNCTION app.audit_append(uuid, text, text, text, text, text, text, text, boolean, text, text, text, text, timestamptz, inet) OWNER TO schoolos;

COMMIT;
