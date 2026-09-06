// Red-team UI spot-audit — SchoolOS login → /today, /ask at 390px & 768px.
// Rerunnable evidence script (report artifact). READ-ONLY on the app.
import { chromium } from '/usr/lib/code/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';

const EXE = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';
const BASE = 'http://127.0.0.1:4310';
const SHOTS = new URL('./redteam-shots/', import.meta.url).pathname;
fs.mkdirSync(SHOTS, { recursive: true });

const findings = [];
const push = (v, path, w, txt) => findings.push({ viewport: v, path, width: Math.round(w), text: txt.slice(0, 60) });

function auditPage(v) {
  return () => {
    const out = {};
    const se = document.scrollingElement;
    out.hOverflow = se.scrollWidth - se.clientWidth;
    // horizontal offenders
    out.offenders = [...document.querySelectorAll('body *')]
      .filter(el => el.offsetParent !== null)
      .map(el => ({ r: el.getBoundingClientRect(), tag: el.tagName + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '') }))
      .filter(x => x.r.right > window.innerWidth + 1 && x.r.width > 4)
      .slice(0, 6).map(x => ({ sel: x.tag, right: Math.round(x.r.right), w: Math.round(x.r.width) }));
    // clipped .stat .value
    out.clippedStats = [...document.querySelectorAll('.stat .value')]
      .filter(el => el.offsetParent !== null)
      .filter(el => el.scrollWidth > el.clientWidth + 1)
      .map(el => ({ txt: el.textContent.trim().slice(0, 30), sw: el.scrollWidth, cw: el.clientWidth }));
    // squished text: >14 chars rendered under 58px wide
    [...document.querySelectorAll('body *')].forEach(el => {
      if (el.offsetParent === null || el.children.length > 0) return;
      const t = (el.textContent || '').trim();
      if (t.length > 14) { const r = el.getBoundingClientRect(); if (r.width > 0 && r.width < 58) push(v, location.pathname, r.width, t); }
    });
    // overlapping visible rows (non-ancestor pairs with >35% mutual overlap)
    const els = [...document.querySelectorAll('main *')].filter(el => el.offsetParent !== null && el.children.length <= 3);
    const rects = els.map(el => ({ el, r: el.getBoundingClientRect() })).filter(x => x.r.width > 20 && x.r.height > 10).slice(0, 250);
    const overlaps = [];
    outer: for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i].r, b = rects[j].r;
      const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ix > 4 && iy > 4) {
        if (rects[i].el.contains(rects[j].el) || rects[j].el.contains(rects[i].el)) continue;
        const area = Math.min(a.width * a.height, b.width * b.height);
        if ((ix * iy) / area > 0.35) { overlaps.push({ a: a.width + 'x' + a.height, b: b.width + 'x' + b.height }); if (overlaps.length > 8) break outer; }
      }
    }
    out.overlaps = overlaps;
    return out;
  };
}

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 150)); });

// 1. login via the form
await page.goto(BASE + '/login', { waitUntil: 'load' });
await page.fill('input[type="email"]', 'principal@meridian.edu');
await page.fill('input[type="password"]', 'schoolos-demo');
await page.click('.login-form button.btn-primary');
try {
  await page.waitForFunction(() => !!localStorage.getItem('schoolos_token'), null, { timeout: 15000 });
} catch {
  const err = await page.evaluate(() => document.querySelector('.login-error')?.textContent ?? null);
  await page.screenshot({ path: SHOTS + 'login-stuck.png' });
  console.log('LOGIN_STUCK', JSON.stringify({ err, url: page.url() }));
}
await page.waitForTimeout(1500);
const postLoginUrl = await page.evaluate(() => location.pathname);
console.log('POST_LOGIN_URL', postLoginUrl);
const storage = await page.evaluate(() => ({
  token: localStorage.getItem('schoolos_token')?.slice(0, 40) + '…',
  session: localStorage.getItem('schoolos.session')?.slice(0, 120),
}));
console.log('STORAGE_AFTER_LOGIN', JSON.stringify(storage));

// 2. audit pages at both viewports
for (const v of [390, 768]) {
  await page.setViewportSize({ width: v, height: v === 390 ? 844 : 1024 });
  for (const p of ['/today', '/ask']) {
    await page.goto(BASE + p, { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    const res = await page.evaluate(auditPage(v));
    await page.screenshot({ path: SHOTS + v + p.replaceAll('/', '_') + '.png', fullPage: false });
    console.log('AUDIT', v, p, JSON.stringify(res));
  }
}

// 3. persistence: close the tab, open a new one in the same context
await page.close();
const page2 = await ctx.newPage();
await page2.goto(BASE + '/today', { waitUntil: 'load' });
await page2.waitForTimeout(1200);
const stillIn1 = await page2.evaluate(() => ({ url: location.pathname, token: !!localStorage.getItem('schoolos_token') }));
console.log('AFTER_TAB_CLOSE_REOPEN', JSON.stringify(stillIn1));

// 4. persistence: simulated browser relaunch via storageState
const state = await ctx.storageState();
const ctx2 = await browser.newContext({ storageState: state, viewport: { width: 390, height: 844 } });
const page3 = await ctx2.newPage();
await page3.goto(BASE + '/today', { waitUntil: 'load' });
await page3.waitForTimeout(1200);
const stillIn2 = await page3.evaluate(() => ({ url: location.pathname, token: !!localStorage.getItem('schoolos_token'), bodyHasLogin: !!document.querySelector('.login-card') }));
console.log('AFTER_SIMULATED_RELAUNCH', JSON.stringify(stillIn2));
await browser.close();

fs.writeFileSync(SHOTS + 'squished-text.json', JSON.stringify(findings, null, 2));
console.log('SQUISHED_TEXT_COUNT', findings.length, JSON.stringify(findings.slice(0, 10)));
console.log('JS_ERRORS', JSON.stringify(errors.slice(0, 10)));
