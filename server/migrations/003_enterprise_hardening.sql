-- 003: Enterprise hardening — lifecycle states, capability contracts, plugin budgets.
ALTER TABLE app.plugins DROP CONSTRAINT IF EXISTS plugins_status_check;
ALTER TABLE app.plugins ADD CONSTRAINT plugins_status_check
  CHECK (status IN ('draft','validated','signed','certified','registered','installed','enabled','active','degraded','suspended','disabled','deprecated','retired','uninstalled'));

-- Formal capability contract (the runtime-enforced version of the manifest §)
CREATE TABLE IF NOT EXISTS app.capability_contracts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid REFERENCES app.tenants(id),
  plugin_id     text NOT NULL,
  capability_id text NOT NULL,
  version       text NOT NULL,
  contract      jsonb NOT NULL,          -- full contract doc (§3 of docs/12)
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, capability_id, version)
);
CREATE INDEX IF NOT EXISTS capcon_plugin_idx ON app.capability_contracts(plugin_id);

-- Runtime governance columns (event + AI budgets; circuit breaker state)
ALTER TABLE app.plugins
  ADD COLUMN IF NOT EXISTS event_budget  jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {per_min, payload_max, fanout, chain_depth}
  ADD COLUMN IF NOT EXISTS ai_budget     jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {calls_per_day, tokens_per_day, tools_per_day}
  ADD COLUMN IF NOT EXISTS breaker_state jsonb NOT NULL DEFAULT '{"open":false}'::jsonb,
  ADD COLUMN IF NOT EXISTS trust_level   text NOT NULL DEFAULT 'T1' CHECK (trust_level IN ('T0','T1','T2','T3','T4')),
  ADD COLUMN IF NOT EXISTS cert_score    jsonb;
