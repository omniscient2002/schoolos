-- 070 · AI gateway ledger (L2-5.1, Wave 5 — claimed per D-40, help.md).
-- Every AI provider call (any plugin, any purpose incl. eval runs) writes one
-- row here BEFORE/after the provider call: tenant, caller, plugin, purpose,
-- provider/model, token counts, latency, outcome. Budget enforcement reads
-- this table (per-tenant daily cap from app.tenants.config.ai.dailyCallCap,
-- per-plugin monthly cap from app.plugins.ai_budget — 0 disables AI for the
-- plugin). Kernel-only writes (schoolos_app gets SELECT — read doors are
-- owner/itadmin), tenant RLS like every other tenant table.
CREATE TABLE IF NOT EXISTS app.ai_calls (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  user_id     uuid,
  plugin_id   text NOT NULL,
  purpose     text NOT NULL,
  provider    text NOT NULL,
  model       text,
  tokens_in   integer NOT NULL DEFAULT 0,
  tokens_out  integer NOT NULL DEFAULT 0,
  latency_ms  integer,
  outcome     text NOT NULL CHECK (outcome IN ('ok','error','budget')),
  error       text,
  sandbox     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_calls_tenant_time_idx ON app.ai_calls (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_calls_budget_idx ON app.ai_calls (tenant_id, created_at) WHERE outcome <> 'budget';

ALTER TABLE app.ai_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_calls FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_calls_tenant ON app.ai_calls;
CREATE POLICY ai_calls_tenant ON app.ai_calls
  USING (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('schoolos.tenant_id', true)::uuid);

REVOKE ALL ON app.ai_calls FROM schoolos_app;
GRANT SELECT ON app.ai_calls TO schoolos_app;
