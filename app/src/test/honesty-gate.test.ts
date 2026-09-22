/* Honesty gate (TODO_FIX_MAP T11) — the product's law is that a fabricated number must never read as
 * the school's own record (see `SampleNote`, components/ui.tsx). A screen that reads the demo dataset
 * or the seed service layer must therefore render a `SampleNote` (or be allowlisted here with a
 * reason). This is the guard that stops the "finished-looking but fake" class from recurring: adding a
 * seed import without a label fails CI instead of shipping.
 *
 * Loaded with Vite's raw glob (no node builtins), mirroring screens-load.smoke.test.tsx. */
import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sources = (import.meta as any).glob('../screens/**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/* Each allowlist entry needs a reason (the vacuity-gate rule: a bare allowance is a hole). These
   screens read the seed for incidental reasons or already label the demo parts in their own copy. */
const ALLOW = new Map<string, string>([
  ['src/screens/Onboard.tsx', 'public signup: only hydrates the dataset; renders no seed numbers'],
  ['src/screens/People.tsx', 'student tab is live; non-student tabs render honest empty states, not seed rows'],
  ['src/screens/PersonDetail.tsx', 'live student profile + demo-directory records; the payment tab carries its own demo notice'],
  ['src/screens/ReportIssue.tsx', 'work-order persistence is live; only the photo attach is a labelled demo placeholder'],
  ['src/screens/Settings.tsx', 'roles + DSR are live; local-only preferences say so'],
  ['src/screens/Today.tsx', 'live actions merge with demo chips explicitly tagged demo(…)'],
]);

const SEED_IMPORT = /from '.*(?:data\/dataset|demo\/seedServices)'/;
const rel = (key: string) => key.replace(/^\.\.\//, 'src/').split('\\').join('/');

describe('honesty gate · seed data must be labelled', () => {
  it('discovers the screen tree', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(80);
  });

  it('every screen that reads the demo dataset renders SampleNote or is allowlisted with a reason', () => {
    const missing: string[] = [];
    for (const [key, src] of Object.entries(sources)) {
      if (!SEED_IMPORT.test(src)) continue;
      if (src.includes('SampleNote')) continue;
      const r = rel(key);
      if (ALLOW.has(r)) continue;
      missing.push(r);
    }
    expect(
      missing,
      `seed-reading screens without SampleNote — add the note or an allowlist reason: ${missing.join(', ')}`,
    ).toEqual([]);
  });
});
