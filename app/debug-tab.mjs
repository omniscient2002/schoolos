import { chromium } from '/usr/lib/code/node_modules/playwright-core/index.mjs';
const EXE = '/home/cassandra/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
const page = await (await browser.newContext()).newPage();
await page.goto('http://127.0.0.1:4310/login', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.login-form input[type="email"]');
await page.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur(); });
for (let i = 0; i < 9; i++) {
  await page.keyboard.press('Tab', { retry: true });
  await page.waitForTimeout(80);
  const info = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return '(body)';
    const cs = getComputedStyle(el);
    return `<${el.tagName.toLowerCase()}> class="${(el.className || '').toString()}" text="${(el.textContent || '').trim().slice(0, 12)}" outline=${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}`;
  });
  console.log(`tab ${i + 1}: ${info}`);
}
await browser.close();
