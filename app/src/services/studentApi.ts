/* ============================================================
   studentApi — typed doors for the StudentOS surfaces (SU-1).
   Shapes frozen in docs/STUDENTOS-PLAN.md ("Frozen API
   contracts (v0)"). Doors are built by the SS-1 lane and may be
   mid-build: wrappers throw the raw error, and callers degrade
   to calm empty/error states via lib/friendlyErrors.

   Normalizers: v0 freezes the door paths, not every element
   field, so READ wrappers accept the loose shapes the server
   plausibly emits (strings OR objects) and return strict UI
   types. WRITE wrappers post the frozen bodies verbatim.
   ============================================================ */
import { apiRequest } from './liveApi';

/* ---------- transport ----------
   FEX-3/6: ride the ONE transport (services/liveApi.ts) — memory-only bearer, same-origin, the same 401
   session-reset and CSRF echo. This helper collapsed onto it when `call` was finally exported. */
const studentCall = apiRequest;

/* ---------- strict UI shapes ---------- */
export type StudentPrintKind =
  | 'timetable' | 'study_plan' | 'checklist' | 'portfolio'
  | 'mistake_sheet' | 'flashcards' | 'noticeboard';

export interface StudentNextClass {
  subject: string;
  period: number | null;
  start: string | null;
  room: string | null;
  teacher: string | null;
}
export interface StudentHomeToday { classes: number; assignmentsDue: number; upcomingTest: number }
export type StudentAttentionKind = 'assignment' | 'exam' | 'task' | 'other';
export interface StudentAttentionItem {
  id: string;
  kind: StudentAttentionKind;
  title: string;
  subject: string | null;
  dueLabel: string | null;
  detail: string | null;
  done: boolean;
  /** set when the item is backed by a student.study_task row (server toggle works) */
  taskId: string | null;
}
export interface StudentProgressArrow { subject: string; direction: 'up' | 'flat' | 'down'; note: string | null }
export interface StudentBagItem { item: string; note: string | null }
export interface StudentHomeData {
  nextClass: StudentNextClass | null;
  today: StudentHomeToday;
  needsAttention: StudentAttentionItem[];
  progress: StudentProgressArrow[];
  bagTomorrow: StudentBagItem[];
}

export interface StudentHomeworkItem { id: string; title: string; subject: string | null; due: string | null; mode: 'digital' | 'paper' }
export interface StudentHomeworkData { digital: StudentHomeworkItem[]; paper: StudentHomeworkItem[] }

export interface StudentResultReport { id: string; title: string; period: string | null; publishedOn: string | null; summary: string | null; explain: string[] }
export interface StudentResultsData { reports: StudentResultReport[] }

export interface StudentMistake { id: string; subject: string; topic: string; whatWrong: string; correction: string | null; lesson: string | null; at: string | null }
export interface StudentFlashcard { id: string; deck: string; front: string; back: string; subject: string | null; topic: string | null }
export interface StudentTask { id: string; title: string; dueDate: string | null; done: boolean; source: 'manual' | 'homework' }

export interface StudentPrintJob { id: string; kind: StudentPrintKind; status: 'queued' | 'printed'; requestedAt: string | null }
export interface StudentPrintResult { ok: boolean; job: StudentPrintJob | null }

/* Session-isolation surface (§plan: no-store + idle timeout). The
   SERVER enforces the timeout; this payload only drives the visible,
   calm countdown. idleTimeoutMinutes falls back to the plan default. */
export const STUDENT_DEFAULT_IDLE_MINUTES = 10;
export interface StudentSessionData {
  studentId: string | null;
  name: string | null;
  classLabel: string | null;
  idleTimeoutMinutes: number;
  loggedInAt: string | null;
}

export interface StudentNoticeboardEntry { title: string; detail: string | null; when: string | null }
/* T506: server shape is { student, blocks:[{title, lines[]}] } (student.world:440). */
export interface StudentNoticeboardData {
  weekLabel: string | null;
  student: { name: string | null; classLabel: string | null } | null;
  blocks: StudentNoticeboardBlock[];
}

/* ---------- tolerant coercers (v0 element shapes are loose) ---------- */
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? v as Record<string, unknown> : {});
const list = (v: unknown): unknown[] => {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') {
    const firstArr = Object.values(v).find(x => Array.isArray(x));
    if (Array.isArray(firstArr)) return firstArr;
  }
  return [];
};
const str = (v: unknown): string | null => {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
};
const firstStr = (...vals: unknown[]): string | null => {
  for (const v of vals) { const s = str(v); if (s) return s; }
  return null;
};
const countOf = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (Array.isArray(v)) return v.length;
  return 0;
};
const DIR_MAP: Record<string, StudentProgressArrow['direction']> = {
  up: 'up', improving: 'up', rising: 'up',
  flat: 'flat', steady: 'flat', same: 'flat',
  down: 'down', declining: 'down', falling: 'down', dipping: 'down',
};
const dirOf = (v: unknown): StudentProgressArrow['direction'] => {
  const s = (str(v) ?? 'flat').toLowerCase();
  return DIR_MAP[s] ?? 'flat';
};
const KIND_MAP: Record<string, StudentAttentionKind> = {
  assignment: 'assignment', homework: 'assignment',
  exam: 'exam', test: 'exam',
  task: 'task',
};

/* ---------- GET /student/home ---------- */
export async function getStudentHome(): Promise<StudentHomeData> {
  const raw = rec(await studentCall<unknown>('/student/home'));
  const next = rec(raw.next_class);
  const today = rec(raw.today);

  const nextClass: StudentNextClass | null = firstStr(next.subject) ? {
    subject: firstStr(next.subject) ?? '',
    period: typeof next.period === 'number' ? next.period : (str(next.period) ? Number(str(next.period)) : null),
    start: firstStr(next.start, next.starts_at, next.time),
    room: firstStr(next.room),
    teacher: firstStr(next.teacher),
  } : null;

  const needsAttention: StudentAttentionItem[] = list(raw.needs_attention).map((e, i) => {
    if (typeof e === 'string') {
      return { id: `att-${i}`, kind: 'other' as const, title: e, subject: null, dueLabel: null, detail: null, done: false, taskId: null };
    }
    const r = rec(e);
    const kindRaw = (firstStr(r.kind) ?? 'other').toLowerCase();
    return {
      id: firstStr(r.id) ?? `att-${i}`,
      kind: KIND_MAP[kindRaw] ?? 'other',
      /* T505: server sends {text, ref} — `title` never existed, so every live
         item rendered "(untitled item)". Read `text` first. */
      title: firstStr(r.text, r.title, r.what, r.label) ?? '(untitled item)',
      subject: firstStr(r.subject),
      dueLabel: firstStr(r.dueLabel, r.due_label, r.due),
      detail: firstStr(r.detail, r.note),
      done: r.done === true,
      taskId: firstStr(r.taskId, r.task_id),
    };
  });

  const progress: StudentProgressArrow[] = list(raw.progress).map((e, i) => {
    const r = rec(e);
    return {
      subject: firstStr(r.subject, r.name) ?? `Subject ${i + 1}`,
      direction: dirOf(r.direction ?? r.trend),
      note: firstStr(r.note, r.detail),
    };
  });

  const bagTomorrow: StudentBagItem[] = list(raw.bag_tomorrow).map(e => {
    if (typeof e === 'string') return { item: e, note: null };
    const r = rec(e);
    return { item: firstStr(r.item, r.what, r.title) ?? '', note: firstStr(r.note, r.why) };
  }).filter(b => b.item);

  return {
    nextClass,
    today: {
      /* T505: server field is classes_count (student.world:212) — reading
         `classes` gave "0 classes" on real data. */
      classes: countOf(today.classes_count ?? today.classes),
      assignmentsDue: countOf(today.assignments_due),
      upcomingTest: countOf(today.upcoming_test),
    },
    needsAttention,
    progress,
    bagTomorrow,
  };
}

/* ---------- GET /student/homework → { digital:[], paper:[] } ---------- */
export async function getStudentHomework(): Promise<StudentHomeworkData> {
  const raw = rec(await studentCall<unknown>('/student/homework'));
  const item = (e: unknown, i: number): StudentHomeworkItem => {
    if (typeof e === 'string') return { id: `hw-${i}`, title: e, subject: null, due: null, mode: 'digital' };
    const r = rec(e);
    return {
      id: firstStr(r.id) ?? `hw-${i}`,
      title: firstStr(r.title, r.task, r.what) ?? '(untitled homework)',
      subject: firstStr(r.subject),
      due: firstStr(r.due, r.due_date),
      mode: firstStr(r.mode) === 'paper' ? 'paper' : 'digital',
    };
  };
  return { digital: list(raw.digital).map(item), paper: list(raw.paper).map(item) };
}

/* ---------- GET /student/results → published reports + explain lines ---------- */
export async function getStudentResults(): Promise<StudentResultsData> {
  const raw = rec(await studentCall<unknown>('/student/results'));
  const reports: StudentResultReport[] = list(raw.reports ?? raw.results).map((e, i) => {
    const r = rec(e);
    return {
      id: firstStr(r.id) ?? `report-${i}`,
      title: firstStr(r.title, r.name) ?? '(untitled report)',
      period: firstStr(r.period, r.term),
      publishedOn: firstStr(r.publishedOn, r.published_on, r.publishedAt),
      summary: firstStr(r.summary, r.overall),
      explain: list(r.explain ?? r.explain_lines).map(x => firstStr(x) ?? '').filter(Boolean),
    };
  });
  return { reports };
}

/* ---------- GET/POST /student/mistakes ---------- */
export async function getMistakes(): Promise<{ mistakes: StudentMistake[] }> {
  const raw = await studentCall<unknown>('/student/mistakes');
  const mistakes: StudentMistake[] = list(raw).map((e, i) => {
    const r = rec(e);
    return {
      id: firstStr(r.id) ?? `mistake-${i}`,
      subject: firstStr(r.subject) ?? '—',
      topic: firstStr(r.topic) ?? '—',
      whatWrong: firstStr(r.whatWrong, r.what_wrong, r.what) ?? '',
      correction: firstStr(r.correction),
      lesson: firstStr(r.lesson),
      at: firstStr(r.at, r.createdAt),
    };
  });
  return { mistakes };
}
export async function addMistake(input: { subject: string; topic: string; whatWrong: string; correction?: string; lesson?: string }): Promise<{ ok: boolean }> {
  await studentCall<unknown>('/student/mistakes', {
    method: 'POST',
    body: JSON.stringify({ subject: input.subject, topic: input.topic, what_wrong: input.whatWrong, correction: input.correction ?? null, lesson: input.lesson ?? null }),
  });
  return { ok: true };
}

/* ---------- GET/POST /student/flashcards?deck= ---------- */
export async function getFlashcards(deck?: string): Promise<{ cards: StudentFlashcard[] }> {
  const qs = deck ? `?deck=${encodeURIComponent(deck)}` : '';
  const raw = await studentCall<unknown>(`/student/flashcards${qs}`);
  const cards: StudentFlashcard[] = list(raw).map((e, i) => {
    const r = rec(e);
    return {
      id: firstStr(r.id) ?? `card-${i}`,
      deck: firstStr(r.deck) ?? 'General',
      front: firstStr(r.front, r.q) ?? '',
      back: firstStr(r.back, r.a) ?? '',
      subject: firstStr(r.subject),
      topic: firstStr(r.topic),
    };
  });
  return { cards };
}
export async function addFlashcard(input: { deck: string; front: string; back: string; subject?: string; topic?: string }): Promise<{ ok: boolean }> {
  await studentCall<unknown>('/student/flashcards', {
    method: 'POST',
    body: JSON.stringify({ deck: input.deck, front: input.front, back: input.back, subject: input.subject ?? null, topic: input.topic ?? null }),
  });
  return { ok: true };
}

/* ---------- GET/POST /student/tasks ---------- */
export async function getTasks(): Promise<{ tasks: StudentTask[] }> {
  const raw = await studentCall<unknown>('/student/tasks');
  const tasks: StudentTask[] = list(raw).map((e, i) => {
    const r = rec(e);
    return {
      id: firstStr(r.id) ?? `task-${i}`,
      title: firstStr(r.title, r.what) ?? '(untitled task)',
      dueDate: firstStr(r.dueDate, r.due_date, r.due),
      done: r.done === true,
      source: firstStr(r.source) === 'homework' ? 'homework' : 'manual',
    };
  });
  return { tasks };
}
export async function addTask(input: { title: string; dueDate?: string }): Promise<{ ok: boolean }> {
  await studentCall<unknown>('/student/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: input.title, due_date: input.dueDate ?? null }),
  });
  return { ok: true };
}
/* The done-toggle rides the same POST /student/tasks door with an `id`
   (server: student.world/index.js — "done toggle on an own task"). The old
   `/student/tasks/:id/toggle` sub-path never existed server-side. */
export async function toggleTask(id: string, done: boolean): Promise<{ ok: boolean }> {
  await studentCall<unknown>('/student/tasks', {
    method: 'POST',
    body: JSON.stringify({ id, done }),
  });
  return { ok: true };
}

/* ---------- POST /student/print · GET student's own jobs ---------- */
export async function requestPrint(kind: StudentPrintKind, payload?: unknown): Promise<StudentPrintResult> {
  const raw = rec(await studentCall<unknown>('/student/print', {
    method: 'POST',
    body: JSON.stringify({ kind, payload: payload ?? {} }),
  }));
  const job = rec(raw.job);
  const id = firstStr(job.id, raw.id);
  const status = (firstStr(job.status, raw.status) ?? 'queued') === 'printed' ? 'printed' : 'queued';
  return {
    ok: raw.ok !== false,
    job: id ? { id, kind, status, requestedAt: firstStr(job.requested_at, raw.requested_at, job.requestedAt) } : null,
  };
}
/* Student's own print jobs (status polling for "queued → printed").
   Path note: GET /student/print/queue is the frozen STAFF door; the
   student-scoped read is /student/print/mine (student.world:399). */
export async function getMyPrints(): Promise<{ jobs: StudentPrintJob[] }> {
  /* T505: the server door is /student/print/mine (student.world:399) —
     /student/print/jobs 404'd. */
  const raw = await studentCall<unknown>('/student/print/mine');
  const jobs: StudentPrintJob[] = list(raw).map((e, i) => {
    const r = rec(e);
    const k = firstStr(r.kind) ?? 'checklist';
    return {
      id: firstStr(r.id) ?? `print-${i}`,
      kind: (StudentPrintKindList as readonly string[]).includes(k) ? k as StudentPrintKind : 'checklist',
      status: (firstStr(r.status) ?? 'queued') === 'printed' ? 'printed' : 'queued',
      requestedAt: firstStr(r.requested_at, r.requestedAt, r.at),
    };
  });
  return { jobs };
}
export const StudentPrintKindList: StudentPrintKind[] = ['timetable', 'study_plan', 'checklist', 'portfolio', 'mistake_sheet', 'flashcards', 'noticeboard'];
export const PRINT_KIND_LABEL: Record<StudentPrintKind, string> = {
  timetable: 'My timetable',
  study_plan: 'My study plan',
  checklist: 'Tomorrow checklist',
  portfolio: 'My portfolio',
  mistake_sheet: 'Mistake notebook sheet',
  flashcards: 'Flashcards',
  noticeboard: 'This week at school',
};

/* ---------- GET /student/session (session isolation) ---------- */
export async function getSession(): Promise<StudentSessionData> {
  const raw = rec(await studentCall<unknown>('/student/session'));
  const idle = typeof raw.idle_timeout_minutes === 'number' && raw.idle_timeout_minutes > 0
    ? raw.idle_timeout_minutes
    : (Number(str(raw.idle_timeout_minutes)) || 0);
  return {
    studentId: firstStr(raw.studentId, raw.student_id),
    name: firstStr(raw.name, raw.student_name),
    classLabel: firstStr(raw.classLabel, raw.class_label, raw.class, raw.grade),
    idleTimeoutMinutes: idle > 0 ? idle : STUDENT_DEFAULT_IDLE_MINUTES,
    loggedInAt: firstStr(raw.loggedInAt, raw.logged_in_at, raw.started_at),
  };
}

/* ---------- GET /student/noticeboard ----------
   T506: the live door (student.world:440) returns
   { student, blocks: [{title, lines: string[]}] } — the old
   {assignments,exams,events,clubs} shape never existed server-side, so the
   noticeboard always rendered empty. Normalizer now mirrors the real shape. */
export interface StudentNoticeboardBlock { title: string; lines: string[] }
export async function getNoticeboard(): Promise<StudentNoticeboardData> {
  const raw = rec(await studentCall<unknown>('/student/noticeboard'));
  const blocks: StudentNoticeboardBlock[] = list(raw.blocks).map((b, i) => {
    if (typeof b === 'string') return { title: b, lines: [] };
    const r = rec(b);
    return {
      title: firstStr(r.title, r.name) ?? `Section ${i + 1}`,
      lines: list(r.lines)
        .map(l => (typeof l === 'string' ? l : firstStr(rec(l).text, rec(l).label, rec(l).what, rec(l).title) ?? ''))
        .filter((l): l is string => Boolean(l)),
    };
  });
  const st = rec(raw.student);
  return {
    weekLabel: firstStr(raw.weekLabel, raw.week_label, raw.week),
    student: raw.student
      ? { name: firstStr(st.name), classLabel: firstStr(st.class, st.class_label, st.grade) }
      : null,
    blocks,
  };
}
