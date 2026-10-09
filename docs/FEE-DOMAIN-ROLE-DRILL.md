# Fee Domain — Role Drill & Open Fixes

> How this document was built: I took each fees role in turn (finance_head
> first, then owner, principal, finance, finance_clerk, coordinator, parent,
> teacher, student), executed **every** fees-domain operation that role is
> allowed (and the denials it must hit), and verified the result **in the
> database** after each call — not just the HTTP status. The drill is
> repeatable: `TEST_DB_NAME=schoolos_feedrill node
> server/scripts/fee-role-drill.js` (fresh seeded DB, 93 checks, JSON report
> in `/tmp/fee-role-drill.json`).
>
> Latest run: **93/93 role checks as-expected** (2026-10-07) plus **37/37
> edge checks** (`TEST_DB_NAME=schoolos_feededge node
> server/scripts/fee-edge-drill.js`, JSON in `/tmp/fee-edge-drill.json`).
> Enterprise suites (plan `docs/FEE-ENTERPRISE-TEST-PLAN.md` P0–P2, all
> executed 2026-10-07): state 8/8, honesty 31/31 (11 enforced + 20
> decorative pinned), property 6/6, rail 5/5, parity 2/2, RLS 3/3 —
> **full fee regression 106/106, 0 fail** across 12 files.
> NFR baselines (2000 students / 7350 dues / 12450 parts): generate 3.9s,
> late-run 180ms, dunning 293ms, reconcile 10ms, 20 parallel confirms 336ms
> (20/20 unique receipts), ledger reads p50 15ms / p95 18ms. Consistency
> pack clean on live + restored DBs. DR rehearsal passed (dump 0.45s →
> restore 3.5s → money-drill ok, audit chain verifies).
>
> Below: §1 role-by-role evidence, §2 edge-case evidence, §3 the open-fixes
> register (11 bugs found by the drills and FIXED, plus the still-OPEN items
> with file:line).

---

## 1. Role drill evidence

Seed: `meridian` tenant (trial plan = all fee features entitled), 3 active
students sampled; `parent@` linked to 2 children via `family.child_link`,
`student@` linked to 1 child via `app.student_accounts`; `finance_head`
(`head@`) and `finance_clerk` (`clerk@`) provisioned. Finance head
configured **every** tenant value first (Step 1), so later roles ran against
a fully-configured school.

### 1.1 Finance head (the configurator) — 55 ops, all green

| # | Operation | HTTP | DB proof |
|---|---|---|---|
| 1 | `PUT /fees/settings` — all 30+ keys (refund threshold ₹2,000, tolerance 50p, min partial ₹50, receipt `FHD` yearly from 100, notes; late on, per-day ₹5, cap ₹200, grace 3d, fixed/percent fallbacks; window 90d, reason-required, partial allowed; methods upi/cash/card; dunning [7,3]/[30], quiet 21:00–08:00; max parts 6, max ext 15d, concession cap 50%) | 200 | `fee_settings.settings` row holds every key; `GET` returns 47 merged keys |
| 2 | Bad enum (`late_fee_mode: hourly`) / unknown key | 400 / 400 | rejected before any write |
| 3 | Create 3 heads: Tuition (defaults), Admission (`isRefundable:false, appliesLateFee:false, allowsInstallments:false`), Transport (`refundWindowDays:30`) | 200 ×3 | 3 `fee_heads` rows with flags |
| 4 | Duplicate head name | 409 | uniqueness holds |
| 5 | 2 discount rules (sibling 10% auto-apply; merit flat ₹5,000 capped, grades [6]); bad kind rejected | 200, 200, 400 | 2 `fee_discount_rules` rows |
| 6 | Per-head late rule (Tuition, per-day ₹5/grace 3/cap ₹200) | 200 | `fee_late_rules` row |
| 7 | Create plan: 2 terms (₹12,000 + ₹8,000, due dates), 3 installments (30% + 30% + remainder), sibling 10%, head Tuition | 200 | `fee_plan_templates` row |
| 8 | Duplicate plan / hike 25% without SMC | 409 / 400 | guards hold |
| 9 | Preview (75 students in scope) | 200 | obligations 1125 → 1125 (**zero writes**) |
| 10 | Generate → **inserted 150, 450 installments, run id**; regenerate → inserted 0 | 200 / 200 | 150 `fee_obligations` + 450 `fee_installments` + `billing_runs` row; idempotent |
| 11 | Clone plan | 200 | second template row |
| 12 | Read obligation (0 payments, 3 installments); render invoice (first = `cached:false`, file stored) | 200 / 200 | `invoice_file_id` set on obligation |
| 13 | Extend due date +10d / beyond 15d cap / no reason | 200 / 400 / 400 | `due_on` moved; cap message names the 15d policy |
| 14 | Edit pending installment date / waive another part | 200 / 200 | `due_on` changed; `status=waived` + reason |
| 15 | Initiate UPI payment (full); bad method | 200 / 400 | `payments.status=initiated` + 1 allocation |
| 16 | Confirm | 200 | `confirmed/manual/manual`, receipt **`FHD-2026-0100`** (yearly series works), `fee_receipts` row with **PDF artifact**, obligation `paid=1200000/paid` |
| 17 | Partial refund ₹100 | 200 | `refunded=10000`, `gateway=manual`, payment stays confirmed |
| 18 | Request scholarship; **self-decide** | 200 / **403** | SoD: requester ≠ approver enforced |
| 19 | Wrong-student obligation on concession request | 400 | F-04 guard (see §2) |
| 20 | Late-fee dry-run (`wouldUpdate=150`) then run (`updated=150`) | 200 / 200 | `late_fee_cents` SET on 150 rows (idempotent SET, not ADD) |
| 21 | Dunning run → **queued 200, escalated 75**; `force:true` run → 200 (no `forced` flag — F-05 OPEN) | 200 / 200 | 515 `fee_dunning_log` rows, 516 `FEE%` comms, 75 finance `exception` Actions |
| 22 | Reconcile (`total=0`), recon-runs history, mark-matched (none disputed → skipped honestly) | 200 ×3 | `recon_runs` row written |
| 23 | Enroll clerk counter-PIN; clerk cash with wrong PIN / correct PIN | 200 / 403 / 200 | `fee_pins` row; wrong PIN refused |
| 24 | Reads: entitlements (trial), installments (200), payments (2), receipts (1), obligations (100); `GET /student/fees` as head | 200 ×5 / **403** | staff cannot touch the student self-view |

### 1.2 Owner — 6 ops

| Operation | HTTP | DB proof |
|---|---|---|
| `PUT /fees/settings` (prefix → OWN) | 200 | stored |
| Void **unpaid** obligation | 200 | `status=void` |
| Void **paid** obligation | 409 | money that moved can't be voided |
| Void billing run **with money** | 409 | refuses; names refund-first path |
| Request + **self-approve** waiver (owner exempt from SoD by design) | 200 / 200 | `status=approved` |

### 1.3 Principal — 7 ops

| Operation | HTTP | DB proof |
|---|---|---|
| `PUT /fees/settings` | 403 | read-only on policy |
| `GET /fees/settings`, create plan, extend fresh ob +5d | 200 ×3 | plan row; `due_on` moved |
| Extend paid/far obligation | 400/409 | policy message, no write |
| Initiate on fresh ob | 200 | `initiated` payment row |
| Initiate on settled remainder (refund+late reopened ₹300 headroom) | 200 | legitimate re-pay, not a duplicate |
| Confirm (maker/checker: principal is neither finance nor owner) | 403 | — |
| Dunning run | 200 | queued 40 |

### 1.4 Finance (legacy broad) — 2 ops

| Operation | HTTP | DB proof |
|---|---|---|
| Confirm already-confirmed | 200 | `already:true`, no double receipt |
| `PUT /fees/settings` | 403 | head/owner only |

### 1.5 Finance clerk (maker) — 4 ops

| Operation | HTTP | DB proof |
|---|---|---|
| Confirm | 403 | maker cannot check |
| Full material refund (above ₹2,000 threshold) | 403 | `code=SOD_REQUIRED` |
| Dunning run | 200 | allowed (queued 0 — dedup already consumed) |
| `GET /fees/settings` | 403 | — |

### 1.6 Coordinator — 3 ops

Reads ledger (100 rows) and concessions: 200. Initiate payment: **403**.
Financial data visible, money movement refused — as designed.

### 1.7 Parent (2 linked children) — 7 ops

| Operation | HTTP | DB proof |
|---|---|---|
| List obligations | 200 | `scoped=own_children`, 13 rows (2 kids incl. drill dues) |
| Query 3rd child's id | 200 | **0 rows** (no leak, no 403 tell) |
| Initiate on own child | 200 | payment row |
| Initiate on other child | 404 | existence kept private |
| Request concession for own child | 200 | `requested` row |
| List own receipts (1 visible after head's payment? own-scope) | 200 | own rows only |
| Refund | 403 | — |

### 1.8 Teacher — 3 ops

Request scholarship: **200** (only money-adjacent power teachers have).
Read ledger / create plan: **403 / 403**.

### 1.9 Student (linked) — 2 ops

`GET /student/fees`: 200, `linked=true`, 5 obligations, `outstandingCents`
computed. `GET /fees/obligations`: 200, `scoped=self`, 5 rows — never the
school ledger.

### 1.10 System invariants (SQL sweep, post-drill)

`overpaid=0, negnet=0, overref=0` (CHECKs + behavior agree),
`live_receipts=1, payment_events=7, dunning_log=515, FEE comms=516`.

---

## 2. Edge-case evidence (37/37)

Races, idempotency, money boundaries, policy switches, isolation — each
verified against the DB, not just the status code.

| # | Probe | Result | DB proof |
|---|---|---|---|
| E1 | Concurrent double-initiate (`Promise.all` ×2, same obligation) | one 200 + one 409 | **exactly-one-winner**, no duplicate payment rows |
| E2 | Same `Idempotency-Key` twice | `already:true`, identical payment id | no duplicate |
| E3 | `amountCents` above outstanding | 400 `VALIDATION_FAILED` | nothing written |
| E4 | Parent partial below `min_partial_cents`; partials with `allow_parent_partial=false` | 400 / 400 | tenant messages name the policy |
| E5 | Pay-many same student (2 allocs); mixed students; 21 ids; **second initiate over a pay-many in-progress** | 200 / 400 / 400 / **409** (was 500 — F-09) | allocations exact; guard now covers both payment shapes |
| E6 | Confirm twice | `already:true` | exactly 1 receipt row |
| E7 | Bogus `gatewayRef` (`FAKE-…`) | 200, `settled_via=manual`, ref stored verbatim | provenance honest: `verifiedBy=null`, never fabricated |
| E8 | Confirm after obligation voided | 409 `OBLIGATION_SETTLED` | no resurrection, `paid_cents` untouched |
| E9 | Full refund → receipt voided; double refund; refund above refundable | 200 `refunded` / 409 / 409 | `voided_at` set; `refunded_cents` capped |
| E10 | Refund an `initiated` payment | 409 `PAYMENT_NOT_CONFIRMED` | ledger untouched |
| E11 | ₹999,999 concession on ₹10,000-unpaid obligation | approved, **clamped to 10,000** | `net ≥ paid` invariant holds in DB |
| E12 | Waiver on fully-paid obligation | approved, **`waived=0`** | no negative net possible |
| E13 | 2d-overdue inside 3d grace → 0; 100d-overdue → exactly cap 5000 | 0 / 5000 | grace + cap math exact |
| E14 | Fixed mode SETs 7000 over 5000-cap → stays 5000 (cap wins, replaces not adds); disabled flag → **409** | 5000 / 409 | F-10 semantics (rate-set auto-enables; explicit off refuses) |
| E15 | Refund on `is_refundable=false` head | 400 naming the head | ledger untouched |
| E16 | Refund 10d after confirm with 1d window | 400 naming the window | ledger untouched |
| E17 | Installment edit with `installment_allow_edit=false` | 403 | row untouched |
| E18 | Quiet hours set 00:00–23:59, run dunning | `queued:0`, comms 8→8 | **zero writes** during blackout |
| E19 | UPI initiate with `enabled_methods=[cash]` | 400 naming enabled rails | — |
| E20 | 25 terms / 25 parts / malformed UUID | 400 ×3 | validators hold |
| E21 | Fresh second tenant: lists zero plans/obligations; pays tenant-A obligation | 200 empty / 200 empty / **404** | RLS isolation, no existence leak |
| E22 | Audit coverage of money ops | 42 audit rows | trail present |
| E23 | All receipt numbers | 8 receipts, 8 unique | series integrity |

---

## 3. Open-fixes register

| ID | Found by | Symptom | Root cause | Fix (file:line) | Status |
|---|---|---|---|---|---|
| F-01 | drill as head | Plan with `installments:[{amount_cents:0}…]` passed validation (400-free) then **500 at generate** | Validator allowed `≥0`; `fee_installments` has `CHECK (amount_cents > 0)` | `routes.js:validateInstallments` → amount `≥1`, percent `(0,100]`; `fees/installments.js:splitInstallments` returns `{error}` on any `≤0` part so generate **skips** instead of 500ing | **FIXED**, suites green |
| F-02 | drill as head | `POST /fees/dunning/run` **500** whenever escalation fired (30d+ overdue + escalation days set) | Escalation INSERT used `kind='task'`; `actions_kind_check` (migration 139) allows only `approval\|incident\|case\|exception\|recommendation\|reminder\|substitution` | `routes.js` dunning escalation INSERT → `kind='exception'` (matches reconcile cards) | **FIXED** — rerun: `queued=200, escalated=75`, suites green |
| F-03 | drill as principal | Re-pay after a confirm **500**: `duplicate key payment_alloc_one_open_per_obligation` | Migration 138 designed `allocations.open=false` once a payment leaves `initiated` but **nothing ever wrote it** — stale `open=true` blocked all later initiations | Migration `151_payment_alloc_close.sql`: AFTER-UPDATE trigger closes allocations + backfill of stranded rows; explicit `SET open=false` in confirm door | **FIXED**, suites green |
| F-04 | drill as head | Concession for student X against student Y's obligation **accepted** (200) — one approval would have moved the wrong child's net | `POST /fees/concessions` never compared `obligation.student_id` vs `studentId` | `routes.js:POST /fees/concessions` → 404 unknown obligation, **400 on student mismatch** (drill asserts it) | **FIXED**, suites green |
| F-09 | edge drill (E5) | Second initiation over a pay-many **in-progress** payment **500** (`payment_alloc_one_open_per_obligation`) | `PAYMENT_IN_PROGRESS` guard only checked legacy `payments.obligation_id` (NULL for pay-many); the partial index became the enforcer — as a 500 | Guard now checks allocations joined to initiated payments → clean **409** | **FIXED**, edge 37/37, suites green |
| F-10 | edge drill (E14) | `late_fee_enabled=false` did **not** disable the run when a rate was set (proceeded instead of 409) | Gate treated explicit-off + rate as "legacy on" | PUT auto-enables when a rate is set without the flag (pre-flag behavior preserved); explicit off now strictly **409**s (dry-run still previews) | **FIXED**, edge 37/37, suites green |
| F-11 | honesty suite | `receipt_series_start` silently ignored once any receipt existed (MAX won, start only seeded row one) | `COALESCE(MAX(..), start-1)` — start never applied as floor | `GREATEST(MAX(..), start-1)` — start is a floor; proven by setting 99999 mid-stream | **FIXED**, suites green |
| F-12 | honesty suite | Confirm **500** (`22P02`) on the first receipt *after* any yearly-format receipt (`PREFIX-2026-0001`) existed | Series parser stripped the *leading* non-digits → `'2026-0001'::int` exploded | Parse the *trailing* numeric segment (`regexp_match … ([0-9]+)$`); regression test confirms twice past a yearly row | **FIXED**, suites green |
| F-13 | property suite | All-explicit installment parts totaling **less** than the obligation silently dropped the remainder (under-scheduled dues) | `splitInstallments` returned explicit-only amounts with no coverage check | Loud `{error}` when explicit-only sum < total (author adds one open `{}` part); generation skips instead of under-billing | **FIXED**, suites green |
| F-14 | parity work (plan §8) | Cron worker **diverged** from the dunning door: read only plugin settings (ignored fee_settings ladder/quiet hours) and never raised escalation Actions | Worker predated tenant fee policy and was never updated | Worker reads fee_settings first (plugin fallback), raises `exception` Actions code-unique; `fee-parity.test.js` pins door≡worker counts | **FIXED**, suites green |
| F-15 | NFR baselines | Sweep ceilings undocumented: dunning `LIMIT 200`/class/run, late-run `LIMIT 500`/run — one daily cron **cannot drain** a 7k-dues backlog (≈35 dunning runs) | Batch caps with no drain loop or documentation | — | **OPEN** — loop-until-clean in worker/door, or document multi-run ops + alert when backlog > cap |
| F-05 | drill as head | `force:true` on dunning does nothing special (no `forced` flag, quiet hours still block) | `SIMULATION-FIXES.md` L7 claims a force override shipped; **no such code exists** in the dunning door | — | **OPEN** — decide: implement audited `force:true` backfill, or correct the doc |
| F-06 | policy review | `overpayment_rule: keep_credit\|refund` is stored/validated but **unenforced** (initiation still refuses overpay) | Credit ledger doesn't exist yet | — | **OPEN** — phase 2: credit-balance ledger or remove the options |
| F-07 | drill as head | Bodyless POST with JSON content-type → 400 `Unexpected end of JSON input` | Standard Fastify strict-JSON body parsing; all shipped clients send `{}` | — | **OPEN (minor hardening)** — consider `{}`-default or a friendlier 400 message on money doors |
| F-08 | drill as head | `refund_deduction_pct` accepted in settings but **never applied** to the reversed amount | Deduction math not implemented in the refund door | — | **OPEN** — apply deduction on reversal (and show it on the receipt), or remove the key |

Notes that are **not** bugs (verified intended): owner self-approve
(`allow_owner_self_approve=true` default); clerk can initiate cash with PIN
but never confirm; teacher reads denied on ledger; parent cross-child reads
return empty (not 403) to avoid existence leaks; late-fee run is SET-based
and idempotent; regeneration never touches paid rows; void requires
`paid_cents=0`.
