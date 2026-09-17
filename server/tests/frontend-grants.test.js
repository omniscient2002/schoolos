// Frontend permission RENDERING — and a drift guard against the server's rule.
//
// WHY THIS LIVES IN server/tests/: the web app has no test runner (TST-6: 44k LOC, no runner, no CI step),
// and this repository's gate is `node --test tests/*.test.js`. Node 26 strips TypeScript types natively, so a
// client module can be imported and asserted here instead of not at all. It is placed in `server/tests/` so it
// runs with everything else; the moment the web app gets a runner, move it next to the module.
//
// WHAT IT PINS:
//   1. THE CLIENT MIRROR AND THE SERVER RULE AGREE, case by case, on the same table. `app/src/lib/grants.ts`
//      re-implements the matching rule so a screen can decide what to RENDER; if either side drifts, one of
//      them starts hiding a control the server would allow (or offering one it will refuse). This test is the
//      only thing standing between those two copies, so it compares them directly rather than asserting
//      hand-written expectations twice.
//   2. The librarian case that motivated all of it: a teacher-based custom role granted the library doors must
//      be admitted by `roleOrGrant` even though `teacher` is not in the built-in list — and a DENY must still
//      win, so the screen cannot offer a control the server refuses.
//   3. `LibraryLive.tsx` actually ASKS the mask rather than comparing the built-in role string, which is the
//      defect (RBAC-3: "sees the module title but none of its controls"). Asserted against the source because
//      there is no DOM runner — a source assertion is weak evidence, and it is labelled as such.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCustomRoles } from '../src/custom-roles.js';
import { patternCovers, maskDecision, granted, grantedAny, roleOrGrant } from '../../app/src/lib/grants.ts';
import { canSurface } from '../../app/src/lib/effective.ts';
import { mapAccountRole, isLightRole, KNOWN_ROLES, UNKNOWN_ROLE_FALLBACK } from '../../app/src/lib/roles.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const serverRule = createCustomRoles({ withUser: async () => { throw new Error('pure matcher only — no DB'); } });

// (pattern, method, path) — the awkward cases included on purpose: prefix wildcards, a '?' suffix, a
// trailing slash, a path that merely STARTS with another path, and a method that must not match.
const CASES = [
  ['GET /plugins/library/books', 'GET', '/plugins/library/books'],
  ['GET /plugins/library/books', 'GET', '/plugins/library/books?q=x'],
  ['GET /plugins/library/books', 'GET', '/plugins/library/books/'],
  ['GET /plugins/library/books', 'POST', '/plugins/library/books'],
  ['POST /plugins/library/loans/*', 'POST', '/plugins/library/loans/abc-123/return'],
  ['POST /plugins/library/loans/*', 'POST', '/plugins/library/loans'],
  ['POST /plugins/library/loans/*', 'GET', '/plugins/library/loans/x'],
  ['* /plugins/ops.bi/*', 'GET', '/plugins/ops.bi/overview'],
  ['* /plugins/ops.bi/*', 'POST', '/plugins/ops.bi/overview'],
  ['GET /students', 'GET', '/students'],
  ['GET /students', 'GET', '/students/extra'],
  ['GET /students', 'GET', '/students-extra'],
  ['GET /students', 'GET', '/students/'],
  ['GET /fees/obligations', 'GET', '/fees/obligations?studentId=1'],
  ['GET /dataset', 'GET', '/dataset'],
  ['GET /dataset', 'GET', '/datasets'],
  ['brokenpattern', 'GET', '/dataset'],
  ['GET ', 'GET', '/dataset'],
];

describe('the client mirror matches the server rule exactly', () => {
  test('patternCovers ≡ server patternMatches on every awkward case', () => {
    for (const [pattern, method, path] of CASES) {
      assert.equal(patternCovers(pattern, method, path), serverRule.patternMatches(pattern, method, path),
        `client and server disagree on ${pattern} vs ${method} ${path} — one will hide a control the other allows`);
    }
  });

  test('maskDecision ≡ server maskDecides, including deny-beats-allow', () => {
    const masks = [
      { allow: [], deny: [] },
      { allow: ['GET /plugins/library/books'], deny: [] },
      { allow: ['GET /plugins/library/books', 'POST /plugins/library/loans'], deny: ['POST /plugins/library/loans'] },
      { allow: ['* /plugins/ops.bi/*'], deny: ['GET /dataset'] },
      { allow: ['GET /students'], deny: ['GET /students'] },
    ];
    for (const mask of masks) {
      for (const [, method, path] of CASES) {
        assert.equal(maskDecision(mask, method, path), serverRule.maskDecides(mask, method, path),
          `client and server disagree on ${method} ${path} for ${JSON.stringify(mask)}`);
      }
    }
  });
});

describe('the librarian role renders its controls (RBAC-3)', () => {
  const LIBRARY = ['GET /plugins/library/books', 'POST /plugins/library/books', 'POST /plugins/library/loans', 'GET /plugins/library/loans'];
  const BUILTIN = ['owner', 'principal', 'coordinator', 'facilities'];

  test('a teacher-based custom role granted the library is admitted, though teacher is not in the built-in list', () => {
    const librarian = { role: 'teacher', role_key: 'librarian', custom: { allow: [...LIBRARY, 'POST /plugins/library/loans/*'], deny: [] } };
    assert.equal(BUILTIN.includes(librarian.role), false, 'the premise: teacher is NOT a library role');
    assert.equal(roleOrGrant(librarian, BUILTIN, LIBRARY), true,
      'this is the whole fix — otherwise the librarian sees the module title with none of its controls');
  });

  test('a plain teacher with no custom role is still refused the staff view', () => {
    assert.equal(roleOrGrant({ role: 'teacher', custom: null }, BUILTIN, LIBRARY), false);
    assert.equal(roleOrGrant({ role: 'teacher' }, BUILTIN, LIBRARY), false);
    assert.equal(roleOrGrant(null, BUILTIN, LIBRARY), false);
  });

  test('a DENY still wins, so the screen cannot offer a control the server refuses', () => {
    const restricted = { role: 'teacher', custom: { allow: [...LIBRARY], deny: ['GET /plugins/library/loans'] } };
    assert.equal(granted(restricted, 'GET /plugins/library/loans'), false, 'deny beats allow, exactly like the server');
    assert.equal(roleOrGrant(restricted, BUILTIN, LIBRARY), true, 'the other doors are still granted');
    // and a role that only DENIES the library doors cannot reach the staff view
    const denied = { role: 'teacher', custom: { allow: [], deny: ['GET /plugins/library/books', 'POST /plugins/library/books', 'POST /plugins/library/loans', 'GET /plugins/library/loans'] } };
    assert.equal(roleOrGrant(denied, BUILTIN, LIBRARY), false);
  });

  test('the built-in roles keep working without any mask', () => {
    for (const r of BUILTIN) assert.equal(roleOrGrant({ role: r, custom: null }, BUILTIN, LIBRARY), true, r);
    assert.equal(grantedAny({ role: 'owner' }, []), false, 'no doors named → no grant');
  });

  test('the provisioning screen offers every role the console can actually create (RBAC-2 follow-up)', () => {
    // The reviewer's finding: the server accepted `counselor` while the only place a school appoints people
    // listed ten roles without it — the new role was reachable only by hand-written requests. A label list is
    // not testable through the DOM (no runner), so this is a source check, the same form the library test
    // above uses: the options must be DERIVED, and every derived role must have a label to render.
    const src = readFileSync(join(HERE, '../../app/src/screens/PeopleAdmin.tsx'), 'utf8');
    assert.match(src, /ROLE_OPTIONS\s*=\s*KNOWN_ROLES/, 'the option list must derive from the one role declaration');
    assert.ok(!/ROLE_OPTIONS\s*=\s*\[/.test(src), 'a hand-written list is how it fell behind');
    const labels = (src.match(/const ROLE_LABEL[\s\S]*?\n\};/) ?? [''])[0];
    for (const r of KNOWN_ROLES) {
      if (r === 'owner' || r === 'student') continue;   // not provisioned through this console by design
      assert.ok(labels.includes(r + ':'), `ROLE_LABEL must cover ${r} or the dropdown shows a raw key`);
    }
  });

  test('the client role list and the server role list cannot drift (RBAC-8)', async () => {
    // The class of defect this catches: `counselor` lived in five server gate lists and a shipped screen
    // while the server refused to issue it, and the docs published thirteen roles while the code had twelve.
    // One declaration, checked against the client mirror, so a role added on either side fails here.
    const { ROLES } = await import('../src/auth.js');
    assert.deepEqual([...KNOWN_ROLES].sort(), [...ROLES].sort(),
      `the client knows ${KNOWN_ROLES.length} roles, the server ${ROLES.length}`);
  });

  test('RBAC-3b: an unrecognised role fails CLOSED — it must never become the broadest role', () => {
    // The defect: `mapAccountRole` ended `: 'principal'`, so any role string the client did not know — a
    // newly added built-in, a value the server started returning, a malformed one — rendered the full
    // management shell and passed the staff-only guard. A guess toward maximum privilege.
    // (`counselor` used to belong in this list — it was a string the client knew and the server did not.
    //  RBAC-2 made it real, so it is asserted on the KNOWN side now, which is the point of the drift guard.)
    for (const r of ['librarian', 'api', 'warden', '', 'PRINCIPAL', 'owner ', 'principal2', null, undefined]) {
      assert.equal(mapAccountRole(r), 'student', `unrecognised role ${JSON.stringify(r)} must fail closed`);
      assert.notEqual(mapAccountRole(r), 'principal', 'and never to the broadest role');
    }
    assert.equal(UNKNOWN_ROLE_FALLBACK, 'student', 'the fallback is the lightest surface, by definition');
    assert.equal(mapAccountRole('counselor'), 'counselor', 'the 13th role maps to itself like the other twelve');
    // every genuine role still maps to itself — the fix must not disturb the shipped roles
    for (const r of KNOWN_ROLES) assert.equal(mapAccountRole(r), r);
    // case matters: the server sends lowercase, so 'PRINCIPAL' is NOT a known role and must not be trusted
    assert.equal(mapAccountRole('OWNER'), 'student', 'a case-mismatched owner must not be treated as an owner');
  });

  test('light-role routing follows the same fail-closed mapping', () => {
    assert.equal(isLightRole('parent'), true);
    assert.equal(isLightRole('student'), true);
    assert.equal(isLightRole('teacher'), false);
    // the security-relevant direction: an unknown role is treated as LIGHT, so it cannot reach the
    // staff-only Guard surfaces while the client does not know what it is
    assert.equal(isLightRole('some-new-role'), true);
  });

  test('the client reads the SERVER effective-access answer for render decisions (item 14)', () => {
    // The server decides; `canSurface` only reads. FEX-5: a surface the server did not name now fails
    // CLOSED (the server maps every renderable route, so an unnamed path is a typo or an unmapped
    // screen — showing it would re-open the "unknown role becomes broadest" defect). A missing payload
    // is still allowed because the server has not spoken yet and still enforces every door.
    assert.equal(canSurface(undefined, '/roles'), true, 'no payload → no opinion, server still enforces');
    assert.equal(canSurface({ role: 'teacher', capabilities: {} }, '/roles'), false, 'unnamed surface now fails closed (FEX-5)');
    assert.equal(canSurface({ role: 'teacher', capabilities: { '/roles': false } }, '/roles'), false);
    assert.equal(canSurface({ role: 'teacher', capabilities: { '/people': true } }, '/people'), true);
    // the two broker surfaces the palette and the sidebar both consult
    const eff = { role: 'teacher', capabilities: { '/roles': false, '/library': true } };
    assert.equal(canSurface(eff, '/library'), true);
    assert.equal(canSurface(eff, '/it'), false, 'a surface the server did not name is hidden, not shown (FEX-5)');
  });

  test('FE-1: the IT-admin screen presents no fabricated infrastructure telemetry (source check)', () => {
    // The register's most damaging UI honesty defect: hardcoded per-service metrics under "Live service
    // posture" that no code path measures. Asserted against the source because there is no DOM runner; the
    // specific strings are the ones that were shown to customers.
    const src = readFileSync(join(HERE, '../../app/src/screens/ItAdmin.tsx'), 'utf8');
    // Strip comments first: the code DELETED the fabricated figures and documents what they were, which is
    // the honest thing to do — only a string the user can actually be shown counts.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const claim of ['99.97%', '14ms query p95', '3 read replicas', '99.2% delivery', 'all rate-limited']) {
      assert.ok(!code.includes(claim), `ItAdmin still presents "${claim}" — nothing measures it (FE-1)`);
    }
  });

  test('nav and the command palette ask the effective-access answer (source check — no DOM runner exists)', () => {
    const shell = readFileSync(join(HERE, '../../app/src/components/Shell.tsx'), 'utf8');
    assert.match(shell, /canSurface\(effective/, 'the sidebar must filter by the server answer');
    assert.match(shell, /canSurface\(live\.effective/, 'the command palette must filter by the server answer');
    assert.match(shell, /isLight && !\(it\.path\?\.startsWith\('\/parent'\)/, 'a parent/student must not see staff palette destinations');
    const appSrc = readFileSync(join(HERE, '../../app/src/App.tsx'), 'utf8');
    assert.match(appSrc, /apiMeEffective\(\)/, 'the session must carry the effective-access answer');
    assert.match(appSrc, /canSurface\(live\.effective, pathname\)/, 'the route guard must consult the server answer');
  });

  test('LibraryLive asks the mask, not the built-in role string (source check — no DOM runner exists)', () => {
    const src = readFileSync(join(HERE, '../../app/src/screens/LibraryLive.tsx'), 'utf8');
    assert.match(src, /roleOrGrant\(live,/, 'the screen must consult the caller\'s own mask');
    assert.ok(!/const isStaff = \[[^\]]*\]\.includes\(live\.role\)/.test(src),
      'and must NOT decide from the built-in role list alone — that is the bug (teacher-based librarian)');
    // the server must be the one that actually surfaces the mask, or the client has nothing to ask
    const me = readFileSync(join(HERE, '../src/routes.js'), 'utf8');
    assert.match(me, /role_key: custom\?\.key \?\? null/, '/me must return the caller\'s own binding');
    assert.match(me, /custom: custom \? \{ allow: custom\.allow, deny: custom\.deny \} : null/, 'and its own mask');
  });
});
