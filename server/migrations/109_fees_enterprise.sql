-- 109 · fees enterprise — the complete production fees data plane.
-- Design: docs/FEES-DESIGN.md · audit/register: docs/FEES-PERFECT-100.md.
--
-- WHAT THIS ADDS
--   · the finance split roles `finance_clerk` (maker) and `finance_head` (checker). `finance` is retained
--     as a legacy broad role so existing tenants keep working; the split is the go-forward taxonomy.
--   · `app.fee_heads` — first-class charge categories (label stops being free text).
--   · `app.payment_allocations` — one payment may settle several obligations.
--   · `app.payment_events` — append-only money event log (audit's second trail).
--   · `app.fee_receipts` — immutable numbered receipts.
--   · `app.fee_concessions` — concession/scholarship/sibling/staff/waiver lifecycle.
--   · `app.fee_installments` — scheduled part-payments.
--   · `app.fee_dunning_log` — the dunning dedup/audit store (comms stays the delivery record).
--   · obligation concession/waived columns + generated net_amount_cents.
--   · payment settled_by/settled_via/reconciliation_status.
--   · drops the dead legacy `app.fee_plans` (seed-only; superseded by fee_plan_templates).
--
-- LAWS OBEYED
--   · DAT-1: every FK between tenant-scoped tables is composite on (tenant_id, …); parents get
--     UNIQUE (tenant_id, id).
--   · D-35: app role gets SELECT/INSERT/UPDATE and NEVER DELETE.
--   · 074: policies route through app.current_tenant().
--   · Idempotent: IF NOT EXISTS / pg_constraint-guarded; runs on an empty database.

-- ── 1. the finance split roles ──────────────────────────────────────────────────
ALTER TABLE app.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE app.users ADD CONSTRAINT users_role_check CHECK (role = ANY (ARRAY[
  'owner'::text, 'principal'::text, 'coordinator'::text, 'counselor'::text, 'finance'::text,
  'finance_head'::text, 'finance_clerk'::text,
  'admissions'::text, 'transport'::text, 'facilities'::text, 'technician'::text, 'teacher'::text,
  'itadmin'::text, 'parent'::text, 'student'::text, 'librarian'::text]));

ALTER TABLE app.roles DROP CONSTRAINT IF EXISTS roles_base_role_check;
ALTER TABLE app.roles ADD CONSTRAINT roles_base_role_check CHECK (base_role = ANY (ARRAY[
  'owner'::text, 'principal'::text, 'coordinator'::text, 'counselor'::text, 'finance'::text,
  'finance_head'::text, 'finance_clerk'::text,
  'admissions'::text, 'transport'::text, 'facilities'::text, 'technician'::text, 'teacher'::text,
  'itadmin'::text, 'parent'::text, 'student'::text, 'librarian'::text]));

-- ── 2. fee heads ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.fee_heads (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES app.tenants(id),
  name           text NOT NULL,
  category       text,
  is_refundable  boolean NOT NULL DEFAULT true,
  tax_code       text,
  gl_ledger_name text,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name),
  UNIQUE (tenant_id, id)
);

-- ── 2b. billing runs (groups the obligations one generation produced) ────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fee_plan_templates_tenant_id_id_key') THEN
    ALTER TABLE app.fee_plan_templates ADD CONSTRAINT fee_plan_templates_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS app.billing_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES app.tenants(id),
  plan_template_id uuid,
  created_by       uuid,
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_runs_tenant_plan_fkey') THEN
    ALTER TABLE app.billing_runs ADD CONSTRAINT billing_runs_tenant_plan_fkey
      FOREIGN KEY (tenant_id, plan_template_id) REFERENCES app.fee_plan_templates(tenant_id, id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_runs_tenant_created_by_fkey') THEN
    ALTER TABLE app.billing_runs ADD CONSTRAINT billing_runs_tenant_created_by_fkey
      FOREIGN KEY (tenant_id, created_by) REFERENCES app.users(tenant_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

-- ── 3. plan templates + obligations: heads, concessions, installments ────────────
ALTER TABLE app.fee_plan_templates ADD COLUMN IF NOT EXISTS fee_head_id uuid;
ALTER TABLE app.fee_plan_templates ADD COLUMN IF NOT EXISTS installments jsonb;
ALTER TABLE app.fee_plan_templates ADD COLUMN IF NOT EXISTS effective_from date;

ALTER TABLE app.fee_obligations ADD COLUMN IF NOT EXISTS fee_head_id uuid;
ALTER TABLE app.fee_obligations ADD COLUMN IF NOT EXISTS concession_cents bigint NOT NULL DEFAULT 0;
ALTER TABLE app.fee_obligations ADD COLUMN IF NOT EXISTS waived_cents bigint NOT NULL DEFAULT 0;
ALTER TABLE app.fee_obligations ADD COLUMN IF NOT EXISTS billing_run_id uuid;
ALTER TABLE app.fee_obligations ADD COLUMN IF NOT EXISTS net_amount_cents bigint
  GENERATED ALWAYS AS (amount_cents - concession_cents - waived_cents) STORED;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'obligations_reductions_nonneg') THEN
    ALTER TABLE app.fee_obligations ADD CONSTRAINT obligations_reductions_nonneg
      CHECK (concession_cents >= 0 AND waived_cents >= 0 AND amount_cents - concession_cents - waived_cents >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'obligations_paid_lte_net') THEN
    ALTER TABLE app.fee_obligations ADD CONSTRAINT obligations_paid_lte_net
      CHECK (paid_cents <= net_amount_cents);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fee_obligations_tenant_fee_head_fkey') THEN
    ALTER TABLE app.fee_obligations ADD CONSTRAINT fee_obligations_tenant_fee_head_fkey
      FOREIGN KEY (tenant_id, fee_head_id) REFERENCES app.fee_heads(tenant_id, id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fee_plan_templates_tenant_fee_head_fkey') THEN
    ALTER TABLE app.fee_plan_templates ADD CONSTRAINT fee_plan_templates_tenant_fee_head_fkey
      FOREIGN KEY (tenant_id, fee_head_id) REFERENCES app.fee_heads(tenant_id, id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fee_obligations_tenant_billing_run_fkey') THEN
    ALTER TABLE app.fee_obligations ADD CONSTRAINT fee_obligations_tenant_billing_run_fkey
      FOREIGN KEY (tenant_id, billing_run_id) REFERENCES app.billing_runs(tenant_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS fee_obl_tenant_head_idx ON app.fee_obligations (tenant_id, fee_head_id);
CREATE INDEX IF NOT EXISTS fee_obl_billing_run_idx ON app.fee_obligations (tenant_id, billing_run_id);

-- ── 4. payments: settlement provenance + reconciliation state ────────────────────
ALTER TABLE app.payments ADD COLUMN IF NOT EXISTS settled_by uuid;
ALTER TABLE app.payments ADD COLUMN IF NOT EXISTS settled_via text;
ALTER TABLE app.payments ADD COLUMN IF NOT EXISTS reconciliation_status text NOT NULL DEFAULT 'unreconciled';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_settled_via_check') THEN
    ALTER TABLE app.payments ADD CONSTRAINT payments_settled_via_check
      CHECK (settled_via IS NULL OR settled_via IN ('gateway','manual','auto'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_reconciliation_status_check') THEN
    ALTER TABLE app.payments ADD CONSTRAINT payments_reconciliation_status_check
      CHECK (reconciliation_status IN ('unreconciled','matched','manual','disputed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_tenant_settled_by_fkey') THEN
    ALTER TABLE app.payments ADD CONSTRAINT payments_tenant_settled_by_fkey
      FOREIGN KEY (tenant_id, settled_by) REFERENCES app.users(tenant_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS payments_tenant_recon_idx ON app.payments (tenant_id, reconciliation_status);

-- the rail's captured amount, for the reconciliation amount-mismatch class
ALTER TABLE plugin_razorpay.order_log ADD COLUMN IF NOT EXISTS amount_cents bigint;

-- ── 5. allocations ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.payment_allocations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id),
  payment_id    uuid NOT NULL,
  obligation_id uuid NOT NULL,
  amount_cents  bigint NOT NULL CHECK (amount_cents > 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, payment_id, obligation_id)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_allocations_tenant_payment_fkey') THEN
    ALTER TABLE app.payment_allocations ADD CONSTRAINT payment_allocations_tenant_payment_fkey
      FOREIGN KEY (tenant_id, payment_id) REFERENCES app.payments(tenant_id, id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_allocations_tenant_obligation_fkey') THEN
    ALTER TABLE app.payment_allocations ADD CONSTRAINT payment_allocations_tenant_obligation_fkey
      FOREIGN KEY (tenant_id, obligation_id) REFERENCES app.fee_obligations(tenant_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS payment_alloc_tenant_obligation_idx ON app.payment_allocations (tenant_id, obligation_id);

-- ── 6. payment_events (append-only) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.payment_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES app.tenants(id),
  payment_id   uuid NOT NULL,
  kind         text NOT NULL CHECK (kind IN
                 ('initiated','confirmed','refunded','failed','webhook_fact','reconciled','disputed','allocation')),
  actor        text,
  actor_role   text,
  source       text,
  amount_cents bigint,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_events_tenant_payment_fkey') THEN
    ALTER TABLE app.payment_events ADD CONSTRAINT payment_events_tenant_payment_fkey
      FOREIGN KEY (tenant_id, payment_id) REFERENCES app.payments(tenant_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS payment_events_tenant_payment_idx ON app.payment_events (tenant_id, payment_id, created_at);

-- ── 7. receipts ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.fee_receipts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES app.tenants(id),
  payment_id   uuid NOT NULL,
  receipt_no   text NOT NULL,
  student_id   uuid NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  issued_at    timestamptz NOT NULL DEFAULT now(),
  issued_by    uuid,
  voided_at    timestamptz,
  UNIQUE (tenant_id, receipt_no)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fee_receipts_tenant_payment_fkey') THEN
    ALTER TABLE app.fee_receipts ADD CONSTRAINT fee_receipts_tenant_payment_fkey
      FOREIGN KEY (tenant_id, payment_id) REFERENCES app.payments(tenant_id, id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fee_receipts_tenant_student_fkey') THEN
    ALTER TABLE app.fee_receipts ADD CONSTRAINT fee_receipts_tenant_student_fkey
      FOREIGN KEY (tenant_id, student_id) REFERENCES app.students(tenant_id, id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fee_receipts_tenant_issued_by_fkey') THEN
    ALTER TABLE app.fee_receipts ADD CONSTRAINT fee_receipts_tenant_issued_by_fkey
      FOREIGN KEY (tenant_id, issued_by) REFERENCES app.users(tenant_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS fee_receipts_tenant_student_idx ON app.fee_receipts (tenant_id, student_id, issued_at DESC);

-- ── 8. concessions ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.fee_concessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id),
  student_id    uuid NOT NULL,
  obligation_id uuid,
  fee_head_id   uuid,
  kind          text NOT NULL CHECK (kind IN ('concession','scholarship','sibling','staff','waiver')),
  percent       numeric(5,2) CHECK (percent IS NULL OR (percent >= 0 AND percent <= 100)),
  amount_cents  bigint CHECK (amount_cents IS NULL OR amount_cents >= 0),
  reason        text,
  status        text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','rejected','active','expired')),
  requested_by  uuid,
  approved_by   uuid,
  approved_at   timestamptz,
  valid_from    date,
  valid_to      date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fee_concessions_tenant_student_fkey') THEN
    ALTER TABLE app.fee_concessions ADD CONSTRAINT fee_concessions_tenant_student_fkey
      FOREIGN KEY (tenant_id, student_id) REFERENCES app.students(tenant_id, id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fee_concessions_tenant_obligation_fkey') THEN
    ALTER TABLE app.fee_concessions ADD CONSTRAINT fee_concessions_tenant_obligation_fkey
      FOREIGN KEY (tenant_id, obligation_id) REFERENCES app.fee_obligations(tenant_id, id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fee_concessions_tenant_head_fkey') THEN
    ALTER TABLE app.fee_concessions ADD CONSTRAINT fee_concessions_tenant_head_fkey
      FOREIGN KEY (tenant_id, fee_head_id) REFERENCES app.fee_heads(tenant_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS fee_concessions_tenant_student_idx ON app.fee_concessions (tenant_id, student_id, status);

-- ── 9. installments ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.fee_installments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id),
  obligation_id uuid NOT NULL,
  seq           int NOT NULL CHECK (seq > 0),
  due_on        date,
  amount_cents  bigint NOT NULL CHECK (amount_cents > 0),
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','overdue','waived')),
  payment_id    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, obligation_id, seq)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fee_installments_tenant_obligation_fkey') THEN
    ALTER TABLE app.fee_installments ADD CONSTRAINT fee_installments_tenant_obligation_fkey
      FOREIGN KEY (tenant_id, obligation_id) REFERENCES app.fee_obligations(tenant_id, id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fee_installments_tenant_payment_fkey') THEN
    ALTER TABLE app.fee_installments ADD CONSTRAINT fee_installments_tenant_payment_fkey
      FOREIGN KEY (tenant_id, payment_id) REFERENCES app.payments(tenant_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

-- ── 10. dunning log ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.fee_dunning_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id),
  obligation_id uuid NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('before_due','overdue','escalation')),
  channel       text,
  offset_days   int,
  dedup_key     text,
  queued_at     timestamptz NOT NULL DEFAULT now(),
  provider      text,
  provider_ref  text,
  status        text NOT NULL DEFAULT 'queued'
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fee_dunning_log_tenant_obligation_fkey') THEN
    ALTER TABLE app.fee_dunning_log ADD CONSTRAINT fee_dunning_log_tenant_obligation_fkey
      FOREIGN KEY (tenant_id, obligation_id) REFERENCES app.fee_obligations(tenant_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS fee_dunning_log_dedup_uidx ON app.fee_dunning_log (dedup_key) WHERE dedup_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS fee_dunning_log_tenant_obl_idx ON app.fee_dunning_log (tenant_id, obligation_id, queued_at DESC);

-- ── 11. RLS + grants for every new table ────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'fee_heads','billing_runs','payment_allocations','payment_events','fee_receipts',
    'fee_concessions','fee_installments','fee_dunning_log'
  ] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON app.%I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON app.%I USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON app.%I TO schoolos_app', t);
  END LOOP;
END $$;

-- ── 12. retire the dead legacy plan table ───────────────────────────────────────
DROP TABLE IF EXISTS app.fee_plans;
