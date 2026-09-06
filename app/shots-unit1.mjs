import { chromium } from '/usr/lib/code/node_modules/playwright-core/index.mjs';

const EXE = '/home/cassandra/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';
const BASE = 'http://127.0.0.1:4310';
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();

await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.login-form input[type="email"]', { timeout: 15000 });
await page.fill('.login-form input[type="email"]', 'principal@meridian.edu');
await page.fill('.login-form input[type="password"]', 'schoolos-demo');
await page.click('.login-form .btn-primary');
try {
  await page.waitForSelector('.page-head', { timeout: 25000 });
} catch {
  // if already authenticated, /login bounces to the app — accept that too
  await page.goto(BASE + '/today', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.page-head', { timeout: 20000 });
}
console.log('LOGIN_OK url=', page.url());
await page.waitForTimeout(900);
await page.screenshot({ path: '/home/cassandra/schoolOS/logs/shot-today-1920.png' });

const probe = await page.evaluate(() => {
  const out = {};
  const h1 = document.querySelector('.page-head h1');
  if (h1) {
    const cs = getComputedStyle(h1);
    out.h1LetterSpacing = cs.letterSpacing;
    out.h1FontWeight = cs.fontWeight;
    out.h1AfterDisplay = getComputedStyle(h1, '::after').display;
    out.h1AfterBg = getComputedStyle(h1, '::after').backgroundImage.slice(0, 90);
    out.h1AfterRadius = getComputedStyle(h1, '::after').borderRadius;
    out.h1AfterSize = getComputedStyle(h1, '::after').width + ' x ' + getComputedStyle(h1, '::after').height;
  }
  const h2 = document.querySelector('.section-title h2');
  if (h2) {
    const cs = getComputedStyle(h2);
    out.h2BorderLeft = cs.borderLeftWidth + ' ' + cs.borderLeftStyle + ' ' + cs.borderLeftColor;
    out.h2LetterSpacing = cs.letterSpacing;
  }
  const btn = document.querySelector('.btn-primary');
  if (btn) {
    const cs = getComputedStyle(btn);
    out.btnBgImage = cs.backgroundImage.slice(0, 110);
    out.btnBgColor = cs.backgroundColor;
    out.btnHeight = cs.height;
    out.btnRadius = cs.borderRadius;
  }
  const card = document.querySelector('.card');
  if (card) out.cardShadow = getComputedStyle(card).boxShadow.slice(0, 120);
  const click = document.querySelector('.card-click');
  if (click) out.cardClickTransition = getComputedStyle(click).transition.slice(0, 200);
  return out;
});
console.log(JSON.stringify(probe, null, 2));

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(600);
await page.screenshot({ path: '/home/cassandra/schoolOS/logs/shot-today-390.png' });
await browser.close();
console.log('SHOTS_DONE');
