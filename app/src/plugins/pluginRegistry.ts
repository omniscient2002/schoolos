/* ============================================================
   Plugin registry — first-party manifests.
   Plugin grid shows ONLY server-registered plugins (ruling
   2026-09-06): the server's app.plugins table is the truth of
   record (docs/11 §8); defaultEnabled mirrors rows landing as
   'registered' and real enablement comes from resync.
   ============================================================ */
import type { PluginManifest } from './pluginTypes';

export const KERNEL_VERSION = '1.0.0';

export const FIRST_PARTY_PLUGINS: PluginManifest[] = [
  /* ── Wave 1 rails & primitives (mirror server/src/plugins/<id>/index.js) ──
     Headless by rule (docs/11 §2.3): settings/reports slots only, no routes —
     attention-slot widgets only SURFACE data that already exists on the spines.
     defaultEnabled=false mirrors server registry rows landing as 'registered';
     real enablement always comes from the server's `enabled` flag via resync. */
  {
    id: 'comms.whatsapp',
    name: 'WhatsApp messages',
    version: '1.0.0',
    class: 'B',
    description: 'WhatsApp messages to parents — fee receipts, attendance notes and delay alerts, sent from approved templates only.',
    icon: 'Message',
    kernel: '>=1.0.0 <2.0.0',
    permissions: ['comms.send', 'events.emit', 'audit.request'],
    slots: ['settings', 'reports'],
    eventSubscriptions: ['attendance.marked', 'fee.due', 'transport.delay'],
    defaultEnabled: false,
  },
  {
    id: 'payments.upi',
    name: 'UPI fee collection',
    version: '1.0.0',
    class: 'B',
    description: 'Collect fees with UPI payment links. Parents pay in one tap; the school office confirms the money arrived.',
    icon: 'CreditCard',
    kernel: '>=1.0.0 <2.0.0',
    permissions: ['audit.request', 'events.emit'],
    slots: ['settings', 'reports'],
    defaultEnabled: false,
  },
  {
    id: 'transport.gps',
    name: 'Bus tracking',
    version: '1.0.0',
    class: 'B',
    description: 'Bus GPS tracking + delay alerts. Parents are told automatically when a bus runs 10 minutes late.',
    icon: 'Compass',
    kernel: '>=1.0.0 <2.0.0',
    permissions: ['events.emit', 'actions.raise', 'audit.request'],
    slots: ['settings', 'reports', 'attention'],
    widgets: [{ slot: 'attention', id: 'gps.delay.approvals', title: 'GPS delay approvals open' }],
    defaultEnabled: false,
  },
  {
    id: 'ops.timetable',
    name: 'Class timetable',
    version: '1.0.0',
    class: 'C',
    description: 'Class timetable & substitutions. Set the weekly grid and find a substitute teacher in one click.',
    icon: 'Grid',
    kernel: '>=1.0.0 <2.0.0',
    permissions: ['students.read', 'events.emit', 'audit.request', 'attendance.write'],
    slots: ['settings', 'reports', 'attention'],
    routes: [{ path: '/timetable', label: 'Timetable' }],
    widgets: [{ slot: 'attention', id: 'timetable.substitutions', title: 'Timetable substitutions feed' }],
    defaultEnabled: true,
  },
  {
    id: 'library',
    name: 'Library',
    version: '1.0.0',
    class: 'A',
    description: 'Library books: catalog, issue and return, and overdue reminders. Switch it on and it appears in the menu; switch it off and it disappears.',
    icon: 'Book',
    kernel: '>=1.0.0 <2.0.0',
    permissions: ['students.read', 'events.emit', 'actions.raise', 'audit.request'],
    slots: ['nav', 'route', 'attention'],
    routes: [{ path: '/library', label: 'Library' }],
    widgets: [{ slot: 'attention', id: 'library.overdue', title: 'Overdue library books' }],
    defaultEnabled: true,
  },
  /* library is the proof plugin and ranks LAST on slot surfaces: the docs/10 §6
     ration (max 2 widgets per slot) is consumed by the production rails first */
  /* wave-2 #1 (unit 14): mirrors server/src/plugins/admissions.funnel (runtime v1.1,
     migrations 018+021). Headless primitives plugin — its UI is the /admissions
     funnel board, shown INSTEAD of the demo kanban while the server flag is on
     (server truth wins on enablement; resync strips it when disabled). */
  {
    id: 'admissions.funnel',
    name: 'Admissions funnel',
    version: '1.1.0',
    class: 'C',
    description: 'Track admission enquiries from first call to enrolled. Keeps applicant details private and separate from student records.',
    icon: 'Users',
    kernel: '>=1.0.0 <2.0.0',
    permissions: ['events.emit', 'audit.request'],
    slots: ['settings', 'reports'],
    defaultEnabled: false,
  },
  /* wave-2 #2 (unit 15): mirrors server/src/plugins/ops.visitors (migration 024).
     Invariants: pickup_requires_guardian_otp · no_release_without_verification ·
     otp_vault_kernel_pattern. Its UI is the /visitors gate-pass board (route
     declared below so useKernelNav gates the nav item on the server flag). */
  {
    id: 'ops.visitors',
    name: 'Visitors gate pass',
    version: '1.0.0',
    class: 'C',
    description: 'Visitor gate passes: the front desk prints a badge, and a student only leaves when the guardian confirms with a code. Safety first — release always needs verification.',
    icon: 'Shield',
    kernel: '>=1.0.0 <2.0.0',
    permissions: ['events.emit', 'audit.request'],
    slots: ['settings', 'reports'],
    routes: [{ path: '/visitors', label: 'Visitors' }],
    defaultEnabled: true,
  },
  /* ── build-out wave D mirrors (server plugins, same registry contract) ── */
  {
    id: 'people.admin',
    name: 'People console',
    version: '1.0.0',
    class: 'B',
    description: 'Create staff and parent accounts, suspend or restore access, move students between classes (with history) and import students from a spreadsheet.',
    icon: 'Users',
    kernel: '>=1.0.0 <2.0.0',
    permissions: ['users.write', 'students.write', 'events.emit', 'audit.request'],
    slots: ['settings', 'reports'],
    routes: [{ path: '/people-admin', label: 'People console' }],
    defaultEnabled: true,
  },
  {
    id: 'files.store',
    name: 'Documents',
    version: '1.0.0',
    class: 'B',
    description: 'Upload and safely share school documents — every download is permission-checked and logged.',
    icon: 'File',
    kernel: '>=1.0.0 <2.0.0',
    permissions: ['files.write', 'files.read', 'events.emit', 'audit.request'],
    slots: ['settings'],
    defaultEnabled: true,
  },
  {
    id: 'payments.razorpay',
    name: 'Razorpay fees',
    version: '1.0.0',
    class: 'B',
    description: 'Collect fees online via Razorpay. Payment confirmations flow into the same fee books as cash — the office still confirms the receipt.',
    icon: 'CreditCard',
    kernel: '>=1.0.0 <2.0.0',
    permissions: ['payments.write', 'events.emit', 'audit.request'],
    slots: ['settings', 'reports'],
    defaultEnabled: false,
  },
  {
    /* B4 (independent review of the 078 change): the rails became real registry rows and the reset door now
       requires `rails.email` to be ENABLED — but this client mirror had entries only for sms and whatsapp, so
       the owner's plugin manager could not show or switch the email rail on at all. The fix was reachable
       through the API (which is how it was verified live) and unreachable through the only owner-facing UI,
       i.e. password reset was still 503 for a real school. Mirror, not decoration. */
    id: 'rails.email',
    name: 'Email service',
    version: '1.0.0',
    class: 'B',
    description: 'Password-reset codes and school email, through the connected mail provider. Until one is connected the platform says so instead of pretending a message was sent.',
    icon: 'Mail',
    kernel: '>=1.0.0 <2.0.0',
    permissions: ['comms.send', 'events.emit'],
    slots: ['settings'],
    defaultEnabled: false,
  },
  {
    id: 'rails.sms',
    name: 'SMS service',
    version: '1.0.0',
    class: 'B',
    description: 'Text messages to guardians — absence notes, fee receipts and alerts. Works only when a provider is connected; everything else runs without it.',
    icon: 'Message',
    kernel: '>=1.0.0 <2.0.0',
    permissions: ['comms.send', 'events.emit'],
    slots: ['settings'],
    defaultEnabled: false,
  },
  {
    id: 'rails.whatsapp',
    name: 'WhatsApp service',
    version: '1.0.0',
    class: 'B',
    description: 'WhatsApp messages from approved templates — receipts and alerts, delivered through the connected provider.',
    icon: 'Message',
    kernel: '>=1.0.0 <2.0.0',
    permissions: ['comms.send', 'events.emit'],
    slots: ['settings'],
    defaultEnabled: false,
  },
  /* ── Wave 4/5 mirrors (D-39): headless read-model/engine plugins landed by
     L3 in server/src/plugins/<id>/. settingsSchema rides the manifests (the
     kernel reader serves it) and renders through the L5-5.2 generic settings
     form. money.invoicing is NOT mirrored yet — L1-5.1 has no server
     manifest/catalog row; this registry mirrors only real rows. */
  {
    id: 'ops.bi',
    name: 'Insight Read Models',
    version: '1.0.0',
    class: 'B',
    description: 'School-level insight over real records, aggregates only: attendance percentage by class (windowed, per-student drill for staff), fee aging buckets by term, admissions funnel conversion and stage aging, homework completion by class. Read models are 60s-cached and row-capped (500) — slightly stale, never wrong by more than a minute.',
    icon: 'Insights',
    kernel: '>=1.0.0 <2.0.0',
    permissions: ['students.read', 'fees.read', 'events.emit', 'audit.request'],
    slots: ['reports'],
    defaultEnabled: false,
  },
  {
    id: 'ops.import',
    name: 'Migration Import Engine',
    version: '1.0.0',
    class: 'B',
    description: 'Column-mapping validator, row-level error collection, shadow-load (staged analysis, zero domain writes) and dry-run diff summaries for school-data imports (students, guardians, fees). The engine is importable by the kernel migration doors; commit authority stays with the kernel.',
    icon: 'Database',
    kernel: '>=1.0.0 <2.0.0',
    permissions: ['students.read', 'events.emit', 'audit.request'],
    slots: ['reports'],
    defaultEnabled: false,
  },
  {
    id: 'ops.udise',
    name: 'UDISE+ Export',
    version: '1.0.0',
    class: 'B',
    description: 'Deterministic UDISE+-style statistical export from real school records: on-roll enrollment by class × section × gender bucket, staff by role, infrastructure by category and status. Aggregates only — never names, never PII. The gender split is honest about what the schema records today (a not_recorded bucket) until a students.gender column exists.',
    icon: 'Clipboard',
    kernel: '>=1.0.0 <2.0.0',
    permissions: ['students.read', 'events.emit', 'audit.request'],
    slots: ['settings', 'reports'],
    defaultEnabled: false,
  },
];

export const pluginById = (id: string) => FIRST_PARTY_PLUGINS.find(p => p.id === id);

/* ============================================================
   Built-in capabilities — core, NOT plugins (ruling 2026-09-06).
   Shown on the Plugin Manager as a separate, clearly-labeled
   static section: no enable buttons, no server dependency, no
   class/version governance vocabulary. They must not look like
   plugin cards.
   - transport: retired from the grid — the capability duplicates the
     transport.gps rail (one plugin, one card); the /transport
     screen stays core. P2-12: this once described ids the server
     does NOT register, which read as a bug in the registry.
   - maintenance: core capability, never was a plugin.
   - exams: superseded by the REAL `exams.assessment` plugin (wave 3
     shipped), which is the exam card on this same board — this entry
     is the core capability surface only.
   ============================================================ */
export interface BuiltInCapability { id: string; name: string; description: string; icon: string }

export const BUILT_IN_CAPABILITIES: BuiltInCapability[] = [
  {
    id: 'transport',
    name: 'Transport',
    description: 'Routes, buses, riders, GPS delays. Raises approval-required guardian notices via the kernel action spine (Transport §3.1). GPS ingestion is the transport.gps rail.',
    icon: 'Bus',
  },
  {
    id: 'maintenance',
    name: 'Maintenance & Facilities',
    description: 'Assets, work orders, SLA governance, technician dispatch. SLA breaches escalate through the kernel action spine (Facilities §1.2).',
    icon: 'Wrench',
  },
  {
    id: 'exams',
    name: 'Examinations',
    description: 'Exam mode, halls, invigilation, marks entry primitives. Marks and report cards are served by the exams.assessment add-on above.',
    icon: 'Award',
  },
];
