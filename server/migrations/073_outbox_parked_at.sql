-- 073 · app.outbox.parked_at — make relay FAILURE distinguishable from relay IDLENESS.
-- Claimed via .coop/help.md. Closes the §4 H5 / §5.9 "success-shaped silence" instance
-- in the event spine, and the ops finding that parked rows are counted as processed.
--
-- THE DEFECT: the relay's park path set processed_at = now(), and the ONLY queue gauge
-- (src/app.js, outbox_pending) counts `processed_at IS NULL`. So the moment a poison row
-- exhausted MAX_ATTEMPTS and parked, the pending gauge FELL — i.e. a total relay failure
-- produced exactly the same metric signature as a healthy, idle system. An operator
-- watching the only available signal would see the queue draining and conclude all was
-- well while every event was being dropped.
--
-- Two separate states now exist and stay distinct, permanently:
--   processed_at IS NOT NULL, parked_at IS NULL  → genuinely delivered
--   parked_at    IS NOT NULL, processed_at NULL  → gave up after MAX_ATTEMPTS
--   both NULL                                    → pending (still being attempted)
--
-- DELIBERATELY NOT SETTING processed_at ON PARK is the point: parked rows must not be
-- silently absorbed into the "done" population. They are terminal for the RELAY but not
-- for a HUMAN, so retention (scripts/retention-worker.js) was also updated to age out
-- parked rows separately — otherwise poison rows would accumulate forever.
--
-- Idempotent: IF NOT EXISTS throughout, so it is safe on a database that already has it.

ALTER TABLE app.outbox ADD COLUMN IF NOT EXISTS parked_at timestamptz;

COMMENT ON COLUMN app.outbox.parked_at IS
  'Set when the relay gives up after MAX_ATTEMPTS. Terminal for the relay; NOT delivery. '
  'Kept distinct from processed_at so a failing relay cannot look like an idle one.';

-- The gauge and the park query both filter on this column; a partial index keeps the
-- cheap metrics query cheap as parked rows accumulate.
CREATE INDEX IF NOT EXISTS outbox_parked_at_idx
  ON app.outbox (parked_at) WHERE parked_at IS NOT NULL;

-- The pending gauge is the inverse shape (unprocessed AND unparked); index it too so the
-- single most-watched metric in the system does not degrade into a sequential scan.
CREATE INDEX IF NOT EXISTS outbox_pending_idx
  ON app.outbox (created_at) WHERE processed_at IS NULL AND parked_at IS NULL;

-- Repair any row parked by the PREVIOUS worker implementation. Those rows carry the park
-- marker in last_error but were stamped processed_at = now(); without this backfill the
-- parked population is invisible to the new gauge and the fix would only apply to future
-- failures. last_error is the only surviving evidence, so it is what we key on.
--
-- processed_at is NULLed rather than kept: such a row was NEVER delivered, so leaving
-- processed_at set would preserve exactly the lie this migration exists to remove. It is
-- reclassified, not deleted — the payload and the error are still there for inspection.
DO $$
DECLARE n int;
BEGIN
  UPDATE app.outbox
     SET parked_at = COALESCE(processed_at, now()),
         processed_at = NULL
   WHERE parked_at IS NULL
     AND last_error LIKE 'max attempts%';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    RAISE NOTICE '073: reclassified % previously-parked row(s) from processed_at to parked_at — they were being counted as delivered and were not', n;
  END IF;
END $$;
