// ops.visitors — manifest (drop-in contract; registry row + contract authored by
// migration 024 — 018-admissions precedent: the plugin factory provisions its own rows
// via numbered migrations; this file mirrors them for the drop-in factory).
// Invariants: pickup_requires_guardian_otp · no_release_without_verification ·
// otp_vault_kernel_pattern. Uniform lifecycle gate on every door.
export default {
  id: 'ops.visitors',
  version: '1.0.2',
  class: 'C',
  /* PLG-1: this manifest declared nothing while its code called emitEvent/requestAudit and read (or wrote)
     the tables below — so the stored grant was whatever a client asked for. Declared now from a static scan of
     this plugin's own index.js: the facilities it actually calls, and nothing it does not (the catalog's
     `memory.write` for pack.cbse/pack.dpdp was a copy-paste: no code path touches app.memory_entries). */
  permissions: ['students.read', 'events.emit', 'audit.request', 'comms.send'],
  description: 'Campus gate pass with guardian-verified student pickup. Front desk logs visitors, issues badges; student pickup raises an OTP to the primary guardian (kernel OTP-vault pattern, scrypt-hashed, TTL + attempt-bounded); release is fail-closed without verification.',
  policyRefs: ['Student safety · guardian pickup verification', 'Platform §2.4'],
  settingsSchema: {
    type: 'object',
    properties: {
      pickup_otp_ttl_minutes: { type: 'integer', minimum: 1, maximum: 30, default: 5, description: 'Pickup OTP validity in minutes' },
      pickup_otp_max_attempts: { type: 'integer', minimum: 1, maximum: 10, default: 5, description: 'Max OTP attempts per code' },
    },
  },
  invariants: ['pickup_requires_guardian_otp', 'no_release_without_verification', 'otp_vault_kernel_pattern'],
  dependencies: [],
};
