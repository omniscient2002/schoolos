-- 089: five high-frequency tenant-leading indexes from PERFECT-100 DAT-9.
-- Additive and replay-safe; column order matches the common tenant/RLS
-- predicate followed by the route's lookup or ordering column.

CREATE INDEX IF NOT EXISTS communications_tenant_created_idx
  ON app.communications (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS guardians_tenant_phone_idx
  ON app.guardians (tenant_id, phone);

CREATE INDEX IF NOT EXISTS notifications_tenant_user_created_idx
  ON app.notifications (tenant_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS wo_events_tenant_wo_created_idx
  ON app.wo_events (tenant_id, wo_id, created_at DESC);

CREATE INDEX IF NOT EXISTS route_stops_tenant_route_seq_idx
  ON app.route_stops (tenant_id, route_id, seq);
