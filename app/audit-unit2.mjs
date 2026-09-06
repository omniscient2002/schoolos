import { chromium } from '/usr/lib/code/node_modules/playwright-core/index.mjs';

const EXE = '/home/cassandra/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';
const BASE = 'http://127.0.0.1:4310';
const WIDTHS = [1920, 768, 390];
const ROUTES = ['/today', '/attention', '/ask', '/maintenance'];

const ACCENT_RGB = 'rgb(14, 117, 104)'; // --accent

/* Layout checks shared by all pages */
const LAYOUT_FN = () => {
  const out = { hOverflow: null, clippedStats: [], tinyText: [] };
  const doc = document.documentElement;
  if (document.scrollWidth > doc.clientWidth + 2) out.hOverflow = `scrollWidth=${document.scrollWidth} clientWidth=${doc.clientWidth}`;
  for (const el of document.querySelectorAll('.stat .value')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (el.scrollWidth > el.clientWidth + 1) out.clippedStats.push(`"${(el.textContent || '').trim().slice(0, 24)}" sw=${el.scrollWidth} cw=${el.clientWidth}`);
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.children.length > 0) continue;
    let direct = '';
    for (const c of node.childNodes) if (c.nodeType === 3) direct += c.textContent;
    direct = direct.trim();
    if (direct.length <= 14) continue;
    const cs = getComputedStyle(node);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
    const r = node.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.width < 58) out.tinyText.push(`<${node.tagName.toLowerCase()} class="${(node.className || '').toString().slice(0, 40)}"> "${direct.slice(0, 30)}" w=${Math.round(r.width * 10) / 10}`);
  }
  return out;
};

/* Focus indicator check for the currently focused element */
const FOCUS_FN = () => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const cs = getComputedStyle(el);
  const halo = cs.boxShadow && cs.boxShadow.includes('0px 0px 0px 3px');
  return {
    tag: el.tagName.toLowerCase(),
    cls: (el.className || '').toString().slice(0, 40),
    outlineW: cs.outlineWidth, outlineS: cs.outlineStyle, outlineC: cs.outlineColor,
    borderC: cs.borderColor, halo: !!halo,
  };
};

async function runAudit(attemptNo) {
  const issues = [];
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();

    async function gotoRobust(url, selector, attempts = 6) {
      for (let i = 1; i <= attempts; i++) {
        try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }); }
        catch (e) { console.log(`  [a${attemptNo}] goto ${i}/${attempts}: ${e.message.split('\n')[0].slice(0, 70)}`); await new Promise(r => setTimeout(r, 2000)); continue; }
        try { await page.waitForSelector(selector, { timeout: 6000 }); return true; }
        catch { console.log(`  [a${attemptNo}] missing ${selector} on ${url} (try ${i})`); }
      }
      return false;
    }

    /* ---------- PART A: login page, unauthenticated, 3 widths ---------- */
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 1080 });
      if (!(await gotoRobust(BASE + '/login', '.login-form input[type="email"]'))) { issues.push(`login@${width}: form never appeared`); continue; }
      await page.waitForTimeout(500);
      const res = await page.evaluate(LAYOUT_FN);
      if (res.hOverflow) issues.push(`login@${width}: h-overflow ${res.hOverflow}`);
      for (const t of res.tinyText) issues.push(`login@${width}: tiny text ${t}`);

      /* keyboard focus walk: blur (autoFocus), then Tab through the form.
         NOTE: the seg control is a Chrome-native tablist — Tab skips it by
         spec; it is reached via Shift+Tab from the form (roving arrows are
         a Login.tsx gap, reported, not fixed — auth-screen JSX off-lane). */
      await page.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur(); });
      const stops = [];
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press('Tab');
        await page.waitForTimeout(60);
        const f = await page.evaluate(FOCUS_FN);
        if (f) stops.push(f);
        const cls = f ? f.cls : '';
        if (cls.includes('login-role')) break; // walked past the form
      }
      // seg walk: Shift+Tab from the email input reaches the tablist
      await page.focus('.login-form input[type="email"]');
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press('Shift+Tab');
        await page.waitForTimeout(60);
        const f = await page.evaluate(FOCUS_FN);
        if (f) stops.push(f);
        if (f && f.cls.includes('seg-btn')) break;
      }
      const segStop = stops.find(s => s.cls.includes('seg-btn'));
      const inputStop = stops.find(s => s.tag === 'input');
      const submitStop = stops.find(s => s.tag === 'button' && s.cls.includes('btn-primary'));
      const ringVisible = s => !!s && ((parseFloat(s.outlineW) >= 2 && s.outlineS !== 'none') || s.halo || s.borderC === ACCENT_RGB);
      if (!ringVisible(segStop)) issues.push(`login@${width}: no visible focus ring on seg-btn ${JSON.stringify(segStop)}`);
      if (!ringVisible(inputStop)) issues.push(`login@${width}: no visible focus ring on email input ${JSON.stringify(inputStop)}`);
      if (!ringVisible(submitStop)) issues.push(`login@${width}: no visible focus ring on Sign in button ${JSON.stringify(submitStop)}`);
      console.log(`[a${attemptNo}] login@${width}: overflow=${res.hOverflow ? 'YES' : 'no'} tiny=${res.tinyText.length} ring seg=${ringVisible(segStop)} input=${ringVisible(inputStop)} submit=${ringVisible(submitStop)}`);
    }

    /* ---------- PART B: login via form, authed routes ---------- */
    if (!(await gotoRobust(BASE + '/login', '.login-form input[type="email"]'))) return { verdict: 'env', issues };
    await page.fill('.login-form input[type="email"]', 'principal@meridian.edu');
    await page.fill('.login-form input[type="password"]', 'schoolos-demo');
    await page.click('.login-form .btn-primary');
    let loggedIn = false;
    for (let i = 0; i < 4 && !loggedIn; i++) {
      try { await page.waitForSelector('.page-head', { timeout: 12000 }); loggedIn = true; }
      catch {
        if (!page.url().includes('/login')) loggedIn = await gotoRobust(BASE + '/today', '.page-head', 4);
        else { const btn = await page.$('.login-form .btn-primary'); if (btn) { await page.fill('.login-form input[type="email"]', 'principal@meridian.edu'); await page.fill('.login-form input[type="password"]', 'schoolos-demo'); await btn.click(); } }
      }
    }
    if (!loggedIn) { console.log(`  [a${attemptNo}] login did not complete`); return { verdict: 'env', issues }; }
    console.log(`[a${attemptNo}] LOGIN_OK url=${page.url()}`);

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 1080 });
      await page.waitForTimeout(350);
      for (const route of ROUTES) {
        if (!(await gotoRobust(BASE + route, '.page-head'))) { issues.push(`route ${route}@${width}: .page-head never appeared`); continue; }
        await page.waitForTimeout(700);
        const res = await page.evaluate(LAYOUT_FN).catch(e => { console.log(`  [a${attemptNo}] evaluate failed: ${e.message.split('\n')[0].slice(0, 60)}`); return null; });
        if (res === null) { issues.push(`route ${route}@${width}: page context lost (env race)`); continue; }
        if (res.hOverflow) issues.push(`route ${route}@${width}: h-overflow ${res.hOverflow}`);
        for (const c of res.clippedStats) issues.push(`route ${route}@${width}: stat clipped ${c}`);
        for (const t of res.tinyText) issues.push(`route ${route}@${width}: tiny text ${t}`);
        console.log(`[a${attemptNo}] checked ${route}@${width}: overflow=${res.hOverflow ? 'YES' : 'no'} statsClipped=${res.clippedStats.length} tiny=${res.tinyText.length}`);
      }
    }
    return { verdict: issues.length === 0 ? 'clean' : 'issues', issues };
  } finally {
    await browser.close().catch(() => {});
  }
}

let final = null;
for (let a = 1; a <= 5; a++) {
  try {
    final = await runAudit(a);
    console.log(`attempt ${a}: ${final.verdict} (${final.issues.length} issues)`);
    if (final.verdict !== 'env') break;
    console.log('env race — waiting 8s before next attempt');
    await new Promise(r => setTimeout(r, 8000));
  } catch (e) {
    console.log(`attempt ${a} crashed: ${e.message.split('\n')[0].slice(0, 120)}`);
    await new Promise(r => setTimeout(r, 8000));
  }
}
console.log('---');
if (!final || final.verdict === 'env') { console.log('AUDIT_INCOMPLETE (env race persisted)'); process.exit(2); }
console.log(`TOTAL_ISSUES=${final.issues.length}`);
for (const i of final.issues) console.log('ISSUE: ' + i);
process.exit(final.verdict === 'clean' ? 0 : 1);
