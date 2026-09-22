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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/* ── L3-3.1 per-board policy (lives in plugin settings at 'board_policy') ──────
   Shape: {board, scale, pass_pct, divisions:[{label, min_pct}]} — validated at the
   PUT door. gradeOf stays authoritative for grade/points; the policy adds the
   PASS decision and the division band on top. An absent policy ⇒ snapshots carry
   no pass/division keys (byte-identical to pre-policy assemblies). */
const POLICY_SCALES = ['cbse_10_point', 'gpa_4', 'percent'];
const readBoardPolicy = (raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const scale = POLICY_SCALES.includes(raw.scale) ? raw.scale : null;
  if (!scale) return null;
  const pass = Number(raw.pass_pct);
  return {
    board: String(raw.board ?? 'CBSE').slice(0, 40),
    scale,
    pass_pct: Number.isFinite(pass) && pass >= 0 && pass <= 100 ? Math.round(pass) : 33,
    divisions: Array.isArray(raw.divisions)
      ? raw.divisions.slice(0, 10).map((d) => ({ label: String(d?.label ?? '').slice(0, 20), min_pct: Number(d?.min_pct) }))
        .filter((d) => d.label && Number.isFinite(d.min_pct) && d.min_pct >= 0 && d.min_pct <= 100)
      : [],
  };
};
const policyOf = (pct, policy) => {
  const base = gradeOf(pct, policy.scale);
  const pass = pct >= (policy.pass_pct ?? 33);
  const div = [...(policy.divisions ?? [])].sort((a, b) => b.min_pct - a.min_pct).find((d) => pct >= d.min_pct);
  return { ...base, pass, division: div?.label ?? null };
};

/* ── L3-3.1 shared deterministic assembly ────────────────────────────────────────
   publish/execute and the recompute verifier MUST assemble identically or drift
   is an artifact of two implementations. This is the one assembly. */
const assembleReports = (e, marks, scale, policy) => {
  const students = [...new Set(marks.map((m) => m.student_id))];
  const reports = students.map((sid) => {
    const comps = {};
    for (const m of marks.filter((x) => x.student_id === sid)) comps[m.component] = (Number(m.marks) / Number(m.max_marks)) * 100;
    const w = e.weightage ?? {};
    const pct = Object.entries(w).reduce((acc, [k, wt]) => acc + (comps[k] != null ? comps[k] * Number(wt) / 100 : 0), 0);
    const rounded = Math.round(pct * 100) / 100;
    /* grade derives from the UNROUNDED pct exactly as the pre-refactor inline code
       did — byte-identical snapshots keep every stored digest valid. */
    const snap = { studentId: sid, examId: e.id, components: comps, weightage: w, pct: rounded,
      ...(policy ? policyOf(pct, policy) : gradeOf(pct, scale)) };
    return { studentId: sid, snapshot: snap, digest: createHash('sha256').update(canonical(snap)).digest('hex') };
  });
  return reports;
};

export function register(app, kernel) {
  const { withUser, requestAudit, emitEvent, require, sysq } = kernel;

  const EXAM_STAFF = ['owner', 'principal', 'itadmin', 'teacher', 'coordinator'];
  const EXAM_ADMIN = ['owner', 'principal', 'itadmin', 'coordinator']; // assessment coordinator administers exams
  const MOD_TIER = ['owner', 'principal', 'itadmin', 'coordinator']; // moderation decision tier (excludes teacher)
  const lifecycleGate = makeLifecycleGate(kernel.sysq, ID);
  const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });

  // ── create exam (draft) with weightage — invariant checked at once ───────────
  /* S0 fix F1: weightage must be a plain non-array object of FINITE non-negative
     numbers summing to EXACTLY 100 — negative components once drove pct negative
     and 500'd publish/assembly, and arrays silently scored every student 0. */
  const validWeightage = (w) => {
    if (!w || typeof w !== 'object' || Array.isArray(w)) return null;
    const keys = Object.keys(w);
    if (!keys.length || keys.length > 10 || keys.some((k) => typeof k !== 'string' || k.length > 40)) return null;
    let total = 0;
    for (const v of Object.values(w)) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return null;
      total += n;
    }
    return total === 100 ? w : null;
  };
  app.post(`/plugins/${ID}/exams`, { preHandler: [require(...EXAM_ADMIN), lifecycleGate] }, async (req, reply) => {
    const { name, term, classGrade, weightage } = req.body ?? {};
    if (!name || !classGrade) return bad(reply, 'Exam name and class are required');
    const w = validWeightage(weightage ?? { written: 100 });
    if (!w) return bad(reply, 'This exam\'s components must be non-negative numbers that add up to exactly 100%', 409);
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
    if (!studentId || marks == null) return bad(reply, 'Student and marks are required');
    // S0 fix F2: body-supplied ids get the same format guard as route params —
    // a malformed id otherwise hits the uuid cast and 500s instead of 404.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(studentId))) return bad(reply, 'That student reference is not a valid id');
    const m = Number(marks);
    if (!Number.isFinite(m) || m < 0) return bad(reply, 'Marks can\'t be negative');
    const mm = Number(maxMarks ?? 100);
    if (!Number.isFinite(mm) || mm <= 0) return bad(reply, 'Maximum marks must be a positive number');
    if (m > mm) return bad(reply, `Marks (${m}) can\'t be more than the maximum (${mm})`, 409);
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const e = (await c.query(`SELECT id, status, class_grade FROM plugin_exams.exam WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!e) return bad(reply, 'We couldn\'t find that exam', 404);
      if (e.status === 'published') return bad(reply, 'Marks are locked — this exam is already published', 409);
      const st = (await c.query(`SELECT id FROM app.students WHERE id=$1 AND tenant_id=$2`, [studentId, req.user.tenant_id])).rows[0];
      if (!st) return bad(reply, 'student not found', 404);
      // Eligibility consumes the attendance kernel primitive (014 contract). Late counts
      // as attended (late = showed up). Settings-driven floor, default 75.
      const minPct = await (async () => { const p = Number((await sysq(
        `SELECT settings->>'minAttendancePct' AS p FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`,
        [req.user.tenant_id, ID])).rows[0]?.p); return Number.isFinite(p) && p > 0 ? p : 75; })(); // S0 fix F9: NaN floor = no floor (L2 repair: async IIFE for the await)
      const att = (await sysq(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE status IN ('present','late'))::int AS attended
         FROM app.attendance WHERE tenant_id=$1 AND student_id=$2`,
        [req.user.tenant_id, studentId])).rows[0];
      const pct = att.total > 0 ? Math.round((att.attended / att.total) * 1000) / 10 : 0;
      if (pct < minPct) {
        return reply.code(409).send({ error: `Attendance is ${pct}%, below the ${minPct}% floor — this student can\'t sit this exam`, attendancePct: pct, floor: minPct });
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
      if (!e) return bad(reply, 'We couldn\'t find that exam', 404);
      if (e.status === 'published') return bad(reply, 'This exam is already published', 409);
      if (!validWeightage(e.weightage)) return bad(reply, 'Marks must add up to exactly 100% — fix the exam\'s components first', 409);
      // PLGX: the `weightage_locked` guard was DEAD — the flag is only ever set true by the publication
      // UPDATE below, and `status === 'published'` (checked above) already catches that state. A guard
      // that can never fire reads as protection that does not exist. Removed; the published check is the
      // real gate.
      // kernel action codes are UNIQUE per (tenant, code) — recurring operations scope the
      // code per instance (dpdp composes per-kind; here per-exam)
      const open = (await c.query(`SELECT id FROM app.actions WHERE tenant_id=$1 AND code=$2 AND status='open' LIMIT 1`,
        [req.user.tenant_id, `exams.publish.${e.id}`])).rows[0];
      if (open) return reply.code(409).send({ error: 'A publication approval is already waiting', actionId: open.id });
      const act = await c.query(
        `INSERT INTO app.actions (tenant_id, code, kind, title, detail, why, priority, status, owner, owner_role, policy_ref, ai_involved, source_event, payload, source_plugin)
         VALUES ($1,'exams.publish.'||$6::text,'approval',$2,$3,$4,'high','open','Principal','principal','Assessment publication',false,'exam.published.v1',$5::jsonb,'exams.assessment') RETURNING id`,
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
      if (!e) return bad(reply, 'We couldn\'t find that exam', 404);
      if (e.status === 'published') return bad(reply, 'This exam is already published', 409);
      if (!e.action_id) return bad(reply, 'Publish it first — no approval was raised for this exam', 409);
      const act = (await sysq(`SELECT status, payload FROM app.actions WHERE id=$1 AND tenant_id=$2`, [e.action_id, req.user.tenant_id])).rows[0];
      if (!act || act.status === 'open') return bad(reply, 'This needs approval first — decide it in the Approvals queue', 409);
      if (act.status === 'dismissed') return bad(reply, 'publication approval dismissed', 409);
      if (act.payload?.proposed_by === req.user.id) {
        return reply.code(403).send({ error: 'The person who raised this publication can\'t approve it — a second person must' });
      }
      // deterministic assembly: pure function of (marks, weightage, scale)
      const scale = (await sysq(`SELECT COALESCE(settings->>'gradeScale', settings->>'grade_scale') AS gs FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`, [req.user.tenant_id, ID])).rows[0]?.gs ?? 'cbse_10_point';
      const marks = (await c.query(
        `SELECT student_id, component, marks, max_marks FROM plugin_exams.mark WHERE exam_id=$1 AND tenant_id=$2 ORDER BY student_id, component`,
        [e.id, req.user.tenant_id])).rows;
      const total = Object.values(e.weightage ?? {}).reduce((a, b) => a + Number(b || 0), 0);
      if (Math.round(total) !== 100) return bad(reply, `Marks must add up to 100% — these add up to ${total}%`, 409);
      const pluginPolicy = readBoardPolicy((await sysq(`SELECT settings->'board_policy' AS bp FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`,
        [req.user.tenant_id, ID])).rows[0]?.bp);
      // F5: the PER-EXAM board policy (`POST /exams/:id/board-policy`, stored on the exam row) now takes
      // precedence over the plugin-level default; both feed the same deterministic assembly.
      const policy = (e.board_policy ? readBoardPolicy(e.board_policy) : null) ?? pluginPolicy;
      const reports = assembleReports(e, marks, scale, policy);
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
        const scale = (await sysq(`SELECT COALESCE(settings->>'gradeScale', settings->>'grade_scale') AS gs FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`, [req.user.tenant_id, ID])).rows[0]?.gs ?? 'cbse_10_point';
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
      if (dup) return reply.code(409).send({ error: 'A review proposal is already open for this report', moderationId: dup.id });
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
    if (!['approved', 'rejected'].includes(decision)) return bad(reply, "Decision must be approved or rejected");
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const m = (await c.query(`SELECT * FROM plugin_exams.moderation WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.mid, req.user.tenant_id])).rows[0];
      if (!m) return bad(reply, 'We couldn\'t find that review', 404);
      const r = (await c.query(`SELECT id, digest FROM plugin_exams.report WHERE id=$1`, [m.report_id])).rows[0];
      if (!r) return bad(reply, 'The original report is missing', 404);
      if (m.status !== 'proposed') return bad(reply, `This review is already ${m.status}`, 409);
      if (m.proposed_by === req.user.id) {
        return reply.code(403).send({ error: 'The person who proposed this review can\'t decide it — a second person must' });
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
        const scale = (await sysq(`SELECT COALESCE(settings->>'gradeScale', settings->>'grade_scale') AS gs FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`, [req.user.tenant_id, ID])).rows[0]?.gs ?? 'cbse_10_point';
        const pct = Number(adj?.pct);
        if (!adj || typeof adj !== 'object' || !Number.isFinite(pct) || pct < 0 || pct > 100) {
          return bad(reply, 'The adjusted percentage must be a number from 0 to 100');
        }
        const corrected = { ...adj, pct, ...gradeOf(pct, scale) };
        if (adj.grade != null && adj.grade !== corrected.grade) {
          return bad(reply, `${adj.grade} does not follow from ${pct}% on this scale (it works out to ${corrected.grade}) — grades are always recalculated`);
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

  // ══════════════════ L3-3.1 exam depth ═══════════════════════════════════════

  // ── bulk marks entry (one transaction, per-row failure collection) ──────────
  // Contract mirrors the CSV-import robustness law: one bad row NEVER aborts the
  // batch — shape/eligibility failures land in failed[] with the row's index and
  // a human reason; valid rows commit. The exam is locked FOR UPDATE for the
  // whole batch; a published exam refuses the batch outright (frozen marks).
  app.post(`/plugins/${ID}/exams/:id/marks/bulk`, { preHandler: [require(...EXAM_STAFF), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!rows || rows.length === 0) return bad(reply, 'Send rows: [{studentId, component?, marks, maxMarks?}]');
    if (rows.length > 300) return bad(reply, 'Up to 300 rows per batch — split the class list', 409);
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const e = (await c.query(`SELECT id, status, class_grade FROM plugin_exams.exam WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!e) return bad(reply, 'We couldn\'t find that exam', 404);
      if (e.status === 'published') return bad(reply, 'Marks are locked — this exam is already published', 409);
      // shape pass first: every row validated before anything is written
      const parsed = [];
      const failed = [];
      rows.forEach((row, i) => {
        const at = { row: i };
        const studentId = row?.studentId ?? row?.student_id;
        if (!studentId) { failed.push({ ...at, error: 'studentId is required' }); return; }
        // PLGX: a non-uuid studentId reached `= ANY($2::uuid[])` and 22P02'd the whole batch to a 500.
        if (!UUID_RE.test(String(studentId))) { failed.push({ ...at, studentId, error: 'studentId must be a uuid' }); return; }
        const m = Number(row.marks);
        if (!Number.isFinite(m) || m < 0) { failed.push({ ...at, studentId, error: 'marks must be a number from 0 up' }); return; }
        const mm = Number(row.maxMarks ?? row.max_marks ?? 100);
        if (!Number.isFinite(mm) || mm <= 0) { failed.push({ ...at, studentId, error: 'maxMarks must be a positive number' }); return; }
        if (m > mm) { failed.push({ ...at, studentId, error: `marks (${m}) can't be more than the maximum (${mm})` }); return; }
        parsed.push({ row: i, studentId, component: String(row.component ?? 'written').slice(0, 40), marks: m, maxMarks: mm });
      });
      // students exist? one round-trip for the whole batch
      const ids = [...new Set(parsed.map((p) => p.studentId))];
      const known = new Set((await c.query(
        `SELECT id FROM app.students WHERE tenant_id=$1 AND id = ANY($2::uuid[])`,
        [req.user.tenant_id, ids])).rows.map((r) => r.id));
      for (const p of parsed) if (!known.has(p.studentId)) {
        failed.push({ row: p.row, studentId: p.studentId, error: 'student not found' });
      }
      const eligible = parsed.filter((p) => known.has(p.studentId));
      // attendance eligibility — one grouped query for the distinct students
      const minPct = Number((await sysq(`SELECT COALESCE(settings->>'minAttendancePct', settings->>'min_attendance_pct', '75') AS p
        FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`, [req.user.tenant_id, ID])).rows[0]?.p ?? 75);
      if (eligible.length) {
        const att = (await sysq(
          `SELECT student_id,
                  count(*)::int AS total,
                  count(*) FILTER (WHERE status IN ('present','late'))::int AS attended
           FROM app.attendance WHERE tenant_id=$1 AND student_id = ANY($2::uuid[]) GROUP BY student_id`,
          [req.user.tenant_id, [...new Set(eligible.map((p) => p.studentId))]]));
        const pctBy = new Map(att.rows.map((r) => [r.student_id, r.total > 0 ? Math.round((r.attended / r.total) * 1000) / 10 : 0]));
        for (let i = eligible.length - 1; i >= 0; i--) {
          const p = eligible[i];
          const pct = pctBy.get(p.studentId) ?? 0;
          if (pct < minPct) {
            failed.push({ row: p.row, studentId: p.studentId, error: `Attendance is ${pct}%, below the ${minPct}% floor` });
            eligible.splice(i, 1);
          }
        }
      }
      // write pass: per-row SAVEPOINT — a row the DB itself rejects doesn't kill the batch
      let savedCount = 0;
      for (const p of eligible) {
        await c.query('SAVEPOINT bulk_row');
        try {
          await c.query(
            `INSERT INTO plugin_exams.mark (tenant_id, exam_id, student_id, component, marks, max_marks, entered_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (exam_id, student_id, component) DO UPDATE SET marks=$5, max_marks=$6, entered_by=$7, updated_at=now()`,
            [req.user.tenant_id, e.id, p.studentId, p.component, p.marks, p.maxMarks, req.user.id]);
          savedCount++;
        } catch (err) {
          await c.query('ROLLBACK TO SAVEPOINT bulk_row');
          failed.push({ row: p.row, studentId: p.studentId, error: String(err.code ?? 'write failed') });
        }
        await c.query('RELEASE SAVEPOINT bulk_row');
      }
      await emitEvent(c, req.user.tenant_id,
        { type: 'exams', label: `bulk marks: ${savedCount} saved, ${failed.length} rejected (class ${e.class_grade})`, ref: e.id },
        'exam.marks.bulk.v1', { examId: e.id, saved: savedCount, failed: failed.length, minAttendancePct: minPct });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: 'bulk marks entered', recordType: 'Exam', recordRef: e.id,
        reason: 'assessment batch entry', policyRef: 'CBSE pack obligations · marks are sensitive records', risk: 'medium',
        outcome: `${savedCount} saved · ${failed.length} rejected of ${rows.length} rows` });
      return { ok: true, saved: savedCount, failedRows: failed };
    });
  });

  // ── per-board policy (settings-carried; PUT validates the whole shape) ──────
  app.get(`/plugins/${ID}/board-policy`, { preHandler: [require(...EXAM_STAFF), lifecycleGate] }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const row = (await sysq(`SELECT settings->'board_policy' AS bp FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`,
        [req.user.tenant_id, ID])).rows[0];
      const policy = readBoardPolicy(row?.bp);
      if (policy) return { policy, custom: true };
      return { policy: { board: 'CBSE', scale: 'cbse_10_point', pass_pct: 33, divisions: [{ label: 'First', min_pct: 60 }, { label: 'Second', min_pct: 45 }, { label: 'Third', min_pct: 33 }] }, custom: false,
        note: 'Default board policy — save your own to change the pass mark, scale or divisions.' };
    });
  });

  app.put(`/plugins/${ID}/board-policy`, { preHandler: [require(...EXAM_ADMIN), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!POLICY_SCALES.includes(b.scale)) return bad(reply, `scale must be one of: ${POLICY_SCALES.join(', ')}`);
    const pass = Number(b.pass_pct);
    if (!Number.isFinite(pass) || pass < 0 || pass > 100) return bad(reply, 'pass_pct must be a number from 0 to 100');
    const board = typeof b.board === 'string' && b.board.trim() ? b.board.trim().slice(0, 40) : 'CBSE';
    let divisions = [];
    if (b.divisions != null) {
      if (!Array.isArray(b.divisions) || b.divisions.length > 10) return bad(reply, 'divisions must be a list of at most 10 bands');
      for (const d of b.divisions) {
        const min = Number(d?.min_pct);
        const label = String(d?.label ?? '').trim();
        if (!label || label.length > 20) return bad(reply, 'each division needs a label of up to 20 characters');
        if (!Number.isFinite(min) || min < 0 || min > 100) return bad(reply, 'each division needs min_pct from 0 to 100');
        divisions.push({ label, min_pct: Math.round(min) });
      }
    }
    const policy = { board, scale: b.scale, pass_pct: Math.round(pass), divisions };
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      await c.query(`UPDATE app.plugins SET settings = jsonb_set(settings, '{board_policy}', $2::jsonb, true), updated_at=now() WHERE tenant_id=$1 AND plugin_id=$3`,
        [req.user.tenant_id, JSON.stringify(policy), ID]);
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: 'board policy updated', recordType: 'Plugin', recordRef: ID,
        reason: 'assessment policy change', policyRef: 'CBSE pack obligations · board policy', risk: 'medium',
        outcome: `board ${board} · scale ${scaleLabel(policy.scale)} · pass ${policy.pass_pct}% · ${divisions.length} division bands (applies to future assemblies; existing reports keep their digest)` });
      return { ok: true, policy };
    });
  });

  // ── recompute verifier: re-assemble from frozen marks, report digest drift ──
  // Read-only on reports — it never "fixes" anything. Drift means the stored
  // snapshot no longer follows from the frozen marks + current policy: exactly
  // what an audit wants surfaced, never silently patched.
  app.post(`/plugins/${ID}/exams/:id/recompute`, { preHandler: [require(...MOD_TIER), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const e = (await c.query(`SELECT id, name, status, weightage FROM plugin_exams.exam WHERE id=$1 AND tenant_id=$2`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!e) return bad(reply, 'We couldn\'t find that exam', 404);
      if (e.status !== 'published') return bad(reply, 'Recompute verifies PUBLISHED reports — this exam has none yet', 409);
      const scale = (await sysq(`SELECT COALESCE(settings->>'gradeScale', settings->>'grade_scale', 'cbse_10_point') AS gs FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`, [req.user.tenant_id, ID])).rows[0]?.gs ?? 'cbse_10_point';
      const policy = readBoardPolicy((await sysq(`SELECT settings->'board_policy' AS bp FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`,
        [req.user.tenant_id, ID])).rows[0]?.bp);
      const marks = (await c.query(
        `SELECT student_id, component, marks, max_marks FROM plugin_exams.mark WHERE exam_id=$1 AND tenant_id=$2 ORDER BY student_id, component`,
        [e.id, req.user.tenant_id])).rows;
      const recomputed = assembleReports(e, marks, scale, policy);
      const stored = (await c.query(
        `SELECT r.student_id, r.snapshot, r.digest FROM plugin_exams.report r
         WHERE r.exam_id=$1 AND r.tenant_id=$2 ORDER BY r.student_id LIMIT 500`,
        [e.id, req.user.tenant_id])).rows;
      const bySid = new Map(recomputed.map((r) => [r.studentId, r]));
      const drifted = [];
      for (const r of stored) {
        const fresh = bySid.get(r.student_id);
        if (!fresh || fresh.digest !== r.digest) {
          drifted.push({ studentId: r.student_id, storedDigest: r.digest, recomputedDigest: fresh?.digest ?? null,
            storedPct: r.snapshot?.pct ?? null, recomputedPct: fresh?.snapshot?.pct ?? null });
        }
      }
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: 'report recompute verification', recordType: 'Exam', recordRef: e.id,
        reason: 'integrity verification', policyRef: 'deterministic_only · recompute', risk: 'low',
        outcome: `${stored.length} reports re-assembled · ${drifted.length} drifted${policy ? ' (board policy applied)' : ''}` });
      return { ok: true, examId: e.id, checked: stored.length, drifted, policyApplied: !!policy,
        note: drifted.length ? 'Drift does NOT auto-correct — review through the moderation flow.' : 'Every report follows from the frozen marks.' };
    });
  });

  // ── moderation queue (senior tier read; one place to see what's waiting) ────
  app.get(`/plugins/${ID}/moderations`, { preHandler: [require(...MOD_TIER), lifecycleGate] }, async (req) => {
    const status = ['proposed', 'approved', 'rejected', 'all'].includes(String(req.query?.status)) ? String(req.query.status) : 'proposed';
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const rows = (await c.query(
        `SELECT m.id, m.status, m.reason, m.created_at, m.decided_at, m.decided_by,
                r.student_id, r.digest AS report_digest,
                e.id AS exam_id, e.name AS exam_name, e.term, e.class_grade,
                s.name AS student_name, u.name AS proposed_by_name
         FROM plugin_exams.moderation m
         JOIN plugin_exams.report r ON r.id = m.report_id
         JOIN plugin_exams.exam e ON e.id = r.exam_id
         LEFT JOIN app.students s ON s.id = r.student_id
         LEFT JOIN app.users u ON u.id = m.proposed_by
         WHERE m.tenant_id=$1 AND ($2::text = 'all' OR m.status = $2::text)
         ORDER BY m.created_at DESC LIMIT 200`,
        [req.user.tenant_id, status])).rows;
      return { moderations: rows.map((r) => ({
        id: r.id, status: r.status, reason: r.reason, createdAt: r.created_at, decidedAt: r.decided_at, decidedBy: r.decided_by,
        report: { studentId: r.student_id, studentName: r.student_name, digest: r.report_digest },
        exam: { id: r.exam_id, name: r.exam_name, term: r.term, classGrade: r.class_grade },
        proposedBy: r.proposed_by_name ?? null,
      })) };
    });
  });
}

/* scale label for audit copy (L3-3.1) */
function scaleLabel(scale) {
  return scale === 'cbse_10_point' ? 'CBSE 10-point' : scale === 'gpa_4' ? 'GPA 4.0' : 'Percent';
}
