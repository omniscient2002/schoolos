-- 116 · OWNER / PRINCIPAL — spine hardening (docs/OWNER-PRINCIPAL-PERFECT-100.md, Batch 2).
--
-- WHAT THIS ADDS
--   · OPP-DAT-1  `app.actions.source_plugin` — the plugin that raised an action, so the plugin
--                disable-drain can reassign REAL rows instead of matching zero (the old drain keyed on
--                `owner_role = <plugin id>`, which no raise ever sets).
--   · OPP-OVR-2  `app.action_delegations` — bounded, scoped delegation of approval authority (vacation
--                cover). Never applies to owner/finance segregation-of-duties.
--   · OPP-OVR-3  `app.action_sla_events` — append-only record of SLA escalations for past-deadline actions.
--   · OPP-PRD-2  `app.principal_briefs` — the generated daily brief (07:00 IST) per school.
--   · OPP-PRD-3  `app.announcements` — the announcement composer: audience, template, approval, and the
--                communications rows it fans out to.
--   · OPP-PRD-5  `app.compliance_items` — the compliance calendar (returns, inspections, drills) with a
--                filing action.
--   · OPP-PRD-7  `app.certificates` — TC / bonafide / character certificates with a signing spine.
--   · OPP-DAT-2  `app.report_snapshots` — immutable board-pack / inspection-pack artifacts.
--
-- LAWS OBEYED
--   · DAT-1: composite (tenant_id, id) UNIQUE on parents + tenant-aligned FKs; a row can never point at
--     another tenant's student/user/action.
--   · D-35: app role gets SELECT/INSERT/UPDATE and NEVER DELETE.
--   · 074: every policy routes through app.current_tenant().
--   · Append-only where the domain demands it (SLA events, report snapshots).
--   · Idempotent: IF NOT EXISTS / pg_constraint-guarded; runs on an empty database and on a replay.

BEGIN;

-- ── 1. OPP-DAT-1 · the raising plugin on every action ─────────────────────────────────────────────
ALTER TABLE app.actions ADD COLUMN IF NOT EXISTS source_plugin text;
CREATE INDEX IF NOT EXISTS actions_source_plugin_idx ON app.actions (tenant_id, source_plugin) WHERE source_plugin IS NOT NULL;
COMMENT ON COLUMN app.actions.source_plugin IS
  'The plugin that raised this action (e.g. admissions.funnel). Set at raise time; the plugin disable-drain reassigns open actions by this column. NULL for kernel-raised actions.';

-- ── 2. OPP-OVR-2 · bounded delegation of approval authority ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.action_delegations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  from_user_id uuid NOT NULL,
  from_role   text NOT NULL,
  to_user_id  uuid NOT NULL,
  to_role     text NOT NULL,
  scope_role  text,                       -- NULL = any owner_role the delegator may decide; else restrict
  starts_at   timestamptz NOT NULL DEFAULT now(),
  ends_at     timestamptz NOT NULL,
  reason      text,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

ALTER TABLE app.action_delegations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.action_delegations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.action_delegations;
CREATE POLICY tenant_isolation ON app.action_delegations
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.action_delegations TO schoolos_app;

-- tenant-aligned composite keys so the FKs below can never cross tenants.
-- app.users(tenant_id,id) and app.actions(tenant_id,id) already carry this key from 081 — do not
-- drop/re-add them (other FKs depend on them). Only the new tables need it.
ALTER TABLE app.action_delegations DROP CONSTRAINT IF EXISTS action_delegations_tenant_id_id_key;
ALTER TABLE app.action_delegations ADD CONSTRAINT action_delegations_tenant_id_id_key UNIQUE (tenant_id, id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'action_delegations_from_user_fkey') THEN
    ALTER TABLE app.action_delegations ADD CONSTRAINT action_delegations_from_user_fkey
      FOREIGN KEY (tenant_id, from_user_id) REFERENCES app.users(tenant_id, id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'action_delegations_to_user_fkey') THEN
    ALTER TABLE app.action_delegations ADD CONSTRAINT action_delegations_to_user_fkey
      FOREIGN KEY (tenant_id, to_user_id) REFERENCES app.users(tenant_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS action_delegations_active_idx
  ON app.action_delegations (tenant_id, to_user_id, ends_at);

-- ── 3. OPP-OVR-3 · append-only SLA escalation events ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.action_sla_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  action_id   uuid NOT NULL,
  escalated_to_role text NOT NULL,
  hours_overdue integer NOT NULL DEFAULT 0,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.action_sla_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.action_sla_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.action_sla_events;
CREATE POLICY tenant_isolation ON app.action_sla_events
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
-- append-only: SELECT + INSERT, never UPDATE
GRANT SELECT, INSERT ON app.action_sla_events TO schoolos_app;

ALTER TABLE app.action_sla_events DROP CONSTRAINT IF EXISTS action_sla_events_tenant_id_id_key;
ALTER TABLE app.action_sla_events ADD CONSTRAINT action_sla_events_tenant_id_id_key UNIQUE (tenant_id, id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'action_sla_events_action_fkey') THEN
    ALTER TABLE app.action_sla_events ADD CONSTRAINT action_sla_events_action_fkey
      FOREIGN KEY (tenant_id, action_id) REFERENCES app.actions(tenant_id, id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── 4. OPP-PRD-2 · the principal's generated brief ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.principal_briefs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  brief_date  date NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, brief_date)
);

ALTER TABLE app.principal_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.principal_briefs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.principal_briefs;
CREATE POLICY tenant_isolation ON app.principal_briefs
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.principal_briefs TO schoolos_app;

-- ── 5. OPP-PRD-3 · the announcement composer ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.announcements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  title       text NOT NULL,
  body        text NOT NULL,
  audience_kind text NOT NULL DEFAULT 'all_guardians' CHECK (audience_kind IN ('all_guardians','class','route','staff','custom')),
  audience_ref  text,                     -- class grade, route code, or a note for `custom`
  channel     text NOT NULL DEFAULT 'In-app',
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','queued','sent','cancelled')),
  action_id   uuid,                       -- the kernel approval that authorised it
  comm_id     uuid,                       -- the app.communications row it fanned out to
  recipients  integer,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  approved_by uuid,
  approved_at timestamptz
);

ALTER TABLE app.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.announcements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.announcements;
CREATE POLICY tenant_isolation ON app.announcements
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.announcements TO schoolos_app;

CREATE INDEX IF NOT EXISTS announcements_tenant_status_idx ON app.announcements (tenant_id, status);

-- DAT-2: the announcement/certificate action+comm references are constrained by migration 117
-- (composite, tenant-aligned), kept in its own file so a deployment that predates 116 still migrates.

-- ── 6. OPP-PRD-5 · the compliance calendar ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.compliance_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  kind        text NOT NULL CHECK (kind IN ('board_return','inspection','fire_drill','dpdp_audit','certification','other')),
  title       text NOT NULL,
  due_on      date NOT NULL,
  owner_role  text NOT NULL DEFAULT 'principal',
  status      text NOT NULL DEFAULT 'due' CHECK (status IN ('due','reminded','filed','waived')),
  evidence_ref text,
  filed_by    uuid,
  filed_at    timestamptz,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kind, title, due_on)
);

ALTER TABLE app.compliance_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.compliance_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.compliance_items;
CREATE POLICY tenant_isolation ON app.compliance_items
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.compliance_items TO schoolos_app;

CREATE INDEX IF NOT EXISTS compliance_items_due_idx ON app.compliance_items (tenant_id, status, due_on);

-- ── 7. OPP-PRD-7 · certificate signing ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.certificates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  kind        text NOT NULL CHECK (kind IN ('transfer','bonafide','character','study','other')),
  student_id  uuid NOT NULL,
  serial      text NOT NULL,
  body        text,
  status      text NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval','signed','issued','cancelled')),
  action_id   uuid,
  artifact_ref uuid,                      -- app.files row for the rendered PDF
  issued_by   uuid,
  signed_by   uuid,
  signed_at   timestamptz,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, serial)
);

ALTER TABLE app.certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.certificates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.certificates;
CREATE POLICY tenant_isolation ON app.certificates
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.certificates TO schoolos_app;

-- app.students(tenant_id,id) already carries this key from 081.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'certificates_student_fkey') THEN
    ALTER TABLE app.certificates ADD CONSTRAINT certificates_student_fkey
      FOREIGN KEY (tenant_id, student_id) REFERENCES app.students(tenant_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS certificates_student_idx ON app.certificates (tenant_id, student_id);

-- ── 8. OPP-DAT-2 · immutable report snapshots (board pack / inspection pack) ────────────────────────
CREATE TABLE IF NOT EXISTS app.report_snapshots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  kind        text NOT NULL CHECK (kind IN ('board_pack','inspection_pack','fee_health','safety_summary')),
  period      text NOT NULL,              -- e.g. '2026-09' or '2026-27-T2'
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text NOT NULL,
  generated_by uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kind, period, content_hash)
);

ALTER TABLE app.report_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.report_snapshots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.report_snapshots;
CREATE POLICY tenant_isolation ON app.report_snapshots
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
-- append-only: SELECT + INSERT, never UPDATE (a snapshot is a fact)
GRANT SELECT, INSERT ON app.report_snapshots TO schoolos_app;

CREATE INDEX IF NOT EXISTS report_snapshots_tenant_kind_idx ON app.report_snapshots (tenant_id, kind, created_at DESC);

COMMIT;
