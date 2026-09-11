-- 062_exam_board_policy.sql — Wave 4 · L1-4.3: per-exam board policy json.
-- The tenant-level board policy already lives in plugin settings; this adds the
-- PER-EXAM override (a CBSE term exam and a state-board practice paper can carry
-- different policies). Validation-only this sprint: the door validates the shape
-- and stores it — nothing consumes it yet (recorded honestly in the door reply).
ALTER TABLE plugin_exams.exam
  ADD COLUMN IF NOT EXISTS board_policy jsonb;
