import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enabledCapability } from '../src/plugin-capabilities.js';

test('plugin capability lookup is manifest-driven and tenant-scoped', async () => {
  let seen;
  const row = { plugin_id: 'rails.sms', settings: { provider: 'logger' }, manifest: { capabilities: ['auth.otp'] } };
  const sysq = async (sql, params) => {
    seen = { sql, params };
    return { rows: [row] };
  };
  assert.deepEqual(await enabledCapability(sysq, 'tenant-a', 'auth.otp'), row);
  assert.match(seen.sql, /tenant_id=\$1/);
  assert.match(seen.sql, /manifest->'capabilities'/);
  assert.deepEqual(seen.params, ['tenant-a', 'auth.otp']);
});

test('no enabled manifest provider yields no capability', async () => {
  const sysq = async () => ({ rows: [] });
  assert.equal(await enabledCapability(sysq, 'tenant-a', 'auth.password_reset'), null);
});
