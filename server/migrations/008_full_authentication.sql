-- 008: Full authentication — phone + Google SSO + OTP vault.
-- Login methods: email+password (existing), phone+OTP, Google SSO (OAuth code flow).
-- OTPs are never stored in plaintext; requests are rate-limited; every method audited.

ALTER TABLE app.users
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS auth_provider text NOT NULL DEFAULT 'password'
    CHECK (auth_provider IN ('password','google','phone'));
-- one phone per tenant (a parent could exist in two schools)
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_tenant_idx ON app.users(tenant_id, phone) WHERE phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS app.auth_otps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  phone       text NOT NULL,
  code_hash   text NOT NULL,               -- scrypt "salt:hash", same scheme as passwords
  purpose     text NOT NULL DEFAULT 'login' CHECK (purpose IN ('login')),
  attempts    int  NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,        -- 5 minutes
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_otps_phone_idx ON app.auth_otps(phone, created_at DESC);
ALTER TABLE app.auth_otps ENABLE ROW LEVEL SECURITY;
CREATE POLICY otps_kernel_only ON app.auth_otps FOR ALL TO schoolos_app USING (false);
-- OTP verification runs in the kernel path (owner connection) — the app role is denied entirely.
