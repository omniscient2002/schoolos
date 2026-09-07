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

const ID = 'family.view';
export { default as manifest } from './manifest.js';

const GUARDIAN = ['parent'];
const STAFF_OVERSIGHT = ['owner', 'principal', 'itadmin', 'coordinator'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TICKET_STATUSES = ['submitted','received','assigned','in_progress','waiting_parent','resolved','closed'];
const REQUEST_CATEGORIES = ['leave','certificate','document','transport','activity','profile_correction','reevaluation','other'];
const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });

export function register(app, kernel) {
  const { withUser, requestAudit, emitEvent, require, q, settingsFor } = kernel;
  const lifecycleGate = makeLifecycleGate(kernel.q, ID);

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
          assignments = (await c.query(
            `SELECT h.id, h.title, h.subject, h.due_at, sub.status AS submission_status, sub.grade
             FROM teacher.homework h
             LEFT JOIN teacher.submission sub ON sub.homework_id=h.id AND sub.student_id=$1
             WHERE h.class_grade=$2 AND h.tenant_id=$3 AND h.due_at > now() - interval '7 days'
             ORDER BY h.due_at ASC LIMIT 20`, [ch.id, ch.grade, req.user.tenant_id])).rows;
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
          child_id: ch.id, name: ch.name, class_grade: ch.grade, section: ch.section,
          attendance_today: attToday, assignments, consents, attention,
        });
      }
      const requests = (await c.query(
        `SELECT id, category, title, status, created_at FROM family.request
         WHERE guardian_id=$1 AND tenant_id=$2 ORDER BY created_at DESC LIMIT 10`,
        [req.user.id, req.user.tenant_id])).rows;
      return { children: out, requests };
    });
  });

  // ── per-child timeline (evidence-only; own child) ──────────────────────────
  app.get('/parent/child/:id/timeline', { preHandler: [require(...GUARDIAN), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      if (!(await assertOwnChild(c, req.user.id, req.params.id)))
        return bad(reply, 'This child is not linked to your family account', 403);
      const events = [];
      const att = await c.query(
        `SELECT school_date AS date, status FROM app.attendance WHERE student_id=$1 AND tenant_id=$2 ORDER BY school_date DESC LIMIT 30`,
        [req.params.id, req.user.tenant_id]);
      for (const a of att.rows) events.push({ at: a.date, kind: 'attendance', text: a.status === 'present' ? 'Present' : a.status === 'absent' ? 'Absent' : `Attendance: ${a.status}` });
      if (await tableExists(c, 'teacher.submission')) {
        const sub = await c.query(
          `SELECT sub.submitted_at, sub.status, h.title, h.subject FROM teacher.submission sub
           JOIN teacher.homework h ON h.id=sub.homework_id WHERE sub.student_id=$1 AND sub.tenant_id=$2
           ORDER BY sub.submitted_at DESC LIMIT 30`, [req.params.id, req.user.tenant_id]);
        for (const s of sub.rows) events.push({ at: s.submitted_at, kind: 'homework', text: `${s.subject}: ${s.title} — ${s.status}` });
      }
      const rep = await c.query(
        `SELECT published_at, total_pct FROM plugin_exams.report r JOIN plugin_exams.exam e ON e.id=r.exam_id
         WHERE r.student_id=$1 AND r.tenant_id=$2 AND e.status='published' ORDER BY r.published_at DESC NULLS LAST LIMIT 10`,
        [req.params.id, req.user.tenant_id]).catch(() => ({ rows: [] }));
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
      const rep = (await c.query(
        `SELECT e.name AS exam_name, e.term, r.total_pct, r.grade, r.digest, r.published_at
         FROM plugin_exams.report r JOIN plugin_exams.exam e ON e.id=r.exam_id
         WHERE r.student_id=$1 AND r.tenant_id=$2 AND e.status='published'
         ORDER BY r.published_at DESC NULLS LAST LIMIT 12`, [req.params.id, req.user.tenant_id]).catch(() => ({ rows: [] }))).rows;
      return { reports: rep.map(r => ({ exam: r.exam_name, term: r.term, pct: r.total_pct, grade: r.grade, publishedAt: r.published_at,
        explain: r.pct == null ? 'Result details will appear here once the school publishes them.' :
          `This result is from ${r.exam_name}. It shows what was understood at that point — growth across results matters more than any single score.` })) };
    });
  });

  // ── attendance (approved-leave-aware) ──────────────────────────────────────
  app.get('/parent/child/:id/attendance', { preHandler: [require(...GUARDIAN), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      if (!(await assertOwnChild(c, req.user.id, req.params.id)))
        return bad(reply, 'This child is not linked to your family account', 403);
      const rows = (await c.query(
        `SELECT school_date AS date, status FROM app.attendance WHERE student_id=$1 AND tenant_id=$2 ORDER BY school_date DESC LIMIT 60`,
        [req.params.id, req.user.tenant_id])).rows;
      const month = rows.filter(r => new Date(r.date) >= new Date(Date.now() - 30 * 864e5));
      const present = month.filter(r => r.status === 'present').length;
      return {
        today: rows[0]?.status ?? null,
        month_pct: month.length ? Math.round((present / month.length) * 100) : null,
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
      const upcoming = (await c.query(
        `SELECT id, name, term, class_grade FROM plugin_exams.exam
         WHERE tenant_id=$1 AND class_grade=$2 AND status IN ('draft','published')
         ORDER BY created_at DESC LIMIT 8`, [req.user.tenant_id, (await c.query(`SELECT grade FROM app.students WHERE id=$1`, [req.params.id])).rows[0]?.grade]).catch(() => ({ rows: [] }))).rows;
      const published = (await c.query(
        `SELECT e.name AS exam, r.total_pct, r.grade FROM plugin_exams.report r JOIN plugin_exams.exam e ON e.id=r.exam_id
         WHERE r.student_id=$1 AND r.tenant_id=$2 AND e.status='published' ORDER BY r.published_at DESC NULLS LAST LIMIT 8`,
        [req.params.id, req.user.tenant_id]).catch(() => ({ rows: [] }))).rows;
      return { upcoming, published };
    });
  });

  // ── consents (immutable decisions) ─────────────────────────────────────────
  app.get('/parent/consents', { preHandler: [require(...GUARDIAN), lifecycleGate] }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const kids = (await myChildren(c, req.user.id)).map(k => k.id);
      const rows = kids.length ? (await c.query(
        `SELECT c.id, c.kind, c.title, c.due_at, c.status, s.name AS child
         FROM family.consent c JOIN app.students s ON s.id=c.student_id
         WHERE c.student_id = ANY($1) AND c.tenant_id=$2 ORDER BY (c.status='pending') DESC, c.due_at NULLS LAST`,
        [kids, req.user.tenant_id])).rows : [];
      return { consents: rows };
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
      return { ok: true, status: decision };
    });
  });

  // ── request center (append-only ticket) ────────────────────────────────────
  app.post('/parent/requests', { preHandler: [require(...GUARDIAN), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!REQUEST_CATEGORIES.includes(b.category)) return bad(reply, 'Choose what you need: leave, certificate, document, transport, activity, profile correction, re-evaluation or other');
    if (!b.title || !String(b.title).trim()) return bad(reply, 'Please add a short title');
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
        `INSERT INTO app.actions (tenant_id, code, kind, title, detail, why, priority, status, owner, owner_role, policy_ref, ai_involved, source_event, payload)
         VALUES ($1,$2,'approval',$3,$4,$5,'normal','open','Coordinator','coordinator','PARENTOS-PLAN · child leave via kernel approval',false,$6,$7::jsonb)
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
