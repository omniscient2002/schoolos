/* Walk all routes as a freshly-created IT admin on the live dev stack. */
import { chromium } from '/usr/lib/code/node_modules/playwright-core/index.mjs';
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';
const API = 'http://127.0.0.1:8080';
const U = Date.now().toString(36);

// 1. signup school
const su = await fetch(API + '/onboard/signup', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.99.0.1' },
  body: JSON.stringify({ schoolName: 'IT Hunt ' + U, ownerName: 'Hunt Owner', ownerEmail: `owner-${U}@ithunt.test`, ownerPassword: 'hunt-pass-1' }) });
const suBody = await su.json();
console.log('signup:', su.status, suBody.user?.role);
const ownerTok = suBody.token;

// 2. owner creates itadmin via the People console door (temp password returned)
const cu = await fetch(API + '/plugins/people.admin/users', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${ownerTok}` },
  body: JSON.stringify({ name: 'Ivy Admin', email: `ivy-${U}@ithunt.test`, role: 'itadmin' }) });
const cuBody = await cu.json().catch(() => ({}));
console.log('create user:', cu.status, cuBody.tempPassword ? 'temp issued' : JSON.stringify(cuBody).slice(0, 120));
const tempPw = cuBody.tempPassword;

// 3. login as itadmin
const li = await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: `ivy-${U}@ithunt.test`, password: tempPw }) });
const liBody = await li.json();
console.log('itadmin login:', li.status, liBody.role ?? '');
const tok = liBody.token;

// 4. browser-walk every staff route
const ROUTES = ['/', '/today', '/group', '/ask', '/people', '/people-admin', '/operations', '/attention', '/learning', '/attendance',
  '/fees', '/admissions', '/visitors', '/library', '/transport', '/maintenance', '/calendar', '/documents', '/cases', '/incidents',
  '/insights', '/automation', '/action-center', '/audit', '/memory', '/data-health', '/ai-governance', '/ai-usage', '/it', '/settings',
  '/plugins', '/settings', '/migration', '/reception', '/noticeboard', '/print-queue', '/wellbeing-queue', '/operations/hr', '/next', '/coord', '/constitution'];
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', e => console.log('PAGEERROR on', page.url(), '→', String(e.message).slice(0, 200)));
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE-ERR', m.text().slice(0, 200)); });
let bad = 0;
/* browser-side login: the login card stores token+session, exactly like the user */
await page.goto('http://127.0.0.1:4310/', { waitUntil: 'networkidle' });
await page.waitForSelector('.login-card', { timeout: 15000 });
await page.fill('input[type="email"]', `ivy-${U}@ithunt.test`);
await page.fill('input[type="password"]', tempPw);
await page.click('button:has-text("Sign in")');
await page.waitForTimeout(2500);
for (const r of ROUTES) {
  await page.goto('http://127.0.0.1:4310' + r, { waitUntil: 'networkidle', timeout: 20000 }).catch(e => console.log('NAV-FAIL', r, String(e.message).slice(0, 80)));
  await page.waitForTimeout(350);
  const crash = await page.locator('text=Something went wrong on this screen').count();
  const gate = await page.locator('text=switched off').count();
  const who = await page.locator('.login-card').count();
  if (crash) { bad++; console.log('💥 CRASH', r); }
  else if (who) console.log('→ logout-redirect', r);
  else if (gate) console.log('⊂ gated', r);
  else console.log('ok', r);
}
await browser.close();
console.log(bad === 0 ? 'ALL ROUTES CLEAN' : `${bad} routes crashed`);
// leave the tenant for inspection
