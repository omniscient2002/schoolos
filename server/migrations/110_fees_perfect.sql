-- 110 · fees to 100 — the residual schema for the FEES-PERFECT-100 register (docs/FEES-PERFECT-100.md §0b).
--
-- WHAT THIS ADDS
--   · `app.fee_settings` — the per-tenant fee policy knobs that used to be hardcoded in routes.js:
--     the refund approval threshold (FEE-SEC-9) and the reconciliation amount tolerance (FEE-DAT-8).
--   · `app.fee_receipts.pdf_file_id` — the immutable PDF artifact pointer (FEE-DAT-3b), composite-FK'd to
--     `app.files` so a receipt can never point at another tenant's file.
--   · `app.plugin_usage` — the usage meter behind declared `billing.metered` counters (FEE-COM-2), so a
--     tenant's links/orders/webhooks/vouchers are countable and reportable.
--
-- LAWS OBEYED
--   · DAT-1: composite tenant-aligned FKs; parents get UNIQUE (tenant_id, id).
--   · D-35: app role gets SELECT/INSERT/UPDATE and NEVER DELETE.
--   · 074: policies route through app.current_tenant().
--   · Idempotent: IF NOT EXISTS / pg_constraint-guarded; runs on an empty database.

-- ── 1. per-tenant fee settings ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.fee_settings (
  tenant_id  uuid PRIMARY KEY REFERENCES app.tenants(id),
  settings   jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.fee_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.fee_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.fee_settings;
CREATE POLICY tenant_isolation ON app.fee_settings
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.fee_settings TO schoolos_app;

-- ── 2. the receipt PDF artifact pointer ─────────────────────────────────────────
ALTER TABLE app.fee_receipts ADD COLUMN IF NOT EXISTS pdf_file_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fee_receipts_tenant_pdf_file_fkey') THEN
    ALTER TABLE app.fee_receipts ADD CONSTRAINT fee_receipts_tenant_pdf_file_fkey
      FOREIGN KEY (tenant_id, pdf_file_id) REFERENCES app.files(tenant_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

-- ── 3. plugin usage meter (billing.metered enforcement surface) ─────────────────
CREATE TABLE IF NOT EXISTS app.plugin_usage (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  plugin_id   text NOT NULL,
  metric      text NOT NULL,
  count       bigint NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, plugin_id, metric)
);

ALTER TABLE app.plugin_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.plugin_usage FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.plugin_usage;
CREATE POLICY tenant_isolation ON app.plugin_usage
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.plugin_usage TO schoolos_app;

CREATE INDEX IF NOT EXISTS plugin_usage_tenant_plugin_idx ON app.plugin_usage (tenant_id, plugin_id);
