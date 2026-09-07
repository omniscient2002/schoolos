// hr.leave — manifest (drop-in contract; registry row + contracts authored by
// migration 029 — 018/024 precedent: the plugin factory provisions its own rows via
// numbered migrations; this file mirrors them for the drop-in factory).
// Invariants: absence-is-a-fact (no comms rail use) · staff.leave.marked.v1 is the
// timetable absence_feed=hr.leave source · per-staff-day uniqueness. Uniform
// lifecycle gate on every door.
export default {
  id: 'hr.leave',
  name: 'HR Leave & Duty Roster',
  version: '1.0.0',
  kernel: '>=1.0.0 <2.0.0',
  class: 'C',
  trust: 'T1',
  description: 'Staff leave marking and the daily duty roster. Emits staff.leave.marked.v1 / staff.leave.cancelled.v1 — the absence facts consumed by ops.timetable when its absence_feed setting is set to hr.leave (021 contract). No communication rail use — absence is a fact, not a parent notice.',
  permissions: ['users.read', 'events.emit', 'audit.request'],
  events: { subscribe: [], publish: ['staff.leave.marked.v1', 'staff.leave.cancelled.v1'] },
  eventSubscriptions: [],
  slots: ['settings', 'reports'],
  routes: [],
  widgets: [],
  settingsSchema: {
    type: 'object',
    properties: {
      absence_feed_contract: {
        type: 'string',
        default: 'ops.timetable absence_feed=hr.leave consumes staff.leave.marked.v1 (spine, per staff-day unique)',
        description: 'Consumption contract note for the timetable slot',
      },
    },
  },
  data: { schema: 'plugin_hr.leave (RLS-scoped)', core_refs: ['users.id'], retention: { on_uninstall: 'export_then_purge_30d' }, residency: ['IN'] },
  regions: ['IN'],
  residency: 'IN',
  billing: { model: 'pack', pack: 'operations' },
  dependencies: [],
  defaultEnabled: false,
};
