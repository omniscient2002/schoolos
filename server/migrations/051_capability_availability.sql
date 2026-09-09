-- 051: capability availability marker (Wave C decoupling contract).
-- The capability_contracts seeding (007 + the plugin catalog) already registers
-- contracts; what's missing is a DOCS-LEVEL decoupling marker: the frontend must
-- hide optional rails/plugins based on GET /capabilities (src/app.js), never by
-- assuming presence. `optional` makes that statement a first-class column on the
-- contract itself instead of a comment in the UI codebase.
ALTER TABLE app.capability_contracts
  ADD COLUMN IF NOT EXISTS optional boolean NOT NULL DEFAULT true;

-- Mark the transport family explicitly: GPS transport is a per-tenant add-on
-- (registry-driven), never a kernel guarantee. (Column default already true —
-- this UPDATE is self-documenting, not a behavior change.)
UPDATE app.capability_contracts SET optional = true WHERE capability_id LIKE 'transport%';

COMMENT ON COLUMN app.capability_contracts.optional IS
  'Docs-level decoupling marker (051): true = optional extension the UI must hide via GET /capabilities when absent; kernel core guarantees stay mandatory.';

-- Read path already granted (bootstrap schema grants; 007 adds the
-- contracts_read SELECT policy) — re-granted here as a no-op safety net.
GRANT SELECT ON app.capability_contracts TO schoolos_app;
