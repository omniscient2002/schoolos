import { chromium } from '/usr/lib/code/node_modules/playwright-core/index.mjs';

const EXE = '/home/cassandra/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE', m.type(), m.text().slice(0, 200)); });
page.on('requestfailed', r => console.log('REQFAIL', r.url().slice(0, 120), r.failure()?.errorText));
await page.goto('http://127.0.0.1:4310/login', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
console.log('url=', page.url());
const info = await page.evaluate(() => ({
  segBtns: [...document.querySelectorAll('.seg-btn')].map(b => b.textContent + (b.className.includes('active') ? '*' : '')),
  forms: document.querySelectorAll('.login-form').length,
  emailInputs: document.querySelectorAll('input[type="email"]').length,
  telInputs: document.querySelectorAll('input[type="tel"]').length,
  bodyStart: document.body.innerText.slice(0, 400).replace(/\n+/g, ' | '),
}));
console.log(JSON.stringify(info, null, 2));
await browser.close();
