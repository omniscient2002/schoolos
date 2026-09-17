-- 101: DAT-2 census — two auth tables added after migration 082 carry bare user references.
--
--   096 auth.mfa_challenges      (tenant_id, user_id) — a pre-auth MFA challenge
--   097 auth.login_throttles     (user_id)            — a per-account password-spray counter
--
-- Both are REAL references to app.users, so the DAT-2 rule applies: constrain them rather than add an
-- allowlist exemption. mfa_challenges gets the tenant-aligned composite FK (it carries tenant_id, so a
-- single-column FK would be tenant-blind); login_throttles has no tenant_id and keys on the globally
-- unique app.users.id, so a single-column FK is correct there.
--
-- NOT VALID is deliberate (matching 092): a historical orphan challenge/throttle row must not fail a
-- deploy, while every NEW row is constrained immediately. ON DELETE CASCADE because both rows are
-- derived state with no ledger value; nothing in the codebase deletes users, so this is future-proofing
-- rather than an active path.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'login_throttles_user_fk') THEN
    ALTER TABLE auth.login_throttles
      ADD CONSTRAINT login_throttles_user_fk
      FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mfa_challenges_tenant_user_fk') THEN
    ALTER TABLE auth.mfa_challenges
      ADD CONSTRAINT mfa_challenges_tenant_user_fk
      FOREIGN KEY (tenant_id, user_id) REFERENCES app.users(tenant_id, id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
