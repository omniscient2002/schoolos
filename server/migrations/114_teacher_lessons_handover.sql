-- 114 · TEACHER lessons lifecycle + leave handover packet
--        (TEACHER-PARENT-STUDENT-PERFECT-100 PRD-2 / DAT-4, DEL-3).
--
-- Two tables the register named but the tree never had:
--   teacher.lesson           — the lesson workspace (planned → prepared → teaching → completed →
--                              reflected); a 10–20s reflection updates curriculum progress.
--   teacher.handover_packet  — the deterministic packet generated when the coordinator approves a
--                              teacher's leave: the affected periods, class/subject/room, and a
--                              suggested activity. Rendered on the teacher's My-leave card.
--
-- Both are tenant-scoped, FORCE RLS, app-role SELECT/INSERT/UPDATE (no DELETE — records persist),
-- and every write is audited by the doors that touch them.

-- ── teacher.lesson ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teacher.lesson (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  teacher_id   uuid NOT NULL,
  class_grade  text NOT NULL,
  subject      text NOT NULL,
  lesson_date  date NOT NULL,
  period       int,
  topic        text NOT NULL,
  objectives   jsonb NOT NULL DEFAULT '[]'::jsonb,
  resources    jsonb NOT NULL DEFAULT '[]'::jsonb,
  reflection   jsonb,
  status       text NOT NULL DEFAULT 'planned'
                 CHECK (status IN ('planned','prepared','teaching','completed','reflected')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS teacher_lesson_owner_date_idx ON teacher.lesson (tenant_id, teacher_id, lesson_date DESC);

-- ── teacher.handover_packet ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teacher.handover_packet (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  leave_request_id uuid NOT NULL UNIQUE,
  teacher_id       uuid NOT NULL,
  substitute_id    uuid,
  substitute_name  text,
  classes          jsonb NOT NULL DEFAULT '[]'::jsonb,
  packet_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS teacher_handover_leave_idx ON teacher.handover_packet (tenant_id, leave_request_id);

-- ── RLS: tenant isolation, FORCE (113 precedent) ───────────────────────────────────
DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lesson','handover_packet'] LOOP
    EXECUTE format('ALTER TABLE teacher.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE teacher.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON teacher.%I', t);
    EXECUTE format($f$CREATE POLICY tenant_isolation ON teacher.%I
      USING (tenant_id = app.current_tenant()::uuid)
      WITH CHECK (tenant_id = app.current_tenant()::uuid)$f$, t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON teacher.lesson, teacher.handover_packet TO schoolos_app;
