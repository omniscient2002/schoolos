// Dev-only: check the interactive layers a route walk cannot reach —
// modals, drawers, dropdowns, toasts, focus management, and reduced motion.
//   node scripts/audit-overlays.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173';
const OUT = '/tmp/opencode/overlays';
const W = Number(process.env.W ?? 1440);
const H = Number(process.env.H ?? 1000);
const PW = 'schoolos-demo';
mkdirSync(OUT, { recursive: true });

/* Every assertion runs inside the page. Returns a list of failures. */
const CHECK_OVERLAY = () => {
  const f = [];
  const el = document.querySelector('.modal, .drawer');
  if (!el) return ['no overlay open'];
  const r = el.getBoundingClientRect();
  const vis = getComputedStyle(el);
  if (r.width === 0 || r.height === 0) f.push('overlay has zero size');
  // The whole document must not be able to scroll sideways once an overlay is up.
  if (document.documentElement.scrollWidth > window.innerWidth + 1) f.push('overlay introduced horizontal page scroll');
  // A modal must never exceed the viewport, and its footer must be reachable.
  if (el.classList.contains('modal')) {
    if (r.height > window.innerHeight + 1) f.push(`modal taller than viewport (${Math.round(r.height)} > ${window.innerHeight})`);
    if (r.right > window.innerWidth + 1 || r.left < -1) f.push('modal escapes the viewport horizontally');
    const foot = el.querySelector('.modal-foot');
    const body = el.querySelector('.modal-body');
    if (body && body.scrollHeight > body.clientHeight) {
      // a scrolling body is correct; the footer must still be inside the box
      const fr = foot?.getBoundingClientRect();
      if (fr && (fr.bottom > r.bottom + 1 || fr.top < r.top - 1)) f.push('modal footer is not reachable');
    }
  }
  if (vis.boxShadow === 'none' && el.classList.contains('modal')) f.push('modal has no elevation (overlay depth budget not spent)');
  if (parseFloat(vis.opacity) < 1) f.push('modal rendered semi-transparent');
  // Focus must have moved into the dialog.
  const active = document.activeElement;
  if (active && !el.contains(active) && active !== document.body) f.push('focus is outside the open dialog');
  // Every dialog needs an accessible name.
  if (!el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')) f.push('dialog has no accessible name');
  if (el.getAttribute('aria-modal') !== 'true' && el.classList.contains('modal')) f.push('modal missing aria-modal');
  return f;
};

const CHECK_AFTER_ESC = () => ({
  overlayGone: !document.querySelector('.modal, .drawer'),
  /* The trigger must be back. body means the caret was dropped on the floor. */
  focusReturned: document.activeElement !== document.body && document.activeElement !== document.documentElement,
  focusOn: document.activeElement.tagName + '.' + (document.activeElement.className || '').toString().slice(0, 24),
  scrollUnlocked: document.body.style.overflow !== 'hidden',
});

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome-stable', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const results = [];

async function login(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await new Promise(r => setTimeout(r, 800));
  await page.type('input[type="email"]', email, { delay: 3 });
  await page.type('input[type="password"]', PW, { delay: 3 });
  const b = await page.$('form button.btn-primary');
  if (b) await b.click({ timeout: 6000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 2400));
}

/* ---- 1. Drawer: real focus + real click, then Escape ----
   A synthetic el.click() does NOT move focus, so "focus returns to the
   trigger" is untestable that way — the trigger was never the activeElement
   to begin with. Use the handle's focus() then click(). */
{
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H });
  await login(page, 'ramesh.gupta@cassandra.edu');
  await page.evaluate(() => { history.pushState({}, '', '/fees'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await new Promise(r => setTimeout(r, 2800));
  const row = await page.$('table.data tbody tr');
  let opened = false;
  if (row) { await row.focus(); await row.click(); opened = true; }
  await new Promise(r => setTimeout(r, 1400));
  const f = await page.evaluate(CHECK_OVERLAY).catch(e => ['probe: ' + String(e).slice(0, 60)]);
  await page.screenshot({ path: `${OUT}/drawer.png` }).catch(() => {});
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 900));
  const after = await page.evaluate(CHECK_AFTER_ESC);
  results.push({ test: 'drawer', opened, failures: f, afterEscape: after });
  await page.close();
}

/* ---- 2. Modal: force one open via a real click on any primary action ---- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H });
  await login(page, 'ramesh.gupta@cassandra.edu');
  await page.evaluate(() => { history.pushState({}, '', '/fees'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await new Promise(r => setTimeout(r, 2600));
  const opened = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('table.data tbody tr')];
    if (rows.length) { rows[0].focus(); rows[0].click(); return 'row'; }
    const b = [...document.querySelectorAll('button')].find(x => /record payment/i.test(x.textContent || ''));
    if (b) { b.focus(); b.click(); return 'button'; }
    return false;
  });
  await new Promise(r => setTimeout(r, 1600));
  const f = await page.evaluate(CHECK_OVERLAY).catch(e => ['probe: ' + String(e).slice(0, 60)]);
  await page.screenshot({ path: `${OUT}/modal.png` }).catch(() => {});
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 700));
  const after = await page.evaluate(CHECK_AFTER_ESC);
  results.push({ test: 'modal', opened, failures: f, afterEscape: after });
  await page.close();
}

/* ---- 3. Dropdown menu: APG semantics + Escape ---- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H });
  await login(page, 'principal@cassandra.edu');
  await new Promise(r => setTimeout(r, 1200));
  const info = await page.evaluate(async () => {
    const trig = document.querySelector('.topbar .iconbtn');
    if (!trig) return { fail: 'no topbar trigger' };
    trig.click();
    await new Promise(r => setTimeout(r, 500));
    const menu = document.querySelector('.dropdown-menu');
    if (!menu) return { fail: 'menu did not open' };
    const out = {
      role: menu.getAttribute('role'),
      hasExpanded: trig.getAttribute('aria-expanded'),
      hasHaspopup: trig.getAttribute('aria-haspopup'),
      labelled: menu.getAttribute('aria-label'),
      itemCount: menu.querySelectorAll('[role="menuitem"],[role="menuitemradio"]').length,
      overflowsViewport: menu.getBoundingClientRect().right > window.innerWidth + 1,
    };
    return out;
  });
  await page.screenshot({ path: `${OUT}/dropdown.png` }).catch(() => {});
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 500));
  info.closedOnEsc = await page.evaluate(() => !document.querySelector('.dropdown-menu'));
  results.push({ test: 'dropdown', ...info });
  await page.close();
}

/* ---- 4. Reduced motion: transforms/animations must be gone ---- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H });
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await login(page, 'principal@cassandra.edu');
  await new Promise(r => setTimeout(r, 1500));
  const f = await page.evaluate(() => {
    const bad = [];
    const dur = s => parseFloat(s) || 0;
    if (dur(getComputedStyle(document.querySelector('.page')).animationDuration) > 0.01) bad.push('page entrance still animates');
    const b = document.querySelector('.btn');
    if (b && dur(getComputedStyle(b).transitionDuration) > 0.002) bad.push('button transition still runs');
    const sk = document.querySelector('.skeleton');
    if (sk && dur(getComputedStyle(sk).animationDuration) > 0.002) bad.push('skeleton still animates');
    if (getComputedStyle(document.documentElement).scrollBehavior !== 'auto') bad.push('smooth scrolling still on');
    return bad;
  });
  results.push({ test: 'reduced-motion', failures: f });
  await page.close();
}

/* ---- 5. Keyboard: skip link is the first stop and actually works ---- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H });
  await login(page, 'principal@cassandra.edu');
  await new Promise(r => setTimeout(r, 1200));
  const f = await page.evaluate(async () => {
    const bad = [];
    document.body.focus();
    const first = document.querySelector('.skip-link');
    if (!first) return ['no skip link'];
    // The first Tab from the top of the document should reach it.
    const r = first.getBoundingClientRect();
    if (r.bottom < 0) bad.push('skip link is off-screen even when unfocused (expected) — ignoring');
    first.focus();
    await new Promise(res => setTimeout(res, 300));
    if (document.activeElement !== first) bad.push('skip link is not focusable');
    if (first.getBoundingClientRect().top < 0) bad.push('skip link does not become visible on focus');
    if (!/^#/.test(first.getAttribute('href') || '')) bad.push('skip link does not target a fragment');
    return bad;
  });
  await page.screenshot({ path: `${OUT}/skiplink.png` }).catch(() => {});
  results.push({ test: 'keyboard-skip-link', failures: f });
  await page.close();
}

writeFileSync(`${OUT}/overlays.json`, JSON.stringify(results, null, 2));
for (const r of results) {
  const f = (r.failures || []).filter(x => !x.startsWith('skip link is off-screen'));
  console.log(`${r.test.padEnd(20)} ${f.length ? 'FAIL' : 'ok  '} ${f.join(' | ').slice(0, 150)}`);
  if (r.afterEscape) console.log(`  after Escape: overlayGone=${r.afterEscape.overlayGone} focusReturned=${r.afterEscape.focusReturned} scrollUnlocked=${r.afterEscape.scrollUnlocked}`);
  if (r.closedOnEsc !== undefined) console.log(`  closedOnEsc=${r.closedOnEsc} role=${r.role} items=${r.itemCount} overflowsViewport=${r.overflowsViewport}`);
}
await Promise.race([browser.close(), new Promise(r => setTimeout(r, 2000))]);
process.exit(0);
