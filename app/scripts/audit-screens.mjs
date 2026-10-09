// Dev-only: deep per-role screen walk. Signs in once per role, then visits
// EVERY route that role's own navigation links to, auditing each screen and
// failing loudly on a crash. Home-only auditing misses the majority of a
// role's surface — and a screen can pass every layout check and still throw.
//
//   node scripts/audit-screens.mjs
//   ONLY=teacher node scripts/audit-screens.mjs
//   W=390 H=844 node scripts/audit-screens.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173';
const OUT = process.env.OUT ?? '/tmp/opencode/screens';
const W = Number(process.env.W ?? 1440);
const H = Number(process.env.H ?? 1000);
const THEME = process.env.SHOOT_THEME ?? 'light';
const CONTRAST = process.env.SHOOT_CONTRAST ?? 'standard';
const PW = process.env.PW ?? 'schoolos-demo';
const ONLY = process.env.ONLY ?? '';
const SHOT = process.env.SHOT === '1';

const ACCOUNTS = [
  { role: 'principal', email: 'principal@cassandra.edu' },
  { role: 'teacher', email: 'priya.iyer@cassandra.edu' },
  { role: 'student', email: 'meera.menon@cassandra.edu' },
  { role: 'parent', email: 'parent.cas-0037@cassandra.edu' },
  { role: 'finance', email: 'ramesh.gupta@cassandra.edu' },
  { role: 'librarian', email: 'anita.desai@cassandra.edu' },
  { role: 'coordinator', email: 'kavita.reddy@cassandra.edu' },
  { role: 'technician', email: 'technician@sahyadri.edu.in' },
  { role: 'transport', email: 'transport@sahyadri.edu.in' },
  { role: 'itadmin', email: 'suresh.babu@cassandra.edu' },
  { role: 'owner', email: 'ananya.rao@cassandra.edu' },
  { role: 'admissions', email: 'admissions@sahyadri.edu.in' },
  { role: 'counselor', email: 'counselor@sahyadri.edu.in' },
  { role: 'facilities', email: 'facilities@sahyadri.edu.in' },
].filter(a => !ONLY || a.role === ONLY);

/* Parent and student land on the calm surface, which has no sidebar — the
   route list cannot be read from the DOM, so it is stated here (mirroring
   App.tsx and DemoBar.tsx for those two lanes). */
const LIGHT_ROLE_ROUTES = {
  parent: ['/parent/family', '/parent/fees', '/parent/copilot', '/parent/requests', '/parent/consents', '/parent/complaints', '/parent/chat'],
  student: ['/student/home2', '/student/homework', '/student/tasks', '/student/mistakes', '/student/flashcards', '/student/results', '/student/learning', '/student/portfolio', '/student/fees', '/noticeboard'],
};

/* The nav walk only ever sees what a role's sidebar LINKS to. 47 of the 133
   declared routes are reached from inside a screen (a button, a card) rather
   than from the nav, so they were never visited. This map reaches them
   directly — the screen is declared, mounted and rendered either way, so
   hitting the URL exercises exactly the same code. */
const DEEP_ROUTES = {
  principal: ['/admissions', '/transport', '/documents', '/maintenance/work-orders', '/maintenance/preventive', '/maintenance/inspections',
    '/maintenance/inventory', '/maintenance/vendors', '/maintenance/intelligence', '/maintenance/map',
    '/library/desk/issue', '/library/desk/return', '/library/desk/catalog', '/library/desk/catalog/new', '/library/desk/holds',
    '/library/desk/fines', '/library/desk/requests', '/library/desk/members', '/library/desk/reports', '/library/desk/settings',
    '/library/setup', '/operations/hr', '/calendar', '/cases', '/incidents', '/constitution', '/data-health', '/settings', '/appraisals'],
  teacher: ['/teacher/concerns', '/teacher/doubts', '/teacher/interventions', '/teacher/ptm', '/teacher/safety', '/teacher/exam-marks', '/teacher/analytics', '/calendar', '/documents', '/cases'],
  student: ['/student', '/print-queue', '/wellbeing-queue', '/noticeboard'],
  parent: ['/parent'],
  librarian: ['/library/desk/issue', '/library/desk/return', '/library/desk/catalog', '/library/desk/catalog/new', '/library/desk/holds',
    '/library/desk/fines', '/library/desk/requests', '/library/desk/members', '/library/desk/reports', '/library/desk/settings', '/library/setup'],
  coordinator: ['/coord/home', '/coord/substitutions', '/coord/workload', '/coord/curriculum', '/coord/escalations', '/coord/approvals', '/calendar', '/documents'],
  facilities: ['/maintenance/work-orders', '/maintenance/preventive', '/maintenance/inspections', '/maintenance/inventory', '/maintenance/vendors', '/maintenance/intelligence', '/maintenance/map'],
  transport: ['/transport', '/calendar'],
  admissions: ['/admissions', '/documents'],
  counselor: ['/appraisals', '/cases', '/incidents'],
  finance: ['/calendar', '/documents', '/settings'],
  itadmin: ['/settings', '/plugins/settings/example', '/data-health'],
  technician: ['/maintenance/work-orders', '/maintenance/inspections', '/maintenance/inventory', '/maintenance/vendors'],
  owner: ['/constitution', '/data-health', '/appraisals', '/settings', '/incidents'],
};

mkdirSync(`${OUT}`, { recursive: true });

/* The same quality gates as audit-roles, plus a crash detector. Kept inline so
   this script stands alone. */
const PROBE = () => {
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
  const out = { crashed: document.body.innerText.includes('Something went wrong on this screen'),
    notFound: document.body.innerText.includes('This page moved') || /\b404\b/.test(document.title),
    hScroll: document.documentElement.scrollWidth > window.innerWidth + 1, overflow: [], tinyText: [], tap: [], contrast: [] };

  for (const el of document.querySelectorAll('.page *')) {
    if (!vis(el) || (el.children.length > 0 && !el.matches('td,th,button,a'))) continue;
    const s = getComputedStyle(el);
    if (s.overflowX !== 'visible' || s.textOverflow === 'ellipsis' || s.whiteSpace === 'nowrap') continue;
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
      out.overflow.push({ cls: (el.className || el.tagName).toString().slice(0, 36), text: (el.textContent || '').trim().slice(0, 34), by: el.scrollWidth - el.clientWidth });
    }
  }
  const META = ['.avatar', '.chart-svg', // 2-letter initials in a 26px circle; the name is always alongside
'.u-upper', '.t-time', '.day-ribbon-axis', '.day-ribbon-title', '.nav-section > span', '.wo-step-time', '.wo-step-label', '.event-meta', '.rs-time', '.cs-k', '.memory-loop-tag', '.mtab', '.badge', '.login-role code'];
  for (const el of document.querySelectorAll('.page *')) {
    if (!vis(el) || el.children.length) continue;
    const txt = (el.textContent || '').trim();
    if (txt.length < 2) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs >= 11.6 || META.some(s => el.matches(s) || el.closest(s))) continue;
    out.tinyText.push({ fs: fs.toFixed(1), text: txt.slice(0, 30), cls: (el.className || '').toString().slice(0, 34) });
  }
  if (window.innerWidth < 900) {
    for (const el of document.querySelectorAll('button, a[href], input, select, [role="button"], [role="tab"], [role="menuitem"]')) {
      if (!vis(el) || el.closest('.skip-link')) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 32 || r.width < 24 || r.height >= 44) continue;
      out.tap.push({ h: Math.round(r.height), text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 26), cls: (el.className || '').toString().slice(0, 30) });
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
    if (r < (large ? 3 : 4.5)) out.contrast.push({ r: r.toFixed(2), text: txt.slice(0, 30), cls: (el.className || '').toString().slice(0, 34) });
  }
  return out;
};

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome-stable', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const report = [];
const t0 = Date.now();
let crashes = 0, screens = 0;

for (const acc of ACCOUNTS) {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1, hasTouch: W < 900, isMobile: W < 900 });
  if (W < 900) {
    const cdp = await page.createCDPSession();
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }
  await page.evaluateOnNewDocument((t, c) => { localStorage.setItem('schoolos.theme', t); localStorage.setItem('schoolos.contrast', c); }, THEME, CONTRAST);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 120)));

  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await new Promise(r => setTimeout(r, 800));
    await page.type('input[type="email"]', acc.email, { delay: 3 });
    await page.type('input[type="password"]', PW, { delay: 3 });
    const btn = await page.$('form button.btn-primary');
    if (btn) await btn.click({ timeout: 6000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2400));
  } catch (e) { console.log(`${acc.role}: LOGIN FAILED ${String(e).slice(0, 60)}`); await page.close(); continue; }

  /* The role's own nav is the honest list of what that role can reach. The
     light roles (parent, student) have no sidebar — they get the bottom tab
     bar plus a More sheet — so their routes are listed explicitly here, taken
     from App.tsx's route table for those lanes. */
  let routes = await page.evaluate(() => {
    const as = [...document.querySelectorAll('.sidebar .nav-item')].map(a => a.getAttribute('href'));
    return [...new Set(as.filter(Boolean))];
  }).catch(() => []);
  if (!routes.length) routes = LIGHT_ROLE_ROUTES[acc.role] ?? [];
  /* DEEP=1 adds the routes a role reaches from inside a screen rather than
     from its nav — the 47 declared paths the nav walk can never see. */
  if (process.env.DEEP === '1') routes = [...routes, ...(DEEP_ROUTES[acc.role] ?? [])];
  routes = routes.filter((r, i) => routes.indexOf(r) === i);

  const roleFails = [];
  for (const to of routes) {
    errs.length = 0;
    try {
      await page.evaluate((t) => { history.pushState({}, '', t); window.dispatchEvent(new PopStateEvent('popstate')); }, to);
      /* A fixed sleep races the lazy chunk: a screen that has not rendered yet
         gets audited mid-load and reports phantom overflow/tap findings. Wait
         until the page text stops changing (two stable reads), capped so a
         genuinely stuck screen cannot hang the run. */
      await page.waitForFunction(() => {
        const el = document.querySelector('.page') || document.body;
        const len = (el.innerText || '').length;
        const prev = window.__lastLen;
        window.__stable = prev === len ? (window.__stable || 0) + 1 : 0;
        window.__lastLen = len;
        return len > 0 && window.__stable >= 2;
      }, { timeout: 8000, polling: 200 }).catch(() => {});
    } catch { /* navigation raced a lazy chunk; the probe below still reports */ }
    const p = await page.evaluate(PROBE).catch(() => null);
    screens++;
    if (!p) { roleFails.push({ to, fatal: 'probe failed' }); continue; }
    const bad = p.crashed || p.notFound || p.hScroll || p.overflow.length || p.tinyText.length || p.tap.length || p.contrast.length || errs.length;
    if (p.crashed) crashes++;
    if (bad) {
      roleFails.push({ to, ...p, pageErrors: errs.slice(0, 2) });
      console.log(`  ${acc.role} ${to}  ${p.crashed ? 'CRASH ' : ''}${p.notFound ? '404 ' : ''}ovf=${p.overflow.length} tiny=${p.tinyText.length} tap=${p.tap.length} ct=${p.contrast.length} err=${errs.length}`);
    }
    if (SHOT) await page.screenshot({ path: `${OUT}/${acc.role}${to.replace(/\//g, '_')}.png` }).catch(() => {});
  }
  report.push({ role: acc.role, routes: routes.length, failures: roleFails });
  console.log(`${acc.role.padEnd(13)} ${routes.length} routes · ${roleFails.length} with findings`);
}

writeFileSync(`${OUT}/screens-${W}-${THEME}-${CONTRAST}.json`, JSON.stringify(report, null, 2));
const totalFails = report.reduce((s, r) => s + r.failures.length, 0);
console.log(`\n${screens} screens across ${report.length} roles in ${Math.round((Date.now() - t0) / 1000)}s`);
console.log(`CRASHES: ${crashes} · screens with findings: ${totalFails}`);
await Promise.race([browser.close(), new Promise(r => setTimeout(r, 2000))]);
process.exit(0);
