// FEX-9 — the app had one 2-case test for ~44.5k LOC. This is the cheap half of route coverage: every
// screen module is imported in a jsdom environment and must load and export a component. It catches the
// white-page class of defect (an import-time throw or a module that exports nothing renderable) across the
// whole screen tree, which no single behavioural test could. Rendering each route with its data is the
// next step; this pins that the modules are loadable at all.
import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const modules = (import.meta as any).glob('../screens/**/*.tsx', { eager: false }) as Record<string, () => Promise<Record<string, unknown>>>;

describe('FEX-9 · every screen module loads', () => {
  it('the glob discovers the screen tree', () => {
    const paths = Object.keys(modules);
    expect(paths.length).toBeGreaterThan(80);
  });

  it('each screen module imports and exports a component', async () => {
    // Mirror the real entry order: the app always evaluates App (and the plugin/widget graph) before any
    // screen is reached. Importing a screen first would enter the same graph through a cycle and report a
    // bundler artifact rather than a product defect.
    await import('../App');
    const paths = Object.keys(modules).filter((p) => !p.includes('.test.'));
    const failures: string[] = [];
    for (const p of paths) {
      try {
        const mod = await modules[p]();
        const isComponent = Object.values(mod).some(
          (v) => typeof v === 'function'
            || (v != null && typeof v === 'object' && '$$typeof' in (v as Record<string, unknown>)),
        );
        if (!isComponent) failures.push(`${p} exports no component`);
      } catch (e) {
        failures.push(`${p} threw on import: ${String(e)}`);
      }
    }
    expect(failures).toEqual([]);
  }, 120000);
});
