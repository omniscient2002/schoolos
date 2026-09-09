/* ============================================================
   Plugin types — the contract between kernel and modules.
   See docs/10-plugin-architecture.md
   ============================================================ */
import type { RoleId } from '../types/domain';

export type PluginClass = 'A' | 'B' | 'C' | 'D' | 'E';

export type PluginPermission =
  | 'students.read' | 'attendance.read' | 'attendance.write'
  | 'fees.read' | 'fees.write' | 'audit.request' | 'events.emit'
  | 'actions.raise' | 'comms.send' | 'memory.write'
  | 'students.write' | 'users.write' | 'files.read' | 'files.write' | 'payments.write';

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
  A: { label: 'Keeps records', detail: 'Stores its own information and adds screens or reports' },
  B: { label: 'Runs a process', detail: 'Handles approvals and step-by-step workflows' },
  C: { label: 'Provides building blocks', detail: 'Other features use what it produces' },
  D: { label: 'Automates', detail: 'Sends messages and reacts to events' },
  E: { label: 'Connects outward', detail: 'Works with outside software, with tight limits' },
};

export const PERMISSION_INFO: Record<PluginPermission, string> = {
  'students.read': 'Read student records (scoped)',
  'attendance.read': 'Read attendance registers',
  'attendance.write': 'Mark or amend attendance',
  'fees.read': 'Read fee obligations',
  'fees.write': 'Change money records — rarely allowed',
  'audit.request': 'Write to the school activity log',
  'events.emit': 'Tell other features when something happens',
  'actions.raise': 'Ask a person to approve something',
  'comms.send': 'Send messages to parents and staff (with delivery receipts)',
  'memory.write': 'Save notes to the AI memory',
  'students.write': 'Change student records',
  'users.write': 'Create and manage staff/parent accounts',
  'files.read': 'Read stored documents',
  'files.write': 'Upload documents',
  'payments.write': 'Create and track online payments',
};
