-- 107 · FEX-15 / DAT-13 — the refunded amount is a first-class, constrained column.
--
-- The refund door reverses `fee_obligations.paid_cents` and flips the payment to 'refunded', but the
-- payment row carried no `refunded_cents`, so nothing in the schema expressed "how much of this payment
-- has been given back". A partial refund (the DAT-13 remainder) was therefore unrepresentable AND
-- unconstrained: a future edit could set a refund larger than the payment and the ledger would accept it.
-- This adds the column, backfills the full refunds that exist today, and puts the arithmetic under a
-- CHECK the database enforces.
ALTER TABLE app.payments
  ADD COLUMN IF NOT EXISTS refunded_cents bigint NOT NULL DEFAULT 0;

-- Backfill: every historically refunded payment was a full refund.
UPDATE app.payments SET refunded_cents = amount_cents
  WHERE status = 'refunded' AND refunded_cents = 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_refunded_cents_check') THEN
    ALTER TABLE app.payments ADD CONSTRAINT payments_refunded_cents_check
      CHECK (refunded_cents >= 0 AND refunded_cents <= amount_cents);
  END IF;
END $$;
