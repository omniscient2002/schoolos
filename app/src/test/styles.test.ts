/* Stylesheet + design-token guards.
 *
 * These pin a whole CLASS of bug that no component test can see, because the
 * failure mode is "the declaration is silently dropped" rather than a thrown
 * error:
 *
 *   · `var(--line)` where --line was never declared. An undefined custom
 *     property makes the WHOLE declaration invalid at computed-value time, so
 *     `border: 1px solid var(--line)` renders NO border at all. Five screens
 *     shipped that way (RailsBoard, Classes, Onboard, PeopleAdmin, Timetable),
 *     plus `fontFamily: var(--mono)` which rendered no monospace font.
 *   · A selector that over-matches. `.nav-section span` also matched the label
 *     inside every `.nav-item`, so the entire sidebar rendered as 11px
 *     uppercase grey micro-text. `.divider` (a 1px <hr>) collided with the
 *     attention-row modifier and painted entire rows.
 *   · A theme layer that is never imported. contrast.css existed, was named by
 *     the product's own visual brief, and was dead — nothing imported it and
 *     nothing ever set data-contrast.
 *   · An inline style that shadows a responsive class, which no media query can
 *     override without !important.
 *
 * NOTE ON READING SOURCES: `import.meta.glob(..., '?raw')` returns EMPTY
 * STRINGS for .css in this toolchain — Vite routes CSS through its CSS
 * pipeline before `?raw` sees it, so a test written that way passes
 * vacuously. (The existing honesty-gate.test.ts globs .tsx only, which does
 * work.) So sources are read from disk with node:fs.
 */
/// <reference types="node" />
// Node types are pulled in for THIS FILE ONLY. The test runner executes in
// Node and genuinely needs node:fs to read the stylesheets, but the browser
// app must not be able to reach for process/Buffer. A per-file reference keeps
// that boundary instead of widening the app project's types.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(css|tsx|ts)$/.test(e.name)) out.push(p);
  }
  return out;
}

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const files = walk(SRC).map(p => [p.slice(SRC.length + 1), readFileSync(p, 'utf8')] as const);

const isTest = (k: string) => k.includes('.test.');
const css = files.filter(([k]) => k.endsWith('.css'));
const code = files.filter(([k]) => !k.endsWith('.css') && !isTest(k));

const read = (suffix: string) => {
  const hit = files.find(([k]) => k.endsWith(suffix));
  if (!hit) throw new Error(`fixture not found: ${suffix}`);
  return hit[1];
};
/* index.html lives at the app root, outside src/ */
const readRoot = (name: string) => {
  try { return readFileSync(join(ROOT, name), 'utf8'); }
  catch { throw new Error(`fixture not found at app root: ${name}`); }
};

/* Sanity gate: if source reading silently breaks again, fail loudly here
   rather than let every assertion below pass on empty strings. */
describe('source fixtures are actually readable', () => {
  it('reads non-empty CSS and component sources', () => {
    expect(css.length).toBeGreaterThan(5);
    for (const [k, v] of css) expect(v.length, `${k} read empty`).toBeGreaterThan(500);
    expect(code.length).toBeGreaterThan(150);
    expect(readRoot('index.html').length).toBeGreaterThan(200);
  });
});

/* Every custom property DECLARED anywhere in the stylesheets. */
const declared = new Set<string>();
for (const [, src] of css) {
  for (const m of src.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) declared.add(m[1]);
}
/* Values React assigns inline on an element, so a bare var(--x) in code is
   legitimately undeclared there. Anything else is a typo. */
const INLINE_OK = new Set(['--campus-hue', '--pd', '--reveal-delay']);

describe('custom properties are all declared', () => {
  it('no stylesheet references an undeclared token', () => {
    const bad: string[] = [];
    for (const [k, src] of css) {
      for (const m of src.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
        if (!declared.has(m[1]) && !INLINE_OK.has(m[1])) bad.push(`${k}: var(${m[1]})`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('no component references an undeclared token', () => {
    const bad: string[] = [];
    for (const [k, src] of code) {
      for (const m of src.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
        if (!declared.has(m[1]) && !INLINE_OK.has(m[1])) bad.push(`${k}: var(${m[1]})`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('each inline-set exemption is genuinely assigned somewhere', () => {
    for (const t of INLINE_OK) {
      const assigned = files.some(([, s]) => s.includes(`'${t}'`) || s.includes(`"${t}"`) || s.includes(`${t}:`));
      expect(assigned, `${t} is exempt but never assigned`).toBe(true);
    }
  });
});

describe('the theme layers are actually wired', () => {
  it('index.css imports every layer, in order', () => {
    const entry = read('index.css');
    const order = ['tokens.css', 'base.css', 'components.css', 'dark.css', 'contrast.css', 'polish.css']
      .map(f => entry.indexOf(f));
    for (const [i, at] of order.entries()) {
      expect(at, `${['tokens', 'base', 'components', 'dark', 'contrast', 'polish'][i]}.css must be imported`).toBeGreaterThan(-1);
    }
    for (let i = 1; i < order.length; i++) {
      expect(order[i], 'theme layers must be imported in the declared order').toBeGreaterThan(order[i - 1]);
    }
  });

  it('the high-contrast theme is reachable, not dead', () => {
    expect(read('styles/contrast.css')).toContain("data-contrast='1'");
    const theme = read('lib/theme.ts');
    expect(theme).toContain('applyContrast');
    expect(theme).toContain('schoolos.contrast');
    /* and a person can actually turn it on */
    expect(read('components/Shell.tsx')).toContain('setContrast');
  });

  it('the document language is driven by the i18n layer', () => {
    expect(readRoot('index.html')).toMatch(/<html lang="en-IN">/);
    expect(read('i18n/index.ts')).toContain("setAttribute('lang'");
  });
});

describe('selectors do not over-match', () => {
  it('the sidebar group heading does not style every nav item label', () => {
    const c = read('styles/components.css');
    /* a descendant selector here also hit `.nav-item .sidebar-label`, which
       turned the whole 25-item rail into 11px uppercase grey micro-text */
    expect(c).toMatch(/\.nav-section\s*>\s*span\s*\{/);
    expect(c).not.toMatch(/\.nav-section\s+span\s*\{/);
  });

  it('the attention-row separator does not reuse the global .divider class', () => {
    /* `.divider` is a 1px <hr> with a background; applying it to a row painted
       the whole row. In the light theme the fill was near-white and invisible;
       under high contrast it was a dark slab across the list. */
    const c = read('styles/components.css');
    expect(c).toContain('.attention-row.sep');
    expect(c).not.toContain('.attention-row.divider');
  });

  it('a narrow-viewport rule does not restate the touch floor', () => {
    /* `@media (max-width:768px){ .btn-ghost.btn-sm{min-height:40px} }` carried
       two class selectors, outranked the `pointer: coarse` block, and left the
       campus switcher and every dropdown row under the 44px WCAG 2.5.8 floor */
    const c = read('styles/components.css');
    expect(c).not.toMatch(/@media \(max-width: 768px\)\s*\{[^}]*\.btn-ghost\.btn-sm[^}]*min-height/);
  });

  it('the touch floor is declared once, in tokens', () => {
    expect(read('styles/tokens.css')).toMatch(/--tap-min:\s*44px/);
  });

  it('the honesty note keeps its layout', () => {
    /* this rule was dropped in a rewrite, stacking the icon above the text on
       every screen that renders it */
    const rule = read('styles/components.css').match(/\.sample-note\s*\{[^}]*\}/)?.[0];
    expect(rule, '.sample-note must be styled').toBeTruthy();
    expect(rule).toMatch(/display:\s*flex/);
  });
});

describe('readability floor', () => {
  it('no live text is set below 11px, and the one exemption is structural', () => {
    /* 11px is the metadata step. The only exemption is .avatar — two-letter
       initials in a 26px circle, always beside the full name, sized to the
       shape rather than to a reading measure. */
    const bad: string[] = [];
    for (const [k, src] of css) {
      if (k.includes('contrast.css')) continue;
      for (const m of src.matchAll(/([^\n{}]*)\{([^}]*font-size:\s*(\d+(?:\.\d+)?)px[^}]*)\}/g)) {
        if (parseFloat(m[3]) >= 11) continue;
        if (/\.avatar/.test(m[1])) continue;
        bad.push(`${k}: ${m[1].trim().slice(0, 46)} → ${m[3]}px`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('stat labels and table headers sit at the 12px floor, not the 11px step', () => {
    /* both are load-bearing: a KPI whose label needs squinting, and a column
       header that tells you which column an amount belongs to */
    const c = read('styles/components.css');
    const statLabel = c.match(/\.stat \.label\s*\{[^}]*font-size:\s*([^;]+);/)?.[1];
    expect(statLabel, '.stat .label must declare a size').toBeTruthy();
    expect(statLabel).not.toMatch(/--text-2xs/);
    const th = c.match(/table\.data thead th\s*\{[^}]*font-size:\s*([^;]+);/)?.[1];
    expect(th, 'table.data thead th must declare a size').toBeTruthy();
    expect(th).not.toMatch(/--text-2xs/);
  });
});

describe('responsive grids are not frozen inline', () => {
  it('no element shadows a responsive grid class with an inline column count', () => {
    /* `<div className="grid grid-4" style={{gridTemplateColumns:'repeat(6, …)'}}>`
       — an inline value cannot be overridden by a media query without
       !important, so the stylesheet's reflow was silently dead and each KPI
       got ~53px on a 390px phone, overflowing its own label. */
    const bad: string[] = [];
    for (const [k, src] of code) {
      for (const m of src.matchAll(/className="grid grid-\d"[^>]*style=\{\{[^}]*gridTemplateColumns/g)) {
        bad.push(`${k}: ${m[0].slice(0, 90)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('a calendar week grid is allowed to stay fixed at 7', () => {
    /* asserted positively, so the exemption above is deliberate, not a hole */
    const cal = read('screens/CalendarScreen.tsx');
    expect(cal).toContain("'repeat(7, minmax(0,1fr))'");
    expect(cal).toContain('WEEKDAYS');
  });
});

describe('inline styles do not defeat the control system', () => {
  it('no button pins its own height inline', () => {
    /* An inline minHeight outranks EVERY stylesheet rule, so these could
       never reach the 44px touch floor — and one of them forced a 44px
       ghost button on desktop, breaking the control rhythm. */
    const bad: string[] = [];
    for (const [k, src] of code) {
      for (const m of src.matchAll(/className="[^"]*\bbtn\b[^"]*"[^>]*style=\{\{[^}]*minHeight/g)) {
        bad.push(`${k}: ${m[0].slice(0, 90)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
