/* labels.ts — user-facing names for code identifiers.
 *
 * The product's plain-language law: a school user must never read a raw role key, enum value,
 * plugin id or snake_case field name in the UI. Screens import these helpers instead of
 * rendering the identifier directly. `humanize` is the safe fallback (in_progress → In progress);
 * the explicit maps cover the words that need a friendlier, domain-correct name. */

/** Staff/role titles. Unknown keys fall back to a humanised version of the key, never a blank. */
export const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  principal: 'Principal',
  coordinator: 'Coordinator',
  counselor: 'Counsellor',
  teacher: 'Class teacher',
  finance: 'Bursar / Accountant',
  finance_head: 'Finance head',
  finance_clerk: 'Finance clerk',
  admissions: 'Admissions officer',
  transport: 'Transport in-charge',
  facilities: 'Facilities',
  technician: 'Technician',
  itadmin: 'IT administrator',
  librarian: 'Librarian',
  parent: 'Parent',
  student: 'Student',
};

export function roleLabel(role: string | null | undefined): string {
  const key = String(role ?? '').trim();
  if (!key) return 'Staff';
  return ROLE_LABELS[key] ?? humanize(key);
}

/** Add-on (plugin) ids → the name a school user knows them by. */
export const PLUGIN_LABELS: Record<string, string> = {
  'library': 'Library',
  'people.admin': 'People',
  'admissions.funnel': 'Admissions',
  'ops.visitors': 'Visitors',
  'ops.timetable': 'Timetable',
  'ops.bi': 'Reports',
  'ops.import': 'Data import',
  'ops.udise': 'UDISE returns',
  'pack.dpdp': 'Data & privacy',
  'pack.cbse': 'Board compliance',
  'payments.upi': 'UPI payments',
  'payments.razorpay': 'Online payments',
  'files.store': 'Documents',
  'hr.leave': 'Leave',
  'exams.assessment': 'Exams',
  'transport.gps': 'Transport tracking',
  'accounting.tally': 'Tally export',
  'comms.whatsapp': 'WhatsApp',
  'health.clinic': 'Health clinic',
  'teacher.classroom': 'Classroom',
  'teacher.copilot': 'Teaching assistant',
  'teacher.support': 'Student support',
};

export function pluginLabel(id: string | null | undefined): string {
  const key = String(id ?? '').trim();
  if (!key) return 'Add-on';
  return PLUGIN_LABELS[key] ?? humanize(key);
}

/** Status / stage / kind values that need a friendlier name than Title Case. */
export const STATUS_LABELS: Record<string, string> = {
  in_progress: 'In progress',
  waiting_parent: 'Waiting on the family',
  waiting_staff: 'Waiting on the school',
  pending: 'Waiting',
  pending_approval: 'Waiting for approval',
  draft: 'Draft',
  open: 'Open',
  closed: 'Closed',
  resolved: 'Resolved',
  cancelled: 'Cancelled',
  scheduled: 'Scheduled',
  overdue: 'Overdue',
  published: 'Published',
  sent: 'Sent',
  queued: 'Queued',
  acknowledged: 'Acknowledged',
  shared: 'Shared',
  referred_out: 'Referred out',
  needs_support: 'Needs support',
  on_track: 'On track',
  at_risk: 'At risk',
  outstanding: 'Outstanding',
  paid: 'Paid',
  waived: 'Waived',
  valid: 'Valid',
  invalid: 'Needs fixing',
  applied: 'Applied',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  urgent: 'Urgent',
};

export function statusLabel(value: string | null | undefined): string {
  const key = String(value ?? '').trim();
  if (!key) return '—';
  return STATUS_LABELS[key] ?? humanize(key);
}

/** Notification group keys → the plain heading shown in the bell. */
export const NOTIFICATION_GROUP_LABELS: Record<string, string> = {
  'needs-you': 'Needs you',
  approvals: 'Approvals',
  money: 'Fees & payments',
  attendance: 'Attendance',
  academics: 'Academics',
  admissions: 'Admissions',
  library: 'Library',
  transport: 'Transport',
  maintenance: 'Maintenance',
  updates: 'Updates',
};

export function notificationGroupLabel(group: string | null | undefined): string {
  const key = String(group ?? '').trim();
  if (!key) return 'Updates';
  return NOTIFICATION_GROUP_LABELS[key] ?? humanize(key);
}

/** Fallback: snake_case / kebab-case / camelCase → "Title Case words". */
export function humanize(value: unknown): string {
  const s = String(value ?? '').trim();
  if (!s) return '—';
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

/* ══ P3-1 · one place that knows how to write a grade ═════════════════════════════════════════════
   A school's grade is free text by design — the Classes screen asks for free text and suggests
   "e.g. 6, LKG, Nursery", and the onboarding school called them "Grade 1", "Grade 1-A". Screens then
   wrote `Class {grade}` and `Grade {grade}`, which rendered "Class Grade 1" and "Grade Grade 1-A"
   in TEN places across nine files. It is one bug, not ten, and the fix belongs in one helper: a
   caller asks for the label it wants and never concatenates a prefix onto a value that may already
   carry one. */

/** The grade with any redundant "Grade "/"Class " prefix removed: "Grade 1-A" → "1-A".
 *  Takes `unknown` on purpose: `Student.grade` is `number | string | undefined` in the domain type
 *  (the roster has held both), and a label helper that refuses a number just pushes the
 *  concatenation bug back into the screens. */
export const bareGrade = (grade: unknown): string =>
  String(grade ?? '').trim().replace(/^(?:grade|class)\s+/i, '');

/** "Class 1" for "Grade 1" or "1"; "Class LKG" for "LKG". Never "Class Grade 1". */
export const classLabel = (grade: unknown): string => {
  const bare = bareGrade(grade);
  return bare ? `Class ${bare}` : 'Class';
};

/** "Grade 1-A" for "Grade 1-A" and for "1-A"; "Grade LKG" for "LKG". Never "Grade Grade 1-A". */
export const gradeLabel = (grade: unknown): string => {
  const bare = bareGrade(grade);
  if (!bare) return 'Grade';
  return /^(?:grade|class)\b/i.test(bare) ? bare : `Grade ${bare}`;
};

/** "1-A" from a grade and a section, or just the grade when the section is unknown. */
export const classAndSection = (grade: unknown, section: unknown): string =>
  [bareGrade(grade), String(section ?? '').trim()].filter(Boolean).join('-');
