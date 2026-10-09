// family.view — runtime module (migration 034, ParentOS lane PS-1).
// The parent read-plane. Every door answers one of the four family questions:
// what is happening today / does my child need attention / what does school need
// from me / what should I do next. Design invariants:
//   · GUARDIAN SCOPING — a parent reads only children linked via family.child_link.
//     Cross-guardian child ids are 403 with no data in the error (the /my-cases lesson,
//     pinned by tests). The teacher role is refused on every door.
//   · CONSENT IS IMMUTABLE — a decision (granted/declined) is final; the DB guard in 034
//     raises on any UPDATE of a decided row. A new consent is a new row, never a rewrite.
//     Pending is never treated as consent.
//   · PARENTS NEVER EDIT RECORDS — corrections travel as requests (report-discrepancy).
//     Request statuses are append-only event rows (no UPDATE on history).
//   · CHILD LEAVE — raises the per-instance kernel action parent.leave.<requestId>
//     (UNIQUE(tenant,code) from birth — cycle-5 P1-1). Approval is office authority.
//   · GRACEFUL DEGRADATION — TeacherOS tables (teacher.homework etc.) are read via
//     information_schema probes; absent tables yield empty sections, never 500s.
import { makeLifecycleGate } from '../_shared/lifecycle-gate.js';
import { uuidParams } from '../_shared/uuid-param.js';
import { servedReport } from '../_shared/exam-report.js';
import { pluginAbsent } from '../_shared/optional-table.js';

const ID = 'family.view';
export { default as manifest } from './manifest.js';

const GUARDIAN = ['parent'];
// School-side authority for the two staff actions on the family plane: authoring a consent
// (the school asks; a parent never authors their own) and advancing a request ticket.
const STAFF_AUTHORITY = ['owner', 'principal', 'itadmin', 'coordinator'];
const STAFF_OVERSIGHT = ['owner', 'principal', 'itadmin', 'coordinator'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TICKET_STATUSES = ['submitted','received','assigned','in_progress','waiting_parent','resolved','closed'];
// SEC-4: the ticket state machine. The door validates it here (plain 409) and the DB guard
// in 113 enforces the same edges for any write that bypasses the door.
const TICKET_TRANSITIONS = {
  submitted: ['received','assigned','in_progress','waiting_parent','resolved','closed'],
  received: ['assigned','in_progress','waiting_parent','resolved','closed'],
  assigned: ['in_progress','waiting_parent','resolved','closed'],
  in_progress: ['waiting_parent','resolved','closed'],
  waiting_parent: ['in_progress','resolved','closed'],
  resolved: ['closed'],
  closed: [],
};
const REQUEST_CATEGORIES = ['leave','certificate','document','transport','activity','profile_correction','reevaluation','other'];
const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });

export function register(app, kernel) {
  const { withUser, requestAudit, emitEvent, require, sysq, settingsFor } = kernel;
  const lifecycleGate = makeLifecycleGate(kernel.sysq, ID);

  const myChildren = async (c, userId) =>
    (await c.query(
      `SELECT s.id, s.name, s.grade, s.section, s.admission_no
       FROM family.child_link l JOIN app.students s ON s.id = l.student_id AND s.tenant_id = l.tenant_id
       WHERE l.user_id=$1 AND l.tenant_id=current_setting('schoolos.tenant_id', true)::uuid
       ORDER BY s.name`, [userId])).rows;

  const assertOwnChild = async (c, userId, childId) => {
    const ok = await c.query(
      `SELECT 1 FROM family.child_link WHERE user_id=$1 AND student_id=$2
       AND tenant_id=current_setting('schoolos.tenant_id', true)::uuid`, [userId, childId]);
    return ok.rows.length > 0;
  };

  const tableExists = async (c, name) =>
    // schema-qualified names ('teacher.homework'); unqualified defaults to public
    !!(await c.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_name = split_part($1, '.', 2)
         AND table_schema = CASE WHEN position('.' in $1) > 0 THEN split_part($1, '.', 1) ELSE 'public' END`,
      [name])).rows.length;

  /* A1 (+F-18): the exams plugin tables are absent when the plugin is off;
     degrade ONLY for that case. Now shared at ../_shared/optional-table.js so every
     plane shares one rule instead of drifting copies. */

/* F1: the grade scale the exams plugin grades on, read the same way the staff report door reads the
     SETTINGS — one settings key, one default, so a moderated grade cannot be re-derived differently on
     the staff plane than on the family plane.

     Read through `c` (the constrained, tenant-scoped connection) rather than the owner-path helper the
     staff door uses: `app.plugins` carries the same tenant_isolation policy as every other tenant
     table, so the owner path bought nothing here. Every owner-path call site is counted and pinned by
     the RLS boundary test, and "the sibling door does it this way" is not a reason to add one. */
  const examScale = async (c, tenantId) =>
    (await c.query(`SELECT COALESCE(settings->>'gradeScale', settings->>'grade_scale') AS gs
                      FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`,
      [tenantId, 'exams.assessment'])).rows[0]?.gs ?? 'cbse_10_point';

  /* F1: the ONE exam read model — an approved moderation overlay supersedes the frozen
     snapshot, on every plane. Both parent doors below go through servedReport() exactly as
     the staff report door does, so a moderated 90/A2 can never read to a family as 57/C1.
     The overlay is joined in the same query: the family plane reads it with the report so
     the two can never be served out of step. */
  const servedExams = async (c, { studentId, tenantId, scale }) =>
    (await c.query(
      `SELECT e.name AS exam_name, e.term, r.snapshot, r.digest, r.created_at AS published_at,
              (SELECT m.adjusted_snapshot FROM plugin_exams.moderation m
                WHERE m.report_id=r.id AND m.status='approved'
                ORDER BY m.decided_at DESC LIMIT 1) AS moderation
         FROM plugin_exams.report r JOIN plugin_exams.exam e ON e.id=r.exam_id
        WHERE r.student_id=$1 AND r.tenant_id=$2 AND e.status='published'
        ORDER BY r.created_at DESC NULLS LAST LIMIT 12`, [studentId, tenantId]).catch(pluginAbsent)).rows
      .map((r) => ({ ...r, ...servedReport(r, r.moderation ? { adjusted_snapshot: r.moderation } : null, scale) }));

  // ── home aggregation ────────────────────────────────────────────────────────
  app.get('/parent/home', { preHandler: [require(...GUARDIAN), lifecycleGate] }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const children = await myChildren(c, req.user.id);
      const hasHw = await tableExists(c, 'teacher.homework');
      const hasLeave = await tableExists(c, 'teacher.leave_request');
      const out = [];
      for (const ch of children) {
        const attToday = (await c.query(
          `SELECT status FROM app.attendance WHERE student_id=$1 AND school_date=(now() AT TIME ZONE 'Asia/Kolkata')::date AND tenant_id=$2`,
          [ch.id, req.user.tenant_id])).rows[0]?.status ?? null;
        let assignments = null;
        if (hasHw) {
          // roster↔user bridge (034 name-match convention): classroom submissions key the
          // student USER id; family.child_link keys the roster id. Match either — a row is
          // the child's only when ids collide or the submitter user carries the child's name.
          assignments = (await c.query(
            `SELECT h.id, h.title, h.subject, h.due_at, sub.status AS submission_status, sub.grade
             FROM teacher.homework h
             LEFT JOIN teacher.submission sub ON sub.homework_id=h.id
               AND (sub.student_id=$1
                    OR EXISTS (SELECT 1 FROM app.users su
                               WHERE su.id = sub.student_id AND su.tenant_id=$3
                               AND lower(su.name) = lower($4)
                               AND (SELECT count(*) FROM app.students d WHERE d.tenant_id=$3 AND lower(d.name)=lower($4)) = 1
                               AND (SELECT count(*) FROM app.users u2 WHERE u2.tenant_id=$3 AND u2.role='student' AND lower(u2.name)=lower($4)) = 1))
             WHERE h.class_grade=$2 AND h.tenant_id=$3 AND h.due_at > now() - interval '7 days'
             ORDER BY h.due_at ASC LIMIT 20`,
            [ch.id, ch.grade, req.user.tenant_id, ch.name])).rows;
        }
        const consents = (await c.query(
          `SELECT id, kind, title, due_at, status FROM family.consent
           WHERE student_id=$1 AND tenant_id=$2 ORDER BY (status='pending') DESC, due_at NULLS LAST LIMIT 10`,
          [ch.id, req.user.tenant_id])).rows;
        const attention = [];
        for (const cs of consents.filter(x => x.status === 'pending'))
          attention.push({ tier: 'action', ref: `/parent/consents`, title: `Consent needed: ${cs.title}`, due: cs.due_at });
        if (assignments) {
          for (const hw of assignments.filter(x => !x.submission_status && new Date(x.due_at) < new Date(Date.now() + 36e5 * 36)))
            attention.push({ tier: 'upcoming', ref: `/parent/assignments`, title: `Homework due: ${hw.title}`, due: hw.due_at });
        }
        out.push({
          child_id: ch.id, name: ch.name, class: `${ch.grade}${ch.section ? `-${ch.section}` : ''}`,
          class_grade: ch.grade, section: ch.section,
          attendance_today: attToday, assignments, consents, attention,
        });
      }
      const requests = (await c.query(
        `SELECT id, category, title, status, created_at FROM family.request
         WHERE guardian_id=$1 AND tenant_id=$2 ORDER BY created_at DESC LIMIT 10`,
        [req.user.id, req.user.tenant_id])).rows;
      // ACTION CENTER checklist — pending consents (fees are added by the fees read plane
      // in the UI). Derived from the same rows the children aggregate already read.
      const actions = [];
      for (const ch of out) {
        for (const cs of (ch.consents ?? []).filter((x) => x.status === 'pending'))
          actions.push({ kind: 'consent', ref: '/parent/consents', title: `Consent: ${cs.title}`, due: cs.due_at ?? null });
      }
      return { children: out, requests, actions, brief: {} };
    });
  });

  // ── per-child assignments (teacher.homework probe; 034 name-bridge) ────────
  app.get('/parent/child/:id/assignments', { preHandler: [require(...GUARDIAN), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      if (!(await assertOwnChild(c, req.user.id, req.params.id)))
        return bad(reply, 'This child is not linked to your family account', 403);
      const child = (await c.query(`SELECT name, grade FROM app.students WHERE id=$1 AND tenant_id=$2`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!child || !(await tableExists(c, 'teacher.homework'))) {
        return { child_id: req.params.id, upcoming: [], submitted: [], reviewed: [], overdue: [], missing: [],
          explain: 'The homework lane is not connected yet — ask the class teacher until homework appears here.' };
      }
      const rows = (await c.query(
        `SELECT h.id, h.title, h.subject, h.due_at, sub.status AS submission_status
         FROM teacher.homework h
         LEFT JOIN teacher.submission sub ON sub.homework_id=h.id
           AND (sub.student_id=$1
                OR ($3::text IS NOT NULL AND EXISTS (SELECT 1 FROM app.users su
                       WHERE su.id = sub.student_id AND su.tenant_id=$2
                       AND lower(su.name) = lower($3)
                       AND (SELECT count(*) FROM app.students d WHERE d.tenant_id=$2 AND lower(d.name)=lower($3)) = 1
                       AND (SELECT count(*) FROM app.users u2 WHERE u2.tenant_id=$2 AND u2.role='student' AND lower(u2.name)=lower($3)) = 1)))
         WHERE h.class_grade=$4 AND h.tenant_id=$2 AND h.due_at > now() - interval '30 days'
         ORDER BY h.due_at ASC LIMIT 50`,
        [req.params.id, req.user.tenant_id, child.name, child.grade])).rows;
      const now = Date.now();
      const out = { child_id: req.params.id, upcoming: [], submitted: [], reviewed: [], overdue: [], missing: [] };
      for (const r of rows) {
        const item = { id: r.id, title: r.title, subject: r.subject, due: r.due_at, status: r.submission_status ?? null };
        if (r.submission_status === 'reviewed' || r.submission_status === 'graded') out.reviewed.push(item);
        else if (r.submission_status === 'submitted') out.submitted.push(item);
        else if (r.submission_status === 'late') out.overdue.push(item);
        else if (new Date(r.due_at).getTime() < now) out.missing.push(item);
        else out.upcoming.push(item);
      }
      out.explain = 'Homework status comes from the class teacher\'s records. Paper homework needs no upload here.';
      return out;
    });
  });

  // ── per-child timeline (evidence-only; own child) ──────────────────────────
  app.get('/parent/child/:id/timeline', { preHandler: [require(...GUARDIAN), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      if (!(await assertOwnChild(c, req.user.id, req.params.id)))
        return bad(reply, 'This child is not linked to your family account', 403);
      const events = [];
      const att = await c.query(
        `SELECT to_char(school_date,'YYYY-MM-DD') AS date, status FROM app.attendance WHERE student_id=$1 AND tenant_id=$2 ORDER BY school_date DESC LIMIT 30`,
        [req.params.id, req.user.tenant_id]);
      for (const a of att.rows) events.push({ at: a.date, kind: 'attendance', text: a.status === 'present' ? 'Present' : a.status === 'absent' ? 'Absent' : `Attendance: ${a.status}` });
      if (await tableExists(c, 'teacher.submission')) {
        // roster↔user bridge: submissions key the student USER id (031); the child here is
        // a roster id. Match the roster id OR the child-named student user (034 convention).
        const child = (await c.query(`SELECT name, grade FROM app.students WHERE id=$1 AND tenant_id=$2`,
          [req.params.id, req.user.tenant_id])).rows[0];
        const sub = await c.query(
          `SELECT sub.submitted_at, sub.status, h.title, h.subject FROM teacher.submission sub
           JOIN teacher.homework h ON h.id=sub.homework_id
           WHERE sub.tenant_id=$2 AND h.class_grade=$4 AND (sub.student_id=$1
                 OR ($3::text IS NOT NULL AND EXISTS (SELECT 1 FROM app.users su
                        WHERE su.id = sub.student_id AND su.tenant_id=$2
                        AND lower(su.name) = lower($3)
                        AND (SELECT count(*) FROM app.students d WHERE d.tenant_id=$2 AND lower(d.name)=lower($3)) = 1
                        AND (SELECT count(*) FROM app.users u2 WHERE u2.tenant_id=$2 AND u2.role='student' AND lower(u2.name)=lower($3)) = 1)))
           ORDER BY sub.submitted_at DESC LIMIT 30`, [req.params.id, req.user.tenant_id, child?.name ?? null, child?.grade ?? null]);
        for (const s of sub.rows) events.push({ at: s.submitted_at, kind: 'homework', text: `${s.subject}: ${s.title} — ${s.status}` });
      }
      // A1: plugin_exams.report has `snapshot`/`digest`/`created_at` — NOT total_pct/grade/published_at.
      // The pct and grade live inside the snapshot JSON; the row's time is created_at.
      const rep = await c.query(
        `SELECT r.created_at AS published_at, (r.snapshot->>'pct') AS total_pct
           FROM plugin_exams.report r JOIN plugin_exams.exam e ON e.id=r.exam_id
          WHERE r.student_id=$1 AND r.tenant_id=$2 AND e.status='published'
          ORDER BY r.created_at DESC NULLS LAST LIMIT 10`,
        [req.params.id, req.user.tenant_id]).catch(pluginAbsent);
      for (const r of rep.rows) events.push({ at: r.published_at, kind: 'result', text: `Report card published — ${r.total_pct}%` });
      events.sort((a, b) => new Date(b.at) - new Date(a.at));
      return { timeline: events.slice(0, 50) };
    });
  });

  // ── academics (published reports only; growth framing) ─────────────────────
  app.get('/parent/child/:id/academics', { preHandler: [require(...GUARDIAN), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      if (!(await assertOwnChild(c, req.user.id, req.params.id)))
        return bad(reply, 'This child is not linked to your family account', 403);
      // F1: served through the shared exam read model (overlay supersedes the frozen snapshot;
      // pct is a number and the grade is the served one, never the pre-moderation value).
      const rows = await servedExams(c, { studentId: req.params.id, tenantId: req.user.tenant_id,
        scale: await examScale(c, req.user.tenant_id) });
      return { reports: rows.map(r => ({ exam: r.exam_name, term: r.term, pct: r.report?.pct ?? null,
        grade: r.report?.grade ?? r.report?.division ?? null, points: r.report?.points ?? null,
        moderated: r.moderated, publishedAt: r.published_at,
        explain: r.report?.pct == null ? 'Result details will appear here once the school publishes them.' :
          `This result is from ${r.exam_name}. It shows what was understood at that point — growth across results matters more than any single score.` })) };
    });
  });

  // ── attendance (approved-leave-aware) ──────────────────────────────────────
  app.get('/parent/child/:id/attendance', { preHandler: [require(...GUARDIAN), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      if (!(await assertOwnChild(c, req.user.id, req.params.id)))
        return bad(reply, 'This child is not linked to your family account', 403);
      const rows = (await c.query(
        `SELECT to_char(school_date,'YYYY-MM-DD') AS date, status FROM app.attendance WHERE student_id=$1 AND tenant_id=$2 ORDER BY school_date DESC LIMIT 60`,
        [req.params.id, req.user.tenant_id])).rows;
      const month = rows.filter(r => new Date(r.date) >= new Date(Date.now() - 30 * 864e5));
      // S0 fix E6: late = showed up (kernel eligibility precedent); approved leave
      // leaves the denominator — the note below was already promising this.
      const held = month.filter(r => r.status !== 'leave');
      const present = held.filter(r => r.status === 'present' || r.status === 'late').length;
      return {
        today: rows[0]?.status ?? null,
        month_pct: held.length ? Math.round((present / held.length) * 100) : null,
        history: rows,
        note: 'Approved leave never counts against attendance.',
      };
    });
  });

  // ── exams (upcoming + published) ────────────────────────────────────────────
  app.get('/parent/child/:id/exams', { preHandler: [require(...GUARDIAN), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      if (!(await assertOwnChild(c, req.user.id, req.params.id)))
        return bad(reply, 'This child is not linked to your family account', 403);
      const child = (await c.query(`SELECT grade FROM app.students WHERE id=$1 AND tenant_id=$2`,
        [req.params.id, req.user.tenant_id])).rows[0];
      // F2: 'upcoming' means not yet published. The old list also carried published exams,
      // so every finished exam appeared twice — once as a result, once as a promise.
      const upcoming = (await c.query(
        `SELECT id, name, term, class_grade FROM plugin_exams.exam
         WHERE tenant_id=$1 AND class_grade=$2 AND status='draft'
         ORDER BY created_at DESC LIMIT 8`, [req.user.tenant_id, child?.grade]).catch(pluginAbsent)).rows;
      // F1: same shared read model as /academics — an approved overlay supersedes the snapshot.
      const published = await servedExams(c, { studentId: req.params.id, tenantId: req.user.tenant_id,
        scale: await examScale(c, req.user.tenant_id) });
      return { upcoming, published: published.map(r => ({ exam: r.exam_name, term: r.term,
        total_pct: r.report?.pct ?? null, grade: r.report?.grade ?? r.report?.division ?? null,
        points: r.report?.points ?? null, moderated: r.moderated, publishedAt: r.published_at })) };
    });
  });

  // ── transport (own child's bus route) ──────────────────────────────────────
  app.get('/parent/child/:id/transport', { preHandler: [require(...GUARDIAN), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      if (!(await assertOwnChild(c, req.user.id, req.params.id)))
        return bad(reply, 'This child is not linked to your family account', 403);
      const child = (await c.query(`SELECT name, bus_route FROM app.students WHERE id=$1 AND tenant_id=$2`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!child) return bad(reply, 'We couldn\'t find that child', 404);
      let route = null;
      if (child.bus_route) {
        route = (await c.query(
          `SELECT code, name, vehicle, capacity FROM app.routes WHERE tenant_id=$1 AND code=$2`,
          [req.user.tenant_id, child.bus_route]).catch(pluginAbsent)).rows[0] ?? null;
      }
      return {
        child_id: req.params.id,
        route: route ? { code: route.code, name: route.name, vehicle: route.vehicle ?? null, capacity: route.capacity ?? null } : null,
        route_code: child.bus_route ?? null,
        note: child.bus_route
          ? 'Your child is assigned to this route. Live position is not published to families.'
          : 'The school has not assigned a bus route for your child yet.',
      };
    });
  });

  // ── documents (own child's student-scoped files; metadata only, download via files.store) ──
  app.get('/parent/child/:id/documents', { preHandler: [require(...GUARDIAN), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      if (!(await assertOwnChild(c, req.user.id, req.params.id)))
        return bad(reply, 'This child is not linked to your family account', 403);
      if (!(await tableExists(c, 'app.files'))) {
        return { child_id: req.params.id, documents: [], note: 'The document store is not connected yet.' };
      }
      const rows = (await c.query(
        `SELECT id, filename, mime, bytes, created_at FROM app.files
          WHERE tenant_id=$1 AND scope='student' AND ref_id=$2 ORDER BY created_at DESC LIMIT 100`,
        [req.user.tenant_id, req.params.id])).rows;
      return { child_id: req.params.id, documents: rows, note: 'Only files the school has shared for this child appear here.' };
    });
  });

  // ── consents (immutable decisions) ─────────────────────────────────────────
  app.get('/parent/consents', { preHandler: [require(...GUARDIAN), lifecycleGate] }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const kids = (await myChildren(c, req.user.id)).map(k => k.id);
      const rows = kids.length ? (await c.query(
        `SELECT c.id, c.kind, c.title, c.detail_ref AS detail, c.due_at, c.status, c.decided_at,
                c.student_id AS child_id, s.name AS child_name, s.name AS child
         FROM family.consent c JOIN app.students s ON s.id=c.student_id
         WHERE c.student_id = ANY($1) AND c.tenant_id=$2 ORDER BY (c.status='pending') DESC, c.due_at NULLS LAST`,
        [kids, req.user.tenant_id])).rows : [];
      return { consents: rows };
    });
  });

  // author a consent (school/office act — the parent never authors their own). Closes the
  // consent loop: without this the consent centre could never be populated (DAT-1).
  app.post('/parent/consents', { preHandler: [require(...STAFF_AUTHORITY), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    const KINDS = ['trip', 'photo', 'medical', 'activity', 'transport', 'other'];
    if (!KINDS.includes(b.kind)) return bad(reply, 'Choose a consent kind: trip, photo, medical, activity, transport or other');
    if (!b.title || !String(b.title).trim()) return bad(reply, 'Give the consent a short title');
    if (!b.studentId || !UUID.test(String(b.studentId))) return bad(reply, 'Pick the student this consent is for');
    if (b.dueAt && Number.isNaN(new Date(b.dueAt).getTime())) return bad(reply, 'Due date must be a valid date and time');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const st = (await c.query(`SELECT id, name FROM app.students WHERE id=$1 AND tenant_id=$2`,
        [b.studentId, req.user.tenant_id])).rows[0];
      if (!st) return bad(reply, 'We couldn\'t find that student', 404);
      const row = (await c.query(
        `INSERT INTO family.consent (tenant_id, student_id, kind, title, detail_ref, due_at)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, kind, title, detail_ref, due_at, status, created_at`,
        [req.user.tenant_id, st.id, b.kind, String(b.title).slice(0, 160),
         b.detail ? String(b.detail).slice(0, 2000) : null, b.dueAt ?? null])).rows[0];
      await emitEvent(c, req.user.tenant_id,
        { type: 'family', label: `Consent requested: ${row.title}`, ref: row.id },
        'family.consent.v1', { consentId: row.id, studentId: st.id, kind: b.kind, action: 'requested' });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Consent authored', recordType: 'FamilyConsent', recordRef: row.id,
        reason: row.title, policyRef: 'PARENTOS-PLAN · consent centre (school asks, parent decides)', risk: 'medium',
        outcome: `pending for ${st.name}` });
      return { ok: true, consent: { id: row.id, student_id: st.id, child_name: st.name, kind: row.kind,
        title: row.title, detail: row.detail_ref, due_at: row.due_at, status: row.status } };
    });
  });

  app.post('/parent/consents/:id/decide', { preHandler: [require(...GUARDIAN), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    const decision = req.body?.decision;
    if (!['granted', 'declined'].includes(decision)) return bad(reply, 'Decision must be granted or declined');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const row = (await c.query(`SELECT id, student_id, title, status FROM family.consent WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!row) return bad(reply, 'We couldn\'t find that consent request', 404);
      if (!(await assertOwnChild(c, req.user.id, row.student_id)))
        return bad(reply, 'This consent is not for your child', 403);
      if (row.status !== 'pending') return bad(reply, 'This consent was already decided — decisions are final; a new consent can be recorded separately', 409);
      const upd = await c.query(
        `UPDATE family.consent SET status=$2, decided_by=$3, decided_at=now() WHERE id=$1`, [row.id, decision, req.user.id]);
      if (upd.rowCount !== 1) return bad(reply, 'This consent could not be updated', 409);
      await emitEvent(c, req.user.tenant_id, { type: 'family', label: `Consent ${decision}: ${row.title}`, ref: row.id },
        'family.consent.v1', { consentId: row.id, decision });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: `Consent ${decision}`, recordType: 'FamilyConsent', recordRef: row.id,
        reason: row.title, policyRef: 'PARENTOS-PLAN · immutable consent', risk: 'medium',
        outcome: `status ${decision} (final)` });
      return { ok: true, status: decision, consent: { id: row.id, status: decision } };
    });
  });

  // ── request center (append-only ticket) ────────────────────────────────────
  app.post('/parent/requests', { preHandler: [require(...GUARDIAN), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!REQUEST_CATEGORIES.includes(b.category)) return bad(reply, 'Choose what you need: leave, certificate, document, transport, activity, profile correction, re-evaluation or other');
    if (!b.title || !String(b.title).trim()) return bad(reply, 'Please add a short title');
    // S0 fix E7: body child ids are format-guarded before the uuid cast (500 → 400)
    if (b.childId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(b.childId))) {
      return bad(reply, 'This record needs a valid child ID');
    }
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      if (b.childId && !(await assertOwnChild(c, req.user.id, b.childId)))
        return bad(reply, 'This child is not linked to your family account', 403);
      const row = (await c.query(
        `INSERT INTO family.request (tenant_id, guardian_id, child_id, category, title, payload, owner_role, sla_at)
         VALUES ($1,$2,$3,$4,$5,$6,'coordinator', now() + interval '72 hours') RETURNING id, status`,
        [req.user.tenant_id, req.user.id, b.childId ?? null, b.category, String(b.title).slice(0, 160), JSON.stringify(b.payload ?? {})])).rows[0];
      await c.query(`INSERT INTO family.request_event (tenant_id, request_id, from_status, to_status, note, actor_id)
        VALUES ($1,$2,NULL,'submitted','request received', $3)`, [req.user.tenant_id, row.id, req.user.id]);
      await emitEvent(c, req.user.tenant_id, { type: 'family', label: `Request: ${b.title}`, ref: row.id },
        'family.request.v1', { requestId: row.id, category: b.category });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: `Request filed (${b.category})`, recordType: 'FamilyRequest', recordRef: row.id,
        reason: String(b.title).slice(0, 160), policyRef: 'PARENTOS-PLAN §requests', risk: 'low', outcome: 'status submitted' });
      return { ok: true, requestId: row.id, status: row.status };
    });
  });

  app.get('/parent/requests', { preHandler: [require(...GUARDIAN), lifecycleGate] }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const rows = (await c.query(
        `SELECT r.id, r.category, r.title, r.status, r.created_at, r.sla_at,
          (SELECT json_agg(json_build_object('to', e.to_status, 'note', e.note, 'at', e.at) ORDER BY e.at)
           FROM family.request_event e WHERE e.request_id=r.id) AS events
         FROM family.request r WHERE r.guardian_id=$1 AND r.tenant_id=$2 ORDER BY r.created_at DESC LIMIT 50`,
        [req.user.id, req.user.tenant_id])).rows;
      return { requests: rows };
    });
  });

  // advance a request ticket (school/office act) — append-only status event (DAT-2)
  app.post('/parent/requests/:id/transition', { preHandler: [require(...STAFF_AUTHORITY), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!TICKET_STATUSES.includes(b.status)) return bad(reply, `Status must be one of: ${TICKET_STATUSES.join(', ')}`);
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = (await c.query(
        `SELECT id, guardian_id, status, title FROM family.request WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!r) return bad(reply, 'We couldn\'t find that request', 404);
      if (r.status === b.status) return bad(reply, `This request is already ${b.status}`, 409);
      const allowed = TICKET_TRANSITIONS[r.status] ?? [];
      if (!allowed.includes(b.status)) {
        return bad(reply, allowed.length
          ? `From ${r.status} a request can move to: ${allowed.join(', ')}`
          : `${r.status} is a final state — the request cannot move further`, 409);
      }
      // SEC-4: mark this transaction as a sanctioned transition so the append-only DB
      // guard (113) admits it; every other UPDATE that changes the status is refused.
      await c.query(`SELECT set_config('schoolos.family_request_transition', 'on', true)`);
      await c.query(`UPDATE family.request SET status=$2 WHERE id=$1`, [r.id, b.status]);
      await c.query(
        `INSERT INTO family.request_event (tenant_id, request_id, from_status, to_status, note, actor_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [req.user.tenant_id, r.id, r.status, b.status, b.note ? String(b.note).slice(0, 500) : null, req.user.id]);
      await c.query(
        `INSERT INTO app.notifications (tenant_id, user_id, "group", title, body, ref)
         VALUES ($1,$2,'needs-you',$3,$4,$5)`,
        [req.user.tenant_id, r.guardian_id, `Request update: ${r.title}`, `Your request is now ${String(b.status).replace('_', ' ')}.`, r.id]);
      await emitEvent(c, req.user.tenant_id, { type: 'family', label: `Request ${b.status}: ${r.title}`, ref: r.id },
        'family.request.v1', { requestId: r.id, from: r.status, to: b.status });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: `Request ${b.status}`, recordType: 'FamilyRequest', recordRef: r.id,
        reason: b.note ? String(b.note).slice(0, 200) : 'office ticket transition',
        policyRef: 'PARENTOS-PLAN §requests · append-only ticket', risk: 'low',
        outcome: `${r.status} → ${b.status}` });
      return { ok: true, requestId: r.id, status: b.status };
    });
  });

  // ── child-link management (school authority; DAT-3 / SEC-5) ─────────────────
  // Binding a guardian to a roster child was seed-only — production provisioning was
  // manual SQL. These three doors make the authorization table manageable: list, bind
  // (idempotent upsert) and unbind, all audited and event-spined. A guardian can never
  // reach them; only the school authority can change who sees a child.
  app.get('/parent/links', { preHandler: [require(...STAFF_AUTHORITY), lifecycleGate] }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const studentId = req.query?.studentId ? String(req.query.studentId) : null;
      const rows = (await c.query(
        `SELECT l.id, l.user_id, l.student_id, l.relation, l.is_primary, l.created_at,
                u.name AS guardian_name, u.email AS guardian_email,
                s.name AS child_name, s.grade, s.section
         FROM family.child_link l
         JOIN app.users u ON u.id = l.user_id AND u.tenant_id = l.tenant_id
         JOIN app.students s ON s.id = l.student_id AND s.tenant_id = l.tenant_id
         WHERE l.tenant_id=$1 AND ($2::uuid IS NULL OR l.student_id=$2::uuid)
         ORDER BY s.name, u.name`, [req.user.tenant_id, studentId])).rows;
      return { links: rows };
    });
  });

  app.post('/parent/links', { preHandler: [require(...STAFF_AUTHORITY), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.userId || !UUID.test(String(b.userId))) return bad(reply, 'Pick the guardian account to link');
    if (!b.studentId || !UUID.test(String(b.studentId))) return bad(reply, 'Pick the student to link');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const guardian = (await c.query(
        `SELECT id, name, role FROM app.users WHERE id=$1 AND tenant_id=$2 AND active`, [b.userId, req.user.tenant_id])).rows[0];
      if (!guardian) return bad(reply, 'We couldn\'t find that guardian account', 404);
      if (guardian.role !== 'parent') return bad(reply, 'Only a guardian (parent) account can be linked to a child');
      const student = (await c.query(
        `SELECT id, name FROM app.students WHERE id=$1 AND tenant_id=$2`, [b.studentId, req.user.tenant_id])).rows[0];
      if (!student) return bad(reply, 'We couldn\'t find that student', 404);
      const row = (await c.query(
        `INSERT INTO family.child_link (tenant_id, user_id, student_id, relation, is_primary)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (tenant_id, user_id, student_id)
         DO UPDATE SET relation=EXCLUDED.relation, is_primary=EXCLUDED.is_primary
         RETURNING id, user_id, student_id, relation, is_primary`,
        [req.user.tenant_id, guardian.id, student.id,
         b.relation ? String(b.relation).slice(0, 40) : 'guardian', b.isPrimary === true])).rows[0];
      // No event contract exists for link management (the published family contracts are
      // request/consent/child-leave); the append-only audit row below is the permanent record.
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Guardian linked to child', recordType: 'FamilyChildLink', recordRef: row.id,
        reason: `${guardian.name} → ${student.name}`, policyRef: 'PARENTOS-PLAN §53 (authorization table)', risk: 'medium',
        outcome: `relation ${row.relation}${row.is_primary ? ' (primary)' : ''}` });
      return { ok: true, link: row };
    });
  });

  app.delete('/parent/links/:id', { preHandler: [require(...STAFF_AUTHORITY), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const row = (await c.query(
        `SELECT l.id, u.name AS guardian_name, s.name AS child_name
         FROM family.child_link l
         JOIN app.users u ON u.id = l.user_id
         JOIN app.students s ON s.id = l.student_id
         WHERE l.id=$1 AND l.tenant_id=$2`, [req.params.id, req.user.tenant_id])).rows[0];
      if (!row) return bad(reply, 'We couldn\'t find that link', 404);
      await c.query(`DELETE FROM family.child_link WHERE id=$1 AND tenant_id=$2`, [row.id, req.user.tenant_id]);
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Guardian unlinked from child', recordType: 'FamilyChildLink', recordRef: row.id,
        reason: `${row.guardian_name} ✕ ${row.child_name}`, policyRef: 'PARENTOS-PLAN §53 (authorization table)', risk: 'medium',
        outcome: 'link removed — guardian can no longer read this child' });
      return { ok: true, id: row.id };
    });
  });

  app.post('/parent/report-discrepancy', { preHandler: [require(...GUARDIAN), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.recordRef || !b.whatWrong) return bad(reply, 'Tell us which record looks wrong and what seems off');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const row = (await c.query(
        `INSERT INTO family.request (tenant_id, guardian_id, category, title, payload, owner_role, sla_at)
         VALUES ($1,$2,'profile_correction',$3,$4,'coordinator', now() + interval '72 hours') RETURNING id`,
        [req.user.tenant_id, req.user.id,
         `Record correction: ${String(b.recordRef).slice(0, 80)}`,
         JSON.stringify({ record_ref: b.recordRef, what_wrong: String(b.whatWrong).slice(0, 1000), source: 'report-discrepancy' })])).rows[0];
      await c.query(`INSERT INTO family.request_event (tenant_id, request_id, to_status, note, actor_id)
        VALUES ($1,$2,'submitted','discrepancy reported — office will verify and correct if needed', $3)`,
        [req.user.tenant_id, row.id, req.user.id]);
      // S0 fix E8: this domain write now rides the event spine like its siblings.
      await emitEvent(c, req.user.tenant_id,
        { type: 'family', label: 'Discrepancy reported for verification', ref: row.id },
        'family.request.v1', { requestId: row.id, category: 'profile_correction', source: 'report-discrepancy' });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Discrepancy reported', recordType: 'FamilyRequest', recordRef: row.id,
        reason: String(b.recordRef).slice(0, 80), policyRef: 'PARENTOS-PLAN §82 (parents never edit records)', risk: 'low',
        outcome: 'routed to office for verification' });
      return { ok: true, requestId: row.id, note: 'The office will review and correct the record if needed. You can track this in your requests.' };
    });
  });

  // ── child leave (per-instance kernel action; office approves) ─────────────
  app.post('/parent/leave-request', { preHandler: [require(...GUARDIAN), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.childId || !b.kind || !b.dates || !b.reason) return bad(reply, 'Please choose the child, leave type, dates and a reason');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      if (!(await assertOwnChild(c, req.user.id, b.childId)))
        return bad(reply, 'This child is not linked to your family account', 403);
      const child = (await c.query(`SELECT name FROM app.students WHERE id=$1 AND tenant_id=$2`, [b.childId, req.user.tenant_id])).rows[0];
      const row = (await c.query(
        `INSERT INTO family.request (tenant_id, guardian_id, child_id, category, title, payload, owner_role, sla_at)
         VALUES ($1,$2,$3,'leave',$4,$5,'coordinator', now() + interval '48 hours') RETURNING id`,
        [req.user.tenant_id, req.user.id, b.childId,
         `Leave request for ${child?.name ?? 'child'} (${b.kind})`,
         JSON.stringify({ kind: b.kind, dates: b.dates, reason: String(b.reason).slice(0, 1000), doc_ref: b.docRef ?? null })])).rows[0];
      await c.query(`INSERT INTO family.request_event (tenant_id, request_id, to_status, note, actor_id)
        VALUES ($1,$2,'submitted','leave requested', $3)`, [req.user.tenant_id, row.id, req.user.id]);
      const actionId = (await c.query(
        `INSERT INTO app.actions (tenant_id, code, kind, title, detail, why, priority, status, owner, owner_role, policy_ref, ai_involved, source_event, payload, source_plugin)
         VALUES ($1,$2,'approval',$3,$4,$5,'normal','open','Coordinator','coordinator','PARENTOS-PLAN · child leave via kernel approval',false,$6,$7::jsonb,'family.view')
         RETURNING id`,
        [req.user.tenant_id, `parent.leave.${row.id}`,
         `Leave request: ${child?.name ?? 'child'} (${b.kind}, ${String(b.dates).slice(0, 60)})`,
         String(b.reason).slice(0, 300),
         'guardian-filed leave — office decides; attendance is never edited directly by parents',
         row.id,
         JSON.stringify({ kind: 'task', requestId: row.id, childId: b.childId, proposed_by: req.user.id })])).rows[0].id;
      await emitEvent(c, req.user.tenant_id, { type: 'family', label: `Leave requested — ${child?.name ?? 'child'}`, ref: row.id },
        'child.leave.requested.v1', { requestId: row.id, childId: b.childId, actionId });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Child leave requested', recordType: 'FamilyRequest', recordRef: row.id,
        reason: b.kind, policyRef: 'M8 student leave · kernel approval', risk: 'low',
        outcome: `kernel action ${actionId} raised` });
      return { ok: true, requestId: row.id, actionId, note: 'The school office will review this. You can track it in your requests.' };
    });
  });
}
