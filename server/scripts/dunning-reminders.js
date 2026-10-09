// Dunning worker (Wave 3 · L1-3.2): cron-able overdue-fee reminder sweep across ALL tenants on the owner
// path. Same rules as POST /fees/dunning/run: open/partial + past due + unpaid remainder, 7-day dedup per
// obligation (dedup_key = dunning:<obligationId>), guardians with a phone only, quiet hours from
// comms.whatsapp settings (IST, default 21:00–08:00) — during quiet hours the sweep writes nothing.
//
// Rows are queued as `status='queued'` and left for `scripts/comms-dispatcher.js` to deliver, so dunning
// inherits the carrier-honesty rule (PRD-13): a sandbox carrier in production records 'failed' with a
// reason, never 'sent'.
//
// TWO ENTRY POINTS, ONE SWEEP (PRD-13 residual). This file used to be a self-executing script with no
// exports, while `scripts/day-worker.js` step 4 imported `../src/plugins/money.invoicing/dunning.js` and
// called `runDunning()` on it. That path DOES NOT EXIST, so the import threw MODULE_NOT_FOUND on every
// single run, the catch logged `day.dunning { status: 'skipped' }`, and a money-collecting step reported
// a clean day while doing nothing — the worker's own comment called it transitional "until L1's module
// lands", but the module was never going to land at that path because the sweep was already here. The
// sweep is now a real export, so the daily worker and the cron entry run the SAME code.
//   as a library:  const { runDunning } = await import('./dunning-reminders.js'); await runDunning({ q })
//   as a cron job: node scripts/dunning-reminders.js    (exits 1 when reminders were queued, else 0)
import { pathToFileURL } from 'node:url';
import { sysq } from '../src/db.js';
import { selectOverdue, selectBeforeDue, selectEscalation, overdueBody, beforeDueBody, escalationBody, overdueDedup, beforeDueDedup, escalationDedup } from '../src/fees/dunning.js';

// This is an all-tenant maintenance sweep, so it deliberately uses the named
// privileged helper. Keeping the choice in db.js makes the owner path explicit
// and prevents a second raw pg.Client from silently bypassing the DB boundary.
const defaultQ = sysq;

const IST_NOW_MS = () => Date.now() + 5.5 * 3600 * 1000;
const IST_TODAY = () => new Date(IST_NOW_MS()).toISOString().slice(0, 10);
const IST_MINUTE = () => { const d = new Date(IST_NOW_MS()); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const parseHm = (s) => { const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(s ?? '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const inQuiet = (q0, q1, m) => q0 === null || q1 === null ? false : (q0 <= q1 ? (m >= q0 && m < q1) : (m >= q0 || m < q1));

/**
 * Sweep every tenant for overdue fees and queue the reminders.
 *
 * @param q      query function (defaults to a fresh client per call) — pass the caller's pool so the
 *               sweep shares one connection and can join the caller's transaction/telemetry.
 * @param quiet  tri-state, and the reason it is a parameter rather than a hidden global:
 *                 null  → decide from the clock per tenant (the real cron behaviour);
 *                 true  → treat it as quiet hours and queue nothing (reported as quiet, NOT as an error);
 *                 false → sweep regardless of the clock. A cron entry wants `null`; a test that must be
 *                         deterministic at any hour of the day needs one of the other two, and a sweep
 *                         whose only honest answer is "it depends what time it is" cannot be tested.
 * @returns { queued, quiet, tenants: [{ slug, queued, skippedNoContact }], quietHoursSkipped: [...] }
 */
export async function runDunning({ q = defaultQ, quiet = null } = {}) {
  const report = { date: IST_TODAY(), tenants: [], queuedTotal: 0, quietHoursSkipped: [], quiet: false };
  if (quiet === true) { report.quiet = true; return { ...report, queued: 0 }; }

  const tenants = (await q(`SELECT id, slug FROM app.tenants ORDER BY slug`)).rows;
  for (const t of tenants) {
    // F-14 parity: fee_settings owns the ladder + quiet hours (plugin is fallback),
    // exactly like the HTTP door's dunningPolicy/dunningQuietHours. A tenant that
    // configures everything in Fee policy gets the same sweep from cron and door.
    const fs = (await q(`SELECT settings FROM app.fee_settings WHERE tenant_id=$1`, [t.id]).catch(() => ({ rows: [] }))).rows[0]?.settings ?? {};
    const clean = (v) => Array.isArray(v) ? v.filter((n) => Number.isInteger(n) && n > 0 && n <= 90) : null;
    const s = (await q(`SELECT settings FROM app.plugins WHERE tenant_id=$1 AND plugin_id='comms.whatsapp'`, [t.id])).rows[0]?.settings ?? {};
    let before = clean(fs.dunning_before_due_days);
    let escalate = clean(fs.dunning_escalation_days);
    if (before === null) before = Array.isArray(s.before_due_days) ? s.before_due_days.filter((n) => Number.isInteger(n) && n > 0) : [];
    if (escalate === null) escalate = Array.isArray(s.escalation_days) ? s.escalation_days.filter((n) => Number.isInteger(n) && n > 0) : [];
    const quietStart = fs.dunning_quiet_start ?? s.quiet_hours?.start ?? '21:00';
    const quietEnd = fs.dunning_quiet_end ?? s.quiet_hours?.end ?? '08:00';
    const quietHours = { start: quietStart, end: quietEnd };
    const q0 = parseHm(quietHours.start), q1 = parseHm(quietHours.end);
    if (quiet === null && inQuiet(q0, q1, IST_MINUTE())) {
      report.quietHoursSkipped.push({ slug: t.slug, quietHours });
      report.quiet = true;
      continue;
    }
    const today = IST_TODAY();
    const queue = async (o, { kind, dedup, body, offsetDays }) => {
      if (!o.guardian_phone) { skippedNoContact += 1; return 0; }
      const inserted = await q(
        `INSERT INTO app.communications (tenant_id, audience_kind, audience_json, channel, template, body, status, policy_ref, dedup_key)
         VALUES ($1,'guardian',$2::jsonb,'whatsapp',$3,$4,'queued','Fees §4.2',$5)
         ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING`,
        [t.id, JSON.stringify([o.guardian_phone]),
         kind === 'escalation' ? 'FEE_ESCALATION' : 'FEE_REMINDER', body, dedup]);
      if (inserted.rowCount > 0) {
        await q(
          `INSERT INTO app.fee_dunning_log (tenant_id, obligation_id, kind, channel, offset_days, dedup_key)
           VALUES ($1,$2,$3,'whatsapp',$4,$5) ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING`,
          [t.id, o.id, kind, offsetDays ?? null, dedup]);
      }
      return inserted.rowCount;
    };
    let queued = 0; let skippedNoContact = 0; let escalated = 0;
    for (const o of await selectOverdue(q, t.id, today)) queued += await queue(o, { kind: 'overdue', dedup: overdueDedup(o.id), body: overdueBody(o) });
    for (const offset of before) for (const o of await selectBeforeDue(q, t.id, today, offset)) queued += await queue(o, { kind: 'before_due', dedup: beforeDueDedup(o.id, offset), body: beforeDueBody(o), offsetDays: offset });
    // F-14 parity: escalation raises a finance Action like the door (kind exception —
    // 'task' violates actions_kind_check). Idempotent via code-unique ON CONFLICT.
    for (const days of escalate) for (const o of await selectEscalation(q, t.id, today, days)) {
      const n = await queue(o, { kind: 'escalation', dedup: escalationDedup(o.id, days), body: escalationBody(o), offsetDays: days });
      if (n > 0) {
        escalated += 1;
        const due = (() => { try { return (BigInt(o.net_amount_cents ?? o.amount_cents) - BigInt(o.paid_cents)).toString(); } catch { return '?'; } })();
        await q(
          `INSERT INTO app.actions (tenant_id, code, kind, title, detail, why, priority, status, owner, owner_role, policy_ref, ai_involved, payload)
           VALUES ($1,$2,'exception',$3,$4,$5,'high','open','Finance','finance','Fees §4.2',false,$6::jsonb)
           ON CONFLICT (tenant_id, code) DO NOTHING`,
          [t.id, `fee.overdue.${o.id}`,
           `Overdue fee ${days}d+ — ${o.student_name} ${o.label}`,
           `₹${Number(due) / 100} outstanding since ${o.due_on}.`,
           'Fee escalation policy: an aged overdue obligation needs a human decision.',
           JSON.stringify({ obligationId: o.id, daysOverdue: days, raised_by: 'dunning-worker' })]);
      }
    }
    report.tenants.push({ slug: t.slug, queued, skippedNoContact, escalated });
    report.queuedTotal += queued;
    report.escalatedTotal = (report.escalatedTotal ?? 0) + escalated;
  }
  return { ...report, queued: report.queuedTotal };
}

// CLI guard: `node scripts/dunning-reminders.js` runs the sweep; importing gets the function and no
// side effects (the double-duty pattern day-worker.js already uses). Exit contract preserved for cron
// wrappers: 1 when reminders were queued so an alert can fire, 0 when clean or quiet.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = await runDunning();
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.queued > 0 ? 1 : 0);
}
