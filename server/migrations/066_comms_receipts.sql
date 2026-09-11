-- 058 · comms provider receipts (L2-3.3, Wave 3 — claimed by L2, blocks.md).
-- The dispatcher persists WHICH provider carried a row and its reference
-- (wamid / message id / rail log ref) — the audit trail answers "was it really
-- sent, by whom, with what receipt" without grep-ing provider logs.
ALTER TABLE app.communications
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_ref text;
