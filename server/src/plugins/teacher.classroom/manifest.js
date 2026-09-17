// teacher.classroom — manifest (registry row + contracts authored by migration 031;
// 018/024/029/032/034 precedent: the plugin factory provisions its own rows via numbered
// migrations; this file mirrors them for the drop-in factory).
// Invariants: students can ONLY submit, always as themselves (student_id = the signed-in
// student; UNIQUE(homework_id, student_id) makes a second submit a 409 — resubmission is
// requested by the teacher, never taken through this door) · late is decided at insert
// time (submitted_at > due_at → 'late') · a teacher sees ONLY homework rows with
// created_by = self, and the review desk belongs to the assigning teacher alone ·
// staff leave rides per-instance kernel actions (teacher.leave.<requestId>, UNIQUE from
// birth); the coordinator decides on the kernel door.
export default {
  id: 'teacher.classroom',
  name: 'Classroom & Homework',
  version: '1.0.0',
  kernel: '>=1.0.0 <2.0.0',
  class: 'C',
  trust: 'T1',
  description: 'The teacher classroom lane: post homework per class and subject with due dates, one-shot student submissions (text or link) with automatic late detection, the assigning-teacher-only review desk (reviewed / graded / resubmit_requested with grade and feedback), and the pending/reviewed/late/missing inbox. Staff leave rides per-instance kernel actions (teacher.leave.<requestId>); the coordinator decides on the kernel door. Privacy pins: students can ONLY submit and always as themselves — a second submit is refused; teachers see only the homework they assigned; review belongs to the assigning teacher alone.',
  permissions: ['students.read', 'events.emit', 'audit.request', 'actions.raise'],
  events: {
    subscribe: [],
    publish: [
      { type: 'homework.v1', schema: 'v1' },
      { type: 'submission.v1', schema: 'v1' },
      { type: 'staff.leave.requested.v1', schema: 'v1' },
    ],
  },
  eventSubscriptions: [],
  slots: [],
  routes: [],
  widgets: [],
  settingsSchema: { type: 'object', properties: {} },
  data: { schema: 'teacher.homework, teacher.submission, teacher.leave_request', core_refs: ['students.id', 'users.id'], retention: { on_uninstall: 'export_then_purge_30d' }, residency: ['IN'] },
  regions: ['IN'],
  residency: 'IN',
  billing: { model: 'pack', pack: 'teacher' },
  dependencies: [],
  defaultEnabled: false,
};
