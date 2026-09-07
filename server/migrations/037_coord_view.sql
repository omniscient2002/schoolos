-- 037_coord_view.sql — CoordinatorOS lane CS-1: coord.view v1.0.0
-- The coordinator read+act plane. The coordinator is the school's execution
-- authority: staffing today (absences from hr.leave + teacher.leave_request, graded
-- gracefully), substitution gaps on the timetable grid, open kernel approvals
-- (owner_role='coordinator' — proposer≠decider SoD enforced at the decide door),
-- curriculum pace vs term expectation (covered_pct from curriculum.progress,
-- expected_pct from IST term calendar — pace is a fraction of elapsed term days,
-- never a rank), duty allocation (FAIRNESS framing: least-loaded deterministic pick,
-- overload is a flag — NEVER a score/rank), escalations (family requests + concerns
-- + re-evaluations routed to the coordinator desk, with append-only timelines),
-- and the deterministic v0 coordinator copilot (keyword intents, honest empty
-- answers, 200/month budget rows in coord.copilot_call).
-- Privacy pins: teacher-workload is AGGREGATE ONLY (staffing facts, no student data);
-- escalations carry student identity ONLY where the coordinator is the routed
-- authority (family.request rows carry child_id — the coordinator is their owner_role).
BEGIN;

-- ── 1. coord.copilot_call — the CS-1 budget ledger (033 copilot.call shape) ─────
CREATE SCHEMA IF NOT EXISTS coord;
GRANT USAGE ON SCHEMA coord TO schoolos_app;

CREATE TABLE IF NOT EXISTS coord.copilot_call (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES app.tenants(id),
  user_id            uuid NOT NULL,               -- app.users.id (no hard FK — plugin isolation)
  verb               text NOT NULL CHECK (verb IN ('ask')),
  budget_class       text NOT NULL DEFAULT 'coordinator_tier',
  tokens_in          integer NOT NULL DEFAULT 0,
  tokens_out         integer NOT NULL DEFAULT 0,
  sources            jsonb NOT NULL DEFAULT '[]'::jsonb,
  at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coord_copilot_call_budget_idx ON coord.copilot_call (tenant_id, user_id, at DESC);
GRANT SELECT, INSERT ON coord.copilot_call TO schoolos_app;
ALTER TABLE coord.copilot_call ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS coord_copilot_call_tenant_isolation ON coord.copilot_call;
CREATE POLICY coord_copilot_call_tenant_isolation ON coord.copilot_call
  USING (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('schoolos.tenant_id', true)::uuid);

-- ── 2. RLS for sibling tables the app role reads on coord doors ─────────────────
-- curriculum tables exist only from 033 onward; probe before guarding (034 rule).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='curriculum' AND table_name='progress') THEN
    EXECUTE 'GRANT SELECT ON curriculum.progress TO schoolos_app';
  END IF;
END $$;

-- ── 3. Registry row (plugin factory precedent 018/024/029/031/032/033/034) ─────
INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, manifest, permissions)
SELECT t.id, 'coord.view', '1.0.0', 'C', 'registered',
  '{"id":"coord.view","name":"Coordinator Command Center","version":"1.0.0","kernel":">=1.0.0 <2.0.0","class":"C","trust":"T1","description":"The coordinator execution plane: staffing today (absences, periods affected), substitution gaps on the timetable grid, open kernel approvals owned by the coordinator role (decide door with proposer≠decider SoD), curriculum pace vs term expectation (covered_pct from curriculum.progress; expected_pct from IST term calendar; weeks_behind; revision_needed), teacher workload aggregates with a fairness overload flag (never a score or rank), duty allocation by least-loaded deterministic pick, escalations (family requests, routed concerns, re-evaluations) with append-only timelines, and the deterministic v0 coordinator copilot (keyword intents, honest empty answers, 200/month budget rows). Privacy pins: workload doors return aggregates only — no student data; escalations carry student identity only where the coordinator is the routed authority; the teacher role is refused on every door. Contracts: coord.home.v1, coord.decision.v1.","permissions":["users.read","students.read","events.emit","audit.request"],"events":{"subscribe":[],"publish":[{"type":"coord.home.v1","schema":"v1"},{"type":"coord.decision.v1","schema":"v1"},{"type":"sub.assign.v1","schema":"v1"},{"type":"duty.assigned.v1","schema":"v1"}]},"eventSubscriptions":[],"slots":["settings","reports"],"routes":[],"widgets":[],"settingsSchema":{"type":"object","properties":{"copilot_monthly_cap":{"type":"integer","default":200,"description":"Monthly coordinator copilot ask budget (A2 budget class coordinator_tier)"}}},"data":{"schema":"coord.copilot_call (plugin-owned, RLS-scoped); reads: app.timetable_*, plugin_hr.leave, teacher.leave_request, app.actions, family.request(+events), teacher.concern(+status events), curriculum.node/progress, duty.assignment","core_refs":["users.id","students.id"],"retention":{"on_uninstall":"export_then_purge_30d"},"residency":["IN"]},"regions":["IN"],"residency":"IN","billing":{"model":"pack","pack":"coordination"},"dependencies":[],"defaultEnabled":false}'::jsonb,
  '["users.read","students.read","events.emit","audit.request"]'::jsonb
FROM app.tenants t
WHERE NOT EXISTS (SELECT 1 FROM app.plugins p WHERE p.plugin_id='coord.view' AND p.tenant_id = t.id);

-- ── 4. Capability contracts (034 shape: guard per tenant row, idempotent) ───────
INSERT INTO app.capability_contracts (tenant_id, capability_id, plugin_id, version, contract)
SELECT t.id, v.cap, 'coord.view', '1.0.0',
  jsonb_build_object('events', v.cap, 'schema', 'v1', 'source', 'coord.view', 'note', v.note)
FROM app.tenants t
CROSS JOIN (VALUES
  ('coord.home.v1',    'daily coordinator read plane (staffing, gaps, approvals, delays, issues)'),
  ('coord.decision.v1','kernel-approval decisions on coordinator-owned actions (SoD: proposer≠decider)')
) AS v(cap, note)
WHERE NOT EXISTS (SELECT 1 FROM app.capability_contracts c WHERE c.plugin_id='coord.view' AND c.capability_id=v.cap AND c.tenant_id = t.id);

-- ── 5. Guarded ledger entry (034 shape verbatim; record_ref coordinator-view@1) ─
WITH cands AS (
  SELECT t.id AS tenant_id,
         COALESCE((SELECT a.hash FROM app.audit_log a
                    WHERE a.tenant_id = t.id
                    ORDER BY a.created_at DESC, a.id DESC LIMIT 1), 'GENESIS') AS prev_hash,
         to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at_iso
  FROM app.tenants t
  WHERE NOT EXISTS (
    SELECT 1 FROM app.audit_log x
    WHERE x.tenant_id = t.id AND x.record_type = 'Plugin' AND x.record_ref = 'coordinator-view@1')
), mat AS (
  SELECT c.tenant_id, c.prev_hash, c.at_iso,
    '{"tenant":"' || c.tenant_id::text
    || '","actor":"migration 037 (plugin factory)","actorRole":"system","action":"CoordinatorOS lane CS-1 registered: coord.view v1.0.0 (staffing today · substitution gaps · coordinator-owned kernel approvals with proposer≠decider SoD · curriculum pace vs term expectation · teacher workload aggregates with a fairness overload flag, never a score · duty allocation by least-loaded deterministic pick · escalations with append-only timelines · deterministic v0 copilot with 200/month budget)","recordType":"Plugin","recordRef":"coordinator-view@1","outcome":"coordinator is the execution authority · principal may read but deciding rides the coordinator-owned action · teacher role refused on every door · workload doors return aggregates only, no student data · escalations carry student identity only where the coordinator is the routed authority · copilot never invents: honest empty answers · graceful degradation when sibling-lane tables are absent","at":"' || c.at_iso || '"}' AS material
  FROM cands c
), hashed AS (
  SELECT m.tenant_id, m.prev_hash, m.at_iso, m.material,
         encode(sha256(convert_to(m.prev_hash || m.material, 'UTF8')), 'hex') AS row_hash
  FROM mat m
)
SELECT * FROM hashed
CROSS JOIN LATERAL app.audit_append(
  hashed.tenant_id, 'migration 037 (plugin factory)', 'system',
  'CoordinatorOS lane CS-1: coord.view v1.0.0 (coordinator command center read+act plane · SoD decide door · fairness-first workload · deterministic v0 copilot)',
  'Plugin', 'coordinator-view@1',
  'coordinator execution authority · proposer≠decider SoD · overload is a flag, never a score/rank · aggregates only on workload doors · student identity only where coordinator is routed authority · copilot never invents',
  'COORDINATOROS-PLAN · DPDP Act 2023 · Platform §2.4', false, 'high',
  'coord.view 1.0.0 · CS-1 data plane live (migration 037)',
  hashed.prev_hash, hashed.row_hash, hashed.at_iso::timestamptz);

COMMIT;
