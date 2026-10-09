-- 136 · transport write model: retirement for routes and stops (H1).
--
-- The audit found `app.routes` / `app.route_stops` were seed-only, so a self-signup school had 0
-- routes and no door to create any. This is ADDITIVE and idempotent: `retired_at` on both tables so
-- the app role (which holds no DELETE) can retire a route/stop instead of deleting it.

BEGIN;

ALTER TABLE app.routes      ADD COLUMN IF NOT EXISTS retired_at timestamptz;
ALTER TABLE app.route_stops ADD COLUMN IF NOT EXISTS retired_at timestamptz;

CREATE INDEX IF NOT EXISTS routes_active_idx      ON app.routes (tenant_id)      WHERE retired_at IS NULL;
CREATE INDEX IF NOT EXISTS route_stops_active_idx ON app.route_stops (tenant_id) WHERE retired_at IS NULL;

COMMIT;
