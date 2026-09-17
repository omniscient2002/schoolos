-- 080 — PLG-2: which plan a school is on, so `entitlement` can finally be checked.
--
-- The register: "`entitlement` is never checked — any tenant can enable any plugin, including paid packs and
-- rails, and the ledger records it as legitimate." The stored `app.plugins.entitlement` values are six
-- inconsistent vocabularies, so they cannot answer the question; the plan must be a fact about the TENANT.
--
-- DEFAULT 'trial' is deliberate and is the reason this change breaks nothing: trial includes everything, so the
-- 36 test files that call an enable door, the demo tenant and every self-signup tenant keep working, while the
-- column, the CHECK, the matrix and the refusal paths become real. Defaulting to a RESTRICTED plan would turn
-- this P0 fix into an outage. Honest residual, stated rather than implied: `trial` has no expiry yet, so this
-- means "unassigned = everything", not "a timed trial". Expiry is a separate piece of work.
ALTER TABLE app.tenants ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'trial';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_plan_check') THEN
    ALTER TABLE app.tenants ADD CONSTRAINT tenants_plan_check
      CHECK (plan IN ('trial','core','operations','campus','compliance','rails'));
  END IF;
END $$;
