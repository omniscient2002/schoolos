// parent.assistant — manifest (registry row + contracts authored by migration 035;
// 018/024/029/033/034 precedent: the plugin factory provisions its own rows via numbered
// migrations; this file mirrors them for the drop-in factory).
// Invariants: guardians read ONLY their linked children (family.child_link; cross-guardian
// 403) · DETERMINISTIC-ONLY: no LLM is contacted anywhere — the brief is a factual
// aggregation, ask composes from authorized own-child records by keyword routing, drafts
// are labelled ai_draft templates the parent edits before sending · every line carries
// evidence numbers; the words failing/disengaged/risk/at-risk/weak never appear in output ·
// unknown topics are answered honestly and point to the class teacher · every ask/draft
// call writes a parent.copilot_call row (P-copilot budget, 100 per calendar month → 429) ·
// the teacher role is refused on every door.
export default {
  id: 'parent.assistant',
  name: 'Parent Assistant',
  version: '1.0.0',
  kernel: '>=1.0.0 <2.0.0',
  class: 'C',
  trust: 'T1',
  description: 'The parent assistant: morning/evening/week brief per child (attendance today, homework due in the next 24h when the homework lane is connected, pending consents, exams announced in the last 7 days, open requests, weekly attendance share and published reports), a keyword ask that answers ONLY from the family\'s own records with sources, labelled template drafts (question to teacher, leave note) that the parent edits before sending, and plain-language explains built from real numbers. Deterministic-only: no LLM is contacted anywhere; unknown topics get an honest no and point to the class teacher; every ask/draft call writes a parent.copilot_call budget row (P-copilot, 100 per calendar month). Guardian scoping via family.child_link; cross-guardian access refused; teachers refused on every door.',
  permissions: ['students.read', 'events.emit', 'audit.request'],
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
        default: 'v0 is deterministic-only: no LLM calls; answers are composed from the family\'s own records, unknowns are said honestly',
        description: 'Scope note for the AI governance slot',
      },
    },
  },
  data: {
    schema: 'parent.copilot_call, parent.brief_log (all RLS-scoped); reads family.child_link, family.request, family.consent, app.attendance, app.fee_obligations, teacher.homework (probed), plugin_exams.* (probed)',
    core_refs: ['students.id', 'users.id'],
    retention: { on_uninstall: 'export_then_purge_30d' },
    residency: ['IN'],
  },
  regions: ['IN'],
  residency: 'IN',
  billing: { model: 'pack', pack: 'family' },
  dependencies: [],
  defaultEnabled: false,
};
