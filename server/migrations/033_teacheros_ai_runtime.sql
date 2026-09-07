-- 033: TeacherOS lane TS-3 (server-ai) — teacher.copilot v0 (deterministic, NO LLM).
-- Per orchestrator lane law: plugin factory provisions its own rows via numbered
-- migrations (018/020/024/029 precedent). This unit owns ONLY the artifacts below;
-- sibling lanes (TS-1 teacher.classroom → 031, TS-2 teacher.support → 032) own their
-- own tables — this migration NEVER creates teacher.* tables.
--
-- V0 INVARIANTS (docs/TEACHEROS-PLAN.md §0–5):
--   · A1 · curriculum is seeded, never teacher-typed — curriculum.node arrives via
--     migration seeding/import only; the app role gets SELECT (no INSERT). Teachers
--     only check off coverage (curriculum.progress, audited).
--   · A2 · copilot runs on budget classes — every ask/draft call writes a copilot.call
--     row (verb, budget_class 'teacher_tier', sources). No external model is called
--     anywhere in v0: drafts are deterministic templates, ask is keyword routing over
--     authorized data, both clearly labelled.
--   · A3 · mastery labels decay — mastery.evidence carries expires_at; on read,
--     expired evidence downgrades the level ONE step and marks confidence 'low'
--     (idempotent: no double-sliding). Language is "needs support", never "failing".
--   · RLS on every table (schoolos.tenant_id GUC), app-role grants per house pattern.
--
-- Tables:  curriculum.node · curriculum.progress · mastery.evidence · mastery.state
--          copilot.call   (schemas: curriculum, mastery, copilot)
-- Module:  server/src/plugins/teacher.copilot/ (mounted by the loader; no core edits).

-- ── 1. curriculum schema (A1) ───────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS curriculum;
GRANT USAGE ON SCHEMA curriculum TO schoolos_app;

-- the imported tree: subject → grade → unit → topic → objective (A1: seeded/imported)
CREATE TABLE IF NOT EXISTS curriculum.node (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES app.tenants(id),
  subject    text NOT NULL,
  grade      text NOT NULL,                      -- class grade ('6'..'8' in the seed)
  parent_id  uuid REFERENCES curriculum.node(id),-- NULL for units
  kind       text NOT NULL CHECK (kind IN ('unit','topic','objective')),
  name       text NOT NULL,
  order_no   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS curriculum_node_tree_idx ON curriculum.node (tenant_id, subject, grade, kind, order_no);
-- idempotent import keys: units (parent NULL) and children (parent set) separately,
-- because UNIQUE treats NULLs as distinct
CREATE UNIQUE INDEX IF NOT EXISTS curriculum_node_unit_key ON curriculum.node (tenant_id, subject, grade, kind, name)
  WHERE parent_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS curriculum_node_child_key ON curriculum.node (tenant_id, subject, grade, parent_id, kind, name)
  WHERE parent_id IS NOT NULL;
-- A1: read-only for the app role — authoring rides the migration/import path
GRANT SELECT ON curriculum.node TO schoolos_app;
ALTER TABLE curriculum.node ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS curriculum_node_tenant_isolation ON curriculum.node;
CREATE POLICY curriculum_node_tenant_isolation ON curriculum.node
  USING (tenant_id = current_setting('schoolos.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('schoolos.tenant_id')::uuid);

-- teacher check-off (the one teacher write in the curriculum lane; audited)
CREATE TABLE IF NOT EXISTS curriculum.progress (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES app.tenants(id),
  node_id      uuid NOT NULL REFERENCES curriculum.node(id),
  class_grade  text NOT NULL,
  covered_pct  integer NOT NULL CHECK (covered_pct BETWEEN 0 AND 100),
  covered_by   uuid,                               -- app.users.id of the checking teacher
  evidence_ref text,
  covered_at   timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS curriculum_progress_key ON curriculum.progress (tenant_id, node_id, class_grade);
CREATE INDEX IF NOT EXISTS curriculum_progress_class_idx ON curriculum.progress (tenant_id, class_grade);
GRANT SELECT, INSERT, UPDATE ON curriculum.progress TO schoolos_app;
ALTER TABLE curriculum.progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS curriculum_progress_tenant_isolation ON curriculum.progress;
CREATE POLICY curriculum_progress_tenant_isolation ON curriculum.progress
  USING (tenant_id = current_setting('schoolos.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('schoolos.tenant_id')::uuid);

-- ── 2. mastery schema (A3 decay) ────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS mastery;
GRANT USAGE ON SCHEMA mastery TO schoolos_app;

-- evidence stamps: every mastery label must be click-through to evidence that EXPIRES
-- unless re-evidenced. Written by sibling lanes (assessments/homework/observations) —
-- kind is therefore deliberately NOT enum-locked in v0 (cross-lane contract surface).
CREATE TABLE IF NOT EXISTS mastery.evidence (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  student_id  uuid NOT NULL,                      -- app.students.id (no hard FK — plugin isolation)
  subject     text NOT NULL,
  node_id     uuid REFERENCES curriculum.node(id),-- topic/objective link; NULL = general observation
  kind        text NOT NULL,                      -- assessment | homework | observation | quiz | …
  ref         text,                               -- evidence link (assessment id, hw id, note ref)
  value       numeric(5,2) CHECK (value BETWEEN 0 AND 100),
  observed_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz,                        -- A3: evidence expires unless re-evidenced;
  created_at  timestamptz NOT NULL DEFAULT now()  --      NULL = non-expiring (treated as still active)
);
CREATE INDEX IF NOT EXISTS mastery_evidence_student_idx ON mastery.evidence (tenant_id, student_id, subject);
CREATE INDEX IF NOT EXISTS mastery_evidence_expiry_idx ON mastery.evidence (tenant_id, expires_at);
GRANT SELECT, INSERT ON mastery.evidence TO schoolos_app;
ALTER TABLE mastery.evidence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mastery_evidence_tenant_isolation ON mastery.evidence;
CREATE POLICY mastery_evidence_tenant_isolation ON mastery.evidence
  USING (tenant_id = current_setting('schoolos.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('schoolos.tenant_id')::uuid);

-- derived, deterministic state: level = needs_support | developing | secure
-- (🔴/🟡/🟢 in the UI). "Needs support", never "failing" (A3). The decay downgrade
-- persists here exactly once per decay event (derived_from.reason = 'evidence_expired').
CREATE TABLE IF NOT EXISTS mastery.state (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES app.tenants(id),
  student_id   uuid NOT NULL,
  subject      text NOT NULL,
  node_id      uuid NOT NULL REFERENCES curriculum.node(id),
  level        text NOT NULL CHECK (level IN ('needs_support','developing','secure')),
  confidence   text NOT NULL DEFAULT 'medium' CHECK (confidence IN ('low','medium','high')),
  derived_from jsonb NOT NULL DEFAULT '{}'::jsonb, -- {basis, n, avg} | {reason:'evidence_expired', from_level, expired_count, decayed_at}
  computed_at  timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mastery_state_key ON mastery.state (tenant_id, student_id, subject, node_id);
CREATE INDEX IF NOT EXISTS mastery_state_student_idx ON mastery.state (tenant_id, student_id, subject);
GRANT SELECT, INSERT, UPDATE ON mastery.state TO schoolos_app;
ALTER TABLE mastery.state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mastery_state_tenant_isolation ON mastery.state;
CREATE POLICY mastery_state_tenant_isolation ON mastery.state
  USING (tenant_id = current_setting('schoolos.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('schoolos.tenant_id')::uuid);

-- ── 3. copilot schema (A2 budget ledger) ────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS copilot;
GRANT USAGE ON SCHEMA copilot TO schoolos_app;

-- the AI action log (P4): one row per ask/draft/brief call, even when the call is a
-- deterministic template (v0). Feeds AI usage governance; tokens stay 0 until a real
-- model is wired (v1+). No external LLM is contacted by this plugin in v0.
CREATE TABLE IF NOT EXISTS copilot.call (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES app.tenants(id),
  user_id            uuid NOT NULL,               -- app.users.id (no hard FK — plugin isolation)
  verb               text NOT NULL CHECK (verb IN ('ask','draft','brief')),
  budget_class       text NOT NULL DEFAULT 'teacher_tier',
  tokens_in          integer NOT NULL DEFAULT 0,
  tokens_out         integer NOT NULL DEFAULT 0,
  sources            jsonb NOT NULL DEFAULT '[]'::jsonb,
  approved_action_id uuid,                        -- kernel action when a draft is approved (v1+)
  at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS copilot_call_budget_idx ON copilot.call (tenant_id, user_id, at DESC);
GRANT SELECT, INSERT ON copilot.call TO schoolos_app;
ALTER TABLE copilot.call ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS copilot_call_tenant_isolation ON copilot.call;
CREATE POLICY copilot_call_tenant_isolation ON copilot.call
  USING (tenant_id = current_setting('schoolos.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('schoolos.tenant_id')::uuid);

-- ── 4. A1 seed: sample CBSE-aligned tree, grades 6–8, Mathematics + Science ─────
-- 3 units × 4 topics per subject-grade (plan §5 TS-3 scope). Idempotent per tenant:
-- re-runs and later-joining tenants are filled by the NOT EXISTS guards.
INSERT INTO curriculum.node (tenant_id, subject, grade, parent_id, kind, name, order_no)
SELECT t.id, v.subject, v.grade, NULL::uuid, 'unit', v.name, v.ord
FROM app.tenants t
CROSS JOIN (VALUES
  ('Mathematics', '6', 1, 'Number System'),
  ('Mathematics', '6', 2, 'Algebra'),
  ('Mathematics', '6', 3, 'Geometry'),
  ('Mathematics', '7', 1, 'Number System'),
  ('Mathematics', '7', 2, 'Algebra & Arithmetic'),
  ('Mathematics', '7', 3, 'Geometry'),
  ('Mathematics', '8', 1, 'Number System'),
  ('Mathematics', '8', 2, 'Algebra'),
  ('Mathematics', '8', 3, 'Geometry & Data'),
  ('Science', '6', 1, 'Food & Materials'),
  ('Science', '6', 2, 'The Living World'),
  ('Science', '6', 3, 'Physical World'),
  ('Science', '7', 1, 'Food & Health'),
  ('Science', '7', 2, 'The Living World'),
  ('Science', '7', 3, 'Physical World'),
  ('Science', '8', 1, 'Food & Materials'),
  ('Science', '8', 2, 'The Living World'),
  ('Science', '8', 3, 'Physical World')
) AS v(subject, grade, ord, name)
WHERE NOT EXISTS (
  SELECT 1 FROM curriculum.node x
  WHERE x.tenant_id = t.id AND x.subject = v.subject AND x.grade = v.grade
    AND x.kind = 'unit' AND x.name = v.name);

INSERT INTO curriculum.node (tenant_id, subject, grade, parent_id, kind, name, order_no)
SELECT t.id, v.subject, v.grade, u.id, 'topic', tp.topic, tp.ord
FROM app.tenants t
CROSS JOIN (VALUES
  ('Mathematics', '6', 1, 'Number System',
   ARRAY['Knowing Our Numbers','Fractions','Decimals','Integers']),
  ('Mathematics', '6', 2, 'Algebra',
   ARRAY['Algebraic Basics','Ratio and Proportion','Mensuration Basics','Data Handling']),
  ('Mathematics', '6', 3, 'Geometry',
   ARRAY['Basic Geometrical Ideas','Understanding Elementary Shapes','Symmetry','Practical Geometry']),
  ('Mathematics', '7', 1, 'Number System',
   ARRAY['Integers','Fractions and Decimals','Rational Numbers','Exponents and Powers']),
  ('Mathematics', '7', 2, 'Algebra & Arithmetic',
   ARRAY['Simple Equations','Algebraic Expressions','Comparing Quantities','Perimeter and Area']),
  ('Mathematics', '7', 3, 'Geometry',
   ARRAY['Lines and Angles','The Triangle and its Properties','Symmetry','Visualising Solid Shapes']),
  ('Mathematics', '8', 1, 'Number System',
   ARRAY['Rational Numbers','Squares and Square Roots','Cubes and Cube Roots','Exponents and Powers']),
  ('Mathematics', '8', 2, 'Algebra',
   ARRAY['Linear Equations in One Variable','Algebraic Expressions and Identities','Factorisation','Direct and Inverse Proportions']),
  ('Mathematics', '8', 3, 'Geometry & Data',
   ARRAY['Quadrilaterals','Mensuration','Data Handling','Visualising Solid Shapes']),
  ('Science', '6', 1, 'Food & Materials',
   ARRAY['Components of Food','Fibre to Fabric','Separation of Substances','Sorting Materials into Groups']),
  ('Science', '6', 2, 'The Living World',
   ARRAY['Getting to Know Plants','Body Movements','The Living Organisms and Their Surroundings','Water']),
  ('Science', '6', 3, 'Physical World',
   ARRAY['Motion and Measurement of Distances','Light, Shadows and Reflections','Electricity and Circuits','Fun with Magnets']),
  ('Science', '7', 1, 'Food & Health',
   ARRAY['Nutrition in Plants','Nutrition in Animals','Heat','Fibre to Fabric']),
  ('Science', '7', 2, 'The Living World',
   ARRAY['Weather, Climate and Adaptations','Soil','Respiration in Organisms','Transportation in Animals and Plants']),
  ('Science', '7', 3, 'Physical World',
   ARRAY['Acids, Bases and Salts','Physical and Chemical Changes','Light','Electric Current and its Effects']),
  ('Science', '8', 1, 'Food & Materials',
   ARRAY['Crop Production and Management','Microorganisms: Friend and Foe','Coal and Petroleum','Combustion and Flame']),
  ('Science', '8', 2, 'The Living World',
   ARRAY['Cell — Structure and Functions','Reproduction in Animals','Reaching the Age of Adolescence','Conservation of Plants and Animals']),
  ('Science', '8', 3, 'Physical World',
   ARRAY['Force and Pressure','Friction','Sound','Chemical Effects of Electric Current'])
) AS v(subject, grade, ord, unit, topics)
JOIN curriculum.node u ON u.tenant_id = t.id AND u.subject = v.subject
  AND u.grade = v.grade AND u.kind = 'unit' AND u.name = v.unit AND u.order_no = v.ord
CROSS JOIN LATERAL unnest(v.topics) WITH ORDINALITY AS tp(topic, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM curriculum.node x
  WHERE x.tenant_id = t.id AND x.subject = v.subject AND x.grade = v.grade
    AND x.kind = 'topic' AND x.name = tp.topic);

-- ── 5. registry row (factory-authored, 018/021/029 precedent) ───────────────────
INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, manifest, permissions)
SELECT t.id, 'teacher.copilot', '0.1.0', 'C', 'registered',
  '{"id":"teacher.copilot","name":"Teaching Copilot","version":"0.1.0","kernel":">=1.0.0 <2.0.0","class":"C","trust":"T1","description":"Teacher day brief, curriculum tree + coverage check-off, mastery maps with A3 evidence decay, and deterministic Copilot drafts/ask. V0 INVARIANT: no external AI model is contacted anywhere — drafts are labelled templates built from curriculum/mastery data and ask routes questions to authorized data by keyword; every call writes a copilot.call budget row (A2). Curriculum is seeded, never teacher-typed (A1). Mastery labels decay: expired evidence downgrades a level one step with low confidence, language is needs-support-never-failing (A3).","permissions":["students.read","users.read","audit.request"],"events":{"subscribe":[],"publish":[]},"eventSubscriptions":[],"slots":["settings","reports"],"routes":[],"widgets":[],"settingsSchema":{"type":"object","properties":{"deterministic_v0":{"type":"string","default":"v0 is deterministic-only: no LLM calls, no tokens; copilot.call.tokens_in/out stay 0 until a governed model is wired (v1)","description":"Scope note for the AI governance slot"}}},"data":{"schema":"curriculum.node, curriculum.progress, mastery.evidence, mastery.state, copilot.call (all RLS-scoped)","core_refs":["students.id","users.id"],"retention":{"on_uninstall":"export_then_purge_30d"},"residency":["IN"]},"regions":["IN"],"residency":"IN","billing":{"model":"pack","pack":"teaching"},"dependencies":[],"defaultEnabled":false}'::jsonb,
  '["students.read","users.read","audit.request"]'::jsonb
FROM app.tenants t
WHERE NOT EXISTS (SELECT 1 FROM app.plugins p WHERE p.plugin_id='teacher.copilot' AND p.tenant_id = t.id);

-- capability contracts (contract-registry pattern; v0 = deterministic-only)
INSERT INTO app.capability_contracts (tenant_id, capability_id, plugin_id, version, contract)
SELECT t.id, 'copilot.ask.v1', 'teacher.copilot', '0.1.0',
  '{"description":"Deterministic retrieval Q&A over the caller''s authorized data (timetable, curriculum pace, homework inbox, mastery, concerns). V0 routes questions to data summaries by keyword — NO model calls. Every call writes a copilot.call budget row (A2) and returns its sources.","read_scopes":["timetable.read:own_tenant","curriculum.read:own_tenant","mastery.read:own_tenant"],"write_scopes":["copilot.call"],"event_outputs":[],"side_effects":[],"policy_refs":["TeacherOS A2 (budget classes)","Platform §2.4"],"audit":{"level":"full","includes":["verb","sources","budget_class"]},"data_classification":["internal"],"ai_eligibility":{"modes":["retrieval"],"grounding":"required","deterministic_only":true,"budget_enforced":true},"compat":{"kernel":">=1.0 <2.0"},"regions":["IN"],"residency":"IN"}'::jsonb
FROM app.tenants t
WHERE NOT EXISTS (SELECT 1 FROM app.capability_contracts c WHERE c.plugin_id='teacher.copilot' AND c.capability_id='copilot.ask.v1');

INSERT INTO app.capability_contracts (tenant_id, capability_id, plugin_id, version, contract)
SELECT t.id, 'copilot.draft.v1', 'teacher.copilot', '0.1.0',
  '{"description":"Deterministic template drafts (lesson | worksheet | feedback | message) built from curriculum and mastery data. Output is labelled ai_draft; the teacher edits and approves before any use — a draft never sends anything. V0 is template-only, NO model calls; each call writes a copilot.call budget row.","read_scopes":["curriculum.read:own_tenant","mastery.read:own_tenant","students.read:own_tenant"],"write_scopes":["copilot.call"],"event_outputs":[],"side_effects":[{"type":"content.draft","approval":"never_auto_send","policy_ref":"TeacherOS P4 (AI recommends, teacher decides)"}],"policy_refs":["TeacherOS A2 (budget classes)","Platform §2.4"],"audit":{"level":"full","includes":["kind","built_from","budget_class"]},"data_classification":["internal"],"ai_eligibility":{"modes":["transformation"],"grounding":"required","deterministic_only":true,"budget_enforced":true},"compat":{"kernel":">=1.0 <2.0"},"regions":["IN"],"residency":"IN"}'::jsonb
FROM app.tenants t
WHERE NOT EXISTS (SELECT 1 FROM app.capability_contracts c WHERE c.plugin_id='teacher.copilot' AND c.capability_id='copilot.draft.v1');

-- ── 6. guarded ledger entry (024/029 precedent) ─────────────────────────────────
WITH cands AS (
  SELECT t.id AS tenant_id,
         COALESCE((SELECT a.hash FROM app.audit_log a
                    WHERE a.tenant_id = t.id
                    ORDER BY a.created_at DESC, a.id DESC LIMIT 1), 'GENESIS') AS prev_hash,
         to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at_iso
  FROM app.tenants t
  WHERE NOT EXISTS (
    SELECT 1 FROM app.audit_log x
    WHERE x.tenant_id = t.id AND x.record_type = 'Plugin' AND x.record_ref = 'teacher.copilot@0.1.0-v0')
), mat AS (
  SELECT c.tenant_id, c.prev_hash, c.at_iso,
    '{"tenant":"' || c.tenant_id::text
    || '","actor":"migration 033 (plugin factory)","actorRole":"system","action":"TeacherOS lane TS-3: teacher.copilot v0.1.0 (deterministic, no LLM) — day brief, curriculum tree + audited coverage check-off, mastery maps with A3 evidence decay, keyword-routed ask and template drafts; every copilot call budgeted (A2)","recordType":"Plugin","recordRef":"teacher.copilot@0.1.0-v0","outcome":"curriculum.node/progress · mastery.evidence/state · copilot.call data planes (RLS) · CBSE-aligned seed tree grades 6-8 maths+science (3 units × 4 topics per subject-grade) · deterministic-only invariant, no model calls in v0","at":"' || c.at_iso || '"}' AS material
  FROM cands c
), hashed AS (
  SELECT m.tenant_id, m.prev_hash, m.at_iso, m.material,
         encode(sha256(convert_to(m.prev_hash || m.material, 'UTF8')), 'hex') AS row_hash
  FROM mat m
)
SELECT * FROM hashed
CROSS JOIN LATERAL app.audit_append(
  hashed.tenant_id, 'migration 033 (plugin factory)', 'system',
  'TeacherOS lane TS-3: teacher.copilot v0 (deterministic)',
  'Plugin', 'teacher.copilot@0.1.0-v0',
  'curriculum tree + coverage · mastery with A3 decay · copilot ask/draft on budget classes',
  'TeacherOS A1 (curriculum seeded) · A2 (budget classes) · A3 (mastery decay) · Platform §3 (plugin governance)',
  false, 'medium',
  'teacher.copilot 0.1.0 v0 · deterministic-only · sibling-lane surfaces degrade gracefully',
  hashed.prev_hash, hashed.row_hash, hashed.at_iso::timestamptz);
