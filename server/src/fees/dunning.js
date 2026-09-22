/* Fee-dunning selection — ONE definition shared by the kernel HTTP door
 * (`POST /fees/dunning/run`) and the day-worker/dunning-reminders script, so the two
 * can never diverge (FEE-DEL-4). The caller supplies the query function and the tenant;
 * the SQL, the candidate classes and the dedup keys live here only.
 *
 * Classes:
 *   overdue     — due_on < today, still outstanding, not reminded in the last 7 days.
 *   before_due  — due_on within one of the configured offsets, still outstanding, not yet
 *                 reminded for that offset (opt-in: the offsets list defaults to empty).
 *   escalation  — overdue beyond a configured age, still outstanding, not yet escalated.
 */

export const OVERDUE_SQL = `
  SELECT o.id, o.student_id, o.label, o.due_on, o.amount_cents, o.paid_cents,
         o.net_amount_cents, s.name AS student_name, s.guardian_phone
  FROM app.fee_obligations o JOIN app.students s ON s.id = o.student_id
  WHERE o.tenant_id = $1 AND o.status IN ('open','partial')
    AND o.due_on < $2::date AND o.net_amount_cents > o.paid_cents
    AND NOT EXISTS (SELECT 1 FROM app.communications cm
                     WHERE cm.dedup_key = 'dunning:' || o.id::text AND cm.created_at > now() - interval '7 days')
  ORDER BY o.due_on LIMIT 200`;

export const BEFORE_DUE_SQL = `
  SELECT o.id, o.student_id, o.label, o.due_on, o.amount_cents, o.paid_cents,
         o.net_amount_cents, s.name AS student_name, s.guardian_phone
  FROM app.fee_obligations o JOIN app.students s ON s.id = o.student_id
  WHERE o.tenant_id = $1 AND o.status IN ('open','partial')
    AND o.due_on >= $2::date AND o.due_on <= ($2::date + ($3::int || ' days')::interval)
    AND o.net_amount_cents > o.paid_cents
    AND NOT EXISTS (SELECT 1 FROM app.fee_dunning_log dl
                     WHERE dl.dedup_key = 'due:' || o.id::text || ':' || $3::int)
  ORDER BY o.due_on LIMIT 200`;

export const ESCALATION_SQL = `
  SELECT o.id, o.student_id, o.label, o.due_on, o.amount_cents, o.paid_cents,
         o.net_amount_cents, s.name AS student_name, s.guardian_phone
  FROM app.fee_obligations o JOIN app.students s ON s.id = o.student_id
  WHERE o.tenant_id = $1 AND o.status IN ('open','partial')
    AND o.due_on <= ($2::date - ($3::int || ' days')::interval)
    AND o.net_amount_cents > o.paid_cents
    AND NOT EXISTS (SELECT 1 FROM app.fee_dunning_log dl
                     WHERE dl.dedup_key = 'escalation:' || o.id::text || ':' || $3::int)
  ORDER BY o.due_on LIMIT 200`;

export const outstanding = (o) => BigInt(o.net_amount_cents ?? o.amount_cents) - BigInt(o.paid_cents);

export const overdueBody = (o) => {
  const due = outstanding(o);
  return `Fee reminder: ${o.student_name} — ${o.label}, ₹${Number(due) / 100} was due on ${o.due_on}. Please pay via the parent portal or at the school office. If you have already paid, please share the receipt with the office — no action otherwise.`;
};

export const beforeDueBody = (o) => {
  const due = outstanding(o);
  return `Fee reminder: ${o.student_name} — ${o.label}, ₹${Number(due) / 100} is due on ${o.due_on}. Please pay via the parent portal or at the school office. If you have already paid, please share the receipt with the office — no action otherwise.`;
};

export const escalationBody = (o) => {
  const due = outstanding(o);
  return `Fee escalation: ${o.student_name} — ${o.label}, ₹${Number(due) / 100} remains unpaid since ${o.due_on}. Please contact the school office to settle this fee.`;
};

export const overdueDedup = (id) => `dunning:${id}`;
export const beforeDueDedup = (id, offset) => `due:${id}:${offset}`;
export const escalationDedup = (id, days) => `escalation:${id}:${days}`;

export async function selectOverdue(ownerQuery, tenantId, today) {
  return (await ownerQuery(OVERDUE_SQL, [tenantId, today])).rows;
}
export async function selectBeforeDue(ownerQuery, tenantId, today, offset) {
  return (await ownerQuery(BEFORE_DUE_SQL, [tenantId, today, offset])).rows;
}
export async function selectEscalation(ownerQuery, tenantId, today, days) {
  return (await ownerQuery(ESCALATION_SQL, [tenantId, today, days])).rows;
}
