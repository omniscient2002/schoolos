-- 081 — DAT-1: tenant alignment is enforced by the SCHEMA, not by hope.
--
-- THE REGISTER: "Every child FK references the parent's PK only, never (id, tenant_id) ... and no unique key
-- includes tenant_id on any of those parents. RLS prevents *reading* a mismatch, so a cross-tenant child row
-- is invisible rather than impossible — it can sit with tenant_id=A and student_id∈B, absent from both
-- tenants' ledgers."
--
-- That is the whole finding, and it is worth stating why it is a P0 rather than a tidiness item: with a
-- single-column FK, `app.attendance(tenant_id=A, student_id=B)` is ACCEPTED by the database. RLS then hides
-- it from tenant A (the row's student belongs to B) and from tenant B (the row's tenant is A). The pupil's
-- attendance is gone from both schools' registers, with no error at any layer. Making the pair composite
-- makes that row IMPOSSIBLE, and the failure becomes a constraint violation at write time — which is where a
-- data-integrity problem should be discovered.
--
-- MEASURED SCOPE (live catalogue, not the register's example list — 57 conversions, 26 parents, 44 child
-- tables). The register named `plugin_exams.mark.student_id` as one of these: it is NOT, it has no FK at all.
-- That column is DAT-2's (migration 082).
--
-- ORDER IS LOAD-BEARING: step 1 (unique keys on parents) must precede step 2 (composite FKs). A composite FK
-- whose target has no matching unique constraint fails with "there is no unique constraint matching given
-- keys for referenced table" — the guard blocks below cannot paper over it.
--
-- WHY `UNIQUE (tenant_id, id)` IS REDUNDANT AND STILL CORRECT: every parent already has `id` as its PRIMARY
-- KEY, so `(tenant_id, id)` is trivially unique. It exists ONLY to be a legal FK target — PostgreSQL requires
-- the referenced columns to carry a unique constraint in exactly that order. Please do not "clean this up":
-- dropping these breaks every composite FK below. The cost is 26 btree index builds of (uuid, uuid); the real
-- cost on a large table is the ACCESS EXCLUSIVE lock window, not the index size, and it cannot be avoided
-- because the runner wraps each file in ONE transaction (scripts/migrate.js:59-67) — no CREATE INDEX
-- CONCURRENTLY is possible inside a migration.
--
-- ON DELETE ACTIONS ARE PRESERVED EXACTLY AS THEY ARE TODAY (51 NO ACTION, 6 CASCADE), and that is a
-- deliberate limit on this change's blast radius. The register's proposed fix ("composite FKs") says nothing
-- about deletion behaviour, and DAT-2 is the row that owns that question — its own proposal is too coarse in
-- at least nine places (a blanket "CASCADE for derived rows" would bypass the DPDP erasure journal, which
-- writes no student DELETE at all). Changing tenancy AND deletion semantics in one migration would make a
-- failure impossible to attribute. Composite first, cascade policy in its own reviewed change.
--
-- `app.tenants` is deliberately absent from the parent list: it has no `tenant_id` column (it IS the tenant
-- root), so `REFERENCES app.tenants (tenant_id, id)` is not expressible. For the same reason the 72 FKs that
-- point at `app.tenants` are out of scope — a tenant cannot be cross-tenant.
--
-- IDEMPOTENT by the house idiom (080_tenant_plan.sql:14-19): ADD CONSTRAINT IF NOT EXISTS does not exist in
-- PostgreSQL, so every addition is guarded on pg_constraint. Re-running this file is a no-op.
--
-- PRE-FLIGHT (run before applying to PRODUCTION; the dev database is nearly empty outside `app.*`, so its
-- zeros prove nothing there):
--   SELECT count(*) FROM app.attendance a JOIN app.students s ON s.id = a.student_id
--    WHERE a.tenant_id <> s.tenant_id;      -- repeat per pair; >0 means a row that is currently invisible
--   Any MIGRATION MISMATCH is a data decision for the owner (which tenant owns the row?), NOT something this
--   migration may guess at. It will fail loudly on such a row, by design: the composite ADD CONSTRAINT
--   validates existing rows.

-- ── Step 1 · a composite FK needs a composite unique key on the parent ────────────────────────────────
-- 26 parents. Every one already has `id` as its PRIMARY KEY, so `(tenant_id, id)` is trivially
-- unique and this constraint is semantically redundant — it exists ONLY because PostgreSQL requires the
-- referenced columns of a composite FK to carry a unique constraint in exactly that order. Do not remove
-- these as "duplicates": every composite FK in step 2 depends on them.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('app','academic_years'),
      ('app','actions'),
      ('app','assets'),
      ('app','events'),
      ('app','fee_obligations'),
      ('app','migration_sources'),
      ('app','outbox'),
      ('app','payments'),
      ('app','routes'),
      ('app','students'),
      ('app','timetable_periods'),
      ('app','timetable_slots'),
      ('app','users'),
      ('app','webhook_subscriptions'),
      ('app','work_orders'),
      ('curriculum','node'),
      ('family','request'),
      ('intervention','plan'),
      ('library','book'),
      ('plugin_admissions','lead'),
      ('plugin_exams','exam'),
      ('plugin_exams','report'),
      ('ptm','slot'),
      ('support','doubt'),
      ('teacher','concern'),
      ('teacher','homework')
    ) AS v(sch, tbl) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE c.contype IN ('u','p') AND n.nspname = r.sch AND t.relname = r.tbl
        AND (SELECT array_agg(a.attname::text ORDER BY k.ord)
               FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
               JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum)
            = ARRAY['tenant_id','id']
    ) THEN
      EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I UNIQUE (tenant_id, id)',
                     r.sch, r.tbl, r.tbl || '_tenant_id_id_key');
    END IF;
  END LOOP;
END $$;

-- ── Step 2 · replace each single-column FK with its tenant-aligned twin ───────────────────────────────
-- The 57 rows below were GENERATED from the live pg_constraint catalogue into
-- .coop/logs/recon-dat12-raw/fk_values_081.sql, NOT typed by hand. The first draft of this file WAS
-- hand-written from a reading of the schema and it was wrong in both directions: 37 real pairs were missing
-- and 6 invented rows never existed (an `app.ptm_bookings` table — the real one is `ptm.booking`). Every one
-- of those errors would have been SILENT, because the ADD sits inside an `IF NOT EXISTS` guard, so the
-- migration would have applied cleanly while converting one third of the surface. Generate this list; never
-- retype it.
--
-- The OLD constraint is DROPPED, not kept alongside: two FKs on the same column would both be enforced, and
-- the single-column one would defeat any ON DELETE behaviour chosen for the composite one later. The ON DELETE
-- action is copied from the constraint being replaced, so this migration changes tenancy ONLY (51 NO ACTION,
-- 6 CASCADE preserved — see the header).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('app','actions','decided_by','actions_decided_by_fkey','app','users','NO ACTION'),
    ('app','api_keys','created_by','api_keys_created_by_fkey','app','users','NO ACTION'),
    ('app','attendance','marked_by','attendance_marked_by_fkey','app','users','NO ACTION'),
    ('app','attendance','student_id','attendance_student_id_fkey','app','students','NO ACTION'),
    ('app','cases','opened_by','cases_opened_by_fkey','app','users','NO ACTION'),
    ('app','communications','approved_by','communications_approved_by_fkey','app','users','NO ACTION'),
    ('app','enrollment_history','changed_by','enrollment_history_changed_by_fkey','app','users','NO ACTION'),
    ('app','enrollment_history','student_id','enrollment_history_student_id_fkey','app','students','NO ACTION'),
    ('app','event_action_link','action_id','event_action_link_action_id_fkey','app','actions','NO ACTION'),
    ('app','event_action_link','downstream_event_id','event_action_link_downstream_event_id_fkey','app','events','NO ACTION'),
    ('app','event_action_link','event_id','event_action_link_event_id_fkey','app','events','NO ACTION'),
    ('app','event_action_link','outbox_id','event_action_link_outbox_id_fkey','app','outbox','NO ACTION'),
    ('app','fee_obligations','academic_year_id','fee_obligations_academic_year_id_fkey','app','academic_years','NO ACTION'),
    ('app','fee_obligations','student_id','fee_obligations_student_id_fkey','app','students','NO ACTION'),
    ('app','fee_plan_templates','academic_year_id','fee_plan_templates_academic_year_id_fkey','app','academic_years','NO ACTION'),
    ('app','fee_plans','academic_year_id','fee_plans_academic_year_id_fkey','app','academic_years','NO ACTION'),
    ('app','fee_plans','student_id','fee_plans_student_id_fkey','app','students','NO ACTION'),
    ('app','files','uploader_id','files_uploader_id_fkey','app','users','NO ACTION'),
    ('app','guardians','student_id','guardians_student_id_fkey','app','students','NO ACTION'),
    ('app','migration_rows','source_id','migration_rows_source_id_fkey','app','migration_sources','CASCADE'),
    ('app','notifications','user_id','notifications_user_id_fkey','app','users','NO ACTION'),
    ('app','outbox','event_id','outbox_event_id_fkey','app','events','NO ACTION'),
    ('app','payments','obligation_id','payments_obligation_id_fkey','app','fee_obligations','NO ACTION'),
    ('app','payments','student_id','payments_student_id_fkey','app','students','NO ACTION'),
    ('app','plugins','enabled_by','plugins_enabled_by_fkey','app','users','NO ACTION'),
    ('app','route_stops','route_id','route_stops_route_id_fkey','app','routes','CASCADE'),
    ('app','timetable_slots','period_id','timetable_slots_period_id_fkey','app','timetable_periods','NO ACTION'),
    ('app','timetable_substitutions','assigned_by','timetable_substitutions_assigned_by_fkey','app','users','NO ACTION'),
    ('app','timetable_substitutions','slot_id','timetable_substitutions_slot_id_fkey','app','timetable_slots','NO ACTION'),
    ('app','transport_events','route_id','transport_events_route_id_fkey','app','routes','NO ACTION'),
    ('app','webhook_deliveries','subscription_id','webhook_deliveries_subscription_id_fkey','app','webhook_subscriptions','NO ACTION'),
    ('app','webhook_subscriptions','created_by','webhook_subscriptions_created_by_fkey','app','users','NO ACTION'),
    ('app','wo_events','actor_id','wo_events_actor_id_fkey','app','users','NO ACTION'),
    ('app','wo_events','wo_id','wo_events_wo_id_fkey','app','work_orders','CASCADE'),
    ('app','work_orders','asset_id','work_orders_asset_id_fkey','app','assets','NO ACTION'),
    ('app','work_orders','assigned_to','work_orders_assigned_to_fkey','app','users','NO ACTION'),
    ('app','work_orders','reported_by','work_orders_reported_by_fkey','app','users','NO ACTION'),
    ('curriculum','node','parent_id','node_parent_id_fkey','curriculum','node','NO ACTION'),
    ('curriculum','progress','node_id','progress_node_id_fkey','curriculum','node','NO ACTION'),
    ('family','request_event','request_id','request_event_request_id_fkey','family','request','CASCADE'),
    ('intervention','plan_event','plan_id','plan_event_plan_id_fkey','intervention','plan','NO ACTION'),
    ('library','loan','book_id','loan_book_id_fkey','library','book','NO ACTION'),
    ('library','loan','issued_by','loan_issued_by_fkey','app','users','NO ACTION'),
    ('library','loan','student_id','loan_student_id_fkey','app','students','NO ACTION'),
    ('mastery','evidence','node_id','evidence_node_id_fkey','curriculum','node','NO ACTION'),
    ('mastery','state','node_id','state_node_id_fkey','curriculum','node','NO ACTION'),
    ('plugin_admissions','lead','created_by','lead_created_by_fkey','app','users','NO ACTION'),
    ('plugin_admissions','stage_history','lead_id','stage_history_lead_id_fkey','plugin_admissions','lead','CASCADE'),
    ('plugin_exams','exam','academic_year_id','exam_academic_year_id_fkey','app','academic_years','NO ACTION'),
    ('plugin_exams','mark','exam_id','mark_exam_id_fkey','plugin_exams','exam','NO ACTION'),
    ('plugin_exams','moderation','report_id','moderation_report_id_fkey','plugin_exams','report','NO ACTION'),
    ('plugin_exams','report','exam_id','report_exam_id_fkey','plugin_exams','exam','NO ACTION'),
    ('plugin_razorpay','order_log','payment_id','order_log_payment_id_fkey','app','payments','NO ACTION'),
    ('ptm','booking','slot_id','booking_slot_id_fkey','ptm','slot','NO ACTION'),
    ('support','faq','source_doubt_id','faq_source_doubt_id_fkey','support','doubt','NO ACTION'),
    ('teacher','concern_status_event','concern_id','concern_status_event_concern_id_fkey','teacher','concern','NO ACTION'),
    ('teacher','submission','homework_id','submission_homework_id_fkey','teacher','homework','CASCADE')
  ) AS v(csch, ctbl, ccol, oldname, psch, ptbl, del) LOOP
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I', r.csch, r.ctbl, r.oldname);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.ctbl || '_tenant_' || r.ccol || '_fkey') THEN
      EXECUTE format(
        'ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (tenant_id, %I) '
        || 'REFERENCES %I.%I (tenant_id, id) ON DELETE %s',
        r.csch, r.ctbl, r.ctbl || '_tenant_' || r.ccol || '_fkey', r.ccol,
        r.psch, r.ptbl, r.del);
    END IF;
  END LOOP;
END $$;

-- ── Verification, inside the same transaction ─────────────────────────────────────────────────────────
-- The first version of this check counted constraints whose name matched '%_tenant_%_fkey' and asserted
-- `>= 57`. On the dev database that query returned 72, because it also counted 15 PRE-EXISTING tenant-aligned
-- FKs this file never created — and a threshold already satisfied before the migration runs is not a check
-- that the migration did anything. It now verifies the EXACT list declared above, so a typo'd child column
-- name (which the `IF NOT EXISTS` guard would otherwise swallow as "already done") rolls the file back.
DO $$
DECLARE r record; missing text[] := ARRAY[]::text[];
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('app','actions','decided_by'),
      ('app','api_keys','created_by'),
      ('app','attendance','marked_by'),
      ('app','attendance','student_id'),
      ('app','cases','opened_by'),
      ('app','communications','approved_by'),
      ('app','enrollment_history','changed_by'),
      ('app','enrollment_history','student_id'),
      ('app','event_action_link','action_id'),
      ('app','event_action_link','downstream_event_id'),
      ('app','event_action_link','event_id'),
      ('app','event_action_link','outbox_id'),
      ('app','fee_obligations','academic_year_id'),
      ('app','fee_obligations','student_id'),
      ('app','fee_plan_templates','academic_year_id'),
      ('app','fee_plans','academic_year_id'),
      ('app','fee_plans','student_id'),
      ('app','files','uploader_id'),
      ('app','guardians','student_id'),
      ('app','migration_rows','source_id'),
      ('app','notifications','user_id'),
      ('app','outbox','event_id'),
      ('app','payments','obligation_id'),
      ('app','payments','student_id'),
      ('app','plugins','enabled_by'),
      ('app','route_stops','route_id'),
      ('app','timetable_slots','period_id'),
      ('app','timetable_substitutions','assigned_by'),
      ('app','timetable_substitutions','slot_id'),
      ('app','transport_events','route_id'),
      ('app','webhook_deliveries','subscription_id'),
      ('app','webhook_subscriptions','created_by'),
      ('app','wo_events','actor_id'),
      ('app','wo_events','wo_id'),
      ('app','work_orders','asset_id'),
      ('app','work_orders','assigned_to'),
      ('app','work_orders','reported_by'),
      ('curriculum','node','parent_id'),
      ('curriculum','progress','node_id'),
      ('family','request_event','request_id'),
      ('intervention','plan_event','plan_id'),
      ('library','loan','book_id'),
      ('library','loan','issued_by'),
      ('library','loan','student_id'),
      ('mastery','evidence','node_id'),
      ('mastery','state','node_id'),
      ('plugin_admissions','lead','created_by'),
      ('plugin_admissions','stage_history','lead_id'),
      ('plugin_exams','exam','academic_year_id'),
      ('plugin_exams','mark','exam_id'),
      ('plugin_exams','moderation','report_id'),
      ('plugin_exams','report','exam_id'),
      ('plugin_razorpay','order_log','payment_id'),
      ('ptm','booking','slot_id'),
      ('support','faq','source_doubt_id'),
      ('teacher','concern_status_event','concern_id'),
      ('teacher','submission','homework_id')
    ) AS v(csch, ctbl, ccol) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE con.contype = 'f' AND n.nspname = r.csch AND c.relname = r.ctbl
        AND con.conname = r.ctbl || '_tenant_' || r.ccol || '_fkey'
    ) THEN
      missing := missing || (r.csch || '.' || r.ctbl || '.' || r.ccol);
    END IF;
  END LOOP;
  IF array_length(missing, 1) > 0 THEN
    RAISE EXCEPTION '081: these child references were NOT converted to tenant-aligned FKs: %',
      array_to_string(missing, ', ');
  END IF;
  RAISE NOTICE '081: all 57 declared child references are now tenant-aligned';
END $$;
