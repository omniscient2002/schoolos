// ops.udise — UDISE+-style statistical export (headless, class B, read-only).
// Pulls NO PII: every figure is an aggregate count over on-roll students, active
// staff and the asset register. Column mapping is self-documented by the plugin's
// /columns door and pinned in tests/udise-export.test.js.
export default {
  id: 'ops.udise',
  name: 'UDISE+ Export',
  version: '1.0.0',
  class: 'B',
  trust: 'T1',
  description: 'Deterministic UDISE+-style statistical export from real school records: on-roll enrollment by class × section × gender bucket, staff by role, infrastructure by category and status. Aggregates only — never names, never PII. The gender split is honest about what the schema records today (a not_recorded bucket) until a students.gender column exists (L1 migration).',
  permissions: ['students.read', 'events.emit', 'audit.request'],
  events: { subscribe: [], publish: ['udise.export.completed'] },
  slots: ['settings', 'reports'],
  routes: [],
  widgets: [],
  settingsSchema: {
    type: 'object',
    properties: {
      udise_code: { type: 'string', description: "The school's 11-digit UDISE code (stamped on every export row)" },
      school_name: { type: 'string', description: 'School name as registered on UDISE+ (export metadata only)' },
      school_type: { type: 'string', description: 'e.g. Primary / Upper Primary / Secondary / Higher Secondary' },
    },
    required: ['udise_code'],
  },
  data: { schema: 'stateless (no plugin tables — reads kernel records, exports aggregates)', core_refs: ['students.id', 'users.id', 'assets.id'], retention: { on_uninstall: 'nothing-stored' }, residency: ['IN'] },
  regions: ['IN'],
  residency: 'IN',
  billing: { model: 'pack', pack: 'operations' },
  dependencies: [],
  policy_refs: ['Platform §5.2 (artifacts)', 'UDIS+-schema mapping: see /columns door'],
};
