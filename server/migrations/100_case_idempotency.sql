-- 100: retry-safe complaint creation for flaky mobile networks.
ALTER TABLE app.cases ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS cases_tenant_idempotency_uidx
  ON app.cases (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
