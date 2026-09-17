// coord.view — runtime module (migration 037, CoordinatorOS lane CS-1).
// The coordinator is the school's EXECUTION AUTHORITY. Every door answers one of
// the coordination questions: who is off today / where are the gaps / what needs a
// decision / is the curriculum on pace / is staff load fair / what is escalated.
// Design invariants (pinned by tests/coord-view.test.js):
//   · EXECUTION AUTHORITY — decide doors verify the kernel action is
//     owner_role='coordinator'; the principal may read everywhere but a decision
//     executes only through the coordinator-owned action (mirrors the routes.js
//     kernel decide path: load, FOR UPDATE, SoD proposer≠decider, audit).
//   · FAIRNESS, NOT RANKING — the workload door returns per-teacher AGGREGATES with
//     a boolean overload flag (extra duties beyond a monthly threshold). There is
//     deliberately NO score, NO rank, NO ordering by load anywhere in the payload —
//     a load table is a rostering aid, not a teacher rating.
//   · PRIVACY TIERING — workload doors return aggregates only (no student data).
//     Escalations carry student identity ONLY where the coordinator is the routed
//     authority (family.request rows owned by 'coordinator', or concerns still open
//     awaiting routing / routed to the coordinator desk); concerns routed to the
//     counselor/principal desks appear without student identity.
//   · DETERMINISTIC COPILOT (v0) — keyword intents over the coordinator's own door
//     data, honest empty answers (it never invents), every call writes a
//     coord.copilot_call budget row; 200/month per user → 429 (A2 budget class
//     coordinator_tier). No model is contacted anywhere in v0.
//   · GRACEFUL DEGRADATION — sibling-lane tables (teacher.*, curriculum.*,
//     plugin_hr.leave, duty.assignment, app.timetable_*) are read via
//     information_schema probes (teacher.support convention); absent tables yield
//     empty/degraded sections, never 500s.
import { makeLifecycleGate } from '../_shared/lifecycle-gate.js';

const ID = 'coord.view';
export { default as manifest } from './manifest.js';

const AUTHORITY = ['coordinator', 'principal'];            // every coord door
const DUTY_KINDS = ['duty', 'invigilation', 'event', 'exam'];
const EXTRA_LOAD_LIMIT = 8;   // fairness threshold: substitutions+invigilation+duties/month
const COPILOT_MONTHLY_CAP = 200;                           // A2 budget class coordinator_tier
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });
const istNow = () => new Date(Date.now() + 5.5 * 3600 * 1000);   // Asia/Kolkata clock
const istDate = () => istNow().toISOString().slice(0, 10);
const dowName = () => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][istNow().getUTCDay()];
const round1 = (x) => Math.round(x * 10) / 10;

// ── term pace (deterministic Indian academic calendar) ─────────────────────────
// Academic year Apr 1 – Mar 31. Term 1: Apr–Sep; Term 2: Oct–Mar. expected_pct =
// days elapsed / total days × 100 — a fraction of the term, never a judgement.
export function termPace(now = istNow()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-based
  let start;
  let end;
  if (m >= 3 && m <= 8) { start = new Date(Date.UTC(y, 3, 1)); end = new Date(Date.UTC(y, 9, 1)); }        // Apr 1 – Sep 30
  else if (m >= 9) { start = new Date(Date.UTC(y, 9, 1)); end = new Date(Date.UTC(y + 1, 3, 1)); }         // Oct 1 – Mar 31
  else { start = new Date(Date.UTC(y - 1, 9, 1)); end = new Date(Date.UTC(y, 3, 1)); }                     // Jan–Mar
  const daysTotal = Math.round((end - start) / 864e5);
  const daysElapsed = Math.min(daysTotal, Math.max(0, Math.round((now - start) / 864e5)));
  const expectedPct = daysTotal > 0 ? Math.min(100, Math.round((daysElapsed / daysTotal) * 100)) : 0;
  return { daysElapsed, daysTotal, termWeeks: round1(daysTotal / 7), expectedPct };
}

export function weeksBehind(coveredPct, expectedPct, termWeeks) {
  return Math.max(0, round1(((expectedPct - coveredPct) / 100) * termWeeks));
}

export function register(app, kernel) {
  const { withUser, requestAudit, emitEvent, require, sysq } = kernel;
  const lifecycleGate = makeLifecycleGate(sysq, ID);

  const tableExists = async (c, schema, name) =>
    !!(await c.query(`SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2`, [schema, name])).rows.length;

  // ═══════════ shared aggregations (doors + copilot grounding) ═══════════

  // staffing today: absences from hr.leave facts + approved teacher leave, periods
  // affected from the timetable grid; gaps = absent teachers' slots without an
  // effective substitution overlay for today.
  async function staffingToday(c, tenantId) {
    const today = istDate();
    const dow = dowName();
    const teachers = (await c.query(
      `SELECT id, name FROM app.users WHERE tenant_id=$1 AND role='teacher' AND active ORDER BY name`, [tenantId])).rows;
    const hasSlots = await tableExists(c, 'app', 'timetable_slots');
    const hasPeriods = hasSlots && (await tableExists(c, 'app', 'timetable_periods'));
    const hasLeave = await tableExists(c, 'teacher', 'leave_request');
    const hasHr = await tableExists(c, 'plugin_hr', 'leave');
    const hasSubs = hasSlots && (await tableExists(c, 'app', 'timetable_substitutions'));

    const slots = hasSlots ? (await c.query(
      `SELECT s.id, s.teacher_name, s.subject${hasPeriods ? ', p.seq AS period_seq, p.label AS period_label' : ''}
       FROM app.timetable_slots s${hasPeriods ? ' JOIN app.timetable_periods p ON p.id = s.period_id' : ''}
       WHERE s.tenant_id=$1 AND s.day_of_week=$2`, [tenantId, dow])).rows : [];
    const slotsByName = new Map();
    for (const s of slots) {
      if (!slotsByName.has(s.teacher_name)) slotsByName.set(s.teacher_name, []);
      slotsByName.get(s.teacher_name).push(s);
    }

    const leaveToday = hasLeave ? (await c.query(
      `SELECT teacher_id, kind FROM teacher.leave_request
       WHERE tenant_id=$1 AND status='approved' AND from_date <= $2::date AND to_date >= $2::date`,
      [tenantId, today])).rows : [];
    const hrToday = hasHr ? (await c.query(
      `SELECT staff_id, kind FROM plugin_hr.leave
       WHERE tenant_id=$1 AND status='marked' AND leave_date=$2::date`, [tenantId, today])).rows : [];
    const awayById = new Map();
    for (const r of [...leaveToday.map((r) => ({ id: r.teacher_id, kind: r.kind })), ...hrToday.map((r) => ({ id: r.staff_id, kind: r.kind }))]) {
      // a sick fact grades the day 'absent'; planned leave grades 'on_leave'
      awayById.set(r.id, awayById.get(r.id) === 'absent' || r.kind === 'sick' ? 'absent' : 'on_leave');
    }

    const staffing = teachers.map((t) => {
      const status = awayById.get(t.id) ?? 'present';
      return {
        teacher: t.name,
        status,
        periods_affected: status === 'present' ? 0 : (slotsByName.get(t.name)?.length ?? 0),
      };
    });

    const absentNames = staffing.filter((s) => s.status !== 'present').map((s) => s.teacher);
    let gaps = [];
    if (absentNames.length && hasSubs) {
      const uncovered = (await c.query(
        `SELECT s.id, s.teacher_name, s.subject${hasPeriods ? ', p.seq AS period_seq' : ''}
         FROM app.timetable_slots s${hasPeriods ? ' JOIN app.timetable_periods p ON p.id = s.period_id' : ''}
         WHERE s.tenant_id=$1 AND s.day_of_week=$2 AND s.teacher_name = ANY($3::text[])
           AND NOT EXISTS (SELECT 1 FROM app.timetable_substitutions x
                           WHERE x.slot_id = s.id AND x.date=$4::date AND x.status <> 'cancelled')
         ORDER BY s.teacher_name, s.subject`, [tenantId, dow, absentNames, today])).rows;
      gaps = uncovered.map((g) => ({
        // the v1 timetable grid is section-agnostic (ops.timetable): it carries no
        // class column, so class_grade is null until the grid grows one — said plainly
        class_grade: null,
        period: g.period_seq ?? null,
        subject: g.subject,
        uncovered: true,
      }));
    }
    return { staffing, gaps, absentTeachers: absentNames };
  }

  // curriculum monitor: per class_grade × subject over the topic tree; covered_pct
  // is the average check-off across topics, expected_pct is term pace.
  async function curriculumMonitor(c, tenantId) {
    const hasNode = await tableExists(c, 'curriculum', 'node');
    const hasProgress = await tableExists(c, 'curriculum', 'progress');
    if (!hasNode) return { available: false, monitor: [] };
    const raw = (await c.query(
      `SELECT n.subject, n.grade AS class_grade,
              ROUND(AVG(COALESCE(p.covered_pct, 0)))::int AS covered_pct,
              count(*)::int AS topics
       FROM curriculum.node n
       LEFT JOIN curriculum.progress p
         ON p.node_id = n.id AND p.class_grade = n.grade ${hasProgress ? 'AND p.tenant_id = n.tenant_id' : 'AND FALSE'}
       WHERE n.tenant_id=$1 AND n.kind='topic'
       GROUP BY n.subject, n.grade
       ORDER BY n.subject, n.grade`, [tenantId])).rows;
    const pace = termPace();
    const monitor = raw.map((r) => {
      const weeks = weeksBehind(r.covered_pct, pace.expectedPct, pace.termWeeks);
      return {
        class_grade: r.class_grade,
        subject: r.subject,
        topics: r.topics,
        covered_pct: r.covered_pct,
        expected_pct: pace.expectedPct,
        weeks_behind: weeks,
        revision_needed: weeks >= 1,
      };
    });
    return { available: true, pace, monitor };
  }

  // teacher workload: AGGREGATES ONLY (staffing facts + duty counts) — no student
  // data anywhere. overload = fairness flag on extra load, never a score/rank.
  async function teacherWorkload(c, tenantId) {
    const monthStart = `(date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date)`;
    const teachers = (await c.query(
      `SELECT id, name FROM app.users WHERE tenant_id=$1 AND role='teacher' AND active ORDER BY name`, [tenantId])).rows;
    const hasSlots = await tableExists(c, 'app', 'timetable_slots');
    const hasSubs = hasSlots && (await tableExists(c, 'app', 'timetable_substitutions'));
    const hasDuty = await tableExists(c, 'duty', 'assignment');
    const hasGrading = (await tableExists(c, 'teacher', 'homework')) && (await tableExists(c, 'teacher', 'submission'));

    const periodRows = hasSlots ? (await c.query(
      `SELECT lower(teacher_name) AS k, count(*)::int AS n FROM app.timetable_slots
       WHERE tenant_id=$1 GROUP BY lower(teacher_name)`, [tenantId])).rows : [];
    const periodBy = Object.fromEntries(periodRows.map((r) => [r.k, r.n]));
    const subRows = hasSubs ? (await c.query(
      `SELECT lower(substitute) AS k, count(*)::int AS n FROM app.timetable_substitutions
       WHERE tenant_id=$1 AND date >= ${monthStart} GROUP BY lower(substitute)`, [tenantId])).rows : [];
    const subBy = Object.fromEntries(subRows.map((r) => [r.k, r.n]));
    const dutyRows = hasDuty ? (await c.query(
      `SELECT teacher_id, kind, count(*)::int AS n FROM duty.assignment
       WHERE tenant_id=$1 AND duty_date >= ${monthStart} GROUP BY teacher_id, kind`, [tenantId])).rows : [];
    const dutyBy = new Map();
    for (const r of dutyRows) {
      const cur = dutyBy.get(r.teacher_id) ?? { duty: 0, invigilation: 0 };
      if (r.kind === 'invigilation' || r.kind === 'exam') cur.invigilation += r.n;
      else cur.duty += r.n;
      dutyBy.set(r.teacher_id, cur);
    }
    const gradingRows = hasGrading ? (await c.query(
      `SELECT h.created_by, count(*)::int AS n
       FROM teacher.submission sub JOIN teacher.homework h ON h.id = sub.homework_id
       WHERE sub.tenant_id=$1 AND sub.status IN ('submitted','late')
       GROUP BY h.created_by`, [tenantId])).rows : [];
    const gradingBy = Object.fromEntries(gradingRows.map((r) => [r.created_by, r.n]));

    const workload = teachers.map((t) => {
      const periodsWeek = hasSlots ? (periodBy[t.name.toLowerCase()] ?? 0) : null;
      const subsMonth = hasSubs ? (subBy[t.name.toLowerCase()] ?? 0) : null;
      const d = dutyBy.get(t.id) ?? { duty: hasDuty ? 0 : null, invigilation: hasDuty ? 0 : null };
      const gradingEst = hasGrading ? (gradingBy[t.id] ?? 0) : null;
      const extra = (subsMonth ?? 0) + (d.invigilation ?? 0) + (d.duty ?? 0);
      return {
        teacher_id: t.id,
        name: t.name,
        periods_week: periodsWeek,
        substitutions_month: subsMonth,
        invigilation: d.invigilation,
        duties: d.duty,
        grading_est: gradingEst,
        overload: extra >= EXTRA_LOAD_LIMIT,
      };
    });
    return {
      threshold: { extra_load_per_month: EXTRA_LOAD_LIMIT, basis: 'substitutions + invigilation + duties this month' },
      workload,
      note: 'Fairness view: extra-load flags for rostering balance only — never a score, never a ranking.',
    };
  }

  async function pendingApprovals(c, tenantId) {
    return (await c.query(
      `SELECT id, code, kind, title,
              ROUND(EXTRACT(EPOCH FROM (now() - created_at)) / 3600.0, 1)::float8 AS age_hours
       FROM app.actions
       WHERE tenant_id=$1 AND owner_role='coordinator' AND status='open'
       ORDER BY created_at ASC LIMIT 100`, [tenantId])).rows
      .map((a) => ({ action_id: a.id, code: a.code, kind: a.kind, title: a.title, age_hours: a.age_hours }));
  }

  async function openIssues(c, tenantId) {
    if (!(await tableExists(c, 'teacher', 'concern'))) return [];
    return (await c.query(
      `SELECT cc.id, cc.category, cc.urgency, cc.status, cc.routed_role, cc.routed_to, cc.student_id,
              (SELECT max(e.created_at) FROM teacher.concern_status_event e
                WHERE e.concern_id = cc.id AND e.to_status='routed') AS routed_at,
              s.name AS student_name
       FROM teacher.concern cc
       LEFT JOIN app.students s ON s.id = cc.student_id
       WHERE cc.tenant_id=$1 AND cc.status <> 'closed'
       ORDER BY cc.created_at DESC LIMIT 100`, [tenantId])).rows
      .map((r) => ({
        concern_id: r.id,
        category: r.category,
        urgency: r.urgency,
        // student identity only where the coordinator is the routed authority
        student: r.status === 'open' || r.routed_role === 'coordinator' ? r.student_name : null,
        routed_at: r.routed_at,
      }));
  }

  // ═══════════════════ doors ═══════════════════

  app.get('/coord/home', { preHandler: [require(...AUTHORITY), lifecycleGate] }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // sequential on the ONE transaction client (Promise.all would interleave queries
      // on a shared connection — pg deprecation + ordering hazards)
      const { staffing, gaps } = await staffingToday(c, req.user.tenant_id);
      const monitor = await curriculumMonitor(c, req.user.tenant_id);
      const approvals = await pendingApprovals(c, req.user.tenant_id);
      const issues = await openIssues(c, req.user.tenant_id);
      const curriculumDelays = monitor.monitor
        .filter((m) => m.weeks_behind > 0)
        .map(({ class_grade, subject, covered_pct, expected_pct, weeks_behind }) =>
          ({ class_grade, subject, covered_pct, expected_pct, weeks_behind }));
      return {
        date: istDate(),
        staffing_today: staffing,
        substitution_gaps: gaps,
        grid_note: 'the v1 timetable grid is section-agnostic (ops.timetable) — gaps carry period + subject; class_grade is null until the grid grows a class column',
        pending_approvals: approvals,
        curriculum_delays: curriculumDelays,
        open_issues: issues,
      };
    });
  });

  app.get('/coord/curriculum-monitor', { preHandler: [require(...AUTHORITY), lifecycleGate] }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const m = await curriculumMonitor(c, req.user.tenant_id);
      if (!m.available) return { available: false, monitor: [], note: 'The curriculum data plane is not built yet — the monitor will fill in once the curriculum tree exists.' };
      return {
        available: true,
        pace: { days_elapsed: m.pace.daysElapsed, days_total: m.pace.daysTotal, term_weeks: m.pace.termWeeks, expected_pct: m.pace.expectedPct },
        monitor: m.monitor,
        note: 'expected_pct is term pace (days elapsed / total × 100, IST academic calendar); weeks_behind = (expected − covered)/100 × term weeks; revision_needed at ≥ 1 week. Pace is a fraction of the term — never a rank.',
      };
    });
  });

  app.get('/coord/teacher-workload', { preHandler: [require(...AUTHORITY), lifecycleGate] }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const w = await teacherWorkload(c, req.user.tenant_id);
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Teacher workload read', recordType: 'TeacherWorkload', recordRef: 'workload',
        reason: 'fairness oversight', policyRef: 'COORDINATOROS-PLAN · fairness framing — aggregates only, no student data, never a score/rank', risk: 'low',
        outcome: `${w.workload.length} teachers · ${w.workload.filter((x) => x.overload).length} over the extra-load threshold` });
      return w;
    });
  });

  // kernel decide path (routes.js pattern) for coordinator-owned substitution actions
  app.post('/coord/substitution/decide', { preHandler: [require(...AUTHORITY), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!UUID.test(String(b.action_id ?? ''))) return bad(reply, 'This decision needs a valid action ID');
    if (!['approved', 'rejected'].includes(b.decision)) return bad(reply, 'Decision must be approved or rejected');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const a = (await c.query(
        `SELECT id, code, kind, title, status, owner_role, policy_ref, payload FROM app.actions
         WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [b.action_id, req.user.tenant_id])).rows[0];
      if (!a) return bad(reply, 'We couldn\'t find that action', 404);
      if (a.status !== 'open') return bad(reply, `This action is already ${a.status}`, 409);
      // execution authority: the action must be owned by the coordinator role
      if (a.owner_role !== 'coordinator') {
        return bad(reply, `Substitution actions are decided by the coordinator authority (this one is owned by ${a.owner_role})`, 403);
      }
      // RT-7 #4: decide-door aliasing guard — this desk decides SUBSTITUTION actions
      // only. The code must carry the substitution segment ('sub', fixture precedent
      // 'cs1.sub.ok') or the payload must pin kind='substitution'. Anything else
      // (staff leave, publications, SARs …) is refused here with NO side effects, so
      // foreign desks can never be decided — or event-stamped — through this door.
      const subKind = /(^|[.-])sub($|[.-])/.test(String(a.code ?? '').toLowerCase())
        || (a.payload && typeof a.payload === 'object' && a.payload.kind === 'substitution');
      if (!subKind) {
        return bad(reply, 'This decision belongs to a different desk', 409);
      }
      // SoD (routes.js decide rule): the proposer can never approve their own proposal
      const p = (a.payload && typeof a.payload === 'object') ? a.payload : {};
      if (b.decision === 'approved' && p.proposed_by === req.user.id) {
        return bad(reply, 'Self-approval is not permitted — the proposer cannot approve their own substitution (segregation of duties)', 403);
      }
      const status = b.decision === 'approved' ? 'approved' : 'dismissed';
      await c.query(
        `UPDATE app.actions SET status=$2, decided_by=$3, decided_at=now(), decision_note=$4 WHERE id=$1`,
        [a.id, status, req.user.id, b.note ? String(b.note).slice(0, 500) : null]);
      let emitted = null;
      if (b.decision === 'approved') {
        await emitEvent(c, req.user.tenant_id,
          { type: 'coordination', label: `Substitution approved — ${a.title}`, ref: a.id },
          'sub.assign.v1', { actionId: a.id, code: a.code, decidedBy: req.user.id, template: 'sub.assign.v1' });
        emitted = 'sub.assign.v1';
      }
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: `Substitution action ${b.decision}`, recordType: 'Action', recordRef: a.code,
        reason: b.note ? String(b.note).slice(0, 200) : 'coordinator decide door',
        policyRef: a.policy_ref ?? 'coord.decision.v1 · proposer≠decider', risk: 'medium',
        outcome: `${a.status} → ${status}${emitted ? ` · ${emitted} emitted` : ' · no event (rejected)'}` });
      return { ok: true, action_id: a.id, code: a.code, decision: b.decision, status, event: emitted };
    });
  });

  // fairness-aware allocation: least-loaded candidate by duty.assignment count
  // (deterministic tie-break name, then id) — a rostering aid, never a ranking.
  app.post('/coord/duty/allocate', { preHandler: [require(...AUTHORITY), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!DUTY_KINDS.includes(b.kind)) return bad(reply, `Kind must be one of: ${DUTY_KINDS.join(', ')}`);
    if (!DATE.test(String(b.date ?? ''))) return bad(reply, 'Duty date must be YYYY-MM-DD');
    const candidates = Array.isArray(b.candidates) ? [...new Set(b.candidates.map(String))] : [];
    // PLGX: unbounded candidate arrays were accepted; cap like every other batch door.
    if (!candidates.length || candidates.length > 200 || candidates.some((x) => !UUID.test(x))) return bad(reply, 'Send 1-200 valid candidate teacher IDs');
    if (b.period != null && String(b.period).length > 40) return bad(reply, 'Period is too long');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // RT-7 #6: honesty ordering — report a missing duty data plane (409, designed
      // copy) BEFORE validating candidates, so a disabled lane never masquerades as
      // bad input.
      if (!(await tableExists(c, 'duty', 'assignment'))) {
        return bad(reply, 'The duty roster data plane is not built yet — allocation is unavailable', 409);
      }
      const staff = (await c.query(
        `SELECT id, name FROM app.users
         WHERE tenant_id=$1 AND role='teacher' AND active AND id = ANY($2::uuid[]) ORDER BY name`,
        [req.user.tenant_id, candidates])).rows;
      if (staff.length !== candidates.length) return bad(reply, 'Every candidate must be an active teacher of this school', 400);
      const loads = (await c.query(
        `SELECT teacher_id, count(*)::int AS n FROM duty.assignment WHERE tenant_id=$1 GROUP BY teacher_id`,
        [req.user.tenant_id])).rows;
      const loadById = new Map(loads.map((l) => [l.teacher_id, l.n]));
      // deterministic least-loaded pick: load ASC, name ASC, id ASC
      const ranked = staff
        .map((s) => ({ ...s, load: loadById.get(s.id) ?? 0 }))
        .sort((a, z) => a.load - z.load || a.name.localeCompare(z.name) || String(a.id).localeCompare(String(z.id)));
      const pick = ranked[0];
      let row;
      try {
        row = (await c.query(
          `INSERT INTO duty.assignment (tenant_id, teacher_id, kind, duty_date, period, note, allocated_by)
           VALUES ($1,$2,$3,$4::date,$5,$6,$7) RETURNING id`,
          [req.user.tenant_id, pick.id, b.kind, b.date, b.period != null ? String(b.period) : null,
           b.note ? String(b.note).slice(0, 200) : null, req.user.id])).rows[0];
      } catch (e) {
        if (e.code === '23505') return bad(reply, 'That teacher already has this duty on this date/period — pick another slot or candidate', 409);
        throw e;
      }
      await emitEvent(c, req.user.tenant_id,
        { type: 'coordination', label: `Duty allocated — ${pick.name} (${b.kind} ${b.date})`, ref: row.id },
        'duty.assigned.v1', { assignmentId: row.id, teacherId: pick.id, kind: b.kind, date: b.date, period: b.period ?? null });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Duty allocated', recordType: 'DutyAssignment', recordRef: row.id,
        reason: `fairness pick: least-loaded of ${staff.length} candidates`,
        policyRef: 'coord.decision.v1 · fairness framing (no scores, no ranks)', risk: 'low',
        outcome: `${pick.name} (${pick.load} existing assignments) → ${b.kind} ${b.date}${b.period ? ` ${b.period}` : ''}` });
      return {
        ok: true,
        assignment_id: row.id,
        assigned_to: { teacher_id: pick.id, name: pick.name },
        assigned_load_before: pick.load,
        kind: b.kind,
        date: b.date,
        period: b.period ?? null,
      };
    });
  });

  // escalations: family requests owned by the coordinator + routed/open concerns —
  // append-only timelines; student identity only where the coordinator is the
  // routed authority.
  app.get('/coord/escalations', { preHandler: [require(...AUTHORITY), lifecycleGate] }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const family = (await c.query(
        `SELECT r.id, r.category, r.title, r.status, r.child_id, r.created_at, r.sla_at, s.name AS student_name,
                (SELECT json_agg(json_build_object('to', e.to_status, 'note', e.note, 'at', e.at) ORDER BY e.at, e.id)
                 FROM family.request_event e WHERE e.request_id = r.id) AS timeline
         FROM family.request r
         LEFT JOIN app.students s ON s.id = r.child_id
         WHERE r.tenant_id=$1 AND r.owner_role='coordinator' AND r.status NOT IN ('resolved','closed')
         ORDER BY r.created_at DESC LIMIT 100`, [req.user.tenant_id])).rows
        .map((r) => ({
          source: 'family_request',
          id: r.id,
          kind: r.category === 'reevaluation' ? 'reevaluation' : r.category,
          category: r.category,
          title: r.title,
          status: r.status,
          // the coordinator is the owner_role of these requests — the routed authority
          student: r.student_name ?? null,
          created_at: r.created_at,
          sla_at: r.sla_at,
          timeline: r.timeline ?? [],
        }));
      let concerns = [];
      if (await tableExists(c, 'teacher', 'concern')) {
        concerns = (await c.query(
          `SELECT cc.id, cc.category, cc.urgency, cc.status, cc.routed_role, cc.routed_to, cc.created_at,
                  (SELECT max(e.created_at) FROM teacher.concern_status_event e
                    WHERE e.concern_id = cc.id AND e.to_status='routed') AS routed_at,
                  s.name AS student_name,
                  (SELECT json_agg(json_build_object('to', ev.to_status, 'note', ev.note, 'at', ev.created_at) ORDER BY ev.created_at, ev.id)
                   FROM teacher.concern_status_event ev WHERE ev.concern_id = cc.id) AS timeline
           FROM teacher.concern cc
           LEFT JOIN app.students s ON s.id = cc.student_id
           WHERE cc.tenant_id=$1 AND cc.status <> 'closed'
           ORDER BY cc.created_at DESC LIMIT 100`, [req.user.tenant_id])).rows
          .map((r) => ({
            source: 'teacher_concern',
            id: r.id,
            kind: 'concern',
            category: r.category,
            urgency: r.urgency,
            status: r.status,
            // coordinator authority = open (awaiting routing) or routed to the coordinator desk
            student: r.status === 'open' || r.routed_role === 'coordinator' ? r.student_name : null,
            routed_at: r.routed_at,
            created_at: r.created_at,
            timeline: r.timeline ?? [],
          }));
      }
      return {
        escalations: [...family, ...concerns],
        note: 'Student identity appears only where the coordinator is the routed authority (family requests owned here, open concerns awaiting routing, concerns routed to the coordinator desk).',
      };
    });
  });

  // ═══════════ deterministic v0 copilot (never invents) ═══════════

  function detectIntent(question) {
    const q2 = question.toLowerCase();
    if (/interven|concern|wellbeing|support plan|counsel|bully/.test(q2)) return 'intervention';
    if (/curricul|syllabus|coverage|pace|behind|portion/.test(q2)) return 'curriculum';
    if (/substitut|absent|absence|leave|cover|uncovered|staffing/.test(q2)) return 'substitution';
    if (/summar|overview|status|today|how are things|everything/.test(q2)) return 'summary';
    return 'unknown';
  }

  async function answerIntent(c, tenantId, intent, question) {
    const src = (ref, note) => ({ kind: 'data', ref, note, scope: 'own_tenant' });
    if (intent === 'intervention') {
      const hasConcerns = await tableExists(c, 'teacher', 'concern');
      const openConcerns = hasConcerns ? (await c.query(
        `SELECT urgency, count(*)::int AS n FROM teacher.concern
         WHERE tenant_id=$1 AND status <> 'closed' GROUP BY urgency`, [tenantId])).rows : [];
      const openRequests = (await c.query(
        `SELECT count(*)::int AS n FROM family.request
         WHERE tenant_id=$1 AND owner_role='coordinator' AND status NOT IN ('resolved','closed')`, [tenantId])).rows[0].n;
      const high = openConcerns.filter((r) => r.urgency === 'high' || r.urgency === 'critical').reduce((s, r) => s + r.n, 0);
      const total = openConcerns.reduce((s, r) => s + r.n, 0);
      const answer = total === 0
        ? 'No open concerns right now — the support queue is clear.'
        : `${total} open concern${total === 1 ? '' : 's'} (${high} high or critical urgency) and ${openRequests} open family request${openRequests === 1 ? '' : 's'} on the coordinator desk.`;
      const sources = [];
      if (hasConcerns) sources.push(src('teacher.concern', 'open concerns by urgency'));
      sources.push(src('family.request', 'open coordinator-owned requests'));
      return { answer, data: { open_concerns: total, high_urgency: high, open_family_requests: openRequests }, sources };
    }
    if (intent === 'curriculum') {
      const m = await curriculumMonitor(c, tenantId);
      if (!m.available) return {
        answer: 'The curriculum data plane is not built yet, so I cannot report pace.',
        data: null,
        sources: [],
      };
      const delays = m.monitor.filter((r) => r.weeks_behind > 0)
        .sort((a, z) => z.weeks_behind - a.weeks_behind || a.subject.localeCompare(z.subject)).slice(0, 3);
      const answer = delays.length === 0
        ? `All tracked class×subject pairs are at or ahead of the term pace (${m.pace.expectedPct}% of the term elapsed).`
        : `Term pace: ${m.pace.expectedPct}% of the term elapsed. ${delays.map((d) => `${d.subject} class ${d.class_grade} is ${d.weeks_behind} week${d.weeks_behind === 1 ? '' : 's'} behind (${d.covered_pct}% covered)`).join('; ')}.`;
      return { answer, data: { pace: { expected_pct: m.pace.expectedPct, term_weeks: m.pace.termWeeks }, delays: delays.map(({ class_grade, subject, covered_pct, expected_pct, weeks_behind }) => ({ class_grade, subject, covered_pct, expected_pct, weeks_behind })) }, sources: [src('curriculum.progress', 'coverage check-offs vs term pace')] };
    }
    if (intent === 'substitution') {
      const { staffing, gaps } = await staffingToday(c, tenantId);
      const away = staffing.filter((s) => s.status !== 'present');
      const answer = away.length === 0
        ? 'No staff absences recorded for today — the grid is fully covered.'
        : `${away.length} teacher${away.length === 1 ? '' : 's'} away today (${away.map((a) => `${a.teacher} — ${a.status.replace('_', ' ')}`).join(', ')}); ${gaps.length} period${gaps.length === 1 ? '' : 's'} still uncovered.`;
      return { answer, data: { absent: away, uncovered_gaps: gaps.length, gaps }, sources: [src('plugin_hr.leave / teacher.leave_request', 'absence facts for today'), src('app.timetable_slots', "today's grid")] };
    }
    if (intent === 'summary') {
      const { staffing, gaps } = await staffingToday(c, tenantId);
      const approvals = await pendingApprovals(c, tenantId);
      const issues = await openIssues(c, tenantId);
      const monitor = await curriculumMonitor(c, tenantId);
      const away = staffing.filter((s) => s.status !== 'present').length;
      const delays = monitor.monitor.filter((m2) => m2.weeks_behind > 0).length;
      const answer = `Today: ${away} staff away, ${gaps.length} uncovered period${gaps.length === 1 ? '' : 's'}, ${approvals.length} approval${approvals.length === 1 ? '' : 's'} waiting on you, ${issues.length} open concern${issues.length === 1 ? '' : 's'}, and ${monitor.available ? `${delays} class×subject pair${delays === 1 ? '' : 's'} behind the term pace` : 'no curriculum data yet'}.`;
      return {
        answer,
        data: { staff_away: away, uncovered_gaps: gaps.length, pending_approvals: approvals.length, open_issues: issues.length, curriculum_delays: monitor.available ? delays : null },
        sources: [src('app.actions', 'open coordinator-owned approvals'), src('teacher.concern', 'open issues'), src('curriculum.progress', 'term pace')],
      };
    }
    // honest unknown: no data for the question, and the copilot never guesses
    return {
      answer: 'I can only answer from coordinator-desk data — interventions, curriculum pace, substitutions and today\'s summary. I don\'t have data for that question, and I won\'t guess.',
      data: null,
      sources: [],
    };
  }

  app.post('/coord/copilot-lite', { preHandler: [require(...AUTHORITY), lifecycleGate] }, async (req, reply) => {
    const question = String(req.body?.question ?? '').trim();
    if (!question) return bad(reply, 'Ask a question first');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const hasLedger = await tableExists(c, 'coord', 'copilot_call');
      const used = hasLedger ? (await c.query(
        `SELECT count(*)::int AS n FROM coord.copilot_call
         WHERE tenant_id=$1 AND user_id=$2 AND at >= date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))`,
        [req.user.tenant_id, req.user.id])).rows[0].n : 0;
      if (used >= COPILOT_MONTHLY_CAP) {
        return reply.code(429).send({ error: `Copilot monthly limit reached (${COPILOT_MONTHLY_CAP} calls) — try again next month` });
      }
      const intent = detectIntent(question);
      const { answer, data, sources } = await answerIntent(c, req.user.tenant_id, intent, question);
      if (hasLedger) {
        await c.query(
          `INSERT INTO coord.copilot_call (tenant_id, user_id, verb, budget_class, sources)
           VALUES ($1,$2,'ask','coordinator_tier',$3::jsonb)`,
          [req.user.tenant_id, req.user.id, JSON.stringify(sources)]);
      }
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Copilot-lite answered (deterministic)', recordType: 'CopilotCall', recordRef: intent,
        reason: question.slice(0, 120), policyRef: 'COORDINATOROS-PLAN · A2 budget classes · v0 deterministic (no model calls)', risk: 'low',
        outcome: `keyword-routed to ${intent}${sources.length ? ` (${sources.map((s) => s.ref).join(', ')})` : ' (no data)'} · honest answer, never invented · budget ${used + 1}/${COPILOT_MONTHLY_CAP}` });
      return { intent, answer, data, sources, budget: { used: used + 1, cap: COPILOT_MONTHLY_CAP, class: 'coordinator_tier' } };
    });
  });
}
