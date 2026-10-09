// admissions.funnel — follow-up SLA sweep, ONE definition shared by the HTTP door
// (POST /plugins/admissions.funnel/sla/run) and the day-worker step, so the two
// can never diverge (A5). Read-only on leads; writes notifications + events only.
// `emit(topic, payload)` is injected: the door passes kernel emitEvent, the worker
// passes an outbox insert with the identical topic/payload shape.
import { CLOSED_STAGES } from '../_shared/admissions-access.js';

export async function runFollowupSla(query, tenantId, { actor = 'day-worker', limit = 200, emit = null } = {}) {
  const stuck = (await query(
    `SELECT id, student_name, class_applied, stage, updated_at
       FROM plugin_admissions.lead
      WHERE tenant_id=$1 AND stage <> ALL($2::text[]) AND updated_at < now() - interval '7 days'
      ORDER BY updated_at ASC LIMIT $3`, [tenantId, CLOSED_STAGES, limit])).rows;
  let raised = 0; let skipped = 0;
  for (const l of stuck) {
    const already = (await query(
      `SELECT 1 FROM app.notifications WHERE tenant_id=$1 AND ref=$2 AND created_at::date = current_date LIMIT 1`,
      [tenantId, l.id])).rows[0];
    if (already) { skipped++; continue; }
    await query(
      `INSERT INTO app.notifications (tenant_id, "group", title, body, ref)
       VALUES ($1,'needs-you',$2,$3,$4)`,
      [tenantId, `Follow up: ${l.student_name} (${l.class_applied}) at ${l.stage}`,
        'No touchpoint for more than 7 days. Open the admissions funnel to follow up.', l.id]);
    if (emit) await emit('admission.followup.overdue', { leadId: l.id, stage: l.stage }, l);
    raised++;
  }
  // A13: interviews/visits scheduled in the next 48h get one reminder each
  // (deduped per activity per day). Same sweep, same cron — no new scheduler.
  const upcoming = (await query(
    `SELECT a.id, a.kind, a.scheduled_at, l.student_name, l.class_applied, l.guardian_phone
       FROM plugin_admissions.lead_activity a JOIN plugin_admissions.lead l ON l.id = a.lead_id
      WHERE a.tenant_id=$1 AND a.kind IN ('visit','interview') AND a.completed_at IS NULL
        AND a.scheduled_at IS NOT NULL AND a.scheduled_at > now()
        AND a.scheduled_at <= now() + interval '48 hours'
      ORDER BY a.scheduled_at ASC LIMIT 200`, [tenantId])).rows;
  let reminded = 0;
  for (const u of upcoming) {
    const done = (await query(
      `SELECT 1 FROM app.notifications WHERE tenant_id=$1 AND ref=$2 AND created_at::date = current_date LIMIT 1`,
      [tenantId, `activity:${u.id}`])).rows[0];
    if (done) continue;
    await query(
      `INSERT INTO app.notifications (tenant_id, "group", title, body, ref)
       VALUES ($1,'needs-you',$2,$3,$4)`,
      [tenantId, `Upcoming ${u.kind}: ${u.student_name} (${u.class_applied})`,
        `Scheduled ${new Date(u.scheduled_at).toISOString().slice(0, 16).replace('T', ' ')} UTC. Open the funnel to prepare.`, `activity:${u.id}`]);
    if (emit) await emit('admission.interview.upcoming',
      { leadId: null, activityId: u.id, kind: u.kind, scheduledAt: u.scheduled_at }, u);
    reminded++;
  }
  return { scanned: stuck.length, raised, skipped, reminded,
    leads: stuck.map((l) => ({ id: l.id, stage: l.stage })) };
}
