// PERFECT-100 §5.1 SEC-1 / §3 — RLS is a boundary only if the role reaching the
// tables is subject to it.
//
// THE DEFECT: the pool authenticated as `schoolos`, which OWNS every table and carries
// `rolbypassrls = true` — so RLS was not merely unenforced for it, it was SKIPPED. Only
// the `withUser(...)` call sites were protected, because they explicitly
// `SET LOCAL ROLE schoolos_app`. Every bare `q(...)` site ran as the owner, so tenant
// isolation was a property of call-site discipline rather than of the database.
//
// THE FIX: `q()` now runs as `schoolos_app` (no BYPASSRLS), so RLS applies to every
// ordinary query whether or not the author considered tenancy; privileged work must be
// explicitly named `sysq()`. The tests below pin BOTH halves — that ordinary queries are
// constrained, AND that privileged ones are explicit rather than accidental.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setupTestDb } from './helpers.js';

const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let app;
let db;
let owner;

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.ready();
  db = await import('../src/db.js');
  owner = (await db.sysq(`SELECT id, role, tenant_id, name FROM app.users WHERE email='owner@meridian.edu'`)).rows[0];
});

after(async () => { await app?.close(); });

const walk = (dir) => readdirSync(dir).flatMap((e) => {
  const p = join(dir, e);
  return statSync(p).isDirectory() ? walk(p) : (p.endsWith('.js') ? [p] : []);
});

describe('SEC-1 — the default query path is constrained, not the owner', () => {
  test('q() executes as schoolos_app, NOT as the BYPASSRLS owner', async () => {
    const r = await db.q(`SELECT session_user AS sess, current_user AS eff, current_setting('role') AS role_guc`);
    assert.equal(r.rows[0].sess, 'schoolos', 'the SESSION user is still the owner (it owns the tables)');
    assert.equal(r.rows[0].eff, 'schoolos_app',
      'but the EFFECTIVE role for an ordinary query is the constrained app role — this is what makes RLS apply');
    assert.equal(r.rows[0].role_guc, 'schoolos_app');
    // If someone reverts q() to pool.query, `eff` reverts to 'schoolos' and this fails.
  });

  test('the constrained role genuinely cannot bypass RLS', async () => {
    const { rows } = await db.sysq(`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname='schoolos_app'`);
    assert.equal(rows[0].rolbypassrls, false, 'schoolos_app must not carry BYPASSRLS');
    assert.equal(rows[0].rolsuper, false, 'nor superuser');
  });

  test('a tenant table read through q() with no tenant GUC returns NOTHING (fails closed)', async () => {
    const viaQ = (await db.q(`SELECT count(*)::int AS n FROM app.users`)).rows[0].n;
    const viaSysq = (await db.sysq(`SELECT count(*)::int AS n FROM app.users`)).rows[0].n;
    assert.equal(viaQ, 0,
      'RLS with no schoolos.tenant_id evaluates tenant_id = NULL → no rows. The direction of failure is what matters: '
      + 'a missed call site leaks nothing rather than leaking every school');
    assert.ok(viaSysq > 0,
      `the privileged path still sees the real population (${viaSysq}) — so the 0 above is RLS, not an empty table`);
  });

  test('withUser scopes reads to the named tenant and no other', async () => {
    const tenant = (await db.sysq(`SELECT id, slug FROM app.tenants ORDER BY slug LIMIT 1`)).rows[0];
    assert.ok(tenant, 'the seed must provide a tenant');
    const own = await db.withUser(tenant.id, 'owner', async (c) =>
      (await c.query(`SELECT count(*)::int AS n FROM app.students`)).rows[0].n);
    const total = (await db.sysq(`SELECT count(*)::int AS n FROM app.students`)).rows[0].n;
    assert.ok(own > 0, `a tenant must see its own students (got ${own})`);
    assert.equal(own, total, 'and, in a single-tenant seed, that is the whole table');

    // The real isolation claim: an id that matches no tenant sees NOTHING. This is what
    // proves the tenant GUC actually filters rather than the query merely succeeding.
    const stranger = await db.withUser(randomUUID(), 'owner', async (c) =>
      (await c.query(`SELECT count(*)::int AS n FROM app.students`)).rows[0].n);
    assert.equal(stranger, 0, 'a non-existent tenant must see zero rows, not every row');
  });

  test('a real tenant door still returns data (fails-closed must not become fails-silently)', async () => {
    // The failure mode of this whole change is a route that silently returns an empty
    // list because its query lost owner privileges. That would be its own instance of
    // success-shaped silence, so a tenant-serving path is asserted end-to-end.
    const token = app.jwt.sign({ sub: owner.id, role: owner.role, tenant: owner.tenant_id, name: owner.name, jti: randomUUID() });
    const res = await app.inject({ method: 'GET', url: '/students', headers: { authorization: `Bearer ${token}` } });
    assert.equal(res.statusCode, 200);
    assert.ok((res.json().students ?? []).length > 0, 'a tenant door must still see its own students');
  });
});

describe('SEC-1 — privilege must be explicit and reviewable', () => {
  test('no source file contains an un-named bare q( call (every site declares its privilege)', () => {
    const offenders = [];
    for (const f of walk(join(SERVER_ROOT, 'src'))) {
      if (f.endsWith('db.js')) continue;
      for (const [i, line] of readFileSync(f, 'utf8').split('\n').entries()) {
        if (/(?<![\w.$])q\(/.test(line)) offenders.push(`${f.replace(SERVER_ROOT + '/', '')}:${i + 1}`);
      }
    }
    assert.deepEqual(offenders, [],
      'q( is the CONSTRAINED helper; a privileged site must say sysq( so grep is a complete audit of privilege');
  });

  /* 110 → 111 (2026-09-14, PLG-2). The shared lifecycle gate now reads the tenant's plan on the owner path once
     per request (`sysq(SELECT plan FROM app.tenants …)`): a row saying `enabled` must not outvote the plan the
     school is actually on, and the plan lives on the tenant, not in the plugin row. One indexed primary-key lookup
     per plugin request is the honest price of enforcing a commercial boundary at the door. Justified here rather
     than absorbed silently — that is what this pin is for. */
  /* ── 111 → 112 (2026-09-14, DAT-3 — the delivery stage that no gauge measured) ───────────────────────
   * ONE new site in the `/metrics` handler (src/app.js): the webhook fan-out tallies — deliveries queued,
   * failed, and queued past due (`app.webhook_deliveries`).
   *
   * The owner path is REQUIRED for exactly the reason the comms gauges above require it: an ops gauge is a
   * CROSS-TENANT count, and a `withUser` read would silently narrow it to the caller's own school — reporting
   * a clean bill of health while every OTHER tenant's subscriber webhooks failed to arrive. That silent
   * narrowing is not hypothetical here; it IS the blind spot DAT-3 removed: before this change no gauge read
   * that table at all, so a drained `outbox_pending` looked healthy while every delivery was failing.
   *
   * Read-only, and it grants the app role nothing: the query reads only `status`/`next_attempt_at` counts,
   * never a payload and never a signing secret. Net privilege granted by this change: ZERO.
   *
   * NOTE ON PLACEMENT: this justification deliberately sits OUTSIDE the test body. Putting it inside pushed
   * the single `assert.equal` past the 80-line window that TST-4's vacuity gate scans, so the gate reported
   * this test as `no-assertion-in-test` — i.e. the comment explaining the pin broke the check on the pin.
   * A comment is not worth a blind spot in the gate.
   * ──────────────────────────────────────────────────────────────────────────────────────────────────── */
  /* ── 112 → 108 (2026-09-15, API-3 · PERFECT-100 §5.5 — the MFA recovery double-use race) ─────────────
   * FOUR owner-path sites became NONE. (a) Recovery-code consumption was a SELECT `… WHERE consumed_at IS
   * NULL` plus an UPDATE whose result was discarded; it is now ONE guarded `UPDATE … RETURNING`, and that
   * single statement IS the fix: under the old shape two concurrent requests both passed the read and both
   * were issued a session with the same code. (b) The enrollment mint (8 inserts + enable + `mfa_enrolled_at`)
   * moved from three `sysq(...)` calls into ONE owner transaction (`tx`), so the eight codes are
   * all-or-nothing instead of sometimes shown and never stored. Same owner role, fewer statements: net
   * privilege granted ZERO — the direction this pin is happy about.
   * ──────────────────────────────────────────────────────────────────────────────────────────────────── */
  /* ── 108 → 109 (2026-09-16, OPS-3 follow-up — the `/metrics` worker-counter export is restored) ───────
   * The duplicate-series fix had removed the generic `app.ops_counters` export outright, which also dropped
   * every worker heartbeat (`webhook_last_tick_epoch`, workflow counters). Restoring it adds ONE owner-path
   * read, for the same CROSS-TENANT reason the comms/outbox gauges above do: `app.ops_counters` is a GLOBAL
   * platform table with no `tenant_id`, so a `withUser` read would silently report only the caller's school.
   * It is a heartbeat read on the owner/itadmin-gated `/metrics` door, with a reserved-name exclusion that
   * keeps it from re-introducing a duplicate Prometheus series. Read-only; net privilege granted: ZERO.
   * ──────────────────────────────────────────────────────────────────────────────────────────────────── */
  // ────────────────────────────────────────────────────────────────────────────────────────────────────
  // Count-method note + the audited-inventory ledger. Deliberately OUTSIDE the test body: TST-4's vacuity
  // gate scans only the first ~80 lines of a test for an assertion, and this ledger is longer than that, so
  // keeping it inside made the gate report the pin itself as `no-assertion-in-test`. A comment is not worth
  // a blind spot in the gate.
  //
  // Count only real call sites: db.js DEFINES the helpers (and its own doc comments quote `sysq(`), so it is
  // excluded — and line comments are stripped so prose in any file cannot move the number.
  // NOTE on what this pattern cannot do: it counts the IDENTIFIER `sysq(`, and the rails used to contain
  // `export function bindKernel(sysq)` plus `bindKernel(sysq)` — a parameter declaration and an argument,
  // neither of them a query — which read as 110 owner-path sites when the true inventory was 108. A false
  // positive here is not harmless: it teaches the reader to raise the pin for nothing, which is how a pin
  // stops meaning anything. Fixed at the source rather than by cleverer matching: the parameter is now
  // named `ownerQuery` (accurate — the function is whatever owner-path query the caller binds, not
  // necessarily `sysq`). Tightening the regex to require a following quote was tried and REJECTED: 29 real
  // call sites put their SQL template on the next line, so it under-reported at 79.
  //
  // This number is the audited inventory of owner-privileged queries. If it changes,
  // someone must justify the new privilege here — the point is that it cannot grow
  // silently.
  //
  // 103 → 105 (2026-09-13, SEC-20): `GET /audit/verify` in src/routes.js adds TWO owner-privileged
  // queries — the app.audit_verify() call and the row/hash-version tally. The owner path is
  // REQUIRED there, not a convenience: app.audit_log_cold is REVOKE ALL from schoolos_app, so a
  // withUser implementation would read nothing on the archived side and still report a clean bill
  // of health — the exact success-shaped silence this item exists to remove.
  //
  // 105 → 106 (2026-09-13, SEC-21): the Razorpay webhook adds ONE query — the payload-independent
  // enumeration of per-tenant webhook secrets (src/plugins/payments.razorpay). This is the cost of
  // removing an unauthenticated oracle: verification previously derived its candidate list from the
  // RESOLVED (payload-supplied) order id, so the response and the query count varied with the
  // attacker's input (1 query + 403 for an unknown id, 2 + 401 for a known one). It is now a fixed
  // enumeration followed by a payload-independent answer, so an unauthenticated probe does the SAME
  // work whatever it sends — fewer owner-path queries than before in the worst case, and no timing
  // signal. Net privilege granted to the app role by this change: ZERO.
  // 106 → 107 (2026-09-13, PRD-13): `/metrics` gains ONE owner-privileged query counting the comms
  // population by carrier — `schoolos_comms_sandbox_sent` (rows whose status is 'sent' but whose
  // carrier reached nobody) and `schoolos_comms_failed`. The owner path is REQUIRED for exactly the
  // reason the two gauges already in that same query require it: an ops gauge is a CROSS-TENANT
  // count, and a withUser read would silently narrow it to one school — reporting a clean bill of
  // health for a fleet while every other tenant's messages went nowhere. Read-only; it grants the
  // app role nothing. Net privilege granted by this change: ZERO.
  // 107 → 108 (2026-09-13, PRD-13 part 2): ONE new call site in `ops.visitors`, the `DELETE FROM
  // plugin_visitors.pickup_otp` that withdraws the pickup code when it could not be delivered.
  // The owner path is REQUIRED and cannot be avoided: that table's RLS is `USING (false)` — the app
  // role is denied by design, and the file header states that secret reads/writes go through the
  // kernel/owner connection only. The alternative is not "less privilege", it is leaving a live
  // single-use credential in the vault with no way to redeem or revoke it. Note the OTHER new write
  // in that same path (the comms evidence row) deliberately does NOT appear here: `schoolos_app`
  // holds INSERT on app.communications and its policy checks `tenant_id = app.current_tenant()` as a
  // WITH CHECK, so that row is written through the constrained client, which proves tenancy rather
  // than asserting it.
  // 108 → 110 (2026-09-13, PRD-4 + OPS-5 — the credential rails and the honest OTP door). TWO sites, and
  // both are the price of the same thing: a rail must be SWITCHED ON before it may carry a credential.
  //   (a) `railEnabled()` in src/app.js — one read of the tenant's `rails.sms` status, used by BOTH the
  //       pre-lookup channel gate and the post-lookup one. It replaces the single inline read that stood
  //       here before, so the net for the OTP door is +0; what is genuinely new is that the RESET door now
  //       asks the same question, and one helper answering it twice is the least-privilege form of that.
  //   (b) the `DELETE FROM app.auth_otps … WITHDRAWN` in the OTP door — the withdrawal of a code the
  //       carrier could not deliver. Same reasoning as (c) below: the alternative is not "less privilege",
  //       it is a live single-use credential in a vault with no way to redeem or revoke it.
  // 112 → 108 (2026-09-15, API-3): four owner-path sites became one guarded UPDATE + one tx — see the header.
  // 111 → 112 (2026-09-14, DAT-3): ONE `/metrics` site, FULL JUSTIFICATION IN THE FILE HEADER BELOW.
  // Offsetting −1: `plugin-catalog.js` LOST its owner-path fallback read this round (it resolved a
  // manifest template from `app.plugins` for seven plugins; every plugin ships `manifest.js`, so the read
  // was dead code that silently swallowed its own failure). Least privilege is preferred, which is why it
  // is recorded here rather than quietly absorbed.
  //
  // Note on the inventory itself: the count is of owner-path QUERY sites, and until this round it also
  // counted `export function bindKernel(sysq)` and `bindKernel(sysq)` in the rails — a parameter name is
  // not a query. The parameter is now `ownerQuery` (accurate: whatever owner-path query the caller binds),
  // so the identifier and the inventory agree by construction. Tightening the regex to require a following
  // quote was tried and rejected — 29 real call sites put their SQL template on the next line, so it
  // under-reported at 79. A pin that cries wolf is a pin nobody reads.
  // 110 → 118 (2026-09-17, AUTH-4/8/9): the identifier-keyed throttle layer (request_throttles) plus the
  // AUTH-9 hardening added owner-path sites, ALL on kernel-only secrets/state that the app role is denied:
  // requestThrottleLocked/clearRequestThrottle/bumpLoginThrottle (login lockout), otpRequestAllowed
  // (SELECT+INSERT per-phone cap), bumpMfaThrottle (cumulative MFA lockout), and the reset-request timing
  // equaliser's decoy token INSERT. `auth.request_throttles`, `auth.reset_tokens` and `auth.mfa_challenges`
  // are RLS-denied to schoolos_app by design, so `sysq` is the only possible path; no privilege is granted
  // to the app role. The count was NOT updated when AUTH-4/8 landed and the pin's own test file was not in
  // that batch — corrected here rather than hidden.
  // 109 → 110 (2026-09-17, OPSX-3/8): ONE combined owner-path read on the owner/itadmin-or-metrics-scoped
  // `/metrics` door now carries every fleet-wide alert gauge the rules file declares under `metric:`.
  // The owner path is REQUIRED for the same reason the existing /metrics gauges require it: these are
  // CROSS-TENANT counts and a withUser read would silently narrow them to the caller's school, which is
  // the OPSX-3 blind spot itself. The +1 also covers the migrations_pending comparison (files on disk vs
  // app.schema_migrations), which is a platform table with no tenant_id. Read-only; the app role gains
  // nothing. Net privilege granted by this change: ZERO.
  // ────────────────────────────────────────────────────────────────────────────────────────────────────
  // 118 → 120 (2026-09-17, library v2, docs/LIBRARY-DESIGN.md): the library plugin's existing owner-path
  // `settings()` read is unchanged, and the librarian notification-settings door adds TWO more explicit
  // owner-path sites — a read and a write of the plugin's OWN `app.plugins.settings` row. The owner path is
  // REQUIRED because `app.plugins` is the registry the app role does not own; the row is the plugin's own
  // configuration, not tenant data, and the write is role-gated to `librarian`. Net tenant privilege: ZERO.
  // 120 → 121 (2026-09-17, FEE-OPS-1): the fee-domain gauges on the owner/itadmin-gated `/metrics` door add
  // ONE owner-path read (outstanding/collected/stale-initiated/disputed/dunning-queued). The owner path is
  // REQUIRED for the same reason every other /metrics gauge requires it: these are CROSS-TENANT counts, and a
  // withUser read would silently narrow them to the caller's school. Read-only; the app role gains nothing.
  // Net privilege granted by this change: ZERO.
  // 121 → 122 (2026-09-17, LIB-E1/E6): the library-domain gauges on the same `/metrics` door add ONE
  // owner-path read carrying the tenant KPI gauges AND the fleet-wide alert gauges the rules file names
  // (holds stalled, chronic overdue, stale fines). The owner path is REQUIRED for the fleet half for the
  // same OPSX-3 reason as the fee gauges — a withUser read would narrow the alert signal to the caller's
  // school and hide a stalled queue everywhere else. Read-only; the app role gains nothing.
  // Net privilege granted by this change: ZERO.
  // 122 → 124 (2026-09-21, SEC-1): step-up re-auth adds TWO owner-path reads of `app.users.password_hash`
  // — `app.requireStepUp` (the guard) and `POST /me/step-up` (issuing the token). The owner path is
  // REQUIRED because `password_hash` is column-scoped away from `schoolos_app` (migration 077), so the
  // constrained client cannot read the credential to verify it. Read-only; no new privilege reaches the
  // app role (it still cannot SELECT password_hash).
  // 124 → 127 (2026-09-22, C3): student idle moved to the shared `auth.session_activity` store, adding
  // THREE owner-path queries (SELECT last_seen, DELETE on expiry, upsert last_seen) in the authenticate
  // hook. `auth.session_activity` is kernel-only (no grant to schoolos_app), so sysq is the only possible
  // path; no new privilege reaches the app role.
  // ────────────────────────────────────────────────────────────────────────────────────────────────────
  test('the privileged call-site count is PINNED (adding privilege requires a deliberate edit)', () => {
    let count = 0;
    for (const f of walk(join(SERVER_ROOT, 'src'))) {
      if (f === join(SERVER_ROOT, 'src', 'db.js')) continue;
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        count += (line.split('//')[0].match(/(?<![\w$])sysq\(/g) ?? []).length;
      }
    }
    const AUDITED = 127;
    assert.equal(count, AUDITED,
      `owner-privileged query sites changed: ${count} vs ${AUDITED}. If you added one, justify it here; `
      + 'if you removed one, prefer it (least privilege). Never raise this number without a reason.');
  });

  test('every direct pool connection outside db.js is EXPLICITLY constrained to the app role', () => {
    const offenders = [];
    for (const f of walk(join(SERVER_ROOT, 'src'))) {
      if (f.endsWith('db.js')) continue;
      const src = readFileSync(f, 'utf8');
      if (!/pool\.connect\(/.test(src)) continue;
      // A raw connection must set the constrained role — or be an allowlisted owner
      // path that states WHY. The allowlist is explicit so a new privileged module
      // cannot appear silently: it has to be justified here.
      const rel = f.replace(SERVER_ROOT + '/', '');
      const OWNER_PATH_ALLOWLIST = {
        'src/onboarding.js':
          'self-signup creates a tenant and its first owner — a cross-tenant INSERT that the '
          + 'app role must not be able to perform (comment in-file: "ONE owner-path transaction")',
      };
      if (OWNER_PATH_ALLOWLIST[rel]) continue;
      const constrained = /SET LOCAL ROLE\s+'?schoolos_app/.test(src) || /SET LOCAL ROLE \$\{/.test(src);
      if (!constrained) offenders.push(rel);
    }
    assert.deepEqual(offenders, [],
      'a module that borrows a raw pool connection must constrain it with SET LOCAL ROLE schoolos_app, '
      + 'or be added to OWNER_PATH_ALLOWLIST with a stated reason');
  });
});
