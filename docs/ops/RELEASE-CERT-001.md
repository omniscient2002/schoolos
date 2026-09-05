# RELEASE CERTIFICATE — REL-CERT-001

| | |
|---|---|
| **Issued** | 2026-09-05 11:19 UTC (battery run 10:51–11:20 UTC) |
| **Issuer** | QA-1, standing QA & release engineer (evidence-only; no production code modified) |
| **Build variants** | Frontend mock build `dist/assets/index-Cgja8Erd.js` (69 assets / 71 files); live build `VITE_LIVE_API=1` → `dist/assets/index-CFgOXw9D.js` (69 assets / 71 files). Backend: server from `server/` (pid in api.log logs, no rebuild applicable). |
| **Commit-ish state** | `/home/cassandra/schoolOS` is **not a git repository** (`git rev-parse` → `fatal: not a git repository`). Build outputs fingerprinted by content hash filename instead. ⚠ Unversioned tree — provenance is weak. |
| **Servers under test** | API http://127.0.0.1:8080 (pre-existing, not restarted), preview http://127.0.0.1:4310 (pre-existing, not restarted) |
| **Verdict** | **NOT CERTIFIED — 1 blocker** (see VERDICT line at bottom) |

## Check matrix

| # | Check | Result | Evidence (command → key output) |
|---|---|---|---|
| 1 | Backend tests | **PASS** | `cd server && npm test` (run twice; `/tmp` proved ephemeral, rerun logged to `.qa-relcert-tmp/tests-full.log`) → exit 0; `ℹ tests 15 / ℹ suites 8 / ℹ pass 15 / ℹ fail 0` (33.2s). Suites: auth, role scoping, RLS tenant isolation, fee invariant, work order state machine, transport policy, audit ledger, plugin registry. No 429s observed either run. |
| 2 | Schema (migrations 001–003 live) | **PASS** (with W2 drift note) | `SELECT * FROM app.schema_migrations` → 3 rows: `001_init.sql`, `002_plugins.sql`, `003_enterprise_hardening.sql` (applied 15:10/15:12/15:45 +05:30). `capability_contracts` present (26 tables in `app`). `app.plugins` has all 5 required columns: `event_budget, ai_budget, breaker_state` (jsonb), `trust_level` (text), `cert_score` (jsonb) — 19 columns total. `plugins_status_check` → 14 allowed values incl. `'draft'` and `'retired'`; `plugins_trust_level_check` → T0–T4; `plugins_class_check` → A–E. |
| 3 | Frontend typecheck | **PASS** | `cd app && npx tsc -b` → exit 0, zero diagnostics. |
| 4 | Frontend builds | **PASS** | `npx vite build` (mock) → exit 0, `index-Cgja8Erd.js 329.72 kB / gzip 102.38 kB`, built 956 ms, 69 asset files. `VITE_LIVE_API=1 npx vite build` → exit 0, `index-CFgOXw9D.js 329.82 kB / gzip 102.41 kB`, built 724 ms, 69 asset files. (Measurement note: live build ran second and overwrote `dist/`; mock was rebuilt afterward to take its count — both are 69.) |
| 5 | Servers healthy (no restart) | **PASS** | `GET /health` → `{"status":"ok","db":true,...}` at 10:51:21Z and 11:19:33Z. Preview `GET /demo` → HTTP 200 at 10:51 and 11:19. Both were already listening (`ss -ltn` → :8080, :4310) — not double-started per state hygiene. Preview serves the mock shell: `assets/index-Cgja8Erd.js` matches the mock build output. |
| 6a | Smoke: login | **PASS** | `POST /auth/login` → HTTP 200, bearer token (315 chars). |
| 6b | Smoke: GET /students | **PASS/W1** | `GET /students` → HTTP 200, `{students:[...]}` with **100** items (default page). `GET /students?limit=500` → **375** items = DB ground truth (`SELECT count(*) … GROUP BY tenant` → 375 in tenant `97e8302d…`). Item shape intact (`admission_no, name, grade, section, guardian_name, guardian_phone, bus_route, status, source`). Expectation "375" holds only with an explicit `limit` → W1. |
| 6c | Smoke: GET /audit?limit=5 | **PASS** | HTTP 200 `{entries:[5]}`; entries carry `actor` ("Dr. Meera Krishnan" / roles), `actor_role`, hash-chain fields `prev_hash` + `hash` on every row. `policy_ref` is `null` on auth rows but populated on policy rows (6 rows non-null in DB, e.g. `"Transport §3.1"`) → W3 note. |
| 6d | Smoke: GET /plugins | **FAIL — BLOCKER B1** | HTTP **500** `{"error":"internal error"}`. api.log: `DatabaseError: permission denied for table plugins`, PG code `42501`, `aclchk.c / aclcheck_error`, at `server/src/routes.js:449` via `withUser (server/src/db.js:50)`. Root cause below. |
| 6e | Smoke: POST /transport/events | **PASS** | `{"routeCode":"Route 7","kind":"gps_delay","delayMins":13}` → HTTP 200 `{event, riders, action}`; `riders: 75`; `action.kind: "approval"`, `action.policy_ref: "Transport §3.1"`, title `"Notify 75 guardians — Bus Route 7 +13 min"`, `priority: high`, `ai_involved: true`. Matches Transport §3.1 policy (>10 min ⇒ approval-gated guardian notice). |
| 7 | UI sweep (headless dump-dom) | **PASS** | All 7 routes render >15 KB (blank-page floor ≈1 KB): `/demo` 31,167 B marker "Demo" (+7 nav instances); `/today` 74,010 B "Today"; `/attention` 63,151 B "Attention"; `/plugins` 31,290 B **"Plugin Manager"**; `/library` 20,347 B **"Library is not enabled for your school"** (KernelGate state; no `?plugins=` was set); `/live` 20,335 B renders its "Live API not enabled" gate — expected on the mock-variant preview build (string absent from all other routes); `/migration` 31,141 B "Migration". DOM dumps in `.qa-relcert-tmp/dom_*.html`. |

## Blockers

**B1 — `GET /plugins` returns HTTP 500 in the live API (permission denied for table plugins).**
Layer: **DB grants** (not code logic, not schema, not frontend).
Evidence chain:
- Live `schoolos`: `information_schema.role_table_grants` → `schoolos_app` has **zero** grants on `app.plugins`, while it holds full CRUD on `students` / partial on `audit_log`.
- Test `schoolos_test`: `schoolos_app` holds full SELECT/INSERT/UPDATE/DELETE on `app.plugins` — this skew is why battery step 1 passes 15/15 (incl. the 4 plugin tests) while live fails.
- Source of grants: `server/scripts/bootstrap.js:15-19` — `GRANT ... ON ALL TABLES IN SCHEMA app TO schoolos_app` + default-privileges clause. No migration file contains any GRANT statement (grep across `server/` → only bootstrap.js). `app.plugins` is created by migration 002 *after* bootstrap, so it never received a grant; default privileges only cover postgres-created tables (`pg_default_acl` grantor = postgres).
Impact: Plugin Manager surface is dead against live API (UI route renders, data call 500s). Ship-stopper for any plugin-gated feature.
Suggested fix (for CTO, **not applied by QA**): add an idempotent `GRANT SELECT, INSERT, UPDATE, DELETE ON app.plugins TO schoolos_app` to migration 002 or a new 005, and make bootstrap grants idempotent/re-runnable so post-bootstrap migrations can't strand tables. Verify RBAC tests still pass via `SET ROLE schoolos_app`.

## WARN items

- **W1 — `/students` default page returns 100**, not the expected 375; the documented count only appears with `?limit=500`. Data is complete and correct; either fix the expectation or document the pagination contract.
- **W2 — Migration drift:** `server/migrations/004_event_spine.sql` exists on disk (mtime 16:44 +05:30 — it appeared **during this battery**) but is **not applied** to live (`schema_migrations` has only 001–003). Unknown authorship/change mid-verification; it alters `app.events`, `app.outbox` and creates `app.event_action_link`. Do not ship until applied deliberately and re-verified.
- **W3 — `policy_ref` is `null` on auth audit rows** (e.g. "Signed in"). Likely intended; confirm it's not supposed to cite a policy (e.g. Auth §) for governance completeness.
- **W4 — Environment hygiene:** repo is not a git repository (no commit provenance for the certificate); `/tmp` is ephemeral between command calls (test log lost once, rerun for evidence); `schoolos_test` vs live grant skew masks RBAC regressions (aligned grants would have caught B1 in step 1).

## Watch items (non-blocking, monitor next cycle)

- API rate limiter is active (`x-ratelimit-limit: 300` per 60 s on `/students`); not load-tested in this battery. If CI hits 429s, wait 60 s and rerun.
- `/live` gate string verified on the **mock**-variant preview; re-verify after a `VITE_LIVE_API=1` deployment.
- No git metadata: future certificates should pin a commit hash; today only build-content hashes are available.

## Artifact index (throwaway, `.qa-relcert-tmp/`)

`tests-full.log` (full suite run 2) · `dom_{demo,today,attention,plugins,library,live,migration}.html` · `login.json`, `students.json`, `students2.json`, `students_hdr.txt`, `audit.json`, `plugins.json`, `transport.json`

---

**VERDICT: NOT CERTIFIED.** 1 blocker: B1 `GET /plugins` → 500 (`permission denied for table plugins`, missing `schoolos_app` grant on `app.plugins` in live DB; test DB masks it). 11 of 12 checks PASS; WARNs W1–W4 above. Fix B1 (grant migration + bootstrap idempotency), apply or explicitly defer 004, then re-run steps 1, 2 (expect 4 migrations), and 6d for full certification.

*Signed: QA-1 — evidence-only; no production code was modified in this battery. Writes: this file + `.qa-relcert-tmp/` only.*
