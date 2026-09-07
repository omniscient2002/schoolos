// student.world — runtime module (migration 036, StudentOS lane SS-1).
// The student world on SCHOOL computers/kiosks — students have no personal phones
// (§78/§79), so session isolation on shared machines is a security requirement:
//   · NO CROSS-STUDENT ACCESS anywhere. User-owned rows (mistakes, flashcards, tasks,
//     print jobs) run through a user-scoped connection whose RLS policy pins BOTH the
//     tenant GUC AND schoolos.user_id (032 teacher.note precedent) — tenant match alone
//     is never enough to see a student's rows.
//   · IDENTITY PIN — the kernel has role 'student' (auth.js ROLES · selfOnly) but no
//     user↔student FK anywhere. A student resolves to their own app.students row by the
//     demo name-match used across the tree (seed.js creates user student@meridian.edu =
//     'Aarav Sharma' against exactly one student row of that name; 034 seeds
//     family.child_link by the same name match). Pinned in ownStudent() below.
//   · SESSION ISOLATION HEADERS — every /student/* response carries Cache-Control:
//     no-store + Pragma: no-cache (hook below; headers ride even on auth failures —
//     the safe direction). /auth/logout lives in app.js and is registered before this
//     loader mounts, so the student-role Clear-Site-Data header cannot be attached from
//     here (Fastify snapshots hooks at route-registration time) — the one-line
//     routes.js/app.js suggestion for the orchestrator is in the SS-1 handoff; the
//     kiosk UI meanwhile drives idle-expiry via GET /student/session.
//   · GRACEFUL DEGRADATION — teacher.homework (031 lane, not yet on disk) and
//     plugin_exams are read via information_schema probes; absent tables yield empty
//     sections, never 500s.
import { pool } from '../../db.js';
import { makeLifecycleGate } from '../_shared/lifecycle-gate.js';
import { uuidParams } from '../_shared/uuid-param.js';

const ID = 'student.world';
export { default as manifest } from './manifest.js';

const STUDENT = ['student'];
// staff surfaces: print queue + noticeboard. Wellbeing is narrower (counselor/principal
// designees — never the classroom teacher, safety-box rule).
const STAFF = ['teacher', 'coordinator', 'principal', 'owner', 'itadmin'];
const WELLBEING_READERS = ['principal', 'coordinator', 'owner', 'itadmin'];
const PRINT_KINDS = ['timetable', 'study_plan', 'checklist', 'portfolio', 'mistake_sheet', 'flashcards', 'noticeboard'];
const WELLBEING_CATEGORIES = ['academic_pressure', 'friendship', 'bullying', 'family', 'health', 'other'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });

// §78/§79: Asia/Kolkata clock (kiosks may sit in any timezone; the school day is IST)
const istNow = () => new Date(Date.now() + 5.5 * 3600 * 1000);
const istDayName = () => WEEKDAYS[istNow().getUTCDay()];
const istDate = () => istNow().toISOString().slice(0, 10);
const istTime = () => istNow().toISOString().slice(11, 16); // 'HH:MM'

export function register(app, kernel) {
  const { withUser, requestAudit, emitEvent, require } = kernel;
  const lifecycleGate = makeLifecycleGate(kernel.q, ID);
  const settingsFor = (c, tenantId) =>
    c.query(`SELECT settings FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`, [tenantId, ID])
      .then((r) => r.rows[0]?.settings ?? {});

  // ── session-isolation headers (§78/§79) ─────────────────────────────────────
  // Registered BEFORE this module's routes mount, so it scopes exactly the /student/*
  // doors (Fastify snapshots hooks at route registration; /auth/logout was registered
  // earlier and is a shared file — one-line suggestion documented in the handoff).
  // Clear-Site-Data rides every /student/* response (the sanctioned fallback): the
  // shared-machine browser clears cache + storage between student sessions, so nothing
  // leaks to the next student on the kiosk.
  app.addHook('onSend', async (req, reply, payload) => {
    const url = req.raw?.url ?? '';
    if (url === '/student' || url.startsWith('/student/') || url.startsWith('/student?')) {
      reply.header('Cache-Control', 'no-store');
      reply.header('Pragma', 'no-cache');
      reply.header('Clear-Site-Data', '"cache", "storage"');
    }
    return payload;
  });

  // ── user-scoped connection (§78/§79 belt-and-braces): tenant + user_id GUCs + app role.
  // The owner_scoped RLS policies on student.mistake_note/flashcard/study_task read
  // schoolos.user_id; a tenant-matched row is invisible unless the GUC names its owner.
  const withStudentUser = (tenantId, userId, fn) =>
    (async () => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await c.query(`SELECT set_config('schoolos.tenant_id', $1::text, true)`, [String(tenantId)]);
        await c.query(`SELECT set_config('schoolos.user_id', $1::text, true)`, [String(userId)]);
        await c.query(`SELECT set_config('schoolos.role', 'student', true)`);
        await c.query('SET LOCAL ROLE schoolos_app');
        const out = await fn(c);
        await c.query('COMMIT');
        return out;
      } catch (e) {
        try { await c.query('ROLLBACK'); } catch { /* noop */ }
        throw e;
      } finally {
        c.release();
      }
    })();

  const tableExists = async (c, name) =>
    !!(await c.query(`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [name])).rows.length;
  const columnExists = async (c, table, column) =>
    !!(await c.query(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2`, [table, column])).rows.length;

  // ── IDENTITY PIN: student role → own app.students row (demo name-match, see header)
  const ownStudent = async (c, user) =>
    (await c.query(
      `SELECT id, name, grade, section, admission_no
       FROM app.students
       WHERE tenant_id=$1 AND status='active' AND lower(name)=lower($2)
       ORDER BY created_at LIMIT 1`, [user.tenant_id, user.name])).rows[0] ?? null;

  // timetable grid read (app.timetable_slots has no class/section column — 021 — the
  // demo grid is uniform per section; the student's own day is the tenant day grid)
  const daySlots = async (c, tenantId, dayName) => (await c.query(
    `SELECT p.seq, p.label, p.start_time, p.end_time, s.subject, s.teacher_name, s.room
     FROM app.timetable_slots s JOIN app.timetable_periods p ON p.id=s.period_id
     WHERE s.tenant_id=$1 AND s.day_of_week=$2
     ORDER BY p.sort_idx, s.subject`, [tenantId, dayName]).catch(() => ({ rows: [] }))).rows;

  // homework read plane (031 lane may be absent): mode split per SS-1 brief
  const homeworkRows = async (c, tenantId, grade) => {
    if (!(await tableExists(c, 'teacher.homework'))) return null; // absent → null (degrade)
    const hasMode = await columnExists(c, 'teacher.homework', 'mode');
    const rows = (await c.query(
      `SELECT id, title, subject, detail, due_at${hasMode ? ', mode' : ''}
       FROM teacher.homework
       WHERE tenant_id=$1 AND class_grade=$2 AND (status IS NULL OR status <> 'archived')
       ORDER BY due_at ASC NULLS LAST LIMIT 50`, [tenantId, grade]).catch(() => ({ rows: [] }))).rows;
    const isPaper = (h) =>
      (hasMode && String(h.mode ?? '').toLowerCase().includes('paper')) ||
      /notebook|paper/i.test(String(h.detail ?? ''));
    const digital = rows.filter((h) => !isPaper(h)).map((h) => ({
      id: h.id, title: h.title, subject: h.subject, due_at: h.due_at, note: 'Submit online or show the teacher in class',
    }));
    const paper = rows.filter((h) => isPaper(h)).map((h) => ({
      id: h.id, title: h.title, subject: h.subject, due_at: h.due_at, note: 'Complete in notebook — teacher marks receipt',
    }));
    return { digital, paper };
  };

  // published reports for one student (absent plugin_exams → [])
  const publishedReports = async (c, tenantId, studentId) => (await c.query(
    `SELECT e.name AS exam_name, e.term, r.snapshot, r.created_at
     FROM plugin_exams.report r JOIN plugin_exams.exam e ON e.id=r.exam_id
     WHERE r.tenant_id=$1 AND r.student_id=$2 AND e.status='published'
     ORDER BY r.created_at DESC LIMIT 12`, [tenantId, studentId]).catch(() => ({ rows: [] }))).rows;

  const explainFor = (r) =>
    r.pct == null ? 'Result details will appear here once the school publishes them.' :
    `This result is from ${r.exam_name}. It shows what was understood at that point — growth across results matters more than any single score.`;

  // ── GET /student/home — own data only (contracts: student.home.v1) ──────────
  app.get('/student/home', { preHandler: [require(...STUDENT), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const me = await ownStudent(c, req.user);
      const today = istDayName();
      const slots = me ? await daySlots(c, req.user.tenant_id, today) : [];
      const nowT = istTime();
      const current = slots.find((s) => s.start_time <= nowT && nowT < s.end_time) ?? null;
      const upcoming = slots.find((s) => s.start_time > nowT) ?? null;
      const nextSlot = current ?? upcoming;
      const next_class = nextSlot ? {
        period: nextSlot.label, seq: nextSlot.seq, subject: nextSlot.subject,
        teacher: nextSlot.teacher_name, room: nextSlot.room ?? null,
        start_time: nextSlot.start_time, end_time: nextSlot.end_time,
        now: !!current,
      } : null;
      const hw = me ? await homeworkRows(c, req.user.tenant_id, me.grade) : null;
      const exams = me ? (await c.query(
        `SELECT name, term, status, published_at FROM plugin_exams.exam
         WHERE tenant_id=$1 AND class_grade=$2
         ORDER BY created_at DESC LIMIT 8`, [req.user.tenant_id, me.grade]).catch(() => ({ rows: [] }))).rows : [];
      const upcoming_test = exams.find((e) => e.status === 'published')
        ? { name: exams.find((e) => e.status === 'published').name, term: exams.find((e) => e.status === 'published').term }
        : null;
      const needs_attention = [];
      const nowMs = istNow().getTime();
      for (const h of [...(hw?.digital ?? []), ...(hw?.paper ?? [])])
        if (h.due_at && new Date(h.due_at).getTime() < nowMs)
          needs_attention.push({ text: `Overdue homework: ${h.subject ?? ''} ${h.title}`.trim(), ref: '/student/homework' });
      const tomorrowDay = WEEKDAYS[(istNow().getUTCDay() + 1) % 7];
      const tomorrowSlots = me ? await daySlots(c, req.user.tenant_id, tomorrowDay) : [];
      if (tomorrowSlots.length === 0 && exams.length)
        needs_attention.push({ text: `Check the results board — ${exams[0].name} was published`, ref: '/student/results' });
      // progress: last two published pcts per exam (exam carries no subject column — keyed by exam name)
      const progress = [];
      if (me) {
        const byExam = new Map();
        for (const r of await publishedReports(c, req.user.tenant_id, me.id)) {
          const pct = Number(r.snapshot?.pct);
          if (!Number.isFinite(pct)) continue;
          if (!byExam.has(r.exam_name)) byExam.set(r.exam_name, []);
          byExam.get(r.exam_name).push(pct); // reports DESC by created_at → [newest, previous, …]
        }
        for (const [examName, pcts] of byExam) {
          const [newest, previous] = pcts;
          const direction = previous == null ? 'steady' : newest > previous ? 'improving' : newest < previous ? 'declining' : 'steady';
          progress.push({ subject: examName, direction, latest_pct: newest });
        }
      }
      const bag = [];
      const bagSubjects = [...new Set(tomorrowSlots.map((s) => s.subject))];
      for (const subject of bagSubjects)
        bag.push({ text: /lab/i.test(subject) ? `${subject} — lab record, apron and kit` : `${subject} — textbook and notebook` });
      const idle = Math.max(1, parseInt(process.env.STUDENT_IDLE_TIMEOUT_MINUTES ?? '10', 10) || 10);
      return {
        student: me ? { name: me.name, grade: me.grade, section: me.section, admission_no: me.admission_no } : null,
        next_class,
        today: {
          classes_count: slots.length ? new Set(slots.map((s) => s.seq)).size : 0,
          assignments_due: hw ? hw.digital.length + hw.paper.length : null,
          upcoming_test,
        },
        needs_attention,
        progress,
        bag_tomorrow: bag,
        session: { idle_minutes: idle, logout_url: '/auth/logout' },
        note: me ? undefined : 'Your class link is not set up yet — ask your class teacher to check your name spelling in the school records.',
      };
    });
  });

  // ── GET /student/homework — digital/paper split (information_schema probes) ──
  app.get('/student/homework', { preHandler: [require(...STUDENT), lifecycleGate] }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const me = await ownStudent(c, req.user);
      if (!me) return { digital: [], paper: [], note: 'Your class link is not set up yet — ask your class teacher.' };
      const hw = await homeworkRows(c, req.user.tenant_id, me.grade);
      if (!hw) return { digital: [], paper: [], note: 'No homework system connected yet — check the class noticeboard.' };
      return { digital: hw.digital, paper: hw.paper, note: 'Paper homework needs no submission here — complete it in your notebook; the teacher marks receipt.' };
    });
  });

  // ── GET /student/results — own published reports + plain explains ───────────
  app.get('/student/results', { preHandler: [require(...STUDENT), lifecycleGate] }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const me = await ownStudent(c, req.user);
      if (!me) return { reports: [], note: 'Your class link is not set up yet — ask your class teacher.' };
      const rows = await publishedReports(c, req.user.tenant_id, me.id);
      return {
        student: { name: me.name, grade: me.grade },
        reports: rows.map((r) => {
          const pct = r.snapshot?.pct ?? null;
          const row = { exam: r.exam_name, term: r.term, pct, grade: r.snapshot?.grade ?? null, publishedAt: r.created_at };
          return { ...row, explain: explainFor({ exam_name: r.exam_name, pct }) };
        }),
        note: rows.length ? undefined : 'No results published yet — they will appear here when the school publishes them.',
      };
    });
  });

  // ── mistake notes (strictly user-owned; RLS pins schoolos.user_id) ──────────
  app.post('/student/mistakes', { preHandler: [require(...STUDENT), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    for (const [f, label] of [['subject', 'subject'], ['topic', 'topic'], ['what_wrong', 'what went wrong'], ['correction', 'the corrected answer']])
      if (!b[f] || !String(b[f]).trim()) return bad(reply, `Please add ${label}`);
    return withStudentUser(req.user.tenant_id, req.user.id, async (c) => {
      const me = await ownStudent(c, req.user);
      const row = (await c.query(
        `INSERT INTO student.mistake_note (tenant_id, creator_user_id, student_id, subject, topic, what_wrong, correction, lesson)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, created_at`,
        [req.user.tenant_id, req.user.id, me?.id ?? null,
         String(b.subject).slice(0, 80), String(b.topic).slice(0, 200),
         String(b.what_wrong).slice(0, 2000), String(b.correction).slice(0, 2000),
         b.lesson ? String(b.lesson).slice(0, 1000) : null])).rows[0];
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Mistake note saved', recordType: 'MistakeNote', recordRef: row.id,
        reason: `${b.subject}: ${b.topic}`, policyRef: 'STUDENTOS-PLAN · self-study plane', risk: 'low',
        outcome: 'own-row created (owner-scoped RLS)' });
      return { ok: true, id: row.id, createdAt: row.created_at };
    });
  });

  app.get('/student/mistakes', { preHandler: [require(...STUDENT), lifecycleGate] }, async (req) => {
    return withStudentUser(req.user.tenant_id, req.user.id, async (c) => {
      const rows = (await c.query(
        `SELECT id, subject, topic, what_wrong, correction, lesson, created_at
         FROM student.mistake_note WHERE creator_user_id=$1 ORDER BY created_at DESC LIMIT 100`,
        [req.user.id])).rows;
      return { mistakes: rows };
    });
  });

  app.delete('/student/mistakes/:id', { preHandler: [require(...STUDENT), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    return withStudentUser(req.user.tenant_id, req.user.id, async (c) => {
      const del = await c.query(
        `DELETE FROM student.mistake_note WHERE id=$1 AND creator_user_id=$2 RETURNING id`, [req.params.id, req.user.id]);
      if (!del.rows[0]) return bad(reply, 'We couldn\'t find that note in your notebook', 404);
      return { ok: true };
    });
  });

  // ── flashcards (strictly user-owned) ────────────────────────────────────────
  app.post('/student/flashcards', { preHandler: [require(...STUDENT), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.deck || !String(b.deck).trim()) return bad(reply, 'Name the deck this card belongs to');
    if (!b.front || !String(b.front).trim()) return bad(reply, 'Please add the question (front of the card)');
    if (!b.back || !String(b.back).trim()) return bad(reply, 'Please add the answer (back of the card)');
    return withStudentUser(req.user.tenant_id, req.user.id, async (c) => {
      const me = await ownStudent(c, req.user);
      const row = (await c.query(
        `INSERT INTO student.flashcard (tenant_id, creator_user_id, student_id, deck, front, back, subject, topic)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [req.user.tenant_id, req.user.id, me?.id ?? null, String(b.deck).slice(0, 120),
         String(b.front).slice(0, 1000), String(b.back).slice(0, 1000),
         b.subject ? String(b.subject).slice(0, 80) : null, b.topic ? String(b.topic).slice(0, 200) : null])).rows[0];
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Flashcard added', recordType: 'Flashcard', recordRef: row.id,
        reason: `deck ${b.deck}`, policyRef: 'STUDENTOS-PLAN · self-study plane', risk: 'low',
        outcome: 'own-row created (owner-scoped RLS)' });
      return { ok: true, id: row.id };
    });
  });

  app.get('/student/flashcards', { preHandler: [require(...STUDENT), lifecycleGate] }, async (req) => {
    return withStudentUser(req.user.tenant_id, req.user.id, async (c) => {
      const deck = req.query?.deck ?? null;
      const rows = (await c.query(
        `SELECT id, deck, front, back, subject, topic, created_at
         FROM student.flashcard
         WHERE creator_user_id=$1 AND ($2::text IS NULL OR deck=$2)
         ORDER BY created_at DESC LIMIT 200`, [req.user.id, deck])).rows;
      const decks = (await c.query(
        `SELECT deck, count(*)::int AS cards FROM student.flashcard WHERE creator_user_id=$1 GROUP BY deck ORDER BY deck`,
        [req.user.id])).rows;
      return { flashcards: rows, decks };
    });
  });

  // ── study tasks (user-owned; GET also mirrors homework as checklist items) ──
  app.get('/student/tasks', { preHandler: [require(...STUDENT), lifecycleGate] }, async (req) => {
    return withStudentUser(req.user.tenant_id, req.user.id, async (c) => {
      const tasks = (await c.query(
        `SELECT id, title, due_date, done, done_at, created_at
         FROM student.study_task WHERE creator_user_id=$1 ORDER BY done ASC, due_date NULLS LAST, created_at DESC LIMIT 100`,
        [req.user.id])).rows;
      const me = await ownStudent(c, req.user);
      const hw = me ? await homeworkRows(c, req.user.tenant_id, me.grade) : null;
      const tasks_view = hw
        ? [...hw.digital, ...hw.paper].map((h) => ({
            id: `homework:${h.id}`, title: `${h.subject ?? ''}: ${h.title}`.trim(),
            due_date: h.due_at ? String(h.due_at).slice(0, 10) : null, done: null, source: 'homework', note: h.note,
          }))
        : [];
      return { tasks, tasks_view };
    });
  });

  app.post('/student/tasks', { preHandler: [require(...STUDENT), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (b.id) { // done toggle on an own task
      return withStudentUser(req.user.tenant_id, req.user.id, async (c) => {
        const upd = await c.query(
          `UPDATE student.study_task SET done=$2, done_at=$3, updated_at=now()
           WHERE id=$1 AND creator_user_id=$4 RETURNING id, done`, [b.id, !!b.done, b.done ? new Date().toISOString() : null, req.user.id]);
        if (!upd.rows[0]) return bad(reply, 'We couldn\'t find that task in your list', 404);
        return { ok: true, id: upd.rows[0].id, done: upd.rows[0].done };
      });
    }
    if (!b.title || !String(b.title).trim()) return bad(reply, 'Please add what you want to get done');
    if (b.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.due_date))) return bad(reply, 'Due date should be YYYY-MM-DD');
    return withStudentUser(req.user.tenant_id, req.user.id, async (c) => {
      const me = await ownStudent(c, req.user);
      const row = (await c.query(
        `INSERT INTO student.study_task (tenant_id, creator_user_id, student_id, title, due_date)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, done`,
        [req.user.tenant_id, req.user.id, me?.id ?? null, String(b.title).slice(0, 200), b.due_date ?? null])).rows[0];
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Study task created', recordType: 'StudyTask', recordRef: row.id,
        reason: String(b.title).slice(0, 200), policyRef: 'STUDENTOS-PLAN · self-study plane', risk: 'low',
        outcome: 'own-row created (owner-scoped RLS)' });
      return { ok: true, id: row.id, done: row.done };
    });
  });

  // ── print jobs: student queues, school prints (§78/§79 kiosk reality) ──────
  app.post('/student/print', { preHandler: [require(...STUDENT), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!PRINT_KINDS.includes(b.kind)) return bad(reply, 'Choose what to print: timetable, study plan, checklist, portfolio, mistake sheet, flashcards or noticeboard');
    return withStudentUser(req.user.tenant_id, req.user.id, async (c) => {
      const me = await ownStudent(c, req.user);
      const row = (await c.query(
        `INSERT INTO student.print_job (tenant_id, creator_user_id, student_id, kind, payload)
         VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING id, status, created_at`,
        [req.user.tenant_id, req.user.id, me?.id ?? null, b.kind, JSON.stringify(b.payload ?? {})])).rows[0];
      await emitEvent(c, req.user.tenant_id,
        { type: 'student', label: `Print queued: ${b.kind} — ${me?.name ?? req.user.name}`, ref: row.id },
        'student.print.v1', { printJobId: row.id, kind: b.kind, studentId: me?.id ?? null });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: `Print queued (${b.kind})`, recordType: 'PrintJob', recordRef: row.id,
        reason: 'school-controlled printing — office/teacher discharges', policyRef: 'STUDENTOS-PLAN §78 (kiosk print plane)', risk: 'low',
        outcome: 'status queued' });
      return { ok: true, id: row.id, status: row.status, note: 'The school office will print this for you. Check your print list for the status.' };
    });
  });

  app.get('/student/print/mine', { preHandler: [require(...STUDENT), lifecycleGate] }, async (req) => {
    return withStudentUser(req.user.tenant_id, req.user.id, async (c) => {
      const rows = (await c.query(
        `SELECT id, kind, status, created_at, printed_at FROM student.print_job
         WHERE creator_user_id=$1 ORDER BY created_at DESC LIMIT 30`, [req.user.id])).rows;
      return { jobs: rows };
    });
  });

  // staff queue — teacher/office tier: every queued job with student name + kind
  app.get('/student/print/queue', { preHandler: [require(...STAFF), lifecycleGate] }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const rows = (await c.query(
        `SELECT j.id, j.kind, j.status, j.created_at, j.printed_at,
                COALESCE(s.name, u.name) AS student_name,
                CASE WHEN s.id IS NOT NULL THEN s.grade || '-' || s.section END AS class
         FROM student.print_job j
         LEFT JOIN app.students s ON s.id=j.student_id AND s.tenant_id=j.tenant_id
         LEFT JOIN app.users u ON u.id=j.creator_user_id
         WHERE j.tenant_id=current_setting('schoolos.tenant_id', true)::uuid AND j.status='queued'
         ORDER BY j.created_at ASC LIMIT 100`)).rows;
      return { jobs: rows };
    });
  });

  app.post('/student/print/:id/done', { preHandler: [require(...STAFF), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const row = (await c.query(
        `UPDATE student.print_job SET status='printed', printed_by=$3, printed_at=now(), updated_at=now()
         WHERE id=$1 AND tenant_id=$2 AND status='queued' RETURNING id, kind, creator_user_id`,
        [req.params.id, req.user.tenant_id, req.user.id])).rows[0];
      if (!row) return bad(reply, 'We couldn\'t find that queued print job', 404);
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: `Print discharged (${row.kind})`, recordType: 'PrintJob', recordRef: row.id,
        reason: 'printed at the school printer', policyRef: 'STUDENTOS-PLAN §78 (kiosk print plane)', risk: 'low',
        outcome: 'status printed' });
      return { ok: true, id: row.id, status: 'printed' };
    });
  });

  // ── noticeboard — weekly print-ready summary (student door; same shape for staff) ──
  app.get('/student/noticeboard', { preHandler: [require(...STUDENT, ...STAFF), lifecycleGate] }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const me = await ownStudent(c, req.user);
      const blocks = [];
      if (me) {
        const hw = await homeworkRows(c, req.user.tenant_id, me.grade);
        const due = hw ? [...hw.digital, ...hw.paper].filter((h) => h.due_at && new Date(h.due_at) <= new Date(Date.now() + 7 * 864e5)) : [];
        blocks.push({ title: 'Homework due this week', lines: due.length ? due.map((h) => `${h.subject ?? ''}: ${h.title}${h.due_at ? ` (due ${String(h.due_at).slice(0, 10)})` : ''}`) : ['Nothing due this week.'] });
        const exams = (await c.query(
          `SELECT name, term FROM plugin_exams.exam WHERE tenant_id=$1 AND class_grade=$2 AND status='published'
           ORDER BY created_at DESC LIMIT 5`, [req.user.tenant_id, me.grade]).catch(() => ({ rows: [] }))).rows;
        blocks.push({ title: 'Results published', lines: exams.length ? exams.map((e) => `${e.name} (${e.term}) — see your results page`) : ['No results published this week.'] });
      }
      const events = (await c.query(
        `SELECT label, created_at FROM app.events WHERE tenant_id=$1 AND created_at > now() - interval '7 days'
         ORDER BY created_at DESC LIMIT 10`, [req.user.tenant_id]).catch(() => ({ rows: [] }))).rows;
      blocks.push({ title: 'Announcements & events this week', lines: events.length ? events.map((e) => e.label) : ['No new announcements.'] });
      blocks.push({ title: 'Printed by', lines: [`Generated ${istDate()} (IST) — student.world noticeboard`] });
      return { student: me ? { name: me.name, class: `${me.grade}-${me.section}` } : null, blocks };
    });
  });

  // ── wellbeing — counselor/principal plane (teacher refused; safety-box discipline) ──
  app.post('/student/wellbeing', { preHandler: [require(...STUDENT), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!WELLBEING_CATEGORIES.includes(b.category)) return bad(reply, 'Choose what this is about: academic pressure, friendship, bullying, family, health or other');
    if (!b.detail || !String(b.detail).trim()) return bad(reply, 'Please write a little about how you are feeling');
    const anonymous = b.anonymous === true; // named by default — the counselor follows up with you
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const me = anonymous ? null : await ownStudent(c, req.user);
      const row = (await c.query(
        `INSERT INTO student.wellbeing_request (tenant_id, creator_user_id, student_id, category, detail, anonymous)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, status, created_at`,
        [req.user.tenant_id, anonymous ? null : req.user.id, me?.id ?? null,
         b.category, String(b.detail).slice(0, 2000), anonymous])).rows[0];
      await emitEvent(c, req.user.tenant_id,
        { type: 'student', label: `Wellbeing request filed (${b.category})`, ref: row.id },
        'student.wellbeing.v1', { requestId: row.id, category: b.category, anonymous });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: anonymous ? 'anonymous (student)' : req.user.name, action: `Wellbeing request filed (${b.category})`,
        recordType: 'WellbeingRequest', recordRef: row.id,
        reason: anonymous ? 'anonymous filing — no identity stored' : 'counselor plane',
        policyRef: 'STUDENTOS-PLAN §wellbeing · safety_anonymous_audit precedent', risk: 'medium',
        outcome: `routed to counselor/principal plane (${anonymous ? 'anonymous' : 'named'})` });
      return {
        ok: true, id: row.id, anonymous,
        note: anonymous
          ? 'Your request was sent without your name. The counselor will answer it in the weekly wellbeing review.'
          : 'Your request was sent to the counselor. They will reach out to you.',
      };
    });
  });

  app.get('/student/wellbeing', { preHandler: [require(...WELLBEING_READERS), lifecycleGate] }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const rows = (await c.query(
        `SELECT w.id, w.category, w.detail, w.anonymous, w.status, w.created_at,
                s.name AS student_name, u.name AS requested_by
         FROM student.wellbeing_request w
         LEFT JOIN app.students s ON s.id=w.student_id
         LEFT JOIN app.users u ON u.id=w.creator_user_id
         WHERE w.tenant_id=current_setting('schoolos.tenant_id', true)::uuid
         ORDER BY w.created_at DESC LIMIT 50`)).rows;
      return { requests: rows.map((r) => ({
        id: r.id, category: r.category, detail: r.detail, status: r.status, createdAt: r.created_at,
        student: r.anonymous ? null : (r.student_name ?? r.requested_by ?? null),
      })) };
    });
  });

  // ── session — kiosk idle-countdown contract (STUDENT_IDLE_TIMEOUT_MINUTES, default 10) ──
  app.get('/student/session', { preHandler: [require(...STUDENT), lifecycleGate] }, async (req) => {
    const s = (await kernel.q(
      `SELECT settings FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`, [req.user.tenant_id, ID]).catch(() => ({ rows: [] }))).rows[0];
    const idle = Math.max(1, parseInt(process.env.STUDENT_IDLE_TIMEOUT_MINUTES ?? s?.settings?.student_idle_timeout_minutes ?? '10', 10) || 10);
    return { idle_minutes: idle, logout_url: '/auth/logout',
      note: 'You are on a shared school computer. When you finish, log out — your data will not stay on this machine.' };
  });
}
