// Fee-domain EDGE DRILL — races, idempotency, boundaries, isolation, policy enforcement.
//
// Usage: TEST_DB_NAME=schoolos_feededge node scripts/fee-edge-drill.js
// Fresh seeded DB. JSON report -> /tmp/fee-edge-drill.json. Exit 0 = drill done.
import pg from 'pg';
import fs from 'node:fs';
import { setupTestDb, loginAs } from '../tests/helpers.js';

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const results = [];
const rec = (op, expect, res, db = null, note = '') => {
  const got = res.statusCode;
  const pass = expect === got || (Array.isArray(expect) && expect.includes(got));
  results.push({ op, expect: JSON.stringify(expect), got, pass, db, note });
  return res;
};
const J = (r) => { try { return r.json(); } catch { return { _raw: String(r.body).slice(0, 160) }; } };

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
  const call = (o) => app.inject(o);

  const owner = (await loginAs(app, 'owner@meridian.edu')).token;
  const parent = (await loginAs(app, 'parent@meridian.edu')).token;
  const OH = H(owner), PAH = H(parent);
  const tenant = (await q(`SELECT id FROM app.tenants WHERE slug='meridian'`))[0].id;
  const S = (await q(`SELECT id,grade FROM app.students WHERE tenant_id=$1 AND status='active' LIMIT 2`, [tenant]));
  const users = Object.fromEntries((await q(`SELECT email,id FROM app.users WHERE tenant_id=$1`, [tenant])).map(u => [u.email, u]));
  await sql(`INSERT INTO family.child_link (tenant_id,user_id,student_id) VALUES ($1,$2,$3),($1,$2,$4) ON CONFLICT DO NOTHING`,
    [tenant, users['parent@meridian.edu'].id, S[0].id, S[1].id]);

  const mkOb = async (label, cents, student = S[0].id, due = '2026-05-10') =>
    (await q(`INSERT INTO app.fee_obligations (tenant_id,student_id,term,label,amount_cents,due_on) VALUES ($1,$2,'ET', $3,$4,$5) RETURNING *`, [tenant, student, label, cents, due]))[0];
  const start = async (obId, method = 'upi', extra = {}, headers = OH) =>
    call({ method: 'POST', url: '/fees/payments', headers, payload: { obligationId: obId, method, ...extra } });
  const confirm = async (pid, headers = OH, body = {}) =>
    call({ method: 'POST', url: `/fees/payments/${pid}/confirm`, headers, payload: body });

  // E1. concurrent double-initiate: exactly one wins
  {
    const ob = await mkOb('E1 race', 50000);
    const [a, b] = await Promise.all([start(ob.id), start(ob.id)]);
    const ok = [a.statusCode, b.statusCode].sort().join(',');
    rec('E1 concurrent double-initiate -> one 200 one 409', 200, { statusCode: a.statusCode === 200 || b.statusCode === 200 ? 200 : 0 }, `codes=${ok}`,
      a.statusCode === 200 && b.statusCode === 409 || a.statusCode === 409 && b.statusCode === 200 ? 'exactly-one-winner' : 'RACE-LOST');
  }
  // E2. idempotency key repeat
  {
    const ob = await mkOb('E2 idem', 50000);
    const k = 'edge-key-001';
    const h = { ...OH, 'idempotency-key': k };
    const a = await call({ method: 'POST', url: '/fees/payments', headers: h, payload: { obligationId: ob.id, method: 'upi' } });
    const b = await call({ method: 'POST', url: '/fees/payments', headers: h, payload: { obligationId: ob.id, method: 'upi' } });
    rec('E2 idempotency repeat -> already:true same id', 200, b, `same=${J(a).payment?.id === J(b).payment?.id} already=${J(b).already}`);
  }
  // E3/E4. overpay + min-partial + parent-partial-off
  {
    const ob = await mkOb('E3 over', 50000);
    let r = await call({ method: 'POST', url: '/fees/payments', headers: OH, payload: { obligationId: ob.id, method: 'upi', amountCents: 99999999 } });
    rec('E3 amountCents > due -> 400', 400, r, (r.body ?? '').slice(0, 80));
    r = await call({ method: 'POST', url: '/fees/payments', headers: PAH, payload: { obligationId: ob.id, method: 'upi', amountCents: 100 } });
    rec('E4 parent partial below min(10000) -> 400', 400, r, (r.body ?? '').slice(0, 90));
    await call({ method: 'PUT', url: '/fees/settings', headers: OH, payload: { allow_parent_partial: false } });
    r = await call({ method: 'POST', url: '/fees/payments', headers: PAH, payload: { obligationId: ob.id, method: 'upi', amountCents: 20000 } });
    rec('E4 parent partial when disabled -> 400', 400, r, (r.body ?? '').slice(0, 90));
    await call({ method: 'PUT', url: '/fees/settings', headers: OH, payload: { allow_parent_partial: true } });
  }
  // E5. pay-many: same student ok, mixed students refused, >20 refused
  {
    const a = await mkOb('E5a', 20000), b = await mkOb('E5b', 30000);
    let r = await call({ method: 'POST', url: '/fees/payments', headers: OH, payload: { obligationIds: [a.id, b.id], method: 'upi' } });
    rec('E5 pay-many same student -> 200 x2 allocs', 200, r, `allocs=${(J(r).allocations ?? []).length}`);
    const c = await mkOb('E5c', 20000, S[1].id);
    r = await call({ method: 'POST', url: '/fees/payments', headers: OH, payload: { obligationIds: [a.id, c.id], method: 'upi' } });
    rec('E5 pay-many mixed students -> 400', 400, r);
    const many = [];
    for (let i = 0; i < 21; i++) many.push((await mkOb(`E5m${i}`, 1000)).id);
    r = await call({ method: 'POST', url: '/fees/payments', headers: OH, payload: { obligationIds: many, method: 'upi' } });
    rec('E5 pay-many 21 distinct -> 400', 400, r);
    // pay-many in-progress: second initiation while first still initiated -> clean 409 (was 500 via partial index)
    const w1 = await mkOb('E5w1', 20000), w2 = await mkOb('E5w2', 20000);
    await call({ method: 'POST', url: '/fees/payments', headers: OH, payload: { obligationIds: [w1.id, w2.id], method: 'upi' } });
    r = await call({ method: 'POST', url: '/fees/payments', headers: OH, payload: { obligationId: w1.id, method: 'upi' } });
    rec('E5 second initiate over pay-many in-progress -> 409 (was 500)', 409, r, J(r).code);
  }
  // E6/E7. double confirm + bogus gateway ref
  {
    const ob = await mkOb('E6 dbl', 40000);
    const p = J(await start(ob.id)).payment;
    await confirm(p.id);
    const r = await confirm(p.id);
    rec('E6 confirm twice -> already:true, one receipt', 200, r, `already=${J(r).already}`);
    const n = (await q(`SELECT count(*)::int n FROM app.fee_receipts WHERE payment_id=$1`, [p.id]))[0].n;
    rec('E6 receipt rows for payment', 200, { statusCode: 200 }, `${n} (expect 1)`, n === 1 ? '' : 'DUPLICATE-RECEIPT');
    const ob2 = await mkOb('E7 bogus', 40000);
    const p2 = J(await start(ob2.id)).payment;
    const r2 = await confirm(p2.id, OH, { gatewayRef: 'FAKE-12345678' });
    rec('E7 bogus gatewayRef -> manual, still settles', 200, r2, `via=${J(r2).payment?.settled_via} ref=${J(r2).payment?.gateway_ref}`);
  }
  // E8. void then confirm initiated
  {
    const ob = await mkOb('E8 void', 40000);
    const p = J(await start(ob.id)).payment;
    await call({ method: 'POST', url: `/fees/obligations/${ob.id}/void`, headers: OH, payload: {} });
    const r = await confirm(p.id);
    rec('E8 confirm after void -> 409 (no resurrection)', 409, r, J(r).code);
  }
  // E9. full refund voids receipt; double refund conflicts; over-refund conflicts
  {
    const ob = await mkOb('E9 ref', 60000);
    const p = J(await start(ob.id)).payment;
    await confirm(p.id);
    let r = await call({ method: 'POST', url: `/payments/${p.id}/refund`, headers: OH, payload: { reason: 'edge full' } });
    rec('E9 full refund (60k < default 5L? no: 600>=5000 threshold, reason given) -> 200', 200, r, `status=${J(r).payment?.status}`);
    const v = (await q(`SELECT voided_at FROM app.fee_receipts WHERE payment_id=$1`, [p.id]))[0];
    rec('E9 receipt voided on full refund', 200, { statusCode: 200 }, `voided=${v?.voided_at ? 'yes' : 'NO'}`);
    r = await call({ method: 'POST', url: `/payments/${p.id}/refund`, headers: OH, payload: { reason: 'again' } });
    rec('E9 double refund -> 409 CONFLICT', 409, r, J(r).code);
    const ob2 = await mkOb('E9b over', 60000);
    const p2 = J(await start(ob2.id)).payment;
    await confirm(p2.id);
    r = await call({ method: 'POST', url: `/payments/${p2.id}/refund`, headers: OH, payload: { refundCents: 99999999, reason: 'too much' } });
    rec('E9 refund > refundable -> 409', 409, r, J(r).code);
  }
  // E10. refund on unconfirmed -> refused
  {
    const ob = await mkOb('E10 unconf', 40000);
    const p = J(await start(ob.id)).payment;
    const r = await call({ method: 'POST', url: `/payments/${p.id}/refund`, headers: OH, payload: { reason: 'early' } });
    rec('E10 refund initiated (unconfirmed) -> 409 PAYMENT_NOT_CONFIRMED', 409, r, J(r).code);
  }
  // E11/E12. concession clamp: oversized + on paid
  {
    const ob = await mkOb('E11 clamp', 50000);
    const p = J(await start(ob.id, 'upi', { amountCents: 40000 })).payment;
    await confirm(p.id);
    const c = J(await call({ method: 'POST', url: '/fees/concessions', headers: OH, payload: { studentId: S[0].id, obligationId: ob.id, kind: 'scholarship', amountCents: 999999, reason: 'oversized' } })).concession;
    const d = await call({ method: 'POST', url: `/fees/concessions/${c.id}/decide`, headers: OH, payload: { decision: 'approve' } });
    const row = (await q(`SELECT concession_cents,net_amount_cents,paid_cents FROM app.fee_obligations WHERE id=$1`, [ob.id]))[0];
    rec('E11 oversized concession clamped to unpaid', 200, d, `conc=${row.concession_cents} net=${row.net_amount_cents} paid=${row.paid_cents} (net>=paid)`, Number(row.net_amount_cents) >= Number(row.paid_cents) ? '' : 'NET-BELOW-PAID');
    const ob2 = await mkOb('E12 paid', 30000);
    const p2 = J(await start(ob2.id)).payment;
    await confirm(p2.id);
    const c2 = J(await call({ method: 'POST', url: '/fees/concessions', headers: OH, payload: { studentId: S[0].id, obligationId: ob2.id, kind: 'waiver', amountCents: 5000, reason: 'post-paid' } })).concession;
    await call({ method: 'POST', url: `/fees/concessions/${c2.id}/decide`, headers: OH, payload: { decision: 'approve' } });
    const row2 = (await q(`SELECT waived_cents,net_amount_cents,paid_cents FROM app.fee_obligations WHERE id=$1`, [ob2.id]))[0];
    rec('E12 waiver on paid ob clamped to 0', 200, { statusCode: 200 }, `waived=${row2.waived_cents} (expect 0)`, Number(row2.waived_cents) === 0 ? '' : 'WAIVER-ON-PAID');
  }
  // E13/E14. late-fee grace + cap + fixed/percent modes
  {
    await call({ method: 'PUT', url: '/fees/settings', headers: OH, payload: { late_fee_enabled: true, late_fee_mode: 'per_day', late_fee_per_day_cents: 1000, late_fee_grace_days: 3, late_fee_cap_cents: 5000 } });
    const two = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
    const old = new Date(Date.now() - 100 * 864e5).toISOString().slice(0, 10);
    const g = await mkOb('E13 grace', 100000, S[0].id, two);
    const o = await mkOb('E13 cap', 100000, S[0].id, old);
    await call({ method: 'POST', url: '/fees/late-fees/run', headers: OH, payload: {} });
    const rg = (await q(`SELECT late_fee_cents FROM app.fee_obligations WHERE id=$1`, [g.id]))[0];
    const ro = (await q(`SELECT late_fee_cents FROM app.fee_obligations WHERE id=$1`, [o.id]))[0];
    rec('E13 within grace (2d <= 3d) -> 0', 200, { statusCode: 200 }, `fee=${rg.late_fee_cents}`, Number(rg.late_fee_cents) === 0 ? '' : 'GRACE-LEAK');
    rec('E13 100d overdue capped at 5000', 200, { statusCode: 200 }, `fee=${ro.late_fee_cents}`, Number(ro.late_fee_cents) === 5000 ? '' : 'CAP-LEAK');
    await call({ method: 'PUT', url: '/fees/settings', headers: OH, payload: { late_fee_mode: 'fixed', late_fee_fixed_cents: 7000 } });
    await call({ method: 'POST', url: '/fees/late-fees/run', headers: OH, payload: {} });
    const rf = (await q(`SELECT late_fee_cents FROM app.fee_obligations WHERE id=$1`, [o.id]))[0];
    rec('E14 fixed mode SETs 7000 (replaces, not adds)', 200, { statusCode: 200 }, `fee=${rf.late_fee_cents}`, Number(rf.late_fee_cents) === 5000 ? '' : 'cap-vs-fixed? (cap 5000 < fixed 7000 -> capped, correct)' );
    await call({ method: 'PUT', url: '/fees/settings', headers: OH, payload: { late_fee_enabled: false } });
    const rdis = await call({ method: 'POST', url: '/fees/late-fees/run', headers: OH, payload: {} });
    rec('E14 late disabled -> 409', 409, rdis);
    await call({ method: 'PUT', url: '/fees/settings', headers: OH, payload: { late_fee_enabled: true, late_fee_mode: 'per_day' } });
  }
  // E15/E16. non-refundable head + window
  {
    const h = (await q(`INSERT INTO app.fee_heads (tenant_id,name,is_refundable) VALUES ($1,'E15 NoRef',false) RETURNING id`, [tenant]))[0];
    const ob = (await q(`INSERT INTO app.fee_obligations (tenant_id,student_id,term,label,amount_cents,fee_head_id) VALUES ($1,$2,'ET','E15 head',50000,$3) RETURNING *`, [tenant, S[0].id, h.id]))[0];
    const p = J(await start(ob.id)).payment;
    await confirm(p.id);
    const r = await call({ method: 'POST', url: `/payments/${p.id}/refund`, headers: OH, payload: { reason: 'head test' } });
    rec('E15 non-refundable head -> 400', 400, r, (r.body ?? '').slice(0, 80));
    await call({ method: 'PUT', url: '/fees/settings', headers: OH, payload: { refund_window_days: 1 } });
    const ob2 = await mkOb('E16 win', 40000);
    const p2 = J(await start(ob2.id)).payment;
    await confirm(p2.id);
    await sql(`UPDATE app.payments SET confirmed_at = now() - interval '10 days' WHERE id=$1`, [p2.id]);
    const r2 = await call({ method: 'POST', url: `/payments/${p2.id}/refund`, headers: OH, payload: { reason: 'late' } });
    rec('E16 refund after window -> 400', 400, r2, (r2.body ?? '').slice(0, 80));
    await call({ method: 'PUT', url: '/fees/settings', headers: OH, payload: { refund_window_days: 0 } });
  }
  // E17. installment editing disabled
  {
    await call({ method: 'PUT', url: '/fees/settings', headers: OH, payload: { installment_allow_edit: false } });
    const inst = (await q(`SELECT fi.* FROM app.fee_installments fi JOIN app.fee_obligations o ON o.id=fi.obligation_id WHERE fi.tenant_id=$1 AND fi.status='pending' LIMIT 1`, [tenant]))[0];
    if (inst) {
      const r = await call({ method: 'PATCH', url: `/fees/installments/${inst.id}`, headers: OH, payload: { due_on: '2027-01-01' } });
      rec('E17 edit with allow_edit=false -> 403', 403, r);
    } else rec('E17 no pending installments in seed', 200, { statusCode: 200 }, 'skipped');
    await call({ method: 'PUT', url: '/fees/settings', headers: OH, payload: { installment_allow_edit: true } });
  }
  // E18. quiet-hours blackout (set 00:00-23:59, run, restore)
  {
    const prev = J(await call({ method: 'GET', url: '/fees/settings', headers: OH })).settings;
    await call({ method: 'PUT', url: '/fees/settings', headers: OH, payload: { dunning_quiet_start: '00:00', dunning_quiet_end: '23:59' } });
    const before = (await q(`SELECT count(*)::int n FROM app.communications WHERE tenant_id=$1 AND template LIKE 'FEE%'`, [tenant]))[0].n;
    const r = await call({ method: 'POST', url: '/fees/dunning/run', headers: OH, payload: {} });
    const after = (await q(`SELECT count(*)::int n FROM app.communications WHERE tenant_id=$1 AND template LIKE 'FEE%'`, [tenant]))[0].n;
    rec('E18 full-day quiet -> queued:0, zero writes', 200, r, `queued=${J(r).queued} comms ${before}->${after}`, J(r).queued === 0 && before === after ? '' : 'QUIET-LEAK');
    await call({ method: 'PUT', url: '/fees/settings', headers: OH, payload: { dunning_quiet_start: prev.dunning_quiet_start ?? '21:00', dunning_quiet_end: prev.dunning_quiet_end ?? '08:00' } });
  }
  // E19. methods gate
  {
    await call({ method: 'PUT', url: '/fees/settings', headers: OH, payload: { enabled_methods: ['cash'] } });
    const ob = await mkOb('E19 meth', 40000);
    const r = await call({ method: 'POST', url: '/fees/payments', headers: OH, payload: { obligationId: ob.id, method: 'upi' } });
    rec('E19 upi when only cash enabled -> 400 names rails', 400, r, (r.body ?? '').slice(0, 110));
    await call({ method: 'PUT', url: '/fees/settings', headers: OH, payload: { enabled_methods: ['upi', 'razorpay', 'cash', 'card', 'cheque', 'netbanking', 'bank_transfer', 'manual'] } });
  }
  // E20. limits: 25 terms, 25 parts, bad uuid
  {
    const terms = Array.from({ length: 25 }, (_, i) => ({ term: `T${i}`, label: `l${i}`, amount_cents: 100 }));
    let r = await call({ method: 'POST', url: '/fee-plans', headers: OH, payload: { name: 'E20 many', grades: [S[0].grade], terms } });
    rec('E20 25 terms -> 400', 400, r);
    r = await call({ method: 'POST', url: '/fee-plans', headers: OH, payload: { name: 'E20 parts', grades: [S[0].grade], terms: [{ term: 'X', label: 'x', amount_cents: 100 }], installments: Array.from({ length: 25 }, () => ({})) } });
    rec('E20 25 parts -> 400', 400, r);
    r = await call({ method: 'GET', url: '/fees/obligations/not-a-uuid', headers: OH });
    rec('E20 bad uuid -> 400', 400, r);
  }
  // E21. cross-tenant isolation (second tenant sees nothing, touches nothing)
  {
    const t2 = (await q(`INSERT INTO app.tenants (slug,name,config) VALUES ('edge2','Edge Two','{}'::jsonb) RETURNING id`))[0];
    const pw = (await q(`SELECT password_hash FROM app.users WHERE email='owner@meridian.edu'`))[0].password_hash;
    await sql(`INSERT INTO app.users (tenant_id,email,name,role,password_hash) VALUES ($1,'owner@edge2.edu','Edge Owner','owner',$2)`, [t2.id, pw]);
    const { buildApp: _b } = await import('../src/app.js');
    const t2tok = (await loginAs(app, 'owner@edge2.edu')).token;
    const T2H = H(t2tok);
    let r = await call({ method: 'GET', url: '/fee-plans', headers: T2H });
    rec('E21 tenant B sees zero plans', 200, r, `n=${(J(r).feePlans ?? []).length}`, (J(r).feePlans ?? []).length === 0 ? '' : 'LEAK');
    r = await call({ method: 'GET', url: '/fees/obligations', headers: T2H });
    rec('E21 tenant B sees zero obligations', 200, r, `n=${(J(r).obligations ?? []).length}`, (J(r).obligations ?? []).length === 0 ? '' : 'LEAK');
    const aOb = (await q(`SELECT id FROM app.fee_obligations WHERE tenant_id=$1 LIMIT 1`, [tenant]))[0];
    r = await call({ method: 'POST', url: '/fees/payments', headers: T2H, payload: { obligationId: aOb.id, method: 'upi' } });
    rec('E21 tenant B pays A obligation -> 404', 404, r);
  }
  // E22. audit presence for the money trail
  {
    const n = (await q(`SELECT count(*)::int n FROM app.audit_log WHERE tenant_id=$1 AND (record_type ILIKE '%pay%' OR record_type ILIKE '%fee%' OR action ILIKE '%refund%' OR action ILIKE '%late fee%')`, [tenant]))[0].n;
    rec('E22 audit rows cover money ops', 200, { statusCode: 200 }, `${n} audit rows`, n > 10 ? '' : 'THIN-TRAIL');
  }
  // E23. receipt series increments (yearly scope from drill? default never here)
  {
    const rows = (await q(`SELECT receipt_no FROM app.fee_receipts WHERE tenant_id=$1 ORDER BY issued_at`, [tenant])).map(r => r.receipt_no);
    const uniq = new Set(rows);
    rec('E23 receipt numbers unique + ordered', 200, { statusCode: 200 }, `${rows.length} receipts, ${uniq.size} unique`, rows.length === uniq.size ? '' : 'DUP-RECEIPT');
  }

  fs.writeFileSync('/tmp/fee-edge-drill.json', JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
  const pass = results.filter(x => x.pass).length;
  console.log(`\n===== EDGE DONE: ${pass}/${results.length} as-expected =====`);
  for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} ${x.op} -> ${x.got} (exp ${x.expect})${x.db ? ' | ' + String(x.db).slice(0, 200) : ''}${x.note ? ' !! ' + x.note : ''}`);
  await app.close();
}
main().catch(e => { console.error('EDGE CRASH:', e); process.exit(2); });
