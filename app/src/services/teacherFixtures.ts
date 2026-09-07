/* ============================================================
   teacherFixtures.ts — TU-1 contract layer (FIXTURE FALLBACK).

   The Teacher Command Center is built against the FROZEN §4
   contracts (docs/TEACHEROS-PLAN.md):

     GET /teacher/home            → NOW/NEXT/NEEDS-ATTENTION aggregate
     GET /teacher/brief?when=eod  → end-of-day brief
     GET /teacher/brief?when=week → weekly brief

   Server lanes TS-1/TS-2/TS-3 are building these doors in
   parallel. Until one answers 200, this module serves a typed
   LOCAL FIXTURE derived from the demo dataset so the UI is real
   against the CONTRACT, and integration is a switch — not a
   rewrite.

   How the switch works (the only mechanism — do not add another):
   every read calls the live door once. A 200 response replaces
   the fixture for the rest of the session (the transport-level
   `live.ok` gate) AND is surfaced per-card via the returned
   `source` field. A 404 (door not yet live) silently falls back
   to the fixture. Any other status throws — the card renders its
   error state with the friendly message, exactly as it will when
   the door is live and misbehaving.

   THIS FILE IS TEMPORARY SCAFFOLDING. When both doors are live
   and verified, delete it and point TeacherHome at liveApi
   directly. Never ship fixture data to a tenant that has real
   records: `ok: false` always means "show a working UI honestly
   labelled Demo data", never "fake the data".
   ============================================================ */
import * as seed from '../data/dataset';
import { LIVE_API, LIVE_BASE } from './liveApi';
import type { TimeSlot } from '../types/domain';

/* ============================================================
   Contract types — mirror of plan §4, frozen. The server lanes
   must satisfy these shapes; do not widen them from the UI.
   ============================================================ */

/** Source stamp — every card declares where its data came from. */
export type TeacherSource = 'live' | 'fixture';

export interface TeacherPeriod {
  id: string;
  period: number;
  start: string;   // "HH:MM" 24h
  end: string;
  classGrade: string;  // "8-B"
  subject: string;
  room: string;
}

export interface TeacherCommitment {
  id: string;
  kind: 'class' | 'duty' | 'ptm' | 'exam' | 'event';
  title: string;
  start: string;
  end?: string;
  detail: string;
}

export type TeacherNeedKind = 'submission' | 'concern' | 'substitute' | 'approval';

export interface TeacherNeed {
  id: string;
  kind: TeacherNeedKind;
  /** Plain-language headline, e.g. "9 homework responses are waiting to be reviewed" */
  title: string;
  /** One line of why-now, plain language. */
  detail: string;
  /** ISO deadline, when the item has one. */
  deadline?: string;
  /** ranked: 0 = do first */
  rank: number;
  /** Where the action completes (TU-2 flow route). */
  to: string;
  /** In-flight state for the 12-state matrix. */
  state?: 'pending' | 'approval' | 'conflict' | 'sync';
}

export interface TeacherHomeAggregate {
  /** null = not a teaching day / no timetable */
  now: (TeacherPeriod & { endsInMins: number }) | null;
  next: TeacherCommitment[];
  needsAttention: TeacherNeed[];
  glance: { periods: number; free: number; duties: number; deadlines: number };
  suggestions: TeacherSuggestion[];
}

export interface TeacherSuggestion {
  id: string;
  title: string;
  /** plain-language estimate, e.g. "about 10 minutes" */
  estimate: string;
  reason: string;
  to: string;
  rank: number;
}

export interface TeacherBriefSection {
  heading: string;
  lines: string[];
}

export interface TeacherBrief {
  /** eod briefs are "today so far"; weekly briefs name the span. */
  span: string;
  sections: TeacherBriefSection[];
}

/* ============================================================
   Transport + probe
   ============================================================ */

async function call<T>(path: string): Promise<T> {
  const token = localStorage.getItem('schoolos_token');
  const res = await fetch(`${LIVE_BASE}${path}`, {
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

/** Transport-level result — flips to `ok` for the whole session once
 *  the real door answers 200 (gate for the fixture fallback). */
export interface DoorResult<T> { ok: boolean; data: T | null }

const doorState: Record<'home' | 'brief', boolean> = { home: false, brief: false };
/** Test/inspection hook — forces the next read onto the fixture. */
export function _resetTeacherDoors() { doorState.home = false; doorState.brief = false; }
/** True when the server door has answered 200 this session. */
export const teacherDoorLive = { get home() { return doorState.home; }, get brief() { return doorState.brief; } };

function notLive(err: unknown): boolean {
  const msg = String(err);
  return /\b404\b/.test(msg) || /not found/i.test(msg) || /Cannot (GET|POST)/.test(msg);
}

/* ============================================================
   Derived-from-seed fixture (demo dataset is the source of truth
   for demo identities — Priya Iyer, 8-B class teacher, maths).
   ============================================================ */

const iso = (d: Date) => d.toISOString();
const hhmm = (s: string) => s;   // timetable stores "HH:MM" already

function mySlotsToday(): TimeSlot[] {
  const me = seed.teachers.find(t => t.name === 'Priya Iyer') ?? seed.teachers[0];
  const dow = new Date().getDay();
  return seed.timetable
    .filter(t => t.day === dow && t.teacherId === me.id)
    .sort((a, b) => a.period - b.period);
}

function toMin(s: string): number { const [h, m] = s.split(':').map(Number); return h * 60 + m; }

function sectionLabel(sectionId: string): string {
  const s = seed.sections.find(x => x.id === sectionId);
  return s ? `${s.grade}-${s.name}` : 'Class';
}

function fixtureHome(): TeacherHomeAggregate {
  const now = new Date();
  const hm = now.getHours() * 60 + now.getMinutes();
  const slots = mySlotsToday();
  const secOf = (slot: TimeSlot) => sectionLabel(slot.sectionId);

  const current = slots.find(t => toMin(t.start) <= hm && hm < toMin(t.end));
  const upcoming = slots.filter(t => toMin(t.start) > hm);
  const past = slots.filter(t => toMin(t.end) <= hm);

  const nowCard = current
    ? {
        id: current.id, period: current.period, start: hhmm(current.start), end: hhmm(current.end),
        classGrade: secOf(current.sectionId), subject: current.subject, room: current.room,
        endsInMins: Math.max(0, toMin(current.end) - hm),
      }
    : null;

  const periodLabel = (t: TimeSlot) => `P${t.period} ${t.subject} — ${secOf(t.sectionId)} · Room ${t.room}`;
  const next: TeacherCommitment[] = [];
  for (const t of upcoming.slice(0, 4)) {
    next.push({ id: t.id, kind: 'class', title: periodLabel(t), start: hhmm(t.start), end: hhmm(t.end), detail: `${t.subject} with ${secOf(t.sectionId)}` });
  }

  /* PTM / exam / duty commitments from the calendar — the two weeks ahead,
     non-class, so the NEXT band never shows only periods. */
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const horizon = dayStart.getTime() + 7 * 86_400_000;
  const events = seed.calendarEvents
    .filter(e => e.on.getTime() >= dayStart.getTime() && e.on.getTime() < horizon)
    .filter(e => e.type === 'ptm' || e.type === 'exam' || e.type === 'staff')
    .sort((a, b) => a.on.getTime() - b.on.getTime())
    .slice(0, 4);
  for (const e of events) {
    const isToday = e.on.getTime() < dayStart.getTime() + 86_400_000;
    next.push({
      id: e.id,
      kind: e.type === 'ptm' ? 'ptm' : e.type === 'exam' ? 'exam' : 'event',
      title: e.title,
      start: isToday ? e.on.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : `${e.on.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} ${e.on.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`,
      detail: e.location ? `${e.owner} · ${e.location}` : e.owner,
    });
  }
  next.sort((a, b) => toMin(a.start.split(' ').pop() ?? a.start) - toMin(b.start.split(' ').pop() ?? b.start));

  const needsAttention: TeacherNeed[] = [
    {
      id: 'need-hw-8b', kind: 'submission', rank: 0,
      title: '9 homework responses from 8-B are waiting to be reviewed',
      detail: 'Fractions worksheet, due yesterday. Two came in after the deadline and need a late decision.',
      deadline: iso(new Date(dayStart.getTime() + 15 * 3600_000)), to: '/teacher/submissions', state: 'pending',
    },
    {
      id: 'need-concern', kind: 'concern', rank: 1,
      title: 'A concern you flagged needs one more detail',
      detail: 'The support team routed it back: which week did the attendance dip start? One line keeps the case moving.',
      to: '/teacher/concerns', state: 'pending',
    },
    {
      id: 'need-approval', kind: 'approval', rank: 2,
      title: 'Your leave request for Friday is waiting for approval',
      detail: 'Coordinator Arjun Bhat has it. A substitute proposal is generated once it is approved.',
      to: '/teacher/leave', state: 'approval',
    },
  ];

  const dutiesToday = seed.calendarEvents.filter(e => e.type === 'staff' && e.on.getTime() < dayStart.getTime() + 86_400_000).length
    + (past.length + upcoming.length + (current ? 1 : 0) >= 5 ? 1 : 0);
  const deadlines = seed.calendarEvents.filter(e => e.type === 'exam' || e.type === 'deadline').length;

  const suggestions: TeacherSuggestion[] = [
    { id: 'sg-1', rank: 0, title: 'Review the 9 waiting homework responses', estimate: 'about 10 minutes', reason: 'Due yesterday — students see "reviewed" faster when it is done before lunch.', to: '/teacher/submissions' },
    { id: 'sg-2', rank: 1, title: 'Send the fractions revision list to 8-B', estimate: 'about 5 minutes', reason: 'Unit test is next week; a revision list now cuts repeat questions.', to: '/teacher/homework' },
    { id: 'sg-3', rank: 2, title: 'Complete the attendance dip detail on your flagged concern', estimate: 'about 2 minutes', reason: 'One missing line is holding the support-team routing.', to: '/teacher/concerns' },
    { id: 'sg-4', rank: 3, title: 'Prep for the parent meeting — 3 slots booked', estimate: 'about 15 minutes', reason: 'The pre-meeting pack is ready; skimming it before the slots starts them calmer.', to: '/teacher/ptm' },
  ];

  return {
    now: nowCard,
    next: next.slice(0, 4),
    needsAttention,
    glance: { periods: slots.length, free: Math.max(0, 8 - slots.length), duties: dutiesToday, deadlines },
    suggestions,
  };
}

function fixtureBrief(when: 'eod' | 'week'): TeacherBrief {
  if (when === 'week') {
    return {
      span: 'This week',
      sections: [
        { heading: 'Teaching', lines: ['Fractions unit: 6 of 8 topics covered in 8-B — on pace.', 'Word problems need one more practice round before the unit test.'] },
        { heading: 'Workload', lines: ['Homework set: 4 · Reviews pending: 9 · Duties: 1.', 'Lightest day ahead: Wednesday — a good slot for assessment marking.'] },
        { heading: 'To watch', lines: ['Two students slipped below 85% attendance this week — attendance decline signals are with the coordinator.'] },
      ],
    };
  }
  return {
    span: 'Today',
    sections: [
      { heading: 'Done today', lines: ['Attendance marked for every class · lesson log updated · 3 homework responses reviewed.'] },
      { heading: 'Still open', lines: ['9 homework responses waiting · one concern detail pending · leave request for Friday awaiting approval.'] },
      { heading: 'Tomorrow', lines: ['P2 Maths with 8-B — continue fractions word problems · PTM slots from 15:00 · duty: none.'] },
      { heading: 'Preparation', lines: ['Revision worksheet draft is ready in your drafts — review and publish it tonight or tomorrow morning.'] },
    ],
  };
}

/* ============================================================
   Public reads — the only two the UI consumes.
   ============================================================ */

export async function getTeacherHome(): Promise<DoorResult<TeacherHomeAggregate>> {
  if (!LIVE_API) return { ok: false, data: fixtureHome() };
  if (doorState.home) {
    /* session already validated the door — refetch live, throw real errors */
    return { ok: true, data: await call<TeacherHomeAggregate>('/teacher/home') };
  }
  try {
    const data = await call<TeacherHomeAggregate>('/teacher/home');
    doorState.home = true;
    return { ok: true, data };
  } catch (err) {
    if (notLive(err)) return { ok: false, data: fixtureHome() };  // door not built yet → fixture
    throw err;                                                    // door live and failing → real error
  }
}

export async function getTeacherBrief(when: 'eod' | 'week'): Promise<DoorResult<TeacherBrief>> {
  if (!LIVE_API) return { ok: false, data: fixtureBrief(when) };
  if (doorState.brief) {
    return { ok: true, data: await call<TeacherBrief>(`/teacher/brief?when=${when}`) };
  }
  try {
    const data = await call<TeacherBrief>(`/teacher/brief?when=${when}`);
    doorState.brief = true;
    return { ok: true, data };
  } catch (err) {
    if (notLive(err)) return { ok: false, data: fixtureBrief(when) };
    throw err;
  }
}

/** Stamp a result with where it came from — TeacherHome renders the
 *  "Demo data" badge from this, so fixture mode is never silent. */
export function sourceOf(r: { ok: boolean }): TeacherSource { return r.ok ? 'live' : 'fixture'; }

export const teacherFixture = { fixtureHome, fixtureBrief };

/* ============================================================
   TU-2 (ui-flows) SECTION — teacher flow doors. Same switch law
   as above (200 → live for the session · 404 → fixture · other
   errors → throw to the screen). Partitioned for lane
   coordination: TU-1 owns the home/brief block above, TU-2 owns
   everything below this line. Do not reorder across the seam.
   Doors not named in plan §4 are marked PROPOSED and flagged in
   handoff/2026-09-08-tu2-ui-flows.md.
   ============================================================ */

/* ---------- P6 · homework + submissions (teacher.classroom, TS-1) ---------- */

export interface TeacherHomework {
  id: string;
  class_grade: string;          /* e.g. "8-B" */
  subject: string;
  title: string;
  detail: string;
  attachment: string | null;    /* file name or link — contract: attachment? */
  due_at: string;               /* ISO */
  status: 'open' | 'closed';
  created_at: string;
  submission_counts?: { submitted: number; late: number; reviewed: number; missing: number }; /* PROPOSED row enrichment */
}

export interface NewHomework {
  class_grade: string;
  subject: string;
  title: string;
  detail?: string;
  attachment?: string;
  due_at: string;
}

export type SubmissionState = 'submitted' | 'late' | 'reviewed' | 'graded' | 'resubmit_requested' | 'missing';

export interface TeacherSubmission {
  id: string;
  homework_id: string;
  homework_title: string;
  class_grade: string;
  student_id: string;
  student_name: string;
  content_type: 'text' | 'image' | 'pdf' | 'link';
  content_ref: string;
  submitted_at: string | null;  /* null → missing */
  status: SubmissionState;
  grade: number | null;
  feedback: string | null;
  reviewed_at: string | null;
}

/* ---------- P8 · teacher self-leave, duty, workload (TS-1) ---------- */

export type LeaveKind = 'casual' | 'sick' | 'earned' | 'duty' | 'other';

export interface TeacherLeaveRequest {
  id: string;
  kind: LeaveKind;
  from_date: string;            /* ISO date */
  to_date: string;
  reason: string;
  status: 'requested' | 'approved' | 'rejected';
  approver_name: string | null;
  decided_at: string | null;
  note: string | null;          /* coordinator note — shown with the decision */
  handover?: {                  /* auto after approval (P8) */
    substitute_name: string;
    classes: { class_grade: string; period: string; subject: string; room: string; note: string }[];
    packet_at: string;
  };
}

export interface LeaveBalance { kind: LeaveKind; entitled: number; used: number; carried: number }

export type DutyKind = 'invigilation' | 'corridor' | 'assembly' | 'lunch' | 'event' | 'substitution';

export interface DutyAssignment {
  id: string;
  kind: DutyKind;
  date: string;
  period_label: string;
  time: string;
  place: string;
  source: 'roster' | 'substitution';
}

export interface MyWorkload {
  week_label: string;
  periods: number;
  substitutions: number;
  invigilation: number;
  duties: number;                           /* roster duties this week (§4 /workload/mine) */
  load_score: number;                       /* composite 0–100 — fairness input, NEVER a rating (P8) */
  grading_estimate_mins: number;
  ptm_count: number;
  meetings: number;
  fair_band: { min: number; max: number };  /* load band used for FAIRNESS only — never a ranking (P8) */
  note: string;
}

/* ---------- P9 · announcements + messages (comms rail) ---------- */

export interface TeacherAnnouncement {
  id: string;
  audiences: string[];          /* class grades, e.g. ["8-B"] */
  title: string;
  body: string;
  template_id: string | null;
  status: 'sent' | 'scheduled';
  scheduled_at: string | null;
  sent_at: string | null;
  receipts: { delivered: number; read: number; total: number };
}

export interface MsgMessage { id: string; from: 'teacher' | 'guardian'; text: string; at: string; template_id?: string }

export interface MsgThread {
  id: string;
  student_id: string;
  student_name: string;
  class_grade: string;
  guardian_name: string;
  guardian_phone_masked: string;  /* masked numbers only — never a raw phone (P9) */
  unread: number;
  messages: MsgMessage[];
}

export interface MessageTemplate { id: string; name: string; text: string }

/* ---------- P11 · PTM (teacher.support, TS-2) — server shapes ----------
   GET  /ptm/slots        → { slots: [{ slotId, teacherId, teacherName, date,
                                startTime, endTime, status, booked,
                                bookedStudentId?, bookedStudentName? }] }
   POST /ptm/slots        {date, startTime, endTime} → { ok, slotId, status }
   GET/POST /ptm/:id/notes  :id = BOOKING id → { notes: [{ noteId, note, at }] } / { ok, private }
   The slot board does not yet echo the booking id (TS-2 gap, tracked in the
   handoff) — `bookingId` is optional and the notes editor degrades plainly
   when a booked slot arrives without one. */
export interface PtmSlot {
  slotId: string;
  teacherId: string;
  teacherName: string;
  date: string;
  startTime: string;
  endTime: string;
  status: 'open' | 'booked' | 'closed';
  booked: boolean;
  bookingId?: string | null;
  bookedStudentId?: string | null;
  bookedStudentName?: string | null;
}

export interface PtmNote { noteId: string; note: string; at: string }

/** The teacher's booked meetings — derived from the slot board (booked, mine). */
export interface PtmMeeting {
  bookingId: string | null;
  slotId: string;
  date: string;
  startTime: string;
  studentName: string;
  guardianName: string | null;
  status: 'booked' | 'cancelled' | 'completed';
  notes: PtmNote[];             /* PRIVATE — teacher-only (P11) */
}

/* ---------- TU-2 teacher context (prefills; TU-1's /teacher/home
   context replaces this when it lands — shapes stay compatible) ---------- */

export const teacherContext = {
  name: 'Priya Iyer',
  classes: ['8-B', '8-A', '7-A'],
  subjectFor: (_cls: string) => 'Maths',
};

/* ---------- TU-2 door state — same law as the TU-1 block ---------- */

const flowDoorState: Record<string, boolean> = {};
/** Test/inspection hook — forces the flow doors back onto the fixture. */
export function _resetTeacherFlowDoors() { for (const k of Object.keys(flowDoorState)) flowDoorState[k] = false; }

/** Sync view for the UI: has THIS door proven live this session?
 *  Screens render the "Demo data" tag from this after a read settles
 *  (the flag is set inside the same promise that resolves the data). */
export function isFlowDoorLive(door: string): boolean { return !!flowDoorState[door]; }

function flowNotLive(err: unknown): boolean {
  const msg = String(err);
  return /\b404\b/.test(msg) || /not found/i.test(msg) || /Cannot (GET|POST)/.test(msg);
}

/** TU-2 transport: mirrors `call` above plus write support. */
async function flowCall<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('schoolos_token');
  const res = await fetch(`${LIVE_BASE}${path}`, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(opts.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

/** Read a flow door: live once proven, fixture while the door is absent,
 *  real error the moment the door exists and fails. Returns where it came from. */
export async function flowRead<T>(door: string, path: string, fixture: () => Promise<T>): Promise<{ data: T; source: TeacherSource }> {
  if (!LIVE_API) return { data: await fixture(), source: 'fixture' };
  if (flowDoorState[door]) return { data: await flowCall<T>(path), source: 'live' };
  try {
    const data = await flowCall<T>(path);
    flowDoorState[door] = true;
    return { data, source: 'live' };
  } catch (err) {
    if (flowNotLive(err)) return { data: await fixture(), source: 'fixture' };  // door not built yet
    throw err;                                                                  // door live and failing
  }
}

/** Write a flow door: same law — a not-live door falls back to the fixture
 *  (which mutates local state so the refetch shows the change). */
export async function flowWrite<T>(door: string, path: string, init: RequestInit, fixture: () => Promise<T>): Promise<{ data: T; source: TeacherSource }> {
  if (!LIVE_API) return { data: await fixture(), source: 'fixture' };
  if (flowDoorState[door]) return { data: await flowCall<T>(path, init), source: 'live' };
  try {
    const data = await flowCall<T>(path, init);
    flowDoorState[door] = true;
    return { data, source: 'live' };
  } catch (err) {
    if (flowNotLive(err)) return { data: await fixture(), source: 'fixture' };
    throw err;
  }
}

/* ============================================================
   Flow fixtures — module-local, mutate on writes so refetches
   behave like the server (demo identities follow the seed:
   Priya Iyer · maths · 8-B class teacher).
   ============================================================ */

const isoF = (d: Date) => d.toISOString();
const dayF = (n: number, h = 17, m = 0) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, m, 0, 0); return isoF(d); };
const dateOnlyF = (n: number) => dayF(n, 12).slice(0, 10);
const waitF = (ms: number) => new Promise(r => setTimeout(r, ms));
const uidF = (p: string) => `${p}_${Math.random().toString(36).slice(2, 9)}`;

/* ---- P6 homework ---- */

let fxHomework: TeacherHomework[] = [
  { id: 'hw_101', class_grade: '8-B', subject: 'Maths', title: 'Fractions worksheet 4', detail: 'Page 31, questions 1–12. Show every step.', attachment: 'fractions-ws4.pdf', due_at: dayF(2), status: 'open', created_at: dayF(-1, 9), submission_counts: { submitted: 18, late: 2, reviewed: 4, missing: 3 } },
  { id: 'hw_102', class_grade: '8-A', subject: 'Maths', title: 'Word problems set 2', detail: 'Ten word problems on ratios. Write the sentence, then the sum.', attachment: null, due_at: dayF(1), status: 'open', created_at: dayF(-2, 10), submission_counts: { submitted: 21, late: 1, reviewed: 0, missing: 2 } },
  { id: 'hw_103', class_grade: '7-A', subject: 'Maths', title: 'Integers practice — signs', detail: 'Page 12, questions 1–20. Watch the signs.', attachment: null, due_at: dayF(-1), status: 'open', created_at: dayF(-4, 8), submission_counts: { submitted: 14, late: 4, reviewed: 9, missing: 6 } },
  { id: 'hw_104', class_grade: '8-B', subject: 'Maths', title: 'Mensuration revision quiz', detail: 'Self-check quiz, 15 marks. Link below.', attachment: 'https://quiz.meridian.edu/mens-rev', due_at: dayF(-3), status: 'closed', created_at: dayF(-8, 9), submission_counts: { submitted: 25, late: 0, reviewed: 25, missing: 0 } },
];

/** GET /plugins/teacher.classroom/homework?mine=1[&class=] (§4, frozen) */
export async function listHomework(params: { class?: string } = {}): Promise<{ homework: TeacherHomework[] }> {
  const q = params.class ? `&class=${encodeURIComponent(params.class)}` : '';
  return flowRead('hw', `/plugins/teacher.classroom/homework?mine=1${q}`, async () => {
    await waitF(360);
    return { homework: fxHomework.filter(h => !params.class || h.class_grade === params.class) };
  }).then(r => r.data);
}

/** POST /plugins/teacher.classroom/homework (§4, frozen) */
export async function createHomework(body: NewHomework): Promise<{ ok: boolean; homework: TeacherHomework }> {
  return flowWrite('hw', '/plugins/teacher.classroom/homework', { method: 'POST', body: JSON.stringify(body) }, async () => {
    await waitF(420);
    if (!body.title.trim()) throw new Error('Give the homework a title before publishing.');
    if (new Date(body.due_at).getTime() < Date.now() - 60_000) throw new Error('The due date is in the past — pick today or later.');
    const hw: TeacherHomework = {
      id: uidF('hw'), class_grade: body.class_grade, subject: body.subject, title: body.title.trim(),
      detail: body.detail ?? '', attachment: body.attachment ?? null, due_at: body.due_at,
      status: 'open', created_at: isoF(new Date()), submission_counts: { submitted: 0, late: 0, reviewed: 0, missing: 0 },
    };
    fxHomework = [hw, ...fxHomework];
    return { ok: true, homework: hw };
  }).then(r => r.data);
}

/* ---- P6 submissions inbox ---- */

let fxSubmissions: TeacherSubmission[] = [
  { id: 'sub_1', homework_id: 'hw_101', homework_title: 'Fractions worksheet 4', class_grade: '8-B', student_id: 'stu_1', student_name: 'Aarav Sharma', content_type: 'pdf', content_ref: 'aarav-fractions-ws4.pdf', submitted_at: dayF(0, 8, 12), status: 'submitted', grade: null, feedback: null, reviewed_at: null },
  { id: 'sub_2', homework_id: 'hw_101', homework_title: 'Fractions worksheet 4', class_grade: '8-B', student_id: 'stu_2', student_name: 'Kavya Nair', content_type: 'image', content_ref: 'IMG_2210.jpg', submitted_at: dayF(0, 7, 40), status: 'submitted', grade: null, feedback: null, reviewed_at: null },
  { id: 'sub_3', homework_id: 'hw_101', homework_title: 'Fractions worksheet 4', class_grade: '8-B', student_id: 'stu_3', student_name: 'Rohan Gupta', content_type: 'text', content_ref: 'Q1: 3/4 + 1/6 = 9/12 + 2/12 = 11/12 …', submitted_at: dayF(-1, 22, 5), status: 'late', grade: null, feedback: null, reviewed_at: null },
  { id: 'sub_4', homework_id: 'hw_102', homework_title: 'Word problems set 2', class_grade: '8-A', student_id: 'stu_4', student_name: 'Diya Patel', content_type: 'pdf', content_ref: 'diya-wp2.pdf', submitted_at: dayF(0, 9, 2), status: 'submitted', grade: null, feedback: null, reviewed_at: null },
  { id: 'sub_5', homework_id: 'hw_102', homework_title: 'Word problems set 2', class_grade: '8-A', student_id: 'stu_5', student_name: 'Ishaan Verma', content_type: 'link', content_ref: 'https://docs.example.com/ishaan-wp2', submitted_at: dayF(-1, 20, 15), status: 'late', grade: null, feedback: null, reviewed_at: null },
  { id: 'sub_6', homework_id: 'hw_103', homework_title: 'Integers practice — signs', class_grade: '7-A', student_id: 'stu_6', student_name: 'Meera Pillai', content_type: 'image', content_ref: 'meera-integer-work.jpg', submitted_at: dayF(-2, 16, 45), status: 'submitted', grade: null, feedback: null, reviewed_at: null },
  { id: 'sub_7', homework_id: 'hw_103', homework_title: 'Integers practice — signs', class_grade: '7-A', student_id: 'stu_7', student_name: 'Anil Kumar', content_type: 'image', content_ref: 'anil-integer-work.jpg', submitted_at: dayF(-2, 18, 30), status: 'resubmit_requested', grade: null, feedback: 'Signs are flipped on Q4–Q6 — redo those three and send it again.', reviewed_at: dayF(-1, 10) },
  { id: 'sub_8', homework_id: 'hw_103', homework_title: 'Integers practice — signs', class_grade: '7-A', student_id: 'stu_8', student_name: 'Sara Khan', content_type: 'image', content_ref: 'sara-integer-work.jpg', submitted_at: dayF(-2, 15, 10), status: 'reviewed', grade: 9, feedback: 'Neat work — every answer correct.', reviewed_at: dayF(-1, 11) },
  { id: 'sub_9', homework_id: 'hw_104', homework_title: 'Mensuration revision quiz', class_grade: '8-B', student_id: 'stu_1', student_name: 'Aarav Sharma', content_type: 'text', content_ref: 'Auto-graded · 13/15', submitted_at: dayF(-4, 19), status: 'graded', grade: 13, feedback: 'Re-check area units — cm vs m.', reviewed_at: dayF(-3, 9) },
  { id: 'sub_10', homework_id: 'hw_104', homework_title: 'Mensuration revision quiz', class_grade: '8-B', student_id: 'stu_9', student_name: 'Tanvi Rao', content_type: 'text', content_ref: 'Auto-graded · 15/15', submitted_at: dayF(-4, 18, 20), status: 'graded', grade: 15, feedback: null, reviewed_at: dayF(-3, 9) },
  /* missing rows — the inbox state=missing view (students with no submission) */
  { id: 'sub_m1', homework_id: 'hw_101', homework_title: 'Fractions worksheet 4', class_grade: '8-B', student_id: 'stu_10', student_name: 'Arjun Menon', content_type: 'text', content_ref: '', submitted_at: null, status: 'missing', grade: null, feedback: null, reviewed_at: null },
  { id: 'sub_m2', homework_id: 'hw_101', homework_title: 'Fractions worksheet 4', class_grade: '8-B', student_id: 'stu_11', student_name: 'Nisha Pillai', content_type: 'text', content_ref: '', submitted_at: null, status: 'missing', grade: null, feedback: null, reviewed_at: null },
  { id: 'sub_m3', homework_id: 'hw_102', homework_title: 'Word problems set 2', class_grade: '8-A', student_id: 'stu_12', student_name: 'Vikram Shetty', content_type: 'text', content_ref: '', submitted_at: null, status: 'missing', grade: null, feedback: null, reviewed_at: null },
  { id: 'sub_m4', homework_id: 'hw_103', homework_title: 'Integers practice — signs', class_grade: '7-A', student_id: 'stu_13', student_name: 'Farhan Ali', content_type: 'text', content_ref: '', submitted_at: null, status: 'missing', grade: null, feedback: null, reviewed_at: null },
];

/** GET /plugins/teacher.classroom/submissions?homework=&state= (§4, frozen) */
export async function listSubmissions(params: { homework?: string; state?: string } = {}): Promise<{ submissions: TeacherSubmission[] }> {
  const q = `${params.homework ? `homework=${encodeURIComponent(params.homework)}&` : ''}${params.state ? `state=${encodeURIComponent(params.state)}` : ''}`;
  return flowRead('submissions', `/plugins/teacher.classroom/submissions?${q}`, async () => {
    await waitF(340);
    const rows = fxSubmissions.filter(s =>
      (!params.homework || s.homework_id === params.homework) &&
      (!params.state || params.state === 'all' || s.status === params.state));
    return { submissions: rows };
  }).then(r => r.data);
}

/** POST /plugins/teacher.classroom/submissions/:id/review {status, grade?, feedback?} (§4, frozen) */
export async function reviewSubmission(id: string, body: { status: string; grade?: number; feedback?: string }): Promise<{ ok: boolean; submission: TeacherSubmission }> {
  return flowWrite('submissions', `/plugins/teacher.classroom/submissions/${encodeURIComponent(id)}/review`, { method: 'POST', body: JSON.stringify(body) }, async () => {
    await waitF(300);
    const sub = fxSubmissions.find(s => s.id === id);
    if (!sub) throw new Error('That submission is no longer in the inbox.');
    const updated: TeacherSubmission = {
      ...sub,
      status: body.status as TeacherSubmission['status'],
      grade: body.grade ?? sub.grade,
      feedback: body.feedback ?? sub.feedback,
      reviewed_at: body.status === 'missing' ? sub.reviewed_at : isoF(new Date()),
    };
    fxSubmissions = fxSubmissions.map(s => (s.id === id ? updated : s));
    return { ok: true, submission: updated };
  }).then(r => r.data);
}

/* ---- P8 teacher self-leave + duty + workload ---- */

let fxLeave: TeacherLeaveRequest[] = [
  {
    id: 'lv_31', kind: 'casual', from_date: dateOnlyF(9), to_date: dateOnlyF(9), reason: 'Family function out of town.', status: 'requested',
    approver_name: null, decided_at: null, note: null,
  },
  {
    id: 'lv_30', kind: 'sick', from_date: dateOnlyF(-6), to_date: dateOnlyF(-5), reason: 'Fever, doctor advised rest.', status: 'approved',
    approver_name: 'V. Menon (Coordinator)', decided_at: dayF(-7, 18, 20), note: 'Get well soon — roster adjusted.',
    handover: {
      substitute_name: 'R. Fernandes',
      classes: [
        { class_grade: '8-B', period: 'P2 · 09:15', subject: 'Maths', room: '204', note: 'Continue fractions — worksheet 3 revision. Last topic: adding unlike fractions.' },
        { class_grade: '8-A', period: 'P4 · 11:30', subject: 'Maths', room: '207', note: 'Word problems, guided set 1. Answer key on your desk.' },
        { class_grade: '7-A', period: 'P6 · 14:00', subject: 'Maths', room: 'Lab 1', note: 'Integers recap — activity sheet in the lab drawer.' },
      ],
      packet_at: dayF(-7, 18, 22),
    },
  },
  {
    id: 'lv_29', kind: 'casual', from_date: dateOnlyF(-20), to_date: dateOnlyF(-19), reason: 'Apartment maintenance — plumber visit.', status: 'rejected',
    approver_name: 'V. Menon (Coordinator)', decided_at: dayF(-21, 17), note: 'Both days clash with the Term-2 invigilation block. Please pick dates after the 20th.',
  },
];

/** POST /teacher/leave (self) (§4, frozen) */
export async function createLeave(body: { kind: LeaveKind; from_date: string; to_date: string; reason: string }): Promise<{ ok: boolean; request: TeacherLeaveRequest }> {
  return flowWrite('leave', '/teacher/leave', { method: 'POST', body: JSON.stringify(body) }, async () => {
    await waitF(420);
    if (!body.reason.trim()) throw new Error('Add a short reason — the coordinator reads it first.');
    if (new Date(body.to_date) < new Date(body.from_date)) throw new Error('The end date is before the start date.');
    const req: TeacherLeaveRequest = {
      id: uidF('lv'), kind: body.kind, from_date: body.from_date, to_date: body.to_date,
      reason: body.reason.trim(), status: 'requested', approver_name: null, decided_at: null, note: null,
    };
    fxLeave = [req, ...fxLeave];
    return { ok: true, request: req };
  }).then(r => r.data);
}

/** GET /teacher/leave/mine (§4, frozen) */
export async function listMyLeave(): Promise<{ requests: TeacherLeaveRequest[]; balances: LeaveBalance[] }> {
  return flowRead('leave', '/teacher/leave/mine', async () => {
    await waitF(340);
    return {
      requests: fxLeave,
      balances: [
        { kind: 'casual', entitled: 12, used: 4, carried: 2 },
        { kind: 'sick', entitled: 10, used: 2, carried: 0 },
        { kind: 'earned', entitled: 18, used: 6, carried: 5 },
        { kind: 'duty', entitled: 4, used: 1, carried: 0 },
      ],
    };
  }).then(r => r.data);
}

let fxDuties: DutyAssignment[] = [
  { id: 'du_1', kind: 'invigilation', date: dateOnlyF(1), period_label: 'P3', time: '10:15–11:15', place: 'Exam Hall B', source: 'roster' },
  { id: 'du_2', kind: 'corridor', date: dateOnlyF(2), period_label: 'P5', time: '12:30–13:15', place: 'Block B, first floor', source: 'roster' },
  { id: 'du_3', kind: 'lunch', date: dateOnlyF(3), period_label: 'Lunch', time: '12:30–13:15', place: 'Dining hall', source: 'roster' },
  { id: 'du_4', kind: 'substitution', date: dateOnlyF(4), period_label: 'P2', time: '09:15–10:00', place: 'Room 210 (6-B)', source: 'substitution' },
  { id: 'du_5', kind: 'assembly', date: dateOnlyF(0), period_label: 'Assembly', time: '07:45–08:15', place: 'Main ground', source: 'roster' },
  { id: 'du_6', kind: 'invigilation', date: dateOnlyF(-2), period_label: 'P4', time: '11:30–12:30', place: 'Exam Hall A', source: 'roster' },
];

/** GET /duty/roster?window= (§4, frozen) */
export async function listDutyRoster(window: 'today' | 'week' | 'month' = 'week'): Promise<{ duties: DutyAssignment[] }> {
  return flowRead(`duty_${window}`, `/duty/roster?window=${encodeURIComponent(window)}`, async () => {
    await waitF(320);
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const span = window === 'today' ? 1 : window === 'week' ? 7 : 31;
    return {
      duties: fxDuties.filter(d => {
        const t = new Date(d.date).getTime();
        return t >= from.getTime() - 2 * 86400000 && t < from.getTime() + span * 86400000; /* small back-window so completed duties show */
      }),
    };
  }).then(r => r.data);
}

/** GET /workload/mine (§4, frozen) */
export async function myWorkload(): Promise<{ workload: MyWorkload }> {
  return flowRead('workload', '/workload/mine', async () => {
    await waitF(300);
    return {
      workload: {
        week_label: 'This week',
        periods: 24,
        substitutions: 2,
        invigilation: 3,
        duties: 4,
        load_score: 61,
        grading_estimate_mins: 95,
        ptm_count: 2,
        meetings: 1,
        fair_band: { min: 18, max: 28 },
        note: 'Your load sits inside the fair band for your subject team. This is for your protection, not your rating.',
      },
    };
  }).then(r => r.data);
}

/* ---- P9 announcements ---- */

let fxAnnouncements: TeacherAnnouncement[] = [
  {
    id: 'an_1', audiences: ['8-B', '8-A'], title: 'Maths extra class on Saturday',
    body: 'A support class for fractions runs Saturday 09:00–10:00 in Room 204. It is optional — students who want the practice are welcome. Please send a reply slip by Friday.',
    template_id: null, status: 'sent', scheduled_at: null, sent_at: dayF(-1, 16, 5), receipts: { delivered: 43, read: 31, total: 46 },
  },
  {
    id: 'an_2', audiences: ['7-A'], title: 'Maths practice books home today',
    body: 'Practice books go home today for the weekend work. Please return them on Monday — nothing else is needed.',
    template_id: null, status: 'sent', scheduled_at: null, sent_at: dayF(-3, 12), receipts: { delivered: 22, read: 19, total: 23 },
  },
  {
    id: 'an_3', audiences: ['8-A'], title: 'Unit test 2 — syllabus note',
    body: 'Unit test 2 covers chapters 4 and 5. A revision sheet goes home on Monday. Nothing else is needed.',
    template_id: 'tpl_exam_info', status: 'scheduled', scheduled_at: dayF(1, 8), sent_at: null, receipts: { delivered: 0, read: 0, total: 23 },
  },
];

/** GET /comms/announcements?mine=1 — PROPOSED door (comms rail, P9); freeze with TS-1 */
export async function listAnnouncements(): Promise<{ announcements: TeacherAnnouncement[] }> {
  return flowRead('announce', '/comms/announcements?mine=1', async () => {
    await waitF(320);
    return { announcements: fxAnnouncements };
  }).then(r => r.data);
}

/** POST /comms/announcements — PROPOSED door (comms rail, P9); freeze with TS-1 */
export async function sendAnnouncement(body: { audiences: string[]; title: string; body: string; template_id?: string; scheduled_at?: string }): Promise<{ ok: boolean; announcement: TeacherAnnouncement }> {
  return flowWrite('announce', '/comms/announcements', { method: 'POST', body: JSON.stringify(body) }, async () => {
    await waitF(420);
    if (!body.audiences.length) throw new Error('Pick at least one class to announce to.');
    if (!body.title.trim()) throw new Error('Give the announcement a title.');
    const an: TeacherAnnouncement = {
      id: uidF('an'), audiences: body.audiences, title: body.title.trim(), body: body.body.trim(),
      template_id: body.template_id ?? null, status: body.scheduled_at ? 'scheduled' : 'sent',
      scheduled_at: body.scheduled_at ?? null, sent_at: body.scheduled_at ? null : isoF(new Date()),
      receipts: { delivered: 0, read: 0, total: 0 },
    };
    fxAnnouncements = [an, ...fxAnnouncements];
    return { ok: true, announcement: an };
  }).then(r => r.data);
}

/* ---- P9 messages (teacher ↔ guardian, masked numbers, M7.3 templates) ---- */

export const MESSAGE_TEMPLATES: MessageTemplate[] = [
  { id: 'tpl_hw_remind', name: 'Homework reminder', text: 'Hello, this is Priya Iyer, Class Teacher. A gentle reminder — {student} has not yet submitted "{homework}", due {due}. Kindly help them send it tomorrow. Thank you.' },
  { id: 'tpl_appreciation', name: 'Appreciation', text: 'Hello! Happy to share that {student} did very well this week — {detail}. Thought you would like to know. Thank you for the support at home.' },
  { id: 'tpl_concern', name: 'Concern', text: 'Hello, this is Priya Iyer. I wanted to share a small concern about {student} — {detail}. Nothing urgent, but a word together would help. Are you available for a short call this week?' },
  { id: 'tpl_ptm_invite', name: 'PTM invite', text: 'Hello! Parent-teacher meetings are on Saturday. I have kept a slot for {student} at {time}. Please confirm if the time works, and I will keep the slot for you.' },
];

let fxThreads: MsgThread[] = [
  {
    id: 'th_1', student_id: 'stu_10', student_name: 'Arjun Menon', class_grade: '8-B', guardian_name: 'Lata Menon', guardian_phone_masked: '+91 98•••• ••412', unread: 1,
    messages: [
      { id: 'tm_1', from: 'guardian', text: 'Good morning ma\'am. Arjun was unwell yesterday — he will submit the fractions worksheet today.', at: dayF(0, 7, 22) },
      { id: 'tm_2', from: 'teacher', text: 'Thank you for letting me know. Hope he is feeling better — today is fine.', at: dayF(0, 7, 40) },
      { id: 'tm_3', from: 'guardian', text: 'He is much better. One question — is the revision quiz counted for the term?', at: dayF(0, 8, 2) },
    ],
  },
  {
    id: 'th_2', student_id: 'stu_5', student_name: 'Ishaan Verma', class_grade: '8-A', guardian_name: 'R. Verma', guardian_phone_masked: '+91 97•••• ••880', unread: 0,
    messages: [
      { id: 'tm_4', from: 'teacher', text: 'Hello! Happy to share that Ishaan did very well this week — his word-problem work has improved a lot. Thought you would like to know.', at: dayF(-2, 16, 30), template_id: 'tpl_appreciation' },
      { id: 'tm_5', from: 'guardian', text: 'Thank you so much ma\'am, this made our evening. We will keep the practice going.', at: dayF(-2, 19, 12) },
    ],
  },
  {
    id: 'th_3', student_id: 'stu_3', student_name: 'Rohan Gupta', class_grade: '8-B', guardian_name: 'S. Gupta', guardian_phone_masked: '+91 96•••• ••037', unread: 0,
    messages: [
      { id: 'tm_6', from: 'teacher', text: 'Hello, this is Priya Iyer. I wanted to share a small concern about Rohan — homework has been late three times this month. Nothing urgent, but a word together would help. Are you available for a short call this week?', at: dayF(-1, 15, 45), template_id: 'tpl_concern' },
      { id: 'tm_7', from: 'guardian', text: 'Yes ma\'am, Saturday after 11 works. We will make sure the pending work is done by Friday.', at: dayF(-1, 20, 5) },
    ],
  },
];

/** GET /comms/threads?mine=1 — PROPOSED door (in-school messaging, P9); freeze with TS-1 */
export async function listThreads(): Promise<{ threads: MsgThread[] }> {
  return flowRead('threads', '/comms/threads?mine=1', async () => {
    await waitF(340);
    return { threads: fxThreads };
  }).then(r => r.data);
}

/** POST /comms/threads/:id/messages — PROPOSED door (in-school messaging, P9); freeze with TS-1 */
export async function sendThreadMessage(threadId: string, text: string, templateId?: string): Promise<{ ok: boolean; message: MsgMessage }> {
  return flowWrite('threads', `/comms/threads/${encodeURIComponent(threadId)}/messages`, { method: 'POST', body: JSON.stringify({ text, template_id: templateId }) }, async () => {
    await waitF(300);
    if (!text.trim()) throw new Error('Write the message before sending.');
    const th = fxThreads.find(t => t.id === threadId);
    if (!th) throw new Error('That conversation is no longer available.');
    const msg: MsgMessage = { id: uidF('tm'), from: 'teacher', text: text.trim(), at: isoF(new Date()), template_id: templateId };
    th.messages = [...th.messages, msg];
    th.unread = 0;
    return { ok: true, message: msg };
  }).then(r => r.data);
}

/* ---- P11 PTM — slot board + private notes (server shapes) ---- */

const ME = 'usr_priya'; /* fixture self — Priya Iyer */

let fxSlots: PtmSlot[] = [
  { slotId: 'ps_1', teacherId: ME, teacherName: 'Priya Iyer', date: dateOnlyF(3), startTime: '09:00', endTime: '09:20', status: 'booked', booked: true, bookingId: 'bk_1', bookedStudentId: 'stu_1', bookedStudentName: 'Aarav Sharma' },
  { slotId: 'ps_2', teacherId: ME, teacherName: 'Priya Iyer', date: dateOnlyF(3), startTime: '09:20', endTime: '09:40', status: 'booked', booked: true, bookingId: 'bk_2', bookedStudentId: 'stu_4', bookedStudentName: 'Diya Patel' },
  { slotId: 'ps_3', teacherId: ME, teacherName: 'Priya Iyer', date: dateOnlyF(3), startTime: '09:40', endTime: '10:00', status: 'open', booked: false },
  { slotId: 'ps_4', teacherId: ME, teacherName: 'Priya Iyer', date: dateOnlyF(3), startTime: '10:00', endTime: '10:20', status: 'open', booked: false },
  { slotId: 'ps_5', teacherId: ME, teacherName: 'Priya Iyer', date: dateOnlyF(3), startTime: '10:20', endTime: '10:40', status: 'booked', booked: true, bookingId: 'bk_3', bookedStudentId: 'stu_2', bookedStudentName: 'Kavya Nair' },
  { slotId: 'ps_6', teacherId: ME, teacherName: 'Priya Iyer', date: dateOnlyF(3), startTime: '10:40', endTime: '11:00', status: 'open', booked: false },
];

/* PRIVATE teacher notes (P11) — keyed by booking id, like the server's
   user-pinned teacher.note ledger. Never shown to anyone but the teacher. */
const fxNotes: Record<string, PtmNote[]> = {
  bk_3: [{ noteId: 'pn_1', note: 'Asked about maths confidence. Agreed: 10 minutes of word problems daily at home; I share a weekly progress note until the next PTM.', at: dayF(-1, 17, 10) }],
};

function fxMeetingFromSlot(s: PtmSlot): PtmMeeting {
  return {
    bookingId: s.bookingId ?? null,
    slotId: s.slotId,
    date: s.date,
    startTime: s.startTime,
    studentName: s.bookedStudentName ?? '—',
    guardianName: null,
    status: 'booked',
    notes: s.bookingId ? fxNotes[s.bookingId] ?? [] : [],
  };
}

/** GET /ptm/slots — the board (§4). `mine` filters to the signed-in teacher
 *  by name when the caller has it (the board is school-wide for staff). */
export async function listPtmSlots(mine?: string): Promise<{ slots: PtmSlot[] }> {
  return flowRead('ptm_slots', '/ptm/slots', async () => {
    await waitF(300);
    return { slots: fxSlots.filter(s => !mine || s.teacherName === mine) };
  }).then(r => ({ slots: (r.data.slots ?? []).filter(s => !mine || !r.source || r.source === 'fixture' || s.teacherName === mine) }));
}

/** POST /ptm/slots {date, startTime, endTime} — ONE slot per call (server law:
 *  HH:MM, end after start, one slot per start time). Publishing a block of
 *  slots = sequential calls from the screen, like bulk review. */
export async function createPtmSlot(body: { date: string; startTime: string; endTime: string }): Promise<{ ok: boolean; slotId?: string; status?: string }> {
  return flowWrite('ptm_slots', '/ptm/slots', { method: 'POST', body: JSON.stringify(body) }, async () => {
    await waitF(300);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) throw new Error('Slot date must be YYYY-MM-DD');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(body.startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.endTime)) throw new Error('Times must be HH:MM (24-hour)');
    if (body.startTime >= body.endTime) throw new Error('End time must be after the start time');
    if (fxSlots.some(s => s.date === body.date && s.startTime === body.startTime && s.teacherName === teacherContext.name)) {
      throw new Error('You already have a slot at that time — pick another start time');
    }
    const slot: PtmSlot = { slotId: uidF('ps'), teacherId: ME, teacherName: teacherContext.name, date: body.date, startTime: body.startTime, endTime: body.endTime, status: 'open', booked: false };
    fxSlots = [...fxSlots, slot].sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
    return { ok: true, slotId: slot.slotId, status: 'open' };
  }).then(r => r.data);
}

/** The teacher's booked meetings — booked slots on my board. */
export async function listPtmMeetings(mine?: string): Promise<{ meetings: PtmMeeting[] }> {
  const { slots } = await listPtmSlots(mine);
  return { meetings: slots.filter(s => s.booked).map(fxMeetingFromSlot) };
}

/** GET /ptm/:id/notes (:id = booking id) — private, teacher-only. */
export async function listPtmNotes(bookingId: string): Promise<{ bookingId: string; notes: PtmNote[] }> {
  return flowRead(`ptm_notes_${bookingId}`, `/ptm/${encodeURIComponent(bookingId)}/notes`, async () => {
    await waitF(240);
    if (!fxNotes[bookingId]) throw new Error("We couldn't find that PTM booking");
    return { bookingId, notes: fxNotes[bookingId] };
  }).then(r => r.data);
}

/** POST /ptm/:id/notes {note} — PRIVATE: "Only you can see this." */
export async function savePtmNotes(bookingId: string, note: string): Promise<{ ok: boolean; private: boolean }> {
  return flowWrite('ptm_meetings', `/ptm/${encodeURIComponent(bookingId)}/notes`, { method: 'POST', body: JSON.stringify({ note }) }, async () => {
    await waitF(280);
    if (!note.trim()) throw new Error('Write the meeting note first');
    if (!fxNotes[bookingId]) throw new Error("We couldn't find that PTM booking");
    fxNotes[bookingId] = [...fxNotes[bookingId], { noteId: uidF('pn'), note: note.trim(), at: isoF(new Date()) }];
    return { ok: true, private: true };
  }).then(r => r.data);
}

/* ---- P10 · concerns (teacher.support, TS-2 — exact door shapes) ----
   POST /teacher/concern        {studentId?, category, urgency?, detail}
                                  → { ok, concernId, status, escalateActionId? }
   GET  /teacher/concerns       → { scope, concerns: [...] }  (teacher = own filed)
   GET  /teacher/concern/:id/events → { concernId, events: [{ from, to, note, at }] }
   Safety-category or critical concerns raise a principal-desk escalation
   server-side (concern.escalate.<id>) — the screen says so in plain words. */

export type ConcernCategory = 'academic' | 'attendance' | 'behaviour' | 'wellbeing' | 'safety' | 'engagement';
export type ConcernUrgency = 'low' | 'normal' | 'high' | 'critical';

export interface TeacherConcern {
  concernId: string;
  studentId: string | null;
  studentName: string | null;
  category: ConcernCategory;
  urgency: ConcernUrgency;
  detail: string;
  status: 'open' | 'routed' | 'closed';
  routedRole: string | null;
  outcome: string | null;
  outcomeNote: string | null;
  createdAt: string;
}

export interface ConcernEvent { from: string | null; to: string; note: string | null; at: string }

let fxConcerns: TeacherConcern[] = [
  {
    concernId: 'con_2', studentId: 'stu_3', studentName: 'Rohan Gupta', category: 'attendance', urgency: 'normal',
    detail: 'Late three mornings this week, tired in class. Guardian said the commute changed — worth a check-in before it becomes a pattern.',
    status: 'routed', routedRole: 'counselor', outcome: null, outcomeNote: null, createdAt: dayF(-2, 11, 20),
  },
  {
    concernId: 'con_1', studentId: 'stu_8', studentName: 'Sara Khan', category: 'academic', urgency: 'low',
    detail: 'Word problems slip when two steps are combined — she loses the thread mid-sum. Practice set sent home.',
    status: 'closed', routedRole: 'counselor', outcome: 'resolved', outcomeNote: 'Extra practice set shared with home; reviewed after two weeks — improving.', createdAt: dayF(-9, 15),
  },
];

/** POST /teacher/concern — one-tap flag. */
export async function fileConcern(body: { studentId?: string | null; category: ConcernCategory; urgency?: ConcernUrgency; detail: string }): Promise<{ ok: boolean; concernId: string; status: string; escalateActionId?: string | null }> {
  return flowWrite('concern', '/teacher/concern', { method: 'POST', body: JSON.stringify(body) }, async () => {
    await waitF(360);
    if (!body.detail.trim()) throw new Error('Please describe what you noticed');
    const student = body.studentId ? fxRoster.find(r => r.id === body.studentId) : undefined;
    const row: TeacherConcern = {
      concernId: uidF('con'),
      studentId: body.studentId ?? null,
      studentName: student?.name ?? null,
      category: body.category,
      urgency: body.urgency ?? 'normal',
      detail: body.detail.trim().slice(0, 2000),
      status: 'open', routedRole: null, outcome: null, outcomeNote: null,
      createdAt: isoF(new Date()),
    };
    fxConcerns = [row, ...fxConcerns];
    const escalates = body.category === 'safety' || (body.urgency ?? 'normal') === 'critical';
    return { ok: true, concernId: row.concernId, status: 'open', escalateActionId: escalates ? uidF('act') : null };
  }).then(r => r.data);
}

/** GET /teacher/concerns — a teacher sees the concerns they filed. */
export async function listMyConcerns(): Promise<{ scope: string; concerns: TeacherConcern[] }> {
  return flowRead('concern', '/teacher/concerns', async () => {
    await waitF(320);
    return { scope: 'own_filed', concerns: fxConcerns };
  }).then(r => r.data);
}

/** GET /teacher/concern/:id/events — the append-only history. */
export async function concernEvents(concernId: string): Promise<{ concernId: string; events: ConcernEvent[] }> {
  return flowRead(`concern_${concernId}`, `/teacher/concern/${encodeURIComponent(concernId)}/events`, async () => {
    await waitF(240);
    const c = fxConcerns.find(x => x.concernId === concernId);
    if (!c) throw new Error("We couldn't find that concern");
    const evs: ConcernEvent[] = [{ from: null, to: 'open', note: 'concern filed', at: c.createdAt }];
    if (c.routedRole) evs.push({ from: 'open', to: 'routed', note: `routed to ${c.routedRole}`, at: c.createdAt });
    if (c.status === 'closed') evs.push({ from: 'routed', to: 'closed', note: `outcome: ${c.outcome} — ${c.outcomeNote ?? ''}`.trim(), at: c.createdAt });
    return { concernId, events: evs };
  }).then(r => r.data);
}

/* ============================================================
   TU-3 (ui-insights) SECTION — mastery maps · progress stories ·
   curriculum coverage · class analytics · interventions.

   Seam law (same as above): TU-1 owns the home/brief block,
   TU-2 owns the flow block; TU-3 owns everything below THIS
   line. Consumes the shared helpers above (flowRead/flowWrite/
   waitF/dayF/uidF/teacherContext) — never edits them. Demo
   student identities follow the seed roster already used by
   TU-2 fixtures (stu_1 Aarav Sharma …) so evidence links stay
   coherent across lanes.

   A3 rule baked into the data: every mastery label carries
   evidence + confidence + expiry. Evidence older than 28 days
   no longer feeds the label (staleness().expired) — screens
   must show the decay note, never a naked 🔴.

   Doors (frozen §4 unless marked PROPOSED):
     GET  /mastery/student/:id?subject=      getMasteryStudent
     GET  /mastery/class/:grade?subject=     getMasteryClass
     GET  /curriculum/tree?subject=&grade=   getCurriculumTree
     POST /curriculum/progress               saveCurriculumProgress
     GET  /interventions?student=            getInterventions
     POST /interventions                     createIntervention
     POST /interventions/:id/reassess        moveIntervention
     GET  /progress/story/:studentId         getProgressStory   (PROPOSED)
     GET  /analytics/class/:grade            getClassAnalytics  (PROPOSED composite)
   ============================================================ */

/* ---------- A3 mastery types ---------- */

export type MasteryLevel = 'strong' | 'developing' | 'needs_support';

export interface MasteryEvidence {
  id: string;
  kind: 'assessment' | 'homework' | 'observation' | 'intervention';
  title: string;
  /** Where the evidence row deep-links (teacher flow routes). */
  link: 'homework' | 'assessment' | 'observation' | 'intervention';
  /** One plain-language line: what the evidence showed. */
  value: string;
  observedAt: string;
  expiresAt: string;
}

export interface MasteryTopic {
  nodeId: string;
  topic: string;
  unit: string;
  level: MasteryLevel;
  /** 0–100, derived from evidence count + freshness — never a raw score. */
  confidence: number;
  trend: 'improving' | 'steady' | 'dipping';
  evidence: MasteryEvidence[];
}

export interface MasteryStudent {
  studentId: string;
  name: string;
  classGrade: string;
  topics: MasteryTopic[];
}

export const MASTERY_LABEL: Record<MasteryLevel, string> = {
  strong: 'Strong',
  developing: 'Developing',
  needs_support: 'Needs support',
};

/** Dot + tone + color per level — words are always present (never a naked 🔴). */
export const MASTERY_STYLE: Record<MasteryLevel, { dot: string; color: string; tone: 'success' | 'warning' | 'danger' }> = {
  strong: { dot: '🟢', color: 'var(--success)', tone: 'success' },
  developing: { dot: '🟡', color: 'var(--warning)', tone: 'warning' },
  needs_support: { dot: '🔴', color: 'var(--danger)', tone: 'danger' },
};

export const TREND_INFO: Record<MasteryTopic['trend'], { glyph: string; label: string; color: string }> = {
  improving: { glyph: '▲', label: 'improving', color: 'var(--success)' },
  steady: { glyph: '▬', label: 'steady', color: 'var(--text-3)' },
  dipping: { glyph: '▼', label: 'dipping', color: 'var(--danger)' },
};

/** Plain staleness for A3 copy. Evidence ≥ 4 weeks old is expired. */
export function staleness(date: string): { label: string; expired: boolean } {
  const weeks = Math.floor((Date.now() - new Date(date).getTime()) / (7 * 86400000));
  if (weeks < 1) return { label: 'this week', expired: false };
  if (weeks === 1) return { label: '1 week ago', expired: false };
  if (weeks < 4) return { label: `${weeks} weeks ago`, expired: false };
  const months = Math.floor(weeks / 4);
  return { label: `${months} month${months > 1 ? 's' : ''} ago`, expired: true };
}

export const liveEvidence = (t: MasteryTopic) => t.evidence.filter(e => !staleness(e.observedAt).expired);

function confidenceOf(ev: MasteryEvidence[]): number {
  const live = ev.filter(e => !staleness(e.observedAt).expired);
  if (!live.length) return 20;
  const fresh = live.filter(e => staleness(e.observedAt).weeks === undefined ? false : Date.now() - new Date(e.observedAt).getTime() < 14 * 86400000).length;
  return Math.min(94, 46 + fresh * 16 + (live.length - 1) * 8);
}

/* ---------- roster (aligned with TU-2 fixture identities) ---------- */

export interface RosterStudent { id: string; name: string; classGrade: string }

const fxRoster: RosterStudent[] = [
  { id: 'stu_1', name: 'Aarav Sharma', classGrade: '8-B' },
  { id: 'stu_2', name: 'Kavya Nair', classGrade: '8-B' },
  { id: 'stu_3', name: 'Rohan Gupta', classGrade: '8-B' },
  { id: 'stu_9', name: 'Tanvi Rao', classGrade: '8-B' },
  { id: 'stu_10', name: 'Arjun Menon', classGrade: '8-B' },
  { id: 'stu_11', name: 'Nisha Pillai', classGrade: '8-B' },
  { id: 'stu_4', name: 'Diya Patel', classGrade: '8-A' },
  { id: 'stu_5', name: 'Ishaan Verma', classGrade: '8-A' },
  { id: 'stu_12', name: 'Vikram Shetty', classGrade: '8-A' },
  { id: 'stu_6', name: 'Meera Pillai', classGrade: '7-A' },
  { id: 'stu_7', name: 'Anil Kumar', classGrade: '7-A' },
  { id: 'stu_8', name: 'Sara Khan', classGrade: '7-A' },
  { id: 'stu_13', name: 'Farhan Ali', classGrade: '7-A' },
];

export function rosterFor(classGrade: string): RosterStudent[] {
  return fxRoster.filter(r => r.classGrade === classGrade);
}

/* ---------- mastery fixtures (per-profile arcs, deterministic) ---------- */

type TopicArc = { topic: string; unit: string; level: MasteryLevel; trend: MasteryTopic['trend']; ev: MasteryEvidence[] };

function arcEvidence(sid: string, tag: string): MasteryEvidence[] {
  switch (tag) {
    case 'fractions_strong': return [
      { id: `${sid}_e1`, kind: 'assessment', title: 'Unit test — Fractions', link: 'assessment', value: '14/20 — added unlike denominators correctly', observedAt: dayF(-12, 10), expiresAt: dayF(-12 + 28, 10) },
      { id: `${sid}_e2`, kind: 'homework', title: 'Fractions worksheet 4', link: 'homework', value: 'Reviewed · 6/7 correct', observedAt: dayF(-5, 9), expiresAt: dayF(-5 + 28, 9) },
      { id: `${sid}_e3`, kind: 'observation', title: 'Observation — class work', link: 'observation', value: 'Explained equivalent fractions to a partner unprompted', observedAt: dayF(-2, 11), expiresAt: dayF(-2 + 28, 11) },
    ];
    case 'equations_developing': return [
      { id: `${sid}_e4`, kind: 'assessment', title: 'Class test — Simple equations', link: 'assessment', value: '9/20 — sign slips when moving terms', observedAt: dayF(-24, 10), expiresAt: dayF(-24 + 28, 10) },
      { id: `${sid}_e5`, kind: 'intervention', title: 'Equation re-teach — 3 weeks', link: 'intervention', value: 'Recheck quiz scheduled this week', observedAt: dayF(-10, 12), expiresAt: dayF(-10 + 28, 12) },
    ];
    case 'angles_strong': return [
      { id: `${sid}_e6`, kind: 'assessment', title: 'Unit test — Lines & angles', link: 'assessment', value: '16/20 — angle-sum rule solid', observedAt: dayF(-9, 10), expiresAt: dayF(-9 + 28, 10) },
      { id: `${sid}_e7`, kind: 'homework', title: 'Triangles practice', link: 'homework', value: 'Late submission · reviewed · 4/7 correct', observedAt: dayF(-3, 9), expiresAt: dayF(-3 + 28, 9) },
    ];
    case 'word_problems_weak': return [
      { id: `${sid}_e8`, kind: 'assessment', title: 'Unit test — Fractions (word problems)', link: 'assessment', value: '2 of 8 word problems correct', observedAt: dayF(-12, 10), expiresAt: dayF(-12 + 28, 10) },
      { id: `${sid}_e9`, kind: 'homework', title: 'Word problems set 2', link: 'homework', value: 'Not submitted', observedAt: dayF(-7, 9), expiresAt: dayF(-7 + 28, 9) },
      { id: `${sid}_e10`, kind: 'observation', title: 'Observation — class work', link: 'observation', value: 'Reads the problem twice, unsure where to start', observedAt: dayF(-4, 11), expiresAt: dayF(-4 + 28, 11) },
    ];
    /* expired-only arc: every piece is > 4 weeks old → the label must decay (A3) */
    case 'stale': return [
      { id: `${sid}_e11`, kind: 'assessment', title: 'Class test — Simple equations', link: 'assessment', value: '11/20 — improving from the previous test', observedAt: dayF(-33, 10), expiresAt: dayF(-33 + 28, 10) },
    ];
    default: return [
      { id: `${sid}_ed`, kind: 'assessment', title: 'Unit test — Fractions', link: 'assessment', value: '11/20 — developing, most basics in place', observedAt: dayF(-15, 10), expiresAt: dayF(-15 + 28, 10) },
      { id: `${sid}_eh`, kind: 'homework', title: 'Fractions worksheet 4', link: 'homework', value: 'Submitted on time · 5/7 correct', observedAt: dayF(-6, 9), expiresAt: dayF(-6 + 28, 9) },
    ];
  }
}

function topicsFor(sid: string, profile: number): TopicArc[] {
  /* profile 0 = the canonical demo arc (Aarav): fractions strong ·
     equations developing · word problems weak with one stale topic */
  const arcs: TopicArc[] = [
    { topic: 'Fractions', unit: 'Number sense', level: 'strong', trend: 'improving', ev: arcEvidence(sid, 'fractions_strong') },
    { topic: 'Simple equations', unit: 'Algebra', level: 'developing', trend: 'improving', ev: arcEvidence(sid, profile === 0 ? 'equations_developing' : profile === 3 ? 'stale' : 'default') },
    { topic: 'Lines & angles', unit: 'Geometry', level: 'strong', trend: 'steady', ev: arcEvidence(sid, 'angles_strong') },
    { topic: 'Word problems', unit: 'Number sense', level: profile % 3 === 0 ? 'needs_support' : 'developing', trend: profile % 3 === 0 ? 'dipping' : 'steady', ev: arcEvidence(sid, profile % 3 === 0 ? 'word_problems_weak' : 'default') },
  ];
  return arcs;
}

const MASTERY_PROFILES: Record<string, number> = { stu_1: 0, stu_2: 1, stu_3: 0, stu_9: 2, stu_10: 3, stu_11: 1, stu_4: 2, stu_5: 1, stu_12: 3, stu_6: 1, stu_7: 0, stu_8: 2, stu_13: 1 };

/** GET /mastery/student/:id?subject= (§4, frozen) — evidence-linked, decayed. */
export async function getMasteryStudent(studentId: string, subject = 'Maths'): Promise<{ data: MasteryStudent | null; source: TeacherSource }> {
  return flowRead('mastery_student', `/mastery/student/${encodeURIComponent(studentId)}?subject=${encodeURIComponent(subject)}`, async () => {
    await waitF(320);
    const st = fxRoster.find(r => r.id === studentId);
    if (!st) throw new Error('That student is not on your class lists. Open a student from one of your own classes.');
    const arcs = topicsFor(studentId, MASTERY_PROFILES[studentId] ?? 1);
    const topics: MasteryTopic[] = arcs.map((a, i) => {
      const live = a.ev.filter(e => !staleness(e.observedAt).expired);
      /* A3: a label with no live evidence must not stand — it decays to developing, low confidence */
      const level: MasteryLevel = live.length ? a.level : 'developing';
      return { nodeId: `m_${subject}_${i}`, topic: a.topic, unit: a.unit, level, confidence: confidenceOf(a.ev), trend: a.trend, evidence: a.ev };
    });
    return { data: { studentId, name: st.name, classGrade: st.classGrade, topics }, source: 'fixture' as TeacherSource };
  }).then(r => ({ data: r.data ?? null, source: r.source }));
}

/** GET /mastery/class/:grade?subject= (§4, frozen) — one row per child, no ranking. */
export async function getMasteryClass(classGrade: string, subject = 'Maths'): Promise<{ data: MasteryStudent[]; source: TeacherSource }> {
  return flowRead('mastery_class', `/mastery/class/${encodeURIComponent(classGrade)}?subject=${encodeURIComponent(subject)}`, async () => {
    await waitF(360);
    return {
      data: rosterFor(classGrade).map(st => {
        const arcs = topicsFor(st.id, MASTERY_PROFILES[st.id] ?? 1);
        const topics: MasteryTopic[] = arcs.map((a, i) => {
          const live = a.ev.filter(e => !staleness(e.observedAt).expired);
          const level: MasteryLevel = live.length ? a.level : 'developing';
          return { nodeId: `m_${subject}_${i}`, topic: a.topic, unit: a.unit, level, confidence: confidenceOf(a.ev), trend: a.trend, evidence: a.ev };
        });
        return { studentId: st.id, name: st.name, classGrade, topics };
      }),
      source: 'fixture' as TeacherSource,
    };
  }).then(r => ({ data: r.data ?? [], source: r.source }));
}

/* ---------- progress story (P5 narrative over evidence) ---------- */

export type StoryKind = 'introduced' | 'homework' | 'submission' | 'assessment' | 'intervention' | 'observed' | 'improvement';

export interface StoryStep {
  id: string;
  at: string;
  kind: StoryKind;
  /** One plain sentence — the whole point of this view. */
  sentence: string;
  evidenceRef?: string;
  evidenceLink?: MasteryEvidence['link'];
}

export const STORY_KIND_LABEL: Record<StoryKind, string> = {
  introduced: 'Lesson', homework: 'Homework', submission: 'Submission',
  assessment: 'Assessment', intervention: 'Support', observed: 'Observation', improvement: 'Improvement',
};

/** GET /progress/story/:studentId — PROPOSED door (builds from mastery.evidence
 *  + lesson + intervention events; freeze with TS-3 before W2). */
export async function getProgressStory(studentId: string): Promise<{ data: { studentName: string; steps: StoryStep[] } | null; source: TeacherSource }> {
  return flowRead('story', `/progress/story/${encodeURIComponent(studentId)}`, async () => {
    await waitF(340);
    const st = fxRoster.find(r => r.id === studentId);
    if (!st) throw new Error('That student is not on your class lists. Open a story from one of your own classes.');
    const steps: StoryStep[] = [
      { id: 'ps1', at: dayF(-38, 10), kind: 'introduced', sentence: 'Fractions were introduced in class — posters and paper strips.', evidenceRef: 'Lesson · 18 Jul' },
      { id: 'ps2', at: dayF(-31, 9), kind: 'homework', sentence: 'First homework came back on time, but adding unlike fractions looked shaky.', evidenceRef: 'Homework · Fraction basics', evidenceLink: 'homework' },
      { id: 'ps3', at: dayF(-24, 10), kind: 'assessment', sentence: 'Unit test went poorly — 8/20, most marks lost on word problems.', evidenceRef: 'Unit test · Fractions', evidenceLink: 'assessment' },
      { id: 'ps4', at: dayF(-22, 12), kind: 'intervention', sentence: 'Fraction clinic started — three short sessions a week with Ms. Iyer.', evidenceRef: 'Intervention · Fraction clinic', evidenceLink: 'intervention' },
      { id: 'ps5', at: dayF(-12, 10), kind: 'assessment', sentence: 'Re-test improved — 14/20. Word problems are still the gap.', evidenceRef: 'Unit test · Fractions (re-test)', evidenceLink: 'assessment' },
      { id: 'ps6', at: dayF(-5, 9), kind: 'submission', sentence: 'Worksheet 4 came in on time with 6/7 correct.', evidenceRef: 'Homework · Fractions worksheet 4', evidenceLink: 'homework' },
      { id: 'ps7', at: dayF(-2, 11), kind: 'improvement', sentence: 'Explained equivalent fractions to a partner without help — mastery evidence.', evidenceRef: 'Observation · Class work', evidenceLink: 'observation' },
    ];
    return { data: { studentName: st.name, steps }, source: 'fixture' as TeacherSource };
  }).then(r => ({ data: r.data ?? null, source: r.source }));
}

/* ---------- curriculum (A1: seeded tree; teachers only tick coverage) ---------- */

export interface CurriculumNode {
  id: string;
  unit: string;
  topic: string;
  order: number;
  coveredPct: number;
  coveredBy?: string;
  coveredAt?: string;
  /** Set when a covered topic still shows weak mastery — plan a revision. */
  revisionNeed?: number;
}

export interface CurriculumClass {
  classGrade: string;
  subject: string;
  /** Plain pacing vs the office plan. */
  pacing: 'ahead' | 'on_track' | 'behind';
  pacingWeeks: number;
  pacingNote: string;
  units: CurriculumNode[];
}

let fxCurriculum: Record<string, CurriculumClass> = {};

function buildCurriculum(classGrade: string): CurriculumClass {
  const plan: { unit: string; topics: { topic: string; pct: number; by?: string; at?: number; revisionNeed?: number }[] }[] = [
    { unit: 'Number sense', topics: [
      { topic: 'Rational numbers', pct: 100, by: 'Priya Iyer', at: 34 },
      { topic: 'Fractions', pct: 100, by: 'Priya Iyer', at: 26, revisionNeed: 5 },
      { topic: 'Word problems', pct: 45, by: 'Priya Iyer', at: 9, revisionNeed: 7 },
    ] },
    { unit: 'Algebra', topics: [
      { topic: 'Simple equations', pct: 80, by: 'Priya Iyer', at: 6, revisionNeed: 6 },
      { topic: 'Linear expressions', pct: 0 },
    ] },
    { unit: 'Geometry', topics: [
      { topic: 'Lines & angles', pct: 100, by: 'Priya Iyer', at: 14 },
      { topic: 'Triangles', pct: 10 },
    ] },
    { unit: 'Data handling', topics: [
      { topic: 'Bar graphs & percentages', pct: 0 },
    ] },
  ];
  const pacingByClass: Record<string, { pacing: CurriculumClass['pacing']; weeks: number; note: string }> = {
    '8-B': { pacing: 'behind', weeks: 2, note: 'Geometry is 2 weeks behind plan — Triangles was due last fortnight. The term plan has buffer weeks in October; cover Triangles before the unit test.' },
    '8-A': { pacing: 'on_track', weeks: 0, note: 'Units are landing close to plan — nothing needs catching up this week.' },
    '7-A': { pacing: 'ahead', weeks: 1, note: 'About 1 week ahead of plan — a good moment for a practice round before moving on.' },
  };
  const p = pacingByClass[classGrade] ?? pacingByClass['8-B'];
  return {
    classGrade, subject: 'Maths', pacing: p.pacing, pacingWeeks: p.weeks, pacingNote: p.note,
    units: plan.flatMap((u, ui) => u.topics.map((t, ti) => ({
      id: `c_${classGrade}_${ui}_${ti}`, unit: u.unit, topic: t.topic, order: ui * 10 + ti,
      coveredPct: t.pct, coveredBy: t.by, coveredAt: t.at !== undefined ? dayF(-t.at, 12) : undefined, revisionNeed: t.revisionNeed,
    }))),
  };
}

/** GET /curriculum/tree?subject=&grade= (§4, frozen) — progress rides the tree read. */
export async function getCurriculumTree(classGrade: string, subject = 'Maths'): Promise<{ data: CurriculumClass | null; source: TeacherSource }> {
  return flowRead(`curriculum_${classGrade}`, `/curriculum/tree?subject=${encodeURIComponent(subject)}&grade=${encodeURIComponent(classGrade.split('-')[0] ?? '8')}`, async () => {
    await waitF(340);
    if (!fxCurriculum[classGrade]) fxCurriculum[classGrade] = buildCurriculum(classGrade);
    return { data: fxCurriculum[classGrade], source: 'fixture' as TeacherSource };
  }).then(r => ({ data: r.data ?? null, source: r.source }));
}

/** POST /curriculum/progress {node_id, class_grade, pct, evidence?} (§4, frozen). */
export async function saveCurriculumProgress(nodeId: string, classGrade: string, pct: number): Promise<{ data: CurriculumClass | null; source: TeacherSource }> {
  return flowWrite('curriculum', '/curriculum/progress', { method: 'POST', body: JSON.stringify({ node_id: nodeId, class_grade: classGrade, pct }) }, async () => {
    await waitF(300);
    if (!fxCurriculum[classGrade]) fxCurriculum[classGrade] = buildCurriculum(classGrade);
    const n = fxCurriculum[classGrade].units.find(u => u.id === nodeId);
    if (!n) throw new Error('That topic is no longer on the plan. Refresh the page.');
    n.coveredPct = pct;
    n.coveredBy = teacherContext.name;
    n.coveredAt = isoF(new Date());
    return { data: fxCurriculum[classGrade], source: 'fixture' as TeacherSource };
  }).then(r => ({ data: r.data ?? null, source: r.source }));
}

/* ---------- class analytics (P7 — questions, never rankings) ---------- */

export interface StudentDimensions {
  studentId: string;
  name: string;
  /** Multi-dimension on purpose: never one score per child. */
  mastery: { strong: number; developing: number; needs_support: number };
  homeworkCompletionPct: number;
  attendancePct: number;
  trend: MasteryTopic['trend'];
  trendNote: string;
}

export interface TopicNeed { topic: string; needsSupport: number; of: number }

export interface ErrorPattern {
  pattern: string;
  topic: string;
  count: number;
  plain: string;
}

export interface HomeworkCompletion { title: string; classGrade: string; completedPct: number; missing: number }

export interface ClassAnalyticsData {
  classGrade: string;
  subject: string;
  topicNeeds: TopicNeed[];
  improving: StudentDimensions[];
  checkIn: StudentDimensions[];
  homework: HomeworkCompletion[];
  errorPatterns: ErrorPattern[];
  readiness: { nextUnit: string; verdict: 'ready' | 'almost' | 'not_yet'; reasons: string[] };
}

function dimsFor(st: RosterStudent, profile: number): StudentDimensions {
  const cycle = profile % 5;
  return {
    studentId: st.id,
    name: st.name,
    mastery: cycle === 0 ? { strong: 1, developing: 2, needs_support: 1 }
      : cycle === 1 ? { strong: 2, developing: 2, needs_support: 0 }
      : cycle === 2 ? { strong: 3, developing: 1, needs_support: 0 }
      : cycle === 3 ? { strong: 0, developing: 3, needs_support: 1 }
      : { strong: 2, developing: 1, needs_support: 1 },
    homeworkCompletionPct: [40, 75, 92, 66, 84][cycle],
    attendancePct: [81, 96, 98, 88, 93][cycle],
    trend: cycle === 0 ? 'dipping' : cycle === 2 || cycle === 3 ? 'improving' : 'steady',
    trendNote: cycle === 0 ? 'Two homework sets went missing this month'
      : cycle === 2 ? 'Re-test and clinic homework both improved'
      : cycle === 3 ? 'Attendance back up, homework resumed'
      : 'No change worth acting on',
  };
}

/** GET /analytics/class/:grade — PROPOSED composite door (mastery.class +
 *  homework completion + assessment patterns + readiness); freeze with TS-3. */
export async function getClassAnalytics(classGrade: string): Promise<{ data: ClassAnalyticsData | null; source: TeacherSource }> {
  return flowRead(`analytics_${classGrade}`, `/analytics/class/${encodeURIComponent(classGrade)}`, async () => {
    await waitF(380);
    const roster = rosterFor(classGrade);
    const dims = roster.map(st => dimsFor(st, MASTERY_PROFILES[st.id] ?? 1));
    return {
      data: {
        classGrade, subject: 'Maths',
        topicNeeds: [
          { topic: 'Word problems', needsSupport: 4, of: roster.length },
          { topic: 'Simple equations', needsSupport: 3, of: roster.length },
          { topic: 'Fractions', needsSupport: 1, of: roster.length },
          { topic: 'Lines & angles', needsSupport: 0, of: roster.length },
        ],
        improving: dims.filter(d => d.trend === 'improving'),
        checkIn: dims.filter(d => d.trend === 'dipping' || d.mastery.needs_support > 0),
        homework: [
          { title: 'Mensuration revision quiz', classGrade, completedPct: 100, missing: 0 },
          { title: 'Word problems set 2', classGrade, completedPct: 91, missing: 2 },
          { title: 'Fractions worksheet 4', classGrade, completedPct: 80, missing: 3 },
          { title: 'Integers practice — signs', classGrade, completedPct: 55, missing: 6 },
        ],
        errorPatterns: [
          { pattern: 'Added denominators without a common one', topic: 'Fractions', count: 9, plain: '1/2 + 1/3 answered as 2/5 — the most common slip in the last test.' },
          { pattern: 'Sign errors moving terms across equals', topic: 'Algebra', count: 6, plain: 'x + 4 = 10 answered as x = 14.' },
          { pattern: 'Correct sums on a different quantity than asked', topic: 'Word problems', count: 7, plain: 'The working is right — the question asked for something else.' },
        ],
        readiness: {
          nextUnit: 'Linear expressions (Algebra)',
          verdict: 'almost',
          reasons: [
            'Simple equations coverage is at 80% — two lessons left.',
            '6 students still show sign slips on moving terms.',
            'Fractions are strong for most of the class, which the next unit builds on.',
          ],
        },
      },
      source: 'fixture' as TeacherSource,
    };
  }).then(r => ({ data: r.data ?? null, source: r.source }));
}

/* ---------- interventions (P10 lifecycle, append-only events) ---------- */

export type InterventionStage = 'identified' | 'planned' | 'in_progress' | 'reassessed' | 'outcome';

export const INTERVENTION_STAGES: { id: InterventionStage; label: string; plain: string }[] = [
  { id: 'identified', label: 'Identified', plain: 'A need showed up in the evidence' },
  { id: 'planned', label: 'Planned', plain: 'Support agreed — owner and dates set' },
  { id: 'in_progress', label: 'In progress', plain: 'Support is happening now' },
  { id: 'reassessed', label: 'Reassessed', plain: 'Evidence re-checked after support' },
  { id: 'outcome', label: 'Outcome', plain: 'Result recorded' },
];

export interface InterventionEvent {
  id: string;
  at: string;
  by: string;
  /** Append-only: one plain sentence per event; nothing is edited or deleted. */
  text: string;
  evidenceRef?: string;
}

export interface Intervention {
  id: string;
  studentId: string;
  studentName: string;
  objective: string;
  activity: string;
  durationWeeks: number;
  owner: string;
  stage: InterventionStage;
  startedAt: string;
  targetEnd: string;
  events: InterventionEvent[];
}

let fxInterventions: Intervention[] = [
  {
    id: 'iv_1', studentId: 'stu_1', studentName: 'Aarav Sharma',
    objective: 'Read word problems confidently and pick the right operation',
    activity: 'Fraction & word-problem clinic — 3 short sessions a week, pair practice',
    durationWeeks: 4, owner: 'Priya Iyer', stage: 'in_progress',
    startedAt: dayF(-22, 12), targetEnd: dayF(6, 12),
    events: [
      { id: 'ive_1', at: dayF(-24, 12), by: 'Priya Iyer', text: 'Identified from the fractions unit test — word problems 2/8, homework going missing.', evidenceRef: 'Unit test · Fractions' },
      { id: 'ive_2', at: dayF(-22, 15), by: 'Priya Iyer', text: 'Plan agreed with the family — 4 weeks, progress reviewed weekly.', evidenceRef: 'PTM notes' },
      { id: 'ive_3', at: dayF(-12, 12), by: 'Priya Iyer', text: 'Re-test after 2 weeks: 14/20, up from 8/20. Word problems remain the gap.', evidenceRef: 'Unit test · re-test' },
    ],
  },
  {
    id: 'iv_2', studentId: 'stu_7', studentName: 'Anil Kumar',
    objective: 'Fix sign errors when moving terms in simple equations',
    activity: 'One 15-minute re-teach a week + 5 marked practice sums',
    durationWeeks: 3, owner: 'Priya Iyer', stage: 'planned',
    startedAt: dayF(-2, 12), targetEnd: dayF(19, 12),
    events: [
      { id: 'ive_4', at: dayF(-4, 12), by: 'Priya Iyer', text: 'Identified from the equations class test — sign slips on 6 of 20 marks.', evidenceRef: 'Class test · Simple equations' },
      { id: 'ive_5', at: dayF(-2, 12), by: 'Priya Iyer', text: 'Planned: re-teach + practice sets, recheck with a 10-mark quiz.', evidenceRef: 'Quiz plan' },
    ],
  },
  {
    id: 'iv_3', studentId: 'stu_3', studentName: 'Rohan Gupta',
    objective: 'Get homework back on track before the unit test',
    activity: 'Homework buddy pairing + a Tuesday check-in during break',
    durationWeeks: 2, owner: 'Priya Iyer', stage: 'identified',
    startedAt: dayF(-1, 12), targetEnd: dayF(13, 12),
    events: [
      { id: 'ive_6', at: dayF(-1, 12), by: 'Priya Iyer', text: 'Identified — homework has been late three times this month; the family confirmed a catch-up plan on the call.', evidenceRef: 'Messages · Thread' },
    ],
  },
];

/** GET /interventions?student= (§4, frozen). */
export async function getInterventions(studentId?: string): Promise<{ data: Intervention[]; source: TeacherSource }> {
  return flowRead('interventions', `/interventions${studentId ? `?student=${encodeURIComponent(studentId)}` : ''}`, async () => {
    await waitF(340);
    const rows = studentId ? fxInterventions.filter(iv => iv.studentId === studentId) : fxInterventions;
    return { data: rows, source: 'fixture' as TeacherSource };
  }).then(r => ({ data: r.data ?? [], source: r.source }));
}

/** POST /interventions (§4, frozen) — new plans enter at "planned". */
export async function createIntervention(body: { studentId: string; studentName: string; objective: string; activity: string; durationWeeks: number; owner: string }): Promise<{ data: Intervention; source: TeacherSource }> {
  return flowWrite('interventions', '/interventions', { method: 'POST', body: JSON.stringify(body) }, async () => {
    await waitF(380);
    if (!body.studentId) throw new Error('Pick a student for this support plan.');
    if (!body.objective.trim()) throw new Error('Write the goal in one line — what should get better?');
    if (!body.activity.trim()) throw new Error('Describe the support activity — what will actually happen?');
    const iv: Intervention = {
      id: uidF('iv'), studentId: body.studentId, studentName: body.studentName,
      objective: body.objective.trim(), activity: body.activity.trim(),
      durationWeeks: body.durationWeeks, owner: body.owner,
      stage: 'planned', startedAt: isoF(new Date()),
      targetEnd: dayF(body.durationWeeks * 7, 12),
      events: [{ id: uidF('ive'), at: isoF(new Date()), by: body.owner, text: `Planned: ${body.activity.trim()} — first recheck in ${body.durationWeeks} weeks.`, evidenceRef: 'Teacher plan' }],
    };
    fxInterventions = [iv, ...fxInterventions];
    return { data: iv, source: 'fixture' as TeacherSource };
  }).then(r => ({ data: r.data, source: r.source }));
}

/** POST /interventions/:id/reassess (§4, frozen) + stage moves — append-only. */
export async function moveIntervention(id: string, to: InterventionStage, note: string, evidenceRef?: string): Promise<{ data: Intervention | null; source: TeacherSource }> {
  return flowWrite('interventions', `/interventions/${encodeURIComponent(id)}/reassess`, { method: 'POST', body: JSON.stringify({ to, note }) }, async () => {
    await waitF(300);
    const iv = fxInterventions.find(x => x.id === id);
    if (!iv) throw new Error('That plan is no longer on the board.');
    if (!note.trim()) throw new Error('Add one line about what happened — the log only grows, so write it once.');
    iv.stage = to;
    iv.events = [...iv.events, { id: uidF('ive'), at: isoF(new Date()), by: teacherContext.name, text: note.trim(), evidenceRef }];
    return { data: iv, source: 'fixture' as TeacherSource };
  }).then(r => ({ data: r.data ?? null, source: r.source }));
}
