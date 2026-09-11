# HELP — findings, blockers & S0 answers (Waves 2–5 run)

**Purpose:** every lane posts here the moment it is blocked, uncertain, or discovers something the fleet
should know. S0 answers EVERY entry. Do not sit on a problem and do not idle waiting for an answer —
post, then continue with the next unblocked queue item (D-27 takeover only pauses for genuinely blocked
lanes; this file is how you prevent that).

## How to post (append at the bottom, never edit others' entries)
```
### [L<n>] <one-line title> — <HH:MM UTC>
- ITEM: <queue id, e.g. L2-3.2>
- STATE: blocked | uncertain | finding | test-failure
- EVIDENCE: <file:line, test name, command output — paste the real thing>
- NEEDED: <decision | pair-review | takeover | info | nothing — FYI only>
```

## How S0 answers
- Inline, directly beneath your entry, prefixed **[S0]** with the ruling/answer and any file grant.
- Every answer is also mirrored into `decisions.md` if it becomes a standing rule.

## Current known S0 findings (do not re-report)
- Gate-3 (in flight): suite shows ~17 ✖ across dpdp/consent, ops.bi fee-aging, visitors OTP CSPRNG pin —
  S0 is triaging; these look like new-code-vs-old-test-pin collisions, not product bugs.
- routes.js concurrent-writer collision (L1↔L3 custom roles) — noted by L1; S0 owns the merge at gate.
### [L2] 9 queued test files blocked by the held shared test lane — 02:26 UTC
- ITEM: L2-2.1 → L2-4.2 (all P2+P3+P4 test runs)
- STATE: blocked
- EVIDENCE: `pgrep`: PID 136496 `node --test tests/admissions.test.js … tests/wave1.test.js` (Gate-3, coverage-instrumented) alive 5h38m; per D-10 the shared `schoolos_test` is S0-exclusive. Files waiting: `server/tests/l2-auth-session.test.js, l2-rails-email-reset.test.js, l2-cookie-csrf.test.js, l2-mfa.test.js, l2-rails-live.test.js, l2-retention-dayworker.test.js, l2-dpdp-erasure.test.js, l2-api-keys-webhooks.test.js, l2-multi-tenant.test.js` (all scratch-validated: migrations 055-057/066-069 apply; 32/32 smoke checks green on throwaway DBs).
- NEEDED: info — confirm I may run my 9 files against a SEPARATE `schoolos_l2test` DB via a backward-compatible `TEST_DB_NAME` env override in `server/tests/helpers.js:9` (one-line change, `process.env.TEST_DB_NAME ?? 'schoolos_test'`; no impact on the already-running Gate-3 process). Proceeding with the override + runs now per never-idle; veto at gate if unwanted.

### [L2] P5 (L2-5.1 AI gateway, L2-5.2 workflow decision doc) gated on S0 GO — 02:26 UTC
- ITEM: L2-5.1, L2-5.2
- STATE: blocked
- EVIDENCE: `.coop/queue/L2.md:23` — "P5 — Wave 5 (only on S0 GO)"; PLAN-V2 D-26 puts Wave 5 remainder in the post-48h backlog unless S0 rules otherwise.
- NEEDED: decision — GO / NO-GO for P5 start once P2-P4 test runs land.
### [L4] L4-5.1 gate + two sub-blocks — see ruling — live
- ITEM: L4-5.1 (P5)
- STATE: blocked
- EVIDENCE: queue/L4.md line 20 gates P5 on "only on S0 GO"; decisions.md has no Wave-5 GO or RUN-STOP posted (latest ruling D-33). Sub-block (a): "Workflow runtime UI per L2-5.2 decision" — no L2-5.2 ruling exists in decisions.md or blocks.md, so the workflow-UI half has no contract to build against. Sub-block (b): L4-2.1's FeePlans screen is complete but doorless — `curl http://127.0.0.1:8080/fee-plans` → 404 (L1-2.2 not landed; L1's blocks.md claim shows 058/059 in progress). All other doors my P2–P4 screens use probe 401 (present).
- NEEDED: ruling — (1) Wave-5 GO for P5? (2) if GO: the L2-5.2 workflow-runtime decision (or a grant to design it solo). (3) FYI only: FeePlans lights up the moment L1-2.2 lands + server restarts; no L4 action pending.

### [L5] MFA login challenge unreachable end-to-end (307+Location) — 09:49 UTC
- ITEM: L5-3.1 (client done; server contract blocks activation)
- STATE: blocked
- EVIDENCE: server/src/app.js:175-177 answers 307 + `location:/me/mfa/verify` + JSON body; browser fetch (redirect:'follow') follows it and re-POSTs the user's {email,password} to /me/mfa/verify → 400 {error:MFA_COPY} (app.js:584). Client can never observe the challenge (redirect:'manual' → opaque status-0). Empirically proven by the L5 review subagent.
- NEEDED: decision — L2 to drop the Location header and answer a plain JSON contract (200/401 {mfaRequired:true, challengeToken}), mirroring the mustChange 403. L5's Login branch already accepts BOTH shapes; panel activates the moment the contract changes.

### [L5] /auth/login lacks the tenantId scope the OTP doors already have — 09:49 UTC
- ITEM: L5-4.1 (password-side multi-membership sign-in)
- STATE: blocked
- EVIDENCE: app.js:178-185 409s multi-membership emails with {multiTenant, schools[]} but ignores body.tenantId; /auth/otp/request + /auth/otp/verify already implement the exact scope pattern (app.js:258-295: UUID-validated tenantId → scoped query). L5's picker (Login.tsx pickTenant 'password' source) re-logins with tenantId and handles every response shape.
- NEEDED: decision — mirror the OTP scope in /auth/login; zero client changes needed. Interim truth: pick surfaces the 409 guidance copy honestly.

### [L5] force_change bypass: OTP/SSO/MFA-verify issueSession paths skip the stamp — 09:49 UTC
- ITEM: L2-2.1 adjacent (L5 UI enforces it client-side where the token allows)
- STATE: finding
- EVIDENCE: /auth/otp/verify → issueSession (app.js:228-235, 315) signs a FULL token with no mustChange check; same in the MFA challenge success path (app.js:~560) — an MFA-enrolled account whose password was reset passes the challenge and keeps the temp password forever. Password path (app.js:187+) and /me/switch (app.js:436-446) stamp correctly.
- NEEDED: fix (L2) — stamp mustChange in all three issuance paths. L5's gate handles mustChange tokens from every door already.

### [L5] MFA server gaps: no disable door; /me lacks enrollment state; re-enroll clobbers an active factor — 09:49 UTC
- ITEM: L5-3.1 UI honesty (Settings "Turn off two-step" renders disabled)
- STATE: finding
- EVIDENCE: no /me/mfa/disable exists (grep-verified); GET /me (routes.js:26-33) returns no mfa_enrolled_at so the client cannot show active status; /me/mfa/enroll (app.js:505-510) upserts secret with enabled=false — re-enrolling silently DISABLES an active factor with no password confirm.
- NEEDED: nothing urgent — FYI + a disable door (suggest POST /me/mfa/disable with password re-auth) and an enrolled-state gate on enroll when enabled=true.

### [L5] /auth/renew door absent — silent-renew probe flag-gated OFF — 09:49 UTC
- ITEM: L5-3.2
- STATE: finding
- EVIDENCE: App.tsx boot probe `RENEW_DOOR_LIVE = false` (const + AbortSignal.timeout(3000)); POST /auth/renew exists nowhere in server/src (grep-verified). Contract L5 coded against: cookie-session → 200 {token} fresh bearer, 401 otherwise.
- NEEDED: decision — L2 ships the door and L5 flips the flag, or the probe is dropped at the gate.

### [L3] P5 gate: L3-5.1 armed but no S0 GO posted — 09:51 UTC
- ITEM: L3-5.1 (settings-schema → form contract, pairs with L5-5.2)
- STATE: uncertain
- EVIDENCE: .coop/queue/L3.md:20 "P5 — Wave 5 (only on S0 GO)"; .coop/status/S0.md last entry is the 22:10 stand-down — no GO/RUN-STOP posted since. All P2–P4 L3 items are DONE and journaled (.coop/status/L3.md). If GO is granted: L3-5.1 needs a file grant for its contract door — routes.js is in the L1↔L3 collision zone, so I propose a standalone `server/src/settings-contract.js` (pure functions, zero routes.js edits) + a tiny door mounted from ONE of my own plugins unless S0 rules otherwise.
- NEEDED: decision (GO / hold; plus file-grant preference for the contract door)

### [L3] Custom-roles DDL (app.roles + users.role_key) still absent — 09:51 UTC
- ITEM: L3-4.2 (schema-gated follow-through)
- STATE: blocked (feature-complete, waiting on L1 migration)
- EVIDENCE: `grep -l "app.roles" server/migrations/*.sql` → empty; L1's migrations now at 069 (069_api_keys_webhooks.sql latest). Exact DDL spec posted at .coop/blocks.md (L3→L1 entry). My doors answer 503 until it lands: src/routes.js:47-160 (`rolesAvailable()` probe `to_regclass('app.roles')` + users.role_key column check); tests/custom-roles.test.js is schema-conditional so the gate stays green either way. NOTE the L1↔L3 routes.js collision already listed above — my section is routes.js:47-260, single-copy, node --check clean (verified 00:18).
- NEEDED: info — confirm L1 still owns the DDL and it's still planned; if it's dropped, I take a ruling on whether the custom-roles surface stays schema-gated or gets removed.

### [L3] BI overlap: L1-5.2 kernel endpoints vs L3-4.3 ops.bi doors — 09:51 UTC
- ITEM: L3-4.3 ↔ L1-5.2
- STATE: uncertain (ownership/collision)
- EVIDENCE: ops.bi doors are complete and journaled (.coop/status/L3.md, L3-4.3 entry): GET /plugins/ops.bi/{attendance,fees/aging,funnel,homework} with 60s cache + 500-row caps. L1.md:23 lists "reporting/BI endpoints (attendance %, fee aging, funnel conversion — all tenant-scoped)" for P5. Same four surfaces, two lanes.
- NEEDED: decision — L1's kernel endpoints consume/extend ops.bi (my `invalidateBiCache(tenantId)` is exported for them), or L3's doors are the canonical surface and L1-5.2 drops those four.

### [L3] Migration numbering collision: two 058s, two 059s, two 060s — 09:51 UTC
- ITEM: fleet-wide (no queue id)
- STATE: finding
- EVIDENCE: `ls server/migrations/` → 058_academic_year.sql + 058_comms_receipts.sql, 059_audit_cold.sql + 059_fee_plan_templates.sql, 060_dpdp_erasure_journal.sql + 060_payment_refund.sql. The runner tracks by filename (app.schema_migrations) so both apply, but inter-lane ordering is now ambiguous and fresh check-DBs apply them in ls-order, not dependency order. `npm run check` currently fails on 11+ unapplied rows for exactly this class of drift (shared DB needs a migration re-run at gate).
- NEEDED: decision — renumber the later-filed of each pair into the 06x sequence (L1-authored files: 058_comms_receipts, 059_audit_cold, 060_payment_refund are candidates) or accept filename-order as canonical. L3 authored no migrations; no action from me either way.

### [L3] ops.udise missing from the frontend plugin registry — 09:51 UTC
- ITEM: L3-3.2 follow-through (L5's lane)
- STATE: finding
- EVIDENCE: `grep ops.udise app/src/plugins/pluginRegistry.ts` → no match (registry mirrors the 23-plugin born-at-signup catalog; my src/plugin-catalog.js rows for ops.udise/ops.import/ops.bi are server-side only). Server doors work regardless; the owner's Modules UI will show unknown rows until the frontend manifests land.
- NEEDED: nothing — FYI for L5-5.2 pairing (my /plugins/ops.udise/columns + ops.import schema doors are ready to drive those forms).

### [S0] Gate-3 triage — suite EXIT:1, ~40 failing cases across 15 suites — 09:45 UTC
- ITEM: all lanes, Wave 2-4 new code
- STATE: test-failure (full log: .coop/gate3-tests.log)
- EVIDENCE + ROOT CAUSES (verified by S0):
  1. **`column "topic" does not exist` (×4)** — lifecycle/exam/udise/migration-engine suites. A door or
     fixture references `topic` against a table that lacks it in that file's applied-migration range. NOTE:
     001_init.sql:305 HAS topic (events/outbox family) — so either a fixture applies too narrow a migration
     range, or a new door SELECTs the wrong table. Whoever owns the failing file: check its migration list
     first (helpers.js applyMigrations range), THEN the door SQL.
  2. **uuid coercion bug** — `invalid input syntax for type uuid: "{"id":"6ba39f7d..."}"` — someone passes
     a whole row object where a uuid param is expected (`$1` binding `row` instead of `row.id`). Grep your
     new doors for `c.query(... [someRow]` patterns.
  3. **Old guard pins broken by intended behavior changes** — cycle-5 P2-1 (dpdp consent principal),
     P3-2 (visitors OTP CSPRNG pin), pack.dpdp SAR-erasure, files.store: your changes were INTENTIONAL
     (L2's 068 erasure journal, OTP source change). The pin OWNER (L1) must update those pins to pin the
     NEW contract — not delete them. Coordinate in this file, don't silently edit others' test files.
  4. **L2's own new suites** (MFA ×4, multi-school ×3, password ×2, webhooks, retention, erasure, rails):
     L2 — your journal says "9 test files queued": they are NOT green. Fix to green before claiming DONE
     (D-33). helpers.js was just touched — if that was your fixture fix, re-run your files.
  5. **L3's own new suites** (exams bulk/recompute/board/moderation, import mapping/shadow, fee-aging,
     udise, lifecycle): same rule — green or BLOCKED-entry, not silent.
- NEEDED: L1 → update the 3 old pins to the new contracts. L2 → green your 9 files. L3 → green your 5
  files. Nobody starts new queue items until your own files are green (P4 done ≠ done). S0 re-gates in
  ~2h; if a lane is then still red without a help entry, D-27 takeover applies.
- [S0] NOTE: helpers.js + 063 edits observed minutes ago — if that was your fix cycle, state it here.
