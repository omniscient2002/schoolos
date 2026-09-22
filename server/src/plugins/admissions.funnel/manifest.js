// admissions.funnel — module manifest (wave-2 #1, migration 018)
// Mirrors the registry row authored in 018; the loader validates id === dirname.
export default {
  id: 'admissions.funnel',
  name: 'Admissions Funnel',
  version: '1.3.0',
  kernel: '>=1.0.0 <2.0.0',
  class: 'C',
  trust: 'T1',
  description: 'Admission enquiry-to-enrollment funnel: lead capture, correction and stage progression along a DB-enforced lattice (enquiry → form → interaction → offer → waitlisted → enrolled, side exits rejected/withdrawn), visit/interview scheduling, admission-document attachment, generated offer letters, stage history trail, health/orphan reconciliation, and PII-masked teacher surfaces. Applicant/guardian PII stays in plugin_admissions (purgeable); never writes core students; no money surfaces.',
  permissions: ['events.emit', 'audit.request', 'actions.raise', 'comms.send'],
  settingsSchema: {
    type: 'object',
    properties: {
      default_source: { type: 'string', description: 'fallback inquiry source (walk-in, referral, website, phone)' },
      enrollment_term: { type: 'string', description: 'term leads are being captured for (e.g. 2027-28)' },
      /* SEC-6 (2026-09-14): these three were read by the door — `index.js:79-89` drives the admissions session
       * window and stamps the session year on every lead from them — but were NOT declared in this manifest, so
       * it did not describe the module's own settings. That gap was invisible while the settings door persisted
       * any JSON handed to it; it became fatal the moment SEC-6 wired the schema validator into the persisting
       * door, because `/plugins/admissions.funnel/settings` then rejected the very payload the plugin needs.
       *
       * The `pattern`/`default` values are MIRRORED from migration 022's registry row, which was the only place
       * they existed. This file is the SOURCE of `app.plugins.manifest` — `plugin-catalog.js:62` imports it and
       * re-inserts on every boot, overwriting whatever the registry row held — so a value present only in 022
       * was being silently replaced at boot. Keeping the two in step matters more than either alone.
       *
       * NOTE ON THE REGEX ESCAPING, because it has already gone wrong once: the pattern must be the ordinary JS
       * string '^\\d{2}-\\d{2}$', which is the two-character escape `\d` and matches a digit. Migration 022
       * wrote the same regex with a doubled escape, producing a pattern that matches a literal backslash
       * followed by `d` and therefore never matches anything — measured, not inferred: the stored value was 15
       * characters long instead of 13, and `new RegExp(stored).test('12-01')` returned false. Do not "fix" the
       * escaping below by adding backslashes. */
      admission_year: { type: 'string', pattern: '^\\d{4}-\\d{2}$', default: '2026-27', description: 'Admission session year (e.g. 2026-27); defaults to the current Apr–Mar cycle' },
      cycle_start: { type: 'string', pattern: '^\\d{2}-\\d{2}$', default: '02-01', description: 'Session window start (MM-DD); Feb 1 default — India admissions cycle Feb–Jun' },
      cycle_end: { type: 'string', pattern: '^\\d{2}-\\d{2}$', default: '06-30', description: 'Session window end (MM-DD)' },
      notify_guardians: { type: 'boolean', default: true, description: 'Queue a guardian message when an offer is made and when it is accepted (delivery is owned by the comms dispatcher/rails)' },
    },
  },
  data: { schema: 'plugin_admissions', core_refs: [], retention: { on_uninstall: 'export_then_purge_30d' }, residency: ['IN'] },
  policy_refs: ['DPDP consent obligations (guardian contact)', 'Platform §3 (plugin governance)'],
};
