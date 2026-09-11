-- 063_custom_roles.sql — Wave 4/5 · L3-4.2 DDL request (blocks.md:28), executed by L1.
-- Custom per-tenant roles: a role row extends a kernel base_role with an
-- allow/deny permission json; app.users.role_key points at it.
--
-- DEVIATION from the request (recorded for L3/S0): the requested composite FK
-- `FOREIGN KEY (tenant_id, role_key) REFERENCES app.roles(tenant_id, key)
-- ON DELETE SET NULL` is NOT safe — ON DELETE SET NULL nulls EVERY referencing
-- column, which would wipe users.tenant_id and orphan the row across tenants.
-- The composite FK ships with ON DELETE RESTRICT instead: a role that is still
-- assigned cannot be deleted until the door reassigns its users (which the
-- /roles delete path should enforce anyway).

CREATE TABLE IF NOT EXISTS app.roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  key         text NOT NULL CHECK (key ~ '^[a-z0-9_-]{2,40}$'),
  label       text NOT NULL CHECK (length(label) <= 60),
  base_role   text NOT NULL CHECK (base_role IN ('owner','principal','coordinator','finance','admissions','transport','facilities','technician','teacher','itadmin','parent','student')),
  permissions jsonb NOT NULL DEFAULT '{"allow":[],"deny":[]}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roles_tenant_key_uidx UNIQUE (tenant_id, key)
);

ALTER TABLE app.users ADD COLUMN IF NOT EXISTS role_key text;
ALTER TABLE app.users
  DROP CONSTRAINT IF EXISTS users_role_key_fkey,
  ADD CONSTRAINT users_role_key_fkey
    FOREIGN KEY (tenant_id, role_key) REFERENCES app.roles (tenant_id, key)
    ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS users_role_key_idx ON app.users (tenant_id, role_key);

-- 049 RLS pattern (verbatim).
ALTER TABLE app.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.roles;
CREATE POLICY tenant_isolation ON app.roles
  USING (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('schoolos.tenant_id', true)::uuid);

-- 054 grant law: explicit, never default privileges. CRUD is app-role driven
-- (L3's /roles* doors run under withUser).
GRANT SELECT, INSERT, UPDATE, DELETE ON app.roles TO schoolos_app;
