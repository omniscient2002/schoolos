// ops.timetable — plugin manifest (drop-in factory, docs/11 §2.2)
export default {
  id: 'ops.timetable',
  name: 'Timetable Primitives',
  version: '1.0.0',
  class: 'C',
  trust: 'T1',
  description: 'Period grid, class-section slots, daily substitutions (deterministic suggester), and attendance period-autofill primitives consumed by attendance/exams/comms. Substitution assignment is audited; ranking is a rule, never a model.',
  permissions: ['students.read', 'attendance.write', 'events.emit', 'audit.request'],
  events: { subscribe: [], publish: ['timetable.published', 'substitution.assigned', 'attendance.autofilled'] },
  slots: ['settings', 'reports'],
  routes: [],
  widgets: [],
  settings_schema: {
    type: 'object',
    properties: {
      working_days: { type: 'array', items: { type: 'string', enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] }, default: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] },
      autofill_default: { type: 'string', enum: ['present', 'none'], default: 'present', description: 'Status used for unmarked students on deterministic period autofill' },
      absence_feed: { type: 'string', enum: ['manual', 'hr.leave'], default: 'manual', description: 'Source of staff-absence facts (hr.leave plugin in wave 3)' },
    },
  },
  data: { schema: 'app.timetable_* (plugin-owned, RLS-scoped)', core_refs: ['students.id', 'attendance.student_id'], retention: { on_uninstall: 'export_then_purge_30d' }, residency: ['IN'] },
  regions: ['IN'],
  residency: 'IN',
  billing: { model: 'pack', pack: 'operations' },
  dependencies: [],
  policy_refs: ['Attendance §1.1', 'Platform §3 (plugin governance)'],
};
