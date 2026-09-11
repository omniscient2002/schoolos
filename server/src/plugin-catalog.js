/* Plugin catalog seeding for freshly created tenants.
   Ground truth: the full per-tenant registry seeded by the migrations
   (dumped from a migrated schema — 23 rows). Migrations only touched tenants
   existing at migration time; every school created through /onboard/signup
   afterwards got ZERO catalog rows, so the plugin manager had no real
   switches and features sat 'switched off' with no way to turn them on.
   This module seeds the SAME rows at signup. Regenerate whenever a
   migration adds catalog rows. */

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

/* Seeds the catalog for ONE tenant. Idempotent — safe on every signup and
   from the self-heal in GET /plugins. */
async function ensurePluginCatalog(client, tenantId) {
  for (const p of CATALOG) {
    const status = DEFAULT_ON.has(p.plugin_id) ? 'enabled' : 'registered';
    await client.query(
      `INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, manifest, permissions, entitlement, trust_level, event_budget, ai_budget, enabled_at)
       SELECT $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, 'T1',
         '{"events_per_min":60,"payload_max_bytes":65536,"subscriber_max":25,"fanout_max":50,"chain_depth_max":5,"replay_max":10000,"scheduled_per_day":1000}'::jsonb,
         '{"requests_per_day":200,"tokens_per_day":200000}'::jsonb,
         CASE WHEN $5 = 'enabled' THEN now() ELSE NULL END
       WHERE NOT EXISTS (SELECT 1 FROM app.plugins WHERE tenant_id = $1 AND plugin_id = $2)`,
      [tenantId, p.plugin_id, p.version, p.class, status, JSON.stringify({ id: p.plugin_id, version: p.version }), JSON.stringify(p.permissions), JSON.stringify(p.entitlement)]);
  }
}

export { CATALOG, ensurePluginCatalog };
