// library — manifest (drop-in contract; the registry row + capability contract are authored by
// migrations 047/108). The plugin is OPT-IN (defaultEnabled:false) and its desk is staffed by the
// dedicated `librarian` role (docs/LIBRARY-DESIGN.md): owner/principal enable + configure and see the
// aggregate ops overview; borrowers (students + every non-parent staff role) search, reserve and request.
// Invariants: availability_derived_from_copies · one_open_loan_per_copy · one_borrower_identity ·
// holds_fifo · fine_computed_once_at_return · no_delete_for_app_role · lifecycle_gate_on_every_door.
export default {
  id: 'library',
  version: '2.0.0',
  class: 'C',
  defaultEnabled: false,
  /* PLG-1: the facilities this module actually calls, and nothing it does not. */
  permissions: ['students.read', 'users.read', 'events.emit', 'audit.request'],
  description: 'The school library management system: catalog with per-copy tracking and tenant-configurable identifiers, issue/return/renew, reservations (holds) with a FIFO queue, a fines ledger, and purchase requests. Staffed by the dedicated librarian role; owner/principal see an aggregate operations dashboard; students and all non-parent staff borrow.',
  /* E3: the events the module actually emits (declared so the conformance/event checks can see them). */
  events: {
    subscribe: [],
    publish: [
      'library.book.added.v1', 'library.book.updated.v1', 'library.book.retired.v1', 'library.catalog.imported.v1',
      'library.copy.added.v1', 'library.copy.status.v1',
      'library.loan.issued.v1', 'library.loan.returned.v1', 'library.loan.renewed.v1', 'library.loan.lost.v1',
      'library.reservation.created.v1', 'library.reservation.ready.v1',
      'library.fine.settled.v1',
      'library.acquisition.requested.v1', 'library.acquisition.voted.v1', 'library.acquisition.decided.v1',
    ],
  },
  policyRefs: ['Library desk norms', 'Platform §2.4'],
  settingsSchema: {
    type: 'object',
    properties: {
      identifier_scheme: { type: 'string', enum: ['accession', 'barcode', 'isbn', 'qr', 'custom'], default: 'accession', description: 'How copies are labelled in this school' },
      identifier_prefix: { type: 'string', maxLength: 12, default: 'LIB', description: 'Prefix for generated copy codes' },
      accession_start: { type: 'integer', minimum: 1, maximum: 1000000, default: 1 },
      accession_padding: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
      custom_identifier_label: { type: 'string', maxLength: 40, default: 'Accession No' },
      barcode_symbology: { type: 'string', enum: ['code128', 'code39', 'ean13'], default: 'code128' },
      scan_accepts: { type: 'array', items: { type: 'string' }, default: ['copy_code', 'barcode', 'isbn', 'accession'] },
      default_loan_days: { type: 'integer', minimum: 1, maximum: 365, default: 14 },
      loan_days_student: { type: 'integer', minimum: 1, maximum: 365, default: 14 },
      loan_days_teacher: { type: 'integer', minimum: 1, maximum: 365, default: 21 },
      loan_days_staff: { type: 'integer', minimum: 1, maximum: 365, default: 21 },
      max_loans_student: { type: 'integer', minimum: 0, maximum: 50, default: 2 },
      max_loans_teacher: { type: 'integer', minimum: 0, maximum: 50, default: 5 },
      max_loans_staff: { type: 'integer', minimum: 0, maximum: 50, default: 5 },
      renewal_limit: { type: 'integer', minimum: 0, maximum: 10, default: 1 },
      renewal_days: { type: 'integer', minimum: 1, maximum: 90, default: 7 },
      allow_self_reserve: { type: 'boolean', default: true },
      max_reservations: { type: 'integer', minimum: 0, maximum: 20, default: 3 },
      reservation_hold_days: { type: 'integer', minimum: 1, maximum: 30, default: 2 },
      allow_acquisition_requests: { type: 'boolean', default: true },
      acquisition_votes: { type: 'boolean', default: true },
      max_open_acquisition_requests: { type: 'integer', minimum: 0, maximum: 50, default: 5 },
      grace_days: { type: 'integer', minimum: 0, maximum: 60, default: 0 },
      fine_per_day_cents: { type: 'integer', minimum: 0, maximum: 100000, default: 500, description: 'Overdue fine per day, in paise (₹1 = 100 paise)' },
      fine_cap_cents: { type: 'integer', minimum: 0, maximum: 10000000, default: 20000 },
      lost_charge_percent: { type: 'integer', minimum: 0, maximum: 500, default: 100 },
      damage_charge_cents: { type: 'integer', minimum: 0, maximum: 10000000, default: 0 },
      allow_fine_waiver: { type: 'boolean', default: true },
      notify_channels: { type: 'array', items: { type: 'string' }, default: ['in_app'] },
      notify_parent: { type: 'boolean', default: true },
      due_reminder_days_before: { type: 'array', items: { type: 'integer' }, default: [2, 1] },
      overdue_repeat_days: { type: 'integer', minimum: 1, maximum: 90, default: 7 },
      quiet_hours_ist: { type: 'array', items: { type: 'integer' }, default: [21, 8] },
    },
  },
  invariants: [
    'availability_derived_from_copies',
    'one_open_loan_per_copy',
    'one_borrower_identity',
    'holds_fifo',
    'fine_computed_once_at_return',
    'no_delete_for_app_role',
  ],
  dependencies: [],
};
