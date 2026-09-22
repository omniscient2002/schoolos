# SchoolOS — Library Domain: Complete Knowledge & Design

> **Purpose:** the single document that explains the library domain end to end — every table, every
> server door, every gate, every screen, every test, and the full target design. Read this to learn the
> system; read §C to build the next version.
>
> **Status:** AS-BUILT = v1 lending desk (shipped). TARGET = v2 full LMS (design approved, not built).
> **Owner decisions locked:** dedicated `librarian` role · owner+principal enable/configure · owner/principal
> see aggregates only · configurable identifiers · build all at once after sign-off.

---

# PART A — DOMAIN CONCEPTS (the vocabulary)

| Term | Meaning in SchoolOS |
|---|---|
| **Title / Book** | A catalog record (`library.book`) — the bibliographic entity. One title has many physical copies. |
| **Copy** | A physical book on the shelf. v1 has no copy rows (uses `copies_total`); v2 adds `library.copy`. |
| **Accession number** | Sequential register number a school writes in its accession register. One identifier scheme option. |
| **Call number / shelf location** | Where the copy lives on the shelf. |
| **Circulation** | Issue + return activity. |
| **Loan** | One copy out to one borrower (`library.loan`). |
| **Borrower** | v1: a student. v2: a student **or** any staff user. |
| **Due date** | Date the copy must be returned. v1 fixed-ish; v2 policy-driven with librarian override. |
| **Overdue** | `status='issued'` and `due_on < today`. |
| **Fine** | Money owed for late return / damage / loss. v1: `fine_cents` on the loan. v2: separate `library.fine` ledger. |
| **Reservation / Hold** | A queued request for a title that is (or will be) available. v2 only. |
| **Renewal** | Extending a loan's due date. v2 only. |
| **Retire** | Removing a title from future issue while keeping history. |
| **Withdraw** | Removing a physical copy (lost/damaged/discarded). v2. |
| **OPAC** | Online Public Access Catalog — the borrower-facing search. v2 screen `/library`. |
| **Desk** | The librarian's management surface. |
| **Librarian** | The single role that runs the library. |

---

# PART B — AS-BUILT (v1 lending desk) — HISTORICAL

> **E4 · This part describes the v1 desk and is kept for history only.** The shipped library is **v2**
> (`server/src/plugins/library/manifest.js` version `2.0.0`; migrations 047/108/111): a dedicated
> `librarian` role, per-copy tracking, holds/FIFO, a fines ledger, acquisitions and tenant-configurable
> identifiers. The v1 staff gate and student name-match described below no longer exist. For the shipped
> behaviour, read PART C (target design) and `docs/LIBRARY-PERFECT-100.md`.

## B1. Plugin identity & lifecycle

| Property | Value | Source |
|---|---|---|
| Plugin id | `library` | `server/src/plugins/library/manifest.js` |
| Version | 1.0.0 | manifest / migration 047 |
| Class | **C** in the server manifest & migration; **A** in the client registry (inconsistency) | `manifest.js`, `app/src/plugins/pluginRegistry.ts:70` |
| Trust | T1 | `047_library.sql:80` |
| Registry row | created by migration 047, status `registered` | `047_library.sql:73-100` |
| Capability contract | `library.lending` 1.0.0 | `047_library.sql:103-122` |
| **Enablement** | **DEFAULT_ON in the server catalog** + `defaultEnabled:true` in the client registry — so every school is born with it on | `server/src/plugin-catalog.js:54`, `pluginRegistry.ts:80` |
| Enable/disable doors | `require('owner','itadmin')` | `server/src/routes.js:2086` (enable), `:2160` (disable) |
| Lifecycle gate | every door calls `makeLifecycleGate(sysq, 'library')`; disabled ⇒ **409** | `index.js:33` |
| Manifest permissions | `students.read`, `events.emit`, `audit.request` | `manifest.js` |
| Client registry permissions | adds `actions.raise` (server manifest does not) | `pluginRegistry.ts:76` |
| Settings | `fine_per_day_cents` (integer, default 500 paise = ₹5/day) | `manifest.js`, `047_library.sql:91` |
| Data residency | IN | `047_library.sql:94` |

**Drift worth knowing (v1):** the client registry says class `A` and grants `actions.raise`; the server says
class `C` and does not. The registry is the client mirror; the server manifest is authoritative.

## B2. Data model (v1)

### `library.book` — the catalog
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK app.tenants | |
| code | text | `UNIQUE(tenant_id, code)`; server generates `LIB-<ts36>-<hex>` if absent |
| title | text | required |
| author | text | optional |
| category | text | optional |
| copies_total | int | `CHECK (copies_total >= 0)` |
| status | text | `available \| retired` |
| created_by | uuid | |
| created_at | timestamptz | |
Index: `book_tenant_title_idx (tenant_id, title)`.

### `library.loan` — the loan ledger
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK app.tenants | |
| book_id | uuid FK library.book | |
| student_id | uuid FK app.students | **students only** |
| issued_by | uuid FK app.users | the staffer who issued |
| issued_at | timestamptz | |
| due_on | date | |
| returned_at | timestamptz | null while out |
| fine_cents | int | `CHECK (fine_cents >= 0)`, computed **once** at return |
| status | text | `issued \| returned \| lost` |
| created_at | timestamptz | |
Indexes: `loan_tenant_student_idx (tenant_id, student_id)`, `loan_tenant_status_idx (tenant_id, status, due_on)`.

### RLS & grants
- Both tables: `ENABLE` + `FORCE ROW LEVEL SECURITY`, policy `tenant_isolation` using `tenant_id = app.current_tenant()` (rewritten by 074 from 047's inline form).
- App role: `GRANT SELECT, INSERT, UPDATE` — **no DELETE** (D-35). Retire is an UPDATE.

### The derived-availability law
`available = copies_total − count(open loans)` where open = `status='issued' AND returned_at IS NULL`.
There is deliberately **no stored `copies_available`** column — it can never desync. The issue door recomputes
it under the book's `FOR UPDATE` lock, so two desks racing the last copy cannot both win.

## B3. Server API — every door (v1)

All doors: `preHandler = [require(...), (uuidParams), lifecycleGate]`, all run inside `withUser(tenant, role)`
so RLS applies. `bad(reply,msg,code)` returns `{ error }`.

| # | Method & path | Gate | Inputs | Behaviour | Errors | Side effects |
|---|---|---|---|---|---|---|
| 1 | `POST /plugins/library/books` | `require(owner,principal,coordinator,facilities)` | `title`(req), `author`, `category`, `copies_total\|copiesTotal`, `code` | insert title; auto-generate code if absent; code ≤40 | 400 title/copies | emit `library.book.added.v1`; audit "Book added to catalog" |
| 2 | `GET /plugins/library/books` | staff | `?search=` or `?q=` (ILIKE-escaped) | list ≤300 titles + derived `available`/`openLoans` | — | none |
| 3 | `POST /plugins/library/books/:id/retire` | staff + uuid | — | lock book; refuse if any open loan; `status='retired'` | 404, 409 already-retired, 409 copies out | emit `library.book.retired.v1` (**undeclared**); audit "Book retired" |
| 4 | `POST /plugins/library/loans` | staff | `bookId`, `studentId`, `dueOn`(YYYY-MM-DD) | lock book; book available; student active; availability check; insert loan | 400 missing/date, 404 book/student, 409 retired/inactive/no copies | emit `library.loan.issued.v1`; audit "Book issued" |
| 5 | `POST /plugins/library/loans/:id/return` | staff + uuid | — | lock loan; compute `fine = max(0, whole UTC days late) × perDay`; mark returned | 404, 409 already-returned | emit `library.loan.returned.v1`; audit "Book returned" |
| 6 | `GET /plugins/library/loans` | staff | `?state=open\|all`, `?studentId=` (uuid-validated) | list ≤300 loans, `overdue` flag | 400 bad uuid | none |
| 7 | `GET /plugins/library/overdue` | staff | — | issued & `due_on < today`, joins primary guardian phone; **full phone only for owner/principal/coordinator**, masked for facilities | — | none |
| 8 | `GET /plugins/library/loans/mine` | `require(student)` | — | resolve own student by **name-match**; own loans ≤100 | — | none |

**Fine math (door 5, `index.js:186-196`):** whole days late on the **UTC** calendar, floored at 0. The due day
itself is never charged; an early return is never fined. UTC is deliberate so the result does not depend on
the server's session timezone (an IST session made a 3-day-late loan read as 4 days late before 05:30 IST).

## B4. Events & audit (v1)

**Emitted:** `library.book.added.v1`, `library.loan.issued.v1`, `library.loan.returned.v1`, and (undeclared)
`library.book.retired.v1`. Payloads carry ids and counts, never borrower PII beyond a display label.

**Audit actions:** "Book added to catalog", "Book retired", "Book issued", "Book returned" — written through
`requestAudit` in the same transaction, `actorRole` forced to `plugin:library`, policy `Library desk norms`.

**Declaration drift:** `manifest.js` publishes only `added/issued/returned`; the code also emits `retired`.
The capability contract lists the same three. v2 fixes the declaration.

## B5. Settings (v1)
`app.plugins.settings` for `library` = `{ "fine_per_day_cents": 500 }`, validated by the settings contract.
Read at return time via the owner path (`sysq`).

## B6. RBAC (v1) — exactly who can do what

```
Server STAFF  = owner, principal, coordinator, facilities   (all 6 management doors)
Server STUDENT= student                                     (/loans/mine only)
```

| Actor | Catalog list | Add/retire | Issue/return | Loans/overdue | My loans |
|---|---|---|---|---|---|
| owner | ✓ | ✓ | ✓ | ✓ | — |
| principal | ✓ | ✓ | ✓ | ✓ | — |
| coordinator | ✓ | ✓ | ✓ | ✓ | — |
| facilities | ✓ | ✓ | ✓ | ✓ | — |
| teacher | ✗ (403) | ✗ | ✗ | ✗ | — |
| student | ✓ (door 2 is staff-gated — actually 403; catalog visible only via the UI which calls it) | ✗ | ✗ | ✗ | ✓ |
| parent | ✗ | ✗ | ✗ | ✗ | ✗ |
| librarian (custom role) | ✓ via mask | ✓ via mask | ✓ via mask | ✓ via mask | — |

**Custom-role overlay (D-43):** `server/src/custom-roles.js` masks are enforced on plugin doors. The shipped
"Librarian" preset (`app/src/screens/RolesAdmin.tsx:63-79`) is base `teacher` + an allow-list of the library
doors. Without the preset, a plain teacher is 403 (baseline pinned by `tests/rbac-plugin-edge.test.js:92-93`).
This is the only "librarian" that exists today — and it also inherits a teacher plane.

## B7. Frontend surfaces (v1)

| Surface | File | Notes |
|---|---|---|
| Route `/library` | `app/src/App.tsx:415` | `S` (guard+shell) → `KernelGate plugin="library"` → `LibraryLive`. Gated by **plugin enablement only**, not role. |
| Nav entry | `app/src/components/Shell.tsx` | present for **principal** (:70), **teacher** (:81), **owner** (:129), **student** (:205). Filtered by plugin enablement + `canSurface(effective)`. |
| Live screen | `app/src/screens/LibraryLive.tsx` | `isStaff` = owner/principal/coordinator/facilities **or** a custom mask granting the doors; `isStudent`. Add-book form, issue form (book dropdown + **raw Student ID text** + due date), open-loans table with one-tap Return, student "My books", catalog search, overdue table. |
| Attention widget | `app/src/plugins/widgets/LibraryOverdue.tsx` | Registered `library.overdue` in `registerWidgets.ts:8`. **Renders hardcoded fixture data** (Diya Mehta / Advait Bose) — honesty gap. |
| Demo screen | `app/src/screens/Library.tsx` | Seeded-fiction demo (`BOOKS`/`LOANS` constants). **Not routed** — the route uses `LibraryLive`. Dead code. |
| Client service | `app/src/services/adminApi.ts:75-108` | `libraryBooks`, `libraryAddBook`, `libraryIssue`, `libraryReturn`, `libraryLoans`, `libraryOverdue`, `libraryMyLoans`. |
| Mask mirror | `app/src/lib/grants.ts` | `roleOrGrant` — rendering hint only. |
| Registry | `app/src/plugins/pluginRegistry.ts:70-82` | nav + route + attention slot. |

## B8. Test coverage (v1)

| Test file | What it pins |
|---|---|
| `server/tests/wave-b.test.js:156` | add book (1 copy) → issue → second issue **409 "no copies available"** → overdue list → return computes fine → re-issue after return → student `/loans/mine` |
| `server/tests/rbac-plugin-edge.test.js:70` | D-43: a custom librarian role (base teacher) reaches the library; plain teacher 403; finance refused |
| `server/tests/frontend-grants.test.js` | the client mask mirror (`patternCovers`/`granted`) incl. library doors |
| `server/tests/plg-permissions.test.js:71-102` | declared permissions are enforced; drift denies the door |
| `server/tests/dat2-reference-integrity.test.js` | FK census covers `library.loan.student_id` etc. |
| `wave-c`, `cycle6-hardening`, `governance`, `me-effective`, `next10-followups`, `plg-ai-budget`, `plg-entitlement`, `plg-enable-metadata`, `rails-catalog-otp`, `plugins` | RLS, lifecycle, entitlement, capability, enable-metadata |

## B9. Known gaps (v1) — mapped to the owner's complaints

| # | Gap | Evidence |
|---|---|---|
| G1 | **Owner/principal/facilities are de-facto librarians** — the desk is gated on a broad staff list | `index.js:31` |
| G2 | **Ships on by default** — no opt-in decision | `plugin-catalog.js:54`, `pluginRegistry.ts:80` |
| G3 | **No real `librarian` role** — only a cosmetic preset that inherits the teacher plane | `RolesAdmin.tsx:63-79` |
| G4 | **Nav is enablement-only** — every staffer/student sees a Library entry | `Shell.tsx` nav arrays |
| G5 | **Students only can borrow** — no teacher/staff borrowing | `library.loan.student_id` |
| G6 | **No reservations/holds** | schema |
| G7 | **No notifications** — no due/overdue/parent alerts | code |
| G8 | **No per-copy tracking** — cannot express a lost/damaged copy | `copies_total` |
| G9 | **Fake overdue widget** | `LibraryOverdue.tsx` |
| G10 | Class A/C + `actions.raise` drift | manifest vs registry |
| G11 | Event declaration drift (`retired` undeclared) | `index.js:121` |
| G12 | **Student identity is a name-match pin** — fragile | `index.js:43-48` |
| G13 | Issue UI requires typing a student **UUID**; no name search | `LibraryLive.tsx:144` |
| G14 | No pagination beyond hard `LIMIT 300` | doors 2/6 |

---

# PART C — TARGET DESIGN (v2 full LMS)

## C1. Access model (approved)

| Surface | student | teacher/staff | librarian | owner/principal |
|---|---|---|---|---|
| Catalog search + detail | ✓ | ✓ | ✓ | ✓ |
| Reserve / hold | ✓ | ✓ | ✓ | ✓ |
| **Suggest a book not in the catalog** | ✓ | ✓ | ✓ | ✓ |
| Manage purchase requests (approve/order/added) | ✗ | ✗ | ✓ | ✗ |
| My loans / fines / renew | ✓ | ✓ | ✓ | ✓ |
| Desk (catalog CRUD, issue, return, holds, fines, reports) | ✗ | ✗ | ✓ | ✗ |
| Notification & loan-policy settings (due reminders, channels, periods, fines) | ✗ | ✗ | ✓ | ✓ |
| Ops dashboard (aggregates only) | ✗ | ✗ | ✓ | ✓ |
| Enable/configure plugin · identifier/catalog scheme | ✗ | ✗ | ✗ | ✓ (owner+principal) |

**`librarian` is a new 14th built-in role.** It has no fees/audit/people/insights. Home = `/library/desk`.
Owner/principal are denied every desk door server-side, not just hidden.

## C2. Enabling flow

```
owner/principal → Modules → Library → Enable
   server enable door widened to owner|principal|itadmin
   → plugin status enabled; borrower catalog + nav appear
   → "Set up library" wizard:
        ① Identifier scheme (accession | barcode | isbn | qr | custom)
        ② Loan policy (days, renewals, fines; per borrower-type overrides)
        ③ Create the librarian account (people.admin, role=librarian, temp pw once)
   done → status active; checklist closes
Desk stays LOCKED until a librarian exists; re-locks if none remain (data retained).
Disable → every door 409 (lifecycle), data retained.
```

## C3. Per-tenant configuration

```json
{
  "identifier_scheme": "accession",
  "identifier_prefix": "LIB", "accession_start": 1, "accession_padding": 5,
  "auto_generate_copy_codes": true, "custom_identifier_label": "Accession No",
  "barcode_symbology": "code128", "scan_accepts": ["copy_code","barcode","isbn","accession"],
  "default_loan_days": 14,
  "default_loan_days_by_type": { "student": 14, "teacher": 21, "staff": 21 },
  "max_open_loans_by_type":     { "student": 2,  "teacher": 5,  "staff": 5 },
  "renewal_limit": 1, "renewal_days": 7,
  "allow_self_reserve": true, "max_reservations": 3, "reservation_hold_days": 2,
  "allow_acquisition_requests": true, "acquisition_votes": true, "max_open_acquisition_requests": 5,
  "grace_days": 0, "fine_per_day_cents": 500, "fine_cap_cents": 20000,
  "lost_charge_percent": 100, "allow_fine_waiver": true,
  "notify_channels": ["in_app","whatsapp"], "notify_parent": true,
  "due_reminder_days_before": [2, 1], "overdue_repeat_days": 7, "quiet_hours_ist": [21, 8]
}
```
Validated by `server/src/settings-contract.js`; unknown keys 400.

**Edit authority (per key group):**
- **owner/principal** — identifier/catalog scheme (`identifier_scheme`, `identifier_prefix`, `accession_*`,
  `auto_generate_copy_codes`, `custom_identifier_label`, `barcode_symbology`, `scan_accepts`) and the initial
  values of everything during setup.
- **librarian** — operational policy and **all notification settings**: `default_loan_days*`, `max_open_loans_by_type`,
  `renewal_*`, `allow_self_reserve`, `max_reservations`, `reservation_hold_days`, `grace_days`,
  `fine_per_day_cents`, `fine_cap_cents`, `lost_charge_percent`, `allow_fine_waiver`, `notify_channels`,
  `notify_parent`, **`due_reminder_days_before`**, `overdue_repeat_days`, `quiet_hours_ist`.

Enforced by door, not by UI: `/plugins/library/settings` (owner/principal, full schema) and
`PUT /plugins/library/desk/settings/notifications` (**librarian**, notification keys only) — both validate
through the settings contract, so a librarian cannot change the identifier scheme and owner/principal can.

## C4. Book identification (per tenant)

| Scheme | Meaning | Generated | Scan resolves |
|---|---|---|---|
| accession | sequential register no. | auto | copy_code/accession |
| barcode | machine symbology | auto (code128) | barcode |
| isbn | publisher ISBN as title key | manual/lookup | isbn13/10 |
| qr | QR payload of copy id | auto | qr text |
| custom | tenant label + free value | manual | custom value |

Scan box accepts any configured `scan_accepts` value and resolves to a copy/book.

## C5. Data model v2

```
app.student_accounts (id, tenant_id, student_id -> app.students, user_id -> app.users,
                      UNIQUE(tenant_id,student_id), UNIQUE(tenant_id,user_id))
library.book  + subtitle, author, co_author, publisher, edition, pub_year, language,
                isbn10, isbn13, subject, category, dewey_code, description,
                shelf_location, price_cents, acquired_on, vendor, bill_ref,
                book_type ∈ book|reference|magazine|journal|other,
                status ∈ active|retired, cover_file_id, updated_at
library.copy  (id, tenant_id, book_id, copy_code UNIQUE(tenant,code), barcode,
               accession_no, status ∈ available|issued|reserved|lost|damaged|withdrawn,
               condition, acquired_on, notes)
library.loan  + copy_id, borrower_type ∈ student|staff,
                borrower_student_id, borrower_user_id (exactly one),
                returned_by, return_condition, renewal_count, last_renewed_at,
                source ∈ walk_in|reservation,
                CHECK num_nonnulls(borrower_student_id,borrower_user_id)=1,
                UNIQUE index one open loan per copy
library.reservation (id, tenant_id, book_id, borrower_*, status ∈ requested|ready|fulfilled|expired|cancelled,
                     queue_no, requested_at, ready_at, expires_at, fulfilled_loan_id,
                     partial unique one active per borrower per title)
library.fine  (id, tenant_id, loan_id, borrower_*, cause ∈ overdue|damage|lost,
               amount_cents, status ∈ outstanding|paid|waived, assessed_at, settled_at, settled_by, notes)
library.acquisition_request (
               id, tenant_id,
               title, author, isbn, note,                 -- what the borrower asked for
               requested_by_user_id, requested_by_student_id,  -- exactly one
               normalized_key,                            -- lower(title)|lower(author) for de-duping demand
               status ∈ requested|approved|rejected|ordered|added|cancelled,
               vote_count int DEFAULT 1,
               decided_by, decided_at, decision_note,
               added_book_id -> library.book,             -- set when the title lands in the catalog
               created_at, updated_at)
library.acquisition_vote (id, tenant_id, request_id, voter_user_id, voter_student_id, created_at,
               UNIQUE (tenant_id, request_id, COALESCE(voter_student_id, voter_user_id)))
```
All: FORCE RLS + `tenant_isolation`; app role SELECT/INSERT/UPDATE (no DELETE); composite tenant-aligned FKs.

## C6. Lifecycles

### Walk-in issue
```
borrower picks book → librarian scans copy → scans/searches borrower
   identity confirmed · policy check (max loans, dues, availability, holds)
   due date prefilled from policy → may override → confirm
   copy.status=issued · loan row · hold fulfilled if any · event+audit · receipt
```

### Reservation / pre-book
```
borrower searches → Reserve → queue_no FIFO
copy freed → oldest 'requested' → 'ready' + expires_at → notify borrower(+parent)
desk: scan borrower → issue → reservation 'fulfilled' + loan(source=reservation)
not collected → 'expired' → notify → queue advances
```

### Return
```
scan copy → open loan → condition ok|damaged
   overdue fine = max(0, whole days late − grace) × per_day, capped
   damage/lost → separate fine rows
   copy.status=available|damaged|lost → queue advances → receipt
```

### Renewal
```
renew if renewal_count < limit, no 'ready' hold on title, no outstanding dues (configurable)
→ due_on += renewal_days, renewal_count++, event+audit
```

### Overdue sweep (day-worker, IST, deduped)
```
due−reminder → "due soon"; due<today → "overdue" (repeat every N days)
parent notified when borrower is student and notify_parent
librarian ops feed updated; fine row (overdue) maintained
dedup_key e.g. library:overdue:<loan>:<date>; quiet hours honoured
```

### Lost / damaged
```
mark copy lost/damaged → close open loan (lost) → replacement fine per lost_charge_percent
copy off availability → refund/waive supported (librarian)
```

### Acquisition request (suggest a book to buy)
```
borrower searches catalog → not found → "Request this book"
   title/author/isbn/note; if allow_acquisition_requests is off → honest refusal
   de-dupe by normalized_key (lower(title)|lower(author)):
     an existing open request → add a VOTE (acquisition_votes) and show the demand count
     else create request status 'requested' (cap max_open_acquisition_requests per borrower)
librarian desk → "Purchase requests" queue, sorted by vote_count then age
   decide: approve (intent to buy) | reject (reason) | ordered | added
added → set added_book_id, notify every requester + voter, offer each a RESERVE
"Most requested" → ops dashboard demand panel + CSV (aggregate, no names)
```

## C7. Notifications

| Trigger | Borrower | Parent | Librarian ops |
|---|---|---|---|
| Reservation ready / expired | ✓ | ✓ | ✓ |
| **Due reminder (each configured day before: e.g. 2d and 1d)** | ✓ student **and staff** | ✓ if student | — |
| Overdue (day 1, repeat) | ✓ student **and staff** | ✓ if student | ✓ dashboard |
| Issue / return receipt | ✓ | optional | — |
| Fine raised / waived | ✓ | ✓ | ✓ |
| Copy lost/damaged | ✓ | ✓ | ✓ |
| **Acquisition request decided** (approved/rejected/ordered) | ✓ requester | — | — |
| **Requested title added to catalog** | ✓ requester + voters | — | ✓ |
| **Request demand reaches N votes** | — | — | ✓ |

**Due reminders apply to every borrower type.** `due_reminder_days_before` is a per-tenant list; for each
offset the day-worker fires one reminder to the borrower (student **or** staff) and, when the borrower is a
student and `notify_parent` is on, to the parent. Deduped per loan per offset (`library:due:<loan>:<offset>`) so
a re-run never double-sends. If the list is empty, no reminders fire (configurable off).

**Delivery honesty (platform law PRD-13/PRD-17):** with no sms/email/whatsapp rail configured, a reminder must
**not** claim it was delivered. The in-app row (the bell) is always written — it is a real delivery. The outbound
comms row is `queued` when a rail is configured and the day-worker lets the dispatcher carry it; when no rail is
configured the in-app notification is the delivery and the operator-facing log says so (`channel: 'in_app',
provider: 'none'`). No row is ever marked `delivered` without a provider receipt.

Mechanism: `app.notifications` (in-app), `app.communications` (rails, audience_json, dedup_key),
`app.outbox` + dispatcher, `day-worker` sweep. Parent via `family.child_link`; student via `student_accounts`.

## C8. Screens — “how it looks”

### Owner/principal — `/library/insights` (aggregates only)
```
┌ Library — operations ───────────────────────────── [30d ▾] [Export CSV] ┐
│  on loan 184 · overdue 27 · available 1,412 · collection in use 63%     │
│  Loans/day sparkline (30d)                                              │
│  Top titles │ Overdue aging (1–7 / 8–30 / 30+) │ Reservations queue     │
│  Fines outstanding ₹3,450 · collected ₹1,200 · waived ₹300              │
│  Dead stock 214 · Lost this term 6 · Catalog gaps 12                    │
└─────────────────────────────────────────────────────────────────────────┘
```

### Librarian desk — `/library/desk`
```
Dashboard: on loan · overdue · holds ready · available
           Needs you: 3 holds ready · 27 overdue · 2 damaged · 5 purchase requests
           Quick: Add book · Add copies · Members · Fines · Reports · Purchase requests · Setup
Issue:     Copy [scan/search] → Borrower [scan/search] → Reserved? → Due date [prefill/override] → Issue
Books:     searchable table (title, author, code, category, copies total/available) + row actions
Add book:  metadata form; identifier fields adapt to scheme; copies stepper; optional ISBN lookup
Return:    scan → borrower, due, days late, fine, condition toggle → confirm
Holds:     queue per title (requested/ready/expired) → fulfil/cancel/extend
Members:   students+staff, loan counts, dues, history
Fines:     outstanding/settled → mark paid / waive(reason)
Reports:   circulation, overdue, most-borrowed, inventory audit, dead stock → CSV
Purchase:  request queue sorted by demand (votes) · approve/reject/ordered/added
           · on "added" notify requesters + offer a reserve
Settings:  §C3 config — librarian edits loan policy + all notification settings
           (incl. due-reminder offsets); identifier scheme owner/principal-only
```

### Borrower catalog — `/library` (students + staff)
```
search · category filter · available-only
grid of book cards (cover, available x/y, [Reserve]/[Join queue])
book detail: metadata, availability, queue length, [Reserve]
no results → "Can't find it? Request this book" (title/author/note; shows votes if already requested)
My loans: title, due, overdue badge, [Request renewal]; My fines; My requests (status + votes)
```

### Setup wizard — `/library/setup` (owner/principal)
Identifier scheme → Loan policy → Create librarian.

## C9. Operational analytics for owner/principal

1. **Circulation** — issued, returns, active, renewals, loans/day trend, peak days.
2. **Collection** — titles, copies, available, utilization %, turnover, acquisitions.
3. **Readers** — active borrowers, penetration, by class/role, top borrowers, non-borrowers.
4. **Overdue & dues** — count, aging buckets, avg days late, fines outstanding/collected/waived, recovery.
5. **Holds** — queue length, ready, avg wait, fulfilment vs expiry.
6. **Reading** — most-borrowed titles/categories, category mix, grade trends.
7. **Collection health** — dead stock (0 loans in 180d), lost/damaged value, catalog gaps.
8. **Financial** — collection value, cost per circulation, written-off value.
9. **Acquisition demand** — open purchase requests, total votes, most-requested titles, avg time
   request→added, approval/rejection rate (aggregate, no requester identity).

All aggregate, no PII; period selector 7/30/90/term/year + CSV.

## C10. Security, RLS, audit, events

- Desk doors `require('librarian')`; ops door `require('librarian','owner','principal')`, aggregates only;
  borrower doors any authenticated non-parent.
- Every write: `emitEvent` + `requestAudit` inside `withUser`.
- PII: borrower name/phone to librarian only; ops strips identity; parents see only their child.
- Fines are ledger rows; waive is an audited status update; no DELETE.
- Events: `library.book.*`, `library.copy.*`, `library.loan.issued|returned|renewed|overdue|lost`,
  `library.reservation.*`, `library.fine.*`, `library.acquisition.requested|voted|decided|added`
  (all declared in the manifest this time).

## C11. Edge cases & invariants

- Last-copy race → row lock on `library.copy`; second gets "no copies available".
- Reservation race → row lock + partial unique; `queue_no` assigned under lock.
- Return with a ready hold → auto-ready + notify.
- Borrower with an outstanding lost item cannot borrow.
- Student deactivated → loans remain, no new borrow, parent still notified.
- Librarian removed → desk re-locks; data retained.
- Plugin disabled → 409 everywhere; data retained.
- Fine ≤ cap; grace never charged; early return never fined.
- IST dates for due/overdue; fine math in whole days.

## C12. Build plan (one pass, in order)

1. Migration `108_library_v2.sql` — role CHECK + `student_accounts` + catalog/copy/loan/reservation/fine + RLS/grants/FKs + registry/manifest (defaultEnabled false).
2. Kernel — add `librarian` to ROLES; widen enable door to principal; role/nav mapping; remove library from DEFAULT_ON.
3. Plugin rewrite — desk/borrower/ops doors, settings schema, events/audit.
4. Day-worker — due/overdue sweep + notification fan-out with dedup.
5. Frontend — `/library/insights`, `/library/desk/*`, `/library`, `/library/setup`; nav gating.
6. Tests — role gate, self-scope, copy locks, reservation queue, fine math, notification dedup, ops PII-stripping.
7. Docs — FEATURES-STATUS, PERMISSION-MATRIX, DATA-FLOW.

## C13. Resolved defaults (approved)

1. Add `app.student_accounts` link now — **yes**.
2. Parent borrowing — **excluded**.
3. Defaults in §C3 — **accepted**.
4. Staff borrowing — **immediate**, no approval.
5. Reservation hold — **2 days**.
6. Fines — **desk-collected** (not routed to the fees ledger).
7. Ops dashboard — **principal sees it**.
