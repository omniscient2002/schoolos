/* ============================================================
   coordApi.ts — typed wrappers for the coord.view plugin doors
   (migration 037, CS-1 lane; shapes read from
   server/src/plugins/coord.view/index.js — CU-1 builds to the
   frozen contract, graceful on every error via friendlyErrors).

   Doors:
   - GET  /coord/home                 command center (today)
   - GET  /coord/curriculum-monitor   class×subject pace
   - GET  /coord/teacher-workload     AGGREGATES ONLY (no scores/ranks by design)
   - POST /coord/substitution/decide  coordinator-owned kernel decide
   - POST /coord/duty/allocate        fairness-aware least-loaded allocation
   - GET  /coord/escalations          routed family requests + concerns
   - POST /coord/copilot-lite         deterministic v0 (never invents, 200/month)
   ============================================================ */

/* FEX-3/6: ride the ONE transport (services/liveApi.ts) — memory-only bearer, same-origin, the same 401
   session-reset and CSRF echo. */
import { apiRequest } from './liveApi';

const call = apiRequest;

/* ---------------- home ---------------- */

/** staffing_today[] entry — status: present | on_leave | absent (server truth) */
export interface CoordStaffingRow { teacher: string; status: 'present' | 'on_leave' | 'absent'; periods_affected: number }
/** substitution_gaps[] — class_grade is null until the grid grows a class column (grid_note) */
export interface CoordSubGap { class_grade: string | null; period: number | null; subject: string; uncovered: boolean }
export interface CoordPendingApproval { action_id: string; code: string; kind: string; title: string; age_hours: number }
export interface CoordCurriculumDelay { class_grade: string | null; subject: string; covered_pct: number; expected_pct: number; weeks_behind: number }
export interface CoordOpenIssue { concern_id: string; category: string; urgency: string | null; status: string; student: string | null; routed_at: string | null }

export interface CoordHome {
  date: string;
  staffing_today: CoordStaffingRow[];
  substitution_gaps: CoordSubGap[];
  grid_note: string;
  pending_approvals: CoordPendingApproval[];
  curriculum_delays: CoordCurriculumDelay[];
  open_issues: CoordOpenIssue[];
}

export const getCoordHome = () => call<CoordHome>('/coord/home');

/* ---------------- curriculum monitor ---------------- */

export interface CoordPace { days_elapsed: number; days_total: number; term_weeks: number; expected_pct: number }
export interface CoordCurriculumRow {
  class_grade: string | null; subject: string; topics: number;
  covered_pct: number; expected_pct: number; weeks_behind: number; revision_needed: boolean;
}
export interface CoordCurriculumMonitor {
  available: boolean;
  pace?: CoordPace;
  monitor: CoordCurriculumRow[];
  note?: string;
}

export const getCurriculumMonitor = () => call<CoordCurriculumMonitor>('/coord/curriculum-monitor');

/* ---------------- teacher workload (fairness: aggregates only) ---------------- */

export interface CoordWorkloadRow {
  teacher_id: string; name: string;
  periods_week: number | null; substitutions_month: number | null;
  invigilation: number | null; duties: number | null; grading_est: number | null;
  /** fairness flag: extra load ≥ threshold this month — NEVER a score or rank */
  overload: boolean;
}
export interface CoordTeacherWorkload {
  threshold: { extra_load_per_month: number; basis: string };
  workload: CoordWorkloadRow[];
  note: string;
}

export const getTeacherWorkload = () => call<CoordTeacherWorkload>('/coord/teacher-workload');

/* ---------------- substitution decide ---------------- */

export type CoordDecision = 'approved' | 'rejected';

export interface CoordDecideResult { ok: boolean; action_id: string; code: string; decision: CoordDecision; status: string; event: string | null }

export const decideSubstitution = (actionId: string, decision: CoordDecision, note?: string) =>
  call<CoordDecideResult>('/coord/substitution/decide', {
    method: 'POST',
    body: JSON.stringify({ action_id: actionId, decision, ...(note ? { note } : {}) }),
  });

/* ---------------- duty allocate (fairness-aware least-loaded pick) ---------------- */

export type CoordDutyKind = 'duty' | 'invigilation' | 'event' | 'exam';

export interface CoordDutyAllocatePayload {
  kind: CoordDutyKind;
  date: string;                     // YYYY-MM-DD
  candidates: string[];             // active teacher UUIDs
  period?: string;
  note?: string;
}
export interface CoordDutyAllocateResult {
  ok: boolean; assignment_id: string;
  assigned_to: { teacher_id: string; name: string };
  assigned_load_before: number; kind: string; date: string; period: string | null;
}

export const allocateDuty = (payload: CoordDutyAllocatePayload) =>
  call<CoordDutyAllocateResult>('/coord/duty/allocate', { method: 'POST', body: JSON.stringify(payload) });

/* ---------------- escalations ---------------- */

export interface CoordTimelineEvent { to: string; note: string | null; at: string }
export interface CoordEscalation {
  source: 'family_request' | 'teacher_concern';
  id: string;
  kind: string;
  category: string;
  title?: string;                   // family requests carry a title
  status: string;
  urgency?: string | null;
  /** student identity only where the coordinator is the routed authority */
  student: string | null;
  created_at: string;
  sla_at?: string | null;
  routed_at?: string | null;
  timeline: CoordTimelineEvent[];
}
export interface CoordEscalations { escalations: CoordEscalation[]; note: string }

export const getEscalations = () => call<CoordEscalations>('/coord/escalations');

/* ---------------- copilot-lite (deterministic v0) ---------------- */

export interface CoordCopilotSource { kind: string; ref: string; note: string; scope: string }
export interface CoordCopilotAnswer {
  intent: 'intervention' | 'curriculum' | 'substitution' | 'summary' | 'unknown';
  answer: string;
  data: Record<string, unknown> | null;
  sources: CoordCopilotSource[];
  budget: { used: number; cap: number; class: string };
}

export const copilotLite = (question: string) =>
  call<CoordCopilotAnswer>('/coord/copilot-lite', { method: 'POST', body: JSON.stringify({ question }) });

/* ---------------- generic kernel decide (ApprovalCenter fallback) ----------------
   routes.js contract: POST /actions/:id/decide { decision: 'approved' | 'dismissed', note? }
   Used for coordinator-owned actions that are NOT substitution proposals;
   substitution actions go through decideSubstitution (coord.decision.v1 door). */

export interface GenericDecideResult { ok: boolean; decision: string; execution: unknown }

export const decideGenericAction = (actionId: string, decision: 'approved' | 'dismissed', note?: string) =>
  call<GenericDecideResult>(`/actions/${actionId}/decide`, {
    method: 'POST',
    body: JSON.stringify({ decision, ...(note ? { note } : {}) }),
  });
