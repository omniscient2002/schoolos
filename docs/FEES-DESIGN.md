# SchoolOS — Fees Domain: Final Production Design

> **Purpose:** the authoritative, end-to-end design of the fees domain at production enterprise level —
> the money model, every table, every server door, every role, every worker, every screen, the event and
> audit contracts, the security and compliance posture, and the acceptance criteria. This is the system of
> record for how school money moves in SchoolOS.
>
> **Status:** this document is the final design. Implementation status is tracked separately in
> `docs/FEATURES-STATUS.md`; nothing here is aspirational with respect to the design itself.

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
| `principal` | Full ledger read, plans, dunning, concessions approval above threshold; settlement only if policy delegates |
| `finance_head` | Settlement, refunds (approver), reconciliation, dunning, plans, concessions approve ≤ threshold |
| `finance_clerk` | Initiate, desk collection, refunds (proposer only), reconciliation review, dunning run |
| `itadmin` | Configuration, secrets, export/accounting; no settlement |
| `coordinator` | Full-ledger read, reports, aging |
| `parent` | Own children's obligations, own payments, receipts, initiate payment, request concession |
| `student` | Own dues read-only (v2 via `student_accounts` link) |
| `admissions` / `transport` / `facilities` / `technician` / `teacher` / `counselor` / `librarian` | **No fee mandate.** No ledger read, no payment action. |
| Custom roles | Mask over doors, enforced uniformly on kernel and plugin gates; ceiling limited to the author's own reach; `base_role: owner` forbidden |

### 2.2 Separation of duties

```
finance_clerk  → initiate, collect, propose refund/waiver
finance_head   → confirm, approve refund/waiver, reconcile
owner/principal→ approve above threshold, void, configure
```
- A single actor may never propose and approve the same reversal.
- Refund/waiver above `approval_threshold_cents` requires a distinct approver; the attempt is refused with
  `SOD_REQUIRED` and audited.
- `owner` is the only role that may void an obligation, and only when it carries no payments.

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
| `GET /fee-plans` | owner, principal, finance_head, finance_clerk, coordinator, itadmin | list templates + generated counts + last run | read-only |
| `POST /fee-plans` | owner, principal, finance_head | create template (head, grades, terms, installments) | `UNIQUE(tenant,name)` → 409 |
| `POST /fee-plans/:id/generate` | owner, principal, finance_head | lock template; atomic fan-out to active students; apply sibling/staff concessions; one `billing_run_id` | unique key + `ON CONFLICT DO NOTHING` |
| `POST /billing-runs/:id/void` | owner | void an entire un-paid run atomically | status short-circuit |
| `GET /fees/obligations` | owner, principal, finance_*, coordinator, itadmin, parent, student(self) | parent/student structurally scoped; staff full ledger via mask-aware check | read-only |
| `GET /fees/obligations/:id` | same as list | one obligation with allocations, installments, concessions | read-only |
| `POST /fees/obligations/:id/void` | owner | refuse if `paid_cents>0` or active allocation; `status='void'` | already-void short-circuit |
| `GET /payments` | owner, principal, finance_*, coordinator, itadmin; parent (own) | itemised payment list with filters (status, method, date, student, reconciliation) | read-only |
| `GET /payments/:id` | same | payment + allocations + events + receipt | read-only |
| `POST /fees/payments` | parent, finance_clerk, finance_head, owner, principal | validate; lock obligation; parent ownership; one-open check; insert `initiated`; allocate | `Idempotency-Key` header + partial unique |
| `POST /fees/payments/:id/confirm` | finance_clerk, finance_head, owner | lock; verify ref against provider record; confirm + receipt; `paid_cents += amount`; emit comms | status short-circuit + one-open unique |
| `POST /payments/:id/refund` | finance_clerk (propose), finance_head/owner (approve) | maker-checker; pre-validate ledger; gateway refund before mutation; reverse `paid_cents`; `refunded_cents += amount` | status short-circuit |
| `POST /payments/reconcile` | finance_head, owner | 3-class + amount-mismatch sweep; write `payment_events`, audit, and Action cards | read-only |
| `POST /fees/dunning/run` | finance_clerk, finance_head, owner | quiet-hours gate; before-due + overdue + escalation selection; queue comms with `fee_dunning_log` dedup | dedup key |
| `GET /reports/fees/summary` | owner, principal, finance_*, coordinator, itadmin | per-term aggregates, collection %, method mix, concession spend | read-only |
| `GET /reports/fees/aging` | same | overdue buckets + oldest debtors (PII-stripped) | read-only |
| `POST /fees/concessions` | finance_clerk, finance_head, principal, owner | create request; apply at generation or to an obligation | unique per (student,head,period) |
| `POST /fees/concessions/:id/decide` | approver per threshold | approve/reject; applies `concession_cents`, recomputes `net_amount_cents` | status short-circuit |
| `GET /fees/receipts` / `GET /fees/receipts/:id` | staff; parent own | receipt list + PDF (via `files.store`) | read-only |

### 5.2 Gateway doors

| Plugin | Door | Gate | Behaviour |
|---|---|---|---|
| `payments.upi` | `POST /plugins/payments.upi/links` | finance_clerk, finance_head, owner, principal | lock obligation, refuse settled/in-progress, create `initiated` payment, build `upi://` intent |
| `payments.upi` | `POST /plugins/payments.upi/webhook` | public, rate-limited | fail-closed HMAC over raw bytes; tenant resolved from the payment; lifecycle; freshness; replay dedupe; record fact only |
| `payments.razorpay` | `POST /plugins/payments.razorpay/orders` | finance_clerk, finance_head, owner, principal | unconfigured → 503; phase 1 lock+insert; phase 2 REST order; phase 3 failure→`failed`+502 / success→`order_log` |
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
       UPI      → link door → upi:// intent / QR
       Razorpay → order door → checkout
       desk     → pay at office; clerk records manually
  → gateway webhook records a FACT (never settles)
  → settlement: clerk/head confirms (or auto-settle policy on a verified capture)
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
request (parent/teacher/finance) → approval per threshold (principal above 10%)
  → applied to an obligation (or to generation via sibling/staff rules)
  → concession_cents set, net_amount_cents recomputed; paid_cents untouched
  → payment_events(concession) + audit + guardian notice on decision
```

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
tenant-bound AES-256-GCM key, and secret-class keys are masked on read.

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
    "approval_threshold_cents": 0, "categories": ["concession","scholarship","staff","sibling","waiver"]
  },
  "collection": {
    "methods": ["upi","razorpay","cash","card","cheque","netbanking","bank_transfer","manual"],
    "allow_parent_partial": true, "min_partial_cents": 10000,
    "receipt_prefix": "RCP", "receipt_series_start": 1, "auto_settle_verified_capture": false
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
Tabs: Ledger · Payments · Reconciliation · Dunning · Concessions · By class · Plans · Insights
Payments:    date · student · amount · method · status · receipt · gateway_ref · verified? · [Refund]
Refunds:     propose/approve queue (maker-checker) · reason · gateway vs manual · approval threshold
Reconcile:   discrepancy cards → [Mark matched] [Raise case] · last sweep · tolerance
Dunning:     overdue queue · [Run sweep] · quiet-hours state · last-sent per obligation · escalations
Concessions: request queue · approve/reject · apply to obligation
```

### Owner/principal — `/fees/insights`
```
billed · collected · outstanding · collection % · aging buckets · top defaulters (PII-stripped)
collection trend · method mix · concession spend · refunds · reconciliation health · [Export CSV]
```

### Person 360 — `/people/:id` (Fees tab)
Per-student obligations, allocations, installments, concessions, payment history, record-payment action
(subject to the caller's settlement authority).

### Setup wizard — `/fees/setup`
Academic year → Fee heads → Terms & due dates → Plan templates → Rails & secrets → Done.

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

## 14. Acceptance criteria (definition of done)

1. A parent can see their children's dues, pay through a gateway, and download a receipt — end to end.
2. A clerk can find any payment, propose a refund, and a distinct approver can complete it.
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
