// pack.dpdp — manifest (drop-in contract; registry row provisioned by migrations 009 + 023)
// The 009-locked contract is authoritative: dpdp.consent.ledger · events
// consent.recorded.v1 / sar.opened.v1 / sar.fulfilled.v1 · invariants
// residency_zone_enforced / consent_immutable / sar_sla_tracked / retention_schedule_linked.
// Standing rule: registry rows/contracts provisioned EXCLUSIVELY via numbered migrations —
// this file mirrors that row for the drop-in factory (no separate provisioning path).
export default {
  id: 'pack.dpdp',
  version: '1.1.1',
  class: 'C',
  /* PLG-1: this manifest declared nothing while its code called emitEvent/requestAudit and read (or wrote)
     the tables below — so the stored grant was whatever a client asked for. Declared now from a static scan of
     this plugin's own index.js: the facilities it actually calls, and nothing it does not (the catalog's
     `memory.write` for pack.cbse/pack.dpdp was a copy-paste: no code path touches app.memory_entries). */
  permissions: ['students.read', 'actions.raise', 'events.emit', 'audit.request'],
  description: 'DPDP Act 2023 compliance pack: immutable consent ledger, SAR (export/erasure) workflow through the kernel action spine, retention schedule hooks. Data-residency IN.',
  policyRefs: ['DPDP Act 2023 · consent and retention', 'Platform §2.4'],
  settingsSchema: {
    type: 'object',
    properties: {
      consent_validity_days: { type: 'integer', minimum: 1, maximum: 3650, default: 1095, description: 'Default consent validity in days (DPDP retention schedule); 1095 = 3 years' },
      dsr_sla_days: { type: 'integer', minimum: 1, maximum: 90, default: 30, description: 'SAR fulfilment SLA in days (invariant sar_sla_tracked)' },
    },
  },
  invariants: ['residency_zone_enforced', 'consent_immutable', 'sar_sla_tracked', 'retention_schedule_linked'],
  dependencies: [],
};
