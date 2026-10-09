// P2-4 · the client's role lists and the server's door guards cannot drift.
//
// THE DEFECT THIS EXISTS FOR. A screen decides what to RENDER from a hand-written role list, while the
// server decides what it will ALLOW from its own `require(...)`. Nothing compared the two, so:
//   · F-5 — the fee-plan screen listed roles that did not include the finance head, and the finance head
//     was told "plans are managed by finance" by a UI that had just refused them the door it holds;
//   · F-8 — "Start from the standard day" was offered to a coordinator whose door refuses them;
//   · P3-3 — the library setup screen offered an account a principal cannot create.
//
// A mismatch is not a cosmetic drift: one of the two is always wrong at runtime, and the person using the
// product is the one who finds out. This turns F-5 and F-8 from a 403 into a BUILD failure.
//
// WHAT IT CHECKS, and what it deliberately does not. For every `useRoleOrGrant([roles], [doors])` in the
// SPA, each named role must be admitted by the SERVER's guard for at least one of the named doors — i.e.
// the client may be stricter than the server (it can hide a control the server would allow; that is a
// UX choice) but it may never be LOOSER (it may not offer a control the server will refuse). Where the
// scanner cannot see a guard (a role-gate written by a helper it does not model), the check is skipped
// rather than guessed: a false failure here would train people to ignore it.
//
// WHY IT LIVES IN server/tests/: the SPA has no CI step of its own for this, and the server's scanner
// already reads every plugin's index.js. Same reasoning as frontend-grants.test.js.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRoutes } from '../scripts/permission-matrix.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = join(HERE, '..');
const APP_SRC = join(SERVER_ROOT, '..', 'app', 'src');

/** A path pattern reduced to a comparable shape: every `:param` is `x`, every `*` is `x`. */
const concrete = (pattern) => pattern
  .replace(/:\w+/g, 'x')
  .replace(/\*/g, 'x');

/** The SPA writes some doors as `POST ${PERIOD_BASE}/slots` — resolve the file's own consts first. */
function resolveTemplate(fileSrc, pattern) {
  return pattern.replace(/\$\{([A-Z_]+)\}/g, (_, name) => {
    const m = fileSrc.match(new RegExp(`const ${name} = ['\"]([^'\"]+)['\"]`));
    return m ? m[1] : '';
  });
}

const doors = new Map(); // "METHOD /path" → route record
for (const f of [
  join(SERVER_ROOT, 'src', 'app.js'),
  join(SERVER_ROOT, 'src', 'routes.js'),
  ...readdirSync(join(SERVER_ROOT, 'src', 'plugins'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_') && existsSync(join(SERVER_ROOT, 'src', 'plugins', e.name, 'index.js')))
    .map((e) => join(SERVER_ROOT, 'src', 'plugins', e.name, 'index.js')),
]) {
  // BOTH sides are normalised the same way: the scanner keeps Fastify's `:param`, the client writes
  // `:id`, and a door that exists must not read as a typo because of that.
  for (const r of scanRoutes([f])) doors.set(`${r.method} ${concrete(r.path)}`, r);
}

function appSources(dir = APP_SRC, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') appSources(p, out); continue; }
    if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

/* every useRoleOrGrant([...roles], [...doors]) / granted-style call in the SPA */
const CALL_RE = /useRoleOrGrant\(\s*\[([^\]]*)\]\s*,\s*\[([^\]]*)\]/g;
const strs = (listSrc) => [...listSrc.matchAll(/[`']([^`']+)[`']/g)].map((m) => m[1]);

describe('P2-4 · a UI role list is never looser than the server door it gates', () => {
  test('every useRoleOrGrant role list is admitted by the server guard for the doors it names', () => {
    const mismatches = [];
    const unknownDoors = [];
    let checked = 0;

    for (const file of appSources()) {
      const src = readFileSync(file, 'utf8');
      for (const call of src.matchAll(CALL_RE)) {
        const roles = strs(call[1]);
        const named = strs(call[2]).filter((d) => /^[A-Z*]+ \//.test(d));
        if (!roles.length || !named.length) continue;
        const rel = file.replace(APP_SRC + '/', '');

        for (const pattern of named) {
          const key = concrete(resolveTemplate(src, pattern));
          const route = doors.get(key);
          if (!route) {
            /* A door the scanner cannot see: a plugin that is switched off still declares its routes in
               source, so this is a typo or a plugin module that no longer exists. Either way the client
               is asking about a door that is not there. */
            unknownDoors.push(`${rel}: ${pattern}`);
            continue;
          }
          if (route.cls !== 'role-gated' || !route.roles.length) continue;   // no role gate → nothing to drift from
          checked++;
          for (const role of roles) {
            if (!route.roles.includes(role)) {
              mismatches.push(`${rel}: ${pattern} is gated on [${route.roles.join(', ')}] but the UI lists '${role}'`);
            }
          }
        }
      }
    }

    assert.ok(checked > 25, `the guard only inspected ${checked} role lists — the scanner or the pattern drifted`);
    assert.deepEqual(unknownDoors, [],
      `the SPA names a door the server does not register (a typo is a control that can never work):\n${unknownDoors.join('\n')}`);
    assert.deepEqual(mismatches, [],
      `the UI offers a role the server refuses:\n${mismatches.join('\n')}`);
  });
});