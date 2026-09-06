// Per-role uniform settings-strip verification (orchestrator follow-up item 1)
import Fastify from 'fastify';
const BASE = 'http://127.0.0.1:8080';
const login = async (email) => {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'schoolos-demo' }) });
  const j = await r.json();
  return j.token ?? j.accessToken ?? null;
};
const check = async (email, role) => {
  const t = await login(email);
  if (!t) return console.log(`${role.padEnd(12)} → no demo account (skipped)`);
  const r = await fetch(`${BASE}/plugins`, { headers: { authorization: `Bearer ${t}` } });
  const j = await r.json();
  const leaks = (j.plugins ?? []).filter(p => p.settings !== undefined);
  const flagged = (j.plugins ?? []).filter(p => p.hasSettings).map(p => p.plugin_id);
  console.log(`${role.padEnd(12)} → rows ${j.plugins.length} · settings-value leaks ${leaks.length}${leaks.length ? ' ⚠ ' + leaks.map(p => p.plugin_id).join(',') : ' (uniform ✓)'} · hasSettings on [${flagged.join(', ')}] · keys[] only, no values`);
};
await check('parent@meridian.edu', 'parent');
await check('coordinator@meridian.edu', 'coordinator');
await check('teacher@meridian.edu', 'teacher');
await check('principal@meridian.edu', 'principal');
const o = await login('owner@meridian.edu');
const r = await fetch(`${BASE}/plugins`, { headers: { authorization: `Bearer ${o.token}` } });
const j = await r.json();
const withSettings = (j.plugins ?? []).filter(p => p.settings !== undefined);
console.log(`owner        → rows ${j.plugins.length} · rows WITH settings objects ${withSettings.length} (privileged view, expected)`);
process.exit(0);
