-- 093: DAT-9 residual FK/index coverage. The earlier indexes covered the hot
-- tenant lookups; these cover parent-FK joins that still lacked a tenant-leading
-- access path. Keep the original indexes intact where they serve a different
-- query shape.

CREATE INDEX IF NOT EXISTS attendance_tenant_student_date_idx
  ON app.attendance (tenant_id, student_id, school_date DESC);
CREATE INDEX IF NOT EXISTS guardians_tenant_student_idx
  ON app.guardians (tenant_id, student_id);
CREATE INDEX IF NOT EXISTS payments_tenant_obligation_idx
  ON app.payments (tenant_id, obligation_id);
CREATE INDEX IF NOT EXISTS work_orders_tenant_asset_idx
  ON app.work_orders (tenant_id, asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS work_orders_tenant_assignee_idx
  ON app.work_orders (tenant_id, assigned_to, created_at DESC);
CREATE INDEX IF NOT EXISTS work_orders_tenant_reporter_idx
  ON app.work_orders (tenant_id, reported_by, created_at DESC);
CREATE INDEX IF NOT EXISTS loan_tenant_book_status_idx
  ON library.loan (tenant_id, book_id, status, due_on);
CREATE INDEX IF NOT EXISTS submission_tenant_homework_student_idx
  ON teacher.submission (tenant_id, homework_id, student_id);
CREATE INDEX IF NOT EXISTS ptm_booking_tenant_student_idx
  ON ptm.booking (tenant_id, student_id, booked_at DESC);
CREATE INDEX IF NOT EXISTS intervention_plan_tenant_student_idx
  ON intervention.plan (tenant_id, student_id, created_at DESC);
