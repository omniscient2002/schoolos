// family.view — manifest (registry row + contracts authored by migration 034;
// 018/024/029/032 precedent: the plugin factory provisions its own rows via numbered
// migrations; this file mirrors them for the drop-in factory).
// Invariants: guardians read ONLY their linked children (family.child_link; cross-guardian
// 403) · consent decisions are immutable once made (BEFORE UPDATE guard) · parents never
// edit school records — corrections travel as requests · request statuses are append-only
// events · child leave requests raise per-instance kernel actions (UNIQUE(tenant,code)
// from birth) · the teacher role is refused on every door.
export default {
  id: 'family.view',
  name: 'Family Command Center',
  version: '1.0.0',
  kernel: '>=1.0.0 <2.0.0',
  class: 'C',
  trust: 'T1',
  description: 'The parent read-plane: per-child home aggregation (attendance, assignments, exams, timeline), the unified request center with append-only ticket statuses, immutable event consents, child leave requests via per-instance kernel actions, and the report-discrepancy flow. Guardian scoping via family.child_link; cross-guardian access refused; teachers refused on every door.',
  permissions: ['students.read', 'events.emit', 'audit.request'],
  events: {
    subscribe: [],
    publish: [
      { type: 'family.request.v1', schema: 'v1' },
      { type: 'family.consent.v1', schema: 'v1' },
      { type: 'child.leave.requested.v1', schema: 'v1' },
    ],
  },
  eventSubscriptions: [],
  slots: ['settings', 'reports'],
  routes: [],
  widgets: [],
  settingsSchema: { type: 'object', properties: {} },
  data: { schema: 'family.child_link, family.request(+events), family.consent', core_refs: ['students.id', 'users.id'], retention: { on_uninstall: 'export_then_purge_30d' }, residency: ['IN'] },
  regions: ['IN'],
  residency: 'IN',
  billing: { model: 'pack', pack: 'family' },
  dependencies: [],
  defaultEnabled: false,
};
