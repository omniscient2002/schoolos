// fee-nfr.js · P1 NFR baselines on a scale fixture.
// Usage: TEST_DB_NAME=schoolos_feednfr FEE_NFR_STUDENTS=2000 node scripts/fee-nfr.js
// Fresh DB (setupTestDb), bulk students via SQL, then times the real doors:
// generate, late-run, dunning, reconcile, concurrent confirms, paged reads.
// Prints a baseline table (no assertions — baselines ratify SLOs, see plan §9).
import pg from 'pg';
import { setupTestDb, loginAs } from '../tests/helpers.js';

const N = Number(process.env.FEE_NFR_STUDENTS ?? 2000);
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const ms = async (fn) => { const t0 = Date.now(); const out = await fn(); return { ms: Date.now() - t0, out }; };

const app_inject = async (app, o) => app.inject(o);
async function main() {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  const app = await buildApp({ logger: false });
  await app.ready();
  const sql = async (text, params = []) => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try { return await c.query(text, params); } finally { await c.end(); }
  };
  const q = async (t, p = []) => (await sql(t, p)).rows;
  const owner = (await loginAs(app, 'owner@meridian.edu')).token;
  const tenant = (await q(`SELECT id FROM app.tenants WHERE slug='meridian'`))[0].id;
  console.log(`seeding ${N} students…`);
  {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try {
      await c.query('BEGIN');
      for (let i = 0; i < N; i += 500) {
        const vals = [];
        for (let j = 0; j < 500 && i + j < N; j++) {
          vals.push(`('${tenant}','NFR${i + j}','Bulk Student ${i + j}','9','A','Guardian ${i + j}','+91900${String(100000 + i + j).slice(-6)}')`);
        }
        await c.query(`INSERT INTO app.students (tenant_id,admission_no,name,grade,section,guardian_name,guardian_phone) VALUES ${vals.join(',')}`);
      }
      await c.query('COMMIT');
    } finally { await c.end(); }
  }
  const call = (o) => app_inject(app, o);
  const R = {};
  // plan: 3 terms x installments(3 parts), all overdue yesterday-ish
  const past = new Date(Date.now() - 40 * 864e5).toISOString().slice(0, 10);
  let r = await call({ method: 'POST', url: '/fee-plans', headers: H(owner), payload: { name: 'NFR plan', grades: ['9'],
    terms: [1, 2, 3].map((i) => ({ term: `N${i}`, label: `nfr term ${i}`, amount_cents: 300000, due_on: past })),
    installments: [{ percent: 50 }, {}] } });
  const pid = r.json().feePlan.id;
  R.generate = await ms(() => call({ method: 'POST', url: `/fee-plans/${pid}/generate`, headers: H(owner), payload: {} }));
  console.log(`generate: ${R.generate.ms}ms for ${R.generate.out.json().inserted} obligations (${R.generate.out.json().installmentsCreated} parts)`);
  // late fees
  R.late = await ms(() => call({ method: 'PUT', url: '/fees/settings', headers: H(owner), payload: { late_fee_enabled: true, late_fee_mode: 'per_day', late_fee_per_day_cents: 100, late_fee_grace_days: 0 } }).then(() =>
    call({ method: 'POST', url: '/fees/late-fees/run', headers: H(owner), payload: {} })));
  console.log(`late-run: ${R.late.ms}ms updated=${R.late.out.json().updated}`);
  // dunning
  R.dun = await ms(() => call({ method: 'POST', url: '/fees/dunning/run', headers: H(owner), payload: {} }));
  console.log(`dunning: ${R.dun.ms}ms queued=${R.dun.out.json().queued} escalated=${R.dun.out.json().escalated}`);
  // reconcile
  R.rec = await ms(() => call({ method: 'POST', url: '/payments/reconcile', headers: H(owner), payload: {} }));
  console.log(`reconcile: ${R.rec.ms}ms total=${R.rec.out.json().total}`);
  // concurrent confirms: initiate 20 then confirm in parallel
  const obs = await q(`SELECT id FROM app.fee_obligations WHERE tenant_id=$1 AND label='nfr term 1' AND status='open' LIMIT 20`, [tenant]);
  const inits = await Promise.all(obs.map((o) => call({ method: 'POST', url: '/fees/payments', headers: H(owner), payload: { obligationId: o.id, method: 'upi' } })));
  const pids = inits.map((x) => x.json().payment?.id).filter(Boolean);
  R.conf = await ms(() => Promise.all(pids.map((id) => call({ method: 'POST', url: `/fees/payments/${id}/confirm`, headers: H(owner), payload: {} }))));
  const receipts = await q(`SELECT count(*)::int n, count(DISTINCT receipt_no)::int u FROM app.fee_receipts WHERE tenant_id=$1 AND payment_id = ANY($2)`, [tenant, pids]);
  console.log(`confirm-x20 parallel: ${R.conf.ms}ms receipts=${receipts[0].n} unique=${receipts[0].u}`);
  // paged reads p50/p95 over 100 pages
  const times = [];
  for (let i = 0; i < 100; i++) {
    const t0 = Date.now();
    await call({ method: 'GET', url: `/fees/obligations?limit=100&offset=${i * 100}`, headers: H(owner) });
    times.push(Date.now() - t0);
  }
  times.sort((a, b) => a - b);
  console.log(`reads: p50=${times[50]}ms p95=${times[95]}ms over ${times.length} pages`);
  const total = await q(`SELECT (SELECT count(*) FROM app.fee_obligations WHERE tenant_id=$1) o, (SELECT count(*) FROM app.fee_installments fi JOIN app.fee_obligations fo ON fo.id=fi.obligation_id WHERE fo.tenant_id=$1) i`, [tenant]);
  console.log(`fixture: ${N} students, ${total[0].o} obligations, ${total[0].i} installments`);
  await app.close();
}
main().catch((e) => { console.error('NFR CRASH:', e); process.exit(2); });
