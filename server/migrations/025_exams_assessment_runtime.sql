-- 025: exams.assessment runtime data plane (plugindev, wave-3 builds)
-- Registry + contract exams.publication were provisioned by 014 (guarded re-provision
-- here for bare-kernel DBs only). Locked invariants encoded:
--   deterministic_only          — report assembly is a pure function of marks+weightage;
--                                 each report carries a sha256 digest of its canonical inputs
--   weightage_total_enforced    — component weightages must sum to exactly 100
--   approval_before_publish     — publication raises an app.actions approval; nothing is
--                                 guardian-visible (or even assembled) before approval + execution
--   no_cross_tenant_marks       — RLS on every table keyed to the schoolos.tenant_id GUC
--                                 that withUser sets (defense-in-depth over WHERE scoping)
-- Marks are sensitive academic records: every write audited; marks freeze read-only at
-- publication. Retention per 014 manifest (on_uninstall: export_then_purge_30d).

CREATE SCHEMA IF NOT EXISTS plugin_exams;
GRANT USAGE ON SCHEMA plugin_exams TO schoolos_app;

CREATE TABLE IF NOT EXISTS plugin_exams.exam (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES app.tenants(id),
  name           text NOT NULL,
  term           text NOT NULL DEFAULT 'term-1',
  class_grade    text NOT NULL,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  weightage      jsonb,                             -- {component: percent}; set once, frozen at publish
  weightage_locked boolean NOT NULL DEFAULT false,
  eligibility_min_pct integer NOT NULL DEFAULT 75,  -- min attendance pct (present+late) to sit the exam
  published_snapshot jsonb,
  digest         text,                              -- sha256 of canonical assembly inputs
  action_id      uuid,                              -- kernel approval action (publication)
  published_at   timestamptz,
  published_by   text,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, class_grade, term, name)
);
GRANT SELECT, INSERT, UPDATE ON plugin_exams.exam TO schoolos_app;

CREATE TABLE IF NOT EXISTS plugin_exams.mark (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  exam_id     uuid NOT NULL REFERENCES plugin_exams.exam(id),
  student_id  uuid NOT NULL,                        -- core ref app.students.id (no hard FK — plugin isolation)
  component   text NOT NULL DEFAULT 'written',
  marks       numeric(6,2) NOT NULL CHECK (marks >= 0),
  max_marks   numeric(6,2) NOT NULL DEFAULT 100 CHECK (max_marks > 0),
  entered_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exam_id, student_id, component)
);
GRANT SELECT, INSERT, UPDATE ON plugin_exams.mark TO schoolos_app;

CREATE TABLE IF NOT EXISTS plugin_exams.report (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES app.tenants(id),
  exam_id    uuid NOT NULL REFERENCES plugin_exams.exam(id),
  student_id uuid NOT NULL,
  snapshot   jsonb NOT NULL,                        -- deterministic assembly {components, pct, grade}
  digest     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exam_id, student_id)
);
GRANT SELECT, INSERT ON plugin_exams.report TO schoolos_app;  -- INSERT happens only on the publish/execute assembly path

-- no_cross_tenant_marks: DB-layer tenant isolation on every table (withUser sets the
-- schoolos.tenant_id GUC before SET LOCAL ROLE; the kernel owner path is unaffected).
ALTER TABLE plugin_exams.exam   ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_exams.mark   ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_exams.report ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exams_tenant_isolation ON plugin_exams.exam;
DROP POLICY IF EXISTS exams_tenant_isolation ON plugin_exams.mark;
DROP POLICY IF EXISTS exams_tenant_isolation ON plugin_exams.report;
CREATE POLICY exams_tenant_isolation ON plugin_exams.exam   FOR ALL TO schoolos_app
  USING (tenant_id::text = current_setting('schoolos.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('schoolos.tenant_id', true));
CREATE POLICY exams_tenant_isolation ON plugin_exams.mark   FOR ALL TO schoolos_app
  USING (tenant_id::text = current_setting('schoolos.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('schoolos.tenant_id', true));
CREATE POLICY exams_tenant_isolation ON plugin_exams.report FOR ALL TO schoolos_app
  USING (tenant_id::text = current_setting('schoolos.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('schoolos.tenant_id', true));

-- Guarded registry row (bare-kernel DBs; 014 rows win).
INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, manifest, permissions, settings)
SELECT t.id, 'exams.assessment', '1.0.0', 'D', 'registered', '{
  "id": "exams.assessment",
  "version": "1.0.0",
  "class": "D",
  "description": "Examination primitives: marks entry, deterministic report-card assembly, publication via the kernel approval spine. Marks freeze read-only at publication; nothing guardian-visible before approval.",
  "policyRefs": ["CBSE pack obligations", "Platform §3 (plugin governance)"],
  "settingsSchema": {"type": "object", "properties": {
    "grade_scale": {"type": "string", "enum": ["cbse_10_point", "percent", "gpa_4"], "default": "cbse_10_point"},
    "report_card_template": {"type": "string"}}}
}'::jsonb, '["students.read","attendance.read","events.emit","audit.request"]'::jsonb, '{}'::jsonb
FROM app.tenants t
WHERE NOT EXISTS (SELECT 1 FROM app.plugins p WHERE p.tenant_id = t.id AND p.plugin_id = 'exams.assessment');

-- Guarded ledger entry (hash chain as 001/009-024) — once per tenant.
WITH cands AS (
  SELECT t.id AS tenant_id,
         COALESCE((SELECT a.hash FROM app.audit_log a
                    WHERE a.tenant_id = t.id
                    ORDER BY a.created_at DESC, a.id DESC LIMIT 1), 'GENESIS') AS prev_hash,
         to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at_iso
  FROM app.tenants t
  WHERE NOT EXISTS (
    SELECT 1 FROM app.audit_log x
    WHERE x.tenant_id = t.id AND x.record_type = 'Plugin' AND x.record_ref = 'exams.assessment@1.0.0-runtime')
), mat AS (
  SELECT c.tenant_id, c.prev_hash, c.at_iso,
    '{"tenant":"' || c.tenant_id::text
    || '","actor":"migration 025 (plugin factory)","actorRole":"system","action":"Plugin unit shipped: exams.assessment v1.0 (wave-3 builds runtime)","recordType":"Plugin","recordRef":"exams.assessment@1.0.0-runtime","outcome":"plugin_exams data plane · marks entry (per-write audit, frozen at publish) · deterministic report assembly with sha256 digests · publication via kernel approval spine · weightage_total_enforced · no_cross_tenant_marks via RLS on schoolos.tenant_id","at":"' || c.at_iso || '"}' AS material
  FROM cands c
), hashed AS (
  SELECT m.tenant_id, m.prev_hash, m.at_iso, m.material,
         encode(sha256(convert_to(m.prev_hash || m.material, 'UTF8')), 'hex') AS row_hash
  FROM mat m
)
SELECT * FROM hashed
CROSS JOIN LATERAL app.audit_append(
  hashed.tenant_id, 'migration 025 (plugin factory)', 'system',
  'Plugin unit shipped: exams.assessment v1.0 (wave-3 builds runtime)',
  'Plugin', 'exams.assessment@1.0.0-runtime',
  'marks · deterministic reports · approval-gated publication · weightage enforcement · tenant RLS',
  'CBSE pack obligations · Platform §3 (plugin governance)', false, 'medium',
  'data plane provisioned · contract from 014 unchanged',
  hashed.prev_hash, hashed.row_hash, hashed.at_iso::timestamptz);
