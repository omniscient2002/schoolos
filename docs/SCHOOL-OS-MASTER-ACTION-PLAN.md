# SCHOOL OS — MASTER ACTION PLAN

> Derived from `SCHOOL-OS-2026-STRATEGY.md` (read that for *why*; this doc is *what, in what order*).
> Target buyer: private unaided CBSE/State-board day school, ₹20–60k/yr, 300–2,000 pupils. Stack: Fastify 5 + Postgres RLS + React 19 SPA.
> Priority scale: **P0** blocks revenue/legality/adoption · **P1** wins deals · **P2** depth after traction.
> Rule: no task lands without its acceptance criteria passing on a fresh browser walk + the affected test file green.

---

## Phase 0 — Foundation & architecture (protect the moat; weeks 1–2)

| # | Task (what) | Why | Pri | Dependencies | Done when |
|---|---|---|---|---|---|
| 0.1 | Freeze substrate guarantees as CI gates: RLS wall test, audit-or-rollback test, unknown-surface-closed test | Your moat is invisible correctness; one regression kills trust | P0 | none | `node --test` covers all three; factory-check runs them |
| 0.2 | Wire billing: plans (`trial/core/operations/campus/compliance/rails` already in `entitlements.js`) → checkout (Razorpay) → quotas enforced at doors → usage page (FEE-COM-2 report exists) | No revenue capture today; `trial`=everything-forever | P0 | none (scaffolding exists) | Test school hits quota wall with honest upgrade copy; paid school unlocks |
| 0.3 | Size presets: `small ≤500 / standard / large` seed configs (modules on, roles, fee heads, nav density) + setup wizard | Trials die in settings sprawl; small schools drown in flagship depth | P0 | none | Fresh signup picks size → sensible modules + hidden advanced (reversible) |
| 0.4 | Fresh-bundle guard: build hash recorded at build; preview/boot log warns when `dist` predates `src` (FIX-6 repeat) | Served stale UI for days unnoticed | P1 | none | CI + boot log both check; documented in HANDOFF traps |
| 0.5 | Kill demo residue: delete hardcoded Bus-14 narratives; make `· demo`/Illustrative badges conditional on actually-unwired lanes | Fiction on real schools destroys principal trust | P0 | none | Grep `demo(` in Today/Insights limited to empty-lane branches; populated walk shows zero |
| 0.6 | Bundle Indic fonts (Noto Sans Telugu/Tamil/Kannada/Malayalam/Marathi/Bengali/Hindi) + low-end-Android perf budget (no splash crashes, <3s first paint on 2GB RAM) | Reviews: boxes-not-glyphs, crashes, slowness = 1★ | P0 | none | 390px walk on throttled profile; font test page renders all scripts |

## Phase 1 — Core school management (weeks 2–5)

| # | Task | Why | Pri | Deps | Done when |
|---|---|---|---|---|---|
| 1.1 | Keep roster engine as-is (admit guards P2-5/6/7/8, triggers, guardians∪links) | Genuine differentiator; do not touch working money | — | — | Existing suites stay green |
| 1.2 | MPD Compliance Center: Appendix-IX checklist + doc vault w/ expiry + auto disclosure page + circular tracker | CBSE surprise inspections since May-2026; affiliation jeopardy | P0 | 0.3 (preset) | All 12 disclosure rows generatable; expired cert blocks with 30-day alert |
| 1.3 | RTE/EWS manager: 25% seat math, lottery CSV import, auto fee-waiver to Cl.8, reimbursement ledger (claimed vs received per child) | Crores stuck; SC mandate; zero product coverage | P0 | 1.1 (roster), fees generate | Lottery file → seats + waived dues + ledger; Cl.9 cliff flagged per child |
| 1.4 | UDISE depth: infrastructure fields (rooms/labs/toilets M-F/water/playground/PTR 30:1 check) + deadline tracker + 4-level submission log | Real-time validated portal; yearly scramble | P1 | 1.2 (vault) | Export validates clean; deadline engine nags from −30d |
| 1.5 | Scholarships (NMMSS/pre/post-matric) + APAAR field + DigiLocker TC + sibling/staff-ward/RTE discount engine | Dropout + TC delays | P1 | fees concessions | Discount auto-applies; TC issues to DigiLocker |
| 1.6 | PTA/SMC manager (meetings, minutes, attendance, fee-consultation record) | Hike legality + MPD rows | P1 | 1.2 | Hike cannot publish without attached consultation record |
| 1.7 | Health extension: RBSK checkups, vaccination, PM-POSHAN meal log on clinic | Parent questions; government-adjacent credibility | P2 | clinic | Weekly meal + termly checkup reports |

## Phase 2 — Teacher experience: sub-minute everything (weeks 3–6, overlaps 1)

| # | Task | Why | Pri | Deps | Done when |
|---|---|---|---|---|---|
| 2.1 | Register discipline: keep 10-sec owned-register; add staff QR attendance + adapter interface (NO face recognition — Delhi 2021) | Adoption lives/dies here; coercion fails (10% Indore) | P0/P1 | attendance doors | Median mark time <15s measured; QR pilot in 1 school |
| 2.2 | Marks-entry grid: keyboard-first, bulk paste, per-cell validation, <60s per class | #1 teacher complaint pattern | P0 | exams doors | Timed walkthrough passes; weightage enforced pre-save |
| 2.3 | Homework: keep post-once/submit-once/inbox; add due-today nudges + parent-visible status | Black-hole homework | P1 | classroom | Submission rate visible per class; zero new doors needed |
| 2.4 | Timetable: conflict detector (room/teacher/lab) inline; constrained assist; NEVER full-auto flagship | Detection >> generation in value/risk | P1 | timetable doors | Clash flagged at edit time; coordinator still owns the call |
| 2.5 | Substitution: keep suggest→approve; add 7am SMS/push to substitute + handover packet | Daily scramble | P1 | HR leave, timetable | Cover assigned in <2 min from approval |
| 2.6 | Teacher minutes/day budget: instrument and cap new teacher-facing work; kill anything exceeding it | North-star metric | P1 | analytics | Dashboard shows median teacher task times; regressions fail CI discussion |

## Phase 3 — Parent & student experience (weeks 4–8)

| # | Task | Why | Pri | Deps | Done when |
|---|---|---|---|---|---|
| 3.1 | Parent PWA + push (FCM) + Hindi first (+Marathi), install prompt, offline-readable dues/homework | No app = no adoption; reviews unanimous | P0 | 0.6 fonts | Push arrives <10s; Hindi renders on ₹8k phone; works read-only offline |
| 3.2 | In-app UPI fee pay: intent → webhook → auto-confirm under cap; over-cap stays staff-confirmed; receipts + history | Parents judge you here; staff-only pay doesn't scale | P0 | fees kernel, gateway wiring | Parent pays end-to-end in test mode; mismatch flags human |
| 3.3 | Diary + e-signature + circulars with read receipts (per-parent) | "Lost in the bag" + no-proof core complaint | P1 | comms (Phase 5) | Unsigned list per class; signature timestamps stored |
| 3.4 | Bus live map + stop ETA + boarding completeness (parent view) | Daily "where is the bus" calls | P1 | transport upgrade (5.2) | ETA ±2 min; office sees boarding photos/status |
| 3.5 | Student 360 page (attendance+marks+fees+transport+library+health+awards) + class-teacher field-level sharing | Pre-meeting scramble | P2 | read doors exist | One page per child; sharing toggles per field |
| 3.6 | PTM booking surface in parent app (publish → book → remind) | Scheduling ping-pong | P1 | PTM doors exist | Booking + reminder without office mediation |

## Phase 4 — Finance & operations (weeks 5–9)

| # | Task | Why | Pri | Deps | Done when |
|---|---|---|---|---|---|
| 4.1 | Payroll + ECS: salary structures, bank disbursal file, TDS/PF records, staff QR linkage | Affiliation law; every rival tier has it | P0 | HR leave | ECS file generates; auditor accepts the trail |
| 4.2 | Dynamic fee structures + discounts/offers + counter 4-digit PIN + dunning broadcast + SMC-hike workflow | Collection is #1 ROI; borrowed-phone fraud real | P1 | fees kernel | PIN blocks logged-out recording; broadcast lifts collection measured |
| 4.3 | Gateway reconciliation: auto-match exact, human-resolve rest; mismatch queue | Paid-not-reflecting is the 1★ review | P1 | 3.2 | 100% webhooks resolve to matched-or-queued within 1h |
| 4.4 | Transport compliance pack: boarding timestamps, attendant roster + police-verification status, fare/km engine, quarterly report, inspection log | 2026 MH law; keep approval-before-notify | P1 | transport GPS | Quarterly report generates from real rows; inspector walkthrough passes |
| 4.5 | Safety-audit checklist (NCPCR-mapped) + police-verification tracker for ALL staff/drivers (periodic) | Accountability framework is law-adjacent | P1 | people.admin | Audit score per school; expired verification blocks duty roster |
| 4.6 | Canteen/store + inventory billing | Small revenue + stock truth | P2 | fees rails | Stock + sale + receipt reconcile |
| 4.7 | Light double-entry + GST-ready accounting export (rival Pathsala ships it) | Auditor acceptance | P2 | Tally export | Trial balance from fee/payroll rows |

## Phase 5 — Communication: WhatsApp-first (weeks 6–10)

| # | Task | Why | Pri | Deps | Done when |
|---|---|---|---|---|---|
| 5.1 | BSP send (Cloud API) + DLT template registry complete + per-parent sent→delivered→read + SMS failover + shared office inbox | 90–95% engagement lives here; logger sends nothing | P0 | comms dispatcher | Real message to real phone in staging; receipts update live; failures retry once then human queue |
| 5.2 | Template gallery (absence, dues, results, holiday, PTM, delay) in Hindi/Marathi/English, human-approved, Meta-approved flow | Translation quality + approval compliance | P0 | 5.1 | 20 templates live; approval SLA tracked |
| 5.3 | Audience engine: class/section/bus-route/defaulter/role targeting + quiet hours + per-topic parent controls | Wrong-audience sends = fatigue + 1★ | P1 | 5.1 | Mis-targeted send impossible by construction (audience picker) |
| 5.4 | Emergency broadcast: principal-only, WhatsApp interactive-button ack, auto-escalate unacked in 30 min via SMS+call list | Safety | P1 | 5.1 | Drill completes with ack ledger |
| 5.5 | Surveys/feedback with skip logic (closure loop) | "Prove it landed, then hear back" | P2 | 5.1 | Response rates per circular |

## Phase 6 — Automation: visible when-this-then-that (weeks 8–11)

| # | Task | Why | Pri | Deps | Done when |
|---|---|---|---|---|---|
| 6.1 | Template gallery UI over existing workflow engine (absence→notice, due−3d→reminder, delay→approval, enquiry→task, publish→cards+notices, expiry−30d→MPD task) with dry-run + audit preview | Invisible automation gets zero use | P1 | engine exists | 10 templates, each dry-runnable; every firing audited |
| 6.2 | Approval SLA engine: escalate stale approvals (leave, announcement, case, delay) at 24h → principal digest | Bottlenecks are the #1 office complaint | P1 | action-center | Zero approval older than SLA without an escalation row |
| 6.3 | Low-attendance (<75%) + fee-at-risk + dropout-cliff watchlists, staff-only, labeled review lists (never parent-facing scores) | Early action beats reports | P1 | ops.bi | Weekly review list per coordinator; actions linked |
| 6.4 | Keep HARD stops: no auto money movement, no auto safeguarding decisions, no auto sends (dispatcher needs approval or pre-approved template+audience) | One auto-send scandal ends the company | P0 | constitution postures | Attempted bypass fails closed in tests |

## Phase 7 — Analytics: decisions, not charts (weeks 9–12)

| # | Task | Why | Pri | Deps | Done when |
|---|---|---|---|---|---|
| 7.1 | Principal cockpit: collection-at-risk, attendance exceptions, approvals aging, compliance countdown, staff gaps — each tile links to its action | Kills the Excel person | P1 | summaries exist | Every tile answers "what do I do next" (no dead charts) |
| 7.2 | Finish live-ification: question cards live-or-empty; conditional Illustrative badges; delete demo narratives (from 0.5) | Trust | P0 | 0.5 | Populated walk: zero `demo` strings; empty walk: honest empties |
| 7.3 | Cited NL analytics (staff-only): ask-your-data with per-claim record links, token-metered per tenant | Differentiation without LLM risk | P2 | ops.bi | Every claim cites a row; unknown = honest "not in records" |
| 7.4 | Fee default early list + timetable coverage + substitution SLA + comms read-rate dashboards | Operational KPIs owners pay for | P1 | lanes live | Each metric names its decider + next action |

## Phase 8 — AI: boring, approved, cited (weeks 10–14, gated pilots)

| # | Task | Why | Pri | Deps | Done when |
|---|---|---|---|---|---|
| 8.1 | Keep determinism as doctrine: budgets, approval gates, zero-LLM default, tokens metered | Safety + cost control | P0 | exists | Any LLM call without budget+approval fails closed in tests |
| 8.2 | Parent-message + announcement drafting from templates (human sends; Hindi/Marathi human-approved) | Real teacher minutes saved | P1 | comms templates | Draft→edit→send measured <2 min |
| 8.3 | Marks anomaly flags + homework load flags (human reviews) | Catches errors pre-publish | P1 | exams/classroom | Flag precision reviewed weekly; no auto-changes ever |
| 8.4 | Pilot-gated: substitution ranking, NCF-SE lesson first drafts (teacher edits) | Upside with containment | P2 | pilot flag per tenant | 2 pilot schools, kill criteria written before start |
| 8.5 | Explicit bans enforced in code review checklist: open parent/student chat, parent-facing scores, face recognition, auto-send, auto-grade | One incident ends trust | P0 | — | Checklist item in PR template |

## Phase 9 — Security, performance & reliability (continuous, hard gate before launch)

| # | Task | Why | Pri | Deps | Done when |
|---|---|---|---|---|---|
| 9.1 | DPDP breach runbook + minor-data minimization pass + photo/boarding-image consent scoping (lawyer-reviewed) | POCSO-climate + enforcement phasing | P0 | DPDP pack | Tabletop drill passes; image retention rules enforced |
| 9.2 | Perf budgets: p95 door <300ms at 2,000-pupil scale; list caps + pagination everywhere; BI cache discipline kept | Slow = 1★ (reviews) | P0 | — | Load test in CI; slow-door alert |
| 9.3 | Backup/restore rehearsed (globals + per-DB + `pg_restore --list` verify) + status page | Schools can't lose records, ever | P0 | ops scripts exist | Quarterly restore drill logged |
| 9.4 | Rate-limit + abuse review (signup 3/min exists; extend to OTP, fee-intent, comms broadcast) | Fraud/cost exposure | P1 | — | Abuse test per vector in suite |
| 9.5 | Session/token review: keep memory-only bearer + HttpOnly cookie; add optional TOTP for owner/itadmin | Account-takeover = headline risk | P1 | auth | TOTP pilot; no localStorage tokens ever (test asserts) |

## Phase 10 — Final polish and launch (weeks 12–16)

| # | Task | Why | Pri | Deps | Done when |
|---|---|---|---|---|---|
| 10.1 | 5 design-partner schools live (mix: 300/800/1,800 pupils; 1 budget Hindi-medium) with founder-led WhatsApp onboarding + free migration | Evidence before scale | P0 | MVP slice (below) | Daily active office use in all 5; teacher-minutes + read-rate baselines captured |
| 10.2 | Support playbook: Hindi+English, WhatsApp channel, 4-hour first response, public status, release notes per deploy | Support is the product at this price | P0 | — | CSAT + renewal tracked; 98% renewal is the target (market leader level) |
| 10.3 | Docs law enforced: DATA-FLOW + ROLE-CAPABILITIES + matrix regenerated per change; API docs + sandbox for chains | Chains buy open APIs | P1 | permission-matrix script | Stale-docs check in CI |
| 10.4 | Launch pricing page (flat bands + metered comms, published) + 30-day trial + assisted migration offer | Hidden pricing loses to open rivals | P0 | 0.2 billing | Mystery-shopper test: price found in <60s |
| 10.5 | Kill criteria review: any feature below usage threshold after 2 terms gets hidden (preset) or deleted | Feature count is not value | P1 | analytics | Quarterly prune ritual scheduled |

---

## MVP action list (the 8-week sellable slice — in order)

1. 0.2 billing wired → 0.3 presets + 0.6 fonts/perf → 0.5 demo-residue deletion
2. 1.2 MPD v1 + 1.3 RTE v1 (compliance sells the meeting)
3. 3.2 parent UPI pay + 5.1 real WhatsApp send + 5.2 templates (money + proof)
4. 2.1 register discipline + staff QR + 2.2 marks grid (teacher love)
5. 3.1 parent PWA + push + Hindi (adoption)
6. 4.1 payroll-lite + ECS file (affiliation proof)
7. 1.7→defer; 4.4 boarding timestamps only (law minimum) — full compliance pack in Phase 2
8. 10.1 five design partners live; instrument teacher-minutes, read-rate, collection %

## Full product roadmap (quarters)

- **Q1**: MVP slice above; 5 live schools; metrics baselined.
- **Q2**: NEP pack v1, transport compliance full, safety-audit + verification, diary+e-sign, Student/Staff 360, PTA/SMC, scholarships/APAAR/DigiLocker, automation gallery, offline queues.
- **Q3**: Automation depth (reconciliation auto-match, approval SLAs, watchlists), analytics cockpit, cited NL analytics, UDISE depth.
- **Q4**: Intelligence pilots, open API + sandbox, white-label parent app, multi-branch HQ + group billing, vendor marketplace.

## Top improvements = biggest competitive advantage

1. Collection engine (parent UPI + PIN + dunning + reconciliation) — directly moves school revenue.
2. Honest comms (BSP + read receipts + inbox + Hindi) — the gap every review names.
3. Compliance centers (MPD + RTE ledger + bus-law pack) — nobody else has all three; sells to owners, not clerks.
4. Teacher sub-minute paths (register, marks grid, cover) — adoption where rivals get 10%.
5. Duplicate-proof roster + hash audit — the trust story auditors and principals repeat.

## DO NOT BUILD (enforced)

Face-recognition attendance · open LLM chat for parents/students · parent-facing predictive scores · full-auto timetable flagship · email-channel investment · hostel (without design partner) · public website builder (MPD page only) · LMS/video depth (partner) · auto money movement · auto safeguarding decisions · auto-sends of any kind.


---

## Execution log — 2026-10-04 (this build)

**Shipped (browser + test verified):**
- 0.3 presets: Guided setup in People console (Small 7 / Standard 12 / Large 29 + 3 fee heads, apply tolerates 409s, always available to owner) + 0.5 demo-gating (Today SampleNote only with demo chips; Insights badge/note only while both live doors empty) + 0.6 PWA manifest + Noto stacks + EN/HI toggle (account menu, persisted, 67% honest coverage) + 0.4 HANDOFF traps 12–13.
- 1.2 MPD center: 14-row Appendix-IX wall derived from vault, file/retire, public disclosure wall (PII-free), screens + nav.
- 1.3 RTE manager: overview (25%, seats, claimed/received/pending), lottery import (per-row savepoints, statutory waiver auto-approved, failed[] by row), reimbursements, screens + nav.
- 4.1 Payroll-lite: structures (PAN-checked, bank masked last-4), draft snapshot runs with skipped[], ECS/cash/cheque disburse locks history, screens + nav.
- 0.2 billing: plan+usage read, honest 503 checkout without gateway keys, HMAC webhook flips plan (replay-safe), screen + nav.
- FIX-11 regression test + 4 new SURFACE_DOOR entries + PUBLIC_ALLOWLIST threat notes + PERMISSION-MATRIX regenerated (415 routes, `npm run check` green).

**Verification:** `tsc` + `vite build` green; vitest 64/64; server suites onboard 12/12, wave-b 11/11, mpd-rte-payroll 8/8, guard set (me-effective, door-surface, grants, custom-roles, domain-contracts, door-gating) 65/65; browser walks v16 (4 screens, nav, actions) + v17 (wizard, presets, HI persist, no crashes).

**Deliberately remaining (phased per roadmap):** NEP/HPC pack, full transport compliance (timestamps/attendants/fare engine), BSP send (plumbing ready, logger until keys), parent PWA beyond web toggle (manifest+push-ready shell done; store release later), biometric adapters, hostel/LMS/video (partner), predictions, website builder, multi-branch HQ billing. Test-data note: `Bad Phone Probe2` probe account stays Suspended (history, not deleted — D-35).

## Execution log — batch 2, 2026-10-04 (fees hardening, timetable conflicts, infra/APAAR, health, CPD, 360, diary, automation gallery, approve atomicity)

**Shipped + verified (tests + browser):**
- Fee counter-PIN: `app.fee_pins` (scrypt hash, owner/finance_head enroll) + cash collections by enrolled staff require the 4–6 digit PIN (unenrolled = old behavior; `tests/action-plan-batch2` pins all three states). Sibling discounts + dunning broadcast verified pre-existing (D3 auto-concession at generate; Wave-3 dunning run) — no duplicate doors built.
- Timetable conflicts: `GET /plugins/ops.timetable/conflicts` (teacher/room/section per day×period cell, read-only) + Conflicts panel on the grid (detection, coordinator still resolves).
- UDISE infra: singleton profile + PTR derivation + office write gate; APAAR 12-digit identity per pupil (409 names holder); scholarships ride existing concession kinds (no new table invented).
- PTA/SMC meetings on the MPD screen (minutes ≥10 chars, attendees); Clinic gains RBSK/vaccination checkups + PM-POSHAN meal log (same-date upsert); HR gains CPD ledger (office all, staff own + totals).
- Student 360: `GET /students/:id/360` (money withheld from teacher/counselor — mirrors the obligations door; parent own-child; pupil own-linked) + School-record card on the profile.
- Diary: `POST /announcements/:id/ack` (idempotent) + office ack lists in Receipts (`1 receipt(s) · 1 signed`) + parent Notices card with one-tap Sign on `/parent/family`; `GET /notices` (parent-only, school-wide + own classes, published only).
- Automation gallery: `GET /automation/templates` (6 honest starting points applied through live `/workflow-rules`).
- Approve atomicity (Fix-12): recipients resolved before mutation + resume path for stranded rows; pinned by test; stranded dev row resumed live.

**Verification:** new file `tests/action-plan-batch2.test.js` 9/9; `npm run check` green; `tsc` + build green; vitest 64/64; browser loops v18–v23 (all blocks present, full parent sign-off loop provision→force-change→notice→sign→office count).

**Still open (next):** NEP/HPC pack, BSP send wiring, parent native app, full bus-law pack, biometric adapters, predictions, website builder, HQ billing — per roadmap phasing. Stray dev rows from loop tests (Loop parents, Loop notice) are genuine-shaped functional data, kept.

## Execution log — batch 3, 2026-10-04 (NEP pack, transport compliance, ECS proof, QR, breach, emergency)

**Shipped + verified (tests + browser):**
- NEP pack: 5+3+3+4 stage derivation, Class-6 R3 record (OASIS source), bagless/art/skill log, HPC inputs + live aggregates (attendance/published exams/homework) with teacher-ownership + parent-own scoping, FLN skill levels + class board, skill/elective subject flags; `/nep` screen + role nav (owner/principal/teacher/coordinator/itadmin).
- Transport compliance: daily runs (idempotent) + board/deboard timestamps + dup-direction 409, attendants + police-verification, per-km fares + quotes, inspections, quarterly compliance pack; fare/attendant/inspection/boarding UI on Routes & stops.
- Payroll ECS proof file (disbursed-only, audited read, CSV download button); staff QR day-token + self-scan + office manual mark + HR code card.
- DPDP breach register (72-hour clock: open→contained→closed) + card on Compliance calendar.
- Emergency broadcast (owner/principal compose+approve at once, empty-audience refuses first) + unacked escalation list (phones, audited reads) + Unacked button + parent Sign loop proven end-to-end via UI.
- Automation template gallery (6 honest starting points over live workflow doors).

**Verification:** `tests/action-plan-batch3.test.js` 8/8; drift guards (me-effective, door-surface) green; PERMISSION-MATRIX regenerated (462 routes) + `npm run check` green; tsc/build green; vitest 64/64; browser v18–v24 (all blocks, 360 card, full parent sign-off, R3/fare/QR/breach/emergency/unacked live).

**Still open (next):** BSP send wiring, native parent app, live bus map/ETA (vendor), biometric adapters, predictions, HQ billing, hostel/LMS. Stray loop-test rows are genuine-shaped functional data, kept.

## Execution log — batch 4, 2026-10-04 (hike gate, pupil QR, ETA, stale SLA, rails proof, batch-4 UI)

**Shipped + verified (tests + browser):**
- Fee-hike governance: plan templates carry `hike_pct` + SMC consultation ref; >10% without a fresh (≤180d) SMC record is refused naming the paper; list surfaces both columns.
- Pupil QR: 12-char day codes per class roster (owned-class scoping for teachers) + today-only marking + pupil self-serve day code (portal-bound accounts) + register QR mode (printable sheet + paste box) + My-day-code card on the pupil home.
- Bus ETA: scheduled stop times from run start + offsets with boarding state; run-start buttons per route; Today's-runs card on Transport.
- Stale-approval SLA: open approvals older than N days listed + one-tap digest to owners/principals; Action Center banner only when rotting exists.
- Rails proof: `sendSms` unit-proven (logger ok, E.164, https/auth validation, exact POST shape + auth header via stubbed fetch, secret never logged).
- UI: counter-PIN enrollment on Fees (staff picker) + PIN field in the payment modal (cash only); UDISE readiness panel on Returns; SMC-hike fields on plan create; QR mode; ETA card; stale banner; day-code card.
- Process fix: parity scanner needs literal role lists — `...CONST` spreads replaced with inline literals in transport doors.

**Verification:** `tests/action-plan-batch4.test.js` 5/5 (+rerun 16/16 with drift guards); `npm run check` green; matrix 462 routes; tsc/build/vitest green; browser v24–v27 (all blocks, R3/fare/QR/breach/emergency/unacked, PIN enroll 200, run→board→ETA, QR codes listed).

**Still open (next):** BSP live send (keys), native parent app, live GPS map, biometric hardware adapters, predictions, HQ billing, hostel/LMS/video, DigiLocker. Test/loop rows in dev are genuine-shaped functional data, kept.
