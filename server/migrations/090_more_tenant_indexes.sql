-- 090: five more additive indexes from PERFECT-100 DAT-9.

CREATE INDEX IF NOT EXISTS transport_events_tenant_route_time_idx
  ON app.transport_events (tenant_id, route_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS outbox_tenant_pending_idx
  ON app.outbox (tenant_id, created_at)
  WHERE processed_at IS NULL AND parked_at IS NULL;

CREATE INDEX IF NOT EXISTS webhook_deliveries_tenant_due_idx
  ON app.webhook_deliveries (tenant_id, next_attempt_at)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS memory_entries_tenant_decided_idx
  ON app.memory_entries (tenant_id, decided_at DESC);

CREATE INDEX IF NOT EXISTS payments_tenant_student_idx
  ON app.payments (tenant_id, student_id);
