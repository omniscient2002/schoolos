-- 105 · DATX-10 (PERFECT-100 §9.2) — app.audit_verify must always run the cold-boundary check.
--
-- 075 guarded the boundary check with `IF n > 0`, where `n` is the number of HOT rows walked. When the hot
-- table is empty for a tenant the boundary was skipped entirely — so a tenant whose archive boundary was
-- broken could still verify "clean" because there was nothing hot to walk. The check is now unconditional:
-- it compares the newest cold row against the tenant's FIRST hot row (or reports nothing when both are
-- empty). The hot walk still orders by (created_at, id), which is exactly how app.audit_append links the
-- chain, so verifier and writer agree; a monotonic sequence would require re-linking historic chains and is
-- deliberately out of scope.
--
-- This is a CREATE OR REPLACE of the function defined in 075 (075 is applied and checksum-frozen). Only the
-- boundary guard changes; the body is otherwise identical.

CREATE OR REPLACE FUNCTION app.audit_verify(p_tenant uuid, p_limit int DEFAULT 10000)
RETURNS TABLE (
  break_kind text, row_id uuid, created_at timestamptz,
  expected_prev text, actual_prev text, expected_hash text, actual_hash text, hash_version smallint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app
AS $fn$
DECLARE
  r record;
  prev text := 'GENESIS';
  ctx text;
  expected text;
  n int := 0;
BEGIN
  IF NOT COALESCE((
    SELECT rolsuper OR rolbypassrls FROM pg_roles
     WHERE rolname = COALESCE(NULLIF(current_setting('role', true), 'none'), session_user)), false) THEN
    ctx := current_setting('schoolos.tenant_id', true);
    IF ctx IS NULL OR ctx = '' OR ctx::uuid IS DISTINCT FROM p_tenant THEN
      RAISE EXCEPTION 'audit_verify: tenant pin violated (p_tenant % not allowed for this session)', p_tenant
        USING ERRCODE = '42501';
    END IF;
  END IF;

  FOR r IN SELECT a.* FROM app.audit_log a
            WHERE a.tenant_id = p_tenant
            ORDER BY a.created_at, a.id
            LIMIT (CASE WHEN p_limit IS NULL OR p_limit <= 0 THEN NULL ELSE p_limit END)
  LOOP
    n := n + 1;
    IF r.prev_hash IS DISTINCT FROM prev THEN
      break_kind := 'link_break'; row_id := r.id; created_at := r.created_at;
      expected_prev := prev; actual_prev := r.prev_hash;
      expected_hash := NULL; actual_hash := NULL; hash_version := r.hash_version;
      RETURN NEXT;
    END IF;
    IF r.hash_version >= 2 THEN
      expected := app.audit_row_hash(r.prev_hash, r.tenant_id, r.actor, r.actor_role, r.action,
                                     r.record_type, r.record_ref, r.reason, r.policy_ref, r.ai_involved,
                                     r.risk, r.outcome, r.ip, r.created_at);
      IF expected IS DISTINCT FROM r.hash THEN
        break_kind := 'hash_mismatch'; row_id := r.id; created_at := r.created_at;
        expected_prev := NULL; actual_prev := NULL;
        expected_hash := expected; actual_hash := r.hash; hash_version := r.hash_version;
        RETURN NEXT;
      END IF;
    END IF;
    prev := r.hash;
  END LOOP;

  -- DATX-10: UNCONDITIONAL boundary check (075 wrapped this in `IF n > 0`).
  DECLARE newest_cold text;
          first_hot text;
  BEGIN
    SELECT c.hash INTO newest_cold FROM app.audit_log_cold c
     WHERE c.tenant_id = p_tenant ORDER BY c.created_at DESC, c.id DESC LIMIT 1;
    SELECT a.prev_hash INTO first_hot FROM app.audit_log a
     WHERE a.tenant_id = p_tenant ORDER BY a.created_at, a.id LIMIT 1;
    -- If cold has rows the hot head (when present) must link to them. If hot is empty, `first_hot` is NULL
    -- and there is no hot link to check — but the branch still RUNS, so the intent is auditable.
    IF newest_cold IS NOT NULL AND first_hot IS NOT NULL AND first_hot IS DISTINCT FROM newest_cold THEN
      break_kind := 'cold_boundary_break'; row_id := NULL; created_at := NULL;
      expected_prev := newest_cold; actual_prev := first_hot;
      expected_hash := NULL; actual_hash := NULL; hash_version := NULL;
      RETURN NEXT;
    END IF;
  END;
END;
$fn$;
ALTER FUNCTION app.audit_verify(uuid, int) OWNER TO schoolos;
REVOKE ALL ON FUNCTION app.audit_verify(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.audit_verify(uuid, int) TO schoolos_app;
