-- 147 · Action Plan 4.3 (match, not auto-settle): reconciliation sweep history.
--
-- WHAT THIS ADDS
--   · `app.recon_runs` — one row per sweep per tenant (manual door or worker):
--     when it ran, who/what ran it, the four class counts, actions raised.
--     The mismatch queue header reads the latest row, so "last sweep" is a
--     record, not an ephemeral toast. Money itself is untouched here (A7:
--     settlement stays staff-only; the sweep only ever marks `disputed`).
--
-- LAWS OBEYED
--   · DAT-1: composite (tenant_id, id) UNIQUE.
--   · D-35: app role gets SELECT/INSERT/UPDATE, never DELETE (runs are history).
--   · 074: every policy routes through app.current_tenant().
--   · Idempotent: IF NOT EXISTS throughout.

BEGIN;

CREATE TABLE IF NOT EXISTS app.recon_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES app.tenants(id),
  ran_at         timestamptz NOT NULL DEFAULT now(),
  source         text NOT NULL CHECK (source IN ('manual','worker')),
  ran_by         uuid,
  ghost          integer NOT NULL DEFAULT 0 CHECK (ghost >= 0),
  missing        integer NOT NULL DEFAULT 0 CHECK (missing >= 0),
  orphan         integer NOT NULL DEFAULT 0 CHECK (orphan >= 0),
  amount_mismatch integer NOT NULL DEFAULT 0 CHECK (amount_mismatch >= 0),
  actions_raised integer NOT NULL DEFAULT 0 CHECK (actions_raised >= 0),
  UNIQUE (tenant_id, id)
);

ALTER TABLE app.recon_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.recon_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.recon_runs;
CREATE POLICY tenant_isolation ON app.recon_runs
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.recon_runs TO schoolos_app;

COMMIT;
