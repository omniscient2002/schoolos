-- 113 · TEACHER / PARENT / STUDENT — security & integrity hardening
--        (TEACHER-PARENT-STUDENT-PERFECT-100 SEC-1…5, DAT-3).
--
-- 039 over-granted UPDATE on teacher.concern_status_event, breaking the append-only
-- invariant 032 declared and the teacher.support manifest still advertises. This file
-- restores it and adds the remaining DB-layer guarantees the register asks for:
--   SEC-1 · concern_status_event is append-only again (no UPDATE).
--   SEC-2 · FORCE ROW LEVEL SECURITY on every teacher/family/parent/student table
--           (102 set the precedent for submission_needs_linking).
--   SEC-3 · student.print_job gains a RESTRICTIVE owner-scope policy: a student sees
--           only their own jobs at the DATABASE layer; the staff print queue/discharge
--           doors are explicitly allowed by role (the only sanctioned cross-user read).
--   SEC-4 · family.request status is append-only: a BEFORE UPDATE guard refuses any
--           status change that did not come through the transition door (or the kernel
--           child-leave executor) and refuses illegal state-machine jumps.
--   SEC-5/DAT-3 · family.child_link gains DELETE so the new staff link-management
--           door can unbind a guardian (the table was write-only by grant omission).
--
-- All statements are idempotent (IF EXISTS / CREATE OR REPLACE) and safe to replay.

-- ── helper: the request transaction's effective role, NULL-normalised (074 pattern) ──
CREATE OR REPLACE FUNCTION app.current_role() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE AS
$fn$ SELECT NULLIF(current_setting('schoolos.role', true), '') $fn$;
COMMENT ON FUNCTION app.current_role() IS
  'Effective role for the transaction (schoolos.role GUC). NULL when unset/empty.';
GRANT EXECUTE ON FUNCTION app.current_role() TO schoolos_app;

-- ── SEC-1: concern history is append-only ──────────────────────────────────────────
-- 032 granted SELECT + INSERT only; 039 widened it to UPDATE so the route/outcome doors
-- could use SELECT … FOR UPDATE. That is a lock, not a write — the UPDATE privilege was
-- never needed and let the app role rewrite concern history. Revoke it.
REVOKE UPDATE ON teacher.concern_status_event FROM schoolos_app;

-- ── SEC-2: FORCE ROW LEVEL SECURITY on every domain table ──────────────────────────
-- ENABLE already applied everywhere; FORCE additionally subjects the table OWNER to the
-- policies (the owner carries BYPASSRLS today, so this is belt-and-braces — but it makes
-- the guarantee a property of the table, not of a role attribute that could be changed).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'teacher.homework','teacher.submission','teacher.leave_request',
    'teacher.concern','teacher.concern_status_event','teacher.note',
    'teacher.submission_needs_linking',
    'safety.box','support.doubt','support.faq',
    'intervention.plan','intervention.plan_event',
    'ptm.slot','ptm.booking',
    'curriculum.node','curriculum.progress','mastery.evidence','mastery.state','copilot.call',
    'coord.copilot_call','duty.assignment',
    'family.child_link','family.request','family.request_event','family.consent',
    'parent.copilot_call','parent.brief_log',
    'student.mistake_note','student.flashcard','student.study_task',
    'student.print_job','student.wellbeing_request'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
               WHERE n.nspname = split_part(t, '.', 1) AND c.relname = split_part(t, '.', 2)
                 AND c.relkind = 'r') THEN
      EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;

-- ── SEC-3: student.print_job owner-scope at the database layer ─────────────────────
-- The three study tables (036) already carry a RESTRICTIVE owner policy. print_job was
-- declared user-owned but relied on a WHERE clause alone. Staff must still read the whole
-- tenant's queue and discharge jobs, so the policy admits the print-staff roles by the
-- server-set schoolos.role GUC (a student can never set it) and pins everyone else to
-- their own creator_user_id.
CREATE OR REPLACE FUNCTION app.is_print_staff() RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE AS
$fn$ SELECT app.current_role() IN ('teacher','coordinator','principal','owner','itadmin') $fn$;
COMMENT ON FUNCTION app.is_print_staff() IS
  'Print-staff roles for the school-controlled print queue (student.world STAFF set).';
GRANT EXECUTE ON FUNCTION app.is_print_staff() TO schoolos_app;

DROP POLICY IF EXISTS print_job_owner ON student.print_job;
CREATE POLICY print_job_owner ON student.print_job AS RESTRICTIVE
  USING (app.is_print_staff() OR creator_user_id = app.current_user_id()::uuid)
  WITH CHECK (app.is_print_staff() OR creator_user_id = app.current_user_id()::uuid);

-- ── SEC-4: family.request status is append-only (transition guard) ─────────────────
-- The door and the kernel child-leave executor mark the transaction with
-- `schoolos.family_request_transition = 'on'`; any other UPDATE that changes the status
-- is refused. Illegal state-machine jumps are refused too. (Defence in depth: the guard
-- stops a direct/naive write, not a determined role that also sets the marker.)
CREATE OR REPLACE FUNCTION family.request_transition_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF current_setting('schoolos.family_request_transition', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'family.request status is append-only — use the request transition door'
        USING ERRCODE = '42501';
    END IF;
    IF NOT (
      (OLD.status = 'submitted'      AND NEW.status IN ('received','assigned','in_progress','waiting_parent','resolved','closed')) OR
      (OLD.status = 'received'       AND NEW.status IN ('assigned','in_progress','waiting_parent','resolved','closed')) OR
      (OLD.status = 'assigned'       AND NEW.status IN ('in_progress','waiting_parent','resolved','closed')) OR
      (OLD.status = 'in_progress'    AND NEW.status IN ('waiting_parent','resolved','closed')) OR
      (OLD.status = 'waiting_parent' AND NEW.status IN ('in_progress','resolved','closed')) OR
      (OLD.status = 'resolved'       AND NEW.status = 'closed')
    ) THEN
      RAISE EXCEPTION 'illegal family.request transition: % -> %', OLD.status, NEW.status
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS request_transition_guard ON family.request;
CREATE TRIGGER request_transition_guard BEFORE UPDATE ON family.request
  FOR EACH ROW EXECUTE FUNCTION family.request_transition_guard();

-- ── SEC-5 / DAT-3: child_link is bindable and unbindable by school authority ────────
GRANT DELETE ON family.child_link TO schoolos_app;
