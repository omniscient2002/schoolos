-- 053_onboarding.sql — self-serve tenant onboarding (build-out wave: platform signup).
--
-- WHY A RUNTIME TENANT PATH: the standing rule ("registry rows provisioned
-- EXCLUSIVELY via numbered migrations") governs governance/registry rows,
-- capability contracts, and test fixtures — hand-provisioned rows have no
-- provenance. School-owner self-signup is a PRODUCT capability: the request
-- itself is the provenance (hash-chained 'Tenant onboarded' audit row + the
-- platform.tenant.onboarded.v1 event, both written in the same transaction
-- that creates the tenant). This migration only stamps WHEN/HOW.
ALTER TABLE app.tenants
  ADD COLUMN IF NOT EXISTS onboarded_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarded_via text;

GRANT UPDATE (onboarded_at, onboarded_via, config, name) ON app.tenants TO schoolos_app;
GRANT INSERT ON app.tenants TO schoolos_app;
GRANT SELECT ON app.tenants TO schoolos_app;

-- Ledger note: app.audit_log.tenant_id is NOT NULL and the hash chain is
-- per-tenant — a platform-level migration row cannot exist (044's pattern
-- writes per-tenant rows inside a tenant loop). The capability is documented
-- HERE instead; the runtime 'Tenant onboarded' row lands per-school with its
-- own hash chain from POST /onboard/signup.
