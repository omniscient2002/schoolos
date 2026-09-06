import { chromium } from '/usr/lib/code/node_modules/playwright-core/index.mjs';

const EXE = '/home/cassandra/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';
const BASE = 'http://127.0.0.1:4310';
const WIDTHS = [1920, 768, 390];
const ROUTES = ['/today', '/attention', '/ask', '/maintenance'];

const issues = [];
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();

// goto + reload-retries (IO-pressured host: lazy chunk fetches can transiently fail)
async function gotoRobust(url, selector, attempts = 6) {
  for (let i = 1; i <= attempts; i++) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    try { await page.waitForSelector(selector, { timeout: 6000 }); return true; }
    catch {
      console.log(`  retry ${i}/${attempts}: ${url} missing ${selector}`);
      try { await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector(selector, { timeout: 6000 }); return true; }
      catch { /* next attempt */ }
    }
  }
  return false;
}

// --- login via form ---
if (!(await gotoRobust(BASE + '/login', '.login-form input[type="email"]'))) {
  console.log('LOGIN_FORM_NEVER_APPEARED'); await browser.close(); return 'env';
}
await page.fill('.login-form input[type="email"]', 'principal@meridian.edu');
await page.fill('.login-form input[type="password"]', 'schoolos-demo');
await page.click('.login-form .btn-primary');
let loggedIn = false;
for (let i = 0; i < 3 && !loggedIn; i++) {
  try { await page.waitForSelector('.page-head', { timeout: 15000 }); loggedIn = true; }
  catch {
    if (!page.url().includes('/login')) {
      loggedIn = await gotoRobust(BASE + '/today', '.page-head', 3);
    } else {
      const btn = await page.$('.login-form .btn-primary');
      if (btn) { await page.fill('.login-form input[type="email"]', 'principal@meridian.edu'); await page.fill('.login-form input[type="password"]', 'schoolos-demo'); await btn.click(); }
    }
  }
}
if (!loggedIn) { console.log('LOGIN_FAILED'); await browser.close(); return 'env'; }
console.log('LOGIN_OK url=', page.url());

for (const width of WIDTHS) {
  await page.setViewportSize({ width, height: 1080 });
  await page.waitForTimeout(350);
  for (const route of ROUTES) {
    const ok = await gotoRobust(BASE + route, '.page-head');
    if (!ok) { issues.push(`route ${route}@${width}: .page-head never appeared (url=${page.url()})`); continue; }
    await page.waitForTimeout(700); // data fetch + reflow settle

    const res = await page.evaluate(() => {
      const out = { hOverflow: null, clippedStats: [], tinyText: [] };
      const doc = document.documentElement;
      if (document.scrollWidth > doc.clientWidth + 2) {
        out.hOverflow = `scrollWidth=${document.scrollWidth} clientWidth=${doc.clientWidth}`;
      }
      // stat value clipping
      for (const el of document.querySelectorAll('.stat .value')) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        if (el.scrollWidth > el.clientWidth + 1) {
          out.clippedStats.push(`"${(el.textContent || '').trim().slice(0, 24)}" sw=${el.scrollWidth} cw=${el.clientWidth}`);
        }
      }
      // tiny text blocks: leaf element, direct text >14 chars, box <58px wide
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
        if (r.width < 58) {
          out.tinyText.push(`<${node.tagName.toLowerCase()} class="${(node.className || '').toString().slice(0, 40)}"> "${direct.slice(0, 30)}" w=${Math.round(r.width * 10) / 10}`);
        }
      }
      return out;
    });

    if (res.hOverflow) issues.push(`route ${route}@${width}: h-overflow ${res.hOverflow}`);
    for (const c of res.clippedStats) issues.push(`route ${route}@${width}: stat value clipped ${c}`);
    for (const t of res.tinyText) issues.push(`route ${route}@${width}: tiny text ${t}`);
    console.log(`checked ${route}@${width}: overflow=${res.hOverflow ? 'YES' : 'no'} statsClipped=${res.clippedStats.length} tinyText=${res.tinyText.length}`);
  }
}

await browser.close();
console.log('---');
console.log(`TOTAL_ISSUES=${issues.length}`);
for (const i of issues) console.log('ISSUE: ' + i);
return issues.length === 0 ? 'clean' : 'issues';
