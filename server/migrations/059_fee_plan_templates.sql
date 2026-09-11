-- 057_fee_plan_templates.sql — Wave 2 · L1-2.2: fee-plan templates + the
-- idempotent-generation key on fee_obligations.
-- A template scopes a grade-set × term-list; /fee-plans/:id/generate fans it out
-- to every ACTIVE student in scope. (tenant_id, student_id, term, label) is the
-- idempotency key: regeneration skips what exists, and — the D-5/D-21
-- paid_cents invariant — never touches a row that already carries payments.

CREATE TABLE IF NOT EXISTS app.fee_plan_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES app.tenants(id),
  name            text NOT NULL,
  grades          text[] NOT NULL,
  terms           jsonb NOT NULL,   -- [{term, label, amount_cents, due_on?}, …]
  academic_year_id uuid REFERENCES app.academic_years(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fee_plan_tenant_name_uidx UNIQUE (tenant_id, name)
);

-- 049 RLS pattern (verbatim).
ALTER TABLE app.fee_plan_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.fee_plan_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.fee_plan_templates;
CREATE POLICY tenant_isolation ON app.fee_plan_templates
  USING (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('schoolos.tenant_id', true)::uuid);

-- 054 grant law: explicit, never default privileges.
GRANT SELECT, INSERT, UPDATE ON app.fee_plan_templates TO schoolos_app;

-- Idempotency key for generation. Seed data is label-distinct per (student,
-- term). Legacy exact duplicates that carry NO payments are collapsed to the
-- earliest row so the index can build; duplicates WITH payments are left alone
-- (money rows are never deleted — a real duplicate there is an integrity matter
-- for the owner to reconcile, not something a migration may silently merge).
DELETE FROM app.fee_obligations a
  USING app.fee_obligations b
 WHERE a.tenant_id = b.tenant_id
   AND a.student_id = b.student_id
   AND a.term = b.term
   AND a.label = b.label
   AND a.id <> b.id
   AND a.created_at > b.created_at
   AND a.paid_cents = 0 AND a.status = 'open';
CREATE UNIQUE INDEX IF NOT EXISTS fee_obl_student_term_label_uidx
  ON app.fee_obligations (tenant_id, student_id, term, label);
