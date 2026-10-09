# SchoolOS — Fees Domain: Final Production Design

> **Purpose:** the authoritative, end-to-end design of the fees domain at production enterprise level —
> the money model, every table, every server door, every role, every worker, every screen, the event and
> audit contracts, the security and compliance posture, and the acceptance criteria. This is the system of
> record for how school money moves in SchoolOS.
>
> **Status:** this document is the final design. Implementation status is tracked separately in
> `docs/FEATURES-STATUS.md`; nothing here is aspirational with respect to the design itself.
> Verified line-by-line against code on 2026-10-06 (§14 runbook, §15 readiness/gaps/map added;
> stale gate, lifecycle, and surface claims corrected). §15.3 lists the remaining code-verified gaps.

---

## 1. Design principles (non-negotiable)

1. **Money is a kernel guarantee, not a plugin.** The ledger (`fee_obligations`, `payments`) is owned by the
   kernel. Plugins may *observe*, *record facts*, and *export*; they may never post to the ledger.
2. **Integer paise only.** All amounts are `bigint` paise. No floating-point arithmetic anywhere on the
   money path; ratios are computed in whole basis points and rounded once.
3. **Settlement is a staff act.** A gateway capture, a webhook, or a parent's intent never changes
   `paid_cents`. Only the kernel settlement door does, and only for authorized staff (or an explicitly
   enabled, audited auto-settle policy).
4. **Rails record facts; the kernel decides.** Provider webhooks are evidence, verified by HMAC over raw
   bytes, replay-deduped, freshness-bounded, and tenant-bound. They are never a settlement instruction.
5. **Maker-checker on reversals.** Refunds, waivers, and write-offs above a configured threshold require a
   second authorized actor. One `finance` role must not both make and check.
6. **Tenant isolation is a database boundary.** Every money table is `FORCE ROW LEVEL SECURITY` with a
   `tenant_id = app.current_tenant()` predicate; composite tenant-aligned foreign keys make cross-tenant
   references impossible. The application role never has `DELETE`.
7. **Every mutation is audited in the same transaction** on a hash-chained append-only ledger, and the money
   path additionally writes an append-only `payment_events` row.
8. **Deterministic first.** Fee math, dunning selection, reconciliation matching, and receipt numbering are
   pure functions of stored inputs. AI never touches a money decision.
9. **Idempotency by construction.** Generation, initiation, settlement, refund, webhook ingestion, and
   notification all have database-level idempotency keys — not application-only checks.
10. **Honesty.** No row, UI, or document claims a delivery, a settlement, or a figure the system cannot
    prove with a provider receipt or a stored record.

---

## 2. Actors & authorization

### 2.1 Built-in roles with a fee mandate

| Role | Fee authority |
|---|---|
| `owner` | Full ledger, plans, settlement, refund, void, reconcile, dunning, concessions approval, configuration |
| `principal` | Full ledger read, plans, settlement (in the confirm gate), dunning, concessions approval; voids only via owner |
| `finance_head` | Settlement, refunds (approver), reconciliation, dunning, plans, concessions approve, policy (`PUT /fees/settings` with owner) |
| `finance_clerk` | Initiate, desk collection (initiate only — **cannot confirm**; confirmation is the checker step), refunds (proposer only), reconciliation review, dunning run |
| `finance` | Full ledger read, plans, settlement (in the confirm gate), initiate, refunds; no policy writes |
| `itadmin` | Configuration, secrets, export/accounting; no settlement; CAN run the RTE lottery import (intake lane) |
| `coordinator` | Full-ledger read, reports, aging; plans read/create; RTE import |
| `parent` | Own children's obligations, own payments, receipts, initiate payment, request concession |
| `student` | Own dues read-only (v2 via `student_accounts` link) |
| `admissions` / `transport` / `facilities` / `technician` / `teacher` / `counselor` / `librarian` | **No fee mandate.** No ledger read, no payment action. |
| Custom roles | Mask over doors, enforced uniformly on kernel and plugin gates; ceiling limited to the author's own reach; `base_role: owner` forbidden |

### 2.2 Separation of duties

```
finance_clerk  → initiate, collect, propose refund/waiver (never confirm, never approve material refunds)
finance_head   → confirm, approve refund/waiver, reconcile, policy (with owner)
finance        → initiate, confirm, full-ledger read (no policy writes)
owner/principal→ approve, void (owner only), configure
```
- A single actor may never propose and approve the same reversal; the settler may not refund their own
  settlement unless they are the owner (`SOD_REQUIRED`, audited).
- Material full refunds (amount ≥ per-tenant `refund_approval_threshold_cents`, default ₹5,000) additionally
  require a reason and refuse `finance_clerk` outright. Partial below-threshold refunds need no reason.
- `owner` is the only role that may void an obligation, and only when it carries no payments.
- Concession approval is pure separation-of-duties (requester ≠ approver, owner exempt) — there is no
  percentage threshold in code; any `requested` concession needs a second authorized person.

### 2.3 Parent scoping

A parent's reach is structural, not a filter: the parent branch resolves `family.child_link` and refuses any
`studentId` not among the caller's children (404, so obligation existence stays private). A forged child id
yields an empty/404, never another family's data.

---

## 3. Domain vocabulary

| Term | Meaning |
|---|---|
| **Fee head** | A first-class charge category (Tuition, Transport, Lab, Hostel…) with refundability and tax metadata. |
| **Fee plan template** | A billing rule: grade-set × term-list × per-student amount, optional installment schedule. Charges nothing until generated. |
| **Billing run** | The atomic act of generating obligations from a template for every active student in scope. |
| **Obligation** | One student's receivable for one head/term. `amount_cents`, `concession_cents`, `net_amount_cents`, `paid_cents`, `waived_cents`, `status`. |
| **Concession** | A sanctioned reduction (concession, scholarship, sibling, staff, waiver) with an approval lifecycle. |
| **Installment** | A scheduled part of an obligation with its own due date. |
| **Payment** | A collection event. `initiated → confirmed → refunded` (or `failed`). |
| **Allocation** | The link between one payment and the obligation(s) it settles — supports one payment across several dues. |
| **Settlement** | The staff/kernel act that moves `paid_cents` and issues a receipt. |
| **Receipt** | An immutable numbered artifact (`RCP-…`) with a PDF in `files.store`. |
| **Gateway / rail** | `payments.upi`, `payments.razorpay` — links/orders + signed facts. |
| **Manual reconciliation** | A settlement whose reference matches no provider record; permitted at the desk, labelled as such. |
| **Reconciliation** | The comparison of kernel ledger against provider `order_log` (ghost/missing/orphan/amount-mismatch). |
| **Dunning** | Pre-due reminders, overdue reminders, and escalation actions. |
| **Quiet hours** | IST window during which no outbound fee message is queued. |
| **Aging** | Overdue buckets 1–7 / 8–30 / 31–90 / 90+ days. |
| **Daybook / voucher** | Tally export of confirmed payments as Tally 4.1 receipt XML. |
| **Fee §4.2** | The policy reference stamped on every fee audit and communications row. |

---

## 4. Data model

### 4.1 Tenancy, RLS, grants (applies to every table below)

- `ENABLE` + `FORCE ROW LEVEL SECURITY`; policy `tenant_isolation` using the NULL-normalising helper
  `app.current_tenant()` (so an unset tenant denies, never raises).
- Composite tenant-aligned foreign keys (`(tenant_id, id)` targets) — cross-tenant references are impossible.
- App role privileges: `SELECT, INSERT, UPDATE` only. **No `DELETE` anywhere.** Deletes are scoped
  `SECURITY DEFINER` helpers where a genuine purge is required (retention only).
- Money ledger (`audit_log`, `payment_events`, `fee_receipts`) is append-only; corrections append.

### 4.2 Core tables

**`app.academic_years`** — `id, tenant_id, name, starts_on, ends_on, is_current, created_at, updated_at`.
`UNIQUE(tenant_id,name)`, `CHECK(ends_on>starts_on)`, partial unique `(tenant_id) WHERE is_current`.
Helper `app.current_academic_year_id(tenant)`.

**`app.fee_heads`** — `id, tenant_id, name, category, is_refundable boolean, tax_code, gl_ledger_name,
active, created_at`. `UNIQUE(tenant_id,name)`.

**`app.fee_plan_templates`** — `id, tenant_id, name, fee_head_id, grades text[], terms jsonb
([{term,label,amount_cents,due_on?}]), academic_year_id, installments jsonb, effective_from, created_at,
updated_at`. `UNIQUE(tenant_id,name)`; terms validated by the kernel validator (≤24 entries, name ≤40,
label ≤80, integer amount ≥0, `YYYY-MM-DD` due date).

**`app.fee_obligations`** — `id, tenant_id, student_id, fee_head_id, term, label, due_on,
amount_cents, concession_cents, waived_cents, net_amount_cents (generated), paid_cents, status, source_ref,
billing_run_id, academic_year_id, created_at`.
- `CHECK paid_cents >= 0 AND paid_cents <= net_amount_cents`.
- `CHECK concession_cents >= 0 AND waived_cents >= 0 AND net_amount_cents >= 0`.
- `status ∈ open | partial | paid | void`.
- **Idempotency key** `UNIQUE(tenant_id, student_id, term, label)`; generation uses `ON CONFLICT DO NOTHING`,
  so regeneration never touches a row carrying payments or concessions.

**`app.fee_installments`** — `id, tenant_id, obligation_id, seq, due_on, amount_cents, status
(pending|paid|overdue|waived), payment_id`. Partial unique `(obligation_id, seq)`.

**`app.fee_concessions`** — `id, tenant_id, student_id, obligation_id?, fee_head_id, kind
(concession|scholarship|sibling|staff|waiver), percent, amount_cents, reason, status
(requested|approved|rejected|active|expired), requested_by, approved_by, approved_at, valid_from, valid_to,
created_at`.
- `CHECK percent BETWEEN 0 AND 100`; exactly one of `percent`/`amount_cents` is authoritative.
- Maker-checker enforced in the approval door, not by constraint.

**`app.payments`** — `id, tenant_id, student_id, obligation_id?, amount_cents, method, gateway_ref,
status (created|initiated|confirmed|failed|refunded), receipt_no, confirmed_at, settled_by, settled_via,
reconciliation_status (unreconciled|matched|manual|disputed), refunded_at, refund_reason,
refund_gateway_ref, refunded_cents, idempotency_key, created_at`.
- `CHECK amount_cents > 0`.
- `CHECK status <> 'confirmed' OR gateway_ref IS NOT NULL`.
- `CHECK refunded_cents >= 0 AND refunded_cents <= amount_cents`.
- `CHECK lower(method) IN (upi,razorpay,cash,card,cheque,netbanking,bank_transfer,manual)`.
- Partial unique `(tenant_id, obligation_id) WHERE status='initiated'` — one open attempt per obligation.
- Partial unique `(tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL`.

**`app.payment_allocations`** — `id, tenant_id, payment_id, obligation_id, amount_cents`.
`CHECK amount_cents > 0`; sum of allocations per payment ≤ `payments.amount_cents`; one payment may settle
several obligations.

**`app.payment_events`** — append-only money event log:
`id, tenant_id, payment_id, kind (initiated|confirmed|refunded|failed|webhook_fact|reconciled|disputed),
actor, actor_role, source, amount_cents, payload jsonb, created_at`. Never updated, never deleted.

**`app.fee_receipts`** — `id, tenant_id, payment_id, receipt_no, student_id, amount_cents, issued_at,
issued_by, pdf_file_id, voided_at`. `UNIQUE(tenant_id, receipt_no)`; append-only; a voided receipt keeps its
row and gains `voided_at`.

**`app.fee_dunning_log`** — `id, tenant_id, obligation_id, kind (before_due|overdue|escalation), channel,
offset_days, dedup_key, queued_at, provider, provider_ref, status`. `UNIQUE(dedup_key) WHERE NOT NULL`.
This replaces using `communications` rows as the dedup store; the comms row remains the delivery record.

**`app.communications`** — the delivery record: `id, tenant_id, audience_kind, audience_json, channel,
template, body, status (queued|sent|delivered|failed), policy_ref, dedup_key, approved_by, sent_at,
delivered_at, attempts, last_error, next_attempt_at, provider, provider_ref, claimed_at, claimed_by,
created_at`. Partial unique `dedup_key`. Carries `FEE_REMINDER`, `FEE_RECEIPT`, `FEE_DIGEST`.

### 4.3 Gateway data planes

**`plugin_upi.webhook_log`** — `id, tenant_id, gateway, event_id, event_type, payload, signature_verified,
received_at`. `UNIQUE(tenant_id, event_id)`.

**`plugin_razorpay.order_log`** — `id, tenant_id, payment_id, razorpay_order_id, razorpay_payment_id,
status, amount_cents, payload, created_at`. `UNIQUE(tenant_id, razorpay_order_id)`.

**`plugin_razorpay.webhook_log`** — identical shape to the UPI log; `UNIQUE(tenant_id, event_id)`.

**`accounting.tally`** owns no tables — the daybook reads `app.payments`; export history reads
`app.audit_log`. The plugin exports; it never posts.

### 4.4 Money invariants (database law)

| # | Invariant | Enforcement |
|---|---|---|
| 1 | `paid_cents ≤ net_amount_cents` | CHECK |
| 2 | One open payment per obligation | partial unique |
| 3 | `confirmed` requires a `gateway_ref` | CHECK |
| 4 | `refunded_cents ≤ amount_cents` | CHECK |
| 5 | Caller replay key unique per tenant | partial unique |
| 6 | Gateway replay no-op | `UNIQUE(tenant_id, event_id)` |
| 7 | Generation idempotent, never overwrites paid/concessed rows | unique key + `ON CONFLICT DO NOTHING` |
| 8 | Allocation sum ≤ payment amount | CHECK + door guard |
| 9 | Cross-tenant references impossible | composite tenant-aligned FKs |
| 10 | No hard delete on the money path | grants + append-only tables |
| 11 | Every mutation writes audit + `payment_events` in-transaction | door discipline, pinned by tests |

### 4.5 Concurrency

- Obligation and payment rows are locked `FOR UPDATE` for the duration of a settlement/refund.
- `lock_timeout = 5s`; a contended settlement fails cleanly rather than queuing indefinitely.
- Gateway network calls happen **before** the ledger mutation and **outside** the lock, so a provider
  refusal leaves the ledger byte-identical and no lock is held across the network.
- Concurrent confirms settle exactly once (one receipt); concurrent refunds reverse exactly once.

---

## 5. Server API

All kernel doors run inside `withUser(tenant, role)` so RLS applies. Plugin doors add a lifecycle gate
(disabled → 409, unentitled → 402, permission drift → 403). Error bodies are `{ error, code? }` with a
shared catalogue; list doors use a pagination envelope `{ items, limit, offset, hasMore }`.

### 5.1 Kernel fee doors

| Method & path | Gate | Behaviour | Idempotency |
|---|---|---|---|
| `GET /fee-plans` | owner, principal, finance, finance_head, finance_clerk, coordinator, itadmin | list templates + generated counts + last run | read-only |
| `POST /fee-plans` | owner, principal, finance, finance_head, finance_clerk | create template (head, grades, terms, installments) | `UNIQUE(tenant,name)` → 409 |
| `POST /fee-plans/:id/generate` | owner, principal, finance, finance_head, finance_clerk | lock template; atomic fan-out to active students; apply sibling/staff concessions; one `billing_run_id` | unique key + `ON CONFLICT DO NOTHING` |
| `POST /billing-runs/:id/void` | owner, finance_head | void an entire un-paid run atomically | status short-circuit |
| `GET /fees/obligations` | owner, principal, finance_*, coordinator, itadmin, parent, student(self) | parent/student structurally scoped; staff full ledger via mask-aware check | read-only |
| `GET /fees/obligations/:id` | same as list | one obligation with allocations, installments, concessions | read-only |
| `POST /fees/obligations/:id/void` | owner | refuse if `paid_cents>0` or active allocation; `status='void'` | already-void short-circuit |
| `GET /payments` | owner, principal, finance_*, coordinator, itadmin; parent (own) | itemised payment list with filters (status, method, date, student, reconciliation) | read-only |
| `GET /payments/:id` | same | payment + allocations + events + receipt | read-only |
| `POST /fees/payments` | parent, finance, finance_clerk, finance_head, owner, principal | validate; lock obligation; parent ownership; one-open check; insert `initiated`; allocate | `Idempotency-Key` header + partial unique |
| `POST /fees/payments/:id/confirm` | finance, finance_head, owner (**clerk excluded by design** — initiation and confirmation are different hands) | lock; verify ref against provider record; confirm + receipt; `paid_cents += amount`; emit comms | status short-circuit + one-open unique |
| `POST /payments/:id/refund` | finance, finance_clerk (propose), finance_head/owner (approve material) | maker-checker + threshold; pre-validate ledger; gateway refund before mutation; reverse `paid_cents`; `refunded_cents += amount` | status short-circuit |
| `POST /payments/reconcile` | owner, finance, finance_head, finance_clerk | 3-class + amount-mismatch sweep; write `payment_events`, audit, and Action cards | read-only |
| `POST /fees/dunning/run` | owner, principal, finance, finance_head, finance_clerk | quiet-hours gate; before-due + overdue + escalation selection; queue comms with `fee_dunning_log` dedup | dedup key |
| `GET /reports/fees/summary` | owner, principal, finance_*, coordinator, itadmin | per-term aggregates, collection %, method mix, concession spend | read-only |
| `GET /reports/fees/aging` | same | overdue buckets + oldest debtors (PII-stripped) | read-only |
| `POST /fees/concessions` | owner, principal, finance, finance_head, finance_clerk, parent, teacher | create request; apply at generation or to an obligation | one row per call (no dedup) |
| `POST /fees/concessions/:id/decide` | owner, principal, finance, finance_head — requester ≠ approver (owner exempt) | approve/reject; applies `concession_cents`, recomputes `net_amount_cents` | status short-circuit |
| `GET /fees/receipts` / `GET /fees/receipts/:id` | staff; parent own | receipt list + PDF (via `files.store`) | read-only |

### 5.2 Gateway doors

| Plugin | Door | Gate | Behaviour |
|---|---|---|---|
| `payments.upi` | `POST /plugins/payments.upi/links` | finance, finance_head, finance_clerk, owner, principal, **parent (own child)** | lock obligation, refuse settled/in-progress, create `initiated` payment, build `upi://` intent |
| `payments.upi` | `POST /plugins/payments.upi/webhook` | public, rate-limited | fail-closed HMAC over raw bytes; tenant resolved from the payment; lifecycle; freshness; replay dedupe; record fact only |
| `payments.razorpay` | `POST /plugins/payments.razorpay/orders` | finance, finance_head, finance_clerk, owner, principal (**parent NOT admitted** — the parent "Pay by card" button 403s; see §15 gaps) | unconfigured → 503; phase 1 lock+insert; phase 2 REST order; phase 3 failure→`failed`+502 / success→`order_log` |
| `payments.razorpay` | `POST /plugins/payments.razorpay/webhook` | public, rate-limited | parse → per-tenant secret candidates → HMAC → resolve tenant → bind signing tenant (SEC-21) → lifecycle → freshness → dedupe → update `order_log` fact only |
| `accounting.tally` | `GET /plugins/accounting.tally/daybook` | owner, itadmin, finance_* | confirmed payments mapped to ledger names |
| `accounting.tally` | `POST /plugins/accounting.tally/export` | owner, itadmin, finance_* | Tally 4.1 receipt XML, sha256 hash, digest-level audit, budget-checked |
| `accounting.tally` | `GET /plugins/accounting.tally/exports` | owner, itadmin, finance_* | export history from the audit ledger |

### 5.3 Read models & guardian surfaces

- `GET /plugins/ops.bi/fees/aging` — cached overdue read model for staff.
- `parent.assistant` — `GET /parent/brief` (`fees_open`), `POST /parent/copilot/ask` (fee intent),
  `GET /parent/explain/fees`, all grounded on the caller's own children and never a source of truth.
- `family.view` exposes the family command centre; fee detail is served by the kernel scoped door.

### 5.4 Error catalogue (money path)

`VALIDATION_FAILED` (400) · `FORBIDDEN` (403) · `NOT_FOUND` (404) · `CONFLICT` (409) ·
`OBLIGATION_SETTLED` · `PAYMENT_IN_PROGRESS` · `PAYMENT_NOT_CONFIRMED` · `LEDGER_INCONSISTENT` ·
`GATEWAY_REFUSED` · `SOD_REQUIRED` · `QUIET_HOURS` · `NOT_ENTITLED` (402) · `PLUGIN_OFF` (409) ·
`RATE_LIMITED` (429) · `GATEWAY_UNCONFIGURED` (503).

---

## 6. Lifecycles

### 6.1 Billing run
```
finance selects/creates a plan template (head × grades × terms × amount, optional installments)
  → preview: N students × T terms = M obligations, gross ₹X, concession ₹Y, net ₹Z   (no writes)
  → generate (one transaction): obligations + installments + sibling/staff concessions
       source_ref = billing_run:<id>; ON CONFLICT DO NOTHING; paid rows untouched
  → event fees.billing_run.generated + audit; optional guardian notice (approval spine)
  → void run (owner) reverses only un-paid, un-concessed rows
```

### 6.2 Parent payment
```
parent → /parent/fees → own children's obligations + outstanding total
  → Pay (full or partial above the configured minimum) → method
       UPI      → link door → upi:// intent / QR (parent-admitted)
       Razorpay → order door → checkout (STAFF ONLY — parent "Pay by card" 403s; §15 gap)
       desk     → pay at office; clerk initiates, a confirmer settles
  → gateway webhook records a FACT (never settles)
  → settlement: finance / finance_head / owner confirms (clerk cannot — maker-checker);
     verified capture → settled_via='gateway', else 'manual'. There is NO auto-settle:
     a verified capture never moves money by itself (dead flag removed, `settled_via='auto'`
     reserved but never written).
  → receipt issued, allocated to obligations/installments, FEE_RECEIPT delivered, statuses recomputed
```

### 6.3 Settlement (kernel)
```
lock payment → require initiated → lock obligation (refuse void)
  → verify gateway_ref against the provider's own record (order_log/webhook_log)
  → status='confirmed', receipt_no assigned, receipt row written, settled_by/settled_via recorded
  → paid_cents += amount (≤ net_amount_cents) → status recomputed
  → payment_events(confirmed) + audit (verified vs manual) + comms
```

### 6.4 Refund (maker-checker)
```
finance_clerk proposes refund (full or partial, reason) → action raised
  → finance_head/owner approves (distinct actor) → gateway refund BEFORE any mutation
  → refunded_cents += amount (≤ amount_cents) → paid_cents -= amount → obligation recomputed
  → payment_events(refunded) + audit risk high + receipt void + guardian notice
  → a refused gateway leaves the ledger byte-identical
```

### 6.5 Concession / waiver
```
request (parent/teacher/finance — parents and teachers see only their own requests)
  → approval by owner/principal/finance/finance_head with separation-of-duties
     (requester ≠ approver; owner exempt; no amount threshold in code)
  → applied to an obligation (or to generation via sibling/staff rules)
  → concession_cents set, net_amount_cents recomputed; paid_cents untouched
  → payment_events(concession) + audit + guardian notice on decision
```
Discretionary write-offs (bad-debt forgiveness outside the concession kinds) do NOT exist: no table,
no door, no thresholds. The only `waived_cents` writer is a concession approved with `kind='waiver`;
`fee_installments.status='waived'` exists in the CHECK but no door writes it. RTE statutory 100%
waivers are a separate authority (lottery import), not discretion.

### 6.6 Reconciliation
```
sweep: ghost (local confirmed, rail not captured) · missing (rail captured, ledger unconfirmed)
       · orphan (confirmed, no rail log) · amount mismatch
  → each finding: payment_events(reconciled|disputed) + event + audit + Action Center card
  → auto-match when provider ref matches and amounts are equal within tolerance
  → operator marks matched / raises a case; money is never auto-written by the sweep
```

### 6.7 Dunning & escalation
```
pre-due reminders (configured offsets) → overdue reminders (repeat every N days)
  → escalation after configured days raises a finance Action, not just a message
  → quiet hours honoured (writes nothing); dedup per obligation per offset in fee_dunning_log
  → every send recorded with provider receipt; in-app is a real delivery when no rail exists
```

### 6.8 Installments
```
if enabled, generation splits net_amount_cents into N installments with due dates
  → each installment settles via allocations; obligation status derives from the sum
  → overdue installments drive aging and dunning
```

### 6.9 Receipts
```
settlement → receipt row (append-only) + PDF artifact via files.store
  → parent downloads from /parent/fees; staff from the payments list
  → refund voids the receipt (voided_at), never deletes it
```

---

## 7. Events, audit & outbox

`emitEvent` writes `app.events` and an `app.outbox` row in the same transaction (default topic
`event.<type>`); `auditLog` writes the hash-chained ledger via `app.audit_append`. Plugin audit uses
`requestAudit` with `actorRole: plugin:<id>`. Every money mutation writes audit **and** a
`payment_events` row.

**Event catalogue (declared in manifests):**

| Event | Emitted by | Meaning |
|---|---|---|
| `fees.billing_run.generated` | kernel | a plan was fanned out |
| `fees.obligation.voided` | kernel | an obligation/run voided |
| `fees.payment.initiated` | kernel | an attempt opened |
| `fees.payment.confirmed` | kernel | ledger moved, receipt issued |
| `fees.payment.refunded` | kernel | reversal applied |
| `fees.payment.failed` | kernel/rails | attempt failed |
| `fees.reconciliation.discrepancy` | kernel/worker | ledger vs rail mismatch |
| `fees.dunning.sent` / `fees.dunning.escalated` | kernel/worker | reminder / escalation |
| `fees.concession.requested` / `.decided` | kernel | concession lifecycle |
| `fee.due` | kernel | obligation due — **the event the rails subscribe to** |
| `payment.link.created` | payments.upi | UPI intent created |
| `razorpay.order.created` | payments.razorpay | order created |
| `payment.captured` / `payment.failed` | rails (webhook) | provider fact |
| `tally.export.completed` | accounting.tally | export artifact produced |

**Audit actions:** "Created fee plan template", "Generated fee obligations", "Voided fee obligation",
"Initiated payment", "Confirmed payment (gateway reference … verified …)" / "Confirmed payment (manual
reconciliation — no gateway evidence)", "Refunded payment" (risk high), "Ran fee dunning sweep",
"Decided concession", "Reconciliation discrepancy", plus plugin actions "Payment link created",
"UPI webhook <type>", "Razorpay order initiated/failed/created", "Razorpay webhook <type>",
"Tally voucher export", "Capability request: tally.voucher.export". Reconciliation and no-op dunning sweeps
write audit rows too.

---

## 8. Background workers & scheduling

| Worker | Responsibility | Exit contract | Schedule |
|---|---|---|---|
| `day-worker` | sequences preventive → tally summary → retention → **dunning** → library reminders; each step contained | `1` if any step failed | weekdays 03:05 IST |
| `dunning-reminders` | per-tenant pre-due/overdue/escalation sweep, quiet-hours tri-state, `fee_dunning_log` dedup | `1` when anything queued (alert signal) | run by day-worker; runnable by hand |
| `reconcile-payments` | all-tenant discrepancy sweep, emits `fees.reconciliation` warn events | `1` when discrepancies found | weekdays 03:30 IST |
| `comms-dispatcher` | drains queued `FEE_REMINDER`/`FEE_RECEIPT` to rails | long-lived | compose service |
| `outbox` / `webhook-worker` / `workflow-worker` | fan out money events; evaluate fee workflow rules | long-lived | compose services |
| `retention-worker` | purges webhook logs, comms, outbox per windows | `1` on purge failure | compose one-shot + day-worker |

Alert rules: `comms_queue_stalled`, `comms_failed`, `comms_delivered_to_nobody`, `outbox_not_draining`,
`webhook_fanout_stalled`, `workflow_runner_stalled`, `backup_missing`.

---

## 9. Configuration & capabilities

Settings are validated against the manifest `settingsSchema` (unknown keys refused), encrypted with a
tenant-bound AES-256-GCM key, and secret-class keys are masked on read. NOTE: the sample below mixes
two stores — the kernel `PUT /fees/settings` keys (thresholds, partials, receipt series, late-fee
numerics) and per-plugin settings (comms quiet-hours, rail credentials, Tally mapping), each written
through its own door:

```json
{
  "billing": {
    "academic_year_id": "uuid", "terms": ["Term 1","Term 2","Term 3"],
    "due_day_of_month": 10, "grace_days": 5,
    "late_fee": { "enabled": false, "per_day_cents": 0, "cap_cents": 0 },
    "installments": { "enabled": false, "count": 3, "cadence": "monthly" }
  },
  "concessions": {
    "sibling_discount_percent": 0, "staff_ward_percent": 0,
    "categories": ["concession","scholarship","staff","sibling","waiver"]
  },
  "collection": {
    "methods": ["upi","razorpay","cash","card","cheque","netbanking","bank_transfer","manual"],
    "allow_parent_partial": true, "min_partial_cents": 10000,
    "receipt_prefix": "RCP", "receipt_series_start": 1
  },
  "dunning": {
    "enabled": true, "before_due_days": [3,1], "overdue_repeat_days": 7,
    "escalation_days": [15,30], "quiet_hours_ist": [21,8],
    "notify_channels": ["in_app","whatsapp"], "notify_parent": true
  },
  "reconciliation": { "auto_run_hour": 3, "tolerance_cents": 0, "alert_on_discrepancy": true },
  "accounting": { "ledger_mapping": {}, "export_hour": 20, "company_name": "" }
}
```

| Plugin | Settings | Capability |
|---|---|---|
| `payments.upi` | `gateway`, `webhook_secret_configured` (env), `default_vpa`, `webhook_freshness_mins` | `fees.upi.gateway` |
| `payments.razorpay` | `key_id`, `key_secret` (secret), `webhook_secret` (secret), `webhook_freshness_mins` | `fees.razorpay.gateway` |
| `accounting.tally` | `tally_url`, `company_name`, `export_hour`, `ledger_mapping` | `fees.accounting.export` |
| `comms.whatsapp` | `bsp_provider`, `sender_id`, `dlt_entity_id`, `dlt_template_ids`, `pay_button_template`, `quiet_hours` | `comms.whatsapp.templates` |

`enabledCapability(tenant, capability)` resolves the first enabled plugin whose manifest declares the
capability — the kernel never guesses a plugin id. Edit authority: owner/principal all keys; finance the
operational keys; itadmin secrets only.

---

## 10. Frontend surfaces

### Parent — `/parent/fees`
```
Outstanding ₹X across N children                                   [Pay now]
  per child: term · head · amount · due · status · [Pay] [Receipts]
  Pay sheet: amount (full/partial) · method · gateway checkout / UPI QR · confirm
  Receipts: list + [Download PDF] · Dues timeline · Ask (grounded parent assistant)
```

### Finance desk — `/fees`
```
Tabs (actual): Ledger · Payments · Installments · Delivery · Discounts & waivers · By class · Plans
(Plans embeds the FeePlans builder; reconciliation and dunning are operation cards inside
Payments, not tabs; there is no /fees/insights route — summaries live on /insights and /board-pack.)
Ledger: dues table (student, term, head, amount/paid/due/status) + per-row Record payment,
  owner-only Void, Invoice · per-student drawer · Outstanding / Collected % / Past-due stats.
Payments: newest-100 (date/student/amount/method/reference/provenance gateway-vs-manual/status)
  + Refund + Mark matched (disputed only) · Run reconciliation · Run fee reminders ·
  fee-policy card (owner/finance_head) · counter-PIN card (owner/finance_head).
```
The shared `RecordPaymentModal` performs initiate+confirm in one desk intent, so it requires
confirmation authority — a `finance_clerk` alone is refused at confirm. Counter cash therefore
needs a confirmer (finance/head/owner) even when the clerk collected it: this is the
maker-checker working as designed, and it means a single-clerk school must route confirmations
through the owner or head. Counter-PINs (`POST /fees/pins`, owner/finance_head) authenticate the
collector at initiation; they do not confer confirmation.

### Owner/principal — summaries on `/insights` and `/board-pack`
```
billed · collected · outstanding · collection % · aging buckets · top defaulters (PII-stripped)
collection trend · method mix · concession spend · refunds · reconciliation health · [Export CSV]
```
(via `GET /reports/fees/summary` and `GET /reports/board-pack`; no dedicated `/fees/insights` route.)

### Person 360 — `/people/:id` (Fees tab)
Per-student obligations, allocations, installments, concessions, payment history, record-payment action
(subject to the caller's settlement authority).

### Setup surfaces (no combined wizard — there is no `/fees/setup` route)
Module switching lives on `/plugins` (or the People-console size preset: Small/Standard/Large →
module switches + 3 standard heads Tuition/TRANSport/Activity); structure on `/fees/plans`;
policy on the `/fees` Payments tab; rails credentials on each plugin's settings; Tally on `/returns`.
A new school walks these in the order of §14, not through one screen.

**Navigation & access:** nav is driven by the server capability payload (`GET /me/effective`); a route is
reachable only if the caller's role or mask reaches its mapped door. There is no client-invented permission
model, and a deep-link to a surface the caller cannot reach renders an honest lock screen.

---

## 11. Notifications & receipts

| Trigger | Parent | Student | Finance |
|---|---|---|---|
| Obligation generated | ✓ (approved notice) | — | — |
| Due soon (configured offsets) | ✓ | ✓ | — |
| Overdue (repeat) | ✓ | ✓ | ✓ desk |
| Payment confirmed | ✓ receipt | — | — |
| Refund processed | ✓ | — | ✓ |
| Concession decided | ✓ | — | — |
| Reconciliation discrepancy | — | — | ✓ Action |
| Dunning escalation | ✓ | — | ✓ Action |

**Delivery honesty (PRD-13/PRD-17):** no row is marked `delivered` without a provider receipt. With no rail
configured, the in-app notification is the delivery and the operator-facing log says so. Every send is
recorded in `app.fee_dunning_log`; every receipt is an immutable artifact.

---

## 12. Security, compliance & tenancy

- **Tenant isolation:** FORCE RLS on every money table; composite tenant-aligned FKs; app role cannot
  bypass RLS and cannot DELETE. Cross-tenant probes are part of the suite.
- **Webhook security:** HMAC-SHA256 over raw bytes with `timingSafeEqual`; per-tenant secret candidates
  bound to the resolved tenant (SEC-21); uniform failure bodies (no existence oracle); freshness windows;
  replay dedupe; boot-refusal when an enabled rail lacks a secret.
- **Settlement provenance:** provider-record-backed, never regex-shaped (SEC-8). Manual settlements are
  permitted at the desk but always labelled.
- **Secrets:** encrypted at rest, masked on read, rotated through the settings door with key-name-only audit;
  `rails.sms` auth header classified secret.
- **Audit:** hash-chained append-only ledger; every mutation audited in-transaction; `payment_events` is a
  second append-only trail for the money path; `GET /audit/verify` recomputes the chain.
- **DPDP:** consent-gated comms; erasure nulls `guardian_phone` (which correctly stops dunning) and is
  journaled and replayable; retention windows purge webhook logs and outbound rows.
- **Payments data:** no card data is stored or transmitted by SchoolOS — card capture is delegated to the
  gateway; only provider references are retained.
- **GST/accounting readiness:** fee heads carry tax metadata; Tally export maps to ledger names; vouchers
  are hash-stamped and digest-audited.
- **Observability:** per-route latency, queue age, parked counts, webhook signature failures, worker
  heartbeats, backup age; request ids returned to clients and present in logs; build id in `/health`.
- **DR:** nightly verified backups + WAL/PITR; a restore drill restores roles and policies; RPO ≤ 24h.

---

## 13. Edge cases & invariants

- Last-payment race → obligation lock + one-open partial unique; the second attempt gets 409.
- Concurrent confirm → exactly one settlement and one receipt.
- Concurrent refund → ledger reversed exactly once.
- Gateway-refused refund → ledger byte-identical (network before mutation).
- Void refuses any obligation carrying payments or an active allocation; refund before void.
- Partial payment → obligation `partial`; refunding one payment returns it to `partial`.
- Concession never drives `net_amount_cents` below 0 and never touches `paid_cents`.
- `refunded_cents ≤ amount_cents`; partial refunds bounded.
- One payment may settle several obligations only while allocations sum ≤ the payment amount.
- IST dates for due/overdue; money in integer paise; no floats.
- Plugin disabled → 409 everywhere; ledger retained; drain protocol hands open actions back.
- Reconciliation tolerance is explicit; a mismatch beyond it raises a case and never auto-writes money.

---

## 14. New-school setup runbook (Part 2, stage: money)

A school arrives here with Part 1 done (roster, classes, finance roles appointed). Trial plan already
entitles every fee feature (§9 gates list `trial`), so there is no paywall on setup. Walk in order —
each step names its screen, door, role, and what "done" looks like:

```
1. Switch the modules on ............ /plugins or People-console size preset ... owner
   Small (7) / Standard (12) / Large (all 29). The preset ALSO creates the 3 standard
   fee heads (Tuition/TUIT, Transport/TRANS, Activity/ACT); 409 already-exists is fine.
   Done: plugins_enabled beyond the born-on 4 (checklist counts this).
2. Fix the fee heads ................ /fees/plans head picker + POST /fees/heads .. owner/principal/finance(_head)
   Add Lab, Hostel, Exam…; set category, refundability, tax_code, gl_ledger_name.
   NOTE: tax_code/gl_ledger_name/is_refundable are STORED but never consumed — no GST
   math and no ledger mapping read them (see §15). Done: heads list covers every charge.
3. Build plan templates ............. /fees/plans → POST /fee-plans ............. owner/principal/finance(_head/_clerk)
   Per plan: name, fee head, grades (from the school's own /classes list), terms with
   per-student paise + due dates (≤24 terms), installments (2/3/4/6/12), sibling
   auto-concession, hike % (above 10% requires an SMC meeting record within 180 days).
   There is NO plan edit: correction is void-run + new plan. Done: one plan per grade-band.
4. Generate the dues ................ [Generate fee dues] → POST /fee-plans/:id/generate
   One transaction fans out one obligation per active student × term (+ installments,
   + sibling concessions); existing rows are skipped, paid rows never touched.
   Undo (only while nothing is paid): Void last run (owner/finance_head), or single
   void per obligation (owner only, $0-paid only). Done: ledger shows billed totals.
5. Set the money policy .............. /fees Payments tab → PUT /fees/settings ... owner/finance_head
   Refund-approval threshold (default ₹5,000), parent-partial on/off + minimum (₹100),
   receipt prefix/series, late-fee per-day + cap + grace (0 = off), then Run late fees.
   Done: policy card saved (audited).
6. Connect the rails ................ each plugin's settings .................... owner/itadmin (secrets)
   UPI: default_vpa (else 503) · Razorpay: key_id/secret + webhook_secret ·
   WhatsApp BSP sender/DLT + quiet hours · Tally company/mapping. Secrets encrypted,
   masked on read, key-name-only audit. Done: links/orders succeed; test UPI intent.
7. Set the reminder policy .......... comms.whatsapp before-due offsets + escalation ages
   Overdue always sweeps; pre-due/escalation are opt-in. Quiet hours default 21:00–08:00 IST.
   Done: Run fee reminders queues >0 with dedup keys (or honestly 0 off-season).
8. Collect .......................... parents: /parent/fees (UPI intent, office cash);
   desk: RecordPaymentModal (initiate+confirm needs confirmer rights — see §10 clerk note).
   Every confirm mints RCP-… + PDF + FEE_RECEIPT notice. Done: collected % moves.
9. Reconcile + report ................ Run reconciliation (disputed → mark matched / case);
   aging buckets, board-pack money, Tally daybook + export. Done: zero unexplained disputed.
```

Skipping is allowed except where doors enforce (imports validate against defined classes;
generation needs active students in plan grades). A school that collects only cash can skip
step 6 entirely — manual settlement is a first-class path, always labelled `manual`.

---

## 15. Production readiness, generality boundary & role×domain map

### 15.1 Ready for production money (verified against code)

Integer-paise storage with no floats on any mutation path; idempotent initiation (header +
partial unique), generation (`ON CONFLICT DO NOTHING`), webhooks (event-id dedupe), refunds
(status short-circuit); maker-checker with SoD refusal + audit; advisory-locked deterministic
receipts; HMAC webhooks that record facts but never settle; hash-chained audit + `payment_events`
in-transaction; FORCE RLS everywhere with composite tenant FKs; no DELETE on the money path;
restore drill (`money-dr-drill`) verifying `paid ≤ net`, receipt↔payment equality, allocation
orphans. Trial plan entitles all fee features, so a new school is not paywalled mid-setup.

### 15.2 Generality boundary: India-first by construction

The domain is generalised **per-tenant** (heads, plans, terms, installments, concessions, dunning
policy, thresholds, receipt series are all school data) but **India-locked** in code. A school
outside India, or an Indian school needing GST, hits these walls:

- **INR-only.** `currency:'INR'` is literal in Razorpay/UPI doors; no currency column exists
  anywhere; `₹`/`en-IN` is baked into every surface and dunning copy.
- **IST-only.** Late-fee, dunning, reconciliation and Tally windows hardcode `Asia/Kolkata`
  (`routes.js`, `tally/index.js`) — even though the tenant now carries its own `timezone`
  (Part 1 profile). Money jobs do not read it.
- **No GST.** `tax_code` is stored on heads and never consumed; no rates, no tax breakup on
  receipts/invoices; Tally maps generic `Fee Income / Sundry Debtors`, not head ledgers.
- **Single late-fee formula** (flat per-day × overdue − grace, optional cap). No compounding,
  per-head rates, or schedules.
- **Statutory shapes are Indian**: RTE 25% quota + 100% waiver, UDISE/OASIS returns, Tally XML.

### 15.3 Known gaps (code-verified, not roadmap wishes)

| # | Gap | Where | Impact |
|---|---|---|---|
| 1 | Parent "Pay by card/netbanking" button 403s | `ParentFees.tsx` renders it; `POST /plugins/payments.razorpay/orders` admits staff only | Parents can pay online by UPI only; cards need the desk. Fix: admit parent with own-child scoping, or remove the button. |
| 2 | Tally export has no UI trigger | `POST /plugins/accounting.tally/export` exists; `Returns.tsx` reads daybook + history only | Accountant sees what WOULD export but cannot produce the file in-app. Fix: one button calling the existing door. |
| 3 | Receipt reads `school:{name:'SchoolOS'}` | `routes.js:3644` (+ tally `companyName='SchoolOS Demo'` default, UPI label) | Legal documents carry the platform name, not the school's. Fix: resolve tenant name. |
| 4 | Obligation invoice is `.txt`, not PDF | `invoice-<id>.txt` (`routes.js:3177`) vs receipt PDF | Fine for records, weak for parent-facing paperwork. |
| 5 | No discretionary write-offs | no table/door/thresholds; `installments waived` unwritten | Bad debt can only leave via waiver-kind concessions (approval-capped) or void ($0-paid). |
| 6 | No cheque-bounce handling | bounced cheques stay `confirmed` | Manual correction only (refund/void path). |
| 7 | `day-worker` brief undercounts dues | filters `status='pending'`, a value the CHECK never holds (should be `open`) | Morning brief shows fewer dues than the ledger. One-word fix. |
| 8 | Receipt series is collision-honest, not gapless | `MAX+1` under lock; rollback leaves gaps; mid-stream prefix change parses numeric suffix only | Acceptable for school receipts; do not promise gapless books. |
| 9 | No fee-plan edit | void-run + recreate only | Plan typos after first payment require per-obligation handling. |
| 10 | Concession requests have no dedup | one row per call | Double-clicks queue two requests (status guard prevents double-apply). |

### 15.4 Role × domain connections (how fees touches the rest)

- **Admissions** — RTE lottery import writes `rte-lottery` students + guardians + auto-approved 100% waivers + fee obligations; funnel conversion creates `admissions`-source students that later get billed by plans. Admissions desk reads dues context but holds no ledger write.
- **People/roster** — obligations key off `app.students.status='active'`; withdrawal keeps history; transfers don't move dues (dues are per-student, not per-class — class change never reprices).
- **Comms rails** — dunning/reminder/receipt delivery rides `comms.whatsapp`/sms/email; quiet-hours and DLT live on the rail side; `fee_dunning_log` dedups, `communications` proves delivery.
- **Accounting (Tally)** — read-only consumer of confirmed payments; never posts. `tax_code`/`gl_ledger_name` are future mapping hooks, not live wiring.
- **Oversight** — board-pack money, `/insights` summaries, and audit verify read the same ledger; `UDISE/OASIS` returns read enrollment + fee aggregates at filing time.
- **Parent assistant / family.view** — grounded reads (`fees_open`, explain-fees) over the parent's own children; never a source of truth, never a writer.
- **Billing (SaaS)** — `app.billing_orders` + `/billing/*` is the school→SchoolOS subscription plane; shares the Razorpay rail pattern but NEVER touches student money tables.
- **Payroll/HR** — staff-ward concessions link the fee and HR domains by rule (`staff` kind), not by money movement.
- **Library/transport/clinic** — no money coupling today: transport fees are a fee HEAD (TRANS), not a computed sync with `transport.gps` riders; library fines live in the desk, not obligations. Cross-domain billing (e.g., bus riders → transport dues) is unbuilt by design — heads are manual.

---

## 16. Acceptance criteria (definition of done)

1. A parent can see their children's dues, pay online by UPI (card/netbanking is staff-only
   until gap §15.3#1 is closed) or cash at the desk, and download a receipt — end to end.
2. A clerk can find any payment, propose a refund, and a distinct approver can complete it;
   the clerk can never confirm a settlement or approve a material refund.
3. Every settlement is either provider-verified or explicitly labelled manual, in the audit ledger.
4. Reconciliation surfaces every ghost/missing/orphan/mismatch with an Action, and the sweep is audited.
5. Dunning sends pre-due, overdue, and escalation notices with per-offset dedup and delivery evidence.
6. Concessions and waivers apply with maker-checker and never move `paid_cents`.
7. Installments settle via allocations and drive aging correctly.
8. Every money mutation writes audit + `payment_events` in the same transaction.
9. No cross-tenant read or write is possible from any fee door.
10. No money path uses floats; every invariant in §4.4 is enforced by the database and pinned by a test.
11. Every surface is reachable only through the server capability payload; no client-invented permissions.
12. Every number in the UI is derived from a live door or shown as an honest empty state.
13. A verified gateway capture never settles by itself; every confirmed payment names its settler
    and its provenance (`gateway` vs `manual`).
