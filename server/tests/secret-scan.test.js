// SEC-15 — the secret scanner must be able to fail.
//
// The register's complaint was that the scanner "requires 20+ characters inside quotes", so it could not see
// this repo's own secrets: `server/.env` holds unquoted `JWT_SECRET=...` assignments. The dotenv rule was
// added; this file proves it fires on a real secret and stays quiet on the placeholders and dev values the
// repo deliberately ships. The scanner is now a pure function of a root directory, so the fixture is a temp
// tree and no planted secret ever touches the working repository.
//
// NOTE: the fake secrets below are BUILT AT RUNTIME (`['AKIA', '…'].join('')`) rather than written as
// literals. A literal would be a real finding for the scanner when it walks this repo — the test would
// break the gate it exists to prove. The source contains the pieces, never the assembled pattern.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanTree, scanText } from '../../scripts/secret-scan.mjs';

const AWS = ['AKIA', '1234567890ABCDEF'].join('');
const URL_CRED = ['postgres://admin:', 'S3cretPassw0rd', '@db.example.com:5432/prod'].join('');
const HARDCODED = 'abcdefghijklmnopqrstuvwxyz123456';

const withTree = (files, fn) => {
  const root = mkdtempSync(join(tmpdir(), 'schoolos-secretscan-'));
  try {
    for (const [rel, body] of Object.entries(files)) {
      const full = join(root, rel);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, body);
    }
    return fn(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
};

test('the dotenv rule sees an unquoted secret that the quoted-string heuristic cannot', () => {
  withTree({ '.env': 'JWT_SECRET=aRealLookingSecretValue12345\nPORT=8080\n' }, (root) => {
    const hits = scanTree(root);
    assert.equal(hits.length, 1, `expected exactly one finding, got ${JSON.stringify(hits)}`);
    assert.match(hits[0], /\.env — dotenv secret assignment/);
    assert.ok(!/aRealLookingSecretValue12345/.test(hits[0]), 'the finding must never echo the value');
  });
});

test("placeholders and the repo's own dev credentials are not failures", () => {
  withTree({
    '.env': [
      'JWT_SECRET=${JWT_SECRET}',
      'JWT_SECRET=change-me-before-you-ship',
      'RAZORPAY_WEBHOOK_SECRET=your-webhook-secret-here',
      'DATABASE_URL=postgres://schoolos:schoolos_dev_pw@127.0.0.1:5432/schoolos',
    ].join('\n'),
  }, (root) => {
    assert.deepEqual(scanTree(root), [], 'the demo/dev values are allow-listed by design');
  });
});

test('cloud keys, URL credentials and hardcoded assignments are all caught', () => {
  withTree({
    'src/leak.js': `const k = "${AWS}";\n`,
    'src/url.js': `const dsn = "${URL_CRED}";\n`,
    'src/assign.js': `const api_key = "${HARDCODED}";\n`,
  }, (root) => {
    const hits = scanTree(root);
    const names = hits.map((h) => h.split(' — ')[1]?.split(':')[0]);
    assert.ok(names.includes('AWS access key'), `AWS key not flagged: ${JSON.stringify(hits)}`);
    assert.ok(names.includes('password in URL'), `URL credential not flagged: ${JSON.stringify(hits)}`);
    assert.ok(names.includes('hardcoded secret assignment'), `hardcoded assignment not flagged: ${JSON.stringify(hits)}`);
  });
});

test('scanText labels the line number of a finding', () => {
  const hits = scanText('x.js', `line one\nconst password = "${HARDCODED}";\n`);
  assert.equal(hits.length, 1);
  assert.match(hits[0], /x\.js:2 — hardcoded secret assignment/);
});
