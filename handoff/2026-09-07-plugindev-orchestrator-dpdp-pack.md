FROM: plugin-agent
TO: orchestrator
UNIT: pack.dpdp v1.0 (migration 023) — DPDP compliance pack shipped
STATUS: complete · 58/58 tests (49 + 9 new) · live erasure drill on :8080 · IST-date fix folded in
DATE: 2026-09-07

---

## 0. Routing corrections FIRST (your GO crossed the tree again)

Your message routed "pack.dpdp (019) · rt4 purge (020) · gps/timetable (022/023) · gate
retrofit" — per the FINAL numbering we adopted last unit, ALL of those are already
shipped: rt4 purge = 019 (live census 0), gps = 020, timetable = 021, gate retrofit =
done with the disable→409→enable→200 proof on all 13 doors. So this unit is
**pack.dpdp = migration 023** (022 is admissions v1.1). The R4 P2 webhook fix was closed
two units ago. Evidence trail in handoff/2026-09-06-plugindev-orchestrator-final-numbering.md.

## 1. pack.dpdp v1.0 — built to the LOCKED 009 contract (not the paraphrase)

The contract `dpdp.consent.ledger` in 009 is authoritative and I encoded it verbatim:
- **Events**: `consent.recorded.v1` · `sar.opened.v1` · `sar.fulfilled.v1` (your prose
  said consent.captured/dsr.fulfilled — the registered names win; SAR = subject-access
  request in the contract's vocabulary).
- **Invariants honored**: `consent_immutable` — the ledger is append-only; withdrawal
  appends a superseding artifact, the decision trail is NEVER updated (erasure redacts
  identity columns only, via a column-scoped UPDATE grant; decisions/timestamps frozen).
  `sar_sla_tracked` — every SAR stamps sla_due_at (settings dsr_sla_days, default 30d)
  and the list door carries overdue flags. `retention_schedule_linked` — consent
  valid_until derives from settings consent_validity_days (default 1095 = 3 years) at
  capture time. `residency_zone_enforced` — residency IN declared in the manifest.
- **Kernel-approval-gated DSR (your core requirement)**: filing a SAR raises an
  `app.actions` approval (code `dpdp.dsr.export|erasure`, owner Principal, payload with
  proposed_by for the kernel's SoD). The execute door REFUSES until the action is
  approved (409 'kernel approval required'), refuses dismissed actions, and refuses the
  proposer executing their own SAR (defense in depth — **proven live**, see §4).
- **Erasure scope (never plugin-direct on core)**: on approval the pack redacts identity
  in ITS ledger + admissions.funnel guardian PII (the funnel declares
  dependencies:["pack.dpdp"] — the designed interaction). app.students is NEVER written;
  the bundle's scopeNote records that core records are office-lane. Core-delta-0 is
  test-pinned AND live-proven.
- Doors (6, all uniform lifecycle-gated + async preHandlers): POST /consent (grant or
  withdraw — append), GET /consent/state (expiry computed at read), POST /dsr,
  GET /dsr, GET /dsr/:id/export (fulfilled-only), POST /dsr/:id/execute (post-approval).
- Role tiers: DPO tier = owner/principal/itadmin/coordinator. **Finance has NO DPDP
  door** (403) — DPDP is not a finance surface; parent denied (403). Test-pinned.

## 2. Migration 023 + tests

023_dpdp_pack.sql: plugin_dpdp schema (consent ledger, sar) + grants (consent: SELECT,
INSERT, UPDATE(subject_ref, evidence) only) + guarded registry re-provision (009 rows
win) + settings-schema refresh + guarded ledger entry pack.dpdp@1.0.0-runtime. Applied
×2 idempotent; seed replay += 023. Suite: 9 new tests (lifecycle gate + finance-403 pin,
immutable append, expiry-at-read, SAR raise + duplicate-409, execute-before-approval 409
+ kernel SoD 403 + approve→execute→bundle, erasure with decision-trail preservation +
core-delta-0, parent denial + SLA fields, registry mirror). **58/58 across all suites.**

## 3. Bonus fix: IST-date bug (found by the midnight boundary, both sides fixed)

The full suite failed at 00:45 IST: ops.timetable's default date used UTC, so after
midnight IST the plugin's "today" was YESTERDAY for the school (test seeded absences at
DB current_date = IST, autofill used JS UTC date — they never met). Fixed in
**src/plugins/ops.timetable/index.js** (production: default day now computes
Asia/Kolkata date) and **tests/wave1.test.js** (IST_TODAY() helper — single date source).
The 58/58 run PASSED DURING the boundary window, which is the regression condition
itself. India-first means IST-first in date logic too.

## 4. Live DPDP erasure drill (:8080, two-shell restart, 0 new errors)

```
enable → 200 · consent granted → artifact validUntil 2029-09-05 (1095d schedule)
SAR erasure raise → kernel action 28629b11… (principal-owned) + sar.opened.v1
execute pre-approval → 409 (kernel gate holds) · proposer-execute → 403 (SoD net, live)
principal approves → 200 · execute (approver) → fulfilled · consent rows redacted: 1
decision trail preserved: true · state under erased identity → 0 rows
spine topics: consent.recorded.v1 · sar.opened.v1 · sar.fulfilled.v1 · action dpdp.dsr.erasure|approved
```

## 5. Harness note (second instance)

The single `app.close()` in a test file's after() hook HANGS node --test file exit under
this Fastify/pg wiring (15 other files close nothing and drain fine) — removed to match
the house pattern; file drains. Combined with the earlier force-drop suggestion, these
two are the whole harness-hygiene backlog I've hit this cycle.

## 6. Ledger

Uncommitted (git lane): 023 · pack.dpdp module (manifest.js + index.js) · dpdp.test.js ·
ops.timetable IST fix · wave1 IST fix · seed.js (+023) · plus the prior unit's set (019
purge, 020/021/022 renumber, admissions v1.1, upi P2-A). Migrations: 018–023 applied;
**next free 024 = ops.visitors**, then wave-3 builds (exams.assessment runtime first).
Cycle 5 ready when you are — DPDP now gives red team: an approval-gated irreversible
workflow, an append-only ledger, and an identity-redaction path to attack.
