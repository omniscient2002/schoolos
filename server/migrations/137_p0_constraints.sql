-- 137_p0_constraints.sql — P0-7 from SCHOOL_OS_FULL_AUDIT.md
-- Missing money/mark CHECKs: the doors validated these, but the database did not, so an
-- impossible state (negative money, marks above the maximum) could still be persisted by any
-- path that bypassed the door. Repair first, then constrain.
--
-- All statements are idempotent (DROP CONSTRAINT IF EXISTS before ADD), so a replay is safe.

-- ── fee obligations: money is never negative ────────────────────────────────
UPDATE app.fee_obligations SET amount_cents = 0 WHERE amount_cents < 0;
ALTER TABLE app.fee_obligations DROP CONSTRAINT IF EXISTS fee_obligations_amount_nonneg;
ALTER TABLE app.fee_obligations
  ADD CONSTRAINT fee_obligations_amount_nonneg CHECK (amount_cents >= 0);

-- ── payments: money is never negative (amount, refunded, paid) ──────────────
UPDATE app.payments SET amount_cents = 0 WHERE amount_cents < 0;
ALTER TABLE app.payments DROP CONSTRAINT IF EXISTS payments_amount_nonneg;
ALTER TABLE app.payments
  ADD CONSTRAINT payments_amount_nonneg CHECK (amount_cents >= 0);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='app' AND table_name='payments' AND column_name='refunded_cents') THEN
    UPDATE app.payments SET refunded_cents = 0 WHERE refunded_cents < 0;
    ALTER TABLE app.payments DROP CONSTRAINT IF EXISTS payments_refunded_nonneg;
    ALTER TABLE app.payments ADD CONSTRAINT payments_refunded_nonneg CHECK (refunded_cents >= 0);
  END IF;
END $$;

-- ── exam marks: never above the maximum ─────────────────────────────────────
UPDATE plugin_exams.mark SET marks = max_marks WHERE marks > max_marks;
ALTER TABLE plugin_exams.mark DROP CONSTRAINT IF EXISTS mark_marks_lte_max;
ALTER TABLE plugin_exams.mark
  ADD CONSTRAINT mark_marks_lte_max CHECK (marks <= max_marks);
