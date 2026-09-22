/* ============================================================
   teacherApi.ts — TU-1 contract layer (LIVE DOORS ONLY).

   The Teacher Command Center is built against the FROZEN §4
   contracts (docs/TEACHEROS-PLAN.md):

     GET /teacher/home            → NOW/NEXT/NEEDS-ATTENTION aggregate
     GET /teacher/brief?when=eod  → end-of-day brief
     GET /teacher/brief?when=week → weekly brief

   A door either answers live or it throws. A door that is absent
   (404 / "not found" / "Cannot GET|POST") — or a build with
   `LIVE_API` off — throws a clear "not connected yet" Error; the
   screens' real loading/empty/error paths then render. This module
   NEVER fabricates sample data.

   Once a door answers 200 it is latched live for the rest of the
   session: later calls refetch live and propagate the real error.
   ============================================================ */
import { LIVE_API, apiRequest } from './liveApi';

/* ============================================================
   Contract types — mirror of plan §4, frozen. The server lanes
   must satisfy these shapes; do not widen them from the UI.
   ============================================================ */

/** Source stamp — every card declares where its data came from. */
export type TeacherSource = 'live';

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

/* FEX-3/6: teacher screens ride the ONE transport (`liveApi.apiRequest`) — memory-only bearer, same 401
   session-reset, same CSRF echo. The hand-rolled copies this replaces read the JWT from localStorage. */
const call = apiRequest;

/** Transport-level result — `ok` is always true once the door answers. */
export interface DoorResult<T> { ok: boolean; data: T | null }

const doorState: Record<'home' | 'brief', boolean> = { home: false, brief: false };
/** Test/inspection hook — forces the next read to re-probe the door. */
export function _resetTeacherDoors() { doorState.home = false; doorState.brief = false; }
/** True when the server door has answered 200 this session. */
export const teacherDoorLive = { get home() { return doorState.home; }, get brief() { return doorState.brief; } };

/** A door that is absent (404 / route missing) is not connected. */
function notLive(err: unknown): boolean {
  const msg = String(err);
  return /\b404\b/.test(msg) || /not found/i.test(msg) || /Cannot (GET|POST)/.test(msg);
}

/** The honest answer when a door has not been built yet — never a fixture. */
function doorNotConnected(): Error {
  return new Error('This teacher door is not connected yet.');
}

/* ============================================================
   Public reads — the only two the UI consumes.
   ============================================================ */

export async function getTeacherHome(): Promise<DoorResult<TeacherHomeAggregate>> {
  if (!LIVE_API) throw doorNotConnected();
  if (doorState.home) {
    /* session already validated the door — refetch live, throw real errors */
    return { ok: true, data: await call<TeacherHomeAggregate>('/teacher/home') };
  }
  try {
    const data = await call<TeacherHomeAggregate>('/teacher/home');
    doorState.home = true;
    return { ok: true, data };
  } catch (err) {
    if (notLive(err)) throw doorNotConnected();  // door not built yet → honest error
    throw err;                                   // door live and failing → real error
  }
}

export async function getTeacherBrief(when: 'eod' | 'week'): Promise<DoorResult<TeacherBrief>> {
  if (!LIVE_API) throw doorNotConnected();
  if (doorState.brief) {
    return { ok: true, data: await call<TeacherBrief>(`/teacher/brief?when=${when}`) };
  }
  try {
    const data = await call<TeacherBrief>(`/teacher/brief?when=${when}`);
    doorState.brief = true;
    return { ok: true, data };
  } catch (err) {
    if (notLive(err)) throw doorNotConnected();
    throw err;
  }
}

/** Stamp a result with where it came from. A live door is the only source. */
export function sourceOf(_r: { ok: boolean }): TeacherSource { return 'live'; }

/* ============================================================
   TU-2 (ui-flows) SECTION — teacher flow doors. Same law as
   above (200 → live for the session · absent → honest error ·
   other errors → throw to the screen). Partitioned for lane
   coordination: TU-1 owns the home/brief block above, TU-2 owns
   everything below this line. Do not reorder across the seam.
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
   The slot board may not echo the booking id (TS-2 gap) — `bookingId` is
   optional and the notes editor degrades plainly when a booked slot arrives
   without one. */
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

/* ---------- TU-2 door state — same law as the TU-1 block ---------- */

const flowDoorState: Record<string, boolean> = {};
/** Test/inspection hook — forces the flow doors back to a cold probe. */
export function _resetTeacherFlowDoors() { for (const k of Object.keys(flowDoorState)) flowDoorState[k] = false; }

/** Sync view for the UI: has THIS door proven live this session? */
export function isFlowDoorLive(door: string): boolean { return !!flowDoorState[door]; }

/** TU-2 transport (write support): the same ONE transport as `call` above. */
const flowCall = apiRequest;

/** Read a flow door: live once proven, honest error while the door is absent,
 *  real error the moment the door exists and fails. Returns where it came from. */
export async function flowRead<T>(door: string, path: string): Promise<{ data: T; source: TeacherSource }> {
  if (!LIVE_API) throw doorNotConnected();
  if (flowDoorState[door]) return { data: await flowCall<T>(path), source: 'live' };
  try {
    const data = await flowCall<T>(path);
    flowDoorState[door] = true;
    return { data, source: 'live' };
  } catch (err) {
    if (notLive(err)) throw doorNotConnected();  // door not built yet
    throw err;                                   // door live and failing
  }
}

/** Write a flow door: same law — an absent door surfaces the honest error. */
export async function flowWrite<T>(door: string, path: string, init: RequestInit): Promise<{ data: T; source: TeacherSource }> {
  if (!LIVE_API) throw doorNotConnected();
  if (flowDoorState[door]) return { data: await flowCall<T>(path, init), source: 'live' };
  try {
    const data = await flowCall<T>(path, init);
    flowDoorState[door] = true;
    return { data, source: 'live' };
  } catch (err) {
    if (notLive(err)) throw doorNotConnected();
    throw err;
  }
}

/* ============================================================
   TU-2 flow doors — live reads/writes.
   ============================================================ */

/** GET /plugins/teacher.classroom/homework?mine=1[&class=] (§4, frozen) */
export async function listHomework(params: { class?: string } = {}): Promise<{ homework: TeacherHomework[] }> {
  const q = params.class ? `&class=${encodeURIComponent(params.class)}` : '';
  const r = await flowRead<{ homework: TeacherHomework[] }>('hw', `/plugins/teacher.classroom/homework?mine=1${q}`);
  return r.data;
}

/** POST /plugins/teacher.classroom/homework (§4, frozen) */
export async function createHomework(body: NewHomework): Promise<{ ok: boolean; homework: TeacherHomework }> {
  const r = await flowWrite<{ ok: boolean; homework: TeacherHomework }>('hw', '/plugins/teacher.classroom/homework', { method: 'POST', body: JSON.stringify(body) });
  return r.data;
}

/** GET /plugins/teacher.classroom/submissions?homework=&state= (§4, frozen) */
export async function listSubmissions(params: { homework?: string; state?: string } = {}): Promise<{ submissions: TeacherSubmission[] }> {
  const q = `${params.homework ? `homework=${encodeURIComponent(params.homework)}&` : ''}${params.state ? `state=${encodeURIComponent(params.state)}` : ''}`;
  const r = await flowRead<{ submissions: TeacherSubmission[] }>('submissions', `/plugins/teacher.classroom/submissions?${q}`);
  return r.data;
}

/** POST /plugins/teacher.classroom/submissions/:id/review {status, grade?, feedback?} (§4, frozen) */
export async function reviewSubmission(id: string, body: { status: string; grade?: number; feedback?: string }): Promise<{ ok: boolean; submission: TeacherSubmission }> {
  const r = await flowWrite<{ ok: boolean; submission: TeacherSubmission }>('submissions', `/plugins/teacher.classroom/submissions/${encodeURIComponent(id)}/review`, { method: 'POST', body: JSON.stringify(body) });
  return r.data;
}

/** POST /teacher/leave (self) (§4, frozen) */
export async function createLeave(body: { kind: LeaveKind; from_date: string; to_date: string; reason: string }): Promise<{ ok: boolean; request: TeacherLeaveRequest }> {
  const r = await flowWrite<{ ok: boolean; request: TeacherLeaveRequest }>('leave', '/teacher/leave', { method: 'POST', body: JSON.stringify(body) });
  return r.data;
}

/** GET /teacher/leave/mine (§4, frozen) */
export async function listMyLeave(): Promise<{ requests: TeacherLeaveRequest[]; balances: LeaveBalance[] }> {
  const r = await flowRead<{ requests: TeacherLeaveRequest[]; balances: LeaveBalance[] }>('leave', '/teacher/leave/mine');
  return r.data;
}

/** GET /duty/roster?window= (§4, frozen) */
export async function listDutyRoster(window: 'today' | 'week' | 'month' = 'week'): Promise<{ duties: DutyAssignment[] }> {
  const r = await flowRead<{ duties: DutyAssignment[] }>(`duty_${window}`, `/duty/roster?window=${encodeURIComponent(window)}`);
  return r.data;
}

/** GET /workload/mine (§4, frozen) */
export async function myWorkload(): Promise<{ workload: MyWorkload }> {
  const r = await flowRead<{ workload: MyWorkload }>('workload', '/workload/mine');
  return r.data;
}

/** GET /comms/announcements?mine=1 — PROPOSED door (comms rail, P9); freeze with TS-1 */
export async function listAnnouncements(): Promise<{ announcements: TeacherAnnouncement[] }> {
  const r = await flowRead<{ announcements: TeacherAnnouncement[] }>('announce', '/comms/announcements?mine=1');
  return r.data;
}

/** POST /comms/announcements — PROPOSED door (comms rail, P9); freeze with TS-1 */
export async function sendAnnouncement(body: { audiences: string[]; title: string; body: string; template_id?: string; scheduled_at?: string }): Promise<{ ok: boolean; announcement: TeacherAnnouncement }> {
  const r = await flowWrite<{ ok: boolean; announcement: TeacherAnnouncement }>('announce', '/comms/announcements', { method: 'POST', body: JSON.stringify(body) });
  return r.data;
}

/** GET /comms/threads?mine=1 — PROPOSED door (in-school messaging, P9); freeze with TS-1 */
export async function listThreads(): Promise<{ threads: MsgThread[] }> {
  const r = await flowRead<{ threads: MsgThread[] }>('threads', '/comms/threads?mine=1');
  return r.data;
}

/** POST /comms/threads/:id/messages — PROPOSED door (in-school messaging, P9); freeze with TS-1 */
export async function sendThreadMessage(threadId: string, text: string, templateId?: string): Promise<{ ok: boolean; message: MsgMessage }> {
  const r = await flowWrite<{ ok: boolean; message: MsgMessage }>('threads', `/comms/threads/${encodeURIComponent(threadId)}/messages`, { method: 'POST', body: JSON.stringify({ text, template_id: templateId }) });
  return r.data;
}

/** GET /ptm/slots — the board (§4). `mine` filters to the signed-in teacher
 *  by name when the caller has it (the board is school-wide for staff). */
export async function listPtmSlots(mine?: string): Promise<{ slots: PtmSlot[] }> {
  const r = await flowRead<{ slots: PtmSlot[] }>('ptm_slots', '/ptm/slots');
  return { slots: (r.data.slots ?? []).filter(s => !mine || s.teacherName === mine) };
}

/** POST /ptm/slots {date, startTime, endTime} — ONE slot per call (server law:
 *  HH:MM, end after start, one slot per start time). Publishing a block of
 *  slots = sequential calls from the screen, like bulk review. */
export async function createPtmSlot(body: { date: string; startTime: string; endTime: string }): Promise<{ ok: boolean; slotId?: string; status?: string }> {
  const r = await flowWrite<{ ok: boolean; slotId?: string; status?: string }>('ptm_slots', '/ptm/slots', { method: 'POST', body: JSON.stringify(body) });
  return r.data;
}

function meetingFromSlot(s: PtmSlot): PtmMeeting {
  return {
    bookingId: s.bookingId ?? null,
    slotId: s.slotId,
    date: s.date,
    startTime: s.startTime,
    studentName: s.bookedStudentName ?? '—',
    guardianName: null,
    status: 'booked',
    notes: [],
  };
}

/** The teacher's booked meetings — booked slots on my board. */
export async function listPtmMeetings(mine?: string): Promise<{ meetings: PtmMeeting[] }> {
  const { slots } = await listPtmSlots(mine);
  return { meetings: slots.filter(s => s.booked).map(meetingFromSlot) };
}

/** GET /ptm/:id/notes (:id = booking id) — private, teacher-only. */
export async function listPtmNotes(bookingId: string): Promise<{ bookingId: string; notes: PtmNote[] }> {
  const r = await flowRead<{ bookingId: string; notes: PtmNote[] }>(`ptm_notes_${bookingId}`, `/ptm/${encodeURIComponent(bookingId)}/notes`);
  return r.data;
}

/** POST /ptm/:id/notes {note} — PRIVATE: "Only you can see this." */
export async function savePtmNotes(bookingId: string, note: string): Promise<{ ok: boolean; private: boolean }> {
  const r = await flowWrite<{ ok: boolean; private: boolean }>('ptm_meetings', `/ptm/${encodeURIComponent(bookingId)}/notes`, { method: 'POST', body: JSON.stringify({ note }) });
  return r.data;
}

/* ---------- P10 · concerns (teacher.support, TS-2 — exact door shapes) ----
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

/** POST /teacher/concern — one-tap flag. */
export async function fileConcern(body: { studentId?: string | null; category: ConcernCategory; urgency?: ConcernUrgency; detail: string }): Promise<{ ok: boolean; concernId: string; status: string; escalateActionId?: string | null }> {
  const r = await flowWrite<{ ok: boolean; concernId: string; status: string; escalateActionId?: string | null }>('concern', '/teacher/concern', { method: 'POST', body: JSON.stringify(body) });
  return r.data;
}

/** GET /teacher/concerns — a teacher sees the concerns they filed. */
export async function listMyConcerns(): Promise<{ scope: string; concerns: TeacherConcern[] }> {
  const r = await flowRead<{ scope: string; concerns: TeacherConcern[] }>('concern', '/teacher/concerns');
  return r.data;
}

/** GET /teacher/concern/:id/events — the append-only history. */
export async function concernEvents(concernId: string): Promise<{ concernId: string; events: ConcernEvent[] }> {
  const r = await flowRead<{ concernId: string; events: ConcernEvent[] }>(`concern_${concernId}`, `/teacher/concern/${encodeURIComponent(concernId)}/events`);
  return r.data;
}

/** POST /teacher/concern/:id/outcome — the designated owner closes a routed concern (PRD-8). */
export async function recordConcernOutcome(concernId: string, outcome: string, note: string): Promise<{ ok: boolean; concernId: string; status: string; outcome: string }> {
  const r = await flowWrite<{ ok: boolean; concernId: string; status: string; outcome: string }>(
    'concern', `/teacher/concern/${encodeURIComponent(concernId)}/outcome`, { method: 'POST', body: JSON.stringify({ outcome, note }) });
  return r.data;
}

/* ---------- mastery + curriculum (live server shapes) ---------- */

export interface MasteryCell {
  studentId: string; studentName: string; section: string | null; topicId: string; topic: string;
  level: string | null; levelLabel: string | null; confidence: string | null; decayed: boolean;
}
export async function getMasteryClassLive(grade: string, subject = 'Mathematics'): Promise<{ grade: string; subject: string; students: number; cells: MasteryCell[]; note: string }> {
  const r = await flowRead<{ grade: string; subject: string; students: number; cells: MasteryCell[]; note: string }>(
    `mastery_class_live_${grade}_${subject}`, `/mastery/class/${encodeURIComponent(grade)}?subject=${encodeURIComponent(subject)}`);
  return r.data;
}
export interface MasteryEvidenceRow { evidenceId: string; kind: string; ref: string | null; value: number; observedAt: string; expiresAt: string | null; expired: boolean }
export interface MasteryMapRow {
  nodeId: string; topic: string; unit: string | null; level: string | null; levelLabel: string | null;
  confidence: string | null; decayed: boolean; freshEvidenceCount: number; expiredEvidenceCount: number; evidence: MasteryEvidenceRow[];
}
export async function getMasteryStudentLive(id: string, subject = 'Mathematics'): Promise<{ studentId: string; name: string; classGrade: string; section: string | null; subject: string; map: MasteryMapRow[]; note: string }> {
  const r = await flowRead<{ studentId: string; name: string; classGrade: string; section: string | null; subject: string; map: MasteryMapRow[]; note: string }>(
    `mastery_student_live_${id}_${subject}`, `/mastery/student/${encodeURIComponent(id)}?subject=${encodeURIComponent(subject)}`);
  return r.data;
}
export interface CurriculumTopicLive { topicId: string; topic: string; orderNo: number; coveredPct: number; covered: boolean; coveredAt: string | null }
export interface CurriculumUnitLive { unitId: string; unit: string; orderNo: number; topics: CurriculumTopicLive[] }
export async function getCurriculumTreeLive(grade: string, subject = 'Mathematics'): Promise<{ subject: string; grade: string; units: CurriculumUnitLive[] }> {
  const r = await flowRead<{ subject: string; grade: string; units: CurriculumUnitLive[] }>(
    `curriculum_live_${grade}_${subject}`, `/curriculum/tree?subject=${encodeURIComponent(subject)}&grade=${encodeURIComponent(grade)}`);
  return r.data;
}
export async function saveCoverage(nodeId: string, classGrade: string, pct: number): Promise<{ ok: boolean }> {
  const r = await flowWrite<{ ok: boolean }>('curriculum_live', '/curriculum/progress', { method: 'POST', body: JSON.stringify({ node_id: nodeId, class_grade: classGrade, pct }) });
  return r.data;
}

/* ---------- class analytics (P7/P11 composite; aggregates, never rankings) ---------- */

export interface ClassAnalyticsLive {
  grade: string; subject: string; students: number;
  mastery: { strong: number; developing: number; needs_support: number; unlabelled: number };
  homework: { assigned: number; turned_in: number; completion_pct: number | null };
  attendance: { pct: number | null };
  note: string;
}
export async function getClassAnalyticsLive(grade: string, subject = 'Mathematics'): Promise<ClassAnalyticsLive> {
  const r = await flowRead<ClassAnalyticsLive>(`analytics_${grade}_${subject}`, `/analytics/class/${encodeURIComponent(grade)}?subject=${encodeURIComponent(subject)}`);
  return r.data;
}

/* ---------- teacher roster (the class lists a teacher may act on) ---------- */

export async function listMyStudents(cls?: string): Promise<{ scope: string; classes: string[]; students: RosterStudent[] }> {
  const r = await flowRead<{ scope: string; classes: string[]; students: RosterStudent[] }>('roster', `/plugins/teacher.classroom/roster${cls ? `?class=${encodeURIComponent(cls)}` : ''}`);
  return r.data;
}

/* ---------- safety box (designated authority; never the classroom teacher) ---------- */

export interface SafetyReport {
  reportId: string; anonymous: boolean; classGrade: string; category: string; detail: string;
  severity: string; status: string; assignedTo: string | null; assignedName: string | null; createdAt: string;
}
export async function listSafetyBox(assignedOnly = false): Promise<{ scope: string; reports: SafetyReport[] }> {
  const r = await flowRead<{ scope: string; reports: SafetyReport[] }>('safety_box', `/safety/box${assignedOnly ? '?assigned=1' : ''}`);
  return r.data;
}
export async function assignSafetyReport(id: string, assignedTo: string): Promise<{ ok: boolean }> {
  const r = await flowWrite<{ ok: boolean }>('safety_box', `/safety/box/${encodeURIComponent(id)}/assign`, { method: 'POST', body: JSON.stringify({ assignedTo }) });
  return r.data;
}
export async function listBoxAssignees(): Promise<{ assignees: { id: string; name: string; role: string }[] }> {
  const r = await flowRead<{ assignees: { id: string; name: string; role: string }[] }>('safety_box', '/safety/box/assignees');
  return r.data;
}
export interface SafetySummaryBucket { classGrade: string; category: string; severity: string; count: number }
export async function getSafetySummary(): Promise<{ windowDays: number; buckets: SafetySummaryBucket[]; note: string }> {
  const r = await flowRead<{ windowDays: number; buckets: SafetySummaryBucket[]; note: string }>('safety_box', '/safety/box/summary');
  return r.data;
}
export async function closeSafetyReport(id: string, note?: string): Promise<{ ok: boolean }> {
  const r = await flowWrite<{ ok: boolean }>('safety_box', `/safety/box/${encodeURIComponent(id)}/close`, { method: 'POST', body: JSON.stringify({ note }) });
  return r.data;
}

/* ---------- doubts (deterministic routing; teacher answers, promotes FAQ) ---------- */

export interface SupportDoubt {
  doubtId: string; subject: string; topic: string | null; question: string; status: string;
  routedReason: string | null; answer: string | null; answeredAt: string | null; askedByName: string; createdAt: string;
}
export async function listDoubts(): Promise<{ scope: string; doubts: SupportDoubt[] }> {
  const r = await flowRead<{ scope: string; doubts: SupportDoubt[] }>('doubts', '/teacher/support/doubts');
  return r.data;
}
export async function answerDoubt(id: string, answer: string): Promise<{ ok: boolean }> {
  const r = await flowWrite<{ ok: boolean }>('doubts', `/teacher/support/doubts/${encodeURIComponent(id)}/answer`, { method: 'POST', body: JSON.stringify({ answer }) });
  return r.data;
}
export async function promoteDoubtFaq(id: string): Promise<{ ok: boolean; faqId?: string }> {
  const r = await flowWrite<{ ok: boolean; faqId?: string }>('doubts', `/teacher/support/doubts/${encodeURIComponent(id)}/promote-faq`, { method: 'POST', body: '{}' });
  return r.data;
}

/* ---------- intervention plans (server shape) ---------- */

export interface ServerIntervention {
  planId: string; studentId: string; studentName: string; ownerId: string; ownerName: string;
  objective: string; activity: string; targetEnd: string | null; status: string; outcome: string | null;
  createdAt: string; updatedAt: string;
}
export const INTERVENTION_FLOW: string[] = ['identified', 'planned', 'in_progress', 'reassessed', 'improved', 'continue', 'escalate'];
export async function listInterventions(studentId?: string): Promise<{ scope: string; plans: ServerIntervention[] }> {
  const r = await flowRead<{ scope: string; plans: ServerIntervention[] }>('interventions', `/interventions${studentId ? `?student=${encodeURIComponent(studentId)}` : ''}`);
  return r.data;
}
export async function createPlan(body: { studentId: string; objective: string; activity: string; targetEnd?: string }): Promise<{ ok: boolean; planId: string }> {
  const r = await flowWrite<{ ok: boolean; planId: string }>('interventions', '/interventions', { method: 'POST', body: JSON.stringify(body) });
  return r.data;
}
export async function movePlan(id: string, to: string, note?: string): Promise<{ ok: boolean; status: string }> {
  const r = await flowWrite<{ ok: boolean; status: string }>('interventions', `/interventions/${encodeURIComponent(id)}/transition`, { method: 'POST', body: JSON.stringify({ to, note }) });
  return r.data;
}

/* ---------- lessons lifecycle (PRD-2 / DAT-4) ---------- */

export interface TeacherLesson {
  id: string; class_grade: string; subject: string; lesson_date: string; period: number | null;
  topic: string; objectives: string[]; resources: string[]; reflection: { worked?: string | null; reinforce?: string | null; next?: string | null; at?: string } | null;
  status: string; created_at: string;
}
export async function listLessons(date?: string): Promise<{ date: string | null; lessons: TeacherLesson[] }> {
  const r = await flowRead<{ date: string | null; lessons: TeacherLesson[] }>('lessons', `/plugins/teacher.classroom/lessons${date ? `?date=${encodeURIComponent(date)}` : ''}`);
  return r.data;
}
export async function createLesson(body: { class_grade: string; subject: string; lesson_date?: string; period?: number | null; topic: string; objectives?: string[]; resources?: string[] }): Promise<{ ok: boolean; lessonId: string; lesson: TeacherLesson }> {
  const r = await flowWrite<{ ok: boolean; lessonId: string; lesson: TeacherLesson }>('lessons', '/plugins/teacher.classroom/lessons', { method: 'POST', body: JSON.stringify(body) });
  return r.data;
}
export async function reflectLesson(id: string, body: { worked?: string; reinforce?: string; next?: string }): Promise<{ ok: boolean }> {
  const r = await flowWrite<{ ok: boolean }>('lessons', `/plugins/teacher.classroom/lessons/${encodeURIComponent(id)}/reflect`, { method: 'POST', body: JSON.stringify(body) });
  return r.data;
}

/* ============================================================
   TU-3 (ui-insights) SECTION — mastery maps · progress stories ·
   curriculum coverage · class analytics · interventions.

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

   A3 rule baked into the contract: every mastery label carries
   evidence + confidence + expiry. Evidence older than 28 days
   no longer feeds the label (staleness().expired) — screens
   must show the decay note, never a naked 🔴.
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

/** Where an evidence row deep-links — plain label + teacher flow route
 *  (routes follow components/teacher/TeacherNav.tsx). */
export function evidenceLinkTarget(link: MasteryEvidence['link']): { to: string; label: string } {
  switch (link) {
    case 'homework': return { to: '/teacher/submissions', label: 'Open homework' };
    case 'assessment': return { to: '/teacher/assessments', label: 'Open assessments' };
    case 'observation': return { to: '/teacher/mastery', label: 'Open mastery map' };
    case 'intervention': return { to: '/teacher/interventions', label: 'Open support plans' };
  }
}

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

/* ---------- roster (identity only — the server owns the real roster) ---------- */

export interface RosterStudent { id: string; name: string; classGrade: string; grade?: string; section?: string | null; admission_no?: string | null }

/** No client-side roster exists: a synchronous picker cannot fabricate students.
 *  Screens that need the roster read the live door instead. */
export function rosterFor(_classGrade: string): RosterStudent[] {
  return [];
}

/* ---------- teaching copilot (P4 · deterministic v0, budgeted) ---------- */

export interface CopilotAskResult {
  answer: string;
  sources: { kind: string }[];
  suggested_action: { label: string; to: string } | null;
  budget: { used: number; cap: number };
}
/** POST /copilot/ask {question} — deterministic keyword-routed answer with sources. */
export async function askTeacherCopilot(question: string): Promise<CopilotAskResult> {
  const r = await flowWrite<CopilotAskResult>('copilot_ask', '/copilot/ask', { method: 'POST', body: JSON.stringify({ question }) });
  return r.data;
}

export interface CopilotDraftResult {
  kind: string; title: string; draft: string; label: string; budget: { used: number; cap: number };
}
/** POST /copilot/draft {kind, params} — a labelled ai_draft template the teacher edits. */
export async function draftTeacherCopilot(kind: string, params: Record<string, unknown>): Promise<CopilotDraftResult> {
  const r = await flowWrite<CopilotDraftResult>('copilot_draft', '/copilot/draft', { method: 'POST', body: JSON.stringify({ kind, params }) });
  return r.data;
}

/** GET /mastery/student/:id?subject= (§4, frozen) — evidence-linked, decayed. */
export async function getMasteryStudent(studentId: string, subject = 'Maths'): Promise<{ data: MasteryStudent | null; source: TeacherSource }> {
  const r = await flowRead<MasteryStudent>('mastery_student', `/mastery/student/${encodeURIComponent(studentId)}?subject=${encodeURIComponent(subject)}`);
  return { data: r.data ?? null, source: r.source };
}

/** GET /mastery/class/:grade?subject= (§4, frozen) — one row per child, no ranking. */
export async function getMasteryClass(classGrade: string, subject = 'Maths'): Promise<{ data: MasteryStudent[]; source: TeacherSource }> {
  const r = await flowRead<MasteryStudent[]>('mastery_class', `/mastery/class/${encodeURIComponent(classGrade)}?subject=${encodeURIComponent(subject)}`);
  return { data: r.data ?? [], source: r.source };
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
  const r = await flowRead<{ studentName: string; steps: StoryStep[] }>('story', `/progress/story/${encodeURIComponent(studentId)}`);
  return { data: r.data ?? null, source: r.source };
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

/** GET /curriculum/tree?subject=&grade= (§4, frozen) — progress rides the tree read. */
export async function getCurriculumTree(classGrade: string, subject = 'Maths'): Promise<{ data: CurriculumClass | null; source: TeacherSource }> {
  const r = await flowRead<CurriculumClass>(`curriculum_${classGrade}`, `/curriculum/tree?subject=${encodeURIComponent(subject)}&grade=${encodeURIComponent(classGrade.split('-')[0] ?? '8')}`);
  return { data: r.data ?? null, source: r.source };
}

/** POST /curriculum/progress {node_id, class_grade, pct, evidence?} (§4, frozen). */
export async function saveCurriculumProgress(nodeId: string, classGrade: string, pct: number): Promise<{ data: CurriculumClass | null; source: TeacherSource }> {
  const r = await flowWrite<CurriculumClass>('curriculum', '/curriculum/progress', { method: 'POST', body: JSON.stringify({ node_id: nodeId, class_grade: classGrade, pct }) });
  return { data: r.data ?? null, source: r.source };
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

/** GET /analytics/class/:grade — PROPOSED composite door (mastery.class +
 *  homework completion + assessment patterns + readiness); freeze with TS-3. */
export async function getClassAnalytics(classGrade: string): Promise<{ data: ClassAnalyticsData | null; source: TeacherSource }> {
  const r = await flowRead<ClassAnalyticsData>(`analytics_${classGrade}`, `/analytics/class/${encodeURIComponent(classGrade)}`);
  return { data: r.data ?? null, source: r.source };
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

/** GET /interventions?student= (§4, frozen). */
export async function getInterventions(studentId?: string): Promise<{ data: Intervention[]; source: TeacherSource }> {
  const r = await flowRead<Intervention[]>('interventions', `/interventions${studentId ? `?student=${encodeURIComponent(studentId)}` : ''}`);
  return { data: r.data ?? [], source: r.source };
}

/** POST /interventions (§4, frozen) — new plans enter at "planned". */
export async function createIntervention(body: { studentId: string; studentName: string; objective: string; activity: string; durationWeeks: number; owner: string }): Promise<{ data: Intervention; source: TeacherSource }> {
  const r = await flowWrite<Intervention>('interventions', '/interventions', { method: 'POST', body: JSON.stringify(body) });
  return { data: r.data, source: r.source };
}

/** POST /interventions/:id/reassess (§4, frozen) + stage moves — append-only. */
export async function moveIntervention(id: string, to: InterventionStage, note: string, _evidenceRef?: string): Promise<{ data: Intervention | null; source: TeacherSource }> {
  const r = await flowWrite<Intervention>('interventions', `/interventions/${encodeURIComponent(id)}/reassess`, { method: 'POST', body: JSON.stringify({ to, note }) });
  return { data: r.data ?? null, source: r.source };
}
