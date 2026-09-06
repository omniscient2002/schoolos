// admissions.funnel — runtime module (wave-2 #1, migration 018)
// Class C plugin: applicant/guardian PII confined to plugin_admissions; the funnel
// NEVER writes core students (enrollment into core is a staff/office workflow after
// the offer stage); no money surfaces. All preHandlers async (Fastify 5 law).
// Stage lattice is enforced server-side; terminal stages are immutable.
import { makeLifecycleGate } from '../_shared/lifecycle-gate.js';

const ID = 'admissions.funnel';

// forward lattice (transitively closed) + terminal exits
const NEXT = {
  inquiry: ['applied', 'rejected', 'withdrawn'],
  applied: ['interview', 'rejected', 'withdrawn'],
  interview: ['offer', 'rejected', 'withdrawn'],
  offer: ['enrolled', 'rejected', 'withdrawn'],
};
const TERMINAL = new Set(['enrolled', 'rejected', 'withdrawn']);
const STAGES = [...Object.keys(NEXT), ...TERMINAL];

// PII mask for non-privileged surfaces: teacher/coordinator see shape, not content
const maskPhone = (p) => (p ? `${String(p).slice(0, 2)}xxxx${String(p).slice(-2)}` : null);

export function register(app, kernel) {
  const { withUser, requestAudit, emitEvent, require, q } = kernel;

  const PRINCIPAL = ['owner', 'principal', 'itadmin'];
  const FULL_PII = ['owner', 'principal', 'itadmin', 'coordinator']; // admissions office sees guardian contacts
  const ADMIN = ['owner', 'principal', 'itadmin', 'finance', 'coordinator'];
  const can = (role, list) => list.includes(role);

  const lifecycleGate = makeLifecycleGate(kernel.q, ID);

  // ── create lead (admin roles) ────────────────────────────────────────────────
  app.post(`/plugins/${ID}/leads`, { preHandler: [require(...ADMIN), lifecycleGate] }, async (req, reply) => {
    const { studentName, guardianName, guardianPhone, classApplied, source } = req.body ?? {};
    if (!studentName || !guardianPhone || !classApplied) {
      return reply.code(400).send({ error: 'studentName, guardianPhone, classApplied are required' });
    }
    if (!/^[\d+\-\s()]{6,15}$/.test(String(guardianPhone))) return reply.code(400).send({ error: 'guardianPhone looks invalid' });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `INSERT INTO plugin_admissions.lead (tenant_id, student_name, guardian_name, guardian_phone, class_applied, source, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [req.user.tenant_id, String(studentName).slice(0, 120), guardianName ? String(guardianName).slice(0, 120) : null,
          String(guardianPhone), String(classApplied).slice(0, 40), String(source ?? 'walk-in').slice(0, 40), req.user.id]);
      const leadId = r.rows[0].id;
      await c.query(`INSERT INTO plugin_admissions.stage_history (tenant_id, lead_id, from_stage, to_stage, actor)
        VALUES ($1,$2,NULL,'inquiry',$3)`, [req.user.tenant_id, leadId, req.user.email]);
      await emitEvent(c, req.user.tenant_id,
        { type: 'admissions', label: `admission lead captured (${String(studentName).slice(0, 60)})`, ref: leadId },
        'admission.lead.captured', { leadId, classApplied, source: source ?? 'walk-in' });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: 'admission lead captured', recordType: 'AdmissionLead', recordRef: leadId,
        reason: 'lead capture', policyRef: 'DPDP consent obligations (guardian contact)', risk: 'low',
        outcome: `lead created at stage inquiry (source ${source ?? 'walk-in'})` });
      return { ok: true, leadId, stage: 'inquiry' };
    });
  });

  // ── list leads (masking depends on role) ─────────────────────────────────────
  app.get(`/plugins/${ID}/leads`, { preHandler: [require(...ADMIN, 'teacher'), lifecycleGate] }, async (req, reply) => {
    const masked = !can(req.user.role, FULL_PII);
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const stage = req.query.stage && STAGES.includes(req.query.stage) ? req.query.stage : null;
      const rows = (await c.query(
        `SELECT id, student_name, guardian_name, guardian_phone, class_applied, source, stage, created_at, updated_at
         FROM plugin_admissions.lead WHERE tenant_id=$1 AND ($2::text IS NULL OR stage=$2)
         ORDER BY created_at DESC LIMIT 200`, [req.user.tenant_id, stage])).rows;
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: masked ? 'admission leads listed (masked)' : 'admission leads listed (full PII)', recordType: 'AdmissionLead', recordRef: 'list',
        reason: 'funnel view', policyRef: 'DPDP consent obligations (guardian contact)', risk: masked ? 'low' : 'medium',
        outcome: masked ? `${rows.length} leads, PII masked` : `${rows.length} leads, full PII` });
      return {
        masked,
        leads: rows.map((r) => ({
          id: r.id, studentName: r.student_name, classApplied: r.class_applied, source: r.source,
          stage: r.stage, createdAt: r.created_at, updatedAt: r.updated_at,
          guardianName: masked ? null : r.guardian_name,
          guardianPhone: masked ? maskPhone(r.guardian_phone) : r.guardian_phone,
        })),
      };
    });
  });

  // ── stage transition (admin roles; lattice enforced server-side) ─────────────
  app.post(`/plugins/${ID}/leads/:id/stage`, { preHandler: [require(...ADMIN), lifecycleGate] }, async (req, reply) => {
    const to = String(req.body?.to ?? '');
    if (!STAGES.includes(to)) return reply.code(400).send({ error: `unknown stage (valid: ${STAGES.join(', ')})` });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const cur = (await c.query(`SELECT stage FROM plugin_admissions.lead WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!cur) return reply.code(404).send({ error: 'lead not found' });
      if (TERMINAL.has(cur.stage)) return reply.code(409).send({ error: `stage '${cur.stage}' is terminal — immutable` });
      if (!(NEXT[cur.stage] ?? []).includes(to)) {
        return reply.code(409).send({ error: `illegal transition ${cur.stage} → ${to} (allowed: ${(NEXT[cur.stage] ?? []).join(', ')})` });
      }
      if (to === 'enrolled') {
        // the funnel NEVER writes core students: enrollment is raised as a staff
        // workflow note; the office performs the actual core enrollment.
        await c.query(`UPDATE plugin_admissions.lead SET notes = notes || jsonb_build_object('enrollment_note', 'raised for office enrollment; funnel does not write core students', 'enrollment_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) WHERE id=$1`,
          [req.params.id]);
      }
      const u = await c.query(`UPDATE plugin_admissions.lead SET stage=$1, updated_at=now() WHERE id=$2 AND tenant_id=$3 RETURNING stage`,
        [to, req.params.id, req.user.tenant_id]);
      await c.query(`INSERT INTO plugin_admissions.stage_history (tenant_id, lead_id, from_stage, to_stage, actor)
        VALUES ($1,$2,$3,$4,$5)`, [req.user.tenant_id, req.params.id, cur.stage, to, req.user.email]);
      await emitEvent(c, req.user.tenant_id,
        { type: 'admissions', label: `admission stage changed: ${cur.stage} → ${to}`, ref: req.params.id },
        'admission.stage.changed', { leadId: req.params.id, from: cur.stage, to });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: 'admission stage changed', recordType: 'AdmissionLead', recordRef: req.params.id,
        reason: 'funnel progression', policyRef: 'Platform §3 (plugin governance)', risk: to === 'enrolled' ? 'medium' : 'low',
        outcome: `${cur.stage} → ${to}${to === 'enrolled' ? ' (enrollment raised for office — no core-student write)' : ''}` });
      return { ok: true, from: cur.stage, to: u.rows[0].stage };
    });
  });

  // ── stage history (admin roles) ──────────────────────────────────────────────
  app.get(`/plugins/${ID}/leads/:id/history`, { preHandler: [require(...ADMIN), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const rows = (await c.query(
        `SELECT from_stage, to_stage, actor, at FROM plugin_admissions.stage_history
         WHERE lead_id=$1 AND tenant_id=$2 ORDER BY at ASC`, [req.params.id, req.user.tenant_id])).rows;
      if (!rows.length) return reply.code(404).send({ error: 'lead not found' });
      return { history: rows };
    });
  });

  // ── funnel summary (admin roles) ─────────────────────────────────────────────
  app.get(`/plugins/${ID}/summary`, { preHandler: [require(...ADMIN), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const rows = (await c.query(
        `SELECT stage, count(*)::int n FROM plugin_admissions.lead WHERE tenant_id=$1 GROUP BY stage`,
        [req.user.tenant_id])).rows;
      const byStage = Object.fromEntries(STAGES.map((s) => [s, 0]));
      for (const r of rows) byStage[r.stage] = r.n;
      return { byStage, total: rows.reduce((a, r) => a + r.n, 0) };
    });
  });
}
