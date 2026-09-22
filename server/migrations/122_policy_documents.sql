-- 122 · OWNER / PRINCIPAL — the school constitution policy store (docs/OWNER-PRINCIPAL-PERFECT-100.md, PRD-12).
--
-- WHAT THIS ADDS
--   · OPP-PRD-12  `app.policy_documents` — the school's own rules, versioned and audited. The
--                Constitution screen used to render seed policies and save workspace-local drafts that
--                reset on reload (its own copy admitted the store was read-only). This is the real store.
--
-- LAWS OBEYED
--   · DAT-1: composite (tenant_id, id) UNIQUE + a tenant-aligned FK on the parent only.
--   · D-35: the app role gets SELECT/INSERT/UPDATE, never DELETE.
--   · 074: every policy routes through app.current_tenant().
--   · Idempotent: IF NOT EXISTS; runs on an empty database and on a replay.

BEGIN;

CREATE TABLE IF NOT EXISTS app.policy_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  ref         text NOT NULL,
  title       text NOT NULL,
  category    text NOT NULL DEFAULT 'school',
  body        text NOT NULL,
  version     integer NOT NULL DEFAULT 1,
  updated_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, ref)
);

ALTER TABLE app.policy_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.policy_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.policy_documents;
CREATE POLICY tenant_isolation ON app.policy_documents
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.policy_documents TO schoolos_app;

ALTER TABLE app.policy_documents DROP CONSTRAINT IF EXISTS policy_documents_tenant_id_id_key;
ALTER TABLE app.policy_documents ADD CONSTRAINT policy_documents_tenant_id_id_key UNIQUE (tenant_id, id);

CREATE INDEX IF NOT EXISTS policy_documents_tenant_idx ON app.policy_documents (tenant_id, category, ref);

COMMIT;
