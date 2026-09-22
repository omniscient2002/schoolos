// teacher.copilot — runtime module (migration 033, TeacherOS lane TS-3, v0). Class C.
// V0 invariant — deterministic_only: NO external LLM is contacted anywhere in this
// module. /copilot/draft assembles clearly-labelled ai_draft templates from curriculum/
// homework/mastery data; /copilot/ask routes the question to the brief/curriculum/
// mastery data by keyword matching; /teacher/brief is a deterministic aggregation.
// Every ask/draft/brief call writes a copilot.call row (A2 budget ledger — teacher
// tier; tokens stay 0 until a governed model is wired in v1).
//
// A1 · curriculum is seeded, never teacher-typed: curriculum.node is app-role
//      READ-ONLY (migration/import path authors it); teachers only check off
//      coverage via /curriculum/progress, which is audited.
// A3 · mastery labels decay: evidence whose expires_at has passed stops counting.
//      If the persisted state's evidence basis has fully expired, the level slides
//      ONE step (secure→developing→needs_support, floored), confidence flips to
//      'low', and the decay is persisted exactly ONCE (idempotent — derived_from
//      .reason='evidence_expired' marks the already-decayed row; no double-sliding).
//      Fresh evidence recovers the label deterministically. Language is
//      "needs support", never "failing".
//
// Graceful degradation: the brief aggregates across sibling lanes (TS-1
// teacher.homework, TS-2 teacher.concern) that may not exist yet in this database.
// Every sibling read sits behind an information_schema existence probe (per request,
// inside the caller's RLS transaction) and a per-source try/catch — a missing
// neighbour is reported as {available:false} in the payload and said plainly in the
// brief sentences, never a 500. This plugin's OWN tables always answer.
import { makeLifecycleGate } from '../_shared/lifecycle-gate.js';
import { uuidParams } from '../_shared/uuid-param.js';

const ID = 'teacher.copilot';

// A2 budget class (plan §4): the teacher tier. Visible in /teacher/usage.
const BUDGET_CLASS = 'teacher_tier';
// per-user daily ask/draft cap — the visible budget governance hook (v0: generous,
// deterministic; every ask/draft response echoes {used, cap})
const DAILY_CAP = 200;

// A3 decay order: secure slides down to developing, developing to needs_support.
const LEVELS = ['needs_support', 'developing', 'secure'];
const LEVEL_STEP = Object.fromEntries(LEVELS.map((l, i) => [l, i]));
const LEVEL_LABEL = { needs_support: 'Needs support', developing: 'Developing', secure: 'Secure' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUBJECTS = ['Mathematics', 'Science'];

export function register(app, kernel) {
  const { withUser, requestAudit, require } = kernel;
  const lifecycleGate = makeLifecycleGate(kernel.sysq, ID);
  const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });

  // Insight doors (curriculum tree, mastery maps): the teacher lane + oversight.
  const STAFF = ['owner', 'principal', 'itadmin', 'coordinator', 'teacher'];
  // Copilot doors (brief/ask/draft/usage): the copilot is the TEACHER's assistant —
  // teacher-role-only (lane contract; coordinators/principals have their own desks).
  const TEACHER_ONLY = ['teacher'];

  // ── shared helpers ────────────────────────────────────────────────────────────
  // information_schema probe INSIDE the caller's RLS transaction (the app role can
  // read the catalogs). True only when a sibling-lane table actually exists.
  async function tableExists(c, schema, table) {
    const r = await c.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema=$1 AND table_name=$2 LIMIT 1`, [schema, table]);
    return r.rows.length > 0;
  }

  // Per-source safe read: a missing table or a sibling-lane schema surprise degrades
  // to {available:false} instead of failing the whole brief (lane law: build your own
  // tables only, never crash when neighbours are absent).
  async function safeRead(fn) {
    try { return await fn(); } catch {
      return { available: false };
    }
  }

  // IST clock (cycle-5 hygiene: date math on the Asia/Kolkata clock)
  const istNow = () => new Date(Date.now() + 5.5 * 3600 * 1000);
  const istDate = () => istNow().toISOString().slice(0, 10);

  // A2 budget ledger: one row per call, written INSIDE the caller's transaction.
  async function budgetCall(c, req, verb, sources) {
    await c.query(
      `INSERT INTO copilot.call (tenant_id, user_id, verb, budget_class, sources)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [req.user.tenant_id, req.user.id, verb, BUDGET_CLASS, JSON.stringify(sources)]);
  }

  async function budgetUsedToday(c, req) {
    const r = await c.query(
      `SELECT count(*)::int AS n FROM copilot.call
       WHERE user_id=$1 AND verb IN ('ask','draft') AND at > now() - interval '24 hours'`,
      [req.user.id]);
    return r.rows[0].n;
  }

  // ═══════════════════════════ CURRICULUM (A1) ═════════════════════════════════

  // GET /curriculum/tree?subject=&grade= — the seeded tree + coverage bars for the class.
  app.get('/curriculum/tree', { preHandler: [require(...STAFF), lifecycleGate] }, async (req, reply) => {
    const subject = req.query?.subject ? String(req.query.subject) : null;
    const grade = req.query?.grade ? String(req.query.grade) : null;
    if (!subject || !SUBJECTS.includes(subject)) return bad(reply, 'Please pick a subject: Mathematics or Science');
    if (!grade || !/^[0-9]{1,2}$/.test(grade)) return bad(reply, 'Please pick a class grade (e.g. 6, 7 or 8)');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const units = (await c.query(
        `SELECT id, name, order_no FROM curriculum.node
         WHERE subject=$1 AND grade=$2 AND kind='unit' ORDER BY order_no, name`,
        [subject, grade])).rows;
      const topics = (await c.query(
        `SELECT n.id, n.name, n.order_no, n.parent_id, p.covered_pct, p.covered_at
         FROM curriculum.node n
         LEFT JOIN curriculum.progress p ON p.node_id = n.id AND p.class_grade = $3
         WHERE n.subject=$1 AND n.grade=$2 AND n.kind='topic'
         ORDER BY n.parent_id, n.order_no, n.name`,
        [subject, grade, grade])).rows;
      const tree = units.map((u) => ({
        unitId: u.id, unit: u.name, orderNo: u.order_no,
        topics: topics.filter((t) => t.parent_id === u.id).map((t) => ({
          topicId: t.id, topic: t.name, orderNo: t.order_no,
          coveredPct: t.covered_pct ?? 0, covered: (t.covered_pct ?? 0) >= 100, coveredAt: t.covered_at ?? null,
        })),
      }));
      return { subject, grade, units: tree };
    });
  });

  // POST /curriculum/progress {node_id, class_grade, pct} — the ONE teacher curriculum
  // write; audited (A1: teachers check off coverage, they never author the tree).
  app.post('/curriculum/progress', { preHandler: [require(...STAFF), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.node_id || !UUID_RE.test(String(b.node_id))) return bad(reply, 'Please pick a curriculum topic');
    if (!b.class_grade || !/^[0-9]{1,2}$/.test(String(b.class_grade))) return bad(reply, 'Please pick the class this coverage applies to');
    const pct = Number(b.pct ?? 100);
    if (!Number.isInteger(pct) || pct < 0 || pct > 100) return bad(reply, 'Coverage is a whole number from 0 to 100');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const node = (await c.query(
        `SELECT id, subject, grade, kind, name FROM curriculum.node WHERE id=$1`,
        [b.node_id])).rows[0];
      if (!node) return bad(reply, 'We couldn\'t find that curriculum topic', 404);
      if (node.kind !== 'topic') return bad(reply, 'Coverage is ticked on topics — pick a topic, not a unit');
      const r = await c.query(
        `INSERT INTO curriculum.progress (tenant_id, node_id, class_grade, covered_pct, covered_by, evidence_ref)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (tenant_id, node_id, class_grade)
         DO UPDATE SET covered_pct=EXCLUDED.covered_pct, covered_by=EXCLUDED.covered_by,
           covered_at=now(), updated_at=now()
         RETURNING id, node_id, class_grade, covered_pct, covered_at`,
        [req.user.tenant_id, node.id, String(b.class_grade), pct, req.user.id,
          b.evidence ? String(b.evidence).slice(0, 200) : null]);
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Curriculum coverage updated', recordType: 'CurriculumProgress',
        recordRef: r.rows[0].id, reason: `topic check-off (${node.subject} class ${b.class_grade})`,
        policyRef: 'TeacherOS A1 (curriculum seeded, teachers check off progress)', risk: 'low',
        outcome: `${node.name} → ${pct}% for class ${b.class_grade}` });
      return { ok: true, progress: r.rows[0], topic: node.name, subject: node.subject };
    });
  });

  // ═══════════════════════════ MASTERY (A3 decay) ══════════════════════════════

  // Deterministic label from NON-EXPIRED evidence values (pure function).
  const levelFromValues = (values) => {
    if (values.length === 0) return { level: null, confidence: null, basis: 'no_evidence' };
    const avg = values.reduce((a, v) => a + Number(v), 0) / values.length;
    const level = avg >= 60 ? 'secure' : avg >= 40 ? 'developing' : 'needs_support';
    const n = values.length;
    const confidence = n >= 3 ? 'high' : n === 2 ? 'medium' : 'low';
    return { level, confidence, basis: 'evidence', n, avg: Math.round(avg * 10) / 10 };
  };

  // The A3 decay resolver for ONE (student, subject, node) cell — deterministic and
  // idempotent. Contract:
  //   · no evidence rows at all            → {level:null} (no label is persisted —
  //                                          A3 forbids evidence-free negative labels)
  //   · fresh evidence (expires_at IS NULL OR > now) → label = levelFromValues,
  //                                          persisted/refreshed (recovery after decay)
  //   · only expired evidence remains      → the persisted label slides ONE step down
  //                                          (floored at needs_support), confidence
  //                                          'low', persisted ONCE with
  //                                          derived_from.reason='evidence_expired';
  //                                          later reads are idempotent (no sliding)
  // Returns `{ level, confidence, basis, decayed, freshEvidence, expiredEvidence, recovered,
  //            change }` where `change` is null when this read changed NOTHING and otherwise
  //            describes the write that happened: { kind:'inserted'|'refreshed'|'decayed',
  //            stateId, fromLevel, toLevel, fromConfidence, toConfidence }.
  //
  // DAT-7 — this resolver writes mastery.state (INSERT / evidence-refresh UPDATE / one-shot
  // decay UPDATE) and both doors that call it are GETs the UI polls. Those writes were
  // unledgered: a teacher opening a mastery screen could move a student's persisted level with
  // no audit row. The fix follows the pattern already written down in the sibling
  // teacher.classroom leave projection (index.js lines ~305-315): the write's EFFECT is
  // reported rather than assumed, and the LEDGER row is written once per real state change.
  //
  // The audit is written by the DOORS, not here, and that placement is deliberate: the actor
  // must be the named member of staff whose read caused the write, and this helper has no
  // request/user context to name (it is also pure with respect to tenancy/identity today).
  // The helper's job is to say WHAT changed; each door's job is to say WHO did it. Both doors
  // go through the single `auditMasteryChange` reporter below, so neither can drift.
  async function resolveMasteryState(c, tenantId, studentId, subject, node) {
    const now = new Date();
    const fresh = (await c.query(
      `SELECT value FROM mastery.evidence
       WHERE student_id=$1 AND subject=$2 AND node_id=$3
         AND (expires_at IS NULL OR expires_at > $4)`,
      [studentId, subject, node.id, now])).rows;
    const derived = levelFromValues(fresh.map((f) => f.value));
    const st = (await c.query(
      `SELECT id, level, confidence, derived_from FROM mastery.state
       WHERE student_id=$1 AND subject=$2 AND node_id=$3`,
      [studentId, subject, node.id])).rows[0];

    if (!st) {
      if (derived.basis === 'no_evidence') {
        // nothing was written: no label is persisted without evidence (A3)
        return { level: null, confidence: null, basis: 'no_evidence', decayed: false,
          freshEvidence: 0, expiredEvidence: 0, change: null };
      }
      const ins = await c.query(
        `INSERT INTO mastery.state (tenant_id, student_id, subject, node_id, level, confidence, derived_from)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING id, level, confidence`,
        [tenantId, studentId, subject, node.id, derived.level, derived.confidence, JSON.stringify(derived)]);
      return { level: ins.rows[0].level, confidence: ins.rows[0].confidence, basis: 'evidence',
        decayed: false, freshEvidence: fresh.length, expiredEvidence: 0,
        change: { kind: 'inserted', stateId: ins.rows[0].id, fromLevel: null, toLevel: ins.rows[0].level,
          fromConfidence: null, toConfidence: ins.rows[0].confidence } };
    }

    const df = st.derived_from ?? {};
    if (derived.basis === 'evidence') {
      // fresh evidence governs; refresh when it moved, or when the row still carries a
      // decay marker (recovery rewrites derived_from to the clean evidence basis)
      let change = null;
      if (st.level !== derived.level || st.confidence !== derived.confidence || df.reason === 'evidence_expired') {
        const u = await c.query(
          `UPDATE mastery.state SET level=$2, confidence=$3, derived_from=$4::jsonb,
             computed_at=now(), updated_at=now() WHERE id=$1`,
          [st.id, derived.level, derived.confidence, JSON.stringify(derived)]);
        // rowCount is CHECKED, not assumed: the ledger records this as a change only when the
        // statement actually moved a row (the sibling leave-projection pattern).
        if (u.rowCount === 1) {
          change = { kind: 'refreshed', stateId: st.id, fromLevel: st.level, toLevel: derived.level,
            fromConfidence: st.confidence, toConfidence: derived.confidence };
        }
      }
      return { level: derived.level, confidence: derived.confidence, basis: 'evidence',
        decayed: false, freshEvidence: fresh.length, expiredEvidence: 0,
        recovered: df.reason === 'evidence_expired', change };
    }

    // no fresh evidence left
    if (df.reason === 'evidence_expired') {
      // already decayed once — idempotent, never slides twice; nothing is written, so
      // nothing is audited (the poll-driven no-change path must stay silent)
      return { level: st.level, confidence: st.confidence, basis: 'decayed', decayed: true,
        freshEvidence: 0, expiredEvidence: df.expired_count ?? null, change: null };
    }
    const expired = (await c.query(
      `SELECT count(*)::int AS n FROM mastery.evidence
       WHERE student_id=$1 AND subject=$2 AND node_id=$3 AND expires_at IS NOT NULL AND expires_at <= $4`,
      [studentId, subject, node.id, now])).rows[0].n;
    // LEVELS is ordered needs_support→developing→secure: sliding DOWN one step
    // (secure→developing, developing→needs_support, floored at the bottom) = idx − 1
    const idx = LEVEL_STEP[st.level] ?? 0;
    const down = LEVELS[Math.max(idx - 1, 0)];
    const du = await c.query(
      `UPDATE mastery.state SET level=$2, confidence='low',
         derived_from = derived_from || $3::jsonb, computed_at=now(), updated_at=now()
       WHERE id=$1`,
      [st.id, down, JSON.stringify({ reason: 'evidence_expired', from_level: st.level,
        to_level: down, expired_count: expired, decayed_at: new Date().toISOString() })]);
    return { level: down, confidence: 'low', basis: 'decayed', decayed: true,
      freshEvidence: 0, expiredEvidence: expired,
      change: du.rowCount === 1
        ? { kind: 'decayed', stateId: st.id, fromLevel: st.level, toLevel: down,
          fromConfidence: st.confidence, toConfidence: 'low' }
        : null };
  }

  // DAT-7: the ONE place a mastery read-path write is ledgered. Both mastery doors call this
  // immediately after resolveMasteryState and ONLY with a non-null `change`, so:
  //   · the no-change path (the overwhelmingly common one — the UI polls these GETs) writes
  //     NOTHING. An unconditional row here would bury the ledger in noise and make the very
  //     evidence it exists to preserve harder to find — the reasoning recorded in the sibling
  //     teacher.classroom leave projection.
  //   · the actor is the real named member of staff (req.user.name), never 'system': a read by
  //     a named teacher that changed a persisted record must name that teacher, otherwise the
  //     row cannot answer "who changed this level".
  // Risk is 'low' and that is the honest reading, not a default: this is a DERIVED projection of
  // evidence rows other lanes already wrote, triggered by opening a screen — it grants nothing,
  // reveals nothing beyond what the same GET returns, and every write is idempotent and
  // constrained to the row's own (student, subject, node) cell. It is not a security-critical
  // grant (which would be 'high') nor a decision a human must countersign (which would be
  // 'medium'). The label can move in either direction (evidence-added recovery and evidence-
  // expired decay both land here), which is exactly why the from/to levels are recorded.
  async function auditMasteryChange(c, req, subject, change) {
    const verb = change.kind === 'inserted' ? 'Mastery label created'
      : change.kind === 'refreshed' ? 'Mastery label refreshed'
        : 'Mastery label decayed (evidence expired)';
    const from = change.fromLevel ?? 'no label';
    await requestAudit(c, req.user.tenant_id, ID, {
      actor: req.user.name, action: verb, recordType: 'MasteryState', recordRef: change.stateId,
      reason: `mastery cell re-evaluated on a staff read (A3 decay resolver · ${subject})`,
      policyRef: 'TeacherOS A3 (labels decay when evidence expires)',
      risk: 'low',
      outcome: `level ${from} → ${change.toLevel}${change.fromConfidence ? `; confidence ${change.fromConfidence} → ${change.toConfidence}` : `; confidence ${change.toConfidence}`}` });
  }

  // GET /mastery/student/:id?subject= — level + evidence links, A3-decayed.
  app.get('/mastery/student/:id', { preHandler: [require(...STAFF), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    const subject = req.query?.subject ? String(req.query.subject) : null;
    if (!subject || !SUBJECTS.includes(subject)) return bad(reply, 'Please pick a subject: Mathematics or Science');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const student = (await c.query(
        `SELECT id, name, grade, section FROM app.students WHERE id=$1`,
        [req.params.id])).rows[0];
      if (!student) return bad(reply, 'We couldn\'t find that student', 404);
      // topics that actually carry evidence or state for this student+subject
      const nodeRows = (await c.query(
        `SELECT DISTINCT n.id, n.name, n.parent_id, u.name AS unit
         FROM mastery.evidence e JOIN curriculum.node n ON n.id = e.node_id
         LEFT JOIN curriculum.node u ON u.id = n.parent_id
         WHERE e.student_id=$1 AND e.subject=$2
         UNION
         SELECT DISTINCT n.id, n.name, n.parent_id, u.name AS unit
         FROM mastery.state s JOIN curriculum.node n ON n.id = s.node_id
         LEFT JOIN curriculum.node u ON u.id = n.parent_id
         WHERE s.student_id=$1 AND s.subject=$2`,
        [student.id, subject])).rows;
      const map = [];
      for (const node of nodeRows) {
        const resolved = await resolveMasteryState(c, req.user.tenant_id, student.id, subject, node);
        if (resolved.change) await auditMasteryChange(c, req, subject, resolved.change);
        const evidence = (await c.query(
          `SELECT id, kind, ref, value, observed_at, expires_at,
                  (expires_at IS NOT NULL AND expires_at <= now()) AS expired
           FROM mastery.evidence WHERE student_id=$1 AND subject=$2 AND node_id=$3
           ORDER BY observed_at DESC LIMIT 20`,
          [student.id, subject, node.id])).rows;
        map.push({
          nodeId: node.id, topic: node.name, unit: node.unit ?? null,
          level: resolved.level, levelLabel: resolved.level ? LEVEL_LABEL[resolved.level] : null,
          confidence: resolved.confidence, decayed: resolved.decayed,
          freshEvidenceCount: resolved.freshEvidence, expiredEvidenceCount: resolved.expiredEvidence ?? 0,
          evidence: evidence.map((e) => ({ evidenceId: e.id, kind: e.kind, ref: e.ref,
            value: e.value, observedAt: e.observed_at, expiresAt: e.expires_at, expired: e.expired })),
        });
      }
      return { studentId: student.id, name: student.name, classGrade: student.grade,
        section: student.section, subject, map,
        note: 'levels decay when their evidence expires (A3) — every label links to evidence' };
    });
  });

  // GET /mastery/class/:grade?subject= — the class map; only cells with evidence/state.
  app.get('/mastery/class/:grade', { preHandler: [require(...STAFF), lifecycleGate] }, async (req, reply) => {
    const subject = req.query?.subject ? String(req.query.subject) : null;
    if (!subject || !SUBJECTS.includes(subject)) return bad(reply, 'Please pick a subject: Mathematics or Science');
    if (!/^[0-9]{1,2}$/.test(String(req.params.grade))) return bad(reply, 'Please use a class grade (e.g. 8)');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const grade = String(req.params.grade);
      const students = (await c.query(
        `SELECT id, name, section FROM app.students WHERE grade=$1 AND status='active'
         ORDER BY section, name LIMIT 500`, [grade])).rows;
      const topics = (await c.query(
        `SELECT id, name FROM curriculum.node
         WHERE subject=$1 AND grade=$2 AND kind='topic' ORDER BY parent_id, order_no, name`,
        [subject, grade])).rows;
      // resolve only the cells that actually carry evidence or state (keeps the read O(cells))
      const relevant = (await c.query(
        `SELECT DISTINCT student_id, node_id FROM mastery.evidence
          WHERE subject=$1 AND node_id = ANY($2::uuid[]) AND student_id = ANY($3::uuid[])
         UNION
         SELECT DISTINCT student_id, node_id FROM mastery.state
          WHERE subject=$1 AND node_id = ANY($2::uuid[]) AND student_id = ANY($3::uuid[])`,
        [subject, topics.map((t) => t.id), students.map((s) => s.id)])).rows;
      const cellKeys = new Set(relevant.map((r) => `${r.student_id}:${r.node_id}`));
      const topicName = Object.fromEntries(topics.map((t) => [t.id, t.name]));
      const cells = [];
      for (const key of cellKeys) {
        const [studentId, nodeId] = key.split(':');
        const student = students.find((s) => s.id === studentId);
        if (!student || !topicName[nodeId]) continue;
        const resolved = await resolveMasteryState(c, req.user.tenant_id, studentId, subject, { id: nodeId });
        if (resolved.change) await auditMasteryChange(c, req, subject, resolved.change);
        cells.push({ studentId, studentName: student.name, section: student.section, topicId: nodeId,
          topic: topicName[nodeId], level: resolved.level,
          levelLabel: resolved.level ? LEVEL_LABEL[resolved.level] : null,
          confidence: resolved.confidence, decayed: resolved.decayed });
      }
      cells.sort((a, b) => (a.studentName ?? '').localeCompare(b.studentName ?? '') || a.topic.localeCompare(b.topic));
      return { grade, subject, students: students.length, cells,
        note: 'needs-support-first reading: labels decay when evidence expires (A3)' };
    });
  });

  // GET /progress/story/:studentId — P5: the narrative instead of the score. Built only
  // from real evidence rows (submissions, mastery evidence, intervention events). Every
  // step is one plain sentence; nothing is invented.
  app.get('/progress/story/:studentId', { preHandler: [require(...STAFF), uuidParams('studentId'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const student = (await c.query(`SELECT id, name FROM app.students WHERE id=$1`, [req.params.studentId])).rows[0];
      if (!student) return bad(reply, 'We couldn\'t find that student', 404);
      const steps = [];
      if (await tableExists(c, 'teacher', 'submission')) {
        const subs = (await c.query(
          `SELECT s.id, s.status, s.submitted_at, s.grade, h.title, h.subject
           FROM teacher.submission s JOIN teacher.homework h ON h.id=s.homework_id
           WHERE s.student_id=$1 ORDER BY s.submitted_at DESC LIMIT 30`, [student.id])).rows;
        for (const s of subs) {
          steps.push({ id: `sub-${s.id}`, at: s.submitted_at, kind: 'submission',
            sentence: `${s.subject}: “${s.title}” was ${s.status === 'late' ? 'submitted late' : s.status === 'graded' ? `graded ${s.grade ?? ''}`.trim() : s.status}.`,
            evidenceRef: s.id });
        }
      }
      if (await tableExists(c, 'mastery', 'evidence')) {
        const ev = (await c.query(
          `SELECT e.id, e.kind, e.value, e.observed_at, n.name AS topic
           FROM mastery.evidence e LEFT JOIN curriculum.node n ON n.id=e.node_id
           WHERE e.student_id=$1 ORDER BY e.observed_at DESC LIMIT 40`, [student.id])).rows;
        for (const e of ev) {
          const kind = e.kind === 'assessment' ? 'assessment' : e.kind === 'observation' ? 'observed' : 'assessment';
          steps.push({ id: `ev-${e.id}`, at: e.observed_at, kind,
            sentence: e.topic ? `${e.topic}: evidence recorded (${e.value}%).` : `Evidence recorded (${e.value}%).`,
            evidenceRef: e.id });
        }
      }
      if (await tableExists(c, 'intervention', 'plan_event')) {
        const pe = (await c.query(
          `SELECT pe.id, pe.to_status, pe.note, pe.created_at, p.objective
           FROM intervention.plan_event pe JOIN intervention.plan p ON p.id=pe.plan_id
           WHERE p.student_id=$1 ORDER BY pe.created_at DESC LIMIT 30`, [student.id])).rows;
        for (const e of pe) {
          steps.push({ id: `int-${e.id}`, at: e.created_at, kind: 'intervention',
            sentence: `Support plan “${e.objective}” moved to ${String(e.to_status).replace('_', ' ')}${e.note ? ` — ${e.note}` : ''}.`,
            evidenceRef: e.id });
        }
      }
      steps.sort((a, b) => new Date(b.at) - new Date(a.at));
      return { studentId: student.id, studentName: student.name, steps: steps.slice(0, 60),
        note: 'A chronological story from real records — no score, no judgement.' };
    });
  });

  // GET /analytics/class/:grade — P7/P11 composite: questions, never rankings. Aggregates
  // only; no per-student score, no ordering of children.
  app.get('/analytics/class/:grade', { preHandler: [require(...STAFF), lifecycleGate] }, async (req, reply) => {
    const grade = String(req.params.grade);
    if (!/^[0-9]{1,2}$/.test(grade)) return bad(reply, 'Please use a class grade (e.g. 8)');
    const subject = req.query?.subject ? String(req.query.subject) : 'Mathematics';
    if (!SUBJECTS.includes(subject)) return bad(reply, 'Please pick a subject: Mathematics or Science');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const students = (await c.query(
        `SELECT id FROM app.students WHERE tenant_id=$1 AND grade=$2 AND status='active'`, [req.user.tenant_id, grade])).rows;
      const ids = students.map((s) => s.id);
      const mastery = { strong: 0, developing: 0, needs_support: 0, unlabelled: 0 };
      if (ids.length && (await tableExists(c, 'mastery', 'state'))) {
        const rows = (await c.query(
          `SELECT level, count(*)::int AS n FROM mastery.state WHERE subject=$1 AND student_id = ANY($2::uuid[]) GROUP BY level`,
          [subject, ids])).rows;
        for (const r of rows) if (r.level in mastery) mastery[r.level] = r.n;
        mastery.unlabelled = Math.max(0, ids.length - (mastery.strong + mastery.developing + mastery.needs_support));
      }
      let homework = { assigned: 0, turned_in: 0, completion_pct: null };
      if (await tableExists(c, 'teacher', 'submission')) {
        const hw = (await c.query(
          `SELECT h.id, (SELECT count(*)::int FROM teacher.submission s WHERE s.homework_id=h.id AND s.status IN ('submitted','late','reviewed','graded')) AS turned_in
           FROM teacher.homework h WHERE h.tenant_id=$1 AND h.class_grade=$2`, [req.user.tenant_id, grade])).rows;
        const assigned = hw.length * Math.max(1, ids.length);
        const turned = hw.reduce((a, h) => a + h.turned_in, 0);
        homework = { assigned, turned_in: turned, completion_pct: assigned ? Math.round((turned / assigned) * 100) : null };
      }
      let attendance = { pct: null };
      if (ids.length) {
        const a = (await c.query(
          `SELECT count(*) FILTER (WHERE status IN ('present','late'))::int AS present,
                  count(*) FILTER (WHERE status <> 'leave')::int AS held
           FROM app.attendance WHERE tenant_id=$1 AND student_id = ANY($2::uuid[]) AND school_date > (now() AT TIME ZONE 'Asia/Kolkata')::date - 30`,
          [req.user.tenant_id, ids])).rows[0];
        attendance = { pct: a.held ? Math.round((a.present / a.held) * 100) : null };
      }
      return { grade, subject, students: ids.length, mastery, homework, attendance,
        note: 'Aggregates only — this is a picture of the class, never a ranking of children.' };
    });
  });

  // ═══════════════════════ BRIEF (deterministic aggregation) ═══════════════════

  // Shared aggregation for /teacher/brief — also the grounding data for /copilot/ask.
  async function buildBrief(c, tenantId, teacherId, when) {
    const ist = istNow();
    const dow = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][ist.getUTCDay()];
    const teacherName = (await c.query(`SELECT name FROM app.users WHERE id=$1`, [teacherId])).rows[0]?.name ?? '';

    // periods today — from timetable data IF reachable (021 primitives; the demo grid
    // carries a teacher_name string, so the teacher matches on her display name)
    const timetable = await safeRead(async () => {
      if (!(await tableExists(c, 'app', 'timetable_slots'))) return { available: false };
      const periods = (await c.query(
        `SELECT p.seq, p.label, p.start_time, p.end_time, p.is_break, s.subject, s.room
         FROM app.timetable_slots s JOIN app.timetable_periods p ON p.id = s.period_id
         WHERE s.day_of_week=$1 AND s.teacher_name=$2
         ORDER BY p.sort_idx`, [dow, teacherName])).rows;
      const istTime = ist.toISOString().slice(11, 16);
      const teaching = periods.filter((p) => !p.is_break);
      return { available: true, day: dow, teachingToday: teaching.length,
        currentPeriod: teaching.find((p) => p.start_time <= istTime && istTime < p.end_time) ?? null,
        nextPeriod: teaching.find((p) => p.start_time > istTime) ?? null,
        periods: periods.map((p) => ({ seq: p.seq, time: `${p.start_time}–${p.end_time}`,
          subject: p.subject, room: p.room, isBreak: p.is_break })) };
    });

    // pending submissions — from teacher.homework IF TS-1's tables exist (RLS of that
    // lane applies; no explicit tenant filter — column shapes belong to the sibling lane).
    // 031 ships `created_by` as the authoring-teacher column; older drafts that named it
    // `teacher_id` (or lanes that add it) are supported via a catalog column probe.
    const homework = await safeRead(async () => {
      if (!(await tableExists(c, 'teacher', 'homework'))) return { available: false, reason: 'not_built' };
      const authorCol = (await c.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema='teacher' AND table_name='homework' AND column_name='teacher_id'
         LIMIT 1`)).rows.length ? 'teacher_id' : 'created_by';
      const openHomework = (await c.query(
        `SELECT count(*)::int AS n FROM teacher.homework WHERE ${authorCol}=$1 AND status='open'`,
        [teacherId])).rows[0].n;
      let pending = 0, reviewed = 0;
      if (await tableExists(c, 'teacher', 'submission')) {
        pending = (await c.query(
          `SELECT count(*)::int AS n FROM teacher.submission s
           JOIN teacher.homework h ON h.id = s.homework_id
           WHERE h.${authorCol}=$1 AND s.status IN ('submitted','late')`, [teacherId])).rows[0].n;
        reviewed = (await c.query(
          `SELECT count(*)::int AS n FROM teacher.submission s
           JOIN teacher.homework h ON h.id = s.homework_id
           WHERE h.${authorCol}=$1 AND s.status='reviewed'`, [teacherId])).rows[0].n;
      }
      return { available: true, openHomework, pendingSubmissions: pending, reviewedSubmissions: reviewed };
    });

    // open concerns — from teacher.concern IF TS-2's table exists. 032 ships `filed_by`
    // (teachers file concerns); older `teacher_id`-shaped drafts are supported too.
    const concerns = await safeRead(async () => {
      if (!(await tableExists(c, 'teacher', 'concern'))) return { available: false, reason: 'not_built' };
      const filerCol = (await c.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema='teacher' AND table_name='concern' AND column_name='teacher_id'
         LIMIT 1`)).rows.length ? 'teacher_id' : 'filed_by';
      const rows = (await c.query(
        `SELECT id, category, urgency, status FROM teacher.concern
         WHERE ${filerCol}=$1 AND status IN ('open','routed','in_support')
         ORDER BY CASE urgency WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, created_at DESC
         LIMIT 20`, [teacherId])).rows;
      return { available: true, open: rows.length,
        items: rows.map((r) => ({ concernId: r.id, category: r.category, urgency: r.urgency, status: r.status })) };
    });

    // curriculum pace — always available (own tables): % topics fully covered
    const pace = await safeRead(async () => {
      const rows = (await c.query(
        `SELECT n.subject, n.grade,
                count(DISTINCT n.id)::int AS total,
                count(DISTINCT p.node_id) FILTER (WHERE p.covered_pct >= 100)::int AS covered,
                count(DISTINCT p.node_id) FILTER (WHERE p.covered_pct > 0 AND p.covered_pct < 100)::int AS partial
         FROM curriculum.node n
         LEFT JOIN curriculum.progress p ON p.node_id = n.id AND p.class_grade = n.grade
         WHERE n.kind='topic'
         GROUP BY n.subject, n.grade ORDER BY n.subject, n.grade`)).rows;
      return { available: true, rows: rows.map((r) => ({ subject: r.subject, grade: r.grade,
        covered: r.covered, partial: r.partial, total: r.total,
        pacePct: r.total > 0 ? Math.round((r.covered / r.total) * 100) : 0 })) };
    });

    const sources = [
      { kind: 'timetable', table: 'app.timetable_slots', available: timetable.available === true },
      { kind: 'homework', table: 'teacher.homework', available: homework.available === true },
      { kind: 'concerns', table: 'teacher.concern', available: concerns.available === true },
      { kind: 'curriculum', table: 'curriculum.progress', available: pace.available === true },
    ];

    // plain sentences (deterministic; missing neighbours are said plainly).
    // pacePhrase uses total-touched coverage (full + partial) so a half-ticked topic
    // isn't hidden behind the ≥100% bar; full-coverage counts stay in the payload.
    const paceRows = (pace.rows ?? []).filter((r) => r.covered + r.partial > 0);
    const pacePhrase = paceRows
      .map((r) => `${r.subject} class ${r.grade} is ${r.pacePct}% covered (${r.covered + r.partial} of ${r.total} topics touched)`).join('; ');

    // plain sentences (deterministic; missing neighbours are said plainly)
    const sentences = [];
    if (when === 'eod') {
      if (timetable.available) sentences.push(`You have ${timetable.teachingToday} teaching period${timetable.teachingToday === 1 ? '' : 's'} today${timetable.currentPeriod ? `; the current period is ${timetable.currentPeriod.subject}` : ''}${timetable.nextPeriod ? `, next is ${timetable.nextPeriod.subject} at ${timetable.nextPeriod.start_time}` : timetable.currentPeriod ? ', and that is the last one' : ''}.`);
      else sentences.push('The timetable isn\'t reachable right now, so today\'s periods aren\'t shown.');
      sentences.push(homework.available
        ? (homework.pendingSubmissions > 0
          ? `${homework.pendingSubmissions} submission${homework.pendingSubmissions === 1 ? ' is' : 's are'} waiting for your review across ${homework.openHomework} open homework.`
          : 'No submissions are waiting for review.')
        : 'The homework inbox isn\'t connected in this database yet — submission counts are skipped.');
      sentences.push(concerns.available
        ? (concerns.open > 0
          ? `${concerns.open} concern${concerns.open === 1 ? ' is' : 's are'} open in your queue${concerns.items.some((i) => i.urgency === 'high') ? ' — at least one is urgent' : ''}.`
          : 'No concerns are open in your queue.')
        : 'The concern queue isn\'t connected in this database yet — concern counts are skipped.');
      sentences.push(pacePhrase ? `Curriculum pace: ${pacePhrase}.` : 'No curriculum coverage has been ticked yet — tick topics in the curriculum tree.');
      sentences.push('This brief is a deterministic summary of school data — nothing was invented.');
    } else {
      sentences.push(timetable.available
        ? `On ${dow}s you have ${timetable.teachingToday} teaching period${timetable.teachingToday === 1 ? '' : 's'}.`
        : 'The timetable isn\'t reachable right now, so the week\'s periods aren\'t shown.');
      sentences.push(homework.available
        ? `So far ${homework.pendingSubmissions + homework.reviewedSubmissions} submission${(homework.pendingSubmissions + homework.reviewedSubmissions) === 1 ? ' has' : 's have'} come in; ${homework.pendingSubmissions} still need${homework.pendingSubmissions === 1 ? 's' : ''} review.`
        : 'The homework inbox isn\'t connected in this database yet — submission counts are skipped.');
      sentences.push(concerns.available
        ? `${concerns.open} concern${concerns.open === 1 ? ' remains' : 's remain'} in your queue.`
        : 'The concern queue isn\'t connected in this database yet — concern counts are skipped.');
      sentences.push(pacePhrase ? `Curriculum coverage: ${pacePhrase}.` : 'No curriculum coverage has been ticked yet.');
      sentences.push('This brief is a deterministic summary of school data — nothing was invented.');
    }

    return { when, generatedFor: istDate(), timetable, homework, concerns, curriculumPace: pace,
      sources, sentences, label: 'deterministic_summary' };
  }

  // GET /teacher/brief?when=eod|week — teacher-role-only (the copilot lane).
  app.get('/teacher/brief', { preHandler: [require(...TEACHER_ONLY), lifecycleGate] }, async (req) => {
    const when = req.query?.when === 'week' ? 'week' : 'eod';
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const brief = await buildBrief(c, req.user.tenant_id, req.user.id, when);
      await budgetCall(c, req, 'brief', brief.sources); // A2: briefs are budgeted too
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: `Teacher ${when} brief generated`, recordType: 'CopilotCall',
        recordRef: when, reason: 'teacher day brief', policyRef: 'TeacherOS P1 (end-of-day/weekly brief)',
        risk: 'low',
        outcome: `deterministic aggregation · sources: ${brief.sources.filter((s) => s.available).map((s) => s.kind).join(', ') || 'none'}` });
      return brief;
    });
  });

  // ═══════════════════════ COPILOT (A2 · deterministic v0) ═════════════════════

  // POST /copilot/draft {kind: lesson|worksheet|feedback|message, params}
  // → deterministic TEMPLATE draft, clearly labelled ai_draft. NO model calls.
  app.post('/copilot/draft', { preHandler: [require(...TEACHER_ONLY), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    const kind = String(b.kind ?? '');
    if (!['lesson', 'worksheet', 'feedback', 'message', 'questions'].includes(kind))
      return bad(reply, 'Pick a draft type: lesson, worksheet, feedback, message or questions');
    const params = (b.params && typeof b.params === 'object') ? b.params : {};
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const used = await budgetUsedToday(c, req);
      if (used >= DAILY_CAP) return reply.code(429).send({ error: 'You\'ve reached today\'s Copilot draft limit — try again tomorrow', budget: { used, cap: DAILY_CAP } });

      const builtFrom = [];
      // grounding: curriculum topic (when the teacher picked one) — from OWN tables
      let topicName = null, unitName = null;
      let subject = params.subject ?? null, grade = params.classGrade ?? null;
      if (params.nodeId && UUID_RE.test(String(params.nodeId))) {
        const n = (await c.query(
          `SELECT n.name, n.subject, n.grade, u.name AS unit FROM curriculum.node n
           LEFT JOIN curriculum.node u ON u.id = n.parent_id WHERE n.id=$1`,
          [params.nodeId])).rows[0];
        if (n) { topicName = n.name; unitName = n.unit; subject = n.subject; grade = n.grade; builtFrom.push('curriculum.node'); }
      }
      const minutes = Math.min(120, Math.max(15, Number.isFinite(Number(params.minutes)) ? Number(params.minutes) : 40));
      let title = '', body = '';
      if (kind === 'lesson') {
        if (!subject || !grade) return bad(reply, 'A lesson draft needs a subject and class — or pick a topic from the curriculum tree');
        const focus = topicName ?? (params.focus ? String(params.focus).slice(0, 120) : subject);
        title = `Lesson draft · ${subject} · Class ${grade} · ${focus}`;
        body = [
          'LESSON PLAN (ai_draft — review and edit before use)',
          `Class: ${grade} · Subject: ${subject} · Topic: ${focus}${unitName ? ` (unit: ${unitName})` : ''}`,
          `Duration: ${minutes} minutes`,
          '',
          `Objective: by the end, students can explain and practise ${focus}.`,
          'Starter (5 min): recall the previous lesson with two quick oral questions.',
          `Main (25 min): teach ${focus} with one worked example on the board, then one guided practice in pairs.`,
          'Practice (8 min): two problems attempted independently; walk the room and note who needs support.',
          'Wrap-up (2 min): one exit question; note confusions for the next lesson.',
          '',
          'Differentiation: support pair works a simpler example; advanced pair gets one challenge problem.',
          `Built from ${builtFrom.includes('curriculum.node') ? `curriculum topic "${focus}"` : 'the details you gave'} · deterministic template v0 — no AI model involved`,
        ].join('\n');
      } else if (kind === 'worksheet') {
        if (!subject || !grade) return bad(reply, 'A worksheet draft needs a subject and class — or pick a topic from the curriculum tree');
        const focus = topicName ?? (params.focus ? String(params.focus).slice(0, 120) : subject);
        title = `Worksheet draft · ${subject} · Class ${grade} · ${focus}`;
        body = [
          'WORKSHEET (ai_draft — review and edit before printing)',
          `${subject} · Class ${grade} · ${focus} · Name: ________ Date: ________`,
          '',
          'Section A — Practice (answer all)',
          `1. Explain ${focus} in your own words.`,
          `2. Solve one worked example of ${focus} from your notes.`,
          '3. Attempt two similar problems on your own. Show your working.',
          '',
          'Section B — Challenge (optional)',
          `4. Describe one real-life situation where ${focus} is used.`,
          '',
          'Teacher note: tick mastery evidence for students who complete Section A unaided.',
          `Built from ${builtFrom.includes('curriculum.node') ? `curriculum topic "${focus}"` : 'the details you gave'} · deterministic template v0 — no AI model involved`,
        ].join('\n');
      } else if (kind === 'feedback') {
        if (!params.studentName) return bad(reply, 'Tell me which student this feedback is for');
        const name = String(params.studentName).slice(0, 80);
        const focus = topicName ?? (params.focus ? String(params.focus).slice(0, 120) : 'our current topic');
        title = `Feedback draft · ${name}`;
        body = [
          'FEEDBACK DRAFT (ai_draft — edit in your own voice before sharing)',
          `Student: ${name}${subject ? ` · ${subject}` : ''}`,
          '',
          `Strengths: you have been working steadily, and your recent effort on ${focus} shows.`,
          `Next step: the class goal right now is ${focus} — try the practice set once more and bring your question to class.`,
          'Encouragement: keep going — steady practice is exactly how tricky topics become comfortable.',
          '',
          'Note: feedback is about the work, never the child. Deterministic template v0 — no AI model involved.',
        ].join('\n');
      } else if (kind === 'questions') {
        if (!subject || !grade) return bad(reply, 'A question set needs a subject and class — or pick a topic from the curriculum tree');
        const focus = topicName ?? (params.focus ? String(params.focus).slice(0, 120) : subject);
        const count = Math.min(20, Math.max(4, Number.isFinite(Number(params.count)) ? Number(params.count) : 8));
        title = `Question set draft · ${subject} · Class ${grade} · ${focus}`;
        body = [
          'QUESTION SET (ai_draft — review, edit and validate before use)',
          `${subject} · Class ${grade} · ${focus}`,
          '',
          `Section A — Recall (${Math.ceil(count / 3)} questions)`,
          `1. Define ${focus} in one sentence.`,
          `2. State one key property or rule of ${focus}.`,
          '',
          `Section B — Apply (${Math.ceil(count / 3)} questions)`,
          `3. Solve a worked problem on ${focus}, showing each step.`,
          `4. Find and correct the mistake in the given example of ${focus}.`,
          '',
          `Section C — Reason (${Math.ceil(count / 3)} questions)`,
          `5. Explain why ${focus} matters, with one real-life example.`,
          `6. Compare ${focus} with the previous topic — one similarity, one difference.`,
          '',
          'Teacher note: adjust marks and difficulty to your blueprint before use. Deterministic template v0 — no AI model involved.',
        ].join('\n');
      } else { // message
        if (!params.studentName) return bad(reply, 'Tell me which parent this message is for');
        const name = String(params.studentName).slice(0, 80);
        const focus = topicName ?? (params.focus ? String(params.focus).slice(0, 120) : 'the current topic');
        title = `Parent message draft · ${name}`;
        body = [
          'PARENT MESSAGE DRAFT (ai_draft — edit and approve before sending; sending is a separate, approved step)',
          `Dear ${params.guardianName ? String(params.guardianName).slice(0, 80) : `Parent of ${name}`},`,
          '',
          `I wanted to share how ${name} is doing in ${subject ?? 'class'}. ${params.positive ? `${String(params.positive).slice(0, 200)} ` : ''}Our focus for the next two weeks is ${focus}, and a little practice at home would help.`,
          'Thank you for your support.',
          '',
          `— ${req.user.name}`,
          'Guardian numbers stay masked in school tools — messages go through the school channel only. Deterministic template v0 — no AI model involved.',
        ].join('\n');
      }

      const sources = builtFrom.includes('curriculum.node') ? [{ kind: 'curriculum', ref: params.nodeId }] : [];
      await budgetCall(c, req, 'draft', sources);
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: `Copilot draft generated (${kind})`, recordType: 'CopilotCall',
        recordRef: kind, reason: 'teacher draft request',
        policyRef: 'TeacherOS P4 (AI recommends, teacher decides) · A2 budget classes',
        aiInvolved: false, risk: 'low',
        outcome: `deterministic template (labelled ai_draft) · no model call · budget ${used + 1}/${DAILY_CAP}` });
      return { ok: true, kind, title, draft: body, label: 'ai_draft', deterministic: true,
        builtFrom, budget: { used: used + 1, cap: DAILY_CAP, budgetClass: BUDGET_CLASS } };
    });
  });

  // POST /copilot/ask {question} — v0: keyword routing to brief/curriculum/mastery
  // data → {answer, sources[], budget}. Deterministic, clearly labelled.
  app.post('/copilot/ask', { preHandler: [require(...TEACHER_ONLY), lifecycleGate] }, async (req, reply) => {
    const question = String(req.body?.question ?? '').trim();
    if (!question) return bad(reply, 'Ask me a question — for example "what do I teach today?" or "how is class 8 doing in Mathematics?"');
    if (question.length > 500) return bad(reply, 'Please keep the question under 500 characters');
    const qLower = question.toLowerCase();
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const used = await budgetUsedToday(c, req);
      if (used >= DAILY_CAP) return reply.code(429).send({ error: 'You\'ve reached today\'s Copilot limit — try again tomorrow', budget: { used, cap: DAILY_CAP } });

      // ground every answer in live data
      const brief = await buildBrief(c, req.user.tenant_id, req.user.id, 'eod');
      const sources = [];
      let answer = null;
      let suggestedAction = null; // API-9: deterministic next step for the routed branch

      const mGrade = qLower.match(/class\s*([6-9]|10)/) ?? qLower.match(/(?:^|\s)grade\s*([6-9]|10)/);
      const mSubject = SUBJECTS.find((s) => qLower.includes(s.toLowerCase()));
      const curriculumWords = ['curriculum', 'syllabus', 'coverage', 'pace', 'covered', 'chapter', 'tree'];
      const masteryWords = ['mastery', 'weak', 'needs support', 'struggl', 'behind', 'strong'];
      // NOTE: no bare 'teach' — abstract questions ("the meaning of teaching") must
      // fall through to the honest fallback, not hijack the timetable branch.
      const dayWords = ['today', 'period', 'timetable', 'next class', 'schedule', 'my day', 'teach today', 'teaching today', 'teach tomorrow'];
      const isDayQ = dayWords.some((w) => qLower.includes(w)) || /\bdo i teach\b/.test(qLower);

      // 1 · curriculum pace
      if (!answer && curriculumWords.some((w) => qLower.includes(w))) {
        sources.push({ kind: 'curriculum', table: 'curriculum.progress' });
        const rows = (brief.curriculumPace.rows ?? []).filter((r) => r.covered + r.partial > 0);
        const pick = rows.find((r) => (!mSubject || r.subject === mSubject) && (!mGrade || r.grade === mGrade))
          ?? rows.find((r) => !mSubject || r.subject === mSubject);
        answer = pick
          ? `${pick.subject} class ${pick.grade}: ${pick.covered} of ${pick.total} topics fully covered (${pick.pacePct}%)${pick.partial > 0 ? `, ${pick.partial} partially ticked` : ''}. ${pick.pacePct < 50 ? 'Pace looks behind — plan a catch-up week or tick pending coverage.' : 'Pace looks healthy.'}`
          : `No curriculum coverage has been ticked yet${mSubject ? ` for ${mSubject}` : ''}${mGrade ? ` class ${mGrade}` : ''} — tick topics in the curriculum tree and the pace will show here.`;
        suggestedAction = { label: 'Open the curriculum tree', to: '/teacher/curriculum' };
      }

      // 2 · mastery (own tables; persisted deterministic states)
      if (!answer && masteryWords.some((w) => qLower.includes(w))) {
        sources.push({ kind: 'mastery', table: 'mastery.state' });
        const grade = mGrade ? mGrade[1] : null;
        const subject = mSubject ?? 'Mathematics';
        if (grade) {
          const cells = (await c.query(
            `SELECT s.name AS student, n.name AS topic
             FROM mastery.state st
             JOIN app.students s ON s.id = st.student_id
             JOIN curriculum.node n ON n.id = st.node_id
             WHERE st.subject=$1 AND s.grade=$2 AND st.level='needs_support'
             ORDER BY s.name, n.name LIMIT 10`, [subject, grade])).rows;
          answer = cells.length
            ? `Needs support in ${subject} class ${grade}: ${cells.map((r) => `${r.student} (${r.topic})`).join(', ')}. Evidence links are on the mastery map — labels decay when their evidence expires.`
            : `No student in ${subject} class ${grade} is currently marked "needs support" — either everyone is doing fine or no evidence has been recorded yet.`;
          if (cells.length) suggestedAction = { label: 'Create an intervention', to: '/interventions' };
        } else {
          answer = 'Tell me the class too — for example "who needs support in class 8 Mathematics?" — and I\'ll pull the mastery map.';
        }
      }

      // 3 · today / timetable
      if (!answer && isDayQ) {
        sources.push({ kind: 'timetable', table: 'app.timetable_slots', available: brief.timetable.available === true });
        answer = brief.timetable.available
          ? (brief.timetable.teachingToday > 0
            ? `On ${brief.timetable.day}s you teach ${brief.timetable.teachingToday} period${brief.timetable.teachingToday === 1 ? '' : 's'}${brief.timetable.currentPeriod ? `; right now: ${brief.timetable.currentPeriod.subject}${brief.timetable.currentPeriod.room ? ` (${brief.timetable.currentPeriod.room})` : ''}` : ''}${brief.timetable.nextPeriod ? `; next: ${brief.timetable.nextPeriod.subject} at ${brief.timetable.nextPeriod.start_time}` : brief.timetable.currentPeriod ? '; that was the last one for today' : ''}.`
            : `No teaching periods are scheduled for you on ${brief.timetable.day}s.`)
          : 'The timetable isn\'t reachable in this database yet, so I can\'t see your periods — everything else on the brief still works.';
        suggestedAction = { label: 'Open your command center', to: '/teacher' };
      }

      // 4 · homework / submissions
      if (!answer && ['homework', 'submission', 'submitted', 'pending', 'inbox', 'review'].some((w) => qLower.includes(w))) {
        sources.push({ kind: 'homework', table: 'teacher.homework', available: brief.homework.available === true });
        answer = brief.homework.available
          ? `${brief.homework.pendingSubmissions} submission${brief.homework.pendingSubmissions === 1 ? ' is' : 's are'} waiting for review across ${brief.homework.openHomework} open homework; ${brief.homework.reviewedSubmissions} reviewed.`
          : 'The homework inbox isn\'t connected in this database yet — the homework lane hasn\'t been built, so I can\'t count submissions.';
        suggestedAction = { label: 'Open the submissions inbox', to: '/teacher/submissions' };
      }

      // 5 · fallback: the brief itself
      if (!answer) {
        sources.push({ kind: 'brief', table: '/teacher/brief' });
        answer = `Here's your day at a glance: ${brief.sentences.join(' ')}`;
      }

      await budgetCall(c, req, 'ask', sources);
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Copilot ask answered (deterministic)', recordType: 'CopilotCall',
        recordRef: 'ask', reason: question.slice(0, 120), policyRef: 'TeacherOS P4 · A2 budget classes',
        aiInvolved: false, risk: 'low',
        outcome: `keyword-routed to ${sources.map((s) => s.kind).join(', ')} · deterministic answer, no model call · budget ${used + 1}/${DAILY_CAP}` });
      return { ok: true, question, answer, sources, label: 'deterministic_answer',
        deterministic: true, suggested_action: suggestedAction,
        budget: { used: used + 1, cap: DAILY_CAP, budgetClass: BUDGET_CLASS } };
    });
  });

  // GET /teacher/usage — the A2 governance read: the caller's own budget ledger.
  app.get('/teacher/usage', { preHandler: [require(...TEACHER_ONLY), lifecycleGate] }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const rows = (await c.query(
        `SELECT verb, count(*)::int AS calls
         FROM copilot.call WHERE user_id=$1 AND at > now() - interval '24 hours'
         GROUP BY verb`, [req.user.id])).rows;
      return { budgetClass: BUDGET_CLASS, windowHours: 24, cap: DAILY_CAP,
        used: rows.filter((r) => r.verb !== 'brief').reduce((a, r) => a + r.calls, 0),
        verbs: rows, note: 'v0 is deterministic — tokens stay 0 until a governed model is wired' };
    });
  });
}
