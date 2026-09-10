// L2 diagnostic (T201): reproduce the visitors pickup 500 with the full error
// stack. Boots the real app against a prepared schoolos_test, adds an onError hook
// (before ready) so fastify hands us the exact thrown error, then walks the
// door flow. Read-only for the repo; test-db writes are the suite's own pattern.
process.env.OTP_DEV_ECHO = '1';
import pg from 'pg';

process.env.DATABASE_URL = process.env.PROBE_URL; // before src imports (config reads at import time)

const { buildApp } = await import('./src/app.js');
const app = await buildApp({ logger: false });
app.addHook('onError', async (req, reply, err) => {
  console.error(`ONERROR ${req.method} ${req.url} → ${err.message} (code ${err.code ?? '-'})`);
  console.error(err.stack?.split('\n').slice(0, 6).join('\n'));
});
await app.ready();

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const sql = async (text, params = []) => {
  const c = new pg.Client({ connectionString: process.env.PROBE_URL });
  await c.connect(); const r = await c.query(text, params); await c.end(); return r;
};
const login = async (email) => {
  const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'schoolos-demo' } });
  if (r.statusCode !== 200) throw new Error(`login ${email}: ${r.statusCode} ${r.body.slice(0, 120)}`);
  return r.json();
};

const o = await login('owner@meridian.edu');
const en = await app.inject({ method: 'POST', url: '/plugins/ops.visitors/enable', headers: H(o.token), payload: { version: '1.0.0', class: 'C' } });
console.log('enable:', en.statusCode);
const co = await login('coordinator@meridian.edu');
const student = (await sql(`SELECT s.id FROM app.students s JOIN app.guardians g ON g.student_id=s.id AND g.is_primary AND g.phone IS NOT NULL LIMIT 1`)).rows[0];
const r = await app.inject({ method: 'POST', url: '/plugins/ops.visitors/visitors', payload: { visitorName: 'Probe Uncle', visitorPhone: '9876500099', purpose: 'pickup', studentId: student.id }, headers: H(co.token) });
console.log('log visit:', r.statusCode);
const visit = r.json().visitId;
const ci = await app.inject({ method: 'POST', url: `/plugins/ops.visitors/visitors/${visit}/checkin`, payload: {}, headers: H(co.token) });
console.log('checkin:', ci.statusCode);
const p = await app.inject({ method: 'POST', url: `/plugins/ops.visitors/visitors/${visit}/pickup`, payload: {}, headers: H(co.token) });
console.log('pickup:', p.statusCode, p.body.slice(0, 200));
process.exit(0);
