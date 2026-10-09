-- 150 · tenant-configurable fees policy tables.
--
-- Everything in the fees domain becomes tenant-owned:
--   · fee_heads gains per-head policy flags (late fee / installments / concession / refund window).
--   · fee_discount_rules is the scholarship/concession catalogue (merit/need/EWS/RTE/sibling/staff/early_bird).
--   · fee_late_rules holds optional per-head late-fee overrides (null head_id = tenant default lives in fee_settings).
--   · fee_installments gains edit audit columns; billing_runs snapshots the policy used.
--   · fee_concessions gains a dedup key so re-generation proposes once, never duplicates.
--
-- LAWS OBEYED
--   · DAT-1: every FK between tenant-scoped tables is composite on (tenant_id, …); parents get UNIQUE (tenant_id, id).
--   · D-35: app role gets SELECT/INSERT/UPDATE and NEVER DELETE.
--   · 074: policies route through app.current_tenant().
--   · Idempotent: IF NOT EXISTS / pg_constraint-guarded; runs on an empty database.

-- ── 1. fee_heads policy flags ───────────────────────────────────────────────
ALTER TABLE app.fee_heads ADD COLUMN IF NOT EXISTS applies_late_fee boolean NOT NULL DEFAULT true;
ALTER TABLE app.fee_heads ADD COLUMN IF NOT EXISTS allows_installments boolean NOT NULL DEFAULT true;
ALTER TABLE app.fee_heads ADD COLUMN IF NOT EXISTS allows_concession boolean NOT NULL DEFAULT true;
ALTER TABLE app.fee_heads ADD COLUMN IF NOT EXISTS refund_window_days integer;
ALTER TABLE app.fee_heads ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- ── 2. discount / scholarship catalogue ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.fee_discount_rules (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES app.tenants(id),
  name                  text NOT NULL,
  kind                  text NOT NULL CHECK (kind IN ('merit','need','ews','rte','sibling','staff','early_bird','other','concession','scholarship','waiver')),
  value_type            text NOT NULL CHECK (value_type IN ('percent','flat')),
  value_numeric         numeric(8,2) NOT NULL CHECK (value_numeric >= 0),
  max_per_student_cents bigint CHECK (max_per_student_cents IS NULL OR max_per_student_cents >= 0),
  valid_from            date,
  valid_to              date,
  grades                text[] NOT NULL DEFAULT '{}',
  fee_head_id           uuid,
  requires_approval     boolean NOT NULL DEFAULT true,
  auto_apply            boolean NOT NULL DEFAULT false,
  stackable             boolean NOT NULL DEFAULT false,
  priority              integer NOT NULL DEFAULT 0,
  active                boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name),
  UNIQUE (tenant_id, id)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fee_discount_rules_tenant_head_fkey') THEN
    ALTER TABLE app.fee_discount_rules ADD CONSTRAINT fee_discount_rules_tenant_head_fkey
      FOREIGN KEY (tenant_id, fee_head_id) REFERENCES app.fee_heads(tenant_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS fee_discount_rules_tenant_active_idx ON app.fee_discount_rules (tenant_id, active);

-- ── 3. per-head late-fee overrides ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.fee_late_rules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES app.tenants(id),
  fee_head_id    uuid,
  mode           text NOT NULL CHECK (mode IN ('per_day','fixed','percent')),
  per_day_cents  bigint NOT NULL DEFAULT 0 CHECK (per_day_cents >= 0),
  fixed_cents    bigint NOT NULL DEFAULT 0 CHECK (fixed_cents >= 0),
  percent        numeric(5,2) NOT NULL DEFAULT 0 CHECK (percent >= 0 AND percent <= 100),
  cap_cents      bigint NOT NULL DEFAULT 0 CHECK (cap_cents >= 0),
  grace_days     integer NOT NULL DEFAULT 0 CHECK (grace_days >= 0),
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fee_late_rules_tenant_head_fkey') THEN
    ALTER TABLE app.fee_late_rules ADD CONSTRAINT fee_late_rules_tenant_head_fkey
      FOREIGN KEY (tenant_id, fee_head_id) REFERENCES app.fee_heads(tenant_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS fee_late_rules_tenant_head_idx ON app.fee_late_rules (tenant_id, fee_head_id) WHERE active;

-- ── 4. installment edit audit + billing-run policy snapshot ────────────────
ALTER TABLE app.fee_installments ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE app.fee_installments ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE app.fee_installments ADD COLUMN IF NOT EXISTS waived_reason text;
ALTER TABLE app.billing_runs ADD COLUMN IF NOT EXISTS policy_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fee_installments_tenant_updated_by_fkey') THEN
    ALTER TABLE app.fee_installments ADD CONSTRAINT fee_installments_tenant_updated_by_fkey
      FOREIGN KEY (tenant_id, updated_by) REFERENCES app.users(tenant_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

-- ── 5. concession dedup (re-generation proposes once) ──────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS fee_concessions_propose_uidx
  ON app.fee_concessions (tenant_id, student_id, obligation_id, kind)
  WHERE status = 'requested' AND obligation_id IS NOT NULL;

-- ── 6. RLS + grants ───────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fee_discount_rules','fee_late_rules'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON app.%I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON app.%I USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON app.%I TO schoolos_app', t);
  END LOOP;
END $$;
