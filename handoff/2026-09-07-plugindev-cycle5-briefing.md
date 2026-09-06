FROM: plugin-agent
TO: orchestrator + cycle-5 red team
SUBJECT: cycle-5 trigger report — no unit in flight; everything through visitors shipped; red-team focus list
DATE: 2026-09-07

---

## 1. Unit completion matrix (this dispatch's frames, reconciled)

| Frame | Reality |
|---|---|
| "dpdp in flight — treat next unit as dpdp-completion" | **dpdp is COMPLETE** (023_dpdp_pack.sql + manifest/index module + 9 tests + live erasure drill, committed 3df7c2a, 58/58 at the time) |
| "ops.visitors rides the unit after" | **visitors is COMPLETE** (024_ops_visitors.sql + module + 9 tests + live guardian-pickup drill, 67/67 total) |
| "finish whatever you're mid-flight on" | **Nothing is mid-flight.** All assigned units through visitors are shipped, tested, live-verified. |
| pre-suite DROP WITH (FORCE) | Confirmed at helpers.js:16 — harness hygiene adopted; the two transient hangs this cycle were pre-fix stale-DB runs |

Uncommitted in my lane (your git lane, commit when convenient): `server/migrations/024_ops_visitors.sql`,
`server/src/plugins/ops.visitors/`, `server/tests/visitors.test.js`, `server/scripts/seed.js`
(replay += 024) + the three newest handoff files. Everything else is in (db22e59, 3df7c2a,
0dcd2c5, fe16990, a7ca2c7…).

Ledger tail: 022 admissions v1.1 · 023 dpdp · **024 visitors** · **next free 025**.

## 2. CYCLE-5 RED-TEAM FOCUS LIST (per-rail, freshest first)

1. **ops.visitors (024 — NEWEST)**: pickup OTP vault `plugin_visitors.pickup_otp` — RLS
   `USING (false)` (app-role SELECT/INSERT must throw; verify with `SET ROLE`),
   scrypt+salt single-use codes, attempt-bounded (`config.otp.maxAttempts`), TTL
   (settings `pickup_otp_ttl_minutes`). Attack: OTP replay after consumption, expired-
   code verify, cross-tenant visitId, complete pre-verification as coordinator (must
   409 "BLOCKED"), override abuse (note-less, non-senior roles), badge uniqueness
   (V-XXXXXXXX), visitor-PII on the list door, vault write attempt via any app-role
   door (must fail — the module writes secrets ONLY through the kernel owner path `q`).
2. **pack.dpdp (023)**: SAR export/erasure — execute-before-approval 409, dismissed-
   action refusal, proposer-execution SoD 403 (live-proven), cross-tenant sarId, bundle
   delivery to non-DPO tiers, erasure completeness (consent subject_ref + admissions
   guardian PII redacted; decision trail preserved; core students untouched — the
   "never plugin-direct on core" invariant), consent_immutable (withdrawal appends,
   never updates; erasure redacts identity columns only).
3. **admissions v1.1 (022)**: students.create kernel action (approve-as-finance,
   self-approve, replay → double enrollment), dedupe guard (raced/unicode phones,
   year-scoped), session-window bypass via body `admissionYear`, terminal immutability.
4. **payments.upi**: ±window freshness (future +1h → 400 pinned), raw-bytes HMAC
   discriminator, 1/1/1 dedupe, links-door recoverable 409, boot-refusal posture.
5. **Uniform lifecycle gate** (24 doors, 7 modules): disabled-rail → 409 everywhere;
   per-request settings reads (no caching).
6. **IST-date logic**: midnight-IST boundary on timetable default day (pinned by wave1).

## 3. Trigger

Cycle 5 fires on this report per your standing rule. Queue after cycle 5: **wave-3
builds — exams.assessment runtime first (025)** → pack.cbse.
