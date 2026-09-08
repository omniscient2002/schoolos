-- 038 · auth token revocation (security matrix A3): logout must actually end a session.
-- Stateless JWTs otherwise stay valid until natural expiry — on shared school computers
-- that is an abandoned-kiosk takeover risk (StudentOS §62/§63/§78).
-- Design: every minted token carries a jti; /auth/logout records it; the authenticate
-- hook refuses revoked jtis until natural expiry. The cleanup is automatic (expired
-- rows are deleted opportunistically on logout and on check).
BEGIN;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.revoked_token (
  jti        text PRIMARY KEY,
  tenant_id  uuid,
  revoked_at timestamptz NOT NULL DEFAULT now(),
  exp        timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS revoked_token_exp_idx ON auth.revoked_token (exp);

-- Service plane: read/written by the authenticate hook and the logout door, which run
-- outside user impersonation (no tenant GUC yet at verify time). No RLS — the table
-- holds only opaque token ids and expiry timestamps, never personal payload data.
GRANT SELECT, INSERT, DELETE ON auth.revoked_token TO schoolos_app;
GRANT USAGE ON SCHEMA auth TO schoolos_app;

COMMIT;
