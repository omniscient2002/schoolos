// people.admin — manifest (drop-in contract; the registry row + capability contract
// are authored by migration 046 — 018/024/034 precedent: the plugin factory provisions
// its own rows via numbered migrations; this file mirrors them for the drop-in factory).
// Invariants: owner_creation_forbidden · owner_suspend_forbidden ·
// temp_password_shown_once · transfer_writes_history · import_per_row_savepoint ·
// unique_tenant_email_409. Uniform lifecycle gate on every door.
export default {
  id: 'people.admin',
  version: '1.0.0',
  class: 'B',
  /* PLG-1: this manifest declared nothing while its code called emitEvent/requestAudit and read (or wrote)
     the tables below — so the stored grant was whatever a client asked for. Declared now from a static scan of
     this plugin's own index.js: the facilities it actually calls, and nothing it does not (the catalog's
     `memory.write` for pack.cbse/pack.dpdp was a copy-paste: no code path touches app.memory_entries). */
  permissions: ['users.write', 'students.write', 'events.emit', 'audit.request'],
  description: 'Identity & roster administration: user provisioning for every role except owner (scrypt credentials, optional parent child-link), suspend/activate (suspension makes the kernel live-row check refuse the account), forced-change temporary passwords, the student class/section transfer flow that writes an append-only enrollment_history row, and a validated CSV roster import (per-row SAVEPOINT, in-file + in-DB admission-number dedupe, 500-row cap, full report). Owner accounts cannot be created, suspended or password-reset from any door.',
  policyRefs: ['Platform §2.4 (identity & access)'],
  settingsSchema: { type: 'object', properties: {} },
  invariants: [
    'owner_creation_forbidden',
    'owner_suspend_forbidden',
    'temp_password_shown_once',
    'transfer_writes_history',
    'import_per_row_savepoint',
    'unique_tenant_email_409',
  ],
  dependencies: [],
};
