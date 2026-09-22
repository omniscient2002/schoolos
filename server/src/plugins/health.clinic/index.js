import { makeLifecycleGate } from '../_shared/lifecycle-gate.js';
import { uuidParams } from '../_shared/uuid-param.js';
// health.clinic — infirmary log, sick passes, guardian health notices (wave 3).
// Visits are append-first: corrections append a new row, the log is never rewritten.
// sent_home / hospital_referral outcomes raise a per-instance kernel approval action
// (clinic.notify.<visitId> — UNIQUE(tenant_id, code) satisfied from birth, cycle-5
// P1-1 pattern) with payload.kind='message', executed by the kernel decide handler
// onto the comms rail (transport gps_delay precedent). Guardian notice is an APPROVED
// communication, never a plugin-direct send (Comms §1.2).
// PII tiering: health history is nurse-lane — no teacher/finance/parent read.
const ID = 'health.clinic';
export { default as manifest } from './manifest.js';

const IST_NOW = () => new Date(Date.now() + 5.5 * 3600 * 1000); // Asia/Kolkata clock

export function register(app, kernel) {
  const { withUser, requestAudit, emitEvent, require } = kernel;
  const lifecycleGate = makeLifecycleGate(kernel.sysq, ID);
  const NURSE = ['owner', 'principal', 'itadmin', 'coordinator']; // clinic authority (nurse-lane)
  const ACTIONS = ['rest', 'first_aid', 'sent_home', 'hospital_referral'];

  // log a visit (append-first)
  app.post(`/plugins/${ID}/visits`, { preHandler: [require(...NURSE), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.studentId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(b.studentId)))
      return bad(reply, 'Please pick a student');
    if (!b.complaint) return bad(reply, 'Please describe the complaint');
    if (b.action && !ACTIONS.includes(b.action)) return bad(reply, 'Choose a valid outcome: rest, first aid, sent home or hospital referral');
    if (b.temperatureC != null && (typeof b.temperatureC !== 'number' || b.temperatureC < 30 || b.temperatureC > 45))
      return bad(reply, 'Please enter a realistic temperature between 30 and 45°C');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const student = (await c.query(`SELECT id, name, guardian_phone FROM app.students WHERE id=$1 AND tenant_id=$2`,
        [b.studentId, req.user.tenant_id])).rows[0];
      if (!student) return bad(reply, 'We couldn\'t find that student', 404);
      const action = b.action ?? 'first_aid';
      const v = (await c.query(
        `INSERT INTO plugin_clinic.visit (tenant_id, student_id, complaint, temperature_c, action, notes, logged_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, visited_at, action`,
        [req.user.tenant_id, student.id, String(b.complaint).slice(0, 500), b.temperatureC ?? null, action,
         b.notes ? String(b.notes).slice(0, 1000) : null, req.user.id])).rows[0];
      await emitEvent(c, req.user.tenant_id,
        { type: 'clinic', label: `Clinic visit logged: ${student.name} (${action})`, ref: v.id },
        'clinic.visit.logged.v1',
        { visitId: v.id, studentId: student.id, action, visitedAt: v.visited_at });
      // guardian notice: APPROVED communication via per-instance kernel action (Comms §1.2)
      const noticeActionId = await raiseGuardianNotice(c, req.user.tenant_id, v.id, student, action, String(b.complaint), { id: req.user.id, role: req.user.role });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: `Clinic visit logged (${action})`, recordType: 'ClinicVisit', recordRef: v.id,
        reason: 'infirmary log', policyRef: 'Health · DPDP Act 2023 (health PII)', risk: isSensitive(action) ? 'high' : 'medium',
        outcome: noticeActionId ? `visit logged; guardian-notice action ${noticeActionId} raised (kernel approval required)` : 'visit logged' });
      return { ok: true, visitId: v.id, action: v.action, visitedAt: v.visited_at, noticeActionId };
    });
  });

  // append a correction — the original row is never rewritten (append-first)
  app.post(`/plugins/${ID}/visits/:id/correct`, { preHandler: [require(...NURSE), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.correction) return bad(reply, 'Please describe the correction');
    if (b.action && !ACTIONS.includes(b.action)) return bad(reply, 'Choose a valid outcome: rest, first aid, sent home or hospital referral');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const orig = (await c.query(
        `SELECT id, student_id, complaint, action FROM plugin_clinic.visit WHERE id=$1 AND tenant_id=$2`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!orig) return bad(reply, 'We couldn\'t find that clinic visit', 404);
      const action = b.action ?? orig.action;
      const corr = (await c.query(
        `INSERT INTO plugin_clinic.visit (tenant_id, student_id, complaint, temperature_c, action, notes, logged_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [req.user.tenant_id, orig.student_id, orig.complaint, null, action,
         `CORRECTION of ${req.params.id}: ${String(b.correction).slice(0, 900)}`, req.user.id])).rows[0];
      await emitEvent(c, req.user.tenant_id,
        { type: 'clinic', label: 'Clinic visit corrected (appended)', ref: corr.id },
        'clinic.visit.logged.v1',
        { visitId: corr.id, correctsVisitId: orig.id, studentId: orig.student_id, action });
      // P3-3 (cycle 6): a correction that ESCALATES the action class re-fires the
      // guardian notice (duty of care) — per-instance code on the correction row id
      const SEVERE = ['sent_home', 'hospital_referral'];
      let noticeActionId = null;
      if (action !== orig.action && SEVERE.includes(action)) {
        noticeActionId = await raiseGuardianNotice(c, req.user.tenant_id, corr.id, { name: (await c.query(`SELECT name FROM app.students WHERE id=$1`, [orig.student_id])).rows[0]?.name ?? 'student' }, action, orig.complaint, { id: req.user.id, role: req.user.role });
      }
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Clinic visit correction appended', recordType: 'ClinicVisit', recordRef: corr.id,
        reason: 'log integrity: append, never rewrite', policyRef: 'Health · audit trail', risk: 'medium',
        outcome: `correction of ${orig.id} appended as ${corr.id}` });
      return { ok: true, correctionId: corr.id, correctsVisitId: orig.id, noticeActionId };
    });
  });

  // sick pass — class-release authorization tied to a visit
  app.post(`/plugins/${ID}/visits/:id/sick-pass`, { preHandler: [require(...NURSE), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const v = (await c.query(
        `SELECT id, student_id FROM plugin_clinic.visit WHERE id=$1 AND tenant_id=$2`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!v) return bad(reply, 'We couldn\'t find that clinic visit', 404);
      const open = (await c.query(
        `SELECT id FROM plugin_clinic.sick_pass WHERE tenant_id=$1 AND visit_id=$2 AND status='active'`,
        [req.user.tenant_id, v.id])).rows[0];
      if (open) return reply.code(409).send({ error: 'This visit already has an active sick pass', passId: open.id });
      const ttl = await sickPassTtlHours(c, req.user.tenant_id);
      const validUntil = new Date(Date.now() + ttl * 3600 * 1000); // S0 fix H8: instant stays real-epoch (IST math is for date strings only)
      const p = (await c.query(
        `INSERT INTO plugin_clinic.sick_pass (tenant_id, visit_id, student_id, valid_until, issued_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, valid_until`,
        [req.user.tenant_id, v.id, v.student_id, validUntil, req.user.id])).rows[0];
      await emitEvent(c, req.user.tenant_id,
        { type: 'clinic', label: `Sick pass issued (valid ${ttl}h)`, ref: p.id },
        'clinic.sick_pass.issued.v1',
        { passId: p.id, visitId: v.id, studentId: v.student_id, validUntil: p.valid_until });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Sick pass issued', recordType: 'SickPass', recordRef: p.id,
        reason: 'class-release authorization', policyRef: 'Health · duty of care', risk: 'low',
        outcome: `pass ${p.id} valid until ${p.valid_until.toISOString()} (IST clock)` });
      return { ok: true, passId: p.id, visitId: v.id, validUntil: p.valid_until, status: 'active' };
    });
  });

  // infirmary log read — nurse-lane PII (no teacher/finance/parent)
  app.get(`/plugins/${ID}/visits`, { preHandler: [require(...NURSE), lifecycleGate] }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const rows = (await c.query(
        `SELECT v.id, v.student_id, v.visited_at, v.complaint, v.temperature_c, v.action, v.notes,
                s.name AS student_name
         FROM plugin_clinic.visit v JOIN app.students s ON s.id = v.student_id
         WHERE v.tenant_id=$1 ORDER BY v.visited_at DESC LIMIT 200`, [req.user.tenant_id])).rows;
      return { visits: rows.map((r) => ({
        visitId: r.id, studentId: r.student_id, studentName: r.student_name, visitedAt: r.visited_at,
        complaint: r.complaint, temperatureC: r.temperature_c, action: r.action, notes: r.notes })) };
    });
  });

  // revoke a pass — office lane (returned unexpectedly, wrong student, etc.)
  app.post(`/plugins/${ID}/sick-passes/:id/revoke`, { preHandler: [require('owner', 'principal', 'itadmin'), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const p = (await c.query(
        `SELECT id, status FROM plugin_clinic.sick_pass WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!p) return bad(reply, 'We couldn\'t find that sick pass', 404);
      if (p.status !== 'active') return bad(reply, `Only an active pass can be revoked (this one is ${p.status})`, 409);
      await c.query(`UPDATE plugin_clinic.sick_pass SET status='revoked', updated_at=now() WHERE id=$1`, [p.id]);
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Sick pass revoked', recordType: 'SickPass', recordRef: p.id,
        reason: 'office correction', policyRef: 'Health · duty of care', risk: 'low', outcome: 'pass no longer valid' });
      return { ok: true, status: 'revoked' };
    });
  });

  // APPROVED communication via per-instance kernel action — shared by the visit log
  // door and the correction-escalation path (Comms §1.2; never a plugin-direct send)
  async function raiseGuardianNotice(c, tenantId, visitRef, student, action, complaint, actor = {}) {
    const s = (await c.query(
      `SELECT settings FROM app.plugins WHERE tenant_id=$1 AND plugin_id='${ID}'`,
      [tenantId])).rows[0]?.settings ?? {};
    const SEVERE = ['sent_home', 'hospital_referral']; // notices are for these ONLY (P3-3 refactor guard)
    if (!SEVERE.includes(action)) return null;
    const flag = action === 'sent_home' ? 'notify_on_sent_home' : 'notify_on_referral';
    if (s[flag] === false) return null; // disabled by settings
    const isReferral = action === 'hospital_referral';
    const name = student?.name ?? 'the student';
    return (await c.query(
      `INSERT INTO app.actions (tenant_id, code, kind, title, detail, why, priority, status, owner, owner_role, policy_ref, ai_involved, source_event, payload, source_plugin)
       VALUES ($1, $2, 'approval', $3, $4, $5, $6, 'open', NULL, 'principal', 'Comms §1.2 · DPDP Act 2023 (health PII)', false, $7, $8, 'health.clinic')
       RETURNING id`,
      [tenantId, `clinic.notify.${visitRef}`,
       isReferral ? `Guardian notice: hospital referral — ${name}` : `Guardian notice: sent home — ${name}`,
       isReferral ? `${name} was referred to a hospital from the infirmary today (complaint: ${String(complaint).slice(0, 120)}). Please arrange pickup.` :
         `${name} was sent home from the infirmary today (complaint: ${String(complaint).slice(0, 120)}). Rest advised.`,
       'guardian must be informed of health events (school duty of care)', isReferral ? 'high' : 'normal',
       visitRef,
       JSON.stringify({ kind: 'message', visitId: visitRef, studentId: student?.id ?? null, action, audience: 'guardians', channel: 'WhatsApp',
         template: isReferral ? 'CLINIC_REFERRAL' : 'CLINIC_SENT_HOME',
         draft: isReferral ? `${name} was referred to a hospital from the infirmary today. Please arrange pickup at the earliest.` :
           `${name} was sent home from the infirmary today. Rest advised; keep the child home for the day.`,
         proposed_by: actor.id ?? null, proposed_by_role: actor.role ?? null })])).rows[0].id;
  }
  function bad(reply, error, code = 400) { return reply.code(code).send({ error }); }
  function isSensitive(action) { return action === 'hospital_referral'; }
  async function sickPassTtlHours(c, tenantId) {
    const s = (await c.query(`SELECT settings FROM app.plugins WHERE tenant_id=$1 AND plugin_id='${ID}'`, [tenantId])).rows[0]?.settings ?? {};
    const h = Number(s.sick_pass_ttl_hours ?? 8);
    return Number.isFinite(h) && h > 0 && h <= 48 ? h : 8;
  }
}
