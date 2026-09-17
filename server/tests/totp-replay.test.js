import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSecret, totpAt, verifyTotpStep } from '../src/totp.js';

test('TOTP verification returns the matched moving-factor step', () => {
  const secret = generateSecret();
  const now = 1_700_000_000_000;
  const step = Math.floor(now / 1000 / 30);
  const code = totpAt(secret, step);
  assert.equal(verifyTotpStep(secret, code, { now }), step);
  assert.equal(verifyTotpStep(secret, '000000', { now }), null);
});
