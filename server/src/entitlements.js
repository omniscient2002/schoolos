/* PLG-2 — which plugins a school is entitled to, and why this is a matrix in code.

   THE DEFECT: `entitlement` was never checked. Any tenant could enable any plugin — including paid packs and
   the credential rails — and the ledger recorded it as a legitimate act. Of the four documented enable gates
   (kernel compat, permissions accepted, entitlement, `dependsOn`) none were implemented.

   WHY AN AUTHORED MATRIX AND NOT THE STORED VALUES: `app.plugins.entitlement` holds six mutually inconsistent
   vocabularies — the column was written by whoever authored each plugin, and several plugins write
   `entitlement.plan` values that match nothing anywhere. A field nobody can agree on the meaning of cannot be
   the gate. So the plan belongs to the TENANT (`app.tenants.plan`, migration 080) and the mapping from plan to
   plugins is authored here, in one place, in a diff a reviewer can read.

   THE COMMERCIAL MAPPING IS A PRODUCT DECISION, NOT A TECHNICAL FINDING. The grouping below follows
   docs/11-plugin-native-architecture.md's own tiers, and moving a plugin between plans is a one-line change by
   design. What matters for the defect is that the mapping is (a) explicit, (b) complete over the catalogue, and
   (c) enforced — all three are asserted by this file's test, so a plugin added to the catalogue without a plan
   fails CI rather than becoming silently unavailable to every school.
*/

/* '*' means everything, and is the honest description of `trial`: see 080's comment — unassigned means
   everything today, not "a timed trial". Nothing expires. */
export const PLANS = Object.freeze({
  trial: '*',
  core: [],
  operations: [
    'ops.timetable', 'ops.visitors', 'ops.bi', 'ops.import', 'ops.udise', 'hr.leave',
    'health.clinic', 'teacher.classroom', 'teacher.support', 'teacher.copilot', 'coord.view',
  ],
  campus: [
    'library', 'admissions.funnel', 'family.view', 'parent.assistant', 'student.world',
    'exams.assessment', 'people.admin', 'files.store',
  ],
  compliance: ['pack.cbse', 'pack.dpdp'],
  rails: [
    'rails.email', 'rails.sms', 'rails.whatsapp', 'comms.whatsapp',
    'payments.upi', 'payments.razorpay', 'accounting.tally', 'transport.gps',
  ],
});

/** plugin_id → the plan that first includes it. Derived, so the two can never disagree. */
export const PLUGIN_PLAN = Object.freeze((() => {
  const map = {};
  for (const [plan, ids] of Object.entries(PLANS)) {
    if (ids === '*') continue;
    for (const id of ids) if (!(id in map)) map[id] = plan;
  }
  return map;
})());

/** Is this plugin part of the plan? `trial` is everything, unlisted plugins are not included in a paid plan. */
export function planIncludes(plan, pluginId) {
  const set = PLANS[plan];
  if (set === undefined) return false;          // an unknown plan entitles nothing — never "allow by default"
  if (set === '*') return true;
  return set.includes(pluginId);
}

/** The refusal shape for an entitlement gap, used by the enable door and the request gate. */
export function notEntitled(pluginId, plan) {
  return {
    code: 'NOT_ENTITLED',
    plugin: pluginId,
    plan,
    error: `Your school's plan (${plan}) does not include this feature. Nothing was changed — ask the school owner about adding it.`,
  };
}

/** Every catalogue id that no plan covers. The test asserts this is empty. */
export function uncoveredPlugins(catalogIds) {
  return catalogIds.filter((id) => !(id in PLUGIN_PLAN));
}
