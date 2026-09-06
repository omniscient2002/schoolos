-- 018: admissions.funnel — registration + runtime provision (plugin factory, docs/11 §2.2)
-- Unit: wave-2 #1 · admissions.funnel (Class C, T1 — applicant PII, guardian contacts)
--
-- Independence contract: idempotent like 011/013/015 — (a) no-ops on databases where
-- these artifacts already exist, (b) fully provisions admissions.funnel on a bare kernel.
-- admissions.funnel was NEVER registered (009/010 do not carry it): this is its ONE
-- registration+runtime migration. Module: server/src/plugins/admissions.funnel/.
--
-- Posture: applicant/guardian PII lives ONLY in plugin_admissions (purgeable); the funnel
-- NEVER writes core students (enrollment into core stays a staff/office workflow); no
-- money surfaces (fees ride the kernel after enrollment); stage lattice enforced server-side;
-- teacher-facing surfaces are PII-masked (no full guardian phone, no guardian name).

-- ── 1. Funnel data plane ────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS plugin_admissions;
CREATE TABLE IF NOT EXISTS plugin_admissions.lead (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id),
  student_name  text NOT NULL,
  guardian_name text,
  guardian_phone text NOT NULL,
  class_applied text NOT NULL,
  source        text NOT NULL DEFAULT 'walk-in',
  stage         text NOT NULL DEFAULT 'inquiry',
  notes         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by    uuid REFERENCES app.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS plugin_admissions.stage_history (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  lead_id   uuid NOT NULL REFERENCES plugin_admissions.lead(id) ON DELETE CASCADE,
  from_stage text,
  to_stage  text NOT NULL,
  actor     text NOT NULL,
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_tenant_stage ON plugin_admissions.lead (tenant_id, stage);

-- App-role grants (same pattern as 010 §5): the constrained schoolos_app role
-- serves every tenant-scoped door; the migration owner role never serves traffic.
GRANT USAGE ON SCHEMA plugin_admissions TO schoolos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA plugin_admissions TO schoolos_app;

-- ── 2. Registry row (authored here first; 009 never provisioned this plugin) ────
INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, manifest, permissions, entitlement, trust_level, event_budget, ai_budget)
SELECT t.id, v.plugin_id, v.version, v.class, 'registered', v.manifest, v.permissions, v.entitlement, 'T1', v.event_budget, v.ai_budget
FROM app.tenants t
CROSS JOIN (VALUES
  ('admissions.funnel', '1.0.0', 'C',
   '{"id":"admissions.funnel","name":"Admissions Funnel","version":"1.0.0","kernel":">=1.0.0 <2.0.0","class":"C","trust":"T1","description":"Admission inquiry-to-enrollment funnel: lead capture, stage progression (inquiry > applied > interview > offer > enrolled) with side exits (rejected/withdrawn), stage history trail, PII-masked teacher surfaces. Applicant/guardian PII stays in plugin_admissions (purgeable); never writes core students — enrollment into core is a staff/office workflow; no money surfaces. DSR-friendly: every lead is exportable and purgeable on consent withdrawal (pack.dpdp consumes this).","permissions":["events.emit","audit.request"],"events":{"subscribe":[],"publish":[{"type":"admission.lead.captured","schema":"v1"},{"type":"admission.stage.changed","schema":"v1"}]},"slots":["settings"],"routes":[],"widgets":[],"settingsSchema":{"type":"object","properties":{"default_source":{"type":"string","description":"fallback inquiry source (walk-in, referral, website, phone)"},"enrollment_term":{"type":"string","description":"term leads are being captured for (e.g. 2027-28)"}}},"data":{"schema":"plugin_admissions","core_refs":[],"retention":{"on_uninstall":"export_then_purge_30d"},"residency":["IN"]},"regions":["IN"],"residency":"IN","billing":{"model":"module","billing":"included"},"dependencies":["pack.dpdp"],"policy_refs":["DPDP consent obligations (guardian contact)","Platform §3 (plugin governance)"],"defaultEnabled":false,"lifecycle":{"deactivate":"leads frozen read-only; purge honors DSR","health":"stage-lattice probe"}}'::jsonb,
   '["events.emit","audit.request"]'::jsonb,
   '{"plan":"module","billing":"included"}'::jsonb,
   jsonb_build_object('events_per_min',60,'payload_max_bytes',65536,'subscriber_max',25,'fanout_max',50,'chain_depth_max',5,'replay_max',10000,'scheduled_per_day',1000),
   '{"calls_per_day":200,"tokens_per_day":50000,"tools_per_day":50}'::jsonb)
) AS v(plugin_id, version, class, manifest, permissions, entitlement, event_budget, ai_budget)
WHERE NOT EXISTS (
  SELECT 1 FROM app.plugins p WHERE p.tenant_id = t.id AND p.plugin_id = v.plugin_id);

-- ── 3. Capability contract: admissions.capture (guarded) ────────────────────────
INSERT INTO app.capability_contracts (tenant_id, plugin_id, capability_id, version, kind, contract, enforced)
SELECT NULL, v.plugin_id, v.capability_id, v.version, v.kind, v.contract, v.enforced
FROM (VALUES
  ('admissions.funnel', 'admissions.capture', '1.0.0', 'command',
   '{"description":"Admission funnel: capture inquiry leads (applicant + guardian contact), progress them through an enforced stage lattice with a history trail, and surface PII-masked lists to non-privileged roles. Never writes core students; enrollment is raised as a staff workflow after the offer stage. No money surfaces — fees ride the kernel only after core enrollment exists.","read_scopes":["plugin_admissions.leads"],"write_scopes":["plugin_admissions.leads"],"event_inputs":[],"event_outputs":["admission.lead.captured.v1","admission.stage.changed.v1"],"side_effects":[{"type":"event.emit","approval":"never","policy_ref":"Platform §2.4"},{"type":"ledger.audit","approval":"never","policy_ref":"Platform §2.4"}],"policy_refs":["DPDP consent obligations (guardian contact)","Platform §3 (plugin governance)"],"audit":{"level":"full","includes":["actor","lead","from_stage","to_stage"]},"data_classification":["pii:student_records","pii:guardian_contact"],"compat":{"kernel":">=1.0 <2.0"},"regions":["IN"],"residency":"IN"}'::jsonb,
   '{"audit":"full","invariants":["stage_lattice_enforced","terminal_stages_immutable","no_core_students_writes","teacher_surfaces_pii_masked","no_money_surfaces"]}'::jsonb)
) AS v(plugin_id, capability_id, version, kind, contract, enforced)
WHERE NOT EXISTS (
  SELECT 1 FROM app.capability_contracts x
  WHERE x.tenant_id IS NULL AND x.capability_id = v.capability_id AND x.version = v.version);

-- ── 4. Guarded registration audit entry (same hash chain as 001/009-017) ────────
WITH cands AS (
  SELECT t.id AS tenant_id,
         COALESCE((SELECT a.hash FROM app.audit_log a
                    WHERE a.tenant_id = t.id
                    ORDER BY a.created_at DESC, a.id DESC LIMIT 1), 'GENESIS') AS prev_hash,
         to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at_iso
  FROM app.tenants t
  WHERE NOT EXISTS (
    SELECT 1 FROM app.audit_log x
    WHERE x.tenant_id = t.id AND x.record_type = 'Plugin' AND x.record_ref = 'admissions.funnel@1.0.0')
), mat AS (
  SELECT c.tenant_id, c.prev_hash, c.at_iso,
    '{"tenant":"' || c.tenant_id::text
    || '","actor":"migration 018 (plugin factory)","actorRole":"system","action":"Plugin unit registered: admissions.funnel (wave-2 #1)","recordType":"Plugin","recordRef":"admissions.funnel@1.0.0","outcome":"Lead capture + enforced stage lattice + history trail live · PII confined to plugin_admissions (purgeable) · teacher surfaces masked · no core-student writes · no money surfaces · module src/plugins/admissions.funnel mounted by loader","at":"' || c.at_iso || '"}' AS material
  FROM cands c
), hashed AS (
  SELECT m.tenant_id, m.prev_hash, m.at_iso, m.material,
         encode(sha256(convert_to(m.prev_hash || m.material, 'UTF8')), 'hex') AS row_hash
  FROM mat m
)
SELECT * FROM hashed
CROSS JOIN LATERAL app.audit_append(
  hashed.tenant_id, 'migration 018 (plugin factory)', 'system',
  'Plugin unit registered: admissions.funnel (wave-2 #1)',
  'Plugin', 'admissions.funnel@1.0.0',
  'lead capture · stage lattice · PII-masked surfaces · no core-student writes',
  'Platform §3 (plugin governance)', false, 'low',
  'registered (not enabled) · plugin_admissions provisioned · module mounted by loader',
  hashed.prev_hash, hashed.row_hash, hashed.at_iso::timestamptz);
