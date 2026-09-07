// teacher.classroom — runtime module (migration 031, TeacherOS lane TS-1 retry).
// Homework desk: teachers post, students submit once, the assigning teacher reviews.
// Design invariants:
//   · TEACHER SCOPING — a teacher sees ONLY homework rows with created_by = self
//     (`mine=1` list + every door). The inbox and review desk belong to the assigning
//     teacher alone; another teacher's homework id is 404 with no data in the error.
//   · STUDENTS CAN ONLY SUBMIT — no student door reads anything but their own
//     submissions; student_id is ALWAYS the signed-in student (no picker, no body
//     override — the privacy pin). UNIQUE(homework_id, student_id) is the structural
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

const ID = 'teacher.classroom';
export { default as manifest } from './manifest.js';

const TEACHER = ['teacher'];
const STUDENT = ['student'];
const REVIEW_STATUSES = ['reviewed', 'graded', 'resubmit_requested'];
const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function register(app, kernel) {
  const { withUser, requestAudit, emitEvent, require, q } = kernel;
  const lifecycleGate = makeLifecycleGate(q, ID);

  // ── teacher posts homework (audited) ───────────────────────────────────────
  app.post('/plugins/teacher.classroom/homework', { preHandler: [require(...TEACHER), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.class_grade || !String(b.class_grade).trim()) return bad(reply, 'Choose the class this homework is for');
    if (!b.subject || !String(b.subject).trim()) return bad(reply, 'Choose the subject');
    if (!b.title || !String(b.title).trim()) return bad(reply, 'Please add a short title');
    if (!b.due_at || Number.isNaN(new Date(b.due_at).getTime())) return bad(reply, 'Pick a due date and time');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const row = (await c.query(
        `INSERT INTO teacher.homework (tenant_id, class_grade, subject, title, detail, attachment_ref, due_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, class_grade, subject, title, due_at, status, created_at`,
        [req.user.tenant_id, String(b.class_grade).slice(0, 20), String(b.subject).slice(0, 60), String(b.title).slice(0, 200),
         b.detail ? String(b.detail).slice(0, 4000) : null, b.attachment_ref ? String(b.attachment_ref).slice(0, 500) : null,
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
      const subs = (await c.query(
        `SELECT s.id, s.student_id, s.content_type, s.status, s.grade, s.feedback, s.submitted_at, s.reviewed_at, st.name AS student_name
         FROM teacher.submission s LEFT JOIN app.students st ON st.id = s.student_id
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
        `SELECT id, title, subject, due_at, status FROM teacher.homework WHERE id=$1 AND status='open'`,
        [req.params.id])).rows[0];
      if (!hw) return bad(reply, 'We couldn\'t find that homework', 404);
      const late = new Date() > new Date(hw.due_at);
      await c.query('SAVEPOINT submit_once');
      try {
        await c.query(
          `INSERT INTO teacher.submission (tenant_id, homework_id, student_id, content_type, content, status, submitted_at)
           VALUES ($1,$2,$3,$4,$5,$6, now())`,
          [req.user.tenant_id, hw.id, req.user.id, b.content_type, String(b.content).slice(0, 8000), late ? 'late' : 'submitted']);
      } catch (e) {
        await c.query('ROLLBACK TO SAVEPOINT submit_once');
        if (e.code === '23505') return bad(reply, 'Already submitted — resubmission is requested by your teacher, not allowed here', 409);
        throw e;
      }
      await c.query('RELEASE SAVEPOINT submit_once');
      const sub = (await c.query(
        `SELECT id, status, submitted_at FROM teacher.submission WHERE homework_id=$1 AND student_id=$2`,
        [hw.id, req.user.id])).rows[0];
      await emitEvent(c, req.user.tenant_id, { type: 'classroom', label: `Homework submitted: ${hw.subject} — ${hw.title.slice(0, 60)}${late ? ' (late)' : ''}`, ref: sub.id },
        'submission.v1', { submissionId: sub.id, homeworkId: hw.id, studentId: req.user.id, status: sub.status });
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
      // join pins review to the ASSIGNING teacher (privacy pin — never a colleague)
      const row = (await c.query(
        `SELECT s.id, s.status, s.homework_id, s.student_id, h.title, h.subject, h.created_by
         FROM teacher.submission s JOIN teacher.homework h ON h.id = s.homework_id
         WHERE s.id=$1 AND h.created_by=$2 FOR UPDATE OF s`,
        [req.params.id, req.user.id])).rows[0];
      if (!row) return bad(reply, 'We couldn\'t find that submission', 404);
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
        // roster students of the class whose due date passed with no submission on file
        rows = (await c.query(
          `SELECT h.id AS homework_id, h.title, h.subject, h.class_grade, h.due_at,
             st.id AS student_id, st.name AS student_name
           FROM teacher.homework h
           JOIN app.students st ON st.grade = h.class_grade
           WHERE h.created_by = $1 AND h.status='open' AND h.due_at < now()
             AND NOT EXISTS (SELECT 1 FROM teacher.submission s WHERE s.homework_id = h.id AND s.student_id = st.id)
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
           LEFT JOIN app.students st ON st.id = s.student_id
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
           a.status AS action_status, a.decision_note
         FROM teacher.leave_request r
         LEFT JOIN app.actions a ON a.code = 'teacher.leave.' || r.id::text
         WHERE r.teacher_id=$1 ORDER BY r.created_at DESC LIMIT 50`, [req.user.id])).rows;
      // mirror the kernel decision into the row (idempotent; the action row is the truth)
      for (const r of rows) {
        if (r.status === 'pending' && r.action_status === 'approved')
          await c.query(`UPDATE teacher.leave_request SET status='approved', decided_at=now() WHERE id=$1 AND status='pending'`, [r.id]);
        else if (r.status === 'pending' && r.action_status === 'dismissed')
          await c.query(`UPDATE teacher.leave_request SET status='rejected', decided_at=now() WHERE id=$1 AND status='pending'`, [r.id]);
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
