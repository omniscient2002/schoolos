/* Control census — the check that would have caught the invisible "+ add" button.
 *
 * WHY THIS EXISTS
 * ---------------
 * A live, working, correctly-wired timetable slot button was invisible for as long as it was
 * styled `border: 1px dashed var(--line)`, where `--line` is declared nowhere. An undefined
 * custom property invalidates the WHOLE declaration at computed-value time, so the button
 * rendered with no border, on a transparent background, in faint text. The endpoint worked.
 * The click handler worked. It was simply painted as nothing — and because the failure mode
 * is a silently dropped declaration rather than a thrown error, no component test noticed and
 * no screenshot review flagged it. A human spent a whole onboarding flow concluding the
 * feature did not exist.
 *
 * So the generalisation is not "look harder". It is: COUNT the controls, and look for controls
 * that are laid out but not drawn.
 *
 * WHAT IT CHECKS, PER SCREEN
 *   · how many buttons / inputs / selects there are, so "I found none" is falsifiable
 *   · controls present in the DOM but not visible (zero area, display:none, opacity < 0.1)
 *   · THE G-5 SIGNATURE: an inline `border` of >= 1px whose *computed* border-style is `none`,
 *     i.e. the declaration was silently invalidated. Requiring a real px width is what stops
 *     a no-op `border: 0px` from matching.
 *
 * It walks the routes DECLARED in app/src/App.tsx rather than a hand-written list — a guessed
 * list sent me chasing two non-bugs (`/finance` is not a route; the fee door is /fees/plans).
 *
 * USAGE
 *   cd app && npm run dev            # or: npm run dev -- --port 5199
 *   cd .. && node scripts/control-census.mjs
 *
 *   Env: UI_BASE (default http://127.0.0.1:5173), CENSUS_EMAIL, CENSUS_PASSWORD.
 *   An account with the widest access is best — the owner.
 *
 * Note it navigates with history.pushState + popstate rather than page.goto, because the
 * session cookie is not sent cross-origin (finding C-3) and a hard reload bounces to /login.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const puppeteer = require_('../app/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js');

const UI = process.env.UI_BASE || 'http://127.0.0.1:5173';
const EMAIL = process.env.CENSUS_EMAIL;
const PASSWORD = process.env.CENSUS_PASSWORD;
const CHROME = process.env.CHROME_PATH
  || `${process.env.HOME}/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome`;
const SETTLE_MS = Number(process.env.CENSUS_SETTLE_MS || 2600);

if (!EMAIL || !PASSWORD) {
  console.error('Set CENSUS_EMAIL and CENSUS_PASSWORD (and optionally UI_BASE / CHROME_PATH).');
  process.exit(2);
}

/** every route declared in the SPA, excluding the two you are not "in" as a user */
function declaredRoutes() {
  const src = readFileSync(new URL('../app/src/App.tsx', import.meta.url), 'utf8');
  return [...new Set([...src.matchAll(/path="(\/[a-z0-9/-]*)"/g)].map((m) => m[1]))]
    .filter((r) => r && r !== '/login' && r !== '/onboard' && r !== '/');
}

const IN_PAGE = () => {
  const invisible = [];
  const noBorder = [];
  const shellHidden = [];
  const all = Array.from(document.querySelectorAll('button, input, select, textarea, a[href], [role=button]'));
  for (const el of all) {
    const label = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.tagName)
      .trim().replace(/\s+/g, ' ').slice(0, 42);

    // invisible, or legitimately hidden by a collapsed drawer / mobile menu?
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const notDrawn = r.width < 1 || r.height < 1 || cs.display === 'none'
      || cs.visibility === 'hidden' || Number(cs.opacity) < 0.1;
    if (notDrawn) {
      let hiddenByLayout = false;
      for (let n = el; n; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (s.display === 'none' || s.contentVisibility === 'hidden') { hiddenByLayout = true; break; }
      }
      (hiddenByLayout ? shellHidden : invisible).push({ label, tag: el.tagName.toLowerCase() });
    }

    // THE G-5 SIGNATURE
    const want = el.style?.border || el.style?.borderTop || '';
    const askedForPx = Math.max(0, ...[...want.matchAll(/([\d.]+)px/g)].map((m) => Number(m[1])));
    if (askedForPx >= 1 && cs.borderTopStyle === 'none') {
      noBorder.push({ label, declared: want.slice(0, 52), computed: `${cs.borderTopStyle} ${cs.borderTopWidth}` });
    }
  }
  return {
    buttons: document.querySelectorAll('button').length,
    inputs: document.querySelectorAll('input').length,
    selects: document.querySelectorAll('select').length,
    links: document.querySelectorAll('a[href]').length,
    heading: (document.querySelector('h1,h2,h3')?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 52),
    invisible, noBorder, shellHidden: shellHidden.length,
    total: all.length,
  };
};

const browser = await puppeteer.launch({ headless: 'new', executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });

await page.goto(`${UI}/login`, { waitUntil: 'networkidle2' });
await page.waitForSelector('input[type=email]', { visible: true });
await page.type('input[type=email]', EMAIL);
await page.type('input[type=password]', PASSWORD);
await page.evaluate(() => Array.from(document.querySelectorAll('button'))
  .find((b) => /sign in/i.test(b.textContent || ''))?.click());
await new Promise((r) => setTimeout(r, 3500));
if (await page.evaluate(() => !!document.querySelector('input[type=password]'))) {
  console.error('Sign-in failed — still on /login.');
  console.error('  page said:', await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 300)));
  await browser.close();
  process.exit(1);
}

const report = [];
for (const route of declaredRoutes()) {
  await page.evaluate((u) => {
    window.history.pushState({}, '', u);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
  await new Promise((r) => setTimeout(r, SETTLE_MS));
  const row = await page.evaluate(IN_PAGE);
  report.push({ route, ...row });
  console.log(`${route.padEnd(30)} btn:${String(row.buttons).padStart(3)} in:${String(row.inputs).padStart(3)}`
    + ` sel:${String(row.selects).padStart(3)}  invisible:${row.invisible.length}`
    + `  border-dropped:${String(row.noBorder.length).padStart(2)}  shell-hidden:${row.shellHidden}   ${row.heading}`);
}

console.log('\n══ controls present in the DOM but not visible ══');
let any = false;
for (const r of report) for (const i of r.invisible) { console.log(`  ${r.route}  <${i.tag}> ${i.label}`); any = true; }
if (!any) console.log('  none');

console.log('\n══ declared a border, computed to nothing (the G-5 signature) ══');
any = false;
for (const r of report) for (const b of r.noBorder) {
  console.log(`  ${r.route}  ${b.label}\n      declared ${b.declared}\n      computed ${b.computed}`);
  any = true;
}
if (!any) console.log('  none');

const controls = report.reduce((a, r) => a + r.total, 0);
const bad = report.reduce((a, r) => a + r.invisible.length + r.noBorder.length, 0);
console.log(`\n${report.length} screens · ${controls} interactive controls · `
  + `${report.reduce((a, r) => a + r.buttons, 0)} buttons · ${bad} defect(s)`);
console.log(bad ? 'FAIL — see above' : 'PASS — no invisible controls, no dropped borders');

await browser.close();
process.exit(bad ? 1 : 0);