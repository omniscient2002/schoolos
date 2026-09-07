// student.world — manifest (registry row + contracts authored by migration 036;
// 018/024/029/032/034 precedent: the plugin factory provisions its own rows via numbered
// migrations; this file mirrors them for the drop-in factory).
// Invariants: students are on SCHOOL computers/kiosks (no personal phones, §78/§79) —
// user-owned rows are RLS-pinned to schoolos.user_id, every /student/* response is
// no-store, and the kiosk idle-countdown rides GET /student/session. No cross-student
// data access anywhere. Print jobs are school-controlled (student queues, office/teacher
// prints). Anonymous wellbeing filings store no student identity. The teacher role is
// refused on student-owned doors.
export default {
  id: 'student.world',
  name: 'Student World',
  version: '1.0.0',
  kernel: '>=1.0.0 <2.0.0',
  class: 'C',
  trust: 'T1',
  description: 'The student world on school computers/kiosks (no personal phones): own home view (next class from the timetable grid + current IST period, today counts, upcoming test, needs-attention, progress directions, bag-for-tomorrow), homework split digital/paper (paper = complete in notebook, teacher marks receipt — no submission flow), own published results with plain-language explains, and the self-study plane: mistake notes, flashcards, study tasks, and school-controlled print jobs (student queues, office/teacher prints) plus a print-ready weekly noticeboard. Wellbeing requests route to the counselor/principal plane; anonymous filings store no student identity. Session isolation on shared machines: user-owned rows are RLS-pinned to schoolos.user_id, every /student/* response is no-store, and GET /student/session drives the kiosk idle-countdown. Contracts: student.home.v1, student.print.v1, student.wellbeing.v1.',
  permissions: ['students.read', 'events.emit', 'audit.request'],
  events: {
    subscribe: [],
    publish: [
      { type: 'student.home.v1', schema: 'v1' },
      { type: 'student.print.v1', schema: 'v1' },
      { type: 'student.wellbeing.v1', schema: 'v1' },
    ],
  },
  eventSubscriptions: [],
  slots: ['settings', 'reports'],
  routes: [],
  widgets: [],
  settingsSchema: { type: 'object', properties: { student_idle_timeout_minutes: { type: 'integer', minimum: 1, maximum: 120, default: 10 } } },
  data: { schema: 'student.mistake_note, student.flashcard, student.study_task, student.print_job, student.wellbeing_request', core_refs: ['students.id', 'users.id'], retention: { on_uninstall: 'export_then_purge_30d' }, residency: ['IN'] },
  regions: ['IN'],
  residency: 'IN',
  billing: { model: 'pack', pack: 'student' },
  dependencies: [],
  defaultEnabled: false,
};
