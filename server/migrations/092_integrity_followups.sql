-- 092: DAT-12 follow-ups. Keep existing dirty rows observable, but make the
-- lifecycle invariants fail closed for every new row/update. NOT VALID is
-- deliberate: validation/backfill is a separate maintenance operation and
-- must not make a deploy fail because of historical data.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loan_status_check') THEN
    ALTER TABLE library.loan ADD CONSTRAINT loan_status_check
      CHECK (status IN ('issued', 'returned', 'lost')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_marked_by_check') THEN
    ALTER TABLE app.attendance ADD CONSTRAINT attendance_marked_by_check
      CHECK (marked_by IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cases_opened_by_check') THEN
    ALTER TABLE app.cases ADD CONSTRAINT cases_opened_by_check
      CHECK (opened_by IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'actions_decision_actor_check') THEN
    ALTER TABLE app.actions ADD CONSTRAINT actions_decision_actor_check
      CHECK (status IN ('open', 'expired') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)) NOT VALID;
  END IF;
END $$;

-- These columns are lifecycle timestamps and must never be omitted by a new
-- write. Existing NULLs remain available for an explicit cleanup/rebaseline.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fee_obligations_created_at_check') THEN
    ALTER TABLE app.fee_obligations ADD CONSTRAINT fee_obligations_created_at_check CHECK (created_at IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'routes_created_at_check') THEN
    ALTER TABLE app.routes ADD CONSTRAINT routes_created_at_check CHECK (created_at IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_created_at_check') THEN
    ALTER TABLE app.assets ADD CONSTRAINT assets_created_at_check CHECK (created_at IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_orders_created_at_check') THEN
    ALTER TABLE app.work_orders ADD CONSTRAINT work_orders_created_at_check CHECK (created_at IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wo_events_created_at_check') THEN
    ALTER TABLE app.wo_events ADD CONSTRAINT wo_events_created_at_check CHECK (created_at IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cases_created_at_check') THEN
    ALTER TABLE app.cases ADD CONSTRAINT cases_created_at_check CHECK (created_at IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'actions_created_at_check') THEN
    ALTER TABLE app.actions ADD CONSTRAINT actions_created_at_check CHECK (created_at IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'communications_created_at_check') THEN
    ALTER TABLE app.communications ADD CONSTRAINT communications_created_at_check CHECK (created_at IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_created_at_check') THEN
    ALTER TABLE app.notifications ADD CONSTRAINT notifications_created_at_check CHECK (created_at IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'migration_sources_created_at_check') THEN
    ALTER TABLE app.migration_sources ADD CONSTRAINT migration_sources_created_at_check CHECK (created_at IS NOT NULL) NOT VALID;
  END IF;
END $$;
