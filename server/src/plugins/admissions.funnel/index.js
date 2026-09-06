// admissions.funnel — runtime module (v1.1, migrations 018 + 021)
// India-admissions semantics: enquiry → form → interaction → offer lattice with
// rejected/withdrawn side exits; duplicate-enquiry guard; Feb–Jun session window
// via settings (admission_year, cycle_start/cycle_end); offer.accepted →
// students.create raised as a KERNEL APPROVAL-GATED action (app.actions) — offers
// create core student records, a core-domain write, so it rides kernel approval
// semantics and the plugin NEVER writes app.students directly. No money surfaces
// (fee collection is payments.upi's lane). All preHandlers async (Fastify 5 law).
import { makeLifecycleGate } from '../_shared/lifecycle-gate.js';

const ID = 'admissions.funnel';

// forward lattice + terminal exits (stage.transitioned events on every move)
const NEXT = {
  enquiry: ['form', 'rejected', 'withdrawn'],
  form: ['interaction', 'rejected', 'withdrawn'],
  interaction: ['offer', 'rejected', 'withdrawn'],
  offer: ['enrolled', 'rejected', 'withdrawn'], // offer → enrolled = offer.accepted
};
const TERMINAL = new Set(['enrolled', 'rejected', 'withdrawn']);
const STAGES = [...Object.keys(NEXT), ...TERMINAL];

// PII mask for non-privileged surfaces: teacher/finance see shape, not content
const maskPhone = (p) => (p ? `${String(p).slice(0, 2)}xxxx${String(p).slice(-2)}` : null);

// current Apr–Mar Indian academic cycle, e.g. '2026-27'
const currentSessionYear = () => {
  const n = new Date();
  const y = (n.getUTCMonth() + 1) >= 4 ? n.getUTCFullYear() : n.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
};
const mmdd = (d) => `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

export function register(app, kernel) {
  const { withUser, requestAudit, emitEvent, require, q } = kernel;

  const FULL_PII = ['owner', 'principal', 'itadmin', 'coordinator']; // admissions office sees guardian contacts
  const ADMIN = ['owner', 'principal', 'itadmin', 'finance', 'coordinator'];

  const lifecycleGate = makeLifecycleGate(kernel.q, ID);

  // ── capture enquiry (admin roles; session window + dedupe guard) ─────────────
  app.post(`/plugins/${ID}/leads`, { preHandler: [require(...ADMIN), lifecycleGate] }, async (req, reply) => {
    const { studentName, guardianName, guardianPhone, classApplied, source, admissionYear } = req.body ?? {};
    if (!studentName || !guardianPhone || !classApplied) {
      return reply.code(400).send({ error: 'studentName, guardianPhone, classApplied are required' });
    }
    if (!/^[\d+\-\s()]{6,15}$/.test(String(guardianPhone))) return reply.code(400).send({ error: 'guardianPhone looks invalid' });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // settings: admission_year + Feb–Jun session window (settings-driven, not hard-coded)
      const pl = (await c.query(`SELECT settings FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`,
        [req.user.tenant_id, ID])).rows[0];
      const s = pl?.settings ?? {};
      const ay = String(admissionYear ?? s.admission_year ?? currentSessionYear());
      if (s.cycle_start && s.cycle_end) {
        const today = mmdd(new Date());
        if (today < String(s.cycle_start) || today > String(s.cycle_end)) {
          return reply.code(409).send({ error: `outside the admission window (${s.cycle_start} → ${s.cycle_end} for ${ay})` });
        }
      }
      // duplicate-enquiry guard: one open enquiry per (guardian, class, session)
      const dup = (await c.query(
        `SELECT id FROM plugin_admissions.lead WHERE tenant_id=$1 AND guardian_phone=$2 AND class_applied=$3
          AND COALESCE(notes->>'admission_year','')=$4 AND stage IN ('enquiry','form','interaction','offer') LIMIT 1`,
        [req.user.tenant_id, String(guardianPhone), String(classApplied), ay])).rows[0];
      if (dup) return reply.code(409).send({ error: 'an open enquiry already exists for this guardian, class and session', leadId: dup.id });
      const r = await c.query(
        `INSERT INTO plugin_admissions.lead (tenant_id, student_name, guardian_name, guardian_phone, class_applied, source, created_by, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7, jsonb_build_object('admission_year',$8::text)) RETURNING id`,
        [req.user.tenant_id, String(studentName).slice(0, 120), guardianName ? String(guardianName).slice(0, 120) : null,
          String(guardianPhone), String(classApplied).slice(0, 40), String(source ?? 'walk-in').slice(0, 40), req.user.id, ay]);
      const leadId = r.rows[0].id;
      await c.query(`INSERT INTO plugin_admissions.stage_history (tenant_id, lead_id, from_stage, to_stage, actor)
        VALUES ($1,$2,NULL,'enquiry',$3)`, [req.user.tenant_id, leadId, req.user.email]);
      await emitEvent(c, req.user.tenant_id,
        { type: 'admissions', label: `admission enquiry captured (${String(studentName).slice(0, 60)})`, ref: leadId },
        'admission.enquiry.captured', { leadId, classApplied, source: source ?? 'walk-in', admissionYear: ay });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: 'admission enquiry captured', recordType: 'AdmissionLead', recordRef: leadId,
        reason: 'lead capture', policyRef: 'DPDP consent obligations (guardian contact)', risk: 'low',
        outcome: `enquiry created at stage enquiry (source ${source ?? 'walk-in'}, session ${ay})` });
      return { ok: true, leadId, stage: 'enquiry', admissionYear: ay };
    });
  });

  // ── list leads (masking depends on role) ─────────────────────────────────────
  app.get(`/plugins/${ID}/leads`, { preHandler: [require(...ADMIN, 'teacher'), lifecycleGate] }, async (req, reply) => {
    const masked = !FULL_PII.includes(req.user.role);
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const stage = req.query.stage && STAGES.includes(req.query.stage) ? req.query.stage : null;
      const rows = (await c.query(
        `SELECT id, student_name, guardian_name, guardian_phone, class_applied, source, stage, notes, created_at, updated_at
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
          stage: r.stage, admissionYear: r.notes?.admission_year ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
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
      const cur = (await c.query(`SELECT stage, student_name, class_applied, guardian_name, guardian_phone, notes FROM plugin_admissions.lead WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!cur) return reply.code(404).send({ error: 'lead not found' });
      if (TERMINAL.has(cur.stage)) return reply.code(409).send({ error: `stage '${cur.stage}' is terminal — immutable` });
      if (!(NEXT[cur.stage] ?? []).includes(to)) {
        return reply.code(409).send({ error: `illegal transition ${cur.stage} → ${to} (allowed: ${(NEXT[cur.stage] ?? []).join(', ')})` });
      }
      // offer.accepted → students.create: raised as a KERNEL APPROVAL-GATED action
      // (app.actions). Admissions offers create core student records — a core-domain
      // write — so it rides kernel approval semantics; the plugin never writes
      // app.students directly (invariant: no_core_students_writes).
      let actionId = null;
      if (cur.stage === 'offer' && to === 'enrolled') {
        const a = await c.query(
          `INSERT INTO app.actions (tenant_id, code, kind, title, detail, why, priority, status, owner, owner_role, policy_ref, ai_involved, source_event, payload)
           VALUES ($1,'students.create','approval',$2,$3,$4,'high','open','Principal','principal','Admissions §2',false,'admission.offer.accepted',$5::jsonb) RETURNING id`,
          [req.user.tenant_id,
            'Admission offer accepted — create student record',
            `Lead ${cur.student_name} (class ${cur.class_applied}) accepted the offer. Approve to create the core student record.`,
            'Admissions offers create core students — core-domain write routed through kernel approval; the funnel never writes app.students directly.',
            JSON.stringify({ leadId: req.params.id, studentName: cur.student_name, classApplied: cur.class_applied,
              guardianName: cur.guardian_name, guardianPhone: cur.guardian_phone,
              admissionYear: cur.notes?.admission_year ?? null })]);
        actionId = a.rows[0].id;
      }
      const u = await c.query(`UPDATE plugin_admissions.lead SET stage=$1, updated_at=now() WHERE id=$2 AND tenant_id=$3 RETURNING stage`,
        [to, req.params.id, req.user.tenant_id]);
      await c.query(`INSERT INTO plugin_admissions.stage_history (tenant_id, lead_id, from_stage, to_stage, actor)
        VALUES ($1,$2,$3,$4,$5)`, [req.user.tenant_id, req.params.id, cur.stage, to, req.user.email]);
      await emitEvent(c, req.user.tenant_id,
        { type: 'admissions', label: `admission stage transitioned: ${cur.stage} → ${to}`, ref: req.params.id },
        'admission.stage.transitioned', { leadId: req.params.id, from: cur.stage, to, actionId });
      if (actionId) {
        await emitEvent(c, req.user.tenant_id,
          { type: 'admissions', label: `admission offer accepted — students.create raised for approval`, ref: req.params.id },
          'admission.offer.accepted', { leadId: req.params.id, actionId, admissionYear: cur.notes?.admission_year ?? null });
      }
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: 'admission stage transitioned', recordType: 'AdmissionLead', recordRef: req.params.id,
        reason: 'funnel progression', policyRef: 'Platform §3 (plugin governance)', risk: to === 'enrolled' ? 'medium' : 'low',
        outcome: `${cur.stage} → ${to}${actionId ? ' · students.create raised via kernel approval action (no plugin-direct core write)' : ''}` });
      return { ok: true, from: cur.stage, to: u.rows[0].stage, actionId };
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
