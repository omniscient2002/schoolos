# ADMISSIONS DOMAIN — full-depth analysis

How every admissions datum enters SchoolOS, how it travels, where it is stored, and how
every role interacts with it — with worked examples for each role and each feature that
touches admissions.

Companion: `ADMISSIONS-PERFECT-100.md` (audit, scorecard, findings, build plan). This
file is the map; that file is the audit.

Truth rule: **code and migrations are the source of truth.** Where the docs disagree with
the code, the code is described here and the disagreement is called out.

---

## 0 · Verdict at a glance

Admissions in SchoolOS is a **plugin** (`admissions.funnel`, v1.3, class C, trust T1) plus
a **kernel-side enrollment executor** and a **kernel follow-up ranking service**, with two
front-end surfaces (a live server-backed board and a sample preview).

- **In:** staff capture an enquiry (`POST /plugins/admissions.funnel/leads`) or a student
  is created directly (`POST /students` / CSV import).
- **Through:** a DB- and server-enforced stage lattice
  (`enquiry → form → interaction → offer → waitlisted → enrolled`, side exits
  `rejected`/`withdrawn`); `offer/waitlisted → enrolled` raises a kernel approval action,
  never a plugin write to `app.students`. Visits/interviews are scheduled on
  `lead_activity`; documents attach from `files.store`; an offer letter is generated.
- **Out:** approval executes `executeStudentCreation` → `app.students` +
  `app.guardians` + `family.child_link` (phone-matched) + `app.enrollment_history` + event
  + audit. Offer/acceptance queue a guardian notice (queued, not sent).
- **Around it:** DPDP export/erasure, BI funnel, board pack, visitors/attendance/exams/
  library/UDISE/CBSE all key off `admission_no`.

The single most important design decision: **the funnel holds no SQL against
`app.students`.** Enrollment is a core-domain write, so it rides kernel approval
semantics (`app.actions`) and the kernel executes it.

---

## 1 · Purpose & principles

1. **PII confinement.** Applicant and guardian PII lives only in `plugin_admissions`
   (purgeable, tenant-isolated, DPDP-consumable). It is never copied into core tables
   except the guardian fields the student record legitimately needs.
2. **One server-side truth.** The stage lattice is enforced in `index.js`, not in the
   client. The client mirrors; the server decides.
3. **No core writes from a plugin.** Enrollment is raised as a kernel action.
4. **No money.** The funnel collects no fees; fees attach only after core enrollment
   exists (`payments.upi`/kernel lane).
5. **Auditable and evented.** Every door writes an audit row; every transition writes a
   `stage_history` row and an event.
6. **India-first semantics.** Apr–Mar session year on the IST clock; Feb–Jun admissions
   window; E.164 guardian phones.

---

## 2 · Roles & authority tiers

16 built-in roles (`server/src/auth.js:75`, mirrored in `app/src/types/domain.ts:13`):
`owner, principal, coordinator, counselor, finance, finance_head, finance_clerk,
admissions, transport, facilities, technician, teacher, itadmin, parent, student,
librarian`.

### 2.1 Admissions-relevant authority lists (exact code)

```js
// server/src/plugins/_shared/admissions-access.js — the ONE definition (imported by the plugin,
// the kernel follow-up queue and ops.bi). K6: the docs used to omit `admissions`; the code includes it.
const FULL_PII = ['owner', 'principal', 'itadmin', 'coordinator', 'admissions']; // full guardian contacts
const ADMIN    = ['owner', 'principal', 'itadmin', 'finance', 'coordinator', 'admissions']; // capture/move/summary
```

```js
// server/src/routes.js (follow-up queue) — imports the shared FULL_PII/ADMIN, so it cannot drift
const fullPii = FULL_PII.includes(req.user.role);
```

### 2.2 Tier table

| Tier | Roles | Capture | Move | Summary/History | Guardian name | Guardian phone |
|---|---|---|---|---|---|---|
| Funnel admin + full PII | owner, principal, itadmin, coordinator, **admissions** | ✅ | ✅ | ✅ | full | full E.164 |
| Funnel admin, masked | finance | ✅ | ✅ | ✅ | `null` | `98xxxx10` |
| Read-only, masked | teacher | ✗ | ✗ | ✗ | `null` | `98xxxx10` |
| Direct student create | owner, principal, coordinator, admissions | — | — | — | — | — |
| Approval decide | 12 staff roles incl. admissions | — | — | — | — | — |
| Denied | parent, student | ✗ | ✗ | ✗ | ✗ | ✗ |

### 2.3 The `admissions` role

The role named `admissions` is the named desk for this domain and now holds the funnel:
it is in both `ADMIN` (capture/move/history/summary/activities/documents/offer-letter)
and `FULL_PII` (unmasked guardian contacts), alongside `POST /students`, the action
board, events, the follow-up queue and the timetable grid. The generated
`docs/role-matrices/admissions.txt` and `PERMISSION-MATRIX.md` agree with the code.

There is no role-mapping layer: front-end and server role strings are identical 1:1
(`app/src/lib/roles.ts:27-30`; unknown roles fail closed to `student`).

---

## 3 · Plugins & schemas

| Plugin | Class | Trust | Relationship to admissions |
|---|---|---|---|
| `admissions.funnel` | C | T1 | the domain itself |
| `pack.dpdp` | — | — | **declared dependency** (018:52); exports/erases lead PII |
| `people.admin` | B | T1 | roster/identity; CSV import; `enrollment_history`; transfer/promote/withdraw |
| `ops.bi` | — | — | funnel read model (`core_refs: plugin_admissions.lead.id`) |
| `ops.import` | — | — | imports `admission_no` |
| `ops.visitors` | — | — | guardian lookup by `admission_no` |
| `ops.udise`, `pack.cbse` | — | — | statutory enrollment exports |
| `family.view`, `parent.assistant` | — | — | parent's view of the converted student |
| `library`, `exams.assessment`, `teacher.classroom` | — | — | read `admission_no` |
| `comms.whatsapp`, `rails.*` | — | — | delivery rails (no direct admissions caller) |

Schema `plugin_admissions` is owned by the plugin; its data plane is created in 018 and
amended in 022/027/049/074/106.

---

## 4 · Data model

### 4.1 `plugin_admissions.lead` (018:16-29, amended 022/027)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `tenant_id` | uuid NOT NULL FK `app.tenants` | RLS key |
| `student_name` | text NOT NULL | truncated to 120 at the door (`index.js:107`) |
| `guardian_name` | text | nullable; truncated to 120 |
| `guardian_phone` | text NOT NULL | normalized to E.164 `+91…` at the door |
| `class_applied` | text NOT NULL | e.g. `6` or `6-A`; truncated to 40 |
| `source` | text NOT NULL DEFAULT `'walk-in'` | truncated to 40 |
| `stage` | text NOT NULL DEFAULT `'enquiry'` (022:32) | CHECK-constrained to the lattice (119) |
| `admission_year` | text NOT NULL DEFAULT `''` | session key, `^\d{4}-\d{2}$` or `''` (119) |
| `documents` | jsonb NOT NULL DEFAULT `[]` | attached `files.store` ids (119) |
| `notes` | jsonb NOT NULL DEFAULT `{}` | freeform |
| `created_by` | uuid FK `app.users` | |
| `created_at`/`updated_at` | timestamptz | `updated_at` bumped on every stage move |

**Indexes / constraints**
- `lead_tenant_stage` on `(tenant_id, stage)` (018:39).
- `lead_unique_open_enquiry` UNIQUE on
  `(tenant_id, guardian_phone, class_applied, admission_year)`
  **WHERE stage IN ('enquiry','form','interaction','offer','waitlisted')** (119:34-38) —
  the duplicate-enquiry guard, race-safe.
- `lead_stage_valid` CHECK on `stage`; `lead_admission_year_shape`; `lead_documents_array` (119).
- RLS `ENABLE`+`FORCE` with `tenant_isolation` (049:25-26), predicate rewritten to
  `app.current_tenant()::uuid` (074).

### 4.2 `plugin_admissions.stage_history` (018:30-38)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid NOT NULL | |
| `lead_id` | uuid NOT NULL FK lead `ON DELETE CASCADE` | |
| `from_stage` | text | NULL for the first row (enquiry) |
| `to_stage` | text NOT NULL | |
| `actor` | text NOT NULL | `req.user.email` |
| `at` | timestamptz DEFAULT now() | |

Index `admissions_stage_history_tenant_lead_at_idx` (106:36-37). RLS per 049/074.
`stage_history_to_valid` / `stage_history_from_valid` CHECK the lattice (119).

### 4.2b `plugin_admissions.lead_activity` (119)

Visit / interview / call / note scheduling and outcomes.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid NOT NULL FK tenants | RLS key |
| `lead_id` | uuid NOT NULL FK lead `ON DELETE CASCADE` | |
| `kind` | text CHECK `visit\|interview\|call\|note` | |
| `scheduled_at`/`completed_at` | timestamptz | |
| `outcome`/`notes` | text | |
| `actor` | text | `req.user.email` |
| `created_at` | timestamptz | |

Index `lead_activity_tenant_lead`; RLS `tenant_isolation` (119 §5).

### 4.3 Core tables written by the conversion executor

| Table | What the executor writes | Source |
|---|---|---|
| `app.students` | `admission_no='ADM-<ay>-<lead8>'` (fallback full uuid), `name`, `grade`, `section`, guardian fields, `status='active'`, `source='admissions'`, `source_ref=leadId` | `routes.js:2460-2476` |
| `app.guardians` | `name`, `phone`, `relation='guardian'`, `is_primary=true` — only if both name and phone exist on the lead | `routes.js:2479-2482` |
| `family.child_link` | link an existing `parent` account whose stored E.164 phone equals the lead's guardian phone (structural match, never name-equality) | `routes.js:2566-2580` |
| `app.enrollment_history` | one row `from=to=<grade/section>`, `reason='admission via <action code> — funnel conversion'` | `routes.js:2483-2486` |
| `app.actions` | the raised approval | `index.js:182-193` |
| `app.events`/`app.outbox` | `admission.*` + `people` | `emitEvent` |
| `app.audit_log` | capture/list/transition/conversion rows | `requestAudit`/`auditLog` |

`app.enrollment_history` is **append-only** for the app role (SELECT/INSERT only,
046:48) and RLS-protected (046:39-45).

### 4.4 Grants

```sql
GRANT USAGE ON SCHEMA plugin_admissions TO schoolos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA plugin_admissions TO schoolos_app;
```
(018:43-44). Request paths run as `schoolos_app` with `schoolos.tenant_id` set by
`withUser`; the migration owner role has `BYPASSRLS`.

---

## 5 · Door inventory

### 5.1 Plugin doors — `server/src/plugins/admissions.funnel/index.js`

| # | Method | Path | Gate | What it does |
|---|---|---|---|---|
| 1 | POST | `/plugins/admissions.funnel/leads` | `require(...ADMIN)` + `lifecycleGate` | capture enquiry |
| 2 | GET | `/plugins/admissions.funnel/leads` | `require(...ADMIN,'teacher')` + gate | list, role-tiered PII, `capped` |
| 3 | PATCH | `/plugins/admissions.funnel/leads/:id` | `require(...ADMIN)` + `uuidParams` + gate | correct a lead (session immutable) |
| 4 | POST | `/plugins/admissions.funnel/leads/:id/stage` | `require(...ADMIN)` + `uuidParams` + gate | lattice move; queues guardian notice |
| 5 | POST | `/plugins/admissions.funnel/leads/:id/activities` | `require(...ADMIN)` + `uuidParams` + gate | schedule/log visit/interview/call/note |
| 6 | GET | `/plugins/admissions.funnel/leads/:id/activities` | `require(...ADMIN,'teacher')` + gate | activity trail |
| 7 | POST | `/plugins/admissions.funnel/leads/:id/documents` | `require(...ADMIN)` + `uuidParams` + gate | attach a `files.store` id |
| 8 | GET | `/plugins/admissions.funnel/leads/:id/offer-letter` | `require(...ADMIN)` + `uuidParams` + gate | generated offer letter |
| 9 | GET | `/plugins/admissions.funnel/leads/:id/history` | `require(...ADMIN)` + `uuidParams` + gate | transition trail |
| 10 | GET | `/plugins/admissions.funnel/summary` | `require(...ADMIN)` + gate | stage counts |
| 11 | GET | `/plugins/admissions.funnel/health` | owner/principal/itadmin + gate | lattice probe + orphan reconciliation |
| 12 | POST | `/plugins/admissions.funnel/sla/run` | owner/principal/itadmin + gate | escalate stuck leads (once/day) |

### 5.2 Kernel doors that touch admissions

| Method | Path | Roles | File |
|---|---|---|---|
| POST | `/students` | owner, principal, coordinator, admissions | `routes.js:614` |
| GET | `/students` | `me` (staff; parent scoped by `family.child_link`) | `routes.js:554` |
| GET | `/admissions/followups` | owner, principal, itadmin, finance, finance_head, finance_clerk, coordinator, teacher | `routes.js:3188` |
| GET | `/actions` | 12 staff roles | `routes.js:1989` |
| POST | `/actions/:id/decide` | 12 staff roles | `routes.js:2506` |
| POST | `/plugins/:id/enable` | owner, principal, itadmin | `routes.js:3479` |
| POST | `/plugins/:id/disable` | owner, principal, itadmin | `routes.js:3553` |
| POST | `/plugins/:id/settings` | owner, principal, itadmin | `routes.js:3585` |

### 5.3 Plugin lifecycle & settings

- **Enable** resolves the on-disk manifest (never the client body), checks entitlement
  (402), kernel compat (409), and dependencies (409 if `pack.dpdp` is off)
  (`routes.js:3485-3519`), then writes `status='enabled'` and the granted permissions.
- **Disable** drains open actions raised by `source_plugin='admissions.funnel'` back to
  the principal desk (`routes.js:3563-3573`); the lifecycle gate then 409s every door
  with `"Admissions is switched off — ask the school owner to turn it on"`
  (`_shared/lifecycle-gate.js`).
- **Settings** validates against the manifest `settingsSchema` and persists the
  normalized form; the audit records **changed key names, never values**
  (`routes.js:3602-3628`).

---

## 6 · Data travel — end-to-end flows

### F1 · Capture an enquiry

```
FunnelBoard / API
  └─ POST /plugins/admissions.funnel/leads
       body: { studentName, guardianName, guardianPhone, classApplied, source?, admissionYear? }
  1. auth (JWT → req.user) + require(ADMIN) + lifecycleGate
  2. shape checks: studentName, guardianPhone, classApplied required; phone regex ^[\d+\-\s()]{6,15}$
     admissionYear format ^\d{4}-\d{2}$ if supplied          index.js:64-72
  3. normPhone → +91XXXXXXXXXX                               index.js:36-42,73
  4. settings: admission_year, cycle_start/cycle_end          index.js:76-82
     - non-current session and role ∉ {owner,itadmin} → 403  index.js:80-82
     - outside window → 409 "Admissions are open from Feb 1 to Jun 30"  index.js:83-91
  5. duplicate guard (guardian, class, session, open stage) → 409 + existing leadId
                                                              index.js:94-98
  6. SAVEPOINT insert; 23505 → ROLLBACK TO SAVEPOINT → 409   index.js:99-120
  7. stage_history (NULL → enquiry, actor=email)              index.js:122-123
  8. emit admission.enquiry.captured                          index.js:124-126
  9. audit "admission enquiry captured"                       index.js:127-130
  └─ 200 { ok, leadId, stage:'enquiry', admissionYear }
```

### F2 · List leads (PII tiers)

```
GET /plugins/admissions.funnel/leads?stage=offer
  masked = !FULL_PII.includes(role)          index.js:137
  SELECT ... LIMIT 200 ORDER BY created_at DESC  index.js:140-143
  audit "admission leads listed (masked|full PII)"  index.js:144-147
  guardianName  = masked ? null : value
  guardianPhone = masked ? maskPhone(value) : value   // 98xxxx10
  admissionYear = notes->>'admission_year'            index.js:150-155
```

### F3 · Move a stage (the lattice)

```
POST /plugins/admissions.funnel/leads/:id/stage { to }
  1. to ∈ STAGES else 400                       index.js:163
  2. SELECT ... FOR UPDATE                       index.js:165-166
  3. terminal? → 409 "closed ... can't be changed"  index.js:168
  4. NEXT[cur.stage] must include to → else 409  index.js:169-171
  5. if offer → enrolled:
       INSERT app.actions code='students.create.<leadId>', kind='approval',
         owner_role='principal', source_event='admission.offer.accepted',
         payload={leadId, studentName, classApplied, guardianName, guardianPhone, admissionYear},
         source_plugin='admissions.funnel'        index.js:177-193
  6. UPDATE lead.stage, updated_at=now()          index.js:195-196
  7. INSERT stage_history (from→to, actor)        index.js:197-198
  8. emit admission.stage.transitioned            index.js:199-201
  9. if actionId: emit admission.offer.accepted   index.js:202-206
 10. audit "admission stage transitioned"         index.js:207-210
```

Lattice (`_shared/admissions-access.js`):
```
enquiry → form → interaction → offer → enrolled
   ↓        ↓         ↓          ↓       ↑
rejected  rejected  rejected   rejected  │
withdrawn withdrawn withdrawn  withdrawn │
                              offer → waitlisted → enrolled
```
`TERMINAL = {enrolled, rejected, withdrawn}` — no move out; `waitlisted` is a holding
state off `offer` that can still convert. The DB CHECK constraints (119) enforce the same
set, so even a direct SQL writer cannot invent a stage.

### F4 · Convert to a student (approval + executor)

```
Principal/owner: POST /actions/:id/decide { decision:'approved' }
  - FOR UPDATE action; 404/409                         routes.js:2515-2517
  - authority: owner_role match | owner override | principal (non-finance, non-owner)
                                                        routes.js:2538-2541
  - delegation window (never finance/owner)             routes.js:2546-2556
  - unattributed raise guard: principal cannot self-approve an
    admission.offer.accepted raise → owner must        routes.js:2558-2576
  - status flip approved                                 routes.js:2581-2582
  - dispatch: code startsWith 'students.create.' && payload.leadId
                                                        routes.js:2672-2677
executeStudentCreation(c, req, a, p):                   routes.js:2445-2504
  - SELECT lead FOR UPDATE                               routes.js:2446-2448
  - idempotency: existing (source='admissions', source_ref=leadId) → return
                                                        routes.js:2450-2453
  - require stage='enrolled' else 409 "conversion stale" routes.js:2454
  - parseClassApplied(class_applied) → {grade, section}  routes.js:2441-2444,2455
  - admission_no = ADM-<ay>-<lead8>; SAVEPOINT fallback to full uuid
                                                        routes.js:2456-2477
  - INSERT app.students (source='admissions')            routes.js:2460-2476
  - INSERT app.guardians (if name+phone)                 routes.js:2479-2482
  - link an existing parent account by E.164 phone match (family.child_link)
                                                         routes.js:2566-2580
  - INSERT app.enrollment_history                        routes.js:2582-2585
  - emit people "Student created from admissions"        routes.js:2487
  - audit "Student created from admissions lead …" policyRef 'Admissions §3'
                                                        routes.js:2494-2502
```

### F5 · Follow-up queue (deterministic, no model)

```
GET /admissions/followups    roleGatedMe(owner,principal,itadmin,finance,
                               finance_head,finance_clerk,coordinator,teacher)
  SELECT open leads ORDER BY updated_at ASC LIMIT 500   routes.js:3191-3197
  score = days_in_stage × weight                        routes.js
  stuck = days > 7; stuck first, then score desc
  guardianName/Phone masked unless fullPii              routes.js
  audit "Listed admissions follow-up queue"             routes.js
  ruleVersion 'followups-1'
```
Weights and the closed-stage filter come from `_shared/admissions-access.js`
(`enquiry 1, form 1.2, interaction 1.5, offer 2.5, waitlisted 2`; `CLOSED_STAGES =
enrolled/rejected/withdrawn`), so the queue ranks the live lattice. Pinned by
`wave5-kernel.test.js`.

### F6 · Direct student creation (no lead)

```
POST /students { name, grade, section, admissionNo?, guardianName?, guardianPhone?, busRoute? }
  require(owner, principal, coordinator, admissions)    routes.js:614
  admission_no = body.admissionNo ?? ADM-<base36(now)> routes.js:618
  INSERT app.students source='staff'                    routes.js:619-622
  audit "Created student" + emit people "Student enrolled"  routes.js:623-624
```
This is the **non-funnel** path (walk-in data entry / migration). It does not create a
lead or an `enrollment_history` row (unlike the executor).

### F7 · CSV roster import

```
POST /plugins/people.admin/import/students { csv } | multipart field 'csv'
  require(owner, principal, coordinator, admissions) + lifecycleGate  people.admin:543
  per-row SAVEPOINT; in-file admission_no dedupe (first wins);
  DB UNIQUE(tenant, admission_no) 23505 fails only that row; 500-row / 2MB caps
  one audit row + one import event for the batch
```

### F8 · Student lifecycle after admission

| Action | Door | Writes |
|---|---|---|
| Transfer class/section | `POST /plugins/people.admin/students/:id/transfer` | `enrollment_history` + flip `app.students` (one tx) |
| Promote grade+1 | `POST .../students/:id/promote` | `enrollment_history` + flip |
| Withdraw | `POST .../students/:id/withdraw` | `status='transferred'`, bus unassigned, history kept |
| Edit core fields | `PATCH .../students/:id` | identity/status/provenance immutable |

### F9 · DPDP export / erasure of a guardian

```
POST /plugins/pack.dpdp/dsr { kind:'export'|'erasure', subjectRef:<phone> }
  raises a kernel action; on approval+execute:
  export: bundle includes plugin_admissions.lead rows WHERE guardian_phone=subject_ref
          (pack.dpdp/index.js:206-212)
  erasure: UPDATE lead SET guardian_name=NULL, guardian_phone='[erased:<id>]'
          (pack.dpdp/index.js:217-219)
```

### F10 · BI / board pack

```
GET /plugins/ops.bi/funnel  → stage counts + transitions + avg days in stage
                              order = FORWARD + CLOSED_STAGES (shared lattice)
                              returns enrolled/rejected/withdrawn/waitlisted
                              (ops.bi/index.js)
Board pack: admissions_open_leads count (routes.js)
```

### F11 · Scheduling, documents, offer letter, health, SLA and guardian comms (v1.3)

```
POST .../leads/:id/activities { kind, scheduledAt?, outcome?, notes?, completed? }
  → plugin_admissions.lead_activity row + admission.<kind>.logged event + audit
GET  .../leads/:id/activities → the activity trail

POST .../leads/:id/documents { fileId, label? }
  → appends { fileId, label, attachedAt, by } to lead.documents + audit
  (the file itself lives in files.store; the funnel stores only the id)

GET  .../leads/:id/offer-letter
  → only when stage ∈ {offer, waitlisted, enrolled}; renders a deterministic letter
    from the lead + tenant name; nothing is stored; audited

GET  .../health   (owner/principal/itadmin)
  → { healthy, probe:'stage-lattice', stages{count,oldestDays}, openLeads,
      stuckOver7d, orphans{ strandedEnrolled[], danglingActions[] } }
  strandedEnrolled = enrolled lead with no student AND no open students.create action
  danglingActions  = open students.create action whose lead is not enrolled

POST .../sla/run  (owner/principal/itadmin)
  → scans open leads with updated_at < now()-7d; one notification per lead per day
    + admission.followup.overdue event; idempotent by day; never mutates the lead

stage → offer | enrolled (guardian phone present, notify_guardians ≠ false)
  → INSERT app.communications (status 'queued', template ADMISSION_OFFER |
    ADMISSION_ACCEPTED, dedup_key admission.<stage>:<leadId>)
    The comms dispatcher owns delivery; no rail → drains honestly as failed.
```

---

## 7 · Field-level lineage (where each value comes from and goes)

| Field | Enters as | Stored | Leaves as | Consumers |
|---|---|---|---|---|
| `studentName` | capture body | `lead.student_name` | `students.name` (on conversion) | board, follow-ups, BI |
| `guardianName` | capture body | `lead.guardian_name` | `students.guardian_name`, `guardians.name` | full-PII list, roster (staff), DPDP export |
| `guardianPhone` | capture body (any format) | normalized `+91…` | `students.guardian_phone`, `guardians.phone` | full-PII list, follow-ups, DPDP key, visitors lookup |
| `classApplied` | capture body | `lead.class_applied` | parsed to `students.grade`+`section` | roster, BI |
| `source` | capture body / settings default | `lead.source` | — | board badges, BI |
| `admissionYear` | capture body / settings / IST default | `notes.admission_year` | action payload → `ADM-<ay>-…` | dedupe key, admission number |
| `stage` | default `enquiry` | `lead.stage` | board columns, summary | follow-ups, BI |
| `to` (transition) | move body | `lead.stage` + `stage_history` | events | audit, history drawer |
| `admission_no` | generated `ADM-<ay>-<lead8>` | `students.admission_no` | identity key | attendance, exams, library, UDISE, CBSE, visitors, receipts |

---

## 8 · Role-by-role interaction, with examples

### 8.1 Owner

**Powers:** enable/disable/settings; full-PII funnel; decide any action (including
unattributed admission raises); `POST /students`.

- *Example — open the season:* owner enables `admissions.funnel` (dependency
  `pack.dpdp` must be on) and sets `{admission_year:'2027-28', cycle_start:'02-01',
  cycle_end:'06-30'}`. The settings door validates the pattern and audits the changed key
  names. Enquiries outside Feb 1–Jun 30 now 409.
- *Example — approve an enrollment the principal cannot:* the principal accepted an offer
  but raised it without an attributable proposer; the owner is the only one who can
  approve (`routes.js:2574-2575`).
- *Example — switch it off:* owner disables the plugin; any open `students.create` action
  is handed back to the principal desk; all funnel doors 409 with a friendly message.

### 8.2 Principal

**Powers:** full-PII funnel; approval owner for `students.create.<leadId>`; direct
student create; SoD-blocked from self-approving an unattributed admissions raise.

- *Example — approve a clean conversion:* office moved a lead `offer → enrolled`; the
  principal opens Action Center, sees "Admission offer accepted — create student record",
  approves; the executor creates the student `ADM-2026-27-AB12CD34`, guardian, enrollment
  history, event and audit.
- *Example — blocked self-approval:* the principal was the one who moved the lead to
  `enrolled` (principal is in the ADMIN set). Because the raise has no `proposed_by`, the
  principal is refused with "Ask the school owner to decide." (This is the audited
  exploit path T105d/OVR-4.)
- *Example — dismiss:* dismissing leaves the lead at `enrolled` and creates no student;
  the stage is **not** reverted (see §11).

### 8.3 Coordinator (the de-facto admissions office)

**Powers:** full-PII funnel capture/move/history/summary; transfer/promote/history;
import; direct student create.

- *Example — capture a walk-in:* coordinator enters `{studentName:'Ira', guardianName:
  'Rohit', guardianPhone:'98765 43210', classApplied:'6-A', source:'walk-in'}`. Phone
  normalizes to `+919876543210`; duplicate open enquiry for the same guardian/class/
  session returns 409 with the existing lead id.
- *Example — work the board:* moves `enquiry → form → interaction → offer`; each move
  appends history and emits `admission.stage.transitioned`.
- *Example — history check:* opens the history drawer: `— → Enquiry · s.kulkarni ·
  2h ago`, `Enquiry → Form · …`.
- *Example — transfer a converted student:* `POST .../students/:id/transfer` writes the
  `enrollment_history` row and flips the class in one transaction.

### 8.4 Finance

**Powers:** funnel capture/move/history/summary, but **masked PII**.

- *Example — record a fee-time enquiry:* finance captures a lead but sees
  `guardianPhone:'98xxxx10'` and `guardianName:null` on the list; enough to work the
  funnel, not enough to leak contacts. Fees remain a separate lane; the funnel has no
  money surface.

### 8.5 IT admin

**Powers:** enable/disable/settings; full-PII read; everything read-side.

- *Example — re-enable after a version bump:* the stored grant lacked `actions.raise`;
  the lifecycle gate returned 403 naming the missing permission. IT admin re-enables from
  the manifest, which records the manifest's declared set as the grant, and the door
  opens.

### 8.6 Teacher

**Powers:** masked read of the funnel + masked follow-up queue. No capture, no move.

- *Example — see a prospective student:* teacher sees `Aarav Mehta · Grade 6 · Referral`
  but `Guardian: Masked`. Cannot transition.

### 8.7 Admissions role

**Powers:** `POST /students`, action decide/read, events, timetable, safety box. **No
funnel door.**

- *Example — enroll directly:* admissions can `POST /students` for a walk-in, but cannot
  use the funnel board. The intended "admissions office" funnel work is held by
  owner/principal/coordinator/finance in code.

### 8.8 Parent

**Powers:** none in the funnel (403). After conversion, sees the child **only** if
`family.child_link` exists — which conversion does **not** create.

- *Example — parent after admission:* parent logs in and sees the child only once an
  admin links the account (`family.child_link`); otherwise the parent domain shows
  nothing.

### 8.9 Student

**Powers:** none in the funnel. Reads own records via `student.world` keyed on
`admission_no`.

### 8.10 DPO (DPDP)

**Powers:** SAR export/erasure through `pack.dpdp`, kernel-gated.

- *Example — guardian erasure:* DPO opens a SAR for `+919876543210`; on approval+execute
  the lead's `guardian_name` becomes `NULL` and `guardian_phone` becomes
  `[erased:<id>]`, while the decision trail survives.

### 8.11 API key / machine identity

**Powers:** whatever scopes the key holds; `requireRole` returns early for
`req.auth.via === 'api-key'` (`app.js:1343`). Machine identities never receive guardian
phones on roster reads (`routes.js:566`).

---

## 9 · Feature-by-feature connections

| Feature | How admissions connects | Evidence |
|---|---|---|
| **Fees / payments** | none at capture; fees attach after core enrollment. No money surface in the funnel. | `018:9-12`; `FEES-DESIGN.md:54` |
| **Comms (WhatsApp/SMS/email)** | no direct send; `admission.*` events reach the outbox and can be matched by workflow rules. | `DATA-FLOW.md:234` |
| **Students** | conversion creates the core student; `admission_no` becomes the identity key everywhere. | `routes.js:2460-2476` |
| **Parents / family** | executor creates `app.guardians`, **not** `family.child_link`. | `routes.js:2479-2482` |
| **Enrollment history** | conversion and transfer/promote append rows. | `046:24`; `people.admin:238-241,419` |
| **Attendance** | reads `admission_no` on register rows. | `Attendance.tsx:55,112,450` |
| **Exams** | roster keyed on `admission_no`; paste-import. | `ExamMarks.tsx` |
| **Library** | borrower search by `admission_no`. | `library/index.js:791-825` |
| **Visitors** | guardian lookup by `admission_no`. | `ops.visitors/index.js:81-108` |
| **UDISE / CBSE** | statutory enrollment exports from `admission_no`. | `ops.udise:52-123`; `pack.cbse:171-195` |
| **BI / board pack** | open-lead counts, funnel stage counts. | `routes.js:2091,2101`; `ops.bi:126-158` |
| **Audit** | every door + conversion. | `index.js:127,144,207`; `routes.js:2494` |
| **Events / outbox** | three `admission.*` topics + `people`. | `index.js:124,199,202`; `routes.js:2487` |
| **DPDP** | declared dependency; export/erasure of lead PII. | `pack.dpdp:206-219` |
| **Approvals / SoD** | `students.create.<leadId>` + unattributed guard. | `routes.js:2558-2576` |
| **Lifecycle / entitlement** | per-door 409 when off; plan 402 when unentitled. | `lifecycle-gate.js` |
| **Audit integrity** | registration/upgrade hash-chained ledger entries. | `018:73-102`; `022:45-74` |

---

## 10 · UI surface map

| Route | Screen | Live? | Notes |
|---|---|---|---|
| `/admissions` | `FunnelBoard` (if plugin enabled) else `Admissions` (demo) | mixed | switch in `App.tsx:401-407` |
| `/operations` | tile + open-lead count | live | `Operations.tsx:120-172` |
| `/boardpack` | `admissions_open_leads` | live | `BoardPack.tsx:62,80` |
| `/reports` | ops.bi funnel | live (stale order) | `Reports.tsx:152-208` |
| `/people` | enroll-a-student, roster | live | `People.tsx:60-171` |
| `/people-admin` | import, history, withdraw | live | `PeopleAdmin.tsx:399-423` |
| `/migration` | admission-number uniqueness | live | `Migration.tsx:242` |
| `/today` | admissions role briefing | live | `Today.tsx:146,556` |

`FunnelBoard` (`app/src/screens/FunnelBoard.tsx`) is the server-truth surface: it fetches
leads/summary/history/health, captures and edits leads (drawers), schedules visits and
interviews, shows the offer letter, mirrors the lattice for display, refetches after
every move, and shows the masked-vs-full copy from the server's `masked` flag.
`Admissions.tsx` is a clearly-labelled **sample preview** (shown while the plugin is off)
that renders the same server lattice via a legacy→new normaliser; it makes no money or AI
claim.

---

## 11 · Edge cases, failure modes & corrections

| Situation | Behaviour | Evidence |
|---|---|---|
| Duplicate open enquiry (same guardian/class/session) | 409 + existing `leadId` | `index.js:94-98`; test 3 |
| Two offices race the same walk-in | partial unique index → loser gets 23505 → SAVEPOINT rollback → 409 | `index.js:99-120`; test cycle5 |
| Move to an unknown stage | 400 | test 4 |
| Skip a stage (`enquiry → offer`) | 409 | test 4 |
| Move a terminal lead | 409 "closed … can't be changed" | test 6, 8 |
| Capture outside the window | 409 "Admissions are open from Feb 1 to Jun 30" | test 7 |
| Non-current session by a non-owner | 403 | `index.js:80-82`; cycle6 |
| Guardian phone spaced/dashed/compact | one guardian after E.164 normalization | `index.js:36-42`; cycle5 |
| Second conversion of the same lead | action code is per-lead; a replay returns the existing student | `routes.js:2450-2453`; executor test |
| Approve after the lead is no longer `enrolled` | 409 "conversion stale" | `routes.js:2454` |
| Principal self-approves an unattributed admissions raise | 403, owner must decide | `routes.js:2574-2575` |
| Double decision on one action | 409 "action already approved" | `routes.js:2517` |
| Dismiss an enrollment action | no student created; **lead stays `enrolled`** — stage not reverted | `routes.js:2584-2672` |
| Plugin disabled mid-flight | open actions drain to principal; all doors 409 | `routes.js:3563-3573` |
| Guardian erased then a new enquiry | erased phone `[erased:…]` is not a valid E.164 input; index collision risk (A-4) | `pack.dpdp:218` |
| Free-text `class_applied` like `"Grade 6"` | parsed to `grade='Grade 6'`, `section='A'` — not a real class | `routes.js:2441-2444` (B-4) |
| Parent after conversion | no access until `family.child_link` is created manually | `routes.js:2479-2482` (E-7) |

**Correction / who can fix what**
- A wrong phone/name on a lead: **no door** — needs SQL (E-2).
- A wrong class on a lead: **no door** — needs SQL.
- A student created from a bad lead: `PATCH /plugins/people.admin/students/:id` for core
  fields (identity/status/provenance immutable); class via transfer.
- A wrong student: withdraw (status → transferred) then re-admit (fresh record) — the
  system says so explicitly (`people.admin:378-379`).

---

## 12 · Events, workers & delivery

| Event | Emitted at | Consumer |
|---|---|---|
| `admission.enquiry.captured` | capture door | default workflow rule → `admission.followup.scheduled` |
| `admission.stage.transitioned` | stage door | outbox relay; action lineage |
| `admission.offer.accepted` | stage door | outbox relay; action lineage |
| `admission.visit/interview/call/note.logged` | activities door | outbox relay |
| `admission.followup.overdue` | SLA sweep | outbox relay; notification raised |
| `people` "Student created from admissions" | executor | outbox relay |
| `people.student.transferred/promoted/withdrawn` | people.admin | outbox relay |

`emitEvent` writes an `app.events` row and an `app.outbox` row atomically
(`audit.js`). The `outbox-worker` relays; the `workflow-worker` matches rules on these topics.
**K7 update:** migration `123_admissions_followup_rule.sql` now seeds a **default follow-up workflow
rule** per tenant (an editable pipeline artifact — it does NOT auto-message a guardian), and the
follow-up SLA sweep raises `admission.followup.overdue` + a notification for overdue leads. There is
still **no** automatic guardian message on stage moves (guardian notices stay approval-gated through
the kernel action spine). The former "no default rule ships / no SLA escalation" text was pre-123.

---

## 13 · Test coverage

| Suite | Covers |
|---|---|
| `admissions-v13.test.js` | admissions role reaches the funnel; edit + class normalisation; waitlist lattice; scheduling + documents; offer letter; guardian notice; health/reconcile; SLA sweep; default workflow rule |
| `admissions.test.js` | lifecycle gate; capture+history; dedupe; lattice; offer→action + core delta 0 + events; terminal/PII tiers/parent denial; session window; summary/withdrawn/registry |
| `admissions-executor.test.js` | approve→student+guardian+history+audit; double-approve 409; SoD; per-instance second conversion |
| `cycle5-remediation.test.js` | second conversion, dedupe race, spaced/compact phone, admissionYear |
| `cycle6-hardening.test.js` | uuid guard, DPDP phone |
| `dpdp.test.js`, `l2-dpdp-erasure.test.js` | consent `admissions_enquiry`, SAR export/erasure |
| `wave5-kernel.test.js` | follow-ups ranking, masking, RTE-3 |
| `wave-c.test.js` | RLS cross-tenant |
| `wave-b.test.js`, `import-engine.test.js` | transfer history, CSV dedupe |
| `students-lifecycle.test.js` | `admission_no` immutable |
| `bi-readmodels.test.js` | ops.bi funnel |
| `sec6-settings-contract.test.js` | session-window settings |
| `owner-principal.test.js`, `l1-security-sprint.test.js` | source_plugin; self-approve path |

---

## 14 · Gap register (domain view) — all closed in v1.3

| ID | Gap | Resolution |
|---|---|---|
| D-1/E-1 | no create-lead client | `apiCreateFunnelLead` + capture drawer |
| D-2/D-3 | follow-ups + BI use the old lattice | both import `_shared/admissions-access.js` |
| C-1/J-2 | `admissions` role excluded from the funnel | added to `ADMIN`/`FULL_PII` |
| E-7 | `family.child_link` not created at conversion | executor phone-matches a parent account |
| E-2 | no enquiry edit door | `PATCH .../leads/:id` |
| E-3 | no document upload | `POST .../leads/:id/documents` (files.store ids) |
| E-4 | no visit/interview scheduling | `lead_activity` + activities doors |
| F-1..F-4 | no delivery loop / SLA / comms | migration 123, `/sla/run`, queued notices |
| B-1/B-2 | no DB CHECK on stages | migration 119 CHECK constraints |
| B-4 | free-text class parsing | parser strips `Grade`/`Class` |
| A-4 | erased-phone index collision | dedupe on `admission_year` column; DPDP tests |
| E-5/E-6 | no offer letter, no waitlist | `offer-letter` door; `waitlisted` stage |
| A-1/A-2 | duplicated PII list / mask helper | shared module + `maskPhone` in `phone.js` |
| H-1/H-2/H-3 | no health probe / reconciliation / replay test | `GET .../health`; DPDP replay suites |

Full detail and build batches: `ADMISSIONS-PERFECT-100.md`.

---

## 15 · Cross-cutting concerns

- **Tenancy.** Every row carries `tenant_id`; RLS `FORCE`d with a
  `current_setting('schoolos.tenant_id')` policy rewritten to `app.current_tenant()`;
  `withUser` sets the GUC and `SET LOCAL ROLE schoolos_app`. A cross-tenant read is
  structurally impossible (`wave-c.test.js`).
- **PII.** Full contacts only for `owner/principal/itadmin/coordinator`; teacher/finance
  masked. Lead PII is purgeable and DPDP-consumable. Machine identities never get phones.
- **Time.** Session year and windows are computed on the IST clock (`index.js:43-51`);
  withdrawal effective date defaults to IST (`people.admin:353-354`).
- **Concurrency.** `FOR UPDATE` on lead and action; partial unique index for dedupe;
  SAVEPOINT + 23505 mapping for races and admission-number collisions.
- **Idempotency.** Conversion is idempotent three ways (decide 409, unique action code,
  `source_ref` lookup). SAR erasure is journal-backed.
- **Audit & events.** Every door writes an audit row; every transition writes a
  `stage_history` row and an event. Registration/upgrade rows are hash-chained.
- **Honesty.** The sample preview is clearly labelled and makes no money or AI claim; the
  live board refetches from the server rather than optimistically patching; the follow-up
  ranking is a documented deterministic rule, not a model; the SLA sweep and the comms
  queue record what actually happened (a queued notice is never claimed as sent).
