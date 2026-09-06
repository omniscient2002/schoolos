import { chromium } from '/usr/lib/code/node_modules/playwright-core/index.mjs';
const EXE = '/home/cassandra/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
const page = await (await browser.newContext()).newPage();
await page.goto('http://127.0.0.1:4310/login', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.seg-btn');
await page.waitForTimeout(600);
const info = await page.evaluate(() => {
  const seg = document.querySelector('.seg');
  const btn = document.querySelector('.seg-btn');
  const cs = getComputedStyle(btn);
  return {
    segRole: seg.getAttribute('role'),
    segHTML: seg.outerHTML.slice(0, 300),
    btnTabindex: btn.getAttribute('tabindex'),
    btnTabIndexProp: btn.tabIndex,
    btnDisabled: btn.disabled,
    btnVisible: btn.checkVisibility ? btn.checkVisibility() : 'n/a',
    btnDisplay: cs.display, btnVisibility: cs.visibility,
    segInert: seg.inert, segAriaHidden: seg.getAttribute('aria-hidden'),
    parentInertChain: (() => { let n = btn, out = []; while (n && n !== document.body) { if (n.inert) out.push(n.tagName + '.' + n.className); n = n.parentElement; } return out; })(),
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
