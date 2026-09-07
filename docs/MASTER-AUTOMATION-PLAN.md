# SchoolOS — Master Automation Plan (everything, in detail)

Companion to `ROLE-NEEDS.md` (what each role asked for) and `AUTOMATION-PLAN.md` (wave summary). This is the build-grade version: every function of a school, the automation loop for each, and the engineering contract it lands on.

**The automation grammar used throughout:**
`TRIGGER → SYSTEM DOES IT → HUMAN DECIDES THE EXCEPTIONS → RECORD IS PERMANENT`
Nothing consequential happens without a human decision; nothing repetitive waits for one.

---

## M1 · Admissions → Enrollment → Rollover
**Today:** funnel (capture→follow-up→enroll, kernel-gated), per-instance codes, dedupe backstop ✅
| # | Build | Loop | Notes |
|---|---|---|---|
| 1.1 | Digital admission form | Parent submits online (docs/photos) → lands in funnel as a lead | Public form door; upload to tenant store |
| 1.2 | Auto follow-up engine | Lead idle >3 days → task created + opt-out-able WhatsApp nudge | Comms rail template `admit.nudge.v1`; office can snooze |
| 1.3 | Enrollment completion kit | On approve: student row + section + fee plan + ID-card draft + guardian links — one execute | Kernel approve-execute; replaces 6 manual steps |
| 1.4 | **Term rollover wizard** | Year end: promote/detain per student (bulk, exception list), close terms, archive, seed next-year sections — staged exactly like migration (stage → activate) | The riskiest automation; staged + reversible + audited |
| 1.5 | Student ID cards | Photo + class + QR → print sheet/PDF | QR = admission no; no PII in QR |

## M2 · Attendance (students + staff)
**Today:** one-tap marking, autofill from transport ✅, hr.leave roster ✅
| # | Build | Loop |
|---|---|---|
| 2.1 | Absent-alert engine | Marking closes 10:00 IST → guardians of absentees notified (absent.nudge.v1) → unexcused >3 days = concern flag |
| 2.2 | Leave-aware attendance | Approved student leave pre-marks "on leave" (not "absent") — no false alarms |
| 2.3 | Late/early slips | Gate logs student out-of-class → parent notified → record reconciles with attendance |
| 2.4 | Staff attendance | Same door as students; feeds payroll inputs (M8) |

## M3 · Timetable, Substitutions, Duty
**Today:** deterministic suggester, absence_feed live switch ✅
| # | Build | Loop |
|---|---|---|
| 3.1 | Duty auto-handover | Teacher leave approved → free periods → substitution proposal → coordinator one-tap → notify all (teacher, substitute, class) |
| 3.2 | Duty-fairness monitor | Monthly: substitute-load per teacher → auto-balanced proposals next month |
| 3.3 | Exam-day timetable | Exam created → invigilation duties auto-proposed → approve → publish |

## M4 · Homework & Learning
**Today:** learning screens, portfolio, AI ask ✅
| # | Build | Loop |
|---|---|---|
| 4.1 | **Homework plugin** (`learning.homework`) | Assign (20s: class/subject/text/photo/due) → student list → 17:00 parent digest → T-1 auto-reminder to non-submitters → overdue report to teacher (weekly, not naggy) |
| 4.2 | Submission inbox | Student submits text/photo → timestamped → teacher marks reviewed → parent sees "done" |
| 4.3 | Test calendar | Exams + class tests in one student/parent calendar (feeds M13) |

## M5 · Exams & Results
**Today:** creation→weightage→marks→approval→publish→moderation→digest-frozen reports; CBSE checks; OASIS export ✅ (the deepest module already)
| # | Build | Loop |
|---|---|---|
| 5.1 | Results-to-family push | On publish: guardian notification "report card ready" with link (report is already frozen/digest-stamped) |
| 5.2 | Class analytics post-publish | Topic-level weak areas, who needs help — teacher/principal view only |
| 5.3 | Re-evaluation window | Parent applies within N days → kernel action → teacher responds → outcome appended (never overwritten) |

## M6 · Fees & Money
**Today:** UPI links, webhook (fail-closed HMAC), receipts, Tally export, payment matching ✅
| # | Build | Loop |
|---|---|---|
| 6.1 | Dunning ladder | D+7/15/30 gentle reminders (templates), principal-tunable, exemptions list, auto-stop on payment — **never messages the child** |
| 6.2 | Instalments & part-pay | Fee plan per student → part payments tracked → balance recalculated |
| 6.3 | Refunds/adjustments | Request → finance+owner approve (SoD) → execute → Tally |
| 6.4 | Fee forecast | Parent view: "this term you owe X, next instalment on D" |

## M7 · Communication
**Today:** WhatsApp templates + receipts, chat, friendlyErrors ✅
| # | Build | Loop |
|---|---|---|
| 7.1 | Announcement composer | Principal writes once → audience (school/class/staff/parents-of) → in-app + WhatsApp + digest → receipts + read counts |
| 7.2 | **Digest engine** | Parent 17:00 daily (homework/dues/notices/absence) · Principal 07:00 brief (M17) — ONE message, never spam |
| 7.3 | Template library | All sends are named templates, audited, DPDP-compliant content; no free-text to minors |

## M8 · Leave, HR, Payroll inputs
**Today:** hr.leave (mark/cancel/roster), staff.leave events ✅
| # | Build | Loop |
|---|---|---|
| 8.1 | **Student leave letters** | Student/parent applies → class-teacher kernel approval → attendance+timetable+roster informed → status visible |
| 8.2 | Teacher self-leave | Teacher applies (not office-typed) → office/coordinator approves → M3.1 fires |
| 8.3 | Payroll inputs | Month end: staff attendance + duty load + substitutions → salary-sheet export (CSV for their accountant) |
| 8.4 | Duty rosters (exam/supervision/events) | Auto-proposed from availability → approve → notify |

## M9 · Health & Safety
**Today:** clinic (append-first, approved guardian notices, sick passes), incidents ✅
| # | Build | Loop |
|---|---|---|
| 9.1 | **Anonymous safety box** | Student reports (name optional) → ONLY principal/counselor → serious → immediate principal page → append-only → weekly pattern summary (never unmasks) |
| 9.2 | Counselor referral flow | Teacher one-tap concern flag (absence/grades/behaviour pattern) → counselor queue → outcome logged, privacy-tiered |
| 9.3 | Sick-pass → gate integration | Clinic issues pass → gate/exit record matches → guardian notified (already partially live) |
| 9.4 | Emergency broadcast | Critical incident → one authorisation → all guardians (template `emerg.broadcast.v1`, owner+principal only, audited) |
| 9.5 | Drills & inspections | Fire/earthquake drill records + compliance calendar linkage (M15) |

## M10 · Visitors & Gate Security
**Today:** OTP vault, fail-closed release, audited override, guardian-lookup ✅
| # | Build | Loop |
|---|---|---|
| 10.1 | Pre-registered pickups | Parent adds "grandma can pick up on Fri" → gate verifies against allowlist, not just primary guardian |
| 10.2 | Visitor badge printing | Pass → printable badge with QR (no PII beyond first name) |

## M11 · Transport
**Today:** GPS positions, delay guard → kernel approval, attendance autofill ✅
| # | Build | Loop |
|---|---|---|
| 11.1 | Stop ETA to parents | Positions → per-stop ETA → push on delay (delay guard pattern already approval-gated) |
| 11.2 | Route health | Daily: routes late >X min → transport report to principal |
| 11.3 | Boarding/de-boarding scans | Child boards/leaves bus → guardian ping (safety-first; needs QR scan at door) |

## M12 · Library, Inventory, Assets
**Today:** maintenance/work-orders, assets, vendors ✅
| # | Build | Loop |
|---|---|---|
| 12.1 | Library plugin | Catalogue → issue/return by QR → overdue → gentle notice → fine auto-posts to fee ledger (M6) |
| 12.2 | Inventory issue-return | Stationery/uniform/kit issue per student/staff → stock alerts at reorder level |
| 12.3 | Asset lifecycle | Purchase → assign → service (already partly live) → condemn, with audit |

## M13 · Calendar, Events, PTM
**Today:** calendar screen, events spine ✅
| # | Build | Loop |
|---|---|---|
| 13.1 | School calendar (authoritative) | Holidays/exams/PTM/functions — one source, feeds every digest |
| 13.2 | PTM booking | Office opens slots → parent books → reminders → teacher meeting-notes (private) |
| 13.3 | Event consent | Trip/photo consent = templated, one-tap, immutable record (DPDP family) |
| 13.4 | Event RSVP + volunteer sign-up | Function → invite → headcount → volunteer slots |

## M14 · Certificates & Documents
**Today:** documents screen ✅
| # | Build | Loop |
|---|---|---|
| 14.1 | Certificate generator | TC/bonafide/character/study-cert from real data → PDF → **principal signs via kernel approve-execute** → numbered register (TC numbers never reused) |
| 14.2 | Bulk operations | Class-wise ID cards / certificates → print pack |
| 14.3 | Report-card PDFs | Frozen reports → printable board-format cards (uses OASIS-style assembly) |

## M15 · Compliance & Board
**Today:** CBSE rule pack, OASIS export, DPDP consent/erasure/access, hash-chained audit ✅
| # | Build | Loop |
|---|---|---|
| 15.1 | Compliance calendar | Board returns, inspections, fire drills, DPDP audit dates → reminders to owner |
| 15.2 | One-click inspection pack | Attendance+fees+safety+staff-creds bundle PDF for inspectors |
| 15.3 | RTI/records desk | Time-bound access requests on the DPDP door pattern |

## M16 · Front Desk & the AI Receptionist (Wave D crown jewel)
**Today:** Reception surface (AI), visitor desk ✅
| # | Build | Loop |
|---|---|---|
| 16.1 | Appointment engine | Walk-in/parent books principal/teacher slot (ties M13.2) |
| 16.2 | **Voice AI telephony** (`reception.voice`) | Inbound call → AI answers from school data (fees/leave/transport/timetable) → books/complains/escalates → call recording = PII (DPDP consent on answer), per-tenant number, Hindi+English, staff handoff with call summary |
| 16.3 | WhatsApp two-way bot | Same brain as voice over WhatsApp (text) — answers routine queries, opens cases |

## M17 · Intelligence & Oversight
**Today:** Insights, Attention, AI governance/usage, Action Center, audit ✅
| # | Build | Loop |
|---|---|---|
| 17.1 | **Principal's 07:00 brief** | Auto-written plain-language brief: absentees, fee dues, incidents, deadlines, AI actions to review, anomalies — every number links to its screen |
| 17.2 | Early-warning engine | Absence% + grade drop + fee stress + incidents = child-at-risk flag to counselor (privacy-tiered, human decides) |
| 17.3 | Week-at-a-glance for owner | Multi-school (Group) rollup |

---

## The spine every module rides (unchanged, this is why it's fast)
1. **Kernel approval** — proposer ≠ approver, per-instance codes, decide→execute, SoD 403s.
2. **Comms rail** — every notification is a named template with receipts; digests bundle; nothing free-text to minors.
3. **IST time engine** — deadlines/digests/dunning on the school's clock.
4. **Append-only ledgers** — cases, safety box, clinic, consent, TC register.
5. **RLS + role-scoped reads, test-pinned** — the /my-cases lesson institutionalized.
6. **Lifecycle gates** — every module switchable per tenant, instant 409, friendly copy.

## What stays human-only (constitution)
Expulsion/rustication, punishment decisions, hiring/firing, final grade changes after publish (moderation only), emergency broadcast authorization, dunning exemptions, certificate signing, safety-box unmasking (nobody, by design).

## Sequencing & estimate
| Wave | Modules | Est. |
|---|---|---|
| **A · Daily loop** (school runs tomorrow) | 4.1–4.3 · 8.1 · 2.1–2.3 · 7.1–7.2 · 5.1 | 14–18h |
| **B · Safety & trust** (child protection) | 9.1–9.3 · 13.2–13.3 · 11.1 · 10.1 | 10–14h |
| **C · Office engine** (money+paper+people) | 6.1–6.4 · 14.1–14.3 · 1.1–1.2 · 12.1–12.2 · 8.3 · 17.1 · 15.1–15.2 · 1.4 | 16–20h |
| **D · Voice & bots** (the original promise) | 16.2–16.3 · 16.1 | 10–14h |
| **E · Intelligence & polish** | 17.2–17.3 · 5.2–5.3 · 3.2–3.3 · rest | 8–12h |

**Total: ~58–78 factory-hours to every line item above.**
Each wave ships verified (tsc · suite · factory-check · audit), migrations numbered, residue itemized — the same factory discipline that produced the current release.

## Dependencies (what blocks what)
- 2.2 ← 8.1 (leave-aware attendance needs student leave)
- 7.2 ← 4.1, 6.1, 13.1 (digest bundles homework/dues/calendar)
- 6.1 ← 7.3 (dunning uses template library)
- 14.1 ← nothing (data already real) — early win
- 17.1 ← 2.1, 6.1, 9.x (brief aggregates their outputs)
- 16.2 ← 7.3 + 9.4 consent posture (recordings are PII)
