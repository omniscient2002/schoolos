# SchoolOS: How the Project Works

This guide explains SchoolOS in plain language. It is intended for someone who understands schools and business processes, but does not want to read thousands of lines of code to understand what happens when a user clicks a button.

The short version is:

```text
User clicks something
        ↓
Frontend sends a request
        ↓
SchoolOS identifies the user and school
        ↓
SchoolOS checks whether that user may do it
        ↓
The database reads or changes data
        ↓
The change is recorded in the audit trail
        ↓
Events and background work are queued if needed
        ↓
The response returns to the frontend
        ↓
The user sees the result
```

## 1. The two ways SchoolOS can run

SchoolOS has two experiences.

### Demo mode

Demo mode is a product demonstration. It uses prepared sample data representing Meridian International Academy. It is designed to work without a live backend, so a visitor can explore screens immediately.

Demo data includes example students, staff, fees, attendance, incidents, transport records and conversations. Some demo actions update browser state or simulated data instead of the real database.

Demo mode is useful for showing the product, but it is not proof that a real school record was created.

### Live mode

Live mode connects the React frontend to the Fastify API and PostgreSQL database.

In live mode:

- A school is a tenant.
- Each user belongs to one or more tenants.
- Each record belongs to a tenant.
- The server, not the browser, is the authority.
- A successful write changes the database and normally creates audit/event records.
- The frontend reloads or updates itself from the API response.

The live path is the path that matters for real schools.

## 2. The main parts of the system

### Browser application

The `app/` directory contains the React frontend.

It is responsible for:

- displaying pages and forms;
- storing the current session in the browser application state;
- sending API requests;
- displaying loading, success, empty and error states;
- hiding navigation that the server says the user cannot reach.

The browser is not trusted. Hiding a button is only a user-experience improvement. The API must check the permission again.

### API server

The `server/` directory contains the Fastify backend.

It is responsible for:

- login and sessions;
- authentication and role checks;
- tenant isolation;
- validation;
- database reads and writes;
- audit records;
- events and outbox rows;
- plugin registration and plugin routes;
- health, readiness and metrics endpoints.

The main files are:

- `server/src/app.js`: application setup, authentication, login, sessions and platform doors;
- `server/src/routes.js`: core school-operation doors;
- `server/src/db.js`: database pools and tenant-scoped transactions;
- `server/src/audit.js`: audit ledger, event and outbox helpers;
- `server/src/plugin-catalog.js`: the per-school plugin registry;
- `server/src/plugins/*`: optional product modules.

### PostgreSQL database

The database stores the source of truth for live mode.

Important areas include:

- `app.tenants`: schools;
- `app.users`: people who can sign in;
- `app.students`: student records;
- `family.child_link`: parent-to-child relationships;
- `app.attendance`: attendance records;
- `app.fee_obligations` and `app.payments`: money records;
- `app.actions`: approval requests;
- `app.events`: business events;
- `app.outbox`: work waiting for background delivery;
- `app.communications`: communication delivery records;
- `app.audit_log`: the audit ledger;
- `app.plugins`: enabled/disabled plugin state and settings.

Each school’s records are separated by `tenant_id` and protected by PostgreSQL row-level security.

### Workers

Some work should not happen while the user is waiting for an HTTP response. Workers process that work later.

Examples:

- `outbox-worker.js`: drains general event/outbox work;
- `comms-dispatcher.js`: sends queued email, SMS or WhatsApp messages through a rail;
- `webhook-worker.js`: sends signed webhooks to external systems;
- `workflow-worker.js`: evaluates workflow rules;
- `day-worker.js`: scheduled daily work such as dunning and maintenance;
- `reconcile-payments.js`: compares gateway results with the school ledger;
- `retention-worker.js`: applies retention and archive rules.

The important distinction is:

```text
The API records “this work must happen”
        ↓
The worker attempts the work
        ↓
The worker records success, retry, failure or parked/dead-letter state
```

## 3. How a school and its data are created

There are three common creation paths.

### A. A new school signs up

The onboarding flow creates, in one transaction:

1. the tenant/school;
2. the owner account;
3. initial school setup data;
4. the plugin catalog;
5. default-on core modules;
6. an audit record and event.

If a required step fails, the transaction is rolled back. This prevents a half-created school with an owner but no registry, or a registry without a school.

### B. An operator imports data

The migration flow generally follows:

```text
source file or source system
        ↓
source registered
        ↓
rows staged
        ↓
validation and error report
        ↓
shadow/preview comparison
        ↓
owner approves activation
        ↓
records become live
```

The migration screen should show counts, rejected rows, differences and the rollback window. A staged row is not automatically a live student or payment.

### C. A school user creates or changes a record

Examples:

- a people administrator creates a staff account;
- a teacher marks attendance;
- finance creates a fee obligation;
- a receptionist creates a visitor pass;
- a transport operator reports a delay;
- a principal approves a parent message.

The request path for all of these is explained below.

## 4. What happens to every request

### Step 1: The browser decides whether to send a request

The frontend may first check its effective-access information. This controls navigation and gives a better user experience.

For example, a parent should not see the staff audit page in the sidebar.

This check is not security. A user can manually call an API URL, so the server repeats the authorization check.

### Step 2: The request reaches Fastify

The API receives the HTTP request and applies common platform handling:

- CORS rules;
- rate limits;
- request ID/correlation ID;
- body parsing;
- request timeout;
- route matching;
- common error handling.

Some routes are intentionally public:

- `/health`;
- `/ready`;
- login and authentication routes;
- onboarding routes;
- signature-verified webhook receivers.

Everything else normally requires authentication.

### Step 3: The server identifies the caller

The caller may use:

- a session JWT/cookie;
- a bearer token;
- an API key for the limited read plane.

For a normal user session, the server checks:

1. the token signature;
2. token expiry;
3. the token ID (`jti`) has not been revoked;
4. the user still exists and is active;
5. the session epoch still matches the database;
6. the tenant claim matches the user record;
7. special restrictions such as MFA-pending or forced password change.

The server uses current database user information where possible. A stale or stolen token must not keep working after the account is disabled or its session epoch changes.

### Step 4: The server checks the route permission

The route has an authorization requirement. Examples:

- a parent may read their own child’s fee obligations;
- finance may manage fee records;
- a teacher may mark only an assigned class;
- owner or IT admin may read protected metrics;
- a student cannot read the whole attendance register;
- an approval must be made by the owning authority or an allowed higher authority.

There are several different questions:

```text
Authentication: Who are you?
Role/capability: Are you allowed to use this kind of door?
Scope: Which records are yours to see?
Ownership/SoD: Are you the right person to approve or change this record?
Tenant: Does this record belong to your school?
```

Passing one question does not automatically pass the others.

### Step 5: The server opens a tenant-scoped database transaction

Most authenticated data work runs through the constrained application database role.

Conceptually, the server does this:

```text
BEGIN
set current tenant = the caller’s school
set current role = the caller’s application role
switch to the restricted database role
run the handler’s SQL
COMMIT if successful
ROLLBACK if anything fails
```

PostgreSQL row-level security then limits records to that tenant. A query that forgets a tenant filter should still be constrained by the database policy, although application queries should include tenant conditions as defence in depth.

### Step 6: The handler validates the input

Validation happens before important database work.

Typical validation includes:

- required fields exist;
- IDs have the correct format;
- dates are valid school dates;
- amounts are non-negative and within business rules;
- enum-like fields use accepted values;
- pagination limits are bounded;
- plugin settings match the plugin manifest;
- a phone number is normalised before it is used for OTP or delivery.

Invalid input should return a client error such as `400`, not create a partial record.

### Step 7: The handler reads or writes domain data

A read normally selects records and returns a response.

A write may change several tables together. For example, approving a parent message may:

- update the action status;
- insert a queued communication;
- insert an audit row;
- insert an event;
- insert an outbox row for subscribers.

These changes belong in the same transaction where possible. If a later step fails, the earlier changes roll back together.

### Step 8: The server records evidence

For a meaningful mutation, SchoolOS records:

- who acted;
- which tenant they belong to;
- what changed;
- which record changed;
- why or under which policy;
- the result and risk where applicable.

The audit ledger is intended to answer:

```text
Who changed this?
What did they change?
When did it happen?
Why was it allowed?
What was the outcome?
```

Events describe something that happened in the school domain. Outbox rows describe work that another process may need to perform.

### Step 9: The transaction commits

If all required work succeeds:

```text
COMMIT
```

The database changes are now live.

If a database constraint, permission, timeout or handler error occurs:

```text
ROLLBACK
```

The frontend receives an error and should not display the operation as completed.

### Step 10: The frontend displays the result

The response may be:

- a created/updated record;
- a list of records;
- an approval or queued status;
- an empty result;
- a validation error;
- a permission message;
- a temporary-unavailable message.

The frontend should distinguish “not allowed,” “not found,” “nothing exists yet,” and “the service is unavailable.” They are different business situations.

## 5. All important request outcomes

### `2xx`: success

The requested operation completed. For a communication, `queued` is not the same as `sent`, and `sent` is not necessarily `delivered` by the carrier.

### `400`: invalid request

The caller sent malformed or incomplete data. Nothing important should be written.

Example: `limit=abc`, an invalid date or a missing fee amount.

### `401`: not authenticated

There is no usable session, or the token is invalid/expired/revoked.

The frontend should send the user to sign in again, not show “permission denied.”

### `403`: authenticated but not allowed

The server knows who the user is, but their role, capability, scope or ownership does not permit the operation.

### `404`: not found or intentionally hidden

The record does not exist, or the server deliberately avoids revealing that a record exists to an unauthorised user.

### `409`: conflict

The request conflicts with current state.

Examples:

- a payment was already confirmed;
- a book has no available copy;
- an action was already decided;
- an email exists in multiple schools and requires a tenant choice.

### `422`: business validation failure

The input format may be valid, but the business rule rejects it.

Examples:

- a pickup OTP is wrong;
- a teacher tries to mark another class;
- a workflow transition is not allowed.

### `429`: rate or governance limit

The request was throttled, or a plugin/event budget was exhausted.

### `503`: temporarily unavailable or not configured

The school has not configured a required provider, the database is unavailable, or the service is draining.

The correct user message is “try again or contact the administrator,” not “completed successfully.”

### `500`: unexpected server failure

The operation should be treated as unsuccessful. The server logs the technical error with the request ID, while the client receives a safe generic response.

## 6. How users see data

### Owner

The owner manages the school, users, roles, plugins, high-risk settings, governance and business operations. The owner can see broad school data, subject to tenant boundaries and special ownership rules.

### Principal

The principal sees school-wide operational and academic information and can approve many school actions. Approval does not automatically mean the principal can approve every action; segregation-of-duties rules still apply.

### IT admin

The IT admin manages platform configuration, plugins, access and protected technical telemetry. This is not automatically equivalent to the owner for every business action.

### Coordinator

The coordinator sees and manages the operational areas assigned to that role, such as actions, cases, attendance coordination and schedules.

### Teacher

The teacher sees teaching work, assigned classes, homework, submissions and appropriate student information. Class ownership should determine which students can be changed.

### Finance

Finance sees fee plans, obligations, payments and reconciliation work. Money-changing operations should still respect maker/checker rules and payment evidence.

### Admissions

Admissions sees leads, follow-ups and conversion workflows. Converting a lead into a student creates multiple related records and an audit trail.

### Transport

Transport sees routes, vehicle/route operations and transport events. A sufficiently serious delay can create an approval action and later communication work.

### Facilities and technician

These roles see and update maintenance records within their operational scope. They should not automatically receive unrelated student safeguarding, finance or guardian data.

### Counselor

The counselor role is intended for safeguarding and wellbeing oversight, not general access to every staff surface.

### Parent

The parent sees their linked children’s information, such as attendance, fees, requests and communication. The link comes from `family.child_link`; the parent should not select an arbitrary student ID to see another child.

### Student

The student sees their own learning and personal school information. A student must not fall through to a whole-school roster query.

### The same person in multiple schools

If an email or phone belongs to multiple tenants, SchoolOS must not silently choose the first row. The user receives a school picker/tenant choice, then signs in for the selected school.

## 7. The most important end-to-end examples

### Example A: User login

```text
User enters email + password
        ↓
POST /auth/login
        ↓
Find active user, possibly scoped to tenant
        ↓
Verify scrypt password
        ↓
If MFA is enabled: issue only an MFA-pending challenge
        ↓
Otherwise issue JWT/cookie with user, role, tenant, jti and epoch
        ↓
Record login evidence
        ↓
Frontend stores the session and loads /me/effective
```

Failure possibilities:

- unknown email or wrong password: uniform `401`;
- multiple schools: `409` school picker;
- MFA required: `401` with an MFA challenge, not a full session;
- forced password change: restricted session and `403` until changed;
- rate limit: `429`.

### Example B: Teacher marks attendance

```text
Teacher selects a class and marks students
        ↓
POST /attendance/mark
        ↓
Authenticate teacher and set tenant transaction
        ↓
Check date, student IDs and owned class
        ↓
Insert/update attendance rows
        ↓
Write audit evidence
        ↓
Emit attendance event/outbox work if policy requires it
        ↓
Commit
        ↓
Return marked records/status
```

If the teacher includes a student outside the owned class, the request fails. The browser cannot bypass this by changing the class name in its payload.

### Example C: Finance creates and receives a payment

```text
Finance creates fee plan/obligation
        ↓
Student/parent sees the obligation
        ↓
POST /fees/payments
        ↓
Payment is initiated and linked to one obligation
        ↓
Gateway order/webhook may be involved
        ↓
Signature and freshness are checked
        ↓
POST /fees/payments/:id/confirm or verified webhook
        ↓
Payment and obligation update atomically
        ↓
Audit + event + reconciliation evidence
```

A caller-provided string that merely looks like a gateway reference is not enough to prove a gateway payment.

### Example D: Transport reports a delay

```text
Transport user or GPS plugin sends position/event
        ↓
Authenticate + lifecycle/permission gate
        ↓
Resolve the enabled GPS capability
        ↓
Validate route and delay
        ↓
Write transport event
        ↓
If delay crosses the policy threshold, raise an action
        ↓
Audit and emit event/outbox work
        ↓
Principal/owner reviews the action
        ↓
If approved, resolve real recipients and queue communication
        ↓
Dispatcher calls the selected rail
```

The action being approved is not the same as the message being delivered. The message starts as `queued` and receives a later provider result.

### Example E: Parent files a complaint

```text
Parent submits complaint
        ↓
POST /cases
        ↓
Authenticate and identify the parent
        ↓
Derive protected fields such as origin and permitted severity
        ↓
Create case and audit/event records
        ↓
Staff queue can read the case according to role
        ↓
Staff updates status or assigns follow-up
```

Parents are allowed to report some issues, but they should not control internal priority, ownership or SLA fields in a way that can manipulate the staff board.

### Example F: A plugin is enabled

```text
Owner selects Enable
        ↓
POST /plugins/:id/enable
        ↓
Check tenant plan/entitlement
        ↓
Load the plugin manifest
        ↓
Check declared permissions, dependencies and kernel compatibility
        ↓
Write enabled registry state and audit record
        ↓
Plugin lifecycle gate permits its doors
```

A plugin is not simply “a folder that exists.” It needs a tenant registry row, an enabled state, a valid manifest, permissions and any required provider settings.

### Example G: A communication is delivered

```text
Approved action or system policy creates a queued communication
        ↓
Communication row stores recipients and status=queued
        ↓
Comms dispatcher claims the row
        ↓
Dispatcher selects a capability-enabled rail
        ↓
Rail calls logger, SMS, email or WhatsApp provider
        ↓
Provider result is recorded
        ↓
Success → sent/receipt information
Failure → retry/backoff, then failed/parked
```

`queued` means the system accepted work. It does not mean a carrier accepted it. Sandbox/logger mode must not be presented as a real delivery.

## 8. Events, outbox and audit: three different records

These are easy to confuse.

### Domain event

“Attendance was marked,” “a transport delay occurred,” or “a fee was confirmed.”

It describes something that happened in SchoolOS.

### Outbox row

“Another process or subscriber needs to do something because of this event.”

It supports reliable asynchronous processing.

### Audit row

“This actor changed this important record under this policy, with this result.”

It supports accountability and investigation.

One user action may create all three, but they answer different questions.

## 9. What happens when background work fails

Workers normally use retries and backoff.

```text
attempt 1 fails
        ↓
row remains retryable with next attempt time
        ↓
worker tries again
        ↓
temporary success → completed
permanent/repeated failure → failed or parked
```

The API request that created the work may already have succeeded. The UI must therefore show the correct state:

- “queued” when waiting;
- “sent” only when the rail reports an accepted send;
- “failed” when delivery was unsuccessful;
- “parked” when an operator must investigate.

## 10. Files and private data

File metadata is stored in the database, while uploaded bytes live in private storage. A file download must pass both:

1. tenant/record authorization;
2. the file-storage access rule.

Backups include both the database dump and the private storage archive. Restoring only the database is not a complete restore.

DPDP erasure work must cover both database fields and uploaded/private data where applicable. Erasure replay is designed to be idempotent, so restoring a backup and replaying the same journal does not repeatedly damage data.

## 11. How to follow one feature in the code

For any feature, trace it in this order:

1. **Frontend screen**: find the button/form and the API call.
2. **API route**: find the matching `app.get`, `app.post`, `app.patch` or `app.delete`.
3. **Pre-handler**: identify `authenticate`, `require(...)`, `requireRole(...)` or a plugin lifecycle gate.
4. **Transaction**: find `withUser(...)` and inspect the SQL inside it.
5. **Audit**: find `auditLog`, `requestAudit` or the relevant audit helper.
6. **Events**: find `emitEvent`, `linkLineage` or an outbox insert.
7. **Worker**: identify which script consumes the event or queued row.
8. **Frontend result**: find how success, empty data and errors are rendered.

For a plugin, add two steps:

```text
plugin manifest → plugin catalog row → lifecycle gate → plugin route
```

## 12. Important current limitations to understand

The architecture is strong in several areas, but these limitations affect how data should be interpreted:

- Demo mode is not a live school database.
- Some organisational relationships still need stronger structural modelling, especially classes, subjects, teaching assignments and student login-to-student links.
- A name is not a reliable identity. Any name-based lookup should be treated as an approximation until a structural ID relationship exists.
- A role says what type of work a person may do; it does not automatically prove ownership of every row.
- A queued communication is not a delivered communication.
- A successful HTTP response may mean “accepted for processing,” not “the external provider completed it.”
- A database backup without roles, private files and erasure replay is not a complete operational restore.

## 13. Glossary

| Term | Simple meaning |
|---|---|
| Tenant | One school and its isolated data |
| User | A person who can sign in |
| Role | Broad job permission category, such as teacher or finance |
| Capability | A specific thing a user/plugin/provider can do |
| Scope | Which records a permitted user may access |
| Door | An API endpoint/route |
| Plugin | A separately registered module with its own routes and settings |
| Manifest | A plugin’s declared identity, permissions, settings and capabilities |
| RLS | PostgreSQL’s database-level tenant-row protection |
| Transaction | A group of database changes committed or rolled back together |
| Audit log | Evidence of who changed what and why |
| Event | A fact that something happened in the school system |
| Outbox | Durable pending work for another process |
| Worker | A background process that handles pending work |
| Rail | A provider adapter such as SMS, email, WhatsApp or payments |
| Queued | Accepted by SchoolOS, waiting for processing |
| Sent | Accepted by the configured delivery provider |
| Delivered | Confirmed by a provider/carrier where supported |
| Parked | Failed repeatedly and waiting for operator attention |

## 14. One-sentence mental model

Think of SchoolOS as a school ledger with controlled doors:

> Every user action enters through a checked door, is limited to that school, changes records in a transaction, leaves evidence, and sends later work to workers instead of pretending that unfinished work is complete.

## 15. A school joining SchoolOS for the first time

This is the complete business story for a new school. Names and numbers below are examples.

### Day 0: the school signs up

Suppose **Green Valley School** buys SchoolOS.

The school owner enters:

- school name;
- school slug or URL name;
- owner name and email;
- owner password;
- timezone and country;
- initial plan;
- optional campus information.

SchoolOS creates:

1. a tenant record for Green Valley School;
2. the owner user;
3. the initial school configuration;
4. the plugin catalog;
5. default-on core modules such as people, visitors, library, timetable and files;
6. an audit entry saying the school was created;
7. an onboarding checklist.

The owner then receives a session and lands in the school workspace. The owner does not begin with real students or fees yet; those arrive through import or manual entry.

### Day 1: the owner configures the school

The owner can create or configure:

- campuses: North Campus, Main Campus;
- academic year: 2026–27;
- terms and school dates;
- school profile and board information;
- classes, sections and subjects when the organisation model is configured;
- staff accounts and role assignments;
- plugin settings;
- communication provider settings;
- payment provider settings;
- transport and maintenance setup;
- data-protection and retention settings.

Every important configuration change creates an audit record. A plugin can be visible in the catalog but still be disabled or unconfigured.

### Day 1: the school brings in people

There are two approaches.

#### Import approach

The school uploads a student or staff file.

```text
CSV or source-system export
        ↓
Migration source registered
        ↓
Rows staged
        ↓
Required fields and duplicates checked
        ↓
Errors shown to operator
        ↓
Preview totals and differences
        ↓
Owner approves activation
        ↓
Students/staff become live records
```

Example student import row:

```text
Name: Aarav Mehta
Admission number: GV-2026-0042
Grade: 6
Section: A
Guardian name: Kavita Mehta
Guardian phone: +919876543210
Bus route: Route 7
```

After activation, SchoolOS can use that row in attendance, fees, transport, parent linking and communication workflows.

#### Manual approach

An authorised people administrator creates one student or staff member through the people screen. The same validation, audit and tenant rules apply; manual entry is not a way around controls.

### Day 1: staff accounts are created

The owner or people administrator creates staff accounts such as:

| Person | Platform role | Example responsibility |
|---|---|---|
| Anika Shah | Principal | school-wide academic and operational approval |
| Rohan Das | Coordinator | daily operations and case follow-up |
| Neha Rao | Finance | fee plans and payment reconciliation |
| Imran Khan | Admissions | leads and enrollment conversion |
| Priya Iyer | Teacher | assigned classes and learning records |
| Vikram Joshi | Transport | routes and delays |
| Arif Shaikh | Technician | maintenance work orders |
| Meera Nair | Counselor | safeguarding and wellbeing oversight |

The platform role is not the same as a job title. “Librarian,” “Nurse” and “Lab Assistant” are designations in demo data; they should not silently become authorization roles.

### Day 1: parents and students are linked

A parent account is linked to one or more children through `family.child_link`.

Example:

```text
Kavita Mehta (parent account)
        ├── Aarav Mehta, Grade 6-A
        └── Diya Mehta, Grade 3-B
```

The parent can then see the linked children’s attendance, fees, notices and requests. A parent cannot type another student’s ID and gain access to that student.

A student account should eventually be linked structurally to one student record. Until that relationship is present, name-based matching is only an approximation and must not be treated as a reliable identity proof.

### Day 2: the school configures optional modules

The school enables only what it needs:

- library;
- transport/GPS;
- fees/payments;
- SMS/email/WhatsApp rails;
- admissions;
- maintenance;
- visitors and pickup verification;
- wellbeing and safeguarding;
- HR leave;
- files and documents;
- CBSE/board or DPDP compliance packs;
- accounting export;
- API keys and webhooks.

The owner enables the module, the server checks plan and manifest requirements, and the module’s settings form becomes available. A payment or communication module without provider credentials may exist but should report honestly as unconfigured.

## 16. Role-by-role examples

The examples below describe the normal first-term journey. “Can generate” means records or events this role may create directly or trigger through an approved workflow. It does not mean the role can write arbitrary database rows.

### 16.1 Owner

The owner is the school’s accountable administrator and commercial decision-maker.

#### First setup actions

The owner can:

- create the school;
- set the plan and campuses;
- invite the principal and administrators;
- create staff accounts;
- configure academic years and terms;
- enable plugins;
- configure payment and communication providers;
- create or approve custom roles;
- review audit, security and operational status;
- approve high-risk or owner-level actions.

#### Data the owner can generate

- tenant and school profile;
- campus records;
- academic year and term records;
- user and role records;
- plugin enable/disable records;
- plugin settings and provider configuration;
- fee plans and policy settings;
- approval decisions;
- operational memories and decisions;
- API keys and webhook subscriptions;
- migration approvals;
- DPDP export or erasure requests;
- audit and governance records.

#### Examples

1. The owner creates North Campus and Main Campus.
2. The owner enables `library` and creates a librarian custom role.
3. The owner configures the email rail with an SMTP provider.
4. The owner approves a fee-plan policy for Term 1.
5. The owner reviews a payment reconciliation discrepancy.
6. The owner approves a transport-delay parent message when segregation-of-duties rules require owner approval.
7. The owner exports a school data record for a legal request.

#### What the owner should not assume

The owner’s broad access does not mean every action is automatically safe. Payment confirmation, refunds, safeguarding and erasure actions still require evidence and correct workflow state.

### 16.2 Principal

The principal runs the academic and operational life of the school.

#### First setup actions

- review the imported student roster;
- confirm grades, sections and teachers;
- approve the academic calendar;
- review fee plans;
- review transport and safety setup;
- approve staff actions and parent communications;
- inspect attendance and incident trends.

#### Data the principal can generate

- academic decisions;
- attendance approval or correction actions;
- action approval/dismissal decisions;
- student promotion or transfer approvals;
- fee-policy decisions;
- safeguarding follow-up decisions;
- transport-delay approvals;
- parent communication approvals;
- school memories and policy decisions;
- audit records for those actions.

#### Examples

1. The principal confirms that Grade 6-A is assigned to Priya.
2. The principal approves a parent notice about a bus delay.
3. The principal reviews a sudden attendance drop and raises a follow-up task.
4. The principal approves promotion of a student to the next grade.
5. The principal dismisses an incorrect operational action where the authority rules permit it.
6. The principal reviews a safeguarding case without seeing data outside the permitted safeguarding surface.

The principal may be a higher authority, but cannot bypass tenant isolation, ownership or segregation-of-duties rules.

### 16.3 IT administrator

The IT administrator keeps the school’s digital platform configured and usable.

#### First setup actions

- invite or suspend staff accounts;
- configure plugins and settings forms;
- configure API keys and webhooks;
- review `/health`, `/ready` and protected metrics;
- review build and migration status;
- help staff with access problems;
- manage custom roles where allowed.

#### Data the IT administrator can generate

- user activation/suspension records;
- plugin settings changes;
- plugin enable/disable records;
- API-key and webhook records;
- access-role records;
- technical audit entries;
- operational troubleshooting evidence.

#### Examples

1. The IT administrator enables the file-storage module.
2. The IT administrator configures a webhook endpoint for the school MIS.
3. The IT administrator disables a broken plugin after its work is drained.
4. The IT administrator reads tenant-scoped queue and worker metrics.
5. The IT administrator helps a teacher reset a forced-change password without reading the teacher’s password.

IT administration is not automatically permission to approve every financial or safeguarding action.

### 16.4 Coordinator

The coordinator is the school’s operational control room.

#### First setup actions

- review daily actions and notifications;
- assign operational cases;
- coordinate attendance follow-up;
- maintain timetable and substitutions;
- review work orders and visitor issues;
- coordinate staff leave and requests.

#### Data the coordinator can generate

- operational cases;
- tasks and notifications;
- action assignments and permitted decisions;
- timetable changes;
- substitution records;
- attendance follow-up actions;
- work-order updates;
- leave decisions where authorised;
- audit and event records.

#### Examples

1. The coordinator assigns a maintenance issue to the technician.
2. The coordinator opens a follow-up case for repeated absence.
3. The coordinator records a timetable clash and assigns a substitute.
4. The coordinator reviews a pending parent request.
5. The coordinator assigns a safeguarding follow-up to the counselor, not to finance or transport staff.

The coordinator can organise work without automatically gaining access to every student phone number, fee secret or technical credential.

### 16.5 Counselor

The counselor handles wellbeing and safeguarding information.

#### First setup actions

- review the safeguarding queue;
- receive assigned concerns;
- record wellbeing follow-up;
- coordinate with authorised staff;
- escalate urgent situations.

#### Data the counselor can generate

- wellbeing concerns;
- safeguarding assignments;
- intervention plans;
- case updates;
- follow-up tasks;
- restricted audit entries;
- approved safeguarding communications.

#### Examples

1. A teacher submits a concern about bullying.
2. The coordinator assigns the concern to the counselor.
3. The counselor records a meeting outcome without exposing the full record to finance.
4. The counselor creates an intervention plan for a student.
5. The counselor escalates a high-risk concern to the principal.

Safeguarding data should have narrower visibility than ordinary staff data.

### 16.6 Finance

Finance manages the school’s money records.

#### First setup actions

- import or create fee plans;
- generate student obligations;
- configure payment methods;
- configure gateway settings through the payment plugin;
- review outstanding and overdue balances;
- reconcile gateway results.

#### Data the finance role can generate

- fee-plan templates;
- fee obligations;
- payment initiation records;
- payment confirmation evidence;
- refund requests or actions where permitted;
- reconciliation records;
- dunning/reminder work;
- accounting exports;
- payment audit entries.

#### Examples

1. Finance creates a Term 1 tuition plan of ₹80,000.
2. The system generates an obligation for Aarav Mehta.
3. A parent initiates a payment and receives a gateway order.
4. A verified gateway webhook confirms the payment.
5. Finance reconciles a gateway success that did not yet appear in the ledger.
6. Finance creates a Tally/daybook export.
7. Finance reviews a failed payment and triggers an allowed reminder.

Finance should not be able to silently mark a payment as gateway-verified merely by typing a plausible reference. A gateway record or explicit manual reconciliation must explain the evidence.

### 16.7 Admissions

Admissions turns prospective families into enrolled students.

#### First setup actions

- configure admission sessions and windows;
- create lead sources;
- import existing inquiries;
- set follow-up stages;
- create visit/interview slots.

#### Data the admissions role can generate

- admission leads;
- guardian contact details;
- follow-up tasks;
- visit bookings;
- interview or offer records;
- conversion decisions;
- student and enrollment records after approval;
- enrollment history;
- admission audit/event records.

#### Examples

1. A parent inquiry creates a lead for Grade 4.
2. Admissions schedules a campus visit.
3. Admissions records an interview outcome.
4. Admissions sends an offer for the principal’s approval.
5. After acceptance, admissions converts the lead into a student, guardian and enrollment history record.
6. Admissions marks a lead as withdrawn with a reason.

Conversion is not just changing a status. It creates or connects a student, guardian, enrollment and audit trail.

### 16.8 Transport

Transport manages routes, delays and bus-related communication.

#### First setup actions

- configure routes;
- add stops and route assignments;
- associate students with routes;
- enable GPS ingestion if available;
- configure delay policies;
- verify guardian contactability.

#### Data the transport role can generate

- route records;
- stop and assignment records;
- GPS position events;
- delay events;
- transport incidents;
- approval actions;
- parent communication work;
- transport audit and event records.

#### Examples

1. Transport creates Route 7 with Sector 12 stops.
2. Aarav is assigned to Route 7.
3. A GPS provider sends a bus position.
4. The system detects a 13-minute delay.
5. SchoolOS creates a transport action affecting 38 students.
6. A principal approves the parent update.
7. The communication dispatcher queues the message for the real guardian recipients.

The transport role does not directly mark a message as delivered. The delivery rail does that after attempting the send.

### 16.9 Facilities

Facilities manages physical assets and maintenance intake.

#### First setup actions

- import assets and rooms;
- define maintenance categories;
- create service priorities;
- assign technicians or vendors;
- configure preventive maintenance schedules.

#### Data the facilities role can generate

- asset records;
- work orders;
- maintenance status changes;
- vendor assignments;
- inspection records;
- preventive-maintenance tasks;
- maintenance events and audit records.

#### Examples

1. Facilities registers Bus 14 as an asset.
2. A user reports a coolant leak.
3. Facilities creates an emergency work order.
4. The work order is assigned to Arif.
5. Arif moves it from open to on-site to repairing to resolved.
6. Facilities records the repair note and next inspection date.

Facilities should not receive library write rights, finance rights or safeguarding access just because it is a broad staff role. Those are separate capabilities.

### 16.10 Technician

The technician works on assigned maintenance tasks.

#### First setup actions

- open the assigned work queue;
- review asset history;
- acknowledge work orders;
- record work performed and parts used.

#### Data the technician can generate

- work-order status changes;
- technician notes;
- inspection results;
- repair completion evidence;
- maintenance events and audit records.

#### Examples

1. The technician accepts the Bus 14 work order.
2. The technician records “coolant hose replaced.”
3. The technician uploads a repair invoice or photo.
4. The technician marks the repair ready for verification.
5. Facilities verifies and closes the work order.

Technician access should normally be assignment- or maintenance-scoped, not school-wide.

### 16.11 Teacher

The teacher creates and maintains learning records for assigned classes.

#### First setup actions

- confirm assigned classes and subjects;
- review the roster;
- configure homework or learning activities;
- mark attendance;
- review submissions.

#### Data the teacher can generate

- attendance marks;
- homework assignments;
- submission feedback;
- grades or assessment records where permitted;
- class notes;
- leave requests;
- student support concerns;
- follow-up actions;
- audit/event records.

#### Examples

1. Priya marks Aarav present in Grade 6-A.
2. Priya records Aarav absent and adds a note.
3. Priya creates a mathematics homework assignment.
4. Aarav submits the work.
5. Priya reviews the submission and records feedback.
6. Priya files a wellbeing concern for a student.
7. Priya requests leave for a staff day.

The teacher can mark only classes or students within the teacher’s assigned scope. The request payload cannot promote a teacher into a principal.

### 16.12 Parent

The parent is mainly a reader and requester, not a school administrator.

#### First setup actions

- sign in with the school-provided account;
- confirm linked children;
- review contact information;
- view fees and attendance;
- submit requests or complaints.

#### Data the parent can generate

- complaints/cases;
- leave or certificate requests;
- document requests;
- payment initiation records;
- message replies where the feature allows it;
- pickup/visitor requests;
- data-protection requests about the parent/child subject.

#### Examples

1. Kavita views Aarav’s attendance.
2. Kavita sees an outstanding Term 1 fee obligation.
3. Kavita initiates a payment.
4. Kavita submits a complaint about repeated bus delays.
5. Kavita requests a certificate.
6. Kavita files a DPDP export or erasure request for an eligible subject.
7. Kavita receives an approved school notice through the configured communication rail.

The parent cannot:

- read the whole school roster;
- mark another child’s attendance;
- change fee-plan policy;
- approve staff actions;
- read the audit ledger;
- configure plugins;
- download another child’s private files.

### 16.13 Student

The student is a self-service user with the narrowest personal-data surface.

#### First setup actions

- sign in;
- view their own timetable and learning;
- view their own attendance where allowed;
- submit homework;
- raise an allowed request.

#### Data the student can generate

- homework submissions;
- allowed learning responses;
- student questions;
- personal requests;
- permitted wellbeing reports;
- notification read-state changes.

#### Examples

1. Aarav views his timetable.
2. Aarav opens his own homework assignment.
3. Aarav uploads a submission.
4. Aarav asks a learning question.
5. Aarav files a wellbeing concern through the student-safe surface.
6. Aarav reads a school notice.

The student cannot:

- read another student’s profile;
- read the whole attendance register;
- see family financial records beyond their intended surface;
- edit fee obligations;
- approve actions;
- access staff communications or audit data.

## 17. A complete first-term story

Here is how the records connect during one real school day.

### Morning

1. The transport provider sends a GPS position for Route 7.
2. The transport plugin validates the tenant and enabled capability.
3. A 13-minute delay creates a transport event.
4. The policy raises an action affecting the linked students.
5. The action is visible to the responsible staff/principal.
6. A teacher marks Grade 6-A attendance.
7. The teacher’s class scope is checked against the student rows.
8. Attendance rows and audit evidence are committed.

### Midday

9. A parent files a complaint about the bus delay.
10. The case is created with protected origin, priority and ownership fields derived by the server.
11. The coordinator assigns the case to transport.
12. Facilities creates a work order for the bus inspection.
13. The technician records the repair.

### Afternoon

14. Finance receives a payment gateway webhook.
15. The webhook timestamp and signature are verified before the payment is trusted.
16. The payment and fee obligation update atomically.
17. Finance sees the gateway evidence in reconciliation.

### Evening

18. The principal approves the transport notice.
19. The action becomes decided.
20. Real guardian recipients are resolved.
21. A communication row is inserted as `queued`.
22. The dispatcher attempts the provider send.
23. The communication receives a provider result.
24. Workers retry or park failed work.
25. The audit ledger, events and delivery records allow an operator to reconstruct the day.

## 18. The data relationship in one picture

```text
School / Tenant
│
├── Users
│   ├── Owner
│   ├── Principal
│   ├── Staff roles
│   ├── Parents ───── family.child_link ───── Students
│   └── Students ──── student identity link ── Student records
│
├── Academic structure
│   ├── Academic years and terms
│   ├── Classes and sections
│   ├── Subjects and assignments
│   └── Attendance, homework and assessments
│
├── Operations
│   ├── Fees, obligations and payments
│   ├── Transport routes and events
│   ├── Assets and work orders
│   ├── Cases, wellbeing and actions
│   └── Visitors, library and files
│
├── Communication
│   ├── Notices and recipient lists
│   ├── Queued communications
│   └── Provider receipts/failures
│
└── Evidence
    ├── Audit ledger
    ├── Domain events
    ├── Outbox work
    └── Worker delivery state
```

The most important rule is that a user does not directly “own the screen data.” The user reaches a server door, and the server derives which tenant records, children, classes, actions or provider settings may be used.
