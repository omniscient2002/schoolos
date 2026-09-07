#!/usr/bin/env node
/* Factory verification bar — one command, the whole product.
   Usage: node scripts/factory-check.mjs [--quick]
   Exit 0 = green. Any failure exits 1 with the failing section. */
import { spawnSync } from 'node:child_process';
import { chromium } from '/usr/lib/code/node_modules/playwright-core/index.mjs';
const ROOT = new URL('..', import.meta.url).pathname;
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';
const ok = (name, pass, detail = '') => { console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); if (!pass) process.exitCode = 1; };

/* 1 — TypeScript */
const tsc = spawnSync('npx', ['tsc', '--noEmit', '-p', 'tsconfig.app.json'], { cwd: ROOT + 'app', encoding: 'utf8', timeout: 180000 });
ok('tsc clean', tsc.status === 0, (tsc.stdout.match(/error TS/g) || []).length + ' errors');

/* 2 — server tests */
if (!process.argv.includes('--quick')) {
  const t = spawnSync('npm', ['test'], { cwd: ROOT + 'server', encoding: 'utf8', timeout: 700000 });
  const pass = (t.stdout.match(/ℹ pass (\d+)/) || [])[1];
  const fail = (t.stdout.match(/ℹ fail (\d+)/) || [])[1];
  ok('server tests', fail === '0' && Number(pass) >= 25, `${pass ?? '?'} pass / ${fail ?? '?'} fail`);
}

/* 3 — UI: auth lifecycle + responsive audit */
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:4310/', { waitUntil: 'networkidle' });
  await page.waitForSelector('.login-card, .topbar', { timeout: 15000 });
  ok('cold open → Login', await page.evaluate(() => !!document.querySelector('.login-card')));
  await page.fill('input[type="email"]', 'principal@meridian.edu');
  await page.fill('input[type="password"]', 'schoolos-demo');
  await page.click('button:has-text("Sign in")');
  await page.waitForSelector('.topbar', { timeout: 12000 });
  ok('login → dashboard', true);
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  ok('refresh keeps session', await page.evaluate(() => !!document.querySelector('.topbar')));
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const p2 = await ctx2.newPage();
  await p2.goto('http://127.0.0.1:4310/', { waitUntil: 'networkidle' }); await p2.waitForTimeout(400);
  ok('fresh browser → Login', await p2.evaluate(() => !!document.querySelector('.login-card')));
  await ctx2.close();

  if (!process.argv.includes('--quick')) {
    let bad = 0;
    for (const w of [1920, 1440, 1024, 768, 390]) {
      await page.setViewportSize({ width: w, height: 1100 });
      for (const r of ['/today', '/attention', '/ask', '/automation', '/memory', '/maintenance']) {
        await page.goto('http://127.0.0.1:4310' + r, { waitUntil: 'networkidle' }); await page.waitForTimeout(450);
        const issues = await page.evaluate(() => {
          const out = [];
          if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 2) out.push('h-overflow');
          document.querySelectorAll('.stat .value').forEach(v => { if (v.scrollWidth > v.clientWidth + 2) out.push('kpi-clip'); });
          document.querySelectorAll('main span, main div').forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.width < 58 && el.textContent && el.textContent.trim().length > 14 && el.children.length === 0) out.push('squished');
          });
          return out;
        });
        bad += issues.length;
      }
    }
    ok('responsive sweep (5×6)', bad === 0, bad + ' issues');
  }
  ok('zero page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally { await browser.close(); }
