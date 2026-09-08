-- 041 · migration integrity — per-file checksums (ops audit P1-8)
-- The runner records sha256(migrations/<name>) at apply time and re-verifies it on
-- every later run: a migration file edited after it was applied hard-fails with
-- "migration file drifted after apply". Idempotent (ADD COLUMN IF NOT EXISTS); the
-- runner also ensures the same column before 041 itself applies on a fresh database,
-- so first-run checksum stamping works from 001 onward.
ALTER TABLE app.schema_migrations ADD COLUMN IF NOT EXISTS checksum text;
