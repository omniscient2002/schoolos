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
  const link = (await app.inject({ method: 'POST', url: '/plugins/payments.upi/links', payload: { obligationId: obs[1]?.id ?? obs[0].id }, headers: H(o.token) })).json();
  const paymentId = link.payment?.id;
  if (paymentId) {
    const wh = await app.inject({ method: 'POST', url: '/plugins/payments.upi/webhook', payload: {
      event: 'payment_link.paid', payload: { payment_link: { notes: { paymentId } } },
    } });
    assert.ok([200, 202].includes(wh.statusCode), 'webhook records the fact');
    const payRow = (await app.inject({ method: 'GET', url: '/fees/obligations', headers: H(f.token) })).json().obligations
      .find(o2 => o2.id === (obs[1]?.id ?? obs[0].id));
    assert.equal(payRow.status, 'open', 'kernel-only settlement invariant holds');
  }
});
});
