-- 126 · shared student-session activity store (C3).
--
-- The student idle window was enforced from an in-process Map keyed by jti, so it did not hold across
-- replicas: a kiosk session idle on replica A could be treated as fresh by replica B. This table is the
-- shared store the authenticate hook reads/writes for `role='student'`. It lives in the `auth` schema
-- (kernel-only: no grant to schoolos_app; the hook uses the owner path via sysq), like the other
-- session state (auth.revoked_token, auth.mfa_challenges).

BEGIN;

CREATE TABLE IF NOT EXISTS auth.session_activity (
  jti          text PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES app.tenants(id),
  user_id      uuid NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS session_activity_seen_idx ON auth.session_activity (last_seen_at);

COMMIT;
