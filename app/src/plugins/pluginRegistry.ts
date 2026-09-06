/* ============================================================
   Plugin registry — first-party manifests.
   The kernel treats these exactly like third-party modules;
   they ship enabled because Indian schools expect them.
   ============================================================ */
import type { PluginManifest } from './pluginTypes';

export const KERNEL_VERSION = '1.0.0';

export const FIRST_PARTY_PLUGINS: PluginManifest[] = [
  {
    id: 'transport',
    name: 'Transport',
    version: '1.4.0',
    class: 'B',
    description: 'Routes, buses, riders, GPS delays. Raises approval-required guardian notices via the kernel action spine (Transport §3.1).',
    icon: 'Bus',
    kernel: '>=1.0.0 <2.0.0',
    permissions: ['students.read', 'events.emit', 'actions.raise', 'comms.send', 'audit.request'],
    slots: ['nav', 'route', 'attention'],
    routes: [{ path: '/transport', label: 'Transport' }],
    widgets: [{ slot: 'attention', id: 'transport.delay', title: 'Bus delays in the last 24h' }],
    eventSubscriptions: [],
    defaultEnabled: true,
  },
  {
    id: 'maintenance',
    name: 'Maintenance & Facilities',
    version: '2.1.0',
    class: 'B',
    description: 'Assets, work orders, SLA governance, technician dispatch. SLA breaches escalate through the kernel action spine (Facilities §1.2).',
    icon: 'Wrench',
    kernel: '>=1.0.0 <2.0.0',
    permissions: ['students.read', 'events.emit', 'actions.raise', 'comms.send', 'memory.write', 'audit.request'],
    slots: ['nav', 'route', 'attention', 'today'],
    routes: [{ path: '/maintenance', label: 'Maintenance' }],
    widgets: [{ slot: 'attention', id: 'maintenance.sla', title: 'SLA clocks closing' }],
    defaultEnabled: true,
  },
  {
    id: 'library',
    name: 'Library',
    version: '1.0.0',
    class: 'A',
    description: 'Catalog, issue/return, overdue tracking. A proof plugin: lives entirely behind the manifest — enable it and nav, routes and the attention slot light up; disable it and it vanishes.',
    icon: 'Book',
    kernel: '>=1.0.0 <2.0.0',
    permissions: ['students.read', 'events.emit', 'actions.raise', 'audit.request'],
    slots: ['nav', 'route', 'attention'],
    routes: [{ path: '/library', label: 'Library' }],
    widgets: [{ slot: 'attention', id: 'library.overdue', title: 'Overdue library books' }],
    defaultEnabled: false,
  },
  {
    id: 'exams',
    name: 'Examinations',
    version: '0.9.0',
    class: 'C',
    description: 'Exam mode, halls, invigilation, marks entry primitives. Planned: marks feed the Learning primitives.',
    icon: 'Award',
    kernel: '>=1.0.0 <2.0.0',
    permissions: ['students.read', 'events.emit', 'audit.request'],
    slots: ['nav', 'route'],
    routes: [{ path: '/exams', label: 'Exams' }],
    defaultEnabled: false,
  },
  /* ── Wave 1 rails & primitives (mirror server/src/plugins/<id>/index.js) ──
     Headless by rule (docs/11 §2.3): settings/reports slots only, no routes.
     defaultEnabled=false mirrors server registry rows landing as 'registered';
     real enablement always comes from the server's `enabled` flag via resync. */
  {
    id: 'comms.whatsapp',
    name: 'WhatsApp Business Rails',
    version: '1.0.0',
    class: 'B',
    description: 'WhatsApp BSP adapter beneath the Communication Orchestrator: DLT-registered template registry, digest delivery with UPI pay buttons, receipt surface. Never sends directly — approved orchestrator intents only.',
    icon: 'Message',
    kernel: '>=1.0.0 <2.0.0',
    permissions: ['comms.send', 'events.emit', 'audit.request'],
    slots: ['settings', 'reports'],
    eventSubscriptions: ['attendance.marked', 'fee.due', 'transport.delay'],
    defaultEnabled: false,
  },
  {
    id: 'payments.upi',
    name: 'UPI Collection Rails',
    version: '1.0.0',
    class: 'B',
    description: 'UPI payment links + signed gateway webhook facts. Settlement stays kernel-only — staff confirm on the fees ledger; the rail never moves money.',
    icon: 'CreditCard',
    kernel: '>=1.0.0 <2.0.0',
    permissions: ['audit.request', 'events.emit'],
    slots: ['settings', 'reports'],
    defaultEnabled: false,
  },
  {
    id: 'transport.gps',
    name: 'Transport GPS Rail',
    version: '1.0.0',
    class: 'B',
    description: 'Vendor GPS position ingestion with a deterministic guardian-notice guard: delay ≥ 10 min raises an approval-required action (Transport §3.1). Positions retained 30 days.',
    icon: 'Compass',
    kernel: '>=1.0.0 <2.0.0',
    permissions: ['events.emit', 'actions.raise', 'audit.request'],
    slots: ['settings', 'reports'],
    defaultEnabled: false,
  },
  {
    id: 'ops.timetable',
    name: 'Timetable Primitives',
    version: '1.0.0',
    class: 'C',
    description: 'Period grid, class-section slots, deterministic substitution suggestions, and attendance period-autofill primitives consumed by attendance, exams and comms.',
    icon: 'Grid',
    kernel: '>=1.0.0 <2.0.0',
    permissions: ['events.emit', 'audit.request', 'attendance.write'],
    slots: ['settings', 'reports'],
    defaultEnabled: false,
  },
];

export const pluginById = (id: string) => FIRST_PARTY_PLUGINS.find(p => p.id === id);
