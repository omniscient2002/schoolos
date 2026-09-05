-- Plugin registry — the switchboard. Server-side truth for what each school runs.
CREATE TABLE IF NOT EXISTS app.plugins (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES app.tenants(id),
  plugin_id    text NOT NULL,
  version      text NOT NULL,
  class        text NOT NULL CHECK (class IN ('A','B','C','D','E')),
  status       text NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','enabled','disabled','suspended')),
  manifest     jsonb NOT NULL DEFAULT '{}'::jsonb,
  permissions  jsonb NOT NULL DEFAULT '[]'::jsonb,
  settings     jsonb NOT NULL DEFAULT '{}'::jsonb,
  entitlement  jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled_at   timestamptz,
  enabled_by   uuid REFERENCES app.users(id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, plugin_id)
);
CREATE INDEX IF NOT EXISTS plugins_tenant_idx ON app.plugins(tenant_id, status);

-- same tenant isolation as every other tenant table
ALTER TABLE app.plugins ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.plugins FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.plugins;
CREATE POLICY tenant_isolation ON app.plugins
  USING (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('schoolos.tenant_id', true)::uuid);
