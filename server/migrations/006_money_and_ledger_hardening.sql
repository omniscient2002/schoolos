-- 006: REDTEAM-1 RTR-001 criticals — money integrity + audit ledger hardening.

-- ── RT-004: money cannot exceed the obligation ──
-- Reconcile poisoned rows first (RTR-001 live PoC evidence: an obligation at 200% paid).
-- The clamp keeps the ledger arithmetically legal; the duplicate receipts remain as
-- evidence of the exploited path and are called out in docs/red-team/RTR-001.md.
UPDATE app.fee_obligations SET paid_cents = LEAST(paid_cents, amount_cents)
  WHERE paid_cents > amount_cents;
ALTER TABLE app.fee_obligations
  DROP CONSTRAINT IF EXISTS obligations_paid_lte_amount;
ALTER TABLE app.fee_obligations
  ADD CONSTRAINT obligations_paid_lte_amount CHECK (paid_cents >= 0 AND paid_cents <= amount_cents);

-- one open payment per obligation at a time (no parallel initiations)
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_open_per_obligation
  ON app.payments(tenant_id, obligation_id) WHERE status = 'initiated';

-- ── RT-003: confirm cannot be self-declared by a payer ──
ALTER TABLE app.payments
  DROP CONSTRAINT IF EXISTS payments_gateway_ref_req;
ALTER TABLE app.payments
  ADD CONSTRAINT payments_gateway_ref_req CHECK (status <> 'confirmed' OR gateway_ref IS NOT NULL);

-- ── Track E: the ledger becomes INSERT-proof for the app role.
-- Writes go through this SECURITY DEFINER function (owner-owned), which
-- enforces the hash chain itself. Direct INSERT is revoked in 005b grants.
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
BEGIN
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

-- The ledger accepts writes ONLY through audit_append (SECURITY DEFINER).
REVOKE INSERT ON app.audit_log FROM schoolos_app;
