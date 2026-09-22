# MAY_BE_IDEAS

> An idea notebook: reports, documents, analysis, and the workflow that ties them together.
> Written by walking a day in each role's shoes. Nothing here is built — it is a menu to pick from.

---

## 0. The seed idea (and the one that organises everything else)

> *"Principal asks the finance head for a document — 'who did not pay this term' — the finance head
> builds it from the data he already has, sends it back, and it lands in the principal's Reports."*

That is not one feature. It is a **loop**, and almost every role needs the same loop:

```
   ASK                 MAKE                    DELIVER                FILE
requester  ─────▶  fulfilling desk  ─────▶  back to requester  ─────▶  requester's
picks a report     builds it from the       notified + can        Reports library
or document        data they own            open / accept         (searchable)
                                          / ask for changes
```

Call it the **Report Desk**. One request object, one lifecycle, one place the finished thing lives.
Everything below is either *"a report someone would ask for"* or *"a thing that makes the loop better."*

The reason this is worth doing as a system rather than as more export buttons: today SchoolOS has
plenty of raw material (fees, attendance, library, exams, audit) but **no way for one desk to ask
another desk for a cut of it**, and no shelf where the answer is kept. The loop is the missing organ.

---

## 1. What already exists — build on this, do not rebuild it

The good news: the bones are already in the codebase. A Report Desk should be assembled from these,
not invented beside them.

| Primitive | Where | What it gives us for free |
|---|---|---|
| **Action spine** — `app.actions` + `POST /actions/:id/decide` | `server/migrations/001_init.sql:215`, `server/src/routes.js:2016` | request/approval object with `owner_role`, `status`, `deadline`, `payload` jsonb, audit + event |
| **Ticket + timeline** — `family.request` + `family.request_event` | `server/migrations/034_parent_family.sql:27` | append-only status timeline, `owner_role`, SLA (`sla_at`) — the best lifecycle model to copy |
| **Routing to a person** — `teacher.concern` (`routed_to`, `routed_role`) | `server/src/plugins/teacher.support/index.js:179` | named assignee + targeted notification + status events |
| **File store** — `app.files` + `plugins/files.store` | `server/src/plugins/files.store/index.js`, `server/src/file-artifacts.js:16` | validated private blobs, scoped download, sha256, append-only; already used for receipt PDFs |
| **Read-model analytics** — `plugins/ops.bi` | `server/src/plugins/ops.bi/index.js` | attendance, fee aging, admissions funnel, homework — cached, RLS-safe |
| **Reports & Insights screens** | `app/src/screens/Reports.tsx`, `Insights.tsx`, `library/insights`, `library/desk/Reports.tsx` | live dashboards + a client-side CSV export pattern |
| **Regulatory exports** | UDISE (`ops.udise`), Tally (`accounting.tally`), CBSE OASIS (`pack.cbse`), DPDP DSR (`pack.dpdp`) | precedent for "official document the school must produce" |
| **Notifications + event spine** | `app.notifications`, `emitEvent` (`server/src/audit.js:37`), `useLiveEventBridge` | how a role learns something arrived |
| **Case tracker** — `app.cases` | `server/migrations/001_init.sql:196`, `server/src/routes.js:1852` | server-side kind/owner/status/SLA/linked_refs, open to every role |

### Honest gaps (facts from the code, not guesses)

1. **No generic "raise an action" door.** Every raiser inserts SQL directly; there is no shared helper.
2. **No requester→file access grant.** `files.store` download allows only the uploader + owner/principal/IT admin (+ guardians for `scope=student`). A finance head who sends a report to a principal has no way to make that principal the allowed reader except by making it school-wide or student-scoped.
3. **No assignment / reassignment / delegation** on actions or cases. (`work_orders.assigned_to` exists but no endpoint ever sets it.)
4. **No comments, evidence or attachments** on actions (payload key-values only).
5. **No task entity and no task inbox.** `payload.kind='task'` on approval just writes a *school-wide* notification — no assignee, no due date, no completion.
6. **No saved / scheduled / versioned reports.** No report-run history anywhere. The "Recomputed nightly" badge on Insights is copy, not a scheduler.
7. **The Documents screen is a demo** (`app/src/screens/Documents.tsx` reads seed; uploads are local-only, "not stored").
8. **`ops.bi/homework` has no UI consumer** — a live endpoint with no screen. Quick win.
9. **Transport analytics and Maintenance intelligence are empty placeholders** (`MaintIntelligence.tsx:16` says so out loud). Report requests are a clean way to discover which of them are actually wanted.

---

## 2. The proposal — a Report Desk

### 2.0 The eligibility rule — ask only for what you may have, and do not yet hold

This is the guardrail that keeps the Report Desk from becoming a back door around permissions.
A request is allowed only when **both** are true:

1. **You have the right.** The content of the report is inside your entitlement — the same scope the
   doors already enforce. A parent, only their linked children; a teacher, only their form-classes; a
   student, only their own records; finance, fee data; the principal, school-wide academics and
   operations. This is **not a new permission model** — it is `server/src/effective-access.js` plus the
   scopes that already exist (`scope.classes`, `family.child_link`, role gates) applied to a report's
   audience.
2. **You do not already hold it.** If the view or artefact is already reachable to you, the system
   shows it instead of accepting a request — no make-work, and no "ask a friend to fetch what I can
   already open".

If either fails, the request is **refused with an honest reason**, not silently queued:

- *"A student cannot request school-wide fee defaulters."*
- *"You can only request reports for your own children."*
- *"You already have this — open Fees → Defaulters."*

The load-bearing consequence: **the producer's access never becomes the requester's access.** A desk
that can see everything cannot launder that visibility to someone who is not entitled to it. The
delivered artefact is scoped to the *requester's* entitlement, and the request row records that the
check passed. Without this rule, "ask finance for a list" is an approval-bypass and a data-exfiltration
channel; with it, the Report Desk is just a faster way to get something you were always allowed to see.

This also splits requests into two kinds, which follow **different** guards:

- **Access-gaining requests** — data / report / document you are entitled to but do not hold. Guarded
  by the eligibility rule above.
- **Action requests** — approval, sign-off, verification, "please do X". Guarded by the existing
  segregation-of-duties rules (`app.actions` decide), not by data entitlement.

Worked examples:

| Ask | Verdict | Why |
|---|---|---|
| Principal → finance: "fee defaulters this term" | allowed | principal is entitled to school-wide fee data and holds no compiled report |
| Student → principal: "all fee defaulters" | **refused** | student has no entitlement to anyone else's fee data |
| Student → office: "my fee statement" | shown, not requested | already reachable at `/student/fees` (rule 2) |
| Parent → office: "another child's attendance" | **refused** | entitlement is their own linked child only |
| Teacher → coordinator: "class 9B attendance" | refused unless 9B is theirs | outside their form-class scope |
| Finance clerk → head: "sign off this daybook" | action request | SoD guard, not data entitlement |

### 2.1 One request object

A **Report Request** is: *a titled ask, from a requester, to a role (or a person), for an artefact,
by a date, with parameters.* Fields:

- `title`, `description`
- `requester` (user) + `requester_role`
- `fulfilling_role` (the desk) and optionally `assignee` (a person)
- `kind`: `report` · `document` · `data_extract` · `analysis` · `verification` · `sign_off`
- `parameters` (jsonb): term, date range, class/section, route, fee head, format…
- `audience` / `sensitivity`: `internal` · `restricted` · `confidential` · `contains_minors`
- `entitlement_basis` (why the requester may see this: own child / own class / desk scope) — recorded
  so the §2.0 check is auditable, not just performed
- `sla_at`, `priority`
- `status` (below) + append-only `events`
- `artefact_file_id` (link to the delivered file in `app.files`)
- `source_template_id` (if it started from a catalogue item)

### 2.2 Lifecycle

```
requested ─▶ accepted ─▶ in_progress ─▶ delivered ─▶ accepted
    │            │                          │
    │            └─ declined (with reason)  └─ rework_requested ─▶ in_progress
    └─ cancelled by requester
```

Binary approval is not enough — the loop needs `delivered → rework → delivered`, because the first
cut of a report is rarely the last. `family.request_event` already models an append-only timeline.

### 2.3 Surfaces (three panes, one module)

1. **Ask** — a "Request a report / document" builder: pick a standard report from the catalogue, fill
   the parameters, choose the desk, add a note and a due date.
2. **Inbox** — "Asked of me" (the fulfilling desk) and "Asked by me" (the requester), with status,
   SLA countdown, and a thread for rework notes.
3. **Library** — delivered artefacts, searchable by title/period/requester/role, each with its
   metadata, version, and a download. This is the principal's "Reports" field from the example.

A request that arrives should also surface where the role already looks: the **notification bell**
(`app.notifications`), the **Action Center** (it is an `app.actions` row under the hood), and the
**Today / Attention** feed.

### 2.4 The catalogue (the part that makes it feel organised)

A gallery of **standard reports**, one click each, parameterised. Not free-form query building —
pre-authored reports a non-technical desk can request without knowing SQL. Examples:

| Catalogue item | Produced by | Typical requester |
|---|---|---|
| Fee defaulters for a term (by class / route) | finance | principal |
| Fee ageing buckets | finance | principal, owner |
| Collection summary per fee head | finance | owner, principal |
| Attendance below 75% (exam-eligibility watch) | coordinator | principal, exam desk |
| Teacher workload / free-period fairness | coordinator | principal |
| Substitution coverage for a week | coordinator | principal |
| Admissions funnel conversion by source | admissions | owner, principal |
| Library overdue / dead stock / acquisitions | librarian | principal, owner |
| Asset & preventive-maintenance compliance | facilities | principal, owner |
| Work-order ageing & vendor spend | facilities | owner |
| Safeguarding weekly pattern (identity-free) | counselor | principal |
| Transport ridership & route compliance | transport | principal |
| Audit / access review extract | IT admin | owner, auditor |
| UDISE / CBSE / Tally / DPDP packs | various | owner, compliance |

Each catalogue item is a tiny contract: *parameters in, rows out, a title, a sensitivity class, and
which roles may request it.* This is where "imagine each role" turns into product.

### 2.5 Permissions, privacy and sign-off

- The **requester gets read access to the artefact they requested — and only within their
  entitlement** (the missing file grant, gap #2). Add `requested_by` / a `shared_with` set to
  `app.files` (or grant via the request row); the grant is bounded by the §2.0 eligibility rule, so a
  delivered report can never be wider than what the requester was already allowed to see.
- **Sensitivity classes** decide redaction: a principal can see named defaulters; a class teacher
  gets counts, not other families' money. `contains_minors` implies aggregate-only by default.
- **Maker–checker** where money or minors are involved: the finance clerk prepares, the finance head
  signs off (mirrors the existing fee-concession SoD, `routes.js:1656`).
- Every request, decision, delivery and download is **audited** (the spine already does this).
- A delivered report can be **versioned**; "accepted" freezes a version.

### 2.6 Recurring reports (later, but the demand is obvious)

Some asks repeat forever: *daily absence list to the principal*, *weekly fee ageing to finance*,
*monthly board pack to owner*. There is no scheduler today (`scripts/day-worker.js` and
`scripts/dunning-reminders.js` show the worker pattern). A saved request + a cadence would turn the
loop into a heartbeat. Until then, the Library's "request again" button covers 80% of it.

---

## 3. A day in each role — what I'd ask for, make, and receive

For each role: **Ask** = what I request from another desk · **Make** = what I produce · **Receive** =
what I want pushed to me · **Also** = adjacent features the role clearly wants.

### Owner
- **Ask:** board pack (fees + enrolment + compliance), per-campus comparison, staff attrition, module
  adoption/ROI, audit extract.
- **Make:** the annual report, policy documents, sign-off on packs.
- **Receive:** exceptions — a term's collection below target, an audit anomaly, a compliance pack due.
- **Also:** a group roll-up across tenants (the `/group` surface hints at it); scheduled monthly board
  pack; a one-page "state of the school" that anyone can read.

### Principal
- **Ask:** *fee defaulters this term* (the seed example), attendance by class, teacher workload,
  exam performance, incident/discipline summary, substitution coverage, parent-complaint SLA.
- **Make:** circulars and notices, board reports, approvals and sign-offs.
- **Receive:** everything requested, plus things I did not ask for and should have.
- **Also:** a **request builder** with parameters; **"have I already asked for this?"** dedupe;
  sign-off that freezes a version; a Reports library that survives staff turnover.

### Coordinator
- **Ask:** curriculum coverage, room/timetable conflict analysis, exam-readiness by class.
- **Make:** daily cover plan, duty roster, workload-fairness report, substitution decisions.
- **Receive:** teacher leave, concerns routed to me, uncovered-class alerts.
- **Also:** a "coverage gap" report that names exactly which periods are uncovered tomorrow (the
  ApprovalCenter already routes substitutions — this is its reporting twin).

### Counselor
- **Ask:** attendance/wellbeing correlation, at-risk watchlist (aggregate), safeguarding pattern
  summary.
- **Make:** wellbeing summaries for the principal (**aggregate only, never identity** — the
  `/safety/box/summary` door is the model), case notes kept private.
- **Receive:** escalated concerns, wellbeing queue.
- **Also:** a hard confidentiality boundary baked into the artefact's sensitivity class; designated
  readers only; redaction by default.

### Finance head (approver)
- **Ask:** (rare) reconciliation help, exam-fee reconciliation from the exam desk.
- **Make:** defaulters, ageing, collection summaries, concession registers, Tally/audit exports,
  receipt packs.
- **Receive:** fee-waiver requests, reconciliation discrepancies, the principal's data requests.
- **Also:** parameterised reports (term × class × route × fee head); PII-aware sharing; a
  "collection vs target" trend; one-click send-to-principal with the request thread attached.

### Finance clerk (maker)
- **Make:** daybook, collection log, receipt reprints, first-cut defaulters.
- **Ask:** head's approval before anything leaves the desk (maker–checker).
- **Also:** a daily cash/UPI reconciliation sheet; "unmatched payment" worklist (the reconcile
  discrepancy classes already exist server-side).

### Admissions
- **Ask:** capacity by grade/section from the school structure; transport availability for a new area.
- **Make:** funnel conversion by source, counsellor performance, waitlist, offer letters, prospectus
  and brochure documents.
- **Receive:** new leads, follow-up reminders.
- **Also:** a "conversion by source/campaign" report; exportable prospectus pack; the funnel screen
  already has no export — a natural catalogue item.

### Transport
- **Ask:** fee-defaulters-on-my-route from finance; vehicle document renewals from facilities.
- **Make:** route roster, ridership report, GPS/on-time compliance, bus maintenance schedule.
- **Receive:** route-change requests (parents), breakdown reports.
- **Also:** transport analytics are **explicitly unbuilt** — a "ridership & compliance" catalogue
  report would be the first real thing on that desk.

### Facilities
- **Ask:** budget/approval for vendor spend; student counts per campus from admissions.
- **Make:** asset register, preventive-maintenance compliance, work-order ageing, vendor spend,
  inspection packs.
- **Receive:** reported issues, AMC/insurance renewals due.
- **Also:** the Documents screen already dreams of "generate inspection pack" and "renewal task" —
  those are exactly Report Desk artefacts with an expiry date.

### Technician
- **Ask:** parts/materials approval from facilities.
- **Make:** job completion notes, parts usage, asset downtime.
- **Receive:** assigned jobs (note: work-order assignment is a **gap** — `assigned_to` is never set).
- **Also:** a "my jobs today" report; a parts-consumption summary for the store.

### Teacher
- **Ask:** a student's full academic history from the exam desk; a class's attendance trend.
- **Make:** report cards, progress notes, lesson plans, exam papers, homework.
- **Receive:** parent requests, submissions, doubts routed to me.
- **Also:** the `ops.bi/homework` endpoint has **no screen** — a homework-completion report is a
  one-day win; a PTM pack (attendance + marks + homework) per child.

### IT admin
- **Ask:** incident reports from any desk.
- **Make:** audit/access-review extracts, data-health reports, AI-usage reports, plugin/entitlement
  status, backup/DR evidence.
- **Receive:** access requests, security exceptions.
- **Also:** a "who can reach what" access review (the effective-access engine already computes it);
  a quarterly evidence pack for compliance.

### Librarian
- **Ask:** purchase approvals, lost-book recovery from finance.
- **Make:** circulation, overdue, dead stock, inventory, acquisitions, fine-collection reports (six
  kinds already exist with CSV).
- **Receive:** purchase requests, reservations.
- **Also:** the library reports are the closest thing to a finished Report Desk — use them as the
  reference implementation for the catalogue.

### Parent
- **Ask:** transfer certificate, bonafide, fee receipts, progress report, attendance summary.
- **Make:** nothing (they are the requester, not a desk) — but they **do** need a timeline and SLA
  (the `family.request` ticket already does this).
- **Receive:** reports about **their own child only**.
- **Also:** a downloadable "my child's term pack"; status tracking on every ask; receipts already
  exist as PDFs — surface them in the same Library.

### Student
- **Ask:** marksheet, transcript, bonafide, a doubt answered.
- **Make:** portfolio entries.
- **Receive:** report cards, results, homework.
- **Also:** a personal "my records" library; portfolio export.

---

## 4. Cross-cutting features that make the loop pleasant

- **Report builder with parameters** (term, date range, class/section, route, fee head, format) — not
  a query language.
- **Sensitivity / redaction engine** — one place that decides what a role may see, keyed off the
  existing effective-access model.
- **Sign-off & version freeze** — "accepted" locks a version; later edits make v2.
- **Delivery channels** — in-app first; email/WhatsApp rails already exist as plugins for later.
- **Rework thread** — comments on the request so "add the route column" does not need a new request.
- **Expiry & retention** — documents like insurance/AMC have a validity date; reports have a
  retention class.
- **Searchable Library** — by title, period, requester, role, sensitivity.
- **"Report of reports"** — a weekly digest of what was requested, delivered, and is overdue per desk.
- **AI assist (with sources)** — summarise a delivered report, answer "which class is worst?" from
  the family's/desk's own records, cite the rows. The deterministic, sourced pattern of
  `parent.assistant` / `teacher.copilot` is the template; never free-form invention.
- **Offline-tolerant asks** — a request queued offline and sent on reconnect (the sync banner already
  tracks an offline queue).

---

## 5. MVP vs later

**MVP (the seed idea, end to end)**
1. A Report Request object on the action spine (`kind='report'`, `owner_role` = fulfilling desk,
   `payload` = parameters).
2. **The §2.0 eligibility check on every request** — entitled, and not already held — refused with an
   honest reason and the basis recorded on the row. This ships *with* the first request, not after it.
3. A **generic raise door** (the missing helper) + a small catalogue of 3–5 reports, starting with
   *fee defaulters* (finance → principal).
4. Requester read-grant on the delivered file, bounded by the eligibility check (fix gap #2).
5. An **Inbox** (asked of me / asked by me) and a **Library** per role, with notifications.
6. Audit + event for every step (free from the spine).

**Next**
6. `delivered → rework` thread; accept/freeze; versioning.
7. Catalogue growth to attendance, library, admissions, facilities.
8. Recurring requests via the worker pattern.
9. Wire `Documents.tsx` to `files.store` so policies/certificates live in the same Library.
10. Redaction/sensitivity classes beyond a simple allow-list.

**Later**
11. AI summaries with citations.
12. Cross-tenant (group) roll-ups for owners.
13. Scheduled board packs and compliance calendars.

---

## 6. Decisions I would want made before building

1. **One spine or two?** Reuse `app.actions` (decide-oriented, SoD, school-wide visibility today) or
   copy `family.request` (timeline-oriented, `owner_role` + SLA) for the request lifecycle? My lean:
   `family.request`-style timeline for the request, `app.actions` only for the sign-off gate.
2. **Who may request from whom?** A fixed matrix (principal→finance, coordinator→teachers) or open
   within a school? A matrix is more organised; open is more useful.
3. **Default sensitivity** for anything containing minors or money — aggregate unless explicitly
   named? I would say yes.
4. **Person or role as the target?** Role-targeted requests survive staff turnover (the desk answers);
   person-targeted is more accountable. Probably: target the role, assign a person.
5. **Where does the Library live?** Inside the existing `/reports` screen, or a new `/requests`
   module? My lean: a new **Requests** module with a Reports tab, because "ask" and "read" are
   different jobs.
6. **Who owns the report→scope mapping?** Each catalogue item must declare the entitlement it needs
   (own child / own class / desk scope), and the server must check it against `effective-access.js` and
   the existing scopes. Decide whether that mapping is authored beside the report or centrally, and
   make "a report added without a declared scope" fail CI — otherwise a new report silently becomes a
   way to ask for anything.

---

## 7. Leave — one system for staff and students

- **Staff leave is fragmented today** (teacher self-leave in `teacher.classroom`, HR `hr.leave` facts,
  coordinator approval). Unify it: apply, balances/quotas, approve, arrange cover, show on the calendar.
- **Student leave is only a parent request** (`family.view` child leave). Give it the same shape:
  guardian applies → class teacher/coordinator approves → attendance auto-marks.
- **Shared concerns:** leave types (sick/casual/event), balances, half-day or period-level for staff,
  multi-day for students, attachments (medical note), notifications, audit, calendar integration,
  substitution/cover for staff.
- **Report hooks:** absence patterns, leave-balance reports, chronic-absence watchlist — natural
  Report Desk catalogue items.

---

## 8. Verdict — is this over-engineering? (and the rule that keeps it honest)

**Two ideas, judged separately.** **A** = the cross-desk request loop (ask → route → share → file).
**B** = the generic form/report *builder* (custom fields, arbitrary templates, write-back). A is useful
and under-built. B is where the over-engineering lives. Conflating them is what makes the whole thing
look heavy.

| Domain | Already has | Loop (A) value | Generic forms (B) value | Verdict |
|---|---|---|---|---|
| Fees | aging, summary, receipts, Tally, concessions | **High** (principal↔finance is the archetype) | Low | thin loop, no builder |
| Owner / Principal | separate domain screens, no cross-domain roll-up | **High** — board pack is genuinely missing | Low | **strongest real use** |
| Attendance | `ops.bi/attendance`, needs export + 75% watch | Low | None | purpose-built export |
| Exams / Learning | report cards, moderation, OASIS export | Low | None | skip |
| Library | 6 report kinds + acquisitions | Low | None | already the reference implementation |
| Admissions | funnel, no export | Medium | Low (follow-up is CRM) | purpose-built export |
| Transport | GPS only | Low | **High** — pre-trip checklist | purpose-built checklist |
| Maintenance | work orders, assets, inspections screens | Low | **High** — condition + photos | purpose-built inspection |
| HR | leave facts only | Medium | **High** — training, appraisals | purpose-built, tied to leave |
| Health | clinic visits | Low | Medium — parent medical update | purpose-built, consent-bound |
| Safeguarding | aggregate summary | Low | **Negative** — PII hazard | never generic |
| Compliance | UDISE/CBSE/Tally/DPDP exports | Low | Medium — supplementary returns | fixed formats → purpose-built |
| Parent / Student | tickets, consents, fees | Low | Medium — medical/consent updates | mostly exists |

**What this says:**

1. Most domains already have their reports, or should get one *specific* screen — not a builder. A
   generic report builder would mostly re-create existing screens with more freedom and less polish.
2. The loop's value is concentrated: principal/owner wanting a cross-desk or cross-domain view, plus a
   handful of field-data cases (transport checklists, maintenance inspections, HR training, health).
3. Forms are the trap, not reports. A field designer before demand produces the failure modes already
   listed: a shadow database, template sprawl, PII through free text, and unowned governance. Where
   forms do fit, the first version is better as a **purpose-built screen** — an inspection form that
   knows what an asset is beats a generic "add a field".
4. The §2.0 entitlement guardrail is mandatory and is itself a cost — another reason not to generalise
   early.

**The rule:** build the generic version only when the **same shape repeats 3+ times across different
domains**. Until then:

- **Now:** thin loop (A) + 3–5 **fixed** catalogue reports (start: fee defaulters). Small.
- **Then:** add concrete templates one at a time (bus checklist, inspection, training) as
  purpose-built features. Repeated "one more field" requests are the signal to generalise.
- **Never/last:** free-form field designer, arbitrary write-back, report scheduling, "reports of
  everything".

**Bottom line:** not over-engineered if A ships thin and B is a catalogue. Over-engineered if the
builder, scheduler, versioning and write-back arrive before the first real request has run end to end.
Treat this document as a *menu*, not a roadmap — cut §4's cross-cutting extras and §2.4's catalogue down
to the 3 reports and 3 templates that have a named requester today.

---

*See also: `docs/LIBRARY-DESIGN.md`, `docs/FEES-DESIGN.md`, `docs/DATA-FLOW.md`,
`docs/PERMISSION-MATRIX.md`. The permission story for any of this is already centralised in
`server/src/effective-access.js` — new surfaces should name their real door there.*
