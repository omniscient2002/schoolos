// ops.import — migration import ENGINE (headless, class B, read-only by charter).
// Owns the column-mapping truth, row-level validation, shadow-load mode and the
// dry-run diff summary. The COMMIT path (writing app.students / app.guardians /
// app.fee_obligations) belongs to the kernel migration section (L1-4.1, routes.js) —
// this plugin never writes domain rows; its doors are pure validation/preview.
export default {
  id: 'ops.import',
  name: 'Migration Import Engine',
  version: '1.0.0',
  class: 'B',
  trust: 'T1',
  description: 'Column-mapping validator, row-level error collection, shadow-load (staged analysis, zero domain writes) and dry-run diff summaries for school-data imports (students, guardians, fees). The engine is importable by the kernel migration doors; commit authority stays with the kernel.',
  permissions: ['students.read', 'events.emit', 'audit.request'],
  events: { subscribe: [], publish: ['ops.import.shadow.completed'] },
  slots: ['reports'],
  routes: [],
  widgets: [],
  settingsSchema: { type: 'object', properties: { max_shadow_rows: { type: 'integer', minimum: 100, maximum: 20000, default: 5000, description: 'Cap on rows analyzed per shadow run' } } },
  data: { schema: 'stateless (no plugin tables; shadow mode writes nothing)', core_refs: ['students.id', 'fee_obligations.id'], retention: { on_uninstall: 'nothing-stored' }, residency: ['IN'] },
  regions: ['IN'],
  residency: 'IN',
  billing: { model: 'pack', pack: 'operations' },
  dependencies: [],
  policy_refs: ['Migration §1.1 (staged before committed)', 'Platform §5.2 (artifacts)'],
};
