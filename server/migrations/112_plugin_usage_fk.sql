-- 111 · plugin usage meter → the plugin registry it counts (FEE-COM-2 / DAT-2).
--
-- `app.plugin_usage.plugin_id` names a plugin and must therefore be a real, tenant-aligned reference — the
-- DAT-2 census refuses a `*_id`-shaped column with no FK unless it is on a reviewed allowlist, and an
-- allowlist entry would be the weaker answer. `app.plugins` already carries UNIQUE (tenant_id, plugin_id),
-- so the composite FK is exact.
ALTER TABLE app.plugin_usage DROP CONSTRAINT IF EXISTS plugin_usage_tenant_plugin_fkey;
ALTER TABLE app.plugin_usage ADD CONSTRAINT plugin_usage_tenant_plugin_fkey
  FOREIGN KEY (tenant_id, plugin_id) REFERENCES app.plugins(tenant_id, plugin_id) ON DELETE RESTRICT;
