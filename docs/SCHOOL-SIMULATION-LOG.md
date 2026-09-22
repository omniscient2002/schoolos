# SchoolOS — Cassandra International School: Onboarding Walkthrough

> A detailed, step-by-step record of bringing a fictional school to life on the real SchoolOS
> application — exactly what happens on screen, what request is sent, what the backend does,
> and how the data changes after each step.
>
> Read-only audit law: this document describes behavior; it does not fix or patch anything.
> One step at a time, with approval before each step.

---

## The school

| Field | Value |
|---|---|
| School name | Cassandra International School |
| Location | Warangal, Telangana |
| Board | CBSE |
| Owner account | Dr. Ananya Rao — `ananya.rao@cassandra.edu` |
| Plan | trial |
| Tenant slug | `cassandra-international-school` |
| Tenant id | `59129cc9-ddaa-4fce-bef9-ce571d8f8a66` |
| Owner user id | `50dc2c64-47ef-4755-9aef-c9fba9759313` |
| Academic year | 2026–27 — **not created yet** |
| Principal | **not created yet** (owner ≠ principal; role is single-valued) |
| Classes | Nursery, LKG, UKG, 1–10 — sections A/B (created in Step 2) |
| Students | **none yet** |

---

## Environment

| Fact | Value |
|---|---|
| API | `http://127.0.0.1:8080` (Fastify 5, `NODE_ENV=development`) |
| Frontend | React 19 + Vite, served separately |
| Database | PostgreSQL with tenant row-level security |
| Self-signup | enabled in development (`SELF_SIGNUP_ENABLED` unset) |
| Pre-existing tenants | 6 (the Meridian demo + 5 residual test/probe schools) |

---

# STEP 1 — New School Registration

## What the owner does
Dr. Ananya Rao opens the app at the public `/onboard` page and completes a 3-step card:
**① Your school → ② You, the owner → ③ Done**.

## The screen
- **Page:** `app/src/screens/Onboard.tsx` (public route `app/src/App.tsx:657`, outside the
  logged-in shell).
- **Step 1 fields:** school name (required, ≥3 chars), address / board / phone (optional).
- **Step 2 fields:** full name, email (the login identity), password (≥8) with a strength bar.
- **Step 3:** a confirmation card and a "what happens next" list.
- The screen sends the request through `apiSignup()` (`app/src/services/onboardingApi.ts:23-30`).
- Note: the screen does **not** collect classes/sections; the school is created with none.

## The request
```
POST http://127.0.0.1:8080/onboard/signup
Content-Type: application/json          (public — no login needed; limited to 3/minute)

{
  "schoolName":    "Cassandra International School",
  "address":       "Warangal, Telangana",
  "board":         "CBSE",
  "phone":         "",
  "ownerName":     "Dr. Ananya Rao",
  "ownerEmail":    "ananya.rao@cassandra.edu",
  "ownerPassword": "<generated locally>"
}
```

## What the backend does
The route lives in `server/src/onboarding.js:53` and runs as a single database transaction:

1. **Signup gate** — checks the `SELF_SIGNUP_ENABLED` kill-switch. In development it is allowed
   (`onboarding.js:54-59`).
2. **Validation** — school name 3–120 chars, owner name present, valid email, password ≥8
   (`onboarding.js:65-68`).
3. **Slug** — derives `cassandra-international-school` from the school name, retrying for
   uniqueness (`onboarding.js:40-49`).
4. **Password hashing** — scrypt with the strong cost (`server/src/auth.js:23-27`).
5. **One transaction** (`onboarding.js:86-131`):
   - insert the **tenant** (`app.tenants`),
   - insert the **owner user** (`app.users`, role `owner`),
   - scope the transaction to the new tenant and provision the **full plugin catalog**
     (`app.plugins`),
   - write a **hash-chained audit row**,
   - emit a **platform event** (writes `app.events` + `app.outbox`).
6. **Auto-login** — signs a JWT (`sub, role, tenant, name, jti, epoch`) and returns it with the
   new user and tenant (`onboarding.js:115`).

## Response
```
HTTP 200
{
  "token": "<JWT>",
  "user":   { "id":"50dc2c64-…", "name":"Dr. Ananya Rao", "role":"owner",
              "email":"ananya.rao@cassandra.edu", "tenantId":"59129cc9-…" },
  "tenant": { "id":"59129cc9-…", "slug":"cassandra-international-school",
              "name":"Cassandra International School" },
  "next":   { "checklist": ["/onboard/status"] }
}
```

## State changes after Step 1
**`app.tenants` — 1 row added**
```
slug           cassandra-international-school
name           Cassandra International School
config         { board:"CBSE", address:"Warangal, Telangana",
                 setup:{ source:"self-signup", at:"2026-09-21T18:18:25Z", sections:[] } }
onboarded_at   2026-09-21T18:18:26Z
onboarded_via  self-signup
plan           trial
```
**`app.users` — 1 row added**
```
email          ananya.rao@cassandra.edu
name           Dr. Ananya Rao
role           owner
active         true
force_change   false
session_epoch  1
```
**`app.plugins` — 29 rows added** (4 enabled, 25 registered/off)
```
enabled: files.store, ops.timetable, ops.visitors, people.admin
```
**`app.audit_log` — 1 row added**
```
actor       Dr. Ananya Rao
action      Tenant onboarded (self-signup)
policy_ref  Platform §1.1 (tenant provisioning)
risk        medium
outcome     school created with its first owner — no student data yet
```
**`app.events` — 1 row added**
```
type   platform
label  New school onboarded: Cassandra International School
topic  platform.tenant.onboarded.v1
```
**`app.outbox` — 1 row added** (pending delivery; no worker running in dev)

## What the owner sees
The confirmation card: "**Cassandra International School is ready** / You are signed in as its
owner", plus the next-steps list (create IT admin → admit students → switch on modules). The
button **Set up my school** navigates to `/people-admin`.

The setup checklist (`GET /onboard/status`) then shows all four items undone:
```
classes   Define your classes and sections            undone
itadmin   Create your IT admin                        undone
students  Admit your first students                   undone
plugins   Switch on the modules you need              undone
```

---

# STEP 2 — Classes & Sections

## What the owner does
From the checklist, the owner opens **Classes & sections** (`/classes`) and builds the school's
structure: adds a class name, adds section chips, and saves.

## The screen
- **Page:** `app/src/screens/Classes.tsx`.
- **Read:** `GET /school/classes` (any signed-in caller).
- **Write:** `PUT /school/classes` (owner / principal / IT admin).
- The owner defines the structure **custom** — nothing is prefilled by the app.
- Save shows the toast: "Classes & sections saved — every class picker now offers exactly these".

## The request
```
POST http://127.0.0.1:8080/auth/login          (owner signs in; audited)
PUT  http://127.0.0.1:8080/school/classes
Authorization: Bearer <owner JWT>
Content-Type: application/json

{
  "classes": [
    {"grade":"Nursery","sections":["A","B"]},
    {"grade":"LKG","sections":["A","B"]},
    {"grade":"UKG","sections":["A","B"]},
    {"grade":"1","sections":["A","B"]},
    … {"grade":"10","sections":["A","B"]}
  ]
}
```

## What the backend does
Route `server/src/routes.js:771`:

1. **Authorization** — `require('owner','principal','itadmin')` (`routes.js:762,771`).
2. **Validation** — `normalizeClasses` (`routes.js:58-82`): up to 60 classes, unique class names,
   sections uppercased and trimmed to 8 chars, up to 30 per class, no duplicates.
3. **Transaction** (`withUser`): locks the tenant row with `SELECT … FOR UPDATE`, merges the new
   list into `config.setup.sections` and stamps `config.setup.updatedAt`, then updates
   `app.tenants` (`routes.js:777-781`).
4. **Audit + event** — writes an audit row ("Updated classes & sections", risk low) and emits
   `platform.school.classes.updated.v1` (`routes.js:783-792`).

## Response
```
HTTP 200
{ "ok": true, "classes": [ …13 classes… ] }
```

## State changes after Step 2
**`app.tenants` — same row updated**
```
config.setup.sections  [ Nursery[A,B], LKG[A,B], UKG[A,B], 1[A,B] … 10[A,B] ]
config.setup.updatedAt 2026-09-21T18:33:53Z
```
**`app.audit_log` — 2 rows added** (total 3)
```
Signed in (password)          actor_role owner   policy_ref Platform §2.4 (identity & access)
Updated classes & sections    actor_role owner   policy_ref School structure
   reason   classes: Nursery(A/B), LKG(A/B), … 10(A/B)
   outcome  13 class(es) · 26 section(s)   risk low
```
**`app.events` — 1 row added** (total 2)
```
label  Classes & sections updated (13 classes)
topic  platform.school.classes.updated.v1
```
**`app.outbox` — 1 row added** (total 2, pending)

## What the owner sees
The checklist item **"Define your classes and sections"** flips to **done**. `GET /onboard/status`
now returns all 13 classes, and every class/section picker in the product (students, transfers,
filters, fees-by-grade, timetable, admissions) offers exactly this list.

---

# STEP 3 — Principal first

## Correction: the IT admin attempt was reverted
An IT admin (**Ravi Kumar**) was provisioned first, then stood down, because the principal must
come first. SchoolOS never hard-deletes users (append-only audit, D-35); the sanctioned revert is
**suspend** — the account is deactivated (`active=false`), its sessions die at the next request,
and the suspension is audited. The account row and its history remain.

## What the owner does
Provision the **principal** via People Admin. The principal then signs in for the first time with
the temporary password and sets their own password (forced change).

## The screen
- **Page:** `app/src/screens/PeopleAdmin.tsx` (plugin-backed).
- **Write:** `POST /plugins/people.admin/users` with `role: "principal"`.
- The principal's first login returns a **forced-change** state; they set a new password at
  `/account/password`.

## The requests
```
# owner signs in
POST /auth/login

# owner provisions the principal
POST /plugins/people.admin/users
Authorization: Bearer <owner JWT>
{ "name": "Dr. Ananya Rao", "email": "principal@cassandra.edu", "role": "principal" }

# principal's first login with the temporary password
POST /auth/login
 → HTTP 403 { mustChange: true, token: <restricted token> }

# principal sets a real password
POST /me/password
Authorization: Bearer <restricted token>
{ "currentPassword": "<temp>", "newPassword": "<new>" }
```

## What the backend does
1. **Create** — `people.admin/index.js:77`: `require('owner','itadmin')` + lifecycle gate →
   validation → CSPRNG temp password → `INSERT app.users` with `force_change=true` → event
   `people.user.created` → audit "User provisioned".
2. **Revert the IT admin** — `POST /plugins/people.admin/users/:id/suspend`
   (`people.admin/index.js:172-198`): sets `active=false`, event `people.user.suspended`,
   audit "User suspended".
3. **First login** — `app.js:295-394`: `issueSession` stamps `mustChange`; the login answers
   **403** with a **restricted token** that reaches only `/me/password`, `/me`, `/auth/logout`.
4. **Set password** — `app.js:939-960`: verifies the current password, writes the new scrypt
   hash, clears `force_change`, **bumps `session_epoch`** (revoking every other session), audits
   "Password changed", and reissues a full token.

## State changes after Step 3
**`app.users` — 3 rows**
```
owner      Dr. Ananya Rao   ananya.rao@cassandra.edu   active   force_change false  epoch 1
principal  Dr. Ananya Rao   principal@cassandra.edu    active   force_change false  epoch 2
itadmin    Ravi Kumar       itadmin@cassandra.edu      active=false  (stood down / reverted)
```
**`app.audit_log` — 5 rows added** (total 10)
```
Signed in (password)         actor_role owner                (owner login)
User suspended               actor_role plugin:people.admin  reason itadmin · itadmin@cassandra.edu
User provisioned             actor_role plugin:people.admin  reason principal · principal@cassandra.edu
Signed in (password)         actor_role principal            outcome JWT issued (restricted — password change required)
Password changed             actor_role principal            outcome session_epoch → 2 (older sessions revoked)
```
**`app.events` — 2 rows added** (total 5)
```
Account suspended: Ravi Kumar (itadmin)              topic people.user.suspended
Account created: Dr. Ananya Rao (principal)          topic people.user.created
```
**`app.outbox` — 2 rows added** (total 5, pending)

## What the owner/principal sees
The principal account is active with no forced change pending; the IT admin is shown **inactive**.
The principal can now perform the remaining setup work.

---

# STEP 4 — Academic year 2026–27 (as principal)

## What the principal does
Signs in and creates the school's academic calendar — one year, set current.

## The screen
- Academic years are managed through the API / oversight surfaces; the door is
  `POST /academic-years`.
- **Who can create:** owner / principal / finance / finance_head. **Who can activate:**
  owner / principal.

## The request
```
POST /auth/login                         (principal signs in; audited)
POST /academic-years
Authorization: Bearer <principal JWT>
Content-Type: application/json

{ "name": "2026-27", "starts_on": "2026-04-01", "ends_on": "2027-03-31", "is_current": true }
```

## What the backend does
Route `server/src/routes.js:887`:

1. **Authorization** — `require('owner','principal','finance','finance_head')`
   (`routes.js:887`).
2. **Validation** — name present and ≤80 chars; `starts_on`/`ends_on` must be `YYYY-MM-DD`;
   `ends_on` must be after `starts_on` (`routes.js:892-895`).
3. **Transaction** (`withUser`): if `is_current`, clears any existing current year first
   (same transaction, atomic), inserts the row into `app.academic_years`, and writes the audit
   row "Created academic year" (`routes.js:900-908`).
4. **Invariant** — the partial unique index `academic_years_one_current_idx` guarantees at most
   one current year per tenant; a race returns a friendly 409 (`routes.js:910-913`).
5. The separate `POST /academic-years/:id/activate` door (owner/principal) flips the current
   flag and emits an event (`routes.js:919-932`).

## Response
```
HTTP 200
{ "year": { "id": "67e1dcde-…", "name": "2026-27",
            "starts_on": "2026-04-01", "ends_on": "2027-03-31", "is_current": true } }
```

## State changes after Step 4
**`app.academic_years` — 1 row added**
```
name        2026-27
starts_on   2026-04-01   (serialized with the IST offset: 2026-03-31T18:30Z)
ends_on     2027-03-31
is_current  true
```
**`app.audit_log` — 2 rows added** (total 12)
```
Signed in (password)     actor_role principal   record_ref principal@cassandra.edu
Created academic year    actor_role principal   record_ref 2026-27
   reason   academic calendar
   outcome  created and set current
```
**`app.events` / `app.outbox`** — unchanged (the create door does not emit; the activate door does).

## What the principal sees
One academic year exists and is marked **current**; `GET /academic-years` returns
`currentAcademicYearId` set to it. Fee plans, exams and promotions now have a calendar to scope to.

---

# STEP 5 — IT admin created by the owner

## Why the owner, not the principal
The principal **cannot** provision accounts. The only provisioning door is gated to owner/IT
admin, and a live attempt as the principal returned **403 `role principal not permitted`**
(nothing written — the gate refuses before the handler). So the owner creates the IT admin, who
can then add the rest of the staff.

## The request
```
POST /auth/login                                (owner signs in; audited)
POST /plugins/people.admin/users
Authorization: Bearer <owner JWT>
Content-Type: application/json

{ "name": "Suresh Babu", "email": "suresh.babu@cassandra.edu", "role": "itadmin" }
```

## What the backend does
Route `server/src/plugins/people.admin/index.js:77`:

1. **Authorization** — `require('owner','itadmin')` + lifecycle gate (`index.js:45,77`).
2. **Validation** — valid email, name present, role in the built-in list minus `owner`.
3. **Temporary password** — CSPRNG readable temp password (`index.js:68-73,110-111`).
4. **Transaction** (`withUser`): `INSERT app.users` with `force_change=true`, emit
   `people.user.created`, audit "User provisioned" (`index.js:113-155`).
5. Returns the temporary password **once**.

## Response
```
HTTP 200
{ "ok": true,
  "user": { "id":"b0edb638-…", "email":"suresh.babu@cassandra.edu", "name":"Suresh Babu",
            "role":"itadmin", "active":true, "forceChange":true },
  "temporaryPassword": "<shown once>" }
```

## State changes after Step 5
**`app.users` — 1 row added** (total 4)
```
Suresh Babu · suresh.babu@cassandra.edu · itadmin · active · force_change=true · epoch 1
```
**`app.audit_log` — 2 rows added** (total 15)
```
Signed in (password)   actor_role owner                (owner login)
User provisioned       actor_role plugin:people.admin  record_ref b0edb638-…
   outcome  itadmin account created · temporary password issued (force_change stamped)
```
**`app.events` — 1 row added** (total 6): `people.user.created`.
**`app.outbox` — 1 row added** (total 6, pending).

## What the owner sees
A second IT admin is **active** (the earlier one remains suspended). The active IT admin can now
add the rest of the staff.

---

# STEP 6 — Structure completed + staff provisioned (as IT admin)

## What the IT admin can and cannot do
- **CAN** change/add classes & sections — `CLASSES_ADMIN = ['owner','principal','itadmin']`
  (`server/src/routes.js:762`).
- **CAN** provision teachers/staff — `ADMIN = ['owner','itadmin']`
  (`server/src/plugins/people.admin/index.js:45`).
- **CANNOT** admit students — `POST /students` is owner/principal/coordinator/admissions
  (`routes.js:615`) and the CSV import is `ROSTER` without `itadmin`
  (`people.admin/index.js:46,543`). Student onboarding stays with the principal.

## What the IT admin does
1. First login with the temporary password → **403 mustChange** → sets a real password.
2. Completes the school structure.
3. Provisions the teaching and support staff.

## The requests
```
POST /auth/login                       (IT admin, temp password) → 403 { mustChange, token }
POST /me/password                      (sets the IT admin's real password)
PUT  /school/classes                   (15 classes × sections A/B/C)
POST /plugins/people.admin/users       ×8  (5 teachers, 1 coordinator, 1 finance, 1 librarian)
```

## What the backend does
- `PUT /school/classes` (`routes.js:771`) — validates via `normalizeClasses`, merges into
  `config.setup.sections`, audits "Updated classes & sections", emits
  `platform.school.classes.updated.v1`.
- `POST /plugins/people.admin/users` (`people.admin/index.js:77`) — per person: temp password,
  `INSERT app.users` with `force_change=true`, event `people.user.created`, audit "User
  provisioned".

## State changes after Step 6
**`app.tenants.config.setup.sections`** — now **15 classes** (Nursery, LKG, UKG, 1–12) ×
sections **A, B, C** = **45 sections**.

**`app.users` — 8 rows added** (total 12; 11 active)
```
5 × teacher      Priya Iyer, Rahul Verma, Sneha Kulkarni, Arif Shaikh, Meera Nair
1 × coordinator  Kavita Reddy
1 × finance      Ramesh Gupta
1 × librarian    Anita Desai
(all active · force_change=true · temporary password shown once)
```
**`app.audit_log`** → **26 rows** · **`app.events`** → **15** · **`app.outbox`** → **15** (pending).

## Accounts by role
```
owner 1 · principal 1 · itadmin 2 (1 active) · coordinator 1 · teacher 5 · finance 1 · librarian 1
```

---

# STEP 7 — All modules switched on (as principal)

## What the principal does
Enables the remaining 25 modules; the 4 `DEFAULT_ON` modules were already on. The tenant now runs
the **full 29-plugin catalog**.

## The request
```
POST /auth/login                        (principal signs in; audited)
POST /plugins/:id/enable   ×25          (body ignored — metadata comes from the manifest)
```

## What the backend does
Route `server/src/routes.js:3633`:

1. **Authorization** — `require('owner','principal','itadmin')` + plugin-id guard.
2. **Manifest from disk** — version, class and permissions are read from `manifest.js`, never the
   request body; declared permissions must be in the kernel vocabulary.
3. **Kernel compat + plan** — `trial` includes every plugin (`entitlements.js`); a plan-excluded
   plugin would answer 402.
4. **Dependencies** — `pack.cbse` requires `exams.assessment@1.0.1`, so `exams.assessment` is
   enabled first (the door answers 409 otherwise).
5. **Upsert** `app.plugins` status `enabled`, then audit `Plugin enabled: <id>@<version>`.

**Boot-guard note:** `payments.upi` requires `UPI_WEBHOOK_SECRET` and `payments.razorpay` requires
`RAZORPAY_WEBHOOK_SECRET` while enabled (`onReady`). Both are present in the environment, so the
API still boots. Razorpay `key_id` is absent, so order creation answers the honest "unconfigured"
path until keys are added.

## State changes after Step 7
**`app.plugins`** — all **29 enabled** (was 4 enabled / 25 registered).
**`app.audit_log`** — **+25 → 52 rows** (`Plugin enabled: <id>@<version>`, actor_role `principal`).
**`app.events` / `app.outbox`** — unchanged (the enable door audits but does not emit).

## What the principal sees
Every module's nav, routes and slots become active; Settings → Modules shows all switches on.

---

# STEP 8 — Class teachers (one class per teacher)

## The rule
Each teacher is the class teacher of **exactly one** class-section, and that teacher takes its
register. The app's model is **one active form-teacher per class-section**
(`class_assignments_one_owner_per_class`), so a teacher *may* own several — but per your
instruction each owns exactly one.

## The request
```
POST /auth/login                          (principal signs in; audited)
POST /class-assignments                   ×5
{ "teacherId": "<uuid>", "grade": "1", "section": "A" }
```

## What the backend does
Route `server/src/routes.js:821`:

1. **Authorization** — `require('owner','principal','coordinator')`.
2. **Validate** — the target user must be role `teacher` in this tenant (404 otherwise).
3. **Handover** — any current holder of that class is retired (`active=false`) and audited.
4. **Assign** — `INSERT app.class_assignments`, then audit
   `Class <grade>-<section> assigned to <teacher>` (`PRD-2 class ownership`).

## State changes after Step 8
**`app.class_assignments` — 5 rows added** (one class per teacher)
```
1-A  Priya Iyer
2-A  Rahul Verma
3-A  Sneha Kulkarni
4-A  Arif Shaikh
5-A  Meera Nair
```
**`app.audit_log`** — **+6 → 58 rows** (5 assignments + principal login).
**`app.events` / `app.outbox`** — unchanged (the assignment door audits but does not emit).

## Coverage gap (important)
The school has **45 class-sections** (15 classes × A/B/C) but only **5 teachers**, so only **5
class-sections** now have a class teacher. To give every class-section its own class teacher 1:1,
the school needs **45 teachers** (or fewer sections). Registers for the other 40 can currently be
marked only by the **office** (owner / principal / coordinator), which bypasses the class-binding.

## The "first-period teacher takes attendance" idea
**Not supported by the current model.** Attendance binding is strictly by
`app.class_assignments` (form teacher); the timetable slot stores the teacher as **free text**
and is **section-agnostic**, so "the teacher who teaches first period" is not a recognised
register owner. Supporting that would be a code/data-model change (timetable slots keyed by
teacher id + grade/section). Flagged for a decision.

---

# STEP 9 — Full class-teacher coverage (40 more teachers)

## What happened
The **IT admin** provisioned **40 more teachers**; the **principal** then assigned each to one of
the remaining class-sections. Every class-section now has exactly one class teacher.

## The requests
```
# IT admin provisions 40 teachers
POST /auth/login                                     (IT admin)
POST /plugins/people.admin/users   ×40               { role:'teacher', name, email }

# principal assigns one class each
POST /auth/login                                     (principal)
POST /class-assignments            ×40               { teacherId, grade, section }
```

## State changes after Step 9
| Table | Change |
|---|---|
| `app.users` | +40 → **52** (45 teachers) |
| `app.class_assignments` | +40 → **45 active** — full coverage |
| `app.audit_log` | +82 → **140** (40 "User provisioned", 40 "Class … assigned to …", 2 logins) |
| `app.events` | +40 → **55** (`people.user.created`) |
| `app.outbox` | +40 → **55** (pending) |

## Class-teacher map (all 45 class-sections)
```
Nursery-A Aarti Sharma      Nursery-B Bhavna Verma      Nursery-C Chetan Reddy
LKG-A     Deepa Nair        LKG-B     Esha Iyer         LKG-C     Farhan Khan
UKG-A     Gita Patel        UKG-B     Hari Prasad       UKG-C     Isha Gupta
1-A  Priya Iyer     1-B  Jatin Rao       1-C  Kiran Singh
2-A  Rahul Verma    2-B  Lata Kumar      2-C  Manoj Das
3-A  Sneha Kulkarni 3-B  Nisha Bose      3-C  Om Mehta
4-A  Arif Shaikh    4-B  Pooja Joshi     4-C  Qadir Ali
5-A  Meera Nair     5-B  Ritu Pillai     5-C  Suman Chatterjee
6-A  Tara Menon     6-B  Uma Krishnan    6-C  Varun Kapoor
7-A  Wasim Sheikh   7-B  Yash Agarwal    7-C  Zara Fatima
8-A  Aditya Rao     8-B  Bina Thomas     8-C  Chandra Sekhar
9-A  Divya Menon    9-B  Ela Bhatt       9-C  Faisal Ahmed
10-A Gauri Deshpande 10-B Hema Latha     10-C Irfan Qureshi
11-A Jyoti Mishra   11-B Karthik Raman   11-C Lavanya Suresh
12-A Mohit Bansal   12-B Neha Sinha      12-C Prakash Yadav
```
Temporary passwords for the 40 new teachers were issued once (reported in the session).

---

# STEP 10 — Students + linked parents onboarded (per class-section)

## What happened
The **IT admin** admitted **45 students** (one per class-section) and created **45 linked parent
accounts**. Because the built-in `itadmin` gate did not yet allow student creation, the owner
first granted a temporary **`onboarding-admin`** custom-role overlay (base `itadmin`, allow
`POST /students` + `POST /plugins/people.admin/import/students`) and assigned it to the IT admin.

## The requests
```
# owner: temporary overlay (no repo change — the app's own custom-role mechanism)
POST /roles                     { key:'onboarding-admin', base_role:'itadmin',
                                  permissions:{ allow:['POST /students','POST /plugins/people.admin/import/students'] } }
POST /roles/onboarding-admin/assign   { userIds:[<itadmin id>] }        (step-up)

# IT admin: one student per class-section
POST /students                  ×45   { name, grade, section, admissionNo, guardianName, guardianPhone }

# IT admin: one linked parent per student
POST /plugins/people.admin/users ×45  { role:'parent', name, email, phone, studentId }
```

## State changes after Step 10
| Table | Change |
|---|---|
| `app.students` | +45 (one per class-section; admission nos `CAS-0001`…`CAS-0045`) |
| `app.users` | +45 parent accounts |
| `family.child_link` | +45 (each parent linked to their child) |
| `app.events` / `app.outbox` | +90 each (45 "Student enrolled", 45 `people.user.created`) |

Parent temp passwords were issued once (reported in the session).

---

# STEP 11 — IT-admin authority fix landed & verified

## What changed (implemented by another session, reviewed here)
The spec `docs/FIX-ITADMIN-ONBOARDING-AUTHORITY.md` was implemented:
- `itadmin` can now **create students** (`POST /students`) and **bulk-import** them;
- **only the owner** may create a `principal` account or a custom role based on `principal`.

The temporary `onboarding-admin` overlay was then **unassigned and retired** — the built-in role
now carries the authority natively.

## Review result — PASS
- All 5 edits present and exact (gates + audited principal refusal).
- Targeted suites: **31/31 pass** (new: itadmin may admit a student; only owner creates principal;
  itadmin can bulk-import; itadmin cannot base a role on principal).
- `node scripts/check.js` → **all green**; `docs/PERMISSION-MATRIX.md` regenerated
  (**372 routes · 0 unguarded**, `POST /students` lists `itadmin`); frontend `tsc` clean.
- Live checks on the restarted API:
  - itadmin `POST /students` (empty body) → **400** "name required" → the gate **passes**
    (previously 403);
  - itadmin `POST /plugins/people.admin/users {role:'principal'}` → **403** and a ledger row
    `Attempted principal provisioning (refused)` at `risk:'high'`;
  - itadmin `POST /plugins/people.admin/users {role:'parent'}` → **200**.
- Lifecycle gates unchanged per spec (transfer/promote owner/principal/coordinator; withdraw
  owner/principal).

## Operational note
The API was restarted to load the new code (new PID, build fingerprint `84347c14fe3b`).

---

# STEP 12 — Fee structure + obligations generated

## Finding first: the timetable cannot be built through the app
Before Step 12 I attempted the timetable. `ops.timetable` exposes only **read/substitute/autofill**
doors — there is **no write door for `app.timetable_periods` or `app.timetable_slots`**. Those
tables are seeded only by migration 010 for tenants that exist at migrate time. Result:
- Cassandra International School: **0 periods / 0 slots**.
- Meridian (seeded): 10 periods.

So a self-signup school cannot define its timetable. **Recorded as a gap** (candidate for a spec).

## What the principal does
Creates fee heads, a fee-plan template, then generates obligations for the active students.

## The requests
```
POST /auth/login                                   (principal)
POST /fees/heads           ×3   { name, category, isRefundable }
POST /fee-plans                 { name, grades, feeHeadId, academicYearId, terms:[…] }
POST /fee-plans/:id/generate    {}
```

## What the backend does
- `POST /fees/heads` (`routes.js:1013`) — inserts `app.fee_heads`, audits.
- `POST /fee-plans` (`routes.js:1069`) — validates name/grades/terms, inserts
  `app.fee_plan_templates`, audits.
- `POST /fee-plans/:id/generate` (`routes.js:1104`) — locks the template, counts active students
  per grade, inserts a `billing_runs` row, then `INSERT … SELECT … ON CONFLICT
  (tenant,student,term,label) DO NOTHING` (idempotent — re-clicking never double-bills).

## State changes after Step 12
| Table | Change |
|---|---|
| `app.fee_heads` | 3 — Tuition Fee, Transport Fee, Exam Fee |
| `app.fee_plan_templates` | 1 — "Tuition 2026-27" (all 15 grades · Term 1 + Term 2) |
| `app.billing_runs` | 1 |
| `app.fee_obligations` | **90** — 45 `Term 1 Tuition` + 45 `Term 2 Tuition`, ₹25,000 each, status `open` |
| `app.audit_log` / `events` / `outbox` | 248 / 148 / 148 |

## What the principal sees
`GET /reports/fees/summary`: Term 1 billed **₹11,25,000**, Term 2 billed **₹11,25,000**, total
**₹22,50,000 outstanding**, grouped under the Tuition Fee head.

---

# STEP 13 — Attendance (first school-day action)

## What happened
**Priya Iyer**, the class teacher of **1-A**, signed in (forced password change), then marked her
register — her one 1-A student, **Ishaan Kumar**, **absent**.

## The requests
```
POST /auth/login          (class teacher, temporary password) → 403 { mustChange, token }
POST /me/password         (set a real password)
POST /attendance/mark     { marks:[{ studentId, status:'absent', note:'Not on the bus' }] }
```

## What the backend does
Route `server/src/routes.js:672`:

1. **Authorization** — `require('owner','principal','coordinator','teacher')`. A teacher is
   authorised by an `app.class_assignments` row for the class being marked
   (`assertTeacherOwnsClasses`), never by name text.
2. **Read-before-write** the existing register for the date, so the audit records *what changed*.
3. **Upsert** `app.attendance` on `(tenant, student, school_date)`.
4. **Per-change audit** — one row per student whose status actually changed, stamped with the
   authority applied (`principal office` vs `class assignment`).
5. **Absence propagation** — emit `attendance.absences`, then queue one `ABSENCE_NOTICE` WhatsApp
   `app.communications` row per **primary guardian** (`app.guardians`, `is_primary`).

## State changes after Step 13
| Table | Change |
|---|---|
| `app.attendance` | +1 — Ishaan Kumar (1-A), `absent`, `marked_by` = Priya Iyer, date 2026-09-22 |
| `app.audit_log` | +1 — `Attendance for <id> on 2026-09-22: recorded absent`, outcome `class assignment` |
| `app.events` | +1 — `attendance.marked — 1 students on 2026-09-22 · 1 newly absent` |
| `app.communications` | **0** — see the finding below |

The class-assignment binding worked exactly as designed: the teacher could mark **only** her own
class, and the audit stamps `class assignment` as the authority.

---

## FINDING (defect, no fix performed): the absence notice did **not** queue

The notice pipeline joins **`app.guardians`** (`JOIN app.guardians g ON g.student_id = s.id AND
g.is_primary`). But for a school onboarded through the app:
- **`app.guardians` = 0 rows** — no live door populates it. `POST /students` sets only the
  denormalised `app.students.guardian_name` / `guardian_phone`; parent accounts are linked via
  **`family.child_link`** (45 rows).
- So the join finds no guardian and **0 `app.communications` rows** are written.
- The response still reports `noticesQueued` = `newlyAbsent.length` (1) — a **misleading count**
  (newly-absent students, not notices actually queued).

**Root cause:** two guardian models populated by different paths — `app.guardians` (the notice
pipeline) vs `family.child_link` (the parent portal). Only the seed and the admissions-convert
executor write `app.guardians`; the app's own student/parent onboarding does not.

**Impact:** absence notices never reach guardians for app-onboarded students.

**Candidate fix (for a spec):** (a) make `POST /students` + parent linking also upsert
`app.guardians`; **or** (b) make the notice pipeline read `family.child_link` /
`students.guardian_phone`; **and** fix `noticesQueued` to report the actual inserted count.

---

# Current school state

```
SCHOOL
  Cassandra International School · cassandra-international-school · plan trial

PEOPLE (~98 accounts; 2 suspended)
  owner / principal (Dr. Ananya Rao) · itadmin Suresh Babu · coordinator · finance · librarian
  45 teachers (one class teacher per class-section) · 46 parents (45 linked)

STRUCTURE
  Classes: 15 (Nursery, LKG, UKG, 1–12) · Sections: A, B, C (45 total) · 45/45 class teachers

CALENDAR
  Academic year: 2026-27 · 2026-04-01 → 2027-03-31 · current ✓

PLUGINS
  enabled (29): ALL

FEES
  Heads: Tuition, Transport, Exam
  Plan: Tuition 2026-27 (all grades · Term 1 + Term 2 · ₹25,000/term)
  Obligations: 90 open (₹22,50,000 billed, ₹0 collected)

ATTENDANCE
  1-A · Ishaan Kumar · absent on 2026-09-22 (marked by class teacher Priya Iyer)
  ⚠ absence notice NOT queued — app.guardians is empty (see finding)

DATA
  students 45 · child links 45 · class assignments 45 · attendance 1
  timetable periods 0 (gap) · exams 0 · library 0

GOVERNANCE
  audit_log ~250 rows · events ~149 · outbox ~149 (pending)
```

---

# Next step — options

| Candidate | Endpoint | Who can do it | What it changes |
|---|---|---|---|
| **Library catalog** | `library` desk doors | librarian | books + copies; students can borrow |
| Exams | `exams.assessment` doors | principal/teacher | create exams + enter marks |
| Transport | `/transport/routes` | transport | routes + stops |
| School profile | `POST /onboard/school` | owner | address/board/phone |
| Guardian/notice fix | *(needs a spec)* | — | makes absence notices actually deliver |
| Timetable | *(blocked — no write door)* | — | needs a spec |

**Recommended next:** write the **guardian/notice spec** (this defect blocks a core school-day
promise), then continue with the **Library catalog** or **Exams**.

---

*End of walkthrough. Step 14 pending approval.*
