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
// HOW, AND WHY IT IS DONE THIS WAY (F-16 update: the structural repair HAS landed).
// `app.students.user_id` (migration 132) now binds a pupil's portal account to exactly
// one roster row, written when the school creates the account from that row
// (people.admin, G-1). The submit door reads that binding FIRST
// (`resolveStudentByUser`, same pin `student.world` resolves from), so the two
// planes agree and a same-named section-sibling can never inherit the submission.
//
// Name matching remains ONLY as the fallback for rows enrolled before the account
// existed (the 034 `child_link` name-match convention this module inherited). The old
// weakness therefore survives in exactly one case — an UNBOUND account whose name
// matches several same-grade rows (the seed's three grade-8 `Diya Nair`s), where we
// take the LOWEST `admission_no` as a deterministic, auditable tiebreak, not a
// correct identification. The fix for that residue is provisioning discipline (bind
// every pupil account), not a cleverer query: no amount of SQL recovers which
// section-sibling signed in. Every query is scoped by `tenant_id` so the weakness
// can never cross a school boundary.
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

// F-16 · STRUCTURAL identity first. `app.students.user_id` (migration 132) binds the
// account to exactly one roster row — the same pin `student.world` resolves from, so the
// two planes finally agree. Name matching below stays ONLY as the fallback for rows
// enrolled before the account existed. Returns the active bound row, or null.
async function resolveStudentByUser(c, tenantId, userId) {
  const rows = (await c.query(
    `SELECT id, name, grade, section, admission_no FROM app.students
      WHERE tenant_id = $1 AND status = 'active' AND user_id = $2 LIMIT 1`,
    [tenantId, userId])).rows;
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

// ── /teacher/home helpers (P1 command center aggregate) ──────────────────────
// The timetable grid (021) is section-agnostic — it carries teacher_name but no class
// column — so a period is shown against the teacher's OWN class from app.class_assignments
// (083, form-teacher model). When the school has not assigned a class the label is empty,
// which the UI renders as "subject · " rather than inventing a section.
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const istNow = () => new Date(Date.now() + 5.5 * 3600 * 1000); // Asia/Kolkata wall clock
const pad2 = (n) => String(n).padStart(2, '0');
const istHHMM = (d) => `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
const minutesBetween = (fromHHMM, toHHMM) =>
  Math.round((new Date(`1970-01-01T${toHHMM}:00Z`) - new Date(`1970-01-01T${fromHHMM}:00Z`)) / 60000);
const periodNo = (p) => Number.parseInt(String(p.seq ?? ''), 10) || 0;

async function tableExists(c, schema, table) {
  return !!(await c.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2 LIMIT 1`,
    [schema, table])).rows.length;
}

export function register(app, kernel) {
  const { withUser, requestAudit, emitEvent, require, sysq } = kernel;
  const lifecycleGate = makeLifecycleGate(sysq, ID);

  // ── P1 · command center aggregate (frozen §4: GET /teacher/home) ─────────────
  // NOW / NEXT / NEEDS-ATTENTION / AT-A-GLANCE / suggestions, assembled only from
  // authorized sources. Sibling planes (timetable, class assignments, duty, concerns)
  // are probed and degrade to empty — never a 500 (house pattern).
  app.get('/teacher/home', { preHandler: [require(...TEACHER), lifecycleGate] }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const ist = istNow();
      const dow = WEEKDAYS[ist.getUTCDay()];
      const nowT = istHHMM(ist);

      let ownClasses = [];
      if (await tableExists(c, 'app', 'class_assignments')) {
        ownClasses = (await c.query(
          `SELECT grade, section FROM app.class_assignments
           WHERE tenant_id=$1 AND teacher_id=$2 AND active ORDER BY grade, section`,
          [req.user.tenant_id, req.user.id])).rows;
      }
      const classLabel = ownClasses.length ? `${ownClasses[0].grade}-${ownClasses[0].section}` : '';

      let periods = [];
      let totalPeriods = 0;
      if (await tableExists(c, 'app', 'timetable_slots')) {
        const hasPeriods = await tableExists(c, 'app', 'timetable_periods');
        periods = (await c.query(
          `SELECT s.id, s.subject, s.room${hasPeriods ? ', p.seq, p.label, p.start_time, p.end_time, p.is_break' : ''}
           FROM app.timetable_slots s${hasPeriods ? ' JOIN app.timetable_periods p ON p.id=s.period_id' : ''}
           WHERE s.tenant_id=$1 AND s.day_of_week=$2 AND s.teacher_name=$3
           ORDER BY ${hasPeriods ? 'p.sort_idx' : 's.subject'}`, [req.user.tenant_id, dow, req.user.name])).rows;
        if (hasPeriods) {
          totalPeriods = (await c.query(
            `SELECT count(*)::int AS n FROM app.timetable_periods WHERE tenant_id=$1 AND is_break=false`,
            [req.user.tenant_id])).rows[0].n;
        }
      }
      const teaching = periods.filter((p) => !p.is_break && p.start_time);
      const current = teaching.find((p) => p.start_time <= nowT && nowT < p.end_time) ?? null;
      const upcoming = teaching.filter((p) => p.start_time > nowT);
      const now = current ? {
        id: current.id, period: periodNo(current), start: current.start_time, end: current.end_time,
        classGrade: classLabel, subject: current.subject, room: current.room ?? '',
        endsInMins: Math.max(1, minutesBetween(nowT, current.end_time)),
      } : null;

      let duties = [];
      if (await tableExists(c, 'duty', 'assignment')) {
        duties = (await c.query(
          `SELECT id, kind, period FROM duty.assignment
           WHERE tenant_id=$1 AND teacher_id=$2 AND duty_date=(now() AT TIME ZONE 'Asia/Kolkata')::date
           ORDER BY period NULLS FIRST`, [req.user.tenant_id, req.user.id])).rows;
      }

      const hwRows = (await c.query(
        `SELECT h.id, h.due_at,
           (SELECT count(*)::int FROM teacher.submission s
             WHERE s.homework_id=h.id AND s.status IN ('submitted','late')) AS pending
         FROM teacher.homework h WHERE h.created_by=$1 AND h.status='open'`, [req.user.id])).rows;
      let pendingSubs = 0;
      let earliestDue = null;
      for (const h of hwRows) {
        pendingSubs += h.pending;
        if (h.pending > 0 && (!earliestDue || new Date(h.due_at) < new Date(earliestDue))) earliestDue = h.due_at;
      }

      let openConcerns = 0;
      if (await tableExists(c, 'teacher', 'concern')) {
        openConcerns = (await c.query(
          `SELECT count(*)::int AS n FROM teacher.concern WHERE filed_by=$1 AND status <> 'closed'`,
          [req.user.id])).rows[0].n;
      }
      const pendingLeave = (await c.query(
        `SELECT count(*)::int AS n FROM teacher.leave_request WHERE teacher_id=$1 AND status='pending'`,
        [req.user.id])).rows[0].n;

      const next = [
        ...upcoming.map((p) => ({
          id: p.id, kind: 'class',
          title: `P${periodNo(p)} ${p.subject} — ${classLabel} · Room ${p.room ?? '—'}`,
          start: p.start_time, end: p.end_time, detail: p.label ?? `Period ${periodNo(p)}`,
        })),
        ...duties.map((d) => ({
          id: d.id, kind: 'duty',
          title: `${String(d.kind).charAt(0).toUpperCase()}${String(d.kind).slice(1)} duty${d.period ? ` · ${d.period}` : ''}`,
          start: '—', detail: 'Duty roster',
        })),
      ].slice(0, 4);

      const needsAttention = [];
      if (pendingSubs > 0) needsAttention.push({
        id: 'subs', kind: 'submission', rank: 0,
        title: `${pendingSubs} submission${pendingSubs === 1 ? '' : 's'} waiting for review`,
        detail: `Across ${hwRows.length} open homework${earliestDue ? ` · earliest due ${String(earliestDue).slice(0, 10)}` : ''}`,
        deadline: earliestDue ?? undefined, to: '/teacher/submissions',
      });
      if (openConcerns > 0) needsAttention.push({
        id: 'concerns', kind: 'concern', rank: 1,
        title: `${openConcerns} open concern${openConcerns === 1 ? '' : 's'} you filed`,
        detail: 'Follow up on the support queue', to: '/teacher/concerns',
      });
      if (pendingLeave > 0) needsAttention.push({
        id: 'leave', kind: 'approval', rank: 2,
        title: `${pendingLeave} leave request${pendingLeave === 1 ? '' : 's'} awaiting a decision`,
        detail: 'The coordinator reviews these', to: '/teacher/leave', state: 'pending',
      });

      const deadlines = hwRows.filter((h) => new Date(h.due_at) <= new Date(Date.now() + 24 * 3600 * 1000)).length;
      const glance = {
        periods: teaching.length,
        free: Math.max(0, totalPeriods - teaching.length),
        duties: duties.length,
        deadlines,
      };

      const suggestions = [];
      if (pendingSubs > 0) suggestions.push({
        id: 's-subs', rank: 0, title: 'Review the homework inbox',
        estimate: `about ${Math.max(2, Math.ceil(pendingSubs / 3))} minutes`,
        reason: `${pendingSubs} submission${pendingSubs === 1 ? '' : 's'} waiting`, to: '/teacher/submissions',
      });
      if (deadlines > 0) suggestions.push({
        id: 's-due', rank: 1, title: 'Check homework due today',
        estimate: 'about 5 minutes', reason: `${deadlines} homework due within a day`, to: '/teacher/homework',
      });
      if (upcoming.length > 0) suggestions.push({
        id: 's-next', rank: 2, title: 'Prepare for your next class',
        estimate: 'about 10 minutes', reason: `${upcoming[0].subject} at ${upcoming[0].start_time}`, to: '/teacher/homework',
      });

      return { now, next, needsAttention, glance, suggestions };
    });
  });

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
    const cls = req.query?.class ? String(req.query.class).slice(0, 20) : null;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // `mine=1` is the explicit contract; the pin is unconditional — created_by = self
      const rows = (await c.query(
        `SELECT h.id, h.class_grade, h.subject, h.title, h.detail, h.attachment_ref, h.due_at, h.status, h.created_at,
           (SELECT count(*)::int FROM teacher.submission s WHERE s.homework_id = h.id) AS submission_count
         FROM teacher.homework h
         WHERE h.created_by = $1 AND ($2::text IS NULL OR h.class_grade = $2)
         ORDER BY h.due_at ASC LIMIT 100`, [req.user.id, cls])).rows;
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
      // F-16: structural binding FIRST (migration 132) — the account names its
      // roster row, so a same-named section-sibling can never inherit this
      // submission. The bound row's own grade is the class gate: a bound pupil
      // in another grade gets the same "different class" answer as the name path.
      const bound = await resolveStudentByUser(c, req.user.tenant_id, req.user.id);
      let student = null;
      if (bound) {
        if (bound.grade !== hw.class_grade) {
          return bad(reply, 'This homework is for a different class');
        }
        student = bound;
      } else {
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
        student = await resolveStudent(c, req.user.tenant_id, req.user.name, hw.class_grade);
        if (!student) {
          // Unreachable while the two queries above agree, and that is the point: if they ever
          // diverge we refuse loudly rather than fall back to the user id (which is how this
          // regression happened) or to a 500 (which hides it).
          return bad(reply, 'We couldn\'t match your login to a student record for this class — please ask the school office to check your account', 409);
        }
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
  // UI contract (SubmissionsInbox, frozen): rows carry `id`, `homework_id`,
  // `homework_title`, `class_grade`, `student_id`, `student_name`, `content_type`,
  // `content_ref`, `submitted_at`, `status`, `grade`, `feedback`, `reviewed_at`.
  // `submission_id` is retained for the existing pins. `state=all` (or no state) is
  // the default view; `homework=` narrows to one assignment.
  app.get('/plugins/teacher.classroom/submissions', { preHandler: [require(...TEACHER), lifecycleGate] }, async (req, reply) => {
    const state = req.query?.state ? String(req.query.state) : 'all';
    if (!['all', 'pending', 'reviewed', 'late', 'missing'].includes(state))
      return bad(reply, 'Pick a view: all, pending, reviewed, late or missing');
    const homeworkId = req.query?.homework ? String(req.query.homework) : null;
    if (homeworkId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(homeworkId))
      return bad(reply, 'That homework filter is not a valid id');
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
          `SELECT h.id AS homework_id, h.title AS homework_title, h.subject, h.class_grade, h.due_at,
             st.id AS student_id, st.name AS student_name
           FROM teacher.homework h
           JOIN app.students st ON st.grade = h.class_grade AND st.tenant_id = h.tenant_id
           WHERE h.created_by = $1 AND h.status='open' AND h.due_at < now()
             AND ($2::uuid IS NULL OR h.id = $2::uuid)
             AND NOT EXISTS (
               SELECT 1 FROM teacher.submission s
               LEFT JOIN app.students ss ON ss.id = s.student_id AND ss.tenant_id = s.tenant_id
               WHERE s.homework_id = h.id
                 AND (s.student_id = st.id
                      OR (ss.grade = st.grade AND lower(ss.name) = lower(st.name))))
           ORDER BY h.due_at ASC, st.name ASC LIMIT 200`, [req.user.id, homeworkId])).rows;
        rows = rows.map((r) => ({
          id: `missing:${r.homework_id}:${r.student_id}`,
          submission_id: null,
          homework_id: r.homework_id, homework_title: r.homework_title, class_grade: r.class_grade,
          student_id: r.student_id, student_name: r.student_name,
          content_type: 'text', content_ref: null, submitted_at: null, status: 'missing',
          grade: null, feedback: null, reviewed_at: null,
        }));
      } else {
        const where = state === 'pending' ? `s.status IN ('submitted','late')`
          : state === 'reviewed' ? `s.status IN ('reviewed','graded')`
          : state === 'late' ? `s.status = 'late'`
          : `TRUE`;
        rows = (await c.query(
          `SELECT s.id, s.id AS submission_id, s.homework_id, h.title AS homework_title, h.class_grade,
             s.student_id, s.content_type, s.content AS content_ref, s.status, s.grade, s.feedback,
             s.submitted_at, s.reviewed_at, st.name AS student_name
           FROM teacher.homework h
           JOIN teacher.submission s ON s.homework_id = h.id
           LEFT JOIN app.students st ON st.id = s.student_id AND st.tenant_id = s.tenant_id
           WHERE h.created_by = $1 AND ${where}
             AND ($2::uuid IS NULL OR h.id = $2::uuid)
           ORDER BY h.due_at ASC, s.submitted_at DESC LIMIT 200`, [req.user.id, homeworkId])).rows;
      }
      return { state, submissions: rows };
    });
  });

  // ── teacher roster (the class lists a teacher may act on) ──────────────────
  // Scoped to the grades the teacher is assigned (app.class_assignments, 083). When the
  // school has no assignment for the teacher the door returns an empty list rather than
  // the whole school — least privilege, and the UI says so honestly.
  app.get('/plugins/teacher.classroom/roster', { preHandler: [require(...TEACHER), lifecycleGate] }, async (req) => {
    const cls = req.query?.class ? String(req.query.class).slice(0, 20) : null;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const grades = [];
      if (await tableExists(c, 'app', 'class_assignments')) {
        const own = (await c.query(
          `SELECT DISTINCT grade FROM app.class_assignments WHERE tenant_id=$1 AND teacher_id=$2 AND active`,
          [req.user.tenant_id, req.user.id])).rows;
        for (const g of own) grades.push(String(g.grade));
      }
      const rows = grades.length ? (await c.query(
        `SELECT id, name, grade, section, admission_no FROM app.students
         WHERE tenant_id=$1 AND status='active' AND grade = ANY($2::text[])
           AND ($3::text IS NULL OR grade=$3)
         ORDER BY grade, section, name LIMIT 300`,
        [req.user.tenant_id, grades, cls])).rows : [];
      return { scope: 'my_classes', classes: grades, students: rows };
    });
  });

  // ── lessons lifecycle (PRD-2 / DAT-4) ──────────────────────────────────────
  // Planned → prepared → teaching → completed → reflected. A reflection updates the
  // lesson and (when a curriculum topic is named) the coverage is ticked separately by
  // the curriculum door — this plane never authors the curriculum tree (A1).
  const LESSON_STATUSES = ['planned', 'prepared', 'teaching', 'completed', 'reflected'];
  const asStringArray = (v) => Array.isArray(v) ? v.map((x) => String(x).slice(0, 300)).filter(Boolean).slice(0, 30) : [];

  app.post('/plugins/teacher.classroom/lessons', { preHandler: [require(...TEACHER), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.class_grade || !String(b.class_grade).trim()) return bad(reply, 'Choose the class for this lesson');
    if (!b.subject || !String(b.subject).trim()) return bad(reply, 'Choose the subject');
    if (!b.topic || !String(b.topic).trim()) return bad(reply, 'Give the lesson a topic');
    const date = b.lesson_date ?? b.date ?? null;
    if (date != null && !isDate(date)) return bad(reply, 'Lesson date must be YYYY-MM-DD');
    const period = b.period == null || b.period === '' ? null : Number(b.period);
    if (period != null && (!Number.isInteger(period) || period < 0 || period > 20)) return bad(reply, 'Period must be a number from 0 to 20');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const row = (await c.query(
        `INSERT INTO teacher.lesson (tenant_id, teacher_id, class_grade, subject, lesson_date, period, topic, objectives, resources)
         VALUES ($1,$2,$3,$4,COALESCE($5::date,(now() AT TIME ZONE 'Asia/Kolkata')::date),$6,$7,$8::jsonb,$9::jsonb)
         RETURNING id, class_grade, subject, lesson_date, period, topic, objectives, resources, status, created_at`,
        [req.user.tenant_id, req.user.id, String(b.class_grade).slice(0, 20), String(b.subject).slice(0, 60),
         date, period, String(b.topic).slice(0, 200), JSON.stringify(asStringArray(b.objectives)), JSON.stringify(asStringArray(b.resources))])).rows[0];
      await emitEvent(c, req.user.tenant_id, { type: 'classroom', label: `Lesson planned: ${row.subject} — ${row.topic}`, ref: row.id },
        'lesson.planned.v1', { lessonId: row.id, classGrade: row.class_grade, subject: row.subject, topic: row.topic });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Lesson planned', recordType: 'Lesson', recordRef: row.id,
        reason: `${row.subject} · ${row.class_grade}`, policyRef: 'TEACHEROS-PLAN §P3 (lessons lifecycle)', risk: 'low',
        outcome: `status ${row.status}` });
      return { ok: true, lessonId: row.id, lesson: row };
    });
  });

  app.get('/plugins/teacher.classroom/lessons', { preHandler: [require(...TEACHER), lifecycleGate] }, async (req) => {
    const date = isDate(req.query?.date) ? String(req.query.date) : null;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const rows = (await c.query(
        `SELECT id, class_grade, subject, to_char(lesson_date,'YYYY-MM-DD') AS lesson_date, period, topic,
                objectives, resources, reflection, status, created_at
         FROM teacher.lesson
         WHERE teacher_id=$1 AND ($2::date IS NULL OR lesson_date=$2::date)
         ORDER BY lesson_date DESC, period NULLS LAST, created_at DESC LIMIT 100`, [req.user.id, date])).rows;
      return { date, lessons: rows };
    });
  });

  app.post('/plugins/teacher.classroom/lessons/:id/reflect', { preHandler: [require(...TEACHER), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.worked && !b.reinforce && !b.next) return bad(reply, 'Add at least one reflection line — what worked, what to reinforce, what is next');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const lesson = (await c.query(`SELECT id, topic, subject FROM teacher.lesson WHERE id=$1 AND teacher_id=$2`,
        [req.params.id, req.user.id])).rows[0];
      if (!lesson) return bad(reply, 'We couldn\'t find that lesson', 404);
      const reflection = {
        worked: b.worked ? String(b.worked).slice(0, 500) : null,
        reinforce: b.reinforce ? String(b.reinforce).slice(0, 500) : null,
        next: b.next ? String(b.next).slice(0, 500) : null,
        at: new Date().toISOString(),
      };
      const row = (await c.query(
        `UPDATE teacher.lesson SET reflection=$3::jsonb, status='reflected', updated_at=now()
         WHERE id=$1 AND teacher_id=$2 RETURNING id, status, reflection`,
        [lesson.id, req.user.id, JSON.stringify(reflection)])).rows[0];
      await emitEvent(c, req.user.tenant_id, { type: 'classroom', label: `Lesson reflected: ${lesson.subject} — ${lesson.topic}`, ref: lesson.id },
        'lesson.reflected.v1', { lessonId: lesson.id });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Lesson reflected', recordType: 'Lesson', recordRef: lesson.id,
        reason: lesson.topic, policyRef: 'TEACHEROS-PLAN §P3 (10–20s reflection)', risk: 'low',
        outcome: 'status reflected' });
      return { ok: true, lessonId: lesson.id, status: row.status, reflection: row.reflection };
    });
  });

  // ── duty roster + my workload (PRD-3) ──────────────────────────────────────
  // Aggregates only, framed for fairness — never a score or a rank (plan §P8).
  app.get('/duty/roster', { preHandler: [require(...TEACHER), lifecycleGate] }, async (req) => {
    const window = ['today', 'week', 'month'].includes(req.query?.window) ? String(req.query.window) : 'week';
    const span = window === 'today' ? '1 day' : window === 'month' ? '31 days' : '7 days';
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      if (!(await tableExists(c, 'duty', 'assignment'))) return { window, duties: [], note: 'The duty roster is not connected in this database yet.' };
      const rows = (await c.query(
        `SELECT id, kind, to_char(duty_date,'YYYY-MM-DD') AS duty_date, to_char(duty_date,'YYYY-MM-DD') AS date,
                period, note, note AS place, COALESCE(period, '—') AS period_label, COALESCE(period, '—') AS time,
                CASE WHEN kind='substitution' THEN 'substitution' ELSE 'roster' END AS source
         FROM duty.assignment
         WHERE tenant_id=$1 AND teacher_id=$2
           AND duty_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date
           AND duty_date <  (now() AT TIME ZONE 'Asia/Kolkata')::date + $3::interval
         ORDER BY duty_date, period NULLS FIRST`, [req.user.tenant_id, req.user.id, span])).rows;
      return { window, duties: rows };
    });
  });

  app.get('/workload/mine', { preHandler: [require(...TEACHER), lifecycleGate] }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const dow = WEEKDAYS[istNow().getUTCDay()];
      let teaching = 0;
      if (await tableExists(c, 'app', 'timetable_slots')) {
        teaching = (await c.query(
          `SELECT count(*)::int AS n FROM app.timetable_slots WHERE tenant_id=$1 AND teacher_name=$2 AND day_of_week=$3`,
          [req.user.tenant_id, req.user.name, dow])).rows[0].n;
      }
      let duties = 0, substitutions = 0, invigilation = 0, meetings = 0;
      if (await tableExists(c, 'duty', 'assignment')) {
        const d = (await c.query(
          `SELECT
             count(*) FILTER (WHERE kind NOT IN ('substitution','invigilation','event'))::int AS duties,
             count(*) FILTER (WHERE kind = 'substitution')::int AS substitutions,
             count(*) FILTER (WHERE kind = 'invigilation')::int AS invigilation,
             count(*) FILTER (WHERE kind = 'event')::int AS meetings
           FROM duty.assignment WHERE tenant_id=$1 AND teacher_id=$2
             AND duty_date >= date_trunc('week', (now() AT TIME ZONE 'Asia/Kolkata')::date)`,
          [req.user.tenant_id, req.user.id])).rows[0];
        duties = d.duties; substitutions = d.substitutions; invigilation = d.invigilation; meetings = d.meetings;
      }
      let pendingReviews = 0;
      if (await tableExists(c, 'teacher', 'submission')) {
        pendingReviews = (await c.query(
          `SELECT count(*)::int AS n FROM teacher.submission s JOIN teacher.homework h ON h.id=s.homework_id
           WHERE h.created_by=$1 AND s.status IN ('submitted','late')`, [req.user.id])).rows[0].n;
      }
      let ptmBookings = 0;
      if (await tableExists(c, 'ptm', 'slot')) {
        ptmBookings = (await c.query(
          `SELECT count(*)::int AS n FROM ptm.slot WHERE tenant_id=$1 AND teacher_id=$2 AND status='booked'`,
          [req.user.tenant_id, req.user.id])).rows[0].n;
      }
      // Fair band is a fixed, published range (extra load = substitutions + invigilation).
      // It exists for fairness and burnout prevention — never a ranking (P8).
      const extra = substitutions + invigilation;
      const FAIR_MIN = 4, FAIR_MAX = 10;
      return {
        workload: {
          periods: teaching,
          teaching_periods: teaching,
          duties,
          substitutions,
          invigilation,
          meetings,
          ptm_count: ptmBookings,
          pending_reviews: pendingReviews,
          grading_estimate_mins: pendingReviews * 5,
          fair_band: { min: FAIR_MIN, max: FAIR_MAX },
          week_label: 'This week',
          total_commitments: teaching + duties + substitutions + invigilation + meetings + pendingReviews + ptmBookings,
          overload: extra > FAIR_MAX,
          note: 'This is for your protection, not your rating. If your extra load rises above the fair band the coordinator is asked to rebalance.',
        },
      };
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
        `INSERT INTO app.actions (tenant_id, code, kind, title, detail, why, priority, status, owner, owner_role, policy_ref, ai_involved, source_event, payload, source_plugin)
         VALUES ($1,$2,'approval',$3,$4,$5,'normal','open','Coordinator','coordinator','TEACHEROS-PLAN · staff leave via kernel approval',false,$6,$7::jsonb,'teacher.classroom')
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
      return { ok: true, requestId: row.id, actionId,
        // UI contract (MyLeave): the freshly filed request in the shape the screen reads
        request: {
          id: row.id, kind: b.kind, from_date: b.from_date, to_date: b.to_date,
          reason: String(b.reason).slice(0, 1000), status: 'requested',
          approver_name: null, decided_at: null, note: null,
        },
        note: 'The coordinator will review this. Track it in My leave.' };
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
        `SELECT r.id, r.kind, r.from_date, r.to_date, r.reason, r.status, r.decided_at, r.note,
           a.decision_note, au.name AS approver_name,
           hp.substitute_name, hp.packet_at, hp.classes AS handover_classes
         FROM teacher.leave_request r
         LEFT JOIN app.actions a ON a.code = 'teacher.leave.' || r.id::text
         LEFT JOIN app.users au ON au.id = a.decided_by
         LEFT JOIN teacher.handover_packet hp ON hp.leave_request_id = r.id
         WHERE r.teacher_id=$1 ORDER BY r.created_at DESC LIMIT 50`, [req.user.id])).rows;
      // UI contract (MyLeave): `requests` in the screen's vocabulary (pending → requested);
      // `leave` keeps the raw DB rows for the existing pins. DEL-3: an approved request with a
      // generated packet carries `handover` (substitute + the affected periods).
      const requests = fresh.map((r) => ({
        id: r.id, kind: r.kind, from_date: r.from_date, to_date: r.to_date, reason: r.reason,
        status: r.status === 'pending' ? 'requested' : r.status,
        approver_name: r.approver_name ?? null,
        decided_at: r.decided_at ?? null,
        note: r.note ?? r.decision_note ?? null,
        handover: r.packet_at
          ? { substitute_name: r.substitute_name ?? 'Cover to be assigned', packet_at: r.packet_at, classes: r.handover_classes ?? [] }
          : null,
      }));
      return {
        requests,
        balances: [],
        leave: fresh.map((r) => ({
          ...r,
          decisionNote: r.decision_note ?? null,
        })),
      };
    });
  });
}
