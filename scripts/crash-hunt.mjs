#!/usr/bin/env node
/* Crash hunt: walk the staff routes as a NEW-school owner and capture which
   screen throws on the empty world. */
import { chromium } from '/usr/lib/code/node_modules/playwright-core/index.mjs';

const EXE = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';
const EMAIL = process.env.PROBE_EMAIL || 'final@probe.test';
const PASSWORD = process.env.PROBE_PW || 'final-probe-1';
const ROUTES = (process.env.PROBE_ROUTES || '/,/today,/attention,/people,/learning,/attendance,/fees,/admissions,/operations,/insights,/documents,/visitors,/maintenance,/people-admin,/library,/rails,/plugins,/settings').split(',');

const routes = ROUTES;

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') pageErrors.push('console: ' + m.text().slice(0, 200)); });

await page.goto('http://127.0.0.1:4310/', { waitUntil: 'networkidle' });
await page.waitForSelector('.login-card', { timeout: 15000 });
await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PASSWORD);
await page.click('button:has-text("Sign in")');
await page.waitForSelector('.topbar, .something-went-wrong, [class*="error"]', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1200);

for (const r of routes) {
  pageErrors.length = 0;
  try {
    await page.goto(`http://127.0.0.1:4310${r}`, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(700);
    const info = await page.evaluate(() => ({
      crash: document.body.innerText.includes('Something went wrong'),
      head: document.querySelector('main, .topbar, h1, h2')?.textContent?.trim().slice(0, 90) ?? document.body.innerText.slice(0, 90),
    }));
    if (info.crash || pageErrors.length) console.log(`   detail: crash=${info.crash} head="${info.head}" errors=${JSON.stringify(pageErrors.slice(0, 2))}`);
    const schoolName = await page.evaluate(() => document.querySelector('.sidebar-label .u-xs, .sidebar .u-xs')?.textContent?.trim() ?? null);
    console.log(`${info.crash ? '💥 CRASH' : 'ok    '} ${r}${info.crash ? ' — ' + (pageErrors[0] ?? 'boundary shown').slice(0, 130) : ''}`);
  } catch (e) {
    console.log(`💥 TIMEOUT ${r} — ${String(e.message).slice(0, 80)}`);
  }
}
await browser.close();
