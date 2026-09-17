// exams.assessment — manifest (drop-in contract; registry + contract exams.publication
// provisioned by migration 014, data plane by 025; this file mirrors them for the
// drop-in factory). Locked invariants: deterministic_only · weightage_total_enforced ·
// approval_before_publish · no_cross_tenant_marks.
export default {
  id: 'exams.assessment',
  version: '1.0.1',
  class: 'D',
  /* PLG-1: this manifest declared nothing while its code called emitEvent/requestAudit and read (or wrote)
     the tables below — so the stored grant was whatever a client asked for. Declared now from a static scan of
     this plugin's own index.js: the facilities it actually calls, and nothing it does not (the catalog's
     `memory.write` for pack.cbse/pack.dpdp was a copy-paste: no code path touches app.memory_entries). */
  permissions: ['students.read', 'attendance.read', 'events.emit', 'audit.request', 'actions.raise'],
  description: 'Examination primitives: marks entry, deterministic report-card assembly, publication via the kernel approval spine. Marks freeze read-only at publication; nothing guardian-visible before approval.',
  policyRefs: ['CBSE pack obligations', 'Platform §3 (plugin governance)'],
  settingsSchema: {
    type: 'object',
    properties: {
      grade_scale: { type: 'string', enum: ['cbse_10_point', 'percent', 'gpa_4'], default: 'cbse_10_point' },
      report_card_template: { type: 'string' },
    },
  },
  invariants: ['deterministic_only', 'weightage_total_enforced', 'approval_before_publish', 'no_cross_tenant_marks', 'eligibility_via_attendance', 'moderation_sod'],
  dependencies: [],
};
