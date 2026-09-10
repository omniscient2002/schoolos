// L2 verification (T201 follow-up): applies the two L1 fix proposals IN CONTAINER
// ONLY (never in the workspace) so S0 can rule with tested evidence:
//   patch 1 — ops.visitors pickup door: FOR UPDATE → FOR NO KEY UPDATE
//             (blocks.md fix option (a); NO KEY UPDATE is compatible with the FK's
//             FOR KEY SHARE, so the owner-path vault INSERT no longer blocks)
//   patch 2 — wave-c test 7: revoked_token app-role probes now expect 42501
//             (the post-054 posture: REVOKE ALL, 054:143)
import { readFileSync, writeFileSync } from 'node:fs';

let p = readFileSync('src/plugins/ops.visitors/index.js', 'utf8');
const n1 = (p.match(/FOR UPDATE/g) || []).length;
p = p.replaceAll('FOR UPDATE', 'FOR NO KEY UPDATE');
writeFileSync('src/plugins/ops.visitors/index.js', p);
console.log(`patch1: ops.visitors FOR UPDATE ×${n1} → FOR NO KEY UPDATE`);

let t = readFileSync('tests/wave-c.test.js', 'utf8');
const before = t;
t = t.replace(
  /assert\.equal\(await count\(tenantA, 'auth\.revoked_token'[^;]*own-tenant revocation visible'\);/,
  `await assert.rejects(() => count(tenantA, 'auth.revoked_token', "jti='" + jti + "'"), (e) => e.code === '42501', 'app role denied on revoked_token (054:143)');`,
);
t = t.replace(
  /assert\.equal\(await count\(tenantB, 'auth\.revoked_token'[^;]*revocation invisible cross-tenant'\);/,
  `await assert.rejects(() => count(tenantB, 'auth.revoked_token', "jti='" + jti + "'"), (e) => e.code === '42501', 'app role denied cross-tenant too (054:143)');`,
);
if (t === before) { console.error('patch2: NO CHANGE — regex mismatch, aborting'); process.exit(2); }
writeFileSync('tests/wave-c.test.js', t);
console.log('patch2: wave-c revoked_token assertions → 42501 expectation (post-054 posture)');
