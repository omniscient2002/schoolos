-- 094: OPS-16 restore reconciliation. The token is encrypted with the same
-- tenant-bound key material used for plugin secrets; the journal never exposes
-- the subject phone as plaintext. replayed_at makes the restore operation
-- auditable and idempotent.
ALTER TABLE plugin_dpdp.erasure_journal
  ADD COLUMN IF NOT EXISTS subject_token jsonb,
  ADD COLUMN IF NOT EXISTS replayed_at timestamptz;
