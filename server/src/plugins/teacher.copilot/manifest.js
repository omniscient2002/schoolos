// teacher.copilot — manifest (drop-in contract; registry row + contracts authored by
// migration 033 — 018/020/029 precedent: the plugin factory provisions its own rows
// via numbered migrations; this file mirrors them for the drop-in factory).
// V0 invariants: deterministic-only (NO external LLM anywhere — drafts are labelled
// templates, ask is keyword routing over authorized data) · every call writes a
// copilot.call budget row (A2) · curriculum is seeded, never teacher-typed (A1) ·
// mastery labels decay one step on expired evidence (A3, needs-support-never-failing).
export default {
  id: 'teacher.copilot',
  name: 'Teaching Copilot',
  version: '0.1.0',
  kernel: '>=1.0.0 <2.0.0',
  class: 'C',
  trust: 'T1',
  description: 'Teacher day brief (eod/week), curriculum tree with audited coverage check-off, mastery maps with A3 evidence decay, and Copilot ask/draft. V0 is deterministic-only: no external AI model is contacted anywhere — drafts are clearly labelled templates built from curriculum/mastery data and ask routes questions to authorized data by keyword. Every call writes a copilot.call budget row (A2). Curriculum is seeded, never teacher-typed (A1); mastery labels decay one step when evidence expires, language is "needs support", never "failing" (A3).',
  permissions: ['students.read', 'users.read', 'audit.request'],
  events: { subscribe: [], publish: [] },
  eventSubscriptions: [],
  slots: ['settings', 'reports'],
  routes: [],
  widgets: [],
  settingsSchema: {
    type: 'object',
    properties: {
      deterministic_v0: {
        type: 'string',
        default: 'v0 is deterministic-only: no LLM calls, no tokens; copilot.call.tokens_in/out stay 0 until a governed model is wired (v1)',
        description: 'Scope note for the AI governance slot',
      },
    },
  },
  data: {
    schema: 'curriculum.node, curriculum.progress, mastery.evidence, mastery.state, copilot.call (all RLS-scoped)',
    core_refs: ['students.id', 'users.id'],
    retention: { on_uninstall: 'export_then_purge_30d' },
    residency: ['IN'],
  },
  regions: ['IN'],
  residency: 'IN',
  billing: { model: 'pack', pack: 'teaching' },
  dependencies: [],
  defaultEnabled: false,
};
