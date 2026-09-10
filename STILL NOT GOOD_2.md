# STILL NOT GOOD_2

## The Delta Verdict — 48-Hour Sprint Results

Audit Date: 2026-09-11 (UTC)
Baseline: `STILL NOT GOOD_1.md` @ commit `da7c585` — Overall 58/100, Enterprise Readiness 31/100
Sprint: 5 parallel GLM sessions (L1–L5) + S0 master coordinator, T+0 2026-09-10 13:10 UTC
This verdict: verified through Gate-2 (21:10–21:45 UTC, T+8h20) — **completed at T+~9h, not T+48h**
Head commits: `53fd349` (L1) `0a46843` (L2) `b72874f` (L3) `f2ad74c` (L4) `1dd9f4c` (L5) `3e2651a` (S0 fixes)

---

## 1. Verification summary (what S0 proved, not what was claimed)

| Check | Result | Evidence |
|---|---|---|
| Server test suite (full) | **EXIT:0 — ~273 tests, 0 failures**, ~18.6 min | `.coop/gate2-tests.log`; was 232 baseline + new negative-test file |
| App build (tsc -b + vite) | **EXIT:0** across 51 changed files | `.coop/gate2-build.log` |
| P0-1 (OTP vault cross-wire) | Dead: visitor pickup OTPs on own FORCE-RLS table, login vault app-role-zero-access, purpose+tenant bound | 054:28-71; ops.visitors diff; negative tests |
| P0-2 (dev doors armed) | Dead: dual-condition gating (NODE_ENV==='development' AND explicit opt-in), loud warnings, echo auto-off when SMS provider exists | config.js diff (reviewed line-by-line) |
| P0-3 (cross-tenant auth) | Dead: per-tenant OTP/SSO resolution, 409 + hint on ambiguity, no silent `rows[0]` | app.js diff; tests |
| Demo-identity leak | Dead: `/dataset` non-demo branch is a strict allowlist; flattened payload has zero seed-derived keys | L1 T104 + test |
| Object predicates | Student 403/404 on roster, parent child-scoped obligations, attendance principal+ binding (no class-of-record exists — honest copy), SoD default 403 with owner routing | routes.js diff (reviewed); l1-security-sprint.test.js |
| DB hardening | razorpay RLS ENABLE+FORCE, 005 grant-trap killed, `lower(email)` unique, audit_append tenant-pin, ops_counters locked | 054_security_sprint.sql (161 lines, reviewed) |
| Store boot-capture bug | Fixed: slices hydrate post-`ensureDataset()` via `domain/hydrate`; all 41 dataset bindings defensive | store.tsx diff; build green |
| Core loop on real doors | Attendance, Fees, Action Center, Audit, bell, People-add, PersonDetail, Attention — server-backed, toasts only on 2xx | L4 journal T401–T409 + diffs |
| Honesty sweep | ~15 screens: no toast claims a write that didn't happen; ItAdmin ops disabled+truthful; Settings "99.2% Live" fiction dead; DPDP data-rights WIRED to real `/plugins/pack.dpdp/dsr` | L3 T305 + journal |
| CI / pipeline | Server job sound, `npm audit` enforced (prod deps), `check.js` genuinely gates DB+migrations+RLS, **parity gate scanning 100 write doors**, digest pinning, restart policies, `.dockerignore` | L2 journal T201–T207 |
| Backups | `backup.sh` (globals + custom-format per-db + `pg_restore --list` verification) + README restore docs | L2 T205 |
| Residue | `.qa-relcert*`/`.chrome-profile*`/34 logs deleted (PII exposure closed) | verified by S0 at T+7m |
| Bundle branding | `<title>SchoolOS — School Operations Platform</title>`, zero "Meridian" in dist | rebuilt + verified by S0 |
| Fabricated AI telemetry | Model/latency/token/cost row removed from shared `AiTraceCard` | S0 edit (D-23) |

**Trust levels:** S0 personally reviewed the diffs for config.js, 054, routes.js predicates, store.tsx, Homework D-8 handling, index.html, and ran the full suite/build/parity-gate. Per-screen copy details (L3/L5) are lane-verified and spot-trusted — a line-by-line re-audit of ~40 screens is the remaining diligence item (see §5).

---

## 2. Re-grading

### GRADE A — Current implementation quality: **74 / 100** (was 58)
| Dimension | Was | Now | Why |
|---|---|---|---|
| Kernel / security engineering | 82 | **85** | P0s dead with negative tests; audit_append pinned; RLS on money tables |
| Data model | 74 | **78** | 054 grant matrix, functional unique, vault split |
| Backend domain coverage | 55 | **68** | Predicates closed the authorization holes; admissions→enrollment still unexecuted (see §4) |
| Frontend product completeness | 42 | **63** | Core staff loop genuinely operates the DB; honesty sweep; live-lane contract fixes; nav model repaired |
| Test quality | 78 | **86** | ~273 tests incl. per-predicate negative suites; parity gate |
| Pipeline / CI | 32 | **76** | Server job fixed, audit enforced, real check.js, parity gate, digests |
| Ops readiness | 28 | **44** | Backup tooling + docs + compose hardening; still no PITR/alerting/staging (cut list) |
| Docs honesty | 60 | **62** | Untouched this sprint; still owes README/HANDOFF number corrections |
| UX / design system | 76 | **80** | Honest states, real CTAs, no more lying toasts |
| Accessibility | 70 | **71** | Minor honest-copy improvements only |

### GRADE B — Enterprise production readiness: **56 / 100** (was 31)
What moved it: zero reproducible P0s, green CI, backup tooling with restore docs, honest money/child-data surfaces, no crash routes for fresh tenants, verified tenancy hardening.
What holds it under 60: no MFA/httpOnly, no real SMS/WhatsApp/email rails (OTP login still cannot complete in production), backup tooling ≠ rehearsed PITR/DR, no alerting/observability, no staging/CD, no academic-year/fee engine, single-host story.

### Headline feature-score moves (0-10, from §22 of the baseline)
Attendance UI 2→**7.5** · Notifications 4→**7.5** · Fees surface 1→**6** · Audit screen 3→**7** · Action Center 3→**7** · AI surfaces 2→**4** (honest canned, telemetry removed) · Pipeline 3→**7.5** · Backups 0→**4** (tooling, not DR) · Parent portal 6→**7** · Student portal 5.5→**6.5** · Teacher lane 7→**7.5**.

---

## 3. What the sprint proved (method note)
Five fresh-context sessions, one shared `.coop/` protocol (file ownership + claim/status journals + master rulings), zero direct-to-main commits by workers, gates every 4h — produced a fully verified Phase-0+Phase-1 + core-Phase-2 delivery in **8.5 hours** with exactly one mid-flight conflict (resolved by ruling) and zero cross-lane file violations. The two-universes problem — the audit's biggest architectural finding — is now structurally policed by L2's parity gate, which fails CI when a write door has no UI caller or a screen imports the mock layer.

---

## 4. What did NOT change (the honest remainder)
- **Admissions→student executor still missing** — approval raises `students.create.<id>`; nobody executes it (deferred: server file outside sprint scope).
- **Fee-plan/obligation creation** — still no door anywhere; the money core cannot be set up in-app.
- **Academic year/term** — still absent; bulk invoicing still impossible.
- **Real delivery rails** — logger/adapter only; OTP login still can't complete in production; comms 'delivered' stamping still fabricated in the approval path (routes.js:461-469 untouched this sprint).
- **MFA, httpOnly cookies, password-reset email** — unchanged (force_change still stamped-but-unenforced).
- **Maintenance module** — still the in-memory plane except ReportIssue (works now) and honest copy; work-order doors still UI-orphaned.
- **DPDP erasure** — platform-incomplete per D-17 of the baseline (L1 delivered a completion plan, no code — correctly, per cut list).
- **PITR/DR drills, alerting/observability, staging/CD, i18n, workflow runtime, real AI** — all untouched. *(The voice receptionist was REMOVED FROM SCOPE by owner decision, 2026-09-11 — it was never built, so nothing to remove from code; it no longer counts against any roadmap or grade.)*
- **Secrets rotation** — *owner-side action, still pending confirmation from you.* The code now fails closed without the flags, but the committed-adjacent secrets in `server/.env` still need rotating in your deploy environment.
- README/HANDOFF staleness (62/63 screens, "25/25 tests", "zero mock modules") — now factually worse vs 273 tests; docs pass owed.

---

## 5. Remaining diligence + path to 90
1. **Re-audit the delta** — line-by-line re-verification of ~40 touched screens (the baseline's §12 red-team register should be re-run against the new predicates; the negative tests cover the server side, the UI copy sweep was spot-trusted).
2. **Owner actions:** rotate secrets; wire `backup.sh` into real cron + one rehearsed restore.
3. **To ~80:** admissions executor, fee-plan creation doors + finance UI, force_change enforcement, README correction pass (≈ 1-2 sprint-days at the demonstrated pace).
4. **To 90 (readiness ~75+):** real rails with receipts, MFA + httpOnly, PITR + restore drill, alerting/observability, staging + CD, academic-year engine, maintenance swap onto real doors (≈ 2-3 more sprint-weeks at this pace, or the original §23 Phase 3-4 plan).

---

## 6. Verdict
**From "the product is a movie" to "the product's core loop is real and the rest admits what it is."** The three findings that made the system unsafe (vault cross-wire, armed dev doors, cross-tenant auth) are dead in code with tests proving it. The flagship loop — attendance → absence notices → fees → approvals → audit — now writes the database it demos. The UI stops lying at ~15 audited surfaces, the bundle stops impersonating a demo school, CI stops lying about safety, and a backup script exists where nothing did before. What remains is exactly what the cut list said remains: the revenue engine, the delivery rails, identity hardening, and operational maturity.

Baseline grades stood because the kernel was real and the product was not. The kernel is now harder, and the product has begun to exist. **74 / 100 current · 56 / 100 readiness.** STILL NOT GOOD — but for the first time, measurably, honestly, on its way.
