-- 057 · staff MFA (TOTP) (L2-3.2, Wave 3 — claimed by L2 per D-11, blocks.md).
-- TOTP secrets and recovery codes NEVER live in app.users (whose rows the
-- schoolos_app role reads for rosters): both ride kernel-only tables with
-- USING(false) policies — 008-vault posture, owner-path writes only.
ALTER TABLE app.users
  ADD COLUMN IF NOT EXISTS mfa_enrolled_at timestamptz; -- roster-visible fact only (no secret)

CREATE TABLE IF NOT EXISTS auth.mfa_secrets (
  user_id   uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  secret    text NOT NULL,              -- base32 (RFC 4648), CSPRNG-generated
  enabled   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth.mfa_recovery_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  tenant_id   uuid NOT NULL,
  code_hash   text NOT NULL,            -- sha256 of the once-shown code
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mfa_recovery_open_idx
  ON auth.mfa_recovery_codes (user_id) WHERE consumed_at IS NULL;

ALTER TABLE auth.mfa_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.mfa_secrets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfa_secrets_kernel_only ON auth.mfa_secrets;
CREATE POLICY mfa_secrets_kernel_only ON auth.mfa_secrets FOR ALL TO schoolos_app USING (false);

ALTER TABLE auth.mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.mfa_recovery_codes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfa_recovery_kernel_only ON auth.mfa_recovery_codes;
CREATE POLICY mfa_recovery_kernel_only ON auth.mfa_recovery_codes FOR ALL TO schoolos_app USING (false);
