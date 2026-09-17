-- 091: remaining high-read tenant/FK indexes from DAT-9.

CREATE INDEX IF NOT EXISTS attendance_student_date_idx
  ON app.attendance (student_id, school_date DESC);
CREATE INDEX IF NOT EXISTS loan_book_status_idx
  ON library.loan (book_id, status) WHERE status = 'issued';
CREATE INDEX IF NOT EXISTS child_link_tenant_user_idx
  ON family.child_link (tenant_id, user_id, student_id);
CREATE INDEX IF NOT EXISTS teacher_homework_tenant_student_idx
  ON teacher.homework (tenant_id, class_grade, due_at);
CREATE INDEX IF NOT EXISTS teacher_concern_tenant_student_idx
  ON teacher.concern (tenant_id, student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS dpdp_sar_tenant_subject_idx
  ON plugin_dpdp.sar (tenant_id, subject_ref, created_at DESC);
CREATE INDEX IF NOT EXISTS exam_report_tenant_student_idx
  ON plugin_exams.report (tenant_id, student_id, created_at DESC);
