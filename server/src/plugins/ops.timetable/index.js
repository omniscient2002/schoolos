import { makeLifecycleGate } from '../_shared/lifecycle-gate.js';
// ops.timetable — Class C primitives provider: grid, slots, substitutions,
// deterministic period-autofill. Every write audited. No kernel edits.
const ID = 'ops.timetable';
export { default as manifest } from './manifest.js';
const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

export function register(app, kernel) {
  const { withUser, requestAudit, emitEvent, require } = kernel;
  const lifecycleGate = makeLifecycleGate(kernel.q, 'ops.timetable');

  app.get(`/plugins/${ID}/grid`, { preHandler: [require('owner','principal','coordinator','teacher','itadmin','finance','admissions','transport','facilities','technician'), lifecycleGate] }, async (req) => {
    const { dayOfWeek } = req.query ?? {};
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const periods = (await c.query(`SELECT id, seq, label, start_time, end_time, is_break FROM app.timetable_periods ORDER BY sort_idx`)).rows;
      const slots = (await c.query(
        `SELECT s.id, s.period_id, s.day_of_week, s.subject, s.teacher_name, s.room
         FROM app.timetable_slots s
         WHERE ($1::text IS NULL OR s.day_of_week=$1)
         ORDER BY s.day_of_week, s.subject`,
        [DAYS.includes(dayOfWeek) ? dayOfWeek : null])).rows;
      const subs = (await c.query(
        `SELECT su.slot_id, su.date, su.absent_teacher, su.substitute, su.status
         FROM app.timetable_substitutions su
         WHERE su.status='assigned' AND su.date = COALESCE($1::date, current_date)`,
        [req.query?.date ?? null])).rows;
      const subBySlot = new Map(subs.map(s => [s.slot_id, s.substitute]));
      return {
        periods,
        days: DAYS,
        slots: slots.map(s => ({ ...s, effectiveTeacher: subBySlot.get(s.id) ?? null })),
        substitutions: subs,
        note: 'slots are section-agnostic in v1 (one grid per school); substitutions overlay the effective teacher for the day',
      };
    });
  });

  app.post(`/plugins/${ID}/substitutions`, { preHandler: [require('coordinator','principal','owner','itadmin'), lifecycleGate] }, async (req, reply) => {
    const { slotId, date, substitute, reason } = req.body ?? {};
    if (!slotId || !substitute) return reply.code(400).send({ error: 'slotId and substitute required' });
    const day = date ?? new Date().toISOString().slice(0, 10);
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const slot = (await c.query(
        `SELECT s.id, s.subject, s.teacher_name, s.day_of_week, p.label, p.start_time, p.end_time
         FROM app.timetable_slots s JOIN app.timetable_periods p ON p.id = s.period_id
         WHERE s.id=$1`, [slotId])).rows[0];
      if (!slot) return reply.code(404).send({ error: 'slot not found' });
      const r = await c.query(
        `INSERT INTO app.timetable_substitutions (tenant_id, slot_id, date, absent_teacher, substitute, reason, assigned_by)
         VALUES ($1,$2,$3::date,$4,$5,$6,$7)
         ON CONFLICT (slot_id, date) DO UPDATE SET substitute=EXCLUDED.substitute, reason=EXCLUDED.reason,
           status='assigned', assigned_by=EXCLUDED.assigned_by
         RETURNING *`,
        [req.user.tenant_id, slotId, day, slot.teacher_name, substitute, reason ?? null, req.user.id]);
      const ev = await emitEvent(c, req.user.tenant_id,
        { type: 'timetable', label: `Substitution — ${slot.subject} ${slot.label} (${slot.start_time}) → ${substitute} for ${slot.teacher_name}`, ref: r.rows[0].id },
        'substitution.assigned', { slotId, date: day, absentTeacher: slot.teacher_name, substitute },
        { emittedBy: `plugin:${ID}`, subject: `slot:${slotId}`, schemaVersion: 1 });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Substitution assigned', recordType: 'Plugin', recordRef: r.rows[0].id,
        reason: `${slot.subject} · ${slot.teacher_name} → ${substitute}`, policyRef: 'Platform §3 (plugin governance)',
        risk: 'low', outcome: `effective ${day} · event ${ev.id}` });
      return { substitution: r.rows[0] };
    });
  });

  // deterministic-first candidate ranking (docs/11 §7): same-subject free teachers first
  app.get(`/plugins/${ID}/substitutions/suggest`, { preHandler: [require('coordinator','principal','owner','itadmin'), lifecycleGate] }, async (req, reply) => {
    const { absentTeacher, dayOfWeek } = req.query ?? {};
    if (!absentTeacher) return reply.code(400).send({ error: 'absentTeacher required' });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const day = DAYS.includes(dayOfWeek) ? dayOfWeek : DAYS[(new Date().getDay() + 6) % 7];
      const missed = (await c.query(
        `SELECT s.id, s.subject, s.room, p.label, p.start_time, p.end_time, p.sort_idx
         FROM app.timetable_slots s JOIN app.timetable_periods p ON p.id = s.period_id
         WHERE s.tenant_id=$1 AND s.day_of_week=$2 AND s.teacher_name=$3 ORDER BY p.sort_idx`,
        [req.user.tenant_id, day, absentTeacher])).rows;
      const busy = new Set((await c.query(
        `SELECT DISTINCT s.teacher_name, p.sort_idx FROM app.timetable_slots s
         JOIN app.timetable_periods p ON p.id = s.period_id
         WHERE s.tenant_id=$1 AND s.day_of_week=$2`,
        [req.user.tenant_id, day])).rows.map(r => `${r.teacher_name}|${r.sort_idx}`));
      const candidates = (await c.query(
        `SELECT DISTINCT teacher_name FROM app.timetable_slots WHERE tenant_id=$1 AND teacher_name <> $2`,
        [req.user.tenant_id, absentTeacher])).rows.map(r => r.teacher_name);
      const teaches = new Set((await c.query(
        `SELECT DISTINCT teacher_name, subject FROM app.timetable_slots WHERE tenant_id=$1`,
        [req.user.tenant_id])).rows.map(r => `${r.teacher_name}|${r.subject}`));
      const suggestions = missed.map(m => ({
        slot: { id: m.id, subject: m.subject, label: m.label, start: m.start_time, end: m.end_time, room: m.room },
        candidates: candidates
          .filter(t => !busy.has(`${t}|${m.sort_idx}`)) // actually free that period
          .map(t => ({
            teacher: t,
            // same-subject teachers rank first (compared against the teacher pool, not the subject)
            score: (teaches.has(`${t}|${m.subject}`) ? 100 : 0) + (t.length % 3), // stable tiebreak
          }))
          .sort((a, b) => b.score - a.score || a.teacher.localeCompare(b.teacher))
          .slice(0, 3),
      }));
      return { day, absentTeacher, suggestions, rule: 'same-subject free teacher first, then any free teacher — deterministic ranking, never a model' };
    });
  });

  app.post(`/plugins/${ID}/attendance/autofill`, { preHandler: [require('teacher','coordinator','principal'), lifecycleGate] }, async (req, reply) => {
    const { date, grade, section, periodSeq } = req.body ?? {};
    if (!date || !grade || !section) return reply.code(400).send({ error: 'date, grade, section required' });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // Deterministic, idempotent, safe: insert ONLY for students with no attendance row
      // today (absent/present/human-marked rows are never touched — Attendance §1.1).
      // Single statement, unique-index-safe on concurrent replays.
      const ins = await c.query(
        `INSERT INTO app.attendance (tenant_id, student_id, school_date, status, marked_by)
         SELECT $1, s.id, $4::date, 'present', $5
         FROM app.students s
         WHERE s.tenant_id=$1 AND s.status='active' AND s.grade=$2 AND s.section=$3
           AND NOT EXISTS (
             SELECT 1 FROM app.attendance a
             WHERE a.tenant_id=$1 AND a.student_id = s.id AND a.school_date=$4::date)
         RETURNING student_id`,
        [req.user.tenant_id, grade, section, date, req.user.id]);
      const marked = ins.rows.length;
      const rosterN = (await c.query(
        `SELECT count(*)::int AS n FROM app.students
         WHERE tenant_id=$1 AND status='active' AND grade=$2 AND section=$3`,
        [req.user.tenant_id, grade, section])).rows[0].n;
      const ev = await emitEvent(c, req.user.tenant_id,
        { type: 'attendance', label: `Period autofill — ${grade}-${section} ${periodSeq ?? ''} · ${marked} unmarked marked present (${date})`, severity: 'info', ref: `${grade}-${section}` },
        'attendance.autofilled', { date, grade, section, periodSeq: periodSeq ?? null, marked },
        { emittedBy: `plugin:${ID}`, subject: `class:${grade}-${section}`, schemaVersion: 1 });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Attendance period autofill', recordType: 'Plugin', recordRef: `${grade}-${section}`,
        reason: `unmarked students only · ${periodSeq ?? 'period n/a'}`, policyRef: 'Attendance §1.1', risk: 'low',
        outcome: `${marked} rows inserted · ${rosterN - marked} already marked · absences untouched` });
      return { marked, alreadyMarked: rosterN - marked, date, grade, section };
    });
  });
}
