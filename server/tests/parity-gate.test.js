// FEX-2 / OPSX-11 — the UI↔door parity gate runs in ENFORCE mode and passes.
//
// The gate itself is the guardrail: it fails when a screen imports the no-HTTP mock plane (write theater)
// or when a write door has no reachable caller and is not in the documented API-only allowlist. This test
// makes that enforcement part of the node suite, not just a CI step, so a drift is caught locally too.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('FEX-2 · UI↔door parity gate (enforce)', () => {
  test('enforce mode exits 0 and reports zero mock-plane importers', () => {
    let out = '';
    let code = 0;
    try {
      out = execFileSync('node', ['scripts/parity-gate.js', '--enforce'], { cwd: SERVER_ROOT, encoding: 'utf8' });
    } catch (e) {
      code = typeof e.status === 'number' ? e.status : 1;
      out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    }
    assert.equal(code, 0, `parity gate failed:\n${out}`);
    assert.match(out, /mock-plane importers 0/, 'no screen may import the no-HTTP mock plane');
    assert.match(out, /enforce mode — clean/, 'the gate must reach its clean state');
  });
});
