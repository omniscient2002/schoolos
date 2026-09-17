-- 103 · AUTH-4 + AUTH-8 (PERFECT-100 §9.2) — durable, IDENTIFIER-keyed throttling.
--
--   AUTH-4: the per-account lock in auth.login_throttles keys on `user_id`, so an UNKNOWN email could not be
--           counted at all. A known-locked email returned 429 while a stranger returned 401 — an account
--           enumeration oracle — and five unauthenticated requests could lock any staff account for 15 min.
--   AUTH-8: `/auth/otp/request` had no per-phone throttle at all → SMS toll fraud / bombing.
--
-- Both share one shape: count attempts against a HASHED identifier (email or E.164 phone), independent of
-- whether an account exists. A known and an unknown identifier therefore throttle identically, and the
-- login door answers the same 429 either way.
--
-- `identifier` stores a sha256 hex of the normalised email/phone (never the raw value), so the table holds
-- no PII and a leaked row cannot be reversed to an address.
--
-- Kernel-only: the app role is denied by RLS and holds no grant — every read/write goes through `sysq`.
CREATE TABLE IF NOT EXISTS auth.request_throttles (
  scope            text NOT NULL,             -- 'login' | 'otp.request'
  identifier       text NOT NULL,             -- sha256 hex of the normalised email/phone
  attempts         integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at  timestamptz,
  locked_until     timestamptz,
  PRIMARY KEY (scope, identifier)
);
CREATE INDEX IF NOT EXISTS request_throttles_locked_idx ON auth.request_throttles (locked_until) WHERE locked_until IS NOT NULL;

ALTER TABLE auth.request_throttles ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.request_throttles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS request_throttles_kernel_only ON auth.request_throttles;
CREATE POLICY request_throttles_kernel_only ON auth.request_throttles FOR ALL TO schoolos_app USING (false);
REVOKE ALL ON auth.request_throttles FROM schoolos_app;
