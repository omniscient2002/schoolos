# RELEASE CERTIFICATE — REL-CERT-002

| | |
|---|---|
| **Issued** | 2026-09-05, battery run 12:39–19:05 UTC (local +05:30) |
| **Issuer** | QA-1, standing QA & release engineer (verify-only; no production code modified) |
| **Scope** | Re-certification: production hardening per docs/12 §23 integrated with REDTEAM-1 RTR-001 criticals |
| **Build variants** | Live build serving on :4310 (`dist/assets/index-CFgOXw9D.js`, 69 assets, dist untouched). Fresh verification builds to `.qa-relcert2-tmp/dist-*`: mock `index-CWU14xxZ.js` (69 assets), live `VITE_LIVE_API=1` `index-Bc8JxAJ9.js` (69 assets). |
| **Commit-ish state** | Still **not a git repository** (`git rev-parse` → fatal). Provenance by build-content hash only — repeat WARN W4 from REL-CERT-001. |
| **Servers** | API :8080 healthy (restarted 12:33 UTC by CTO with fixes; `/health {"status":"ok","db":true}` verified at 12:39 and throughout; pid 1710248). Preview :4310 healthy, serving live variant. Neither restarted by QA. |
| **Verdict** | **NOT CERTIFIED — 1 blocker** (Track F). VERDICT line at bottom. |

## Check matrix

| # | Check | Result | Evidence (command → key output) |
|---|---|---|---|
| 1 | Backend tests (4 files, 23 expected) | **PASS** | `cd server && npm test` → exit 0; `ℹ tests 23 / ℹ suites 10 / ℹ pass 23 / ℹ fail 0` (53.5s). New suites green: `event spine & governance (docs/12)` ✔, `security invariants (RTR-001 regressions)` ✔. Log: `.qa-relcert2-tmp/tests-full.log`. |
| 2a | Migrations 004/005/006 applied (6 rows) | **PASS** | `app.schema_migrations` → 6 rows: 001 (15:10), 002 (15:12), 003 (15:45), **004_event_spine (16:49), 005_grants_refresh (16:59), 006_money_and_ledger_hardening (17:38)**. |
| 2b | 004 event envelope + lineage table | **PASS** | `app.events` has `emitted_by, subject, schema_version`; `app.event_action_link` exists (9 cols: event_id, action_id, downstream_event_id, outbox_id, relation, policy_ref, …). |
| 2c | 005 grants (B1 fix) | **PASS** | `role_table_grants` → `schoolos_app` full CRUD on `plugins`, `events`, `event_action_link`, `fee_obligations`, `payments`; `audit_log` SELECT-only. |
| 2d | 006 money + ledger hardening | **PASS** | CHECKs: `obligations_paid_lte_amount` (`paid_cents>=0 AND <=amount_cents`), `payments_amount_cents_check` (>0), `payments_gateway_ref_req` (confirmed ⇒ gateway_ref NOT NULL); unique partial index `payments_one_open_per_obligation` (tenant,obligation) WHERE status='initiated'; `audit_append` routine = SECURITY **DEFINER**; `audit_log` relacl = `{schoolos=arwdDxtm/schoolos,schoolos_app=r/schoolos}`. |
| 3 | Frontend typecheck + builds | **PASS** | `npx tsc -b` → exit 0. Both `vite build` variants → exit 0, 69 assets each (hashes above). Built to temp dirs so the live build on :4310/dist stayed intact. |
| 4 | Servers health (no restart) | **PASS** | See header. `/health` → `{"status":"ok","db":true,…}`. |
| 5 | B1 regression: GET /plugins | **PASS** (with W1 spec note) | Principal → **HTTP 200**, registry array (`com.rtprobe.test`, class D, enabled, permissions `read:students`). Parent → **HTTP 200** with same registry view (brief said 403; see W1 — mutations ARE gated: parent disable → `403 {"error":"role parent not permitted"}`). |
| 6 | Event spine live | **PASS** | `POST /transport/events {"routeCode":"Route 7","kind":"gps_delay","delayMins":13}` → 200 `{event, riders:75, action}`; DB newest event: `emitted_by=plugin:transport · subject=route:Route 7 · schema_version=1`. `GET /events/lineage` → **200**, 25 rows, row keys incl. `emitted_by/subject/correlation_id/causation_id/links`; 3 rows carry links, sample: `[{action_id: 5abb1f32…, relation: "raised", policy_ref: "Transport §3.1"}]`. |
| 7 | Governance (budgets/breakers/drain) | **PASS** | `breaker_state={"open":false}` live; governance enforced in dispatcher (routes.js:225 → 429 `gov.code` on budget exhaustion; suite `event spine & governance` ✔). Drain round-trip: disable as principal → **403**; as owner → `{status:"disabled", drained:{actions_reassigned:0, events_retained:0}}` + audit outcome `DRAIN: 0 open action(s) handed back · N linked events retained`. Plugin **restored to enabled** post-probe (see State hygiene). Live per-plugin budgets unset `{}` — only the probe plugin is registered (W5). |
| 8a | RT-002 decide role-gate | **PASS** | Parent `POST /actions/5abb1f32…/decide {approved}` (owner_role=principal) → **403** `{"error":"only the owning authority (principal) may decide this action"}`. |
| 8b | RT-003 confirm role-gate | **PASS** | Parent confirm → **403** `{"error":"role parent not permitted"}`; finance confirm → 200 `confirmed`, receipt issued. |
| 8c | RT-004 double-initiate | **PASS** | Initiate #1 → `initiated` (receipt null); initiate #2 → **409** `{"error":"a payment for this obligation is already in progress"}`. DB CHECK + unique index per 2d. |
| 8d | Track E audit append-only | **PASS** | As role `schoolos_app`: `INSERT INTO app.audit_log …` → `ERROR: permission denied for table audit_log` (BEGIN/ROLLBACK, nothing persisted). Ledger intact: 90 rows, hash-chained, writes flow via `audit_append` (DEFINER). |
| 8e | RT-005 students scoping | **PASS** | Parent `/students` → **exactly 1** child; key set has **no `guardian_phone`**; foreign child `/students/:id` → **404**. Principal → 376 (with `guardian_phone`; count delta vs 375 noted in W3). |
| 8f | RT-009 WO minimization + role gate | **PASS** | Parent `/work-orders` → **403** `{"error":"role parent not permitted"}`. Teacher → 200, 4 rows, columns `id|code|title|description|category|priority|status|sla_due_at|cost_cents|sla_breached|created_at|asset_code|asset_name` — **no `reported_by`, no `assigned_to`** (route SELECT list confirmed, routes.js:264-265). |
| 8g | **Track F XFF vs login limiter** | **FAIL — BLOCKER B1** | Live probes: 21 rapid `/auth/login` without XFF → `401×20` then **429** (limiter enforces, api.log `"statusCode":429` ×1). But **32 attempts with rotating spoofed `X-Forwarded-For` (10.10.10.x / 10.10.11.x) → zero 429s, all 401**. Root cause isolated: `server/src/app.js:13` → `Fastify({ …, trustProxy: true })` **unconditionally** ⇒ `req.ip` is XFF-derived whenever the header exists, so the line-23 `keyGenerator` env-gate (`TRUST_PROXY==='true' ? XFF : req.ip`) falls back to the attacker-controlled address either way. The env gate is dead code in effect; RTR-001 Track F remediation **not effective in the running deployment**. |
| 9 | RTR-001 evidence-row reconciliation | **PASS** (with W2) | Obligation `c6ab7002`: amount 1,850,000 = paid 1,850,000, status `paid`, **100.0%** (was 200%) — clamped by 006. Receipts retained as documented evidence: **RCP-MTOAQNA6 / RCP-MTOAQNBN / RCP-MTOAS5L9 / RCP-MTOAS5P1** all present (`gateway_ref`: RT-FORGE-REF-001/002, RT-RACE-CONFIRM, PARENT-SAYS-PAID). Ledger sanity: **0** obligations with paid>amount tenant-wide; 6 payments total. WO-1046 (`cost_cents=-99999`) unchanged — but no flag found anywhere: **W2**. |
| 10 | UI sweep (live build, headless dump-dom) | **PASS** | 7/7 routes >15 KB: `/demo` 31,518 B · `/today` 74,360 B · `/attention` 63,502 B · `/plugins` 31,641 B ("Plugin Manager" ×2) · `/library` 20,698 B ("Library is not enabled for your school") · `/live` 26,503 B (renders; live-variant content) · `/migration` 31,492 B ("Migration"). Dumps: `.qa-relcert2-tmp/dom_*.html`. |

## Blockers

**B1 — Login rate limiting bypassable via X-Forwarded-For rotation (RTR-001 Track F fix ineffective live).**
- Layer: **backend bootstrap** (`server/src/app.js`), not the limiter itself and not the env-gate intent.
- Evidence: 21 no-XFF attempts → 429 at #21 (`api.log` `"statusCode":429`); 32 rotating-XFF attempts → 0×429, all 401 (raw transcripts in the ops log).
- Root cause: `app.js:13` hardcodes `trustProxy: true` on the Fastify instance; Fastify then derives `req.ip` from XFF, so the `keyGenerator` at `app.js:23` uses the spoofable address regardless of `TRUST_PROXY`.
- Suggested fix (CTO's call, **not applied by QA**): `trustProxy: process.env.TRUST_PROXY === 'true'` at `app.js:13` (aligning instance behavior with the keyGenerator's env gate), plus a regression test in `security.test.js` asserting that 21 logins with rotating XFF → 429. Re-cert scope after fix: step 8g probe + security suite.

## WARN items

- **W1 — `/plugins` parent response: 200, not 403.** Assignment said "403 for parent"; live returns 200 with the registry view. Governance *mutations* are correctly gated (enable/disable → 403 for parent/principal-non-owner). If read-view-for-all is intended, amend the spec line; if not, scope `GET /plugins` to staff roles.
- **W2 — WO-1046 "flagged for finance review" not evidenced.** `cost_cents=-99999` persists in the live row and is served to staff via `/work-orders`; no audit row, notification, or case references it (`ILIKE '%1046%'` → 0 rows in audit). The remediation ledger's claim is unverifiable — either create the flag or correct the ledger.
- **W3 — Students count drifted 375 → 376** between batteries (QA made no student writes). Likely CTO-session test data; pin the demo dataset before customer demos.
- **W4 — Not a git repository** (repeat of REL-CERT-001): no commit provenance; certificates pinned by build-content hashes.
- **W5 — Per-plugin budgets/breakers exist but are default-empty live** (`event_budget={}`, only `com.rtprobe.test` registered). Coverage is via `governance.test.js`; consider seeding one budgeted plugin in demo data so the 429 governance path is demoable.
- **W6 — QA probe side-effects (disclosed, no code touched):** payment probe completed legitimately (finance-confirmed receipt `RCP-MTODOU4O`, obligation 100.0%); plugin disable/re-enable round-trip left audit rows; login-limiter probes consumed the 60s window once. All state restored — see below.

## State hygiene (QA probe cleanup)

- `com.rtprobe.test` restored to exact pre-battery state via the legitimate API: `enabled / class D / 1.0.0 / permissions [read:students]` (verified in DB after restore).
- Preview server, API process, and `dist/` (live build `index-CFgOXw9D.js`) untouched throughout.
- Probe artifacts only in `.qa-relcert2-tmp/` and `docs/ops/`.

---

**VERDICT: NOT CERTIFIED.** 1 blocker: **B1 — XFF rotation defeats the login rate limiter** (`trustProxy: true` hardcoded at `app.js:13`; env gate at line 23 is dead code; 32 rotated-XFF attempts, zero 429s vs 429 at attempt #21 without XFF). Everything else green: 23/23 tests · 6/6 migrations · B1(plugins-grants) fixed and regression-verified · event envelope + lineage live · drain protocol live · RT-002/003/004/005/009 + Track E verified live with negative probes · money/ledger reconciliation clean (obligation clamped to 100%, PoC receipts retained) · tsc + both builds pass · UI sweep 7/7. Fix B1 (one-line + test), resolve W1/W2 dispositions, then re-run step 8g + the security suite for full certification.

*Signed: QA-1 — verify-only; no production code modified. Writes: `docs/ops/RELEASE-CERT-002.md` + `.qa-relcert2-tmp/` only.*

---

## RE-CERT ADDENDUM — B1 FIXED · VERDICT: CERTIFIED (2026-09-05, CTO-recorded)

QA-1's scoped re-cert (step 8g probe + security suite) was executed by the orchestrator
after QA-1's turn terminated before the append. Evidence:

- **B1 root-cause fix applied**: `Fastify({ trustProxy: process.env.TRUST_PROXY === 'true' })` at `server/src/app.js:13` — exactly the one-liner QA isolated; the limiter `keyGenerator` env-gate is no longer dead code.
- **Step 8g probe re-run live** (post-restart, 13:15 UTC): 25 logins with rotating spoofed `X-Forwarded-For` (10.7.7.0…24) → **5×429** (limit 20/min). No bypass.
- **Regression test added**: `tests/security.test.js` — "Track F: rotating spoofed X-Forwarded-For cannot defeat the login limiter" ✔.
- **Full suite**: 25/25 pass (`api · plugins · governance · security`), 7/7 migrations live (007: capability contracts), tsc 0 errors, mock + live builds pass, API :8080 healthy, UI :4310 serving live build.
- **W2 resolved**: WO-1046 cost −99,999 → 0 via `server/scripts/reconcile_wo1046.mjs` with a chain-valid `audit_append` ledger entry (hash `0e7e0e308a4a…`).

WARN dispositions (recorded): W1 — `GET /plugins` 200-for-parent is by design (read-only registry metadata; all mutations owner/itadmin-gated; the frontend kernel re-sync depends on it). W3 — student drift accepted as demo-data PoC residue. W4 — git deferred per product owner. W5 — accepted: the plugins table registers governance-relevant plugins only; the kernel-path covers unregistered first-party plugins by design (docs/12 §10).

Additions since the main battery: migration 007 (7 capability contracts in `app.capability_contracts`, surfaced via `GET /plugins` under `contracts`, invariant-tested); attention slot ration enforced in code (`MAX_WIDGETS_PER_SLOT = 2`, `app/src/plugins/Slot.tsx`); live-API kernel re-sync implemented (`useKernel.tsx`).

**VERDICT: CERTIFIED.**
