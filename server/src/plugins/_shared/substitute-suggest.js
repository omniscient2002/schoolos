// Deterministic substitution candidate ranking (docs/11 §7): a free teacher who teaches the same
// subject ranks first, then any free teacher; ties break by name. Never a model. Shared by the
// ops.timetable `substitutions/suggest` door and the leave-cover proposal (routes.js
// `runTeacherLeaveOutcome`), so the ranking the coordinator sees can never drift from the one the
// timetable desk offers.
export const SUBSTITUTE_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export async function substitutionSuggestions(c, tenantId, { absentTeacher, dayOfWeek }) {
  const day = SUBSTITUTE_DAYS.includes(dayOfWeek) ? dayOfWeek : SUBSTITUTE_DAYS[(new Date().getDay() + 6) % 7];
  const missed = (await c.query(
    `SELECT s.id, s.subject, s.room, p.label, p.start_time, p.end_time, p.sort_idx
     FROM app.timetable_slots s JOIN app.timetable_periods p ON p.id = s.period_id
     WHERE s.tenant_id=$1 AND s.day_of_week=$2 AND s.teacher_name=$3 ORDER BY p.sort_idx`,
    [tenantId, day, absentTeacher])).rows;
  const busy = new Set((await c.query(
    `SELECT DISTINCT s.teacher_name, p.sort_idx FROM app.timetable_slots s
     JOIN app.timetable_periods p ON p.id = s.period_id
     WHERE s.tenant_id=$1 AND s.day_of_week=$2`,
    [tenantId, day])).rows.map((r) => `${r.teacher_name}|${r.sort_idx}`));
  const candidates = (await c.query(
    `SELECT DISTINCT teacher_name FROM app.timetable_slots WHERE tenant_id=$1 AND teacher_name <> $2`,
    [tenantId, absentTeacher])).rows.map((r) => r.teacher_name);
  const teaches = new Set((await c.query(
    `SELECT DISTINCT teacher_name, subject FROM app.timetable_slots WHERE tenant_id=$1`,
    [tenantId])).rows.map((r) => `${r.teacher_name}|${r.subject}`));
  const suggestions = missed.map((m) => ({
    slot: { id: m.id, subject: m.subject, label: m.label, start: m.start_time, end: m.end_time, room: m.room },
    candidates: candidates
      .filter((t) => !busy.has(`${t}|${m.sort_idx}`)) // actually free that period
      .map((t) => ({
        teacher: t,
        // same-subject teachers rank first (compared against the teacher pool, not the subject)
        score: (teaches.has(`${t}|${m.subject}`) ? 100 : 0) + (t.length % 3), // stable tiebreak
      }))
      .sort((a, b) => b.score - a.score || a.teacher.localeCompare(b.teacher))
      .slice(0, 3),
  }));
  return { day, absentTeacher, suggestions };
}
