-- 138_p0_payment_and_attendance.sql — P0-1 from SCHOOL_OS_FULL_AUDIT.md
--
-- P0-1: the "one open payment per obligation" guard keyed on app.payments(tenant_id, obligation_id),
-- but a pay-many payment stores obligation_id = NULL and carries its obligations in
-- app.payment_allocations. So two concurrent pay-many initiations for the same obligation could both
-- succeed. Enforce exclusivity on the ALLOCATION: an allocation is `open` while its payment is
-- `initiated`; a partial unique index then allows exactly one open allocation per obligation.
-- Idempotent: safe to replay.

ALTER TABLE app.payment_allocations ADD COLUMN IF NOT EXISTS open boolean NOT NULL DEFAULT true;

-- Backfill from the parent payment's current status.
UPDATE app.payment_allocations pa
   SET open = (p.status = 'initiated')
  FROM app.payments p
 WHERE p.id = pa.payment_id
   AND pa.open <> (p.status = 'initiated');

CREATE UNIQUE INDEX IF NOT EXISTS payment_alloc_one_open_per_obligation
  ON app.payment_allocations (tenant_id, obligation_id) WHERE open;
