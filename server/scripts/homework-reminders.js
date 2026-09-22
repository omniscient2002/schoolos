// Homework reminder worker (TODO_FIX_MAP L4 · TEACHER-PARENT-STUDENT DEL-1): a cron-able sweep that
// queues guardian reminders for (a) homework due in the next 24h (a heads-up to every guardian in the
// class) and (b) homework that became overdue in the last 7 days with no submission (a nudge to the
// guardians of the students who have not turned it in).
//
// Same posture as scripts/dunning-reminders.js:
//   · all-tenant maintenance sweep on the named privileged helper (sysq) — never a second raw pg.Client
//   · quiet hours honoured from comms.whatsapp settings (IST, default 21:00–08:00); during quiet hours
//     nothing is written
//   · rows are queued as `status='queued'` and left for scripts/comms-dispatcher.js, so this inherits
//     the carrier-honesty rule (a sandbox carrier records 'failed' with a reason, never 'sent')
//   · dedup_key = homework:<kind>:<homeworkId>:<studentId>, so a re-run the same day queues nothing new
//
// Two entry points, one sweep (the double-duty pattern day-worker.js and dunning-reminders.js use):
//   as a library:  const { runHomeworkReminders } = await import('./homework-reminders.js');
//   as a cron job: node scripts/homework-reminders.js   (exits 1 when reminders were queued, else 0)
import { pathToFileURL } from 'node:url';
import { sysq } from '../src/db.js';

const defaultQ = sysq;

const IST_NOW_MS = (now) => now.getTime() + 5.5 * 3600 * 1000;
const IST_MINUTE = (now) => { const d = new Date(IST_NOW_MS(now)); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const parseHm = (s) => { const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(s ?? '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const inQuiet = (q0, q1, m) => q0 === null || q1 === null ? false : (q0 <= q1 ? (m >= q0 && m < q1) : (m >= q0 || m < q1));
const dueLabel = (d) => new Date(d).toISOString().slice(0, 10);

/**
 * Sweep every tenant for homework that needs a guardian reminder.
 *
 * @param q      query function (defaults to the privileged helper) — pass the caller's pool so the
 *               sweep shares one connection and joins the caller's transaction/telemetry.
 * @param quiet  tri-state, mirroring dunning-reminders: null → decide from the clock per tenant;
 *               true → queue nothing (reported quiet, not an error); false → sweep regardless of clock.
 * @param now    injectable clock for deterministic tests (defaults to the real one).
 * @returns { queued, tenants: [...], quietHoursSkipped: [...], quiet }
 */
export async function runHomeworkReminders({ q = defaultQ, quiet = null, now = new Date() } = {}) {
  const report = { tenants: [], queuedTotal: 0, quietHoursSkipped: [], quiet: false };
  if (quiet === true) { report.quiet = true; return { ...report, queued: 0 }; }

  const tenants = (await q(`SELECT id, slug FROM app.tenants ORDER BY slug`)).rows;
  for (const t of tenants) {
    const s = (await q(`SELECT settings FROM app.plugins WHERE tenant_id=$1 AND plugin_id='comms.whatsapp'`, [t.id])).rows[0]?.settings ?? {};
    const quietHours = s.quiet_hours ?? { start: '21:00', end: '08:00' };
    const q0 = parseHm(quietHours.start), q1 = parseHm(quietHours.end);
    if (quiet === null && inQuiet(q0, q1, IST_MINUTE(now))) {
      report.quietHoursSkipped.push({ slug: t.slug, quietHours });
      report.quiet = true;
      continue;
    }

    /* (a) due in the next 24h — heads-up to the whole class; (b) overdue in the last 7 days — nudge
       only the guardians of students with no submission. `teacher.homework.class_grade` is a grade
       name, so a homework covers every section of that grade (the same scope the teacher set it for). */
    const dueSoon = (await q(
      `SELECT id, class_grade, subject, title, due_at FROM teacher.homework
        WHERE tenant_id=$1 AND status='open' AND due_at > $2 AND due_at <= $2::timestamptz + interval '24 hours'`,
      [t.id, now])).rows;
    const overdue = (await q(
      `SELECT id, class_grade, subject, title, due_at FROM teacher.homework
        WHERE tenant_id=$1 AND status='open' AND due_at <= $2 AND due_at > $2::timestamptz - interval '7 days'`,
      [t.id, now])).rows;

    let queued = 0, skippedNoContact = 0;
    const notify = async (hw, kind) => {
      const requireMissing = kind === 'overdue';
      /* `class_grade` is authored as either "6" (whole grade) or "6-A" (a section). Match the grade
         always, and the section only when the homework names one — so a grade-wide homework reaches
         every section and a section homework reaches only that section. */
      const guardians = (await q(
        `SELECT st.id AS student_id, st.name AS student_name, g.phone
           FROM app.students st
           JOIN app.guardians g ON g.tenant_id = st.tenant_id AND g.student_id = st.id AND g.is_primary
          WHERE st.tenant_id=$1 AND st.status='active' AND g.phone IS NOT NULL
            AND st.grade = split_part($2, '-', 1)
            AND (position('-' in $2) = 0 OR st.section = split_part($2, '-', 2))
            AND ($3::boolean = false OR NOT EXISTS (
                  SELECT 1 FROM teacher.submission sb WHERE sb.homework_id=$4 AND sb.student_id = st.id))`,
        [t.id, hw.class_grade, requireMissing, hw.id])).rows;
      if (guardians.length === 0) skippedNoContact += 1;
      for (const g of guardians) {
        const title = `"${hw.title}"${hw.subject ? ` (${hw.subject})` : ''}`;
        const body = kind === 'overdue'
          ? `Homework not submitted: ${title} for ${g.student_name} was due ${dueLabel(hw.due_at)}. Please ask them to submit it.`
          : `Homework due soon: ${title} for ${g.student_name} is due ${dueLabel(hw.due_at)}.`;
        const inserted = await q(
          `INSERT INTO app.communications (tenant_id, audience_kind, audience_json, channel, template, body, status, policy_ref, dedup_key)
           VALUES ($1,'guardian',$2::jsonb,'whatsapp',$3,$4,'queued','TeacherOS §homework',$5)
           ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING`,
          [t.id, JSON.stringify([g.phone]),
           kind === 'overdue' ? 'HOMEWORK_OVERDUE' : 'HOMEWORK_DUE', body,
           `homework:${kind}:${hw.id}:${g.student_id}`]);
        queued += inserted.rowCount;
      }
    };
    for (const hw of dueSoon) await notify(hw, 'due_soon');
    for (const hw of overdue) await notify(hw, 'overdue');

    report.tenants.push({ slug: t.slug, dueSoon: dueSoon.length, overdue: overdue.length, queued, skippedNoContact });
    report.queuedTotal += queued;
  }
  return { ...report, queued: report.queuedTotal };
}

// CLI guard: runs the sweep; importing gets the function and no side effects. Exit contract for cron:
// 1 when reminders were queued (so an alert can fire), 0 when clean or quiet.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = await runHomeworkReminders();
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.queued > 0 ? 1 : 0);
}
