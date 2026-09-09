-- 043 · comms dispatch — queue-drain columns for the Communication Orchestrator's
-- missing consumer (Wave A). docs/DATA-FLOW §20 (post-audit honesty rule):
-- kernel-approved sends land in app.communications as status='queued' and NOTHING
-- drained them. The dispatcher (scripts/comms-dispatcher.js, outbox-relay model,
-- 042 retry semantics) claims due rows FOR UPDATE SKIP LOCKED, hands each to its
-- rail (channel 'sms' → rails.sms.sendSms, 'whatsapp' → rails.whatsapp.sendWhatsapp,
-- anything else → durable log-only line), and stamps the outcome on the row.
--
-- Additive + idempotent; the dispatcher also self-ensures these columns at startup
-- (042 worker pattern) so a worker pointed at a pre-043 database degrades, not crashes.

ALTER TABLE app.communications ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 1;
ALTER TABLE app.communications ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE app.communications ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;

-- The dispatcher's only access path is "queued, oldest first" — a partial index that
-- shrinks as the queue drains (outbox_due_idx parity from 042).
CREATE INDEX IF NOT EXISTS comms_queued_idx ON app.communications (created_at) WHERE status='queued';

-- Failed rows park after the attempts cap (outbox parity) — the ops inspection path
-- and any future re-queue sweep read exactly this shrinking slice.
CREATE INDEX IF NOT EXISTS comms_failed_idx ON app.communications (created_at) WHERE status='failed';
