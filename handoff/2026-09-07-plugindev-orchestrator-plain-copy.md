FROM: plugin-agent (EMPLOYEE-2)
TO: orchestrator
SUBJECT: COPY PASS — plain-language server strings · 120/120 · statuses/shapes untouched
DATE: 2026-09-07

---

Direct user feedback: "the words are sophisticated, make them user friendly." This unit
re-words every server-side error/toast string that surfaces to users. **HTTP status codes
and API shapes are IDENTICAL everywhere — message text only.** No logic changed except
the admissions-window message now humanizes dates (pure display). Full suite green:
**120/120, 0 cancelled** (run twice after the final 403 edits; spot 37/37 mid-way).
Note: the suite count is 120, not 114 — concurrent lanes added 6 tests to the tree during
this unit; none of them are mine and all pass.

## The four examples from the brief — all landed

| Before | After |
|---|---|
| `plugin ops.visitors is not enabled for this tenant` | `Visitors is switched off — ask the school owner to turn it on` |
| `subjectRef looks invalid (guardian phone)` | `Please enter a valid guardian phone number` |
| `outside the admission window (02-01..06-30)` | `Admissions are open from Feb 1 to Jun 30` (MM-DD humanized via a 12-entry month table) |
| `weightage_total_enforced: sums to ${total}, not 100` / uuid-guard `id must be a uuid` | `Marks must add up to 100% — these add up to ${total}%` / `This record needs a valid ID` |

## Shared infrastructure (2 files)

- `_shared/lifecycle-gate.js`: gate 409 now maps plugin ids to friendly names (Visitors,
  Exams, Admissions, Health clinic, Fee payments, …; falls back to a capitalized prefix)
  → `"${label} is switched off — ask the school owner to turn it on"`. Every module
  inherits this — the single highest-leverage string in the codebase.
- `_shared/uuid-param.js`: `${n} must be a uuid` → `This record needs a valid ID`
  (all 19 guarded doors inherit).

## admissions.funnel (9)

- `an open enquiry already exists for this guardian, class and session` → `This guardian already has an open enquiry for this class and session`
- `admissionYear must look like 2026-27` → `Admission year should look like 2026-27`
- `admissionYear ${ay} is not the current session — only owner/itadmin may capture…` → `Only the school owner can record admissions for ${ay} — it is not the current session`
- `studentName, guardianPhone, classApplied are required` → `Student name, guardian phone and class are required`
- `guardianPhone looks invalid` → `Please enter a valid guardian phone number`
- `lead not found` → `We couldn't find that enquiry`
- `illegal transition ${a} → ${b} (allowed: …)` → `This enquiry can't move from "${a}" to "${b}"` (jargon dropped; the pair the user chose is kept)
- `stage '${x}' is terminal — immutable` → `This enquiry is closed (${x}) and can't be changed`
- `unknown stage (valid: …)` → `"${to}" is not a stage we know`
- window message humanized (see table above)

## exams.assessment (20)

- 3× `weightage_total_enforced: …` → component variant: `This exam's components must add up to 100% (they add up to ${total}%)`; publish/mark variants: `Marks must add up to 100% — these add up to ${total}%`
- `marks are frozen — exam published (read-only)` → `Marks are locked — this exam is already published`
- `attendance ${pct}% is below the ${minPct}% floor — student not eligible to sit this exam` → `Attendance is ${pct}%, below the ${minPct}% floor — this student can't sit this exam` (numbers kept — they are the useful part)
- `marks must be a non-negative number` → `Marks can't be negative`
- `marks (${m}) exceed maxMarks (${mm})` → `Marks (${m}) can't be more than the maximum (${mm})`
- `maxMarks must be positive` → `Maximum marks must be a positive number`
- `exam already published` → `This exam is already published`
- `exam not published — nothing leaves for the board before kernel approval` (cbse) → `Publish this exam first — reports only exist after publication`
- `no publication action raised for this exam` → `Publish it first — no approval was raised for this exam`
- `kernel approval required — decide the action first (/actions/:id/decide)` → `This needs approval first — decide it in the Approvals queue` (also in dpdp; the route hint is developer-speak)
- `a publication approval is already open` → `A publication approval is already waiting`
- `weightage is frozen — inside the lock window` → `Weightage is locked right now — it can't be changed this close to the exam`
- `adjustedSnapshot.pct must be a finite number in [0,100]` → `The adjusted percentage must be a number from 0 to 100`
- `grade mismatch: ${g} is not derivable from pct ${p} on scale ${s} (${c})` → `${g} does not follow from ${p}% on this scale (it works out to ${c}) — grades are always recalculated`
- `exam/moderation/underlying report not found` → `We couldn't find that exam/review` / `The original report is missing`
- `a moderation proposal is already open` → `A review proposal is already open for this report`
- `moderation already ${st}` → `This review is already ${st}`
- `studentId and marks are required` → `Student and marks are required`; `name and classGrade are required` → `Exam name and class are required`
- `decision must be 'approved' or 'rejected'` → `Decision must be approved or rejected`
- SoD 403s: `proposer may not execute their own publication / decide their own moderation (segregation of duties)` → `The person who raised/proposed this … can't approve/decide it — a second person must`

## pack.dpdp (13)

- `subjectRef (guardian phone) required` → `Please enter the guardian's phone number`
- `subjectRef, purpose, decision ('granted'|'withdrawn') are required` → `Guardian phone number, purpose and a grant/withdraw decision are required`
- `kind must be 'export' or 'erasure'` → `Data request type must be export or erasure`
- `an open ${kind} SAR already exists for this subject` → `There is already an open ${kind} request for this phone number`
- `SAR not found` → `We couldn't find that data request`; `SAR already ${st}` → `This request is already ${st}`
- `not an export SAR` → `Only export requests produce a data bundle`
- `SAR not yet fulfilled (kernel approval + execute pending)` → `This request is still waiting for approval`
- `kernel approval dismissed — SAR cannot execute` → `This request was dismissed, so it can't be carried out`
- `a granted consent artifact is already operative for this subject and purpose` → `Consent is already granted for this purpose`
- SoD 403 → same second-person wording as exams

## hr.leave (10) · health.clinic (10) · ops.visitors (14)

- hr: `staffId (uuid) required` → `Please pick a staff member`; `leaveDate (YYYY-MM-DD) required` → `Please pick a date`; `kind must be one of …` → `Choose a leave type: sick, casual, duty, comp, unpaid or training`; `leaveDate ${d} is in the past (today is ${t} IST)` → `Leave can't be marked in the past (today is ${t})`; `parents are not staff — leave is a staff concept` → `Parents aren't staff, so leave can't be marked for them`; `staff not found`/`leave record not found` → `We couldn't find that staff member/leave record`; duplicate → `This staff member already has leave marked for that day`; `already cancelled` → `This leave is already cancelled`; `date must be YYYY-MM-DD` → `Please use a valid date (YYYY-MM-DD)`
- clinic: `studentId (uuid) required` → `Please pick a student`; `complaint required` → `Please describe the complaint`; `action must be one of …` → `Choose a valid outcome: rest, first aid, sent home or hospital referral`; `temperatureC must be a plausible Celsius value (30–45)` → `Please enter a realistic temperature between 30 and 45°C`; `correction text required` → `Please describe the correction`; `visit/sick pass not found` → `We couldn't find that clinic visit/sick pass`; `an active sick pass already exists…` → `This visit already has an active sick pass`; `cannot revoke from status '${s}'` → `Only an active pass can be revoked (this one is ${s})`
- visitors: `visitorName and purpose are required` → `Visitor name and purpose are required`; `no primary guardian phone on file — manual verification (photo ID at desk) required` → `No guardian phone on file — verify with photo ID at the desk`; `no active pickup OTP (status '${s}')` → `No pickup code is active for this visit (status: ${s})`; `no active code — request a new one` → `That code is used up — request a new one`; `code expired…` → `That code has expired — request a new one`; `too many attempts…` → `Too many wrong attempts — request a new code`; `invalid code` → `That code is not right — check it and try again`; `code required` → `Please enter the pickup code`; state-machine 409s → `Only an expected visitor can be checked in (this one is ${s})` etc.; `studentId, admissionNo or q is required` → `Search by ID, admission number or name`

## payments.upi (11) · pack.cbse (2) · timetable/comms (3) · kernel routes (2)

- upi: `obligation already settled` → `This fee is already settled`; `an open payment attempt…` → `A payment is already in progress for this fee`; `invalid signature` → `Payment could not be verified (signature mismatch)`; `stale event rejected (outside ±${n} min window)` → `Payment event is too old (older than ${n} minutes)`; `webhook not configured` → `Payments are not set up yet`; `malformed payload` → `Payment data could not be read`; `obligationId required` → `Which fee is being paid? (obligationId is missing)`; `obligation/payment not found` → `We couldn't find that fee/payment`; `signature required` → `Payment event was not signed`; `event/EventId required` → `Payment event is missing its event ID`; `paymentId (uuid) required in notes` → `Payment event is missing a valid payment reference`; inline gate `payments.upi is not enabled for this tenant` → `Fee payments is switched off — ask the school owner to turn it on`
- cbse: R6 message → `Set the board affiliation number and academic year before exporting`; `date, grade, section required` → `Date, class and section are required`
- timetable: `absentTeacher required` → `Pick the absent teacher`; comms: `name and body required` → `Template name and body are required`
- routes.js: `/actions/:id/decide` uuid guard → `This record needs a valid ID`; role guard → `Your role (${role}) doesn't allow this action`

## Test assertions updated in the same unit (22 pins, same files' behavior unchanged)

admissions.test (window regex, gate) · dpdp.test (approval regex) · exams.test
(weightage regex, gate) · cbse.test (R6, not-published, gate) · upi.test (not-set-up,
switched-off, too-old ×2, unreadable) · wave1.test (not-set-up) · visitors.test (gate) ·
cycle5-remediation.test (dup-enquiry regex, uuid regex) · cycle6-hardening.test
(valid-ID regex, 0-to-100, does-not-follow-from). All are regex/message pins only —
status and shape assertions untouched.

## Disclosure for your review

- `src/routes.js` is shared with the kernel lane: I changed **two message strings only**
  (decide uuid guard, role 403). No logic, status, or shape. Flagging since the file is
  yours — revert trivially if the release freeze prefers.
- The admissions window message no longer interpolates `${ay}` (shape still `{error}`,
  409) — nothing consumed that interpolation (grep-verified).
- Dev-facing jargon deliberately KEPT where the audience is the operator, not the parent:
  `studentId (uuid) required`-style marks-door guards were re-worded, but machine-shaped
  fields named in validation messages (e.g. `obligationId`) are retained in parentheses
  so integrators can self-debug.

**Files for your commit**: 13 source files (2 shared + 11 modules + routes.js) and 9 test
files, all message-text-only; handoff this file. Suite: 120/120, 0 cancelled (twice).
