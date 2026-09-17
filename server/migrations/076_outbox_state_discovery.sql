-- 076 · outbox discovery is STATE-based, not time-windowed — DAT-4 and its twin DAT-14.
-- Claimed via .coop/help.md (076 was reserved for the webhook/relay fail-closed work).
--
-- THE DEFECT (one shape, three consumers). Every outbox consumer discovered work with a TIME
-- WINDOW and no marker:
--   webhook-worker.js   WHERE o.created_at > now() - interval '1 hour'
--   workflow-worker.js  WHERE created_at  > now() - interval '1 hour' ORDER BY created_at LIMIT 50
-- Both consequences follow from that single choice:
--   1. AN OUTAGE LONGER THAN THE WINDOW IS PERMANENT DATA LOSS. A worker down for 61 minutes
--      comes back, sees nothing older than an hour, and never looks again. The events in the gap
--      are not late — they are gone, silently, with no gap metric and no alert. "At-least-once"
--      is only true while nothing goes wrong for an hour.
--   2. STARVATION, with no cursor to protect against it. The workflow runner re-reads the SAME
--      oldest 50 rows every tick forever, so once more than 50 rows match inside the window the
--      rest are NEVER seen — the window does not bound the scan, it bounds what can ever be
--      processed. (The relay and webhook worker are less exposed only because they have no
--      LIMIT… the webhook worker does have one, which is why it is pinned in tests too.)
--
-- THE FIX: a per-consumer marker on the row. Discovery becomes `marker IS NULL ORDER BY
-- created_at LIMIT n` — a plain page over an index, oldest-first, so a worker that was down for
-- a day recovers everything when it returns, and a worker under load can never starve a row
-- behind the head of the queue. The markers are per CONSUMER because the relay, the webhook
-- fan-out and the workflow runner each read the same spine independently; one shared
-- "processed" flag is exactly the conflation 073 had to undo for parked rows.
--
--   discovered_at       — the webhook fan-out has CONSIDERED this row for delivery rows
--   workflow_scanned_at — the workflow runner has EVALUATED this row against enabled rules
--
-- "Considered", not "delivered": a row that matched no subscription is still discovered, so it is
-- not rescanned every 5 seconds forever. That also fixes the semantics of subscribing LATE — a
-- subscription created now must not receive an unbounded backlog of everything that ever
-- happened, and it must not re-deliver to receivers because an old row was re-scanned.
--
-- BACKFILL IS DELIBERATE AND CONSERVATIVE: existing rows are marked as already discovered, so the
-- new logic starts from the upgrade point. Leaving them NULL would hand every receiver the entire
-- retained history in one burst on deploy. The outage guarantee this migration provides is about
-- events that arrive AFTER it — which is when an outage actually happens.
--
-- Idempotent: IF NOT EXISTS throughout, so it is safe on a database that already has it.

ALTER TABLE app.outbox ADD COLUMN IF NOT EXISTS discovered_at timestamptz;
ALTER TABLE app.outbox ADD COLUMN IF NOT EXISTS workflow_scanned_at timestamptz;

COMMENT ON COLUMN app.outbox.discovered_at IS
  'When the webhook fan-out considered this row for per-subscription delivery rows. NULL = not yet '
  'considered. Replaces the 1-hour time window that silently orphaned events during longer outages.';
COMMENT ON COLUMN app.outbox.workflow_scanned_at IS
  'When the workflow runner evaluated this row against enabled rules. NULL = not yet evaluated. '
  'Replaces the 1-hour window + LIMIT with no cursor that starved every row past the first batch.';

-- Both consumers page `marker IS NULL ORDER BY created_at LIMIT n`, so the partial indexes match
-- the query predicate exactly and the scan stays proportional to the OUTSTANDING work rather than
-- to the size of the retained spine.
CREATE INDEX IF NOT EXISTS outbox_undiscovered_idx
  ON app.outbox (created_at) WHERE discovered_at IS NULL;
CREATE INDEX IF NOT EXISTS outbox_workflow_unscanned_idx
  ON app.outbox (created_at) WHERE workflow_scanned_at IS NULL;

-- The workflow runner additionally skips rows it wrote itself ('wf:' dedup keys) to stop rules
-- triggering rules; index that predicate too so the residual filter does not force a heap fetch
-- on every candidate.
CREATE INDEX IF NOT EXISTS outbox_workflow_unscanned_notwf_idx
  ON app.outbox (created_at) WHERE workflow_scanned_at IS NULL AND dedup_key IS NULL;

DO $$
DECLARE d int; w int;
BEGIN
  -- Conservative backfill (see the header): rows that exist at upgrade time are treated as already
  -- considered by both consumers, so the fix applies to events created from now on and no receiver
  -- gets a burst of retained history. Marked with now() rather than their created_at so the marker
  -- reads as "considered at this moment", which is what happened.
  UPDATE app.outbox SET discovered_at = now() WHERE discovered_at IS NULL;
  GET DIAGNOSTICS d = ROW_COUNT;
  UPDATE app.outbox SET workflow_scanned_at = now() WHERE workflow_scanned_at IS NULL;
  GET DIAGNOSTICS w = ROW_COUNT;
  IF d > 0 OR w > 0 THEN
    RAISE NOTICE '076: backfilled % outbox row(s) as webhook-discovered and % as workflow-scanned — discovery is state-based from here on', d, w;
  END IF;
END $$;
