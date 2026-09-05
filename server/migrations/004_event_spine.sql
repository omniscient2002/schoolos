-- 004: Event envelope v2 + event lineage + plugin drain protocol.
-- docs/12 §23 items 3+4+6: envelope, budgets enforcement, lineage view, drain.

-- ── events: envelope v2 columns ──
ALTER TABLE app.events
  ADD COLUMN IF NOT EXISTS schema_version  integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS emitted_by      text NOT NULL DEFAULT 'kernel',
  ADD COLUMN IF NOT EXISTS subject         text,
  ADD COLUMN IF NOT EXISTS correlation_id  uuid,
  ADD COLUMN IF NOT EXISTS causation_id    uuid,
  ADD COLUMN IF NOT EXISTS payload         jsonb;

-- ── outbox: envelope v2 mirrors events (dispatcher reads here) ──
ALTER TABLE app.outbox
  ADD COLUMN IF NOT EXISTS event_id        uuid REFERENCES app.events(id),
  ADD COLUMN IF NOT EXISTS schema_version  integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS emitted_by      text NOT NULL DEFAULT 'kernel',
  ADD COLUMN IF NOT EXISTS subject         text,
  ADD COLUMN IF NOT EXISTS correlation_id  uuid,
  ADD COLUMN IF NOT EXISTS causation_id    uuid,
  ADD COLUMN IF NOT EXISTS attempts        integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error      text;
-- backfill linkage for existing rows (defensive: only where the event still exists)
UPDATE app.outbox o SET event_id = (o.payload->>'eventId')::uuid
  WHERE o.event_id IS NULL AND o.payload ? 'eventId'
    AND EXISTS (SELECT 1 FROM app.events e WHERE e.id = (o.payload->>'eventId')::uuid);

-- ── event_action_link: the lineage spine (event → action → downstream) ──
CREATE TABLE IF NOT EXISTS app.event_action_link (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  event_id       uuid REFERENCES app.events(id),
  outbox_id      uuid REFERENCES app.outbox(id),
  action_id      uuid REFERENCES app.actions(id),
  downstream_event_id uuid REFERENCES app.events(id),
  relation       text NOT NULL DEFAULT 'raised' CHECK (relation IN ('raised','triggered','notified','resolved')),
  policy_ref     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, action_id, relation)
);
CREATE INDEX IF NOT EXISTS eal_tenant_idx ON app.event_action_link(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS eal_event_idx  ON app.event_action_link(event_id);
ALTER TABLE app.event_action_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.event_action_link FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.event_action_link;
CREATE POLICY tenant_isolation ON app.event_action_link
  USING (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('schoolos.tenant_id', true)::uuid);

-- ── plugin event budgets: defaults per docs/12 §10 (columns exist since 003) ──
UPDATE app.plugins SET event_budget = jsonb_build_object(
  'events_per_min', 60, 'payload_max_bytes', 65536, 'subscriber_max', 25,
  'fanout_max', 50, 'chain_depth_max', 5, 'replay_max', 10000, 'scheduled_per_day', 100
) WHERE event_budget = '{}'::jsonb;
