// exams.assessment — runtime module (migrations 014 + 025, wave-3 builds). Class D.
// Locked contract invariants, encoded:
//   · deterministic_only — report assembly is a pure function of marks+weightage; the
//     same inputs always yield the same snapshot + the same sha256 digest (pinned by test).
//   · weightage_total_enforced — component weightages must sum to exactly 100 (DB-checked
//     again at publish).
//   · approval_before_publish — publish raises an app.actions approval; the snapshot is
//     assembled and frozen ONLY on the execute path after kernel approval. Marks go
//     read-only (weightage_locked) at that moment. Nothing guardian-visible before.
//   · no_cross_tenant_marks — every table carries RLS keyed to the schoolos.tenant_id
//     GUC that withUser sets, ON TOP of WHERE-scoping (defense in depth, exam-grade data).
// Every marks write is audited (policy_ref CBSE pack obligations). All preHandlers async.
import { createHash } from 'node:crypto';
import { makeLifecycleGate } from '../_shared/lifecycle-gate.js';
import { uuidParams } from '../_shared/uuid-param.js';

const ID = 'exams.assessment';

// deterministic CBSE 10-point scale (pure function, no Date/random anywhere)
const CBSE_10 = [
  [91, 'A1', 10], [81, 'A2', 9], [71, 'B1', 8], [61, 'B2', 7],
  [51, 'C1', 6], [41, 'C2', 5], [33, 'D', 4], [0, 'E', 0],
];
const gradeOf = (pct, scale) => {
  if (scale === 'percent') return { grade: null, points: null, pct };
  if (scale === 'gpa_4') {
    const g = pct >= 90 ? 'A' : pct >= 80 ? 'B' : pct >= 70 ? 'C' : pct >= 60 ? 'D' : 'F';
    return { grade: g, points: null, pct };
  }
  const row = CBSE_10.find(([min]) => pct >= min);
  return { grade: row[1], points: row[2], pct };
};

const canonical = (obj) => JSON.stringify(obj, Object.keys(obj).sort());

export function register(app, kernel) {
  const { withUser, requestAudit, emitEvent, require, q } = kernel;

  const EXAM_STAFF = ['owner', 'principal', 'itadmin', 'teacher', 'coordinator'];
  const EXAM_ADMIN = ['owner', 'principal', 'itadmin', 'coordinator']; // assessment coordinator administers exams
  const MOD_TIER = ['owner', 'principal', 'itadmin', 'coordinator']; // moderation decision tier (excludes teacher)
  const lifecycleGate = makeLifecycleGate(kernel.q, ID);
  const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });

  // ── create exam (draft) with weightage — invariant checked at once ───────────
  app.post(`/plugins/${ID}/exams`, { preHandler: [require(...EXAM_ADMIN), lifecycleGate] }, async (req, reply) => {
    const { name, term, classGrade, weightage } = req.body ?? {};
    if (!name || !classGrade) return bad(reply, 'name and classGrade are required');
    const w = weightage ?? { written: 100 };
    const total = Object.values(w).reduce((a, b) => a + Number(b || 0), 0);
    if (Math.round(total) !== 100) return bad(reply, `weightage_total_enforced: components must sum to exactly 100 (got ${total})`, 409);
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `INSERT INTO plugin_exams.exam (tenant_id, name, term, class_grade, weightage, created_by)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING id`,
        [req.user.tenant_id, String(name).slice(0, 120), String(term ?? 'term-1').slice(0, 40),
          String(classGrade).slice(0, 20), JSON.stringify(w), req.user.id]);
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: 'exam created (draft)', recordType: 'Exam', recordRef: r.rows[0].id,
        reason: 'assessment setup', policyRef: 'CBSE pack obligations', risk: 'low',
        outcome: `weightage ${JSON.stringify(w)} (total 100)` });
      return { ok: true, examId: r.rows[0].id, status: 'draft', weightage: w };
    });
  });

  // ── list exams (staff) ───────────────────────────────────────────────────────
  app.get(`/plugins/${ID}/exams`, { preHandler: [require(...EXAM_STAFF), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const rows = (await c.query(
        `SELECT id, name, term, class_grade, status, weightage, digest, published_at FROM plugin_exams.exam
         WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100`, [req.user.tenant_id])).rows;
      return { exams: rows.map((r) => ({ id: r.id, name: r.name, term: r.term, classGrade: r.class_grade,
        status: r.status, weightage: r.weightage, digest: r.digest, publishedAt: r.published_at })) };
    });
  });

  // ── marks entry (per-write audit; frozen once published) ─────────────────────
  app.post(`/plugins/${ID}/exams/:id/marks`, { preHandler: [require(...EXAM_STAFF), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    const { studentId, component, marks, maxMarks } = req.body ?? {};
    if (!studentId || marks == null) return bad(reply, 'studentId and marks are required');
    const m = Number(marks);
    if (!Number.isFinite(m) || m < 0) return bad(reply, 'marks must be a non-negative number');
    const mm = Number(maxMarks ?? 100);
    if (!Number.isFinite(mm) || mm <= 0) return bad(reply, 'maxMarks must be positive');
    if (m > mm) return bad(reply, `marks (${m}) exceed maxMarks (${mm})`, 409);
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const e = (await c.query(`SELECT id, status, class_grade FROM plugin_exams.exam WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!e) return bad(reply, 'exam not found', 404);
      if (e.status === 'published') return bad(reply, 'marks are frozen — exam published (read-only)', 409);
      const st = (await c.query(`SELECT id FROM app.students WHERE id=$1 AND tenant_id=$2`, [studentId, req.user.tenant_id])).rows[0];
      if (!st) return bad(reply, 'student not found', 404);
      // Eligibility consumes the attendance kernel primitive (014 contract). Late counts
      // as attended (late = showed up). Settings-driven floor, default 75.
      const minPct = Number((await q(
        `SELECT settings->>'minAttendancePct' AS p FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`,
        [req.user.tenant_id, ID])).rows[0]?.p ?? 75);
      const att = (await q(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE status IN ('present','late'))::int AS attended
         FROM app.attendance WHERE tenant_id=$1 AND student_id=$2`,
        [req.user.tenant_id, studentId])).rows[0];
      const pct = att.total > 0 ? Math.round((att.attended / att.total) * 1000) / 10 : 0;
      if (pct < minPct) {
        return reply.code(409).send({ error: `attendance ${pct}% is below the ${minPct}% floor — student not eligible to sit this exam`, attendancePct: pct, floor: minPct });
      }
      const comp = String(component ?? 'written').slice(0, 40);
      const r = await c.query(
        `INSERT INTO plugin_exams.mark (tenant_id, exam_id, student_id, component, marks, max_marks, entered_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (exam_id, student_id, component) DO UPDATE SET marks=$5, max_marks=$6, entered_by=$7, updated_at=now()
         RETURNING id`,
        [req.user.tenant_id, e.id, studentId, comp, m, mm, req.user.id]);
      await emitEvent(c, req.user.tenant_id,
        { type: 'exams', label: `marks updated (${comp}: ${m}/${mm})`, ref: r.rows[0].id },
        'exam.marks.updated.v1', { examId: e.id, studentId, component: comp });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: 'marks entered', recordType: 'Mark', recordRef: r.rows[0].id,
        reason: 'assessment', policyRef: 'CBSE pack obligations · marks are sensitive records', risk: 'medium',
        outcome: `${comp}: ${m}/${mm} (upsert)` });
      return { ok: true, markId: r.rows[0].id };
    });
  });

  // ── publish request → kernel approval action (nothing assembled yet) ─────────
  app.post(`/plugins/${ID}/exams/:id/publish`, { preHandler: [require(...EXAM_ADMIN), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const e = (await c.query(`SELECT id, name, class_grade, status, weightage FROM plugin_exams.exam WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!e) return bad(reply, 'exam not found', 404);
      if (e.status === 'published') return bad(reply, 'exam already published', 409);
      const total = Object.values(e.weightage ?? {}).reduce((a, b) => a + Number(b || 0), 0);
      if (Math.round(total) !== 100) return bad(reply, `weightage_total_enforced: sums to ${total}, not 100`, 409);
      // weightage freezes one weightage_lock_days window before publication (IST-first)
      if (e.weightage_locked) return bad(reply, 'weightage is frozen — inside the lock window', 409);
      // kernel action codes are UNIQUE per (tenant, code) — recurring operations scope the
      // code per instance (dpdp composes per-kind; here per-exam)
      const open = (await c.query(`SELECT id FROM app.actions WHERE tenant_id=$1 AND code=$2 AND status='open' LIMIT 1`,
        [req.user.tenant_id, `exams.publish.${e.id}`])).rows[0];
      if (open) return reply.code(409).send({ error: 'a publication approval is already open', actionId: open.id });
      const act = await c.query(
        `INSERT INTO app.actions (tenant_id, code, kind, title, detail, why, priority, status, owner, owner_role, policy_ref, ai_involved, source_event, payload)
         VALUES ($1,'exams.publish.'||$6::text,'approval',$2,$3,$4,'high','open','Principal','principal','Assessment publication',false,'exam.published.v1',$5::jsonb) RETURNING id`,
        [req.user.tenant_id, `Publish exam: ${e.name} (class ${e.class_grade})`,
          `Assemble deterministic report cards and freeze marks. Weightage: ${JSON.stringify(e.weightage)}.`,
          'Publication is approval-required before any guardian-visible surface; marks freeze read-only at publish.',
          JSON.stringify({ examId: e.id, proposed_by: req.user.id, proposed_by_role: req.user.role, weightage: e.weightage }),
          e.id]);
      await c.query(`UPDATE plugin_exams.exam SET action_id=$1, updated_at=now() WHERE id=$2`, [act.rows[0].id, e.id]);
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: 'publication requested', recordType: 'Exam', recordRef: e.id,
        reason: 'exam publication', policyRef: 'Assessment publication · approval_before_publish', risk: 'medium',
        outcome: `kernel approval action raised (${act.rows[0].id})` });
      return { ok: true, actionId: act.rows[0].id, status: 'pending_approval' };
    });
  });

  // ── execute APPROVED publication — deterministic assembly + freeze (SoD-guarded) ──
  app.post(`/plugins/${ID}/exams/:id/publish/execute`, { preHandler: [require(...EXAM_ADMIN), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const e = (await c.query(`SELECT * FROM plugin_exams.exam WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!e) return bad(reply, 'exam not found', 404);
      if (e.status === 'published') return bad(reply, 'exam already published', 409);
      if (!e.action_id) return bad(reply, 'no publication action raised for this exam', 409);
      const act = (await q(`SELECT status, payload FROM app.actions WHERE id=$1 AND tenant_id=$2`, [e.action_id, req.user.tenant_id])).rows[0];
      if (!act || act.status === 'open') return bad(reply, 'kernel approval required — decide the action first (/actions/:id/decide)', 409);
      if (act.status === 'dismissed') return bad(reply, 'publication approval dismissed', 409);
      if (act.payload?.proposed_by === req.user.id) {
        return reply.code(403).send({ error: 'proposer may not execute their own publication (segregation of duties)' });
      }
      // deterministic assembly: pure function of (marks, weightage, scale)
      const scale = (await q(`SELECT settings->>'grade_scale' AS gs FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`, [req.user.tenant_id, ID])).rows[0]?.gs ?? 'cbse_10_point';
      const marks = (await c.query(
        `SELECT student_id, component, marks, max_marks FROM plugin_exams.mark WHERE exam_id=$1 AND tenant_id=$2 ORDER BY student_id, component`,
        [e.id, req.user.tenant_id])).rows;
      const students = [...new Set(marks.map((m) => m.student_id))];
      const total = Object.values(e.weightage ?? {}).reduce((a, b) => a + Number(b || 0), 0);
      if (Math.round(total) !== 100) return bad(reply, `weightage_total_enforced: sums to ${total}`, 409);
      const reports = students.map((sid) => {
        const comps = {};
        for (const m of marks.filter((x) => x.student_id === sid)) comps[m.component] = (Number(m.marks) / Number(m.max_marks)) * 100;
        const w = e.weightage ?? {};
        const pct = Object.entries(w).reduce((acc, [k, wt]) => acc + (comps[k] != null ? comps[k] * Number(wt) / 100 : 0), 0);
        const snap = { studentId: sid, examId: e.id, components: comps, weightage: w, pct: Math.round(pct * 100) / 100, ...gradeOf(pct, scale) };
        return { studentId: sid, snapshot: snap, digest: createHash('sha256').update(canonical(snap)).digest('hex') };
      });
      const digest = createHash('sha256').update(canonical({ examId: e.id, weightage: e.weightage, reports: reports.map((r) => r.digest) })).digest('hex');
      for (const r of reports) {
        // plain INSERT: assembly is single-shot per exam (locked FOR UPDATE, status-gated),
        // reports are SELECT-only granted — a conflict here means tampering and fails loudly
        await c.query(
          `INSERT INTO plugin_exams.report (tenant_id, exam_id, student_id, snapshot, digest) VALUES ($1,$2,$3,$4::jsonb,$5)`,
          [req.user.tenant_id, e.id, r.studentId, JSON.stringify(r.snapshot), r.digest]);
      }
      await c.query(
        `UPDATE plugin_exams.exam SET status='published', weightage_locked=true, published_snapshot=$2::jsonb, digest=$3, published_at=now(), published_by=$4, updated_at=now() WHERE id=$1`,
        [e.id, JSON.stringify({ reports: reports.map((r) => r.snapshot) }), digest, req.user.email]);
      await emitEvent(c, req.user.tenant_id,
        { type: 'exams', label: `exam published: ${e.name} (${reports.length} reports)`, ref: e.id },
        'exam.published.v1', { examId: e.id, digest, reports: reports.length });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: 'exam published (kernel-approved)', recordType: 'Exam', recordRef: e.id,
        reason: 'publication execution', policyRef: 'Assessment publication · approval_before_publish', risk: 'high',
        outcome: `${reports.length} deterministic reports assembled, digest ${digest.slice(0, 12)}…, marks frozen` });
      return { ok: true, status: 'published', reports: reports.length, digest };
    });
  });

  // ── report card (post-publication; deterministic read) ───────────────────────
  app.get(`/plugins/${ID}/exams/:id/reports/:studentId`, { preHandler: [require(...EXAM_STAFF), uuidParams('id', 'studentId'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = (await c.query(
        `SELECT id, snapshot, digest, created_at FROM plugin_exams.report WHERE exam_id=$1 AND student_id=$2 AND tenant_id=$3`,
        [req.params.id, req.params.studentId, req.user.tenant_id])).rows[0];
      if (!r) return bad(reply, 'report not found (exam published?)', 404);
      // moderation overlay: latest approved moderation supersedes the frozen snapshot
      const mo = (await c.query(
        `SELECT adjusted_snapshot, decided_at FROM plugin_exams.moderation WHERE report_id=$1 AND status='approved' ORDER BY decided_at DESC LIMIT 1`,
        [r.id])).rows[0];
      if (mo?.adjusted_snapshot?.digest) {
        // P2-1 belt-and-braces: even a pre-hardening overlay cannot serve an absurd
        // grade — re-derive on the way out and state the served pct explicitly
        const snap = mo.adjusted_snapshot.snapshot ?? {};
        const scale = (await q(`SELECT settings->>'grade_scale' AS gs FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`, [req.user.tenant_id, ID])).rows[0]?.gs ?? 'cbse_10_point';
        const pct = Number(snap.pct);
        const served = Number.isFinite(pct) && pct >= 0 && pct <= 100 ? { ...snap, ...gradeOf(pct, scale) } : r.snapshot;
        return { report: served, digest: mo.adjusted_snapshot.digest, generatedAt: r.created_at,
          moderated: Number.isFinite(pct) && pct >= 0 && pct <= 100 };
      }
      return { report: r.snapshot, digest: r.digest, generatedAt: r.created_at };
    });
  });

  // ── moderation: senior review of an assembled report (post-publication only) ──
  // Propose: attaches a reason + proposed adjustment; decide: same-SoD as the kernel
  // spine — the proposer may not approve their own moderation. Marks stay untouched;
  // the report row's snapshot is replaced only on approval and the original digest is
  // preserved in the moderation record (audit chain).
  app.post(`/plugins/${ID}/exams/:id/reports/:studentId/moderate`, { preHandler: [require(...MOD_TIER), uuidParams('id', 'studentId'), lifecycleGate] }, async (req, reply) => {
    const { reason } = req.body ?? {};
    if (!reason || String(reason).trim().length < 4) return bad(reply, 'reason is required (min 4 chars)');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = (await c.query(`SELECT id, snapshot, digest FROM plugin_exams.report WHERE exam_id=$1 AND student_id=$2 AND tenant_id=$3`,
        [req.params.id, req.params.studentId, req.user.tenant_id])).rows[0];
      if (!r) return bad(reply, 'report not found (published exam?)', 404);
      const dup = (await c.query(`SELECT id FROM plugin_exams.moderation WHERE report_id=$1 AND status='proposed'`, [r.id])).rows[0];
      if (dup) return reply.code(409).send({ error: 'a moderation proposal is already open', moderationId: dup.id });
      const m = await c.query(
        `INSERT INTO plugin_exams.moderation (tenant_id, report_id, reason, proposed_by)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [req.user.tenant_id, r.id, String(reason).slice(0, 500), req.user.id]);
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: 'moderation proposed', recordType: 'Moderation', recordRef: m.rows[0].id,
        reason: 'report review', policyRef: 'CBSE pack obligations', risk: 'medium',
        outcome: `report digest ${String(r.digest).slice(0, 12)}… flagged: ${String(reason).slice(0, 80)}` });
      return { ok: true, moderationId: m.rows[0].id, status: 'proposed' };
    });
  });

  app.post(`/plugins/${ID}/moderations/:mid/decide`, { preHandler: [require(...MOD_TIER), uuidParams('mid'), lifecycleGate] }, async (req, reply) => {
    const { decision, note } = req.body ?? {};
    if (!['approved', 'rejected'].includes(decision)) return bad(reply, "decision must be 'approved' or 'rejected'");
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const m = (await c.query(`SELECT * FROM plugin_exams.moderation WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.mid, req.user.tenant_id])).rows[0];
      if (!m) return bad(reply, 'moderation not found', 404);
      const r = (await c.query(`SELECT id, digest FROM plugin_exams.report WHERE id=$1`, [m.report_id])).rows[0];
      if (!r) return bad(reply, 'underlying report not found', 404);
      if (m.status !== 'proposed') return bad(reply, `moderation already ${m.status}`, 409);
      if (m.proposed_by === req.user.id) {
        return reply.code(403).send({ error: 'proposer may not decide their own moderation (segregation of duties)' });
      }
      if (decision === 'approved') {
        // report rows stay IMMUTABLE (INSERT+SELECT grants only): the approved adjustment
        // lives as an overlay on the moderation record, self-describing with its own
        // digest; the read door serves latest-approved-overlay ?? original snapshot.
        // P2-1 (cycle 6): trust NOTHING stored — pct must be a finite number in [0,100]
        // (Number.isFinite, NOT truthiness: pct:0 is a legitimate adjustment), and the
        // grade/points are RE-DERIVED via this module's gradeOf on the exam's scale;
        // a hand-supplied grade can no longer reach the served report.
        const adj = req.body?.adjustedSnapshot;
        const scale = (await q(`SELECT settings->>'grade_scale' AS gs FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`, [req.user.tenant_id, ID])).rows[0]?.gs ?? 'cbse_10_point';
        const pct = Number(adj?.pct);
        if (!adj || typeof adj !== 'object' || !Number.isFinite(pct) || pct < 0 || pct > 100) {
          return bad(reply, 'adjustedSnapshot.pct must be a finite number in [0,100]');
        }
        const corrected = { ...adj, pct, ...gradeOf(pct, scale) };
        if (adj.grade != null && adj.grade !== corrected.grade) {
          return bad(reply, `grade mismatch: ${adj.grade} is not derivable from pct ${pct} on scale ${scale} (${corrected.grade})`);
        }
        const overlay = { snapshot: corrected, correctsReportId: m.report_id,
          originalDigest: r.digest,
          digest: createHash('sha256').update(canonical(corrected)).digest('hex') };
        await c.query(
          `UPDATE plugin_exams.moderation SET status='approved', adjusted_snapshot=$2::jsonb, decided_by=$3, decided_at=now(), updated_at=now() WHERE id=$1`,
          [m.id, JSON.stringify(overlay), req.user.email]);
      } else {
        await c.query(
          `UPDATE plugin_exams.moderation SET status='rejected', decided_by=$2, decided_at=now(), updated_at=now() WHERE id=$1`,
          [m.id, req.user.email]);
      }
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: `moderation ${decision}`, recordType: 'Moderation', recordRef: m.id,
        reason: note ?? 'report review decision', policyRef: 'CBSE pack obligations', risk: 'high',
        outcome: decision === 'approved' ? 'report snapshot replaced; original digest preserved in record' : 'report unchanged' });
      return { ok: true, status: decision };
    });
  });
}
