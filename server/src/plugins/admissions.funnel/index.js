// admissions.funnel — runtime module (v1.3, migrations 018 + 022 + 119)
// India-admissions semantics: enquiry → form → interaction → offer → enrolled, a
// `waitlisted` holding state off `offer`, and rejected/withdrawn side exits. Duplicate-
// enquiry guard; Feb–Jun session window via settings (admission_year, cycle_start/
// cycle_end); offer/waitlist.accepted → students.create raised as a KERNEL APPROVAL-GATED
// action (app.actions) — offers create core student records, a core-domain write, so it
// rides kernel approval semantics and the plugin NEVER writes app.students directly. No
// money surfaces (fee collection is payments.upi's lane). All preHandlers async (Fastify 5
// law). The access tiers and the lattice live in ONE shared module
// (_shared/admissions-access.js) so the kernel follow-up queue and ops.bi cannot drift.
import { makeLifecycleGate } from '../_shared/lifecycle-gate.js';
import { uuidParams } from '../_shared/uuid-param.js';
import { toE164, maskPhone } from '../_shared/phone.js';
import { parseDob } from '../_shared/enrolment.js';
import { ADMIN, FULL_PII, NEXT, TERMINAL, STAGES, CLOSED_STAGES, parseGradeApplied } from '../_shared/admissions-access.js';
import { runFollowupSla } from './sla.js';

const ID = 'admissions.funnel';

const IST_NOW = () => new Date(Date.now() + 5.5 * 3600 * 1000);

// current Apr–Mar Indian academic cycle, e.g. '2026-27' (IST clock)
const currentSessionYear = () => {
  const n = IST_NOW();
  const y = (n.getUTCMonth() + 1) >= 4 ? n.getUTCFullYear() : n.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
};
const mmdd = (d) => `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
// A12: the session-window day must use the IST clock like currentSessionYear above —
// mmdd(new Date()) read UTC, so 00:00–05:30 IST evaluated "today" as yesterday.
const mmddIST = () => mmdd(IST_NOW());
const clamp = (v, n) => (v == null ? null : String(v).slice(0, n));

export function register(app, kernel) {
  const { withUser, requestAudit, emitEvent, require, sysq } = kernel;

  const lifecycleGate = makeLifecycleGate(kernel.sysq, ID);

  // F-4: queue (never send) a guardian notice. The comms dispatcher owns delivery and
  // records it honestly — a school with no rail configured drains the row as failed with
  // a reason rather than pretending it was sent. Idempotent via the dedup key.
  const queueGuardianNotice = async (c, tenantId, phone, template, body, dedupKey) => {
    if (!phone) return null;
    const r = await c.query(
      `INSERT INTO app.communications (tenant_id, audience_kind, audience_json, channel, template, body, status, policy_ref, dedup_key)
       VALUES ($1,'guardian',$2::jsonb,'whatsapp',$3,$4,'queued','DPDP consent obligations (guardian contact)',$5)
       ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING RETURNING id`,
      [tenantId, JSON.stringify([phone]), template, clamp(body, 1000), dedupKey]);
    return r.rows[0]?.id ?? null;
  };

  // ── capture enquiry (admin roles; session window + dedupe guard) ─────────────
  app.post(`/plugins/${ID}/leads`, { preHandler: [require(...ADMIN), lifecycleGate] }, async (req, reply) => {
    const { studentName, guardianName, guardianPhone, classApplied, source, admissionYear, dob } = req.body ?? {};
    if (!studentName || !guardianPhone || !classApplied) {
      return reply.code(400).send({ error: 'Student name, guardian phone and class are required' });
    }
    // A9: optional birth date at capture (validated once, stored on the lead) so
    // age-eligibility can be checked at conversion instead of on paper forms.
    let dobVal = null;
    if (dob != null && String(dob).trim() !== '') {
      const parsedDob = parseDob(dob);
      if (!parsedDob.ok) return reply.code(400).send({ error: parsedDob.error });
      dobVal = parsedDob.value;
    }
    if (!/^[\d+\-\s()]{6,15}$/.test(String(guardianPhone))) return reply.code(400).send({ error: 'Please enter a valid guardian phone number' });
    const phone = toE164(guardianPhone);
    if (!phone) return reply.code(400).send({ error: 'Please enter a valid guardian phone number' });
    // P2-2 (cycle 5): body-supplied admissionYear used to bypass window + dedupe semantics.
    // Format-validated, and non-current sessions require owner/itadmin.
    if (admissionYear != null && !/^\d{4}-\d{2}$/.test(String(admissionYear))) {
      return reply.code(400).send({ error: 'Admission year should look like 2026-27' });
    }
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // settings: admission_year + Feb–Jun session window (settings-driven, not hard-coded)
      const pl = (await c.query(`SELECT settings FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`,
        [req.user.tenant_id, ID])).rows[0];
      const s = pl?.settings ?? {};
      const ay = String(admissionYear ?? s.admission_year ?? currentSessionYear());
      if (ay !== currentSessionYear() && !['owner', 'itadmin'].includes(req.user.role)) {
        return reply.code(403).send({ error: `Only the school owner can record admissions for ${ay} — it is not the current session` });
      }
      // A10: closed catalogue when configured; free text otherwise.
      const src = String(source ?? s.default_source ?? 'walk-in').slice(0, 40);
      if (Array.isArray(s.sources) && s.sources.length && !s.sources.map(String).includes(src)) {
        return reply.code(400).send({ error: `Source must be one of this school's channels: ${s.sources.map(String).join(', ')}` });
      }
      if (s.cycle_start && s.cycle_end) {
        const today = mmddIST();
        if (today < String(s.cycle_start) || today > String(s.cycle_end)) {
          const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const human = (md) => { const [m, d] = String(md).split('-'); return `${MONTHS[Number(m) - 1]} ${Number(d)}`; };
          return reply.code(409).send({ error: `Admissions are open from ${human(s.cycle_start)} to ${human(s.cycle_end)}` });
        }
      }
      // duplicate-enquiry guard: one open enquiry per (guardian, class, session).
      const dup = (await c.query(
        `SELECT id FROM plugin_admissions.lead WHERE tenant_id=$1 AND guardian_phone=$2 AND class_applied=$3
          AND admission_year=$4 AND stage IN ('enquiry','form','interaction','offer','waitlisted') LIMIT 1`,
        [req.user.tenant_id, phone, String(classApplied), ay])).rows[0];
      if (dup) return reply.code(409).send({ error: 'This guardian already has an open enquiry for this class and session', leadId: dup.id });
      // P1-2 backstop: the check-then-insert above can race; the partial unique index (119)
      // turns the loser's 23505 into a friendly 409.
      let r;
      await c.query('SAVEPOINT lead_insert');
      try {
        r = await c.query(
          `INSERT INTO plugin_admissions.lead (tenant_id, student_name, guardian_name, guardian_phone, class_applied, source, created_by, admission_year, dob)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [req.user.tenant_id, clamp(studentName, 120), clamp(guardianName, 120),
            phone, clamp(classApplied, 40), src, req.user.id, ay, dobVal]);
        await c.query('RELEASE SAVEPOINT lead_insert');
      } catch (e) {
        if (e?.code === '23505') {
          await c.query('ROLLBACK TO SAVEPOINT lead_insert');
          const winner = (await c.query(
            `SELECT id FROM plugin_admissions.lead WHERE tenant_id=$1 AND guardian_phone=$2 AND class_applied=$3
              AND admission_year=$4 AND stage IN ('enquiry','form','interaction','offer','waitlisted') LIMIT 1`,
            [req.user.tenant_id, phone, String(classApplied), ay])).rows[0];
          return reply.code(409).send({ error: 'This guardian already has an open enquiry for this class and session', leadId: winner?.id ?? null });
        }
        throw e;
      }
      const leadId = r.rows[0].id;
      await c.query(`INSERT INTO plugin_admissions.stage_history (tenant_id, lead_id, from_stage, to_stage, actor)
        VALUES ($1,$2,NULL,'enquiry',$3)`, [req.user.tenant_id, leadId, req.user.email]);
      await emitEvent(c, req.user.tenant_id,
        { type: 'admissions', label: `admission enquiry captured (${clamp(studentName, 60)})`, ref: leadId },
        'admission.enquiry.captured', { leadId, classApplied, source: src, admissionYear: ay });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: 'admission enquiry captured', recordType: 'AdmissionLead', recordRef: leadId,
        reason: 'lead capture', policyRef: 'DPDP consent obligations (guardian contact)', risk: 'low',
        outcome: `enquiry created at stage enquiry (source ${src}, session ${ay})` });
      return { ok: true, leadId, stage: 'enquiry', admissionYear: ay };
    });
  });

  // ── list leads (masking depends on role; capped flag) ────────────────────────
  app.get(`/plugins/${ID}/leads`, { preHandler: [require(...ADMIN, 'teacher'), lifecycleGate] }, async (req, reply) => {
    const masked = !FULL_PII.includes(req.user.role);
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const stage = req.query.stage && STAGES.includes(req.query.stage) ? req.query.stage : null;
      const LIMIT = 200;
      const rows = (await c.query(
        `SELECT id, student_name, guardian_name, guardian_phone, class_applied, source, stage, admission_year,
                documents, created_at, updated_at
         FROM plugin_admissions.lead WHERE tenant_id=$1 AND ($2::text IS NULL OR stage=$2)
         ORDER BY created_at DESC LIMIT ${LIMIT + 1}`, [req.user.tenant_id, stage])).rows;
      const capped = rows.length > LIMIT;
      const page = capped ? rows.slice(0, LIMIT) : rows;
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: masked ? 'admission leads listed (masked)' : 'admission leads listed (full PII)', recordType: 'AdmissionLead', recordRef: 'list',
        reason: 'funnel view', policyRef: 'DPDP consent obligations (guardian contact)', risk: masked ? 'low' : 'medium',
        outcome: masked ? `${page.length} leads, PII masked${capped ? ' (capped)' : ''}` : `${page.length} leads, full PII${capped ? ' (capped)' : ''}` });
      return {
        masked, capped,
        leads: page.map((r) => ({
          id: r.id, studentName: r.student_name, classApplied: r.class_applied, source: r.source,
          stage: r.stage, admissionYear: r.admission_year ?? null,
          documentCount: Array.isArray(r.documents) ? r.documents.length : 0,
          createdAt: r.created_at, updatedAt: r.updated_at,
          guardianName: masked ? null : r.guardian_name,
          guardianPhone: masked ? maskPhone(r.guardian_phone) : r.guardian_phone,
        })),
      };
    });
  });

  // ── edit a lead (correction door; identity/session are immutable) ────────────
  app.patch(`/plugins/${ID}/leads/:id`, { preHandler: [require(...ADMIN), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    const sets = [];
    const vals = [req.params.id, req.user.tenant_id];
    const push = (col, v, cap) => { vals.push(clamp(v, cap)); sets.push(`${col}=$${vals.length}`); };
    if (b.studentName != null) { if (!String(b.studentName).trim()) return reply.code(400).send({ error: 'Student name cannot be empty' }); push('student_name', b.studentName, 120); }
    if (b.guardianName != null) push('guardian_name', b.guardianName, 120);
    if (b.classApplied != null) { if (!String(b.classApplied).trim()) return reply.code(400).send({ error: 'Class cannot be empty' }); push('class_applied', b.classApplied, 40); }
    if (b.source != null) push('source', b.source, 40);
    if (b.guardianPhone != null) {
      if (!/^[\d+\-\s()]{6,15}$/.test(String(b.guardianPhone))) return reply.code(400).send({ error: 'Please enter a valid guardian phone number' });
      const phone = toE164(b.guardianPhone);
      if (!phone) return reply.code(400).send({ error: 'Please enter a valid guardian phone number' });
      push('guardian_phone', phone, 20);
    }
    if (!sets.length) return reply.code(400).send({ error: 'Nothing to change' });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `UPDATE plugin_admissions.lead SET ${sets.join(', ')}, updated_at=now()
          WHERE id=$1 AND tenant_id=$2 RETURNING id, student_name, guardian_name, guardian_phone, class_applied, source, stage, admission_year`,
        vals);
      if (!r.rows[0]) return reply.code(404).send({ error: 'We couldn\'t find that enquiry' });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: 'admission enquiry corrected', recordType: 'AdmissionLead', recordRef: req.params.id,
        reason: 'lead correction', policyRef: 'DPDP consent obligations (guardian contact)', risk: 'low',
        outcome: `fields updated: ${sets.map((x) => x.split('=')[0]).join(', ')}` });
      return { ok: true, lead: r.rows[0] };
    });
  });

  // ── stage transition (admin roles; lattice enforced server-side) ─────────────
  app.post(`/plugins/${ID}/leads/:id/stage`, { preHandler: [require(...ADMIN), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    const to = String(req.body?.to ?? '');
    if (!STAGES.includes(to)) return reply.code(400).send({ error: `"${to}" is not a stage we know` });
    // A15: side exits end a child's application — they require a recorded reason
    // (stored on the history row + audit). Checked AFTER terminal/lattice so a
    // closed lead still answers 409 (immutable), not 400 (missing reason).
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : '';
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const cur = (await c.query(`SELECT stage, student_name, class_applied, guardian_name, guardian_phone, admission_year, documents FROM plugin_admissions.lead WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!cur) return reply.code(404).send({ error: 'We couldn\'t find that enquiry' });
      if (TERMINAL.has(cur.stage)) return reply.code(409).send({ error: `This enquiry is closed (${cur.stage}) and can\'t be changed` });
      if (!(NEXT[cur.stage] ?? []).includes(to)) {
        return reply.code(409).send({ error: `This enquiry can\'t move from "${cur.stage}" to "${to}"` });
      }
      if ((to === 'rejected' || to === 'withdrawn') && !reason) {
        return reply.code(400).send({ error: `Moving to "${to}" needs a reason — it ends this application` });
      }
      // A8: seat capacity — offers stop when the grade is full (students + open
      // offers/waitlists holding seats). The desk moves to `waitlisted` instead.
      if (to === 'offer') {
        const cap = Number((await c.query(`SELECT settings FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`,
          [req.user.tenant_id, ID])).rows[0]?.settings?.class_capacity ?? 0);
        if (Number.isFinite(cap) && cap > 0) {
          const { grade } = parseGradeApplied(cur.class_applied);
          const filled = (await c.query(
            `SELECT ((SELECT count(*)::int FROM app.students WHERE tenant_id=$1 AND status='active' AND grade=$2)
                   + (SELECT count(*)::int FROM plugin_admissions.lead
                       WHERE tenant_id=$1 AND class_applied=$3 AND stage IN ('offer','waitlisted') AND id<>$4)) AS n`,
            [req.user.tenant_id, grade, cur.class_applied, req.params.id])).rows[0].n;
          if (filled >= cap) {
            return reply.code(409).send({ error: `Class ${cur.class_applied} is full (${filled}/${cap} seats) — move this enquiry to waitlisted instead` });
          }
        }
      }
      // offer/waitlisted → enrolled: raise a KERNEL APPROVAL-GATED action (app.actions).
      // Admissions offers create core student records — a core-domain write — so it rides
      // kernel approval semantics; the plugin never writes app.students directly
      // (invariant: no_core_students_writes).
      // A1: re-raise after a dismissal must work — the first raise keeps the exact
      // code `students.create.<leadId>` (pinned by tests); later attempts suffix
      // .<n>. An still-open raise is returned as-is (idempotent retry).
      let actionId = null;
      if ((cur.stage === 'offer' || cur.stage === 'waitlisted') && to === 'enrolled') {
        const prior = (await c.query(
          `SELECT id, code FROM app.actions
            WHERE tenant_id=$1 AND status='open' AND payload->>'leadId'=$2 AND code LIKE 'students.create.%'`,
          [req.user.tenant_id, req.params.id])).rows[0];
        if (prior) {
          actionId = prior.id;
        } else {
          const attempts = (await c.query(
            `SELECT count(*)::int n FROM app.actions
              WHERE tenant_id=$1 AND payload->>'leadId'=$2 AND code LIKE 'students.create.%'`,
            [req.user.tenant_id, req.params.id])).rows[0].n;
          const code = attempts > 0 ? `students.create.${req.params.id}.${attempts + 1}` : `students.create.${req.params.id}`;
          const a = await c.query(
            `INSERT INTO app.actions (tenant_id, code, kind, title, detail, why, priority, status, owner, owner_role, policy_ref, ai_involved, source_event, payload, source_plugin)
             VALUES ($1,$2,'approval',$3,$4,$5,'high','open','Principal','principal','Admissions §2',false,'admission.offer.accepted',$6::jsonb,'admissions.funnel') RETURNING id`,
            [req.user.tenant_id, code,
            'Admission offer accepted — create student record',
            `Lead ${cur.student_name} (class ${cur.class_applied}) accepted the offer. Approve to create the core student record.`,
            'Admissions offers create core students — core-domain write routed through kernel approval; the funnel never writes app.students directly.',
            JSON.stringify({ leadId: req.params.id, studentName: cur.student_name, classApplied: cur.class_applied,
              guardianName: cur.guardian_name, guardianPhone: cur.guardian_phone,
              admissionYear: cur.admission_year ?? null,
              /* G1: stamp the proposer. This action is OWNED by the principal (owner_role
                 'principal'), and routes.js refuses to let an owning desk approve a raise that
                 names no proposer — "Segregation of duties — this proposal was raised without
                 an attributable proposer". The guard's own comment states the invariant it
                 enforces: "Every human raise site stamps proposed_by." This site did not, so a
                 coordinator's conversion was raised, routed to the principal's desk, and then
                 unrecoverable — only the owner could clear it. Naming the raiser satisfies the
                 invariant and keeps the SoD check meaningful: a coordinator cannot approve
                 their own conversion, because proposed_by then equals their own user id. */
              proposed_by: req.user.id, proposed_by_role: req.user.role })]);
        actionId = a.rows[0].id;
      }
    }
      const u = await c.query(`UPDATE plugin_admissions.lead SET stage=$1, updated_at=now() WHERE id=$2 AND tenant_id=$3 RETURNING stage`,
        [to, req.params.id, req.user.tenant_id]);
      try {
        await c.query(`INSERT INTO plugin_admissions.stage_history (tenant_id, lead_id, from_stage, to_stage, actor, reason)
          VALUES ($1,$2,$3,$4,$5,$6)`, [req.user.tenant_id, req.params.id, cur.stage, to, req.user.email, reason || null]);
      } catch {
        // pre-152 database without the reason column — history without reason.
        await c.query(`INSERT INTO plugin_admissions.stage_history (tenant_id, lead_id, from_stage, to_stage, actor)
          VALUES ($1,$2,$3,$4,$5)`, [req.user.tenant_id, req.params.id, cur.stage, to, req.user.email]);
      }
      // F-4: queue (never send) a guardian notice on offer and acceptance. Delivery is the
      // comms dispatcher's job; a school with no rail drains it honestly. Gated by the
      // `notify_guardians` setting (default true).
      let noticeId = null;
      if ((to === 'offer' || to === 'enrolled') && cur.guardian_phone) {
        const pl = (await c.query(`SELECT settings FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`,
          [req.user.tenant_id, ID])).rows[0];
        if (pl?.settings?.notify_guardians !== false) {
          const tpl = to === 'offer' ? 'ADMISSION_OFFER' : 'ADMISSION_ACCEPTED';
          const body = to === 'offer'
            ? `An admission offer has been made for ${cur.student_name} to class ${cur.class_applied}. Please contact the school office to confirm acceptance.`
            : `Thank you — the admission offer for ${cur.student_name} (class ${cur.class_applied}) is accepted. The school office will complete enrollment.`;
          noticeId = await queueGuardianNotice(c, req.user.tenant_id, cur.guardian_phone, tpl, body, `admission.${to}:${req.params.id}`);
        }
      }
      await emitEvent(c, req.user.tenant_id,
        { type: 'admissions', label: `admission stage transitioned: ${cur.stage} → ${to}`, ref: req.params.id },
        'admission.stage.transitioned', { leadId: req.params.id, from: cur.stage, to, actionId, noticeId });
      if (actionId) {
        await emitEvent(c, req.user.tenant_id,
          { type: 'admissions', label: `admission offer accepted — students.create raised for approval`, ref: req.params.id },
          'admission.offer.accepted', { leadId: req.params.id, actionId, admissionYear: cur.admission_year ?? null });
      }
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: 'admission stage transitioned', recordType: 'AdmissionLead', recordRef: req.params.id,
        reason: reason || 'funnel progression', policyRef: 'Platform §3 (plugin governance)', risk: to === 'enrolled' ? 'medium' : 'low',
        outcome: `${cur.stage} → ${to}${reason ? ` · reason: ${reason.slice(0, 120)}` : ''}${actionId ? ' · students.create raised via kernel approval action (no plugin-direct core write)' : ''}` });
      return { ok: true, from: cur.stage, to: u.rows[0].stage, actionId };
    });
  });

  // ── repair: reopen a stranded enrolled lead (A14) ─────────────────────────
  // Leads stranded by pre-A1 dismissals sit at `enrolled` with no student and no
  // open action — terminal, unrecoverable through the lattice. Owner/principal may
  // return exactly such a lead to `offer` (audited); anything else is refused so
  // the repair cannot rewrite live conversions.
  app.post(`/plugins/${ID}/leads/:id/reopen`, { preHandler: [require('owner', 'principal'), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : '';
    if (!reason) return reply.code(400).send({ error: 'A reason is required to reopen a stranded application' });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const lead = (await c.query(`SELECT id, stage FROM plugin_admissions.lead WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!lead) return reply.code(404).send({ error: 'We couldn\'t find that enquiry' });
      if (lead.stage !== 'enrolled') return reply.code(409).send({ error: `Only a stranded enrolled lead can be reopened (this one is ${lead.stage})` });
      const made = (await c.query(
        `SELECT 1 FROM app.students WHERE tenant_id=$1 AND source='admissions' AND source_ref=$2`,
        [req.user.tenant_id, req.params.id])).rows[0];
      if (made) return reply.code(409).send({ error: 'This lead already has a student record — nothing to repair' });
      const openAction = (await c.query(
        `SELECT 1 FROM app.actions WHERE tenant_id=$1 AND status='open' AND payload->>'leadId'=$2`, [req.user.tenant_id, req.params.id])).rows[0];
      if (openAction) return reply.code(409).send({ error: 'This lead has an open approval — decide it instead of reopening' });
      await c.query(`UPDATE plugin_admissions.lead SET stage='offer', updated_at=now() WHERE id=$1 AND tenant_id=$2`,
        [req.params.id, req.user.tenant_id]);
      try {
        await c.query(`INSERT INTO plugin_admissions.stage_history (tenant_id, lead_id, from_stage, to_stage, actor, reason)
          VALUES ($1,$2,'enrolled','offer',$3,$4)`, [req.user.tenant_id, req.params.id, req.user.email, reason]);
      } catch {
        await c.query(`INSERT INTO plugin_admissions.stage_history (tenant_id, lead_id, from_stage, to_stage, actor)
          VALUES ($1,$2,'enrolled','offer',$3)`, [req.user.tenant_id, req.params.id, req.user.email]);
      }
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: 'stranded admission reopened', recordType: 'AdmissionLead', recordRef: req.params.id,
        reason, policyRef: 'Platform §3 (plugin governance)', risk: 'medium', outcome: 'enrolled → offer (orphan repair)' });
      return { ok: true, id: req.params.id, from: 'enrolled', to: 'offer' };
    });
  });

  // ── visit / interview / call scheduling + outcomes ───────────────────────────
  app.post(`/plugins/${ID}/leads/:id/activities`, { preHandler: [require(...ADMIN), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    const kind = String(b.kind ?? '');
    if (!['visit', 'interview', 'call', 'note'].includes(kind)) return reply.code(400).send({ error: 'Activity must be a visit, interview, call or note' });
    const scheduledAt = b.scheduledAt != null ? String(b.scheduledAt) : null;
    if (scheduledAt && Number.isNaN(Date.parse(scheduledAt))) return reply.code(400).send({ error: 'The scheduled time isn\'t a valid date' });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const lead = (await c.query(`SELECT id FROM plugin_admissions.lead WHERE id=$1 AND tenant_id=$2`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!lead) return reply.code(404).send({ error: 'We couldn\'t find that enquiry' });
      const r = await c.query(
        `INSERT INTO plugin_admissions.lead_activity (tenant_id, lead_id, kind, scheduled_at, completed_at, outcome, notes, actor)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, kind, scheduled_at, completed_at, outcome, notes, actor, created_at`,
        [req.user.tenant_id, req.params.id, kind, scheduledAt,
          b.completed ? new Date() : null, clamp(b.outcome, 200), clamp(b.notes, 1000), req.user.email]);
      await emitEvent(c, req.user.tenant_id,
        { type: 'admissions', label: `admission ${kind} logged for ${req.params.id}`, ref: req.params.id },
        `admission.${kind}.logged`, { leadId: req.params.id, activityId: r.rows[0].id, kind, scheduledAt });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: `admission ${kind} logged`, recordType: 'AdmissionLead', recordRef: req.params.id,
        reason: 'funnel scheduling', policyRef: 'Platform §3 (plugin governance)', risk: 'low',
        outcome: `${kind}${scheduledAt ? ` scheduled ${scheduledAt}` : ''}${b.outcome ? ` · outcome: ${clamp(b.outcome, 60)}` : ''}` });
      return { ok: true, activity: r.rows[0] };
    });
  });

  app.get(`/plugins/${ID}/leads/:id/activities`, { preHandler: [require(...ADMIN, 'teacher'), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const rows = (await c.query(
        `SELECT id, kind, scheduled_at, completed_at, outcome, notes, actor, created_at
           FROM plugin_admissions.lead_activity WHERE lead_id=$1 AND tenant_id=$2
          ORDER BY COALESCE(scheduled_at, created_at) ASC LIMIT 200`, [req.params.id, req.user.tenant_id])).rows;
      return { activities: rows };
    });
  });

  // ── documents attached at admission (file ids from files.store) ──────────────
  app.post(`/plugins/${ID}/leads/:id/documents`, { preHandler: [require(...ADMIN), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.fileId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(b.fileId))) {
      return reply.code(400).send({ error: 'A valid file id is required (upload through files.store first)' });
    }
    const label = clamp(b.label ?? 'Admission document', 80);
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // A4: the id must be a real file OF THIS SCHOOL — previously any UUID-shaped
      // string was accepted, leaving dangling (or foreign) references on the lead.
      const own = (await c.query(`SELECT id FROM app.files WHERE id=$1 AND tenant_id=$2`,
        [String(b.fileId), req.user.tenant_id]).catch(() => ({ rows: [] }))).rows[0];
      if (!own) return reply.code(404).send({ error: 'That file does not exist in this school — upload through files.store first' });
      const doc = { fileId: String(b.fileId), label, attachedAt: new Date().toISOString(), by: req.user.email };
      const r = await c.query(
        `UPDATE plugin_admissions.lead SET documents = documents || $3::jsonb, updated_at=now()
          WHERE id=$1 AND tenant_id=$2 RETURNING id, documents`,
        [req.params.id, req.user.tenant_id, JSON.stringify([doc])]);
      if (!r.rows[0]) return reply.code(404).send({ error: 'We couldn\'t find that enquiry' });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: 'admission document attached', recordType: 'AdmissionLead', recordRef: req.params.id,
        reason: 'application document', policyRef: 'Platform §2.4 · DPDP data minimisation', risk: 'low',
        outcome: `${label} (file ${doc.fileId})` });
      return { ok: true, documents: r.rows[0].documents };
    });
  });

  // ── offer letter (deterministic, generated on read; nothing is stored) ───────
  app.get(`/plugins/${ID}/leads/:id/offer-letter`, { preHandler: [require(...ADMIN), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const l = (await c.query(
        `SELECT l.id, l.student_name, l.class_applied, l.guardian_name, l.stage, l.admission_year, t.name AS school
           FROM plugin_admissions.lead l JOIN app.tenants t ON t.id = l.tenant_id
          WHERE l.id=$1 AND l.tenant_id=$2`, [req.params.id, req.user.tenant_id])).rows[0];
      if (!l) return reply.code(404).send({ error: 'We couldn\'t find that enquiry' });
      if (!['offer', 'waitlisted', 'enrolled'].includes(l.stage)) {
        return reply.code(409).send({ error: 'An offer letter is only available once an offer has been made' });
      }
      const session = l.admission_year || currentSessionYear();
      // A11: enclose the class fee table so the offer states the price, not just the
      // seat. Reads the school's own plan templates for the normalised grade (best
      // effort — no plan configured means no fee lines, never a failure).
      let feeLines = [];
      try {
        const { grade } = parseGradeApplied(l.class_applied);
        const plans = (await c.query(
          `SELECT name, terms FROM app.fee_plan_templates WHERE tenant_id=$1 AND $2 = ANY(grades) ORDER BY name LIMIT 5`,
          [req.user.tenant_id, grade]).catch(() => ({ rows: [] }))).rows;
        for (const pl of plans) {
          for (const t of (Array.isArray(pl.terms) ? pl.terms : [])) {
            feeLines.push(`- ${pl.name} · ${t.label ?? t.term ?? ''}: Rs ${(Number(t.amount_cents ?? 0) / 100).toFixed(2)}${t.due_on ? ` (due ${t.due_on})` : ''}`);
          }
        }
      } catch { feeLines = []; }
      const letter = [
        `${l.school}`,
        ``,
        `OFFER OF ADMISSION — Academic Session ${session}`,
        ``,
        `Dear ${l.guardian_name ?? 'Parent/Guardian'},`,
        ``,
        `We are pleased to offer admission to ${l.student_name} to Class ${l.class_applied} for the`,
        `${session} academic session, subject to completion of the admission formalities and`,
        `submission of the required documents.`,
        ``,
        `Please confirm acceptance so we may create the student record and complete enrollment.`,
        ...(feeLines.length ? [``, `Fee structure for Class ${l.class_applied} (as configured by the school):`, ...feeLines] : []),
        ``,
        `Warm regards,`,
        `Admissions Office`,
        `${l.school}`,
        ``,
        `Generated ${new Date().toISOString()} · SchoolOS`,
      ].join('\n');
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: 'admission offer letter generated', recordType: 'AdmissionLead', recordRef: l.id,
        reason: 'offer letter', policyRef: 'Platform §3 (plugin governance)', risk: 'low',
        outcome: `offer letter rendered for ${l.student_name} (class ${l.class_applied}, session ${session})${feeLines.length ? ` with ${feeLines.length} fee line(s)` : ' (no fee plan configured for this class)'}` });
      return { leadId: l.id, studentName: l.student_name, classApplied: l.class_applied, admissionYear: session, letter, feeLines };
    });
  });

  // ── stage history (admin roles) ──────────────────────────────────────────────
  app.get(`/plugins/${ID}/leads/:id/history`, { preHandler: [require(...ADMIN), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      let rows;
      try {
        rows = (await c.query(
          `SELECT from_stage, to_stage, actor, at, reason FROM plugin_admissions.stage_history
           WHERE lead_id=$1 AND tenant_id=$2 ORDER BY at ASC`, [req.params.id, req.user.tenant_id])).rows;
      } catch {
        rows = (await c.query(
          `SELECT from_stage, to_stage, actor, at FROM plugin_admissions.stage_history
           WHERE lead_id=$1 AND tenant_id=$2 ORDER BY at ASC`, [req.params.id, req.user.tenant_id])).rows;
      }
      if (!rows.length) return reply.code(404).send({ error: 'We couldn\'t find that enquiry' });
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

  // ── health probe + orphan reconciliation (owner/principal/itadmin) ───────────
  // The manifest declared `health: stage-lattice probe` in 018 but nothing implemented
  // it. This reports the lattice's own health and the two conversion orphans that matter:
  //   · a lead parked at `enrolled` with no student and no open approval action
  //     (a dismissed action leaves exactly this state — the conversion never completed);
  //   · an open `students.create` action whose lead is no longer `enrolled`.
  app.get(`/plugins/${ID}/health`, { preHandler: [require('owner', 'principal', 'itadmin'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const byStage = (await c.query(
        `SELECT stage, count(*)::int n, MAX(extract(epoch FROM (now()-updated_at))/86400)::int oldest_days
           FROM plugin_admissions.lead WHERE tenant_id=$1 GROUP BY stage`, [req.user.tenant_id])).rows;
      const stuck = (await c.query(
        `SELECT count(*)::int n FROM plugin_admissions.lead
          WHERE tenant_id=$1 AND stage NOT IN ('enrolled','rejected','withdrawn')
            AND updated_at < now() - interval '7 days'`, [req.user.tenant_id])).rows[0].n;
      const stranded = (await c.query(
        `SELECT l.id, l.student_name, l.stage FROM plugin_admissions.lead l
          WHERE l.tenant_id=$1 AND l.stage='enrolled'
            AND NOT EXISTS (SELECT 1 FROM app.students s WHERE s.tenant_id=l.tenant_id AND s.source='admissions' AND s.source_ref=l.id::text)
            AND NOT EXISTS (SELECT 1 FROM app.actions a WHERE a.tenant_id=l.tenant_id AND a.status='open' AND a.payload->>'leadId'=l.id::text)
          LIMIT 100`, [req.user.tenant_id])).rows;
      const dangling = (await c.query(
        `SELECT a.id, a.code, a.payload->>'leadId' AS lead_id FROM app.actions a
          WHERE a.tenant_id=$1 AND a.status='open' AND a.code LIKE 'students.create.%'
            AND NOT EXISTS (SELECT 1 FROM plugin_admissions.lead l WHERE l.id::text=a.payload->>'leadId' AND l.stage='enrolled')
          LIMIT 100`, [req.user.tenant_id])).rows;
      const open = byStage.filter((r) => !CLOSED_STAGES.includes(r.stage));
      const healthy = stranded.length === 0 && dangling.length === 0;
      return {
        healthy, probe: 'stage-lattice',
        stages: Object.fromEntries(byStage.map((r) => [r.stage, { count: r.n, oldestDays: r.oldest_days }])),
        openLeads: open.reduce((a, r) => a + r.n, 0),
        stuckOver7d: stuck,
        orphans: { strandedEnrolled: stranded, danglingActions: dangling },
      };
    });
  });

  // ── follow-up SLA sweep (owner/principal/itadmin) ────────────────────────────
  // F-3: `stuck > 7d` was computed on read and nothing ever escalated. This sweep is the
  // escalation: it raises an in-app notification per stuck lead (one per lead per day —
  // idempotent by the day check) and emits `admission.followup.overdue` so the event spine
  // records the chase. A5: the selection/notification core lives in sla.js, shared with
  // the day-worker step — the door only adds events + audit. Safe to run from cron or a
  // worker; it never mutates the lead.
  app.post(`/plugins/${ID}/sla/run`, { preHandler: [require('owner', 'principal', 'itadmin'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const out = await runFollowupSla(c.query.bind(c), req.user.tenant_id, {
        actor: req.user.email,
        emit: async (topic, payload, lead) => {
          await emitEvent(c, req.user.tenant_id,
            { type: 'admissions', label: `admission follow-up overdue: ${lead.student_name} (${lead.stage})`, ref: payload.leadId },
            topic, payload);
        },
      });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: 'admission follow-up SLA sweep', recordType: 'AdmissionLead', recordRef: 'sla',
        reason: 'follow-up SLA (>7 days without touch)', policyRef: 'Platform §3 (plugin governance)', risk: 'low',
        outcome: `${out.scanned} stuck lead(s) scanned · ${out.raised} escalated · ${out.skipped} already chased today · ${out.reminded ?? 0} interview reminder(s)` });
      return { ok: true, scanned: out.scanned, raised: out.raised, skipped: out.skipped, reminded: out.reminded ?? 0 };
    });
  });
}
