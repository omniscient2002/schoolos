// Dunning worker stub (Wave 3 · L1-3.2): cron-able overdue-fee reminder sweep
// across ALL tenants on the owner path. Same rules as POST /fees/dunning/run:
// open/partial + past due + unpaid remainder, 7-day dedup per obligation
// (dedup_key = dunning:<obligationId>), guardians with a phone only, quiet
// hours from comms.whatsapp settings (IST, default 21:00–08:00) — during quiet
// hours the sweep writes nothing. Exits 1 when reminders were queued (so a cron
// wrapper can alert), 0 when clean or quiet.
//   node scripts/dunning-reminders.js
import pg from 'pg';

const DB = process.env.DATABASE_URL ?? 'postgres://schoolos:schoolos_dev_pw@127.0.0.1:5432/schoolos';
const q = async (text, params = []) => {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  try { return await c.query(text, params); } finally { await c.end(); }
};
const IST_NOW_MS = () => Date.now() + 5.5 * 3600 * 1000;
const IST_TODAY = () => new Date(IST_NOW_MS()).toISOString().slice(0, 10);
const IST_MINUTE = () => { const d = new Date(IST_NOW_MS()); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const parseHm = (s) => { const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(s ?? '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const inQuiet = (q0, q1, m) => q0 === null || q1 === null ? false : (q0 <= q1 ? (m >= q0 && m < q1) : (m >= q0 || m < q1));

const report = { date: IST_TODAY(), tenants: [], queuedTotal: 0, quietHoursSkipped: [] };

const tenants = (await q(`SELECT id, slug FROM app.tenants ORDER BY slug`)).rows;
for (const t of tenants) {
  const s = (await q(`SELECT settings FROM app.plugins WHERE tenant_id=$1 AND plugin_id='comms.whatsapp'`, [t.id])).rows[0]?.settings ?? {};
  const quiet = s.quiet_hours ?? { start: '21:00', end: '08:00' };
  const q0 = parseHm(quiet.start), q1 = parseHm(quiet.end);
  if (inQuiet(q0, q1, IST_MINUTE())) {
    report.quietHoursSkipped.push({ slug: t.slug, quietHours: quiet });
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
    await q(
      `INSERT INTO app.communications (tenant_id, audience_kind, audience_json, channel, template, body, status, policy_ref, dedup_key)
       VALUES ($1,'guardian',$2::jsonb,'whatsapp','FEE_REMINDER',$3,'queued','Fees §4.2',$4)`,
      [t.id, JSON.stringify([o.guardian_phone]),
       `Fee reminder: ${o.student_name} — ${o.label}, ₹${Number(due) / 100} was due on ${o.due_on}. Please pay via the parent portal or at the school office. If you have already paid, please share the receipt with the office — no action otherwise.`,
       `dunning:${o.id}`]);
    queued += 1;
  }
  report.tenants.push({ slug: t.slug, queued, skippedNoContact });
  report.queuedTotal += queued;
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.queuedTotal > 0 ? 1 : 0);
