# ParentOS / FamilyOS — Build Plan (compact)

Companion to `TEACHEROS-PLAN.md` (shared spine) and the 88-section Parent Experience Architecture (in-repo source of truth: this doc + that brief). ParentOS optimizes for **understanding + action**, not doing. Grammar unchanged: `TRIGGER → SYSTEM DOES IT → HUMAN DECIDES EXCEPTIONS → PERMANENT RECORD`.

## Principles (enforced)
1. Child-first, calm by default — consolidate; urgent/action/upcoming/info tiers; no notification floods
2. Evidence before interpretation — facts with numbers, never "your child is failing/disengaged"; AI never diagnoses
3. Parent is a partner, not an administrator — respond/request/approve/acknowledge; never edit school records (report-discrepancy flow instead)
4. Privacy by design — only own children; siblings separated unless authorized; never expose teacher-private notes, fees to teachers, internal records
5. Plain language + "Explain this" on every complex metric

## Reuse map (what parents get from existing/in-flight work)
- Complaints + tracking ✅ (my-cases) · Fees+UPI ✅ · DPDP consent ✅ · Chat ✅ · Visitor pickup ✅ · Reports (frozen, digest-stamped) ✅ · Absent alerts + homework digest + child leave approvals ← TeacherOS lanes (in flight)
- New for parents: family aggregate doors, consents center, request/ticket center, briefs, copilot v0, parent UI surfaces

## Data model (migration 034 PS-1 · 035 PS-2)
```
family.request        (id, tenant, guardian_id, child_id?, category leave|certificate|document|transport|
                       activity|profile_correction|reevaluation|other, payload jsonb, status submitted→received→
                       assigned→in_progress→waiting_parent→resolved→closed, owner_role, sla_at)  + status_events append-only
family.consent        (id, tenant, child_id, kind trip|photo|medical|activity|transport, title, detail_ref,
                       due_at, status pending|granted|declined, decided_by, decided_at)   -- immutable once decided
parent.copilot_call   (id, tenant, user_id, verb, budget_class 'P-copilot', tokens, sources jsonb, at)
```
Existing tables read (never written) by parent doors: teacher.homework/submission, teacher.leave_request, plugin_exams.report (published only), attendance, fees, dpdp consent, cases (/my-cases), documents.

## Frozen API contracts (v0)
```
GET  /parent/home                     → {children:[{child_id,name,class,attendance_today,attention:[{tier:urgent|action|upcoming,ref,title,due}]}], actions:[{kind:consent|ptm|form|payment, ref, title, due}], brief:{morning,evening,week}}
GET  /parent/child/:id/timeline       → chronological evidence-only events (authorized scope)
GET  /parent/child/:id/academics      → subjects: {pct, trend, strengths[], practice[], published_reports[]}
GET  /parent/child/:id/assignments    → upcoming|submitted|reviewed|overdue|missing (+explain text)
GET  /parent/child/:id/attendance     → today, month %, history, approved-leave-aware
GET  /parent/child/:id/exams          → upcoming (date/syllabus) + published results + explain
POST /parent/leave-request            {child_id, kind, dates, reason, doc_ref?} → kernel action → attendance informed on approval
GET/POST /parent/consents             → list pending/past · POST /:id/decide {granted|declined} (immutable once set)
GET/POST /parent/requests             → unified request center + status timeline (ticketing statuses)
GET  /parent/brief?when=morning|evening|week   → deterministic plain-language aggregation
POST /parent/copilot/ask|draft        → deterministic v0 (template+rules from authorized data), budget-capped, sources shown
POST /parent/report-discrepancy       {record_ref, what_wrong} → case-style flow; parents NEVER edit records directly
```
Role gates: guardian sees ONLY linked children (sibling separation pinned by tests); teacher never sees fees; copilot never invents policy/dates — "the circular does not specify" when ambiguous.

## Lanes (4, disjoint files)
| Lane | Scope | Files |
|---|---|---|
| **PS-1** server-family | migration 034: family.request+consent+status events; ALL read doors above (graceful degradation when teacher tables absent); leave-request kernel flow | `server/src/plugins/family.view/**`, `migrations/034_*`, `tests/parent-family.test.js` |
| **PS-2** server-parent-ai | migration 035: briefs builder (morning/evening/week, deterministic), copilot v0 (rules+templates over authorized data, budget rows), explain-layer text for attendance/academics | `server/src/plugins/parent.assistant/**`, `migrations/035_*`, `tests/parent-assistant.test.js` |
| **PU-1** ui-family-home | Family Command Center: child switcher, TODAY card, tiered NEEDS ATTENTION, ACTION CENTER checklist, briefs cards, multi-child overview | `app/src/screens/parent/family/**`, `app/src/components/parent/**`, `app/src/services/parentFixtures.ts` |
| **PU-2** ui-family-flows | Assignments center · attendance+leave request · exams+prep · report card+explain · consents · requests/tickets · documents · transport view · events/achievements · messages upgrades | `app/src/screens/parent/flows/**` |

Shell.tsx/App.tsx route wiring: PU lanes LIST proposed lines only — orchestrator integrates (teacher lanes own those files right now). Fixtures auto-swap to live doors (TU pattern).

## Sequencing
W1: PS-1+PS-2+PU-1 → W2: PU-2 + integration → W3: briefs/digests polish + red-team parent-cycle (privacy: sibling separation, fee blindness of teachers, copilot hallucination) → factory-check. Est: **7–10h wall-clock** with 4 lanes.

## Acceptance script (final gate)
1. 07:00 morning brief: today for each child + actions — zero navigation
2. Child absent → 10am alert, approved leave = no false alarm
3. Homework visible; child submits; status flows to parent — no chasing
4. Consent due → ACTION tier → one tap → immutable record
5. Report published → parent opens → "Explain this" → plain language
6. Request submitted → status timeline, never "processed" when queued
7. Multi-child family → overview + per-child drill, records never merged
8. Privacy: sibling data never crosses; teachers fee-blind; copilot cites sources
