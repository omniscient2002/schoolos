import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('next hardening batch is wired at the kernel, money, queue and API boundaries', () => {
  const app = read('src/app.js');
  const routes = read('src/routes.js');
  const audit = read('src/audit.js');
  const loader = read('src/plugins/loader.js');
  const razor = read('src/plugins/payments.razorpay/index.js');
  const upi = read('src/plugins/payments.upi/index.js');
  const migrate = read('scripts/migrate.js');
  const backup = read('scripts/backup.sh');
  const files = read('src/plugins/files.store/index.js');
  const scanner = readFileSync(new URL('../../scripts/secret-scan.mjs', import.meta.url), 'utf8');

  assert.match(app, /installRawJsonParser\(app\)/);
  assert.match(app, /bodyLimit:\s*2 \* 1024 \* 1024/);
  assert.match(app, /setNotFoundHandler/);
  assert.match(app, /mfa_challenges/);
  assert.match(app, /attempts < 5/);
  assert.match(app, /@fastify\/multipart/);
  assert.match(routes, /marks\.length > 300/);
  assert.match(routes, /UUID_RE_NOTICE\.test/);
  assert.doesNotMatch(files, /lower\(g\.name\)=lower\(\$4\)/);
  assert.match(scanner, /dotenv secret assignment/);
  assert.match(upi, /rateLimit: \{ max: 2000/);
  assert.match(razor, /rateLimit: \{ max: 2000/);
  assert.doesNotMatch(razor, /installRawJsonParser/);
  assert.doesNotMatch(upi, /installRawJsonParser/);
  assert.match(routes, /e\.emitted_by=\$3/);
  assert.match(routes, /payment ledger is inconsistent/);
  assert.match(routes, /idempotency-key/);
  assert.match(routes, /hasMore: r\.rows\.length === limit/);
  assert.match(app, /students\.read/);
  assert.match(app, /request_duration_ms_bucket/);
  assert.match(migrate, /MIGRATION_REBASELINE=true/);
  assert.match(backup, /chmod 700/);
  assert.match(read('../.gitignore'), /backups\//);
  assert.match(routes, /OFFSET \$2/);
  assert.match(audit, /event payload exceeds 64KiB/);
  assert.ok(loader.includes('scopedKernel'), 'plugin loader remains permission-scoped');
});
