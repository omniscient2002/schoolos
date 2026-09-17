import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptSettings, decryptSettings, maskSettings } from '../src/settings-crypto.js';

test('SEC-23: secret settings are encrypted, tenant-bound, and masked', () => {
  process.env.PLUGIN_SETTINGS_KEY = 'test-only-plugin-settings-key';
  const stored = encryptSettings({ provider: 'smtp', password: 'correct-horse', host: 'smtp.example.test' }, 'tenant-a');

  assert.notEqual(stored.password, 'correct-horse');
  assert.equal(stored.password.__encrypted, true);
  assert.equal(decryptSettings(stored, 'tenant-a').password, 'correct-horse');
  assert.throws(() => decryptSettings(stored, 'tenant-b'));
  assert.equal(maskSettings(stored).password, '••••••••');
  assert.equal(maskSettings(stored).host, 'smtp.example.test');
});

test('SEC-23: non-secret settings remain unchanged', () => {
  const input = { provider: 'http-generic', url: 'https://example.test', timeout: 8 };
  const stored = encryptSettings(input, 'tenant-a');
  assert.deepEqual(stored, input);
  assert.deepEqual(decryptSettings(stored, 'tenant-a'), input);
});
