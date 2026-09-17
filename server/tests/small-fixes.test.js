import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { hashPassword, verifyPasswordDetailed } from '../src/auth.js';
import { pageParams } from '../src/routes.js';

test('SEC-13: a successful legacy password proof is marked for upgrade', () => {
  const password = 'legacy-password';
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex');
  assert.deepEqual(verifyPasswordDetailed(password, `${salt}:${hash}`), { valid: true, needsRehash: true });
  assert.deepEqual(verifyPasswordDetailed(password, hashPassword(password)), { valid: true, needsRehash: false });
});

test('API-7: pagination inputs are bounded before SQL parameters are built', () => {
  assert.deepEqual(pageParams({ limit: 'abc', offset: '-2' }), { limit: 100, offset: 0 });
  assert.deepEqual(pageParams({ limit: '9999', offset: '4' }), { limit: 500, offset: 4 });
  assert.deepEqual(pageParams({ limit: '25.5', offset: '2.2' }), { limit: 100, offset: 0 });
});
