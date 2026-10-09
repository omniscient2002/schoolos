// G-7 · an owner-facing door must have a CALLER, or be on the API-only list.
//
// THE DEFECT. `POST /api-keys`, `GET /api-keys` and `DELETE /api-keys/:id` existed for the whole life of
// the product and `grep -rn "api-keys" app/src` returned NOTHING: a key minted for an integration could not
// be reviewed, rotated or revoked by a human in the product, only by opening a console. That is a security
// gap, not a missing feature — and it is the generalisation of the F-1 class of defect ("the endpoint
// exists"). `scripts/permission-matrix.js` already enumerates every door, so this turns "a door with no
// caller" into a build failure.
//
// SCOPE, HONESTLY STATED. This audits the IDENTITY AND PLATFORM surface only — the doors a person must be
// able to review and revoke. It is not a claim that every door in the product has a screen (many are
// reached by a plugin's own surfaces, a worker, or a rail), and it says so: anything else that finds a
// caller-less door belongs in a different, per-domain audit. What it does guarantee is that the doors whose
// absence is a security problem are not silently unreachable.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRoutes } from '../scripts/permission-matrix.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = join(HERE, '..');
const APP_SRC = join(SERVER_ROOT, '..', 'app', 'src');

/* The security surface: identity, credentials and machine access. A school that cannot see or revoke
   these is not in control of its own data, whatever the rest of the product does. */
const IDENTITY_DOORS = [
  'POST /api-keys',
  'GET /api-keys',
  'DELETE /api-keys/:id',
  'POST /plugins/people.admin/users',
  'GET /plugins/people.admin/users',
  'POST /plugins/people.admin/users/:id/reset-password',
  'POST /plugins/people.admin/users/:id/suspend',
  'POST /plugins/people.admin/users/:id/activate',
  'POST /roles',
  'PATCH /roles/:key',
  'DELETE /roles/:key',
  'POST /roles/:key/assign',
];

/* Deliberately API-only, with the reason, and ONLY for doors on the list above — a decision recorded
   about a door nobody audits is a decision nobody reads. EMPTY right now: the api-keys surface was the
   last identity door with no screen, and ItAdmin now lists, creates and revokes keys. The next door that
   genuinely has no human surface goes here WITH its reason, which is cheaper than re-litigating it. */
const API_ONLY = new Map([
  // ['POST /api-keys', 'only if the keys surface is ever moved out of the product — reason required'],
]);

/* The SPA writes paths as template literals (`/plugins/people.admin/users/${id}/suspend`), so every
   interpolation collapses to `:x` before comparison — the same normalisation the door list uses. Without
   it, every parameterised door reads as "no caller" and the guard is theatre. */
const appText = (() => {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue; }
      if (/\.(ts|tsx)$/.test(e.name)) out.push(readFileSync(p, 'utf8'));
    }
  };
  walk(APP_SRC);
  return out.join('\n').replace(/\$\{[^}]*\}/g, ':x');
})();

const param = (path) => path.replace(/:\w+/g, ':x');

describe('G-7 · the identity surface is reachable from the product', () => {
  test('every identity door really exists (this list cannot rot into a check that passes on nothing)', () => {
    const files = [
      join(SERVER_ROOT, 'src', 'app.js'),
      join(SERVER_ROOT, 'src', 'routes.js'),
      ...readdirSync(join(SERVER_ROOT, 'src', 'plugins'), { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('_') && existsSync(join(SERVER_ROOT, 'src', 'plugins', e.name, 'index.js')))
        .map((e) => join(SERVER_ROOT, 'src', 'plugins', e.name, 'index.js')),
    ];
    const doors = new Set(scanRoutes(files).map((r) => `${r.method} ${r.path}`));
    const missing = IDENTITY_DOORS.filter((d) => !doors.has(d));
    assert.deepEqual(missing, [], `the identity list names doors this codebase does not register: ${missing.join(', ')}`);
  });

  test('every identity door has a caller in the SPA, or is on the API-only list with a reason', () => {
    const uncalled = [];
    for (const door of IDENTITY_DOORS) {
      if (API_ONLY.has(door)) {
        assert.ok(API_ONLY.get(door).length > 12, `${door} is API-only with no stated reason`);
        continue;
      }
      const hasCall = appText.includes(param(door.split(' ')[1]));
      if (!hasCall) uncalled.push(door);
    }
    assert.deepEqual(uncalled, [],
      `these owner/IT-admin doors have no caller in the SPA and are not on the API-only list:\n${uncalled.join('\n')}\n` +
      'Either build the screen or record the decision (API_ONLY) — an unreachable security door is a gap, not a feature.');
  });

  test('every API-only entry is real, reasoned, and not quietly growing a screen', () => {
    for (const [door, reason] of API_ONLY) {
      assert.ok(IDENTITY_DOORS.includes(door), `${door} is API-only but is not on the audited list — delete the entry`);
      assert.ok(typeof reason === 'string' && reason.trim().length > 12, `${door} is API-only with no stated reason`);
      assert.ok(!appText.includes(param(door.split(' ')[1])),
        `${door} is marked API-only but the SPA calls it — remove the excuse`);
    }
  });
});