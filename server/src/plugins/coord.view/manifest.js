// coord.view — manifest (registry row + contracts authored by migration 037;
// 018/024/029/031/032/033/034 precedent: the plugin factory provisions its own rows
// via numbered migrations; this file mirrors them for the drop-in factory).
// Invariants: the coordinator is the school's execution authority (principal may
// read; deciding rides the coordinator-owned kernel action) · SoD on every decide
// door: proposer≠decider · the teacher role is refused on every door · workload
// doors return AGGREGATES ONLY — no student data, and overload is a fairness flag,
// NEVER a score or rank · escalations carry student identity only where the
// coordinator is the routed authority (family.request owner_role='coordinator') ·
// the copilot is deterministic v0 — it never invents, empty data is said honestly.
export default {
  id: 'coord.view',
  name: 'Coordinator Command Center',
  version: '1.0.0',
  kernel: '>=1.0.0 <2.0.0',
  class: 'C',
  trust: 'T1',
  description: 'The coordinator execution plane: staffing today (absences, periods affected), substitution gaps on the timetable grid, open kernel approvals owned by the coordinator role (decide door with proposer≠decider SoD), curriculum pace vs term expectation (weeks_behind, revision_needed), teacher workload aggregates with a fairness overload flag (never a score or rank), duty allocation by least-loaded deterministic pick, escalations (family requests, routed concerns, re-evaluations) with append-only timelines, and the deterministic v0 coordinator copilot (keyword intents, honest empty answers, 200/month budget). Privacy pins: workload doors return aggregates only — no student data; escalations carry student identity only where the coordinator is the routed authority; teachers refused on every door.',
  permissions: ['users.read', 'students.read', 'events.emit', 'audit.request'],
  events: {
    subscribe: [],
    publish: [
      { type: 'coord.home.v1', schema: 'v1' },
      { type: 'coord.decision.v1', schema: 'v1' },
      { type: 'sub.assign.v1', schema: 'v1' },
      { type: 'duty.assigned.v1', schema: 'v1' },
    ],
  },
  eventSubscriptions: [],
  slots: ['settings', 'reports'],
  routes: [],
  widgets: [],
  settingsSchema: { type: 'object', properties: { copilot_monthly_cap: { type: 'integer', default: 200, description: 'Monthly coordinator copilot ask budget (A2 budget class coordinator_tier)' } } },
  data: { schema: 'coord.copilot_call (plugin-owned, RLS-scoped); reads: app.timetable_*, plugin_hr.leave, teacher.leave_request, app.actions, family.request(+events), teacher.concern(+status events), curriculum.node/progress, duty.assignment', core_refs: ['users.id', 'students.id'], retention: { on_uninstall: 'export_then_purge_30d' }, residency: ['IN'] },
  regions: ['IN'],
  residency: 'IN',
  billing: { model: 'pack', pack: 'coordination' },
  dependencies: [],
  defaultEnabled: false,
};
