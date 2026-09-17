/* Plugin catalog seeding for freshly created tenants.
   Ground truth: the full per-tenant registry seeded by the migrations
   (dumped from a migrated schema — 23 rows). Migrations only touched tenants
   existing at migration time; every school created through /onboard/signup
   afterwards got ZERO catalog rows, so the plugin manager had no real
   switches and features sat 'switched off' with no way to turn them on.
   This module seeds the SAME rows at signup. Regenerate whenever a
   migration adds catalog rows. */
import { encryptSettings } from './settings-crypto.js';

const CATALOG = [
  { plugin_id: 'accounting.tally', version: '1.0.0', class: 'B', permissions: ["fees.read", "events.emit", "audit.request"], entitlement: {"plan": "rails", "billing": "usage-metered"} },
  { plugin_id: 'ops.udise', version: '1.0.0', class: 'B', permissions: ["students.read", "events.emit", "audit.request"], entitlement: {"plan": "module", "billing": "included"} },
  { plugin_id: 'ops.import', version: '1.0.0', class: 'B', permissions: ["students.read", "events.emit", "audit.request"], entitlement: {"plan": "module", "billing": "included"} },
  { plugin_id: 'ops.bi', version: '1.0.0', class: 'B', permissions: ["students.read", "fees.read", "events.emit", "audit.request"], entitlement: {"plan": "module", "billing": "included"} },
  { plugin_id: 'admissions.funnel', version: '1.2.1', class: 'C', permissions: ["events.emit", "audit.request"], entitlement: {"plan": "module", "billing": "included"} },
  { plugin_id: 'comms.whatsapp', version: '1.0.0', class: 'B', permissions: ["students.read", "attendance.read", "fees.read", "comms.send", "events.emit", "audit.request"], entitlement: {"plan": "rails", "billing": "usage-metered"} },
  { plugin_id: 'coord.view', version: '1.0.0', class: 'C', permissions: ["users.read", "students.read", "events.emit", "audit.request"], entitlement: {} },
  { plugin_id: 'exams.assessment', version: '1.0.1', class: 'D', permissions: ["students.read", "attendance.read", "events.emit", "audit.request"], entitlement: {"plan": "pack", "billing": "seat-based"} },
  { plugin_id: 'family.view', version: '1.0.0', class: 'C', permissions: ["students.read", "events.emit", "audit.request"], entitlement: {} },
  { plugin_id: 'files.store', version: '1.0.0', class: 'B', permissions: ["files.write", "students.read", "events.emit", "audit.request"], entitlement: {} },
  { plugin_id: 'health.clinic', version: '1.0.1', class: 'C', permissions: ["students.read", "events.emit", "audit.request"], entitlement: {} },
  { plugin_id: 'hr.leave', version: '1.0.1', class: 'C', permissions: ["users.read", "events.emit", "audit.request"], entitlement: {} },
  { plugin_id: 'library', version: '1.0.0', class: 'C', permissions: ["students.read", "events.emit", "audit.request"], entitlement: {} },
  { plugin_id: 'ops.timetable', version: '1.0.0', class: 'C', permissions: ["students.read", "attendance.write", "events.emit", "audit.request"], entitlement: {"plan": "operations", "billing": "pack"} },
  { plugin_id: 'ops.visitors', version: '1.0.2', class: 'C', permissions: [], entitlement: {} },
  { plugin_id: 'pack.cbse', version: '1.0.0', class: 'C', permissions: ["students.read", "attendance.read", "memory.write", "audit.request"], entitlement: {"plan": "compliance-pack", "billing": "per-board-year"} },
  { plugin_id: 'pack.dpdp', version: '1.1.1', class: 'C', permissions: ["students.read", "actions.raise", "memory.write", "audit.request"], entitlement: {"plan": "compliance-pack", "billing": "per-board-year"} },
  { plugin_id: 'parent.assistant', version: '1.0.0', class: 'C', permissions: ["students.read", "events.emit", "audit.request"], entitlement: {} },
  { plugin_id: 'payments.razorpay', version: '1.0.0', class: 'B', permissions: ["fees.read", "events.emit", "audit.request"], entitlement: {"plan": "rails", "billing": "usage-metered"} },
  { plugin_id: 'payments.upi', version: '1.0.0', class: 'B', permissions: ["fees.read", "events.emit", "actions.raise", "audit.request"], entitlement: {"plan": "rails", "billing": "usage-metered"} },
  // PRD-4/PLG-3: the three credential rails were the ONLY shipped plugins missing from this catalog, so
  // they had no per-tenant registry row at all: the plugin manager could not show them, nobody could
  // configure them, and `/me/reset-request`'s channel gate ("no email rail configured → 503") could never
  // pass for ANY tenant — password reset was permanently 503 by construction. They stay OFF (`registered`,
  // not in DEFAULT_ON): a rail is a credential, so switching it on stays an audited owner action, exactly
  // as the note above requires.
  { plugin_id: 'rails.email', version: '1.0.0', class: 'B', permissions: ["comms.send", "events.emit", "audit.request"], entitlement: {"plan": "rails", "billing": "usage-metered"} },
  { plugin_id: 'rails.sms', version: '1.0.0', class: 'B', permissions: ["comms.send", "events.emit", "audit.request"], entitlement: {"plan": "rails", "billing": "usage-metered"} },
  { plugin_id: 'rails.whatsapp', version: '1.0.0', class: 'B', permissions: ["comms.send", "events.emit", "audit.request"], entitlement: {"plan": "rails", "billing": "usage-metered"} },
  { plugin_id: 'people.admin', version: '1.0.0', class: 'B', permissions: ["users.write", "students.write", "events.emit", "audit.request"], entitlement: {} },
  { plugin_id: 'student.world', version: '1.0.0', class: 'C', permissions: ["students.read", "events.emit", "audit.request"], entitlement: {} },
  { plugin_id: 'teacher.classroom', version: '1.0.0', class: 'C', permissions: ["students.read", "events.emit", "audit.request"], entitlement: {} },
  { plugin_id: 'teacher.copilot', version: '0.1.0', class: 'C', permissions: ["students.read", "users.read", "audit.request"], entitlement: {} },
  { plugin_id: 'teacher.support', version: '1.0.0', class: 'C', permissions: ["students.read", "users.read", "events.emit", "audit.request"], entitlement: {} },
  { plugin_id: 'transport.gps', version: '1.0.0', class: 'B', permissions: ["students.read", "events.emit", "audit.request"], entitlement: {"plan": "rails", "billing": "usage-metered"} },
];

/* Core school-operation modules are ON at birth: a new owner must be able to
   create staff, run the visitor desk, the library, the timetable and store
   files on day one — 'switched off with no switch' must never block a school's
   first hour. Credential rails (WhatsApp/SMS/UPI/Razorpay) stay OFF until the
   owner configures them — enabling stays an audited owner action (docs/12). */
const DEFAULT_ON = new Set(['people.admin', 'ops.visitors', 'library', 'ops.timetable', 'files.store']);

/* PLG-4 (found by independent review of the 078 change): every row this module inserted carried
   `{"id":...,"version":...}` as its manifest, so the plugin manager had NO settings schema to render — its
   settings form reads the schema out of `app.plugins.manifest` and answered "Nothing to configure" for every
   tenant provisioned by signup or the GET /plugins self-heal, and for the three credential rails in every
   tenant. The real manifest lives next to the plugin (`src/plugins/<id>/manifest.js`, the same file the
   loader mounts), so this reads it instead of inventing a stub. A plugin without a manifest module keeps the
   stub rather than failing the seed. */
async function manifestFor(pluginId, version) {
  try {
    const mod = await import(`./plugins/${pluginId}/manifest.js`);
    const m = mod.default ?? mod.manifest;
    if (m && typeof m === 'object') return m;
  } catch { /* no manifest module for this plugin — fall through to the stub */ }
  return { id: pluginId, version };
}

/* Seeds the catalog for ONE tenant. Idempotent — safe on every signup and
   from the self-heal in GET /plugins. */
async function ensurePluginCatalog(client, tenantId) {
  for (const p of CATALOG) {
    const status = DEFAULT_ON.has(p.plugin_id) ? 'enabled' : 'registered';
    const manifest = await manifestFor(p.plugin_id, p.version);
    await client.query(
      `INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, manifest, permissions, entitlement, trust_level, event_budget, ai_budget, enabled_at)
       SELECT $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, 'T1',
         '{"events_per_min":60,"payload_max_bytes":65536,"subscriber_max":25,"fanout_max":50,"chain_depth_max":5,"replay_max":10000,"scheduled_per_day":1000}'::jsonb,
         '{"calls":200,"tokens_per_day":200000}'::jsonb,
         CASE WHEN $5 = 'enabled' THEN now() ELSE NULL END
       WHERE NOT EXISTS (SELECT 1 FROM app.plugins WHERE tenant_id = $1 AND plugin_id = $2)`,
      [tenantId, p.plugin_id, p.version, p.class, status, JSON.stringify(manifest), JSON.stringify(p.permissions), JSON.stringify(p.entitlement)]);
  }

  /* PLG-1 reconcile — the row's grant must be the manifest's declaration. Without this, the new gate would refuse
     every door of a plugin whose stored row predates its declaration (the seven manifests that declared nothing
     until today), i.e. the enforcement would fight a stale cache instead of a real grant. Idempotent, and it
     writes nothing when the sets already agree. */
  const { declaredPermissions, grantedFor } = await import('./plugin-permissions.js');
  const rows = (await client.query(`SELECT plugin_id, permissions FROM app.plugins WHERE tenant_id=$1`, [tenantId])).rows;

  /* SEC-6 manifest reconcile — the row's `settingsSchema` must be the MODULE's declaration, not whatever the
   * DDL happened to write.
   *
   * The INSERT above is guarded by `WHERE NOT EXISTS`, so it only ever writes a manifest when it CREATES the
   * row. But the seeded world already has the row: `scripts/seed.js` replays the migration SQL, each
   * plugin's own migration creates the registry row with an INLINE manifest (`018_admissions_funnel.sql`
   * does exactly this), and only THEN does seed call this function — which therefore finds the row present
   * and skips it. The DDL's manifest survives and the module's file manifest is never applied. Measured on a
   * freshly seeded database: `admissions.funnel`'s stored `cycle_start` pattern was 15 characters
   * (over-escaped, matching a literal backslash then `d`) while the file on disk declares the correct
   * 13-character form.
   *
   * That is why SEC-6 needed BOTH halves. Validation on the settings door reads the schema out of
   * `app.plugins.manifest`, so enforcement was reading a stale copy of the declaration while the module's
   * real declaration sat unread on disk.
   *
   * SCOPE, deliberately narrow: only the `settingsSchema` SUBTREE is reconciled, and only for plugins whose
   * file manifest declares one. Rewriting the whole manifest would be a much larger change — six plugins
   * (`payments.razorpay`, `payments.upi`, `comms.whatsapp`, `accounting.tally`, `transport.gps`,
   * `ops.timetable`) have a stored `settingsSchema` that their file manifest does NOT declare, so a whole-
   * manifest overwrite would silently delete six working settings schemas. Reconciling the subtree keeps
   * every other field of the stored manifest intact and writes nothing when the two already agree.
   *
   * `merged` is what lands: the stored manifest with only the schema key replaced. */
  const schemaRows = (await client.query(`SELECT plugin_id, manifest, settings FROM app.plugins WHERE tenant_id=$1`, [tenantId])).rows;
  for (const row of schemaRows) {
    // SEC-23 migration path: catalog reconciliation already visits every
    // tenant/plugin row. Encrypt legacy plaintext secret fields here so old
    // rows converge at the next normal catalog access without overwriting
    // untouched settings or rotating existing envelopes.
    const encryptedSettings = encryptSettings(row.settings ?? {}, tenantId);
    if (JSON.stringify(encryptedSettings) !== JSON.stringify(row.settings ?? {})) {
      await client.query(
        `UPDATE app.plugins SET settings=$3::jsonb, updated_at=now() WHERE tenant_id=$1 AND plugin_id=$2`,
        [tenantId, row.plugin_id, JSON.stringify(encryptedSettings)]);
    }
    const fileManifest = await manifestFor(row.plugin_id, null);
    const wantSchema = fileManifest?.settingsSchema ?? fileManifest?.settings_schema ?? null;
    const have = row.manifest?.settingsSchema ?? row.manifest?.settings_schema ?? null;
    const wantCapabilities = Array.isArray(fileManifest?.capabilities) ? fileManifest.capabilities : null;
    const haveCapabilities = row.manifest?.capabilities ?? null;
    const schemaChanged = wantSchema !== null && JSON.stringify(have) !== JSON.stringify(wantSchema);
    const capabilitiesChanged = wantCapabilities !== null && JSON.stringify(haveCapabilities) !== JSON.stringify(wantCapabilities);
    if (schemaChanged || capabilitiesChanged) {
      await client.query(
        `UPDATE app.plugins SET manifest=$3::jsonb, updated_at=now() WHERE tenant_id=$1 AND plugin_id=$2`,
        [tenantId, row.plugin_id, JSON.stringify({ ...(row.manifest ?? {}), ...(schemaChanged ? { settingsSchema: wantSchema } : {}), ...(capabilitiesChanged ? { capabilities: wantCapabilities } : {}) })]);
    }
  }
  for (const row of rows) {
    const declared = await declaredPermissions(row.plugin_id);
    if (declared === null) continue;                       // no manifest on disk — leave the row as it is
    const want = grantedFor(row.plugin_id, declared, row.permissions);
    const have = Array.isArray(row.permissions) ? row.permissions : [];
    if ([...want].sort().join('\u0000') !== [...have].sort().join('\u0000')) {
      await client.query(
        `UPDATE app.plugins SET permissions=$3::jsonb, updated_at=now() WHERE tenant_id=$1 AND plugin_id=$2`,
        [tenantId, row.plugin_id, JSON.stringify(want)]);
    }
  }
}

export { CATALOG, DEFAULT_ON, ensurePluginCatalog };
