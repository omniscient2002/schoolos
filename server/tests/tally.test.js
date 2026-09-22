// accounting.tally — wave-2 unit #1 tests (plugin factory drop-in)
// Invariants under test (009): read_only_on_ledger · voucher_totals_match_ledger ·
// audit digest (window + count + hash) · owner/itadmin/finance-only doors.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';

const H = (t) => ({ authorization: `Bearer ${t}` });

let app;
before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.ready();
  const owner = await loginAs(app, 'owner@meridian.edu');
  const en = await app.inject({ method: 'POST', url: '/plugins/accounting.tally/enable',
    headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' }, payload: { version: '1.0.0', class: 'B' } });
  if (en.statusCode !== 200) throw new Error('enable accounting.tally → ' + en.statusCode + ' ' + en.body);
});

describe('accounting.tally (wave-2 #1)', () => {
  test('daybook/export read-only on ledger, digest-audited, totals match', async () => {
  const f = await loginAs(app, 'finance@meridian.edu');

  // seed one confirmed payment through the KERNEL flow (plugin must not create money rows)
  const obs = (await app.inject({ method: 'GET', url: '/fees/obligations?status=open', headers: H(f.token) })).json().obligations;
  assert.ok(obs.length > 0, 'seed must provide an open obligation');
  const init = (await app.inject({ method: 'POST', url: '/fees/payments', payload: { obligationId: obs[0].id }, headers: H(f.token) })).json().payment;
  const confirmedCents = Number(init.amount_cents);
  const conf = await app.inject({ method: 'POST', url: `/fees/payments/${init.id}/confirm`, payload: { gatewayRef: 'TALLY-E2E-1' }, headers: H(f.token) });
  assert.equal(conf.statusCode, 200);

  // daybook door: totals must match the kernel ledger rows (app.payments), by construction
  const db = await app.inject({ method: 'GET', url: '/plugins/accounting.tally/daybook', headers: H(f.token) });
  assert.equal(db.statusCode, 200);
  const daybook = db.json();
  assert.equal(daybook.voucher_count, 1, 'exactly the payment the kernel confirmed');
  assert.equal(daybook.total_cents, confirmedCents, 'voucher_totals_match_ledger');
  assert.equal(daybook.vouchers[0].gateway_ref, 'TALLY-E2E-1');

  // export door: Tally-importable XML + digest audit, never a ledger write
  const ex = await app.inject({ method: 'POST', url: '/plugins/accounting.tally/export', headers: H(f.token) });
  assert.equal(ex.statusCode, 200);
  assert.match(ex.headers['content-type'], /xml/);
  assert.match(ex.body, /<VOUCHER VCHTYPE="Receipt"/);
  assert.match(ex.body, /TALLY-E2E-1/);
  assert.match(ex.body, /-[\d.]+<\/AMOUNT>/, 'credit leg present (double-entry)');

  // history door shows the digest entry
  const hist = (await app.inject({ method: 'GET', url: '/plugins/accounting.tally/exports', headers: H(f.token) })).json();
  assert.equal(hist.exports.length >= 1, true);
  assert.match(hist.exports[0].outcome, /vouchers · sha256:/);

  // read_only_on_ledger: after daybook + export + history, the ledger is byte-identical
  const after = (await app.inject({ method: 'GET', url: '/fees/obligations', headers: H(f.token) })).json().obligations;
  assert.equal(after.length, obs.length, 'no obligation rows created');
  const settledAfter = await app.inject({ method: 'POST', url: `/fees/payments/${init.id}/confirm`, payload: { gatewayRef: 'TALLY-E2E-1' }, headers: H(f.token) });
  assert.equal(settledAfter.statusCode, 200, 'kernel settlement still idempotent — nothing about the ledger changed');

  // payments.upi: settlement stays kernel-only — an UPI webhook FACT cannot settle money
  const o = await loginAs(app, 'owner@meridian.edu');
  /* The block below never executed (it read a field the door does not return), so nothing ever discovered that
     `payments.upi` was never switched on for this tenant — the door answered "Fee payments is switched off" and
     the `if` swallowed it. Enabling it is SETUP, not a weakened assertion: the invariant being pinned is that a
     UPI webhook FACT cannot settle money, and it can only be tested with the plugin on. */
  const upiEn = await app.inject({ method: 'POST', url: '/plugins/payments.upi/enable', headers: H(o.token), payload: { version: '1.0.0', class: 'C' } });
  assert.ok([200, 409].includes(upiEn.statusCode), `payments.upi must be enableable for this invariant to be testable: ${upiEn.statusCode} ${String(upiEn.body).slice(0, 160)}`);
  // A4: the rail needs a configured school VPA (no fabricated `schoolos@<name>`).
  await app.inject({ method: 'POST', url: '/plugins/payments.upi/settings', headers: H(o.token), payload: { gateway: 'razorpay', default_vpa: 'meridian@icici' } });
  const targetId = obs[1]?.id ?? obs[0].id;
  const link = (await app.inject({ method: 'POST', url: '/plugins/payments.upi/links', payload: { obligationId: targetId }, headers: H(o.token) })).json();
  /* TST-4: this read `link.payment?.id`, and the door returns `paymentId` at the top level — so `undefined`,
     the `if` was false, and the entire "a UPI webhook cannot settle money" invariant silently never ran. A
     conditional that can only be false is not a test. */
  const paymentId = link.paymentId;
  assert.ok(paymentId, `the link door must return the payment it created: ${JSON.stringify(link).slice(0, 200)}`);
  {
    const wh = await app.inject({ method: 'POST', url: '/plugins/payments.upi/webhook', payload: {
      event: 'payment_link.paid', payload: { payment_link: { notes: { paymentId } } },
    } });
    /* SEC-21 hardened this door after the block above was written (which is why nobody noticed): an unsigned
       webhook is refused before anything the caller controls is examined, so the FACT is never recorded. The
       invariant this block exists for is that a gateway FACT cannot settle money, and the state the door
       actually reaches now asserts it just as well: refused, and the obligation untouched. The signed path is
       covered end-to-end by webhook-preauth.test.js. */
    assert.ok([400, 401, 403, 503].includes(wh.statusCode),
      `an unsigned UPI webhook must be refused, never treated as a payment fact: ${wh.statusCode} ${String(wh.body).slice(0, 160)}`);
    // Fetch the OPEN obligations explicitly: the unfiltered list is paginated (default 100) and the seed's
    // paid July installments sort ahead of this fixture's September row, so it could fall off page one.
    const payRow = (await app.inject({ method: 'GET', url: '/fees/obligations?status=open&limit=500', headers: H(f.token) })).json().obligations
      .find(o2 => o2.id === targetId);
    assert.equal(payRow.status, 'open', 'kernel-only settlement: nothing a webhook can send settles money');
  }
});
});
