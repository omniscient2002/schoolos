// pack.cbse — manifest (drop-in contract; registry manifest + capability contract
// cbse.assessment.validate provisioned by migration 009; 026 ships the stateless
// runtime). Rules, not code: the pack ADDS obligations, never relaxes kernel safeguards.
export default {
  id: 'pack.cbse',
  version: '1.0.0',
  class: 'C',
  /* PLG-1: this manifest declared nothing while its code called emitEvent/requestAudit and read (or wrote)
     the tables below — so the stored grant was whatever a client asked for. Declared now from a static scan of
     this plugin's own index.js: the facilities it actually calls, and nothing it does not (the catalog's
     `memory.write` for pack.cbse/pack.dpdp was a copy-paste: no code path touches app.memory_entries). */
  permissions: ['students.read', 'attendance.read', 'events.emit', 'audit.request', 'actions.raise'],
  description: 'CBSE policy pack — deterministic validation primitives over exams.assessment data (weightage totals, board attendance norm, report integrity) and OASIS-ready export. Stateless: no own writes; validation/exports audited through the kernel ledger.',
  policyRefs: ['CBSE pack obligations', 'Platform §3 (plugin governance)', 'docs/10 §plugin-architecture'],
  settingsSchema: {
    type: 'object',
    properties: {
      affiliation_no: { type: 'string', description: 'CBSE affiliation number' },
      academic_year: { type: 'string', description: 'Academic year (e.g. 2026-27)' },
      board: { type: 'string', enum: ['CBSE'], default: 'CBSE' },
      report_card_template: { type: 'string', enum: ['cbse_secondary', 'cbse_senior_secondary'], default: 'cbse_secondary' },
      weightage_strict: { type: 'boolean', default: true },
    },
    required: ['affiliation_no', 'academic_year'],
  },
  pack: {
    kind: 'policy',
    applies_to: 'CBSE',
    contents: ['board_calendar', 'holidays', 'grading_scale', 'report_card_structure', 'assessment_weightage_rules', 'compliance_report_templates'],
  },
  invariants: ['deterministic_only', 'adds_obligations_never_relaxes_safeguards', 'weightage_total_enforced', 'no_own_writes'],
  // PLG-2b compares the declared dependency version EXACTLY against the enabled row's version, and the
  // enable door writes that version from the dependency's own manifest. The declaration therefore has to
  // name the version exams.assessment actually ships (1.0.1, its manifest + catalog entry) or pack.cbse
  // can never be enabled at all — the trap PLG-9 records as "version is decorative and caller-controlled".
  dependencies: ['exams.assessment@1.0.1'],
};
