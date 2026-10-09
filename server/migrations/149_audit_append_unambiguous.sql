-- 149 · Audit append: one signature (F-19 follow-up).
--
-- WHAT THIS FIXES
--   · 148 added a 15-argument overload of `app.audit_append(..., p_ip inet)`
--     alongside the 14-argument version from 075. A call with fourteen untyped
--     arguments then matched BOTH signatures, and PostgreSQL refused it with
--     "function app.audit_append(...) is not unique" — breaking seed.js and any
--     direct 14-arg caller.
--   · This drops the 14-argument version. Fourteen-argument calls now resolve to
--     the 15-argument function via `p_ip DEFAULT NULL` — identical behaviour to
--     075 (ip NULL, trigger hashes it the same way).
--
-- LAWS OBEYED
--   · D-35: no grant changes. Idempotent: DROP IF EXISTS.

BEGIN;

DROP FUNCTION IF EXISTS app.audit_append(
  uuid, text, text, text, text, text, text, text, boolean, text, text, text, text, timestamptz);

COMMIT;
