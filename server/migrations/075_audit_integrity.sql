-- 075_audit_integrity.sql — SEC-20 / DAT-5: make the audit ledger tamper-EVIDENT, not just append-only.
--
-- WHY THIS EXISTS (measured, not theoretical):
--   app.audit_append (054:80-124) validates p_prev_hash but stores p_hash VERBATIM. The app role
--   holds EXECUTE on that function, so any app-role caller — i.e. any plugin, and any query reachable
--   from a request path — can write a ledger row whose hash IT chose. The row still LINKS correctly
--   (prev_hash is computed server-side), so ordinary "is the chain intact?" checking sees nothing.
--   Reproducing all 53 rows of the dev ledger from their own stored columns: 27 reproduce, 26 do not.
--   For one row ('migration 013 (plugin factory)') the stored hash matches the MIGRATION FILE's
--   `outcome` literal rather than the `outcome` the row now contains — i.e. that row was altered
--   after insertion and only recomputation can see it.
--
-- WHAT THIS MIGRATION CHANGES:
--   1. Hashing moves INTO the database (a BEFORE INSERT trigger pins prev_hash, hash, hash_version
--      and created_at). p_hash becomes vestigial: the caller can no longer choose it.
--   2. The serialization lock moves INTO app.audit_append. It previously lived only in
--      src/audit.js:8, so the 33 migration replays, scripts/seed.js and any future direct caller
--      could fork the chain by reading the same `prev` concurrently.
--   3. UPDATE is refused by the ledger itself, not only by the absence of a GRANT — so the control
--      survives a future accidental grant to the app role.
--   4. app.audit_verify() recomputes the chain, so tampering is DETECTABLE rather than merely
--      "unlikely". Verification that nobody can run is not evidence.
--
-- HASH VERSIONING — why existing rows are NOT retro-fitted:
--   hash_version = 1 for rows that predate this migration (their hash was computed in JS and, for 26
--   of them, does not reproduce at all). hash_version = 2 for rows written by the trigger. The
--   verifier recomputes v2 rows and reports v1 rows as a named legacy class, so a known-bad history
--   is never silently laundered into "verified" — and a future v2 mismatch is unambiguously tampering.
--   Material for v2 is jsonb_build_object(...)::text (deterministic key order, includes nulls).
--   NOTE: this is deliberately NOT byte-compatible with the old JS material. Having the SECURITY
--   DEFINER function validate a caller-supplied hash is the hole being closed, so the database is
--   now the single source of truth for both writing and verifying. tests/security.test.js:100
--   previously recomputed by hand in JS and now asks the database for the formula instead.
--
-- NOT DONE HERE (stated so it is not mistaken for covered):
--   * Cold-table (app.audit_log_cold) rows are checked only at the hot->cold BOUNDARY. A full walk of
--     the cold chain is DAT-11 territory; /audit/verify reports this limitation explicitly rather
--     than implying full coverage.
--   * Owner/superuser can still use session_replication_role to bypass the trigger. That is by design:
--     a BYPASSRLS role can always rewrite the file, which is exactly why the fix constrains the
--     APPLICATION, not the DBA. The verifier is what makes such a rewrite detectable afterwards.

-- ── 1 · version column ────────────────────────────────────────────────────────
-- DEFAULT 1 is accurate for existing rows: their hash predates the trigger.
ALTER TABLE app.audit_log      ADD COLUMN IF NOT EXISTS hash_version smallint NOT NULL DEFAULT 1;
ALTER TABLE app.audit_log_cold ADD COLUMN IF NOT EXISTS hash_version smallint;

-- ── 2 · the canonical material and hash ───────────────────────────────────────
-- One definition, three consumers: the trigger writes it, the verifier recomputes it, and tests ask
-- for it. A second hand-written copy anywhere is how the two drift apart.
--
-- COVERAGE — every evidentiary column except the chain itself (prev_hash, hash, hash_version) and
-- the surrogate key. The pre-075 writer hashed only 8 fields, so `reason` (why the action happened),
-- `policy_ref` (which rule authorised it), `ai_involved` and `risk` could ALL be rewritten without
-- disturbing the hash — the row still linked and still "verified". Those four are exactly the fields
-- an auditor reads, so a hash that ignores them is a hash over the least interesting half of the row.
-- `ip` is included even though no writer populates it yet (0/53 rows): the trigger reads NEW.ip, so
-- the day something sets it, it is covered automatically rather than silently outside the hash.
CREATE OR REPLACE FUNCTION app.audit_material(
  p_tenant uuid, p_actor text, p_actor_role text, p_action text, p_record_type text,
  p_record_ref text, p_reason text, p_policy_ref text, p_ai boolean, p_risk text,
  p_outcome text, p_ip inet, p_at timestamptz
) RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = app
AS $fn$
  SELECT jsonb_build_object(
    'tenant',     p_tenant,
    'actor',      p_actor,
    'actorRole',  p_actor_role,
    'action',     p_action,
    'recordType', p_record_type,
    'recordRef',  p_record_ref,
    'reason',     p_reason,
    'policyRef',  p_policy_ref,
    'aiInvolved', p_ai,
    'risk',       p_risk,
    'outcome',    p_outcome,
    'ip',         p_ip,
    'at',         to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )::text
$fn$;

CREATE OR REPLACE FUNCTION app.audit_row_hash(
  p_prev text, p_tenant uuid, p_actor text, p_actor_role text, p_action text,
  p_record_type text, p_record_ref text, p_reason text, p_policy_ref text, p_ai boolean,
  p_risk text, p_outcome text, p_ip inet, p_at timestamptz
) RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = app
AS $fn$
  SELECT encode(sha256(convert_to(p_prev || app.audit_material(
    p_tenant, p_actor, p_actor_role, p_action, p_record_type, p_record_ref,
    p_reason, p_policy_ref, p_ai, p_risk, p_outcome, p_ip, p_at), 'UTF8')), 'hex')
$fn$;

-- ── 3 · the pin: the database computes the hash, the caller cannot supply it ───
CREATE OR REPLACE FUNCTION app.audit_pin_hash() RETURNS trigger
LANGUAGE plpgsql
SET search_path = app
AS $fn$
DECLARE prev text;
BEGIN
  -- Archival moves rows hot -> cold VERBATIM (067 / scripts/retention-worker.js:213-218). Those rows
  -- are already chained, so re-hashing them would corrupt every legacy row at the 365-day boundary.
  -- Keyed on the TARGET TABLE, not on a GUC, so it cannot be forged by a caller on the hot table.
  IF TG_TABLE_NAME = 'audit_log_cold' THEN RETURN NEW; END IF;

  -- Sub-millisecond precision must be discarded: the material renders the timestamp with
  -- to_char(..., 'MS'), which TRUNCATES microseconds. Without this, a verifier could never
  -- reproduce the very rows this trigger wrote — a permanent false-positive generator.
  NEW.created_at   := date_trunc('milliseconds', COALESCE(NEW.created_at, now()));
  NEW.hash_version := 2;

  -- Same ordering the verifier walks and the same ordering the previous JS writer used.
  SELECT a.hash INTO prev FROM app.audit_log a
   WHERE a.tenant_id = NEW.tenant_id ORDER BY a.created_at DESC, a.id DESC LIMIT 1;

  NEW.prev_hash := COALESCE(prev, 'GENESIS');
  NEW.hash := app.audit_row_hash(NEW.prev_hash, NEW.tenant_id, NEW.actor, NEW.actor_role, NEW.action,
                                 NEW.record_type, NEW.record_ref, NEW.reason, NEW.policy_ref, NEW.ai_involved,
                                 NEW.risk, NEW.outcome, NEW.ip, NEW.created_at);
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS audit_pin_hash_bi ON app.audit_log;
CREATE TRIGGER audit_pin_hash_bi BEFORE INSERT ON app.audit_log
  FOR EACH ROW EXECUTE FUNCTION app.audit_pin_hash();

-- ── 4 · the ledger refuses UPDATE in the database, not only by grant ───────────
-- UPDATE only, deliberately NOT DELETE: retention archives with `DELETE ... RETURNING` inside a CTE
-- (scripts/retention-worker.js:213-218). A per-row DELETE trigger would break chain-preserving
-- archival. Deleting without inserting is already a visible link break to the verifier.
CREATE OR REPLACE FUNCTION app.audit_ledger_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = app
AS $fn$
BEGIN
  RAISE EXCEPTION 'audit ledger is append-only (attempted % on app.audit_log); a rewrite is tampering and app.audit_verify() will report it', TG_OP
    USING ERRCODE = '42501';
END;
$fn$;

DROP TRIGGER IF EXISTS audit_ledger_immutable_bu ON app.audit_log;
CREATE TRIGGER audit_ledger_immutable_bu BEFORE UPDATE ON app.audit_log
  FOR EACH ROW EXECUTE FUNCTION app.audit_ledger_immutable();

-- ── 5 · app.audit_append: lock inside, hash no longer taken from the caller ────
-- The signature is unchanged so all 78 existing call sites keep working, but p_prev_hash is now only
-- a CONFLICT DETECTOR and p_hash is IGNORED (the BEFORE INSERT trigger overwrites it). A reader must
-- not think a supplied p_hash is honoured — that was the hole.
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
  -- T109 (D-14) tenant pin — BYTE-IDENTICAL to 054. Three tests depend on this exact behaviour:
  -- a direct caller must not be able to forge rows into another tenant's chain. The pool connects as
  -- the `schoolos` owner and request paths flip to the app role via SET ROLE, so the invoker is
  -- detected through the `role` GUC (session_user would ALWAYS read as the bypassing pool owner and
  -- void the pin). Effective invoker = the SET ROLE target when one is active, else the session
  -- login. Exempt only when that effective role can bypass RLS (owner paths: migrations, seed,
  -- bootstrap). Note FORCE RLS is inert here: this function is owned by schoolos, which holds
  -- rolbypassrls, so this pin is the ONLY control on cross-tenant writes.
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

  -- Serialization lives HERE now, not only in src/audit.js. The JS-side lock never protected the 33
  -- migration replays, scripts/seed.js or any future direct caller — two concurrent appends could
  -- read the same `prev` and fork the chain. Sorted before the read so every writer agrees on order.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text, 42));

  SELECT hash INTO prev FROM app.audit_log
   WHERE tenant_id = p_tenant ORDER BY created_at DESC, id DESC LIMIT 1;
  IF prev IS NULL THEN prev := 'GENESIS'; END IF;

  -- Kept for compatibility: a caller that read the chain earlier and lost the race is still told.
  IF p_prev_hash IS NOT NULL AND p_prev_hash <> prev THEN
    RAISE EXCEPTION 'audit chain conflict: expected prev %, got %', prev, p_prev_hash;
  END IF;

  -- prev_hash / hash / hash_version are deliberately NOT in the column list: audit_pin_hash_bi fills
  -- them. p_hash is therefore ignored — see the header. Do not add it back.
  INSERT INTO app.audit_log (tenant_id, actor, actor_role, action, record_type, record_ref,
    reason, policy_ref, ai_involved, risk, outcome, created_at)
  VALUES (p_tenant, p_actor, p_actor_role, p_action, p_record_type, p_record_ref,
    p_reason, p_policy_ref, p_ai, p_risk, p_outcome, COALESCE(p_at, now()))
  RETURNING * INTO row;
  RETURN row;
END;
$fn$;
ALTER FUNCTION app.audit_append OWNER TO schoolos;
REVOKE ALL ON FUNCTION app.audit_append FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.audit_append TO schoolos_app;

-- ── 6 · app.audit_verify: recompute, so tampering is detectable ────────────────
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
  -- Same tenant pin as audit_append, for the same reason: this function is SECURITY DEFINER and it
  -- RETURNS row details (actor, action), so without the pin an app-role caller could read another
  -- tenant's ledger. The /audit/verify door calls this on the owner path, which is exempt.
  IF NOT COALESCE((
    SELECT rolsuper OR rolbypassrls FROM pg_roles
     WHERE rolname = COALESCE(NULLIF(current_setting('role', true), 'none'), session_user)), false) THEN
    ctx := current_setting('schoolos.tenant_id', true);
    IF ctx IS NULL OR ctx = '' OR ctx::uuid IS DISTINCT FROM p_tenant THEN
      RAISE EXCEPTION 'audit_verify: tenant pin violated (p_tenant % not allowed for this session)', p_tenant
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Walk the hot chain in the same order the writer linked it. A NULL p_limit means "no bound";
  -- being able to truncate the walk silently would make verification deniable.
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
    -- Only v2 rows can be recomputed: v1 rows were hashed in JS with a different material, and the
    -- material itself is what changed. Reporting them as mismatches would be a false accusation;
    -- reporting them as "verified" would be laundering. They are counted, not asserted. See the door.
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

  -- Boundary check: the first hot row must link to the last cold row, so archival corruption of the
  -- link is caught even though the cold chain is not walked here (DAT-11).
  IF n > 0 THEN
    DECLARE newest_cold text;
    BEGIN
      SELECT c.hash INTO newest_cold FROM app.audit_log_cold c
       WHERE c.tenant_id = p_tenant ORDER BY c.created_at DESC, c.id DESC LIMIT 1;
      IF newest_cold IS NOT NULL THEN
        SELECT a.prev_hash INTO prev FROM app.audit_log a
         WHERE a.tenant_id = p_tenant ORDER BY a.created_at, a.id LIMIT 1;
        IF prev IS DISTINCT FROM newest_cold THEN
          break_kind := 'cold_boundary_break'; row_id := NULL; created_at := NULL;
          expected_prev := newest_cold; actual_prev := prev;
          expected_hash := NULL; actual_hash := NULL; hash_version := NULL;
          RETURN NEXT;
        END IF;
      END IF;
    END;
  END IF;
END;
$fn$;
ALTER FUNCTION app.audit_verify(uuid, int) OWNER TO schoolos;
REVOKE ALL ON FUNCTION app.audit_verify(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.audit_verify(uuid, int) TO schoolos_app;

-- Old signatures are dropped so a stale 8-argument version can never linger and be picked by an
-- overload resolution the caller did not intend.
DROP FUNCTION IF EXISTS app.audit_material(uuid, text, text, text, text, text, text, timestamptz);
DROP FUNCTION IF EXISTS app.audit_row_hash(text, uuid, text, text, text, text, text, text, timestamptz);
REVOKE ALL ON FUNCTION app.audit_material(uuid, text, text, text, text, text, text, text, boolean, text, text, inet, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.audit_material(uuid, text, text, text, text, text, text, text, boolean, text, text, inet, timestamptz) TO schoolos_app;
REVOKE ALL ON FUNCTION app.audit_row_hash(text, uuid, text, text, text, text, text, text, text, boolean, text, text, inet, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.audit_row_hash(text, uuid, text, text, text, text, text, text, text, boolean, text, text, inet, timestamptz) TO schoolos_app;
