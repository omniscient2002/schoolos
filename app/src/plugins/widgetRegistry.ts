/* Leaf module (no imports): the widget map lives here so it is initialized before any importer can run.
 *
 * The FEX-9 screen-load smoke test exposed a real circular-evaluation trap: `Slot` imported `useKernel`,
 * which imported `App`, which imported `registerWidgets`, which imported `Slot` again — so on some entry
 * orders `registerWidget()` ran while `Slot`'s own `const WIDGETS` was still in the temporal dead zone
 * ("Cannot access 'WIDGETS' before initialization"). A module with no imports cannot be in a cycle, so the
 * map is always ready when `registerWidget` is called. */
import type { ReactNode } from 'react';

export const WIDGETS = new Map<string, () => ReactNode>();
