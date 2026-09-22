-- 115 · tenant-aligned references for the lesson + handover tables (114).
--
-- 114 created teacher.lesson and teacher.handover_packet without foreign keys; the DAT-2
-- census (tests/dat2-reference-integrity.test.js) correctly refuses an FK-less `*_id` column
-- unless it is a written decision. These columns DO have parents, so the right answer is a
-- constraint, not an allowlist entry — the 082 worked example.
--
-- Composite (tenant_id, id) FKs so a row can never point at another tenant's teacher or leave
-- request. Idempotent: DROP CONSTRAINT IF EXISTS + ADD.

BEGIN;

-- teacher.leave_request needs the composite key the FK targets (031 declared only the PK).
ALTER TABLE teacher.leave_request DROP CONSTRAINT IF EXISTS leave_request_tenant_id_id_key;
ALTER TABLE teacher.leave_request ADD CONSTRAINT leave_request_tenant_id_id_key UNIQUE (tenant_id, id);

-- teacher.lesson.teacher_id → app.users(tenant_id, id)
ALTER TABLE teacher.lesson DROP CONSTRAINT IF EXISTS lesson_teacher_id_ref_fkey;
ALTER TABLE teacher.lesson ADD CONSTRAINT lesson_teacher_id_ref_fkey
  FOREIGN KEY (tenant_id, teacher_id) REFERENCES app.users(tenant_id, id) ON DELETE RESTRICT;

-- teacher.handover_packet.teacher_id → app.users(tenant_id, id)
ALTER TABLE teacher.handover_packet DROP CONSTRAINT IF EXISTS handover_packet_teacher_id_ref_fkey;
ALTER TABLE teacher.handover_packet ADD CONSTRAINT handover_packet_teacher_id_ref_fkey
  FOREIGN KEY (tenant_id, teacher_id) REFERENCES app.users(tenant_id, id) ON DELETE RESTRICT;

-- teacher.handover_packet.substitute_id → app.users(tenant_id, id) (nullable)
ALTER TABLE teacher.handover_packet DROP CONSTRAINT IF EXISTS handover_packet_substitute_id_ref_fkey;
ALTER TABLE teacher.handover_packet ADD CONSTRAINT handover_packet_substitute_id_ref_fkey
  FOREIGN KEY (tenant_id, substitute_id) REFERENCES app.users(tenant_id, id) ON DELETE SET NULL;

-- teacher.handover_packet.leave_request_id → teacher.leave_request(tenant_id, id)
ALTER TABLE teacher.handover_packet DROP CONSTRAINT IF EXISTS handover_packet_leave_request_id_ref_fkey;
ALTER TABLE teacher.handover_packet ADD CONSTRAINT handover_packet_leave_request_id_ref_fkey
  FOREIGN KEY (tenant_id, leave_request_id) REFERENCES teacher.leave_request(tenant_id, id) ON DELETE CASCADE;

COMMIT;
