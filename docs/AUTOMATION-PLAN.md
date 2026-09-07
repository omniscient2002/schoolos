# SchoolOS Full-Automation Plan — "Run the whole school"

Method: walked a day in each role's shoes, wrote down what they'd ask for, mapped it against what exists (12 plugins, kernel approvals, 65 screens, 30 migrations), then sequenced the gaps into four build waves.

---

## 1 · What each role actually asks for (role-voice)

### 🎒 Student (Class 3–12)
> "What's due today? I want to see my homework and submit it. I want to ask my doubt the moment I have it. If I'm sick, I want to apply for leave without finding a paper form. When are my marks coming? Where is my bus? I want to tell someone if something bad happened — even without my name on it."

**Wants:** today view (exists) · homework list + submit (MISSING) · doubt asking (exists: Ask) · leave letter (MISSING) · results when published (exists) · bus ETA (GPS exists, parent/student surface MISSING) · a safe, optional-anonymous way to report bullying (MISSING).

### 👪 Parent
> "Is my child safe and in school right now? What's the homework? Fees — tell me what's due and let me pay by UPI with a receipt. If something happens to my child I want to complain and know someone is acting on it. Send consent forms I can sign from my phone. Don't make me chase the school on WhatsApp groups."

**Wants:** absent-today alert (MISSING) · homework visibility + reminders (MISSING) · fees+UPI (exists) · complaints with follow-up (exists — built this session) · leave application for child (MISSING) · one-tap event consents (DPDP consent exists; trip/photo event consent MISSING) · PTM booking (MISSING) · bus ETA + delay alerts (delay alerts exist; ETA surface MISSING) · announcements as proper notices (WhatsApp exists; compose-surface MISSING).

### 👩‍🏫 Teacher
> "Give me my 30 seconds of attendance, not 10 minutes. Let me assign homework and let the system remind parents — I'm not a debt collector. Marks entered once should become report cards without me touching Excel. When I'm on leave, hand my duties to someone automatically. Keep parent chat inside the school, not on my personal number."

**Wants:** one-tap attendance + autofill (exists) · homework assign/track/auto-remind (MISSING) · marks→report cards (exists) · substitution suggestions (exists) · leave with auto duty-handover (hr.leave exists; duty auto-reassign MISSING) · in-school parent messaging (chat exists) · student doubt routing to the right teacher (partially — Ask is AI-first) · discipline notes (cases exist).

### 👨‍💼 Principal
> "One screen: what needs MY decision today, what's slipping, who's absent, what did the AI do. Fees health with gentle escalation I control. Fair duty across teachers. Board compliance in one export. Announcements I write once and reach every parent properly. Every serious incident with a full, fair chain."

**Wants:** action center (exists) · fee dunning ladder (MISSING) · duty-fairness view (MISSING) · CBSE/board exports (exists: cbse pack) · announcement composer (MISSING) · incident chains (exists) · AI oversight (exists) · staff appraisals (MISSING, later) · certificates signing (MISSING).

### 🏢 Office / Front-desk staff
> "Admissions follow-ups on their own. Phone answered even when I'm at lunch. Receipts and Tally without re-entry. Visitor passes that keep children safe. Certificates (TC, bonafide) generated, not handwritten."

**Wants:** funnel automation (exists) · AI receptionist on real phones (DEFERRED — telephony) · fees/receipts/Tally (exists) · visitors (exists) · certificate generator (MISSING) · PTM scheduling (MISSING) · inventory/library (deferred) · staff attendance/payroll inputs (partial).

---

## 2 · Gap list → four waves

### Wave A — The Student-Parent Daily Loop (highest value, all patterns exist)
| Build | What "automated" means | Owner lane | Est. |
|---|---|---|---|
| **Homework** (plugin `learning.homework`) | Teacher assigns → students see it → parent gets a daily digest at 5pm → non-submission nudges automatically, never the teacher | plugin lane | 3–4h |
| **Student leave letters** (plugin `students.leave`) | Student/parent applies → class teacher approves (kernel action) → attendance + timetable + roster informed automatically | plugin lane | 2–3h |
| **Absent-today parent alert** | Attendance closes 10am → comms rail auto-notifies guardians of absentees (composable with clinic notice pattern) | plugin lane | 1–2h |
| **Announcement composer** | Principal writes once → picks audience (school/class/parents-of) → template send with receipts, audited | UI + plugin | 2–3h |
| **Parent "My child today"** | One card: present/absent, homework due, fees due, bus status, clinic visits | UI lane | 2–3h |

### Wave B — Safety & Trust (the child-protection extension of this session's work)
| Build | What "automated" means | Owner lane | Est. |
|---|---|---|---|
| **Anonymous safety box** | Student reports bullying/safety concerns, optionally anonymous → kernel-gated route to principal/counselor with the same SoD as visitor release; append-only like the audit ledger | plugin lane | 2–3h |
| **Event consent** (trips/photos) | Template consent → one-tap parent response → DPDP-style immutable record | plugin lane | 2h |
| **Bus ETA to parents** | GPS positions → per-stop ETA + delay push (delay guard pattern exists) | plugin lane | 2h |
| **PTM booking** | Slot calendar → parent picks → reminders → teacher notes post-meeting | UI + plugin | 2–3h |

### Wave C — Office automation (staff superpowers)
| Build | What "automated" means | Est. |
|---|---|---|
| **Fee dunning ladder** | 7/15/30-day gentle reminders (template sends), principal-tunable, never shames a child | 2h |
| **Certificate generator** | TC/bonafide/character from real data → PDF → principal signs (approve-execute) | 3h |
| **Library & inventory** (deferred plugins get started) | Issue/return, fines to fees, stock alerts | 4–5h |
| **Duty fairness** | Duty rosters balanced automatically from hr.leave + timetable | 2h |

### Wave D — The original promise: AI Receptionist on real phones
| Build | Notes |
|---|---|
| Telephony plugin (`reception.voice`) | Inbound voice AI: answers, answers queries from school data, books appointments, takes complaints (→ cases), escalates to staff. Needs: SIP/Voice provider, per-tenant numbers, consent recording, Hindi/English. Largest single build; deserves its own red-team cycle (call recordings = PII). Est. 8–12h |

---

## 3 · Non-negotiables carried into every wave
- Kernel-approval for anything touching money, marks, or children (SoD, per-instance codes).
- Append-only where trust matters (complaints, safety box, clinic).
- Plain language in every new string (unit-18 standard).
- Privacy boundaries proven by test (the /my-cases lesson: role-scoped reads are pin-tested, not assumed).
- Every unit passes the full ritual: tsc · suite · factory-check · audit.

**Total to "everything automated" (A–C): ~25–30 factory-hours. Wave A alone: ~11–15h.**
