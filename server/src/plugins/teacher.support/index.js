import { makeLifecycleGate } from '../_shared/lifecycle-gate.js';
import { uuidParams } from '../_shared/uuid-param.js';
import { pool } from '../../db.js';
// teacher.support — runtime module (migration 032, TeacherOS lane TS-2).
// Concerns (P10 · M9.2): one-tap staff flags; every status transition APPENDS a row to
// teacher.concern_status_event (append-only — the app role has no UPDATE/DELETE grant on
// history); routing is coordinator-authority with SoD (the filer cannot route their own
// flag, and a coordinator cannot route a concern to themselves); the counselor/principal
// designee records the outcome → closed. Safety-category or critical concerns raise the
// per-instance kernel approval action concern.escalate.<concernId> (UNIQUE(tenant,code)
// from birth — cycle-5 P1-1); the routes.js decide handler enforces proposer≠approver.
// Safety box (M9.1): anonymous student reports — when anonymous the door stores NO
// reporter identity (structural: nullable reporter pair + CHECK in 032) and the audit
// row is written actor-anonymously ('anonymous (student)' — safety_anonymous_audit).
// Reads are designated-authority only (full box: owner/principal/itadmin; designee
// queue via ?assigned=1); the teacher role is refused on every box door. Serious
// severity raises the per-instance kernel page safety.page.<boxId> to the principal.
// The weekly summary is counts by class/category — never identity, never unmasking.
// Doubts: deterministic timetable routing (subject → the teachers who teach it on the
// app.timetable_slots grid; most-frequent teacher, deterministic tie-break) — no AI.
// Interventions: identified→planned→in_progress→reassessed→improved|continue|escalate;
// every transition appends an intervention.plan_event row.
// PTM (M13.2): teachers publish slots; guardians book their OWN child (name-guarded);
// the ptm.invite.v1 receipt rides the comms rail; meeting notes are written/read through
// a dedicated user-scoped connection (RLS policy pins teacher_id to the schoolos.user_id
// GUC) — parents, students and other staff can never read them.
const ID = 'teacher.support';
export { default as manifest } from './manifest.js';

const CATEGORIES = ['academic', 'attendance', 'behaviour', 'wellbeing', 'safety', 'engagement'];
const URGENCIES = ['low', 'normal', 'high', 'critical'];
const BOX_CATEGORIES = ['bullying', 'harassment', 'ragging', 'abuse', 'self_harm', 'substance', 'facility', 'transport', 'other'];
const BOX_SEVERITIES = ['low', 'medium', 'high', 'serious'];
const CONCERN_OUTCOMES = ['resolved', 'monitoring', 'referred_out', 'escalated'];
const INTERVENTION_FLOW = ['identified', 'planned', 'in_progress', 'reassessed', 'improved', 'continue', 'escalate'];
const INTERVENTION_TRANSITIONS = {
  identified: ['planned'],
  planned: ['in_progress'],
  in_progress: ['reassessed'],
  reassessed: ['improved', 'continue', 'escalate'],
};
const STAFF = ['owner', 'principal', 'itadmin', 'coordinator', 'teacher'];       // staff-side surfaces
const ROUTE_AUTHORITY = ['owner', 'principal', 'itadmin', 'coordinator'];        // concern routing tier
const SAFEGUARD_AUTHORITY = ['owner', 'principal', 'itadmin'];                   // full safety-box authority
// designated box readers — every staff role EXCEPT teacher (never teachers, by rule)
const BOX_READERS = ['owner', 'principal', 'itadmin', 'coordinator', 'finance', 'admissions', 'transport', 'facilities', 'technician', 'counselor'];
const IST_NOW = () => new Date(Date.now() + 5.5 * 3600 * 1000); // Asia/Kolkata clock
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function register(app, kernel) {
  const { withUser, requestAudit, emitEvent, require } = kernel;
  const lifecycleGate = makeLifecycleGate(kernel.q, ID);
  const bad = (reply, error, code = 400) => reply.code(code).send({ error });
  const settingsFor = (c, tenantId) =>
    c.query(`SELECT settings FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`, [tenantId, ID])
      .then((r) => r.rows[0]?.settings ?? {});

  // PRIVATE teacher notes — a dedicated user-scoped connection: BOTH GUCs the RLS
  // policy reads are set (tenant + schoolos.user_id) and the role is constrained to
  // schoolos_app — the withUser discipline plus the user pin that makes notes
  // invisible to every other identity in the tenant (migration 032 policy).
  const withNoteUser = (tenantId, userId, fn) =>
    (async () => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await c.query(`SELECT set_config('schoolos.tenant_id', $1, true)`, [tenantId]);
        await c.query(`SELECT set_config('schoolos.user_id', $2, true)`, [userId]);
        await c.query(`SELECT set_config('schoolos.role', 'teacher', true)`);
        await c.query('SET LOCAL ROLE schoolos_app');
        const out = await fn(c);
        await c.query('COMMIT');
        return out;
      } catch (e) {
        try { await c.query('ROLLBACK'); } catch { /* noop */ }
        throw e;
      } finally {
        c.release();
      }
    })();

  // ═══════════════ CONCERNS (P10 · M9.2) ═══════════════

  // one-tap flag (staff) → status open
  app.post('/teacher/concern', { preHandler: [require(...STAFF), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.detail || !String(b.detail).trim()) return bad(reply, 'Please describe what you noticed');
    if (!CATEGORIES.includes(b.category)) return bad(reply, 'Choose a category: academic, attendance, behaviour, wellbeing, safety or engagement');
    if (!URGENCIES.includes(b.urgency ?? 'normal')) return bad(reply, 'Urgency must be low, normal, high or critical');
    if (b.studentId != null && !UUID.test(String(b.studentId))) return bad(reply, 'Pick a valid student');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      let studentName = null;
      if (b.studentId != null) {
        const s = await c.query(`SELECT id, name FROM app.students WHERE id=$1 AND tenant_id=$2`, [b.studentId, req.user.tenant_id]);
        if (!s.rows[0]) return bad(reply, 'We couldn\'t find that student', 404);
        studentName = s.rows[0].name;
      }
      const row = (await c.query(
        `INSERT INTO teacher.concern (tenant_id, student_id, filed_by, category, urgency, detail, evidence_ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, status`,
        [req.user.tenant_id, b.studentId ?? null, req.user.id, b.category, b.urgency ?? 'normal',
         String(b.detail).slice(0, 2000), b.evidenceRef ? String(b.evidenceRef).slice(0, 200) : null])).rows[0];
      // append-only lifecycle: the OPEN row is the first history event
      await c.query(
        `INSERT INTO teacher.concern_status_event (tenant_id, concern_id, from_status, to_status, note, actor_id)
         VALUES ($1,$2,NULL,'open',$3,$4)`,
        [req.user.tenant_id, row.id, 'concern filed', req.user.id]);
      // consequential escalation: safety-category or critical → per-instance kernel
      // approval action (UNIQUE(tenant_id, code) from birth — cycle-5 P1-1 lesson);
      // payload.proposed_by pins the SoD 403 in the decide handler.
      let escalateActionId = null;
      const s = await settingsFor(c, req.user.tenant_id);
      if (s.escalate_on_critical !== false && (b.category === 'safety' || (b.urgency ?? 'normal') === 'critical')) {
        escalateActionId = (await c.query(
          `INSERT INTO app.actions (tenant_id, code, kind, title, detail, why, priority, status, owner, owner_role, policy_ref, ai_involved, source_event, payload)
           VALUES ($1,$2,'approval',$3,$4,$5,'high','open','Principal','principal','M9.2 · TEACHEROS-PLAN §4 (concern escalation)',false,$6,$7::jsonb)
           RETURNING id`,
          [req.user.tenant_id, `concern.escalate.${row.id}`,
           `Review ${b.category} concern${studentName ? ` — ${studentName}` : ''} (filed ${IST_NOW().toISOString().slice(0, 10)})`,
           String(b.detail).slice(0, 300),
           'safety-category / critical concern needs designated review — a human decides, AI never diagnoses',
           row.id,
           JSON.stringify({ kind: 'task', concernId: row.id, category: b.category, urgency: b.urgency ?? 'normal', proposed_by: req.user.id })])).rows[0].id;
      }
      await emitEvent(c, req.user.tenant_id,
        { type: 'teacher', label: `Concern filed — ${b.category}${studentName ? ` (${studentName})` : ''}`, ref: row.id },
        'concern.filed.v1', { concernId: row.id, category: b.category, urgency: b.urgency ?? 'normal', studentId: b.studentId ?? null });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: `Concern filed (${b.category})`, recordType: 'TeacherConcern', recordRef: row.id,
        reason: 'one-tap concern flag', policyRef: 'M9.2 · TEACHEROS-PLAN §4', risk: b.category === 'safety' ? 'high' : 'medium',
        outcome: escalateActionId ? `status open · escalation action ${escalateActionId} raised (kernel approval required)` : 'status open' });
      return { ok: true, concernId: row.id, status: row.status, escalateActionId };
    });
  });

  // queue — role-scoped (the /my-cases privacy pattern): a teacher sees ONLY the
  // concerns they filed; oversight tier sees the board; anyone else routed-to-them.
  app.get('/teacher/concerns', { preHandler: [require(...STAFF, 'counselor'), lifecycleGate] }, async (req) => {
    const status = req.query.status ? String(req.query.status) : null;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const oversight = ROUTE_AUTHORITY.includes(req.user.role);
      const rows = (await c.query(
        `SELECT id, student_id, category, urgency, detail, evidence_ref, status, routed_to, routed_role, outcome, outcome_note, created_at
         FROM teacher.concern
         WHERE ($2::text IS NULL OR status=$2) AND (
           CASE WHEN $1::bool THEN TRUE                       -- oversight tier: the board
                ELSE (filed_by=$3::uuid OR routed_to=$3::uuid) END -- everyone else: own + routed-to-me
         ) ORDER BY created_at DESC LIMIT 200`,
        [oversight, status, req.user.id])).rows;
      const ids = [...new Set(rows.map((r) => r.student_id).filter(Boolean))];
      const names = ids.length ? (await c.query(`SELECT id, name FROM app.students WHERE id = ANY($1::uuid[])`, [ids])).rows : [];
      const nameById = Object.fromEntries(names.map((n) => [n.id, n.name]));
      return {
        scope: oversight ? 'oversight' : req.user.role === 'teacher' ? 'own_filed' : 'routed_to_me',
        concerns: rows.map((r) => ({
          concernId: r.id, studentId: r.student_id, studentName: r.student_id ? nameById[r.student_id] ?? null : null,
          category: r.category, urgency: r.urgency, detail: r.detail, evidenceRef: r.evidence_ref,
          status: r.status, routedTo: r.routed_to, routedRole: r.routed_role,
          outcome: r.outcome, outcomeNote: r.outcome_note,
          createdAt: r.created_at,
        })),
      };
    });
  });

  // coordinator routes → routed (SoD: filer can't route own flag; router ≠ designee)
  app.post('/teacher/concern/:id/route', { preHandler: [require(...ROUTE_AUTHORITY), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!['counselor', 'principal'].includes(b.routedRole)) return bad(reply, 'Route to the counselor or the principal desk');
    if (!b.routedTo || !UUID.test(String(b.routedTo))) return bad(reply, 'Pick the staff member this concern goes to');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const con = (await c.query(`SELECT id, status, filed_by, category, detail FROM teacher.concern WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!con) return bad(reply, 'We couldn\'t find that concern', 404);
      if (con.status !== 'open') return bad(reply, `Only an open concern can be routed (this one is ${con.status})`, 409);
      if (con.filed_by === req.user.id) return bad(reply, 'You filed this concern — routing it needs a different coordinator (segregation of duties)', 403);
      if (String(b.routedTo) === req.user.id) return bad(reply, 'A concern is routed to a different desk than the one routing it (segregation of duties)', 403);
      const staff = (await c.query(`SELECT id, name, role FROM app.users WHERE id=$1 AND tenant_id=$2 AND active`, [b.routedTo, req.user.tenant_id])).rows[0];
      if (!staff) return bad(reply, 'We couldn\'t find that staff member', 404);
      await c.query(
        `UPDATE teacher.concern SET status='routed', routed_to=$2, routed_role=$3, routed_by=$4, updated_at=now() WHERE id=$1`,
        [con.id, staff.id, b.routedRole, req.user.id]);
      await c.query(
        `INSERT INTO teacher.concern_status_event (tenant_id, concern_id, from_status, to_status, note, actor_id)
         VALUES ($1,$2,'open','routed',$3,$4)`,
        [req.user.tenant_id, con.id, `routed to ${b.routedRole} (${staff.name})`, req.user.id]);
      // the designee's queue notice: notification + the named concern.routed.v1
      // comms template (staff-lane record; a routing receipt, not a guardian send)
      await c.query(
        `INSERT INTO app.notifications (tenant_id, user_id, "group", title, body, ref)
         VALUES ($1,$2,'needs-you',$3,$4,$5)`,
        [req.user.tenant_id, staff.id, `Support queue: new ${con.category} concern`,
         `A ${con.category} concern was routed to you as ${b.routedRole}. Open your support queue to pick it up.`, con.id]);
      await c.query(
        `INSERT INTO app.communications (tenant_id, audience_json, channel, template, body, status, policy_ref, dedup_key)
         VALUES ($1,'[]'::jsonb,'in_app','concern.routed.v2','routing receipt — see notifications','queued','M9.2 · concern.routed.v1',$2)`,
        [req.user.tenant_id, con.id]);
      await emitEvent(c, req.user.tenant_id,
        { type: 'teacher', label: `Concern routed to ${b.routedRole}`, ref: con.id },
        'concern.routed.v1', { concernId: con.id, routedRole: b.routedRole, routedTo: staff.id, template: 'concern.routed.v1' });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Concern routed', recordType: 'TeacherConcern', recordRef: con.id,
        reason: 'coordinator routing', policyRef: 'M9.2 · concern.routed.v1', risk: 'low',
        outcome: `open → routed · ${b.routedRole} designee ${staff.name} · queue notice sent` });
      return { ok: true, concernId: con.id, status: 'routed', routedTo: staff.id, routedRole: b.routedRole };
    });
  });

  // designee outcome → closed (append event; the row keeps the current-status pointer)
  app.post('/teacher/concern/:id/outcome', { preHandler: [require(...STAFF, 'counselor'), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!CONCERN_OUTCOMES.includes(b.outcome)) return bad(reply, 'Outcome must be resolved, monitoring, referred_out or escalated');
    if (!b.note || !String(b.note).trim()) return bad(reply, 'Please add a short outcome note (what support was given)');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const con = (await c.query(`SELECT id, status, routed_to, filed_by FROM teacher.concern WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!con) return bad(reply, 'We couldn\'t find that concern', 404);
      if (con.status === 'closed') return bad(reply, 'This concern is already closed', 409);
      if (con.status === 'open') return bad(reply, 'Route the concern before recording an outcome — it needs a designated owner first', 409);
      const can = con.routed_to === req.user.id || ['owner', 'principal', 'counselor'].includes(req.user.role);
      if (!can) return bad(reply, 'Only the designated support owner can close this concern (the coordinator routes, support decides)', 403);
      await c.query(
        `UPDATE teacher.concern SET status='closed', outcome=$2, outcome_note=$3, closed_at=now(), updated_at=now() WHERE id=$1`,
        [con.id, b.outcome, String(b.note).slice(0, 1000)]);
      await c.query(
        `INSERT INTO teacher.concern_status_event (tenant_id, concern_id, from_status, to_status, note, actor_id)
         VALUES ($1,$2,$3,'closed',$4,$5)`,
        [req.user.tenant_id, con.id, con.status, `outcome: ${b.outcome}`, req.user.id]);
      await emitEvent(c, req.user.tenant_id,
        { type: 'teacher', label: `Concern closed (${b.outcome})`, ref: con.id },
        'concern.closed.v1', { concernId: con.id, outcome: b.outcome });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Concern closed', recordType: 'TeacherConcern', recordRef: con.id,
        reason: 'support outcome recorded', policyRef: 'M9.2 · append-only lifecycle', risk: 'low',
        outcome: `${con.status} → closed (${b.outcome}) — history row appended, never rewritten` });
      return { ok: true, concernId: con.id, status: 'closed', outcome: b.outcome };
    });
  });

  // status history — filer, designee or oversight (append-only event rows)
  app.get('/teacher/concern/:id/events', { preHandler: [require(...STAFF, 'counselor'), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const con = (await c.query(
        `SELECT id, filed_by, routed_to FROM teacher.concern WHERE id=$1 AND tenant_id=$2`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!con) return bad(reply, 'We couldn\'t find that concern', 404);
      const allowed = con.filed_by === req.user.id || con.routed_to === req.user.id || ROUTE_AUTHORITY.includes(req.user.role) || req.user.role === 'counselor';
      if (!allowed) return bad(reply, 'You don\'t have access to this concern\'s history', 403);
      const rows = (await c.query(
        `SELECT from_status, to_status, note, actor_id, created_at FROM teacher.concern_status_event
         WHERE concern_id=$1 AND tenant_id=$2 ORDER BY created_at, id`, [con.id, req.user.tenant_id])).rows;
      return { concernId: con.id, events: rows.map((r) => ({ from: r.from_status, to: r.to_status, note: r.note, actorId: r.actor_id, at: r.created_at })) };
    });
  });

  // ═══════════════ SAFETY BOX (M9.1 — anonymous by design) ═══════════════

  // student door. When anonymous we DO NOT bind, store or audit any reporter identity —
  // the audit actor is 'anonymous (student)' (safety_anonymous_audit).
  app.post('/safety/box', { preHandler: [require('student'), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.detail || !String(b.detail).trim()) return bad(reply, 'Please write what happened');
    if (!BOX_CATEGORIES.includes(b.category)) return bad(reply, 'Choose a category: bullying, harassment, ragging, abuse, self_harm, substance, facility, transport or other');
    if (!BOX_SEVERITIES.includes(b.severity ?? 'medium')) return bad(reply, 'Severity must be low, medium, high or serious');
    if (!b.classGrade || !/^[0-9]{1,2}$/.test(String(b.classGrade))) return bad(reply, 'Pick the class (a number like 6, 7, 8)');
    const anonymous = b.anonymous !== false; // anonymous is the DEFAULT — the safe direction
    const actor = anonymous ? 'anonymous (student)' : req.user.name;
    const reporterId = anonymous ? null : req.user.id;
    const severity = b.severity ?? 'medium';
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const row = (await c.query(
        `INSERT INTO safety.box (tenant_id, reporter_anonymous, reporter_user_id, class_grade, category, detail, severity)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, status`,
        [req.user.tenant_id, anonymous, reporterId, String(b.classGrade), b.category,
         String(b.detail).slice(0, 2000), severity])).rows[0];
      // serious severity → immediate principal page: per-instance kernel action code
      // safety.page.<boxId> (UNIQUE(tenant_id, code) satisfied from birth, cycle-5 P1-1)
      let pageActionId = null;
      const s = await settingsFor(c, req.user.tenant_id);
      if (severity === 'serious' && s.page_on_serious !== false) {
        pageActionId = (await c.query(
          `INSERT INTO app.actions (tenant_id, code, kind, title, detail, why, priority, status, owner, owner_role, policy_ref, ai_involved, source_event, payload)
           VALUES ($1,$2,'approval',$3,$4,$5,'critical','open','Principal','principal','M9.1 · serious safety report — immediate principal page',false,$6,$7::jsonb)
           RETURNING id`,
          [req.user.tenant_id, `safety.page.${row.id}`,
           `SAFETY PAGE — serious report, Class ${b.classGrade} (${b.category})`,
           String(b.detail).slice(0, 400),
           'serious student safety report — the designated authority must review immediately; reporter identity is not stored',
           row.id,
           JSON.stringify({ kind: 'task', boxId: row.id, category: b.category, severity, anonymous, proposed_by: reporterId })])).rows[0].id;
        await c.query(`UPDATE safety.box SET page_action_id=$2, updated_at=now() WHERE id=$1`, [row.id, pageActionId]);
      }
      await emitEvent(c, req.user.tenant_id,
        { type: 'safety', label: `Safety report filed — Class ${b.classGrade} · ${b.category} (${severity})`, severity: severity === 'serious' ? 'critical' : 'warn', ref: row.id },
        'safety.report.filed.v1', { boxId: row.id, classGrade: String(b.classGrade), category: b.category, severity, anonymous, pageActionId });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor, action: 'Safety report filed', recordType: 'SafetyReport', recordRef: row.id,
        reason: 'safety box intake', policyRef: 'M9.1 · safety_anonymous_audit', risk: severity === 'serious' ? 'high' : 'medium',
        outcome: pageActionId ? `submitted · principal page action ${pageActionId} raised` : 'submitted · queued for designated review' });
      return { ok: true, reportId: row.id, status: row.status, pageActionId, anonymous };
    });
  });

  // box reads — designated authority only, NEVER teachers. Full box: owner/principal/
  // itadmin. Any other designated staff see ONLY their assigned queue (?assigned=1).
  app.get('/safety/box', { preHandler: [require(...BOX_READERS), lifecycleGate] }, async (req, reply) => {
    const mine = req.query.assigned === '1' || req.query.assigned === 'true';
    const authority = SAFEGUARD_AUTHORITY.includes(req.user.role);
    if (mine && !authority && !['coordinator', 'counselor'].includes(req.user.role)) {
      return bad(reply, 'The safety box is read by the designated safeguarding authority only', 403);
    }
    if (!mine && !authority) {
      return bad(reply, 'The full safety box is designated-authority only — use your assigned queue (?assigned=1)', 403);
    }
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const rows = (await c.query(
        `SELECT b.id, b.reporter_anonymous, b.reporter_user_id, b.class_grade, b.category, b.detail,
                b.severity, b.status, b.assigned_to, b.page_action_id, b.created_at,
                u.name AS assigned_name, ru.name AS reporter_name
         FROM safety.box b
         LEFT JOIN app.users u ON u.id = b.assigned_to
         LEFT JOIN app.users ru ON ru.id = b.reporter_user_id
         WHERE b.tenant_id=$1
         ORDER BY b.created_at DESC LIMIT 200`,
        [req.user.tenant_id])).rows;
      const list = mine ? rows.filter((r) => r.assigned_to === req.user.id) : rows;
      return {
        scope: mine ? 'assigned_to_me' : 'full_box',
        reports: list.map((r) => ({
          reportId: r.id, anonymous: r.reporter_anonymous, classGrade: r.class_grade, category: r.category,
          detail: r.detail, severity: r.severity, status: r.status, assignedTo: r.assigned_to,
          assignedName: r.assigned_name, pageActionId: r.page_action_id, createdAt: r.created_at,
          // identified reports may name their reporter to the designated authority;
          // anonymous rows carry nothing — there is nothing to unmask
          reporter: r.reporter_anonymous ? null : { id: r.reporter_user_id, name: r.reporter_name },
        })),
      };
    });
  });

  // weekly pattern summary — counts by class/category only; NEVER identity, never unmasking
  app.get('/safety/box/summary', { preHandler: [require(...SAFEGUARD_AUTHORITY, 'counselor'), lifecycleGate] }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const rows = (await c.query(
        `SELECT class_grade, category, severity, count(*)::int AS n
         FROM safety.box WHERE tenant_id=$1 AND created_at > now() - interval '7 days'
         GROUP BY class_grade, category, severity ORDER BY n DESC`, [req.user.tenant_id])).rows;
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Safety box weekly summary read', recordType: 'SafetyReport', recordRef: 'weekly-summary',
        reason: 'pattern oversight', policyRef: 'M9.1 · pattern summary — counts only, never identity', risk: 'low',
        outcome: `${rows.length} class/category buckets in the last 7 days` });
      return {
        windowDays: 7,
        buckets: rows.map((r) => ({ classGrade: r.class_grade, category: r.category, severity: r.severity, count: r.n })),
        note: 'Counts by class and category only — reporter identity is never stored for anonymous reports and can never be recovered.',
      };
    });
  });

  // assign a report to a designated owner — never a teacher (structural "never teachers")
  app.post('/safety/box/:id/assign', { preHandler: [require(...SAFEGUARD_AUTHORITY), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.assignedTo || !UUID.test(String(b.assignedTo))) return bad(reply, 'Pick the designated staff member to assign');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const box = (await c.query(`SELECT id, status FROM safety.box WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!box) return bad(reply, 'We couldn\'t find that safety report', 404);
      if (box.status === 'closed') return bad(reply, 'This report is closed', 409);
      const staff = (await c.query(
        `SELECT id, name, role FROM app.users
         WHERE id=$1 AND tenant_id=$2 AND active
           AND role NOT IN ('teacher','parent','student')`,
        [b.assignedTo, req.user.tenant_id])).rows[0];
      if (!staff) return bad(reply, 'Safety reports are assigned to designated (non-teacher) staff only', 400);
      await c.query(`UPDATE safety.box SET status='assigned', assigned_to=$2, assigned_by=$3, updated_at=now() WHERE id=$1`,
        [box.id, staff.id, req.user.id]);
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Safety report assigned', recordType: 'SafetyReport', recordRef: box.id,
        reason: 'designated review ownership', policyRef: 'M9.1 · designated-authority reads only (never teachers)', risk: 'medium',
        outcome: `assigned to ${staff.name} (${staff.role})` });
      return { ok: true, reportId: box.id, status: 'assigned', assignedTo: staff.id, assignedName: staff.name };
    });
  });

  // close a report — safeguarding authority or the assigned designee
  app.post('/safety/box/:id/close', { preHandler: [require(...BOX_READERS), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    const note = req.body?.note ? String(req.body.note).slice(0, 500) : null;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const box = (await c.query(`SELECT id, status, assigned_to FROM safety.box WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!box) return bad(reply, 'We couldn\'t find that safety report', 404);
      if (box.status === 'closed') return bad(reply, 'This report is already closed', 409);
      const can = SAFEGUARD_AUTHORITY.includes(req.user.role) || box.assigned_to === req.user.id;
      if (!can) return bad(reply, 'Only the safeguarding authority or the assigned owner can close a report', 403);
      await c.query(`UPDATE safety.box SET status='closed', closed_at=now(), updated_at=now() WHERE id=$1`, [box.id]);
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Safety report closed', recordType: 'SafetyReport', recordRef: box.id,
        reason: 'review complete', policyRef: 'M9.1 · append-only facts, designated authority', risk: 'medium',
        outcome: note ? `closed: ${note}` : 'closed' });
      return { ok: true, reportId: box.id, status: 'closed' };
    });
  });

  // ═══════════════ DOUBT ROUTING (P10 — deterministic, no AI) ═══════════════

  // student asks → deterministic timetable routing
  app.post('/plugins/teacher.support/doubt', { preHandler: [require('student'), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.subject || !String(b.subject).trim()) return bad(reply, 'Pick the subject the doubt is about');
    if (!b.question || !String(b.question).trim()) return bad(reply, 'Write your question');
    const subject = String(b.subject).trim();
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // resolve the asker's class by name (seed corpus: the student user matches a student row)
      const grade = (await c.query(
        `SELECT grade FROM app.students WHERE tenant_id=$1 AND name=$2 ORDER BY id LIMIT 1`,
        [req.user.tenant_id, req.user.name])).rows[0]?.grade ?? null;
      // deterministic mapping: subject → the teachers who teach it on the timetable grid;
      // most-frequent teacher wins, tie-break alphabetical. NO AI anywhere in this path.
      let routedTo = null;
      let routedReason = 'queued — no matching teacher on the grid; the coordinator will re-route';
      if (grade) {
        const t = (await c.query(
          `SELECT teacher_name, count(*)::int AS n
           FROM app.timetable_slots
           WHERE tenant_id=$1 AND lower(subject)=lower($2)
           GROUP BY teacher_name
           ORDER BY n DESC, teacher_name
           LIMIT 1`,
          [req.user.tenant_id, subject])).rows[0];
        if (t) {
          const u = (await c.query(
            `SELECT id FROM app.users
             WHERE tenant_id=$1 AND role='teacher' AND active AND lower(name)=lower($2)
             ORDER BY id LIMIT 1`,
            [req.user.tenant_id, t.teacher_name])).rows[0];
          if (u) { routedTo = u.id; routedReason = `teaches ${subject} to Class ${grade} (timetable)`; }
        }
      }
      if (!routedTo) {
        // fallback: a teacher active in the school (deterministic tie-break on id);
        // reason names the fallback honestly — no fake precision
        const u = (await c.query(
          `SELECT id FROM app.users WHERE tenant_id=$1 AND role='teacher' AND active ORDER BY id LIMIT 1`,
          [req.user.tenant_id])).rows[0];
        if (u) { routedTo = u.id; routedReason = 'school teacher roster fallback (subject not on the grid)'; }
      }
      const row = (await c.query(
        `INSERT INTO support.doubt (tenant_id, asked_by, subject, topic, question, status, routed_to, routed_reason)
         VALUES ($1,$2,$3,$4,$5,'routed',$6,$7) RETURNING id`,
        [req.user.tenant_id, req.user.id, subject.slice(0, 80), b.topic ? String(b.topic).slice(0, 120) : null,
         String(b.question).slice(0, 2000), routedTo, routedReason])).rows[0];
      await emitEvent(c, req.user.tenant_id,
        { type: 'teacher', label: `Doubt routed — ${subject}`, ref: row.id },
        'doubt.routed.v1', { doubtId: row.id, subject, routedTo, routedReason, deterministic: true });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Doubt routed', recordType: 'SupportDoubt', recordRef: row.id,
        reason: 'deterministic timetable routing', policyRef: 'TEACHEROS-PLAN §4 P10 (no-AI routing)', risk: 'low',
        outcome: routedTo ? `routed via ${routedReason}` : routedReason });
      return { ok: true, doubtId: row.id, status: 'routed', routedTo, routedReason };
    });
  });

  // inbox — teachers see doubts routed to them; students see their own questions
  app.get('/teacher/support/doubts', { preHandler: [require('teacher', 'owner', 'principal', 'itadmin', 'coordinator', 'student'), lifecycleGate] }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const isTeacher = req.user.role === 'teacher';
      const rows = (await c.query(
        `SELECT d.id, d.subject, d.topic, d.question, d.status, d.routed_to, d.routed_reason,
                d.answer, d.answered_at, d.created_at, u.name AS asked_by_name
         FROM support.doubt d JOIN app.users u ON u.id = d.asked_by
         WHERE d.tenant_id=$1 AND (($2 AND d.routed_to=$3) OR (NOT $2 AND d.asked_by=$3))
         ORDER BY d.created_at DESC LIMIT 200`,
        [req.user.tenant_id, isTeacher, req.user.id])).rows;
      return {
        scope: isTeacher ? 'routed_to_me' : 'my_questions',
        doubts: rows.map((r) => ({
          doubtId: r.id, subject: r.subject, topic: r.topic, question: r.question, status: r.status,
          routedReason: r.routed_reason, answer: r.answer, answeredAt: r.answered_at,
          askedByName: r.asked_by_name, createdAt: r.created_at,
        })),
      };
    });
  });

  // teacher answers (routed teacher; oversight tier may answer any)
  app.post('/teacher/support/doubts/:id/answer', { preHandler: [require('teacher', 'owner', 'principal', 'itadmin', 'coordinator'), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.answer || !String(b.answer).trim()) return bad(reply, 'Write the answer first');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const d = (await c.query(`SELECT id, status, routed_to, subject FROM support.doubt WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!d) return bad(reply, 'We couldn\'t find that doubt', 404);
      if (d.status === 'promoted') return bad(reply, 'This doubt already became a class FAQ', 409);
      if (d.routed_to && d.routed_to !== req.user.id && req.user.role === 'teacher') return bad(reply, 'This doubt was routed to another teacher', 403);
      await c.query(`UPDATE support.doubt SET status='answered', answer=$2, answered_by=$3, answered_at=now(), updated_at=now() WHERE id=$1`,
        [d.id, String(b.answer).slice(0, 2000), req.user.id]);
      await emitEvent(c, req.user.tenant_id,
        { type: 'teacher', label: `Doubt answered — ${d.subject}`, ref: d.id },
        'doubt.answered.v1', { doubtId: d.id, subject: d.subject });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Doubt answered', recordType: 'SupportDoubt', recordRef: d.id,
        reason: 'teacher answer', policyRef: 'TEACHEROS-PLAN §4 P10', risk: 'low', outcome: 'routed → answered' });
      return { ok: true, doubtId: d.id, status: 'answered' };
    });
  });

  // promote an answered doubt to the class FAQ (UNIQUE(tenant, source_doubt_id) backstop)
  app.post('/teacher/support/doubts/:id/promote-faq', { preHandler: [require('teacher', 'owner', 'principal', 'itadmin', 'coordinator'), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const d = (await c.query(`SELECT id, status, subject, topic, question, answer FROM support.doubt WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!d) return bad(reply, 'We couldn\'t find that doubt', 404);
      if (d.status !== 'answered' || !d.answer) return bad(reply, 'Answer the doubt first — only answered questions can become FAQs', 409);
      try {
        const f = (await c.query(
          `INSERT INTO support.faq (tenant_id, subject, topic, question, answer, source_doubt_id, promoted_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [req.user.tenant_id, d.subject, d.topic, d.question, d.answer, d.id, req.user.id])).rows[0];
        await c.query(`UPDATE support.doubt SET status='promoted', updated_at=now() WHERE id=$1`, [d.id]);
        await emitEvent(c, req.user.tenant_id,
          { type: 'teacher', label: `FAQ promoted — ${d.subject}`, ref: f.id },
          'doubt.faq.promoted.v1', { faqId: f.id, doubtId: d.id, subject: d.subject });
        await requestAudit(c, req.user.tenant_id, ID, {
          actor: req.user.name, action: 'Doubt promoted to FAQ', recordType: 'SupportFaq', recordRef: f.id,
          reason: 'repeated doubts surface as class FAQs', policyRef: 'TEACHEROS-PLAN §4 P10', risk: 'low',
          outcome: `faq ${f.id} sourced from doubt ${d.id}` });
        return { ok: true, faqId: f.id, doubtId: d.id, status: 'promoted' };
      } catch (e) {
        if (e.code === '23505') return bad(reply, 'This doubt is already a class FAQ', 409);
        throw e;
      }
    });
  });

  // ═══════════════ INTERVENTIONS (P10 lifecycle) ═══════════════

  app.post('/interventions', { preHandler: [require(...STAFF), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.studentId || !UUID.test(String(b.studentId))) return bad(reply, 'Pick the student this plan supports');
    if (!b.objective || !String(b.objective).trim()) return bad(reply, 'State the objective (what should improve)');
    if (!b.activity || !String(b.activity).trim()) return bad(reply, 'Describe the support activity');
    if (b.targetEnd && !DATE.test(String(b.targetEnd))) return bad(reply, 'Target end date must be YYYY-MM-DD');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const st = (await c.query(`SELECT id FROM app.students WHERE id=$1 AND tenant_id=$2`, [b.studentId, req.user.tenant_id])).rows[0];
      if (!st) return bad(reply, 'We couldn\'t find that student', 404);
      const row = (await c.query(
        `INSERT INTO intervention.plan (tenant_id, student_id, owner_id, objective, activity, target_end, status)
         VALUES ($1,$2,$3,$4,$5,$6,'identified') RETURNING id, status`,
        [req.user.tenant_id, b.studentId, req.user.id, String(b.objective).slice(0, 500),
         String(b.activity).slice(0, 500), b.targetEnd ?? null])).rows[0];
      await c.query(
        `INSERT INTO intervention.plan_event (tenant_id, plan_id, from_status, to_status, note, actor_id)
         VALUES ($1,$2,NULL,'identified','plan created',$3)`,
        [req.user.tenant_id, row.id, req.user.id]);
      await emitEvent(c, req.user.tenant_id,
        { type: 'teacher', label: 'Intervention plan created (identified)', ref: row.id },
        'intervention.status.changed.v1', { planId: row.id, studentId: b.studentId, status: 'identified' });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Intervention plan created', recordType: 'InterventionPlan', recordRef: row.id,
        reason: 'student support plan', policyRef: 'TEACHEROS-PLAN §4 P10 · M9.2', risk: 'medium', outcome: 'status identified (append-only lifecycle)' });
      return { ok: true, planId: row.id, status: row.status };
    });
  });

  // list — teachers see plans they own; oversight tier sees all (optionally per student)
  app.get('/interventions', { preHandler: [require(...STAFF), lifecycleGate] }, async (req, reply) => {
    const studentId = req.query.student;
    if (studentId && !UUID.test(String(studentId))) return bad(reply, 'Student filter needs a valid ID');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const oversight = ROUTE_AUTHORITY.includes(req.user.role);
      const rows = (await c.query(
        `SELECT p.id, p.student_id, s.name AS student_name, p.owner_id, u.name AS owner_name,
                p.objective, p.activity, p.target_end, p.status, p.outcome, p.created_at, p.updated_at
         FROM intervention.plan p
         JOIN app.students s ON s.id = p.student_id
         JOIN app.users u ON u.id = p.owner_id
         WHERE p.tenant_id=$1 AND ($2::uuid IS NULL OR p.student_id=$2::uuid)
           AND ($3::bool OR p.owner_id=$4::uuid)
         ORDER BY p.created_at DESC LIMIT 200`,
        [req.user.tenant_id, studentId ?? null, oversight, req.user.id])).rows;
      return {
        scope: oversight ? 'oversight' : 'own_plans',
        plans: rows.map((r) => ({
          planId: r.id, studentId: r.student_id, studentName: r.student_name, ownerId: r.owner_id,
          ownerName: r.owner_name, objective: r.objective, activity: r.activity, targetEnd: r.target_end,
          status: r.status, outcome: r.outcome, createdAt: r.created_at, updatedAt: r.updated_at,
        })),
      };
    });
  });

  // lifecycle transition — append-only event rows, state machine enforced
  app.post('/interventions/:id/transition', { preHandler: [require(...STAFF), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    const to = b.to;
    if (!INTERVENTION_FLOW.includes(to)) return bad(reply, `Move the plan to one of: ${INTERVENTION_FLOW.join(', ')}`);
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const p = (await c.query(`SELECT id, status, owner_id FROM intervention.plan WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!p) return bad(reply, 'We couldn\'t find that intervention plan', 404);
      if (p.owner_id !== req.user.id && !ROUTE_AUTHORITY.includes(req.user.role)) {
        return bad(reply, 'Only the plan owner or the oversight tier can move a plan forward', 403);
      }
      const allowed = INTERVENTION_TRANSITIONS[p.status] ?? [];
      if (!allowed.includes(to)) {
        return bad(reply, allowed.length
          ? `From ${p.status} the plan can move to: ${allowed.join(', ')}`
          : `${p.status} is a final state — the plan cannot move further`, 409);
      }
      await c.query(`UPDATE intervention.plan SET status=$2, outcome=$3, updated_at=now() WHERE id=$1`,
        [p.id, to, ['improved', 'continue', 'escalate'].includes(to) ? (b.note ? String(b.note).slice(0, 500) : to) : null]);
      await c.query(
        `INSERT INTO intervention.plan_event (tenant_id, plan_id, from_status, to_status, note, actor_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [req.user.tenant_id, p.id, p.status, to, b.note ? String(b.note).slice(0, 500) : null, req.user.id]);
      await emitEvent(c, req.user.tenant_id,
        { type: 'teacher', label: `Intervention plan → ${to.replace('_', ' ')}`, ref: p.id },
        'intervention.status.changed.v1', { planId: p.id, from: p.status, to });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: `Intervention plan → ${to}`, recordType: 'InterventionPlan', recordRef: p.id,
        reason: 'lifecycle transition (append-only)', policyRef: 'TEACHEROS-PLAN §4 P10', risk: 'low',
        outcome: `${p.status} → ${to} — history row appended` });
      return { ok: true, planId: p.id, status: to };
    });
  });

  // ═══════════════ PTM (M13.2) + strictly private teacher notes ═══════════════

  // slot board — staff see their school's board; parents see it without other
  // families' booking details
  app.get('/ptm/slots', { preHandler: [require(...STAFF, 'parent'), lifecycleGate] }, async (req, reply) => {
    const date = req.query.date;
    if (date && !DATE.test(String(date))) return bad(reply, 'Date filter must be YYYY-MM-DD');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const rows = (await c.query(
        `SELECT sl.id, sl.teacher_id, u.name AS teacher_name, sl.slot_date, sl.start_time, sl.end_time, sl.status,
                b.id AS booking_id, b.student_id, s.name AS student_name
         FROM ptm.slot sl
         JOIN app.users u ON u.id = sl.teacher_id
         LEFT JOIN ptm.booking b ON b.slot_id = sl.id
         LEFT JOIN app.students s ON s.id = b.student_id
         WHERE sl.tenant_id=$1 AND ($2::date IS NULL OR sl.slot_date=$2::date)
         ORDER BY sl.slot_date, sl.start_time LIMIT 300`,
        [req.user.tenant_id, date ?? null])).rows;
      const isParent = req.user.role === 'parent';
      const slots = rows.map((r) => ({
        slotId: r.id, teacherId: r.teacher_id, teacherName: r.teacher_name, date: r.slot_date,
        startTime: r.start_time, endTime: r.end_time, status: r.status,
        booked: !!r.booking_id,
        ...(isParent ? {} : { bookedStudentId: r.student_id, bookedStudentName: r.student_name }),
      }));
      return { slots };
    });
  });

  // teachers publish their own slots
  app.post('/ptm/slots', { preHandler: [require('teacher'), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!DATE.test(String(b.date ?? ''))) return bad(reply, 'Slot date must be YYYY-MM-DD');
    if (!HHMM.test(String(b.startTime ?? '')) || !HHMM.test(String(b.endTime ?? ''))) return bad(reply, 'Times must be HH:MM (24-hour)');
    if (String(b.startTime) >= String(b.endTime)) return bad(reply, 'End time must be after the start time');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      try {
        const row = (await c.query(
          `INSERT INTO ptm.slot (tenant_id, teacher_id, slot_date, start_time, end_time)
           VALUES ($1,$2,$3::date,$4,$5) RETURNING id, status`,
          [req.user.tenant_id, req.user.id, b.date, b.startTime, b.endTime])).rows[0];
        await emitEvent(c, req.user.tenant_id,
          { type: 'ptm', label: `PTM slot published — ${req.user.name} ${b.date} ${b.startTime}`, ref: row.id },
          'ptm.slot.published.v1', { slotId: row.id, teacherId: req.user.id, date: b.date });
        await requestAudit(c, req.user.tenant_id, ID, {
          actor: req.user.name, action: 'PTM slot published', recordType: 'PtmSlot', recordRef: row.id,
          reason: 'parent-teacher meeting scheduling', policyRef: 'M13.2 · TEACHEROS-PLAN §4', risk: 'low',
          outcome: `${b.date} ${b.startTime}-${b.endTime} open for booking` });
        return { ok: true, slotId: row.id, status: row.status };
      } catch (e) {
        if (e.code === '23505') return bad(reply, 'You already have a slot at that time — pick another start time', 409);
        throw e;
      }
    });
  });

  // guardian books their OWN child (name-guarded, the /students parent pattern)
  app.post('/ptm/book', { preHandler: [require('parent'), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.slotId || !UUID.test(String(b.slotId))) return bad(reply, 'Pick a slot to book');
    if (!b.studentId || !UUID.test(String(b.studentId))) return bad(reply, 'Pick your child for this meeting');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const slot = (await c.query(`SELECT id, slot_date, start_time, end_time, status FROM ptm.slot WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [b.slotId, req.user.tenant_id])).rows[0];
      if (!slot) return bad(reply, 'We couldn\'t find that slot', 404);
      if (slot.status !== 'open') return bad(reply, `That slot is already ${slot.status}`, 409);
      const child = (await c.query(`SELECT id, name, guardian_name FROM app.students WHERE id=$1 AND tenant_id=$2`,
        [b.studentId, req.user.tenant_id])).rows[0];
      if (!child) return bad(reply, 'We couldn\'t find that student', 404);
      if (child.guardian_name !== req.user.name) {
        return bad(reply, 'You can only book meetings for your own child', 403);
      }
      let bk;
      try {
        bk = (await c.query(
          `INSERT INTO ptm.booking (tenant_id, slot_id, student_id, guardian_id) VALUES ($1,$2,$3,$4) RETURNING id`,
          [req.user.tenant_id, slot.id, child.id, req.user.id])).rows[0];
      } catch (e) {
        if (e.code === '23505') return bad(reply, 'Someone just booked that slot — pick another', 409);
        throw e;
      }
      await c.query(`UPDATE ptm.slot SET status='booked', updated_at=now() WHERE id=$1`, [slot.id]);
      // transactional receipt on the comms rail, named template ptm.invite.v1
      // (M13.2 — a booking confirmation is a receipt, not a guardian notice; the
      // kernel-approval doctrine governs notices, receipts ride the rail with a
      // dedup key and a policy ref, attendance ABSENCE_NOTICE precedent)
      await c.query(
        `INSERT INTO app.communications (tenant_id, audience_json, channel, template, body, status, policy_ref, dedup_key)
         VALUES ($1,$2::jsonb,'whatsapp','ptm.invite.v1',$3,'queued','M13.2 · ptm.invite.v1 (transactional receipt)',$4)`,
        [req.user.tenant_id, JSON.stringify([req.user.email]),
         `PTM confirmed — ${slot.slot_date} ${slot.start_time} (${child.name}). Please arrive 5 minutes early.`,
         bk.id]);
      await emitEvent(c, req.user.tenant_id,
        { type: 'ptm', label: `PTM booked — ${child.name} (${slot.slot_date} ${slot.start_time})`, ref: bk.id },
        'ptm.booked.v1', { bookingId: bk.id, slotId: slot.id, studentId: child.id, template: 'ptm.invite.v1' });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'PTM slot booked', recordType: 'PtmBooking', recordRef: bk.id,
        reason: 'guardian booking (own child enforced)', policyRef: 'M13.2 · ptm.invite.v1', risk: 'low',
        outcome: `slot ${slot.id} → booked · ptm.invite.v1 receipt queued` });
      return { ok: true, bookingId: bk.id, slotId: slot.id, status: 'booked', inviteTemplate: 'ptm.invite.v1' };
    });
  });

  // PRIVATE teacher meeting notes — teacher-only doors; the meeting teacher's own
  // user-pinned connection (RLS: teacher_id = schoolos.user_id). Parents and students
  // have no door at all; other staff are refused.
  app.post('/ptm/:id/notes', { preHandler: [require('teacher'), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.note || !String(b.note).trim()) return bad(reply, 'Write the meeting note first');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const bk = (await c.query(
        `SELECT b.id, b.student_id, s.name AS student_name, sl.teacher_id, sl.slot_date
         FROM ptm.booking b JOIN ptm.slot sl ON sl.id = b.slot_id JOIN app.students s ON s.id = b.student_id
         WHERE b.id=$1 AND b.tenant_id=$2`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!bk) return bad(reply, 'We couldn\'t find that PTM booking', 404);
      if (bk.teacher_id !== req.user.id) return bad(reply, 'PTM notes are private to the meeting teacher', 403);
      await withNoteUser(req.user.tenant_id, req.user.id, (nc) => nc.query(
        `INSERT INTO teacher.note (tenant_id, teacher_id, booking_id, student_id, note)
         VALUES ($1,$2,$3,$4,$5)`,
        [req.user.tenant_id, req.user.id, bk.id, bk.student_id, String(b.note).slice(0, 2000)]));
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'PTM private note saved', recordType: 'TeacherNote', recordRef: bk.id,
        reason: 'meeting notes (strictly teacher-private)', policyRef: 'P11 · teacher-only RLS (schoolos.user_id pin)', risk: 'medium',
        outcome: 'note stored under the meeting teacher\'s private ledger — never exposed to parents or students' });
      return { ok: true, bookingId: bk.id, saved: true, private: true };
    });
  });

  app.get('/ptm/:id/notes', { preHandler: [require('teacher'), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const bk = (await c.query(
        `SELECT b.id, sl.teacher_id FROM ptm.booking b JOIN ptm.slot sl ON sl.id = b.slot_id
         WHERE b.id=$1 AND b.tenant_id=$2`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!bk) return bad(reply, 'We couldn\'t find that PTM booking', 404);
      if (bk.teacher_id !== req.user.id) return bad(reply, 'PTM notes are private to the meeting teacher', 403);
      // reads go through the same user-pinned path — the RLS policy is the guarantee,
      // not just the door check
      const r = await withNoteUser(req.user.tenant_id, req.user.id, (nc) => nc.query(
        `SELECT n.id, n.note, n.created_at FROM teacher.note n
         WHERE n.tenant_id=$1 AND n.booking_id=$2 ORDER BY n.created_at`,
        [req.user.tenant_id, bk.id]));
      return { bookingId: bk.id, notes: r.rows.map((n) => ({ noteId: n.id, note: n.note, at: n.created_at })), private: true };
    });
  });
}
