-- 142 · MPD compliance vault + RTE/EWS ledger + payroll-lite + billing orders
-- (Master Action Plan Phase 1–2: 1.2 MPD center, 1.3 RTE manager, 4.1 payroll-lite, 0.2 billing checkout).
--
-- WHAT THIS ADDS
--   · `app.mpd_docs` — Appendix-IX disclosure documents (affiliation, trust, NOC, RTE
--     recognition, building/fire/DEO/water-health-sanitation, fee structure, calendar, SMC,
--     PTA, board results, staff list) with expiry; active rows drive the MPD checklist.
--   · `app.rte_reimbursements` — per-year reimbursement claims (claimed/received) for the
--     RTE §12(1)(c) 25% quota. Pupils ride the roster (`source='rte-lottery'`) + an
--     auto-approved fee concession, so no new student shape is invented.
--   · `app.payroll_structures` — per-staff monthly pay + bank/pan (bank shown last-4 in reads).
--   · `app.payroll_runs` + `app.payroll_payslips` — monthly draft → disbursed runs; payslips
--     snapshot the structure so later edits never rewrite history.
--   · `app.billing_orders` — plan subscription orders (Razorpay-backed when keys exist,
--     honest 503 otherwise); the webhook flips `app.tenants.plan`.
--
-- LAWS OBEYED
--   · DAT-1: composite (tenant_id, id) UNIQUE on every table.
--   · D-35: the app role gets SELECT/INSERT/UPDATE, never DELETE (retire, never delete).
--   · 074: every policy routes through app.current_tenant().
--   · Idempotent: IF NOT EXISTS; runs on an empty database and on a replay.

BEGIN;

CREATE TABLE IF NOT EXISTS app.mpd_docs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  name        text NOT NULL,
  kind        text NOT NULL,
  expires_on  date,
  active      boolean NOT NULL DEFAULT true,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  retired_at  timestamptz,
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS app.rte_reimbursements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES app.tenants(id),
  academic_year  text NOT NULL,
  amount_cents   integer NOT NULL CHECK (amount_cents >= 0),
  claim_ref      text,
  status         text NOT NULL DEFAULT 'claimed' CHECK (status IN ('claimed','received','partial')),
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS app.payroll_structures (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id),
  user_id       uuid NOT NULL,
  monthly_cents integer NOT NULL CHECK (monthly_cents >= 0),
  bank_acct     text,
  pan           text,
  updated_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id),
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS app.payroll_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  month       text NOT NULL CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','disbursed')),
  total_cents integer NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  disburse_mode text,
  disburse_ref  text,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  disbursed_at timestamptz,
  UNIQUE (tenant_id, month),
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS app.payroll_payslips (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id),
  run_id        uuid NOT NULL REFERENCES app.payroll_runs(id),
  user_id       uuid NOT NULL,
  monthly_cents integer NOT NULL CHECK (monthly_cents >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, run_id, user_id),
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS app.billing_orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES app.tenants(id),
  plan             text NOT NULL,
  amount_cents     integer NOT NULL CHECK (amount_cents >= 0),
  gateway_order_id text,
  status           text NOT NULL DEFAULT 'created' CHECK (status IN ('created','paid','failed','void')),
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  paid_at          timestamptz,
  UNIQUE (tenant_id, id)
);

ALTER TABLE app.mpd_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.mpd_docs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.mpd_docs;
CREATE POLICY tenant_isolation ON app.mpd_docs
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.mpd_docs TO schoolos_app;

ALTER TABLE app.rte_reimbursements ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.rte_reimbursements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.rte_reimbursements;
CREATE POLICY tenant_isolation ON app.rte_reimbursements
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.rte_reimbursements TO schoolos_app;

ALTER TABLE app.payroll_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.payroll_structures FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.payroll_structures;
CREATE POLICY tenant_isolation ON app.payroll_structures
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.payroll_structures TO schoolos_app;

ALTER TABLE app.payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.payroll_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.payroll_runs;
CREATE POLICY tenant_isolation ON app.payroll_runs
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.payroll_runs TO schoolos_app;

ALTER TABLE app.payroll_payslips ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.payroll_payslips FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.payroll_payslips;
CREATE POLICY tenant_isolation ON app.payroll_payslips
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.payroll_payslips TO schoolos_app;

ALTER TABLE app.billing_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.billing_orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.billing_orders;
CREATE POLICY tenant_isolation ON app.billing_orders
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.billing_orders TO schoolos_app;

COMMIT;
