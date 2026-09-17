-- 086 · teacher.submission.student_id — repair rows written before 082 constrained the column.
-- Claimed via .coop/help.md (084 is NOT free: 084_settings_pattern_escape.sql is on disk and applied).
--
-- THE DEFECT THIS REPAIRS. `POST /plugins/teacher.classroom/homework/:id/submit` inserted
-- `req.user.id` — an `app.users` id — into `teacher.submission.student_id`. Migration 082 added
--   submission_student_id_ref_fkey FOREIGN KEY (tenant_id, student_id)
--     REFERENCES app.students(tenant_id, id) ON DELETE RESTRICT
-- so from that moment the INSERT raised 23503 on every student submission. The door catches only
-- 23505 (the one-shot UNIQUE), so the violation escaped as HTTP 500 "internal error" and the audit
-- row after the INSERT was unreachable. The application fix is in
-- src/plugins/teacher.classroom/index.js (resolve the signed-in user to an app.students row).
--
-- WHAT THIS FILE DOES ABOUT HISTORY. A database that took submissions BEFORE 082 may still hold
-- rows whose student_id is a user id. Those rows cannot merely be left alone: they are exactly the
-- rows the read paths (join to app.students) can no longer name. Two treatments, chosen so that no
-- academic history is ever silently destroyed:
--
--   1. RESOLVABLE — the stored id is an `app.users` row in the same tenant whose NAME matches
--      exactly one student in a grade, and the homework's class_grade picks that grade. The row is
--      re-keyed to the roster id. This is the same name-match resolution the application now uses,
--      which is deliberate: history must end up keyed the way new rows are keyed, or the teacher's
--      view would show two different kinds of row and the "was the link ever wrong?" question would
--      have two answers. The name used is the USER'S name (`prior_user_name`, recorded), never a
--      caller-supplied one.
--   2. UNRESOLVABLE — no user row, no name match in any grade, or the re-key would land on a
--      student who already has a submission for that homework (UNIQUE(homework_id, student_id)
--      permits only one row, and choosing which child's work to discard is not a migration's
--      decision). The row is MOVED to `teacher.submission_needs_linking`, which preserves every
--      column of the original row plus the raw stored id and the name it was resolved by.
--
-- WHY MOVE RATHER THAN DELETE: a submission is a child's returned work — deleting it would destroy
-- academic evidence to satisfy a constraint, and FKs cannot be deferred past a permanent state.
-- Moving keeps the bytes and makes the problem VISIBLE (it is a queryable table with a `reason`),
-- where deleting would make it invisible. The table is append-only for the app role: no UPDATE or
-- DELETE grant (D-35), so a school can read and act on it but the application cannot quietly
-- discard it.
--
-- IDEMPOTENT by construction: every step is driven by `NOT EXISTS (SELECT 1 FROM app.students ...)`
-- — i.e. it only ever looks at rows whose student_id is NOT a valid roster id in their tenant — and
-- each repaired row leaves that predicate. Re-running on a repaired database touches zero rows.
--
-- A NO-OP ON A FRESH DATABASE, and that matters: `tests/helpers.js` runs migrate → bootstrap → seed,
-- so this file executes while `teacher.submission` is empty and before any user or roster row exists.
-- It must therefore never require seeded data (the lesson 084 learned the hard way): tables are
-- probed with to_regclass, and every statement is a no-op when its input set is empty.

-- ── 1. the holding table (created unconditionally; it is the remedy's record either way) ────────
CREATE TABLE IF NOT EXISTS teacher.submission_needs_linking (
  submission_id      uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL,
  homework_id        uuid NOT NULL REFERENCES teacher.homework(id) ON DELETE CASCADE,
  -- the value that was in student_id: a user id that could not be resolved to a roster row
  prior_student_id   uuid,
  prior_user_name    text,
  content_type       text,
  content            text,
  status             text,
  grade              text,
  feedback           text,
  submitted_at       timestamptz,
  reviewed_by        uuid,
  reviewed_at        timestamptz,
  -- plain-language, machine-readable reason (see the two treatment classes in the header)
  reason             text NOT NULL,
  moved_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS submission_needs_linking_tenant_idx
  ON teacher.submission_needs_linking (tenant_id, moved_at DESC);

COMMENT ON TABLE teacher.submission_needs_linking IS
  'Submissions moved out of teacher.submission by migration 086 because their student_id was a '
  'pre-082 app.users id that could not be mapped to a roster student. Nothing here is deleted — '
  'read it, resolve it against the school''s records, and re-file the work. Append-only for the '
  'application role by design (no UPDATE/DELETE grant).';

-- The app role may read it and add to it (as migrations 009-048 style grants). bootstrap.js revokes
-- and re-grants SELECT/INSERT/UPDATE on schema app tables only, so teacher.* keeps what is stated
-- here; D-35 says the app role never gets table-level DELETE, and it does not.
GRANT SELECT, INSERT ON teacher.submission_needs_linking TO schoolos_app;

-- ── 2. re-key the rows that DO resolve ──────────────────────────────────────────────────────────
DO $$
DECLARE
  r record;
  n_rekeyed int := 0;
  n_moved   int := 0;
BEGIN
  IF to_regclass('teacher.submission') IS NULL
     OR to_regclass('app.students') IS NULL
     OR to_regclass('app.users') IS NULL THEN
    RAISE NOTICE '086: teacher.submission / app.students / app.users absent — nothing to repair';
    RETURN;
  END IF;

  -- ── compute the whole plan FIRST, from one consistent snapshot ────────────────────────────────
  -- This is a materialized CTE (one statement), so every classification below is decided against the
  -- state as it was BEFORE this file changed anything. That is not a stylistic choice: an earlier
  -- draft classified rows inside the loop while the loop was already re-keying and deleting them, so
  -- a row archived at step 3 made a later row's LEFT JOIN resolve to NULL and the later row was
  -- reported as "stored id is not a user" — a WRONG reason recorded in permanent evidence, caused by
  -- the order of the loop. Plan first, then act.
  FOR r IN
    WITH bad AS MATERIALIZED (
      -- rows the FK would reject: student_id is not an app.students id in their own tenant
      SELECT s.id, s.tenant_id, s.homework_id, s.student_id,
             s.content_type, s.content, s.status, s.grade, s.feedback,
             s.submitted_at, s.reviewed_by, s.reviewed_at
      FROM teacher.submission s
      WHERE NOT EXISTS (
        SELECT 1 FROM app.students st WHERE st.tenant_id = s.tenant_id AND st.id = s.student_id)
    ),
    mapped AS MATERIALIZED (
      -- the resolution: stored id → app.users row → same-named roster student, scoped to the
      -- homework's class_grade (the same scope the application's class gate uses). The subquery is
      -- ordered by admission_no — the school's own enrolment order — so a name that repeats within a
      -- grade resolves the same way every run, mirroring `resolveStudent` in the plugin.
      SELECT b.*, u.name AS prior_user_name,
             (SELECT st.id FROM app.students st
               WHERE st.tenant_id = b.tenant_id
                 AND lower(st.name) = lower(u.name)
                 AND st.grade = h.class_grade
               ORDER BY st.admission_no ASC, st.id ASC
               LIMIT 1) AS target_student,
             (SELECT count(*) FROM app.students st3
               WHERE st3.tenant_id = b.tenant_id AND lower(st3.name) = lower(u.name)) AS matches_any_grades,
             -- `committed_row_id` answers a DIFFERENT question from the batch view below: "does the
             -- target student already hold a REAL submission on this homework?" Non-null ⇒ that
             -- child's work is already on file, so this bad row must not compete with it.
             (SELECT min(s2.id::text)::uuid FROM teacher.submission s2
               WHERE s2.homework_id = b.homework_id
                 AND EXISTS (SELECT 1 FROM app.students st2
                              WHERE st2.id = s2.student_id AND st2.tenant_id = b.tenant_id
                                AND lower(st2.name) = lower(u.name)
                                AND st2.grade = h.class_grade)) AS committed_row_id
      FROM bad b
      LEFT JOIN app.users u ON u.id = b.student_id AND u.tenant_id = b.tenant_id
      LEFT JOIN teacher.homework h ON h.id = b.homework_id AND h.tenant_id = b.tenant_id
    ),
    claimed AS MATERIALIZED (
      -- Several bad rows on ONE homework can map to the SAME roster student (possible where those
      -- rows carry distinct USER ids, which is exactly why the UNIQUE(homework_id, student_id) index
      -- is no obstacle between them). Only one may keep the pair; the earliest submission wins and
      -- the rest are archived, deterministically (submitted_at, then id).
      SELECT m.id, m.target_student,
             row_number() OVER (PARTITION BY m.homework_id, m.target_student
                                ORDER BY m.submitted_at ASC, m.id ASC) AS claim_rank
      FROM mapped m
      WHERE m.target_student IS NOT NULL AND m.committed_row_id IS NULL
    )
    SELECT m.id, m.tenant_id, m.homework_id, m.student_id AS prior_student_id,
           m.content_type, m.content, m.status, m.grade, m.feedback,
           m.submitted_at, m.reviewed_by, m.reviewed_at,
           m.prior_user_name, m.target_student,
           CASE
             WHEN m.prior_user_name IS NULL THEN 'stored_id_is_not_a_user_in_this_tenant'
             WHEN m.matches_any_grades = 0 THEN 'no_student_with_this_name'
             WHEN m.target_student IS NULL THEN 'name_not_in_homework_grade'
             WHEN m.committed_row_id IS NOT NULL THEN 'roster_student_already_has_a_submission'
             WHEN c.claim_rank > 1 THEN 'roster_student_already_has_a_submission'
             ELSE 'resolvable'
           END AS disposition
    FROM mapped m
    LEFT JOIN claimed c ON c.id = m.id
    WHERE NOT EXISTS (SELECT 1 FROM teacher.submission_needs_linking a WHERE a.submission_id = m.id)
  LOOP
    IF r.disposition = 'resolvable' AND r.target_student IS NOT NULL THEN
      UPDATE teacher.submission SET student_id = r.target_student WHERE id = r.id;
      n_rekeyed := n_rekeyed + 1;
    ELSE
      INSERT INTO teacher.submission_needs_linking (
        submission_id, tenant_id, homework_id, prior_student_id, prior_user_name,
        content_type, content, status, grade, feedback, submitted_at, reviewed_by, reviewed_at, reason)
      VALUES (r.id, r.tenant_id, r.homework_id, r.prior_student_id, r.prior_user_name,
              r.content_type, r.content, r.status, r.grade, r.feedback, r.submitted_at,
              r.reviewed_by, r.reviewed_at, r.disposition)
      ON CONFLICT (submission_id) DO NOTHING;
      -- only remove the original once the archive row is definitely there
      DELETE FROM teacher.submission
       WHERE id = r.id
         AND EXISTS (SELECT 1 FROM teacher.submission_needs_linking a WHERE a.submission_id = r.id);
      n_moved := n_moved + 1;
    END IF;
  END LOOP;

  RAISE NOTICE '086: re-keyed % submission(s) to their roster student, moved % to teacher.submission_needs_linking',
    n_rekeyed, n_moved;
END $$;

-- ── 3. try to VALIDATE the FK, but never fail the migration over rows this file cannot fix ──────
-- 082 created the constraint (the live catalogue shows convalidated = true, so it was created on a
-- table that satisfied it). If a database somehow still holds an unrepairable row, the honest state
-- is "constraint still NOT VALID + a row sitting in submission_needs_linking", not a migration that
-- aborts every fresh database. WARNING, not exception — and the next run retries.
DO $$
BEGIN
  IF to_regclass('teacher.submission') IS NOT NULL
     AND EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'teacher.submission'::regclass
                    AND conname = 'submission_student_id_ref_fkey' AND NOT convalidated) THEN
    BEGIN
      ALTER TABLE teacher.submission VALIDATE CONSTRAINT submission_student_id_ref_fkey;
      RAISE NOTICE '086: validated submission_student_id_ref_fkey';
    EXCEPTION WHEN foreign_key_violation THEN
      RAISE WARNING '086: submission_student_id_ref_fkey still has rows it cannot validate — see teacher.submission_needs_linking';
    END;
  END IF;
END $$;
