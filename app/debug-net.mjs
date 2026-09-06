import { chromium } from '/usr/lib/code/node_modules/playwright-core/index.mjs';
const EXE = '/home/cassandra/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const page = await (await browser.newContext()).newPage();
const seen = new Map();
page.on('response', r => {
  if (r.status() === 401 || r.status() === 404) {
    const k = `${r.status()} ${r.url()}`;
    seen.set(k, (seen.get(k) || 0) + 1);
  }
});
page.on('framenavigated', f => { if (f === page.mainFrame()) console.log('NAV ->', f.url()); });
await page.goto('http://127.0.0.1:4310/login', { waitUntil: 'load', timeout: 20000 }).catch(e => console.log('goto err', e.message.split('\n')[0]));
await page.waitForTimeout(6000);
console.log('--- non-2xx/3xx responses ---');
for (const [k, v] of seen) console.log(`${v}x  ${k}`);
await browser.close();
