// health.clinic — manifest (drop-in contract; registry row + contracts authored by
// migration 029 — 018/024 precedent: the plugin factory provisions its own rows via
// numbered migrations; this file mirrors them for the drop-in factory).
// Invariants: append-first infirmary log (never rewritten) · guardian notices are
// APPROVED kernel message actions (per-instance clinic.notify.<visitId>), never
// plugin-direct sends · health history is nurse-lane PII. Uniform lifecycle gate.
export default {
  id: 'health.clinic',
  name: 'Health Clinic',
  version: '1.0.0',
  kernel: '>=1.0.0 <2.0.0',
  class: 'C',
  trust: 'T1',
  description: 'Infirmary log, sick passes and guardian health notices. Visits are append-first (corrections append); sent-home and hospital-referral outcomes raise a per-instance kernel approval action (clinic.notify.<visitId>) executed by the decide handler onto the comms rail — guardian notice is an approved communication, never a plugin-direct send (Comms §1.2). Health history is nurse-lane PII: no teacher/finance/parent read.',
  permissions: ['students.read', 'events.emit', 'audit.request'],
  events: { subscribe: [], publish: ['clinic.visit.logged.v1', 'clinic.sick_pass.issued.v1'] },
  eventSubscriptions: [],
  slots: ['settings', 'reports'],
  routes: [],
  widgets: [],
  settingsSchema: {
    type: 'object',
    properties: {
      notify_on_sent_home: { type: 'boolean', default: true, description: 'Raise the guardian-notice action when a visit ends sent_home' },
      notify_on_referral: { type: 'boolean', default: true, description: 'Raise the guardian-notice action on hospital_referral' },
      sick_pass_ttl_hours: { type: 'number', default: 8, description: 'Sick-pass validity window (hours)' },
    },
  },
  data: { schema: 'plugin_clinic.visit, plugin_clinic.sick_pass (RLS-scoped)', core_refs: ['students.id'], retention: { on_uninstall: 'export_then_purge_30d', note: 'health records follow school medical-retention norms; export-then-purge on uninstall' }, residency: ['IN'] },
  regions: ['IN'],
  residency: 'IN',
  billing: { model: 'pack', pack: 'operations' },
  dependencies: [],
  defaultEnabled: false,
};
