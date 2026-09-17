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
    const s = (await q(`SELECT settings FROM app.plugins WHERE tenant_id=$1 AND plugin_id='comms.whatsapp'`, [t.id])).rows[0]?.settings ?? {};
    const quietHours = s.quiet_hours ?? { start: '21:00', end: '08:00' };
    const q0 = parseHm(quietHours.start), q1 = parseHm(quietHours.end);
    if (quiet === null && inQuiet(q0, q1, IST_MINUTE())) {
      report.quietHoursSkipped.push({ slug: t.slug, quietHours });
      report.quiet = true;
      continue;
    }
    const rows = (await q(
      `SELECT o.id, o.label, o.due_on, o.amount_cents, o.paid_cents, s.name AS student_name, s.guardian_phone
       FROM app.fee_obligations o JOIN app.students s ON s.id = o.student_id
       WHERE o.tenant_id=$1 AND o.status IN ('open','partial') AND o.due_on < $2::date AND o.amount_cents > o.paid_cents
         AND NOT EXISTS (SELECT 1 FROM app.communications cm
                          WHERE cm.dedup_key = 'dunning:' || o.id::text AND cm.created_at > now() - interval '7 days')
       ORDER BY o.due_on LIMIT 200`, [t.id, IST_TODAY()])).rows;
    let queued = 0; let skippedNoContact = 0;
    for (const o of rows) {
      if (!o.guardian_phone) { skippedNoContact += 1; continue; }
      const due = BigInt(o.amount_cents) - BigInt(o.paid_cents);
      const inserted = await q(
        `INSERT INTO app.communications (tenant_id, audience_kind, audience_json, channel, template, body, status, policy_ref, dedup_key)
         VALUES ($1,'guardian',$2::jsonb,'whatsapp','FEE_REMINDER',$3,'queued','Fees §4.2',$4)
         ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING`,
        [t.id, JSON.stringify([o.guardian_phone]),
         `Fee reminder: ${o.student_name} — ${o.label}, ₹${Number(due) / 100} was due on ${o.due_on}. Please pay via the parent portal or at the school office. If you have already paid, please share the receipt with the office — no action otherwise.`,
         `dunning:${o.id}`]);
      queued += inserted.rowCount;
    }
    report.tenants.push({ slug: t.slug, queued, skippedNoContact });
    report.queuedTotal += queued;
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
