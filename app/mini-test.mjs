import { chromium } from '/usr/lib/code/node_modules/playwright-core/index.mjs';
const EXE = '/home/cassandra/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const page = await (await browser.newContext()).newPage();
const errs = [];
page.on('requestfailed', r => errs.push(r.url().slice(-50) + ' ' + r.failure()?.errorText));
for (let i = 0; i < 3; i++) {
  try {
    const resp = await page.goto('http://127.0.0.1:4310/login', { waitUntil: 'load', timeout: 20000 });
    console.log(`try ${i}: status=${resp?.status()} failedReq=${errs.length}`);
    await page.waitForTimeout(1000);
    const n = await page.evaluate(() => document.querySelectorAll('input').length);
    console.log(`try ${i}: inputs=${n}`);
    if (n > 0) { console.log('MINIMAL_OK'); break; }
  } catch (e) { console.log(`try ${i}: ${e.message.split('\n')[0]}`); }
  await page.waitForTimeout(1500);
}
await browser.close();
