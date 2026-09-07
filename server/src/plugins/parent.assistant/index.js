// parent.assistant — runtime module (migration 035, ParentOS lane PS-2). Class C.
// The parent's assistant. DETERMINISTIC-ONLY: NO external LLM is contacted anywhere in
// this module. /parent/brief is a factual per-child aggregation (morning/evening/week);
// /parent/copilot/ask routes the question to the family's OWN records by keyword and
// composes the answer from what the rows actually say; /parent/copilot/draft assembles
// clearly-labelled ai_draft templates (question_to_teacher, leave_note) that the parent
// edits before sending; /parent/explain/:topic turns real numbers into plain language.
//
// Design invariants:
//   · GUARDIAN SCOPING — a parent reads only children linked via family.child_link
//     (the 034 myChildren/assertOwnChild pattern). Cross-guardian child ids are 403
//     with no data in the error. The teacher role is refused on every door.
//   · EVIDENCE, NEVER JUDGEMENT — every line is a plain factual sentence with evidence
//     numbers. The words failing/disengaged/risk/at-risk/weak are BANNED in output and
//     a test scans the whole payload for them.
//   · HONEST UNKNOWN — an intent the data cannot answer (or a keyword this v0 does not
//     know) gets "I don't have that information yet — please ask the class teacher".
//     Nothing is ever invented; every answer lists its sources (door names).
//   · P-copilot BUDGET — every ask/draft call writes a parent.copilot_call row; when a
//     user already has 100 rows this calendar month, the door answers 429 plainly.
//   · GRACEFUL DEGRADATION — sibling-lane tables (teacher.homework, plugin_exams.*) are
//     read via information_schema probes; absent tables yield null/empty sections with
//     a plain sentence, never a 500.
import { makeLifecycleGate } from '../_shared/lifecycle-gate.js';

const ID = 'parent.assistant';
export { default as manifest } from './manifest.js';

const GUARDIAN = ['parent'];
const BUDGET_CLASS = 'P-copilot';
const MONTHLY_CAP = 100;
// banned interpretive words — never in any output (test scans the whole payload)
const BANNED = /failing|disengaged|\brisk\b|at-risk|weak/i;
const IST = '(now() AT TIME ZONE \'Asia/Kolkata\')';
const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });
const HONEST_UNKNOWN = 'I don\'t have that information yet — please ask the class teacher';

export function register(app, kernel) {
  const { withUser, requestAudit, require, q } = kernel;
  const lifecycleGate = makeLifecycleGate(q, ID);

  // ── shared helpers (034 myChildren pattern) ─────────────────────────────────
  const myChildren = async (c, userId) =>
    (await c.query(
      `SELECT s.id, s.name, s.grade, s.section, s.admission_no
       FROM family.child_link l JOIN app.students s ON s.id = l.student_id AND s.tenant_id = l.tenant_id
       WHERE l.user_id=$1 AND l.tenant_id=current_setting('schoolos.tenant_id', true)::uuid
       ORDER BY s.name`, [userId])).rows;

  const assertOwnChild = async (c, userId, childId) => {
    const ok = await c.query(
      `SELECT 1 FROM family.child_link WHERE user_id=$1 AND student_id=$2
       AND tenant_id=current_setting('schoolos.tenant_id', true)::uuid`, [userId, childId]);
    return ok.rows.length > 0;
  };

  const tableExists = async (c, schema, table) =>
    !!(await c.query(`SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2 LIMIT 1`,
      [schema, table])).rows.length;

  // sibling-lane safe read: absent neighbour degrades, never 500s
  const safeRead = async (fn) => { try { return await fn(); } catch { return null; } };

  // P-copilot budget ledger: one row per ask/draft call, written INSIDE the caller's
  // transaction. Budget = rows this CALENDAR month (IST) for this user.
  const budgetWrite = (c, req, verb, question, sources) =>
    c.query(
      `INSERT INTO parent.copilot_call (tenant_id, user_id, verb, question, sources, budget_class)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
      [req.user.tenant_id, req.user.id, verb, question ? String(question).slice(0, 500) : null,
       JSON.stringify(sources), BUDGET_CLASS]);

  const budgetUsedThisMonth = (c, req) =>
    c.query(
      `SELECT count(*)::int AS n FROM parent.copilot_call
       WHERE user_id=$1 AND at >= date_trunc('month', ${IST}::timestamp AT TIME ZONE 'Asia/Kolkata')`,
      [req.user.id]).then((r) => r.rows[0].n);

  // ── the per-child aggregation (grounding for the brief AND the ask) ─────────
  // Everything here is scoped to children linked via family.child_link — the same
  // helper the /parent/brief door uses, so ask can never see more than brief can.
  async function collectChildren(c, tenantId, userId) {
    const children = await myChildren(c, userId);
    const hasHw = await tableExists(c, 'teacher', 'homework');
    const hasExams = await tableExists(c, 'plugin_exams', 'exam');
    const hasReports = await tableExists(c, 'plugin_exams', 'report');
    const hasConsent = await tableExists(c, 'family', 'consent');
    const out = [];
    for (const ch of children) {
      // attendance today + last-30-day share (present/late both attended school)
      const attToday = (await c.query(
        `SELECT status FROM app.attendance WHERE student_id=$1 AND tenant_id=$2
         AND school_date=${IST}::date`, [ch.id, tenantId])).rows[0]?.status ?? null;
      const att30 = (await c.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE status IN ('present','late'))::int AS attended
         FROM app.attendance WHERE student_id=$1 AND tenant_id=$2
         AND school_date >= ${IST}::date - 29`, [ch.id, tenantId])).rows[0];
      // homework due in the next 24h — only when the homework lane is connected
      let homeworkDue = null;
      if (hasHw) {
        homeworkDue = await safeRead(async () => (await c.query(
          `SELECT h.title, h.subject, h.due_at
           FROM teacher.homework h
           LEFT JOIN teacher.submission sub ON sub.homework_id=h.id AND sub.student_id=$1
           WHERE h.class_grade=$2 AND h.tenant_id=$3 AND h.status='open' AND h.due_at > now()
             AND h.due_at < now() + interval '24 hours'
           ORDER BY h.due_at ASC LIMIT 10`, [ch.id, ch.grade, tenantId])).rows);
      }
      // exams announced in the LAST 7 days (the exam schema carries no scheduled
      // exam-date column, so "upcoming" is grounded on announcements, never invented)
      let examsSoon = null;
      if (hasExams) {
        examsSoon = await safeRead(async () => (await c.query(
          `SELECT id, name, term, created_at, published_at
           FROM plugin_exams.exam
           WHERE tenant_id=$1 AND class_grade=$2 AND status IN ('draft','published')
             AND created_at > now() - interval '7 days'
           ORDER BY created_at DESC LIMIT 10`, [tenantId, ch.grade])).rows);
      }
      // pending consents (own child only)
      let consentsPending = 0, consentsList = [];
      if (hasConsent) {
        const cs = await safeRead(async () => (await c.query(
          `SELECT id, kind, title, due_at, status FROM family.consent
           WHERE student_id=$1 AND tenant_id=$2 AND status='pending'
           ORDER BY due_at NULLS LAST LIMIT 10`, [ch.id, tenantId])).rows) ?? [];
        consentsList = cs;
        consentsPending = cs.length;
      }
      // published reports (own child only)
      let reports = null;
      if (hasReports) {
        reports = await safeRead(async () => (await c.query(
          `SELECT r.id, e.name AS exam_name, e.term, r.snapshot->>'pct' AS pct, r.created_at AS published_at
           FROM plugin_exams.report r JOIN plugin_exams.exam e ON e.id=r.exam_id
           WHERE r.student_id=$1 AND r.tenant_id=$2 AND e.status='published'
           ORDER BY r.created_at DESC NULLS LAST LIMIT 12`, [ch.id, tenantId])).rows);
      }
      // fees: open obligations for this child (own child only)
      const feesOpen = (await safeRead(async () => (await c.query(
        `SELECT count(*)::int AS n, COALESCE(sum(amount_cents - paid_cents),0)::bigint AS paise
         FROM app.fee_obligations
         WHERE student_id=$1 AND tenant_id=$2 AND status IN ('open','partial')`,
        [ch.id, tenantId])).rows[0])) ?? { n: 0, paise: 0 };
      out.push({
        child_id: ch.id, name: ch.name, grade: ch.grade, section: ch.section,
        attendance: {
          today: attToday,
          last30_total: att30?.total ?? 0,
          last30_attended: att30?.attended ?? 0,
          last30_pct: att30 && att30.total > 0 ? Math.round((att30.attended / att30.total) * 100) : null,
        },
        homework_due_24h: homeworkDue,          // null when the homework lane isn't connected
        exams_last7d: examsSoon,                // null when the exams lane isn't connected
        consents_pending: consentsPending,
        consents_pending_list: consentsList,
        reports_published: reports ?? null,     // null when the exams lane isn't connected
        fees_open_count: Number(feesOpen?.n ?? 0),
        fees_open_amount_paise: Number(feesOpen?.paise ?? 0),
      });
    }
    // open requests — the GUARDIAN's own tickets (family.request is guardian-scoped)
    const openRequests = (await c.query(
      `SELECT id, category, title, status, created_at FROM family.request
       WHERE guardian_id=$1 AND tenant_id=current_setting('schoolos.tenant_id', true)::uuid
         AND status NOT IN ('resolved','closed')
       ORDER BY created_at DESC LIMIT 10`, [userId])).rows;
    return { children: out, open_requests: openRequests };
  }

  // factual sentence with evidence numbers (deterministic; banned words never used)
  const rupees = (paise) => `₹${(Number(paise) / 100).toLocaleString('en-IN')}`;
  function childSentences(ch, when) {
    const s = [];
    s.push(ch.attendance.today
      ? `${ch.name} is marked ${ch.attendance.today} today.`
      : `${ch.name} has no attendance marked for today yet.`);
    s.push(ch.attendance.last30_total > 0
      ? `Attendance over the last 30 days: ${ch.attendance.last30_attended} of ${ch.attendance.last30_total} days attended (${ch.attendance.last30_pct}%).`
      : `${ch.name} has no attendance records in the last 30 days.`);
    if (ch.homework_due_24h === null) s.push('The homework lane isn\'t connected in this database yet — homework due isn\'t shown.');
    else if (ch.homework_due_24h.length === 0) s.push(`No homework is due in the next 24 hours for ${ch.name}.`);
    else s.push(`${ch.homework_due_24h.length} homework assignment${ch.homework_due_24h.length === 1 ? ' is' : 's are'} due in the next 24 hours: ${ch.homework_due_24h.map((h) => `${h.subject} — ${h.title}`).join('; ')}.`);
    if (ch.exams_last7d === null) s.push('The exams lane isn\'t connected in this database yet — exam announcements aren\'t shown.');
    else if (ch.exams_last7d.length === 0) s.push(`No exams were announced for class ${ch.grade} in the last 7 days.`);
    else s.push(`${ch.exams_last7d.length} exam${ch.exams_last7d.length === 1 ? ' was' : 's were'} announced for class ${ch.grade} in the last 7 days: ${ch.exams_last7d.map((e) => e.name).join(', ')}.`);
    s.push(ch.consents_pending === 0
      ? `${ch.name} has no consents waiting for your decision.`
      : `${ch.consents_pending} consent${ch.consents_pending === 1 ? ' is' : 's are'} waiting for your decision: ${ch.consents_pending_list.map((x) => x.title).join(', ')}.`);
    if (when === 'week') {
      s.push(ch.reports_published
        ? (ch.reports_published.length === 0
          ? `No report cards have been published for ${ch.name} yet.`
          : `${ch.reports_published.length} report card${ch.reports_published.length === 1 ? ' has' : 's have'} been published for ${ch.name}${ch.reports_published.some((r) => r.pct) ? ` — latest scores: ${ch.reports_published.filter((r) => r.pct).map((r) => `${r.exam_name} ${r.pct}%`).join(', ')}` : ''}.`)
        : 'The reports lane isn\'t connected in this database yet — published report counts aren\'t shown.');
      s.push(ch.fees_open_count === 0
        ? `No fee instalments are open for ${ch.name}.`
        : `${ch.fees_open_count} fee instalment${ch.fees_open_count === 1 ? ' is' : 's are'} open for ${ch.name} — ${rupees(ch.fees_open_amount_paise)} outstanding.`);
    }
    return s;
  }

  // ═══════════════════════ GET /parent/brief?when=morning|evening|week ═════════
  app.get('/parent/brief', { preHandler: [require(...GUARDIAN), lifecycleGate] }, async (req, reply) => {
    const when = ['morning', 'evening', 'week'].includes(req.query?.when) ? req.query.when
      : (req.query?.when === undefined ? 'morning' : null);
    if (!when) return bad(reply, 'Choose a brief time: morning, evening or week');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const data = await collectChildren(c, req.user.tenant_id, req.user.id);
      const sentences = [];
      for (const ch of data.children) sentences.push(...childSentences(ch, when));
      if (data.open_requests.length === 0) sentences.push('You have no open requests with the school office.');
      else sentences.push(`You have ${data.open_requests.length} open request${data.open_requests.length === 1 ? '' : 's'} with the school office: ${data.open_requests.map((r) => `"${r.title}" (${r.status})`).join(', ')}.`);
      sentences.push('This brief is a deterministic summary of your family\'s school records — nothing was invented.');
      const payload = {
        when,
        generated_for: new Date().toISOString(),
        children: data.children.map((ch) => ({
          child_id: ch.child_id, name: ch.name, grade: ch.grade, section: ch.section,
          attendance_today: ch.attendance.today,
          attendance_last30_days: { attended: ch.attendance.last30_attended, total: ch.attendance.last30_total, pct: ch.attendance.last30_pct },
          homework_due_24h: ch.homework_due_24h,
          exams_last7d: ch.exams_last7d,
          consents_pending: ch.consents_pending,
          reports_published: ch.reports_published ? ch.reports_published.length : null,
          fees_open: { count: ch.fees_open_count, amount_paise: ch.fees_open_amount_paise },
        })),
        open_requests: data.open_requests.map((r) => ({ id: r.id, title: r.title, category: r.category, status: r.status })),
        sentences,
        label: 'deterministic_summary',
        deterministic: true,
      };
      // provenance: log the exact brief served
      await c.query(
        `INSERT INTO parent.brief_log (tenant_id, user_id, when_kind, payload)
         VALUES ($1,$2,$3,$4::jsonb)`,
        [req.user.tenant_id, req.user.id, when, JSON.stringify(payload)]);
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: `Parent ${when} brief generated`, recordType: 'BriefLog',
        recordRef: when, reason: 'parent assistant brief',
        policyRef: 'PARENTOS-PLAN · deterministic-only assistant · DPDP Act 2023', risk: 'low',
        outcome: `factual aggregation for ${data.children.length} linked child${data.children.length === 1 ? '' : 'ren'} · no LLM` });
      return payload;
    });
  });

  // ═══════════════════════ POST /parent/copilot/ask {question} ═════════════════
  app.post('/parent/copilot/ask', { preHandler: [require(...GUARDIAN), lifecycleGate] }, async (req, reply) => {
    const question = String(req.body?.question ?? '').trim();
    if (!question) return bad(reply, 'Ask a question — for example "what homework is due?" or "any exams coming up?"');
    if (question.length > 500) return bad(reply, 'Please keep the question under 500 characters');
    const qLower = question.toLowerCase();
    // intent keywords — first match wins (order matters: leave before attendance)
    const INTENTS = [
      ['homework', ['homework', 'assignment', 'due']],
      ['exam', ['exam', 'test', 'assessment']],
      ['attendance', ['attendance', 'absent', 'present']],
      ['fees', ['fee', 'fees', 'instalment', 'installment', 'payment', 'paid']],
      ['consent', ['consent', 'permission', 'trip', 'photo']],
      ['leave', ['leave', 'holiday', 'off']],
      ['request', ['request', 'complaint', 'ticket', 'certificate', 'bonafide']],
      ['report', ['report', 'result', 'score', 'marks', 'grade']],
    ];
    const intent = INTENTS.find(([, words]) => words.some((w) => qLower.includes(w)))?.[0] ?? null;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const used = await budgetUsedThisMonth(c, req);
      if (used >= MONTHLY_CAP)
        return reply.code(429).send({ error: `You've used your ${MONTHLY_CAP} questions for this month — the limit resets next month`, budget: { used, cap: MONTHLY_CAP, budgetClass: BUDGET_CLASS } });
      const data = await collectChildren(c, req.user.tenant_id, req.user.id);
      const sources = [];
      let answer = null;

      if (intent === 'homework') {
        sources.push({ kind: 'homework', table: 'teacher.homework', available: data.children.some((ch) => ch.homework_due_24h !== null) });
        const items = data.children.filter((ch) => ch.homework_due_24h?.length);
        answer = items.length
          ? `Homework due in the next 24 hours: ${items.map((ch) => `${ch.name} — ${ch.homework_due_24h.map((h) => `${h.subject} "${h.title}" (due ${String(h.due_at).slice(0, 16).replace('T', ' ')})`).join('; ')}`).join(' · ')}.`
          : (data.children.some((ch) => ch.homework_due_24h !== null)
            ? 'No homework is due in the next 24 hours for your children.'
            : 'The homework lane isn\'t connected in this database yet, so I can\'t see homework due.');
      } else if (intent === 'exam') {
        sources.push({ kind: 'exams', table: 'plugin_exams.exam', available: data.children.some((ch) => ch.exams_last7d !== null) });
        const items = data.children.filter((ch) => ch.exams_last7d?.length);
        answer = items.length
          ? `Exams announced for your children's classes in the last 7 days: ${items.map((ch) => `${ch.name} (class ${ch.grade}) — ${ch.exams_last7d.map((e) => e.name).join(', ')}`).join(' · ')}.`
          : (data.children.some((ch) => ch.exams_last7d !== null)
            ? 'No exams were announced for your children\'s classes in the last 7 days.'
            : 'The exams lane isn\'t connected in this database yet, so I can\'t see exam announcements.');
      } else if (intent === 'attendance') {
        sources.push({ kind: 'attendance', table: 'app.attendance' });
        answer = data.children.map((ch) => ch.attendance.today
          ? `${ch.name} is marked ${ch.attendance.today} today; last 30 days: ${ch.attendance.last30_attended} of ${ch.attendance.last30_total} days attended (${ch.attendance.last30_pct}%).`
          : `${ch.name} has no attendance marked for today yet; last 30 days: ${ch.attendance.last30_attended} of ${ch.attendance.last30_total} days attended${ch.attendance.last30_total ? ` (${ch.attendance.last30_pct}%)` : ''}.`).join(' ');
      } else if (intent === 'fees') {
        sources.push({ kind: 'fees', table: 'app.fee_obligations' });
        const withOpen = data.children.filter((ch) => ch.fees_open_count > 0);
        answer = withOpen.length
          ? `Open fee instalments: ${withOpen.map((ch) => `${ch.name} — ${ch.fees_open_count} instalment${ch.fees_open_count === 1 ? '' : 's'} open, ${rupees(ch.fees_open_amount_paise)} outstanding`).join(' · ')}. You can pay from the fees screen.`
          : 'No fee instalments are open for your children right now.';
      } else if (intent === 'consent') {
        sources.push({ kind: 'consents', table: 'family.consent' });
        const pending = data.children.filter((ch) => ch.consents_pending > 0);
        answer = pending.length
          ? `Consents waiting for your decision: ${pending.map((ch) => `${ch.name} — ${ch.consents_pending_list.map((x) => `"${x.title}"`).join(', ')}`).join(' · ')}. You can decide in Consents.`
          : 'No consents are waiting for your decision.';
      } else if (intent === 'request') {
        sources.push({ kind: 'requests', table: 'family.request' });
        answer = data.open_requests.length
          ? `Your open requests with the school office (${data.open_requests.length}): ${data.open_requests.map((r) => `"${r.title}" — filed as ${r.category}, status ${r.status}`).join('; ')}.`
          : 'You have no open requests with the school office right now. You can file one under Requests.';
      } else if (intent === 'leave') {
        sources.push({ kind: 'requests', table: 'family.request' });
        const leaves = data.open_requests.filter((r) => r.category === 'leave');
        answer = leaves.length
          ? `Your open leave requests: ${leaves.map((r) => `"${r.title}" — status ${r.status}`).join('; ')}.`
          : 'You have no open leave requests. To ask for leave, file a request under Requests — the school office decides.';
      } else if (intent === 'report') {
        sources.push({ kind: 'reports', table: 'plugin_exams.report', available: data.children.some((ch) => ch.reports_published !== null) });
        const items = data.children.filter((ch) => ch.reports_published?.length);
        answer = items.length
          ? `Published report cards: ${items.map((ch) => `${ch.name} — ${ch.reports_published.map((r) => `${r.exam_name}${r.pct ? ` ${r.pct}%` : ''}`).join(', ')}`).join(' · ')}. Growth across results matters more than any single score.`
          : (data.children.some((ch) => ch.reports_published !== null)
            ? 'No report cards have been published for your children yet — the school publishes them after each exam.'
            : 'The reports lane isn\'t connected in this database yet.');
      }

      // honest unknown: this v0 routes by keyword only — anything else gets the truth
      if (!answer) {
        sources.push({ kind: 'none', available: false });
        answer = HONEST_UNKNOWN;
      }
      await budgetWrite(c, req, 'ask', question, sources);
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Parent copilot ask answered (deterministic)', recordType: 'CopilotCall',
        recordRef: 'ask', reason: question.slice(0, 120),
        policyRef: 'P-copilot budget classes · deterministic-only · DPDP Act 2023',
        aiInvolved: false, risk: 'low',
        outcome: `keyword-routed to ${sources.map((x) => x.kind).join(', ')} · composed from own-child records · budget ${used + 1}/${MONTHLY_CAP} this month` });
      return { ok: true, question, intent, answer, sources, label: 'deterministic_answer',
        deterministic: true, budget: { used: used + 1, cap: MONTHLY_CAP, budgetClass: BUDGET_CLASS } };
    });
  });

  // ═══════════════════════ POST /parent/copilot/draft ══════════════════════════
  // {kind: question_to_teacher|leave_note, params} → deterministic TEMPLATE draft,
  // labelled ai_draft. The parent edits before sending — a draft never sends anything.
  app.post('/parent/copilot/draft', { preHandler: [require(...GUARDIAN), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    const kind = String(b.kind ?? '');
    if (!['question_to_teacher', 'leave_note'].includes(kind))
      return bad(reply, 'Pick a draft type: question_to_teacher or leave_note');
    const params = (b.params && typeof b.params === 'object') ? b.params : {};
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const used = await budgetUsedThisMonth(c, req);
      if (used >= MONTHLY_CAP)
        return reply.code(429).send({ error: `You've used your ${MONTHLY_CAP} drafts for this month — the limit resets next month`, budget: { used, cap: MONTHLY_CAP, budgetClass: BUDGET_CLASS } });
      // optional grounding: the child must be the guardian's OWN child
      let child = null;
      if (params.childId) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(params.childId)))
          return bad(reply, 'This record needs a valid child ID');
        if (!(await assertOwnChild(c, req.user.id, params.childId)))
          return bad(reply, 'This child is not linked to your family account', 403);
        child = (await c.query(`SELECT id, name, grade, section FROM app.students WHERE id=$1 AND tenant_id=$2`,
          [params.childId, req.user.tenant_id])).rows[0] ?? null;
      }
      const subject = params.subject ? String(params.subject).slice(0, 80) : null;
      const focus = params.focus ? String(params.focus).slice(0, 300) : null;
      let title = '', draft = '';
      if (kind === 'question_to_teacher') {
        title = `Question to the teacher${child ? ` — ${child.name}` : ''}${subject ? ` (${subject})` : ''}`;
        draft = [
          'QUESTION TO THE TEACHER (ai_draft — please edit in your own words before sending)',
          child ? `About: ${child.name}, class ${child.grade}-${child.section}` : 'About: my child',
          subject ? `Subject: ${subject}` : null,
          '',
          focus ? `My question: ${focus}` : 'My question: (write your question here)',
          '',
          'Could you please help me understand this when you have a moment?',
          `— ${req.user.name} (parent)`,
          'This draft was assembled from a template — nothing was invented and nothing is sent until you send it.',
        ].filter((l) => l !== null).join('\n');
      } else { // leave_note
        const dates = params.dates ? String(params.dates).slice(0, 60) : null;
        const reason = params.reason ? String(params.reason).slice(0, 300) : null;
        title = `Leave note${child ? ` — ${child.name}` : ''}${dates ? ` (${dates})` : ''}`;
        draft = [
          'LEAVE NOTE (ai_draft — please edit before sending)',
          child ? `Student: ${child.name}, class ${child.grade}-${child.section}` : 'Student: (your child\'s name and class)',
          dates ? `Leave dates: ${dates}` : 'Leave dates: (write the dates)',
          reason ? `Reason: ${reason}` : 'Reason: (write the reason)',
          '',
          'Requesting you to kindly grant leave for the dates above. Classwork will be caught up promptly.',
          `— ${req.user.name} (parent)`,
          'To actually request leave, file it under Requests — the school office decides. This draft never sends anything.',
        ].join('\n');
      }
      const sources = child ? [{ kind: 'students', table: 'app.students' }] : [];
      await budgetWrite(c, req, 'draft', null, sources);
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: `Parent copilot draft generated (${kind})`, recordType: 'CopilotCall',
        recordRef: kind, reason: 'parent draft request',
        policyRef: 'P-copilot budget classes · deterministic-only · drafts are never auto-sent',
        aiInvolved: false, risk: 'low',
        outcome: `deterministic template (labelled ai_draft) · no model call · budget ${used + 1}/${MONTHLY_CAP} this month` });
      return { ok: true, kind, title, draft, label: 'ai_draft', deterministic: true,
        child_id: child?.id ?? null,
        budget: { used: used + 1, cap: MONTHLY_CAP, budgetClass: BUDGET_CLASS } };
    });
  });

  // ═══════════════════════ GET /parent/explain/:topic ══════════════════════════
  // {meaning, why, what_you_can_do} built from REAL own-child numbers.
  app.get('/parent/explain/:topic', { preHandler: [require(...GUARDIAN), lifecycleGate] }, async (req, reply) => {
    const topic = String(req.params.topic ?? '');
    if (!['attendance', 'report', 'fees'].includes(topic))
      return bad(reply, 'Pick a topic to understand: attendance, report or fees');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const data = await collectChildren(c, req.user.tenant_id, req.user.id);
      let meaning = '', why = '', whatYouCanDo = '';
      if (topic === 'attendance') {
        const lines = data.children.map((ch) => ch.attendance.last30_total > 0
          ? `${ch.name}: attended ${ch.attendance.last30_attended} of the last ${ch.attendance.last30_total} school days (${ch.attendance.last30_pct}%)${ch.attendance.today ? `, today marked ${ch.attendance.today}` : ', today not marked yet'}.`
          : `${ch.name}: no attendance records yet.`);
        meaning = 'Attendance shows the days your child was present at school. Schools record it every day: present, late, or absent. Approved leave is never counted against attendance.';
        why = 'Regular attendance helps your child keep up with classwork day by day — lessons build on each other, and CBSE exam eligibility is linked to attendance.';
        whatYouCanDo = lines.length
          ? `Your numbers right now: ${lines.join(' ')} If a day was marked absent but your child was actually at school or on approved leave, file a request under Requests and the office will verify it.`
          : 'No attendance has been recorded for your children yet. If a marked day looks wrong, file a request under Requests and the office will verify it.';
      } else if (topic === 'report') {
        const lines = data.children.map((ch) => ch.reports_published
          ? (ch.reports_published.length === 0
            ? `${ch.name}: no report cards published yet.`
            : `${ch.name}: ${ch.reports_published.length} report card${ch.reports_published.length === 1 ? '' : 's'} published${ch.reports_published.some((r) => r.pct) ? ` — ${ch.reports_published.filter((r) => r.pct).map((r) => `${r.exam_name} ${r.pct}%`).join(', ')}` : ''}.`)
          : `${ch.name}: the reports lane isn't connected yet.`);
        meaning = 'A report card shows how your child did in a published exam: subject marks, a total percentage, and a grade. Only exams the school has published appear here.';
        why = 'One exam measures one point in time. The pattern across report cards shows what is working and what needs more practice — that is the number worth watching.';
        whatYouCanDo = lines.length
          ? `Your numbers right now: ${lines.join(' ')} Look at the change from one report to the next, and ask the class teacher about one specific topic rather than the whole score.`
          : 'Once the school publishes report cards, your children\'s numbers will appear here.';
      } else { // fees
        const lines = data.children.map((ch) => ch.fees_open_count > 0
          ? `${ch.name}: ${ch.fees_open_count} instalment${ch.fees_open_count === 1 ? '' : 's'} open, ${rupees(ch.fees_open_amount_paise)} outstanding.`
          : `${ch.name}: all instalments paid.`);
        meaning = 'Fees are recorded as instalments: each has an amount, a due date, and what has been paid so far. "Open" means part of the amount is still to be paid.';
        why = 'The school plans resources around fee instalments, and receipts are issued against each payment — keeping instalments current avoids late-payment complications.';
        whatYouCanDo = lines.length
          ? `Your numbers right now: ${lines.join(' ')} You can pay from the fees screen; every payment gets a receipt. If an amount looks wrong, file a request under Requests — parents never edit fee records directly.`
          : 'Your numbers right now: nothing is open for your children. If a charge looks wrong, file a request under Requests — parents never edit fee records directly.';
      }
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: `Explain ${topic}`, recordType: 'BriefLog',
        recordRef: topic, reason: 'parent assistant explain',
        policyRef: 'PARENTOS-PLAN · plain-language explains from real numbers', risk: 'low',
        outcome: `deterministic explain built from own-child records` });
      return { topic, meaning, why, what_you_can_do: whatYouCanDo, deterministic: true };
    });
  });
}
