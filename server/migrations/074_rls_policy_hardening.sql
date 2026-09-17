-- 074 · RLS policy hardening — a policy must DENY, never RAISE.
-- Claimed via .coop/help.md. Residual from SEC-1 (PERFECT-100 §8).
--
-- THE DEFECT: 94 policy predicates inline `current_setting(...)` themselves, in THREE
-- different shapes with TWO different failure behaviours:
--
--   1. current_setting('schoolos.tenant_id'::text, true)::uuid
--        · GUC unset  → NULL::uuid → NULL → row filtered out (correct: deny)
--        · GUC = ''   → ''::uuid  → **22P02 ERROR** (wrong: an authorization check
--                       becomes a 500 for the whole request)
--   2. current_setting('schoolos.tenant_id'::text)::uuid     ← NO missing_ok argument
--        · GUC never set in the session → **42704 "unrecognized configuration
--          parameter" ERROR** (wrong, and it fires on a perfectly ordinary request)
--   3. current_setting('schoolos.user_id'::text, true)::uuid — the user pin (shape 1)
--
-- Observed live: shape 1 with an empty-string GUC was raising 22P02 through `q()`, which
-- is a connection-state quirk turning an access-control rule into an outage. The source
-- of the empty string is still unexplained (see §8 residual) — but **it should not be
-- possible for it to matter**, which is what this migration establishes.
--
-- THE RULE: an authorization predicate has exactly two acceptable outcomes — the row is
-- visible, or it is not. It must never be able to fail the query. Both hole shapes are
-- closed by routing every predicate through a helper that normalises NULL and '' to NULL,
-- so the comparison is UNKNOWN and the row is denied.
--
-- This also makes the semantics UNIFORM: before this, the same "no tenant context" state
-- denied on 82 tables and errored on 12. Uniformity is what lets an operator reason about
-- the boundary at all.
--
-- Idempotent by construction: after the rewrite the inlined pattern no longer appears, so
-- re-running finds nothing to change and reports 0.

-- THE HELPERS RETURN text, NOT uuid — and that is deliberate, not an oversight.
-- `current_setting(...)` returns TEXT, and the 94 predicates use it in BOTH shapes:
--     tenant_id = (current_setting(...))::uuid     ← cast applied by the policy
--     tenant_id::text = current_setting(...)       ← compared AS TEXT
-- Substituting a uuid-returning helper keeps the first working but turns the second into
-- `text = uuid`, which is not even an operator (found the hard way: the first attempt at
-- this migration failed with exactly that error). Returning text means the substitute has
-- the SAME TYPE as the expression it replaces, so every existing cast and comparison keeps
-- its original meaning and the ONLY behavioural change is the closed hole.
CREATE OR REPLACE FUNCTION app.current_tenant() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE AS
$fn$ SELECT NULLIF(current_setting('schoolos.tenant_id', true), '') $fn$;

CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE AS
$fn$ SELECT NULLIF(current_setting('schoolos.user_id', true), '') $fn$;

COMMENT ON FUNCTION app.current_tenant() IS
  'Tenant id for RLS predicates, as TEXT to match current_setting(). NULL when the GUC is '
  'unset OR empty — so a predicate always DENIES instead of raising 22P02/42704. Never '
  'inline current_setting in a policy.';
COMMENT ON FUNCTION app.current_user_id() IS
  'Row-owner pin for owner-scoped RLS predicates. Same NULL-normalising rule as current_tenant().';

-- Policies are evaluated as the app role, so it must be able to call the helpers.
GRANT EXECUTE ON FUNCTION app.current_tenant() TO schoolos_app;
GRANT EXECUTE ON FUNCTION app.current_user_id() TO schoolos_app;

DO $mig$
DECLARE
  r        record;
  q_new    text;
  c_new    text;
  n_pol    int := 0;
  n_err    int := 0;   -- policies that would have ERRORED (missing missing_ok)
  n_hole   int := 0;   -- policies that would have errored on an empty-string GUC
BEGIN
  -- SNAPSHOT FIRST — this is load-bearing, not tidiness.
  -- The first version of this migration looped `FOR r IN SELECT ... FROM pg_policy`
  -- and issued ALTER POLICY inside that loop. ALTER POLICY updates the very catalogue
  -- rows being scanned, and the scan then SKIPS rows: the migration silently hardened
  -- only 44 of the 94 predicates and reported success. (Observed directly: a freshly
  -- migrated database had 50 policies still inlining current_setting while a database
  -- migrated in two passes had 0 — the discrepancy was the tell.) Materialising the
  -- list before mutating anything makes the work complete and deterministic.
  CREATE TEMP TABLE _pol_074 ON COMMIT DROP AS
    SELECT p.polname,
           c.relname                                    AS rel,
           n.nspname                                    AS nsp,
           pg_get_expr(p.polqual, p.polrelid)           AS qual,
           pg_get_expr(p.polwithcheck, p.polrelid)      AS chk
      FROM pg_policy p
      JOIN pg_class c     ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
       AND (pg_get_expr(p.polqual, p.polrelid) LIKE '%current_setting%'
         OR COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') LIKE '%current_setting%');

  FOR r IN SELECT * FROM _pol_074 LOOP
    q_new := r.qual;
    c_new := r.chk;

    -- shape 2 (no `, true`) is counted separately: it raises 42704 when the GUC was
    -- never set, which is a different outage from the empty-string 22P02 hole.
    IF q_new LIKE '%current_setting%' THEN
      IF q_new LIKE '%''schoolos.tenant_id''%' AND q_new NOT LIKE '%tenant_id%true%' THEN n_err := n_err + 1; END IF;
      IF q_new LIKE '%''schoolos.tenant_id''%true%' THEN n_hole := n_hole + 1; END IF;
      q_new := regexp_replace(q_new, 'current_setting\(''schoolos\.tenant_id''(::text)?(, *true)?\)', 'app.current_tenant()', 'g');
      q_new := regexp_replace(q_new, 'current_setting\(''schoolos\.user_id''(::text)?(, *true)?\)',   'app.current_user_id()', 'g');
    END IF;
    IF c_new LIKE '%current_setting%' THEN
      IF c_new LIKE '%''schoolos.tenant_id''%' AND c_new NOT LIKE '%tenant_id%true%' THEN n_err := n_err + 1; END IF;
      IF c_new LIKE '%''schoolos.tenant_id''%true%' THEN n_hole := n_hole + 1; END IF;
      c_new := regexp_replace(c_new, 'current_setting\(''schoolos\.tenant_id''(::text)?(, *true)?\)', 'app.current_tenant()', 'g');
      c_new := regexp_replace(c_new, 'current_setting\(''schoolos\.user_id''(::text)?(, *true)?\)',   'app.current_user_id()', 'g');
    END IF;

    IF q_new IS NOT DISTINCT FROM r.qual AND c_new IS NOT DISTINCT FROM r.chk THEN
      RAISE WARNING '074: policy %.% (%) could NOT be rewritten — its predicate references current_setting in a shape this migration does not know. A policy that can RAISE instead of DENY is a bug; fix it by hand.', r.nsp, r.rel, r.polname;
      CONTINUE;
    END IF;

    -- ALTER POLICY only rewrites the clauses we pass; pass exactly the ones that existed,
    -- so a SELECT policy never gains a WITH CHECK it did not have (that would be a
    -- behaviour change, not a hardening).
    IF q_new IS NOT NULL AND c_new IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I USING (%s) WITH CHECK (%s)', r.polname, r.nsp, r.rel, q_new, c_new);
    ELSIF q_new IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I USING (%s)', r.polname, r.nsp, r.rel, q_new);
    ELSE
      EXECUTE format('ALTER POLICY %I ON %I.%I WITH CHECK (%s)', r.polname, r.nsp, r.rel, c_new);
    END IF;
    n_pol := n_pol + 1;
  END LOOP;

  RAISE NOTICE '074: hardened % of % candidate policy predicate(s) — % inlined current_setting WITHOUT missing_ok (latent 42704 when the GUC was unset), % inlined it with missing_ok (latent 22P02 when the GUC was empty).', n_pol, (SELECT count(*) FROM _pol_074), n_err, n_hole;

  -- Fail loudly rather than leaving a half-hardened boundary behind: if any candidate
  -- was skipped, the operator must know.
  IF n_pol <> (SELECT count(*) FROM _pol_074) THEN
    RAISE EXCEPTION '074: % of % policy predicates were not rewritten — refusing to report success on a partial hardening', (SELECT count(*) FROM _pol_074) - n_pol, (SELECT count(*) FROM _pol_074);
  END IF;
END
$mig$;
