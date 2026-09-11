-- 060_payment_refund.sql — Wave 3 · L1-3.1: the refund leg of the payments loop.
-- payments.status='refunded' finally becomes reachable: refunds are explicit,
-- audited, gateway-verified reversals (the D-5/D-21 paid_cents invariant bans
-- SILENT decreases — a refund is the sanctioned, recorded one). The columns keep
-- the refund leg observable: when, why, and what the gateway answered.
ALTER TABLE app.payments
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz,
  ADD COLUMN IF NOT EXISTS refund_reason text,
  ADD COLUMN IF NOT EXISTS refund_gateway_ref text;

-- Reconciliation sweeps join on these constantly (L1-3.1 settle/reconcile).
CREATE INDEX IF NOT EXISTS payments_method_status_idx ON app.payments (tenant_id, method, status);
