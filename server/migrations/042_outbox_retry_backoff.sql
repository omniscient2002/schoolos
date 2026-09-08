-- 042 · outbox retry pacing (re-scan cycle-1 P2 follow-up)
-- The relay's failure semantics need a "when may this row be retried" marker:
-- without it a failing row was re-claimed every poll tick, so poison rows
-- hammered subscribers at the raw poll rate until the attempts cap parked them.
-- next_attempt_at carries the exponential backoff (set by the worker on every
-- failed delivery; NULL ⇒ immediately eligible). Idempotent; the column is
-- additive so the worker also self-ensures it at startup for pre-042 databases.
ALTER TABLE app.outbox ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;

-- The relay's only access path is "unprocessed, oldest first" — give it a
-- partial index that shrinks as the queue drains.
CREATE INDEX IF NOT EXISTS outbox_due_idx ON app.outbox (created_at) WHERE processed_at IS NULL;
