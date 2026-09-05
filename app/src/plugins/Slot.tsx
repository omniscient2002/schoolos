/* ============================================================
   Slot — the only way a plugin appears on a kernel surface.
   Widgets register by `${pluginId}:${slotName}`; the kernel
   renders them only while the plugin is enabled.
   ============================================================ */
import type { ReactNode } from 'react';
import { useKernel } from './useKernel';

type Widget = () => ReactNode;
const WIDGETS = new Map<string, Widget>();

/** docs/10 §6: a slot admits at most 2 plugin widgets — the kernel stays the
 * loudest voice; plugins earn rank, not space. Enforced here so the documented
 * ration is a real invariant, not prose. */
export const MAX_WIDGETS_PER_SLOT = 2;

export function registerWidget(pluginId: string, widgetId: string, fn: Widget) {
  WIDGETS.set(`${pluginId}:${widgetId}`, fn);
}

export function Slot({ name, empty }: { name: 'attention' | 'today' | 'dashboard'; empty?: ReactNode }) {
  const { all, isEnabled } = useKernel();
  const parts: ReactNode[] = [];
  for (const m of all) {
    if (!isEnabled(m.id)) continue;
    for (const w of m.widgets ?? []) {
      if (w.slot !== name) continue;
      const W = WIDGETS.get(`${m.id}:${w.id}`);
      if (W) parts.push(<W key={`${m.id}:${w.id}`} />);
    }
  }
  if (parts.length === 0) return empty ?? null;
  if (parts.length > MAX_WIDGETS_PER_SLOT) parts.length = MAX_WIDGETS_PER_SLOT;
  return <>{parts}</>;
}
