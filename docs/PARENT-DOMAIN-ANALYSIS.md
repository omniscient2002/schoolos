# PARENT DOMAIN — full-depth analysis

> **Scope.** The complete parent experience as built on the current tree: `family.view` (034),
> `parent.assistant` (035), the parent UI surfaces, `parentApi.ts`, and the parent reuse paths into
> fees, cases, exams and reports. Companion to `docs/PARENTOS-PLAN.md` (design) and
> `docs/TEACHER-PARENT-STUDENT-PERFECT-100.md` (register). Every claim cites `file:line`.
>
> **Method.** Read both plugin `index.js`/`manifest.js`, migrations 034/035, the parent screens,
> `parentApi.ts`, `App.tsx`, `Shell.tsx`, `effective-access.js`, and the two test suites. Nothing
> was edited.
>
> **Status (living).** Batch 1 + 3a closed **PAR-GAP-2** (request transitions), **PAR-GAP-3**
> (assignments door), **PAR-GAP-4** (child-leave write-back marks attendance `leave`), **PAR-DAT-1**
> (consent authoring staff door), and much of **PAR-GAP-6** (home/brief/attendance/exams/consent
> payloads reconciled). A later hardening batch closed **PAR-GAP-5** (child-link management doors:
> `GET/POST /parent/links`, `DELETE /parent/links/:id`; `family.child_link` DELETE granted and
> allowlisted in `grant-tightening.js`), **PAR-DAT-2/4** (`family.request` is now append-only — a
> door state machine plus a DB `BEFORE UPDATE` guard, SEC-4), **PAR-DAT-5** (FORCE RLS on every
> `family.*`/`parent.*` table), **PAR-GAP-10** (FORCE RLS), and API-7 (explain path was already a
> path). A surface batch then closed **PAR-GAP-8** (PTM booking UI) and **PAR-GAP-11** (per-child
> flows at `/parent/child/:id`: attendance+leave, exams, assignments, timeline, report explain,
> transport). Remaining: **PAR-GAP-12** (absent alerts / digest are built server-side; no parent
> notification surface), **PAR-GAP-15**, and the documents/events tabs (no parent-scoped documents
> read door; the kernel event feed is deliberately parent-excluded, PLGX-1). See the
> register's §0 implementation log in `docs/TEACHER-PARENT-STUDENT-PERFECT-100.md`; the gap table in
> §10 below is the baseline snapshot.

---

## 0 · Verdict at a glance

The privacy/scoping spine is genuinely good: structural `family.child_link` binding, cross-guardian
403, immutable-consent DB trigger, deterministic no-LLM assistant, budget ledger, evidence-only
language. What holds the domain at **~44/100** is that the **loops cannot complete** and the
**payloads do not match the client**: nobody can author a consent, no request status can ever
advance, the assignments door the UI calls does not exist, child-leave approval writes nothing back,
and six live UI blocks silently render placeholders because PS-1/PS-2 and PU-1 were built to
different shapes.

| Axis | Weight | Score | Reason |
|---|---|---|---|
| Security, tenancy & scoping | 18 | 74 | structural child_link + cross-guardian 403 + immutable consent; no FORCE RLS, no link-management door |
| Data model & integrity | 15 | 58 | tables + append-only events; no consent authoring, no request transition, `family.request` UPDATE unguarded |
| API contract & integration | 12 | 40 | 2 frozen doors missing; home/brief/attendance/exams/consent/timeline shapes diverge |
| RBAC & least privilege | 12 | 72 | teacher fee-blindness pinned; no office read-plane, no link provisioning |
| Product completeness | 20 | 28 | consent/request loops incomplete; assignments missing; leave informs nothing; no PU-2 flows |
| Frontend correctness & honesty | 10 | 55 | no fabricated data; live cards render placeholders; two stub screens in nav |
| Tests & gates | 8 | 60 | strong privacy/assistant pins; zero contract/UI tests |
| Operations & DR | 5 | 35 | audit rows; no absent-alert/digest, no FORCE-RLS gate, no metrics |
| **Total** | **100** | **~44** | |

---

## 1 · Purpose & principles

ParentOS optimises for **understanding + action**, not doing. Grammar:
`TRIGGER → SYSTEM DOES IT → HUMAN DECIDES EXCEPTIONS → PERMANENT RECORD`
(`PARENTOS-PLAN.md:3`).

1. Child-first, calm by default — consolidate; urgent/action/upcoming/info tiers; no notification floods.
2. Evidence before interpretation — facts with numbers; never "your child is failing/disengaged"; AI never diagnoses.
3. Parent is a partner, not an administrator — respond/request/approve/acknowledge; never edit records.
4. Privacy by design — only own children; siblings separated unless authorised; never expose teacher-private notes or fees-to-teachers.
5. Plain language + "Explain this" on every complex metric.

---

## 2 · Roles

| Role | Parent-domain reach |
|---|---|
| `parent` | every door (guardian-scoped to `family.child_link`); PTM slot board + book own child; fees/payments/receipts; cases; copilot/brief/explain |
| `teacher` | **refused on every family.view / parent.assistant door** (pinned); fee-blind (pinned) |
| `coordinator` | decides `parent.leave.<id>` kernel actions; sees coordinator-owned family requests in `/coord/escalations` |
| `principal`/`owner`/`itadmin` | oversight tier declared (`family.view/index.js:24 STAFF_OVERSIGHT`) but **unused** |
| `office`/staff | no family read-plane door exists |

---

## 3 · Plugins & schemas

| Plugin | Migration | Owns | Billing |
|---|---|---|---|
| `family.view` | `034_parent_family.sql` | schema `family`: child_link, request(+events), consent | pack `family` |
| `parent.assistant` | `035_parent_assistant.sql` | schema `parent`: copilot_call, brief_log | pack `family` |

Both `class:'C'`, `trust:'T1'`, `defaultEnabled:false`.

---

## 4 · Data model

### 4.1 `family.view` (034)

| Table | Key columns | Constraints | Append-only | RLS | Grants |
|---|---|---|---|---|---|
| `family.child_link` | id, tenant_id, user_id, student_id, relation, is_primary, created_at | **UNIQUE(tenant_id, user_id, student_id)** (`034:24`) | no | ENABLE (`034:81-90`) | SELECT/INSERT/UPDATE (`034:92`) |
| `family.request` | id, tenant_id, guardian_id, child_id?, category, title, payload, status, owner_role, sla_at, created_at | category ∈ 8 (`034:32`); status ∈ submitted→received→assigned→in_progress→waiting_parent→resolved→closed (`034:35`) | no (status mutable, UPDATE granted) | ENABLE | SELECT/INSERT/UPDATE |
| `family.request_event` | id, tenant_id, request_id→request CASCADE, from_status, to_status, note, actor_id, at | — | **yes** SELECT+INSERT (`034:93`) | ENABLE | SELECT/INSERT |
| `family.consent` | id, tenant_id, student_id, kind, title, detail_ref, due_at, status, decided_by, decided_at, created_at | kind ∈ 6; status ∈ pending/granted/declined; **BEFORE UPDATE trigger `family.consent_immutable()` raises if OLD.status ≠ pending** (`034:68-78`) | immutable once decided | ENABLE | SELECT/INSERT/UPDATE |

### 4.2 `parent.assistant` (035)

| Table | Key columns | Constraints | Append-only | RLS | Grants |
|---|---|---|---|---|---|
| `parent.copilot_call` | id, tenant_id, user_id, verb, question, answer_ref, sources, budget_class, at | verb ∈ ask/draft | yes SELECT+INSERT (`035:56`) | ENABLE | SELECT/INSERT |
| `parent.brief_log` | id, tenant_id, user_id, when_kind, payload, at | when_kind ∈ morning/evening/week | yes SELECT+INSERT | ENABLE | SELECT/INSERT |

**Findings:**
- **PAR-DAT-1 (P1):** no `INSERT` into `family.consent` exists anywhere in `server/src` (grep: only
  the test `parent-family.test.js:99`). There is **no authoring door**; the consent centre can
  never be populated in production.
- **PAR-DAT-2 (P1):** `family.request.status` is created `submitted` (`family.view:251-252`) and no
  route updates it (grep `UPDATE family.request` = none). The ticket is frozen at one state.
- **PAR-DAT-3 (P1):** `family.child_link` has **no management door**; the only writer is the demo
  name-match seed (`034:97-102`). Production binding is manual SQL.
- **PAR-DAT-4 (P2):** `family.request` is granted UPDATE with no append-only guard — the "append-only
  status" claim rests on the absence of a door, not the database.
- **PAR-DAT-5 (P2):** no `FORCE ROW LEVEL SECURITY` on any `family.*`/`parent.*` table.
- **PAR-DAT-6 (P3):** plan wanted a `tokens` column on `parent.copilot_call` (`PARENTOS-PLAN.md:23`);
  actual table has `question`/`answer_ref` instead.

---

## 5 · Door inventory (15 doors)

### 5.1 `family.view` — 11 doors (`server/src/plugins/family.view/index.js`), all `require('parent')` + lifecycle

| # | Method + path | Line | Behaviour |
|---|---|---|---|
| 1 | `GET /parent/home` | :57 | per-child attendance_today, assignments, consents, attention[]; requests. **Returns `{children,requests}` — no `actions[]`, no `brief{}`** (`:106`) |
| 2 | `GET /parent/child/:id/timeline` | :111 | assertOwnChild 403; attendance + submissions + published reports; returns `{timeline}` (`:143`) |
| 3 | `GET /parent/child/:id/academics` | :148 | published reports + growth framing; no client wrapper |
| 4 | `GET /parent/child/:id/attendance` | :164 | `today` status string, month_pct (leave excluded), history (`:176-181`) |
| 5 | `GET /parent/child/:id/exams` | :186 | upcoming + published (`{id,name,term,class_grade}`) |
| 6 | `GET /parent/consents` | :203 | own children only; `s.name AS child` (`:207`) |
| 7 | `POST /parent/consents/:id/decide` | :215 | granted/declined; assertOwnChild; 409 if decided; emit `family.consent.v1`; audit |
| 8 | `POST /parent/requests` | :239 | category/title; childId format+ownership; inserts request + event; emit `family.request.v1`; audit |
| 9 | `GET /parent/requests` | :265 | own requests + json_agg events |
| 10 | `POST /parent/report-discrepancy` | :277 | creates `profile_correction` request + event; emit; audit |
| 11 | `POST /parent/leave-request` | :303 | childId ownership; inserts request + event; raises kernel action `parent.leave.<id>`; emit `child.leave.requested.v1`; audit |

### 5.2 `parent.assistant` — 4 doors (`server/src/plugins/parent.assistant/index.js`), all `require('parent')` + lifecycle

| # | Method + path | Line | Behaviour |
|---|---|---|---|
| 12 | `GET /parent/brief` | :219 | when ∈ morning/evening/week; per-child sentences; provenance `parent.brief_log`; audit; returns `{when,children,sentences,label,…}` |
| 13 | `POST /parent/copilot/ask` | :263 | 8 intents + honest unknown; sources[]; monthly cap 100 → 429; `parent.copilot_call`; audit |
| 14 | `POST /parent/copilot/draft` | :362 | question_to_teacher / leave_note; own-child grounding; labelled `ai_draft`; budget; audit |
| 15 | `GET /parent/explain/:topic` | :429 | attendance/report/fees; built from own-child numbers; audit |

### 5.3 Frozen-contract conformance (`PARENTOS-PLAN.md:28-41`)

| Contract | Status |
|---|---|
| `GET /parent/home` | PARTIAL (no `actions[]`, no `brief{}`; `class_grade` not `class`) |
| `GET /parent/child/:id/timeline` | PARTIAL (shape differs from client) |
| `GET /parent/child/:id/academics` | PARTIAL (no UI) |
| `GET /parent/child/:id/assignments` | **MISSING** (UI calls it) |
| `GET /parent/child/:id/attendance` | PRESENT |
| `GET /parent/child/:id/exams` | PRESENT |
| `POST /parent/leave-request` | PRESENT |
| `GET/POST /parent/consents` | PARTIAL — **POST (authoring) missing** |
| `GET/POST /parent/requests` | PRESENT |
| `GET /parent/brief` | PRESENT |
| `POST /parent/copilot/ask\|draft` | PRESENT |
| `POST /parent/report-discrepancy` | PRESENT |
| `GET /parent/explain/:topic` | EXTRA (not in plan) |

---

## 6 · Data travel

### F1 · Family home aggregation
```
GET /parent/home
  ├─ myChildren (family.child_link JOIN app.students)
  ├─ per child: attendance today; assignments (probe teacher.homework + name-bridge);
  │             consents; attention[] (pending consent = action; homework due = upcoming)
  └─ requests (guardian's own family.request)
```

### F2 · Consent decision (half-loop)
```
GET /parent/consents ──▶ own-child consents
POST /parent/consents/:id/decide ──▶ UPDATE status granted/declined (trigger blocks re-update)
   ├─ emit family.consent.v1
   └─ audit
[NO AUTHORING PATH] ──▶ family.consent can only be inserted by test/seed
```

### F3 · Request ticket (half-loop)
```
POST /parent/requests ──▶ family.request (submitted) + request_event
POST /parent/report-discrepancy ──▶ family.request (profile_correction) + event
GET /parent/requests ──▶ own requests + events
[NO TRANSITION PATH] ──▶ status never leaves 'submitted'
```

### F4 · Child leave → kernel → (nothing)
```
POST /parent/leave-request
   ├─ assertOwnChild
   ├─ family.request (leave) + event
   ├─ app.actions parent.leave.<id> owner_role=coordinator (proposed_by=parent)
   └─ emit child.leave.requested.v1
coordinator → POST /actions/:id/decide ──▶ approved (kernel routes.js)
   └─ **notification only** (`routes.js:2105-2110`) — no family.request_event,
      no attendance.status='leave'
parent attendance door promises "Approved leave never counts" (`family.view:174-181`)
   but approval never marks attendance
```

### F5 · Parent brief / ask / explain (deterministic)
```
collectChildren: attendance today + 30d; homework due 24h (probe); exams last7d (probe);
                 consents pending; reports published; fees open
GET /parent/brief → factual sentences; safePayload bans failing/disengaged/risk/weak; brief_log
POST /parent/copilot/ask → 8 intents; sources[]; honest unknown; copilot_call; monthly cap
POST /parent/copilot/draft → ai_draft templates; never sends
GET /parent/explain/:topic → {meaning, why, what_you_can_do} from real numbers
```

### F6 · Fees / cases / exams reuse
```
ParentFees.tsx → /fees/obligations, /payments, /fees/receipts, /fees/installments,
                 payments.upi links, payments.razorpay orders (parent-scoped via student_accounts/child_link)
ParentComplaints.tsx → GET /my-cases, POST /cases
family.view academics/exams → plugin_exams.report (published only)
```

---

## 7 · UI surface map

Routed at `App.tsx:497-504`; nav at `Shell.tsx:216-226`.

| Route | Screen | Data source | Verdict |
|---|---|---|---|
| `/parent/family` | `parent/FamilyHome.tsx` | live: getParentHome/getBrief/getConsents/getAttendance/getAssignments/getExams | live; shape defects below |
| `/parent/consents` | `parent/Consents.tsx` | live getConsents/decideConsent | live |
| `/parent/requests` | `parent/Requests.tsx` | live getRequests/createRequest/reportDiscrepancy | live |
| `/parent/copilot` | `parent/Copilot.tsx` | live askCopilot/draftCopilotNote | live |
| `/parent/fees` | `ParentFees.tsx` | live fees doors | live |
| `/parent/complaints` | `ParentComplaints.tsx` | live /my-cases, /cases | live |
| `/parent` | `ParentHome.tsx` | **honest stub** | in nav as "Home" |
| `/parent/chat` | `ParentChat.tsx` | **honest stub** | in nav as "Messages" |

### 7.1 Honesty defects (silent placeholders, no invented numbers)

| ID | Sev | Defect | Evidence |
|---|---|---|---|
| PAR-HON-1 | P1 | Week brief always placeholder: client reads `brief.attendance_pct`/`headline`; server returns `{when,children,sentences,label}` | `FamilyHome.tsx:294-296` vs `parent.assistant:230-247` |
| PAR-HON-2 | P1 | Upcoming exams render blank: client reads `e.title`/`e.date`; server returns `{id,name,term,class_grade}` | `FamilyHome.tsx:225-226` vs `family.view:190-198` |
| PAR-HON-3 | P1 | Attendance `today` is a string server-side, an object client-side | `family.view:177` vs `parentApi.ts:93-100` |
| PAR-HON-4 | P1 | Consent child attribution lost: server `s.name AS child`; client expects `child_name`/`child_id` | `family.view:207` vs `parentApi.ts:112-113` |
| PAR-HON-5 | P2 | Child class blank: server `class_grade`; client reads `c.class` | `family.view:98` vs `FamilyHome.tsx:170` |
| PAR-HON-6 | P2 | Copilot budget never shown: server `budget:{used,cap}`; client reads `budget_left` | `parent.assistant:355` vs `parentApi.ts:153` |
| PAR-HON-7 | P2 | `ParentHome`/`ParentChat` stubs exposed as Home/Messages | `Shell.tsx:222,224` |

No fabricated/seed data found in parent screens (grep = 0). The defects are silent placeholders.

---

## 8 · Reuse-map reality (`PARENTOS-PLAN.md:12-14`)

| Claimed reuse | Wired? | Evidence |
|---|---|---|
| Complaints + tracking (`my-cases`) | YES | `ParentComplaints.tsx:28` → `GET /my-cases` (`routes.js:1839`) |
| Fees + UPI | YES | `ParentFees.tsx:167-170`; parent branches `routes.js:1147-1153,1244-1246,1459-1461` |
| DPDP consent | **NO — different thing** | `pack.dpdp` is DPO-only (`pack.dpdp/index.js:44,86,…`); `/parent/consents` is the separate family.view door |
| Chat | **NO** | `ParentChat.tsx:9-29` stub; `/communications` is staff-only (`routes.js:2646`) |
| Visitor pickup | **NO for parent** | all pickup doors `require(DESK)` (`ops.visitors/index.js:134,258,313`) |
| Reports (frozen) | PARTIAL | academics (no UI) + exams (shape-broken) |
| Absent alerts | **ABSENT** | grep: only seed copy `seed.js:646` |
| Homework digest | **ABSENT** | no parent/attendance digest builder |
| Child leave approvals | PARTIAL | filed `family.view:303`; office decides; approval notification-only |
| PTM | **NO parent UI** | `POST /ptm/book` parent-gated (`teacher.support:708`) but no wrapper/screen |
| Teacher fee-blindness | YES (pinned) | `door-gating-sec4-sec5.test.js:118-121` |
| Sibling separation | PARTIAL | cross-guardian negative pinned; no positive multi-child test |

---

## 9 · Test coverage

**`parent-family.test.js` (8):** home aggregation + no guardian PII; cross-guardian timeline 403;
teacher refused; consent immutable (409 + trigger); two child-leave requests → distinct actions;
request ticket append-only events; report-discrepancy; graceful degradation.

**`parent-assistant.test.js` (9):** brief shape + banned-word scan + deterministic label; bad
`when` 400; ask finds a filed request + budget row; 7 intents + honest unknown; draft both kinds
labelled + bad kind 400; explain from real numbers; P-copilot 100/month → 429; cross-guardian draft
403; teacher refused.

**Untested:** academics; exams; attendance leave math; child_link provisioning; request transitions;
consent authoring; leave approval write-back; the missing assignments door; all client DTO drift;
positive sibling separation; every UI.

---

## 10 · Gap register

| ID | Sev | Gap | Evidence |
|---|---|---|---|
| PAR-GAP-1 | P0 | Consent centre cannot be populated (no authoring door) | grep `INSERT INTO family.consent` = none |
| PAR-GAP-2 | P0 | Request status never advances (no transition door) | grep `UPDATE family.request` = none |
| PAR-GAP-3 | P1 | Assignments door absent while UI calls it | `parentApi.ts:169`; `FamilyHome.tsx:98` |
| PAR-GAP-4 | P1 | Child-leave approval informs nothing (no event, no attendance mark) | `routes.js:2105-2110`; `family.view:174-181` |
| PAR-GAP-5 | P1 | `family.child_link` no provisioning door | seed only `034:97-102` |
| PAR-GAP-6 | P1 | PS-1/PS-2 ↔ PU-1 contract drift (6 silent placeholders) | §7.1 |
| PAR-GAP-7 | P1 | Family home incomplete vs frozen (`actions[]`, `brief{}` absent) | `family.view:106` |
| PAR-GAP-8 | P1 | PTM booking has no parent UI | `teacher.support:708` |
| PAR-GAP-9 | P2 | Academics/timeline doors orphaned | 0 callers |
| PAR-GAP-10 | P2 | No FORCE RLS | `034:81-90`, `035:45-54` |
| PAR-GAP-11 | P2 | PU-2 flows absent (attendance+leave, exams+prep, report explain, documents, transport, events) | no `screens/parent/flows/` |
| PAR-GAP-12 | P2 | No absent alerts / homework digest | absent |
| PAR-GAP-13 | P2 | `/parent/complaints` capability maps to `GET /parent/requests` though screen uses `/my-cases`; `/parent/chat` maps to `/parent/brief` | `effective-access.js:111-112` |
| PAR-GAP-14 | P3 | `STAFF_OVERSIGHT` dead code | `family.view:24` |
| PAR-GAP-15 | P3 | report-discrepancy creates a family.request, not an `app.cases` case | `family.view:281-286` |

---

## 11 · Cross-cutting

- **Capability map** (`effective-access.js:107-114`): `/parent`,`/parent/family`→`GET /parent/home`;
  `/parent/consents`; `/parent/requests`; `/parent/complaints`→requests; `/parent/chat`→brief;
  `/parent/fees`→`GET /fees/obligations`; `/parent/copilot`→brief.
- **Permission matrix:** all 15 doors role-gated `parent`, 0 unguarded.
- **Parity:** reverse-parity `GET /parent/child/:id/assignments` (no door); query-vs-path
  `getExplain` (`parentApi.ts:165` vs `parent.assistant:429`); unused wrappers `getTimeline`,
  `getExplain`, `createLeaveRequest`, `initiateFeePayment`.
