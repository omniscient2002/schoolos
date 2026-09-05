// REDTEAM PoC (tests-rt) — DOM dump sweep: does the SPA render stored <img onerror> payloads raw?
import { chromium } from 'playwright-core';
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const page = await browser.newPage();
const r = await fetch('http://127.0.0.1:8080/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'principal@meridian.edu', password: 'schoolos-demo' }) }).then(r => r.json());
await page.addInitScript(t => localStorage.setItem('schoolos_token', t), r.token);
page.on('dialog', async d => { console.log('*** DIALOG FIRED (XSS EXECUTED):', d.message()); await d.dismiss(); });
for (const path of ['/people', '/live', '/action-center', '/']) {
  try {
    await page.goto('http://127.0.0.1:4310' + path, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const html = await page.content();
    console.log(path.padEnd(14), '| raw <img payload in DOM:', html.includes('<img src=x'), '| escaped present:', html.includes('&lt;img'), '| title:', await page.title());
  } catch (e) { console.log(path, 'ERR', e.message.slice(0, 80)); }
}
await browser.close();
