-- 106 · DATX-11/12/13 — index hygiene and the class_assignments grant.
--
-- DATX-11: fifteen tenant-scoped tables carried a `tenant_id` with NO tenant-leading index, so an
-- RLS-filtered scan (`tenant_id = app.current_tenant()`) had no index to start from. Additive and
-- replay-safe (`IF NOT EXISTS`); one index per table, tenant first, then the column the row is found by.
-- The `auth.*` vault tables are included because their retention/lookup sweeps are tenant-scoped too.
--
-- DATX-12: three (and their siblings found by the same prefix argument) indexes were fully covered by a
-- longer index on the same table — a btree serves any prefix of its key, so the shorter index cost write
-- time and disk and could never be chosen over the covering one. Dropped rather than left "just in case".
--
-- DATX-13: 083 created `app.class_assignments` but granted the app role nothing, relying on
-- `bootstrap.js` (which runs after every migrate) for its SELECT/INSERT/UPDATE. A migration's grants must
-- live with the table, so the door that reads and writes it can never be dead-on-arrival on a database
-- that applied migrations without the bootstrap stage.

-- ── DATX-11 · tenant-leading indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS auth_otps_tenant_phone_created_idx
  ON app.auth_otps (tenant_id, phone, created_at DESC);
CREATE INDEX IF NOT EXISTS mfa_challenges_tenant_user_created_idx
  ON auth.mfa_challenges (tenant_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mfa_recovery_codes_tenant_user_idx
  ON auth.mfa_recovery_codes (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS mfa_secrets_tenant_user_idx
  ON auth.mfa_secrets (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS reset_tokens_tenant_user_created_idx
  ON auth.reset_tokens (tenant_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS revoked_token_tenant_exp_idx
  ON auth.revoked_token (tenant_id, exp);
CREATE INDEX IF NOT EXISTS family_consent_tenant_student_status_idx
  ON family.consent (tenant_id, student_id, status);
CREATE INDEX IF NOT EXISTS family_request_event_tenant_request_at_idx
  ON family.request_event (tenant_id, request_id, at);
CREATE INDEX IF NOT EXISTS intervention_plan_event_tenant_plan_created_idx
  ON intervention.plan_event (tenant_id, plan_id, created_at);
CREATE INDEX IF NOT EXISTS admissions_stage_history_tenant_lead_at_idx
  ON plugin_admissions.stage_history (tenant_id, lead_id, at);
CREATE INDEX IF NOT EXISTS exam_mark_tenant_exam_student_idx
  ON plugin_exams.mark (tenant_id, exam_id, student_id);
CREATE INDEX IF NOT EXISTS exam_moderation_tenant_report_status_idx
  ON plugin_exams.moderation (tenant_id, report_id, status);
CREATE INDEX IF NOT EXISTS pickup_otp_tenant_visit_idx
  ON plugin_visitors.pickup_otp (tenant_id, visit_id);
CREATE INDEX IF NOT EXISTS concern_status_event_tenant_concern_created_idx
  ON teacher.concern_status_event (tenant_id, concern_id, created_at);
CREATE INDEX IF NOT EXISTS leave_request_tenant_teacher_created_idx
  ON teacher.leave_request (tenant_id, teacher_id, created_at DESC);

-- ── DATX-12 · redundant (prefix-covered) indexes ────────────────────────────────────────────────────
DROP INDEX IF EXISTS app.eal_event_idx;
DROP INDEX IF EXISTS app.fee_obl_student_idx;
DROP INDEX IF EXISTS app.users_tenant_idx;
DROP INDEX IF EXISTS intervention.intervention_plan_student_idx;
DROP INDEX IF EXISTS mastery.mastery_state_student_idx;
DROP INDEX IF EXISTS teacher.concern_student_idx;

-- ── DATX-13 · 083's table must carry its own grant ──────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON app.class_assignments TO schoolos_app;
