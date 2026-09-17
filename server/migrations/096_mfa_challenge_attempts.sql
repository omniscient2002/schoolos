-- 096: bound guesses against a pre-authentication MFA challenge.  The JWT is
-- bearer material, so attempts must be keyed by its jti in a kernel-only table,
-- not by process memory or the caller's IP.
CREATE TABLE IF NOT EXISTS auth.mfa_challenges (
  jti         text PRIMARY KEY,
  user_id     uuid NOT NULL,
  tenant_id   uuid NOT NULL,
  attempts    integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mfa_challenges_expiry_idx ON auth.mfa_challenges (expires_at);
ALTER TABLE auth.mfa_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.mfa_challenges FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfa_challenges_kernel_only ON auth.mfa_challenges;
CREATE POLICY mfa_challenges_kernel_only ON auth.mfa_challenges FOR ALL TO schoolos_app USING (false);
REVOKE ALL ON auth.mfa_challenges FROM schoolos_app;
