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
];

export const pluginById = (id: string) => FIRST_PARTY_PLUGINS.find(p => p.id === id);
