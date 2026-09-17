/* ============================================================
   SchoolOS domain types — the contract UI is built against.
   When the backend lands, these become the API DTOs.
   ============================================================ */

export type CampusId = 'north' | 'city' | 'east';

export interface Campus { id: CampusId; name: string; shortName: string; students: number; capacity: number; hue: string; }

/* RBAC-2: `counselor` is the 13th role, matching server/src/auth.js ROLES. The client already authorised
   it in WellbeingQueue's STAFF_ROLES while the server could not issue it — the role existed only as a
   string in a screen's access list. */
export type RoleId = 'principal' | 'teacher' | 'coordinator' | 'counselor' | 'finance' | 'admissions' | 'transport' | 'parent' | 'student' | 'owner' | 'itadmin' | 'facilities' | 'technician';

export interface DemoAccount { id: RoleId; name: string; title: string; campus: CampusId | 'all'; email: string; }

export interface Person {
  id: string;
  name: string;
  type: 'student' | 'teacher' | 'guardian' | 'staff';
  campus: CampusId;
  email: string;
  phone: string;
  avatarHueSeed?: string;
  /* student */
  grade?: number;
  section?: string;
  rollNo?: string;
  guardianIds?: string[];
  busRoute?: string;
  status?: 'active' | 'inactive';
  admissionNo?: string;
  dob?: string;
  /* staff */
  subjects?: string[];
  classes?: string[];
  role?: string;
  designation?: string;
  joinedOn?: string;
}

export interface GuardianLink { guardianId: string; studentId: string; relation: string; primary: boolean; pickupAuthorized: boolean; verified: boolean; }

/* ---------- Fees ---------- */
export type FeeStatus = 'paid' | 'due' | 'overdue' | 'failed' | 'waived';
export interface FeeObligation {
  id: string; studentId: string; term: string; category: string;
  amount: number; dueDate: Date; status: FeeStatus; paidAmount: number;
  paidOn?: Date; method?: string; failureReason?: string; concession?: number;
}
export interface Payment { id: string; studentId: string; obligationId?: string; amount: number; on: Date; method: string; status: 'success' | 'failed' | 'pending'; reference: string; }

/* ---------- Attendance ---------- */
export interface AttendanceRecord {
  id: string; studentId: string; sectionId: string; date: Date;
  status: 'present' | 'absent' | 'late' | 'excused'; markedBy: string; note?: string; offline?: boolean;
}

/* ---------- Sections / Timetable ---------- */
export interface Section { id: string; grade: number; name: string; campus: CampusId; classTeacherId: string; room: string; studentCount: number; }
export interface TimeSlot { id: string; day: number; period: number; start: string; end: string; subject: string; teacherId: string; sectionId: string; room: string; }

/* ---------- Admissions ---------- */
export type LeadStage = 'inquiry' | 'contacted' | 'visit' | 'interview' | 'offer' | 'accepted' | 'enrolled' | 'rejected' | 'withdrawn';
export interface Lead {
  id: string; name: string; grade: number; campus: CampusId; stage: LeadStage;
  source: string; guardian: string; phone: string; createdOn: Date; lastTouch: Date;
  value: number; owner: string; note?: string;
}

/* ---------- Transport ---------- */
export interface BusRoute { id: string; name: string; campus: CampusId; driver: string; vehicle: string; capacity: number; students: number; stops: { name: string; time: string; students: number }[]; status: 'on-time' | 'delayed' | 'maintenance'; delayMins?: number; }
export interface TransportIncident { id: string; routeId: string; type: string; severity: 'low' | 'medium' | 'high'; on: Date; status: string; summary: string; }

/* ---------- Loop objects ---------- */
export type ActionKind = 'approval' | 'incident' | 'case' | 'exception' | 'recommendation' | 'reminder';
export type ActionPriority = 'critical' | 'high' | 'normal' | 'low';
export type ActionStatus = 'open' | 'approved' | 'dismissed' | 'resolved' | 'completed' | 'expired';

export interface ActionItem {
  id: string;
  kind: ActionKind;
  title: string;
  detail: string;
  whyItMatters: string;
  priority: ActionPriority;
  deadline?: Date;
  owner: string;
  ownerRole: RoleId;
  evidence?: Evidence[];
  suggestedActions?: SuggestedAction[];
  status: ActionStatus;
  createdAt: Date;
  sourceEvent?: string;
  aiInvolved?: boolean;
  policyRef?: string;
  slaHours?: number;
}

export interface Evidence { label: string; kind: 'record' | 'chart' | 'event' | 'document' | 'message'; ref?: string; detail?: string; data?: number[]; delta?: string; }

export interface SuggestedAction {
  id: string; label: string; type: 'message' | 'workflow' | 'task' | 'investigate' | 'none';
  detail?: string;
  /* message payload */
  audience?: string; audienceCount?: number; channel?: 'WhatsApp' | 'SMS' | 'Email' | 'Push'; draft?: string; language?: string;
  /* workflow payload */
  workflow?: string;
  posture?: 'AUTO' | 'APPROVAL' | 'HUMAN-ONLY';
}

/* ---------- AI ---------- */
export interface AiEvidenceStep { label: string; detail: string; source: string; refType?: string; }
export interface AiResponse {
  id: string;
  answer: string;
  /** structured sections: text paragraphs, evidence chains, actions, drafts */
  blocks: AiBlock[];
  trace: AiTrace;
  suggestedActions?: SuggestedAction[];
}
export type AiBlock =
  | { type: 'text'; text: string }
  | { type: 'chain'; title: string; steps: AiEvidenceStep[] }
  | { type: 'draft'; title: string; audience: string; channel: SuggestedAction['channel']; body: string; language?: string }
  | { type: 'list'; title: string; items: { label: string; detail?: string; ref?: string }[] }
  | { type: 'note'; text: string };

export interface AiTrace {
  trigger: string;
  policy: string;
  dataUsed: string[];
  reasoningRole: string;
  action: string;
  approvalStatus: string;
  verification: string;
  /* FEX-10: model/latencyMs/tokens/cost were removed. This product has no model to report these for —
     the figures were fabricated and never measured. A trace explains the deterministic evidence chain. */
}

/* ---------- Automation ---------- */
export interface WorkflowDef {
  id: string; name: string; description: string;
  trigger: { event: string; label: string; condition?: string };
  steps: WorkflowStep[];
  enabled: boolean;
  runsThisMonth: number;
  lastRun?: Date;
  source: 'library' | 'custom' | 'nl';
  posture: 'AUTO' | 'APPROVAL' | 'HUMAN-ONLY';
}
export interface WorkflowStep { id: string; type: 'condition' | 'notify' | 'task' | 'approval' | 'update' | 'wait'; label: string; detail?: string; }
export interface WorkflowRun { id: string; workflowId: string; on: Date; triggerRecord: string; status: 'completed' | 'awaiting-approval' | 'failed' | 'running'; stepsCompleted: number; totalSteps: number; }

/* ---------- Governance ---------- */
export interface PolicyRule {
  id: string; category: string; title: string; statement: string;
  posture: 'AUTO' | 'APPROVAL REQUIRED' | 'HUMAN-ONLY';
  version: string; effectiveFrom: Date; owner: string; status: 'active' | 'draft' | 'archived';
  details?: string[];
}

export interface AuditEntry {
  id: string; on: Date; actor: string; actorRole: RoleId; action: string;
  recordType: string; recordRef: string; reason?: string; policyRef?: string;
  aiInvolved: boolean; risk: 'low' | 'medium' | 'high'; outcome: string;
}

export interface DecisionRecord {
  id: string; title: string; decidedOn: Date; approver: string;
  context: string; alternatives: string[]; evidence: string[];
  policy: string; expectedOutcome: string; actualOutcome?: string; reviewOn?: Date; status: 'open' | 'review-due' | 'validated';
}

/* ---------- Cases & Incidents ---------- */
export type CaseKind = 'complaint' | 'request' | 'incident' | 'facilities' | 'reconciliation' | 'compliance' | 'transport' | 'exception';
export interface SchoolCase {
  id: string; kind: CaseKind; title: string; openedOn: Date; openedBy: string;
  owner: string; priority: ActionPriority; slaHours: number;
  status: 'open' | 'triaged' | 'in-progress' | 'resolved' | 'closed';
  messages: { on: Date; from: string; text: string; internal?: boolean }[];
  linkedRecords?: { label: string; ref: string }[];
  origin: 'parent-whatsapp' | 'phone' | 'walk-in' | 'system' | 'staff';
  campus: CampusId;
}

/* ---------- Notifications ---------- */
export interface Notification { id: string; group: 'needs-you' | 'updates' | 'system' | 'approvals'; title: string; body: string; on: Date; read: boolean; ref?: string; }

/* ---------- Data Health ---------- */
export interface HealthIssue {
  id: string; category: 'guardian' | 'enrollment' | 'fees' | 'attendance' | 'documents' | 'integrations';
  severity: 'high' | 'medium' | 'low'; title: string; count: number; detail: string;
  suggestedFix: string; status: 'open' | 'fixed' | 'ignored';
}

/* ---------- Calendar ---------- */
export interface CalendarEvent {
  id: string; title: string; type: 'exam' | 'ptm' | 'trip' | 'admission' | 'deadline' | 'staff' | 'inspection' | 'event';
  on: Date; durationMins: number; campus: CampusId | 'all'; owner: string; conflict?: string; location?: string;
}

/* ---------- Obligations ---------- */
export interface Obligation {
  id: string; title: string; category: 'compliance' | 'renewal' | 'fee' | 'report' | 'contract' | 'review';
  dueOn: Date; leadTimeDays: number; owner: string; ownerRole: RoleId;
  status: 'on-track' | 'due-soon' | 'overdue' | 'done'; evidence?: string; campus: CampusId | 'all';
}

/* ---------- Memory ---------- */
export interface MeetingNote { id: string; title: string; on: Date; attendees: string[]; summary: string; decisions: string[]; actionItems: string[]; }
export interface MemoryDoc { id: string; title: string; type: string; updatedOn: Date; owner: string; excerpt: string; }

/* ---------- Learning ---------- */
export interface Assignment { id: string; title: string; subject: string; sectionId: string; assignedOn: Date; dueOn: Date; status: 'draft' | 'published' | 'closed'; submissions: number; strength: number; teacherId: string; }
export interface Assessment { id: string; title: string; subject: string; grade: number; on: Date; avgScore: number; topScore: number; submitted: number; total: number; }
export interface MasterySkill { skill: string; subject: string; level: 'secure' | 'developing' | 'beginning'; pct: number; trend: number[]; }

/* ---------- Bus / simulation ---------- */
export interface LiveEvent { id: string; on: Date; type: string; label: string; severity: 'info' | 'warn' | 'critical'; ref?: string; }

/* ---------- Legacy-shaped records used by the demo store/screens ---------- */
export interface ActionRecord {
  id: string;
  kind: 'approval' | 'incident' | 'case' | 'recommendation' | 'exception';
  title: string; detail: string; why: string;
  priority: 'critical' | 'high' | 'normal' | 'low' | 'urgent';
  owner: string;
  deadline?: Date;
  evidence: { label: string; detail?: string; ref?: string; data?: number[] }[];
  actions: { label: string; type: 'message' | 'workflow' | 'task' | 'investigate'; detail?: string; draft?: string; audience?: string; audienceCount?: number; channel?: 'WhatsApp' | 'SMS' | 'Email'; posture?: 'AUTO' | 'APPROVAL' | 'HUMAN-ONLY' }[];
  status: 'open' | 'approved' | 'dismissed' | 'resolved';
  on: Date;
  aiInvolved: boolean;
  policyRef?: string;
}

export interface ChatMsg { id: string; from: 'guardian' | 'school'; text: string; on: Date; status?: 'sending' | 'sent' | 'delivered' | 'read'; template?: boolean; }

/* ============================================================
   Maintenance & Facilities Operations
   Asset-first, AI-understood, SLA-governed work management.
   ============================================================ */
export type MaintPriority = 'emergency' | 'critical' | 'high' | 'medium' | 'low';
export type WOStatus = 'reported' | 'assigned' | 'accepted' | 'en-route' | 'on-site' | 'repairing' | 'verification' | 'resolved' | 'closed' | 'cancelled';
export type WOCategory = 'HVAC' | 'AV' | 'Electrical' | 'Plumbing' | 'Civil' | 'Safety' | 'Lab' | 'Cleanliness';
export type AssetCategory = 'HVAC' | 'AV' | 'Electrical' | 'Plumbing' | 'Water' | 'Power' | 'Safety' | 'Lab' | 'Security' | 'Furniture';
export type AssetStatus = 'operational' | 'watch' | 'degraded' | 'down' | 'maintenance' | 'retired';

export interface AssetRecord {
  id: string;                       // NOR-AC-04 (campus-type-number)
  name: string;
  category: AssetCategory;
  campus: CampusId;
  building: string;                 // 'Block A' | 'Block B' | 'Admin' | ...
  floor: number;
  room: string;                     // '204' | 'Lab' | 'Corridor' ...
  manufacturer: string;
  model: string;
  installedOn: Date;
  warrantyUntil?: Date;
  purchaseCost: number;
  criticality: 'high' | 'medium' | 'low';
  status: AssetStatus;
  health: number;                   // 0–100
  healthFactors: { factor: string; impact: number; note: string }[]; // impact: negative points
  lastService?: Date;
  serviceIntervalDays?: number;
  failures: { on: Date; summary: string; cost: number; workOrderId?: string }[];
  repairSpendYTD: number;
  expectedLifeYears?: number;
  manualDoc?: string;
}

export interface MaintSla { responseBy: Date; resolveBy: Date; responseMins: number; resolveMins: number; }

export interface WorkOrderRecord {
  id: string;                       // WO-1042
  title: string;
  description: string;
  source: 'app' | 'qr' | 'voice' | 'whatsapp' | 'inspection' | 'iot' | 'staff';
  category: WOCategory;
  assetId?: string;
  campus: CampusId;
  building: string;
  room?: string;
  priority: MaintPriority;
  status: WOStatus;
  reportedBy: string;               // person name
  reportedRole: RoleId;
  reportedOn: Date;
  assignedTo?: string;              // technician name
  assignedOn?: Date;
  acceptedOn?: Date;
  startedOn?: Date;
  completedOn?: Date;
  verifiedBy?: string;
  verificationNote?: string;
  reporterRating?: number;          // 1–5
  sla: MaintSla;
  respondedOn?: Date;
  slaBreached?: boolean;
  escalation?: 'none' | 'supervisor' | 'vendor' | 'principal';
  holdReason?: string;
  aiUnderstanding?: {
    category: WOCategory;
    assetMatch?: { assetId: string; confidence: number };
    severity: MaintPriority;
    safetyRelevant: boolean;
    urgency: 'immediate' | 'today' | 'this-week' | 'routine';
    affectedPeople?: number;
    suggestedSkill: string;
    confidence: number;             // 0–1
    reasoning: string[];            // concise, evidence-style
  };
  priorityFactors?: { factor: string; weight: number; note: string }[];
  timeline: { on: Date; actor: string; note: string; kind?: 'status' | 'note' | 'part' | 'photo' | 'voice' | 'ai' | 'sla' | 'assign' }[];
  partsUsed?: { inventoryId: string; name: string; qty: number; cost: number }[];
  labourMins?: number;
  photos?: { stage: 'before' | 'after'; note: string; on: Date }[];
  voiceNotes?: { transcript: string; on: Date; parsed?: boolean }[];
  recurrenceOf?: string;            // prior WO id
  resolution?: { summary: string; rootCause: string; preventiveNote?: string };
}

export interface TechnicianRecord {
  id: string;
  name: string;
  skills: string[];                 // category names
  certifications: string[];
  campus: CampusId;
  phone: string;
  currentJobs: number;
  firstTimeFixRate: number;         // 0–1
  avgResolutionMins: number;
  jobs30d: number;
  lastSeen: string;                 // 'On campus · Block B' | 'En route' | ...
  shift: string;
}

export interface MaintPlan {
  id: string;                       // MP-01
  title: string;
  assetIds: string[];
  type: 'time' | 'usage' | 'condition' | 'seasonal' | 'compliance';
  frequency: string;                // 'Monthly' | 'Quarterly (pre-monsoon)' ...
  intervalDays: number;
  lastDone?: Date;
  nextDue: Date;
  owner: string;                    // technician or vendor
  compliance: 'on-track' | 'due-soon' | 'overdue';
  checklist: string[];
  safetyNotes?: string[];
  policyRef?: string;               // 'Fire safety code §4.1'
}

export interface InspectionRecord {
  id: string;
  planId?: string;
  title: string;
  assetId?: string;
  campus: CampusId;
  on: Date;
  status: 'scheduled' | 'in-progress' | 'completed';
  inspector: string;
  result?: 'pass' | 'pass-with-notes' | 'fail';
  findings?: { item: string; ok: boolean; note?: string }[];
  followUpWorkOrderId?: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: AssetCategory;
  unit: string;                     // 'pcs' | 'kit' | 'L'
  stock: number;
  threshold: number;
  unitCost: number;
  consumed30d: number;
  consumptionTrend: number[];
  linkedCategories: AssetCategory[];
  store: string;                    // 'North store' | 'Central store'
  pendingRequests?: { qty: number; forWo?: string; on: Date }[];
}

export interface VendorRecord {
  id: string;
  name: string;
  categories: string[];
  contractUntil?: Date;
  slaPct: number;                   // on-time %
  avgResponseMins: number;
  jobsYTD: number;
  spendYTD: number;
  rating: number;                   // 1–5
  empanelled: boolean;
}

export { WO_FLOW } from '../lib/woFlow';

/* ============================================================
   FRONT DESK — AI Reception (v3 flagship)
   A phone/WhatsApp front desk that answers from school records,
   never guesses, and hands off to staff with full context.
   ============================================================ */
export type CallIntent =
  | 'fees' | 'transport' | 'admissions' | 'attendance' | 'hours'
  | 'documents' | 'maintenance' | 'complaint' | 'emergency' | 'other';

export interface ReceptionCall {
  id: string;                       // 'RC-201'
  on: Date;
  channel: 'phone' | 'whatsapp' | 'walk-in';
  callerNumber?: string;
  callerName?: string;              // resolved from guardian/staff records, else undefined
  transcript: { speaker: 'ai' | 'caller' | 'human-staff'; text: string; at: number }[]; // seconds from start
  intents: CallIntent[];
  resolvedByAi: boolean;
  handedOffTo?: string;             // staff name
  handoffReason?: string;
  outcome: 'resolved' | 'handoff' | 'voicemail' | 'callback-scheduled';
  callbackFor?: string;             // staff role/name when callback requested
  durationSec: number;
  callerSentiment: 'satisfied' | 'neutral' | 'frustrated';
  recordingConsent: boolean;
  linkedRecords?: string[];         // record refs used ('WO-1041', 'FEE-...', 'Route 7')
  language: 'English' | 'Hindi' | 'Hinglish';
}

export interface FrontDeskSettings {
  hours: string;                    // 'Mon–Sat 07:30–16:30'
  aiAnswerThresholdSec: number;     // ring time before AI picks up
  languages: ('English' | 'Hindi' | 'Hinglish')[];
  escalationNumber: string;
  recordingConsentLine: string;
  maxCallDurationMin: number;
  quietModeUntil?: Date;
  emergencyPolicy: string;          // policy ref
}

/* ---- formerly defined in mock modules; now first-class types ---- */
export interface DocRecord { id: string; ownerType: 'student' | 'staff' | 'school'; ownerId: string; ownerName: string; title: string; category: string; expiresOn?: Date; status: 'valid' | 'expiring' | 'expired'; size: string; }
export interface IncidentRecord { id: string; title: string; kind: 'student' | 'transport' | 'facilities' | 'it' | 'payment' | 'parent' | 'compliance' | 'other'; severity: 'low' | 'medium' | 'high' | 'critical'; status: 'detected' | 'triaged' | 'assigned' | 'in-progress' | 'resolved' | 'reviewed'; openedOn: Date; owner: string; campus: CampusId; summary: string; timeline: { on: Date; actor: string; note: string }[]; }
export interface Insight { id: string; question: string; metric: string; delta: string; dir: 'up' | 'down' | 'flat'; explanation: string; chart: { labels: string[]; values: number[] }; clusters: { label: string; value: number }[]; actions: { label: string; ref: string }[]; confidence: 'high' | 'medium' | 'low'; ownerRole: string; }
export interface ModelInfo { id: string; name: string; provider: string; role: string; latency: string; cost: string; status: 'live' | 'shadow' | 'off'; }
export interface AiUsageSummary { todayCalls: number; todayCost: number; monthCost: number; byFeature: { feature: string; calls: number; cost: number }[]; byModel: { model: string; calls: number; cost: number }[]; }
export interface VisitorEntry { id: string; name: string; purpose: string; host: string; on: Date; badgeNo: string; out?: Date; photoVerified: boolean; preRegistered: boolean; }
export interface GatePass { id: string; student: string; section: string; reason: string; on: Date; approvedBy: string; guardianSms: boolean; collectedBy: string; }
export interface DeskIntent { id: string; label: string; callsToday: number; resolvedByAiPct: number; example: string; }
export interface Scenario { id: string; title: string; blurb: string; steps: { label: string; detail: string; screen: string }[]; }
