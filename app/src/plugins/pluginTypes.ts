/* ============================================================
   Plugin types — the contract between kernel and modules.
   See docs/10-plugin-architecture.md
   ============================================================ */
import type { RoleId } from '../types/domain';

export type PluginClass = 'A' | 'B' | 'C' | 'D' | 'E';

export type PluginPermission =
  | 'students.read' | 'attendance.read' | 'attendance.write'
  | 'fees.read' | 'fees.write' | 'audit.request' | 'events.emit'
  | 'actions.raise' | 'comms.send' | 'memory.write';

export type SlotId = 'nav' | 'route' | 'dashboard' | 'attention' | 'today' | 'student-record' | 'settings' | 'reports';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  class: PluginClass;
  description: string;
  icon: string;
  kernel: string;
  permissions: PluginPermission[];
  slots: SlotId[];
  routes?: { path: string; label: string }[];
  widgets?: { slot: 'attention' | 'today' | 'dashboard'; id: string; title: string }[];
  eventSubscriptions?: string[];
  dependsOn?: string[];
  defaultEnabled: boolean;
  roles?: RoleId[];
}

export const CLASS_INFO: Record<PluginClass, { label: string; detail: string }> = {
  A: { label: 'Record', detail: 'Owns its data; contributes screens & reports' },
  B: { label: 'Process', detail: 'Uses kernel workflow + approval spine' },
  C: { label: 'Primitives', detail: 'Outputs other modules consume' },
  D: { label: 'Automation', detail: 'Channels & triggers on kernel events' },
  E: { label: 'Extension', detail: 'Out-of-process, restricted API, signed' },
};

export const PERMISSION_INFO: Record<PluginPermission, string> = {
  'students.read': 'Read student records (scoped)',
  'attendance.read': 'Read attendance registers',
  'attendance.write': 'Mark or amend attendance',
  'fees.read': 'Read fee obligations',
  'fees.write': 'Change money records — rarely granted',
  'audit.request': 'Ask the kernel to record an audit entry',
  'events.emit': 'Publish events on the kernel bus',
  'actions.raise': 'Raise approval-required actions',
  'comms.send': 'Send via Communication Orchestrator (dedup + receipts)',
  'memory.write': 'Write institutional memory entries',
};
