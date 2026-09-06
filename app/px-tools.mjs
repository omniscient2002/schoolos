#!/usr/bin/env node
/* ============================================================================
   px-tools.mjs — persistent pixel-proof toolkit (unit 16, E2).
   Sanctioned persistent tool like audit-lib.mjs / contrast-matrix.mjs.

   Reconstructs the unit-13 fringe-physics pixel methodology whose scratch tools
   were deleted after the run (per ritual). Everything below is sourced from the
   surviving evidence: handoff/2026-09-06-ui-orchestrator-unit13.md and
   logs/u13-pixel-verdict.txt. Purpose: the release-candidate visual audit can
   RUN the proof instead of re-deriving it.

   THE FOUR METHODS (unit-13 verdict logic, codified):

   1. NUDGE BUCKETS — every changed pixel is attributed by its max channel delta:
        ≤3   → text-3 AA nudge          (the disclosed delta class)
        ≤11  → warning-tone nudge
        ≤30  → chart-slate nudge
        >30  → remainder, must be explained (see 2)
      A route's histogram "dominated by ≤3" with small remainders = re-render,
      not redesign.

   2. LCD FRINGE CLASSIFICATION — pixels in the >30 bucket are fringes when the
      CHANNEL SUM is unchanged (Δ = 0): ClearType/subpixel AA redistributes
      channel energy at glyph edges without changing perceived luminance
      (e.g. 255,0,0 ↔ 127,0,128 — both sum to 255, energy redistributed across channels). Fringes must additionally be
      GLYPH-ROW CONFINED: isolated (few same-class neighbours in the 3×3 block),
      otherwise the change is structural, not antialiasing.

   3. SELF-FLOOR CONTROL — shoot the SAME build twice before attributing a
      cross-build diff: the self-diff is the noise floor of the pipeline
      (unit-13: /people 0 px deterministic; /transport 69 px live-GPS churn).
      Cross-build deltas only mean something above their route's floor.

   4. FROZEN CLOCK — time-variant pixels ("2m ago" strings, ribbons) are noise;
      inject a fixed Date before navigation to remove them from the diff.

   USAGE
     import { shoot, nudgeBuckets, fringeReport, selfFloor, freezeClock } from './px-tools.mjs';
     node px-tools.mjs http://127.0.0.1:4310        # runs the built-in self-test
   ========================================================================== */

import { chromium } from '/usr/lib/code/node_modules/playwright-core/index.mjs';

const EXE = '/home/cassandra/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';

export const BUCKETS = { text3: 3, warning: 11, slate: 30 };

/* ---- browser + page plumbing ---- */

export async function launch() {
  return chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
}

/* Inject a fixed Date BEFORE any app script runs (unit-13 frozen-clock control).
   Call between newPage() and the first goto. */
export async function freezeClock(page, iso) {
  await page.addInitScript((t) => {
    const Fixed = class extends Date {
      constructor(...args) { if (args.length === 0) super(t); else super(...args); }
      static now() { return new Date(t).getTime(); }
    };
    window.Date = Fixed;
  }, iso);
}

/* Navigate + settle like the audits do (networkidle + paint wait). */
export async function gotoStable(page, url, waitMs = 1200) {
  await page.goto(url, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(waitMs);
}

/* Screenshot a page and decode it to an RGBA flat array — decode happens IN the
   browser (canvas drawImage), so no PNG library is needed. */
export async function shoot(browser, url, opts = {}) {
  const { width = 1440, height = 900, theme, clock } = opts;
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  if (clock) await freezeClock(page, clock);
  if (theme) {
    await page.addInitScript((t) => { try { localStorage.setItem('schoolos.theme', t); } catch { /* fresh context */ } }, theme);
  }
  await gotoStable(page, url);
  const buf = await page.screenshot({ fullPage: false });
  const meta = await ctx.newPage();
  const img = await meta.evaluate(async (b64) => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + b64;
    await new Promise((res, rej) => { image.onload = res; image.onerror = rej; });
    const c = document.createElement('canvas');
    c.width = image.naturalWidth; c.height = image.naturalHeight;
    const g = c.getContext('2d');
    g.drawImage(image, 0, 0);
    return { w: image.naturalWidth, h: image.naturalHeight, data: Array.from(g.getImageData(0, 0, image.naturalWidth, image.naturalHeight).data) };
  }, buf.toString('base64'));
  await ctx.close();
  return { ...img, url, width, height, theme: theme ?? 'default' };
}

/* ---- classification ---- */

/* max single-channel delta between two pixels — the nudge-bucket key */
export function maxDelta(a, b, o = 0) {
  return Math.max(Math.abs(a[o] - b[o]), Math.abs(a[o + 1] - b[o + 1]), Math.abs(a[o + 2] - b[o + 2]));
}

/* LCD fringe test: channel SUM unchanged (Δ=0) while channels redistribute —
   the unit-13 glyph-edge signature. Alpha ignored (opaque screenshots). */
export function isFringe(a, b, o = 0) {
  return Math.abs((a[o] + a[o + 1] + a[o + 2]) - (b[o] + b[o + 1] + b[o + 2])) === 0
    && (a[o] !== b[o] || a[o + 1] !== b[o + 1] || a[o + 2] !== b[o + 2]);
}

/* Bucket a before/after pair. Returns counts + the >30 remainder with its
   fringe/isolated split. `before.data`/`after.data` are RGBA flats of equal size. */
export function nudgeBuckets(before, after) {
  if (before.data.length !== after.data.length) throw new Error('size mismatch — different viewport or layout shift');
  const n = before.data.length / 4;
  const changedIdx = [];
  const out = { changed: 0, text3: 0, warning: 0, slate: 0, big: 0, w: before.w, h: before.h };
  for (let p = 0; p < n; p++) {
    const o = p * 4;
    const d = maxDelta(before.data, after.data, o);
    if (d === 0) continue;
    out.changed++;
    changedIdx.push(p);
    if (d <= BUCKETS.text3) out.text3++;
    else if (d <= BUCKETS.warning) out.warning++;
    else if (d <= BUCKETS.slate) out.slate++;
    else out.big++;
  }
  return { ...out, changedIdx };
}

/* Fringe attribution for the >30 remainder: fringe test + 3×3 isolation
   (glyph-edge confinement). `fringeOf(p)` lets callers pre-test membership. */
export function fringeReport(before, after, changedIdx, w) {
  const fringeIdx = changedIdx.filter((p) => isFringe(before.data, after.data, p * 4));
  const fringeSet = new Set(fringeIdx);
  let isolated = 0;
  for (const p of fringeIdx) {
    const x = p % w, y = (p / w) | 0;
    let neighbours = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0) continue;
      if (fringeSet.has(ny * w + nx)) neighbours++;
    }
    if (neighbours <= 2) isolated++;   /* unit-13: 98/150 isolated on /fees */
  }
  return {
    fringes: fringeIdx.length,
    isolated,
    structural: fringeIdx.length - isolated,
    pct: changedIdx.length ? +(100 * fringeIdx.length / changedIdx.length).toFixed(1) : 0,
  };
}

/* Self-floor control: same build, shoot twice, diff. Returns changed-pixel count
   — the pipeline's noise floor for that route (0 when deterministic). */
export async function selfFloor(browser, url, opts) {
  const a = await shoot(browser, url, opts);
  const b = await shoot(browser, url, opts);
  return { count: nudgeBuckets(a, b).changed, a, b };
}

/* ---- self-test (node px-tools.mjs <baseURL>) ---- */

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = process.argv[2] ?? 'http://127.0.0.1:4310';
  /* 1. classification sanity (synthetic) */
  const f1 = isFringe([255, 0, 0, 255], [127, 0, 128, 255]);       // sum 255 = 255, channels differ → fringe
  const f2 = isFringe([255, 255, 255, 255], [250, 250, 250, 255]); // sums differ → not fringe
  const b1 = maxDelta([250, 250, 250, 255], [248, 249, 247, 255]); // ≤3 → text3 bucket
  if (!f1 || f2 || b1 !== 3) { console.error('FAIL classification sanity'); process.exit(1); }
  console.log('ok   classification: fringe(255,0,0↔127,0,128)=true  non-fringe(Δsum≠0)=false  bucket(Δ3)=text3');

  /* 2. live pipeline: frozen-clock self-floor on a public route */
  const browser = await launch();
  try {
    const floor = await selfFloor(browser, `${base}/login`, { theme: 'light', clock: '2026-09-06T09:00:00Z' });
    console.log(`ok   self-floor /login (frozen clock): ${floor.count} px ${floor.count === 0 ? '(deterministic — pipeline sound)' : '(CHURN — check clocks/animation before attributing diffs)'}`);
    const dark = await shoot(browser, `${base}/login`, { theme: 'dark', clock: '2026-09-06T09:00:00Z' });
    const light = await shoot(browser, `${base}/login`, { theme: 'light', clock: '2026-09-06T09:00:00Z' });
    const buckets = nudgeBuckets(light, dark);
    const fr = fringeReport(light, dark, buckets.changedIdx, buckets.w);
    console.log(`ok   theme flip /login: changed=${buckets.changed} text3≤3:${buckets.text3} warning≤11:${buckets.warning} slate≤30:${buckets.slate} big>30:${buckets.big} fringes:${fr.fringes} (isolated ${fr.isolated}, ${fr.pct}%)`);
    console.log(buckets.changed === 0 ? 'NOTE theme flip produced no diff — check theme wiring' : 'VERDICT: pipeline operational (buckets + fringe classification live)');
  } finally {
    await browser.close();
  }
}
