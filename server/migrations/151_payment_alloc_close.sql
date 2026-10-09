-- 151 · close payment allocations when a payment leaves `initiated`.
--
-- Migration 138 created `payment_allocations.open` + partial unique index
-- `payment_alloc_one_open_per_obligation` ("an allocation is open while its payment
-- is initiated") but nothing ever set open=false: after ANY payment confirmed, every
-- later initiation on those obligations died with 23505 → HTTP 500. The role drill
-- (docs/FEE-DOMAIN-ROLE-DRILL.md F-03) proved it: principal re-pay after a confirm 500'd.
--
-- Fix at the schema level so EVERY exit path (confirm, refund, gateway fail, future
-- doors) closes the allocation: a trigger on payments.status. Plus a backfill for the
-- rows stranded open by the missing transition. Idempotent.

-- Backfill: close allocations whose payment is no longer initiated.
UPDATE app.payment_allocations pa
   SET open = false
  FROM app.payments p
 WHERE p.id = pa.payment_id
   AND p.status <> 'initiated'
   AND pa.open;

CREATE OR REPLACE FUNCTION app.payment_close_allocations() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'initiated' AND NEW.status IS DISTINCT FROM 'initiated' THEN
    UPDATE app.payment_allocations SET open = false WHERE payment_id = NEW.id AND open;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS payment_close_allocations ON app.payments;
CREATE TRIGGER payment_close_allocations
  AFTER UPDATE OF status ON app.payments
  FOR EACH ROW EXECUTE FUNCTION app.payment_close_allocations();
