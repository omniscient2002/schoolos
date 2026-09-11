-- 071 · workflow rules (L2-5.2, Wave 5 — claimed per D-40, help.md).
-- Minimal honest step-runner state: one rule = topic filter + tiny condition
-- vocabulary + ONE action (outbox fan-out or comms enqueue). No chains: the
-- runner refuses to act on events whose dedup key carries the 'wf:' prefix,
-- so a rule's own output can never re-trigger rules.
CREATE TABLE IF NOT EXISTS app.workflow_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  name        text NOT NULL,
  topic       text NOT NULL,
  condition   jsonb,
  action      jsonb NOT NULL,
  enabled     boolean NOT NULL DEFAULT true,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (condition IS NULL OR (condition ? 'field' AND condition ? 'op')),
  CHECK (action ? 'kind' AND action->>'kind' IN ('outbox','comms'))
);
CREATE INDEX IF NOT EXISTS workflow_rules_tenant_topic_idx ON app.workflow_rules (tenant_id, topic) WHERE enabled;

ALTER TABLE app.workflow_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.workflow_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workflow_rules_tenant ON app.workflow_rules;
CREATE POLICY workflow_rules_tenant ON app.workflow_rules
  USING (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('schoolos.tenant_id', true)::uuid);

REVOKE ALL ON app.workflow_rules FROM schoolos_app;
GRANT SELECT, INSERT, UPDATE ON app.workflow_rules TO schoolos_app;

-- dedup teeth for the runner's idempotence: (rule, event) may fire exactly once.
-- app.outbox never had a dedup_key column (the relay deduped by consumer
-- semantics) — add it, then the partial uniques so pre-dedup rows never block.
ALTER TABLE app.outbox ADD COLUMN IF NOT EXISTS dedup_key text;
CREATE UNIQUE INDEX IF NOT EXISTS outbox_dedup_key_uidx ON app.outbox (dedup_key) WHERE dedup_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS communications_dedup_key_uidx ON app.communications (dedup_key) WHERE dedup_key IS NOT NULL;
