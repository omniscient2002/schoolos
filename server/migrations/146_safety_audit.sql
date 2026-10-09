-- 146 · Master Action Plan 4.5: safety-audit checklist (NCPCR-mapped) + police
-- verification tracker for all account-holding staff/drivers.
--
-- WHAT THIS ADDS
--   · `app.safety_checks` — one row per checklist item per tenant (code, title,
--     detail, status open/done, checked_on/by, evidence). Rows are seeded
--     idempotently by the checklist door from the server's SAFETY_CHECKLIST
--     constant, so a school is born with the wall, not with homework.
--   · `app.staff_verifications` — one row per staff user per tenant (kind,
--     verified_on, expires_on, verified_by, note). Periodic by design: the
--     record door takes verifiedOn + validYears (default 3) and computes the
--     expiry. Contract drivers WITHOUT accounts stay on app.attendants
--     (police_verified_on, batch 3); this table is the account-holding staff.
--   · Roster blocking reads these rows: expired verification keeps a staff
--     member OFF the duty roster's clean list (flagged in `blocked`, never
--     silently dropped); missing verification warns but does not block, so a
--     school that never recorded anything is nagged, not locked out day one.
--
-- LAWS OBEYED
--   · DAT-1: composite (tenant_id, id) UNIQUE everywhere.
--   · D-35: app role gets SELECT/INSERT/UPDATE, never DELETE (attestations and
--     verifications are history; corrections are new rows/updates, not deletes).
--   · 074: every policy routes through app.current_tenant().
--   · Idempotent: IF NOT EXISTS throughout.

BEGIN;

CREATE TABLE IF NOT EXISTS app.safety_checks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  code        text NOT NULL,
  title       text NOT NULL,
  detail      text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  evidence    text,
  checked_on  date,
  checked_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS app.staff_verifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES app.tenants(id),
  user_id      uuid NOT NULL,
  kind         text NOT NULL DEFAULT 'police' CHECK (kind = 'police'),
  verified_on  date NOT NULL,
  expires_on   date NOT NULL,
  verified_by  uuid,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, user_id, kind)
);

ALTER TABLE app.safety_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.safety_checks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.safety_checks;
CREATE POLICY tenant_isolation ON app.safety_checks
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.safety_checks TO schoolos_app;

ALTER TABLE app.staff_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.staff_verifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.staff_verifications;
CREATE POLICY tenant_isolation ON app.staff_verifications
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.staff_verifications TO schoolos_app;

COMMIT;
