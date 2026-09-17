-- 098: caller-provided replay key for fee-payment initiation.
ALTER TABLE app.payments ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS payments_tenant_idempotency_uidx
  ON app.payments (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
