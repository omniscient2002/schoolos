-- 040 · security-cyc8: OAuth state table (login-CSRF fix) + purge hygiene.
-- The state parameter for the Google OAuth flow is stored server-side with a
-- 10-minute TTL and single-use semantics (checked+deleted in the callback).
BEGIN;

CREATE TABLE IF NOT EXISTS app.oauth_states (
  state      text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON app.oauth_states TO schoolos_app;

COMMIT;
