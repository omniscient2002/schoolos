-- 055 · auth session control (L2-2.1, Wave 2 — claimed by L2 per D-11).
-- Session epoch: every JWT carries the user's epoch at issue time (claim `ep`,
-- default 1 for pre-055 tokens); the authenticate hook rejects tokens whose
-- epoch is older than the row's. A credential change (POST /me/password)
-- increments the epoch, which instantly kills every OTHER outstanding session
-- without needing a registry of live jti — the caller is re-issued a fresh
-- token with the new epoch in the same response.
ALTER TABLE app.users
  ADD COLUMN IF NOT EXISTS session_epoch integer NOT NULL DEFAULT 1;
