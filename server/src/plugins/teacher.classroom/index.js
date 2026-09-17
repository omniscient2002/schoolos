// teacher.classroom — runtime module (migration 031, TeacherOS lane TS-1 retry).
// Homework desk: teachers post, students submit once, the assigning teacher reviews.
// Design invariants:
//   · TEACHER SCOPING — a teacher sees ONLY homework rows with created_by = self
//     (`mine=1` list + every door). The inbox and review desk belong to the assigning
//     teacher alone; another teacher's homework id is 404 with no data in the error.
//   · STUDENTS CAN ONLY SUBMIT — no student door reads anything but their own
//     submissions; the row is always filed against the SIGNED-IN student's own roster
//     row (no picker, no body override — the privacy pin). `student_id` therefore holds
//     an `app.students` id, not the `app.users` id it used to hold: 082 constrained the
//     column to `app.students(tenant_id, id)`, and the pre-082 write made every submit a
//     23503 → HTTP 500. UNIQUE(homework_id, student_id) is the structural
//     one-shot guarantee: the SAVEPOINT rethrow pattern turns the 23505 into a plain
//     409 ("resubmission is requested by your teacher, not allowed here").
//   · LATE IS DECIDED AT INSERT — submitted_at > due_at ⇒ status 'late', stamped once;
//     review later moves it to reviewed/graded (keeping the late fact in submitted_at).
//   · STAFF LEAVE (this is TEACHER self leave — family.view 034 owns CHILD leave) —
//     raises the per-instance kernel action teacher.leave.<requestId> (UNIQUE(tenant,code)
//     from birth, cycle-5 P1-1). The coordinator approves/dismisses on the kernel
//     /actions/:id/decide door; /teacher/leave/mine mirrors the kernel decision into
//     teacher.leave_request so the teacher sees the outcome.
import { makeLifecycleGate } from '../_shared/lifecycle-gate.js';
import { uuidParams } from '../_shared/uuid-param.js';
import { requestAudit } from '../../audit.js';

const ID = 'teacher.classroom';
export { default as manifest } from './manifest.js';

const TEACHER = ['teacher'];
const STUDENT = ['student'];
const REVIEW_STATUSES = ['reviewed', 'graded', 'resubmit_requested'];
const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

// Attachment hardening (server-hardening lane): attachment_ref is stored verbatim
// and is a future render-as-link surface for students. The Homework UI contract is
// "a file name or link" — so accept plain names and http(s) URLs ONLY, and refuse
// every other scheme (javascript:/data:/vbscript: stored-XSS vehicles), protocol-
// relative "//host" links and control-character payloads. Invalid ⇒ 400, not silent.
// ── user → roster student resolution ───────────────────────────────────────────
// `teacher.submission.student_id` holds an `app.students` id (082_reference_integrity.sql:
// submission_student_id_ref_fkey → app.students(tenant_id, id) ON DELETE RESTRICT), so the
// write path must RESOLVE the signed-in user to a roster row instead of storing the user id.
//
// HOW, AND WHY IT IS DONE THIS WAY. There is no structural link from `app.users` to
// `app.students`: no FK, no shared column, no students.user_id. The only correspondence that
// exists in this database is the NAME (verified against the live dev DB and the test seed: the
// user `student@meridian.edu` is named `Aarav Sharma` and the roster carries exactly one
// `Aarav Sharma`; `student2@meridian.edu` is `Diya Nair`). The class gate below already resolved
// the student that way — it is the 034 `child_link` name-match convention this module inherited —
// so resolving the id the same way is the one choice that keeps the WRITE and the READS
// consistent instead of inventing a third rule.
//
// THE WEAKNESS, STATED PLAINLY (do not paper over it): a name is not an identity. This resolution
// cannot distinguish two students who share a name, and the seed shows that is not hypothetical —
// `Diya Nair` has three grade-8 rows (sections A, B and C) and the roster carries 125 such
// (name, grade) groups. Scoping to the homework's `class_grade` narrows it but does not make it
// unique, so when several same-name students sit in the homework's grade we take the LOWEST
// `admission_no` — the school's own registration order, i.e. the first-enrolled child. That is a
// deterministic, auditable tiebreak, not a correct identification: for a duplicate name the
// submission may be attributed to the wrong section-sibling. Nobody can do better from these two
// tables; the structural repair is a `students.user_id` column backfilled at provisioning, or an
// explicit link row, and the teacher roster is the authority meanwhile. Every query is scoped by
// `tenant_id` so the weakness can never cross a school boundary.
const STUDENT_BY_NAME_SQL =
  `SELECT id, name, grade, section, admission_no FROM app.students
   WHERE tenant_id = $1 AND lower(name) = lower($2)`;

// Resolve the signed-in student user to a roster row. `grade` (the homework's class_grade) is the
// deciding scope, exactly as the class gate has always been. Returns the row, or null.
async function resolveStudent(c, tenantId, userName, grade) {
  const rows = (await c.query(
    `${STUDENT_BY_NAME_SQL} AND grade = $3
     ORDER BY admission_no ASC, id ASC LIMIT 1`,
    [tenantId, userName, grade])).rows;
  return rows[0] ?? null;
}

// Does a roster row exist for this name in ANY grade? Distinguishes the two data faults the submit
// door must report honestly: "your login is linked to no student at this school" (nothing matches
// the name anywhere ⇒ provisioning problem) versus "this homework is for another class" (the name
// exists, but not in this homework's grade ⇒ the class gate's existing business rule).
const STUDENT_IN_CLASS_SQL =
  `SELECT count(*)::int AS n FROM app.students
   WHERE tenant_id = $1 AND lower(name) = lower($2) AND grade = $3`;

const safeAttachmentRef = (raw) => {
  if (raw == null) return { ok: true, value: null };
  const s = String(raw).trim();
  if (!s) return { ok: true, value: null };
  if (s.length > 500) return { ok: false };
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    try {
      const u = new URL(s); // throws on garbage; normalizes/validates the scheme
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false };
    } catch { return { ok: false }; }
  } else if (s.startsWith('//')) return { ok: false };
  if (/[\u0000-\u001f\u007f]/.test(s)) return { ok: false };
  return { ok: true, value: s };
};

export function register(app, kernel) {
  const { withUser, requestAudit, emitEvent, require, sysq } = kernel;
  const lifecycleGate = makeLifecycleGate(sysq, ID);

  // ── teacher posts homework (audited) ───────────────────────────────────────
  app.post('/plugins/teacher.classroom/homework', { preHandler: [require(...TEACHER), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.class_grade || !String(b.class_grade).trim()) return bad(reply, 'Choose the class this homework is for');
    if (!b.subject || !String(b.subject).trim()) return bad(reply, 'Choose the subject');
    if (!b.title || !String(b.title).trim()) return bad(reply, 'Please add a short title');
    if (!b.due_at || Number.isNaN(new Date(b.due_at).getTime())) return bad(reply, 'Pick a due date and time');
    const attach = safeAttachmentRef(b.attachment_ref ?? b.attachment);
    if (!attach.ok) return bad(reply, 'That attachment isn\'t allowed — paste a plain file name or an http(s) link');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const row = (await c.query(
        `INSERT INTO teacher.homework (tenant_id, class_grade, subject, title, detail, attachment_ref, due_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, class_grade, subject, title, due_at, status, created_at`,
        [req.user.tenant_id, String(b.class_grade).slice(0, 20), String(b.subject).slice(0, 60), String(b.title).slice(0, 200),
         b.detail ? String(b.detail).slice(0, 4000) : null, attach.value,
         new Date(b.due_at).toISOString(), req.user.id])).rows[0];
      await emitEvent(c, req.user.tenant_id, { type: 'classroom', label: `Homework posted: ${b.subject} — ${String(b.title).slice(0, 80)}`, ref: row.id },
        'homework.v1', { homeworkId: row.id, classGrade: row.class_grade, subject: row.subject, dueAt: row.due_at, createdBy: req.user.id });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Homework posted', recordType: 'Homework', recordRef: row.id,
        reason: `${row.subject} · ${row.class_grade}`, policyRef: 'TEACHEROS-PLAN · classroom homework', risk: 'low',
        outcome: `due ${row.due_at}` });
      return { ok: true, homeworkId: row.id, homework: row };
    });
  });

  // ── teacher lists OWN homework (privacy pin: created_by = self) ────────────
  app.get('/plugins/teacher.classroom/homework', { preHandler: [require(...TEACHER), lifecycleGate] }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // `mine=1` is the explicit contract; the pin is unconditional — created_by = self
      const rows = (await c.query(
        `SELECT h.id, h.class_grade, h.subject, h.title, h.detail, h.attachment_ref, h.due_at, h.status, h.created_at,
           (SELECT count(*)::int FROM teacher.submission s WHERE s.homework_id = h.id) AS submission_count
         FROM teacher.homework h
         WHERE h.created_by = $1
         ORDER BY h.due_at ASC LIMIT 100`, [req.user.id])).rows;
      return { homework: rows, scope: 'mine' };
    });
  });

  // ── teacher opens one OWN homework with its submissions ────────────────────
  app.get('/plugins/teacher.classroom/homework/:id', { preHandler: [require(...TEACHER), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const hw = (await c.query(
        `SELECT id, class_grade, subject, title, detail, attachment_ref, due_at, status, created_at
         FROM teacher.homework WHERE id=$1 AND created_by=$2`,
        [req.params.id, req.user.id])).rows[0];
      if (!hw) return bad(reply, 'We couldn\'t find that homework', 404);
      // submissions key an `app.students` row (the 082 FK), so the name rides THAT row — the join
      // this used to make against `app.users su ON su.id = s.student_id` could only ever resolve
      // while the write was storing a user id, and it returned NULL the moment the column held
      // what it is named for. Both sides are tenant-scoped through the composite FK columns.
      const subs = (await c.query(
        `SELECT s.id, s.student_id, s.content_type, s.status, s.grade, s.feedback, s.submitted_at, s.reviewed_at,
           st.name AS student_name
         FROM teacher.submission s
         LEFT JOIN app.students st ON st.id = s.student_id AND st.tenant_id = s.tenant_id
         WHERE s.homework_id=$1 ORDER BY s.submitted_at DESC`, [req.params.id])).rows;
      return { homework: hw, submissions: subs };
    });
  });

  // ── student submits (one-shot; late decided at insert) ─────────────────────
  app.post('/plugins/teacher.classroom/homework/:id/submit', { preHandler: [require(...STUDENT), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!['text', 'link'].includes(b.content_type)) return bad(reply, 'Submit your work as text or a link');
    if (!b.content || !String(b.content).trim()) return bad(reply, 'Your submission is empty — add your work first');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const hw = (await c.query(
        `SELECT id, title, subject, class_grade, due_at, status FROM teacher.homework WHERE id=$1 AND status='open'`,
        [req.params.id])).rows[0];
      if (!hw) return bad(reply, 'We couldn\'t find that homework', 404);
      // RT-7 #3: class gate — homework belongs to one class, and the submission must be stored
      // against the SUBMITTING STUDENT'S ROSTER ROW, not the submitting USER's row.
      //
      // This gate used to prove only that *a* roster student carried the submitter's name in the
      // homework's grade, and the INSERT then wrote `req.user.id` — a user id — into a column
      // 082 had already constrained to `app.students(tenant_id, id)`. Every student submission
      // raised 23503, the door caught only 23505, and the caller got a 500 "internal error" with
      // the audit row unreachable. The gate and the write now share ONE resolution
      // (`resolveStudent`) so they cannot disagree again: the class the gate approves is the
      // class the row is filed under.
      //
      // Fail CLOSED and CLEANLY. A student whose name matches no roster row is a data problem the
      // school must see — an account that can sign in but belongs to no child — not an "internal
      // error" and not a silently missing submission. It is a 409 with plain language, never a 500.
      // The two branches are kept distinct on purpose: "not in this class" is the homework's own
      // rule (existing behaviour, existing copy), while "not linked to any student" is about the
      // ACCOUNT and is the case that must not be mistaken for a wrong-class refusal.
      const inClass = (await c.query(STUDENT_IN_CLASS_SQL,
        [req.user.tenant_id, req.user.name, hw.class_grade])).rows[0].n;
      if (inClass === 0) {
        const anywhere = (await c.query(
          `SELECT count(*)::int AS n FROM app.students WHERE tenant_id=$1 AND lower(name)=lower($2)`,
          [req.user.tenant_id, req.user.name])).rows[0].n;
        if (anywhere === 0) {
          return bad(reply, 'Your login isn\'t linked to a student at this school, so this homework can\'t be filed against you — please ask the school office to link your account', 409);
        }
        return bad(reply, 'This homework is for a different class');
      }
      const student = await resolveStudent(c, req.user.tenant_id, req.user.name, hw.class_grade);
      if (!student) {
        // Unreachable while the two queries above agree, and that is the point: if they ever
        // diverge we refuse loudly rather than fall back to the user id (which is how this
        // regression happened) or to a 500 (which hides it).
        return bad(reply, 'We couldn\'t match your login to a student record for this class — please ask the school office to check your account', 409);
      }
      const late = new Date() > new Date(hw.due_at);
      await c.query('SAVEPOINT submit_once');
      try {
        await c.query(
          `INSERT INTO teacher.submission (tenant_id, homework_id, student_id, content_type, content, status, submitted_at)
           VALUES ($1,$2,$3,$4,$5,$6, now())`,
          [req.user.tenant_id, hw.id, student.id, b.content_type, String(b.content).slice(0, 8000), late ? 'late' : 'submitted']);
      } catch (e) {
        await c.query('ROLLBACK TO SAVEPOINT submit_once');
        if (e.code === '23505') return bad(reply, 'Already submitted — resubmission is requested by your teacher, not allowed here', 409);
        throw e;
      }
      await c.query('RELEASE SAVEPOINT submit_once');
      const sub = (await c.query(
        `SELECT id, status, submitted_at FROM teacher.submission WHERE homework_id=$1 AND student_id=$2`,
        [hw.id, student.id])).rows[0];
      await emitEvent(c, req.user.tenant_id, { type: 'classroom', label: `Homework submitted: ${hw.subject} — ${hw.title.slice(0, 60)}${late ? ' (late)' : ''}`, ref: sub.id },
        'submission.v1', { submissionId: sub.id, homeworkId: hw.id, studentId: student.id, status: sub.status });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Homework submitted', recordType: 'Submission', recordRef: sub.id,
        reason: hw.title.slice(0, 80), policyRef: 'TEACHEROS-PLAN · one-shot submissions', risk: 'low',
        outcome: `status ${sub.status}` });
      return { ok: true, submissionId: sub.id, status: sub.status, submittedAt: sub.submitted_at };
    });
  });

  // ── assigning-teacher review desk ──────────────────────────────────────────
  app.post('/plugins/teacher.classroom/submissions/:id/review', { preHandler: [require(...TEACHER), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!REVIEW_STATUSES.includes(b.status)) return bad(reply, 'Review must set the work as reviewed, graded, or ask for a resubmission');
    if (b.grade != null && b.status !== 'graded') return bad(reply, 'A grade can only be recorded when the work is marked graded');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // fetch WITHOUT the owner filter first: a colleague's submission must answer 403
      // "assigning teacher only" (the pin), never a dataless 404 that hides the rule
      const row = (await c.query(
        `SELECT s.id, s.status, s.homework_id, s.student_id, h.title, h.subject, h.created_by
         FROM teacher.submission s JOIN teacher.homework h ON h.id = s.homework_id
         WHERE s.id=$1 FOR UPDATE OF s`,
        [req.params.id])).rows[0];
      if (!row) return bad(reply, 'We couldn\'t find that submission', 404);
      if (row.created_by !== req.user.id)
        return bad(reply, 'Only the teacher who assigned this homework can review it', 403);
      if (b.grade != null && b.status === 'graded' && String(b.grade).trim() === '')
        return bad(reply, 'Add the grade you want to record, or leave it out');
      const upd = await c.query(
        `UPDATE teacher.submission SET status=$2, grade=$3, feedback=$4, reviewed_by=$5, reviewed_at=now()
         WHERE id=$1 RETURNING status, reviewed_at`,
        [row.id, b.status, b.grade != null ? String(b.grade).slice(0, 20) : null,
         b.feedback ? String(b.feedback).slice(0, 2000) : null, req.user.id]);
      if (upd.rowCount !== 1) return bad(reply, 'This submission could not be updated', 409);
      await emitEvent(c, req.user.tenant_id, { type: 'classroom', label: `Homework reviewed: ${row.subject} — ${row.title.slice(0, 60)} → ${b.status}`, ref: row.id },
        'submission.v1', { submissionId: row.id, homeworkId: row.homework_id, status: b.status, reviewedBy: req.user.id });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: `Submission reviewed (${b.status})`, recordType: 'Submission', recordRef: row.id,
        reason: row.title.slice(0, 80), policyRef: 'TEACHEROS-PLAN · assigning-teacher review', risk: 'medium',
        outcome: `status ${b.status}` });
      return { ok: true, submissionId: row.id, status: upd.rows[0].status, reviewedAt: upd.rows[0].reviewed_at };
    });
  });

  // ── teacher inbox (state filter; own homework only) ────────────────────────
  app.get('/plugins/teacher.classroom/submissions', { preHandler: [require(...TEACHER), lifecycleGate] }, async (req, reply) => {
    const state = req.query?.state ?? 'pending';
    if (!['pending', 'reviewed', 'late', 'missing'].includes(state))
      return bad(reply, 'Pick a view: pending, reviewed, late or missing');
      return withUser(req.user.tenant_id, req.user.role, async (c) => {
      let rows;
      if (state === 'missing') {
        // roster students of the class whose due date passed with no submission on file.
        //
        // PRESENCE vs ATTRIBUTION — two different questions, answered differently on purpose.
        // The write now stores a ROSTER id, so the primary test here is a plain id comparison and is
        // exact. But the roster cannot distinguish same-named children — this seed has 25 name groups
        // with one child in each of sections A, B and C of a grade — while the submitter's login can
        // only resolve to ONE of them (`resolveStudent`, lowest admission_no). An id-only anti-join
        // then lists the OTHER namesakes as missing although the class's work is in, which is a false
        // alarm that sends a teacher chasing work that already exists. The previous code was
        // name-aware here for exactly that reason, so the name clause is KEPT, scoped to the same
        // grade. The trade a school actually sees: a namesake who truly did not submit is not flagged
        // individually. That is a false NEGATIVE — the safe direction for an absence check, and the
        // one this inbox already promised ("the student who submitted is never missing"). The
        // structural fix for both directions is a real `students.user_id` link (see resolveStudent),
        // not a cleverer query: no amount of SQL recovers which section-sibling signed in.
        rows = (await c.query(
          `SELECT h.id AS homework_id, h.title, h.subject, h.class_grade, h.due_at,
             st.id AS student_id, st.name AS student_name
           FROM teacher.homework h
           JOIN app.students st ON st.grade = h.class_grade AND st.tenant_id = h.tenant_id
           WHERE h.created_by = $1 AND h.status='open' AND h.due_at < now()
             AND NOT EXISTS (
               SELECT 1 FROM teacher.submission s
               LEFT JOIN app.students ss ON ss.id = s.student_id AND ss.tenant_id = s.tenant_id
               WHERE s.homework_id = h.id
                 AND (s.student_id = st.id
                      OR (ss.grade = st.grade AND lower(ss.name) = lower(st.name))))
           ORDER BY h.due_at ASC, st.name ASC LIMIT 200`, [req.user.id])).rows;
      } else {
        const where = state === 'pending' ? `s.status IN ('submitted','late')`
          : state === 'reviewed' ? `s.status IN ('reviewed','graded')`
          : `s.status = 'late'`;
        rows = (await c.query(
          `SELECT h.id AS homework_id, h.title, h.subject, h.class_grade, h.due_at,
             s.id AS submission_id, s.student_id, s.status, s.submitted_at, st.name AS student_name
           FROM teacher.homework h
           JOIN teacher.submission s ON s.homework_id = h.id
           LEFT JOIN app.students st ON st.id = s.student_id AND st.tenant_id = s.tenant_id
           WHERE h.created_by = $1 AND ${where}
           ORDER BY h.due_at ASC, s.submitted_at DESC LIMIT 200`, [req.user.id])).rows;
      }
      return { state, submissions: rows };
    });
  });

  // ── staff leave (teacher SELF — family.view owns child leave) ─────────────
  app.post('/teacher/leave', { preHandler: [require(...TEACHER), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    const KINDS = ['sick', 'casual', 'earned', 'duty', 'comp_off', 'other'];
    if (!KINDS.includes(b.kind)) return bad(reply, 'Choose the leave type: sick, casual, earned, duty, comp-off or other');
    if (!isDate(b.from_date) || !isDate(b.to_date)) return bad(reply, 'Pick the first and last day of your leave');
    if (!b.reason || !String(b.reason).trim()) return bad(reply, 'Please add a short reason');
    if (b.to_date < b.from_date) return bad(reply, 'The last day cannot be before the first day');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const row = (await c.query(
        `INSERT INTO teacher.leave_request (tenant_id, teacher_id, kind, from_date, to_date, reason)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, status`,
        [req.user.tenant_id, req.user.id, b.kind, b.from_date, b.to_date, String(b.reason).slice(0, 1000)])).rows[0];
      const actionId = (await c.query(
        `INSERT INTO app.actions (tenant_id, code, kind, title, detail, why, priority, status, owner, owner_role, policy_ref, ai_involved, source_event, payload)
         VALUES ($1,$2,'approval',$3,$4,$5,'normal','open','Coordinator','coordinator','TEACHEROS-PLAN · staff leave via kernel approval',false,$6,$7::jsonb)
         RETURNING id`,
        [req.user.tenant_id, `teacher.leave.${row.id}`,
         `Staff leave: ${req.user.name} (${b.kind}, ${b.from_date} → ${b.to_date})`,
         String(b.reason).slice(0, 300),
         'teacher-filed self leave — coordinator decides; approval never edits a roster row directly',
         row.id,
         JSON.stringify({ kind: 'task', leaveRequestId: row.id, teacherId: req.user.id, proposed_by: req.user.id })])).rows[0].id;
      await emitEvent(c, req.user.tenant_id, { type: 'classroom', label: `Staff leave requested — ${req.user.name} (${b.kind})`, ref: row.id },
        'staff.leave.requested.v1', { requestId: row.id, teacherId: req.user.id, actionId, kind: b.kind, fromDate: b.from_date, toDate: b.to_date });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Staff leave requested', recordType: 'TeacherLeaveRequest', recordRef: row.id,
        reason: b.kind, policyRef: 'TEACHEROS-PLAN · staff leave · kernel approval', risk: 'low',
        outcome: `kernel action ${actionId} raised` });
      return { ok: true, requestId: row.id, actionId, note: 'The coordinator will review this. Track it in My leave.' };
    });
  });

  app.get('/teacher/leave/mine', { preHandler: [require(...TEACHER), lifecycleGate] }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const rows = (await c.query(
        `SELECT r.id, r.kind, r.from_date, r.to_date, r.reason, r.status, r.decided_at, r.note,
           a.status AS action_status, a.decision_note, a.decided_by AS action_decided_by, a.decided_at AS action_decided_at
         FROM teacher.leave_request r
         LEFT JOIN app.actions a ON a.code = 'teacher.leave.' || r.id::text
         WHERE r.teacher_id=$1 ORDER BY r.created_at DESC LIMIT 50`, [req.user.id])).rows;
      // mirror the kernel decision into the row (idempotent; the action row is the truth)
      //
      // DAT-6 — this projection CHANGED a teacher's leave record (pending → approved/rejected) and it
      // did so inside a GET, writing no ledger row. Two things were wrong; both are addressed, and the
      // second is documented rather than silently tolerated:
      //   · The state change was invisible. "Who changed this leave request, when, and on what
      //     authority" is a question the ledger exists to answer, and it could not.
      //   · A GET with side effects sits OUTSIDE the CSRF model — mutating doors are token-checked,
      //     while a GET is reachable from any page. That is tolerable HERE for a specific reason: the
      //     write is a DERIVED PROJECTION of an app.actions row that an authorised human already
      //     decided, so an attacker forcing this request can only apply a decision that already
      //     exists, and every UPDATE is guarded by `AND status='pending'` (idempotent). The reasoning
      //     is recorded so the next reader does not have to re-derive it — and so this pattern is not
      //     copied into a door where a caller-supplied payload decides the outcome.
      const mirrored = [];
      for (const r of rows) {
        const to = r.status === 'pending' && r.action_status === 'approved' ? 'approved'
          : r.status === 'pending' && r.action_status === 'dismissed' ? 'rejected' : null;
        if (!to) continue;
        const u = await c.query(
          `UPDATE teacher.leave_request SET status=$2, decided_by=$3, decided_at=COALESCE($4, now())
            WHERE id=$1 AND status='pending'`,
          [r.id, to, r.action_decided_by, r.action_decided_at]);
        if (u.rowCount === 1) mirrored.push({ id: r.id, to });
      }
      // Audited only for transitions that ACTUALLY happened (rowCount 1). This handler runs on every
      // poll of the teacher's leave screen, so an unconditional row would bury the ledger in noise and
      // make exactly the evidence it is meant to preserve harder to find. One row per real state change
      // is the correct granularity — and it is why the update is checked rather than assumed.
      for (const m of mirrored) {
        await requestAudit(c, req.user.tenant_id, ID, {
          actor: 'system', action: 'Leave decision projected onto request', recordType: 'LeaveRequest',
          recordRef: m.id, reason: `kernel action teacher.leave.${m.id} had been decided`,
          policyRef: 'Platform §2.4 (identity & access) · approvals', risk: 'medium',
          outcome: `teacher.leave_request.status set to "${m.to}" from the kernel decision; the app.actions row remains the authority`,
        });
      }
      const fresh = (await c.query(
        `SELECT id, kind, from_date, to_date, reason, status, decided_at, note FROM teacher.leave_request
         WHERE teacher_id=$1 ORDER BY created_at DESC LIMIT 50`, [req.user.id])).rows;
      return { leave: fresh.map((r) => ({
        ...r,
        decisionNote: rows.find((x) => x.id === r.id)?.decision_note ?? null,
      })) };
    });
  });
}
