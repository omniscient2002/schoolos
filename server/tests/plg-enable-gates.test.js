/* PLG-2b — the enable door's non-database gates are deliberately small and
 * pure: a malformed kernel range must fail closed, and dependencies are an
 * exact id/version contract rather than a truthy row check. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { KERNEL_VERSION, kernelSatisfies, dependencySpec } from '../src/routes.js';

describe('PLG-2b · enable gate predicates', () => {
  test('kernel compatibility accepts the running version and rejects mismatches or unknown syntax', () => {
    assert.equal(KERNEL_VERSION, '1.0.0');
    assert.equal(kernelSatisfies('>=1.0.0 <2.0.0'), true);
    assert.equal(kernelSatisfies('>=1.1.0'), false);
    assert.equal(kernelSatisfies('not-a-range'), false);
    assert.equal(kernelSatisfies(undefined), true);
  });

  test('dependency declarations parse only exact plugin id/version pairs', () => {
    assert.deepEqual(dependencySpec('comms.whatsapp@1.0.0'), { id: 'comms.whatsapp', version: '1.0.0' });
    assert.deepEqual(dependencySpec('comms.whatsapp@v1.0.0'), { id: 'comms.whatsapp', version: '1.0.0' });
    assert.equal(dependencySpec('comms.whatsapp'), null);
    assert.equal(dependencySpec('comms.whatsapp@1.0'), null);
    assert.equal(dependencySpec('../kernel@1.0.0'), null);
  });
});
