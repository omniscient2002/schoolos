# Fees Domain — Enterprise / Production-Level Test Plan

> Goal: prove the fees money path is **correct, consistent, isolated,
> resilient, and honest** before (and continuously after) production.
> Scope: all 40+ fees doors in `server/src/routes.js`, `server/src/fees/*`,
> the workers (`day-worker`, `dunning-reminders`, `reconcile-payments`,
> `comms-dispatcher`), and the Fees/desk UI. Out of scope: non-fee plugin
> internals (covered by their own plans), except where fees integrates
> (Razorpay/UPI rails, Tally export, comms rails).
>
> Baseline already green: 52 unit/door tests + 93 role-drill checks + 37
> edge checks (see `docs/FEE-DOMAIN-ROLE-DRILL.md`). This plan builds from
> there to production-grade. Normative terms: P0 = ship-blocker,
> P1 = release-blocker, P2 = hardening.

---

## 1. Test levels & where they run

| Level | What | Harness | When |
|---|---|---|---|
| L1 Unit | pure math: `splitInstallments`, dunning selectors SQL, reconcile classifiers, receipt numbering, validators | `node --test` | every PR |
| L2 Door × role matrix | every door × every role → exact status + DB assertion | role-drill script (exists) | every PR (subset), nightly (full) |
| L3 State-machine | obligation/payment/installment/concession lifecycles, illegal transitions | new `fee-state.test.js` | nightly + PR |
| L4 Property-based | randomized amounts/parts/dates → invariants hold (fast-check style) | new `fee-property.test.js` | nightly |
| L5 Consistency pack | SQL invariant queries over a scaled fixture; doubles as **prod cron monitor** | `fee-consistency.sql` + job | nightly CI + daily prod |
| L6 Integration | gateway sandbox (Razorpay/UPI), webhooks (valid/forged/replay/stale), workers, dispatcher | sandbox creds + `fee-rail.test.js` | pre-release |
| L7 NFR | load, soak, scale ceilings, frontend perf | k6/artillery-style scripts + seeded scale tenant | pre-release, quarterly |
| L8 Resilience/DR | kill workers mid-run, gateway down, PITR restore + `money-dr-drill.sh` | staging + backup env | pre-release, quarterly |
| L9 UI/E2E | desk flows per role, mobile 390px, receipt PDF download | Playwright-style suite | pre-release |
| L10 Settings-honesty | **every** `fee_settings` key proven to change behavior (§7) | `fee-honesty.test.js` | P0 — 17 knobs currently decorative |

---

## 2. Door × role traceability matrix (normative)

Legend: ✅ must succeed · ❌ must refuse (code in brackets) · ➖ N/A.
`trial` plan assumed (all `fees.*` entitled); a second matrix run on a
`core`-plan tenant must 402 `fees.dunning`/`fees.reconciliation` and
`fees.installments`/`fees.multi_obligation` doors.

| Door | owner | finance_head | finance | clerk | principal | coord | parent | teacher | student |
|---|---|---|---|---|---|---|---|---|---|
| `GET /fees/settings` | ✅ | ✅ | ✅ | ❌403 | ✅ | ❌ | ❌ | ❌ | ❌403 |
| `PUT /fees/settings` | ✅ | ✅ | ❌403 | ❌ | ❌403 | ❌ | ❌ | ❌ | ❌ |
| `POST /fees/late-fees/run` (+dryRun) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `GET /fees/heads` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `POST /fees/heads` (+dup 409) | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `GET/POST /fees/discount-rules` | ✅ | ✅/✅ | R/❌ | R/❌ | R/❌ | R/❌ | ❌ | ❌ | ❌ |
| `GET/POST /fees/late-rules` | ✅ | ✅/✅ | R/❌ | R/❌ | R/❌ | ❌ | ❌ | ❌ | ❌ |
| `POST /fee-plans` (+dup 409, +hike 400) | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌403 | ❌ |
| `POST /fee-plans/:id/preview` (zero writes) | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `POST /fee-plans/:id/generate` (idempotent) | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `POST /fee-plans/:id/clone` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `POST /fees/obligations/:id/void` (paid→409) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `POST …/extend` (+cap/reason) | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `POST …/late-fee/waive` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `PATCH /fees/installments/:id` (+toggle) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `POST /fees/installments/:id/waive` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `POST /fees/payments` (scope/method/partial rules) | ✅ | ✅ | ✅ | ✅ | ✅ | ❌403 | own✅/other404 | ❌ | ❌ |
| `POST /fees/payments/:id/confirm` (clerk/principal 403; double→already) | ✅ | ✅ | ✅ | ❌403 | ❌403 | ❌ | ❌ | ❌ | ❌ |
| `POST /billing-runs/:id/void` (money→409) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `POST /fees/concessions` (parent own-child; mismatch 400) | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ |
| `POST /fees/concessions/:id/decide` (self→403 exc. owner) | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `POST /payments/:id/refund` (SoD/window/head/partial) | ✅ | ✅ | ✅ | partial-only | ❌ | ❌ | ❌403 | ❌ | ❌ |
| `POST /payments/reconcile` / `mark-matched` | ✅ | ✅ | ✅/✅ | recon-only/❌ | runs-view/❌ | ❌ | ❌ | ❌ | ❌ |
| `POST /fees/dunning/run` (quiet→0+writes0) | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `POST /fees/pins` + cash-PIN flow | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Reads: obligations/payments/receipts/installments/delivery/concessions (+parent/teacher/student scoping) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅(ledger) | own | own-req | self |

Each cell = one automated case asserting **status + code + DB delta**.
New vs drill: add the 402-plan-tier run, `coordinator`/`itadmin` reads on
every read door, and `finance_clerk` on plan generate (allowed).

---

## 3. Functional suites (by subdomain)

**S1 Billing & generation.** Zero-student plan (200, inserted 0); inactive
students excluded; 24-term max / 25th refused; `amount_cents:0` term allowed
(obligation 0, no installments — assert no crash); duplicate term-label
pairs across plans; generation under concurrent double-submit (exactly one
billing run wins inserts, second reports skipped); `academicYearId` of
another tenant → 400; void-then-regenerate semantics.
**S2 Installments.** Equal/custom/percent splits incl. remainder-last
paise proof (`Σ parts ≡ total` for 1..99 paise totals × 2..6 parts);
percent-sum >100 → 400; 24-part cap; edit rebalances nothing (caller-owned
— assert siblings untouched); waive then confirm settles around waived
part; paid-part edit → 409.
**S3 Concessions.** Percent vs flat; stacking two approvals on one
obligation (document order-dependence); approve on void obligation;
reject-then-re-request lifecycle; validity windows (`valid_from/to`
currently informational — assert or wire, see §7); null-obligation
request→approve no-op.
**S4 Payments.** All 8 methods × enabled/disabled matrix; cash with
unenrolled staff (no PIN → proceeds), enrolled + missing/wrong PIN → 403;
`Idempotency-Key` malformed → 400; pay-many 20-OK/21-refused, allocation
sums ≡ amount; dedicated: single payment with `obligationIds:[one]` keeps
legacy `obligation_id` populated.
**S5 Refunds.** Full/partial matrix × threshold below/at/above × roles
(clerk/head/settler/owner) × reason present/absent; gateway-refused →
ledger byte-identical; manual-mode note present; `refunded_cents` never
exceeds amount across 3 sequential partials; post-refund re-pay succeeds
(regression F-03).
**S6 Late fees.** All 3 modes × grace boundaries (grace/grace+1) × cap
below/at/above × per-head opt-out × `dryRun` purity (assert `pg_stat`
or row-version unchanged — use `xmax` sampling); re-run idempotence;
waive → 0 + audit.
**S7 Dunning.** Ladder [7,3,1]/[30,60] fires each offset exactly once
(per-offset dedup); 7-day overdue dedup; escalation raises exactly one
`exception` Action even across 3 runs (code-unique); phoneless skipped;
partial-paid still reminded (documents `dunning_stop_on_partial`
decorative until wired); quiet-hours parametrized (set window around
`now()` → 0 writes; window outside → queues).
**S8 Reconciliation.** Fixture each class (ghost/missing/orphan/mismatch
±1p around tolerance); tolerance boundary (`diff == tolerance` → clean,
`tolerance+1` → flagged); `mark-matched` closes Action + sets matched;
second sweep adds no duplicate Actions.
**S9 Receipts/invoices.** Series uniqueness under 50 concurrent confirms
(advisory-lock proof, zero dups, monotonic); `yearly` reset emits
`PREFIX-YYYY-NNNN`; invoice first-render vs cached bytes identical
(sha256); receipt PDF download⚖round-trip (fetch → parse amount lines);
voided receipt excluded from parent list but row retained.
**S10 Settings/policy.** §7 honesty matrix (each key flips behavior);
unknown key / bad enum / negative / over-limit → 400 with field message;
concurrent PUTs last-writer-wins without lost defaults (read-merge-write
race test).

---

## 4. Logical-accuracy & consistency suite (P0)

**L1 Ledger balance pack** (CI + daily prod cron; any row = page):
1. `paid_cents > net_amount_cents` → must be 0 rows.
2. `amount - concession - waived < 0` → 0 rows.
3. `refunded_cents > amount_cents` → 0 rows.
4. Per confirmed payment: `Σ allocations = amount_cents` (or legacy
   `obligation_id` amount when no allocations).
5. Per non-voided receipt: exactly one `fee_receipts` row per confirmed
   payment; `receipt.amount = payment.amount`; voided ⟺ fully refunded.
6. `paid_cents(ob)` ≡ Σ confirmed-allocation amounts − Σ refunded
   reversals (recompute from `payment_events kind=refunded`).
7. `net_amount_cents` ≡ generated expression (recompute in SQL).
8. Installment exclusivity: exactly one `open=true` allocation per
   (tenant, obligation) — partial-index agreement query.
9. Dedup integrity: no duplicate `dedup_key` in comms/dunning/payment
   idempotency keys.
10. Audit coverage: every payment state change has a `payment_events`
    row and an audit row within the same minute.
**L2 Known-divergence decisions (assert-or-fix, P1):**
- (a) Installments split **gross** `amount_cents`, but concessions later
  change `net` — after a 10% approval, Σ parts ≠ net. Decide: rebase
  parts on approval, or document parts-as-schedule (assert current =
  schedule semantics + UI labels it so).
- (b) `auto_concession` writes `concession_cents` directly at generation
  (vs propose→approve in `open item.md`). Decide and pin whichever.
- (c) Concession stacking/`concession_cap_pct` accepted but unenforced —
  wire or remove (see §7).
**L3 Money-math property tests:** random totals (1..10⁹ paise) × parts
(1..24, mixed explicit/percent/omitted) → Σ≡total, all >0 or clean
`{error}`; random percent concessions → `0 ≤ net`, `net ≥ paid`;
late-fee formula vs SQL for 10k random (days, grace, cap, mode) pairs.

---

## 5. Concurrency, idempotency, failure suite (P0)

- Double/triple concurrent initiate, confirm, refund, generate, dunning,
  late-run, reconcile (assert single-winner + clean refusal codes, never
  500/23505/23514 surfaced).
- Crash-between-legs: gateway success then ledger-write killed (staging
  fault injection) → refund path must reconcile on retry without double
  money movement; initiate→confirm with worker restart mid-flight.
- Webhook storms: duplicate delivery ×50 (dedup by event id), out-of-order
  capture-before-order, forged HMAC, stale timestamp, cross-tenant secret
  (tenant-A payload signed with B's secret → refused).
- Rail down: Razorpay 500/timeout on refund → ledger untouched +
  `GATEWAY_REFUSED`; order-log absent → recorded-manual with note.
- DB failover during confirm advisory lock (staging): no double receipt.

---

## 6. Security suite (P0–P1)

- Auth: expired/forged/missing token on every money door (401, no branch
  that skips `require`); `roleGatedMe` vs `require` confusion test —
  call each door with a role in `me` but outside the gate (e.g. teacher
  on ledger reads → 403 with safe message, no row counts leaked).
- RLS fuzz: set `schoolos.tenant_id` to B, attempt direct-row reads on
  every fee table (0 rows); cross-tenant FK insert → refused (existing
  pattern in fee-plans test — extend to receipts/allocations/events/
  discount/late rules/pins).
- SoD matrix: clerk-confirm, clerk-material-refund, settler-refund,
  requester-approve (all non-owner) → 403 `SOD_REQUIRED`; owner bypass
  allowed + audited.
- Injection: label/name/reason payloads with SQL/HTML/oversize (80/300/
  500 caps), `receipt_prefix` special chars (sanitizer proof), `due_on`
  non-dates, NaN/Infinity numerics, `percent: 1e3`.
- PII: parent/teacher/student responses contain no other family's names,
  phones, amounts (snapshot-diff test on fixtures); guardian-phone
  fallback never leaks across families.
- Rate/abuse: 100 rapid initiates same obligation (one wins, rest 409 —
  not 500); PIN brute-force lockout behavior documented.

---

## 7. Settings-honesty matrix (P0 — the headline gap)

For each key: set A/B, run the affected door, assert observable change.
✅ = enforced today · 🔴 = decorative (wire or remove).

| Key | Affected door | Status |
|---|---|---|
| refund_approval_threshold_cents, refund_partial_allowed, refund_require_reason, refund_window_days | refund | ✅ |
| allow_parent_partial, min_partial_cents, enabled_methods | initiate | ✅ |
| receipt_prefix/series_start/reset, invoice_notes | confirm/invoice | ✅ |
| late_fee_enabled/mode/rates/cap/grace (+auto-enable rule) | late-run | ✅ |
| installment_allow_edit, max_extension_days | edit/extend | ✅ |
| dunning_before/escalation_days, quiet start/end, channels | dunning | ✅ (channels recorded; delivery actually sends whatsapp — assert channel wiring) |
| hike_review_threshold_pct/evidence_max_age_days | plan create | ✅ |
| reconciliation_tolerance_cents | reconcile | ✅ |
| **dunning_enabled** | dunning door never reads it | 🔴 wire (master kill-switch) or remove |
| **late_fee_auto_run** | no scheduler reads it | 🔴 wire cron or remove |
| **concession_stacking / concession_cap_pct** | decide door never checks | 🔴 enforce or remove |
| **staff_default_pct / sibling_min_children** (settings-level) | unused (plan-level min_children used) | 🔴 wire or remove |
| **overpayment_rule** (keep_credit/refund) | initiation always refuses | 🔴 credit ledger (phase 2) or single-option |
| **refund_deduction_pct / refund_auto_gateway** | never applied | 🔴 implement or remove (F-08) |
| **reconciliation_auto_match / settlement_slo_hours** | never read; SLO unalerted | 🔴 wire (auto-match small diffs + alert) or remove |
| **installment_mode/max_parts/rounding** | plan validation hardcodes ≤24 | 🔴 enforce tenant max or remove |
| **cash_requires_pin** | PIN checked iff enrolled regardless | 🔴 make it a real master switch or remove |
| **invoice_show_breakup / default_due_time_ist / dunning_stop_on_partial / allow_owner_self_approve** | never read | 🔴 wire or remove |

Rule: **no decorative knobs in production** — each is either a test-proven
behavior or deleted before release. This table is the exit gate for §10.

---

## 8. Integration, workers & rails (P1)

- Razorpay/UPI sandbox: order→capture→confirm `matched`/`gateway`;
  unpaid-order confirm stays `manual`; `failed` status path closes
  allocations (trigger proof); amount mismatch fires reconcile class.
- Worker parity: `day-worker` dunning step ≡ HTTP door selection on same
  fixture (shared `dunning.js` — assert identical candidate sets);
  `reconcile-payments` worker ≡ HTTP report; dispatcher delivers queued
  FEE messages and updates carrier state honestly (sandbox ⇒ failed,
  never sent).
- Tally export: confirmed-only, IST dates, content-hash stable across
  re-exports; voided/refunded excluded or correctly vouchered.
- Comms templates: FEE_REMINDER/ESCALATION/RECEIPT bodies contain no
  other family's data; quiet-hours blackout holds end-to-end (queued at
  20:59 delivers; nothing queued 21:00–08:00).

---

## 9. NFR: performance, scale, soak (P1–P2)

Scale tenant fixture: 20k students × 3 terms × 4 installments (60k
obligations, 240k parts) + 10% paid + 5% overdue. Measure first (no
invented SLOs), then ratify:
- Generate p95 + row counts exact; re-generate idempotence at scale.
- Late-run/dunning/reconcile sweep times vs dues volume (page if >cron
  window); dunning batching under 50k overdue (LIMIT-200 loop proof).
- Confirm p95 under 20 concurrent desks; receipt-lock contention profile
  (advisory lock hold time).
- Reads p95: obligations list, installments, receipts, delivery at
  100k-row scale with pagination stability (no skipped/duplicated rows
  across pages under concurrent writes).
- 72h soak: workers + sweeps on loop, invariant pack green throughout,
  no sequence gaps beyond rollback-holes, disk growth linear.
- Frontend: Fees ledger render at 500-row pages, 390px viewport, PIN
  modal + toasts, PDF download of 5MB artifact.

---

## 10. Resilience & DR (P1)

- Kill -9 workers mid-dunning/late-run/reconcile → rerun is idempotent
  (dedup keys + SET semantics + code-unique Actions; assert zero dupes).
- Gateway down during confirm (cash path unaffected) and during refund
  (refused cleanly, retryable).
- PITR: restore to 5-min-ago snapshot → money-drill verifies hash chain,
  receipt PDFs byte-identical, `paid_cents` sums match pre-restore
  ledger export; RPO/RTO recorded.
- Migration marathon: fresh DB 001→151 equals seeded-then-migrated DB
  schema (diff), and trigger/backfill correctness on a pre-151 snapshot
  with stranded `open=true` rows.

---

## 11. Environments, data, CI wiring

- `test` (PR): L1–L3 + honesty subset (<10 min). `nightly`: full L1–L5
  + drills on scale fixture. `staging` (prod-like): L6–L9 + DR quarterly.
- Prod monitors (from L5 pack): `fee_ledger_balance_violations`,
  `fee_open_alloc_dupes`, `fee_unmatched_confirm_24h`,
  `fee_dunning_queue_age`, `fee_settlement_latency` — alert thresholds in
  `ops/alerts/schoolos.rules.yml`.
- Data: deterministic seed + scale generator (no prod PII in lower envs);
  second-tenant + linked/unlinked parent/student fixtures always present.

---

## 12. Exit criteria (release gate)

1. §2 matrix 100% automated, 100% pass (both plans: trial + core).
2. §7: zero 🔴 — every knob enforced or removed.
3. L4/L5 green 14 consecutive nights; prod monitors silent 14 days.
4. NFR baselines recorded + SLOs ratified; soak clean.
5. DR drill passed with RPO/RTO in SLA; audit trail verifies post-restore.
6. Open register (F-05…F-08 + §4-L2 decisions) resolved or explicitly
   deferred with UI copy that tells the truth.

## 13. Phasing (rough)

- **P0 (now):** L3 state-machine suite, §7 honesty suite, L5 invariant
  pack as CI + prod cron skeleton (~120 cases, ~1 wk).
- **P1:** L6 integration + L9 UI + §8 workers parity + NFR baselines
  (~100 cases + scripts, ~2 wks), resolve F-05…F-08 + L2 decisions.
- **P2:** soak, DR/PITR rehearsal, RLS fuzz expansion, second-round NFR
  after fixes (~1 wk + quarterly repeats).
- **P3 (continuous):** nightly everything, plan-matrix on every
  entitlement change, invariant monitors forever.

## 14. Deliverables

- `server/tests/fee-state.test.js`, `fee-property.test.js`,
  `fee-honesty.test.js`, `fee-rail.test.js` (new)
- `server/scripts/fee-consistency.sql` + cron wiring (L5 pack)
- `server/scripts/fee-scale-seed.js` (20k-student fixture)
- NFR scripts + baselines doc; DR rehearsal log
- This plan's §2/§7 tables kept as the living gate (updated per release)

---

## 15. Execution log — P0–P2 run 2026-10-07 (this run)

Everything below was executed, not just planned. Full detail in
`docs/FEE-DOMAIN-ROLE-DRILL.md` (§1–§3).

| Phase | Deliverable | Result |
|---|---|---|
| P0 | `tests/fee-state.test.js` — 8 lifecycle/illegal-transition tests | 8/8 |
| P0 | `tests/fee-honesty.test.js` — 11 [ENFORCED] + 20 [DECORATIVE] pinned | 31/31 |
| P0 | `tests/fee-property.test.js` — 6 randomized suites (~1.3k cases) | 6/6 |
| P0 | `scripts/fee-consistency.sql` + `fee-consistency.js` runner | 10 checks; proven both directions (planted 1p violation caught; clean after removal) |
| P1 | `tests/fee-rail.test.js` — provenance, fail-path, all 4 recon classes | 5/5 |
| P1 | `tests/fee-parity.test.js` — door≡worker counts + Actions | 2/2 (after fixing F-14) |
| P1 | `tests/fee-rls.test.js` — 13 tables × read-zero + 42501-smuggle + 6 door 404s | 3/3 |
| P1 | `scripts/fee-nfr.js` baselines (2000 students / 7350 dues) | generate 3.9s · late 180ms · dunning 293ms · reconcile 10ms · 20 parallel confirms 336ms (20/20 unique) · reads p50 15 / p95 18ms |
| P2 | DR rehearsal: dump → scratch restore → `money-dr-drill.js` + consistency pack | dump 0.45s · restore 3.5s · audit 0 breaks · ledger clean · receipts/allocs intact |
| P2 | Full regression (12 fee files incl. all pre-existing) | **106/106, 0 fail** |
| P2 | Role drill 93/93 + edge drill 37/37 re-run against final code | green |

Bugs fixed during execution: F-01 (zero installment parts 500) · F-02
(dunning escalation `kind='task'` 500) · F-03 (allocations never closed →
re-pay 500; migration 151 trigger + backfill) · F-04 (cross-student
concession accepted) · F-09 (pay-many in-progress guard gap → 500) ·
F-10 (late-disable ignored with rate set) · F-11 (series_start not a
floor) · F-12 (yearly receipts broke next confirm, 22P02) · F-13
(all-explicit under-coverage dropped remainder) · F-14 (worker/door
divergence) — plus a false-clean in the consistency runner itself
(splitter skipped commented checks; now asserts ≥10 checks run).
Still open: F-05 (dunning `force:true` documented-but-absent) · F-06
(credit-ledger options) · F-07 (bodyless-POST message) · F-08
(`refund_deduction_pct` unapplied) · F-15 (sweep batch ceilings) ·
§7 decorative-knob backlog (19 pinned, each must be wired or removed) ·
§4-L2 divergence decisions (installment-vs-net, auto-apply vs propose,
stacking).
