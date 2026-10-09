// Dev-only: fast per-role UI audit. One browser, one page, reused across
// roles — launching a browser per role exhausted the headless renderer and
// crashed it mid-run, which looks exactly like an app bug.
//
//   node scripts/audit-roles.mjs                 # all lanes, desktop
//   W=390 H=844 node scripts/audit-roles.mjs     # mobile (coarse pointer)
//   ONLY=finance node scripts/audit-roles.mjs
//
// Checks per role: horizontal page scroll, content overflowing its box,
// text under the 12px floor, touch targets under 44px, and text under 4.5:1
// against its own resolved background. Writes a JSON report + a screenshot.
import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173';
const OUT = process.env.OUT ?? '/tmp/opencode/roles';
const W = Number(process.env.W ?? 1440);
const H = Number(process.env.H ?? 1000);
const THEME = process.env.SHOOT_THEME ?? 'light';
const PW = process.env.PW ?? 'schoolos-demo';
const ONLY = process.env.ONLY ?? '';

const ACCOUNTS = [
  { role: 'owner',       email: 'ananya.rao@cassandra.edu',      home: '/today' },
  { role: 'principal',   email: 'principal@cassandra.edu',       home: '/today' },
  { role: 'coordinator', email: 'kavita.reddy@cassandra.edu',    home: '/today' },
  { role: 'finance',     email: 'ramesh.gupta@cassandra.edu',     home: '/today' },
  { role: 'itadmin',     email: 'suresh.babu@cassandra.edu',      home: '/today' },
  { role: 'librarian',   email: 'anita.desai@cassandra.edu',      home: '/library/desk' },
  { role: 'teacher',     email: 'priya.iyer@cassandra.edu',       home: '/teacher' },
  { role: 'student',     email: 'meera.menon@cassandra.edu',      home: '/student/home2' },
  { role: 'parent',      email: 'parent.cas-0037@cassandra.edu',  home: '/parent/family' },
  { role: 'admissions',  email: 'admissions@sahyadri.edu.in',     home: '/admissions' },
  { role: 'counselor',   email: 'counselor@sahyadri.edu.in',      home: '/counselor/concerns' },
  { role: 'facilities',  email: 'facilities@sahyadri.edu.in',     home: '/operations' },
  { role: 'transport',   email: 'transport@sahyadri.edu.in',      home: '/transport' },
  { role: 'technician',  email: 'technician@sahyadri.edu.in',     home: '/maintenance/technician' },
].filter(a => !ONLY || a.role === ONLY);

mkdirSync(`${OUT}/${W}-${THEME}`, { recursive: true });

/* Same yardstick for every role. */
const AUDIT = () => {
  const vis = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const parse = (c) => { const m = c.match(/[\d.]+/g); return m ? m.slice(0, 4).map(Number) : [0, 0, 0, 0]; };
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const over = (fg, bg) => [0, 1, 2].map(i => fg[i] * fg[3] + bg[i] * (1 - fg[3]));
  const ratio = (a, b) => { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); };
  const bgOf = (el) => {
    let n = el, acc = null;
    while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c[3] > 0) { acc = acc ? over(acc, c) : c; if (c[3] === 1) return acc; }
      n = n.parentElement;
    }
    return acc && acc[3] === 1 ? acc : [255, 255, 255, 1];
  };

  const out = { hScroll: document.documentElement.scrollWidth > window.innerWidth + 1, overflow: [], tinyText: [], tapTarget: [], lowContrast: [] };

  for (const el of document.querySelectorAll('.page *')) {
    if (!vis(el) || (el.children.length > 0 && !el.matches('td,th,button,a'))) continue;
    const s = getComputedStyle(el);
    if (s.overflowX !== 'visible' || s.textOverflow === 'ellipsis' || s.whiteSpace === 'nowrap') continue;
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
      out.overflow.push({ cls: (el.className || el.tagName).toString().slice(0, 40), text: (el.textContent || '').trim().slice(0, 40), by: el.scrollWidth - el.clientWidth });
    }
  }

  const META_OK = ['.avatar', '.chart-svg', '.u-upper', '.t-time', '.day-ribbon-axis', '.day-ribbon-title', '.nav-section > span', '.wo-step-time', '.wo-step-label', '.event-meta', '.rs-time', '.cs-k', '.memory-loop-tag', '.mtab', '.badge', '.login-phones', '.login-role code'];
  for (const el of document.querySelectorAll('.page *')) {
    if (!vis(el) || el.children.length) continue;
    const txt = (el.textContent || '').trim();
    if (txt.length < 2) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs >= 11.6 || META_OK.some(sel => el.matches(sel) || el.closest(sel))) continue;
    out.tinyText.push({ fs: fs.toFixed(1), text: txt.slice(0, 34), cls: (el.className || '').toString().slice(0, 40) });
  }

  // The 44px floor is a COARSE-POINTOR rule (WCAG 2.5.8). On a fine pointer
  // a 34px row is correct desktop density, so only assert it on phone widths.
  if (window.innerWidth < 900) {
    for (const el of document.querySelectorAll('button, a[href], input, select, [role="button"], [role="tab"], [role="menuitem"]')) {
      if (!vis(el) || el.closest('.skip-link')) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 32 || r.width < 24 || r.height >= 44) continue;
      out.tapTarget.push({ h: Math.round(r.height), text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30), cls: (el.className || '').toString().slice(0, 36) });
    }
  }

  for (const el of document.querySelectorAll('.page *')) {
    if (!vis(el) || el.children.length) continue;
    const txt = (el.textContent || '').trim();
    if (txt.length < 2) continue;
    const s = getComputedStyle(el);
    const fg = parse(s.color);
    if (fg[3] < 0.3) continue;
    const bg = bgOf(el);
    const r = ratio(over(fg, bg), bg);
    const fs = parseFloat(s.fontSize);
    const large = fs >= 24 || (fs >= 18.66 && parseInt(s.fontWeight, 10) >= 700);
    if (r < (large ? 3 : 4.5)) out.lowContrast.push({ r: r.toFixed(2), text: txt.slice(0, 34), cls: (el.className || '').toString().slice(0, 40) });
  }
  return out;
};

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome-stable', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const report = [];
const t0 = Date.now();

for (const acc of ACCOUNTS) {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1, hasTouch: W < 900, isMobile: W < 900 });
  if (W < 900) {
    const cdp = await page.createCDPSession();
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }
  await page.evaluateOnNewDocument((t) => {
    localStorage.setItem('schoolos.theme', t);
    localStorage.setItem('schoolos.contrast', 'standard');
  }, THEME);

  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + String(e).slice(0, 100)));

  let landed = '?';
  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await new Promise(r => setTimeout(r, 900));
    await page.type('input[type="email"]', acc.email, { delay: 3 });
    await page.type('input[type="password"]', PW, { delay: 3 });
    const btn = await page.$('form button.btn-primary');
    if (btn) await btn.click({ timeout: 6000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2400));
    landed = new URL(page.url()).pathname;
    await page.evaluate((to) => { history.pushState({}, '', to); window.dispatchEvent(new PopStateEvent('popstate')); }, acc.home);
    await new Promise(r => setTimeout(r, 2400));
  } catch (e) { landed = 'ERR ' + String(e).slice(0, 50); }

  const a = await page.evaluate(AUDIT).catch(e => ({ error: String(e).slice(0, 90) }));
  await page.screenshot({ path: `${OUT}/${W}-${THEME}/${acc.role}.png` }).catch(() => {});
  report.push({ role: acc.role, email: acc.email, landed, ...a, pageErrors: errs.slice(0, 2) });
  console.log(
    `${acc.role.padEnd(13)} ${String(landed).slice(0, 20).padEnd(21)}` +
    ` hScroll=${String(a.hScroll).padEnd(5)} overflow=${String(a.overflow?.length ?? '-').padEnd(2)}` +
    ` tiny=${String(a.tinyText?.length ?? '-').padEnd(2)} tap=${String(a.tapTarget?.length ?? '-').padEnd(2)}` +
    ` contrast=${String(a.lowContrast?.length ?? '-').padEnd(2)} crash=${errs.length}`,
  );
  await page.close();
}

writeFileSync(`${OUT}/${W}-${THEME}-report.json`, JSON.stringify(report, null, 2));
const bad = report.filter(r => r.hScroll || (r.overflow?.length ?? 0) || (r.tinyText?.length ?? 0) || (r.tapTarget?.length ?? 0) || (r.lowContrast?.length ?? 0) || r.pageErrors?.length);
console.log(`\n${report.length} roles in ${Math.round((Date.now() - t0) / 1000)}s · ${bad.length} with findings · report -> ${OUT}/${W}-${THEME}-report.json`);
await Promise.race([browser.close(), new Promise(r => setTimeout(r, 2000))]);
process.exit(0);
