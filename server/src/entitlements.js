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

/* ── FEE-COM-1: the fee-management feature matrix ───────────────────────────────────────────────────────
   Rails are plan-gated above, but the KERNEL fee capabilities (heads, installments, concessions, dunning,
   reconciliation, pay-many) had no tier at all — every tenant got the whole desk. This matrix is the fee
   tier: which plan includes which capability, and what an unentitled tenant should be told. It is authored
   here, beside the plugin matrix, so the two commercial decisions live in one reviewable place.
   `trial` is everything (080: unassigned means everything today). */
export const FEE_FEATURES = Object.freeze({
  'fees.collection': { label: 'Desk collection', plans: ['trial', 'core', 'operations', 'campus', 'compliance', 'rails'] },
  'fees.heads': { label: 'Fee heads & categories', plans: ['trial', 'operations', 'campus', 'compliance', 'rails'] },
  'fees.concessions': { label: 'Concessions & waivers', plans: ['trial', 'operations', 'campus', 'compliance', 'rails'] },
  'fees.installments': { label: 'Installment plans', plans: ['trial', 'campus', 'compliance', 'rails'] },
  'fees.multi_obligation': { label: 'Pay across obligations', plans: ['trial', 'campus', 'compliance', 'rails'] },
  'fees.dunning': { label: 'Dunning & reminders', plans: ['trial', 'rails'] },
  'fees.reconciliation': { label: 'Gateway reconciliation', plans: ['trial', 'rails'] },
});

export function feeFeatureIncluded(plan, feature) {
  const def = FEE_FEATURES[feature];
  if (!def) return true; // an unknown feature is not gated — never deny by omission
  if (plan === 'trial') return true;
  return def.plans.includes(plan);
}

/** The first paid plan that includes a feature — what an unentitled tenant must upgrade to. */
export function feeRequiredPlan(feature) {
  const def = FEE_FEATURES[feature];
  return def ? (def.plans.find((p) => p !== 'trial') ?? null) : null;
}

/** The availability report a settings/entitlement surface renders. */
export function feeEntitlements(plan) {
  const out = {};
  for (const feature of Object.keys(FEE_FEATURES)) {
    out[feature] = { available: feeFeatureIncluded(plan, feature), requiredPlan: feeRequiredPlan(feature) };
  }
  return out;
}

/** The 402 refusal shape for a fee feature gap. */
export function feeNotEntitled(feature, plan) {
  const label = FEE_FEATURES[feature]?.label ?? feature;
  return {
    code: 'NOT_ENTITLED',
    feature,
    plan,
    requiredPlan: feeRequiredPlan(feature),
    error: `Your school's plan (${plan}) does not include ${label}. Nothing was changed — ask the school owner about adding it.`,
  };
}
