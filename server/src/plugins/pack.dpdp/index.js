// pack.dpdp — DPDP Act 2023 compliance pack (migration 023; contract dpdp.consent.ledger
// locked in 009). Class C: consent ledger is IMMUTABLE (invariant consent_immutable —
// withdrawal appends a superseding row, never updates a decision); SAR (subject-access
// request) export/erasure ride the KERNEL APPROVAL spine (app.actions) — erasure touches
// the data-principal's identity across domains, so it executes ONLY after kernel
// approval. Retention hooks: consent_validity_days (capture-time schedule) +
// dsr_sla_days (invariant sar_sla_tracked). Events: consent.recorded.v1 ·
// sar.opened.v1 · sar.fulfilled.v1. All preHandlers async (Fastify 5 law).
//
// OFFICE-LANE ERASURE (owner decision, 2026-09-14). This module holds NO SQL against
// `app.students` and never will: the invariant recorded in migration 023 — the pack never
// writes core student rows (office lane) — stands, and is what the DPDP pack promises. The
// office lane's DENORMALISED guardian PII (`app.students.guardian_name` / `guardian_phone`)
// is nevertheless erased, because a data principal who exercises erasure must not stay named
// on the student row: the pack REQUESTS the named core-lane action `students.redactGuardianPii`
// from the kernel (`kernel.requestCoreLaneAction`, src/core-lane-actions.js), which holds the
// SQL, runs it on this request's tenant-scoped client and writes its audit row in the SAME
// transaction. Same boundary, same shape as admissions.funnel's `students.create.<leadId>`
// kernel action. The authorisation is the SAR approval a second authority already decided —
// no second approval is raised, because that would authorise nothing new.
import { makeLifecycleGate } from '../_shared/lifecycle-gate.js';
import { uuidParams } from '../_shared/uuid-param.js';
import { createHash, createHmac } from 'node:crypto';
import { config } from '../../config.js'; // surrogate key material stays in env (D-32: never in code/git)
import { encryptValue } from '../../settings-crypto.js';
import { toE164, isE164 } from '../_shared/phone.js';

const ID = 'pack.dpdp';

export function register(app, kernel) {
  const { withUser, requestAudit, emitEvent, require, sysq } = kernel;

  const DPO = ['owner', 'principal', 'itadmin', 'coordinator']; // data-protection operators
  const lifecycleGate = makeLifecycleGate(kernel.sysq, ID);
  /* P2-1 (cycle 5) said spaced vs compact phone must be ONE data principal, and this file was fixed for it
     with a PRIVATE copy of the rule. That copy is now imported instead: `_shared/phone.js` is the same rule
     plus the E.164 validity check, extracted because three files had drifted copies of it (this one, the
     admissions funnel and the comms dispatcher). One normaliser, one answer to "which number is this". */

  const slaStamp = (days) => `now() + make_interval(days => ${Math.max(1, Math.min(90, Number(days) || 30))})`;
  const validityStamp = (days) => `now() + make_interval(days => ${Math.max(1, Math.min(3650, Number(days) || 1095))})`;

  // ── record consent (append-only; withdrawal = superseding artifact) ──────────
  app.post(`/plugins/${ID}/consent`, { preHandler: [require(...DPO), lifecycleGate] }, async (req, reply) => {
    const { subjectRef, purpose, decision, basis, channel } = req.body ?? {};
    if (!subjectRef || !purpose || !['granted', 'withdrawn'].includes(decision)) {
      return reply.code(400).send({ error: "Guardian phone number, purpose and a grant/withdraw decision are required" });
    }
    // P3-1 (cycle 6): normalize BEFORE validating — spaced variants of any length meet
    // the E.164 contract; the regex judges the normalized form, not the raw input
    if (!isE164(toE164(String(subjectRef)))) return reply.code(400).send({ error: 'Please enter a valid guardian phone number' });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const s = (await c.query(`SELECT settings FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`,
        [req.user.tenant_id, ID])).rows[0]?.settings ?? {};
      // the dedupe guard applies ONLY to new grants whose operative (latest) artifact is
      // still granted — a withdrawal supersedes it, so re-granting appends a fresh
      // artifact (consent_immutable: append-only decision trail)
      if (decision === 'granted') {
        const live = (await c.query(
          `SELECT decision FROM plugin_dpdp.consent
           WHERE tenant_id=$1 AND subject_ref=$2 AND purpose=$3
           ORDER BY valid_from DESC, created_at DESC LIMIT 1`,
          [req.user.tenant_id, toE164(subjectRef), String(purpose).slice(0, 80)])).rows[0];
        if (live && live.decision === 'granted') {
          return reply.code(409).send({ error: 'Consent is already granted for this purpose' });
        }
      }
      const r = await c.query(
        `INSERT INTO plugin_dpdp.consent (tenant_id, subject_ref, purpose, decision, basis, channel, actor, evidence, valid_until)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb, ${validityStamp(s.consent_validity_days)}) RETURNING id, valid_until`,
        [req.user.tenant_id, toE164(subjectRef), String(purpose).slice(0, 80), decision,
          basis ? String(basis).slice(0, 40) : 'consent', channel ? String(channel).slice(0, 40) : 'walk-in',
          req.user.email, JSON.stringify({ recordedBy: req.user.email, note: req.body?.note ?? null, rawSubjectRef: String(subjectRef) })]);
      await emitEvent(c, req.user.tenant_id,
        { type: 'dpdp', label: `consent ${decision} (${String(purpose).slice(0, 40)})`, ref: r.rows[0].id },
        'consent.recorded.v1', { consentId: r.rows[0].id, subjectRef: String(subjectRef), purpose, decision });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: `consent ${decision}`, recordType: 'ConsentArtifact', recordRef: r.rows[0].id,
        reason: 'DPDP consent ledger (append-only)', policyRef: 'DPDP Act 2023 · consent and retention', risk: 'low',
        outcome: `artifact appended for ${purpose} · valid until ${r.rows[0].valid_until?.toISOString?.() ?? r.rows[0].valid_until}` });
      return { ok: true, consentId: r.rows[0].id, decision, validUntil: r.rows[0].valid_until, immutable: true };
    });
  });

  // ── consent state (computed from the latest artifact per subject+purpose) ────
  app.get(`/plugins/${ID}/consent/state`, { preHandler: [require(...DPO), lifecycleGate] }, async (req, reply) => {
    const subjectRef = req.query.subjectRef ? String(req.query.subjectRef) : null;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // P2-1: normalize the query so spaced input matches stored E.164 artifacts
      const norm = subjectRef ? toE164(subjectRef) : null;
      const rows = (await c.query(
        `SELECT DISTINCT ON (subject_ref, purpose) subject_ref, purpose, decision, valid_from, valid_until
         FROM plugin_dpdp.consent WHERE tenant_id=$1 AND ($2::text IS NULL OR subject_ref=$2)
         ORDER BY subject_ref, purpose, valid_from DESC, created_at DESC`, [req.user.tenant_id, norm])).rows;
      const now = Date.now();
      const states = rows.map((r) => ({
        subjectRef: r.subject_ref, purpose: r.purpose,
        state: r.decision === 'withdrawn' ? 'withdrawn'
          : (r.valid_until && r.valid_until.getTime() < now ? 'expired' : 'granted'),
        lastArtifact: { decision: r.decision, validFrom: r.valid_from, validUntil: r.valid_until },
      }));
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: 'consent state queried', recordType: 'ConsentArtifact', recordRef: subjectRef ?? 'all',
        reason: 'compliance view', policyRef: 'DPDP Act 2023 · consent and retention', risk: 'low',
        outcome: `${states.length} purpose-state(s) computed from ${states.length} latest artifacts` });
      return { states };
    });
  });

  // ── open SAR (export|erasure) → kernel approval action ───────────────────────
  app.post(`/plugins/${ID}/dsr`, { preHandler: [require(...DPO), lifecycleGate] }, async (req, reply) => {
    const { kind, subjectRef, note } = req.body ?? {};
    if (!['export', 'erasure'].includes(kind)) return reply.code(400).send({ error: "Data request type must be export or erasure" });
    if (!subjectRef || !isE164(toE164(String(subjectRef)))) return reply.code(400).send({ error: 'Please enter the guardian\'s phone number' });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const open = (await c.query(
        `SELECT id FROM plugin_dpdp.sar WHERE tenant_id=$1 AND subject_ref=$2 AND kind=$3 AND status='open' LIMIT 1`,
        [req.user.tenant_id, toE164(subjectRef), kind])).rows[0];
      if (open) return reply.code(409).send({ error: `There is already an open ${kind} request for this phone number`, sarId: open.id });
      const s = (await c.query(`SELECT settings FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`,
        [req.user.tenant_id, ID])).rows[0]?.settings ?? {};
      const sar = await c.query(
        `INSERT INTO plugin_dpdp.sar (tenant_id, kind, subject_ref, requested_by, sla_due_at)
         VALUES ($1,$2,$3,$4, ${slaStamp(s.dsr_sla_days)}) RETURNING id, sla_due_at`,
        [req.user.tenant_id, kind, toE164(subjectRef), req.user.email]);
      const sarId = sar.rows[0].id;
      // P1-1 (cycle 5): action codes are UNIQUE (tenant_id, code) — the fixed
      // `dpdp.dsr.${kind}` 500'd on the SECOND SAR of a kind (subject #2 could never
      // raise erasure). Per-instance code, binding stays via sar.action_id.
      const act = await c.query(
        `INSERT INTO app.actions (tenant_id, code, kind, title, detail, why, priority, status, owner, owner_role, policy_ref, ai_involved, source_event, payload)
         VALUES ($1,$2,'approval',$3,$4,$5,'high','open','Principal','principal','DPDP Act 2023 · SAR',false,'sar.opened.v1',$6::jsonb) RETURNING id`,
        [req.user.tenant_id, `dpdp.dsr.${kind}.${sarId}`,
          kind === 'export' ? `SAR export for ${String(subjectRef)}` : `SAR ERASURE for ${String(subjectRef)} — irreversible`,
          kind === 'export'
            ? `Bundle the consent artifacts and admissions PII held for this data principal (SLA ${sar.rows[0].sla_due_at?.toISOString?.() ?? sar.rows[0].sla_due_at}).`
            : `Redact the data principal's identity from the consent ledger and admissions funnel. Irreversible once executed.`,
          'Erasure touches the principal\'s data across plugin domains and the office lane — kernel approval semantics; the pack executes only what it owns, and requests the kernel-executed core-lane action for the office-lane student row (kernel holds that SQL, never this plugin).',
          JSON.stringify({ sarId, subjectRef: toE164(subjectRef), dsrKind: kind, note: note ?? null, proposed_by: req.user.id, proposed_by_role: req.user.role })]);
      await c.query(`UPDATE plugin_dpdp.sar SET action_id=$1 WHERE id=$2`, [act.rows[0].id, sarId]);
      await emitEvent(c, req.user.tenant_id,
        { type: 'dpdp', label: `SAR ${kind} opened for ${toE164(subjectRef)}`, ref: sarId },
        'sar.opened.v1', { sarId, actionId: act.rows[0].id, kind, subjectRef: toE164(subjectRef) });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: `SAR ${kind} opened`, recordType: 'SAR', recordRef: sarId,
        reason: 'data-principal request', policyRef: 'DPDP Act 2023 · SAR', risk: kind === 'erasure' ? 'high' : 'medium',
        outcome: `kernel approval action raised (${act.rows[0].id}) · SLA ${sar.rows[0].sla_due_at?.toISOString?.() ?? sar.rows[0].sla_due_at}` });
      return { ok: true, sarId, actionId: act.rows[0].id, slaDueAt: sar.rows[0].sla_due_at };
    });
  });

  // ── SAR list + SLA tracking ──────────────────────────────────────────────────
  app.get(`/plugins/${ID}/dsr`, { preHandler: [require(...DPO), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const rows = (await c.query(
        `SELECT id, kind, subject_ref, status, action_id, sla_due_at, fulfilled_at, requested_by, created_at
         FROM plugin_dpdp.sar WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 200`, [req.user.tenant_id])).rows;
      return {
        sars: rows.map((r) => ({
          sarId: r.id, kind: r.kind, subjectRef: r.subject_ref, status: r.status, actionId: r.action_id,
          slaDueAt: r.sla_due_at, overdue: r.status === 'open' && r.sla_due_at && r.sla_due_at.getTime() < Date.now(),
          fulfilledAt: r.fulfilled_at, requestedBy: r.requested_by, createdAt: r.created_at,
        })),
      };
    });
  });

  // ── export bundle (only after kernel approval + execution) ───────────────────
  app.get(`/plugins/${ID}/dsr/:id/export`, { preHandler: [require(...DPO), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const sar = (await c.query(`SELECT * FROM plugin_dpdp.sar WHERE id=$1 AND tenant_id=$2`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!sar) return reply.code(404).send({ error: 'We couldn\'t find that data request' });
      if (sar.kind !== 'export') return reply.code(400).send({ error: 'Only export requests produce a data bundle' });
      if (sar.status !== 'fulfilled') return reply.code(409).send({ error: 'This request is still waiting for approval' });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: 'SAR export bundle delivered', recordType: 'SAR', recordRef: sar.id,
        reason: 'data-principal access fulfilment', policyRef: 'DPDP Act 2023 · SAR', risk: 'medium',
        outcome: 'bundle delivered to DPO surface' });
      return { sarId: sar.id, status: sar.status, bundle: sar.bundle };
    });
  });

  // ── execute an APPROVED SAR (kernel-gated; this door never approves) ─────────
  app.post(`/plugins/${ID}/dsr/:id/execute`, { preHandler: [require(...DPO), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const sar = (await c.query(`SELECT * FROM plugin_dpdp.sar WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!sar) return reply.code(404).send({ error: 'We couldn\'t find that data request' });
      if (sar.status !== 'open') return reply.code(409).send({ error: `This request is already ${sar.status}` });
      if (!sar.action_id) return reply.code(409).send({ error: 'kernel approval action missing (raise failed mid-flight)' });
      const act = (await c.query(`SELECT status, payload FROM app.actions WHERE id=$1 AND tenant_id=$2`, [sar.action_id, req.user.tenant_id])).rows[0];
      if (!act || act.status === 'open') return reply.code(409).send({ error: 'This needs approval first — decide it in the Approvals queue' });
      if (act.status === 'dismissed') return reply.code(409).send({ error: 'This request was dismissed, so it can\'t be carried out' });
      // defense in depth: the kernel blocks self-approval; the pack also refuses to
      // execute for the proposer (segregation of duties)
      if (act.payload?.proposed_by === req.user.id) {
        return reply.code(403).send({ error: 'The person who raised this request can\'t approve it — a second person must' });
      }
      let bundle;
      if (sar.kind === 'export') {
        const consents = (await c.query(
          `SELECT purpose, decision, basis, channel, valid_from, valid_until, created_at
           FROM plugin_dpdp.consent WHERE tenant_id=$1 AND subject_ref=$2 ORDER BY valid_from ASC`,
          [req.user.tenant_id, sar.subject_ref])).rows;
        const leads = (await c.query(
          `SELECT id, student_name, guardian_name, class_applied, source, stage, created_at
           FROM plugin_admissions.lead WHERE tenant_id=$1 AND guardian_phone=$2`,
          [req.user.tenant_id, sar.subject_ref])).rows;
        bundle = { subjectRef: sar.subject_ref, generatedAt: new Date().toISOString(),
          consentArtifacts: consents, admissionsLeads: leads,
          scopeNote: 'consent ledger + admissions funnel PII (declared dependency). Core student records are office-lane.' };
      } else {
        const cr = await c.query(
          `UPDATE plugin_dpdp.consent SET subject_ref='[erased:'||id||']', evidence=jsonb_build_object('erased',true,'erasedAt',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
           WHERE tenant_id=$1 AND subject_ref=$2`, [req.user.tenant_id, sar.subject_ref]);
        const lr = await c.query(
          `UPDATE plugin_admissions.lead SET guardian_name=NULL, guardian_phone='[erased:'||id||']'
           WHERE tenant_id=$1 AND guardian_phone=$2`, [req.user.tenant_id, sar.subject_ref]);

        // ── L2-3.5: erasure completion (Wave 3) ──────────────────────────────
        // Queue-scoped surfaces (L1 BACKLOG-8 findings): guardians redaction,
        // comms recipient hashing, webhook payload scrub, OTP phones purge —
        // plus the SAR row itself, which previously kept the raw phone forever.
        // Format-insensitive matching: phone formats differ per surface, so
        // matches compare digit-normalized forms. Every rewritten value is the
        // tenant-scoped keyed surrogate (HMAC) — ledger joins survive,
        // re-identification needs the server key, repeat SARs are idempotent
        // via the 060 journal (which stores only sha256(subject), never PII).
        // The erasure execution itself writes NO phone anywhere: the bundle and
        // the SAR row carry the surrogate; login identities (app.users) stay
        // office-lane (blocks.md note) and hash-chained audit rows redact via
        // the post-run audit_redact rebase (findings doc).
        //
        // OFFICE-LANE (owner decision, 2026-09-14): the denormalised guardian PII on
        // app.students IS erased — a data principal who exercises erasure must not stay
        // named on the student row. This module still holds no SQL against app.students:
        // it REQUESTS the kernel-executed core-lane action `students.redactGuardianPii`
        // (see the file header). The kernel nulls guardian_phone rather than writing the
        // surrogate into it, because that column is the office lane's CONTACT COPY —
        // consumers such as the fee-dunning sweep treat any non-empty value as a
        // deliverable number — and tombstones guardian_name with '[erased:<id>]'.
        const norm = toE164(sar.subject_ref);
        const digits = norm.replace(/\D/g, '');
        const subjectKey = createHash('sha256').update(`dpdp-erasure:${req.user.tenant_id}:${norm}`).digest('hex');
        const journal = await kernel.sysq(
          `INSERT INTO plugin_dpdp.erasure_journal (tenant_id, subject_key, surrogate, subject_token, executed_by)
           VALUES ($1,$2,$3,$4::jsonb,$5)
           ON CONFLICT (tenant_id, subject_key) DO UPDATE SET executed_at=now(), executed_by=EXCLUDED.executed_by,
             subject_token=COALESCE(plugin_dpdp.erasure_journal.subject_token, EXCLUDED.subject_token), replayed_at=NULL
           RETURNING surrogate`, [req.user.tenant_id, subjectKey,
            createHmac('sha256', config.jwtSecret).update(`dpdp-erasure:${req.user.tenant_id}:${norm}`).digest('hex').slice(0, 24),
            JSON.stringify(encryptValue({ subject: norm }, req.user.tenant_id)), req.user.email]);
        const surrogate = journal.rows[0].surrogate;
        const scrub = (v) => {
          if (typeof v === 'string') return v.replace(/(\+?\d[\d\s\-()–]{7,}\d)/g, (m) => (m.replace(/\D/g, '') === digits ? surrogate : m));
          if (Array.isArray(v)) return v.map(scrub);
          if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)]));
          return v;
        };

        const gr = await c.query(
          `UPDATE app.guardians SET phone=$3, name='[erased:'||id||']'
           WHERE tenant_id=$1 AND regexp_replace(phone, '[^0-9]', '', 'g') = regexp_replace($2, '[^0-9]', '', 'g')`,
          [req.user.tenant_id, norm, surrogate]);
        const commsRows = (await c.query(
          `SELECT id, audience_json FROM app.communications
           WHERE tenant_id=$1 AND regexp_replace(audience_json::text, '[^0-9]', '', 'g') LIKE '%' || $2 || '%'`,
          [req.user.tenant_id, digits])).rows;
        for (const row of commsRows) {
          await c.query(`UPDATE app.communications SET audience_json=$3::jsonb WHERE id=$1 AND tenant_id=$2`,
            [row.id, req.user.tenant_id, JSON.stringify(scrub(row.audience_json))]);
        }
        let webhookPayloadsScrubbed = 0;
        for (const [schema, table] of [['plugin_razorpay', 'webhook_log'], ['plugin_razorpay', 'order_log'], ['plugin_upi', 'webhook_log']]) {
          const hit = await c.query(
            `SELECT id, payload FROM ${schema}.${table}
             WHERE tenant_id=$1 AND regexp_replace(payload::text, '[^0-9]', '', 'g') LIKE '%' || $2 || '%'`,
            [req.user.tenant_id, digits]).catch(() => ({ rows: [] })); // table absent → skip
          for (const row of hit.rows) {
            await c.query(`UPDATE ${schema}.${table} SET payload=$3::jsonb WHERE id=$1 AND tenant_id=$2`,
              [row.id, req.user.tenant_id, JSON.stringify(scrub(row.payload))]);
            webhookPayloadsScrubbed++;
          }
        }
        const po = await kernel.sysq(
          `DELETE FROM plugin_visitors.pickup_otp
           WHERE tenant_id=$1 AND regexp_replace(phone, '[^0-9]', '', 'g') = regexp_replace($2, '[^0-9]', '', 'g')`,
          [req.user.tenant_id, norm]);
        const lo = await kernel.sysq(
          `DELETE FROM app.auth_otps
           WHERE tenant_id=$1 AND regexp_replace(phone, '[^0-9]', '', 'g') = regexp_replace($2, '[^0-9]', '', 'g')`,
          [req.user.tenant_id, norm]);
        const vp = await c.query(
          `UPDATE plugin_visitors.visit SET visitor_phone=NULL
           WHERE tenant_id=$1 AND regexp_replace(visitor_phone, '[^0-9]', '', 'g') = regexp_replace($2, '[^0-9]', '', 'g')`,
          [req.user.tenant_id, norm]);
        const sr = await c.query(
          `UPDATE plugin_dpdp.sar SET subject_ref=$3
           WHERE tenant_id=$1 AND regexp_replace(subject_ref, '[^0-9]', '', 'g') = regexp_replace($2, '[^0-9]', '', 'g')`,
          [req.user.tenant_id, norm, surrogate]);

        // Office lane: the denormalised guardian PII on app.students. The pack requests the
        // kernel-executed core-lane action — the SQL lives in src/core-lane-actions.js and
        // runs on THIS request's tenant-scoped client, so tenancy is proven by the RLS policy
        // on app.students and the redaction joins this transaction (the journal counts below
        // describe one atomic erasure). The kernel writes the audit row for it in the same
        // transaction. A second erasure for the same subject finds guardian_phone already
        // NULL → 0, matching the other surfaces' second-pass behaviour.
        const core = await kernel.requestCoreLaneAction(c, {
          action: 'students.redactGuardianPii',
          tenantId: req.user.tenant_id,
          actor: req.user.email, actorRole: `plugin:${ID}`,
          caseRef: sar.id,
          params: { subjectRef: norm },
        });

        await kernel.sysq(
          `UPDATE plugin_dpdp.erasure_journal SET surfaces=$2::jsonb
           WHERE tenant_id=$1 AND subject_key=$3`,
          [req.user.tenant_id, JSON.stringify({
            guardiansRedacted: gr.rowCount, commsRecipientsHashed: commsRows.length,
            webhookPayloadsScrubbed, pickupOtpPurged: po.rowCount, loginOtpPurged: lo.rowCount,
            visitorPhonesRedacted: vp.rowCount, sarRefsSurrogated: sr.rowCount,
            studentsGuardianPiiRedacted: core.affected,
          }), subjectKey]);

        bundle = { subjectRef: surrogate, erasedAt: new Date().toISOString(),
          consentRowsRedacted: cr.rowCount, admissionsLeadsRedacted: lr.rowCount,
          decisionTrailPreserved: true,
          surfaces: {
            guardiansRedacted: gr.rowCount,
            commsRecipientsHashed: commsRows.length,
            webhookPayloadsScrubbed,
            pickupOtpPurged: po.rowCount,
            loginOtpPurged: lo.rowCount,
            visitorPhonesRedacted: vp.rowCount,
            sarRefsSurrogated: sr.rowCount,
            studentsGuardianPiiRedacted: core.affected,
          },
          officeLane: { action: core.action, requestedBy: `plugin:${ID}`, executedBy: 'kernel', coreLaneAuditId: core.auditId },
          scopeNote: 'identity redacted across consent ledger, admissions funnel, guardians, comms recipients, gateway payloads, OTP vaults and the SAR trail itself (keyed surrogate); decision trail preserved. Office lane: the denormalised guardian PII on the student row is erased by the kernel-executed core-lane action students.redactGuardianPii (guardian_phone → NULL, guardian_name → [erased:<id>]) — the pack holds no SQL against app.students. Login identities (app.users) remain office-lane (kernel referral); hash-chained audit rows redact via the post-run audit_redact rebase.' };
      }
      await c.query(`UPDATE plugin_dpdp.sar SET status='fulfilled', fulfilled_at=now(), bundle=$2::jsonb WHERE id=$1`,
        [sar.id, JSON.stringify(bundle)]);
      await emitEvent(c, req.user.tenant_id,
        { type: 'dpdp', label: `SAR ${sar.kind} fulfilled`, ref: sar.id },
        'sar.fulfilled.v1', { sarId: sar.id, kind: sar.kind, actionId: sar.action_id });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: `SAR ${sar.kind} executed (kernel-approved)`, recordType: 'SAR', recordRef: sar.id,
        reason: 'data-principal request fulfilment', policyRef: 'DPDP Act 2023 · SAR', risk: sar.kind === 'erasure' ? 'high' : 'medium',
        outcome: sar.kind === 'export' ? 'bundle generated' : `erasure: ${bundle.consentRowsRedacted} consent rows + ${bundle.admissionsLeadsRedacted} leads redacted, decision trail preserved · office lane: ${bundle.surfaces.studentsGuardianPiiRedacted} student row(s) redacted by the kernel core-lane action` });
      return { ok: true, sarId: sar.id, status: 'fulfilled', bundle };
    });
  });
}
