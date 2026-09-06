-- 020: ops.timetable — per-plugin migration (plugin factory, docs/11 §2.2)
-- Unit: wave-1 completion · per-plugin provisioning discipline
--
-- Independence contract: idempotent like 011/013/015/019 — (a) no-ops where 010
-- already provisioned the artifacts, (b) fully provisions ops.timetable on a bare
-- kernel. Timetable DDL/registry row/contracts/demo data copied VERBATIM from 010
-- §1-§3/§7/§8/§9 (the app.timetable_* tables are plugin-owned, RLS-scoped).
-- Runtime module: server/src/plugins/ops.timetable/ (mounted by the loader).

-- ── 1. Timetable primitives (verbatim DDL from 010 §1-§3) ───────────────────────
CREATE TABLE IF NOT EXISTS app.timetable_periods (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  seq         text NOT NULL,                    -- '1'..'8' | 'B' (break) | 'L' (lunch)
  label       text NOT NULL,
  start_time  text NOT NULL,
  end_time    text NOT NULL,
  is_break    boolean NOT NULL DEFAULT false,
  sort_idx    integer NOT NULL,
  UNIQUE (tenant_id, seq)
);

CREATE TABLE IF NOT EXISTS app.timetable_slots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  period_id   uuid NOT NULL REFERENCES app.timetable_periods(id),
  day_of_week text NOT NULL CHECK (day_of_week IN ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday')),
  subject     text NOT NULL,
  teacher_name text NOT NULL,
  room        text,
  UNIQUE (period_id, day_of_week, subject, teacher_name)
);
CREATE INDEX IF NOT EXISTS tt_slots_tenant_idx ON app.timetable_slots(tenant_id, day_of_week);

CREATE TABLE IF NOT EXISTS app.timetable_substitutions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  slot_id     uuid NOT NULL REFERENCES app.timetable_slots(id),
  date        date NOT NULL,
  absent_teacher text NOT NULL,
  substitute  text NOT NULL,
  reason      text,
  status      text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned','completed','cancelled')),
  assigned_by uuid REFERENCES app.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slot_id, date)
);
CREATE INDEX IF NOT EXISTS tt_subs_tenant_idx ON app.timetable_substitutions(tenant_id, date);

-- RLS (verbatim policy shape from 010 §6)
DO $$
DECLARE t text; sch text; tbl text;
BEGIN
  FOREACH t IN ARRAY ARRAY['app.timetable_periods','app.timetable_slots','app.timetable_substitutions']
  LOOP
    sch := split_part(t, '.', 1);
    tbl := split_part(t, '.', 2);
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', sch, tbl);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', sch, tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I.%I', sch, tbl);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I.%I
      USING (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)$p$, sch, tbl);
  END LOOP;
END $$;

-- ── 2. Registry row (verbatim manifest from 010 §7; status 'registered') ────────
INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, manifest, permissions, entitlement, trust_level, event_budget, ai_budget)
SELECT t.id, 'ops.timetable', '1.0.0', 'C', 'registered',
  '{"id":"ops.timetable","name":"Timetable & Substitutions","version":"1.0.0","kernel":">=1.0.0 <2.0.0","class":"C","trust":"T1","description":"Timetable primitives provider: period grid, class-section slots, daily substitutions and deterministic attendance period-autofill. Outputs are consumed by attendance, exams and comms (Class C contract). Substitution assignment is audited; the substitution suggester is deterministic-first — candidate ranking is a rule, never a model (docs/11 §7).","permissions":["students.read","attendance.write","events.emit","audit.request"],"events":{"subscribe":[],"publish":[{"type":"timetable.published","schema":"v1"},{"type":"substitution.assigned","schema":"v1"}]},"eventSubscriptions":[],"slots":["settings","reports"],"routes":[],"widgets":[],"settingsSchema":{"type":"object","properties":{"working_days":{"type":"array","items":{"type":"string","enum":["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"]},"default":["Monday","Tuesday","Wednesday","Thursday","Friday"]},"autofill_default":{"type":"string","enum":["present","none"],"default":"present","description":"Status used for unmarked students on deterministic period autofill"},"absence_feed":{"type":"string","enum":["manual","hr.leave"],"default":"manual","description":"Source of staff-absence facts (hr.leave plugin in wave 3)"}}},"data":{"schema":"app.timetable_* (plugin-owned, RLS-scoped)","core_refs":["students.id","attendance.student_id"],"retention":{"on_uninstall":"export_then_purge_30d"},"residency":["IN"]},"regions":["IN"],"residency":"IN","billing":{"model":"pack","pack":"operations"},"dependencies":[],"defaultEnabled":false}'::jsonb,
  '["students.read","attendance.write","events.emit","audit.request"]'::jsonb,
  '{"plan":"operations","billing":"pack"}'::jsonb, 'T1',
  jsonb_build_object('events_per_min',60,'payload_max_bytes',65536,'subscriber_max',25,'fanout_max',50,'chain_depth_max',5,'replay_max',10000,'scheduled_per_day',100),
  '{"calls_per_day":500,"tokens_per_day":100000,"tools_per_day":50}'::jsonb
FROM app.tenants t
ON CONFLICT (tenant_id, plugin_id) DO NOTHING;

-- ── 3. Capability contracts (verbatim from 010 §8, incl. the NULL AI capability) ─
INSERT INTO app.capability_contracts (tenant_id, plugin_id, capability_id, version, kind, contract, enforced)
SELECT NULL, v.plugin_id, v.capability_id, v.version, v.kind, v.contract, v.enforced
FROM (VALUES
  ('ops.timetable', 'timetable.substitute.assign', '1.0.0', 'command',
   '{"description":"Assign a substitution for a class-section period; the timetable primitive overlays the effective teacher and emits substitution.assigned for attendance, comms and exam flows.","read_scopes":["timetable.read:own_tenant"],"write_scopes":["plugin_timetable.substitutions"],"event_outputs":["substitution.assigned.v1"],"side_effects":[{"type":"event.publish","approval":"never"},{"type":"comms.send","approval":"required","policy_ref":"Comms §1.2","note":"guardian/staff notification rides the orchestrator"}],"policy_refs":["Platform §3 (plugin governance)","Attendance §1.1"],"audit":{"level":"full","includes":["actor","slot","absent_teacher","substitute"]},"data_classification":["internal"],"compat":{"kernel":">=1.0 <2.0"},"regions":["IN"],"residency":"IN"}'::jsonb,
   '{"audit":"full","invariants":["slot_exists","one_effective_substitution_per_slot_day","audited_assignment"]}'::jsonb),
  ('ops.timetable', 'attendance.period.autofill', '1.0.0', 'command',
   '{"description":"Deterministic period-attendance default: marks unmarked students present for one class-section period. Absences stay human-marked (teacher flow); guardian notices remain kernel policy.","read_scopes":["graph.read:students","attendance.read:section"],"write_scopes":["attendance.write:period"],"side_effects":[{"type":"attendance.write","approval":"never","guard":"unmarked_rows_only","policy_ref":"Attendance §1.1"},{"type":"event.publish","approval":"never"}],"policy_refs":["Attendance §1.1"],"audit":{"level":"full","includes":["actor","period","marked_count"]},"data_classification":["pii:student_records"],"compat":{"kernel":">=1.0 <2.0"},"regions":["IN"],"residency":"IN"}'::jsonb,
   '{"audit":"full","invariants":["deterministic","unmarked_rows_only","absences_human_marked","idempotent_replay"]}'::jsonb),
  (NULL, 'suggest.substitution', '1.0.0', 'capability',
   '{"description":"AI Gateway capability: ranks substitution candidates from the timetable grid (same-subject first, then free periods, then load balance). Deterministic ranking precedes any model; suggestions never execute — assignment is a staff action through timetable.substitute.assign.","read_scopes":["timetable.read:own_tenant"],"write_scopes":[],"side_effects":[],"policy_refs":["Platform §2.4","Platform §3 (plugin governance)"],"audit":{"level":"digest","includes":["capability","trace_id","candidates_digest"]},"data_classification":["internal"],"ai_eligibility":{"modes":["recommendation"],"grounding":"required","budget_enforced":true},"compat":{"kernel":">=1.0 <2.0"},"regions":["IN"],"residency":"IN"}'::jsonb,
   '{"audit":"digest","invariants":["suggestion_never_executes","deterministic_ranking_precedes_model","budget_enforced"]}'::jsonb)
) AS v(plugin_id, capability_id, version, kind, contract, enforced)
WHERE NOT EXISTS (
  SELECT 1 FROM app.capability_contracts x
  WHERE x.tenant_id IS NULL AND x.capability_id = v.capability_id AND x.version = v.version);

-- ── 4. Demo timetable data (verbatim from 010 §9; only when the tenant has none) ─
INSERT INTO app.timetable_periods (tenant_id, seq, label, start_time, end_time, is_break, sort_idx)
SELECT t.id, p.seq, p.label, p.start_time, p.end_time, p.is_break, p.ord
FROM app.tenants t
CROSS JOIN (VALUES
  ('1','Period 1','08:00','08:45',false,1),('2','Period 2','08:50','09:35',false,2),
  ('3','Period 3','09:40','10:25',false,3),('B','Morning break','10:25','10:55',true,4),
  ('4','Period 4','11:00','11:45',false,5),('5','Period 5','11:50','12:35',false,6),
  ('L','Lunch','12:35','13:20',true,7),('6','Period 6','13:20','14:05',false,8),
  ('7','Period 7','14:10','14:55',false,9),('8','Period 8','15:00','15:45',false,10)
) AS p(seq,label,start_time,end_time,is_break,ord)
WHERE NOT EXISTS (SELECT 1 FROM app.timetable_periods x WHERE x.tenant_id = t.id);

INSERT INTO app.timetable_slots (tenant_id, period_id, day_of_week, subject, teacher_name, room)
SELECT g.tenant_id, g.period_id, g.day, st.subject, st.teacher,
       'R-' || (1 + abs(hashtext(g.tenant_id::text || g.grade || g.section || g.day || g.seq || st.subject)) % 12)
FROM (
  SELECT t.id AS tenant_id, tp.id AS period_id, tp.seq, d.day, s.grade, s.section
  FROM app.tenants t
  JOIN app.timetable_periods tp ON tp.tenant_id = t.id AND tp.is_break = false
  CROSS JOIN (VALUES ('Monday'),('Tuesday'),('Wednesday'),('Thursday'),('Friday')) AS d(day)
  CROSS JOIN LATERAL (
    SELECT DISTINCT grade, section FROM app.students
    WHERE tenant_id = t.id AND status = 'active'
  ) s
  WHERE NOT EXISTS (SELECT 1 FROM app.timetable_slots x WHERE x.tenant_id = t.id)
) g
CROSS JOIN LATERAL (
  SELECT subject, teacher FROM (VALUES
    ('Mathematics','S. Ganesh'),('Science','Priya Iyer'),('English','R. Menon'),
    ('Social Science','A. Khanna'),('Hindi','V. Sharma'),('Computer Lab','D. Rao'),
    ('Art','N. Pillai'),('Physical Education','J. Thomas')
  ) AS m(subject, teacher)
  ORDER BY hashtext(g.tenant_id::text || g.grade || g.section || g.day || g.seq || m.subject) % 100000
  LIMIT 1
) st
ON CONFLICT (period_id, day_of_week, subject, teacher_name) DO NOTHING;

-- ── 5. Grants (verbatim shape from 010 §10) ─────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON app.timetable_periods, app.timetable_slots,
  app.timetable_substitutions TO schoolos_app;

-- ── 6. Guarded ledger entry (010 logged ops.timetable@1.0.0; this is the per-plugin marker) ─
WITH cands AS (
  SELECT t.id AS tenant_id,
         COALESCE((SELECT a.hash FROM app.audit_log a
                    WHERE a.tenant_id = t.id
                    ORDER BY a.created_at DESC, a.id DESC LIMIT 1), 'GENESIS') AS prev_hash,
         to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at_iso
  FROM app.tenants t
  WHERE NOT EXISTS (
    SELECT 1 FROM app.audit_log x
    WHERE x.tenant_id = t.id AND x.record_type = 'Plugin' AND x.record_ref = 'ops.timetable@1.0.0-perplugin')
), mat AS (
  SELECT c.tenant_id, c.prev_hash, c.at_iso,
    '{"tenant":"' || c.tenant_id::text
    || '","actor":"migration 020 (plugin factory)","actorRole":"system","action":"Plugin unit registered: ops.timetable (wave-1 completion)","recordType":"Plugin","recordRef":"ops.timetable@1.0.0-perplugin","outcome":"timetable DDL/RLS/grants + registry row + contracts + demo data verbatim from 010 · module src/plugins/ops.timetable mounted by loader · uniform lifecycle gating live","at":"' || c.at_iso || '"}' AS material
  FROM cands c
), hashed AS (
  SELECT m.tenant_id, m.prev_hash, m.at_iso, m.material,
         encode(sha256(convert_to(m.prev_hash || m.material, 'UTF8')), 'hex') AS row_hash
  FROM mat m
)
SELECT * FROM hashed
CROSS JOIN LATERAL app.audit_append(
  hashed.tenant_id, 'migration 020 (plugin factory)', 'system',
  'Plugin unit registered: ops.timetable (wave-1 completion)',
  'Plugin', 'ops.timetable@1.0.0-perplugin',
  'per-plugin provisioning: timetable DDL/RLS/grants + verbatim row/contracts/demo data',
  'Platform §3.1 (plugin governance)', false, 'low',
  'registered (not enabled) · app.timetable_* under RLS · module mounted by loader',
  hashed.prev_hash, hashed.row_hash, hashed.at_iso::timestamptz);
