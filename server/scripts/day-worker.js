#!/usr/bin/env node
// Day worker (L2-3.4, Wave 3) — the ONE daily maintenance entry point. Cron-shape:
// runs every step once, then exits (compose one-shot / host cron — never loops).
//
// Steps, in order (each failure is contained — a failing step never blocks the
// rest; every step emits one structured, grep-able JSON line):
//   1. preventive WO generation — STUB: the policy source (asset register +
//      service intervals) is not built yet; this step records the tick and the
//      hook point so the future generator drops in without a worker change.
//   2. tally export summary — aggregates confirmed kernel fee payments for the
//      previous day (the accounting.tally door does the full voucher export on
//      demand; this is the daily book-side sanity line).
//   3. retention — scripts/retention-worker.js pass() (purges + audit archival).
//   4. fee dunning — scripts/dunning-reminders.js export (L1-3.2): sweep of overdue
//      fees across tenants, queueing FEE_REMINDER comms rows for the dispatcher.
//      A failing sweep logs `skipped` and never crashes the day (containment).
//
// Compose cron entry (host cron, one line — the compose service mirrors the
// retention one-shot; S0 wires the service at the next gate):
//   30 3 * * * cd /srv/schoolos/server && /usr/bin/docker compose run --rm day-worker >> /var/log/schoolos-day.log 2>&1
import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { config } from '../src/config.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2 });
const line = (kind, data) => console.log(JSON.stringify({ kind, at: new Date().toISOString(), ...data }));

// ── 1. preventive work-order generation (stub; policy source not built yet) ──
export async function runPreventiveStub() {
  line('day.preventive.tick', { status: 'stub', note: 'preventive WO generation policy not configured — hook point: scripts/day-worker.js runPreventiveStub', generated: 0 });
  return { status: 'stub', generated: 0 };
}

// ── 2. tally export summary (book-side daily sanity line) ────────────────────
export async function runTallySummary() {
  const r = await pool.query(
    `SELECT count(*)::int AS n, COALESCE(sum(amount_cents),0)::bigint AS cents
     FROM app.payments
     WHERE status='confirmed' AND created_at >= date_trunc('day', now()) - interval '1 day'
       AND created_at < date_trunc('day', now())`);
  const { n, cents } = r.rows[0] ?? { n: 0, cents: 0 };
  line('day.tally.summary', { confirmedPayments: n, amountCents: Number(cents), note: 'full voucher export rides POST /plugins/accounting.tally/export (owner/finance)' });
  return { confirmedPayments: n, amountCents: Number(cents) };
}

// ── 3. retention (purges + chain-preserving audit archival) ──────────────────
export async function runRetention() {
  const { pass } = await import('./retention-worker.js');
  const counts = await pass();
  // C3: purge stale student-session activity rows (the shared idle store). Bounded and best-effort —
  // a database that predates migration 126 simply skips.
  try {
    const r = await pool.query(`DELETE FROM auth.session_activity WHERE last_seen_at < now() - interval '2 days'`);
    counts.sessionActivityPurged = r.rowCount;
  } catch { /* auth.session_activity absent — pre-126 */ }
  line('day.retention.pass', counts);
  return counts;
}

// ── 4. fee dunning — scripts/dunning-reminders.js (L1-3.2) ───────────────────
// PRD-13 residual. This used to import `../src/plugins/money.invoicing/dunning.js`, a path that does not
// exist, and call `runDunning()` on it. The import threw MODULE_NOT_FOUND on EVERY run, the catch below
// logged `day.dunning { status: 'skipped' }`, and the day reported clean — a money-collecting step that
// could never have worked, waiting for a module that was never going to be written there, because the
// sweep already existed as a self-executing script with no exports. That script now exports `runDunning`,
// so the daily worker and the cron entry run the SAME sweep instead of two divergent ideas of one.
//
// The containment posture is deliberately unchanged, and is what the old test was really protecting: a
// failing sweep is reported and never crashes the day. It is now exercised by making the sweep fail
// (tests/day-worker-dunning.test.js) instead of by asserting that its module is missing.
export async function runDunningHook({ runDunning = null, quiet = null } = {}) {
  try {
    const sweep = runDunning ?? (await import('./dunning-reminders.js')).runDunning;
    const out = await sweep({ q: (text, params) => pool.query(text, params), quiet });
    line('day.dunning', { status: 'ok', ...(out && typeof out === 'object' ? out : { result: String(out) }) });
    return { status: 'ok', ...out };
  } catch (e) {
    // Contained skip, never a crashed cron. This now means "the sweep FAILED", which is a real
    // operational signal; before it meant "the sweep does not exist", which was not a signal at all.
    line('day.dunning', { status: 'skipped', reason: e.message });
    return { status: 'skipped', reason: e.message };
  }
}

// NOTE (TODO_FIX_MAP L4): homework reminders are NOT a step here on purpose. day-worker runs at 03:05
// IST, inside the comms quiet hours (21:00–08:00), so a sweep with the shared quiet-hours guard would
// silently skip every night. scripts/homework-reminders.js is scheduled on its own evening cron line
// instead (ops/cron/schoolos.cron), outside quiet hours, so the reminder actually goes out.

// ── 5. library due/overdue reminders (library v2, docs/LIBRARY-DESIGN.md) ──────
// For every tenant with the library enabled, sweep issued loans and, for the tenant's configured offsets,
// notify the borrower (student OR staff) and, when the borrower is a student, the parent. In-app rows are
// the delivery; an outbound comms row is queued only when a non-in_app channel is configured, so the
// dispatcher carries it and honesty rules apply (PRD-13/17). Deduped per loan per offset per day.
export async function runLibraryReminders() {
  const tenants = await pool.query(
    `SELECT tenant_id, settings FROM app.plugins WHERE plugin_id='library' AND status IN ('enabled','active','degraded')`);
  let notified = 0, queued = 0;
  const istToday = `('now' AT TIME ZONE 'Asia/Kolkata')::date`;
  for (const trow of tenants.rows) {
    const t = trow.tenant_id;
    const s = trow.settings ?? {};
    const offsets = Array.isArray(s.due_reminder_days_before) ? s.due_reminder_days_before.map(Number).filter((n) => n >= 0) : [1];
    const repeat = Math.max(1, Number(s.overdue_repeat_days) || 7);
    const channels = Array.isArray(s.notify_channels) ? s.notify_channels
      : String(s.notify_channels ?? 'in_app').split(',').map((x) => x.trim()).filter(Boolean);
    const outChannel = channels.find((c) => c !== 'in_app') ?? null;
    const notifyParent = s.notify_parent !== false;
    // LMS-13: quiet hours apply to OUTBOUND channels only (an SMS at 02:00 is the intrusion; the in-app
    // bell is not). The sweep still records the in-app reminder; the outbound row is simply not queued
    // while inside the window, so it is not sent at an antisocial hour.
    const qh = Array.isArray(s.quiet_hours_ist) && s.quiet_hours_ist.length === 2 ? s.quiet_hours_ist.map(Number) : null;
    const istHour = new Date(Date.now() + 5.5 * 3600 * 1000).getUTCHours();
    const inQuiet = qh ? (qh[0] <= qh[1] ? (istHour >= qh[0] && istHour < qh[1]) : (istHour >= qh[0] || istHour < qh[1])) : false;

    const remind = async (loan, kind, dedup) => {
      const userIds = [];
      if (loan.student_id) {
        const su = await pool.query(`SELECT user_id FROM app.student_accounts WHERE tenant_id=$1 AND student_id=$2`, [t, loan.student_id]);
        if (su.rows[0]) userIds.push(su.rows[0].user_id);
        if (notifyParent) {
          const pa = await pool.query(`SELECT user_id FROM family.child_link WHERE tenant_id=$1 AND student_id=$2`, [t, loan.student_id]);
          for (const p of pa.rows) userIds.push(p.user_id);
        }
      } else if (loan.borrower_user_id) userIds.push(loan.borrower_user_id);

      const title = kind === 'overdue' ? 'Library book overdue' : 'Library book due soon';
      const body = kind === 'overdue'
        ? `"${loan.title}" was due on ${loan.due_on}. Please return it to the library.`
        : `"${loan.title}" is due on ${loan.due_on}. Return or renew it before the due date.`;
      for (const uid of [...new Set(userIds.filter(Boolean))]) {
        const ins = await pool.query(
          `INSERT INTO app.notifications (tenant_id, user_id, "group", title, body, ref)
           SELECT $1,$2,'library',$3,$4,$5
            WHERE NOT EXISTS (SELECT 1 FROM app.notifications n
              WHERE n.tenant_id=$1 AND n.user_id=$2 AND n.ref=$5 AND n.title=$3
                AND n.created_at >= ${istToday})`, [t, uid, title, body, loan.id]);
        if (ins.rowCount) notified++;
      }
      if (outChannel && !inQuiet) {
        const phones = [];
        if (loan.staff_phone) phones.push(loan.staff_phone);
        const gp = await pool.query(
          loan.student_id
            ? `SELECT g.phone FROM app.guardians g WHERE g.tenant_id=$1 AND g.student_id=$2 AND g.phone IS NOT NULL`
            : `SELECT u.phone FROM app.users u WHERE u.id=$2 AND u.phone IS NOT NULL`, [t, loan.student_id ?? loan.borrower_user_id]);
        for (const r of gp.rows) if (r.phone) phones.push(r.phone);
        if (phones.length) {
          const ins = await pool.query(
            `INSERT INTO app.communications (tenant_id, audience_kind, audience_json, channel, template, body, status, policy_ref, dedup_key)
             VALUES ($1,'library',$2::jsonb,$3,$4,$5,'queued','Library desk norms',$6)
             ON CONFLICT (dedup_key) DO NOTHING`,
            [t, JSON.stringify([...new Set(phones)]), outChannel, kind === 'overdue' ? 'library.overdue.v1' : 'library.due.v1', body, dedup]);
          if (ins.rowCount) queued++;
        }
      }
    };

    for (const off of offsets) {
      const loans = await pool.query(
        `SELECT l.id, l.student_id, l.borrower_user_id, l.due_on, l.borrower_type, b.title,
                u.phone AS staff_phone
           FROM library.loan l JOIN library.book b ON b.id=l.book_id
           LEFT JOIN app.users u ON u.id=l.borrower_user_id
          WHERE l.tenant_id=$1 AND l.status='issued' AND l.due_on = (${istToday} + $2::int)`, [t, off]);
      for (const loan of loans.rows) await remind(loan, 'due', `library:due:${loan.id}:${off}`);
    }
    const overdue = await pool.query(
      `SELECT l.id, l.student_id, l.borrower_user_id, l.due_on, l.borrower_type, b.title,
              u.phone AS staff_phone, (${istToday} - l.due_on) AS days
         FROM library.loan l JOIN library.book b ON b.id=l.book_id
         LEFT JOIN app.users u ON u.id=l.borrower_user_id
        WHERE l.tenant_id=$1 AND l.status='issued' AND l.due_on < ${istToday}`, [t]);
    for (const loan of overdue.rows) {
      if (Number(loan.days) % repeat !== 0) continue;
      await remind(loan, 'overdue', `library:overdue:${loan.id}:${loan.days}`);
    }
  }
  line('day.library.reminders', { tenants: tenants.rows.length, notified, queued });
  return { tenants: tenants.rows.length, notified, queued };
}

// ── 6. library reservation expiry (LMS-1) ──────────────────────────────────────
// A `ready` hold that is not collected by its expiry is marked `expired`, the borrower is told, and the
// queue advances to the next requester (who becomes `ready` with a fresh window). Without this a hold
// would sit ready forever and the queue behind it would never move.
export async function runLibraryReservationExpiry() {
  const tenants = await pool.query(
    `SELECT tenant_id, settings FROM app.plugins WHERE plugin_id='library' AND status IN ('enabled','active','degraded')`);
  let expired = 0, promoted = 0;
  const istToday = `('now' AT TIME ZONE 'Asia/Kolkata')::date`;

  const notifyHold = async (t, hold, title, body) => {
    const ids = [];
    if (hold.borrower_student_id) {
      const su = await pool.query(`SELECT user_id FROM app.student_accounts WHERE tenant_id=$1 AND student_id=$2`, [t, hold.borrower_student_id]);
      if (su.rows[0]) ids.push(su.rows[0].user_id);
      const pa = await pool.query(`SELECT user_id FROM family.child_link WHERE tenant_id=$1 AND student_id=$2`, [t, hold.borrower_student_id]);
      for (const p of pa.rows) ids.push(p.user_id);
    } else if (hold.borrower_user_id) ids.push(hold.borrower_user_id);
    for (const uid of [...new Set(ids.filter(Boolean))]) {
      await pool.query(
        `INSERT INTO app.notifications (tenant_id, user_id, "group", title, body, ref)
         SELECT $1,$2,'library',$3,$4,$5
          WHERE NOT EXISTS (SELECT 1 FROM app.notifications n
            WHERE n.tenant_id=$1 AND n.user_id=$2 AND n.ref=$5 AND n.title=$3 AND n.created_at >= ${istToday})`,
        [t, uid, title, body, hold.id]);
    }
  };

  const promoteOldest = async (t, bookId, holdDays) => {
    const free = (await pool.query(`SELECT count(*) FILTER (WHERE status='available')::int a FROM library.copy WHERE tenant_id=$1 AND book_id=$2`, [t, bookId])).rows[0].a;
    if (free <= 0) return null;
    const hold = (await pool.query(
      `SELECT id, borrower_type, borrower_student_id, borrower_user_id FROM library.reservation
        WHERE tenant_id=$1 AND book_id=$2 AND status='requested'
        ORDER BY queue_no ASC NULLS LAST, requested_at ASC LIMIT 1`, [t, bookId])).rows[0];
    if (!hold) return null;
    const expiry = new Date(Date.now() + holdDays * 86400000).toISOString();
    await pool.query(`UPDATE library.reservation SET status='ready', ready_at=now(), expires_at=$2 WHERE id=$1`, [hold.id, expiry]);
    const title = (await pool.query(`SELECT title FROM library.book WHERE id=$1`, [bookId])).rows[0]?.title ?? 'your book';
    await notifyHold(t, hold, 'Your library book is ready', `"${title}" is waiting at the library — collect it within ${holdDays} day(s).`);
    return hold.id;
  };

  for (const trow of tenants.rows) {
    const t = trow.tenant_id;
    const holdDays = Math.max(1, Number((trow.settings ?? {}).reservation_hold_days) || 2);
    const gone = await pool.query(
      `UPDATE library.reservation SET status='expired'
        WHERE tenant_id=$1 AND status='ready' AND expires_at IS NOT NULL AND expires_at < now()
        RETURNING id, book_id, borrower_type, borrower_student_id, borrower_user_id`, [t]);
    for (const r of gone.rows) {
      expired++;
      const title = (await pool.query(`SELECT title FROM library.book WHERE id=$1`, [r.book_id])).rows[0]?.title ?? 'your book';
      await notifyHold(t, r, 'Library reservation expired', `Your hold on "${title}" expired because it was not collected. You can reserve it again.`);
      if (await promoteOldest(t, r.book_id, holdDays)) promoted++;
    }
  }
  line('day.library.expiry', { tenants: tenants.rows.length, expired, promoted });
  return { tenants: tenants.rows.length, expired, promoted };
}

// ── 7. principal's daily brief (OPP-PRD-2) ─────────────────────────────────────
// The one screen ROLE-NEEDS §4 asks for: absentees, fee dues, overnight incidents, deadlines today and AI
// calls that stopped on budget — computed from the live tables per tenant and stored once per school day.
export async function runPrincipalBrief() {
  const istToday = `('now' AT TIME ZONE 'Asia/Kolkata')::date`;
  const tenants = await pool.query(`SELECT id FROM app.tenants`);
  let written = 0;
  for (const { id: t } of tenants.rows) {
    const q = (text, params = []) => pool.query(text, params);
    const absent = (await q(`SELECT count(*)::int n FROM app.attendance WHERE tenant_id=$1 AND school_date=${istToday} AND status='absent'`, [t])).rows[0].n;
    const dues = (await q(`SELECT count(*)::int n, COALESCE(sum(amount_cents - paid_cents),0)::bigint cents FROM app.fee_obligations WHERE tenant_id=$1 AND status IN ('pending','partial') AND due_on < ${istToday}`, [t])).rows[0];
    const incidents = (await q(`SELECT count(*)::int n FROM app.cases WHERE tenant_id=$1 AND status='open' AND created_at >= now() - interval '1 day'`, [t])).rows[0].n;
    const deadlines = (await q(`SELECT count(*)::int n FROM app.actions WHERE tenant_id=$1 AND status='open' AND deadline::date = ${istToday}`, [t])).rows[0].n;
    const openActions = (await q(`SELECT owner_role, count(*)::int n FROM app.actions WHERE tenant_id=$1 AND status='open' GROUP BY owner_role`, [t])).rows;
    const aiStopped = (await q(`SELECT count(*)::int n FROM app.ai_calls WHERE tenant_id=$1 AND outcome='budget' AND created_at >= now() - interval '1 day'`, [t])).rows[0].n;
    const payload = {
      absentees: absent,
      fee_dues: { count: dues.n, outstanding_cents: Number(dues.cents) },
      overnight_incidents: incidents,
      deadlines_today: deadlines,
      open_actions_by_role: Object.fromEntries(openActions.map((r) => [r.owner_role ?? 'unassigned', r.n])),
      ai_calls_stopped_on_budget: aiStopped,
      generated_at: new Date().toISOString(),
    };
    const ins = await pool.query(
      `INSERT INTO app.principal_briefs (tenant_id, brief_date, payload)
       VALUES ($1, ${istToday}, $2::jsonb)
       ON CONFLICT (tenant_id, brief_date) DO UPDATE SET payload=EXCLUDED.payload RETURNING id`, [t, JSON.stringify(payload)]);
    if (ins.rowCount) written++;
    await pool.query(
      `INSERT INTO app.notifications (tenant_id, "group", title, body, ref)
       SELECT $1,'needs-you','Your morning brief is ready',$2,'/principal-brief'
        WHERE NOT EXISTS (SELECT 1 FROM app.notifications n WHERE n.tenant_id=$1 AND n.ref='/principal-brief' AND n.created_at >= now() - interval '20 hours')`,
      [t, `${absent} absent · ${dues.n} overdue fee${dues.n === 1 ? '' : 's'} · ${incidents} new case${incidents === 1 ? '' : 's'} · ${deadlines} decision deadline${deadlines === 1 ? '' : 's'} today.`]);
  }
  line('day.principal.brief', { tenants: tenants.rows.length, written });
  return { tenants: tenants.rows.length, written };
}

// ── 8. compliance-calendar reminders (OPP-PRD-5) ───────────────────────────────
export async function runComplianceReminders({ leadDays = 14 } = {}) {
  const r = await pool.query(
    `UPDATE app.compliance_items SET status='reminded'
      WHERE status='due' AND due_on <= (('now' AT TIME ZONE 'Asia/Kolkata')::date + $1::int)
      RETURNING id, tenant_id, title, due_on`, [leadDays]);
  for (const item of r.rows) {
    await pool.query(
      `INSERT INTO app.notifications (tenant_id, "group", title, body, ref)
       VALUES ($1,'needs-you',$2,$3,'/compliance')`,
      [item.tenant_id, `Compliance due: ${item.title}`, `Due ${item.due_on.toISOString?.().slice(0, 10) ?? item.due_on}. Mark it filed with evidence when complete.`]);
  }
  line('day.compliance.reminders', { reminded: r.rowCount });
  return { reminded: r.rowCount };
}

// ── 9. action-SLA escalation (OPP-OVR-3) ───────────────────────────────────────
// An open action past its deadline escalates one tier: notify the owner and record an append-only SLA event.
export async function runActionSlaEscalation() {
  const overdue = await pool.query(
    `SELECT id, tenant_id, code, title, owner_role, deadline FROM app.actions
      WHERE status='open' AND deadline IS NOT NULL AND deadline < now()
        AND NOT EXISTS (SELECT 1 FROM app.action_sla_events s WHERE s.action_id=app.actions.id
                        AND s.created_at >= now() - interval '20 hours')`);
  for (const a of overdue.rows) {
    const hours = Math.max(0, Math.round((Date.now() - new Date(a.deadline).getTime()) / 3600000));
    await pool.query(
      `INSERT INTO app.action_sla_events (tenant_id, action_id, escalated_to_role, hours_overdue, note)
       VALUES ($1,$2,'owner',$3,$4)`, [a.tenant_id, a.id, hours, `action ${a.code} past deadline`]);
    await pool.query(
      `INSERT INTO app.notifications (tenant_id, "group", title, body, ref)
       VALUES ($1,'needs-you',$2,$3,$4)`,
      [a.tenant_id, `Overdue decision: ${a.title}`, `The ${a.owner_role ?? 'owning'} desk has not decided this within its deadline (${hours}h overdue). Escalated to the owner.`, a.code]);
  }
  line('day.action.sla', { escalated: overdue.rowCount });
  return { escalated: overdue.rowCount };
}

// ── 10. owner security digest (OPP-SEC-6 / DEL-3) ──────────────────────────────
// The owner sees what happened on the privileged plane in the last day — role changes, API keys,
// plugin disables, DSR activity, exports, high-risk acts — plus the audit-chain verdict. Owner-only.
export async function runOwnerSecurityDigest() {
  const tenants = await pool.query(`SELECT id FROM app.tenants`);
  let written = 0;
  for (const { id: t } of tenants.rows) {
    const c = (await pool.query(
      `SELECT
         count(*) FILTER (WHERE action ILIKE '%role%')::int role_changes,
         count(*) FILTER (WHERE action ILIKE '%API key%')::int api_keys,
         count(*) FILTER (WHERE action ILIKE '%plugin%' AND action ILIKE '%disable%')::int plugin_disables,
         count(*) FILTER (WHERE action ILIKE '%erasure%' OR action ILIKE '%SAR%')::int dsr,
         count(*) FILTER (WHERE action ILIKE '%export%')::int exports,
         count(*) FILTER (WHERE risk='high')::int high_risk,
         count(*)::int total
       FROM app.audit_log WHERE tenant_id=$1 AND created_at >= now() - interval '1 day'`, [t])).rows[0];
    let chain = 'unavailable';
    try {
      const breaks = (await pool.query(`SELECT * FROM app.audit_verify($1, 10000)`, [t])).rows;
      chain = breaks.length === 0 ? 'verified' : `FAILED (${breaks.length} break(s))`;
    } catch { chain = 'unavailable'; }
    const summary = `${c.total} privileged action(s) in 24h — ${c.role_changes} role · ${c.api_keys} API key · ${c.plugin_disables} plugin disable · ${c.dsr} DSR · ${c.exports} export · ${c.high_risk} high-risk. Audit chain ${chain}.`;
    const owners = (await pool.query(`SELECT id FROM app.users WHERE tenant_id=$1 AND role='owner' AND active`, [t])).rows;
    for (const o of owners) {
      await pool.query(
        `INSERT INTO app.notifications (tenant_id, user_id, "group", title, body, ref)
         SELECT $1,$2,'needs-you','Your daily security digest',$3,'/audit'
          WHERE NOT EXISTS (SELECT 1 FROM app.notifications n
                             WHERE n.tenant_id=$1 AND n.user_id=$2 AND n.title='Your daily security digest'
                               AND n.created_at >= now() - interval '20 hours')`,
        [t, o.id, summary]);
      written++;
    }
  }
  line('day.owner.security', { tenants: tenants.rows.length, written });
  return { tenants: tenants.rows.length, written };
}

// CLI guard: `node scripts/day-worker.js` runs the whole day; imports get functions.
// OPP-DEL-7: named steps may be requested (`node scripts/day-worker.js principal-brief`) so the
// 07:00 IST brief cron can run the brief alone, rather than only as a side-effect of the 03:05 day.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const all = [
    ['preventive', runPreventiveStub],
    ['tally', runTallySummary],
    ['retention', runRetention],
    ['dunning', runDunningHook],
    ['library', runLibraryReminders],
    ['library-expiry', runLibraryReservationExpiry],
    ['principal-brief', runPrincipalBrief],
    ['compliance', runComplianceReminders],
    ['action-sla', runActionSlaEscalation],
    ['owner-security', runOwnerSecurityDigest],
  ];
  const requested = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const unknown = requested.filter((n) => !all.some(([name]) => name === n));
  if (unknown.length) { console.error(`day-worker: unknown step(s): ${unknown.join(', ')}`); process.exit(2); }
  const steps = requested.length ? all.filter(([name]) => requested.includes(name)) : all;
  let failed = 0;
  for (const [name, fn] of steps) {
    try { await fn(); } catch (e) { failed++; console.error(`day-worker step ${name} failed:`, e.message); }
  }
  await pool.end().catch(() => {});
  process.exit(failed ? 1 : 0);
}
