// pack.cbse — runtime module (migration 009 registry/contract + 026 ledger; wave-3
// policy pair). Class C policy pack: RULES, NOT CODE.
//   · deterministic_only   — every rule is a pure function of stored inputs; the same
//     exam always yields the same decisions and the same validation digest.
//   · adds_obligations_never_relaxes_safeguards — R4 enforces the CBSE attendance norm
//     (≥75%) ON TOP of exams.assessment's eligibility floor; nothing here loosens a
//     kernel safeguard.
//   · weightage_total_enforced — R1; on FAIL the pack raises the kernel approval action
//     mandated by the 009 contract (guard weightage_total <> 100) under a per-exam code
//     (app.actions is UNIQUE (tenant_id, code) — decided obligations stay decided), and
//     emits cbse.obligation.due.v1.
//   · no_own_writes — the pack holds NO data plane; validation and export are computed
//     on demand and audited through the kernel ledger (validation: full; export:
//     digest+content_hash, tally.voucher.export precedent). Exports require the board
//     identity (affiliation_no + academic_year) and a PUBLISHED exam — the pack never
//     fabricates board data and never surfaces anything pre-approval.
import { createHash } from 'node:crypto';
import { makeLifecycleGate } from '../_shared/lifecycle-gate.js';
import { uuidParams } from '../_shared/uuid-param.js'; // L2 repair: S0's H5 routes use it; the import was missed

const ID = 'pack.cbse';
const CBSE_TIER = ['owner', 'principal', 'itadmin', 'coordinator'];

// CBSE 10-point scale (mirror of exams.assessment's assembly — the pack re-derives, it
// never trusts: R5 recomputes the grade from the stored pct and compares)
const CBSE_10 = [
  [91, 'A1', 10], [81, 'A2', 9], [71, 'B1', 8], [61, 'B2', 7],
  [51, 'C1', 6], [41, 'C2', 5], [33, 'D', 4], [0, 'E', 0],
];
const gradeOf = (pct) => {
  const row = CBSE_10.find(([min]) => pct >= min);
  return { grade: row[1], points: row[2] };
};
const canonical = (obj) => JSON.stringify(obj, Object.keys(obj).sort());

const RULES = [
  { id: 'R1', title: 'weightage_total', policy: 'CBSE pack obligations', detail: 'Assessment component weightages sum to exactly 100.' },
  { id: 'R2', title: 'grade_scale', policy: 'CBSE pack obligations', detail: 'Grade scale is CBSE 10-point (or a board-sanctioned alternative) with valid boundaries.' },
  { id: 'R3', title: 'marks_bounds', policy: 'CBSE pack obligations', detail: 'Every recorded mark satisfies 0 ≤ marks ≤ max_marks.' },
  { id: 'R4', title: 'eligibility_floor', policy: 'CBSE pack obligations · board attendance norm', detail: 'Exam eligibility floor ≥ 75% attendance (CBSE norm). The pack may raise the floor, never lower it.' },
  { id: 'R5', title: 'report_integrity', policy: 'CBSE pack obligations', detail: 'Published reports carry digests; stored grades match deterministic recomputation from pct.' },
  { id: 'R6', title: 'board_identity', policy: 'CBSE pack obligations · OASIS', detail: 'Affiliation number and academic year configured — prerequisite for any board export.' },
];

export function register(app, kernel) {
  const { withUser, requestAudit, emitEvent, require, sysq } = kernel;
  const lifecycleGate = makeLifecycleGate(kernel.sysq, ID);
  const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });

  const loadSettings = async (c, tenantId) => {
    const s = (await c.query(`SELECT settings FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`, [tenantId, ID])).rows[0]?.settings ?? {};
    return {
      affiliation: s.affiliation_no ?? null,
      academicYear: s.academic_year ?? null,
      board: s.board ?? 'CBSE',
      template: s.report_card_template ?? 'cbse_secondary',
      strict: s.weightage_strict !== false,
    };
  };

  // ── rule catalog (transparency surface; deterministic) ───────────────────────
  app.get(`/plugins/${ID}/rules`, { preHandler: [require(...CBSE_TIER), lifecycleGate] }, async (req) => {
    return { pack: ID, version: '1.0.0', kind: 'policy', board: 'CBSE', rules: RULES };
  });

  // ── validate an exam (cross-plugin read over plugin_exams; no writes) ────────
  app.get(`/plugins/${ID}/validate/exam/:examId`, { preHandler: [require(...CBSE_TIER), uuidParams('examId'), lifecycleGate] }, async (req, reply) => { // S0 fix H5 (L2 repair: the trailing comment had swallowed the handler signature)
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const e = (await c.query(`SELECT id, name, term, class_grade, status, weightage, eligibility_min_pct, digest, published_snapshot
                                FROM plugin_exams.exam WHERE id=$1 AND tenant_id=$2`,
        [req.params.examId, req.user.tenant_id])).rows[0];
      if (!e) return bad(reply, 'exam not found', 404);
      const settings = await loadSettings(c, req.user.tenant_id);
      const marks = (await c.query(`SELECT student_id, component, marks, max_marks FROM plugin_exams.mark WHERE exam_id=$1 AND tenant_id=$2`,
        [e.id, req.user.tenant_id])).rows;
      const reports = (await c.query(`SELECT student_id, snapshot, digest FROM plugin_exams.report WHERE exam_id=$1 AND tenant_id=$2`,
        [e.id, req.user.tenant_id])).rows;
      const w = e.weightage ?? {};
      const total = Object.values(w).reduce((a, b) => a + Number(b || 0), 0);
      const decisions = [];
      // R1 — weightage_total (009 contract guard: weightage_total <> 100)
      decisions.push({
        id: 'R1', title: 'weightage_total',
        decision: Math.round(total) === 100 ? 'pass' : 'fail',
        detail: `weightage sums to ${total} across ${Object.keys(w).length} component(s)`,
      });
      // R2 — grade_scale
      const gs = (await sysq(`SELECT settings->>'gradeScale' AS gs FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`, [req.user.tenant_id, 'exams.assessment'])).rows[0]?.gs ?? 'cbse_10_point';
      decisions.push({
        id: 'R2', title: 'grade_scale',
        decision: ['cbse_10_point', 'percent', 'gpa_4'].includes(gs) ? 'pass' : 'warn',
        detail: `assembly scale: ${gs}`,
      });
      // R3 — marks_bounds (local named boundsFail — a `const bad` here would
      // shadow the reply helper for the whole block → TDZ ReferenceError at the 404)
      const boundsFail = marks.filter((m) => Number(m.marks) < 0 || Number(m.marks) > Number(m.max_marks));
      decisions.push({
        id: 'R3', title: 'marks_bounds',
        decision: boundsFail.length === 0 ? 'pass' : 'fail',
        detail: boundsFail.length === 0 ? `${marks.length} mark row(s) within bounds` : `${boundsFail.length} out-of-bounds row(s)`,
      });
      // R4 — eligibility_floor (adds obligations: the pack FLOORS the board norm)
      const floor = Number(e.eligibility_min_pct ?? 75);
      decisions.push({
        id: 'R4', title: 'eligibility_floor',
        decision: floor >= 75 ? 'pass' : 'fail',
        detail: `exam floor ${floor}% vs board norm 75%`,
      });
      // R5 — report_integrity (published exams: digests present, grades re-derived)
      if (e.status === 'published') {
        const mismatched = reports.filter((r) => r.snapshot?.pct != null && gradeOf(Number(r.snapshot.pct)).grade !== r.snapshot?.grade);
        decisions.push({
          id: 'R5', title: 'report_integrity',
          decision: e.digest && reports.length > 0 && mismatched.length === 0 ? 'pass' : 'fail',
          detail: `${reports.length} report(s); exam digest present: ${!!e.digest}; grade mismatches: ${mismatched.length}`,
        });
      } else {
        decisions.push({ id: 'R5', title: 'report_integrity', decision: 'warn', detail: 'exam not published — report integrity pending' });
      }
      // R6 — board_identity
      decisions.push({
        id: 'R6', title: 'board_identity',
        decision: settings.affiliation && settings.academicYear ? 'pass' : 'warn',
        detail: settings.affiliation ? `affiliation ${settings.affiliation}, AY ${settings.academicYear}` : 'affiliation_no / academic_year not configured (required before export)',
      });
      const digest = createHash('sha256').update(canonical(decisions)).digest('hex');
      // kernel obligation: the 009 contract's action.raise side effect, per-exam code
      let obligation = null;
      if (decisions.find((d) => d.id === 'R1')?.decision === 'fail') {
        const code = `cbse.weightage.${e.id}`;
        const existing = (await sysq(`SELECT id, status FROM app.actions WHERE tenant_id=$1 AND code=$2`, [req.user.tenant_id, code])).rows[0];
        if (existing && existing.status === 'open') {
          obligation = { actionId: existing.id, reused: true };
        } else if (!existing) {
          const act = await sysq(
            `INSERT INTO app.actions (tenant_id, code, kind, title, detail, why, priority, status, owner, owner_role, policy_ref, ai_involved, source_event, payload, source_plugin)
             VALUES ($1,$2,'approval',$3,$4,$5,'high','open','Principal','principal','CBSE pack obligations',false,'cbse.obligation.due.v1',$6::jsonb,'pack.cbse') RETURNING id`,
            [req.user.tenant_id, code, `CBSE obligation: assessment weightage invalid (${e.name})`,
              `Rule R1 FAIL: weightage sums to ${total}, not 100. Bring the assessment plan into board compliance.`,
              'The pack raises obligations, never relaxes safeguards; publication of a non-compliant assessment must not proceed.',
              JSON.stringify({ examId: e.id, rule: 'R1', weightage: w, validationDigest: digest, proposed_by: req.user.id, proposed_by_role: req.user.role })]);
          obligation = { actionId: act.rows[0].id, raised: true };
        }
        await emitEvent(c, req.user.tenant_id,
          { type: 'cbse', label: `obligation due: weightage_total (${e.name})`, ref: e.id },
          'cbse.obligation.due.v1', { examId: e.id, rule: 'R1', total, validationDigest: digest });
      }
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: 'assessment validated (CBSE pack)', recordType: 'Exam', recordRef: e.id,
        reason: 'board compliance validation', policyRef: 'CBSE pack obligations', risk: 'low',
        outcome: decisions.map((d) => `${d.id}:${d.decision}`).join(' ') + ` · inputs_digest ${digest.slice(0, 12)}…` });
      return { examId: e.id, name: e.name, status: e.status, rules: decisions, digest,
        counts: { pass: decisions.filter((d) => d.decision === 'pass').length,
          fail: decisions.filter((d) => d.decision === 'fail').length,
          warn: decisions.filter((d) => d.decision === 'warn').length }, obligation };
    });
  });

  // ── OASIS-ready export (published exams only; stateless, digest-audited) ─────
  app.get(`/plugins/${ID}/export/oasis/:examId`, { preHandler: [require(...CBSE_TIER), uuidParams('examId'), lifecycleGate] }, async (req, reply) => { // S0 fix H5 (L2 repair: the trailing comment had swallowed the handler signature)
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const settings = await loadSettings(c, req.user.tenant_id);
      if (!settings.affiliation || !settings.academicYear) {
        return reply.code(409).send({ error: 'Set the board affiliation number and academic year before exporting', rule: 'R6' });
      }
      const e = (await c.query(`SELECT id, name, term, class_grade, status, digest, published_at FROM plugin_exams.exam WHERE id=$1 AND tenant_id=$2`,
        [req.params.examId, req.user.tenant_id])).rows[0];
      if (!e) return bad(reply, 'exam not found', 404);
      if (e.status !== 'published') return bad(reply, 'Publish this exam first — reports only exist after publication', 409);
      const rows = (await c.query(
        `SELECT r.student_id, r.snapshot, r.digest, s.admission_no, s.name, s.grade
         FROM plugin_exams.report r JOIN app.students s ON s.id = r.student_id AND s.tenant_id = r.tenant_id
         WHERE r.exam_id=$1 AND r.tenant_id=$2 ORDER BY s.admission_no`,
        [e.id, req.user.tenant_id])).rows;
      const candidates = rows.map((r) => ({
        enrollment: r.admission_no, studentName: r.name ?? '',
        class: r.grade, pct: r.snapshot?.pct, grade: r.snapshot?.grade, points: r.snapshot?.points,
        reportDigest: r.digest,
      }));
      /* S0 fix H6: JSON.stringify is not CSV escaping; quote-on-need with "" and a
     ' prefix on formula-leading cells (=,+,-,@,tab) keeps Excel honest. */
  const cell = (v) => { const s = String(v ?? ''); const q = /[",\n]/.test(s) ? `\"${s.replace(/\"/g, '\"\"')}\"` : s; return /^[=+\-@\t\r]/.test(s) ? `'${q}` : q; };
  const header = [
        `BOARD,${settings.board}`,
        `AFFILIATION_NO,${settings.affiliation}`,
        `ACADEMIC_YEAR,${settings.academicYear}`,
        `TEMPLATE,${settings.template}`,
        `EXAM,${e.name}`,
        `TERM,${e.term}`,
        `CLASS,${e.class_grade}`,
        `EXAM_DIGEST,${e.digest ?? ''}`,
        `CANDIDATES,${candidates.length}`,
      ].join('\n');
      const body = ['ENROLLMENT,STUDENT_NAME,CLASS,PCT,GRADE,POINTS,REPORT_DIGEST',
        ...candidates.map((k) => [k.enrollment, cell(k.studentName), cell(k.class), k.pct, cell(k.grade), k.points ?? '', k.reportDigest].join(','))].join('\n'); // S0 fix H6: proper CSV cell escaping + formula neutralization
      const csv = `${header}\n${body}\n`;
      const contentHash = createHash('sha256').update(csv).digest('hex');
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: 'OASIS export generated', recordType: 'Exam', recordRef: e.id,
        reason: 'board submission', policyRef: 'CBSE pack obligations · OASIS', risk: 'medium',
        outcome: `candidates=${candidates.length} content_hash=${contentHash.slice(0, 16)}…` });
      return { format: 'oasis_v1', board: settings.board, affiliation: settings.affiliation,
        academicYear: settings.academicYear, template: settings.template, exam: { id: e.id, name: e.name, term: e.term, digest: e.digest },
        candidates, csv, contentHash };
    });
  });
}
