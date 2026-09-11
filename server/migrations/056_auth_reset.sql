-- 056 · auth reset tokens (L2-2.2, Wave 2 — claimed by L2 per D-11, blocks.md).
-- Single-use password-reset tokens: the raw token (32 bytes CSPRNG hex) lives
-- ONLY in the rendered email; the table stores the sha256 hash. 008-vault
-- parity: kernel-only writes via the owner path, no grants to schoolos_app,
-- RLS USING(false) so even a future broad grant sees nothing.
CREATE TABLE IF NOT EXISTS auth.reset_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  user_id     uuid NOT NULL,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reset_tokens_user_open_idx
  ON auth.reset_tokens (user_id, created_at DESC) WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS reset_tokens_expired_idx
  ON auth.reset_tokens (expires_at) WHERE consumed_at IS NULL; -- retention sweep
ALTER TABLE auth.reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.reset_tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reset_tokens_kernel_only ON auth.reset_tokens;
CREATE POLICY reset_tokens_kernel_only ON auth.reset_tokens
  FOR ALL TO schoolos_app USING (false);
