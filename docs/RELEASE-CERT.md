# SchoolOS Release Certificate

**Release:** enterprise-grade production candidate · **Date:** 2026-09-07 · **Tree:** `ad6700a` (main, pushed)

## 1. Product

India-first, multi-tenant school operating system with an AI receptionist core: real authentication (scrypt + JWT, phone-OTP and Google SSO), a server-owned dataset hydrated after authentication, Postgres RLS tenancy on the kernel path, and a **plugin factory** — 12 first-party plugins on a uniform lifecycle-gated kernel-approval spine, a hash-chained append-only audit ledger, and governance (event budgets, capability contracts, drain protocol).

## 2. Verification evidence

| Gate | Result |
|---|---|
| Server suite | **114/114 pass, 0 fail, 0 cancelled** (15 files) |
| Full factory-check | ALL GREEN — tsc · server tests · auth lifecycle · responsive sweep (5×6) · zero page errors |
| RC visual audit | **PASS** — 46/46 owner routes, contrast 55/55 (light + dark), keyboard-complete, role matrix zero-PII |
| Red-team cycles | 6 — **FIX-FIRST ×3 → SHIP ×2 consecutive** (final tree) |
| Migrations | 001→030, applied ×2 (idempotence proven), seed-replay exercised |
| Live drills on record | DPDP erasure, guardian-OTP pickup, publication spine, comms delivery, fail-closed release |

## 3. Security posture (red-team arc)

Cycle 1 caught the release-blockers (OTP dev-echo takeover; unauthenticated 3.79 MB PII dataset) — both dead: dev-echo is opt-in + production-hard-off, `/dataset` requires authentication, the frontend hydrates auth-then-data. Cycle 3 caught the webhook fail-open HMAC — rebuilt fail-closed with raw-bytes MAC, replay dedupe, freshness windows, and a production boot-refusal. Cycles 5–6 caught the kernel-approval `UNIQUE(tenant,code)` second-raise class — closed per-instance everywhere with the SAVEPOINT catch pattern as the documented standard. Final tree survived cycle 6 with **SHIP**.

Enforced invariants: 24+ lifecycle-gated doors (instant 409), per-instance action codes, consent immutability via column-scoped grants, fail-closed child release with audited override, money movement kernel-only (proven: 10+ forged captures left obligations untouched), E.164 normalization at every people-door, IST-first date logic.

## 4. Interface

17 UI units: token discipline (116 declared tokens, 143+ references, zero stray hex), full a11y rotation (34 routes × 3 roles — keyboard-complete, APG menus/tabs/dialogs, skip-link, AA contrast light+dark), role-first gating with server-truth boards, dark mode with both-ways pixel proof, and a PASS RC visual verdict on the final tree.

## 5. Known limits (documented, accepted)

- Accepted P2s (queued post-release): per-account password throttle, token revocation on logout, localStorage token persistence, CORS wildcard pin before non-localhost deploy.
- Cross-tenant paths tested via second-tenant probes; no second-tenant credentials were provisioned for live red-team use.
- Demo credentials are public by design (displayed on the login screen); production deploy requires the plugin-lane identity work (per-lane API identities).
- `payments.upi` webhook requires `UPI_WEBHOOK_SECRET` (boot-refuses otherwise); dev-unsigned mode exists only with the secret absent.
- Audit-row accumulation on long-lived environments: reseed before production (append-only ledger is not deletable by design).
- Deploy contract: same-origin (API + app one origin) or `VITE_API_BASE` pinned at build time.

## 6. Factory record

Three parallel lanes over 6+ cycles: UI/UX (17 units), plugin development (12 plugins, migrations 011–030), red team (6 cycles, every finding remediated or pinned). Every unit accepted only after independent orchestrator verification; every red-team finding routed to a named owner and closed with regression tests.
