-- 123: admissions.funnel — default follow-up workflow rule (F-2).
--
-- The workflow step-runner (071/076) could match `admission.*` topics but shipped no
-- default rule, so an enquiry produced no pipeline artifact beyond the log line. This
-- seeds ONE benign default per tenant: every captured enquiry fans out an
-- `admission.followup.scheduled` outbox marker. It is deliberately an outbox action
-- (not a comms send) — it makes the follow-up pipeline visible on the event spine and
-- gives a tenant a rule to edit, without auto-messaging a guardian.
-- Idempotent.
INSERT INTO app.workflow_rules (tenant_id, name, topic, condition, action, enabled, created_by)
SELECT t.id, 'Admissions: enquiry → follow-up pipeline', 'admission.enquiry.captured', NULL,
       '{"kind":"outbox","topic":"admission.followup.scheduled"}'::jsonb, true, NULL
FROM app.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM app.workflow_rules r
   WHERE r.tenant_id = t.id AND r.name = 'Admissions: enquiry → follow-up pipeline');
