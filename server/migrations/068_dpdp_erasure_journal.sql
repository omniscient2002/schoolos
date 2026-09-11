-- 060 · DPDP erasure journal (L2-3.5, Wave 3 — claimed by L2, blocks.md).
-- Repeat-erasure idempotence WITHOUT storing the subject's phone: the journal
-- keys on sha256(normalized phone + tenant) — a repeat SAR for the same human
-- resolves to the SAME surrogate, but the journal itself carries no PII.
CREATE TABLE IF NOT EXISTS plugin_dpdp.erasure_journal (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  subject_key   text NOT NULL,              -- sha256('dpdp-erasure:'||tenant_id||':'||norm) — no PII
  surrogate     text NOT NULL,              -- the persistent pseudonym written across surfaces
  surfaces      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- per-surface redaction counts
  executed_by   text,
  executed_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, subject_key)
);
ALTER TABLE plugin_dpdp.erasure_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_dpdp.erasure_journal FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erasure_journal_tenant ON plugin_dpdp.erasure_journal;
CREATE POLICY erasure_journal_tenant ON plugin_dpdp.erasure_journal
  USING (tenant_id = current_setting('schoolos.tenant_id', true)::uuid);
REVOKE ALL ON plugin_dpdp.erasure_journal FROM schoolos_app;
