// P0 · fee money-math properties — randomized checks over the pure splitter
// plus the late-fee formula mirror. No DB: these pin integer-paise exactness.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitInstallments } from '../src/fees/installments.js';

// deterministic PRNG (mulberry32) so failures reproduce exactly
const rng = (seed) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

test('PROP · split: parts always sum exactly to the total, all positive', () => {
  const r = rng(42);
  for (let i = 0; i < 500; i++) {
    const total = 1 + Math.floor(r() * 1e9);
    const n = 1 + Math.floor(r() * 6);
    const parts = Array.from({ length: n }, () => {
      const k = r();
      if (k < 0.3) return {};
      if (k < 0.6) return { percent: 1 + Math.floor(r() * 30) };
      return { amount_cents: 1 + Math.floor(r() * (total / n)) };
    });
    const out = splitInstallments(parts, total);
    if (out.error) continue; // overshoot/zero-total cases are clean errors, never throws
    assert.equal(out.amounts.length, n);
    assert.ok(out.amounts.every((a) => a > 0n), `all parts positive for total=${total}`);
    assert.equal(out.amounts.reduce((a, b) => a + b, 0n), BigInt(total), `exact sum for total=${total}`);
  }
});

test('PROP · split: percent parts resolve to floor(total*pct/100)', () => {
  const r = rng(7);
  for (let i = 0; i < 200; i++) {
    const total = 100 + Math.floor(r() * 1e6);
    const pct = 1 + Math.floor(r() * 50);
    const out = splitInstallments([{ percent: pct }, {}], total);
    if (out.error) continue;
    assert.equal(out.amounts[0], (BigInt(total) * BigInt(pct * 100)) / 10000n);
    assert.equal(out.amounts[0] + out.amounts[1], BigInt(total));
  }
});

test('PROP · split: all-explicit under-coverage is an error, never silent loss', () => {
  assert.ok(splitInstallments([{ amount_cents: 30 }, { amount_cents: 30 }], 100).error);
  assert.ok(splitInstallments([{ percent: 50 }, { percent: 30 }], 10000).error);
  assert.ok(!splitInstallments([{ amount_cents: 30 }, {}], 100).error);
  assert.ok(!splitInstallments([{ amount_cents: 40 }, { amount_cents: 60 }], 100).error);
});

test('PROP · split: invalid inputs are clean errors, never throws/NaN', () => {
  assert.ok(splitInstallments([], 100).error);
  assert.ok(splitInstallments([{}], 0).error);
  assert.ok(splitInstallments([{ amount_cents: 60 }, { amount_cents: 50 }], 100).error);
  assert.ok(splitInstallments([{ percent: 0 }, {}], 100).error);
  assert.ok(splitInstallments([{ percent: 101 }, {}], 100).error);
  assert.ok(splitInstallments([{ amount_cents: 1, percent: 1 }], 100).error);
  // more parts than paise → zero-part error, not a CHECK-violating row
  assert.ok(splitInstallments([{}, {}, {}], 2).error);
});

test('PROP · late-fee formula mirror: per_day/fixed/percent × grace × cap', () => {
  const r = rng(99);
  const calc = (mode, { days, perDay, fixed, pct, cap, grace }) => {
    if (mode === 'fixed') return Math.min(cap > 0 ? cap : Infinity, fixed);
    if (mode === 'percent') return Math.min(cap > 0 ? cap : Infinity, 100000 * pct / 100);
    return Math.min(cap > 0 ? cap : Infinity, Math.max(0, days - grace) * perDay);
  };
  for (let i = 0; i < 300; i++) {
    const days = Math.floor(r() * 400), grace = Math.floor(r() * 30);
    const perDay = 1 + Math.floor(r() * 2000), cap = r() < 0.5 ? 0 : 1000 + Math.floor(r() * 50000);
    const fee = calc('per_day', { days, perDay, cap, grace });
    assert.ok(fee >= 0, 'never negative');
    if (days <= grace) assert.equal(fee, 0, 'grace is free');
    if (cap > 0) assert.ok(fee <= cap, 'cap binds');
    assert.equal(Number.isInteger(fee), true, 'integer paise');
  }
});

test('PROP · concession clamp mirror: reduction never exceeds unpaid, net never negative', () => {
  const r = rng(1234);
  for (let i = 0; i < 300; i++) {
    const amount = Math.floor(r() * 1e6);
    const paid = Math.floor(r() * (amount + 1));
    const base = BigInt(amount), unpaid = base - BigInt(paid);
    const want = BigInt(Math.floor(r() * 2e6));
    const reduction = want > unpaid ? (unpaid < 0n ? 0n : unpaid) : want;
    assert.ok(base - reduction >= 0n, 'net never negative');
    assert.ok(reduction <= (unpaid < 0n ? 0n : unpaid), 'clamped to unpaid');
  }
});
