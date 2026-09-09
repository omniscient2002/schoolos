-- 050: metrics persistence store (Wave C).
-- This number was slotted for a "metrics note" in the wave plan; the note is now
-- a real need, so 050 carries real schema. GET /metrics (src/app.js) counts
-- requests/errors in module memory (per-response DB writes would be far too
-- hot), and this tiny table is where the 60-second flush lands them so the
-- monotonic totals survive a restart.
--
-- Deliberately NOT tenant data: no tenant_id, no RLS — the counters are
-- process-global and /metrics reads them on the owner path.
CREATE TABLE IF NOT EXISTS app.ops_counters (
  name       text PRIMARY KEY,                  -- e.g. 'requests_total', 'errors_total'
  value      bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The flush upsert may run on either path; grant the constrained role the same
-- shape of access bootstrap.js grants for schema app (SELECT/INSERT/UPDATE).
GRANT SELECT, INSERT, UPDATE ON app.ops_counters TO schoolos_app;
