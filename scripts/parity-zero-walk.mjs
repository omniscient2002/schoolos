#!/usr/bin/env node
/* Parity-zero walk: fresh school via API, UI login ONCE, then client-side sidebar
   navigation only (split-origin dev drops the memory bearer on hard reload —
   HANDOFF trap 12, so no page.goto after login). Leaves its tenant in the DB
   (truncate app.tenants CASCADE afterwards, per the itadmin-hunt rule). */
import { chromium } from '/usr/lib/code/node_modules/playwright-core/index.mjs';

const EXE = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';
const API = 'http://127.0.0.1:8080';
const UI = 'http://127.0.0.1:4310';
const U = Date.now().toString(36);
const EMAIL = `pzero-${U}@walk.test`;
const PW = `Pzero-Walk-1-${U}`;

const api = async (method, path, token, body) => {
  // GET/HEAD never carry a body (fetch refuses); other methods send '{}' when the
  // caller passes none, because the JSON parser rejects a truly empty body.
  const noBody = method === 'GET' || method === 'HEAD';
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: noBody ? undefined : JSON.stringify(body ?? {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(j).slice(0, 160)}`);
  return j;
};

// fresh school + one class + one pupil (born empty by design, so build the minimum)
const signup = await api('POST', '/onboard/signup', null,
  { schoolName: `Parity Zero Walk ${U}`, ownerName: 'Parity Walker', ownerEmail: EMAIL, ownerPassword: PW });
const ownerToken = signup.token;
await api('PUT', '/school/classes', ownerToken, { classes: [{ grade: '6', sections: ['B'] }] });
const pupil = (await api('POST', '/students', ownerToken,
  { name: 'Parity Pupil', grade: '6', section: 'B', guardianName: 'PZ Guardian', guardianPhone: '+91 9800001234' })).student;
// transport.gps is born off — enable it like the owner's Turn-on button does.
await api('POST', '/plugins/transport.gps/enable', ownerToken);

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push('pageerror: ' + e.message));

await page.goto(`${UI}/login`, { waitUntil: 'networkidle' });
await page.waitForSelector('.login-card', { timeout: 15000 });
await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PW);
await page.click('button:has-text("Sign in")');
await page.waitForTimeout(2500);

let failures = 0;
const go = async (href, clickText) => {
  // sidebar link if present, else the palette/command entry, else in-screen link
  const side = page.locator(`.sidebar-nav a[href="${href}"]`).first();
  if (await side.count()) { await side.click(); }
  else if (clickText) {
    await page.locator(`text=${clickText}`).first().waitFor({ timeout: 15000 });
    await page.locator(`text=${clickText}`).first().click();
  }
  else {
    const any = page.locator(`a[href="${href}"]`).first();
    await any.click();
  }
  await page.waitForTimeout(1200);
};
const check = async (label, href, mustContain, opts = {}) => {
  pageErrors.length = 0;
  if (opts.via) await go(opts.via);
  await go(href, opts.clickText);
  if (opts.then) await opts.then();
  const text = await page.evaluate(() => document.body.innerText);
  const crash = text.includes('Something went wrong');
  const login = await page.locator('.login-card').count();
  const missing = mustContain.filter((s) => !text.includes(s));
  const ok = !crash && !login && missing.length === 0 && pageErrors.length === 0;
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${href}${crash ? ' CRASH' : ''}${login ? ' LOGGED-OUT' : ''}${missing.length ? ` MISSING[${missing.join('|')}]` : ''}${pageErrors.length ? ` ERR[${pageErrors[0].slice(0, 100)}]` : ''}`);
  if (!ok) failures++;
};

await check('returns', '/returns', ['School infrastructure', 'Pupil–teacher ratio']);
await check('automation', '/automation', ['Starting points', 'Absence → guardian notice draft']);
await check('hr', '/operations', ['Operations']);
await check('hr-sub', '/operations/hr', ["Today's presence code", 'Mark present (office)'], { via: '/operations', clickText: 'on the roster' });
await check('transport', '/transport/setup', ['Fare rate', 'Quote a fare', 'Quarterly compliance pack']);
await check('people', '/people', ['Parity Pupil']);
await check('person', `/people/${pupil.id}`, ['APAAR ID', 'Record APAAR'], { via: '/people', clickText: 'Parity Pupil',
  then: async () => { await page.locator('text=APAAR ID').first().waitFor({ timeout: 15000 }).catch(() => {}); await page.waitForTimeout(400); } });

// safety (4.5): the wall seeds on first read; an expired verification blocks the roster.
// hr.leave is born off — enable it like the owner's Turn-on button does.
await api('POST', '/plugins/hr.leave/enable', ownerToken);
const staffId = (await api('GET', '/school/staff', ownerToken)).staff[0].id;
await api('POST', '/staff-verifications', ownerToken, { userId: staffId, verifiedOn: '2020-06-01', validYears: 1 });
await check('safety', '/safety', ['Protection wall', 'Police-verification ledger', 'Child protection committee']);
await check('hr-blocked', '/operations/hr', ['off the roster', 'verification expired'], { via: '/operations', clickText: 'on the roster',
  then: async () => { await page.locator('text=off the roster').first().waitFor({ timeout: 15000 }).catch(() => {}); await page.waitForTimeout(400); } });

console.log(failures === 0 ? 'ALL PARITY-ZERO ROUTES CLEAN' : `${failures} ROUTE(S) DIRTY`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
