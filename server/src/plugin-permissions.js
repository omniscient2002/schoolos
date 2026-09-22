/* PLG-1 — the permission vocabulary and the one refusal shape.

   WHAT WAS WRONG. `permissions[]` was written at seed time, then **overwritten from the request body** on enable,
   and read only for display. No permission-check helper existed anywhere in the codebase. So the documented
   contract — "the manifest is a ceiling, enforced per call" — was a claim with no mechanism behind it, and the
   consent the ledger recorded was authored by whoever called the API (this project's own `plugins.test.js`
   demonstrated it: enabling `library` with `permissions: ['students.read']` returned 200).

   WHAT "ENFORCED" MEANS HERE, and why it is this and not something grander:
     · the MANIFEST declares what the plugin needs, validated against ONE frozen vocabulary (below) at boot;
     · the ROW records exactly that declared set — never a client-supplied one — so the ledger's record of
       consent is the on-disk truth rather than a second opinion;
     · every door refuses while the row's grant does not cover the manifest's declaration, checked in the single
       shared gate that 27 of 29 plugins already use.

   WHAT IS NOT CLAIMED. Annotating all 168 doors with the specific permission each one needs was rejected in
   design: it is unreviewable by hand, and for most domains the vocabulary has no seam to check against, so the
   annotation would be decoration. `PERMISSION_SEAM` therefore records, per permission, WHICH kernel facility
   enforces it — and says `unenforced` where the honest answer is that nothing does yet. A permission marked
   `unenforced` is recorded debt, not a false claim of safety; that is the difference between this file and the
   documentation it replaces.
*/

/* One frozen vocabulary. A manifest may not invent a permission, and adding one here is a deliberate act with a
   review, because a word that no seam checks is a word that means nothing. */
export const KERNEL_PERMISSIONS = Object.freeze([
  'students.read', 'students.write', 'attendance.read', 'attendance.write',
  'fees.read', 'fees.write', 'audit.request', 'events.emit', 'actions.raise',
  'comms.send', 'memory.write', 'users.read', 'users.write', 'files.read',
  'files.write', 'payments.write',
]);

/* Which facility actually enforces each permission. `unenforced:*` is an admission, kept in the code rather than
   in a document, so a reader can see how much of the ceiling is real. PLG-1's own test asserts that the
   enforced ones are wired and that the vocabulary and this map do not drift apart. */
export const PERMISSION_SEAM = Object.freeze({
  'audit.request': 'scopedKernel:auditLog',
  'events.emit': 'scopedKernel:emitEvent',
  'comms.send': 'rails.send',
  'files.write': 'plugin-door:files.store.upload',
  'actions.raise': 'unenforced:raw-sql',
  'attendance.read': 'unenforced:raw-sql',
  'attendance.write': 'unenforced:raw-sql',
  'fees.read': 'unenforced:raw-sql',
  'fees.write': 'unenforced:none',
  'files.read': 'unenforced:none',
  'memory.write': 'unenforced:kernel-door',
  'payments.write': 'unenforced:none',
  'students.read': 'unenforced:raw-sql',
  'students.write': 'unenforced:raw-sql',
  'users.read': 'unenforced:raw-sql',
  'users.write': 'unenforced:raw-sql',
});

/** The WHOLE on-disk manifest for a plugin, or null when there is no module. This is the ONE source the enable
 *  door resolves `version`/`class`/`permissions` from — never the request body (PLG-4). */
export async function declaredManifest(pluginId) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(String(pluginId ?? ''))) return null;   // no path games
  try {
    const mod = await import(`./plugins/${pluginId}/manifest.js`);
    const m = mod?.default ?? mod;
    return m && typeof m === 'object' && m.id ? m : null;
  } catch { return null; }   // null = no manifest on disk (a catalog-only row)
}

/** The on-disk permission declaration for a plugin: null = no manifest, [] = a manifest that declares none.
 *  Mirrors `plugin-catalog.js`'s resolver: the manifest is the source. */
export async function declaredPermissions(pluginId) {
  const m = await declaredManifest(pluginId);
  return m === null ? null : (Array.isArray(m.permissions) ? m.permissions.map(String) : []);
}

/** Anything a manifest invented. Boot refuses on a non-empty result — a typo'd permission must not be stored. */
export function unknownPermissions(list) {
  return (Array.isArray(list) ? list : []).filter((p) => !KERNEL_PERMISSIONS.includes(p));
}

/** The single refusal shape, used by the gate and the enable door so callers see one story. */
export function denied(pluginId, permission, extra = {}) {
  return {
    code: 'PERMISSION_DENIED',
    plugin: pluginId,
    permission,
    ...extra,
    error: `This feature asked for a permission it does not hold (${permission}). Nothing was done — ask the school owner.`,
  };
}

/**
 * The granted set for a plugin: the manifest's declaration, full stop.
 * `existing` is only used when there is no manifest on disk (catalog-only rows), because dropping what such a
 * row already holds would turn a missing file into an outage.
 */
export function grantedFor(pluginId, declared, existing = null) {
  if (declared === null) return Array.isArray(existing) ? existing : [];
  return [...declared];
}

/** Does the stored grant cover what the plugin declares? The gate and the enable door ask this one question. */
export function covers(grant, declared) {
  const g = Array.isArray(grant) ? grant : [];
  const d = Array.isArray(declared) ? declared : [];
  return d.every((p) => g.includes(p));
}

/** The first permission the grant is missing, so a refusal can name the actual gap. */
export function firstMissing(grant, declared) {
  const g = Array.isArray(grant) ? grant : [];
  return (Array.isArray(declared) ? declared : []).find((p) => !g.includes(p)) ?? null;
}

/* PLG-1b: the manifest is also the ceiling for kernel facilities, not merely
 * metadata stored beside the plugin. The loader gives each plugin this narrow
 * facade; raw SQL remains an explicitly recorded debt for facilities without
 * a seam, while these three seams fail at the call site. */
export function scopedKernel(kernel, pluginId, declared = []) {
  const permissions = new Set(Array.isArray(declared) ? declared.map(String) : []);
  const baseAudit = kernel?.auditLog;
  if (typeof baseAudit !== 'function') throw new Error('scopedKernel needs kernel.auditLog');

  const refuse = async (client, tenantId, facility, permission) => {
    await baseAudit(client, tenantId, {
      actor: `plugin:${pluginId}`, actorRole: 'kernel', action: `Plugin facility denied: ${facility}`,
      recordType: 'PluginPermission', recordRef: pluginId, policyRef: 'Platform §3 (plugin governance)',
      risk: 'high', outcome: `missing declared permission ${permission}`,
    });
    throw Object.assign(new Error(`Plugin ${pluginId} is not declared for ${facility} (${permission})`), {
      code: 'PERMISSION_DENIED', statusCode: 403, plugin: pluginId, permission,
    });
  };
  const requireFacility = (facility, permission, fn) => async (client, tenantId, ...args) => {
    if (!permissions.has(permission)) return refuse(client, tenantId, facility, permission);
    return fn(client, tenantId, ...args);
  };
  const requestAudit = requireFacility('auditLog', 'audit.request', async (client, tenantId, _plugin, entry) =>
    // The loaded module, not a caller-provided argument, is the provenance
    // authority.  A plugin must not be able to write another plugin's identity.
    baseAudit(client, tenantId, { ...entry, actorRole: `plugin:${pluginId}`, policyRef: entry?.policyRef ?? `Platform §3 (plugin governance) · ${pluginId}` }));
  const emitEvent = requireFacility('emitEvent', 'events.emit', async (client, tenantId, event, topic, payload, opts = {}) => {
    // C4/H5: enforce the plugin's event budget at the EMIT SEAM too, not only at the two doors that
    // call checkEventBudget explicitly. Scoped to a plugin that has an EXPLICIT `events_per_min`
    // configured, so default-budget plugins keep their behaviour (no surprise breaker trips) while a
    // plugin an operator has bounded is bounded on every path. A refusal throws (429); the enclosing
    // transaction rolls back, so there is no partial write.
    // Skip the probe entirely for a client that has no query method (unit tests pass a bare object as the
    // client — the seam's contract is kernel.emitEvent, not the budget probe).
    if (typeof client?.query !== 'function') {
      return kernel.emitEvent(client, tenantId, event, topic, payload, { ...opts, emittedBy: `plugin:${pluginId}` });
    }
    try {
      await client.query('SAVEPOINT evbudget');
      const b = await client.query(`SELECT event_budget FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`, [tenantId, pluginId]);
      const configured = b.rows[0]?.event_budget;
      if (configured && Number.isFinite(Number(configured.events_per_min))) {
        const { checkEventBudget } = await import('./governance.js');
        const bytes = payload == null ? 0 : Buffer.byteLength(JSON.stringify(payload), 'utf8');
        const gov = await checkEventBudget(client, tenantId, pluginId, bytes);
        if (!gov.allowed) throw Object.assign(new Error(gov.code), { statusCode: 429, code: gov.code, ...gov });
      }
      await client.query('RELEASE SAVEPOINT evbudget');
    } catch (e) {
      // A DB error aborts the enclosing transaction, so undo only the budget probe (never leave the
      // caller's tx aborted) and then either propagate the refusal or continue the event spine.
      await client.query('ROLLBACK TO SAVEPOINT evbudget').catch(() => {});
      if (e?.statusCode === 429) throw e;
    }
    // Same rule for the event/outbox spine: emittedBy is always the mounted
    // plugin id, even when a plugin passes forged options.
    return kernel.emitEvent(client, tenantId, event, topic, payload, { ...opts, emittedBy: `plugin:${pluginId}` });
  });
  const auditLog = requireFacility('auditLog', 'audit.request', baseAudit);
  return { ...kernel, auditLog, requestAudit, emitEvent };
}
