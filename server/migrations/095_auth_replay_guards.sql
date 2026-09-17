-- 095: prevent replay of an already accepted TOTP moving factor.
ALTER TABLE auth.mfa_secrets
  ADD COLUMN IF NOT EXISTS last_totp_step bigint;
