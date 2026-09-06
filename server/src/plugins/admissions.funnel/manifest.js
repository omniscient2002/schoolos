// admissions.funnel — module manifest (wave-2 #1, migration 018)
// Mirrors the registry row authored in 018; the loader validates id === dirname.
export default {
  id: 'admissions.funnel',
  name: 'Admissions Funnel',
  version: '1.0.0',
  kernel: '>=1.0.0 <2.0.0',
  class: 'C',
  trust: 'T1',
  description: 'Admission inquiry-to-enrollment funnel: lead capture, enforced stage lattice (inquiry → applied → interview → offer → enrolled, side exits rejected/withdrawn), stage history trail, PII-masked teacher surfaces. Applicant/guardian PII stays in plugin_admissions (purgeable); never writes core students; no money surfaces.',
  permissions: ['events.emit', 'audit.request'],
  settingsSchema: {
    type: 'object',
    properties: {
      default_source: { type: 'string', description: 'fallback inquiry source (walk-in, referral, website, phone)' },
      enrollment_term: { type: 'string', description: 'term leads are being captured for (e.g. 2027-28)' },
    },
  },
  data: { schema: 'plugin_admissions', core_refs: [], retention: { on_uninstall: 'export_then_purge_30d' }, residency: ['IN'] },
  policy_refs: ['DPDP consent obligations (guardian contact)', 'Platform §3 (plugin governance)'],
};
