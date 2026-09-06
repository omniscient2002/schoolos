import { chromium } from '/usr/lib/code/node_modules/playwright-core/index.mjs';
const EXE = '/home/cassandra/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
const page = await (await browser.newContext()).newPage();
await page.goto('http://127.0.0.1:4310/login', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.login-form input[type="email"]');
const snap = () => page.evaluate(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return '(body)';
  const cs = getComputedStyle(el);
  return `<${el.tagName.toLowerCase()}> class="${(el.className || '').toString()}" text="${(el.textContent || '').trim().slice(0, 10)}" outline=${cs.outlineWidth} ${cs.outlineStyle}`;
});
await page.focus('.login-form input[type="email"]');
console.log('start:', await snap());
await page.keyboard.press('Shift+Tab'); await page.waitForTimeout(80);
console.log('shift+tab 1:', await snap());
await page.keyboard.press('Shift+Tab'); await page.waitForTimeout(80);
console.log('shift+tab 2:', await snap());
// if we are on a seg-btn, try arrows
const cls = await page.evaluate(() => (document.activeElement?.className || ''));
if (cls.includes('seg-btn')) {
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(80);
  console.log('arrow-right:', await snap());
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(80);
  console.log('arrow-right 2:', await snap());
}
await browser.close();
