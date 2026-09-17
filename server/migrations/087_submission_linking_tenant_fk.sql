-- 087 · close the two invariants migration 086 left open (DAT-1 tenant-blind FK, DAT-2 census).
-- Claimed via .coop/help.md per D-40 (the previous maximum was 086_submission_student_link.sql).
--
-- WHAT THIS FIXES. 086 created `teacher.submission_needs_linking` with a SINGLE-COLUMN FK
--   homework_id uuid NOT NULL REFERENCES teacher.homework(id) ON DELETE CASCADE
-- while BOTH tables carry `tenant_id`, so the DAT-1 invariant — "every FK between two tenant-scoped tables
-- is composite on (tenant_id, …)" — fails wherever 086 has run. A fresh-database run of
-- tests/dat1-tenant-alignment.test.js reports exactly one tenant-blind FK:
--   teacher.submission_needs_linking.homework_id → teacher.homework (submission_needs_linking_homework_id_fkey)
-- The DAT-2 census reports three FK-less columns the same table introduced. Neither suite had been re-run
-- between 086 landing and this round; the full CI-posture run is what caught it, which is the whole reason
-- a full run is the step that counts.
--
-- 086 is APPLIED and checksum-locked (migrate.js refuses a drifted file), so this is a NEW migration and the
-- applied file is never edited. On a fresh database 086 runs first and this file immediately corrects it.
--
-- THE TWO FK-LESS COLUMNS MUST BE A WRITTEN DECISION (DAT-2 census), not an absence:
--   · submission_id    — the PK holds the id of the teacher.submission row that was MOVED here and then
--                        DELETED at source, so no parent row exists to reference. Recorded as `policy`.
--   · prior_student_id — the raw pre-082 app.users id that could NOT be resolved to a roster student; an FK
--                        is precisely what was impossible. Recorded as `policy`.
--   · tenant_id        — the repo-wide `tenant-root` decision (app.tenants has no tenant_id column).
-- All three are added to the reviewed allowlist in tests/dat2-reference-integrity.test.js WITH their reasons.
--
-- ON DELETE: 086 chose CASCADE. This file uses RESTRICT, per DAT-2's recorded policy that RESTRICT cannot
-- lose data. Nothing in the codebase deletes teacher.homework, and the archive rows are historical evidence;
-- RESTRICT means a future delete attempt fails loudly instead of silently discarding moved submissions.
-- The constraint is named in the repo's `<child>_tenant_<col>_fkey` convention, which keeps it inside the
-- DAT-1 CASCADE-set test's pattern (`%_tenant_%_fkey`) where it is correctly counted as RESTRICT, not CASCADE.

-- ── 1. the composite-FK target 081 would have added had teacher.homework been in its parent list ────────
DO $$
BEGIN
  IF to_regclass('teacher.homework') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conrelid = 'teacher.homework'::regclass AND conname = 'homework_tenant_id_id_key') THEN
    ALTER TABLE teacher.homework ADD CONSTRAINT homework_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;
END $$;

-- ── 2. convert the tenant-blind FK to its tenant-aligned twin ───────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('teacher.submission_needs_linking') IS NULL THEN
    RAISE NOTICE '087: teacher.submission_needs_linking absent — nothing to convert';
    RETURN;
  END IF;
  -- Add the composite FK FIRST (NOT VALID), then drop the single-column one, then validate. NOT VALID means a
  -- database whose archive cannot satisfy the constraint still ends up with a tenant-aligned one rather than a
  -- migration that aborts every fresh environment; the validate is retried and only WARNS on failure.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'submission_needs_linking_tenant_homework_id_fkey') THEN
    ALTER TABLE teacher.submission_needs_linking
      ADD CONSTRAINT submission_needs_linking_tenant_homework_id_fkey
      FOREIGN KEY (tenant_id, homework_id) REFERENCES teacher.homework (tenant_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
  ALTER TABLE teacher.submission_needs_linking
    DROP CONSTRAINT IF EXISTS submission_needs_linking_homework_id_fkey;
  BEGIN
    ALTER TABLE teacher.submission_needs_linking
      VALIDATE CONSTRAINT submission_needs_linking_tenant_homework_id_fkey;
    RAISE NOTICE '087: submission_needs_linking.homework_id is now tenant-aligned';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE WARNING '087: submission_needs_linking_tenant_homework_id_fkey has rows it cannot validate — it '
      'stays NOT VALID and the next run retries';
  END;
END $$;
