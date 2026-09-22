-- 111 · library governance — borrower write throttles (LIB-E2) + acquisitions vendor/budget (LMS-24).
-- Design: docs/LIBRARY-DESIGN.md · docs/LIBRARY-PERFECT-100.md §15.
--
-- WHY
--   · LIB-E2: the borrower write doors (reserve, suggest, vote) had no per-account rate limit, so one
--     account could spam the reservation queue or the purchase-request queue. The platform already has an
--     identifier-keyed throttle idiom (auth.request_throttles, migration 103) but that table is
--     kernel-only (bootstrap REVOKEs it from schoolos_app) and plugin code must not write auth.*. A
--     library-scoped table keeps the plugin inside its own schema while the desk still gets the 429.
--   · LMS-24: the acquisition request recorded only a status. A school that actually buys a book needs the
--     vendor, the budget line, the cost and the ordered/received timestamps to reconcile procurement.
--
-- LAWS OBEYED
--   · DAT-1/DAT-2: the tenant-aligned composite FK to app.users(tenant_id, id) means the actor reference
--     is constrained, not a bare uuid.
--   · D-35: SELECT/INSERT/UPDATE only — no DELETE for the app role (retention runs on the owner path).
--   · 074: policies route through app.current_tenant().
--   · Idempotent: every step is IF NOT EXISTS / constraint-guarded; safe on a fresh database and on replay.
--
-- THROTTLE SEMANTICS. One row per (tenant, actor, kind). The window is fixed-length: the first attempt in a
-- window sets window_started_at, later attempts inside the window increment, and the first attempt after the
-- window resets the counter to 1. The door decides whether `attempts` exceeds its ceiling and answers 429.
-- The row is deliberately upserted IN THE SAME TRANSACTION as the write, so a throttled request still
-- counts (the check is before the write and the transaction commits the reply).

-- ── 1. borrower write throttles ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS library.request_throttles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES app.tenants(id),
  actor_id          uuid NOT NULL,
  kind              text NOT NULL,
  attempts          integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, actor_id, kind)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'library_throttle_tenant_actor_fkey') THEN
    ALTER TABLE library.request_throttles ADD CONSTRAINT library_throttle_tenant_actor_fkey
      FOREIGN KEY (tenant_id, actor_id) REFERENCES app.users(tenant_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS library_throttle_window_idx ON library.request_throttles (tenant_id, window_started_at);

ALTER TABLE library.request_throttles ENABLE ROW LEVEL SECURITY;
ALTER TABLE library.request_throttles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON library.request_throttles;
CREATE POLICY tenant_isolation ON library.request_throttles
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON library.request_throttles TO schoolos_app;

-- ── 2. acquisition vendor / budget / received tracking ──────────────────────────
ALTER TABLE library.acquisition_request ADD COLUMN IF NOT EXISTS vendor      text;
ALTER TABLE library.acquisition_request ADD COLUMN IF NOT EXISTS budget_code text;
ALTER TABLE library.acquisition_request ADD COLUMN IF NOT EXISTS cost_cents  integer
  CHECK (cost_cents IS NULL OR cost_cents >= 0);
ALTER TABLE library.acquisition_request ADD COLUMN IF NOT EXISTS ordered_at  timestamptz;
ALTER TABLE library.acquisition_request ADD COLUMN IF NOT EXISTS received_at timestamptz;
