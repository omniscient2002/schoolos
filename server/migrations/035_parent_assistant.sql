-- 035_parent_assistant.sql — ParentOS lane PS-2: parent.assistant v1.0.0
-- The parent's deterministic assistant: day/week brief, keyword ask over OWN-child data,
-- labelled template drafts, plain-language explains. V0 INVARIANT — deterministic_only:
-- NO external LLM is contacted anywhere; every line is composed from the family's own
-- records (family.child_link scoping) with evidence numbers, or the door says plainly
-- that it doesn't have the information. Banned interpretive language: failing,
-- disengaged, risk, at-risk, weak — the brief describes facts, never judgements.
--
-- Tables (schema: parent):
--   parent.copilot_call — the P-copilot budget ledger: one row per ask/draft call;
--     budget = count(user rows this calendar month) ≥ 100 → the ask door answers 429.
--   parent.brief_log  — one row per generated brief (morning/evening/week) with the
--     exact payload served (provenance for "what did the assistant tell me").
-- Every door is guardian-only, lifecycle-gated, and refuses the teacher role.
-- Idempotent ×2: IF NOT EXISTS everywhere, NOT EXISTS guards on all inserts.
BEGIN;

CREATE SCHEMA IF NOT EXISTS parent;
GRANT USAGE ON SCHEMA parent TO schoolos_app;

CREATE TABLE IF NOT EXISTS parent.copilot_call (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  user_id      uuid NOT NULL,                  -- app.users.id (no hard FK — plugin isolation)
  verb         text NOT NULL CHECK (verb IN ('ask','draft')),
  question     text,
  answer_ref   text,                           -- ref to a stored answer/draft (v1+); inline answers stay NULL
  sources      jsonb NOT NULL DEFAULT '[]'::jsonb,
  budget_class text NOT NULL DEFAULT 'P-copilot',
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS parent_copilot_call_budget_idx ON parent.copilot_call (tenant_id, user_id, at DESC);

CREATE TABLE IF NOT EXISTS parent.brief_log (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id   uuid NOT NULL,
  when_kind text NOT NULL CHECK (when_kind IN ('morning','evening','week')),
  payload   jsonb NOT NULL DEFAULT '{}'::jsonb, -- the exact brief served (evidence trail)
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS parent_brief_log_idx ON parent.brief_log (tenant_id, user_id, at DESC);

-- RLS: tenant isolation (house pattern, 001 §tenant_isolation; 034 precedent)
DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['copilot_call','brief_log'] LOOP
    EXECUTE format('ALTER TABLE parent.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON parent.%I', t);
    EXECUTE format($f$CREATE POLICY tenant_isolation ON parent.%I
      USING (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)$f$, t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON parent.copilot_call, parent.brief_log TO schoolos_app;

-- factory registry row (plugin factory provisions its own rows — 018/024/029/033/034 precedent)
INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, manifest, permissions)
SELECT t.id, 'parent.assistant', '1.0.0', 'C', 'registered',
  '{"id":"parent.assistant","name":"Parent Assistant","version":"1.0.0","kernel":">=1.0.0 <2.0.0","class":"C","trust":"T1","description":"The parent assistant: morning/evening/week brief per child (attendance today, homework due in the next 24h when the homework lane is connected, pending consents, exams announced in the last 7 days, open requests, weekly attendance share and published reports), a keyword ask that answers ONLY from the family''s own records with sources, labelled template drafts (question to teacher, leave note) that the parent edits before sending, and plain-language explains built from real numbers. DETERMINISTIC-ONLY: no LLM is contacted anywhere; unknown topics get an honest no and point to the class teacher; every ask/draft call writes a parent.copilot_call budget row (P-copilot, 100 per calendar month). Guardian scoping via family.child_link; cross-guardian access refused; teachers refused on every door. Contracts: parent.brief.v1, parent.copilot.v1.","permissions":["students.read","events.emit","audit.request"],"events":{"subscribe":[],"publish":[]},"eventSubscriptions":[],"slots":["settings","reports"],"routes":[],"widgets":[],"settingsSchema":{"type":"object","properties":{"deterministic_v0":{"type":"string","default":"v0 is deterministic-only: no LLM calls; answers are composed from the family''s own records, unknowns are said honestly","description":"Scope note for the AI governance slot"}}},"data":{"schema":"parent.copilot_call, parent.brief_log (all RLS-scoped); reads family.child_link, family.request, family.consent, app.attendance, app.fee_obligations, teacher.homework (probed), plugin_exams.* (probed)","core_refs":["students.id","users.id"],"retention":{"on_uninstall":"export_then_purge_30d"},"residency":["IN"]},"regions":["IN"],"residency":"IN","billing":{"model":"pack","pack":"family"},"dependencies":[],"defaultEnabled":false}'::jsonb,
  '["students.read","events.emit","audit.request"]'::jsonb
FROM app.tenants t
WHERE NOT EXISTS (SELECT 1 FROM app.plugins p WHERE p.plugin_id='parent.assistant');

INSERT INTO app.capability_contracts (tenant_id, capability_id, plugin_id, version, contract)
SELECT t.id, v.cap, 'parent.assistant', '1.0.0',
  jsonb_build_object('events', v.cap, 'schema', 'v1', 'source', 'parent.assistant', 'note', v.note)
FROM app.tenants t
CROSS JOIN (VALUES
  ('parent.brief.v1','deterministic per-child brief (morning/evening/week) from own-child records'),
  ('parent.copilot.v1','keyword ask + labelled template drafts over own-child data; P-copilot budget 100/calendar month; honest unknowns')
) AS v(cap, note)
WHERE NOT EXISTS (SELECT 1 FROM app.capability_contracts c WHERE c.plugin_id='parent.assistant' AND c.capability_id=v.cap);

-- guarded ledger entry (024/029/032/033/034 precedent — chain-selection must match audit_append's verifier)
WITH cands AS (
  SELECT t.id AS tenant_id,
         COALESCE((SELECT a.hash FROM app.audit_log a
                    WHERE a.tenant_id = t.id
                    ORDER BY a.created_at DESC, a.id DESC LIMIT 1), 'GENESIS') AS prev_hash,
         to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at_iso
  FROM app.tenants t
  WHERE NOT EXISTS (
    SELECT 1 FROM app.audit_log x
    WHERE x.tenant_id = t.id AND x.record_type = 'Plugin' AND x.record_ref = 'parent-assistant@1')
), mat AS (
  SELECT c.tenant_id, c.prev_hash, c.at_iso,
    '{"tenant":"' || c.tenant_id::text
    || '","actor":"migration 035 (plugin factory)","actorRole":"system","action":"ParentOS lane PS-2 registered: parent.assistant v1.0.0 (deterministic parent assistant — morning/evening/week brief · keyword ask composed only from own-child records with sources · labelled ai_draft templates the parent edits before sending · plain-language explains from real numbers)","recordType":"Plugin","recordRef":"parent-assistant@1","outcome":"guardian scoping via family.child_link · cross-guardian 403 · teachers refused on every door · deterministic-only, NO LLM anywhere · every ask/draft call budgeted (parent.copilot_call, P-copilot, 100 per calendar month → 429) · briefs provenance-logged (parent.brief_log) · honest unknowns point to the class teacher · banned interpretive language (failing/disengaged/risk/weak)","at":"' || c.at_iso || '"}' AS material
  FROM cands c
), hashed AS (
  SELECT m.tenant_id, m.prev_hash, m.at_iso, m.material,
         encode(sha256(convert_to(m.prev_hash || m.material, 'UTF8')), 'hex') AS row_hash
  FROM mat m
)
SELECT * FROM hashed
CROSS JOIN LATERAL app.audit_append(
  hashed.tenant_id, 'migration 035 (plugin factory)', 'system',
  'ParentOS lane PS-2: parent.assistant v1.0.0 (deterministic brief · keyword ask · labelled drafts · plain-language explains)',
  'Plugin', 'parent-assistant@1',
  'own-child scoping via family.child_link · P-copilot budget 100/calendar month · deterministic-only, no LLM · drafts labelled ai_draft',
  'PARENTOS-PLAN §data+contracts · DPDP Act 2023 · Platform §2.4', false, 'high',
  'parent.assistant 1.0.0 · PS-2 assistant plane live (migration 035)',
  hashed.prev_hash, hashed.row_hash, hashed.at_iso::timestamptz);

COMMIT;
