# The Admissions Domain Story — one season at Sunrise Public School

> **What this document is.** A plain-language walkthrough of how a child gets from
> a parent's first phone call to a seat in a classroom in SchoolOS — every screen,
> every rule, every edge case, straight from the current code
> (`server/src/plugins/admissions.funnel/`, the kernel doors in
> `server/src/routes.js`, migrations `018 → 152`, and the
> `FunnelBoard` / `RteManager` screens). It follows one school through one Indian
> admissions season (February–June) and names what happens at each step, why it
> works that way, and what would go wrong without it.
>
> **How to read it.** Part 0 is the one big idea. Parts 1–10 follow the season.
> Boxes marked **"In plain words"** translate jargon; **"Edge case"** boxes are the
> things that break real admissions desks and exactly what the code does about
> them. Every door below is a real endpoint; every table is a real table.
>
> The exact schema and tests live beside this: `docs/FEES-STORY.md` is the sibling
> for money, and `tests/admissions*.test.js` + `tests/admissions-fixes.test.js`
> pin the behaviour described here.

**Cast of characters**

| Who | Role | What they care about |
|---|---|---|
| **Ravi** | Owner | The school stays compliant and nobody games the funnel |
| **Meera** | Principal | Every admitted child belongs; no over-admission |
| **Arjun** | IT admin | The pipeline runs itself and the audit trail is real |
| **Sneha** | Admissions officer | Capturing enquiries fast and never losing a lead |
| **Rahul** | Coordinator | The daily follow-up queue is honest |
| **Rao-ma'am** | Finance head | RTE reimbursement money is tracked; fee capture stays masked |
| **Kavita** | Parent | Her call is answered and her child's privacy is respected |
| **Aarav** | Applicant, later Grade 6-A | A seat, fairly |
| **Imran** | RTE-quota child | His statutory 25% seat and fee waiver |

---

## Part 0 — The one big idea

**The funnel is not a form. It is a one-way street with gates, and the last gate
is a second pair of eyes.**

A stranger becomes a **lead**. The lead walks an enforced path — `enquiry → form →
interaction → offer → enrolled` — with a `waitlisted` holding pen off the offer
and two side exits, `rejected` and `withdrawn`. The funnel plugin may talk to the
lead, move them, schedule them, even generate their offer letter. But it may
**never write a core student record**. When an offer is accepted, the funnel
raises a **proposal** (`students.create.<leadId>`, an `app.actions` row owned by
the principal), and only an approval by an authority *other than the proposer*
executes the creation of the `app.students` row.

> **In plain words:** the admissions desk can decide who *should* join the school,
> but a second, independent hand writes the child into the register. That is the
> difference between a sales pipeline and a school.

Three laws, one breath each:

1. **Stages are law, not decoration.** The lattice lives in JavaScript
   (`_shared/admissions-access.js`) *and* in database CHECK constraints
   (migration 119). An illegal jump is a 409; a closed lead is immutable.
2. **PII stays in the funnel's own schema** (`plugin_admissions`), which is
   purgeable. Teachers and finance see masked contacts; only the admissions office
   and governance see the number.
3. **The funnel never moves money.** Fees begin only after a core student exists;
   admissions never touches a fee row.

---

## Part 1 — February, week 0: switching the funnel on

Sunrise's staff already have accounts. The funnel arrives **registered but
disabled** (migration 018 provisions the schema, the registry row, and the
capability contract as `registered`, never `enabled`). Until the owner enables it,
every door answers the same honest refusal: *"this module is switched off."*

Ravi, the owner, enables `admissions.funnel` from **Modules → Admissions Funnel**
(`POST /plugins/admissions.funnel/enable`). That action is audited; the module's
lifecycle gate now passes for every door.

He then sets the season's policy on the same settings screen
(`POST /plugins/admissions.funnel/settings`). Every value is validated against the
module's declared schema (SEC-6):

| Setting | Meaning | Default |
|---|---|---|
| `admission_year` | the session every lead is stamped with (`2026-27`) | current Apr–Mar cycle |
| `cycle_start` / `cycle_end` | the window capture is open (`MM-DD`, e.g. `02-01`→`06-30`) | Feb 1 – Jun 30 |
| `default_source` | the fallback channel when none is given | `walk-in` |
| `sources` | the school's channel catalogue (walk-in, referral, website, phone…); empty = accept any | empty (free text) |
| `class_capacity` | seats per grade; `0` = unlimited | `0` |
| `age_bands` | min/max age per grade, e.g. `{"1":{"min":5,"max":7}}` | empty (no check) |
| `notify_guardians` | queue a WhatsApp on offer and acceptance | `true` |

> **Edge case.** An old build accepted an `enrollment_term` setting and then read
> it nowhere — a knob that lied. It is now *removed from the schema*, so a payload
> carrying it is rejected (400) rather than silently stored. Decorative settings
> are bugs; this one is gone.

---

## Part 2 — February: the first enquiry

Kavita calls. Sneha opens **Admissions → New enquiry** (`FunnelBoard`) and types
the child's name, her name, her phone, and the class. The door
(`POST /plugins/admissions.funnel/leads`) checks, in order:

- **Presence** — name, guardian phone, class. Anything missing is a 400.
- **Phone shape** — normalized to E.164 (`toE164`): `9876543210`, `098765…`, and
  `919876…` all become `+919876543210`. A number that cannot be an E.164 number is
  refused here, where the office can fix it.
- **Optional date of birth** — if given, validated once and stored on the lead
  (used later for age eligibility, Part 5).
- **Session** — the year must be a valid `YYYY-YY`; a *non-current* session may only
  be recorded by the owner or IT admin (403 otherwise).
- **Window** — if the cycle window is set and today falls outside it, capture is
  refused (409) with the dates in plain language: *"Admissions are open from Feb 1
  to Jun 30."* (The clock is IST — Part 10.)
- **Source** — if the school configured a `sources` catalogue, the channel must be
  one of them (400 naming them); otherwise any string is accepted.
- **Duplicate guard** — one *open* enquiry per `(guardian phone, class, session)`.
  A second call for the same child is answered `409` **carrying the existing
  lead's id**, so the desk is recovered by re-opening the first lead, not creating
  a twin.

The insert is wrapped in a SAVEPOINT, because two officers can pass the duplicate
check at the same instant. A database **partial unique index**
(`lead_unique_open_enquiry … WHERE stage IN (enquiry,form,interaction,offer,
waitlisted)`) makes the loser's insert fail with `23505`, which the door converts
into the same friendly 409 naming the winning lead. The check is the courtesy; the
index is the law.

On success the funnel writes the first **stage-history** row (`NULL → enquiry`),
emits `admission.enquiry.captured` on the event spine, and writes an audit row
under the DPDP policy reference. A workflow rule (seeded by migration 123) turns
that event into an `admission.followup.scheduled` marker — the follow-up pipeline
becomes visible without anyone auto-messaging a guardian.

The reply: `{ leadId, stage: 'enquiry', admissionYear }`.

> **In plain words:** capturing an enquiry creates a *lead*, never a student. It is
> a named, timestamped, auditable intention.

---

## Part 3 — The lattice (and every way it can move)

The path is defined once, in `_shared/admissions-access.js`, and imported by the
funnel plugin, the kernel follow-up queue, and BI — so the three can never
disagree:

```
enquiry → form → interaction → offer → enrolled
                                   ↘ waitlisted → enrolled
enquiry/form/interaction/offer/waitlisted → rejected
enquiry/form/interaction/offer/waitlisted → withdrawn
```

`TERMINAL = { enrolled, rejected, withdrawn }`. A lead in a terminal stage cannot
move through the ordinary door — a retry answers 409. (`enrolled` is *not* fully
final any more; see the recovery door, Part 8.)

Sneha moves a lead with `POST …/leads/:id/stage {to, reason?}`. The door:

1. rejects an unknown stage (400),
2. loads the lead `FOR UPDATE` (no double-move races),
3. refuses a terminal lead (409),
4. refuses a jump the lattice does not allow (409 naming `from → to`),
5. **requires a reason for `rejected` / `withdrawn`** (400) — a side exit ends a
   child's application and must say why. The reason is stored on the history row
   and shown on the trail.

On `offer`/`waitlisted → enrolled` it raises the kernel approval action (Part 5).
On `→offer`/`→enrolled` it queues a guardian notice if `notify_guardians` is on.
Every move writes a `stage_history` row and emits `admission.stage.transitioned`.

> **Edge case (seat capacity).** If the school set `class_capacity`, moving to
> **offer** counts the seats already held by that class — active students plus other
> leads currently at `offer`/`waitlisted` — and refuses (409) when the class is
> full, suggesting: *"move this enquiry to waitlisted instead."* The class name is
> normalised with the same parser the converter uses, so a seat counted is a seat
> created.

---

## Part 4 — The admissions desk works the lead

Between enquiry and offer, the desk has a full toolkit, all gated to the admissions
office and governance roles:

- **List** (`GET …/leads?stage=`) — capped at 200 with a `capped` flag. **PII is
  tiered by role**: the admissions office, coordinator, principal, owner and IT
  admin see the full guardian name and phone; finance and teachers see a masked
  phone and no name. The audit row records *masked versus full* as different risk
  levels.
- **Correct** (`PATCH …/leads/:id`) — fix a typo in name, guardian, class, source,
  or phone. Identity and session are immutable; an empty patch is a 400.
- **Log an activity** (`POST …/leads/:id/activities`) — a visit, interview, call or
  note, optionally scheduled and with an outcome. `GET` returns the trail.
- **Attach a document** (`POST …/leads/:id/documents`) — a `files.store` file id,
  which must be a real file **belonging to this school** (404 otherwise), appended
  to the lead's `documents` array with who attached it and when.
- **Offer letter** (`GET …/leads/:id/offer-letter`) — available only once an offer
  exists. Deterministic, generated on read, and now **encloses the class fee
  table** from the school's own plan templates so the offer states the price, not
  just the seat. Nothing is stored; the render is audited.
- **History** (`GET …/leads/:id/history`) — the full transition trail with reasons.
- **Summary** (`GET …/summary`) — per-stage counts for the board.

> **Edge case (documents).** The door used to accept any UUID-shaped string and
> leave a dangling reference on the lead. It now confirms the file exists in
> `app.files` for this tenant before attaching — the same ownership discipline the
> fees receipts use.

---

## Part 5 — The offer is accepted: the second pair of eyes

When Sneha moves a lead `offer → enrolled` (or `waitlisted → enrolled`), the
funnel does **not** create a student. It raises an approval action:

```
code:      students.create.<leadId>          (first raise)
           students.create.<leadId>.<n>      (a re-raise after a dismissal)
kind:      approval
owner_role: principal
payload:   { leadId, studentName, classApplied, guardianName, guardianPhone,
             admissionYear, proposed_by, proposed_by_role }
```

Rahul (coordinator) can raise it; Meera (principal) or Ravi (owner) decides it —
**never the person who raised it** (segregation of duties; the `proposed_by` stamp
is what makes that enforceable). If an *open* action already exists for the lead,
the door returns it rather than raising a twin (idempotent retry).

When the principal **approves** (`POST /actions/:id/decide`), the kernel executor
`executeStudentCreation` runs inside the decision transaction:

1. Loads the lead `FOR UPDATE`.
2. **Replay guard** — if a student already exists with `source='admissions'` and
   `source_ref=<leadId>`, returns it (`already:true`). A decision can never create
   a second child.
3. **Staleness guard** — refuses if the lead is not `enrolled` (409).
4. **Class guard** — normalises `classApplied` (`"Grade 6"`, `"Class 6"`, `"6"`,
   `"6-B"` → grade + section, default section `A`) and refuses if the grade or
   section is not one of *this school's* classes. (Otherwise a free-text class
   became a student in grade `"Grade 6"`, invisible to every roster and fee plan.)
5. **Duplicate-child guard** — refuses if an active student with the same name
   already exists (a second lead for the same child cannot become a second child).
6. **Age guard** — if the lead has a date of birth and the school configured an
   `age_bands` entry for the grade, computes age **as on 31 March of the admission
   year** and refuses a conversion outside the band (409 naming the age and band).
7. Inserts the `app.students` row: deterministic admission number
   `ADM-<year>-<lead8>` (falling back to the full lead id on collision), the lead's
   dob, `source='admissions'`, `source_ref=<leadId>`. A SAVEPOINT absorbs the
   admission-number collision.
8. Inserts the primary `app.guardians` row from the lead.
9. **Binds an existing parent account** to the child (`family.child_link`) — only
   when a `parent` user's stored E.164 phone equals the lead's guardian phone.
   Never by name-equality. No matching account means nothing to link.
10. Links a same-name student-role user if unambiguous.
11. Writes the `enrollment_history` admission row.
12. Emits `Student created from admissions` and writes a rich audit row naming the
    act, the admission number, the class, and whether guardian PII was recorded.

The whole thing is idempotent three ways: decide-once (a second decision is 409),
the action code is unique per tenant, and the `(source, source_ref)` replay returns
the existing student.

> **Edge case (the dismissed conversion).** If the principal **dismisses** that
> action, the funnel must not be left with a lead parked at `enrolled` but no
> student — terminal and unfixable. The executor registry now has a dismissal
> branch: the lead **returns to `offer`** with a history row (`enrolled → offer`),
> and the office can re-raise, which uses a suffixed code. Dismissal is a "not
> yet", never a dead end.
>
> **Edge case (adjacent path).** Staff can also enrol directly
> (`POST /students`, owner/principal/coordinator/admissions/IT admin), which
> enforces the same class-validity, unique-admission-number and duplicate-name
> rules — now mirrored in the executor so both paths behave identically.

---

## Part 6 — The follow-up queue and the SLA

Two surfaces keep leads from rotting:

**The daily queue** (`GET /admissions/followups`) — the kernel ranks open leads
deterministically, **no model** (`ruleVersion 'followups-1'`):
`score = days-in-stage × stage weight` (enquiry 1.0 → offer 2.5, because later
stages cost more to lose); `stuck` (>7 days) rows first, then score descending.
Closed stages never rank. PII is masked for roles without admissions authority,
the input is bounded to 500 rows, and every read is audited.

**The SLA sweep** (`POST /plugins/admissions.funnel/sla/run`, owner/principal/IT
admin) — the escalation that prevents "computed but never chased". Its selection
and notification core lives in `sla.js`, **shared with the day-worker**, so the
door and the cron cannot diverge. Each run:

- finds leads untouched >7 days (excluding closed stages),
- raises **one in-app notification per lead per day** (idempotent by the day
  check) and emits `admission.followup.overdue`,
- and, since the fixes, also surfaces **visits/interviews scheduled in the next
  48 hours** (one reminder per activity per day, `admission.interview.upcoming`) so
  a scheduled interview is not forgotten.

The sweep never mutates a lead. It runs from the door **and** from
`day-worker.js` step `admissions-followup` (weekdays at 03:05 IST in the shipped
cron), with the same containment contract as dunning: a failing sweep is logged
`skipped`, never crashing the day.

---

## Part 7 — Health, orphans and repair

`GET …/health` (owner/principal/IT admin) is the honest dashboard of the lattice's
own integrity:

- per-stage counts and the age of the oldest lead in each,
- the count of leads stuck >7 days,
- **`strandedEnrolled`** — a lead at `enrolled` with no student and no open action
  (the fingerprint of a dismissed conversion, historically),
- **`danglingActions`** — an open `students.create` action whose lead is no longer
  enroled.

The probe reports; it does not silently "fix". For the historic stranded case there
is now an explicit repair door: `POST …/leads/:id/reopen` (owner/principal, reason
required) returns **only** a genuinely stranded lead (enrolled, no student, no open
action) to `offer`, audited. Anything else — a live conversion, a lead with an open
approval — is refused, so the repair can never rewrite real enrolments.

> **In plain words:** the health probe is a smoke detector, and `reopen` is the
> extinguisher for the one fire the detector was built to spot. Nothing else is
> auto-changed.

---

## Part 8 — August: the RTE quota child

The state sends its Right to Education lottery results — children who won a seat
under the 25% economically-weaker-section quota. For Sunrise, one winner is Imran.

`POST /rte/lottery/import` (owner/principal/coordinator/admissions/IT admin) takes
the list (1–200 rows) and processes each row in its own SAVEPOINT, so one bad row
never fails the batch. Per row it:

- requires a name, validates date of birth and gender,
- checks the grade and section against the school's own class structure,
- refuses a child who is already enrolled under the same name,
- mints an `RTE-<year>-<seq>` admission number, creates the student
  (`source='rte-lottery'`) and a guardian row,
- and writes a **statutory 100% fee waiver, auto-approved at import** — because the
  lottery *is* the authority, not a staff decision.

The response reports `imported[]` and `failed[]` (line number + reason) per row.
This flow is deliberately **not** gated on the fees tier: RTE is a statutory
obligation, so a school without the fees module still admits its quota children.

The **RTE manager** (`RteManager`, `GET /rte/overview`) tracks the quota picture:
total strength, reserved seats (`ceil(active × 25%)`), filled (the `rte-lottery`
pupils), remaining, and the reimbursement money — `claimed`, `received`, and
`pending`. `POST /rte/reimbursements` (owner/principal/finance/head) records state
reimbursement claims.

> **Edge case (reimbursement chains).** A claim is a *chain*, not a pile: the first
> row must open it as `claimed`; a `partial` or `received` row needs a prior claim;
> cumulative `received` can never exceed what was claimed; a `received` row closes
> the claim to further rows. A duplicate identical row is refused by a database
> uniqueness constraint and surfaced as a friendly 409 — the same race discipline
> as lead capture.

---

## Part 9 — What the season proved (privacy, audit, and the exact tables)

Every sentence above resolves to rows an auditor can read:

- **`plugin_admissions.lead`** — the applicant, guardian contact, class, source,
  session, stage, documents, dob.
- **`plugin_admissions.stage_history`** — every transition, actor, timestamp and
  (for side exits) reason.
- **`plugin_admissions.lead_activity`** — visits, interviews, calls, notes.
- **`app.students` / `app.guardians` / `family.child_link` /
  `app.enrollment_history`** — the core record the conversion creates, with
  `source='admissions'`, `source_ref=<leadId>`.
- **`app.actions`** — the approval gate (`students.create.<leadId>`).
- **`app.notifications` / `app.outbox`** — follow-up and interview reminders.
- **`app.audit_log`** — the hash-chained trail under DPDP and Platform policy refs.
- **`app.rte_reimbursements`** — the state money chain.

**Privacy held throughout:** applicant/guardian PII lives only in the purgeable
`plugin_admissions` schema (IN residency, uninstall = export-then-purge); teachers
and finance see masked contacts; the parent and student roles are refused the
funnel entirely; every PII read is audited at a risk level matched to what was
disclosed.

---

## Part 10 — India reality check (where the domain fits, and where it strains)

Built for a **mainstream Indian private day school**: the Apr–Mar session, the
Feb–Jun capture window, `YYYY-YY` session keys, E.164 guardian phones as the family
identifier (feeds sibling logic downstream in fees), class names validated against
the school's own structure, the RTE §12(1)(c) 25% quota with state reimbursement
tracking, and WhatsApp-first guardian notices with dispatcher-owned delivery.

**Fits well:** private unaided schools (CBSE/ICSE/State), single campus, enquiry-to-
enrollment with waitlists, quota intake, document collection, offer letters.

**Strains or breaks:** government schools (the funnel is not how they take
children), multi-branch chains (each branch is its own tenant; no combined funnel),
and anything needing NACH mandates, donations/80G receipts, or canteen billing —
those are not admissions shapes.

**Known, honest limitations (documented, not hidden):**

- The offer-letter enclosure is text with the fee lines; a sealed **binary PDF**
  artifact is a follow-up (needs a plugin file-write facility).
- `notify_guardians=false` means no notice is queued and **no fallback task is
  raised** — deliberate (the office chose silence), stated so an operator is not
  surprised.
- The RTE same-name guard is name-equality, matching `POST /students`; it is a
  duplicate-detection aid, not an identity proof.

---

## Part 11 — The whole domain in one page

| Plain term | What it really is | Where it lives |
|---|---|---|
| **Enquiry / lead** | An applicant with a guardian contact | `plugin_admissions.lead` |
| **Lattice** | The enforced stage path and its side exits | `admissions-access.js` + CHECKs (119) |
| **Stage history** | Every move, with reasons | `plugin_admissions.stage_history` |
| **Activity** | A visit, interview, call or note | `plugin_admissions.lead_activity` |
| **Offer letter** | Deterministic letter with the class fee table | rendered on read |
| **Conversion proposal** | The approval action an offer acceptance raises | `app.actions` (`students.create.*`) |
| **Student record** | The core child, created only by an approver | `app.students` (`source='admissions'`) |
| **Follow-up queue** | Deterministic ranking of open leads | `GET /admissions/followups` |
| **SLA sweep** | The chase for stuck leads and upcoming interviews | `sla.js` + day-worker |
| **Health / repair** | Lattice integrity probe and the `reopen` door | `GET …/health`, `POST …/reopen` |
| **RTE import** | Statutory 25% intake with a 100% waiver | `POST /rte/lottery/import` |
| **RTE reimbursement** | The state money chain | `app.rte_reimbursements` |

**The four laws, one breath each:**

1. **The funnel proposes; a second hand enrols.** No plugin-direct core writes.
2. **Stages are enforced twice** — in code and in the database — and a closed lead
   is immutable (except the one audited repair for a stranded conversion).
3. **PII is minimised by role** and confined to a purgeable schema.
4. **Nothing is silent.** Every read and write is audited; every escalation is a
   notification; every "can't" is a tested, plain-language refusal.

---

## Where to read next

| Question | Document |
|---|---|
| Exact tables, lattice, doors | this file, Parts 3, 5, 9 |
| The fixes that built this behaviour (A1–A15) | `docs/ADMISSIONS-FIXES.md` |
| The tests that pin it | `tests/admissions.test.js`, `admissions-v13.test.js`, `admissions-executor.test.js`, `admissions-proposer.test.js`, `admissions-fixes.test.js` |
| The sibling money domain | `docs/FEES-STORY.md` |
