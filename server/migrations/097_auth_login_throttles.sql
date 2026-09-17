-- 097: durable per-account password-login throttling.
-- IP/request rate limits alone do not stop a distributed password spray.
CREATE TABLE IF NOT EXISTS auth.login_throttles (
  user_id        uuid PRIMARY KEY,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until   timestamptz,
  last_failed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE auth.login_throttles ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.login_throttles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS login_throttles_kernel_only ON auth.login_throttles;
CREATE POLICY login_throttles_kernel_only ON auth.login_throttles FOR ALL TO schoolos_app USING (false);
REVOKE ALL ON auth.login_throttles FROM schoolos_app;
