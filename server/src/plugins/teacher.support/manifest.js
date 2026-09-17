// teacher.support — manifest (drop-in contract; registry row + contracts authored by
// migration 032 — 018/024/029 precedent: the plugin factory provisions its own rows via
// numbered migrations; this file mirrors them for the drop-in factory).
// Invariants: concern status transitions are APPEND-ONLY event rows · the anonymous
// safety box never stores reporter identity (door + CHECK; anonymous submissions are
// audited actor-anonymously) · box reads are designated-authority only, never teachers ·
// serious severity pages the principal via per-instance kernel action safety.page.<id>
// · doubt routing is deterministic over timetable data (no AI) · PTM notes are strictly
// teacher-only (RLS pinned to schoolos.user_id). Uniform lifecycle gate on every door.
export default {
  id: 'teacher.support',
  name: 'Teacher Support & Safeguarding',
  version: '1.0.0',
  kernel: '>=1.0.0 <2.0.0',
  class: 'C',
  trust: 'T1',
  description: 'One-tap concerns with append-only status events and coordinator routing (counselor/principal designees), the anonymous student safety box (reporter identity never stored for anonymous reports; serious severity raises the per-instance kernel page safety.page.<boxId> to the principal; designated-authority reads only — never teachers; weekly pattern summary counts classes/categories, never people), deterministic doubt routing over timetable data (no AI) with FAQ promotion, intervention plans with an append-only lifecycle, and PTM slots/bookings with strictly teacher-private notes (RLS-pinned to schoolos.user_id). Comms templates: concern.routed.v1, ptm.invite.v1.',
  permissions: ['students.read', 'users.read', 'events.emit', 'audit.request', 'actions.raise', 'comms.send'],
  events: {
    subscribe: [],
    publish: [
      { type: 'concern.filed', schema: 'v1' },
      { type: 'concern.routed', schema: 'v1' },
      { type: 'concern.closed', schema: 'v1' },
      { type: 'safety.report.filed', schema: 'v1' },
      { type: 'safety.page.raised', schema: 'v1' },
      { type: 'doubt.routed', schema: 'v1' },
      { type: 'doubt.answered', schema: 'v1' },
      { type: 'doubt.faq.promoted', schema: 'v1' },
      { type: 'intervention.status.changed', schema: 'v1' },
      { type: 'ptm.slot.published', schema: 'v1' },
      { type: 'ptm.booked', schema: 'v1' },
    ],
  },
  eventSubscriptions: [],
  slots: ['settings', 'reports'],
  routes: [],
  widgets: [],
  settingsSchema: {
    type: 'object',
    properties: {
      escalate_on_critical: { type: 'boolean', default: true, description: 'Raise the per-instance concern.escalate.<id> kernel action when a concern is critical or safety-category' },
      page_on_serious: { type: 'boolean', default: true, description: 'Raise the per-instance safety.page.<boxId> kernel page to the principal when a safety report is serious' },
    },
  },
  data: { schema: 'teacher.concern(+status_events), safety.box, support.doubt, support.faq, intervention.plan(+events), ptm.slot, ptm.booking, teacher.note (RLS-scoped; notes teacher-only)', core_refs: ['students.id', 'users.id'], retention: { on_uninstall: 'export_then_purge_30d', note: 'safety box follows safeguarding retention norms; export-then-purge on uninstall' }, residency: ['IN'] },
  regions: ['IN'],
  residency: 'IN',
  billing: { model: 'pack', pack: 'operations' },
  dependencies: [],
  defaultEnabled: false,
};
