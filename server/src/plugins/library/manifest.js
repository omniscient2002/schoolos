// library — manifest (drop-in contract; the registry row + capability contract are
// authored by migration 047 — 018/020/024 precedent: the plugin factory provisions
// its own rows via numbered migrations; this file mirrors them for the drop-in factory).
// Invariants: availability_derived_never_stored · student_must_be_active ·
// no_issue_from_retired_book · fine_computed_once_at_return · student_self_scope_only ·
// no_delete_for_app_role. Uniform lifecycle gate on every door.
export default {
  id: 'library',
  version: '1.0.0',
  class: 'C',
  /* PLG-1: this manifest declared nothing while its code called emitEvent/requestAudit and read (or wrote)
     the tables below — so the stored grant was whatever a client asked for. Declared now from a static scan of
     this plugin's own index.js: the facilities it actually calls, and nothing it does not (the catalog's
     `memory.write` for pack.cbse/pack.dpdp was a copy-paste: no code path touches app.memory_entries). */
  permissions: ['students.read', 'events.emit', 'audit.request'],
  description: 'The school library desk: catalog with per-title copy counts, issue/return against active students, availability derived from open loans (never stored), overdue fines computed at return (days_overdue × fine_per_day_cents, default ₹5/day) and an overdue chase list. Staffed per school-office norms (owner/principal/coordinator/facilities — no teacher door); students see only their own loans. Catalog lifecycle: retire keeps history, removes future issues.',
  policyRefs: ['Library desk norms', 'Platform §2.4'],
  settingsSchema: {
    type: 'object',
    properties: {
      fine_per_day_cents: { type: 'integer', minimum: 0, maximum: 100000, default: 500, description: 'Overdue fine per day, in paise (₹1 = 100 paise)' },
    },
  },
  invariants: [
    'availability_derived_never_stored',
    'student_must_be_active',
    'no_issue_from_retired_book',
    'fine_computed_once_at_return',
    'student_self_scope_only',
    'no_delete_for_app_role',
  ],
  dependencies: [],
};
