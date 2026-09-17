-- 099: dispatcher claims are leases, not long transactions around provider calls.
ALTER TABLE app.communications ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE app.communications ADD COLUMN IF NOT EXISTS claimed_by text;
CREATE INDEX IF NOT EXISTS comms_claims_idx
  ON app.communications (claimed_at) WHERE status='queued';
