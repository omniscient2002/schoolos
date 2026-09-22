import { makeLifecycleGate } from '../_shared/lifecycle-gate.js';
// ops.timetable — Class C primitives provider: grid, slots, substitutions,
// deterministic period-autofill. Every write audited. No kernel edits.
const ID = 'ops.timetable';
export { default as manifest } from './manifest.js';
const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

export function register(app, kernel) {
  const { withUser, requestAudit, emitEvent, require } = kernel;
  const lifecycleGate = makeLifecycleGate(kernel.sysq, 'ops.timetable');

  app.get(`/plugins/${ID}/grid`, { preHandler: [require('owner','principal','coordinator','teacher','itadmin','finance','admissions','transport','facilities','technician'), lifecycleGate] }, async (req) => {
    const { dayOfWeek, grade, section } = req.query ?? {};
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const periods = (await c.query(`SELECT id, seq, label, start_time, end_time, is_break, sort_idx FROM app.timetable_periods WHERE retired_at IS NULL ORDER BY sort_idx`)).rows;
      // Phase B: when a class-section is asked for, return its slots PLUS the school-wide (NULL
      // grade/section) slots as a fallback; otherwise return the school-wide grid only.
      const wantsClass = grade != null && String(grade).trim() !== '';
      const slots = (await c.query(
        `SELECT s.id, s.period_id, s.day_of_week, s.subject, s.teacher_name, s.room, s.grade, s.section, s.teacher_id
         FROM app.timetable_slots s
         WHERE s.retired_at IS NULL
           AND ($1::text IS NULL OR s.day_of_week=$1)
           AND ($2::bool IS NOT TRUE
                OR (s.grade = $3 AND (s.section IS NOT DISTINCT FROM $4))
                OR (s.grade IS NULL AND s.section IS NULL))
         ORDER BY s.day_of_week, s.period_id, s.subject`,
        [DAYS.includes(dayOfWeek) ? dayOfWeek : null, wantsClass, wantsClass ? String(grade) : null,
          wantsClass && section != null && String(section).trim() !== '' ? String(section) : null])).rows;
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
        note: 'class-section slots overlay the school-wide grid; substitutions overlay the effective teacher for the day',
      };
    });
  });

  app.post(`/plugins/${ID}/substitutions`, { preHandler: [require('coordinator','principal','owner','itadmin'), lifecycleGate] }, async (req, reply) => {
    const { slotId, date, substitute, reason } = req.body ?? {};
    if (!slotId || !substitute) return reply.code(400).send({ error: 'slotId and substitute required' });
    // India-first: the school day is an IST day — a UTC date lags 05:30, so after
    // midnight IST the default here would be "yesterday" for the school
    const day = date ?? new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
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
    if (!absentTeacher) return reply.code(400).send({ error: 'Pick the absent teacher' });
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
    if (!date || !grade || !section) return reply.code(400).send({ error: 'Date, class and section are required' });
    // PLGX-2: this door used to write attendance for ANY body-supplied class and date. The kernel
    // /attendance/mark door binds a teacher to their `app.class_assignments` rows (PRD-2/083); this
    // plugin door is the sibling surface and must apply the same ownership rule, or it re-opens the
    // very bypass the kernel closed. It also validates the date so a malformed value cannot 500.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return reply.code(400).send({ error: 'Date must be YYYY-MM-DD' });
    if (String(grade).length > 20 || String(section).length > 8) return reply.code(400).send({ error: 'Invalid class or section' });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const isOffice = ['principal', 'coordinator'].includes(req.user.role);
      if (!isOffice) {
        const owns = await c.query(
          `SELECT 1 FROM app.class_assignments
            WHERE tenant_id=$1 AND teacher_id=$2 AND grade=$3 AND section=$4 AND active LIMIT 1`,
          [req.user.tenant_id, req.user.id, String(grade), String(section)]);
        if (!owns.rows[0]) {
          return reply.code(403).send({ error: 'You can only autofill a class assigned to you. Ask an administrator to assign this class (or the principal\'s office).' });
        }
      }
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

  /* ============================================================
     M3/M4 — TIMETABLE WRITE DOORS (SPEC-TIMETABLE-WRITE-DOORS.md)
     A school can now build and edit its periods and slots through
     the app. No kernel edits. Retirement is a status update because
     the app role holds no table-level DELETE. Every write is audited
     and emits `timetable.published`.
     ============================================================ */
  const READ_ROLES = ['owner','principal','coordinator','teacher','itadmin','finance','admissions','transport','facilities','technician'];
  const WRITE_ROLES = ['owner','principal','coordinator'];
  const RETIRE_ROLES = ['owner','principal'];
  const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const validatePeriod = (b) => {
    const seq = String(b?.seq ?? '').trim();
    if (!seq || seq.length > 8) return { error: 'A short period code is required (e.g. "1", "B", "L")' };
    const label = String(b?.label ?? '').trim();
    if (!label || label.length > 60) return { error: 'A period label is required (max 60 characters)' };
    const start = String(b?.start_time ?? '').trim();
    const end = String(b?.end_time ?? '').trim();
    if (!HHMM.test(start) || !HHMM.test(end)) return { error: 'Times must be HH:MM (24-hour)' };
    if (start >= end) return { error: 'The end time must be after the start time' };
    const isBreak = b?.is_break === true;
    const sortIdx = Number.isInteger(b?.sort_idx) && b.sort_idx >= 0 ? b.sort_idx : null;
    return { seq, label, start, end, isBreak, sortIdx };
  };

  const validateSlot = (b) => {
    const day = String(b?.day_of_week ?? '').trim();
    if (!DAYS.includes(day)) return { error: `Day must be one of ${DAYS.join(', ')}` };
    const subject = String(b?.subject ?? '').trim();
    if (!subject || subject.length > 60) return { error: 'A subject is required (max 60 characters)' };
    const teacherName = String(b?.teacher_name ?? '').trim();
    if (!teacherName || teacherName.length > 80) return { error: 'A teacher name is required (max 80 characters)' };
    const room = b?.room == null ? null : String(b.room).trim().slice(0, 40) || null;
    const grade = b?.grade == null || String(b.grade).trim() === '' ? null : String(b.grade).trim().slice(0, 20);
    const section = b?.section == null || String(b.section).trim() === '' ? null : String(b.section).trim().slice(0, 8);
    const teacherId = b?.teacher_id == null || String(b.teacher_id).trim() === '' ? null : String(b.teacher_id).trim();
    if (teacherId && !UUID_RE.test(teacherId)) return { error: 'teacher_id must be a valid user id' };
    return { day, subject, teacherName, room, grade, section, teacherId };
  };

  /** The ONE clash check — same lookup the kernel /timetable/clash-check uses, shared so the two
   *  implementations cannot drift. Returns the first conflict, or null. */
  const findClash = async (c, tenantId, { periodId, day, subject, teacherName, teacherId, room, grade, section, excludeId = null }) => {
    const rows = (await c.query(
      `SELECT id, subject, teacher_name, teacher_id, room, grade, section
         FROM app.timetable_slots
        WHERE tenant_id=$1 AND period_id=$2 AND day_of_week=$3 AND retired_at IS NULL
          AND ($4::uuid IS NULL OR id <> $4)`,
      [tenantId, periodId, day, excludeId])).rows;
    for (const r of rows) {
      if (grade && section && r.grade === grade && r.section === section) {
        return { slot: r, reason: `Class ${grade}-${section} already has ${r.subject} in that period` };
      }
      if (teacherId && r.teacher_id === teacherId) {
        return { slot: r, reason: `${r.teacher_name} is already teaching ${r.subject} in that period` };
      }
      if (!teacherId && teacherName && r.teacher_name.toLowerCase() === teacherName.toLowerCase()) {
        return { slot: r, reason: `${r.teacher_name} is already teaching ${r.subject} in that period` };
      }
      if (room && r.room && r.room.toLowerCase() === room.toLowerCase()) {
        return { slot: r, reason: `Room ${r.room} is already in use for ${r.subject} in that period` };
      }
    }
    return null;
  };

  const emitTimetable = (c, tenantId, label, payload, subject) =>
    emitEvent(c, tenantId, { type: 'timetable', label, ref: payload.slotId ?? payload.periodId },
      'timetable.published', payload, { emittedBy: `plugin:${ID}`, subject, schemaVersion: 1 });

  // ── periods ──────────────────────────────────────────────────────────────
  app.get(`/plugins/${ID}/periods`, { preHandler: [require(...READ_ROLES), lifecycleGate] }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const periods = (await c.query(
        `SELECT id, seq, label, start_time, end_time, is_break, sort_idx
           FROM app.timetable_periods WHERE retired_at IS NULL ORDER BY sort_idx`)).rows;
      return { periods, days: DAYS };
    });
  });

  app.post(`/plugins/${ID}/periods`, { preHandler: [require(...WRITE_ROLES), lifecycleGate] }, async (req, reply) => {
    const v = validatePeriod(req.body ?? {});
    if (v.error) return reply.code(400).send({ error: v.error });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const next = v.sortIdx ?? ((await c.query(
        `SELECT COALESCE(MAX(sort_idx),0)+1 AS n FROM app.timetable_periods WHERE tenant_id=$1`, [req.user.tenant_id])).rows[0].n);
      let row;
      try {
        row = (await c.query(
          `INSERT INTO app.timetable_periods (tenant_id, seq, label, start_time, end_time, is_break, sort_idx)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, seq, label, start_time, end_time, is_break, sort_idx`,
          [req.user.tenant_id, v.seq, v.label, v.start, v.end, v.isBreak, next])).rows[0];
      } catch (e) {
        if (e.code === '23505') return reply.code(409).send({ error: `A period with code "${v.seq}" already exists.` });
        throw e;
      }
      await emitTimetable(c, req.user.tenant_id, `Period created — ${v.label} (${v.start}–${v.end})`,
        { periodId: row.id, seq: row.seq }, `period:${row.id}`);
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Timetable period created', recordType: 'Plugin', recordRef: row.id,
        reason: `${v.label} ${v.start}–${v.end}`, policyRef: 'Platform §3 (plugin governance)', risk: 'low',
        outcome: `seq ${v.seq} · break ${v.isBreak}` });
      return { period: row };
    });
  });

  app.patch(`/plugins/${ID}/periods/:id`, { preHandler: [require(...WRITE_ROLES), lifecycleGate] }, async (req, reply) => {
    if (!UUID_RE.test(String(req.params.id))) return reply.code(400).send({ error: 'Invalid period id' });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const existing = (await c.query(
        `SELECT id, seq, label, start_time, end_time, is_break, sort_idx FROM app.timetable_periods
          WHERE id=$1 AND tenant_id=$2 AND retired_at IS NULL`, [req.params.id, req.user.tenant_id])).rows[0];
      if (!existing) return reply.code(404).send({ error: 'Period not found' });
      const merged = {
        seq: req.body?.seq ?? existing.seq,
        label: req.body?.label ?? existing.label,
        start_time: req.body?.start_time ?? existing.start_time,
        end_time: req.body?.end_time ?? existing.end_time,
        is_break: req.body?.is_break ?? existing.is_break,
        sort_idx: req.body?.sort_idx ?? existing.sort_idx,
      };
      const v = validatePeriod(merged);
      if (v.error) return reply.code(400).send({ error: v.error });
      let row;
      try {
        row = (await c.query(
          `UPDATE app.timetable_periods
              SET seq=$3, label=$4, start_time=$5, end_time=$6, is_break=$7, sort_idx=$8
            WHERE id=$1 AND tenant_id=$2
          RETURNING id, seq, label, start_time, end_time, is_break, sort_idx`,
          [existing.id, req.user.tenant_id, v.seq, v.label, v.start, v.end, v.isBreak, v.sortIdx])).rows[0];
      } catch (e) {
        if (e.code === '23505') return reply.code(409).send({ error: `A period with code "${v.seq}" already exists.` });
        throw e;
      }
      await emitTimetable(c, req.user.tenant_id, `Period updated — ${v.label} (${v.start}–${v.end})`,
        { periodId: row.id, seq: row.seq }, `period:${row.id}`);
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Timetable period updated', recordType: 'Plugin', recordRef: row.id,
        reason: `${existing.label} → ${v.label}`, policyRef: 'Platform §3 (plugin governance)', risk: 'low',
        outcome: `${v.start}–${v.end}` });
      return { period: row };
    });
  });

  app.post(`/plugins/${ID}/periods/:id/retire`, { preHandler: [require(...RETIRE_ROLES), lifecycleGate] }, async (req, reply) => {
    if (!UUID_RE.test(String(req.params.id))) return reply.code(400).send({ error: 'Invalid period id' });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const row = (await c.query(
        `UPDATE app.timetable_periods SET retired_at=now()
          WHERE id=$1 AND tenant_id=$2 AND retired_at IS NULL RETURNING id, label`, [req.params.id, req.user.tenant_id])).rows[0];
      if (!row) return reply.code(404).send({ error: 'Period not found' });
      // A retired period takes its slots out of the grid with it.
      await c.query(`UPDATE app.timetable_slots SET retired_at=now()
                      WHERE period_id=$1 AND tenant_id=$2 AND retired_at IS NULL`, [row.id, req.user.tenant_id]);
      await emitTimetable(c, req.user.tenant_id, `Period retired — ${row.label}`, { periodId: row.id }, `period:${row.id}`);
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Timetable period retired', recordType: 'Plugin', recordRef: row.id,
        reason: row.label, policyRef: 'Platform §3 (plugin governance)', risk: 'low', outcome: 'soft-retired with its slots' });
      return { ok: true, retired: row.id };
    });
  });

  // Opt-in standard Indian school day — never auto-run, idempotent.
  app.post(`/plugins/${ID}/periods/seed-default`, { preHandler: [require(...RETIRE_ROLES), lifecycleGate] }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const existing = (await c.query(`SELECT count(*)::int AS n FROM app.timetable_periods WHERE tenant_id=$1 AND retired_at IS NULL`, [req.user.tenant_id])).rows[0].n;
      if (existing > 0) return { ok: true, created: 0, note: 'This school already has periods — nothing was added.' };
      const defaults = [
        ['1','Period 1','08:00','08:45',false,1],['2','Period 2','08:50','09:35',false,2],
        ['3','Period 3','09:40','10:25',false,3],['B','Morning break','10:25','10:55',true,4],
        ['4','Period 4','11:00','11:45',false,5],['5','Period 5','11:50','12:35',false,6],
        ['L','Lunch','12:35','13:20',true,7],['6','Period 6','13:20','14:05',false,8],
        ['7','Period 7','14:10','14:55',false,9],['8','Period 8','15:00','15:45',false,10],
      ];
      let created = 0;
      for (const [seq, label, start, end, isBreak, sortIdx] of defaults) {
        const r = await c.query(
          `INSERT INTO app.timetable_periods (tenant_id, seq, label, start_time, end_time, is_break, sort_idx)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (tenant_id, seq) DO NOTHING RETURNING id`,
          [req.user.tenant_id, seq, label, start, end, isBreak, sortIdx]);
        created += r.rows.length;
      }
      await emitTimetable(c, req.user.tenant_id, `Standard day seeded — ${created} periods`, { periodId: null }, `tenant:${req.user.tenant_id}`);
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Timetable default day seeded', recordType: 'Plugin', recordRef: req.user.tenant_id,
        reason: 'opt-in standard Indian school day', policyRef: 'Platform §3 (plugin governance)', risk: 'low',
        outcome: `${created} periods created` });
      return { ok: true, created };
    });
  });

  // ── slots ────────────────────────────────────────────────────────────────
  app.get(`/plugins/${ID}/slots`, { preHandler: [require(...READ_ROLES), lifecycleGate] }, async (req) => {
    const { dayOfWeek, periodId, grade, section } = req.query ?? {};
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const slots = (await c.query(
        `SELECT s.id, s.period_id, s.day_of_week, s.subject, s.teacher_name, s.teacher_id, s.room, s.grade, s.section
           FROM app.timetable_slots s
          WHERE s.retired_at IS NULL
            AND ($1::text IS NULL OR s.day_of_week=$1)
            AND ($2::uuid IS NULL OR s.period_id=$2)
            AND ($3::text IS NULL OR s.grade=$3)
            AND ($4::text IS NULL OR s.section=$4)
          ORDER BY s.day_of_week, s.period_id, s.subject`,
        [DAYS.includes(dayOfWeek) ? dayOfWeek : null,
          UUID_RE.test(String(periodId ?? '')) ? periodId : null,
          grade != null && String(grade).trim() !== '' ? String(grade) : null,
          section != null && String(section).trim() !== '' ? String(section) : null])).rows;
      return { slots, days: DAYS };
    });
  });

  app.post(`/plugins/${ID}/slots`, { preHandler: [require(...WRITE_ROLES), lifecycleGate] }, async (req, reply) => {
    const v = validateSlot(req.body ?? {});
    if (v.error) return reply.code(400).send({ error: v.error });
    const periodId = String(req.body?.period_id ?? '');
    if (!UUID_RE.test(periodId)) return reply.code(400).send({ error: 'period_id must be a valid period id' });
    const force = req.body?.force === true;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const period = (await c.query(
        `SELECT id, label FROM app.timetable_periods WHERE id=$1 AND tenant_id=$2 AND retired_at IS NULL`,
        [periodId, req.user.tenant_id])).rows[0];
      if (!period) return reply.code(404).send({ error: 'Period not found in this school' });
      const clash = await findClash(c, req.user.tenant_id, { periodId, day: v.day, subject: v.subject, teacherName: v.teacherName, teacherId: v.teacherId, room: v.room, grade: v.grade, section: v.section });
      if (clash && !force) return reply.code(409).send({ error: `${clash.reason}. Confirm to place it anyway.`, conflict: { slotId: clash.slot.id, subject: clash.slot.subject } });
      let row;
      try {
        row = (await c.query(
          `INSERT INTO app.timetable_slots (tenant_id, period_id, day_of_week, subject, teacher_name, teacher_id, room, grade, section)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING id, period_id, day_of_week, subject, teacher_name, teacher_id, room, grade, section`,
          [req.user.tenant_id, periodId, v.day, v.subject, v.teacherName, v.teacherId, v.room, v.grade, v.section])).rows[0];
      } catch (e) {
        if (e.code === '23505') return reply.code(409).send({ error: 'That class-section period already has a subject. Edit the existing slot or retire it first.' });
        throw e;
      }
      await emitTimetable(c, req.user.tenant_id,
        `Slot created — ${v.subject} ${v.grade ? `${v.grade}-${v.section ?? ''} ` : ''}${v.day} ${period.label} · ${v.teacherName}`,
        { slotId: row.id, periodId, dayOfWeek: v.day, subject: v.subject, teacher: v.teacherName, grade: v.grade, section: v.section }, `slot:${row.id}`);
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Timetable slot created', recordType: 'Plugin', recordRef: row.id,
        reason: `${v.subject} · ${v.day} ${period.label} · ${v.teacherName}${v.grade ? ` · ${v.grade}-${v.section ?? ''}` : ''}`,
        policyRef: 'Platform §3 (plugin governance)', risk: 'low', outcome: clash ? `forced over conflict: ${clash.reason}` : 'no conflict' });
      return { slot: row };
    });
  });

  app.patch(`/plugins/${ID}/slots/:id`, { preHandler: [require(...WRITE_ROLES), lifecycleGate] }, async (req, reply) => {
    if (!UUID_RE.test(String(req.params.id))) return reply.code(400).send({ error: 'Invalid slot id' });
    const force = req.body?.force === true;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const existing = (await c.query(
        `SELECT id, period_id, day_of_week, subject, teacher_name, teacher_id, room, grade, section
           FROM app.timetable_slots WHERE id=$1 AND tenant_id=$2 AND retired_at IS NULL`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!existing) return reply.code(404).send({ error: 'Slot not found' });
      const periodId = req.body?.period_id ?? existing.period_id;
      if (!UUID_RE.test(String(periodId))) return reply.code(400).send({ error: 'period_id must be a valid period id' });
      const period = (await c.query(
        `SELECT id, label FROM app.timetable_periods WHERE id=$1 AND tenant_id=$2 AND retired_at IS NULL`,
        [periodId, req.user.tenant_id])).rows[0];
      if (!period) return reply.code(404).send({ error: 'Period not found in this school' });
      const merged = {
        day_of_week: req.body?.day_of_week ?? existing.day_of_week,
        subject: req.body?.subject ?? existing.subject,
        teacher_name: req.body?.teacher_name ?? existing.teacher_name,
        teacher_id: req.body?.teacher_id !== undefined ? req.body.teacher_id : existing.teacher_id,
        room: req.body?.room !== undefined ? req.body.room : existing.room,
        grade: req.body?.grade !== undefined ? req.body.grade : existing.grade,
        section: req.body?.section !== undefined ? req.body.section : existing.section,
      };
      const v = validateSlot(merged);
      if (v.error) return reply.code(400).send({ error: v.error });
      const clash = await findClash(c, req.user.tenant_id, { periodId, day: v.day, subject: v.subject, teacherName: v.teacherName, teacherId: v.teacherId, room: v.room, grade: v.grade, section: v.section, excludeId: existing.id });
      if (clash && !force) return reply.code(409).send({ error: `${clash.reason}. Confirm to place it anyway.`, conflict: { slotId: clash.slot.id, subject: clash.slot.subject } });
      let row;
      try {
        row = (await c.query(
          `UPDATE app.timetable_slots
              SET period_id=$3, day_of_week=$4, subject=$5, teacher_name=$6, teacher_id=$7, room=$8, grade=$9, section=$10
            WHERE id=$1 AND tenant_id=$2
          RETURNING id, period_id, day_of_week, subject, teacher_name, teacher_id, room, grade, section`,
          [existing.id, req.user.tenant_id, periodId, v.day, v.subject, v.teacherName, v.teacherId, v.room, v.grade, v.section])).rows[0];
      } catch (e) {
        if (e.code === '23505') return reply.code(409).send({ error: 'That class-section period already has a subject. Edit the existing slot or retire it first.' });
        throw e;
      }
      await emitTimetable(c, req.user.tenant_id,
        `Slot updated — ${v.subject} ${v.day} ${period.label} · ${v.teacherName}`,
        { slotId: row.id, periodId, dayOfWeek: v.day, subject: v.subject, teacher: v.teacherName, grade: v.grade, section: v.section }, `slot:${row.id}`);
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Timetable slot updated', recordType: 'Plugin', recordRef: row.id,
        reason: `${v.subject} · ${v.day} ${period.label}`, policyRef: 'Platform §3 (plugin governance)', risk: 'low',
        outcome: clash ? `forced over conflict: ${clash.reason}` : 'no conflict' });
      return { slot: row };
    });
  });

  app.post(`/plugins/${ID}/slots/:id/retire`, { preHandler: [require(...RETIRE_ROLES), lifecycleGate] }, async (req, reply) => {
    if (!UUID_RE.test(String(req.params.id))) return reply.code(400).send({ error: 'Invalid slot id' });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const row = (await c.query(
        `UPDATE app.timetable_slots SET retired_at=now()
          WHERE id=$1 AND tenant_id=$2 AND retired_at IS NULL
          RETURNING id, subject, day_of_week`, [req.params.id, req.user.tenant_id])).rows[0];
      if (!row) return reply.code(404).send({ error: 'Slot not found' });
      await emitTimetable(c, req.user.tenant_id, `Slot retired — ${row.subject} ${row.day_of_week}`,
        { slotId: row.id, subject: row.subject, dayOfWeek: row.day_of_week }, `slot:${row.id}`);
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Timetable slot retired', recordType: 'Plugin', recordRef: row.id,
        reason: `${row.subject} ${row.day_of_week}`, policyRef: 'Platform §3 (plugin governance)', risk: 'low', outcome: 'soft-retired' });
      return { ok: true, retired: row.id };
    });
  });

  /* M4: the first-period register owner for a class-section — the teacher of the day's period-1 slot.
     Returns the slot's teacher so the register can be bound to a real assignment, not a name match. */
  app.get(`/plugins/${ID}/first-period-teacher`, { preHandler: [require(...READ_ROLES), lifecycleGate] }, async (req, reply) => {
    const { grade, section, dayOfWeek } = req.query ?? {};
    if (!grade) return reply.code(400).send({ error: 'grade is required' });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const day = DAYS.includes(dayOfWeek) ? dayOfWeek : DAYS[(new Date().getDay() + 6) % 7];
      const row = (await c.query(
        `SELECT s.id, s.subject, s.teacher_name, s.teacher_id, p.label
           FROM app.timetable_slots s
           JOIN app.timetable_periods p ON p.id = s.period_id
          WHERE s.tenant_id=$1 AND s.day_of_week=$2 AND s.grade=$3
            AND (s.section IS NOT DISTINCT FROM $4) AND s.retired_at IS NULL AND p.retired_at IS NULL
            AND p.is_break = false
          ORDER BY p.sort_idx LIMIT 1`,
        [req.user.tenant_id, day, String(grade), section != null && String(section).trim() !== '' ? String(section) : null])).rows[0];
      return { day, grade, section: section ?? null, firstPeriod: row ?? null };
    });
  });
}
