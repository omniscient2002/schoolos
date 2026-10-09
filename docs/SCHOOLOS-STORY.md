# SchoolOS — The Story of a School That Learned to Remember

### A single continuous narrative: every click, every request, every row, every promise

> **What this document is.** One long story that follows a real-shaped Indian school from the
> moment an operator first starts the platform, through self-signup, through every domain it
> touches in a full term, told at the resolution of *the actual button the person pressed, the
> HTTP request that left the browser, the Fastify hook that caught it, the SQL that ran, the
> audit row it wrote, the event and outbox row it promised, and the worker that later kept the
> promise* — and, wherever the documentation and the code disagree, a plainly-marked note saying
> so.
>
> **How to read it.** Read it front to back like a novel, or jump to any chapter. Each chapter is
> self-contained but assumes the cast and the mental model from the Prologue. Technical asides are
> indented and marked so a non-engineer can skip them; the story flows around them.
>
> **Honesty contract.** Every mechanism named here traces to a file in `server/src`, `app/src`, or
> `server/migrations`. Where a feature is demo fiction wearing a live costume, the story says so.
> Where a document is stale, the story says so. This is not marketing; it is a guided tour of a
> system that is unusually honest about its own gaps, and this document tries to be equally honest.
>
> **Scale note.** The repository at the time of writing holds roughly: 145 migration files
> (the latest applying through `147_recon_match_queue.sql` — the numbering skips, so cite
> filenames, never the number), 30 directories under `server/src/plugins/` (29 plugins plus
> `_shared/`), 143 `<Route>` entries in `app/src/App.tsx`, 85 screen `.tsx` files under
> `app/src/screens/`, 150 server test files, React 19, Vite 8, Fastify 5, and a Postgres that
> enforces tenancy in the database itself. These numbers drift; the generated artifacts
> (`docs/VERIFICATION.md`, `docs/PERMISSION-MATRIX.md`) are the live truth.

---

## Prologue — The Building, the Doors, and the Book Nobody Can Tear

Imagine a school. Not the classrooms — the *office*. There is a long corridor, and along it are
doors. Behind each door is a filing cabinet. On the wall next to every door is a small sign:
*who may enter*. Behind the reception desk sits a clerk. Every person who walks in must show an
ID card. The clerk does not take their word for it — the clerk checks the card against a live
list, because a card can be cancelled while it is still in someone's pocket.

Now imagine something unusual. Every filing cabinet drawer has a lock that is *inside* the
cabinet, not on the door. Even if a careless clerk waved someone through the wrong door, the
drawer itself refuses to open unless the folder inside is stamped with the school's own ID. That
lock is PostgreSQL Row-Level Security, and it is the single most important idea in this whole
building.

And now the strangest thing of all. The registry book — the ledger in which every meaningful
action is written — has no eraser. It cannot be torn. Each entry is chained to the one before it
by a fingerprint, so altering today's page breaks tomorrow's. The book is not just a log; it is
*evidence*.

That is SchoolOS. The rest of this book is people walking the corridor.

### The cast

The story follows two schools and the platform around them.

**Green Valley Public School, Nashik** — the new school. It signs up during the story. Its owner
is **Ananya Kulkarni**, a founder-accountant who has run the school on paper and three WhatsApp
groups for nine years. Its first IT admin is **Suresh Pawar**. Its principal is **Rekha Deshmukh**.
Its first teacher is **Priya Iyer**. Its first student is **Aarav Mehta** of Grade 6-A, whose
mother **Kavita** is the first parent account. Green Valley starts with *nothing* — an empty
world, a clean ledger, and 29 plugin switches that are mostly off.

**Saraswati Vidya Mandir Kothrud** — the mature school. It has run on SchoolOS for a while. It
has 13 classes, 23 sections, 11 subjects, a full roster, fee obligations, a bus route, a library,
a clinic, and a year of attendance. It is where the story goes when it needs to show a domain with
data in it. Its owner is **Meera Deshpande**.

**The platform** — the same Postgres and the same Fastify API serving both, separated by a wall
built into the database.

**Meridian International Academy** — the demo tenant. It exists so a visitor can open the
product and see a populated world (375 students, fee plans, transport, attendance) without ever
signing in as a real school. It is the only tenant whose demo dataset is shown, and the story is
careful about when it is and is not present.

### The four words that explain the whole product

The staff experience is one loop:

> **Today → Attention → Ask → Action → Memory**

- **Today** is the briefing: what is happening in this school right now.
- **Attention** is the queue: what needs a human decision.
- **Ask** is the question surface: "how is Grade 8 doing?" — answered from records, not invented.
- **Action** is the decision: approve, dismiss, assign, resolve.
- **Memory** is the institutional record: decisions and their outcomes, so the school learns.

Underneath those four words is a specific engineering claim: the loop is *not* a mock. It is
backed by a Postgres schema, an append-only ledger, an event/outbox spine, and a plugin registry
that decides per request which doors are even open. The story will keep returning to the moment
where the promise meets (or misses) the plumbing.

### The corridor of one request

Before any chapter, hold this picture. Every authenticated request walks the identical corridor:

```
browser click
   │  fetch(method, path, { Authorization: Bearer <jwt> })
   ▼
Fastify hooks
   │  CORS → rate limit → body parse (JSON 1 MiB; files 8 MiB; webhooks raw bytes)
   ▼
app.authenticate
   │  1. X-API-Key branch (reads only, GET /me, GET /dataset)
   │  2. cookie-vs-bearer selection; CSRF double-submit on cookie mutations
   │  3. JWT verify — `jti` is mandatory, so every session is revocable
   │  4. jti denylist check (auth.revoked_token)
   │  5. re-read the user row from the DB — role claims are NEVER authoritative
   │  6. session_epoch compare — a password change kills every old token
   │  7. restricted tokens (mustChange / mfaPending) can only reach their gate doors
   │  8. custom-role mask applied to every authed door
   │  9. failure taxonomy: DB outage → 503; everything else → 401
   ▼
require(...roles)  ← base role ⊕ custom-role mask (deny beats allow)
   ▼
withUser(tenant, role, fn)
   │  BEGIN
   │  set_config('schoolos.tenant_id', <from the token's user row>, true)
   │  set_config('schoolos.role', role, true)
   │  SET LOCAL ROLE schoolos_app        ← the constrained role; RLS applies
   │  run the handler's SQL
   │     · reads compute live (no stale caches except frozen exam reports)
   │     · writes append to app.audit_log (hash-chained)
   │     · writes append to app.events AND app.outbox (same transaction)
   │  COMMIT (or ROLLBACK on any error)
   ▼
onSend: no-store on personal planes, security headers
   ▼
browser renders { } — success, empty, validation error, or permission message
```

Two rivers flow out of a write, and they are easy to confuse:

- `app.audit_log` is the **history river**: *what happened, who did it, under which policy*.
  Append-only, hash-chained, and the application role can never `DELETE` from it (law D-35).
- `app.outbox` is the **promise river**: *what should happen next* — comms dispatch, workflow
  fan-out, plugin drains. Rows are deduplicated by `dedup_key` so a retried event cannot double-send.

A third channel is the **AI gateway** (`server/src/plugins/_shared/ai-gateway.js`): every attempt
writes one row to `app.ai_calls`, budgets are checked *before* a provider runs, and — a fact the
story will insist on — **no plugin actually calls it yet**; the copilots are deterministic
templates, and they say so.

### The two worlds on one screen

The frontend has two truths that frame everything, and the story flags them the first time they
appear:

1. **`LIVE_API` is on by default.** The live transport (`app/src/services/liveApi.ts`) is always
   compiled in. What is gated is `DEMO_BUILD = VITE_DEMO_MODE === '1'`, which in a production
   build tree-shakes every demo screen away.
2. **Most screens are two screens behind one export**: `DEMO_MODE ? <Demo/> : <Live/>`. The demo
   half is largely scripted fiction; the live half ranges from genuinely complete (visitors,
   exams, library, fee-plans, attendance, audit, notifications) to honest empty stubs to a few
   permanent empties caused by a wrong door path.

The demo dataset is **not a client mock**. `GET /dataset` is served by the server, which
function-strips and date-revives a bundle of mock modules; the frontend has zero mock modules. So
demo and live share one data *origin*; only the transport differs. That is why a self-signup
school sees an empty world: the server's `/dataset` allowlist returns nothing real for a
non-demo tenant.

<!-- END OF PROLOGUE -->

---

## Chapter 1 — The Night Before: One Operator, One Server, One Empty Database

It is 11:40 p.m. on a Sunday in early June. A single operator — call him **Dev**, the person who
runs the hosting for a small software company that has decided to sell SchoolOS to schools in
Maharashtra — sits in front of a terminal. There is no school yet. There is no data yet. There is
only a fresh Ubuntu box, a cloned repository, and a decision to make about secrets.

This chapter is the one chapter with no school in it. It matters because everything the story
does later depends on the shape of what Dev builds tonight, and because most of the system's
honest gaps live here, in the seam between "the code is correct" and "a human remembered to run
the right command in the right order."

### 1.1 The environment file, and the wall that reads it

Dev copies the example file and opens it.

```
cd /srv/schoolos/server
cp .env.example .env
$EDITOR .env
```

The file `server/src/config.js` is the first code that will ever read these values, and it is
written to *fail closed*. Dev scrolls it and sees, at the top, a helper `req(name, fallback)`
that exits the process if a required value is missing, and then a block guarded by
`if (isProd && !isWorker)`. That block is a set of tripwires:

- if `NODE_ENV=production` and `DATABASE_URL` still points at `127.0.0.1:5432` or
  `localhost:5432`, the process **throws** — production must point at a real cluster;
- if `CORS_ORIGINS` is still `*`, it throws — a production boot is not allowed to accept every
  origin;
- if `PLUGIN_SETTINGS_KEY` is missing or shorter than 32 characters, it throws — plugin secrets
  (SMTP passwords, gateway keys, webhook secrets) are encrypted at rest and need a real key;
- if `SEED_GUARD` is set to anything other than `strict`, it throws.

Dev has read the audit that produced these lines, so he understands the reasoning: the most
common catastrophic misconfiguration is a production server that quietly inherited a developer's
defaults. A default that cannot be reached in production is better than a default that is merely
discouraged.

He sets:

```
NODE_ENV=production
PORT=8080
HOST=0.0.0.0
DATABASE_URL=postgres://schoolos:<a-long-generated-password>@db.internal:5432/schoolos
JWT_SECRET=<32+ bytes of hex>
PLUGIN_SETTINGS_KEY=<32+ bytes of hex>
CORS_ORIGINS=https://app.greenvalley.example
SEED_GUARD=strict
SELF_SIGNUP_ENABLED=true
```

The last line is a policy decision, not a technical one. Reading `onboarding.js`, Dev sees exactly
what it does:

```js
if (process.env.SELF_SIGNUP_ENABLED !== undefined && process.env.SELF_SIGNUP_ENABLED !== 'true') {
  return reply.code(403).send({ error: 'New-school signups are paused on this platform...' });
}
if (process.env.SELF_SIGNUP_ENABLED === undefined && process.env.NODE_ENV === 'production') {
  return reply.code(403).send({ error: 'New-school signups are paused on this platform...' });
}
```

Translated: signup is off in production by default, and turns on only when an operator explicitly
sets `SELF_SIGNUP_ENABLED=true`. Dev sets it to `true` because the whole point of the next chapters
is a school signing itself up. If he had left it unset, the very first click of Chapter 2 would
have returned a polite 403 — and the story would have ended on page one.

> **Aside — the dev doors.** Three environment variables arm developer-only behaviour:
> `AUTH_DEV_SSO` (a Google login that issues a full session for any existing email, zero
> credentials), `OTP_DEV_ECHO` (OTP codes echoed in HTTP responses), and `RESET_TOKEN_DEV_LOG`
> (reset codes printed to stdout). `config.js` computes their booleans with two conditions each:
> `NODE_ENV` must be exactly `development`, **and** the operator must explicitly set the flag.
> The comment above the code records that a later engineer tried to relax this to "anything not
> production", and that the relaxation was reverted, because a test wanted it. The line reads:
> *"Loosening a security posture so a test passes is how postures erode."* On Dev's production
> box, none of the three can possibly arm.

### 1.2 `npm run migrate` — the first real thing that touches the database

The build creates two Postgres roles and a database. Dev runs the migration runner:

```
cd /srv/schoolos/server
npm ci
npm run migrate
```

`server/scripts/migrate.js` does four things that a reader should understand before trusting any
schema statement in this book:

1. It takes a **Postgres advisory lock** so two runners can never race.
2. It keeps a **checksum ledger** in `app.schema_migrations`: for every applied file it stores the
   file's name and a hash. If a file that was already applied changes on disk, the runner
   **hard-fails on drift** rather than silently re-running it. This is the mechanism that makes
   "always cite the filename" possible.
3. It runs **one transaction per migration**, so a migration that fails halfway leaves no partial
   schema.
4. It applies files in filename order from `server/migrations/`.

On Dev's box the files run from `001_init.sql` up through the `140`/`141` class-and-section
additions and the `142`–`147` action-plan and reconciliation batches. The exact count doesn't
matter; the shape does. Migration `001` is the kernel: `app.tenants`, `app.users`, `app.students`,
the `app.current_tenant()` helpers, and the single RLS predicate that this entire product rests on:

```sql
-- migration 001, tenant isolation, applied ENABLE + FORCE
USING (tenant_id = app.current_tenant()::uuid)
```

Migration `038` brings the `auth` schema (token rails: `revoked_token`). `056`/`057` add the
reset-token vault and MFA vaults. `070`–`077` are the hardening waves: `074` rewrites every
policy to use the `app.current_tenant()` / `app.current_user_id()` helpers so that an empty GUC
string evaluates to NULL (deny) instead of raising `22P02` (a 500), and `075` moves audit hash
computation into a database trigger so a caller can no longer supply its own hash. `079` makes the
`counselor` role actually issuable. Later files add classes, sections, subjects, payroll, RTE,
MPD, and action-plan features.

> **Honest flag — numbering drift.** The migration numbers in filenames are not contiguous and do
> not match the numbers in their file headers or in prose elsewhere. `064` and `065` are absent.
> There are four incompatible numbering systems in the project's history. This story therefore
> always names the *filename*, never "migration 74" as if the number were a coordinate.

### 1.3 `node scripts/bootstrap.js` — the roles and the wall

Migrations create tables. But tables in Postgres are guarded by *roles*, and the default roles do
not exist yet. So Dev runs the bootstrapper:

```
node scripts/bootstrap.js
```

This creates:

- **`schoolos`** — the owner. It owns every table and carries `BYPASSRLS = true`. It is used by
  migrations, by the seed, and by a small, greppable set of privileged runtime paths.
- **`schoolos_app`** — the constrained runtime role. It is `NOINHERIT`, granted to `schoolos`, and
  carries **no** `BYPASSRLS`. Every ordinary user request runs as this role, which is what makes
  RLS a property of the database rather than of developer discipline.

Then it applies the grants matrix. The load-bearing rule, written in capital letters in the
project's decision log as **D-35**, is: *the app role never gets `DELETE`*. A delete must go
through a scoped `SECURITY DEFINER` helper, so that every hard deletion is a named, auditable
act rather than a `DELETE FROM` that anyone could add in a handler. A test
(`tests/acl-d35.test.js`) guards the effect.

The bootstrapper also has to work around a genuinely nasty Postgres behaviour: a `postgres`-owned
default ACL can silently re-grant `DELETE` on any future table that the `postgres` role creates
in schema `app`. Migration `072` revoked `DELETE` everywhere and left one documented exception —
`student.mistake_note`, where a student hard-deletes their own private note through an audited
door. But the default ACL itself cannot be removed without superuser; until an operator runs the
printed command, the trap is armed. This story flags it again in the Epilogue because, months
later, it is still armed.

### 1.4 `npm start` — the API comes alive

Dev starts the HTTP process:

```
npm start
```

`server/src/index.js` is thirty-four lines long and mostly ceremony, but two lines matter:

```js
if (process.env.WORKER_ROLE === '1') {
  console.error('WORKER_ROLE=1 on the HTTP entrypoint — the API would boot with prod guards disabled...');
  process.exit(1);
}
```

and the graceful-shutdown handler at the bottom, which sets `app.schoolosDraining = true` on
`SIGINT`/`SIGTERM`, gives `app.close()` up to fifteen seconds, and forces exit if it hangs.

Why the `WORKER_ROLE` guard? Because worker processes need only `DATABASE_URL`; they must not be
crash-looped by HTTP-only guards like `CORS_ORIGINS` or `JWT_SECRET`. The guard prevents someone
from accidentally starting the API with the worker flag, which would disable the production
guards. The factory's decision log calls this out by test number (T101).

Then `buildApp()` in `server/src/app.js` assembles the whole world in a strict order:

1. **Database pool** — `max: 20`, `connectionTimeoutMillis: 5000`, `statement_timeout: 15_000`,
   `idle_in_transaction_session_timeout: 60_000`, and a server-level `lock_timeout=5s`.
2. **CORS** with credentials disabled, then **rate limiting at 300 requests/minute**.
3. **JWT** decoration.
4. **Kernel routes** (`app.js` + `routes.js`).
5. **Onboarding routes** — mounted *before* plugins, deliberately, so that signup works on a
   school that has no plugins enabled yet.
6. **`loadPlugins`** — the plugin registry. This is boot-fatal: if any plugin folder fails to
   mount, the loader collects *all* errors and the process dies. The loader's stated law is
   *"a plugin that cannot mount must never half-exist."*
7. **Platform doors**: `/dataset`, `/capabilities`, `/ai/*`, `/workflow-rules`, `/metrics`.

Dev watches the log line print:

```
SchoolOS API on :8080 [production]
SchoolOS build <fingerprint>
```

### 1.5 The health doors

Dev opens a browser and hits the platform's health doors.

`GET /health` returns 200, or 200-with-degraded when the database is down. `GET /ready` returns
503 when the platform is not ready to serve. `GET /metrics` returns Prometheus text including
gauges that are deliberately honest — the "honesty gauges" exist precisely because a system that
reports only success looks identical whether it is healthy or merely idle. The metrics endpoint is
restricted to `owner`/`itadmin`.

### 1.6 The workers — and the six that nobody schedules

Here is the first place the story must tell the truth about a gap that will echo all the way to
the Epilogue.

The API does **not** do background work inline. When a write needs something to happen later — a
message to send, a rule to evaluate, a webhook to deliver, old data to archive — it writes a row
to `app.outbox` and returns immediately. Separate **worker processes** drain that queue. On Dev's
box, `server/scripts/` contains:

- `outbox-worker.js` — the relay. Claims rows `FOR UPDATE SKIP LOCKED`, retries with exponential
  backoff via `next_attempt_at`, and **parks** rows after eight attempts. Migration `073` added
  `parked_at` so a total relay failure stops looking metrically identical to an idle system.
- `comms-dispatcher.js` — claims `status='queued'` rows from `app.communications`, resolves the
  channel to a rail (`sms → rails.sms`, `whatsapp → rails.whatsapp`, anything else → log-only),
  stamps `sent`/`sent_at` on success, and backs off/park-after-8 on failure. A **fourth outcome**,
  `undeliverable`, exists for the case where sandbox meets production — a sandboxed send is never
  labelled delivered. It refuses (rather than truncates) an audience over 500 recipients.
- `webhook-worker.js` — signed outbound webhooks, header
  `x-schoolos-signature: t,v1=hmac(secret,'t.body')`.
- `workflow-worker.js` — evaluates `app.workflow_rules` against newly scanned outbox rows,
  writing exactly one action per matching rule with `dedup_key='wf:<rule>:<event>'`, stamping its
  scan marker **last, in the same transaction**.
- `retention-worker.js` — chain-preserving cold archival of old audit rows.
- `day-worker.js` — four contained daily steps including dunning.
- `dunning-reminders.js`, `homework-reminders.js`, `reconcile-payments.js`,
  `replay-erasure-journal.js` — the rest of the scheduled family.

Now the gap. `server/docker-compose.yml` (or the deployment recipe an operator follows) starts
`api`, `retention`, `outbox`, and `comms`. The **workflow, webhook, day, dunning, and reconcile**
workers are shipped but **never scheduled by default**. The project's own ops audit records this
as OPS-8: *in a real deploy today, rules, webhooks, retention-not-in-compose, dunning and
reconciliation silently don't run.* The story will show the consequence twice — once when a
workflow rule fails to fire, and once when a dunning reminder never sends — and will mark both
with this chapter as their cause.

There are also in-process timers in the API: only the metrics flush and a notification path.
There is no cron inside the API.

> **Honest flag — the documented production start order is inverted.** The shipped compose file
> runs `bootstrap` before `migrate`. On a *fresh* database that is the wrong order — bootstrap
> references tables that do not exist until migrations have run — so the only documented
> production start path cannot boot a fresh database (ops finding OPS-1). CI never builds or
> smoke-runs the image (OPS-14), so this stays invisible. Dev, who has read the audit, runs
> `migrate` then `bootstrap` by hand.

### 1.7 Backups

Last thing before bed, Dev reads `server/scripts/backup.sh`. It is, unusually, described in the
project's audit as *"genuinely good"*: it dumps roles and globals, dumps each database in
custom format (`-Fc`), verifies each dump with `pg_restore --list`, writes a `.incomplete` marker
while a dump is in flight, uses `umask 077`, and keeps seven days. But nothing schedules it —
`crontab` is not even installed on the reference host. Dev adds a systemd timer himself. He also
adds `backups/` to `.gitignore`, because on the reference host the manual backup dumps were
world-readable (`0644`) and contained child PII, and `backups/` was one `git add -A` away from
being committed.

At 00:20, Dev closes the laptop. The database is empty, the wall is up, the registry book is
blank, and the promise river is dry. Chapter 2 begins when a stranger knocks on the front door.

<!-- END OF PART 1 -->

---

## Chapter 2 — The Knock: Green Valley Signs Itself Up

### 2.1 The woman at the browser

On Monday morning, **Ananya Kulkarni** opens her laptop in the staff room of Green Valley Public
School in Nashik. Green Valley has 412 students, a rented building with three floors, a peacock
on the water tank, and a business problem: admissions season starts in three weeks and every
enquiry is tracked in a paper register that two different people keep differently.

A colleague forwarded her a link: `https://app.greenvalley.example/onboard`. She clicks it. This
is the first time a human being outside the company has touched the platform.

The frontend is a React 19 single-page app. The router is `BrowserRouter` with lazy chunks and a
root `ErrorBoundary`. The `/onboard` path is **public** — no `AuthGate`, no `KernelGate`, no role
guard. It renders `app/src/screens/Onboard.tsx`.

Ananya sees a small card, the same visual language as the login screen: the "S" logo mark, a
three-segment progress bar, and the heading **Start your school**. There is no sales form, no
"talk to us", no pricing tier. Just a form.

### 2.2 Step 0 — "Your school"

The first panel has a single required field, *School name*, plus three optional ones:

- **School name** — `Green Valley Public School`
- **Address** *(optional)* — `Survey 118, Gangapur Road, Nashik, Maharashtra 422013`
- **Board** *(optional)* — `CBSE`
- **Phone** *(optional)* — `+91 98330 22114`

Underneath is a sentence that Ananya reads twice: *"Your classes and sections are yours to
define — nothing is added for you. You'll set them up right after signup."*

That sentence is not decoration. It is the visible face of a policy decision in
`server/src/onboarding.js`:

```js
/* A new school starts with NO classes: the structure is the school's own to define ...
   Fabricating "1–8 × A/B/C" put sections on the roster that nobody chose and every filter
   then offered. */
const DEFAULT_SECTIONS = [];
```

Older versions of the product prefilled a section grid. There is a comment in the onboarding
guide from that era: *"section grid (grade × sections; a sensible default is prefilled)."* That
comment is now stale — the code deliberately starts empty. Keep this in mind; the story will
show the checklist nagging Ananya until she defines her own classes.

She clicks **Continue**. The button is disabled until `schoolName.trim().length >= 3` — a
client-side guard only, because the server will validate again. The click runs:

```js
onSubmit={(e) => { e.preventDefault(); school.schoolName.trim().length >= 3 && next(); }}
```

No HTTP request leaves the browser. `next()` just sets React state `step` to `1`. Step 0 is
entirely local. This matters: a signup screen that fired a request on every keystroke would be a
privacy leak and a load generator, and the story will keep pointing at the difference between
"the browser did a thing" and "the server did a thing."

### 2.3 Step 1 — "You, the owner"

The second panel collects the identity that will become both the login and the accountability
record:

- **Your full name** — `Ananya Kulkarni`
- **Your email — you will sign in with this** — `ananya@greenvalley.edu.in`
- **Choose a password** *(at least 8 characters)* — **she types it**

As she types the password, a four-segment strength bar fills based on
`STRENGTH(pw) = (len≥8) + (has upper) + (has digit) + (has symbol)`. It is purely advisory; the
server enforces only that the password is at least eight characters.

The button reads **Create my school**. When she clicks it, `submit()` runs, and *now* the network
wakes up.

### 2.4 The request that leaves the browser

`apiSignup` lives in `app/src/services/onboardingApi.ts`. It delegates to the single frontend
"fetch brain", `liveApi`:

```ts
export async function apiSignup(body) {
  const r = await apiPost<SignupOk>('/onboard/signup', body);
  setToken(r.token);   // the owner is signed in the moment their school exists
  return r;
}
```

`liveApi` sends the request to `VITE_API_BASE` (default `http://127.0.0.1:8080`) with
`credentials: 'same-origin'` and, for cookie sessions, an `X-CSRF-Token` header carrying the
`schoolos_csrf` cookie value. On this first request there is no token to attach, because there is
no account yet. The body is:

```json
{
  "schoolName": "Green Valley Public School",
  "address": "Survey 118, Gangapur Road, Nashik, Maharashtra 422013",
  "board": "CBSE",
  "phone": "+91 98330 22114",
  "ownerName": "Ananya Kulkarni",
  "ownerEmail": "ananya@greenvalley.edu.in",
  "ownerPassword": "<typed>"
}
```

`POST /onboard/signup`.

### 2.5 The server, line by line

The request enters Fastify. It passes the CORS hook and the rate limiter. The onboarding door is
registered with its own tighter limit:

```js
app.post('/onboard/signup', { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } }, async (req, reply) => {
```

Three signups per minute per IP. Then the kill-switch:

```js
if (process.env.SELF_SIGNUP_ENABLED !== undefined && process.env.SELF_SIGNUP_ENABLED !== 'true') {
  return reply.code(403).send({ error: 'New-school signups are paused on this platform...' });
}
```

Dev set `SELF_SIGNUP_ENABLED=true` in Chapter 1, so the door is open. Had he left it unset in
production, this is the exact 403 Ananya would have seen.

Then validation, in order:

1. `schoolName` must be a string, trimmed, 3–120 chars. "Green Valley Public School" passes.
2. `ownerName` must be non-empty.
3. `ownerEmail` must match `EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/` after lowercasing. Her email
   passes and is **normalised to lowercase** — so `Ananya@...` and `ananya@...` are the same
   login, which is a small mercy that prevents a whole class of "I typed my email with a capital
   letter" support calls.
4. `ownerPassword` must be ≥8 chars.

If all four pass, the handler assembles the tenant's configuration, derives a unique school code
(the "slug"), hashes the password, and opens **one owner-path transaction**.

The slug function is worth reading because it is the school's public-facing short name and it is
generated, not chosen:

```js
const slugify = (name) => String(name ?? '').toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 60) || 'school';
```

"Green Valley Public School" becomes `green-valley-public-school`. `uniqueSlug` then asks the
database — via `sysq`, the privileged pool, because no tenant is known yet — whether that slug is
taken, and appends `-2`, `-3`, … up to fifty times if it is. (This is one of the few legitimate
uses of the privileged path: you cannot scope a slug check by tenant when the tenant does not
exist yet.)

The configuration object becomes:

```json
{
  "address": "Survey 118, Gangapur Road, Nashik, Maharashtra 422013",
  "board": "CBSE",
  "phone": "+91 98330 22114",
  "setup": { "sections": [], "source": "self-signup", "at": "<ISO timestamp>" }
}
```

Note `sections: []`. Ananya did not supply a section grid and there is no default. The school is
born with no classes.

The password is hashed with scrypt at cost `N=2^17, r=8, p=1` — deliberately expensive, the
project's own note says this is why the test suite takes tens of minutes. Inside the transaction,
four things happen and they either all commit or none does:

**Row 1 — the tenant.**

```sql
INSERT INTO app.tenants (slug, name, config, onboarded_at, onboarded_via)
VALUES ($1,$2,$3::jsonb, now(), 'self-signup') RETURNING id, slug, name, config
```

**Row 2 — the owner user.**

```sql
INSERT INTO app.users (tenant_id, email, name, role, password_hash, active)
VALUES ($1,$2,$3,'owner',$4,true)
RETURNING id, email, name, role, tenant_id, session_epoch
```

The role is hard-coded `'owner'`. There is no parameter for it. This is the only place in the
entire product where an owner account may be created; `people.admin` structurally refuses
`role='owner'` (attempting it writes a high-risk audit row instead). The account is created with
`force_change` at its default of `false`, and the code carries a policy comment explaining why:

```js
/* M5 POLICY DECISION — no forced change on self-signup. Unlike an admin-provisioned account
   (people.admin mints a CSPRNG temporary password and stamps force_change=true so the person
   must replace a secret they did not choose), the owner here CHOSE their own password ... A
   forced change would be ceremony with no security benefit. */
```

**Row 3 — the entire plugin catalog.** Before this, the transaction scopes itself to the new
tenant, because `app.plugins` is RLS-protected and the policy demands the tenant GUC:

```js
await client.query(`SELECT set_config('schoolos.tenant_id', $1, true)`, [t.id]);
await ensurePluginCatalog(client, t.id);
```

`ensurePluginCatalog` (in `plugin-catalog.js`) loops over a hard-coded array of 29 plugin
descriptors and inserts one `app.plugins` row per plugin, `WHERE NOT EXISTS` so it is idempotent.
Each row gets a `version`, a `class`, a `permissions` array, an `entitlement`, a `trust_level` of
`T1`, an `event_budget` of `{"events_per_min":60,...}`, and an `ai_budget` of
`{"calls":200,"tokens_per_day":200000}`. Crucially, the row's **status** depends on one line:

```js
const DEFAULT_ON = new Set(['people.admin', 'ops.visitors', 'ops.timetable', 'files.store']);
const status = DEFAULT_ON.has(p.plugin_id) ? 'enabled' : 'registered';
```

Four plugins are **on at birth**: `people.admin` (so the owner can create staff),
`ops.visitors` (so the front desk works day one), `ops.timetable` (so schedules exist), and
`files.store` (so files can be stored). Everything else — the library, fees rails, transport,
admissions, exams, the AI copilots, SMS/WhatsApp/email — is born `registered` and stays dark
until an owner consciously turns it on.

> **Honest flag — the "5 DEFAULT_ON" claim.** Several documents (including an older onboarding
> walkthrough) say five modules are born on and list `library` among them. The code says four,
> and the library is *deliberately excluded* with a comment: *"The LIBRARY is deliberately NOT in
> this set ... it is opt-in, and it stays locked until a librarian account exists."* Trust the
> code: four. This is a small but concrete example of why this story re-verifies documents.

`ensurePluginCatalog` does more than insert. It then reconciles each row's permissions against
the plugin's on-disk `manifest.js` (so a stale catalog row cannot under-grant a plugin), merges
the module's real `settingsSchema` into the stored manifest (without clobbering six plugins whose
stored schema their file manifest does not declare), encrypts any legacy plaintext plugin
secrets it encounters (SEC-23), and seeds one default workflow rule:

```sql
INSERT INTO app.workflow_rules (tenant_id, name, topic, condition, action, enabled, created_by)
SELECT $1, 'Admissions: enquiry → follow-up pipeline', 'admission.enquiry.captured', NULL,
       '{"kind":"outbox","topic":"admission.followup.scheduled"}'::jsonb, true, NULL
WHERE NOT EXISTS (...)
```

That rule says: when an admission enquiry is captured, emit an outbox topic
`admission.followup.scheduled` — *without* auto-messaging a guardian. It is the seed of Green
Valley's admissions pipeline, planted before Ananya has done anything.

**Row 4 and 5 — the ledger and the promise.** Still inside the transaction:

```js
await auditLog(client, t.id, {
  actor: ownerName, actorRole: 'platform', action: 'Tenant onboarded (self-signup)',
  recordType: 'Tenant', recordRef: `${t.slug} · ${ownerEmail}`,
  reason: 'school-owner signup', policyRef: 'Platform §1.1 (tenant provisioning)', risk: 'medium',
  outcome: `school '${t.name}' created with its first owner — no student data yet` });

await emitEvent(client, t.id,
  { type: 'platform', label: `New school onboarded: ${t.name} (${t.slug})` },
  'platform.tenant.onboarded.v1',
  { tenantId: t.id, slug: t.slug, ownerUserId: u.id, ownerEmail: u.email, sections });
```

The audit write goes through `auditLog`, which takes a per-tenant advisory lock, reads the
current chain head (`'GENESIS'` for a brand-new tenant), and calls the `SECURITY DEFINER`
function `app.audit_append(...)`. The hash is computed by a database trigger (`audit_pin_hash_bi`,
migration `075`), not by JavaScript — a hardening from the "075 integrity saga," in which it was
discovered that 26 of 53 development audit rows did not reproduce from their own columns and one
row had demonstrably been altered after insertion. The ledger now *pins* its own hashes.

`emitEvent` writes **two rows atomically**: one `app.events` row (the human-readable spine) and
one `app.outbox` row (the machine envelope) carrying topic `platform.tenant.onboarded.v1`. Since
the workflow, webhook, and day workers are not scheduled on Dev's box, the promise to act on this
event will sit in the outbox until the outbox relay (which *is* scheduled) drains it — and the
relay's only subscriber today is a log line. This is the first instance of a pattern the story
will name repeatedly: **the event is real, the consumer may not exist.** The event is not a lie;
it is an unkept appointment.

Then:

```js
await client.query('COMMIT');
```

### 2.6 The response, and a token held only in memory

After the commit — deliberately *after*, so a cookie is never minted for a rolled-back
transaction — the handler signs a JWT:

```js
const token = app.jwt.sign({
  sub: u.id, role: u.role, tenant: u.tenant_id, name: u.name,
  jti: randomUUID(), ep: u.session_epoch ?? 1
}, {});
```

The claims are: subject (user id), role (`owner`), tenant (the new school's UUID), name, a
revocable id (`jti`), and the session epoch (`ep`). Then:

```js
app.issueSessionCookies(reply, token);
return { token, user: {...}, tenant: {...}, next: { checklist: ['/onboard/status'] } };
```

The cookie pair — an HttpOnly `schoolos_session` and a readable `schoolos_csrf` — is the durable
credential in a same-origin deployment. The bearer token in the body is what the client keeps in
**memory**, by design. This split is subtle and load-bearing:

> **Honest flag — a previously-fixed bug worth narrating.** The code comment records that
> `/onboard/signup` "has always returned the same `{ token, user }` BODY, but not the
> HttpOnly cookie pair." In a same-origin deployment, the cookie is the durable credential, and a
> cold open exchanges it for a bearer via `POST /auth/renew`. Without the cookie, a freshly
> signed-up owner was bounced straight back to `/login` on the first refresh, because the bearer
> alone is memory-only. The fix issues the cookies after the commit. The story flags it because it
> is exactly the kind of seam where the demo works (nobody refreshes during a demo) and the real
> school fails.

The response body is:

```json
{
  "token": "<jwt>",
  "user": { "id": "...", "name": "Ananya Kulkarni", "role": "owner",
            "email": "ananya@greenvalley.edu.in", "tenantId": "..." },
  "tenant": { "id": "...", "slug": "green-valley-public-school",
              "name": "Green Valley Public School" },
  "next": { "checklist": ["/onboard/status"] }
}
```

### 2.7 What the browser does with it — the first four authenticated GETs

`apiSignup` calls `setToken(r.token)`, which stores the bearer in the `liveApi` module's memory
(not `localStorage`). The onboarding screen then calls `ensureDataset()`:

```js
try { await ensureDataset(); } catch { /* an empty school has no dataset — the app handles empty states */ }
```

`ensureDataset()` issues `GET /dataset`. On the server, `/dataset` is served from a bundle of
mock modules, function-stripped and date-revived, behind an **allowlist**. Green Valley is not the
demo tenant, so the allowlist returns an empty world. The request succeeds with almost nothing in
it. The `catch` is there because an empty world is not an error — it is the correct state for a
school with no students.

Ananya now sees step 2 of the card: **"Green Valley Public School is ready — You are signed in as
its owner."** with three numbered next steps and a button, **Set up my school**. Clicking it calls
`enterApp()`:

```js
navigate('/people-admin', { replace: true });
```

It is a **client-side navigation on purpose**. The comment explains: *"Token is already held in
memory. Navigate client-side so the session survives ... A hard reload would drop the memory-only
bearer and bounce straight back to /login."*

The route change re-mounts the authenticated shell. Its `AuthGate` does not trust anything it
holds locally. It performs a cold validation: `apiMe()` → `GET /me`, and in parallel a silent
`POST /auth/renew` probe. Only a live `/me` answer creates a session.

### 2.8 The corridor, for real: `GET /me`

Every subsequent request now walks the corridor described in the Prologue. For `GET /me` it looks
like this.

The JWT is decoded (signature verified). `jti` is present. The denylist is checked: no row in
`auth.revoked_token`. The user row is re-read **from the database**:

```sql
SELECT id, tenant_id, name, role, pg_role, email, session_epoch, force_change, mfa_enrolled_at
FROM app.users WHERE id=$1 AND active
```

This is the part people get wrong about JWT systems: the token's `role` claim is *not*
authoritative. If someone's role changed or their account was disabled, the next request finds out
from the row. If `session_epoch` in the row differs from the claim's `ep`, the session is dead.
Then the custom-role mask is applied to every authenticated door, including this one. Then
`require(...)` and `withUser(tenant, role, fn)` open a transaction as the constrained
`schoolos_app` role with the tenant GUC set, and the `/me` handler returns the live identity.

The response to `GET /me/effective` (which the shell calls next) is richer: it returns the
role's effective capabilities and render hints, which the client uses to decide which navigation
items to show. The client's guard is **display-only**; the server re-decides every door.

### 2.9 The four more requests the new owner's shell fires

On the first authenticated paint of `/people-admin`, the shell and screen issue a small burst of
reads. The project's browser-captured record of a real signup shows the shape:

```
POST /onboard/signup          → 200   (tenant + owner + catalog + ledger + event)
GET  /dataset                 → 200   (empty world for a non-demo tenant)
GET  /plugins                 → 200   (29 catalog rows, 4 enabled)
GET  /me                      → 200
GET  /me/effective            → 200
GET  /onboard/status          → 200   (checklist: classes ☐, itadmin ☐, students ☐, plugins ☐)
```

Notice `GET /plugins`. That door has a quirk the story will not let pass: **it writes**. It
self-heals the catalog — if a tenant is somehow missing a registry row, the GET inserts it. A GET
that mutates is a code smell, and the project knows it: the permissions matrix annotates it with a
warning. For a fresh signup it is a harmless idempotent upsert, but the story flags it because
"the client only read something" is not true here.

`GET /onboard/status` returns the honest checklist:

```json
{
  "school": { "name": "Green Valley Public School", "slug": "green-valley-public-school",
              "onboardedAt": "...", "sections": [] },
  "counts": { "students": 0, "itadmins": 0, "accounts": 1, "plugins_enabled": 4 },
  "checklist": [
    { "id": "classes",  "label": "Define your classes and sections", "done": false, "href": "/classes" },
    { "id": "itadmin",  "label": "Create your IT admin ...",          "done": false, "href": "/people-admin" },
    { "id": "students", "label": "Admit your first students",          "done": false, "href": "/people-admin" },
    { "id": "plugins",  "label": "Switch on the modules you need ...", "done": false, "href": "/plugins" }
  ]
}
```

Every item is undone. The plugins item is computed as `plugins_enabled > DEFAULT_ON.size` — i.e.
`4 > 4` is false. This is a deliberate fix recorded as S0-C10: counting the four born-on modules
made the item born-done and useless, so it now completes only when the school switches on
something *beyond* its birth set. A checklist that starts all-green teaches the user to ignore it.

### 2.10 The empty world, honestly

At the end of Chapter 2, the database contains, for Green Valley:

- one row in `app.tenants`;
- one row in `app.users` (Ananya, `owner`);
- 29 rows in `app.plugins` (4 `enabled`, 25 `registered`);
- one row in `app.audit_log` (`Tenant onboarded (self-signup)`);
- one row in `app.events` and one in `app.outbox` (`platform.tenant.onboarded.v1`);
- one row in `app.workflow_rules` (the admissions follow-up rule);
- zero students, zero guardians, zero classes, zero sections, zero subjects, zero academic years,
  zero fee plans, zero obligations, zero payments, zero attendance, zero anything else.

Ananya has spent under five minutes and made one POST. She is now the accountable administrator of
a school inside a system that, from this moment, will record who she is, what she does, and why.

> **Aside — what did *not* happen.** No email verification was sent. `onboarding.js` is explicit
> about the reason: there is no sender in the platform, so the mitigations are the 3/minute rate
> limit, the kill-switch, the audit trail, and the fact that a signup creates an *empty* tenant —
> no student data to steal. The story agrees with the code's honesty here and will note the
> trade-off again in the Epilogue: an attacker can sign up on many domains, but they cannot reach
> a real school's records, because there are none behind a fresh signup.

<!-- END OF PART 2 -->

---

## Chapter 3 — The Owner Draws the Skeleton

### 3.1 The first thing a new school needs is a shape

Ananya clicks the checklist item **Define your classes and sections**, or the nav item
**Classes**, and lands on `/classes`. The screen is gated for writes to a set the code calls
`CLASSES_ADMIN` — owner, principal, and IT admin. The *read* is open to any signed-in caller,
because every class picker in the app needs the list.

The screen issues `GET /school/classes`. The handler is deliberately tiny:

```js
app.get('/school/classes', { preHandler: me }, async (req) => {
  return withUser(req.user.tenant_id, req.user.role, async (c) => {
    const t = (await c.query(`SELECT config FROM app.tenants WHERE id=$1`, [req.user.tenant_id])).rows[0];
    const parsed = normalizeClasses(t?.config?.setup?.sections ?? []);
    return { classes: parsed.ok ? parsed.classes : [] };
  });
});
```

The list comes from `app.tenants.config.setup.sections` — the JSONB column that is the only
config column in the entire database. It returns `{ classes: [] }`. Ananya sees an empty screen.

> **Honest flag — where did the "prefilled section grid" go?** Until a recent pass, the signup
> flow prefilled a grid of grades and sections, and the onboarding walkthrough still described
> one. The code now starts empty on purpose, with the reasoning quoted in Chapter 2. The story
> follows the code: Green Valley starts with no classes, and this screen is where it gets them.

### 3.2 Ananya builds 13 classes and 23 sections

Ananya types her structure. She runs Nursery through Grade 10 (she has no XI–XII yet). She gives
Nursery, Jr KG and Sr KG one section each; Grades 1–10 two sections each (A and B). The screen
assembles:

```json
{ "classes": [
  { "grade": "Nursery", "sections": ["A"] },
  { "grade": "Jr KG",   "sections": ["A"] },
  { "grade": "Sr KG",   "sections": ["A"] },
  { "grade": "1", "sections": ["A","B"] },
  { "grade": "2", "sections": ["A","B"] },
  { "grade": "3", "sections": ["A","B"] },
  { "grade": "4", "sections": ["A","B"] },
  { "grade": "5", "sections": ["A","B"] },
  { "grade": "6", "sections": ["A","B"] },
  { "grade": "7", "sections": ["A","B"] },
  { "grade": "8", "sections": ["A","B"] },
  { "grade": "9", "sections": ["A","B"] },
  { "grade": "10","sections": ["A","B"] }
] }
```

She clicks **Save**. `PUT /school/classes`.

The server validates the shape with `normalizeClasses(req.body?.classes)` and, if the shape is
wrong, returns a human sentence via `bad(reply, parsed.error)` rather than a schema-library dump.
Then, inside `withUser`, it does something careful:

```js
const cur = (await c.query(`SELECT name, config FROM app.tenants WHERE id=$1 FOR UPDATE`, [req.user.tenant_id])).rows[0];
const nextConfig = { ...(cur.config ?? {}) };
nextConfig.setup = { ...(nextConfig.setup ?? {}), sections: classes, updatedAt: new Date().toISOString() };
await c.query(`UPDATE app.tenants SET config=$1::jsonb WHERE id=$2`, [JSON.stringify(nextConfig), req.user.tenant_id]);
```

Three things to notice:

1. **`FOR UPDATE`** locks the tenant row. This is a read-modify-write on a JSONB blob, and
   without the lock two concurrent edits (say, Ananya changing classes while her principal edits
   the school profile) would lose one writer's change. The project's audit calls this RTE-19.
2. The config is written as a **whole object**, not a targeted JSON path. That is simpler to reason
   about and, with the lock, safe.
3. This is the *fast read* the pickers use. But it is not the only place the structure lives.

Then comes the part that makes the structure real for the rest of the system. The handler walks
the classes and **upserts** them into real tables:

```js
const row = (await c.query(
  `INSERT INTO app.classes (tenant_id, name, sort_idx, active) VALUES ($1,$2,$3,true)
   ON CONFLICT (tenant_id, name) DO UPDATE SET sort_idx=EXCLUDED.sort_idx, active=true RETURNING id`,
  [req.user.tenant_id, cls.grade, i])).rows[0];
for (const sec of cls.sections) {
  await c.query(
    `INSERT INTO app.sections (tenant_id, class_id, name, active) VALUES ($1,$2,$3,true)
     ON CONFLICT (tenant_id, class_id, name) DO UPDATE SET active=true`,
    [req.user.tenant_id, row.id, sec]);
}
```

And then, for anything that was removed, it does **not** delete. It marks it inactive:

```js
await c.query(
  `UPDATE app.sections SET active=false WHERE tenant_id=$1 AND class_id=$2 AND active AND name <> ALL($3::text[])`,
  [req.user.tenant_id, row.id, cls.sections]);
// ...
await c.query(
  `UPDATE app.classes SET active=false WHERE tenant_id=$1 AND active AND name <> ALL($2::text[])`,
  [req.user.tenant_id, classes.map((x) => x.grade)]);
```

This is law D-35 in miniature: the application role has no `DELETE` on these tables. If Ananya
later drops Grade 10 because it was a typo, the class row survives with `active=false`, and any
historical attendance, fee, or assignment that pointed at it still resolves. A school's structure
is a record of what existed; deleting it would orphan history.

Finally the write leaves evidence — an audit row and an event:

```js
await auditLog(c, req.user.tenant_id, {
  actor: req.user.name, actorRole: req.user.role, action: 'Updated classes & sections',
  recordType: 'Tenant', recordRef: cur.name,
  reason: `classes: ${classes.map((x) => `${x.grade}(${x.sections.join('/') || 'no sections'})`).join(', ') || 'none'}`,
  policyRef: 'School structure', risk: 'low',
  outcome: `${classes.length} class(es) · ${sectionCount} section(s)` });

await emitEvent(c, req.user.tenant_id,
  { type: 'platform', label: `Classes & sections updated (${classes.length} classes)` },
  'platform.school.classes.updated.v1', { by: req.user.id, classes: classes.length, sections: sectionCount });
```

The audit row's `reason` field literally contains the structure Ananya typed, class by class.
If anyone ever asks "when did Green Valley have Grade 9?", the ledger answers.

### 3.3 Subjects

Next, `/classes` also shows the subject list, served by `GET /school/subjects`:

```sql
SELECT id, name, code, is_elective AS "isElective", is_skill AS "isSkill"
FROM app.subjects WHERE tenant_id=$1 AND active ORDER BY name
```

Ananya adds the eleven subjects a CBSE school of her size teaches: English, Marathi, Hindi,
Mathematics, Science, Social Science, Computer Science, Art, Physical Education, Music, and one
more she'll decide later. Each `POST /school/subjects` is **idempotent on name**:

```sql
INSERT INTO app.subjects (tenant_id, name, code, active, is_elective, is_skill)
VALUES ($1,$2,$3,true,$4,$5)
ON CONFLICT (tenant_id, name) DO UPDATE SET active=true, code=COALESCE(EXCLUDED.code, app.subjects.code),
  is_elective=EXCLUDED.is_elective, is_skill=EXCLUDED.is_skill
RETURNING ...
```

Adding "English" twice does not 409 — it reactivates it and keeps the existing code if the new
call omitted one. The handler audits `Subject added` and emits
`platform.school.subject.added.v1`.

Why do subjects exist as a table when homework and exams use a free-text `subject` column? The
code comment gives the reason: the free-text columns are display values, but a *reference* is what
new code — timetable generators, substitution engines, curriculum trees — can join on. This is a
recurring pattern in the product: keep the human-facing string, and add a structural reference
beside it, and make a trigger or a door keep them in step.

### 3.4 The academic year, and a one-row law enforced by the database

Ananya goes to the academic-year card and creates `2026–27`, `2026-06-15` to `2027-04-30`, and
marks it current. `POST /academic-years`.

The handler validates the name length, the `YYYY-MM-DD` date shape, and `ends_on > starts_on`.
Then, if the caller asked for `is_current: true`, it first clears any other current year **in the
same transaction**:

```js
if (b.is_current === true)
  await c.query(`UPDATE app.academic_years SET is_current=false, updated_at=now() WHERE tenant_id=$1 AND is_current`, [req.user.tenant_id]);
const r = await c.query(
  `INSERT INTO app.academic_years (tenant_id, name, starts_on, ends_on, is_current)
   VALUES ($1,$2,$3,$4,$5) RETURNING id, name, starts_on, ends_on, is_current`,
  [req.user.tenant_id, name, startsOn, endsOn, b.is_current === true]);
```

The code comment is precise: the transaction making the new year current is *convenience*; the
**law** is a partial unique index (`academic_years_one_current_idx`, migration `055`) that
Postgres enforces, so even a buggy handler or a race cannot produce two current years. The handler
catches `23505` and distinguishes the two possible unique violations by constraint name:

```js
if (e.code === '23505')
  return bad(reply, e.constraint === 'academic_years_one_current_idx'
    ? 'another academic year was just set current — reload and retry'
    : 'an academic year with this name already exists', 409);
```

This is the shape of "database as the last wall" that runs through the whole system: the handler
does the convenient thing, and the database refuses the illegal thing.

Activating a different year is its own door, `POST /academic-years/:id/activate`, locked with
`FOR UPDATE`, and guarded by `owner`/`principal` only. It flips the old year off and the new one
on, audits `Activated academic year`, and emits an event.

### 3.5 The school profile

Ananya also edits the school profile — name, address, board, phone — through
`POST /onboard/school`, owner-only. The handler is another careful JSONB read-modify-write with
`FOR UPDATE` (the lost-update guard again), and it audits `Updated school profile` and emits
`platform.school.updated.v1`. It is the same pattern as classes: validate, lock, mutate the JSONB,
audit, emit, commit.

> **Aside — "no campuses".** A note in the code says plainly: *"No campuses: a school is ONE site.
> A second site is a second tenant, not a campus of this one."* The UI still contains a
> client-side campus switcher (`ROLE_CAMPUS`), and the story flags it here: there is **no server
> campus scoping**. The switcher is display theatre. A school with two physical sites gets two
> tenants and, if it wants shared oversight, whatever cross-tenant reporting the owner builds by
> switching. This is an honest architectural decision documented as such, but the presence of a
> campus switcher with no server behind it is exactly the sort of seam this book exists to expose.

### 3.6 What Green Valley now contains

After Chapter 3:

- `app.tenants.config.setup.sections` holds 13 classes and 23 sections;
- `app.classes` holds 13 rows, `active=true`;
- `app.sections` holds 23 rows, `active=true`;
- `app.subjects` holds 11 rows;
- `app.academic_years` holds one row, `is_current=true`;
- four more audit rows and four more event/outbox pairs;
- still zero students.

The skeleton is drawn. Now Ananya needs people to hang on it, and modules to make the days move.

<!-- END OF PART 3 -->

---

## Chapter 4 — Switching On the World (And How a Switch Can Never Lie)

### 4.1 The switchboard screen

Ananya opens `/plugins`. This is the screen the product calls **Modules**. It lists every plugin
in the catalog with a switch. On day one, four switches are on and twenty-five are off.

The screen calls `GET /plugins`. Under the hood that read does more than read.

```js
app.get('/plugins', { preHandler: me }, async (req) => {
  return withUser(req.user.tenant_id, req.user.role, async (c) => {
    await ensurePluginCatalog(c, req.user.tenant_id);   // self-heal
    ...
```

**A GET that writes.** `ensurePluginCatalog` is invoked on a read door. Its purpose is
self-healing: a tenant provisioned before catalog seeding existed has zero registry rows, so the
manager would have no switches. The GET fills them in. The project's own permissions map annotates
this with a warning. It is idempotent and benign, but the story records it: if you are reasoning
about which requests mutate state, `GET /plugins` is one of them.

Next, the read decides how much of each plugin's settings to disclose, based on the caller's role:

```js
const privileged = isPrivileged(req.user.role);
const r = (await c.query(
  `SELECT plugin_id, version, class, status, (status IN ('enabled','active','degraded')) AS enabled,
          manifest, permissions, settings, entitlement, enabled_at FROM app.plugins ORDER BY plugin_id`)).rows;
...
if (privileged) return { ...p, ...availability, settings: maskSettings(p.settings) };
const keys = Object.keys(p.settings ?? {});
return { ...p, ...availability, settings: undefined, hasSettings: keys.length > 0, keys, settings_schema: p.manifest?.settingsSchema ?? null };
```

A non-privileged caller never sees settings *values* — only which keys exist and the schema needed
to render a write-only form. This is one of the SEC-2 hardenings: plugin settings are where the
secrets live (SMTP passwords, gateway keys, webhook secrets), and a coordinator must be able to
see that a plugin is configured without being able to read the credential.

The read also returns the **capability contracts** — `app.capability_contracts` — because a
plugin's *capabilities* are declared as data, not just as code. It marks whether a plugin is
available on the tenant's plan (`planIncludes(tenantPlan, pluginId)`) and what plan it requires.

> **Honest flag — a write door with no UI.** The old demo `/it` screen showed keys, webhooks,
> revocation and rotation controls. Most of those render permanently disabled, because the server
> doors for key **rotation** and **flag toggling** do not exist — only list/create/revoke for API
> keys and webhooks. The screen is now honest about it, but the story records the gap.

### 4.2 Enabling a plugin: the server refuses to trust the client

Ananya decides to turn on the **library** for her school. She flips the switch. The client sends:

```
POST /plugins/library/enable
```

with an essentially empty body. That emptiness is the point. Read the enable handler's comment:

```js
/* PLG-4: the client supplies NO registry metadata. `version`, `class` and `manifest` used to come from the
   request body, so a caller could claim library — really class C — was class A with one permission; and
   because PLG-1 made the recorded grant the only grant, the audit record of consent was client-authored. */
```

So the server ignores the body and resolves everything from the **on-disk manifest**,
`server/src/plugins/library/manifest.js` — the same file the plugin loader mounts:

```js
const manifestFile = await declaredManifest(req.params.id);
if (!manifestFile) return bad(reply, `No module on disk for plugin '${req.params.id}'`, 404);
const declared = Array.isArray(manifestFile.permissions) ? manifestFile.permissions.map(String) : [];
const invented = unknownPermissions(declared);
if (invented.length) return bad(reply, `the manifest declares permissions outside the kernel vocabulary: ${invented.join(', ')}`);
const version = typeof manifestFile.version === 'string' ? manifestFile.version : '1.0.0';
const pClass = manifestFile.class;
if (!pClass || !['A','B','C','D','E'].includes(pClass)) return bad(reply, 'the plugin manifest must declare a class A–E');
if (!kernelSatisfies(manifestFile.kernel)) {
  return bad(reply, `Plugin '${req.params.id}' requires kernel ${manifestFile.kernel}; this server runs kernel ${KERNEL_VERSION}.`, 409);
}
if (Buffer.byteLength(JSON.stringify(manifestFile)) > 65536) return bad(reply, 'manifest too large (max 64KB)', 413);
```

Five gates before any write:

1. **A module must exist on disk.** No folder, no enable. This prevents a registry row for a
   plugin that cannot actually mount.
2. **Declared permissions must be in the kernel's vocabulary.** A plugin cannot invent a capability
   the kernel does not understand.
3. **The manifest must declare a class A–E.** These classes describe trust and blast radius.
4. **Kernel compatibility.** The manifest declares a required kernel version; a mismatch is a 409,
   not a best-effort mount.
5. **Manifest size.** 64 KB cap, to bound what can be smuggled into the registry.

Then, inside the transaction, three more gates:

```js
const plan = (await c.query(`SELECT plan FROM app.tenants WHERE id=$1`, [req.user.tenant_id])).rows[0]?.plan ?? 'trial';
if (!planIncludes(plan, req.params.id)) return reply.code(402).send(notEntitled(req.params.id, plan));
```

**Plan entitlement** — a 402 (Payment Required), *before* any write, so an unentitled enable
leaves nothing half-created. Green Valley is on the default plan that includes modules, so library
passes.

```js
for (const dep of dependencies) {
  const row = (await c.query(`SELECT version, status FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`, [req.user.tenant_id, dep.id])).rows[0];
  if (!row || !['enabled','active','degraded'].includes(row.status)) {
    return bad(reply, `Plugin '${req.params.id}' requires '${dep.id}' to be enabled first.`, 409);
  }
  if (semverCmp(row.version, dep.version) !== 0) {
    return bad(reply, `Plugin '${req.params.id}' requires '${dep.id}' version ${dep.version}; found ${row.version}.`, 409);
  }
}
```

**Declared dependencies** must be enabled at the exact required version. And then the write
itself, which reconciles the stored manifest rather than overwriting it:

```js
const fileSchema = manifestFile.settingsSchema ?? manifestFile.settings_schema ?? null;
const mergedManifest = { ...(prevManifest ?? {}), ...manifestFile };
if (fileSchema === null && (prevManifest?.settingsSchema ?? prevManifest?.settings_schema) != null) {
  mergedManifest.settingsSchema = prevManifest.settingsSchema ?? prevManifest.settings_schema;
} else if (fileSchema !== null) {
  mergedManifest.settingsSchema = fileSchema;
}
const r = await c.query(
  `INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, manifest, permissions, enabled_at, enabled_by)
   VALUES ($1,$2,$3,$4,'enabled',$5::jsonb,$6::jsonb, now(), $7)
   ON CONFLICT (tenant_id, plugin_id) DO UPDATE SET status='enabled', ... RETURNING *`, ...);
```

The merge is not cosmetic. Six plugins (`ops.timetable`, `payments.razorpay`, `payments.upi`,
`comms.whatsapp`, `accounting.tally`, `transport.gps`) store their settings schema under the
snake_case key `settings_schema` in the file manifest while the rest of the system reads
`settingsSchema`. A naive "write the file manifest verbatim" would blank their schema and make
them unconfigurable after a re-enable. The comment records that a full test run caught this
regression. The story notes it because it is the kind of bug that only appears when the code and
the declaration disagree about a key's spelling.

The audit row names the plugin, its class, and its permissions:

```
action:  Plugin enabled: library
reason:  class C (from the manifest) · permissions: students.read, users.read, events.emit, audit.request
policy:  Platform §3.1 (plugin governance)
risk:    medium
```

### 4.3 The lifecycle gate — why a switch is real at request time

Here is the crucial design decision. A plugin's enablement is **not** decided when the server
boots. The loader mounts every plugin folder regardless of any tenant's switches. What changes is
a **per-request** check, `_shared/lifecycle-gate.js`:

```
lifecycleGate(sysq, id):  read app.plugins.status for this tenant+plugin
                          if status ∉ {enabled, active, degraded} → 409 with a friendly label
```

Every plugin door carries this gate in its `preHandler`. Consequences:

- turning a plugin off takes effect on the very next request, with no cache to go stale;
- turning it on likewise;
- a caller hitting a disabled plugin's door gets a 409 saying the module is switched off, not a
  404 and not a 500;
- the loader is **registry-blind** and **boot-fatal**: if a folder cannot mount, the process dies
  collecting all errors. The stated law: *"a plugin that cannot mount must never half-exist."*

> **Honest flag — the `degraded` hole.** The lifecycle gate accepts three enabled-equivalent
> states, but `degraded` is read by three gates and **written by nobody**. The state machine has a
> landing pad for plugin failure, and no code ever sends a plane there. Instead, one broken plugin
> kills the whole API (the loader throws) rather than degrading that one plugin. The story flags
> this as a real gap, not a design subtlety.

### 4.4 Disabling a plugin: the drain protocol

Suppose Green Valley, months later, decides to stop using a plugin. `POST /plugins/:id/disable` is
locked behind `owner`/`principal`/`itadmin`, a plugin guard, and **step-up authentication**
(`app.requireStepUp` — a recent second-factor/password confirmation, because disabling a module is
a destructive act).

The handler first confirms the plugin exists (a fix: the 404 used to fire *after* the drain, so
disabling an unknown id could reassign that desk's actions). Then it runs the **drain protocol**:

```js
const drained = await c.query(
  `UPDATE app.actions SET owner='Principal desk (drain hand-back)', owner_role='principal'
   WHERE tenant_id=$1 AND status='open' AND (
     source_plugin=$2 OR owner_role=$2 OR owner=$2 OR EXISTS (
       SELECT 1 FROM app.events e
       WHERE e.tenant_id=app.actions.tenant_id AND e.id::text=app.actions.source_event AND e.emitted_by=$3
     )
   ) RETURNING id`,
  [req.user.tenant_id, req.params.id, `plugin:${req.params.id}`]);
```

The meaning is humane: **disabling a module may never abandon a school's open work.** Every open
action that this plugin raised is handed back to the principal's desk. The handler also counts the
plugin's linked events from the last thirty days (lineage retained), then sets
`status='disabled'`. The audit row records the drain outcome:

```
outcome: data retained · subscriptions stopped · DRAIN: 3 open action(s) handed back to principal · 41 linked events retained for lineage
```

Data is retained. Nothing is deleted. Disabling is a pause, not an amputation.

### 4.5 Settings: the secret-rotation door

When Ananya later configures SMS, WhatsApp, or a payment gateway, she uses the settings form. It
sends `POST /plugins/:id/settings`. This is the most security-sensitive write in the product —
it is where a school's `key_secret`, `webhook_secret`, and SMTP password are replaced — and the
handler has been hardened repeatedly.

First, the row is locked and the previous settings read:

```js
const prevRow = await c.query(
  `SELECT settings, manifest FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2 FOR UPDATE`, ...);
```

Then the payload is **validated against the schema**, not persisted verbatim:

```js
const schema = canonicalSchema(prevRow.rows[0].manifest);
const check = validateSettingsAgainstSchema(schema, next);
if (!check.ok) return reply.code(400).send({ error: 'Those settings were not saved — this module rejected them.', errors: check.errors, ... });
const toStore = check.normalized;
const storedSettings = encryptSettings(toStore, req.user.tenant_id);
```

An **undeclared key is rejected, not dropped** — because silently discarding part of a credential
payload is worse: a school that typos a key name would see success and keep using the old secret.
Only the normalized form is persisted, so defaults are materialised and unvalidated values never
reach the column. A plugin with no schema is passed through unchanged (inventing a schema for a
credential path would be a guess).

Then the diff, and the audit:

```js
const changed = [...new Set([...Object.keys(prev), ...Object.keys(toStore)])]
  .filter((k) => JSON.stringify(prev[k] ?? null) !== JSON.stringify(toStore[k] ?? null));
const secretKeys = changed.filter((k) => isSecretKey(k));
const detail = changed.length
  ? `changed keys: ${changed.join(', ')}${secretKeys.length ? ` · SECRET-CLASS: ${secretKeys.join(', ')} (values deliberately never recorded)` : ''}`
  : 'no effective change (payload identical to stored settings)';
await auditLog(c, ..., {
  action: `Plugin settings updated: ${req.params.id}`,
  risk: secretKeys.length ? 'high' : 'low',
  outcome: detail });
```

The audit row names the **changed key names** and never the values. A secret-class change is
flagged `risk: high`; an ordinary settings edit is `low`. This is how the ledger keeps a
`key_secret` rotation visible without turning evidence into a leak.

> **Honest flag — the CTE trap the code warns about.** The comment above the two-statement form
> records a specific Postgres trap: writing this as a single CTE with `FOR UPDATE` inside it and
> reading the captured old row from the same statement's `RETURNING` returns **NULL**, so every
> save would mark every key changed and flag every edit `risk: high`, destroying the risk column's
> usefulness. The code uses two statements with a real lock across the read-modify-write and warns
> future readers not to "simplify" it back. The story includes this because it is a rare example of
> a code comment that saves a future engineer from a silent, one-sided failure.

### 4.6 The rails, and why they are born off

Green Valley wants to send SMS to parents. `rails.sms` is a plugin. It is born `registered` — off.
This is a policy in three places: the default-on set excludes it, the catalog comment says
credential rails stay off until the owner configures them, and the plugin's provider defaults to
`logger`.

A **rail** is a provider adapter. The three credential rails are:

- `rails.sms` — providers `logger` (default) and `http-generic` (a configured URL + auth header).
- `rails.whatsapp` — `logger`, `http-generic`, and **Meta Cloud API**, with a DLT template
  renderer reading the `comms.whatsapp` registry.
- `rails.email` — `logger` and `smtp` (a hand-rolled SMTP client over `node:net`/`tls`, STARTTLS,
  `AUTH LOGIN`, dot-stuffing).

The comment in `plugin-catalog.js` explains why they were a real bug when absent: they were the
only shipped plugins missing from the catalog, so they had no per-tenant registry row, the plugin
manager could not show them, nobody could configure them, and `/me/reset-request`'s channel gate
("no email rail configured → 503") could never pass for any tenant. **Password reset was
permanently 503 by construction.** The fix added them to the catalog, still off.

The honesty design of the rails is unusual and worth stating clearly. A rail returns
`{ ok: true, provider: 'logger' }` when credentials are missing — and, worryingly, **also when the
settings read fails**. The project's own risk list flags this: *"delivery honesty is enforced by
callers, not by the rails."* The dispatcher and the kernel are responsible for deciding whether a
"logger" send counts as delivered. The story will show this distinction mattering in Chapter 17,
when a staff member approves a message and the UI must not claim it was delivered.

> **Honest flag — cleartext AUTH LOGIN.** `rails.email` can perform `AUTH LOGIN` in cleartext if a
> server does not advertise STARTTLS, and it has no `require_starttls` setting. The audit records
> this. This is a real, known gap, not a hypothetical.

### 4.7 What the switchboard taught us

The Modules screen looks like a settings page. Underneath it is a governance system:

- the client cannot author its own metadata (PLG-4);
- a plugin cannot invent permissions outside the kernel vocabulary;
- a plugin must declare its class and kernel compatibility;
- entitlement is checked before any write (402);
- declared dependencies must be enabled and version-matched;
- enablement is enforced per request, never cached (lifecycle gate);
- disable drains open work back to a human (drain protocol);
- settings are schema-validated, encrypted at rest, and audited by key name, never by value.

Ananya has now turned on the modules she needs. In this story she turns on **library**,
**exams.assessment**, **payments.upi**, **payments.razorpay**, **admissions.funnel**,
**family.view**, **parent.assistant**, **student.world**, **teacher.classroom**,
**teacher.support**, **teacher.copilot**, **coord.view**, **transport.gps**, **ops.bi**,
**ops.udise**, **ops.import**, **pack.cbse**, **hr.leave**, **health.clinic**, and the three
credential rails — configuring the rails later, in Chapter 17, once she has provider keys.

The count of enabled plugins is now well past the birth set of four, so `GET /onboard/status`
finally marks the **plugins** checklist item done.

<!-- END OF PART 4 -->

---

## Chapter 5 — People, Roles, and the Handover Chain

### 5.1 The console where a school is staffed

Ananya opens `/people-admin`. This is the **People console**, backed by the `people.admin`
plugin. It lists accounts and lets an owner or IT admin create them. It is gated to `owner` and
`itadmin`.

The screen calls `GET /plugins/people.admin/users`, which returns active and inactive accounts with
`id, email, name, role, phone, active, force_change, created_at` — deliberately **no password hash,
no session fields**.

Ananya decides her first hire is not a teacher but an **IT admin**: her nephew Suresh, who is good
with computers, so that she does not personally have to create all 30 staff accounts. This mirrors
the checklist's own wording: *"Create your IT admin — then they can add the rest of the staff, so
you don't have to."*

### 5.2 Provisioning the IT admin: a temporary secret shown once

Ananya fills the create form:

- Name: `Suresh Pawar`
- Email: `suresh@greenvalley.edu.in`
- Role: `itadmin`
- Phone: `+91 98220 11111`
- Password: **left blank** (so the server generates one)

`POST /plugins/people.admin/users`.

The handler runs a series of refusals before it writes. Two of them are notable:

```js
if (role === 'owner') {
  // audit a high-risk row, then refuse
  return bad(reply, 'The owner role cannot be created here — ownership is provisioned at tenant bootstrap', 403);
}
if (role === 'principal' && req.user.role !== 'owner') {
  // audit a high-risk row, then refuse
  return bad(reply, 'Only the school owner can create a principal account', 403);
}
```

The owner role is refused outright, with a **high-risk audit row that commits before the 403 is
sent**. This matters: an attempt to mint an owner is itself evidence. The principal role is
refused to anyone but the owner, because the principal is the school's day-to-day authority and
standing one up is an owner-level act.

A student role without a `studentId` is refused too:

```js
if (role === 'student' && !b.studentId) return bad(reply, 'Pick the pupil this portal account belongs to — student accounts are created from the roster...', 400);
```

This closes the "orphan student account" hole: a pupil login that the student plane cannot pin to a
roster row is a login that lands nowhere.

Since Ananya left the password blank, the server mints a temporary one:

```js
const temp = suppliedPassword ? null : tempPassword();
const password = suppliedPassword ?? temp;
```

`tempPassword()` produces a human-typeable secret in the shape `word-word-hex` (for example
`pepper-orchid-7f3a`). It is hashed with the same scrypt as every other password. The user row is
inserted with `force_change = true` because the secret was generated by someone else:

```js
row = (await c.query(
  `INSERT INTO app.users (tenant_id, email, name, role, password_hash, phone, force_change)
   VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, email, name, role, active, created_at`,
  [req.user.tenant_id, email, name.slice(0, 120), role, hashPassword(password), phone, temp ? true : false])).rows[0];
```

The unique constraint `(tenant_id, email)` is caught with a `SAVEPOINT` and turned into a friendly
409 — *"An account with this email already exists at your school"* — rather than a raw `23505`.
(The `SAVEPOINT` matters: in Postgres a failed statement poisons the whole transaction unless you
roll back to a savepoint.)

Then an event and two audit rows, and the response:

```js
return {
  ok: true, user: { ... },
  ...(temp ? { temporaryPassword: temp, note: 'This temporary password is shown once — it is not stored in plaintext; the user must change it at first sign-in.' } : {}),
};
```

The temporary password is returned **exactly once** and never stored. If Ananya loses it, the
answer is a reset, not a lookup. This is the "one name for the once-only secret" contract (P2-11):
the response uses `temporaryPassword` and nothing else, because the server and the SPA once
disagreed over `tempPassword` vs `temporaryPassword`, which minted a secret the office never saw —
an unrecoverable lockout.

### 5.3 The handover chain: owner → IT admin → teacher

Ananya copies the temporary password into a WhatsApp message to Suresh (out of band — the product
has no email rail configured yet). Suresh signs in for the first time at `/login`.

`POST /auth/login` with his email and the temporary password. The handler walks its full outcome
lattice:

1. It checks an **identifier-keyed lock** before the lookup, so a known and an unknown email answer
   the same 429 — no enumeration oracle.
2. It looks up the user joined to the tenant and the MFA vault.
3. Exactly one match. If there were several (the same email in several schools), it would verify the
   password against the matching rows first and, on success, return **409 with a school picker** —
   never a silent first-row pick. (Suresh's email exists in only one school, so this does not fire.)
4. Password verification. A wrong password bumps both a per-account counter (`auth.login_throttles`,
   shared across API replicas) and the identifier counter; five failures lock for fifteen minutes.
5. On success, the failure windows clear, and a legacy hash would be upgraded.

Then, because his account was provisioned with a generated secret, `issueSession` stamps
`mustChange` into the token and the handler returns:

```
403 {
  error: "Your account uses a temporary password — set a new one before continuing.",
  mustChange: true,
  token: <a RESTRICTED token>,
  user: { ... }
}
```

The restricted token has `mustChange: true`. On every subsequent request, `app.authenticate` sees
the claim and the live row's `force_change`, and refuses everything except exactly three paths:

```js
if (payload.mustChange && u.rows[0].force_change) {
  const path = (req.routeOptions?.url ?? req.url ?? '').split('?')[0];
  if (!['/me/password', '/me', '/auth/logout'].includes(path)) {
    return reply.code(403).send({ error: 'Set a new password first — this session is limited to the password change.', mustChange: true });
  }
}
```

So Suresh is dropped into a **ChangePassword gate** that renders alone. He enters a real password.
`POST /me/password` validates length and that it differs from the old one, stores the new scrypt
hash, **bumps the user's `session_epoch`**, and issues a fresh unrestricted token. The epoch bump is
the clever part: every *other* outstanding session for Suresh dies instantly at its next request,
because the epoch in the row no longer matches the claim. He then lands in the app as IT admin.

This is the **HANDOVER chain** the product's test suite pins: owner provisions IT admin → IT admin
provisions teacher → teacher forced to change → teacher works. The chain is the reason the console
exists; without a working handover, a school of 400 staff would make the owner a bottleneck.

> **Honest flag — no role-change door.** The People console has no "change this person's role"
> action. To change a role, the school creates a new account or uses custom-role assignment.
> The project tracks this. If a teacher becomes a coordinator, the correct path today is a new
> custom role, not an edit of `app.users.role`.

### 5.4 The sixteen roles

The canonical role list lives in `server/src/role-catalog.js`:

```
owner, principal, coordinator, counselor,
finance, finance_head, finance_clerk,
admissions, transport, facilities, technician,
teacher, itadmin, parent, student, librarian
```

Sixteen built-in roles. Before this module, the list lived in four places that could drift: the
`auth.js` constant, the database `CHECK` constraint, the per-door gate lists, and the client's role
arrays. The catalog is now the single code source; `tests/rbac-catalog.test.js` pins it against the
database `CHECK` so a role cannot appear on one side only. (The database constraint was extended by
migrations; `counselor` and `librarian` were each added after the fact — `counselor` existed in five
server gate lists and a screen for a long time before a human could actually hold it, which is a
nice example of "the role exists in the code but not in the world.")

The client **fails closed**. In `app/src/lib/roles.ts`, an unknown role maps to a student-lite
surface. If the server ever sends a role the client does not recognise, the client shows the
narrowest surface, not the widest.

### 5.5 A teacher, and the parent link that is not an afterthought

Suresh, now signed in as IT admin, provisions a teacher:

- Name: `Priya Iyer`
- Email: `priya@greenvalley.edu.in`
- Role: `teacher`

`POST /plugins/people.admin/users`. Same path, same temporary-password handover.

Then he provisions the first **parent**, for Aarav Mehta's mother Kavita. Here the form asks one
extra thing the old product did not: **which child is this parent linked to?** Suresh picks
Aarav from the roster (once Aarav exists — the story creates Aarav in Chapter 6, so for now this
step waits). The handler, for a parent with a `studentId`, writes the structural link and mirrors
it into the canonical guardian contact table:

```js
if (role === 'parent' && b.studentId) {
  await c.query(
    `INSERT INTO family.child_link (tenant_id, user_id, student_id, relation, is_primary)
     VALUES ($1,$2,$3,'guardian',true) ON CONFLICT (tenant_id, user_id, student_id) DO NOTHING`,
    [req.user.tenant_id, row.id, b.studentId]);
  if (phone) {
    const existing = (await c.query(`SELECT 1 FROM app.guardians WHERE tenant_id=$1 AND student_id=$2 AND phone=$3 LIMIT 1`, ...)).rows[0];
    if (!existing) {
      await c.query(`INSERT INTO app.guardians (tenant_id, student_id, name, phone, relation, is_primary) VALUES ($1,$2,$3,$4,'guardian',true)`, ...);
    }
  }
  linkedStudentId = b.studentId;
}
```

Two writes, deliberately. `family.child_link` is the **authorization spine** — every parent-scoped
door joins through it. `app.guardians` is the **contact spine** — absence notices, visitor lookup,
and audience resolution read it. The comment explains why both exist: the notice resolver once read
only `app.guardians`, while a self-onboarded family's child lived in `family.child_link`, so a
notice to that family resolved **zero recipients**. Reading the union of both shapes fixed it. The
story will show both tables being joined again in Chapter 17.

### 5.6 Giving a pupil a portal account (not a torn-away login)

Later, when Aarav has a roster row, Suresh uses a separate control: **"Give a pupil a portal
account."** This is the only place a pupil's login can be created, because it is the only path that
writes the structural binding:

```js
if (role === 'student' && b.studentId) {
  const bound = (await c.query(
    `UPDATE app.students SET user_id=$3 WHERE tenant_id=$1 AND id=$2 AND (user_id IS NULL OR user_id=$3)
     RETURNING id, name, admission_no`,
    [req.user.tenant_id, b.studentId, row.id])).rows[0];
  if (!bound) { /* either already bound to someone else → 409, or not found */ }
  linkedStudentId = b.studentId;
}
```

The account and the binding are made in one step. If the pupil already has a portal account, the
door returns 409 — *"That pupil already has a portal account — suspend it first if you mean to
replace it."* Two children must never inherit one another's results, so the binding is exclusive.

This is the resolution of what the project's risk register once called the system's weakest
structural link. Older student identity was a **name match** — fragile, and renames or duplicates
silently severed access. Now `app.students.user_id` (added by a later migration) is the source of
truth, and name matching is only a fallback for roster rows that predate their account, guarded by
an exactly-one-active-match rule. The story flags this in the student portal chapter too, because
it is the single most important identity decision in the product.

### 5.7 Custom roles, masks, and why a deny beats an allow

Green Valley hires a librarian, Kavita Nair. Ananya wants her to reach library doors but not the
fees ledger or the safeguarding queue, even though `librarian` is a built-in role. So Ananya opens
`/roles` and creates a custom role, or uses the shipped librarian preset.

Custom roles live in `app.roles` (key, label, **base_role**, and a `{allow, deny}` mask of
`"METHOD /path"*` patterns). The resolution rule is stated in `custom-roles.js` and is deliberately
simple:

```
1. the base role decides as usual,
2. a matched DENY refuses (403) even when the base role allowed,
3. a matched ALLOW grants even when the base role lacked the door.
```

There is an **amplification ceiling**: a non-owner role-admin may only allow doors their own role
already reaches. It is impossible to self-promote to owner-equivalent. And `owner` rows can never
carry a mask at all.

The reason this module was extracted into its own file is a real bug, and the comment narrates it:
the mask machinery used to live entirely inside the kernel's `registerRoutes`, so only kernel doors
honoured it. Every **plugin** door used a different gate that checked `roles.includes(...)` and
nothing else. The result was asymmetric and both halves were wrong:

- a matched **DENY was silently ignored on plugin doors**, so "this librarian must not reach the
  safeguarding queue" was unenforceable exactly where it matters most;
- a matched **ALLOW could not lift a plugin door's role refusal**, so the librarian preset could not
  be given a plugin door the base role lacked — which is the entire point of the preset.

Now the store, matcher, and decision rule live in `custom-roles.js` and both gates call the same
`applyMask`. A single process-wide instance prevents the "two binding caches" bug, in which the
kernel gate and plugin gate could disagree for up to thirty seconds after a role change.

### 5.8 API keys and webhooks

An owner or IT admin can also mint **API keys** for integrations. The key is shown once; only its
`sha256` is stored. An API key is a constrained read plane: it can reach `GET /me` and
`GET /dataset` with the `core.read` scope, and mutations are 403. The principal is synthetic,
with `role: 'api'`.

**Webhooks** are the outbound direction: a school registers a URL and a secret, and the
webhook-worker signs deliveries with `x-schoolos-signature: t,v1=hmac(secret,'t.body')`. The
secret column is select-scoped away from the app role (`077`), and the relay signs on the owner
path, so the secret is never readable by a normal request.

### 5.9 What people exist at the end of Chapter 5

Green Valley now has: Ananya (owner), Suresh (itadmin), Priya (teacher), and (once Aarav exists) a
parent and a pupil account. Each provisioning wrote an event (`people.user.created`) and a
medium-risk audit row (`User provisioned`). The temporary-password secrets are gone from the
system — only hashes remain, and only the humans who received them retain the plaintext.

The handover chain works, and an owner is no longer the bottleneck.

<!-- END OF PART 5 -->

---

## Chapter 6 — Forty-One Children, Three Doors

### 6.1 The first student, by hand

Green Valley has 412 students on paper. Nobody is going to type 412 names on day one. But Ananya
adds **one** by hand first, because she wants to see the whole thing work end to end. She opens
`/people-admin`, clicks **Add person**, and chooses *student*:

- Name: `Aarav Mehta`
- Grade: `6`
- Section: `A`
- Admission number: `GV-2026-0042`
- Guardian name: `Kavita Mehta`
- Guardian phone: `+91 98765 43210`
- Bus route: `Route 7`
- Date of birth: `2014-08-19`
- Gender: `male`

`POST /students`. Gated to `owner`, `principal`, `coordinator`, `admissions`, `itadmin`.

The handler is one of the most carefully-written doors in the product, because a student row is
the join point for almost everything else. Let me walk its refusals in order, because each one is
a scar from a real failure.

**Required fields.** `name`, `grade`, `section`. Missing → `400 "<field> required"`.

**DOB and gender** are parsed by shared functions (`parseDob`, `parseGender`) that the manual form,
the CSV import, and the record-edit door all call. Three lanes, one rule, so they cannot disagree
about what "male" or "08/19/2014" means.

**The class must be one the school actually has.** This is P2-6:

```js
const cfg = (await c.query(`SELECT config FROM app.tenants WHERE id=$1`, [req.user.tenant_id])).rows[0];
const parsed = normalizeClasses(cfg?.config?.setup?.sections ?? []);
if (parsed.ok && parsed.classes.length) {
  const cls = parsed.classes.find((x) => x.grade === grade);
  if (!cls) return bad(reply, `"${grade}" is not one of this school's classes. Add it on the Classes & sections screen first, or pick one of: ...`);
  if (!cls.sections.includes(section)) return bad(reply, `Section "${section}" is not one of ${cls.grade}'s sections. Use one of: ...`);
}
```

Before this check, the door took `grade` as free text and stored it verbatim, so `"Grade 77"` was
accepted with a 200 and the child became invisible to every screen that reads the school's own
structure — roster, attendance filter, timetable cell, fee plan. Now a typo is refused with the
list of real classes. Note the escape hatch: a school that has *not defined its classes yet* is not
blocked. An empty list means "nothing to check against", not "reject".

**Admission number uniqueness, by name.** P2-5: `admission_no` carries
`UNIQUE (tenant_id, admission_no)` from migration `001`, so a duplicate used to surface as an
unhandled `23505` — a raw 500. Now the door checks first and answers:

```
409: "Admission number GV-2026-0042 is already used by Aarav Mehta (6-A). Admission numbers must be unique."
```

**Duplicate name refusal.** P2-8 is more opinionated:

```js
const sameName = (await c.query(
  `SELECT admission_no, grade, section FROM app.students
    WHERE tenant_id=$1 AND lower(name)=lower($2) AND status='active' LIMIT 1`, ...)).rows[0];
if (sameName) return bad(reply, `${name} is already enrolled in this school (...). Search before enrolling again — a second pupil with the same name cannot be told apart in a roster.`, 409);
```

The product refuses to create two active students with the same name. This is a deliberate product
opinion: a roster sorts and filters by name, so two Aarav Mehtas are indistinguishable to the
humans who use the roster. Where a school genuinely has two, the guidance is to give the second a
distinct name and admission number.

Only then does the insert run:

```sql
INSERT INTO app.students (tenant_id, admission_no, name, grade, section, guardian_name, guardian_phone, bus_route, dob, gender, source, source_ref)
VALUES ($1,...,$12) RETURNING *
```

`source='staff'`, `source_ref` = the acting user's id. The `gender` value is stored as parsed.

**Three follow-on writes.**

1. `linkStudentUser` attempts a best-effort bind of an existing student-role user by **unambiguous
   name match** — exactly one roster row and exactly one student user with that name. This is the
   legacy fallback for rows enrolled before their account existed. It is explicitly best-effort; an
   ambiguous name leaves `user_id` null.
2. If a guardian name **and** phone were supplied, a row is written to `app.guardians` — the
   canonical contact table. The comment records that the manual roster door previously wrote only
   the denormalised `students.guardian_*` columns, so `app.guardians` stayed empty for app-created
   students and absence/visitor/audience lookups found no contact.
3. If the guardian phone **structurally matches** an existing active parent account, a
   `family.child_link` row is written. Note the wording in the code: *"Structural phone match only
   (never name-equality)."* A name is not an identity; a phone that matches an account is.

**The hidden trigger.** A `BEFORE INSERT OR UPDATE` trigger on `app.students`,
`app.sync_student_class_ref`, derives `class_id`/`section_id` from the text `grade`/`section` and —
critically — **invalidates them when the grade changes**, so the reference cannot outlive the class
it was derived from. This fires for *every* writer, including class transfers, the admissions
funnel, and raw SQL. Nobody has to remember it. This is the pattern the project uses when a
denormalised text value and a structural reference coexist: a trigger keeps them in step so no lane
has to.

Then, in the same transaction:

```js
await auditLog(c, ..., { action: 'Created student', recordType: 'Student', recordRef: code, reason: b.reason ?? 'manual entry', outcome: 'created' });
await emitEvent(c, ..., { type: 'people', label: `Student enrolled — ${b.name} (${b.grade}-${b.section})`, ref: code });
```

One audited INSERT. One event and one outbox row. Aarav is now a joinable node. He is discoverable
by attendance (his `student_id`), fees (his obligations), exams (his marks), homework (his class
gate), transport (his `bus_route`), visitors (his guardian lookup), and parent scoping (his
`child_link`) — each through its own relationship table, never a global search.

### 6.2 The other 411, by file (the import path)

Ananya will not type 411 more names. She opens `/data-import` — the **Migration console** —
backed by the kernel, not a plugin. The path has four verbs and a final owner approval.

**1. Register a source.** `POST /migration/sources` (owner/coordinator/itadmin). The school names
the origin — "2025 paper register", "previous ERP export" — and the server creates a
`app.migration_sources` row. Nothing is imported yet.

**2. Stage rows.** `POST /migration/sources/:id/stage-rows` accepts rows (JSON, not raw CSV — the
kernel staging path works on parsed rows) and writes them to a staging table. The staging purge
uses a `SECURITY DEFINER` helper (`purge_staged_rows`) because the app role has no `DELETE`
(D-35).

**3. Validate.** `POST /migration/sources/:id/validate` runs per-row checks and produces an error
report — counts, rejected rows, reasons. A staged row is **not** a live student.

**4. Commit.** `POST /migration/sources/:id/commit` writes the valid rows, idempotently, keyed by
`source_ref='mig:<src>:<n>'` — so re-clicking commit cannot double-import. The trust receipt shows
the **real** `differenceCents` (or, for students, the real row-in versus row-landed difference),
not a fabricated zero.

**5. Activate.** `POST /migration/activate`, owner or principal only — the **trust receipt** that
flips the imported records live. The trust boundary is deliberate: the person who operates the
import is not necessarily the person who attests to its correctness.

> **Honest flag — two import lanes that do not meet.** There is a kernel staging path
> (`/migration/*`) and a separate plugin, `ops.import`, whose docs describe dry-run
> schema/validate-mapping/shadow SELECTs on JSON rows. The project's own map records that
> `ops.import` is *"not wired to the kernel staging path (camelCase vs snake_case mismatch)"* and
> that it does **no CSV parsing** (JSON rows in). So a school using the console is using the
> kernel path; `ops.import` is a partial sibling. The story names this because a reader who sees
> two import features will reasonably assume they are the same feature.

Also flagged in the project's audit: the Migration console screen carries a screen-local constant
for its record count (the "5,099 records" figure is not read from the server) and a "simulated"
toggle sits beside the live path. The live path is real; the cosmetic figures are not.

### 6.3 The honest import posture

The import path demonstrates a design value worth naming: **a staged row is not a live record.**
The product refuses to blur "the school uploaded a spreadsheet" with "these are now the school's
children." Between upload and reality sit validation, a diff, an owner's signature, and an
idempotent commit. In an education system where a wrong fee obligation or a duplicated child
causes real harm, that friction is a feature.

### 6.4 Admissions: turning strangers into students

Green Valley's admissions season is the reason Ananya bought the product, so the third door is the
one she cares about most. It is the `admissions.funnel` plugin, enabled in Chapter 4.

The funnel's stages are a **lattice** the server enforces:

```
enquiry → form → interaction → offer → enrolled
                          ↘ waitlisted ↗
                  rejected / withdrawn (side exits)
```

**Capturing an enquiry.** `POST /plugins/admissions.funnel/leads`, admin roles only. The handler:

- checks the session window (settings `admission_year`, `cycle_start`, `cycle_end` — February to
  June by default, matching Indian admissions season);
- runs a **duplicate guard**: one open enquiry per `(guardian, class, session)`. A repeat returns
  `409` with the existing `leadId`;
- normalizes the guardian phone before comparing, so `+91 98765 43210` and `09876543210` are the
  same person;
- inserts the lead and the first `plugin_admissions.stage_history` row (`NULL → enquiry`);
- emits `admission.enquiry.captured`.

That last event matters because of the default workflow rule planted at signup in Chapter 2. When
the workflow-worker runs, it evaluates the rule `Admissions: enquiry → follow-up pipeline` and
emits a derived topic `admission.followup.scheduled` — a fan-out, not a message, so a captured
enquiry becomes visible on the follow-up pipeline without auto-messaging a guardian.

> **Honest flag — the workflow-worker may not be running.** In the default deployment from
> Chapter 1, `workflow-worker.js` is not scheduled. So `admission.enquiry.captured` is written to
> the outbox, the outbox relay logs it, and the follow-up fan-out never happens. The rule is real;
> the runner is not armed. This is the second appearance of OPS-8 in the story and it will appear
> again.

**Moving a lead stage.** `POST /plugins/admissions.funnel/leads/:id/stage`. The handler locks the
row `FOR UPDATE`, refuses if the current stage is terminal, and refuses any transition not in the
`NEXT` map:

```js
if (!(NEXT[cur.stage] ?? []).includes(to)) {
  return reply.code(409).send({ error: `This enquiry can't move from "${cur.stage}" to "${to}"` });
}
```

A lead cannot skip from `enquiry` straight to `enrolled`. The lattice is enforced server-side; the
client's stage board is a view of it, not the authority.

**The moment an offer becomes a student.** When a lead moves from `offer` (or `waitlisted`) to
`enrolled`, something unusual happens. The admissions plugin does **not** write `app.students`. It
raises a **kernel approval-gated action**:

```sql
INSERT INTO app.actions
  (tenant_id, code, kind, title, body, ..., priority, status, owner, owner_role, policy_ref, ai_involved, source_event, payload, source_plugin)
VALUES ($1, 'students.create.'||$6::text, 'approval', ..., 'high', 'open', 'Principal', 'principal',
        'Admissions §2', false, 'admission.offer.accepted', $5::jsonb, 'admissions.funnel')
RETURNING id
```

The comment is explicit: *"Admissions offers create core student records — a core-domain write — so
it rides ... the funnel never writes app.students directly."* The admissions clerk can move a lead
to `offer` and record acceptance, but the **actual creation of a child's core record waits for a
principal's approval**. When that approval is decided (Chapter 15 explains the action spine and
segregation of duties), an executor runs and creates the student plus an `enrollment_history`
row. This is the Wave-2 fix for the audit finding that "admissions creates nobody" — the funnel
used to move a stage and stop.

The funnel also **queues** guardian notices on `offer` and on acceptance (templates
`ADMISSION_OFFER`, `ADMISSION_ACCEPTED`), but — consistent with the whole delivery philosophy —
it queues, it does not send. The message waits for the dispatcher and an SMS/WhatsApp rail.

### 6.5 The child becomes many rows

By the end of Chapter 6, Green Valley has Aarav and however many children the import landed, plus
a pipeline of enquiries. Each child is:

- one `app.students` row;
- one `app.guardians` row (if a guardian contact was supplied);
- possibly one `family.child_link` row;
- the subject of attendance, fee, homework, exam, transport, and visitor joins when those domains
  run;
- the source of an audit row and an event.

The most important sentence in this chapter is the one the code comments repeat in different
words: *a school's records discover a child through their own relationship table, never through a
global search.* Aarav is not found by scanning all students. He is found because attendance points
at him, fees point at him, his parent points at him. That is why a change to his class in Chapter 8
does not corrupt his history: only the pointers that *name his class* are affected, and everything
that names *him* is untouched.

<!-- END OF PART 6 -->

---

## Chapter 7 — Money: The Domain Where a Lie Costs the Most

### 7.1 Why this chapter is the longest

Attendance can be re-marked. Homework can be resubmitted. A payment cannot be unseen. Money is the
domain where the product's honesty is not a virtue but a requirement, and it is the domain with
the most scars. Ananya is an accountant by training, so she goes straight here.

The fee domain lives mostly in the kernel (`routes.js`), not a plugin, with two payment-gateway
plugins (`payments.upi`, `payments.razorpay`) providing only *orders and webhook facts*. The
project's central money rule is written plainly in the plugins: **the rail never moves money;
settlement is kernel-owned.**

### 7.2 The fee plan: a template, not an obligation

Ananya opens `/fees/plans` and creates a plan:

- Name: `2026–27 Tuition`
- Grades: `1` through `10`
- Terms: `Term 1 → ₹42,000`, `Term 2 → ₹42,000` (in paise: `4200000` each)
- Installments: three per term, on the 5th, 15th, 25th
- Auto-concession: sibling, 10%, min 2 children

`POST /fee-plans`, gated to `owner`, `principal`, `finance`, `finance_head`, `finance_clerk`.

The handler validates the shape (`name` ≤80, `grades` a non-empty list ≤40, terms, installments,
auto-concession). Then it enforces **fee-hike governance** (Action Plan 4.2):

```js
if (hikePct !== null && hikePct > 10) {
  const mtg = consultId ? (await c.query(`SELECT held_on FROM app.mtgs WHERE id=$1 AND kind='SMC'`, [consultId])).rows[0] : null;
  if (!mtg) return bad(reply, 'A rise above 10% needs its SMC consultation — record the meeting first, then cite it here', 400);
  if (new Date(mtg.held_on).getTime() < Date.now() - 180 * 864e5) {
    return bad(reply, 'That SMC consultation is older than 180 days — fresh consultations back fresh hikes', 400);
  }
}
```

A fee rise above 10% must cite a School Management Committee consultation held within 180 days.
This is a real Indian regulatory expectation encoded as a refusal. A rise of 10% or less passes
without paper. The plan is stored in `app.fee_plan_templates` with the terms as JSONB, the grades
as an array, the installments, the auto-concession rule, and the hike metadata. Audit:
`Created fee plan template`.

Notice what a template is **not**: it is not a bill. It is a rule that will produce bills.

### 7.3 Generate: turning a template into 3,750 obligations, idempotently

Ananya clicks **Generate** on the plan. `POST /fee-plans/:id/generate`.

The handler locks the template `FOR UPDATE`, then counts the in-scope students:

```js
const scope = (await c.query(`SELECT count(*)::int n FROM app.students WHERE status='active' AND grade = ANY($1)`, [tpl.grades])).rows[0].n;
```

For Green Valley at this moment, suppose that is 375 active students across Grades 1–10 (the story
uses a plausible number; the real count is whatever was imported). It opens a **billing run** so
that every obligation this generation produces can later be reasoned about — and voided — as one
unit:

```js
const run = (await c.query(
  `INSERT INTO app.billing_runs (tenant_id, plan_template_id, created_by, note) VALUES ($1,$2,$3,$4) RETURNING id`,
  [req.user.tenant_id, tpl.id, req.user.id, `generated from ${tpl.name}`])).rows[0];
```

Then the bulk insert. This is the heart of the money domain:

```sql
INSERT INTO app.fee_obligations (tenant_id, student_id, term, label, due_on, amount_cents, academic_year_id, source_ref, billing_run_id, fee_head_id)
SELECT $1, s.id, te->>'term', te->>'label', NULLIF(te->>'due_on','')::date, (te->>'amount_cents')::bigint, $2, 'feeplan:' || $3, $6, $7
FROM app.students s CROSS JOIN jsonb_array_elements($4::jsonb) te
WHERE s.status='active' AND s.grade = ANY($5)
ON CONFLICT (tenant_id, student_id, term, label) DO NOTHING
RETURNING id, amount_cents
```

The `ON CONFLICT ... DO NOTHING` is the single most important clause in the fee domain. Its target
is a unique constraint on `(tenant_id, student_id, term, label)`. It means **re-clicking Generate
can never double-bill**. If Ananya generates at 10 a.m., adds five students, and generates again at
11 a.m., the first 375 students get nothing new (their rows exist) and only the five new students
get obligations. The handler reports the difference honestly:

```
inserted, skipped = attempted - inserted
```

Then installments. If the template has an installment schedule, each obligation is split, in
order, and the installments are inserted `ON CONFLICT (tenant_id, obligation_id, seq) DO NOTHING`.
Again: regeneration never touches existing rows, so a paid installment is never re-created.

Then auto-concession. The sibling rule:

```js
const upd = await c.query(
  `UPDATE app.fee_obligations o
      SET concession_cents = round(o.amount_cents * $3 / 100.0)::bigint
     FROM app.students s
    WHERE o.student_id = s.id AND o.billing_run_id=$1 AND o.tenant_id=$2
      AND o.concession_cents = 0
      AND (SELECT count(DISTINCT g2.student_id) FROM app.guardians g2
            WHERE g2.tenant_id=$2 AND g2.phone IS NOT NULL
              AND g2.phone = (SELECT g1.phone FROM app.guardians g1
                               WHERE g1.student_id = s.id AND g1.tenant_id=$2 AND g1.phone IS NOT NULL LIMIT 1)) >= $4`,
  [run.id, req.user.tenant_id, Number(ac.percent), minC]);
```

A "sibling" is a student who shares a guardian phone with another active student. The
`concession_cents = 0` guard prevents re-application. The obligation's `net_amount_cents` is a
**generated column** — `amount − concessions − waivers` — so the ledger reflects the concession
automatically, with no code to forget to update it.

The audit row is a small masterpiece of honest reporting:

```
action:  Generated fee obligations
reason:  375 active students × 2 terms
outcome: 750 created · 0 skipped (already exist — payments untouched) · 1125 installments · 41 auto-concessions · run <id>
```

The phrase *"payments untouched"* is the promise to the accountant: generating again did not,
and cannot, disturb money already collected.

### 7.4 What the parent and the office can see

`GET /fees/obligations` returns obligations, scoped by role. The allowed list literally names
`parent` and `student` among its roles. A parent is structurally scoped through
`family.child_link`; the query joins it so a parent sees only their children's obligations. The
amount outstanding is computed at read time — `net_amount_cents − paid_cents` — never stored, so
there is no balance to fall out of sync.

`GET /fees/obligations/:id/invoice` renders an invoice. `GET /fees/installments` shows the
schedule. `GET /fees/receipts` and `/receipts/:id/pdf` serve the immutable receipts.

### 7.5 Void: owner-only, and it refuses to touch paid money

An obligation created in error can be voided. `POST /fees/obligations/:id/void` is gated to
**`owner` only** — the narrowest money gate in the product — and it locks the row:

```js
if (o.status === 'void') return { ok: true, status: 'void', already: true };
if (BigInt(o.paid_cents) > 0n)
  return bad(reply, 'obligation carries payments — refund before voiding (paid_cents can never decrease)', 409);
```

To void an obligation that has been paid, someone must first refund the payment. `paid_cents` can
never decrease — that is the accounting invariant, and the void door enforces it. The audit says
`Voided fee obligation`.

### 7.6 The payment: initiation, and the counter-PIN

A parent, Kavita, opens `/parent/fees` on her phone and taps **Pay ₹42,000** for Aarav's Term 1.
`POST /fees/payments`. The allowed roles are `parent`, `finance`, `finance_head`, `finance_clerk`,
`owner`, `principal`.

The handler supports **pay-many** (one payment allocated across several obligations). It validates
up to twenty obligation ids, each a UUID; a payment method from a known set
(`upi, razorpay, cash, card, cheque, netbanking, bank_transfer, manual`); and an optional
`Idempotency-Key` header (1–128 safe characters).

Idempotency is checked first:

```js
if (idempotencyKey) {
  const prior = await c.query(`SELECT * FROM app.payments WHERE tenant_id=$1 AND idempotency_key=$2 LIMIT 1`, ...);
  if (prior.rows[0]) return { payment: prior.rows[0], already: true };
}
```

If the same request arrives twice — a double-tap, a flaky network retry — the second returns the
first payment rather than creating a second. And even without a client key, the insert is wrapped
to catch a `23505` on the idempotency key and return the prior row.

Then the **counter-PIN** (migration `143`):

```js
if (paymentMethod === 'cash') {
  const pin = (await c.query(`SELECT pin_hash FROM app.fee_pins WHERE user_id=$1`, [req.user.id])).rows[0];
  if (pin) {
    const given = String(b.pin ?? '');
    if (!/^[0-9]{4,6}$/.test(given) || !verifyPassword(given, pin.pin_hash)) {
      return moneyError(reply, 'FORBIDDEN', 'Counter PIN required — enter your 4–6 digit collection PIN');
    }
  }
}
```

Cash at the desk is the "borrowed phone" fraud vector: a staff member collects cash and pockets it.
A staff member with an enrolled PIN must present it with every cash collection. If nobody has
enrolled a PIN yet, the old behaviour holds — progressive enrolment, nobody locked out by default.
This is a maker-side control, not a check.

Then the obligations are locked in a **stable sorted id order** so two concurrent pay-many calls
cannot deadlock each other:

```js
for (const id of [...ids].sort()) {
  const row = (await c.query(`SELECT * FROM app.fee_obligations WHERE id=$1 AND status <> 'void' FOR UPDATE`, [id])).rows[0];
  ...
}
```

Then the parent ownership check — structural, rename-proof, and existence-preserving:

```js
if (req.user.role === 'parent') {
  for (const o of obs) {
    const own = await c.query(`SELECT 1 FROM family.child_link WHERE user_id=$1 AND student_id=$2`, [req.user.id, o.student_id]);
    if (!own.rows[0]) return moneyError(reply, 'NOT_FOUND', 'obligation not found');
  }
}
```

A parent cannot start a payment on another family's obligation. The 404 keeps the obligation's
existence private: a parent probing UUIDs cannot even learn which exist.

The obligations must all belong to **one student**. Outstanding amounts are computed against the
**net** amount (after concessions):

```js
const parts = obs.map((o) => ({ id: o.id, label: o.label, due: BigInt(o.net_amount_cents ?? o.amount_cents) - BigInt(o.paid_cents) })).filter((x) => x.due > 0n);
if (!parts.length) return moneyError(reply, 'OBLIGATION_SETTLED', 'obligation already settled');
```

Then a crucial structural check for each obligation:

```js
const open = await c.query(`SELECT id FROM app.payments WHERE obligation_id=$1 AND status='initiated'`, [part.id]);
if (open.rows[0]) return moneyError(reply, 'PAYMENT_IN_PROGRESS', 'a payment for this obligation is already in progress');
```

**At most one open payment per obligation.** This is backed by a partial unique index (migration
`006`). It is what makes the "₹5,000 + ₹5,000 double-count" risk structurally impossible: two
concurrent payment attempts against one obligation cannot both create an `initiated` row. The story
will point at this again when it describes the webhook path, which records facts and never
settles.

If a partial amount is supplied, the handler checks against tenant settings
(`allow_parent_partial`, `min_partial_cents`). Then it allocates greedily, in obligation order,
until the amount is exhausted, and inserts the payment plus one `app.payment_allocations` row per
obligation:

```js
p = await c.query(
  `INSERT INTO app.payments (tenant_id, student_id, obligation_id, amount_cents, method, status, idempotency_key)
   VALUES ($1,$2,$3,$4,$5,'initiated',$6) RETURNING *`, ...);
for (const a of allocations) {
  await c.query(
    `INSERT INTO app.payment_allocations (tenant_id, payment_id, obligation_id, amount_cents)
     VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id, payment_id, obligation_id) DO NOTHING`, ...);
}
```

Status is `initiated`. `recordPaymentEvent` writes an append-only money-trail row (best-effort:
it can never roll back the ledger). `emitEvent` writes `payment.initiated`. `auditLog` writes
`Initiated payment`.

Ananya's accountant would recognize the maker step. The **checker** step is next.

### 7.7 Confirm: the checker act, and the regex that used to be a lie

Confirming a settlement is a checker act. The gate is deliberately narrow:

```js
require('finance','finance_head','owner')
```

`finance_clerk` — the pure maker — was **removed** from this door. A clerk initiates and collects;
a head confirms and reconciles. (The split exists because `finance` historically meant "do
everything"; the newer `finance_clerk`/`finance_head` roles separate maker from checker.)

The handler locks the payment, is idempotent on an already-confirmed payment, and then runs a
guard that exists because of a specific failure:

```js
const voided = (await c.query(
  `SELECT 1 FROM app.fee_obligations o
    WHERE o.tenant_id=$1 AND o.status='void'
      AND (o.id = $2 OR o.id IN (SELECT obligation_id FROM app.payment_allocations WHERE tenant_id=$1 AND payment_id=$3))
    LIMIT 1`, ...)).rows[0];
if (voided) return moneyError(reply, 'OBLIGATION_SETTLED', 'the obligation was voided — a payment cannot be confirmed against it');
```

A voided obligation must not be resurrected by confirming a still-initiated payment against it.

Then the part the story came to tell. The **gateway reference**.

Older code decided whether a payment was "gateway-verified" by **regex-matching the caller's own
string**, `/^[A-Z0-9-]{10,}$/`. Any finance user could type `MANUAL-123456` into the confirm body
and the audit ledger would record *"Confirmed payment (gateway webhook verified)."* The claim the
money depended on was a property of the string's shape, not of any gateway having spoken. The
refund path synthesised references the same way, so the pattern was also being manufactured
internally.

The fix is the single most important money-security improvement in the product. A reference is now
verified **only if the provider's own record contains it**:

```js
const gatewayRef = suppliedRef || 'MANUAL';
let verifiedBy = null;
if (typeof gatewayRef === 'string' && gatewayRef.length > 0 && gatewayRef !== 'MANUAL') {
  const ev = await c.query(
    `SELECT 1 FROM plugin_razorpay.order_log
      WHERE to_regclass('plugin_razorpay.order_log') IS NOT NULL
        AND payment_id = $1
        AND (razorpay_order_id = $2 OR razorpay_payment_id = $2)
      LIMIT 1`, [p.id, gatewayRef]).catch((e) => { if (e?.code === '42P01') return { rows: [] }; throw e; });
  if (ev.rows[0]) verifiedBy = 'razorpay';
  if (!verifiedBy) {
    const upi = await c.query(
      `SELECT 1 FROM plugin_upi.webhook_log
        WHERE to_regclass('plugin_upi.webhook_log') IS NOT NULL
          AND tenant_id = $1
          AND (event_id = $2 OR payload::jsonb->'payload'->'payment'->'entity'->'notes'->>'paymentId' = $3)
        LIMIT 1`, [req.user.tenant_id, gatewayRef, p.id]).catch(...);
    if (upi.rows[0]) verifiedBy = 'upi';
  }
}
```

Three properties matter:

1. **The lookup is the evidence.** A reference the caller invented matches nothing. A reference the
   gateway issued is already in the provider's log before anyone types it.
2. **It is joined to THIS payment row.** A genuine gateway reference belonging to a different
   payment cannot launder this one.
3. **It is tenant-scoped by RLS**, because it runs inside `withUser`.

If no provider vouches, the settlement is still permitted — a desk taking cash must be able to
settle a payment — but it is **labelled** for what it is:

```js
const webhookVerified = verifiedBy !== null;
const settledVia = webhookVerified ? 'gateway' : 'manual';
```

The reference is still stored even when unverified, and the comment explains why: `app.payments`
carries `CHECK (status <> 'confirmed' OR gateway_ref IS NOT NULL)`, so the schema defines "confirmed"
to require a reference and gives nowhere to record its absence. The column records **what the desk
typed**; `verifiedBy` records **whether a gateway vouched for it** — and that distinction is
persisted in the audit as two different action strings:

```
"Confirmed payment (gateway reference razorpay verified against the provider's own record)"
"Confirmed payment (manual reconciliation — no gateway evidence)"
```

That is what an auditor needs: not "confirmed", but *confirmed how*.

### 7.8 The receipt, and the race that used to skip one

The handler takes a tenant-scoped advisory lock to produce a **deterministic receipt number**:

```js
await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`fee_receipt:${req.user.tenant_id}`]);
const receiptNo = `${rprefix}-${String(Number(rmax.m) + 1).padStart(6, '0')}`;
```

The old scheme was `RCP-<base36 timestamp>` with `ON CONFLICT DO NOTHING`, which could *silently
skip a receipt* on a collision. Now the number is unique under the lock, and a collision would be a
hard error, never a skipped receipt. The payment is updated to `confirmed` with the receipt number,
the settling user, the settlement path, and a reconciliation status (`matched` for gateway,
`manual` otherwise).

Then the ledger update distributes the settlement across the payment's **allocations**, so a pay-many
payment moves every obligation it covers:

```js
const u = await c.query(
  `UPDATE app.fee_obligations SET paid_cents = paid_cents + $2,
     status = CASE WHEN paid_cents + $2 >= net_amount_cents THEN 'paid' ELSE 'partial' END
   WHERE id=$1 AND status <> 'void' RETURNING *`, [a.obligation_id, a.amount_cents.toString()]);
```

Installments settle **in order** up to the new paid total. A receipt row is inserted into
`app.fee_receipts` (immutable), and a real PDF artifact is rendered and stored through
`files.store`, scoped `student` so the child's guardians can download it through the audited
download door. The artifact is best-effort — a storage failure must never roll back a completed
settlement; the receipt row is the record and can be re-rendered.

Finally, the **receipt communication** is queued with real recipients and a dedup key:

```js
const phones = await guardianPhones(c, req.user.tenant_id, p.student_id);
await c.query(
  `INSERT INTO app.communications (tenant_id, audience_kind, audience_json, channel, template, body, policy_ref, dedup_key)
   VALUES ($1,'guardian',$2::jsonb,'whatsapp','FEE_RECEIPT',$3,'Fees §4.2',$4)
   ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING`, ...);
```

The dedup key `receipt:<paymentId>` means a retried confirm cannot send two receipts. And note the
recipient resolution: it reads `family.child_link → users` first, then falls back to the
denormalised `students.guardian_phone`. Again, both family shapes.

### 7.9 Refund, reconcile, dunning

The story is not done with money, but it will move faster now.

**Refund** (`POST /payments/:id/refund`) performs the gateway leg **first**; if the gateway refuses,
the ledger is left **byte-identical**. The floor is zero: an obligation's `paid_cents` cannot go
negative. A refund at or above the tenant's `refund_approval_threshold_cents` (default ₹5,000) may
not be executed by a pure maker, and never by the same user who settled the payment (unless owner)
— the maker/checker separation again.

**Reconcile** (`POST /payments/reconcile`) sweeps for ghosts (gateway says paid, ledger says no),
missing (ledger says paid, gateway says no), and orphans, writing a match queue
(`app.recon_match_queue`, the latest migration). The story flags that a separate
`reconcile-payments.js` worker builds its own Postgres client, which means it runs as the **owner
role with RLS bypassed** — a least-privilege violation the project's audit records — and it writes
`app.events` rows directly with **no outbox row**, so its warnings reach no subscriber. The
reconciliation *is* real; its side-effects are incomplete.

**Dunning** (`POST /fees/dunning/run`) queues overdue reminders with quiet-hours awareness: during
Indian Standard Time quiet hours it writes **nothing**, and it dedups on a seven-day window per
obligation. Because the dunning worker is not scheduled by default (Chapter 1, OPS-8), a queued
reminder may sit until the dispatcher runs.

**Late fees** (`POST /fees/late-fees/run`) apply the tenant's per-day rate, cap, and grace. The
settings exist because "Run late fees" used to be a button that could only ever answer 409 — the
policy values were collectable but no door read them.

### 7.10 The honest flag that matters most here

Here is the gap the project's own audit writes in capital letters, and the story will not soften
it: **the money UI is disconnected from the money doors.**

- The server has confirm, refund, void, dunning, and reconcile doors.
- `liveApi` has **no payment wrapper at all**.
- The Fees screen's *Collect*, *Send reminder*, *waive*, *export*, and *receipt-print* controls
  mutate the **demo store** or raise toasts. The void wrapper exists in `liveApi` but has **no UI
  caller**.
- The Payments tab in live mode is **permanently empty** because no door is wired.

So: a finance role's core job — actually collecting and confirming money — is, in the shipped
browser, largely fiction, while the server behind it is real and carefully built. The one honest
money flow that *is* wired end to end is **Fee Plans** (create/generate/list), plus the
**parent-initiated UPI/Razorpay link** path through the parent portal. The story names this gap so
that a reader does not mistake a working backend for a working button. It is, by the project's own
admission, the largest UI-versus-server gap in the product.

### 7.11 The shape of the money domain, summarized

- **Plans are templates; obligations are per-student; payments allocate across obligations.**
- **Re-generation is idempotent** by a unique key on `(tenant, student, term, label)`, and never
  touches paid rows.
- **One open payment per obligation**, enforced by a partial unique index.
- **Idempotency keys** make initiation safe to retry.
- **Maker/checker** separation on confirm and large refunds.
- **Cash requires a counter-PIN** where enrolled.
- **Gateway verification is against the provider's own record**, never a regex.
- **Receipt numbers are deterministic** under a tenant lock, and receipts are immutable artifacts.
- **All money moves are audited**, with the audit distinguishing gateway-verified from manual.

Ananya, the accountant, closes the fees tab satisfied with the server and uneasy about the buttons.
She is right to be.

<!-- END OF PART 7 -->

---

## Chapter 8 — The Morning Register

### 8.1 Before a teacher can mark, someone must give them a class

Priya Iyer is Green Valley's first teacher. Before she can take a register, an administrator must
tell the system that Grade 6-A is *hers*. That is a separate, deliberate act, and the story pauses
on it because it is the fix to a real architectural hole.

On `/classes`, in the **"Who owns which class"** panel, principal Rekha Deshmukh assigns Priya to
6-A. `POST /class-assignments`, gated to `owner`, `principal`, `coordinator`. The handler:

```js
const t = (await c.query(
  `SELECT id, name FROM app.users WHERE tenant_id=$1 AND id=$2 AND role='teacher'`,
  [req.user.tenant_id, teacherId])).rows[0];
if (!t) return bad(reply, 'That user is not a teacher in this school', 404);
```

The person must be a **teacher in this tenant**. A composite foreign key would already refuse a
foreign tenant, but a bad *role* (say, a parent) would otherwise be accepted silently — "an
assignment to a student or a parent account is not a class owner, it is a mistake that would take a
term to notice."

Then the handover logic:

```js
const prior = (await c.query(
  `SELECT a.id, u.name FROM app.class_assignments a JOIN app.users u ON u.id = a.teacher_id
    WHERE a.tenant_id=$1 AND a.grade=$2 AND a.section=$3 AND a.active`, ...)).rows[0];
if (prior) {
  await c.query(`UPDATE app.class_assignments SET active=false WHERE id=$1 AND tenant_id=$2`, [prior.id, req.user.tenant_id]);
  await auditLog(c, ..., { action: `Class ${g}-${sec} reassigned from ${prior.name} to ${t.name}`, ... });
}
```

One owner per class — a **partial unique index** on `(tenant_id, grade, section) WHERE active`
(migration `083`). Assigning a new teacher retires the old assignment rather than failing, because
that is what a handover means. The audit says `Class 6-A reassigned from X to Y`. The new row is
inserted, and another audit says `Class 6-A assigned to Priya Iyer`, with the outcome:
*"register for 6-A is now markable by Priya Iyer."*

> **Honest flag — why this door exists.** Before migration `083`, `app.timetable_slots` carried a
> `teacher_name` string but no grade/section binding, so **no query could answer "which classes does
> this teacher own."** The attendance door therefore refused every non-principal role with a blanket
> 403 while *advertising* `teacher` in its role gate — a teacher door no teacher could use. The
> project's fix was not to relax the check but to **create the data** (class assignments), so the
> authority could be asserted truthfully. This is a good example of the product's preferred repair
> pattern: do not weaken a gate to make a flow work; give the gate the data it needs.

The read door, `GET /class-assignments`, scopes teachers to their own assignments and office roles
to the whole school, returning `{ scoped: 'school' | 'own_classes' }`. `DELETE /class-assignments/:id`
**soft-retires** (never deletes) — the row is the record of who held the register, and the unique
index is partial precisely so that history survives.

### 8.2 Reading the register

At 8:05 a.m., Priya opens `/attendance` and picks date, Grade 6, Section A. The screen calls
`GET /attendance`:

```
?date=2026-06-16&grade=6&section=A
```

The handler refuses students outright:

```js
if (req.user.role === 'student' && !canReach(req, STAFF_ROSTER_ROLES)) {
  return bad(reply, 'The school-wide register is staff-only. Ask the school office for your own attendance record.', 403);
}
```

and scopes parents to their own children:

```js
if (req.user.role === 'parent') {
  const r = await c.query(
    `SELECT s.id, s.admission_no, s.name, s.grade, s.section, a.status, a.note
     FROM family.child_link cl
     JOIN app.students s ON s.id = cl.student_id AND s.status='active'
     LEFT JOIN app.attendance a ON a.student_id = s.id AND a.school_date = $2::date
     WHERE cl.user_id = $1 ORDER BY ... LIMIT 50`, [req.user.id, date]);
  return { date, rows: r.rows, scoped: 'own_children' };
}
```

The `LEFT JOIN` means a child with no row yet shows a `null` status — the register shows who has
*not* been marked. Staff get the full roster (capped at 2000 rows). No attendance row exists for
June 16 yet, so every status is null.

> **Aside — the student leak that was fixed.** The comment records SEC-3: only `parent` used to be
> scoped, so a **student** fell through to the whole-school query and read every pupil's
> `admission_no`, name, grade, section and daily status. The sibling roster doors already refused
> students; the attendance door was an inconsistency rather than a policy. It now refuses.

### 8.3 Marking: the payload's opinion is never consulted

Priya taps each name present, and marks the absentees. The screen POSTs:

```json
{
  "date": "2026-06-16",
  "marks": [
    { "studentId": "<aarav-uuid>", "status": "present" },
    { "studentId": "<other-uuid>",  "status": "absent"  }
  ]
}
```

`POST /attendance/mark`, gated to `owner`, `principal`, `coordinator`, `teacher`. The handler:

- requires a non-empty `marks` array, **capped at 300 students** ("Split the class and try again"
  with a 413);
- requires each entry to be an object with a UUID `studentId` and a status in
  `present | absent | late | leave`;
- then, for a non-office caller, resolves the teacher's owned classes and asserts them:

```js
const isOffice = ['owner', 'principal', 'coordinator'].includes(req.user.role);
let ownedClasses = null;
if (!isOffice) {
  ownedClasses = (await c.query(
    `SELECT grade, section FROM app.class_assignments
      WHERE tenant_id=$1 AND teacher_id=$2 AND active`, [req.user.tenant_id, req.user.id])).rows;
  if (ownedClasses.length === 0) {
    return bad(reply, 'No class is assigned to you yet, so the register can only be marked by the principal\'s office. Ask an administrator to assign you a class.', 403);
  }
  const cap = await assertTeacherOwnsClasses(c, req.user, ownedClasses, marks);
  if (cap.error) return bad(reply, cap.error, 403);
}
```

`assertTeacherOwnsClasses` is the security heart of the door, and its comment is worth quoting in
full because it explains why the obvious shortcut is wrong:

> *"It reads the STUDENTS being marked and requires every one of them to sit in a class the caller
> owns. The obvious cheaper implementation — trust the `grade`/`section` carried in the request
> payload — is exactly wrong: a client asserting 'this mark is for 8A' while sending another class's
> student ids is the attack the check exists to stop, so the class of record is derived from the
> student rows, server-side, and the request payload's opinion is never consulted."*

It then separates two failure modes:

```js
const missing = ids.filter((id) => !byId.has(id));
if (missing.length) return { error: `No such student in this school: ...` };
const foreign = rows.filter((r) => !owned.has(`${r.grade}||${r.section}`));
if (foreign.length) {
  return { error: `You can only mark the register for your own class(es) — this submission includes ${foreign.length} student(s) from ${classes}. Your class(es): ${mine}.` };
}
```

Rows that are not visible are reported **separately** from rows in the wrong class, because RLS
makes a cross-tenant or non-existent id indistinguishable from a typo — and saying "wrong class"
about a student the caller cannot see would leak that the id exists. So a teacher who tampers with
the payload gets a specific, non-leaking refusal.

### 8.4 The write, and the audit that records change rather than clicks

The handler reads the prior register **before** writing:

```js
const priorRows = (await c.query(
  `SELECT student_id, status FROM app.attendance
    WHERE tenant_id=$1 AND school_date=$2::date AND student_id = ANY($3::uuid[])`, ...)).rows;
const was = new Map(priorRows.map((r) => [r.student_id, r.status]));
```

Then it upserts each mark. The uniqueness of `(tenant_id, student_id, school_date)` means
re-marking the same day is an **update, not a duplicate**:

```sql
INSERT INTO app.attendance (tenant_id, student_id, school_date, status, marked_by)
VALUES ($1,$2,$3::date,$4,$5)
ON CONFLICT (tenant_id, student_id, school_date)
DO UPDATE SET status=EXCLUDED.status, marked_by=EXCLUDED.marked_by, marked_at=now()
```

Then the audit. This is one of the best changes in the product's history:

```js
for (const m of marks) {
  const from = was.get(m.studentId) ?? null;
  if (from === m.status) continue;               // a no-op is not a mutation
  await auditLog(c, req.user.tenant_id, {
    actor: req.user.name, actorRole: req.user.role,
    action: from ? `Attendance for ${m.studentId} on ${date}: ${from} → ${m.status}`
                 : `Attendance for ${m.studentId} on ${date}: recorded ${m.status}`,
    recordType: 'Attendance', recordRef: m.studentId,
    outcome: isOffice ? 'principal office' : 'class assignment',
  });
}
```

The old door left **one** audit row saying *"Marked attendance · N students on <date>"* — a count,
which cannot answer the question a school is audited on: *who was changed, from what to what, by
whom.* Now there is one row per student whose status actually changed, and a re-submit that changes
nothing is **not** recorded as a mutation. The ledger becomes a record of acts, not of clicks. Note
also that the **authority applied** is stamped (`principal office` vs `class assignment`) rather
than inferred from the actor's role.

> **Honest flag — field-level old/new is not a general feature.** Attendance captures the old and
> new status because this handler was rewritten to. For most domains, the audit `action` sentence
> carries the summary and there is no generic value-diff into the ledger. The project's audit lists
> this as a known limit: "NOT IMPLEMENTED: field-level old/new diff capture" outside attendance.

### 8.5 The absence notice, and the two family shapes

Only **newly** absent students are notified:

```js
const absents = marks.filter(m => m.status === 'absent');
const newlyAbsent = absents.filter((m) => was.get(m.studentId) !== 'absent');
```

A re-submit of an already-absent student does not queue a second guardian notice. Then the event:

```js
await emitEvent(c, ..., { type: 'attendance', label: `attendance.marked — ${marks.length} students on ${date} · ${newlyAbsent.length} newly absent`, severity: newlyAbsent.length > 2 ? 'warn' : 'info' },
  'attendance.absences', { date, absentCount: newlyAbsent.length });
```

And the recipient resolution — the union of both family shapes:

```sql
SELECT DISTINCT s.id AS student_id, s.name, t.phone
  FROM app.students s
  JOIN (
    SELECT g.student_id, g.phone FROM app.guardians g WHERE g.is_primary AND g.phone IS NOT NULL
    UNION
    SELECT cl.student_id, u.phone FROM family.child_link cl
      JOIN app.users u ON u.id = cl.user_id
     WHERE u.phone IS NOT NULL AND u.active
  ) t ON t.student_id = s.id
 WHERE s.id = ANY($1::uuid[])
```

The comment explains the defect: reading only `app.guardians` meant **empty results for every
app-created student**, because their family lives in `family.child_link`. The union is the whole
fix. For each guardian phone, a queued `app.communications` row (template `ABSENCE_NOTICE`,
channel `whatsapp`) is inserted.

And the response reports the truth:

```js
return { ok: true, marked: marks.length, absent: absents.length, noticesQueued, guardiansResolved: noticesQueued };
```

The comment: *"M2: report the number of communication rows actually inserted (and guardians
resolved), never the number of newly-absent students — the old value reported 1 when 0 were
queued."* An honest API returns what happened, not what was intended.

### 8.6 The honest flags around the register

- **The "mark all as absent" shortcut in `/live`.** The `LiveMode` harness has a button labelled
  *"Mark unmarked as absent"* that actually marks only the **first two** unmarked rows while its
  copy promises all. The story flags it; it is a harness, not a school feature, but the copy lies.
- **Sort affordances that do nothing.** The Attendance DataTable renders sort arrows on
  non-sortable columns; clicking them changes nothing.
- **Demo marking is theatre.** In demo mode, marking attendance mutates the in-browser store; no
  request leaves, no row is written, no audit row exists.
- **`ops.timetable` period autofill always writes `present`.** The plugin's idempotent
  period-autofill (`WHERE NOT EXISTS`, never touching human marks) ignores its own
  `autofill_default` setting — one of six declared settings the project lists as never read.

### 8.7 Why attendance is a small domain with a big lesson

Attendance is one table, one unique key, one status column. Yet it carries the entire philosophy of
the product: a mutation is bound to an authorised class, the class is derived from data rather than
asserted by the client, the ledger records change rather than clicks, notice recipients are
resolved from both shapes of family, and the response counts what actually happened. If you
understood this chapter, you understand how the whole system tries to behave.

<!-- END OF PART 8 -->

---

## Chapter 9 — Homework, and the Name That Is Not an Identity

### 9.1 Posting homework

Priya opens `/teacher/...` — and immediately the story hits its first routing defect. The teacher's
real desk (`/teacher/*`) is **on no desktop nav list**. It is reachable only from the mobile
More-sheet or by typing a URL. The platform's largest user class has a discoverability hole. The
story flags it now and will flag it again in the Epilogue.

Once she is on the homework screen, she fills in:

- Class: `6`
- Subject: `Mathematics`
- Title: `Fractions worksheet 3`
- Detail: `Complete questions 1–20.`
- Attachment: `https://drive.example.com/fractions-3.pdf`
- Due: `2026-06-18T14:00`

`POST /plugins/teacher.classroom/homework`, gated to `teacher`.

The handler validates that class, subject, title, and a parseable due time are present. Then it
validates the attachment through `safeAttachmentRef`:

```js
if (/^[a-z][a-z0-9+.-]*:/i.test(s)) {
  const u = new URL(s);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false };
} else if (s.startsWith('//')) return { ok: false };
if (/[\u0000-\u001f\u007f]/.test(s)) return { ok: false };
```

A scheme allowlist, a protocol check, a rejection of protocol-relative URLs, and a rejection of
control characters. This is a **stored-XSS control**: an attachment reference is displayed to other
users, so it must not be able to carry `javascript:` or a data URI. The comment calls it a "scheme
allowlist." Note what is *not* stored: the file itself. `attachment_ref` is a validated name or URL
string; actual files go through `files.store` (Chapter 18).

The row is inserted into `teacher.homework` with `created_by` set to Priya's user id. Then:

```js
await emitEvent(c, ..., { type: 'classroom', label: `Homework posted: ${b.subject} — ${title}` , ref: row.id },
  'homework.v1', { homeworkId: row.id, classGrade: row.class_grade, subject: row.subject, dueAt: row.due_at, createdBy: req.user.id });
await requestAudit(c, ..., { action: 'Homework posted', recordType: 'Homework', recordRef: row.id, ... });
```

The event topic is `homework.v1`, the plugin audit's actor role is forced to
`plugin:teacher.classroom`, and the policy reference defaults to
`Platform §3 (plugin governance) · teacher.classroom`.

> **Honest flag — the toast that promises a message the server never sends.** The homework screen's
> success toast claims a 17:00 guardian digest will go out. The server sends **nothing** on
> `homework.v1`. The workflow-worker is not scheduled (Chapter 1), and even if it were, no rule
> fans this topic into a communication. The toast is a copy-versus-truth gap, and the story marks
> it.

### 9.2 Listing homework: the privacy pin

`GET /plugins/teacher.classroom/homework` has an unconditional privacy pin:

```sql
SELECT ... FROM teacher.homework h
 WHERE h.created_by = $1 AND ($2::text IS NULL OR h.class_grade = $2)
 ORDER BY h.due_at ASC LIMIT 100
```

`created_by = self`. A teacher sees only the homework *they* posted. There is no "browse all
homework" door, not even for the principal, because the pin is in the query, not a role check.
The response says so: `{ scope: 'mine' }`.

Opening one assignment joins its submissions to the **roster** row, not the user row. The comment
records the bug that forced this:

> *"submissions key an `app.students` row (the 082 FK), so the name rides THAT row — the join this
> used to make against `app.users su ON su.id = s.student_id` could only ever resolve while the
> write was storing a user id, and it returned NULL the moment the column held what it is named
> for."*

The write side had been storing a user id in a column constrained to reference `app.students`. The
gate approved one thing and the write filed another. The fix was to make the gate and the write
share a single resolution function.

### 9.3 The submission, and the identity problem laid bare

This is the most honest passage of code in the entire repository. Read it slowly.

The story needs Aarav to submit his homework. But here is the state of student identity in the
`teacher.classroom` plugin, quoted from its own comment:

> *"There is no structural link from `app.users` to `app.students`: no FK, no shared column, no
> `students.user_id`. The only correspondence that exists in this database is the NAME ...*
>
> *THE WEAKNESS, STATED PLAINLY (do not paper over it): a name is not an identity. This resolution
> cannot distinguish two students who share a name, and the seed shows that is not hypothetical —
> `Diya Nair` has three grade-8 rows (sections A, B and C) ... so when several same-name students
> sit in the homework's grade we take the LOWEST `admission_no` ... That is a deterministic,
> auditable tiebreak, not a correct identification ... Nobody can do better from these two tables;
> the structural repair is a `students.user_id` column backfilled at provisioning."*

That comment is a confession, and it is **partly stale**. The structural repair it asks for —
`app.students.user_id` — *was* added later (migration `132`, per the project's own current map),
and `people.admin` now writes it when a pupil account is created "from the roster row." But
`teacher.classroom` still resolves the submitting student by **name**, because its code has not been
updated to read `students.user_id` first. The story states this as a live doc/code mismatch:
**the fix exists for one plane and not the one that needs it most.**

So when Aarav submits, the plugin:

1. Checks the homework exists and is open.
2. Reads how many active roster students carry the submitter's name **in the homework's grade**.
3. If zero, checks whether the name exists **anywhere** in the school:
   - if nowhere → `409 "Your login isn't linked to a student at this school ... ask the school office to link your account"`
   - if elsewhere → `409 "This homework is for a different class"`
4. Resolves the roster row by name and grade, lowest admission number first.
5. Inserts the submission with `status` `late` or `submitted`, decided **at insert** (`new Date() > new Date(hw.due_at)`).

The one-shot rule is structural:

```js
await c.query('SAVEPOINT submit_once');
try {
  await c.query(`INSERT INTO teacher.submission (...) VALUES (...)`, ...);
} catch (e) {
  await c.query('ROLLBACK TO SAVEPOINT submit_once');
  if (e.code === '23505') return bad(reply, 'Already submitted — resubmission is requested by your teacher, not allowed here', 409);
  throw e;
}
```

A unique constraint on `(homework_id, student_id)` makes one submission per student per assignment a
database fact, and the `SAVEPOINT` turns the violation into a friendly 409 instead of a poisoned
transaction. Then `emitEvent('submission.v1')` and an audit row.

> **Honest flag — the student portal's "structural pin" and this plugin disagree.** The project's
> current map says student identity was "RESOLVED" — `ownStudent()` reads `app.students.user_id`
> first. That is true of the `student.world` plane. But `teacher.classroom`'s submission path still
> name-matches. Two planes, two identity rules. The story flags this as the single most important
> inconsistency in the product, because everything downstream (results, report cards, which child
> inherits whose marks) depends on getting the child right.

### 9.4 Review: the assigning teacher only

`POST /plugins/teacher.classroom/submissions/:id/review`. The handler fetches the submission
**without** the owner filter first, so that a colleague's submission answers 403 rather than a
dataless 404:

```js
const row = (await c.query(
  `SELECT s.id, s.status, s.homework_id, s.student_id, h.title, h.subject, h.created_by
     FROM teacher.submission s JOIN teacher.homework h ON h.id = s.homework_id
    WHERE s.id=$1 FOR UPDATE OF s`, ...)).rows[0];
if (!row) return bad(reply, 'We couldn\'t find that submission', 404);
if (row.created_by !== req.user.id)
  return bad(reply, 'Only the teacher who assigned this homework can review it', 403);
```

Two subtleties:

1. **404 vs 403 by design.** A nonexistent submission is 404; a real submission belonging to
   another teacher is 403 with the rule stated. A dataless 404 would hide the rule and make the
   system feel arbitrary.
2. **`FOR UPDATE OF s`** locks only the submission row, not the joined homework.

The review sets a status in a known set, allows a grade **only** when the status is `graded`, and
writes `reviewed_by` and `reviewed_at`. It emits `submission.v1` and audits
`Submission reviewed (<status>)`.

### 9.5 The inbox, and the false-negative that is deliberately chosen

The teacher's inbox (`GET /plugins/teacher.classroom/submissions`) has a `missing` view: roster
students of the class whose due date passed with no submission on file. This is where the
name-versus-id problem becomes a visible product trade-off, and the code is candid about it:

> *"PRESENCE vs ATTRIBUTION — two different questions ... The write now stores a ROSTER id, so the
> primary test here is a plain id comparison and is exact. But the roster cannot distinguish
> same-named children ... An id-only anti-join then lists the OTHER namesakes as missing although
> the class's work is in, which is a false alarm that sends a teacher chasing work that already
> exists. ... The trade a school actually sees: a namesake who truly did not submit is not flagged
> individually. That is a false NEGATIVE — the safe direction for an absence check ... The
> structural fix for both directions is a real `students.user_id` link ... not a cleverer query: no
> amount of SQL recovers which section-sibling signed in."*

The product chooses to under-report missing rather than over-report, because a false "missing" alarm
wastes a teacher's time and erodes trust, while a missed namesake is caught by the teacher's own
knowledge of the class. That is a defensible product judgement, and the story respects it — but
notes that it is a *workaround for a missing structural link*, not a solution.

### 9.6 Lessons and leaves: the teacher's other surfaces

The same plugin also carries:

- **Lesson logs** (`POST /lessons`, `POST /lessons/:id/reflect`) — a teacher records what was
  taught and reflects on it.
- **Leave requests** (`teacher.leave_request`) — a teacher requests a staff day off, and `pending`
  requests are surfaced on the command center. But the actual approval routes through the **kernel
  action spine**: a leave request becomes an `app.actions` row owned by the coordinator, so the
  decision, its segregation-of-duties, and its audit all live in one place (Chapter 15).
- A **`/teacher/home` aggregate** that assembles NOW / NEXT / NEEDS-ATTENTION / AT-A-GLANCE from
  authorized sources, probing sibling tables (`class_assignments`, `timetable_slots`,
  `duty.assignment`, `teacher.concern`) and degrading to empty rather than 500. The comment says
  the timetable grid is section-agnostic, so a period is shown against the teacher's **own** class
  from `app.class_assignments`; when the school has not assigned a class, the label is empty rather
  than invented.
- **A `GET /teacher/leave/mine` that writes state inside a GET.** The project's risk register
  calls this out: a state-write inside a GET is outside the CSRF model. The story flags it as a
  design smell, not a security hole (it is a read-triggered side effect, not an exposed mutation
  door), but it is the kind of thing that surprises an auditor.

### 9.7 The honest state of the teacher plane

- The server side of homework is real, careful, and one-shot-safe.
- The teacher's real desk is **unrouted on desktop nav**.
- **Five teacher screens are unrouted**: `CurriculumProgress`, `MasteryMap`, `DutyWorkload`,
  `ProgressStory`, and siblings exist as files but are not mounted. `TeacherNav` links to ten paths
  that all hit `NotFound`.
- `SubmitReviewsInbox` performs **bulk review as sequential POSTs** and never renders the progress
  counter it promises.
- `MasteryMap`'s class picker is **inert**.
- The `teacherFixtures.ts` transport is a "probe-first shim": it tries the real door, and on a 404
  it falls back to fixtures *forever*. It also sends no CSRF token or credentials — so under a
  cookie deployment its POSTs would fail.

The teacher plane is the clearest case of a product whose *server* is done and whose *surface* is
half-built. The story says so plainly because a reader evaluating SchoolOS deserves to know that
"teacher homework" is not one feature but two: a finished backend and a patchwork frontend.

<!-- END OF PART 9 -->

---

## Chapter 10 — Exams: Where a Mark Becomes History

### 10.1 The exam that must add up to one hundred

Priya creates a mid-term exam. `POST /plugins/exams.assessment/exams`:

```json
{ "name": "Mid-Term 2026", "term": "term-1", "classGrade": "6",
  "weightage": { "written": 80, "internal": 20 } }
```

The handler validates the weightage with a precise rule:

```js
const validWeightage = (w) => {
  const keys = Object.keys(w);
  if (!keys.length || keys.length > 10 || keys.some((k) => typeof k !== 'string' || k.length > 40)) return null;
  let total = 0;
  for (const v of Object.values(w)) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
    total += n;
  }
  return total === 100 ? w : null;
};
```

The components must be **non-negative numbers that add up to exactly 100**. Not 99. Not 100.5.
Exactly 100. If not, the caller gets a 409: *"This exam's components must be non-negative numbers
that add up to exactly 100%."* The exam is inserted as a `draft`, and the audit records the
weightage in full.

This is a small rule with a large consequence: an exam whose weights do not normalize would produce
percentages that cannot be trusted, and a report card is a legal-ish document in an Indian school.
The product refuses to guess.

### 10.2 Marks: one row per student per component, audited, gated by attendance

`POST /plugins/exams.assessment/exams/:id/marks`:

- `studentId` is format-validated (a malformed id gets a 400, not a `uuid` cast 500);
- `marks` must be a finite non-negative number;
- `maxMarks` defaults to 100 and must be positive;
- marks may not exceed the maximum (`409`);
- the exam row is locked `FOR UPDATE` and is **refused if already published** — `"Marks are locked
  — this exam is already published"`;
- the student must be in this tenant.

Then a rule that couples the exam domain to attendance:

```js
const minPct = await (async () => { const p = Number((await sysq(
  `SELECT settings->>'minAttendancePct' AS p FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`, ...)).rows[0]?.p);
  return Number.isFinite(p) && p > 0 ? p : 75; })();
const att = (await sysq(
  `SELECT count(*)::int AS total,
          count(*) FILTER (WHERE status IN ('present','late'))::int AS attended
   FROM app.attendance WHERE tenant_id=$1 AND student_id=$2`, ...)).rows[0];
const pct = att.total > 0 ? Math.round((att.attended / att.total) * 1000) / 10 : 0;
if (pct < minPct) {
  return reply.code(409).send({ error: `Attendance is ${pct}%, below the ${minPct}% floor — this student can't sit this exam`, attendancePct: pct, floor: minPct });
}
```

The attendance floor defaults to **75%** and **late counts as attended** (late means the student
showed up). The `Number.isFinite(p) && p > 0` guard is a fixed bug: a `NaN` floor must mean "no
floor", not "every student fails". The student is refused a mark if below the floor.

The mark is an **upsert** on `(exam_id, student_id, component)`:

```sql
INSERT INTO plugin_exams.mark (tenant_id, exam_id, student_id, component, marks, max_marks, entered_by)
VALUES (...)
ON CONFLICT (exam_id, student_id, component) DO UPDATE SET marks=$5, max_marks=$6, entered_by=$7, updated_at=now()
```

Plus an event (`exam.marks.updated.v1`) and an audit row (`marks entered`, risk `medium`,
*"marks are sensitive records"*).

### 10.3 Bulk marks: one bad row never aborts the class

`POST /plugins/exams.assessment/exams/:id/marks/bulk` accepts up to **300 rows**. Its contract
mirrors the CSV-import robustness law:

> *"one bad row NEVER aborts the batch — shape/eligibility failures land in `failed[]` with the
> row's index and a human reason; valid rows commit."*

The exam is locked `FOR UPDATE` for the whole batch, and a published exam refuses the batch
outright. This is how a real teacher enters marks: one spreadsheet paste, with the two bad rows
named rather than the whole submission rejected.

### 10.4 Publication: an approval-gated freeze

This is the domain's centerpiece. Publishing an exam is not a button that flips a status. It is a
two-person, approval-gated operation.

**Step one — request publication.** `POST /exams/:id/publish` locks the exam, refuses if already
published, re-validates the weightage, then raises a **kernel approval action**:

```sql
INSERT INTO app.actions (tenant_id, code, kind, title, detail, why, priority, status, owner, owner_role, policy_ref, ai_involved, source_event, payload, source_plugin)
VALUES ($1,'exams.publish.'||$6::text,'approval',$2,$3,$4,'high','open','Principal','principal','Assessment publication',false,'exam.published.v1',$5::jsonb,'exams.assessment')
RETURNING id
```

The code is scoped per exam (`exams.publish.<examId>`), because kernel action codes are unique per
`(tenant, code)` and recurring operations must scope per instance. It refuses if an approval is
already waiting for that exam. The response is `{ ok, actionId, status: 'pending_approval' }`.

The comment for a removed guard is instructive: a `weightage_locked` check was **dead code**,
because the flag is only ever set true by the publication UPDATE itself, and `status ===
'published'` already catches that state. *"A guard that can never fire reads as protection that
does not exist."* It was removed.

**Step two — execute the approved publication.** `POST /exams/:id/publish/execute` requires the
action to be decided and not dismissed, and then enforces segregation of duties:

```js
if (act.payload?.proposed_by === req.user.id) {
  return reply.code(403).send({ error: 'The person who raised this publication can\'t approve it — a second person must' });
}
```

The person who proposed the publication cannot execute it. A second person must. Then the
**deterministic assembly**:

```js
const policy = (e.board_policy ? readBoardPolicy(e.board_policy) : null) ?? pluginPolicy;
const reports = assembleReports(e, marks, scale, policy);
const digest = createHash('sha256').update(canonical({ examId: e.id, weightage: e.weightage, reports: reports.map((r) => r.digest) })).digest('hex');
for (const r of reports) {
  await c.query(`INSERT INTO plugin_exams.report (tenant_id, exam_id, student_id, snapshot, digest) VALUES ($1,$2,$3,$4::jsonb,$5)`, ...);
}
await c.query(`UPDATE plugin_exams.exam SET status='published', weightage_locked=true, published_snapshot=$2::jsonb, digest=$3, published_at=now(), published_by=$4, updated_at=now() WHERE id=$1`, ...);
```

The reports are a **pure function** of `(marks, weightage, grade scale, board policy)`. Each report
stores a `snapshot` and its own `digest`. The exam stores an overall `digest` and a
`published_snapshot`. Then `emitEvent('exam.published.v1')` and a **high-risk** audit row:
*"exam published (kernel-approved) — N deterministic reports assembled, digest …, marks frozen."*

Why store a snapshot at all? Because a report card is a statement about a moment. Marks can be
corrected later through moderation (below), but the *original* assembled report must remain
recoverable and verifiable. The snapshot is frozen history, not a cache.

### 10.5 Moderation: an overlay that never rewrites the snapshot

A senior reviewer (the `MOD_TIER` roles) can propose a correction. `POST /reports/:studentId/moderate`
requires a reason of at least four characters and refuses if a proposal is already open. It writes a
`plugin_exams.moderation` row with status `proposed` and audits `moderation proposed`, recording the
original report's digest.

Decision — `POST /moderations/:mid/decide` — enforces the same SoD:

```js
if (m.proposed_by === req.user.id) {
  return reply.code(403).send({ error: 'The person who proposed this review can\'t decide it — a second person must' });
}
```

On approval, **the report row is never updated.** Report rows are INSERT+SELECT only. Instead, the
moderation record stores an **overlay**:

```js
const corrected = { ...adj, pct, ...gradeOf(pct, scale) };
if (adj.grade != null && adj.grade !== corrected.grade) {
  return bad(reply, `${adj.grade} does not follow from ${pct}% on this scale (it works out to ${corrected.grade}) — grades are always recalculated`);
}
const overlay = { snapshot: corrected, correctsReportId: m.report_id, originalDigest: r.digest,
  digest: createHash('sha256').update(canonical(corrected)).digest('hex') };
```

Three properties:

1. **A hand-supplied grade is ignored** and the grade is **re-derived** from the percentage on the
   exam's scale. If the caller's stated grade disagrees with the arithmetic, the request is refused
   with the correct grade. *"Grades are always recalculated."*
2. `pct` is validated with `Number.isFinite`, **not truthiness** — because `pct: 0` is a legitimate
   adjustment. This is a subtle and correct distinction.
3. The original digest is preserved inside the overlay, so the correction is traceable to what it
   corrects.

The read door serves the **latest approved overlay, else the original snapshot**:

```js
const served = Number.isFinite(pct) && pct >= 0 && pct <= 100 ? { ...snap, ...gradeOf(pct, scale) } : r.snapshot;
return { report: served, digest: mo.adjusted_snapshot.digest, generatedAt: r.created_at, moderated: ... };
```

And even a pre-hardening overlay cannot serve an absurd grade, because the read path re-derives on
the way out. The audit says: *"report snapshot replaced; original digest preserved in record"* —
though the snapshot is not actually replaced; the overlay is served over it. The language is
slightly loose; the mechanism is sound.

### 10.6 The board policy, and a stale document

The exam can carry a **per-exam board policy** (`POST /exams/:id/board-policy`), stored on the exam
row, which takes precedence over the plugin-level default; both feed the same deterministic
assembly. The project map from September said the `board_policy` column "exists but
**validation-only, nothing consumes it yet**." The current code **does** consume it in `execute`
and in the read path. So that document line is stale; the story follows the code.

The `pack.cbse` plugin layers a read-only rules engine `R1–R6` over `plugin_exams` — weightage,
grade scale, bounds, the 75% eligibility, report-integrity re-derivation, and board identity — plus
an OASIS CSV export. Its "gate" raises kernel obligations (e.g. `cbse.weightage.<exam>`) rather than
blocking. One declared setting, `weightage_strict`, is never consulted — one of the six unread
settings.

### 10.7 The honest state of exams

- The exam backend is among the most complete and careful in the product: deterministic assembly,
  frozen snapshots, digest verification, SoD on both publication and moderation, re-derived grades.
- The **real exam surface** (`app/src/screens/teacher/ExamMarks.tsx`) wires exams, marks-bulk,
  publish, execute, and board-policy correctly — but it is **not routed in production**, and demo
  mode replaces it with an empty card.
- The board-policy is consumed; the older "validation-only" note is stale.
- The `weightage_strict` setting is unread.

So exams are the inverse of the money UI: here the *server and the screen both exist and both are
good*, but the screen is **unmounted**. A school would have to reach it by URL. The story names
this as a routing defect rather than a backend one.

<!-- END OF PART 10 -->

---

## Chapter 11 — The Library, or the Copy Is the Thing

### 11.1 A book is not a copy

A school library is not a list of titles. It is a list of **physical objects**, and the object that
a child walks out with is a *copy*. The library plugin (`library`, version `2.0.0`, class C) models
this correctly: a `library.book` is a title; a `library.copy` is a physical item with a `copy_code`,
a `barcode`, an `accession_no`, and a `status` (`available`, `issued`, `damaged`, `lost`, …).

This distinction is the entire reason the plugin is version 2. The project's design doc
(`docs/LIBRARY-DESIGN.md`) describes per-copy tracking, reservations, a fines ledger, and purchase
requests — and a dedicated `librarian` role (Chapter 5). The library is **opt-in**: recall that
`plugin-catalog.js` deliberately excludes it from the birth set with the comment *"it stays locked
until a librarian account exists."*

Ananya turned it on in Chapter 4; then she created a librarian account (Kavita Nair) and, because
`librarian` is in the role catalog, the custom role preset that gives her library doors is usable.
The nav item `/library` appears because `KernelGate plugin="library"` reads `/plugins` enablement.

### 11.2 Scan, issue, return, renew

**Scanning.** `GET /plugins/library/scan?code=...`. The handler reads the desk's `scan_accepts`
setting (default `copy_code, barcode, accession, isbn`) and searches copies, then books (including
by ISBN-13/ISBN-10 or the school's own `code`). It returns `{ kind: 'copy' | 'book' | 'none' }`.
A desk scanner is thus a first-class input, and what it accepts is configurable.

**Issuing.** `POST /plugins/library/loans`. This is a small state machine:

1. Resolve the **borrower** (`borrowerFromBody`) — a student, a staff user, or a walk-in.
2. Lock the **book** `FOR UPDATE`; refuse a retired title (409).
3. Load the borrower-type policy and refuse if the borrower has a **lost** book outstanding.
4. Count open loans; refuse if at the limit (`This borrower already has N book(s) out (limit M)`).
5. Pick a copy: either the named copy (locked `FOR UPDATE`, and it must belong to the book) or the
   first `available` copy by `copy_code`, locked.
6. Compute the due date: the supplied `dueOn`, or today + the policy's `days`.
7. Insert the loan; set the copy `status='issued'`.
8. **Fulfil this borrower's own active hold** on the title, if any:

```sql
UPDATE library.reservation SET status='fulfilled', fulfilled_loan_id=$3
 WHERE tenant_id=$1 AND book_id=$2 AND status IN ('requested','ready')
   AND (($4::uuid IS NOT NULL AND borrower_student_id=$4::uuid) OR ($5::uuid IS NOT NULL AND borrower_user_id=$5::uuid))
```

9. Notify the borrower (`Library book issued`, with the due date), emit `library.loan.issued.v1`,
   and audit `Book issued`.

The double-locking — book then copy — is what prevents two simultaneous issues from handing the
same physical copy to two children.

**Returning.** `POST /plugins/library/loans/:id/return` locks the loan, checks it is `issued`,
computes the fine from the overdue days, marks the loan `returned` with `returned_by` and a
condition, sets the copy back to `available` (or `damaged`), inserts a `library.fine` row if owed,
calls `advanceQueue` to move the next hold to `ready`, notifies the borrower, emits
`library.loan.returned.v1`, and audits with the fine and overdue days. The fine is computed at
return; the design's comment notes it is UTC-exact.

**Renewing.** `POST /plugins/library/loans/:id/renew` (desk) and `renew-request` (borrower). A
renewal is refused if the loan is not issued, if the renewal limit is reached, or if **someone is
waiting** for the title:

```js
const hold = (await c.query(`SELECT 1 FROM library.reservation WHERE tenant_id=$1 AND book_id=$2 AND status IN ('requested','ready') LIMIT 1`, [t, l.book_id])).rows.length > 0;
if (hold) return { error: 'Someone is waiting for this title — it cannot be renewed', code: 409 };
```

That is a fair-lending rule encoded in a query: you cannot keep renewing a book someone else is
queued for.

### 11.3 Fines, holds, members, acquisitions

- **Fines** (`library.fine`) are a ledger with a `settle` door. A fine at return is `overdue`; a
  lost copy produces a `lost` fine. The desk can settle a fine.
- **Reservations** (`library.reservation`) form a **queue** with `queue_no`, `requested_at`,
  `ready_at`, `expires_at`. The desk can fulfil, the borrower can cancel, and a return advances the
  queue. The borrower-facing `reservations/mine`, `loans/mine`, and `fines/mine` doors serve a
  child's own library life.
- **Members**: `GET /plugins/library/members` lists borrowers. The desk overview aggregates counts.
- **Acquisitions**: a borrower can `POST /acquisitions` (a purchase request), others can `vote`, and
  the desk `decide`s. This is participatory collection-building, and it has its own event family
  (`library.acquisition.requested|voted|decided`).

### 11.4 The honest flags around the library

This domain is, by the project's own assessment, one of the **most fully built**. The
`LibraryLive` screen is **fully real**: books, loans, returns, overdue, and it is the **only screen
in the entire app that consumes `grants.ts`** — the display-only permission mirror. So it both
works and respects the client guard. Two flags remain:

- **`Library.tsx` is dead code** — imported nowhere. The live screen is `LibraryLive.tsx`.
- **`loans/mine` resolves a student by name-match and fails closed.** Older student binding again.
  The project ships `scripts/library-link-accounts.js` — a maintenance script specifically to link
  library borrower accounts — which is an admission that the structural link is incomplete. A
  student whose name is ambiguous cannot see their own loans until the script or a manual link fixes
  it.
- **The overdue list does not communicate.** There is no comms emission from the overdue door; the
  library surfaces an overdue list, and the school decides whether to send anything. The design
  says so explicitly: *"no comms (overdue list only)."* That is an honest scope decision, not a
  bug, but a school expecting automatic reminders will not get them.

### 11.5 What the library teaches about the whole architecture

The library is the cleanest illustration of the product's data philosophy:

- The **copy** carries state (`available`/`issued`/`damaged`), and a loan references a copy, not a
  title. Physical reality is modeled, not approximated.
- Every transition is **locked** and **state-gated**; concurrency cannot double-issue.
- Hold queues are honored; fairness is a query, not a policy document.
- Fines are a **ledger**, not a column that mutates in place.
- Retire, never delete: a title taken out of circulation keeps its history.
- Every act emits an event and writes an audit row.

If a reader wants to understand how the rest of the domains *should* behave, the library is the
reference implementation.

<!-- END OF PART 11 -->

---

## Chapter 12 — The Bus: A Delay Becomes a Promise

### 12.1 First, a route must exist

The project's own comment on the transport plugin begins with an admission:

> *"`app.routes` / `app.route_stops` were seed-only: a self-signup school had zero routes and no
> door to create one, so the transport module was unreachable for exactly the schools it exists
> for."*

So before any GPS story can happen, the write model had to exist. It does now, in the same
`transport.gps` plugin. Route codes are constrained hard, because a route code is what the roster,
the GPS feed, and every notice key on:

```js
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,15}$/;
```

A route is created with a code, a name, an optional vehicle, and a capacity (1–500, default 40).
Duplicate codes are refused with a 409. Routes can be edited and **retired** — never deleted, and
retiring a route retires its stops with it: *"a live stop on a retired route is a lie on the
board."* Stops get a **dense, server-assigned `seq`** (next position, not a caller-supplied number)
and an ETA offset clamped to ±240 minutes. Every write audits.

The comment on the gate registration is a small gem about code hygiene: the `preHandler` is
spelled out at each registration rather than held in a `const`, because *"a preHandler held in a
`const` is invisible to the route scanner, so plugin-conformance cannot see that these doors carry
the lifecycle gate at all, and an ungated door is one enable/disable does not switch off."* In other
words, a refactor that hides a gate from the static scanner is a security regression even though
the gate still runs.

### 12.2 Ingestion: a position, a budget, and a threshold

A GPS device (or, today, a mapped integration) posts a position:

```
POST /plugins/transport.gps/positions
{ "routeCode": "14", "lat": 18.5074, "lng": 73.8077, "delayMins": 13, "deviationM": 220 }
```

Gated to `transport`, `coordinator`, `principal`, `owner`. Validation requires a route code, a
numeric lat, a numeric lng. Then, before any write:

```js
const gov = await checkEventBudget(c, req.user.tenant_id, ID, 512);
if (!gov.allowed) {
  await auditLog(c, ..., { action: 'GPS ingestion rejected by governance', ... outcome: gov.code });
  return reply.code(429).send({ error: gov.code, ...gov });
}
```

A **governance budget** is checked first. If the tenant's transport plugin has exhausted its event
budget, the position is refused with **429**, and the refusal itself is audited. This is a plugin
being governed as a first-class citizen, not a raw table write. The story flags the one gap here:
the kernel's own budget helper has a "bypass by naming" path, where passing a non-plugin id
(`'transport'`) always takes the unbudgeted kernel path — so a transport ping through that specific
call shape escapes the budget. The plugin path shown here is correctly budgeted.

Then two rows and a meter:

```js
INSERT INTO plugin_transport_gps.positions (tenant_id, route_code, lat, lng, delay_mins, deviation_m) VALUES (...) RETURNING id, occurred_at;
INSERT INTO app.transport_events (tenant_id, route_id, kind, delay_mins, note) VALUES (..., delayMins != null ? 'gps_delay' : 'gps_ping', ...);
await meterPlugin(c, req.user.tenant_id, ID, 'positions_ingested');
```

The rider count is computed (`SELECT count(*) FROM app.students WHERE bus_route=$1`), then an event:

```js
const ev = await emitEvent(c, ...,
  { type: 'transport', label: `GPS ping — Bus ${route.code} (${lat}, ${lng})${delayMins ? ` · +${delayMins} min` : ''}${riders ? ` · ${riders} riders` : ''}`, severity: delayMins >= 10 ? 'warn' : 'info', ref: route.code },
  'gps.position', { routeCode, lat, lng, delayMins, riders },
  { emittedBy: `plugin:${ID}`, subject: `route:${route.code}`, schemaVersion: 1 });
```

The event envelope carries `emitted_by` as `plugin:transport.gps` and a subject `route:14` — the
v2 envelope in action (Chapter 23).

### 12.3 The deterministic guard: delay ≥ 10 raises an approval, not a message

If the delay is at least ten minutes, the plugin raises a **kernel approval action** — it does not
send anything:

```js
if (delayMins != null && delayMins >= 10) {
  const a = await c.query(
    `INSERT INTO app.actions (..., kind, title, detail, why, priority, status, owner, owner_role, policy_ref, ...)
     VALUES ($1,$2,'approval',$3,$4,$5,'high','open','Principal','principal','Transport §3.1',...)
     RETURNING *`, [...]);
  action = a.rows[0];
  await c.query(
    `INSERT INTO app.event_action_link (tenant_id, event_id, action_id, relation, policy_ref)
     VALUES ($1,$2,$3,'raised','Transport §3.1') ON CONFLICT DO NOTHING`, ...);
}
```

The action's title is `Notify 38 guardians — Bus 14 +13 min` (the count is real, from the roster).
Its `payload` contains a **pre-drafted** WhatsApp message:

> *"Bus 14 is running approximately 13 minutes late today. Expected delay at each stop accordingly.
> — Transport Desk"*

and the `proposed_by`/`proposed_by_role` of the person who ingested the ping. The action is linked to
the causing event through `app.event_action_link` with relation `raised` — the **lineage spine**.
The audit says `GPS position ingested` with outcome *"position recorded · approval-required notice
raised."*

Read that sequence again, because it is the whole product in miniature: a machine senses something,
the machine records it, the machine *drafts* the human response, and then the machine stops. The
principal decides. Only after approval does the executor resolve the **real guardian recipients**
and queue a communication. *The action being approved is not the same as the message being
delivered.* A queued message is not a delivered message. That sentence appears in the project's
own workflow guide and it is the spine of the delivery philosophy.

### 12.4 Reading positions, and the honest simulation

`GET /plugins/transport.gps/positions` enforces a **30-day retention** at read time:

```sql
WHERE ($1::text IS NULL OR route_code=$1) AND occurred_at > now() - interval '30 days'
  AND occurred_at > now() - ($2 || ' hours')::interval
```

Older rows are simply invisible (the retention worker is the one that physically moves them, and it
may not be scheduled). The `hours` window is clamped to a maximum of 720. The read also returns the
**latest position per route**. And when there are no positions at all, it returns a `simulated`
array — clearly labelled:

```js
note: `vendor-feed simulation — ${STREETS[i % STREETS.length]}`,
```

*"simulation seed on a quiet board — clearly labeled vendor-feed simulation."* This is the honesty
pattern the project uses everywhere: if there is no real data, do not pretend there is; show a
clearly-labelled sample so the screen is not a void, and let the school know it is not their fleet.

### 12.5 The honest flags around transport

- **No HMAC on ingestion.** GPS ingestion is a **staff-JWT** door. A raw-body parser exists in the
  codebase but is unused here, so there is no signature proving a device *is* a device. The project's
  risk register flags this: *"staff-JWT ingestion with no HMAC."*
- **`deviationM` is collected but compared to nothing.** No geofence logic reads it. A vehicle can
  wander 5 km off-route and the system records the deviation without reacting.
- **The delay threshold `10` is hardcoded twice**, and the setting that should override it is never
  read.
- **The UI's map and Bus 14 drill are the labelled sample.** Above them is a live band reading
  real routes/riders, and `/transport/setup` is the real write model. Below the fold, it is demo
  content with an honest note.
- **"GPS telemetry not connected yet"** is the honest UI copy where no vendor feed exists. Chapter
  1's story is consistent: `GET /positions` will show the labelled simulation until a real feed
  posts.

### 12.6 Why this chapter matters beyond buses

The transport story demonstrates the product's answer to "who decides?" A deterministic rule (delay
≥ 10) can *raise* a decision but cannot *make* a guardian-facing communication. The threshold is
data, the message is drafted, the recipients are resolved only after a human approves, and delivery
is a separate promise from approval. This is the pattern the project calls **action-required** and
it recurs in admissions offers, exam publication, clinic referrals, and fee changes. If there is one
sentence to remember from the transport chapter, it is:

> *A machine may notice. A human decides. A worker delivers. And the ledger records all three
> separately.*

<!-- END OF PART 12 -->

---

## Chapter 13 — The Gate: Releasing a Child to the Right Adult

### 13.1 The most safety-critical flow in the school

`ops.visitors` is class C and born enabled — the front desk is day-one infrastructure. But its
**pickup** flow is the most safety-critical thing in the entire product: releasing a child into the
care of an adult. The code treats it with the gravity it deserves, and its comment is a confession
of what used to be wrong.

The plugin's header says it plainly:

> *"pickup OTP rides the KERNEL PATTERN from 008: scrypt+salt hashed, short TTL, attempt-bounded,
> consumed-on-success, stored in `plugin_visitors.pickup_otp` under RLS that DENIES the app role
> (`USING (false)`) ... Release is FAIL-CLOSED: a pickup visit cannot complete without guardian
> verification (audited owner/principal override is the only bypass)."*

### 13.2 Logging a visitor

A parent arrives to meet a teacher (not a pickup). The desk logs:

```
POST /plugins/ops.visitors/visitors
{ "visitorName": "Rohit Shelar", "visitorPhone": "+91 90000 00000",
  "purpose": "pickup", "studentId": "<aarav-uuid>" }
```

Gated to `owner`, `principal`, `itadmin`, `coordinator`. The handler validates name and purpose,
verifies the student belongs to the tenant if a student was named, and inserts a visit with a
**badge code**:

```js
const badge = () => 'V-' + randomBytes(4).toString('hex').toUpperCase();
```

The badge is `V-` plus 32 random bits in hex. The event `visitor.logged.v1` fires and the audit
records `visitor logged`, outcome *"expected (pickup) · badge V-…"*.

### 13.3 The guardian lookup, and a masked phone

The desk needs to find the child's guardian. `GET /plugins/ops.visitors/guardian-lookup`, by id,
admission number, or name. Three details:

1. **The name search escapes ILIKE wildcards** — *"q is a substring, not a pattern"* — so a user
   typing `%` cannot turn a search into a wildcard scan.
2. `studentId` is UUID-validated, because the older code compared it raw and `?studentId=abc` was a
   22P02 → 500.
3. **The phone is masked to the desk tier.** The query returns only the last four digits
   (`phone_tail`), and `phoneOnFile` is a boolean. Full numbers ride only the OTP vault path. A desk
   does not need the full number to verify a pickup; it needs to know one exists.

### 13.4 Requesting pickup: mint, normalise, deliver — in that order

`POST /visitors/:id/pickup` is where the safety engineering concentrates. Let me walk it in order,
because the *ordering* is the point.

**Status gate.** The visit must be `expected` or `checked_in`; and it must have a `student_ref`:
*"pickup flow requires a student link (log the visit with studentId)."*

**Guardian on file.** Read the primary guardian's phone. If none: *"No guardian phone on file —
verify with photo ID at the desk."*

**Normalise BEFORE minting.** This is a fix whose comment is worth quoting:

> *"The stored number is whatever the school office typed — the seed itself keeps `+91 9720000243`,
> with a space, which the rail refuses. Normalise BEFORE minting anything, or a configured channel
> still delivers nothing. ORDERING IS THE POINT ... on the refusal below the handler returns a reply
> rather than throwing, so `withUser` COMMITS. Normalising later left the visit flipped to
> `pickup_pending` with a live `otp_request_id` and an unconsumed vault row — precisely the dangling
> state the undeliverable branch exists to prevent, reached by a different door."*

So the canonical number is computed first; an unusable number is refused **before any write**. This
is a masterclass in transaction-aware refusal ordering.

**Mint a CSPRNG code.** `randomInt(100000, 1000000)` — a six-digit code from a cryptographic source,
not `Math.random`. The code is scrypt-hashed with a random salt and stored in the plugin's own
vault:

```js
const otp = await sysq(
  `INSERT INTO plugin_visitors.pickup_otp (tenant_id, visit_id, phone, code_hash, expires_at)
   VALUES ($1,$2,$3,$4, now() + make_interval(mins => $5)) RETURNING id`, ...);
```

The vault is written on the **owner path** (`sysq`) because the table's RLS **denies the app role
entirely** (`USING (false)`). But the comment carries a critical warning about *which* vault:

> *"T102 (P0-1): pickup codes live in THIS plugin's vault (`plugin_visitors.pickup_otp`, 024 — RLS
> denies the app role, owner-path write only). They must NEVER ride `app.auth_otps`: a vault row
> there is a LOGIN OTP and a front-desk pickup code could be redeemed at `/auth/otp/verify` for a
> full guardian session."*

That is a real vulnerability that was closed: a pickup code must not be a login code. The visit is
flipped to `pickup_pending`.

**Deliver it — and tell the truth about delivery.** This is the emotional heart of the plugin. The
comment:

> *"Before this, the code was minted, scrypt-hashed and vaulted ... and handed to NOBODY. No rail
> call, no comms row, not even a queue entry existed, yet the event announced 'OTP sent to primary
> guardian' and the audit said 'OTP issued to primary guardian'. The desk believed a code was on its
> way and the guardian had nothing to read out. Because release is fail-closed, the practical effect
> was that every pickup degraded to the photo-ID override WHILE THE RECORD CLAIMED THE IDENTITY
> CHECK HAD HAPPENED — the worst place in the product for the ledger to lie."*

So now the SMS is sent **directly** (not queued), because a live single-use code must never sit in
`app.communications`, which is served with `SELECT *` to six roles. The ledger gets a **redacted**
body as delivery evidence:

```js
smsBody.replace(code, `${code.slice(0, 2)}…(redacted — the ledger is evidence, not the channel)`),
```

And the carrier-honesty rule is shared with the dispatcher and the reset door:

```js
const sandboxed = isSandboxResult(sms);
const undeliverable = !sms.ok || (sandboxed && !sandboxAllowed(config.env));
```

**On undeliverable, compensate fully:**

```js
if (undeliverable) {
  await sysq(`DELETE FROM plugin_visitors.pickup_otp WHERE id=$1`, [otp.rows[0].id]);
  await c.query(`UPDATE plugin_visitors.visit SET status=$1, otp_request_id=NULL, updated_at=now() WHERE id=$2`, [v.status, v.id]);
  await requestAudit(c, ..., { action: 'pickup OTP delivery failed', risk: 'medium', outcome: `no code reached the primary guardian ... vault row withdrawn and visit returned to "${v.status}" ...` });
  return bad(reply, `The pickup code could not be sent to the guardian (...). Verify with photo ID at the desk, or fix the SMS channel and try again.`, 503);
}
```

The code is **withdrawn**, the visit is returned to its prior status, and a 503 tells the desk the
truth: *go to the audited photo-ID override, because that is what you are actually relying on.* A
live OTP nobody holds is worse than none.

On success, the event and audit are precise about the carrier and the sandbox state, including the
phrase *"[SANDBOX: no provider is configured, so only a log line exists — nothing left the
building]"*. A dev echo of the code is returned only under `OTP_DEV_ECHO` (the production-forbidden
flag).

### 13.5 Verifying the code: a rejected code is a high-risk event

`POST /visitors/:id/pickup/verify` reads the vault row **on the owner path**, checks consumed, TTL,
and attempts, then compares with `timingSafeEqual` (constant-time):

```js
const ok = (() => { try { return timingSafeEqual(scryptSync(String(code), salt, 64), Buffer.from(hash, 'hex')); } catch { return false; } })();
```

On a wrong code, the handler increments **both** the vault attempt counter and the visit's
`otp_attempts`, and — crucially — **audits every rejection at `risk: 'high'`**. The comment explains:

> *"A rejected guardian-pickup code is an attempted release of a child to someone who could not prove
> they were authorised. ... Audited on every rejection rather than only at the attempt ceiling,
> because 'it hit the ceiling' is not the question anyone asks — 'who was at the gate trying codes'
> is."*

On success the code is consumed (`consumed_at = now()`, owner path, guarded so it consumes once), the
visit becomes `verified`, and the event `visitor.pickup.verified.v1` fires with a medium-risk audit
*"guardian OTP verified — student release authorized."*

### 13.6 Completion: fail-closed, with one audited override

`POST /visitors/:id/complete`. For a pickup visit that has a student link and is **not verified**, the
door is closed:

```js
if (unverifiedPickup) {
  if (!override || !['owner', 'principal'].includes(req.user.role)) {
    return bad(reply, 'student release is BLOCKED: pickup not guardian-verified (owner/principal override with note required)', 409);
  }
  if (!note) return bad(reply, 'override requires a note', 400);
}
```

The **only** bypass is an owner or principal override **with a mandatory note**, and it is audited at
`risk: 'high'` with the outcome `UNVERIFIED RELEASE OVERRIDE by <role>: <note>` and the event flag
`override: true`. Chapter 13's whole argument reduces to this: the system would rather stop a child
at the gate and force a human to write down why they are overriding, than let an unverified release
pass quietly.

### 13.7 The honest flags around visitors

- **The `pickup_otp_max_attempts` setting is now read** — the project's September list of "six
  declared settings never read" includes it, but the current `maxAttempts` helper does read it. So
  that line is stale; the story follows the code.
- **`apiVisitorVerify` uses a bespoke raw fetch** in the SPA that skips the shared 401-redirect and
  CSRF handling. It is the one front-desk call that does not walk the standard corridor. Under a
  cookie deployment it would fail; under bearer it works. A known defect.
- **The dev echo prints the pickup code on-screen** when `OTP_DEV_ECHO` is armed — never in
  production, but worth knowing for anyone running the demo.
- **Pickup OTPs surface in-app or via dev echo when no SMS rail is configured**; the visitor plugin
  now sends through the rail directly, but a school without SMS credentials gets the sandbox path
  and the honest 503.

### 13.8 What the gate teaches

The visitors plugin contains the product's best safety engineering: a secret in a dedicated vault
that RLS denies to the request role, CSPRNG generation, scrypt hashing, constant-time comparison,
single-use consumption, fatal handling of undeliverable codes, fail-closed release, an audited
override with a required note, and a high-risk audit on every rejected attempt. If a regulator or a
parent asked *"can this system protect a child at the gate?"*, this is the chapter to hand them.

<!-- END OF PART 13 -->

---

## Chapter 14 — Maintenance: The Bus That Pings and the Bus That Needs a Hose

### 14.1 Assets

`GET /assets` lists the tenant's asset inventory. The gate is a role list
(`owner, principal, itadmin, finance, finance_head, finance_clerk, coordinator, facilities,
technician, transport`), and the comment records the fix: *"RTE-11: the tenant-wide asset inventory
was readable by every role; work-order mutations are staff-gated."* So the asset register is a staff
surface.

Green Valley's realistic assets include the buses, the RO unit, the lab equipment, the generators,
and the building fittings. An asset has a `code` and a `name`; work orders can reference one.

### 14.2 A work order is born with a deadline

A teacher notices a leaking tap in the Grade 3 corridor and reports it:

```
POST /work-orders
{ "title": "Leaking tap — Grade 3 corridor", "category": "plumbing", "priority": "medium" }
```

Gated to `teacher`, `facilities`, `technician`, `coordinator`, `principal`, `owner` — note that a
**teacher can report**, which is correct: the person who sees a problem should be able to log it.

The handler validates the priority against a policy table, and the policy is the interesting part:

```js
const SLA_POLICY = {
  emergency: { responseMins: 10, resolveHours: 4 },
  critical:  { responseMins: 30, resolveHours: 24 },
  high:      { responseMins: 60, resolveHours: 72 },
  medium:    { responseMins: 240, resolveHours: 120 },
  low:       { responseMins: 480, resolveHours: 168 },
};
```

A priority is not a label; it is a **contract**. Choosing `medium` commits the school to resolving
within 120 hours. The work order is inserted with `status='reported'` and
`sla_due_at = now() + 120h`. A `wo_events` row records the creation and the SLA. An event fires,
with severity scaled by priority (`emergency` → `critical`). The audit says *"SLA due in 120h."*

### 14.3 The state machine

Work orders move through a fixed flow:

```js
const WO_FLOW = ['reported','assigned','accepted','en-route','on-site','repairing','verification','resolved','closed','cancelled'];
```

`POST /work-orders/:id/status` locks the row and enforces **exactly the next step**:

```js
const fromIdx = WO_FLOW.indexOf(w.status), toIdx = WO_FLOW.indexOf(to);
if (toIdx !== fromIdx + 1 && !(w.status === 'reported' && to === 'cancelled')) {
  return bad(reply, `invalid transition ${w.status} → ${to} (state machine)`, 409);
}
```

A job cannot jump from `reported` to `resolved`. It must be assigned, accepted, dispatched,
arrived, worked, verified. The only exception is that a freshly reported job may be **cancelled**
(and only from `reported`). This is a deliberate process discipline: a school cannot claim to have
"resolved" a repair nobody was ever assigned. The client's `canTransition` mirrors the server
exactly, so the buttons shown match the moves allowed.

The update stamps `resolved_at` when resolved/closed, and — a small but important accounting detail
— stamps `sla_breached`:

```sql
sla_breached = CASE WHEN $2='resolved' AND sla_due_at IS NOT NULL AND now() > sla_due_at THEN true ELSE sla_breached END
```

The breach is computed **at the moment of resolution**, from the deadline that was set at creation.
A `wo_events` row records `reported → assigned`, and so on: the work order carries its own
append-style history. A resolved order emits an audit at risk low with the outcome *"SLA met"* or
*"SLA BREACHED."*

### 14.4 The honest state of maintenance

The project's audit calls the **WorkOrderDetail** screen *"the best-built"* in the maintenance
family: a full ten-state machine, live buttons calling the real door, and a `canTransition` that
matches the server. But the honesty flags are plentiful and specific:

- **WorkOrderDetail fetches a 200-row list to `.find()` one work order**, because there is **no
  `GET /work-orders/:id` door**. On a busy desk that is wasteful, and it is on the project's block
  list as a missing door.
- **`TechnicianWorkspace` has live transitions but no client role check.** The buttons render for
  anyone; the server refuses after the click. A technician sees an error rather than an absent
  button.
- **The demo "Voice completion" is a timer plus a canned transcript.** There is no microphone
  anywhere in the product — the voice receptionist was removed from scope by owner decision (D-25).
- **`ReportIssue` has no demo/live split at all** and always calls the mock; its "photo" is a
  hardcoded filename, and two timers are never cleared.
- **`Preventive`, `MaintIntelligence`, `MaintInventory`, `MaintMap`, `MaintVendors`,
  `Inspections` are honest `Empty` stubs in live mode** ("Not connected yet"), though `/assets` and
  `/work-orders` exist and could power the map.
- **The QR is fake.** `QRPattern` is a decorative hash grid that encodes nothing. "Scan QR" does not
  scan anything.
- **The Board view drops resolved/closed/cancelled jobs entirely**, so the board is a queue, not an
  archive.
- **Two maintenance routes are orphans** — inventory and vendors have no nav and no link.
- **The SLA percentage counts cancelled work orders as met**, which flatters the number.

So maintenance is the clearest example of the product's widest demo-versus-live spread: a genuinely
good core (work orders, SLA, state machine, assets) surrounded by a large amount of convincing
theatre. The story names both, side by side, because a reader deserves to know which is which.

---

## Chapter 15 — Cases: One Queue for Every Voice

### 15.1 A case is a complaint, a request, or an incident

The `app.cases` table is the school's unified intake. A case has a `kind`, a `title`, a `detail`, a
`priority` (`critical`, `high`, `normal`, `low`), an `owner`, an `origin`, an SLA deadline, and
linked references. Every escalation in the product that is not an approval tends to become a case
or an action.

### 15.2 Filing a case — and why the fields are derived, not trusted

Any signed-in role may file. A parent, Kavita, is unhappy about a repeated bus delay and files:

```
POST /cases
{ "kind": "transport", "title": "Bus 14 late three days running",
  "detail": "Tuesday, Wednesday and Thursday the bus was over 20 minutes late." }
```

The handler is open to every role by design — and its comment dismantles a plausible-looking audit
recommendation:

> *"SEC-4 — DELIBERATELY NOT THE REGISTER'S RECOMMENDATION ... The audit says to gate this door on
> STAFF_CASE_ROLES and force origin 'staff'. That would break a deliberate, TESTED product
> behaviour: this door is how a parent files a complaint, and
> `tests/cases-privacy.test.js` ('parent files a complaint (bullying scenario)') asserts a 200
> carrying origin 'parent'. ... The actual defect is not WHO may open a case but WHICH FIELDS the
> caller controls."*

That is a mature distinction. The fix was to derive the privileged fields:

```js
const isStaff = STAFF_CASE_ROLES.has(req.user.role);
if (!isStaff && b.priority === 'critical') {
  return bad(reply, 'critical severity is set by staff triage — file it as high and the office will escalate', 403);
}
const maxSla = isStaff ? CASE_MAX_SLA_HOURS : CASE_MAX_SLA_HOURS_REPORTER;
const slaHours = b.slaHours === undefined ? 48 : Number(b.slaHours);
if (!Number.isFinite(slaHours) || slaHours <= 0 || slaHours > maxSla) {
  return bad(reply, `slaHours must be a positive number of hours (max ${maxSla})`);
}
const origin = isStaff ? 'staff' : (req.user.role === 'student' ? 'student' : 'parent');
const owner  = isStaff ? (b.owner ?? 'Coordinator') : 'Coordinator';
```

Four fields a caller used to control are now **derived from the caller's role**:

- **`origin`** — a parent could label their report `staff` or `system`, misattributing its source.
- **`owner`** — a parent could assign the case to any staff member by name.
- **`priority`** — a parent could self-declare `critical` and jump the board. (The office triages
  severity; a parent files `high` and the office escalates.)
- **`slaHours`** — a parent could set an SLA so long the case would never escalate. Staff may commit
  to a year; a family's report is capped at one week, after which the office owns it.

An idempotency key makes filing safe to retry. Then the insert, the event (`Case opened`), and the
audit:

```
action:  Opened case
outcome: origin parent · owner Coordinator · SLA 48h
```

That audit outcome is exactly what a school needs to reconstruct who said what and who owned it.

### 15.3 Reading cases

- `GET /cases` is staff-only: the full school log. The comment is explicit: *"The full school case
  log is staff-only. Parents can see their own complaints at /my-cases."*
- `GET /cases/:id` lets staff read any case; a guardian may read **only the case they filed**
  (`row.opened_by !== req.user.id` → 403). Same structural rule as every other parent read.
- `GET /my-cases` is scoped to `opened_by = $userId`.
- `POST /cases/:id/status` is staff-only and moves among
  `open, triaged, in-progress, resolved, closed`.

The board is now a **live screen**: it reads `GET /cases`, opens with `POST /cases`, moves with
`POST /cases/:id/status`, takes deadlines from the server's own `sla_due_at`, and its drawer
honestly says what the model does **not** hold — there is no message thread on the server, so the
"average first response" figure is shown as *not recorded* rather than invented. That last detail is
the product's character in a sentence: when it cannot compute a number, it says so.

### 15.4 Cases versus actions

A **case** is a human problem in progress: a complaint, mainly for staff triage.
An **action** is a decision the school must make: an approval, an incident, an exception.

They are related but distinct, and the story will explain the action spine next because it is where
the product's governance is strongest. One thing to note here: an SLA **worker** exists to escalate
stale cases and actions (`GET /actions/stale`, `POST /actions/stale/escalate`), raising digest
notices to owners and principals. And once again — the worker that would run automatically is one
of the unscheduled six (Chapter 1). A school can escalate manually through the door; the automatic
sweep does not run by default.

<!-- END OF PART 14-15 -->

---

## Chapter 16 — The Action Spine: Who Decides, and Why You Cannot Decide Alone

### 16.1 One table for every escalation

If you read only one table in SchoolOS to understand its governance, read `app.actions`. Its own
description in the project map is precise: *"the spine: kind approval/incident/exception/
recommendation/reminder, owner_role, policy_ref, ai_involved, UNIQUE(tenant,code) — every plugin
escalation in the system is one row here."*

When transport sees a 13-minute delay, it raises an action. When admissions accepts an offer, it
raises an action. When a teacher files a concern that needs the principal, it becomes an action.
When an exam is ready to publish, it raises an action. When the clinic wants to tell a guardian a
child was sent home, it raises an action. The action table is where the product refuses to let a
machine or a junior role act alone.

An action row carries: a `code` (unique per tenant), a `kind`, a human `title`, a `detail`, a
`why`, a `priority`, a `status` (`open`/`approved`/`dismissed`), an `owner` and `owner_role` (who
must decide), a `policy_ref`, an `ai_involved` boolean, a `source_event`, a JSONB `payload`, and a
`source_plugin`. The `payload` is where the raise site encodes machine-readable facts — including
`proposed_by`, who raised it.

### 16.2 The decide door: a lattice of refusals

`POST /actions/:id/decide` takes `{ decision: 'approved' | 'dismissed', note }`. It is gated to ten
staff roles, but the gate is only the beginning. The handler is a carefully-ordered set of
refusals, each of which repairs a real incident.

**1. Format guard.** A non-UUID `:id` returns a 400, not a raw `22P02` 500.

**2. Lock and state.** The action is locked `FOR UPDATE`; a non-open action returns 409.

**3. The coordinator-desk principal stamp.** A principal may not *approve* a coordinator-owned
action:

```js
const coordDeskPrincipalStamp = decision === 'approved' && req.user.role === 'principal' && a.owner_role === 'coordinator';
if (coordDeskPrincipalStamp) {
  return bad(reply, 'Segregation of duties — ask the owner to decide this', 403);
}
```

Coordinators raise staff-leave and similar day-to-day actions. The principal is *above* the
coordinator in the hierarchy, so a naive role check would let the principal approve them — but that
would let the principal rubber-stamp the coordinator desk's own work. The fix is to route it to the
**owner**, an authority with no line-management stake.

**4. The owner-authority lattice.** This is the corrected boolean, and its comment records a
precedence bug:

```js
// RTE-12: `&&` binds tighter than `||`, so the old expression was
// `ownRole || (isOwnerOrPrincipal && owner !== finance)` — which excluded the OWNER from deciding
// finance-owned actions, contradicting the adjacent comment.
const FINANCE_TIER = ['finance', 'finance_head', 'finance_clerk'];
let ownerOk = a.owner_role === req.user.role
  || req.user.role === 'owner'
  || (req.user.role === 'principal' && !FINANCE_TIER.includes(a.owner_role) && a.owner_role !== 'owner');
```

Translated: you may decide if you are the owning role, **or** you are the owner (unconditional
override), **or** you are the principal deciding a non-finance, non-owner action. The principal's
broad authority deliberately excludes the finance tier (the principal must not rubber-stamp the
finance desk) and excludes owner-owned actions (those are the owner's alone). The finance exclusion
is the whole **tier**, not the literal string `finance`, because the reconciliation desk raises
`owner_role='finance_head'`.

**5. Delegation.** If not `ownerOk`, the handler checks for an active, bounded delegation:

```js
const d = (await c.query(
  `SELECT id, from_role, to_role, scope_role FROM app.action_delegations
    WHERE tenant_id=$1 AND to_user_id=$2 AND starts_at <= now() AND ends_at > now()
      AND (scope_role IS NULL OR scope_role = $3) AND from_role = $3
    ORDER BY ends_at DESC LIMIT 1`, ...)).rows[0];
if (d && !FINANCE_TIER.includes(a.owner_role) && a.owner_role !== 'owner') { ownerOk = true; delegated = d; }
```

A role can hand its approval authority to a named deputy for a window (vacation cover). Delegation
is deliberately **narrower** than the role: it never confers the owner override and never applies to
finance-owned actions. And the delegation *creation* door refuses to delegate owner or finance
authority **at all**:

```js
const FINANCE_TIER = ['finance', 'finance_head', 'finance_clerk'];
if (fromRole === 'owner' || FINANCE_TIER.includes(fromRole) || FINANCE_TIER.includes(scopeRole))
  return bad(reply, 'owner and finance approval authority cannot be delegated (segregation of duties)', 403);
if (toRole === 'owner' || FINANCE_TIER.includes(toRole))
  return bad(reply, 'approval authority cannot be delegated to an owner or finance role ...', 403);
```

So the two desks where maker/checker matters most — money and ownership — can never be delegated
away.

**6. The self-approval guard.** The handler fetches `proposed_by` from the payload and handles the
unattributed case:

```js
const proposedBy = a.payload && typeof a.payload === 'object' ? (a.payload.proposed_by ?? null) : null;
const systemRaised = a.payload && typeof a.payload === 'object' && a.payload.raised_by_system === true;
const unattributed = proposedBy == null && !systemRaised;
if (decision === 'approved' && unattributed && req.user.role === a.owner_role && req.user.role !== 'owner') {
  return bad(reply, 'Segregation of duties — this proposal was raised without an attributable proposer, so the owning desk cannot approve it. Ask the school owner to decide.', 403);
}
if (a.owner_role !== 'owner' && a.payload?.proposed_by === req.user.id && decision === 'approved')
  return bad(reply, 'self-approval is not permitted (segregation of duties)', 403);
```

Read the nuance: **dismissal is always allowed** to the owning authority — rejecting is not
self-dealing. The owner is exempt from the proposer rule because there is no authority above the
owner to propose to them. And an **unattributed** raise (no named proposer, not a system raise)
cannot be approved by its own desk either — the owner is the backstop. Every human raise site
stamps `proposed_by`; a worker stamps `raised_by_system: true`. The unattributed case exists because
older raise sites did not, and the fix generalizes the guard to cover them.

### 16.3 Execution: what actually happens on approval

After the state update, the handler runs a set of **executors**:

```js
for (const ex of EXECUTORS) {
  if (ex.when(a, p, decision)) {
    const r = await ex.run(c, req, a, p, decision, note);
    if (r !== undefined) execution = r;
  }
}
```

Two executor behaviours matter enormously:

- **A `kind:'message'` action QUEUES a communication; it never claims delivery.** Approving a
  guardian notice inserts a queued `app.communications` row with resolved recipients. The audit
  outcome says `executed: message <id>`; it does **not** say "delivered". The project map calls this
  out: *"`kind:'message'` QUEUES never claims delivery."* This is the single most important honesty
  rule in the action spine.
- **`students.create.*` runs the admissions executor.** When a principal approves an admission
  offer acceptance, the executor creates the actual `app.students` row and enrollment history. The
  funnel never wrote core student records; the approval does.

> **Honest flag — the notice resolver's history.** The comment for the executor records a serious
> past failure: the decide executor used to insert the *human audience label* ("guardians") as the
> audience and stamp the row `status='delivered'` with `sent_at`/`delivered_at = now()`, emitting
> "Parent notice SENT" — *"while nothing was sent and nothing could be: `comms-dispatcher.js`
> resolves recipients from phone numbers, and a label is not one."* `delivered` is the strongest
> claim the schema makes, and the dispatcher itself only ever sets `sent_at`. The fix resolves
> recipients from machine-readable identifiers and makes an unaddressable notice **say so** rather
> than be recorded as delivered. The comment also refuses to resolve the bare word "guardians" to
> everyone: *"a clinic notice reads 'was sent home', so tenant-wide fan-out would tell every parent
> about one child. A label is not a selector."*

### 16.4 Lineage: the savepoint that keeps the spine from aborting

On the decide path, the handler links the decision event to the action:

```js
try {
  await c.query('SAVEPOINT lineage');
  const decisionEvent = await emitEvent(c, ..., { type: 'governance', label: `Action ${decision}: ${a.title}`, ref: a.code },
    'action.decided.v1', { actionId: a.id, code: a.code, decision, ownerRole: a.owner_role, delegated: delegated?.id ?? null });
  await linkLineage(c, req.user.tenant_id, { eventId: decisionEvent.id, actionId: a.id, relation: 'resolved', policyRef: a.policy_ref });
  await c.query('RELEASE SAVEPOINT lineage');
} catch {
  await c.query('ROLLBACK TO SAVEPOINT lineage').catch(() => {});
}
```

The comment explains the `SAVEPOINT`: *"without this the lineage spine went sparse the moment a
decision happened. Best-effort via a SAVEPOINT so a lineage failure can never abort the decision
transaction (a bare try/catch left it aborted → 25P02)."* In Postgres, a caught error still poisons
the transaction unless you roll back to a savepoint. This is a subtle and correct pattern.

Then the master audit:

```
action:  Approved action: <title> (delegated)?
policy:  <a.policy_ref>
ai:      <a.ai_involved>
outcome: executed: message <id> | executed: task <id> | no execution
```

### 16.5 The Action Center screen

`ActionCenter` is a genuinely live screen: it reads `GET /actions` and calls
`POST /actions/:id/decide` with optimistic removal and restore-on-failure. Its composer tells the
author **who approves** rather than offering a button that can only fail — a direct response to the
self-approval rule. The screens and the server agree here, which is more than can be said for the
money UI.

### 16.6 Why the action spine is the product's best idea

Most school software lets anyone with a login do anything their role can reach, and leaves
governance to policy documents. SchoolOS makes governance a **data structure with refusals**:
approval required, owning authority, no self-approval, finance and ownership non-delegable, owner as
unconditional override, dismissal always available to reject, machines may raise but not decide,
decisions are delegated explicitly and stamped as such, and every decision writes lineage and a
medium-risk audit row.

If the library is the reference for *data modelling*, and visitors is the reference for *safety*,
the action spine is the reference for *governance*. Together those three chapters are the strongest
answer to the question "why does this product exist?".

<!-- END OF PART 16 -->

---

## Chapter 17 — People When They Are Unwell: HR Leave and the Infirmary

### 17.1 HR leave: an absence is a fact, not a request

Most school software models staff leave as a *request*: submit, approve, reject. SchoolOS's
`hr.leave` plugin models it differently, and the difference is deliberate.

`POST /plugins/hr.leave/leave` records **one row per staff-day**. The rules:

- a **past date** is refused, measured against **IST today** (the school's clock, not the server's
  UTC);
- a duplicate staff-day produces a **friendly 409** via a `SAVEPOINT` (not a raw constraint error);
- the write is audited and emits an event.

There is **no approval flow and no balance table**. If the school wants an approval, the leave
becomes a kernel **action** owned by the coordinator (Chapter 16's spine). The plugin's job is to
record the *fact* that a person is absent. A cancellation keeps the row and marks it cancelled —
never deletes. The roster door (`GET /roster/:date`) computes the staff roster as
**absent × on-duty**.

The project map notes a declared integration that nobody uses: `ops.timetable` declares an
`absence_feed` contract, and the project records that it *"is read by nothing."* So marking an
absence updates the HR record but does not automatically mark that teacher's periods for
substitution. The automatic link is designed but unwired.

The screen (`/operations/hr`) was rebuilt around this model — *"an absence is a FACT that reaches
the timetable, not a request with approve/reject buttons the server does not model."* The UI now
matches the server instead of inventing a workflow.

### 17.2 The infirmary: append-first, notices approval-gated

`health.clinic` is the infirmary log. Its header states its three principles:

> *"Visits are append-first: corrections append a new row, the log is never rewritten.
> sent_home / hospital_referral outcomes raise a per-instance kernel approval action ... Guardian
> notice is an APPROVED communication, never a plugin-direct send. PII tiering: health history is
> nurse-lane — no teacher/finance/parent read."*

**Logging a visit.** `POST /visits` is gated to `owner, principal, itadmin, coordinator` (the nurse
lane). It validates the student reference (UUID), a complaint, an outcome in
`rest | first_aid | sent_home | hospital_referral`, and a realistic temperature (30–45°C). The visit
is inserted; an event `clinic.visit.logged.v1` fires; and if the outcome is severe, a guardian
notice action is raised. The audit's risk is `high` for a hospital referral, `medium` otherwise,
under policy *"Health · DPDP Act 2023 (health PII)."*

**Correction appends.** `POST /visits/:id/correct` **never rewrites the original**. It inserts a new
visit row whose notes begin `CORRECTION of <id>:`. And — the duty-of-care escalation — if a
correction *escalates* the outcome to a severe class, it **re-fires the guardian notice**:

```js
const SEVERE = ['sent_home', 'hospital_referral'];
let noticeActionId = null;
if (action !== orig.action && SEVERE.includes(action)) {
  noticeActionId = await raiseGuardianNotice(c, ...);
}
```

A nurse who first logged "rest" and later realises the child worsened cannot edit history; she
appends a correction, and the system notices that the corrected fact requires a guardian to be
told — and raises the approval.

**Sick pass.** `POST /visits/:id/sick-pass` issues a class-release authorization with a real
`valid_until` epoch, TTL clamped to 8 hours by default (max 48), and refuses a second active pass
for the same visit. The only mutation is **revoke** (`sick-passes/:id/revoke`, office lane): a pass
is otherwise immutable. The comment fixes a time bug: *"S0 fix H8: instant stays real-epoch (IST
math is for date strings only)."*

**Guardian notices: approval-gated.** `raiseGuardianNotice` refuses for non-severe actions, checks
the settings flags (`notify_on_sent_home`, `notify_on_referral`, which can disable the path), and
raises a per-instance kernel approval action with `code = clinic.notify.<visitId>` — unique per
visit — owned by the **principal**, with a pre-drafted message and `kind: 'message'`. It is executed
by the kernel decide handler onto the comms rail. The plugin **never sends directly**. The comment
states the contract: *"Guardian notice is an APPROVED communication, never a plugin-direct send
(Comms §1.2)."*

**Read is nurse-lane PII.** `GET /visits` is gated to the same four roles. No teacher, finance,
parent, or student may read a child's clinic history. The screen `/clinic` asks that question before
it calls anything. The revoke door stays API-only because the read carries no pass state, so there
is nothing for the UI to act on.

### 17.3 What these two domains show together

HR and clinic are small, but together they demonstrate two of the product's core values:

1. **Record the fact; route the decision.** An absence is a fact. A guardian notice about a health
   event is a decision that needs approval. The plugins record facts and raise actions; the spine
   decides.
2. **Never rewrite medical history.** Corrections append. A record that can be silently edited is
   not evidence. The clinic log is designed like a medical chart, not a form.

---

## Chapter 18 — Messages: Queued Is Not Sent, and Sent Is Not Delivered

### 18.1 The three-word honesty rule

The project's workflow guide states it exactly:

> *"`queued` means the system accepted work. It does not mean a carrier accepted it.
> Sandbox/logger mode must not be presented as a real delivery."*

And:

> *"`queued` is not the same as `sent`, and `sent` is not necessarily `delivered` by the carrier."*

The entire communications domain is built to keep those three states separate, and the story will
treat a system that blurs them as broken.

### 18.2 `app.communications`: a status machine

A communication row carries a `tenant_id`, an `audience_kind` and `audience_json` (the resolved
recipients), a `channel`, a `template`, a `body`, a `status`, an optional `policy_ref`, a
`dedup_key`, `provider`/`provider_ref`, `attempts`/`last_error`/`next_attempt_at`, and
`sent_at`/`delivered_at`. The status machine includes at least:

```
queued → claimed → sent → delivered
                 ↘ failed
                 ↘ undeliverable
```

The **`dedup_key`** is the safety rail: a unique index on it (with a partial predicate) means a
retried write cannot enqueue the same message twice. You saw it in fees (`receipt:<paymentId>`),
visitors (`pickup:<otpId>`), and absence notices (a random UUID per notice).

### 18.3 The dispatcher: the only thing that talks to a carrier

`comms-dispatcher.js` is a standalone worker that drains the queue. It:

- claims `status='queued'` rows with `FOR UPDATE SKIP LOCKED` so multiple dispatchers do not
  collide;
- resolves the channel to a rail (`sms → rails.sms`, `whatsapp → rails.whatsapp`, anything else →
  log-only);
- stamps `sent` + `sent_at` **on success**;
- on failure, increments `attempts`, records `last_error`, and sets `next_attempt_at` with
  exponential backoff, **parking after eight attempts** as `failed`;
- refuses (rather than truncates) an audience over `COMMS_MAX_RECIPIENTS` (500) — *"a school with a
  bad audience is told, not silently under-served"*;
- has a **fourth outcome, `undeliverable`**, for the case where a sandbox send meets a production
  environment. A sandboxed send is *never* labelled delivered.

### 18.4 The rails: provider adapters with a dangerous default

A **rail** is a plugin whose whole job is to talk to a provider. Three credential rails exist:

- `rails.sms` — `logger` (default) and `http-generic`.
- `rails.whatsapp` — `logger`, `http-generic`, and **Meta Cloud API**, with a DLT template renderer
  that reads the `comms.whatsapp` plugin's template registry.
- `rails.email` — `logger` and `smtp` (hand-rolled SMTP over `node:net`/`tls`, STARTTLS,
  `AUTH LOGIN`, dot-stuffing).

All three enforce **E.164** recipients and require a **`dedupKey`**. The real dedup lives in
`app.communications.dedup_key`, so the rails participate in the same safety rail.

And here is the dangerous default the project is honest about:

> *"All three return `ok:true, provider:'logger'` when credentials missing **and when the settings
> read fails** — delivery honesty is enforced by callers (dispatcher/kernel), not by the rails."*

So a rail is *not* the honesty boundary. The **caller** must interpret a `logger` result as
sandbox. The shared helpers `isSandboxResult` and `sandboxAllowed` (used by the dispatcher and the
visitors pickup door) are how that interpretation is centralized. The project lists as a residual
that `rails.sms` and `rails.whatsapp` never set a `sandbox` flag themselves, so the caller must know
to ask.

`comms.whatsapp` is a separate plugin — a **DLT template registry** (non-clobbering JSONB merge)
plus a read-only receipts surface over `app.communications`. It has **no send door**; intents from
the orchestrator and other plugins send. Its `/receipts` read has no explicit tenant predicate
(RLS-only), flagged in the project's risk list.

### 18.5 The path of one approved notice, end to end

Recall the transport delay from Chapter 12 and the clinic referral from Chapter 17. Here is what
happens after a principal approves:

1. `POST /actions/:id/decide` runs. The `kind:'message'` executor resolves the **real recipients**
   from machine-readable identifiers (student ids, route codes, class) — never from a human label.
2. It inserts an `app.communications` row with `status='queued'`, the resolved phone array, a
   `template` (`TRANSPORT_DELAY`, `CLINIC_SENT_HOME`, `FEE_RECEIPT`, `ABSENCE_NOTICE`, …), a
   `policy_ref`, and a `dedup_key`.
3. The API returns. The approval is recorded. **Nothing has been sent yet.**
4. Later (when scheduled), the dispatcher claims the row, resolves the rail, and calls the provider.
5. The provider returns. The row becomes `sent` (carrier accepted) — and only a real carrier can
   ever set `delivered_at`.
6. If the provider fails or the environment is sandbox-in-production, the row becomes `failed` or
   `undeliverable`, with backoff and retries, and eventually parks.

Step 3 is the one users get wrong. A school leader who sees "approved" may believe a parent was
messaged. The system knows the difference. The audit says *"executed: message <id>"*, not
"SENT". Only the dispatcher and a real carrier can make a message `sent` or `delivered`.

### 18.6 In-app notifications

Separately, `app.notifications` holds in-app notices, keyed by a `user_id` (or NULL for a
broadcast). The read door is own-plus-broadcast; mark-read is own-only. The Shell's bell polls
`GET /notifications` every 45 seconds. School-wide items cannot be cleared by an individual,
because they do not belong to an individual. A `kind:'task'` action, when approved, writes a
notification to its assignee.

### 18.7 The honest flags around delivery

- **Queued ≠ sent ≠ delivered.** Stated, enforced, and the reason the dispatcher exists.
- **Sandbox honesty is by caller.** A rail can return `ok:true` with no provider; the dispatcher and
  the kernel compensate (the visitors pickup door compensates by withdrawing the code entirely).
- **`rails.email` can AUTH LOGIN in cleartext** if the server does not advertise STARTTLS, and has
  no `require_starttls`. The audit records this.
- **The dispatcher is scheduled by the shipped compose; the workflow, webhook, day, dunning, and
  reconcile workers are not.** So a queued message *will* drain, but a queued **rule** or **dunning
  run** may not fire. The difference is which worker.
- **`/receipts` on `comms.whatsapp` has no explicit tenant predicate** — contained by RLS today,
  flagged as "one policy bug from exposure."

<!-- END OF PART 17-18 -->

---

## Chapter 19 — The "AI-Native" Claim, Examined Honestly

### 19.1 What the marketing says, and what the code says

SchoolOS describes itself as *"the AI-native operating system for schools."* A reader is entitled to
ask what, precisely, is AI in it. The honest answer, which the code states about itself, is:

- there is **one** AI seam, the gateway (`_shared/ai-gateway.js`);
- **no shipped plugin calls it**;
- its only non-sandbox provider is **intentionally inert**;
- the features branded "copilot" and "assistant" are **deterministic templates** that contact no
  model at all;
- and the demo UI's "AI answers" are a keyword-regex fixture.

This chapter walks that claim line by line, because pretending otherwise would betray the whole
document.

### 19.2 The gateway: a real contract, unexercised

The gateway's own header is a confession:

> *"C10/H6 · STATUS (honest): no shipped plugin invokes this gateway today. The copilots
> (teacher.copilot, parent.assistant, coord.view) are DETERMINISTIC (no model); the only callers are
> the kernel's `/ai/call` and `/ai/eval`. The per-plugin `app.plugins.ai_budget` is therefore seeded
> but reserved — it becomes live the moment a plugin routes a call through `createAiGateway`."*

The contract has three parts.

**A ledger.** Every attempt writes a row to `app.ai_calls` with `outcome` one of `ok`, `error`, or
`budget`. Crucially, **no prompt or completion text is ever stored** — the ledger records cost and
failure, not content. (The project flags the residual: `app.ai_calls` has no retention and never
feeds the audit log.)

**Budgets, enforced before the provider runs.** There are two:

1. **Per-plugin monthly cap** (`app.plugins.ai_budget`). This was dead for a long time, and the
   fix (PLG-7) is a nice piece of archaeology: the gateway read key `calls`, the catalog wrote
   `requests_per_day`, and migrations wrote `calls_per_day` — so it was *always null*. The fix
   accepts all three spellings, enforces a positive cap against the plugin's own calls this calendar
   month, and makes `src/plugin-catalog.js` write the canonical `calls` key so read and write cannot
   drift. The comment also records that even a *matched* positive cap was never enforced — only `0`
   was. A numeric budget and `false`/`{"calls":0}` (AI disabled) are all handled.
2. **Per-tenant daily cap** (`tenants.config.ai.dailyCallCap`, default 200).

Budget refusals *do not consume budget* — a denied call is not counted as usage.

**Providers.** A pluggable adapter interface with two shipped:

- `logger` — the sandbox default: no credentials, a deterministic echo, token estimate by
  `length/4`.
- `openai-compatible` — the real-provider *shape*, which **intentionally returns `unconfigured`
  even with keys present**: *"provider openai-compatible is intentionally inert until the owner
  supplies live credentials (D-32 credentials-last)."* This is the "credentials-last" ruling: no
  real provider is wired until an owner deliberately supplies one.

An unknown provider returns a 503-class error and writes an error ledger row. `registerProvider`
exists but is unused.

### 19.3 The only callers, and the audit gap

The kernel exposes three doors:

- `POST /ai/call` — staff-only (a student is refused), rate-limited to 30/min. It calls
  `callAI({ tenantId, pluginId, purpose, input })`.
- `GET /ai/calls` — owner/itadmin read of the ledger.
- `POST /ai/eval` — 5/hr, runs a batch through `evalRun`.

Two honest flags:

- **`POST /ai/call` is the only mutating door that writes no audit row.** Every money move, every
  student record, every attendance mark is audited; an AI call is not. The project lists this as a
  data-layer risk.
- **`/ai/call` lets any staff role claim any `pluginId`.** Attribution is caller-trusted, so the
  ledger cannot prove which feature made a call.

`call()` also takes a bare string input — no temperature, model, messages, output validation, or
PII redaction. The header says plainly: *"Any real AI feature must extend this contract first."*

### 19.4 The deterministic copilots, which are more honest than they sound

The three branded "copilots" do not use the gateway, and they say so.

- **`teacher.copilot`** — a day-brief plus ask/draft, over a seeded curriculum tree with audited
  check-off, A3 mastery maps with **idempotent evidence decay** (the same decay applied twice does
  not double-apply), and a budget ledger (`copilot.call`) of 200/day. Its ask reuses the same
  `buildBrief()` function, so *ask can never read more than the brief*. Sibling-schema drift is
  probed via `information_schema`.
- **`parent.assistant`** — verbatim: *"NO external LLM is contacted anywhere in this module."* It
  produces a per-child brief (attendance/homework/exams/consents/reports/fees/requests), a
  keyword-ask that answers **only from the guardian's own children** with a `HONEST_UNKNOWN`
  constant when it cannot answer, template drafts, and plain-language explanations. It is
  double-enforced for guardian scoping, has a private monthly budget (100), and a banned-word tone
  filter.
- **`coord.view`** — a keyword-only copilot with a private capped ledger (200/month, IST).

These are not AI. They are carefully-written deterministic aggregation with honest limits, and the
server labels them as such. The problem is not the server.

### 19.5 Where the lying happens: the browser

The demo UI's "AI" is fiction. `aiService.ask` is a **keyword-regex fixture**: it matches patterns
like `/absen|fee|aarav|bus/` and returns hardcoded Meridian answers ("Aarav Sharma (8-B)", "82.3%",
"Bus 14") with the context object discarded. The microphone is a toast. `AiGovernance` and
`AiUsage` present **fixtures as telemetry** with zero controls.

So the product has an unusual inversion: the **server is honest** about being deterministic, and
the **client undercuts that honesty** by dressing fixtures as intelligence. The story names this
because it is the exact opposite of the money UI (where the client is dishonest about capability
while the server works). Both are trust problems; they point in opposite directions.

> **Aside — the voice receptionist.** The "AI Front Desk" screen is a beautifully-designed surface
> over mock data. There is **no telephony, voice, or ASR backend** in the repo (zero hits for
> twilio/asterisk/sip). The voice receptionist was removed from scope by owner ruling D-25. What is
> real beneath the front-desk screen is the `ops.visitors` gate desk, the comms rails, and the
> deliberately-empty AI gateway contract.

### 19.6 What an honest summary of "AI-native" would say

If SchoolOS wanted to be exactly as honest as its own code comments, it would say:

> "SchoolOS ships a governed AI *seam* — a ledger, budgets, and a provider interface — but no live
> model. Its copilots are deterministic and say so. The AI features become real when an owner
> supplies provider credentials and a plugin routes through the gateway. The demo's AI answers are a
> fixture."

That is a more modest and more trustworthy statement than "AI-native," and it is the one this book
adopts.

---

## Chapter 20 — Files: Bytes Are Not Metadata, and Metadata Is Not Permission

### 20.1 The plugin

`files.store` is born enabled (one of the four DEFAULT_ON) because handling documents is day-one
infrastructure. Its contract is careful:

- **Upload**: `POST /plugins/files.store/upload` (staff: `owner`, `principal`, `coordinator`,
  `teacher`, `itadmin`, `facilities`). JSON-base64 is the primary lane; multipart is accepted on the
  same door.
- **Download**: `GET /plugins/files.store/:id/download`.
- **List**: `GET /plugins/files.store?scope=&refId=`.

### 20.2 Upload: four independent controls

The header claims the 5 MB cap is *"enforced four ways."* The controls are:

1. **A size cap of 5 MiB** (and the multipart parser is capped at 8 MiB, leaving headroom).
2. **A MIME whitelist** (`pdf/png/jpeg/webp/csv/docx`) **with extension agreement** — a `.exe`
   dressed as a `.pdf` is refused 415. The product refuses to trust a declared content type alone.
3. **`sha256` over the exact bytes**, stored with the metadata.
4. **Server-side rename** and a `storage_path` that is **relative under `FILES_DIR`**, with path
   traversal rejected. The bytes live under `server/storage/<tenant_id>/` and are **never
   web-served** — downloads go only through the permission-checked door.

The metadata row lands in `app.files`, whose `INSERT` is permitted but whose `UPDATE` is **revoked
outright** (`077`): a file's metadata is append-only, because a file's identity should not change
after storage. The scope is `general | homework | student`, with an optional `ref_id`. Upload emits
`files.stored.v1` and writes an audit row **in the same transaction**.

### 20.3 Download: the interesting access rule

`GET /plugins/files.store/:id/download` has a nuanced authorization rule:

- the **uploader**, plus `owner`/`principal`/`itadmin`, may always download;
- for `scope = 'student'`, **that child's guardians** (via `family.child_link`) and the **student
  themself** (name-match pin) are admitted;
- everyone else gets **403 with an audited refusal** at risk `medium`;
- every successful download is audited at risk `low`;
- the response streams with `no-store`.

The header records the ordering that matters: **audit before response.** The verdict and the audit
row commit before the bytes or the 403 are sent. If the process died between the audit and the
stream, the ledger would still show the attempt. A file download is a piece of evidence, not just a
transfer.

### 20.4 List, and the honest gaps

`GET /plugins/files.store?scope=&refId=` returns **metadata only**, and non-admin staff are pinned
to their own uploads. Two honest flags:

- **No presigned URLs exist** (verified). Bytes are served by the API process, not a CDN or object
  store. For a single school that is fine; at scale it is a throughput limit.
- **The Documents screen's upload controls are non-functional in the SPA.** The `adminApi.files*`
  wrappers are **dead wrappers** while the `files.store` doors exist and work. This is a third
  instance of the same pattern: a finished server and an unfinished surface.
- Elsewhere, fields like homework `attachment_ref` remain **validated name/URL strings**, not files.
  The story has shown the scheme allowlist that makes those strings safe.

### 20.5 Why files matter beyond convenience

A school's files — report cards, receipts, certificates, clinic notes, incident photos — are
records. The design decision to keep **bytes private and metadata append-only**, to check
permission on every download, and to audit both the grant and the refusal, is what turns a
convenience feature into something a school can rely on in a dispute. A file that anyone with a URL
can fetch is not a record; it is a leak waiting to happen. `files.store` is the product at its
disciplined best.

<!-- END OF PART 19-20 -->

---

## Chapter 21 — The Ledger, the Memory, the Constitution, and the Gauges

### 21.1 The audit ledger: a book that cannot be torn

The story has referred to the audit ledger in almost every chapter. Here is how it actually works,
end to end.

**What a row holds.** The columns are: `tenant_id`, `actor`, `actor_role`, `action`, `record_type`,
`record_ref`, `reason`, `policy_ref`, `ai_involved`, `risk` (low/medium/high), `outcome`, `ip`,
`prev_hash`, `hash`, `hash_version`, and `created_at`, indexed on `(tenant, created_at DESC)`.

Note `ip`: it is **in the hash material but populated by zero of the 168 write sites**. The column
exists and is part of the chain; no code ever fills it. The project lists this honestly.

**One write path.** There are exactly two writers — `auditLog` (kernel, 61 sites) and
`requestAudit` (plugins, forced `actorRole = plugin:<id>`, default policy `Platform §3`). Both call
a `SECURITY DEFINER` function, `app.audit_append(...)`, because the app role has no direct
`INSERT` on the table.

**The integrity saga.** The old `app.audit_append` *validated* `prev_hash` but stored the caller's
`hash` **verbatim**. When the chain was first recomputed from live rows, **26 of 53 development rows
did not reproduce**, and one row had **provably been altered after insertion** — it matched the
migration file's literal, not the column. Migration `075` fixed the whole family:

- a `BEFORE INSERT` trigger computes `prev_hash` and `hash` and pins `hash_version = 2`; the caller's
  hash is ignored (the JS `auditLog` now passes `NULL` deliberately, and its comment says so);
- `created_at` is millisecond-truncated for determinism;
- a per-tenant advisory lock is taken *inside* the function (the JS-only lock never protected
  migration replays);
- a `BEFORE UPDATE` immutability trigger forbids changing a row (but **not** DELETE, because
  retention archives by INSERT-then-DELETE);
- `app.audit_verify()` recomputes the chain and classifies breaks (`link_break`, `hash_mismatch`,
  `cold_boundary_break`), reporting legacy v1 rows without laundering them.

**Verification, on demand.** `GET /audit/verify` (owner/itadmin) runs the verifier. Its design
choices are each paired with a failure mode:

- it runs on the **owner path** (`sysq`), because `app.audit_log_cold` is `REVOKE ALL` from the app
  role — a `withUser` implementation would read nothing on the cold side and still report a clean
  bill of health;
- it **always returns 200** with a classified findings list, never a 5xx, because a 500 would make
  "cannot verify" indistinguishable from "no problems" to monitors that alert only on non-2xx;
- `ok` never travels alone: the counts and the **limitations** ship with it. The limitations array
  literally states: legacy v1 rows cannot be recomputed and are asserted neither way; the cold
  chain is checked only at the boundary and not walked; and *"a superuser can bypass the pinning
  trigger via session_replication_role ... it cannot be prevented from inside the database."*

The verifier even **audits its own run** — *"a verification nobody can prove happened is not
evidence"* — writing an `Audit chain verified` row at risk low or high depending on the result.

**Retention.** `retention-worker.js` archives rows older than `AUDIT_ARCHIVE_DAYS` (default 365)
verbatim into `audit_log_cold`, INSERT-then-DELETE in one transaction, cold = owner-read-only. The
project flags a real incident: a positional column mapping broke silently when `075` added
`hash_version`, so **archival stopped without alerting**. That is fixed context for anyone relying
on archival.

**What actions exist.** 167 distinct action strings (130 static, 37 templated). Migrations seed
their own genesis rows. And one honest gap: `POST /ai/call` writes no audit row (Chapter 19), the
only mutating door that skips the ledger.

### 21.2 The event spine and lineage

`GET /events` exposes the human-readable event feed (type, label, severity, ref, created_at), gated
to a shared role array. `GET /events/lineage` walks a correlation id through
`app.event_action_link`, returning each event with its linked actions and relations. The
correlation id is reserved but **not yet populated by most callers** — the project records this as
declared-but-unused. The lineage spine is real where it is written (transport raises, action
decisions) and sparse where it is not.

### 21.3 Memory: the institutional learning loop

`app.memory_entries` is the product's **Memory** plane — the last word of the loop
(Today → Attention → Ask → Action → Memory). `GET /memory` (owner/principal/itadmin) reads the last
100 entries. `POST /memory` (owner/principal/coordinator/finance) records a decision with a
`kind`, a `title`, a `body`, an `evidence` array, `decided_by`, and — the important part — an
**`expected` and an `actual`**:

```sql
INSERT INTO app.memory_entries (tenant_id, kind, title, body, evidence, decided_by, expected, actual)
VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8) RETURNING *
```

The audit says *"Recorded institutional decision"*, outcome *"remembered with expected-vs-actual."*
This is the seed of a learning loop: a school records what it expected a decision to achieve and
what actually happened. It is honest that the closed loop (comparing expected and actual
automatically) is a seed, not a completed system.

### 21.4 The Constitution: versioned policy, not a wall poster

The School Constitution is the product's policy store. `GET /policy-documents` (a broad staff list)
returns policies; `POST /policy-documents` (owner/principal/itadmin) creates or versions one. The
UPSERT bumps a version:

```sql
INSERT INTO app.policy_documents (tenant_id, ref, title, category, body, version, updated_by, updated_at)
VALUES ($1,$2,$3,$4,$5,1,$6,now())
ON CONFLICT (tenant_id, ref) DO UPDATE
  SET title=EXCLUDED.title, category=EXCLUDED.category, body=EXCLUDED.body,
      version=app.policy_documents.version+1, updated_by=EXCLUDED.updated_by, updated_at=now()
RETURNING *
```

Each save audits `Policy saved: <title>` with risk medium and outcome `version N`, and emits
`Policy updated: <title> (vN)`. A policy is a versioned, audited record — the thing an inspection
can ask for and a decision can cite.

> **Honest flag — the Constitution screen's copy.** The screen is described in the project map as a
> reader with self-contradictory copy (`:262` vs `:99`). The server store is versioned and audited;
> the screen text can disagree with itself. The story follows the server.

### 21.5 Workflow rules: a real engine, thinly consumed

`app.workflow_rules` holds rules with a `topic` filter, an optional condition
(`{field, op ∈ exists|equals|contains}`), and **one** action (`kind: outbox | comms`). Management is
`GET/POST/DELETE /workflow-rules` (owner/principal/itadmin).

The `DELETE` door is a small demonstration of law D-35: the app role has **no table-level DELETE**
in schema `app` (`071` grants SELECT/INSERT/UPDATE only), so a hard `DELETE` here once **500'd on
every call**. The fix is a soft delete:

```js
const r = await c.query(`UPDATE app.workflow_rules SET enabled=false WHERE id=$1 AND tenant_id=$2 RETURNING id`, ...);
```

The row survives as audit surface; the rule simply stops applying. Same pattern as API keys and
webhooks.

The **runner** (`scripts/workflow-worker.js`) polls outbox rows never scanned
(`workflow_scanned_at IS NULL`, excluding its own `wf:` outputs as a loop-breaker), evaluates
matching enabled rules, and writes **exactly one** action row with `dedup_key = 'wf:<rule>:<event>'`
(partial uniques make (rule, event) fire-once), stamping the scan marker **last, in the same
transaction** — so a crash rolls back and there is no silent loss.

Two honest flags:

- **The runner is not scheduled by default** (Chapter 1, OPS-8). So the engine is real and the
  automatic firing does not happen.
- **Plugins write comms directly rather than through rules.** The engine is real but barely
  consumed; the default admission rule seeded at signup is the most prominent use.

### 21.6 Metrics: honest gauges, including a gauge for the lie

`GET /metrics` (owner/itadmin) returns Prometheus text. Its gauges are the product's honesty made
measurable, and the comments read like a museum of past blind spots:

- `outbox_pending` counts unprocessed, unparked rows. `073` added a **separate parked counter** so
  relay *failure* becomes a positive signal instead of a hole in the pending gauge.
- `comms_queued` alone was not enough. The comment: *"A row whose status is 'sent' but whose CARRIER
  was a sandbox ('logger'/'log-only') was delivered to nobody. That population existed in every
  environment and was invisible: `comms_queued` falls as those rows drain, so a school with no SMS
  provider saw a clean, emptying queue. Counting it separately is what turns 'the ledger is honest'
  into 'the lie is measurable'."* So there is a `comms_sandbox_sent` gauge.
- `outbox_pending` alone was not enough either, because the relay's own deliverable is a log line;
  the webhook fan-out lives in `app.webhook_deliveries` and **no gauge measured it**. Now there are
  three webhook gauges: `queued` (not falling = fan-out stuck), `failed` (somebody never got their
  webhook), and `stalled` (queued, due, not being retried — *"the genuinely alarming one: the worker
  is wedged or not running, which a school would otherwise learn from a customer complaint"*).
- **Fleet gauges** exist because the tenant-scoped gauges were scoped to the *scraper's* tenant, so
  a backlog anywhere else was invisible to the fleet. `fleet_*` series are platform-wide aggregates,
  with no tenant identities exposed.
- Column-presence probes (`076`'s `discovered_at`/`workflow_scanned_at`) answer NULL on a database
  that predates them, and their gauges are **omitted rather than reported as a fabricated zero**.

There are also gauges for `api_heartbeat_age` and `backup_age` (from `ops_counters`) — the latter
because a backup that stopped running is exactly the kind of silence that must be visible.

### 21.7 Automation, roles, audit screen, and the honest risks

- **Automation** in the demo is a keyword compiler; the real rule engine is the workflow subsystem
  above. The screen and the engine are not the same thing.
- **RolesAdmin** is real CRUD over custom roles and their masks (Chapter 5), with retire-in-place
  rather than delete.
- The **Audit screen** reads `GET /audit`; in demo mode it invents policy refs client-side. In live
  mode it shows the real ledger rows including `prev_hash` and `hash`.
- The ItAdmin screen is largely disabled because the doors for key rotation and flags do not exist.

### 21.8 The honest governance risk list

The project's own risk register, consolidated for governance:

1. `degraded` plugin status is read by three gates and written by nobody.
2. The audit `ip` column is in the hash material but populated by zero writers.
3. The `075` trigger orders `created_at DESC, id DESC` while the verifier orders ASC — same-millisecond
   rows can report false link-breaks (documented as open).
4. Audit retention silently broke once due to a positional column map; it is guarded now but worth
   knowing.
5. `ai_calls` has no retention and never feeds the audit ledger.
6. `POST /ai/call` writes no audit row.
7. Lineage correlation ids are declared but not consistently populated.
8. The workflow/webhook/retention/dunning/reconcile workers are shipped but unscheduled by default.

This is what "honest governance" looks like in practice: a strong mechanism, a list of known holes,
and a system that measures its own lies rather than hiding them.

<!-- END OF PART 21 -->

---

## Chapter 22 — The Family Portal: A Parent Reads, Never Writes

### 22.1 The five invariants of the parent plane

`family.view` is the parent read-plane, and its header states its invariants plainly:

> *"GUARDIAN SCOPING — a parent reads only children linked via `family.child_link`. Cross-guardian
> child ids are 403 with no data. The teacher role is refused on every door. CONSENT IS IMMUTABLE —
> a decision (granted/declined) is final; the DB guard in 034 raises on any UPDATE of a decided row.
> A new consent is a new row, never a rewrite. Pending is never treated as consent. PARENTS NEVER
> EDIT RECORDS — corrections travel as requests. Request statuses are append-only event rows.
> CHILD LEAVE — raises the per-instance kernel action `parent.leave.<requestId>`. Approval is office
> authority. GRACEFUL DEGRADATION — TeacherOS tables are read via `information_schema` probes; absent
> tables yield empty sections, never 500s."*

Those five sentences are the whole parent design. Let me narrate them through Kavita's phone.

### 22.2 Login and the family nav

Kavita logs in at `/login` with `kavita.mehta@...` and her password. Because she is a `parent`,
the shell gives her the **family nav** (nine items under `/parent/*`) and the client uses the
`parentApi` transport. She does not see the staff audit page, the fees ledger, or the plugin
manager — the client hides them, and the server refuses them regardless.

### 22.3 Home: what is happening today

`/parent/home` calls `GET /parent/home`. The handler first resolves **her children** — and only via
the structural link:

```js
const myChildren = async (c, userId) =>
  (await c.query(
    `SELECT s.id, s.name, s.grade, s.section, s.admission_no
       FROM family.child_link l JOIN app.students s ON s.id = l.student_id AND s.tenant_id = l.tenant_id
      WHERE l.user_id=$1 AND l.tenant_id=current_setting('schoolos.tenant_id', true)::uuid
      ORDER BY s.name`, [userId])).rows;
```

For each child it assembles: today's attendance (from `app.attendance` for the IST date), upcoming
assignments (probing whether `teacher.homework` exists — graceful degradation), pending consents,
and a derived **attention** list. Read the attention logic because it is the "Today → Attention"
loop for a parent:

```js
for (const cs of consents.filter(x => x.status === 'pending'))
  attention.push({ tier: 'action', ref: `/parent/consents`, title: `Consent needed: ${cs.title}`, due: cs.due_at });
if (assignments) {
  for (const hw of assignments.filter(x => !x.submission_status && new Date(x.due_at) < new Date(Date.now() + 36e5 * 36)))
    attention.push({ tier: 'upcoming', ref: `/parent/assignments`, title: `Homework due: ${hw.title}`, due: hw.due_at });
}
```

A pending consent is `tier: action`; a homework due within 36 hours that has no submission is
`tier: upcoming`. The parent's home is not a dashboard; it is a small set of true statements about
what needs her.

The assignments query is also a window into the identity problem: because classroom submissions
key the **roster** id now, but older ones keyed a user id, the join accepts either — matching the
roster id **or** a submitter user whose name equals the child's, guarded by "exactly one such name."
The comment calls it *"the 034 name-match convention."*

> **Honest flag — the parent report-card silent-empty.** The project's map records that this read
> plane once selected `total_pct, published_at` from `plugin_exams.report` — columns that do not
> exist (`025`) — and swallowed the error, so **parent report cards rendered empty forever**. The
> current code routes exams through `servedReport()` and the one moderation read model (below), but
> the story keeps the flag because it is a textbook "success-shaped silence": an empty list that
> looks like "nothing published" instead of "our query is broken."

### 22.4 Every `:id` door checks ownership, with no data in the refusal

`GET /parent/child/:id/assignments` (and timeline, academics, attendance, exams, transport,
documents) all begin:

```js
if (!(await assertOwnChild(c, req.user.id, req.params.id)))
  return bad(reply, 'This child is not linked to your family account', 403);
```

`assertOwnChild` checks `family.child_link` for `(user_id, student_id)` **and the tenant GUC**. The
refusal is a 403 with **no data in the error** — it does not reveal whether the child exists. This is
the `/my-cases` lesson applied everywhere: a parent probing UUIDs learns nothing.

### 22.5 The one exam read model, shared across planes

The parent exam read is the `servedReport()` path, and the comment explains why it must match the
staff plane exactly:

> *"Both parent doors below go through `servedReport()` exactly as the staff report door does, so a
> moderated 90/A2 can never read to a family as 57/C1. The overlay is joined in the same query: the
> family plane reads it with the report so the two can never be served out of step."*

This is a direct response to a family-trust failure mode: if a result is corrected by moderation,
the family must see the **correction**, not the pre-moderation score. A school that shows the office
one number and the parent another has broken trust irreparably. One function, two planes.

### 22.6 Consents: final, and never a rewrite

A consent is authored by the **school** (`POST /parent/consents`, staff authority) — a parent never
authors their own. The parent **decides** it (`POST /parent/consents/:id/decide`). Once decided, it
is **immutable**: the database guard in migration `034` raises on any UPDATE of a decided row. If
the situation changes, the school issues a **new** consent row. *"Pending is never treated as
consent."* The parent's consent decision is audited.

### 22.7 Requests: append-only tickets

A parent's request travels through a ticket state machine:

```
submitted → received → assigned → in_progress → waiting_parent → resolved → closed
```

The transitions are validated at the door (a plain 409) and **enforced again by a DB guard** (`113`)
for any write that bypasses the door. The request has an append-only `request_event` trail — history
is never updated. `POST /parent/requests/:id/transition` is staff authority (advancing the ticket is
the office's job). Categories include `leave`, `certificate`, `document`, `transport`, `activity`,
`profile_correction`, `reevaluation`, `other`.

**Child leave** is a special request: `POST /parent/leave-request` raises a per-instance kernel
action `parent.leave.<requestId>` — unique from birth — owned by the **coordinator**. The parent
asks; the office decides. The same action-spine discipline the story has seen throughout.

**Report a discrepancy** (`POST /parent/report-discrepancy`) is how a parent corrects a record
without editing it. The comment: *"PARENTS NEVER EDIT RECORDS — corrections travel as requests."*
This is a deliberate power asymmetry: the parent can flag that an attendance mark is wrong; only
the office can change it, and the change is audited.

### 22.8 Parent Fees and the assistant

`/parent/fees` (the `ParentFees` screen) reads the family's obligations and initiates a UPI/Razorpay
payment (Chapter 7). `/parent/copilot` uses `parent.assistant`, which the story has already
described as **deterministic** — a per-child brief, a keyword-ask confined to the parent's own
children, template drafts, and a `HONEST_UNKNOWN` answer when it cannot help.

> **Honest flag — the brief log.** `parent.brief_log` stores the **exact briefs served**, including
> full child-name JSON, with **no purge path**. So while the briefs are honest and useful, they are
> also a growing store of child data with no retention policy. The project lists this as a privacy
> residual.

### 22.9 The honest flags around the parent UI

- **`parentApi` is bearer-only.** It sends no CSRF token and no `credentials:'same-origin'`. Under
  a cookie-session deployment its POSTs would 403. It is one of the five transports that skipped the
  compliant `liveApi` path.
- **`getAssignments` calls an unregistered door** (`/parent/child/:id/assignments` is registered,
  but the wrapper's path construction was wrong at some point), producing a permanent "Not available
  yet."
- **`getExplain` builds `?topic=` against a `/:topic` route**, a guaranteed 404 if ever wired.
- **Three dead exports** exist in the parent service.
- **`isDeniedError` is the app's only authz-versus-outage distinction** — the parent plane renders a
  calm lock on a 403 instead of a scary error. This is the one place the client distinguishes
  "you may not" from "the server is down."

### 22.10 What the parent portal gets right

The family plane is one of the most disciplined parts of the product on the server side:

- scoping is **structural** (`family.child_link`), not name-based;
- refusals leak no data;
- consents are immutable;
- parents cannot edit records — corrections are requests;
- leave and complaints route through the kernel action spine;
- the exam read model is shared with the staff plane, so moderation cannot be inconsistent;
- absent sibling tables degrade to empty rather than 500.

For a parent, the portal's central promise is: **you will always see the same truth the office
sees, and you can always ask — but you cannot silently change the record.** That is the right
promise for a school.

<!-- END OF PART 22 -->

---

## Chapter 23 — The Student Kiosk, and the Safeguarding Room

### 23.1 A school computer is not a phone

`student.world` begins with a premise that most products get wrong:

> *"The student world on SCHOOL computers/kiosks — students have no personal phones (§78/§79), so
> session isolation on shared machines is a security requirement."*

A student in this product is not a consumer with an app. They are a child using a shared machine in
a lab. Everything about the student plane follows from that.

### 23.2 Session isolation: short, cleared, counted down

Three mechanisms work together:

1. **A short session TTL.** The kernel issues student tokens with `expiresIn: config.studentSessionTtl`
   (default `30m`), so a kiosk left logged in self-expires.
2. **Response headers on every `/student/*` response.** An `onSend` hook sets
   `Cache-Control: no-store`, `Pragma: no-cache`, and `Clear-Site-Data: "cache", "storage"` — so
   the shared browser clears cache and storage between sessions, and nothing leaks to the next
   student. The comment notes the hook is registered before the module's routes so it scopes
   `/student/*` exactly.
3. **An idle countdown.** The kernel enforces an idle window using a **shared store**
   (`auth.session_activity`) so the window holds across replicas, with an in-process map fallback for
   databases that predate the table. `GET /student/session` returns the idle minutes and the honest
   copy: *"You are on a shared school computer. When you finish, log out — your data will not stay
   on this machine."*

The story notes one structural caveat the code states: `/auth/logout` is registered before this
loader mounts, so the student Clear-Site-Data header cannot be attached to logout from here (Fastify
snapshots hooks at route-registration time). The kiosk UI drives idle-expiry instead.

### 23.3 The identity pin, finally done right

`ownStudent()` is the resolution of the entire story's identity thread:

```js
const ownStudent = async (c, user) => {
  const bound = (await c.query(
    `SELECT id, name, grade, section, admission_no FROM app.students
      WHERE tenant_id=$1 AND status='active' AND user_id=$2`, [user.tenant_id, user.id])).rows[0];
  if (bound) return bound;
  const r = await c.query(
    `SELECT id, name, grade, section, admission_no, count(*) OVER () AS name_matches
       FROM app.students
      WHERE tenant_id=$1 AND status='active' AND lower(name)=lower($2)
      ORDER BY created_at LIMIT 1`, [user.tenant_id, user.name]);
  const row = r.rows[0];
  return row && Number(row.name_matches) === 1 ? row : null;
};
```

`app.students.user_id` (migration `132`) is the **structural** account↔roster binding, written when
the school creates a pupil's portal account. The name match is kept **only** as a fallback for rows
enrolled before the account existed, and it requires `name_matches === 1` — if two pupils share the
name, it resolves to **nothing** rather than to whichever row was inserted first (S0 fix E1). The
comment is explicit: *"It is not a second source of truth — it is the absence of one, handled
honestly."*

This is the corrected version of the system's weakest link. Recall the contradiction flagged in
Chapter 9: `teacher.classroom` still resolves submissions by name, while `student.world` resolves
identity structurally. Two planes, two rules. The student plane is the right one; the classroom
plane has not caught up. That inconsistency remains the most important open item in the product.

### 23.4 User-scoped RLS: tenant is not enough

A student's private rows (mistakes, flashcards, study tasks, print jobs) run through a special
connection that sets **both** the tenant GUC and a user GUC:

```js
const withStudentUser = (tenantId, userId, fn) =>
  (async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('schoolos.tenant_id', $1::text, true)`, [String(tenantId)]);
      await c.query(`SELECT set_config('schoolos.user_id', $1::text, true)`, [String(userId)]);
      await c.query(`SELECT set_config('schoolos.role', 'student', true)`);
      await c.query('SET LOCAL ROLE schoolos_app');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
    finally { c.release(); }
  })();
```

The RLS policies on those tables pin `schoolos.user_id` as well as the tenant. A tenant-matched row
is **invisible** unless the GUC names its owner. So even a bug that forgot a `user_id = ?` predicate
cannot leak one student's private note to another — the database refuses. This is the same
belt-and-braces philosophy as the kernel's tenant isolation, applied at the person level.

### 23.5 The student's day

`GET /student/home` returns:

- **Next class** — from the timetable grid for today (IST), current period else next, with subject,
  teacher, room, times, and a `now` boolean.
- **Homework** — split into **digital** and **paper**. The default medium is **paper**:

> *"StudentOS §1/§12: paper is the default medium — a homework row only lands in the digital list
> when the school EXPLICITLY labels it digital. Unlabelled rows (schools that never set mode) must
> never require an upload."*

That is a small but humane decision: the product does not assume every child has a device.

- **Upcoming test** — only a *published* exam is named, so a student never sees an exam the school
  has not released.
- **Counts** — assignments, etc.

Other student doors: homework list, results (published only, through `servedReport`), mistakes
(`POST` / `GET` / `DELETE  /student/mistakes/:id` — a student may hard-delete their **own** note,
the one D-35 exception), flashcards, study tasks, the **print queue** (`POST /student/print`, then a
staff member marks it done or the student cancels), and the noticeboard.

### 23.6 The wellbeing request: anonymous by construction

`POST /student/wellbeing` is the safeguarding intake for a child:

```js
if (!WELLBEING_CATEGORIES.includes(b.category)) return bad(reply, 'Choose what this is about: academic pressure, friendship, bullying, family, health or other');
if (!b.detail || !String(b.detail).trim()) return bad(reply, 'Please write a little about how you are feeling');
const anonymous = b.anonymous === true;
const me = anonymous ? null : await ownStudent(c, req.user);
const row = (await c.query(
  `INSERT INTO student.wellbeing_request (tenant_id, creator_user_id, student_id, category, detail, anonymous)
   VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, status, created_at`,
  [req.user.tenant_id, anonymous ? null : req.user.id, me?.id ?? null, ...])).rows[0];
```

Note the structural anonymity: when `anonymous` is true, **no identity is stored at all**
(`creator_user_id` and `student_id` are both NULL, and the audit actor is the literal string
`"anonymous (student)"`). This is the same structural-anonymity pattern as the safety box. The
reader tier (`GET /student/wellbeing`) is `principal, coordinator, owner, itadmin, counselor` —
**never the classroom teacher**. And an anonymous row is served with `student: null`, so the reader
sees the words but not the child.

The comment records why `counselor` is now in the reader list at all: *"the client screen already
listed a counselor — but the role could not be issued, so the person doing this work had to borrow
`coordinator` and with it inherited finance reads and /audit. The counselor is now real."* Making
the role issuable was the privacy fix: the right person can now do the work without over-privilege.

### 23.7 teacher.support: concerns, safety box, doubts, PTM

The `teacher.support` plugin is the staff-side safeguarding surface:

- **One-tap concerns** — a teacher files a concern; status changes are **append-only**
  (`teacher.concern_status_event`); escalation becomes a kernel action.
- **An anonymous-by-default safety box** — a report with `reporter_user_id` NULL when anonymous
  (structural anonymity again); assign/close; a critical report pages the principal.
- **Deterministic doubts + FAQ promotion** — a question-and-answer surface that promotes recurring
  doubts into an FAQ.
- **Interventions** (`intervention.plan` + events).
- **PTM slots and bookings** with **teacher-private notes** — the notes use a dedicated
  `withNoteUser` session variable, so a private note is invisible even to other staff.

The safety-box discipline is the product's clearest statement of the safeguarding principle:
*wellbeing and safety data have narrower visibility than ordinary staff data, and a teacher is never
a reader of a child's disclosure to the counselor.*

### 23.8 The honest flags around the student and safeguarding planes

- **Task ticks persist only `kind==='task'`.** Other checkboxes on the student home evaporate at
  reload.
- **Study and Results tiles are "soon" toasts.**
- **The print success is announced only through a 1-pixel screen-reader node**, a serious
  accessibility defect (no visible confirmation).
- **The counselor has doors but no screens.** The safety box and concerns board are
  server-complete, with zero UI; the nav omits them honestly. This is the most striking
  server-versus-UI gap in the product: the least-privileged safeguarding role was finally made
  real, and then given no surface to work in.
- **`Noticeboard` "Regenerate weekly" is refetch theatre.**
- **`/student/*` and `/parent/*` sub-paths are not covered by the client `staffOnly` guard**, so a
  staff member who types the URL can *render* the family/student screens until a door refuses.
  Display-only leak; the server still refuses.

### 23.9 Why the student plane is a moral statement

A school's most vulnerable user is a child. SchoolOS's student plane is built on three decisions
that are as much ethical as technical:

1. **A shared machine must not leak between children.** Short sessions, cleared storage, idle
   expiry, user-scoped RLS.
2. **A child's disclosure must be structurally anonymous if they choose it.** No identity column
   filled, a reader tier that excludes the classroom teacher, and per-row refusal for anonymous
   rows.
3. **A child's own private notes are theirs.** They can delete them — the one deliberate DELETE in
   the codebase.

Whatever else is unfinished, the student plane's spine is the right spine.

<!-- END OF PART 23 -->

---

## Chapter 24 — Compliance: Consent, Erasure, and the Returns the Government Asks For

### 24.1 India's data-protection law, implemented as a ledger

The DPDP Act 2023 gives an Indian data principal (here, a parent or student) rights over their
personal data: consent, access, and erasure. SchoolOS implements these in `pack.dpdp`, and the
plugin's header states its shape:

> *"Class C: consent ledger is IMMUTABLE (invariant consent_immutable — withdrawal appends a
> superseding row, never updates a decision); SAR (subject-access request) export/erasure ride the
> KERNEL APPROVAL spine (app.actions) — erasure touches the data-principal's identity across
> domains, so it executes ONLY after kernel approval."*

The vocabulary: a **DPO** (data-protection operator) is one of `owner, principal, itadmin,
coordinator`. A **SAR** is a subject-access request. **Consent** is an artifact, not a flag.

### 24.2 Consent: append-only, and expiry is a first-class state

`POST /plugins/pack.dpdp/consent` records a consent artifact. Several details matter:

- The `subjectRef` is a **guardian phone**, and it is **normalised to E.164 before validation** —
  *"spaced variants of any length meet the E.164 contract; the regex judges the normalized form, not
  the raw input."* One normaliser (`_shared/phone.js`) is shared with the admissions funnel and the
  comms dispatcher, because three files had drifted copies of the rule.
- A `granted` decision is de-duplicated **only if the operative (latest) artifact is still granted**.
  A later grant after a withdrawal appends a **fresh** artifact — *"withdrawal = superseding
  artifact."* The decision trail is append-only.
- Each artifact carries a `valid_until` computed from the tenant's `consent_validity_days` setting
  (default 1095 days), clamped to a sane range.
- The event `consent.recorded.v1` fires and the audit says `consent granted/withdrawn` at risk low.

`GET /consent/state` computes the **live state per subject+purpose** from the latest artifact:
`granted`, `withdrawn`, or `expired` (if `valid_until` has passed). Notice that expiry is a
computed state, not a stored one — the ledger is immutable, so the state is derived. Queries are
normalised too, so spaced input matches stored E.164 artifacts.

### 24.3 Erasure: approval-gated, idempotent, and PII-free by the end

A parent exercises erasure. The DPO opens a SAR:

```
POST /plugins/pack.dpdp/dsr
{ "kind": "erasure", "subjectRef": "+91 98765 43210" }
```

The handler refuses a duplicate open request of the same kind, computes an **SLA** from the
tenant's `dsr_sla_days` (default 30), and raises a **kernel approval action** with a
**per-instance** code:

```js
`dpdp.dsr.${kind}.${sarId}`
```

The comment records why per-instance matters: *"action codes are UNIQUE (tenant_id, code) — the
fixed `dpdp.dsr.${kind}` 500'd on the SECOND SAR of a kind (subject #2 could never raise
erasure)."* The action is owned by the **principal**, priority high, policy `DPDP Act 2023 · SAR`,
and the detail for an erasure says the honest thing: *"Redact the data principal's identity ...
Irreversible once executed."*

Execution is a separate, step-up-protected door (`POST /dsr/:id/execute`, with
`app.requireStepUp`). It refuses unless the action is decided and not dismissed, and it refuses to
execute for the proposer:

```js
if (act.payload?.proposed_by === req.user.id) {
  return reply.code(403).send({ error: 'The person who raised this request can\'t approve it — a second person must' });
}
```

So erasure needs **two people and a fresh credential**.

For an **export**, execution assembles a bundle of the consent artifacts and the admissions-funnel
PII for that subject, with a `scopeNote` that is honest about what the bundle does not include:
*"Core student records are office-lane."* The bundle is delivered only after the SAR status is
`fulfilled`.

For an **erasure**, execution redacts the plugin-owned data:

```sql
UPDATE plugin_dpdp.consent SET subject_ref='[erased:'||id||']', evidence=jsonb_build_object('erased',true,...)
 WHERE tenant_id=$1 AND subject_ref=$2;
UPDATE plugin_admissions.lead SET guardian_name=NULL, guardian_phone='[erased:'||id||']'
 WHERE tenant_id=$1 AND guardian_phone=$2;
```

And then — the sophisticated part — it reaches the **queue-scoped surfaces**: guardians redaction,
comms recipient hashing, webhook payload scrub, OTP phone purge, and the SAR row itself (which
previously kept the raw phone forever). The comment:

> *"Format-insensitive matching: phone formats differ per surface, so matches compare digit-
> normalized forms. Every rewritten value is the tenant-scoped keyed surrogate (HMAC) — ledger joins
> survive, re-identification needs the server key, repeat SARs are idempotent via the 060 journal
> (which stores only `sha256(subject)`, never PII)."*

This is a genuinely well-designed erasure: the data principal's PII is replaced by a keyed
surrogate in every surface the pack owns, the erasure is **idempotent** (replaying the journal does
not damage data again), and the journal itself stores only a hash of the subject — zero PII. The
server key lives in the environment (D-32: never in code or git), so re-identification requires the
server key, which is exactly the "pseudonymisation" the law contemplates.

**The office lane.** The pack holds **no SQL against `app.students`** and never will. But the
denormalised guardian PII on the student row (`guardian_name`, `guardian_phone`) *must* be erased.
So the pack **requests** a named core-lane action, `students.redactGuardianPii`, which the kernel
executes on the same tenant-scoped client and audits in the same transaction. This is the same
boundary pattern as admissions' `students.create.<leadId>`: *"Same boundary, same shape."* The
authorisation is the SAR approval a second authority already decided — no second approval is raised,
*because that would authorise nothing new.*

### 24.4 Statutory returns: refuse rather than guess

A school must file returns. Three exports exist:

- **UDISE** (`ops.udise`) — the Indian school-information return. `GET /export` produces a
  deterministic CSV/JSON aggregate by **academic year × grade × section**. It **refuses without a
  configured UDISE code**, defends against CSV formula injection, uses CRLF line endings, and — the
  honesty detail the story keeps returning to — reports **gender as `not_recorded`**, because the
  schema has no gender column. `GET /columns` shows the door's own column mapping.
- **CBSE OASIS** (`pack.cbse`) — a read-only rules engine `R1–R6` over `plugin_exams` (weightage,
  grade scale, bounds, the 75% eligibility, report-integrity re-derivation, board identity) plus an
  OASIS CSV export. Its "gate" raises kernel **obligations** (e.g. `cbse.weightage.<exam>`) rather
  than blocking. One declared setting, `weightage_strict`, is never consulted.
- **Tally** (`accounting.tally`) — a read-only Tally 4.1 export: an IST **day-book** of confirmed
  payments, with **content-addressed XML** (a `sha256` ref) and an audit digest that never includes
  amounts. `POST /export` writes the export; `GET /exports` lists history. The honest flag: the
  `?company=` parameter is interpolated raw into the XML envelope — a real injection surface.

The recurring design value is: **a return that cannot be produced correctly is refused, with a
reason, rather than produced with invented values.** A school would rather be told "configure your
UDISE code" than file a guess.

### 24.5 The Master Action Plan: MPD, RTE, payroll-lite, billing, NEP

The later migrations and kernel doors add a large compliance surface described as the "Master Action
Plan." The story will summarize rather than exhaust it:

- **MPD (Mandatory Public Disclosure)** — a compliance vault of the documents an inspection can ask
  for (affiliation letter, trust registration, state NOC, and more), each with a state
  (`GET /compliance/mpd`, `POST /compliance/mpd/docs`, `POST /compliance/mpd/docs/:id/retire`). It is
  a disclosure wall with a lifecycle.
- **RTE/EWS** — the Right to Education lottery and reimbursement ledger
  (`POST /rte/lottery/import`, `POST /rte/reimbursements`), for the 25% economically-weaker-section
  seats.
- **Payroll-lite** — `GET /payroll/overview`, `PUT /payroll/staff/:id`, `POST /payroll/runs`,
  `POST /payroll/runs/:id/disburse`, `POST /payroll/runs/:id/ecs-file` (a bank ECS file). A small
  payroll for a school that does not run a full HRMS.
- **Billing** — `GET /billing`, `POST /billing/checkout`, and a public `POST /billing/webhook` —
  the *platform's own* billing to the school (not the school's fees to parents). This is a second
  money rail, for the SaaS subscription.
- **NEP** — National Education Policy profile and activities (`GET /nep/profile`, `PUT /nep/r3`,
  `GET/POST /nep/activities`, `POST /nep/hpc`, `GET /nep/hpc/:studentId`, `POST /nep/fln`,
  `GET /nep/fln`) — holistic-progress cards and foundational-literacy/numeracy tracking.
- **Infrastructure & amenities** — `GET/PUT /school/infra`, `GET/POST /meetings`,
  `GET/POST /health-checks`, `GET/POST /meals`, `GET/POST /staff-trainings` — the compliance
  diaries a school must keep (fire safety, water, mid-day meals, staff training).
- **Student 360 and identity** — `GET /students/:id/360`, `POST /students/:id/identity` — a unified
  view and an identity-document record.
- **Attendance QR** — `GET /attendance/qr`, `POST /attendance/qr-mark`, `GET /attendance/my-qr`
  and their staff equivalents — QR-based marking, alongside the manual register.
- **Transport runs, attendants, fares, inspections, compliance report, ETA** — a deeper transport
  model (`GET/POST /transport/runs`, board/unboard, attendants + verify, fares + quote,
  inspections, a compliance report, and an ETA door) that coexists with the `transport.gps` plugin.
- **Staff attendance QR** — `GET /staff-attendance/qr`, `POST /staff-attendance/scan`,
  `POST /staff-attendance/mark`.
- **DPDP breaches** — `GET/POST /dpdp/breaches`, `POST /dpdp/breaches/:id/contain` — a breach
  register with a contain action, because a breach log is itself a legal obligation.
- **Emergency announcements** — `POST /announcements/emergency`,
  `GET /announcements/:id/unacked` — a broadcast that tracks who has *not* acknowledged.
- **Fee entitlements/heads/late-fees/concessions** — the fee policy surface (Chapter 7).
- **Stale-action escalation** — `GET /actions/stale`, `POST /actions/stale/escalate`.

### 24.6 The honest state of the compliance surface

This is a large, recently-grown part of the product, and the story flags two things:

- **Some of it is door-without-screen.** Just as the counselor had doors and no UI, parts of the
  compliance/MPD/RTE/payroll surface arrive as kernel doors that may not yet have a polished screen.
  The Returns screen (`/returns`) is real and fetches with a bearer, but the breadth of the newer
  Master-Action-Plan doors is wider than the UI that exposes them.
- **Some declared settings are unread.** The project lists six (`ops.bi cache_seconds`,
  `ops.import max_shadow_rows`, `ops.timetable autofill_default` and `absence_feed`,
  `ops.visitors pickup_otp_max_attempts`, `pack.cbse weightage_strict`) — though the visitors
  attempts setting turns out to be read in the current code, so the list itself needs a re-check.
  The pattern is worth internalizing: a declared setting that nothing reads is a promise the system
  does not keep, and the honest thing is to either read it or stop declaring it.

### 24.7 Why compliance is the strongest proof of the ledger

Every compliance feature depends on the ledger and the audit trail. Erasure leaves a PII-free,
idempotent journal. Returns are aggregates of records the ledger can trace. A breach register, an
SLA clock on a SAR, a consent artifact with an expiry — each is a claim that a regulator might
test, and each is backed by a row rather than a promise. If a school is ever audited, the compliance
domain is where the product's insistence on evidence pays off.

<!-- END OF PART 24 -->

---

## Chapter 25 — The Promise River: Events, Outbox, and the Workers

### 25.1 Two rivers, one transaction

Every write in this book that "did something" did two things at once. It appended to the **history
river** (`app.audit_log`, hash-chained, append-only) and it dropped a note in the **promise river**
(`app.outbox`, the machine envelope), both inside the same transaction. `emitEvent` writes **both**
an `app.events` row and an `app.outbox` row:

```js
INSERT INTO app.events (tenant_id, type, label, severity, ref, emitted_by, subject, correlation_id, causation_id, schema_version, payload) VALUES (...) RETURNING id, created_at;
INSERT INTO app.outbox (tenant_id, topic, payload, event_id, schema_version, emitted_by, subject, correlation_id, causation_id) VALUES (...);
```

The event table is for humans and dashboards (`type`, `label`, `severity`, `ref`). The outbox row is
for machines (`topic`, `payload`, `event_id`). One action, two audiences, one commit.

The `emitEvent` helper also validates the envelope before it reaches Postgres — the type must match
`/^[a-z][a-z0-9_.-]{0,63}$/`, the label ≤500 chars, the topic matches a longer pattern, the payload
must be JSON-serializable and ≤64 KiB — *"so one malformed plugin payload cannot exhaust a queue."*

### 25.2 The outbox relay: at-least-once, with failure that is visible

`outbox-worker.js` is the relay. Its semantics are worth reading closely because they were fixed
twice.

**Polling with `FOR UPDATE SKIP LOCKED`** so many workers can run concurrently:

```sql
SELECT id, topic, payload, attempts, emitted_by FROM app.outbox
 WHERE processed_at IS NULL AND parked_at IS NULL AND attempts < $1
   AND (next_attempt_at IS NULL OR next_attempt_at <= now())
   AND (last_error IS NULL OR last_error NOT LIKE 'max attempts%')
 ORDER BY created_at LIMIT $2 FOR UPDATE SKIP LOCKED
```

**Attempts are counted unconditionally, before delivery** — success and failure alike. The comment
explains: *"No path can leave a row at a stale count, so MAX_ATTEMPTS and parking are always
reachable."* This replaced an older bump-on-rollback approach that left clean-commit failures
uncounted.

**Backoff:** `delay = min(BASE * 2^(attempts-1), MAX)` — a poison row cannot monopolize batch slots
at the raw poll rate.

**Parking:** after `MAX_ATTEMPTS` (8), the row is parked:

```js
await c.query(
  `UPDATE app.outbox SET parked_at = now(), attempts = $2, next_attempt_at = NULL, last_error = $3 || left($4, 500) WHERE id=$1`,
  [row.id, attempts, PARKED_PREFIX, String(rowErr?.message ?? rowErr)]);
```

And the fix that matters most: it **deliberately leaves `processed_at` NULL** when parking. The old
code set `processed_at` on parking, *"which made the only queue gauge FALL as rows failed — a total
relay failure was indistinguishable from an idle system."* Migration `073` added `parked_at` so
failure is a **positive signal** rather than a hole.

**At-least-once on a PG error:** a failed tick transaction rolls back every claimed row unmarked,
and they are re-claimed next tick.

**Self-healing schema:** the worker ensures `next_attempt_at` (042) and `parked_at` (073) exist at
startup, tolerating a database migrated before them. This is the project's acknowledged
schema-versus-runtime drift allowance.

**Importability:** the poll loop runs only when the file is the process entry point. Before this,
the loop ran at module scope, so *"the event spine's core component therefore had ZERO automated
verification (importing it to test `tick` started a second relay instead)."* The subscriber is now
**injectable** (`deliver`), so the failure path is testable at all — previously the subscriber was
`console.log`, which cannot throw, so parking and backoff were unreachable from any test.

### 25.3 The workflow runner: exactly-once per (rule, event)

`workflow-worker.js` rides the same outbox. It discovers **never-scanned** rows by a per-consumer
marker (`workflow_scanned_at`), skipping its own `wf:` outputs (a loop-breaker), with
`FOR UPDATE SKIP LOCKED`. The comment narrates why the old design was broken:

> *"The previous query was `WHERE created_at > now() - interval '1 hour' ORDER BY created_at LIMIT
> 50` with NO cursor and NO marker. Two failures followed: STARVATION — every tick re-read the same
> oldest 50 rows, so once more than 50 rows matched inside the window the rest were never seen at
> all. The LIMIT did not bound the work per tick; it bounded what could EVER be processed. And
> OUTAGE LOSS — a runner down for more than an hour never looked at the gap again."*

For each row, it loads enabled rules matching the topic, evaluates an optional condition
(`exists`/`equals`/`contains`; an unknown op **never fires** — the honest default), and performs
**exactly one** action:

- `comms` → insert a queued `app.communications` row with `dedup_key = 'wf:<rule>:<event>'`;
- default → insert a derived outbox row (a fan-out) with the same dedup key.

The partial unique index on the dedup key makes `(rule, event)` fire **exactly once**. And the page
marker is stamped **last, in the caller's transaction**:

> *"The page is marked evaluated only AFTER every rule has been applied, inside the caller's
> transaction: a crash mid-page rolls the marker back together with the derived rows, so the page is
> re-evaluated next tick rather than skipped. Marking FIRST would be the silent-loss bug this change
> exists to remove."*

That is the correct ordering for a state-based worker, and it is stated as a law in the comment.

### 25.4 The webhook fan-out: three honest gauges

`webhook-worker.js` delivers outbound webhooks signed with
`x-schoolos-signature: t,v1=hmac(secret,'t.body')`, with retries recorded in
`app.webhook_deliveries` (`UNIQUE(sub, event)`). The project fixed the same class of bug here as in
the outbox: the fan-out was measured by no gauge at all, so *"an operator watching the only queue
signal saw `outbox_pending 0` — a clean, drained, healthy-looking queue — while every subscriber
delivery was failing."* Chapter 21 explained the three replacement gauges (`queued`, `failed`,
`stalled`).

### 25.5 The other workers

- **`comms-dispatcher.js`** — the message drain (Chapter 18). The only one that talks to a carrier.
- **`retention-worker.js`** — chain-preserving cold archival of old audit rows (Chapter 21), plus
  GPS position purge, expired OTP/denylist/OAuth-state cleanup. Its header documents the honest
  incident where a positional column map broke silently.
- **`day-worker.js`** — four contained daily steps, including dunning and maintenance sweeps.
- **`dunning-reminders.js`** — queued overdue reminders with IST quiet hours and 7-day dedup.
- **`homework-reminders.js`** — a reminder worker.
- **`reconcile-payments.js`** — the reconciliation sweep. The project flags that it builds its own
  Postgres client (running as the **owner role, RLS bypassed**) and writes `app.events` directly
  **with no outbox row**, so its warnings reach no subscriber.
- **`replay-erasure-journal.js`** — replays the DPDP erasure journal idempotently after a restore.

### 25.6 The scheduling gap, stated once more, completely

The single most consequential operational fact in the whole system: the shipped deployment starts
**`api`, `retention`, `outbox`, and `comms`** — and **not** the workflow, webhook, day, dunning, or
reconcile workers. The consequences, collected from across this book:

- the **workflow engine never fires automatically**, so the admission follow-up rule and any other
  rule are inert;
- **outbound webhooks are never delivered automatically**;
- **daily sweeps** (day-worker) do not run;
- **dunning reminders** are queued but may not send on schedule;
- **payment reconciliation** does not sweep.

The doors exist, the code is real, the tests cover it — and a default deploy does not arm it. This
is OPS-8, and it is why the story has paused on it in Chapter 1, Chapter 6, Chapter 15, and now
here. A reader planning a real deployment should treat scheduling these workers as a required
step, not a nice-to-have.

### 25.7 The event catalogue and its consumers

The measured topics are many — `homework.v1`, `submission.v1`, `concern.filed.v1|routed.v1|closed.v1`,
`safety.report.filed.v1`, `doubt.*.v1`, `ptm.booked.v1`, `family.consent.v1|request.v1`,
`child.leave.requested.v1`, `student.print.v1|wellbeing.v1`, `sub.assign.v1`, `duty.assigned.v1`,
`payment.link.created`, gateway `payment.captured`, `exam.marks.updated.v1|exam.published.v1`,
`admission.enquiry.captured|stage.transitioned|offer.accepted`, `consent.recorded.v1`,
`sar.opened.v1|fulfilled.v1`, `visitor.*.v1`, `gps.position`, `substitution.assigned`,
`attendance.autofilled`, `cbse.obligation.due.v1`, `clinic.*.v1`, plus the build-out topics
(`platform.tenant.onboarded.v1`, `people.user.created`, `library.loan.issued.v1`, `files.stored.v1`,
and more).

Who listens? The relay logs. The dispatcher drains comms. The workflow runner fans out. Beyond
that, most topics reach **no subscriber**. The project states this honestly: the event spine is an
at-least-once promise, and the promise may be an appointment nobody kept. The value of the spine is
that a future rail (WhatsApp BSP, email, an analytics sink) can attach **without rewriting the
emitters** — which is exactly why the spine exists even when the consumers are thin.

### 25.8 Why the promise river is the right abstraction

A school office is full of "and then someone should…". A teacher marks an absence, and someone
should tell the parent. A bus is late, and someone should notify the guardians. A payment clears,
and someone should send a receipt. SchoolOS models each "and then" as a durable row in a queue, not
as a synchronous side effect inside the request. The request never waits for the message. The
message never blocks the mark. And because both the audit row and the outbox row commit with the
data, a crash cannot leave a change without its promise, or a promise without its change.

The remaining work is not conceptual. It is operational: schedule the workers, attach the
subscribers, and stop letting a clean queue look like a delivered message.

<!-- END OF PART 25 -->

---

## Chapter 26 — The Wall: Security, Tenancy, and the Corridor in Full

### 26.1 The one idea

If the Prologue gave you the picture — a clerk at a desk, a drawer that locks from the inside, a
book that cannot be torn — this chapter is the engineering behind it. The central claim is simple:
**tenant isolation is a property of the database, not of developer discipline.** Everything else in
this chapter supports or qualifies that claim.

### 26.2 The corridor, hook by hook

A request walks this exact sequence.

**Hooks before the route.** CORS (credentials disabled), rate limiting (300/min default), body
parsing (JSON 1 MiB; `files.store` 8 MiB multipart; webhook rails install a raw-bytes JSON parser so
an HMAC can be computed over the wire bytes). `onSend` adds `no-store` on personal planes and
security headers, and a ≥500 response is reduced to a generic *"internal error."*

**`app.authenticate`.** The full order:

1. **X-API-Key branch.** If the header is present, the method must be `GET` (mutations 403). The key
   is `sha256`-hashed and looked up with `revoked_at IS NULL`. The door must be in an allowlist
   (`API_DOOR_SCOPES`) and the key must hold the required scope. `last_used_at` is stamped. A
   synthetic principal is built with `role: 'api'`. Notably, the allowlist includes `GET /metrics`
   (`metrics.read`) and `GET /audit/verify` (`audit.verify`), so an operator's Prometheus and audit
   checker have machine identities — *"without it, alerting had no machine identity at all."*
2. **Cookie-vs-bearer selection.** `Authorization: Bearer` wins; otherwise the `schoolos_session`
   cookie.
3. **CSRF double-submit on cookie mutations only.** For a non-GET/HEAD/OPTIONS request carried by a
   cookie, the `X-CSRF-Token` header must equal the `schoolos_csrf` cookie. Bearer clients are
   exempt. A malformed cookie that cannot be `decodeURIComponent`'d is treated as **not a session
   cookie** rather than 500-ing the auth hook (*"authentication is not the place for an unhandled
   parse error"*).
4. **JWT verify.** `jti` is **mandatory** — a token without one is refused, because it could never be
   revoked.
5. **Denylist.** `auth.revoked_token` is checked by `jti`.
6. **Live user row.** Re-read from the DB, requiring `active`. The token's role claim is **never
   authoritative**: a disabled or re-tenanted account is caught on the next request.
7. **Session epoch.** If the row's `session_epoch` differs from the claim's `ep`, the session is
   dead. A password change bumps the epoch and kills every other session instantly.
8. **Restricted tokens.** `mustChange` may reach only `/me/password`, `/me`, `/auth/logout`.
   `mfaPending` may reach only `/me/mfa/verify`. A `REQUIRE_MFA_ROLES` role without an enrolled
   factor may reach only `/me/mfa/enroll`, `/me`, `/auth/logout`.
9. **Student idle.** A student session uses a shared `auth.session_activity` store (so the window
   holds across replicas), with an in-process fallback for older databases.
10. **Custom-role mask.** `applyMask` runs on **every** authenticated door — including doors gated
    only by `authenticate` — so a DENY is enforced everywhere, not just where a kernel gate happens
    to live. The decision is memoised once per request.
11. **Failure taxonomy.** DB-outage codes (`ECONNREFUSED`, `08006`, `08003`, `57P03`) → **503**;
    everything else → 401. *"A database outage must not read as 'unauthorized'."*

Then `require(...roles)`, then `withUser(tenant, role, fn)`.

### 26.3 `withUser`, and a default that inverts the danger

The transaction helper:

```js
export const withUser = async (tenantId, role, fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('schoolos.tenant_id', $1, true)`, [tenantId]);
    await client.query(`SELECT set_config('schoolos.role', $1, true)`, [role]);
    await client.query(`SET LOCAL ROLE ${APP_ROLE}`);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { client.release(); }
};
```

`SET LOCAL` is transaction-scoped, so the role downgrade cannot leak onto a pooled connection later
handed to another request. The tenant comes from the authenticated user row, **never** from the
request body.

`db.js` carries a long comment about a security default that was inverted:

> *"The pool authenticated as `schoolos`, which OWNS every table and carries `rolbypassrls = true`
> ... RLS is not merely unenforced for the owner — it is *skipped*. Only the ... `withUser(...)` call
> sites were protected ... The 74 bare `q(...)` call sites ran as the owner with RLS bypassed, so any
> route using one was a cross-tenant read/write waiting for a bug."*

The fix makes the **constrained role the default**: `q()` now runs as `schoolos_app`, so RLS applies
to every ordinary query whether or not the author thought about tenancy. Privileged work must be
**explicit** (`sysq()` / `tx()` / `withUser()`), which makes it greppable and reviewable instead of
invisible. And the failure mode is the safe one: with the tenant GUC unset, the policy evaluates
`tenant_id = NULL` → **no rows**, so a missed call site fails **closed** (returns nothing) rather
than open (returns another school's children).

> **Honest flag — the residual owner path.** A handful of operations legitimately run with RLS
> bypassed: authentication bootstrap (finding a user by email before a tenant is known), platform
> supervision (plugin registry, `/metrics`, `schema_migrations`), and maintenance (retention,
> denylist sweeps, outbox). `sysq` is named distinctly so `grep -n sysq( src/` is a complete audit of
> privilege. But the reconcile worker builds its own client and runs as owner — a least-privilege
> violation the project records.

### 26.4 RLS: one predicate, four shapes

Tenant isolation is a single policy applied to every tenant table:

```sql
USING (tenant_id = app.current_tenant()::uuid)
```

applied `ENABLE` + `FORCE` (so even the table owner obeys) over the core tables, and swept onto
stragglers by later migrations. The variants:

- **Tenant isolation** — the default.
- **Row-owner pins** — `teacher.note` and `student.*` additionally pin `schoolos.user_id`, so a
  tenant match is not enough to see a person's private rows.
- **Kernel-only vaults** — `USING (false)` on `auth_otps`, `pickup_otp`, `reset_tokens`, and the MFA
  tables: the app role sees **zero rows**, even for its own tenant. Secret reads/writes happen only
  on the owner path.
- **Platform read** — `capability_contracts` is `USING (true)`, because contracts are platform-level.

Migration `074` is the "a policy must DENY, never RAISE" fix: pre-074 policies inlined
`current_setting(...)`, and an empty-string GUC raised `22P02` → a 500. `074` adds
`app.current_tenant()` / `app.current_user_id()` helpers returning TEXT deliberately, wrapping
`NULLIF(...,'')`, and rewrote all 94 predicates from a snapshot — **after catching that its first
version had hardened only 44 of 94, and refusing to report success on a partial rewrite.**

The app role has **no `DELETE`** (law D-35). The history of grants is a story of layers undoing each
other: broad grants (005) → ledger behind a `SECURITY DEFINER` function (006) → a re-baseline that
makes new tables born with zero grants (054) → the DELETE ban (072) → column scope (077). The one
documented DELETE exception is `student.mistake_note`.

> **Honest flags in the wall.** RLS is ENABLE-but-not-FORCE on ~30 tenant tables (all
> `teacher/family/student/parent/coord/curriculum/mastery/library…`); the `postgres`-owned default
> ACL can silently re-arm the DELETE grant on future postgres-authored tables until a superuser runs
> the printed command; and `users.password_hash` remains readable by the app role because login does
> `SELECT *`. Each is a known, tracked residual — not a hidden one.

### 26.5 Authentication methods, side by side

- **Password** — scrypt at `N=2^17, r=8, p=1`, with a legacy-cost fallback and a `dummyVerify`
  timing-equalization on a missing user, so response time does not reveal whether an email exists.
- **OTP** — a phone→SMS path. Codes are scrypt-hashed, stored in a kernel-only vault, TTL'd,
  attempt-bounded. Uniform 503 when the tenant's SMS rail is off, so there is no number
  enumeration. An undeliverable send **withdraws** the code and says so.
- **Google SSO** — server-side, deliberately off in the shipped product with honest copy; a
  dev-only `AUTH_DEV_SSO` simulator exists and is production-forbidden.
- **MFA** — TOTP (RFC 6238 ±1 window) or single-use recovery codes; staff-only; disable requires the
  password. A `mfaPending` token is a 5-minute restricted session.
- **API keys** — machine identities, read-only, scoped, `sha256`-stored, shown once.
- **Webhooks** — outbound, signed `x-schoolos-signature: t,v1=hmac(secret,'t.body')`, secret
  column-scoped away from the app role.

> **Honest flag — TOTP comparison.** The project records that TOTP is compared with `===` while the
> module exports an unused `constantTimeEqual`. A constant-time comparison exists but is not wired
> into the TOTP check. Small, real, tracked.

### 26.6 Login, in full, with all four outcomes

`POST /auth/login` (20/min) is the most-branched door in the product:

1. **Identifier-keyed lock** checked before the lookup, so a known and an unknown email answer the
   same 429 — no enumeration oracle.
2. Lookup joins `users` and the MFA vault, and `tenants`, scoped optionally by `tenantId`.
3. **Zero rows** → `dummyVerify` (burn the scrypt cost), bump the identifier counter, uniform 401.
4. **Multiple rows** (same email in several schools) → verify the password against the matching rows
   first; no match → uniform 401; a match → **409 with a school picker** listing the memberships
   (the person needs to choose).
5. **Wrong password** → bump both the per-account lock (shared across replicas) and the identifier
   counter; five failures lock for fifteen minutes; 429 or 401 accordingly. **A valid password
   clears the failure window** before any session is issued.
6. Legacy hashes are upgraded **after** a successful proof, guarded by the old value in the WHERE
   clause so a concurrent change is not overwritten.
7. **MFA enabled** → a plain JSON 401 carrying a 5-minute `mfaPending` challenge token (no
   307/Location).
8. **Success** → `issueSession` stamps `mustChange` from the row, signs the JWT with `jti` and `ep`,
   audits `Signed in (password)`, issues the cookie pair, and returns `{ token, user }`.
9. **`force_change`** → a 403 with `mustChange: true` and a **restricted token**.

`POST /auth/renew` re-issues a session from a live cookie/bearer and **retires the old `jti`** (a
fix: the old token used to stay valid until natural expiry). `POST /auth/logout` revokes the `jti`,
clears the cookies, and sends `Clear-Site-Data`.

### 26.7 The cookie story, and the five transports

The session is a **durable HttpOnly cookie** (`schoolos_session`, `SameSite=Strict`, `Secure` in
production) plus a readable CSRF cookie (`schoolos_csrf`). The bearer is memory-only on the client.
A cold open exchanges the cookie for a bearer via `POST /auth/renew`. Mutations carried by the
cookie need the double-submit CSRF token.

The problem the story has flagged repeatedly: only `liveApi.call` sends `credentials:'same-origin'`
**and** the CSRF header. The parent, student, coordinator, and teacher transports are **bearer-only**
— so under a cookie-session deployment, half the app's POSTs would CSRF-fail. The project states
this as a top risk: *"Either the whole app goes bearer-cookie-compliant or the transports unify."*

### 26.8 The security gate inventory

The controls the project pins by test, collected:

- scrypt cost + legacy fallback + timing parity; OTP default-cost scrypt (correct for short-lived
  secrets); TOTP ±1 window.
- webhook HMACs over **wire bytes** with uniform-401 anti-enumeration, tenant-bound secret trust,
  freshness, and `ON CONFLICT` replay no-ops.
- `isSecretKey` classification powering audit-risk, write-only forms, and value-stripping reads.
- column ACLs (users `UPDATE` limited to seven named columns; `sign_secret` unreadable).
- `uuidParams` on ~40 `:id` doors, so a malformed id is a 400, not a `22P02` 500.
- API-key scope allowlist; session epoch + `jti` denylist + 30-minute student TTL + Clear-Site-Data.
- the D-35 no-DELETE law, guarded by `tests/acl-d35.test.js`.
- the RLS boundary test, which pins that the boundary holds **and** that `/metrics` still returns
  data (a fail-closed silence is its own failure mode).

### 26.9 What the wall does not protect against

Honesty requires the limits:

- The audit hash is **unkeyed**, so a database superuser could recompute the whole chain — the
  verifier detects it after the fact but cannot prevent it from inside the database (the code says
  exactly this).
- A future plugin that forgets a `tenant_id` column, or uses `sysq` for user data, would bypass
  isolation; nothing *mechanically* forbids `sysq` misuse (only the naming convention and review).
- Some plugin PII tables rely on application-level scoping plus ENABLE-only RLS.
- The `postgres` default ACL can re-arm DELETE on future tables until a superuser acts.
- `users.password_hash` is app-role-readable (login `SELECT *`).
- No TLS/edge exists on the reference host, HSTS is inert, and there is zero alerting.

### 26.10 The one-sentence verdict on security

SchoolOS's security is unusually principled where it counts — the database enforces tenancy, tokens
are revocable and epoch-bound, secrets live in kernel-only vaults, and every meaningful write leaves
tamper-evident evidence — and unusually candid about the places where discipline has to substitute
for mechanism. The story would trust this system with a child's records, while insisting that the
known residuals be closed before it runs a hundred schools.

<!-- END OF PART 26 -->

---

## Chapter 27 — The Principal's Desk: Reports, Insight, and Oversight

### 27.1 Reports are computed, never stored

The product's report philosophy is stated in the workflow guide: reports are *"read doors that
calculate on the way out — no stored report snapshots except exams."* Attendance percentage, fee
aging, funnel conversion, class strength, teacher workload — every one is a SQL aggregate computed
at read time from the same rows the operational screens write. There is no cache to go stale and no
report to desync. The only deliberate stored snapshot is an exam report (Chapter 10), because a
report card is a statement about a moment.

The project flags one cost: the board pack runs several full-table aggregates, so its per-tenant
roll-up is cached for **30 seconds** (`BOARD_PACK_TTL_MS`) — *"so a hot owner surface cannot be used
as a cheap aggregate amplifier."* That is the only report cache, and it is bounded and explained.

### 27.2 Insights and BI (`ops.bi`)

`ops.bi` provides business-intelligence reads: attendance trends, fee aging, funnel conversion.
Because reads compute live, an insight changes the moment the underlying rows do. The plugin's
`cache_seconds` setting is declared but *never read* — one of the six unread settings — so the BI
plugin does no caching of its own today.

### 27.3 The Board Pack

`GET /reports/board-pack` produces the management roll-up, and `POST /reports/board-pack/snapshot`
freezes one; `GET /reports/snapshots` and `GET /reports/snapshots/:id` list and read them. Snapshots
use a **stable JSON** serialisation (`canonicalJson`, recursively sorted keys) so a content hash
computed at write time still re-derives after Postgres reorders JSONB keys — *"a snapshot's hash
must verify."* This is the same canonicalisation discipline used for exam digests.

### 27.4 Announcements, certificates, compliance, appraisals

A cluster of oversight doors:

- **Announcements** — `GET /announcements`, `POST /announcements`,
  `POST /announcements/:id/approve`, `GET /announcements/receipts`, plus an **emergency** variant
  (`POST /announcements/emergency`) and an **unacknowledged** tracker
  (`GET /announcements/:id/unacked`). A school announcement has an approval step and an
  acknowledgement ledger — because "we told them" and "they saw it" are different claims, exactly
  the queued-versus-delivered distinction in a different domain.
- **Certificates** — `GET /certificates`, `POST /certificates`, `POST /certificates/:id/sign`,
  `GET /certificates/:id/artifact`. A certificate is created, **signed** by an authority, and
  stored as an artifact — a real document with a signer.
- **Compliance** — `GET /compliance`, `POST /compliance`, `POST /compliance/:id/file`; the MPD vault
  (Chapter 24) is the disclosure wall; `GET /compliance/mpd` and its doc lifecycle.
- **Staff appraisals** — `GET /staff/appraisals`, `POST /staff/appraisals`. The screen comment says
  the model is *draft → shared → acknowledged*: an appraisal is written, shared with the staff
  member, and acknowledged by them. That three-state shape is the honest minimum for a performance
  document, and it is visible in the data.
- **Delegations** — `GET /delegations`, `GET /delegations/roster`, `POST /delegations`. Chapter 16
  explained the approval-authority delegation and its hard exclusions (never owner, never finance).
  The roster door excludes owner and the whole finance tier, because those can never be delegated.
- **Board/Group** — `GET /board-pack`, the `Group` screen's multi-campus roll-up. The story flags it
  plainly: the Group roll-up is **seeded fiction** (`makeRng`) and is the app's only
  `permissionError` consumer. There is no server campus scoping behind it (Chapter 3).

### 27.5 Documents, and the file surface's honest split

The **Documents** surface lists stored files (Chapter 20). Its read is real; its upload controls are
the "three dead wrappers" the story has named. A parent's `/parent/child/:id/documents` reads the
child-scoped files through `family.view`'s access rule. The `files.store` backend is solid; the
Documents screen is one of the most visible examples of a finished server with an unfinished
surface.

### 27.6 The principal's actual day, from the shell

For the principal, the shell assembles the loop:

- **Today** — the briefing, from `/capabilities` + `/dataset` (or live doors).
- **Attention** — the event feed.
- **Action Center** — the approval queue (`GET /actions`, `POST /actions/:id/decide`), the one place
  the action spine is used by a human.
- **People / Learning / Operations / Maintenance / Reception / Visitors / Insights / Memory /
  Automation / Fees** — the staff planes.
- **Audit** — the ledger.

The principal is the product's central decider: the action spine routes most escalations to
`owner_role='principal'`, the announcements need the principal's approval, exam publication needs a
second person (often the principal), and the clinic and transport notices land in the principal's
queue. Where the coordinator is the control room, the principal is the **authority** — and the
segregation-of-duties rules exist precisely to stop the principal from being a rubber stamp.

### 27.7 The honest flags on the oversight plane

- **Reports/BI are real SQL read models**, cached and capped; the demo figures on several screens
  are constants.
- **The Group roll-up is fiction**; there is no server campus scoping.
- **`AiGovernance`/`AiUsage` present fixtures as telemetry** with zero controls (Chapter 19).
- **The ItAdmin screen is largely disabled** because doors for key rotation and flags do not exist.
- **The Audit screen invents policy refs in demo mode**; in live mode it shows the real ledger.
- **Five teacher screens are unrouted**, and `TeacherNav` links to ten `NotFound` paths (Chapter 9).
- **Several newer Master-Action-Plan kernel doors have no polished screen yet** (Chapter 24).

### 27.8 The shape of oversight

If the operational domains (attendance, fees, library, transport) are the school's daily work, the
oversight plane is its conscience: reports that compute the truth, a board pack that can be frozen
and verified, announcements with acknowledgement ledgers, certificates with real signatures,
appraisals with an acknowledge step, and delegations that refuse to delegate the two authorities
that most need a check. The plane is not uniformly finished — some of it is fiction and some of it
is door-without-screen — but its **model** is right, and the model is what a school is buying.

<!-- END OF PART 27 -->

---

## Chapter 28 — The Timetable, the Substitution, and the Machinery of a School Day

### 28.1 Periods and slots: the grid becomes writable

For a long time the timetable was seed-only: `app.timetable_periods` and `app.timetable_slots`
existed, but a self-signup school could not create them. The `ops.timetable` write doors fixed
that. The model:

- A **period** has a short `seq` code, a `label`, a `start_time`/`end_time` in 24-hour HH:MM, a
  `is_break` flag, and a `sort_idx`. Validation enforces HH:MM format and `start < end`.
- A **slot** places a `subject`, a `teacher_name` (and optionally a `teacher_id`), a `room`, and
  optionally a `grade`/`section` into a period on a `day_of_week`.

Every write emits `timetable.published` and audits. Retirement is a status update (`retired_at`),
because the app role holds no DELETE — the timetable keeps its history.

### 28.2 The clash check: one implementation, shared

Creating or editing a slot runs `findClash`, which looks for four kinds of collision within the same
period and day: the **class** already has a subject, the **teacher** is already teaching, the same
**teacher name** is already teaching (when no id was supplied), or the **room** is in use. The
comment is important:

> *"The ONE clash check — same lookup the kernel `/timetable/clash-check` uses, shared so the two
> implementations cannot drift."*

This is a recurring discipline: when the same business rule must hold in two places, extract it
into one function rather than copy it. The story has seen the same principle in the audience
resolver (Chapter 7), the phone normaliser (Chapter 24), and the mask application (Chapter 5).

### 28.3 Substitution is an overlay, never an edit

When a teacher is absent, the coordinator records a **substitution**:

```
POST /plugins/ops.timetable/substitutions
{ "slotId": "<slot>", "date": "2026-06-16", "substitute": "Priya Iyer", "reason": "medical" }
```

The insert is an **UPSERT** on `(slot_id, date)`:

```sql
INSERT INTO app.timetable_substitutions (..., slot_id, date, absent_teacher, substitute, reason, assigned_by)
VALUES (...)
ON CONFLICT (slot_id, date) DO UPDATE SET substitute=EXCLUDED.substitute, reason=EXCLUDED.reason,
  status='assigned', assigned_by=EXCLUDED.assigned_by
RETURNING *
```

The original slot is **untouched**. A substitution is an overlay for one date, keyed uniquely by
`(slot, date)`, so re-assigning the same day replaces the substitute rather than stacking. The
absent teacher is read from the slot (`slot.teacher_name`) rather than trusted from the body. The
event is `substitution.assigned`, with `emitted_by: plugin:ops.timetable` and subject `slot:<id>`.
The date defaults to **IST today** — *"a UTC date lags 05:30, so after midnight IST the default here
would be 'yesterday' for the school."*

That last detail is India-first engineering: the school's day is an IST day, and a system that uses
UTC will place today's substitutions on yesterday for five and a half hours every night.

### 28.4 The deterministic suggester

`GET /substitutions/suggest` proposes a substitute with a rule, not a model:

```
rule: 'same-subject free teacher first, then any free teacher — deterministic ranking, never a model'
```

The ranking lives in `_shared/substitute-suggest.js` so that the leave-cover proposal in the kernel
and this timetable door offer the coordinator **exactly the same** suggestions. Deterministic,
explainable, and stable. The project's discomfort with opaque "AI" is visible here: where a decision
can be made by a rule, it is.

### 28.5 Attendance autofill: present-only, ownership-bound, idempotent

`POST /attendance/autofill` fills the unmarked students of a period as **present**. Three
properties:

1. **Ownership is enforced**, mirroring the kernel register door. A teacher can autofill only a
   class they own:

```js
if (!isOffice) {
  const owns = await c.query(
    `SELECT 1 FROM app.class_assignments WHERE tenant_id=$1 AND teacher_id=$2 AND grade=$3 AND section=$4 AND active LIMIT 1`, ...);
  if (!owns.rows[0]) return reply.code(403).send({ error: 'You can only autofill a class assigned to you...' });
}
```

The comment explains why: *"this door used to write attendance for ANY body-supplied class and date.
The kernel `/attendance/mark` door binds a teacher to their `app.class_assignments` rows; this
plugin door is the sibling surface and must apply the same ownership rule, or it re-opens the very
bypass the kernel closed."* A second door with weaker rules is a security regressions waiting to
happen, and this fix closes the sibling.

2. **It is idempotent and never touches human marks** — it inserts only for students with no
   attendance row that day:

```sql
INSERT INTO app.attendance (tenant_id, student_id, school_date, status, marked_by)
SELECT $1, s.id, $4::date, 'present', $5
FROM app.students s
WHERE s.tenant_id=$1 AND s.status='active' AND s.grade=$2 AND s.section=$3
  AND NOT EXISTS (SELECT 1 FROM app.attendance a WHERE a.tenant_id=$1 AND a.student_id=s.id AND a.school_date=$4::date)
RETURNING student_id
```

A single statement, unique-index-safe on concurrent replays. The audit is precise: *"N rows inserted
· M already marked · absences untouched."*

3. **The honest flag:** autofill always writes `present`, ignoring its own `autofill_default`
setting. So a school that configured a different default will not get it. The project lists this
among the unread settings.

### 28.6 The coordinator's command plane (`coord.view`)

`coord.view` (authority `coordinator + principal`; **teachers refused**) is the operational control
room. Its features:

- **Staffing** derived from `teacher.leave ⋈ timetable_slots` — who is absent and what they were
  supposed to teach. No writes from the read.
- **Substitution decide** with a **desk-aliasing guard**: sub-approvals decide only substitution
  payloads, so the substitution desk cannot approve unrelated actions.
- **SoD**: proposer ≠ decider.
- **Curriculum pace** versus term.
- **Workload as an aggregate, never rankings** — an `overload` boolean versus an
  `EXTRA_LOAD_LIMIT`, deliberately *no ranking of teachers*. The project's comment calls this a
  "no-rank policy," and it is an ethical design choice: a system should not produce a leaderboard of
  teachers that could be misused.
- **Least-loaded duty allocation** — a deterministic tie-break (load → name → id).
- **Escalations union** — concerns plus open family requests, in one queue.
- **A keyword-only copilot** with a private capped ledger (200/month, IST).

The six coordinator screens (`/coord/home`, `/coord/substitutions`, `/coord/workload`,
`/coord/curriculum`, `/coord/escalations`, `/coord/approvals`) are live via `coordApi`. Two honest
flags: every screen **fetches before its own gate** (a doomed 403, then the denied card), and
`coordApi` has no CSRF/credentials (Chapter 26's transport gap). `EscalationsQueue`'s "Resolve with
handoff note" only copies to the clipboard, honestly captioned.

### 28.7 Duty, PTM, and the human side of the timetable

- **Duty assignments** (`duty.assignment`) — a roster of who covers what, allocated by the
  least-loaded rule, emitted as `duty.assigned.v1`.
- **PTM (parent-teacher meetings)** — `GET/POST /ptm/slots` (teachers create slots), `POST /ptm/book`
  (parents book), and `POST /ptm/:id/notes` / `GET /ptm/:id/notes` with **teacher-private notes**
  gated to the teacher. A parent books; a teacher writes private notes; the two are firewalled.

### 28.8 Curriculum, mastery, and the learning loop

`curriculum.node` (read-only for the app role) and `curriculum.progress` model a curriculum tree and
progress against it. `mastery.evidence` and `mastery.state` model mastery: evidence has an
`expires_at`, and `mastery.state` holds a derived level plus a `derived_from` decay marker. The
decay is **idempotent** — applying the same decay twice does not double-apply — a property the
teacher copilot relies on. `teacher.homework` and `teacher.submission` (with
`UNIQUE(homework, student)` for one-shot submissions) complete the learning loop, and
`teacher.leave_request` feeds the HR/action path.

The project flags that five teacher screens for this machinery
(`CurriculumProgress`, `MasteryMap`, `DutyWorkload`, `ProgressStory`, and siblings) are **unrouted**
(Chapter 9). The backend exists; the surface does not.

### 28.9 The calendar

`CalendarScreen` presents the school calendar (academic years, terms, events). The academic year is
the root that money and academics hang off (Chapter 3), and exactly one year is current per tenant
by a partial unique index.

### 28.10 What the machinery teaches

The timetable cluster is where the product's **process discipline** is most visible: a substitution
is an overlay, not an edit; an autofill never overwrites a human mark; a clash check is one shared
function; a suggester is a rule, not a model; a workload is an aggregate, not a ranking; a private
note is firewalled from peers. None of these are glamorous. Together they are the difference between
a school tool that respects its staff and one that automates them carelessly.

<!-- END OF PART 28 -->

---

## Chapter 29 — The Shell, the Settings, and the Two Worlds Behind the Screen

### 29.1 The shell: where roles become a user experience

The application shell (`app/src/components/Shell.tsx`, ~663 lines) is the frame every signed-in user
sees. It does four jobs:

1. **Per-role navigation.** Each of the sixteen roles gets a nav array. The owner's nav is the full
   admin set (`/group`, `/people-admin`, `/plugins` + settings, `/rails`, `/roles`, `/migration`);
   the principal's spans the operational planes; the coordinator has the six `/coord/*` screens; the
   counselor has only `/today`, `/wellbeing-queue`, `/attention`, `/ask`; the technician has
   literally four items; the parent has nine `/parent/*` items; the student has six `/student/*`
   items plus library. The story has listed these throughout (Chapter 5's matrix).
2. **Live badge counts.** The nav shows `openActions` and `openWOs` from the API, so a principal can
   see at a glance that three approvals are waiting.
3. **A plugin-enablement filter.** A nav item whose module is disabled is hidden (or, for the owner,
   shown with a "Turn on" affordance). This is `useKernelNav`, reading the tenant's `/plugins` state.
4. **The topbar.** A command palette; a **CampusSwitcher** (client-side only — no server campus
   scoping, Chapter 3); an **Ask** door (light roles get their `/ask` page; staff dispatch a
   `schoolos:ask-toggle` event that opens the AiDock); a **NotificationsBell** polling
   `GET /notifications` every 45 seconds; and a **ProfileMenu** with theme (theme lives *only* in
   Settings), "Switch demo role", "Switch school", and sign-out (token + session clear +
   `POST /auth/logout`).

### 29.2 Routing and gates

`App.tsx` is a `BrowserRouter` with lazy chunks and a root `ErrorBoundary`. The gates, in order:

- **`AuthGate`** — the token is **never trusted locally**. It cold-validates via `GET /me` (plus a
  silent `POST /auth/renew` probe) and then hydrates `/dataset`. Only a live `/me` answer creates a
  session.
- **The `mustChange` gate** — decodes the `mustChange` claim and renders **only** the ChangePassword
  screen. A provisioned user with a temporary password literally cannot navigate elsewhere until
  they replace it.
- **`staffOnly` redirects** — a parent hitting a staff route is sent to `/parent/family`; a student
  to `/student/home2`. A staff member previewing a light-role screen gets a locked card.
- **`KernelGate plugin="people.admin"|"library"`** — gates routes by plugin enablement, so a school
  without the library never sees a library route.
- **Guard → PageShell → Suspense** around every route.
- **An unknown role fails closed**: it maps to a student-lite surface. If the server sends a role
  the client does not know, the client shows the narrowest surface, not the widest.
- `path="*"` → a `NotFound` with a role-aware home link.

Two honest flags repeat from earlier: `staffOnly` does not cover `/parent/*` and `/student/*`
*sub-paths* (so a staff member who types the URL can render the screen until a door refuses), and
the campus switcher is display-only.

### 29.3 Settings: theme, i18n, MFA, and the data-rights button

`Settings.tsx` is the only place a user can change the theme. It also:

- exposes **notification preferences** (device-local only — they are not stored server-side);
- surfaces the **i18n** state honestly: hi-IN covers ~50 keys (~57%), and the screen says so;
- hosts **MfaSection**, where a staff member can enrol/verify/disable MFA. The story flags a UX
  defect: the screen promises a QR code but ships a raw-text `otpauth` URI; recovery codes are shown
  once and that part is honest;
- has a **real DSR button** (the `pack.dpdp` path, Chapter 24);
- and five "not connected" controls that honestly say so.

### 29.4 i18n is hand-rolled and partial

There is no i18n library. The translation layer is hand-rolled and reaches **five files** (Login,
ChangePassword, Settings, MfaSection, Shell); `hi-IN` covers 50 keys, and all service-produced
strings are English-only. The marketing language about bilingual support is ahead of the code, and
the story says so. The honest part is that the Settings screen surfaces the 57% figure rather than
hiding it.

### 29.5 The plugin manager and the kernel mirror

The **Plugins** screen lets an owner see and toggle modules (Chapter 4). `PluginSettingsForm`
renders the module's `settingsSchema` and writes secrets write-only. `useKernel.tsx` is the
client-side mirror of the server's plugin state: `KernelGate` and the nav filter read it, and the
mirror is re-fetched from `GET /plugins`. Two honest flags: the inline toggle **applies the local
flip even when the server call fails** (a UI-state lie on error), and validation is client-only
(the server validates too, in the settings door).

The **effective access** layer (`server/src/effective-access.js` + `GET /me/effective`) is the
server's *render hints*: it tells the client which nav items and screens a role may reach. The
client's `grants.ts` is a **display-only mirror** of the server's `patternMatches`. `grants.ts` is
consumed by exactly one screen (the library, Chapter 11); a drift test (`ui-role-drift.test.js`)
fails the build when a client role list names a role the door refuses. The client guard is a
convenience; the server re-decides every door.

### 29.6 The demo world: `DEMO_BUILD` and `/dataset`

Now the story turns to the second world. Two facts frame everything:

1. **`LIVE_API` is a hardcoded literal.** The live transport is always compiled in. What is gated is
   `DEMO_BUILD = VITE_DEMO_MODE === '1'`, which in a production build **tree-shakes every demo
   screen to `NotFound`** — verified: `app/dist` has zero demo chunks.
2. **Most screens are two screens behind one export**: `DEMO_MODE ? <Demo/> : <Live/>`. The demo
   half is largely scripted fiction; the live half ranges from complete to honest-empty to
   permanently empty.

The demo dataset is **not a client mock**. `GET /dataset` is served by the server, which
function-strips and date-revives a bundle of mock modules. So demo and live share one data origin;
only the transport differs. For a self-signup school, the `/dataset` **allowlist** returns nothing
real — which is why Green Valley sees an empty world (Chapter 2).

### 29.7 The demo suite, honestly labelled

Within a `DEMO_BUILD`, a launcher and several scripted flows exist:

- **DemoBar** — which is actually the **production mobile tab bar**, not a demo artifact.
- **DemoDay** — scripted timers. Its three "suggested action" buttons **literally do nothing**
  (`onApprove={() => {}}`) while labelled "Run" despite "APPROVAL REQUIRED" text; edited drafts are
  never sent.
- **DemoParent** — an eight-phase fiction; "Pay now ₹18,500" just advances state; the audit is
  written as "Ms. Rao" regardless of who is signed in; "callback queued" while nothing is queued.
- **DemoSummary** — a scoreboard computed from constants while claiming it is "read from this
  session's live state."
- **Demo launcher** — "Start the switch→" is a styled `<span>` with no handler.

The story calls all of this what it is: a demo. The problem is only when a demo is mistaken for the
product. The product's own architecture (server-owned data, `DEMO_BUILD` tree-shaking) keeps them
separate, but a reader should know which is which.

### 29.8 `/live`: a demo harness, not a connection wizard

The `/live` screen (LiveMode) is **a demo-account harness**, not a wizard for connecting a real
school. It loads nine seeded accounts (no student), each showing four live panels
(`/students?grade=8&section=B`, `/attendance`, `/actions`, `/audit`, sliced to ≤12 rows). Its
honesty flaws:

- "Mark unmarked as absent" marks only the **first two** unmarked rows while its copy promises all.
- The "Backend connected" badge is **unconditional** — it does not probe.
- Sign-out is a **half-logout**: no `/auth/logout`, no cookie clear, so a cookie session can
  resurrect.
- MFA/mustChange/multi-tenant **dead-end as raw toasts**; the store identity/role/dataset are never
  re-hydrated after sign-in, so the previous tenant's chrome persists.
- The mark-all and other buttons are demo-grade.

Again: labelled a harness by the project, and described honestly here.

### 29.9 The two universes, mapped

The project's own honesty map divides the live half into:

- **Genuinely live**: parent/family suite, student home2/noticeboard, coord suite, FunnelBoard,
  VisitorsBoard, plugins, teacher homework/submissions/leave (with fixture fallback only while a
  door 404s), print/wellbeing staff queues, **Cases**, **HR**, **Clinic**, **Transport** (live band
  + route write model), **Statutory returns**, and **Operations** (work orders/assets/cases/route
  counts).
- **Demo/dataset screens**: Today, People, Fees (in-memory marking), Attendance (in-memory marking),
  Memory, and the Operations briefing prose.
- **Fixture-backed**: teacher home/brief, because the server doors do not exist.

### 29.10 The store, and the client's honesty problems

The client store (`state/store.tsx`, 73 importers) is **not persisted** (a reload returns to the
demo principal/north state), hydrates inbound-only and never writes, fabricates chat receipts at
fixed 900/2200 ms timers, never clears its `syncing` flag, and **invents audit policy-refs in demo
mode**. Three divergent "demo account" tables exist (liveApi 9, Login grid 12, store personas 12
with different names); only the first two can log in. The store is the client's soft spot, and the
story names it.

### 29.11 What the shell chapter establishes

The shell is where the product's honesty is won or lost for the person using it, because a button
that does nothing is a lie even when the server behind it is perfect. This chapter is a catalogue of
which buttons are real, which are demo, and which are dead. A reader evaluating SchoolOS should
treat the **server** as the product and the **SPA** as a work in progress with a strong core, two
excellent live suites (library, parent/family), and a long tail of demo theatre and unrouted
screens.

<!-- END OF PART 29 -->

---

## Chapter 30 — The Factory: How This Was Built, and How It Guards Itself

### 30.1 The quality engine

The project describes itself as *"the production factory"*: continuous hardening run as employees and
an orchestrator communicating through a `handoff/` directory (FROM/TO/STATUS protocol). But the
machinery that actually guards the code is the test suite and the factory gates.

**The test suite.** At the time of writing there are **150 test files**, run with the Node built-in
test runner:

```bash
cd server && npm test                                                    # full suite
node --test --test-concurrency=1 --test-timeout=60000 tests/<file>.test.js
TEST_DB_NAME=schoolos_<lane> npm test                                    # lane DB (D-41)
```

The suite is serial and slow (scrypt cost), and the project calls it *"the quality engine."* Its
coverage spans every plugin lane and the security invariants:

- an **RLS boundary** test that pins both that the boundary holds **and** that `/metrics` still
  returns data (a fail-closed silence is its own failure mode);
- `acl-d35.test.js` guards the DELETE ban;
- `audit-integrity.test.js` walks the hash chain;
- `comms-honesty.test.js` forbids a fake `'sent'`;
- `cases-privacy.test.js` pins the parent-filing flow;
- `plg-ai-budget.test.js` pins the PLG-7 budget fix;
- `rbac-catalog.test.js` pins the role list against the database CHECK;
- `ui-role-drift.test.js` fails the build when a client role list names a role the door refuses;
- and many lane tests.

**The harness.** `tests/helpers.js` drops and recreates a lane database as `postgres`, then runs
**migrate → bootstrap → seed** in that order (grants after tables exist), sets `DATABASE_URL`
*before* importing any `src` module (config reads it at import time), and offers `loginAs()`, which
walks the D-44 mustChange contract (403 → `/me/password` → fresh session) so a test gets a usable
token for a temp-password account.

The harness comment is a small lesson in test reliability: `ADMIN_DATABASE_URL` is set
**explicitly** rather than inherited, because two failure modes came from the ambient environment —
one where bootstrap silently skipped its superuser half (including the revocation that D-35
depends on, so the D-35 assertions could pass or fail depending on the developer's shell), and one
where it pointed at the wrong database and crashed every test in a file before a single assertion
ran. *"Both harness artifacts rather than product behaviour."*

> **Honest flag — the frontend has ZERO tests.** 44k LOC of React is guarded only by `tsc` in CI.
> This is the largest unguarded surface in the project, and the story has documented the
> consequences (dead controls, unrouted screens, a dishonest demo store) throughout.

### 30.2 The factory gates

`node scripts/check.js` is the single pre-ship gate, and it **fails closed on any red lamp**:

1. **Permission matrix (§43)** — runs `scripts/permission-matrix.js` and fails if any route is
   neither guarded nor reviewed-public.
2. **DB reachable** — with a 5-second connect budget (a stopped DB fails here, not with a hang).
   The comment records that the old "db reachable" step was *"an un-awaited async placeholder that
   could never fail."*
3. **Migrations applied** — every `migrations/*.sql` on disk must be tracked in
   `app.schema_migrations`, catching both "never migrated" and "partially migrated."
4. **RLS baseline** — the core catalog and revocation vault tables must exist.
5. **Fees read-plane OpenAPI builds** — the `FEES_OPENAPI` document must be version 3.1.0 with the
   required paths and schemas, every path carrying a GET with a 200 response.

Each DB step uses its own short-lived client, because *"after a failed connect, pg leaves a shared
client permanently broken."* The gate prints its evidence line and exits non-zero on failure.

The **permission matrix generator** (`permission-matrix.js`) scans every registered route and
produces `docs/PERMISSION-MATRIX.md`: the census of role-gated, auth-only, and public doors. It is
regenerated, not hand-typed, so it cannot drift. The **parity gate** (`parity-gate.js`) checks
UI-versus-door parity and fails when a write door has no UI caller at all — its allowlist is the
written list of deliberate exceptions. The project records that it *caught one of its own
regressions*.

### 30.3 Migrations as a discipline

`migrate.js` is advisory-locked, keeps a checksum ledger in `app.schema_migrations`, **hard-fails
on drift** of an applied file, and runs **one transaction per migration**. The story has noted the
consequences: the checksum ledger is why the project can say *"always cite filenames, never
numbers"* (there are four incompatible numbering systems in the history), and why a changed file
cannot silently re-run.

A recurring law for new tables: migration `054` established that **new tables are born with ZERO
grants**, and each migration grants explicitly. This is why the story keeps flagging the
`postgres`-owned default ACL — it is the one thing that can violate the "born with zero grants"
rule, and it cannot be removed without superuser.

### 30.4 CI, compose, and the two documented-by-accident inversions

The CI runs three jobs:

1. **server** — `ci-init-db` → migrate → permission-matrix → parity report → `npm test` → `check`.
2. **web** — `tsc` + `vite build` only (no tests, because there are none).
3. **security** — secret-scan + `npm audit`, fail-closed.

Two operational inversions the project records honestly:

- **The documented production start path cannot boot a fresh database.** The compose `api` service
  runs `bootstrap` **before** `migrate`, the exact inversion (OPS-1), because bootstrap references
  tables that do not exist until migrations have run. The harness and any careful operator run
  migrate first.
- **CI never builds or smoke-runs the image** (OPS-14), and runs Node 22 against the image's Node
  26. So the image is never exercised by CI.

Add the unscheduled workers (Chapter 25) and you have the full operational gap list: the code is
correct, and the deployment recipes have not caught up.

### 30.5 Backups

`backup.sh` is described by the project's audit as *"genuinely good"*: it dumps globals and roles,
dumps each database in custom format (`-Fc`), verifies each dump with `pg_restore --list`, writes a
`.incomplete` marker while a dump is in flight, uses `umask 077`, and keeps seven days. But nothing
schedules it — `crontab` is not installed on the reference host — and on that host the manual
dumps were mode `644` (world-readable child PII) while `backups/` was not in `.gitignore` (one
`git add -A` away from committing PII). The story flagged this in Chapter 1; it is real, and it is
minutes of work to fix.

### 30.6 The `.coop` factory: how the codebase was actually built

The project's engineering process is itself documented: five lanes and one master.

- **L1** server money/academics · **L2** server platform/security · **L3** records/data engine ·
  **L4** frontend money UI · **L5** frontend shell/identity · **S0** orchestrator (sole committer,
  gate runner, conflict resolver).

Mechanics: strict P2→P5 queues, per-task journal lines, file claims in `blocks.md`, a **D-34 help
channel** (post findings there first, then continue; S0 answers inline `[S0]`), a **D-27
90-minute-silence takeover**, **D-40** claim-migration-numbers-before-creating-files, **D-41** lane
test DBs, **D-10** full-suite runs S0-exclusive. There are **43 rulings D-1…D-44** (D-28 absent).
The load-bearing ones: **D-33** quality bar (code + negative tests + tsc + honest UI), **D-35** the
no-DELETE law, **D-37** auth-contract debts (all five landed), **D-44** the cross-zone repair law.
Waves 2–5 ran 4-hourly gates. The audit of record is `docs/PERFECT-100.md` — **122 findings**, with
honest scores of implementation **53/100** and enterprise-readiness **34/100** (the latter fell
because the audit went deeper, not because of regressions).

This process is why the code carries comments like *"P2-5"* and *"S0 fix A7"*: each is a scar from a
specific finding and its fix. The story's citations throughout are the direct benefit of that
discipline — the code tells you why it is the way it is.

### 30.7 The honesty artifacts

The project generates its own verification:

- `docs/PERMISSION-MATRIX.md` — the route census, regenerated.
- `docs/VERIFICATION.md` — generated by `verification-artifact.js` from the runner's own output,
  recording the run log, a source fingerprint, and the exit code. The hand-typed pass counts in
  older certificates were **removed** and replaced by a pointer to this generated file — real
  figures at that time were **87 test files · 637 declared cases**.
- `.ui-audit/` screenshots (predate the sprint), `.audit/` (sealed pre-`.coop` corpus), and the
  `handoff/` protocol.

The project is unusually careful here: where a number can be generated, it is; where a count was
hand-typed and drifted, it was replaced by a generated artifact. This is the same instinct that
produced the honesty gauges in `/metrics`.

### 30.8 The dev-DB sediment and the git risk

Two facts from the project's own audit:

- **Seventy-three `schoolos*` databases** exist on the reference host — sediment of lane runs and
  review rounds (`r20a…r21j`, `rev20_*`, `s0fix1…7`…). The dev database trails the migration tree
  (75 applied ending `077` while the file tree went further), so *"it works locally"* is weaker than
  it looks.
- **Git was the single biggest live risk**: at the time of the map, three days of the hardest work
  (migrations, custom roles, the PERFECT-100 remediation) sat uncommitted while only the orchestrator
  held git. A disk event would have erased it. Since then, commits have landed (the log shows the
  campaigns), but the pattern — a long tail of uncommitted work behind a single committer — is a
  process risk worth naming.

### 30.9 What the factory teaches

The codebase's greatest asset is not any single feature. It is the habit of **writing down why**.
Every non-obvious decision in this book — the D-35 DELETE ban, the `075` hash pinning, the
`074` deny-never-raise rewrite, the PLG-7 budget archaeology, the sandbox-delivery rule, the
self-approval lattice — carries a comment that names the failure it prevents. That is why this story
could be written at all. A reader inheriting this code inherits its reasoning, not just its behavior.

<!-- END OF PART 30 -->

---

## Chapter 31 — A Full Term

### 31.1 The premise

It is now **4 September 2026**. Green Valley Public School has run on SchoolOS for eleven weeks.
The import landed 411 students; the fees generated; attendance is marked daily; the library is open;
the buses report delays; the clinic has seen 62 children; the admissions pipeline converted 47
enquiries into 22 enrolments; and the audit ledger holds tens of thousands of rows. This chapter
follows a single school day and then pulls back to the term, showing how the pieces the story has
described in isolation actually move together.

### 31.2 5:41 a.m. — the transport desk

A GPS integration posts a position for Route 14. `POST /plugins/transport.gps/positions` with
`delayMins: 12`.

The corridor runs: JWT verified, `jti` checked, user row re-read, mask applied, `require(transport,
...)` passes, `lifecycleGate` reads the plugin as `enabled`, `withUser` opens the RLS transaction.
The governance budget passes, so the position is written to `plugin_transport_gps.positions` and a
`gps_delay` event to `app.transport_events`. `meterPlugin` counts it. The riders are counted (38).
`emitEvent('gps.position')` writes an event and an outbox row. And because `delayMins >= 10`, a
kernel approval action is raised, linked to the event through `event_action_link`, with a
pre-drafted WhatsApp message and `proposed_by` the transport user.

The audit says `GPS position ingested`, outcome *"position recorded · approval-required notice
raised."*

What has actually happened: a machine noticed, and a person has not yet been asked. That is the
correct state at 5:41 a.m., before a principal is awake.

### 31.3 6:15 a.m. — the principal wakes and looks at Today

Principal **Rekha Deshmukh** opens the app on her phone. `AuthGate` cold-validates her token with
`GET /me` and a silent `POST /auth/renew`. The shell loads her nav, fetches `GET /actions` and sees
**three open approvals**: the transport notice, a clinic notice (a child sent home yesterday), and a
fee-hike consultation. She opens the Action Center.

The transport action is owned by `owner_role: 'principal'`. She may decide it. She reads the draft:
*"Bus 14 is running approximately 12 minutes late today…"* She taps **Approve**. `POST /actions/:id/decide`.

The decide handler locks the action, confirms it is open, checks the SoD lattice (she is the owning
authority; no self-approval risk because the proposer is the transport user), updates the status,
and runs the `kind:'message'` executor. The executor resolves the **real recipients** — the 38
riders' guardians, from the union of `app.guardians` and `family.child_link` — and inserts a
**queued** `app.communications` row with template `TRANSPORT_DELAY` and a dedup key. It emits
`action.decided.v1` and writes lineage. The audit says *"Approved action: Notify 38 guardians…"*,
outcome `executed: message <id>`.

**No message has been sent.** It is queued. The dispatcher will claim it when scheduled.

### 31.4 7:05 a.m. — the gate

A grandparent arrives to collect a child. The front desk (coordinator) logs a visitor with
`purpose: 'pickup'` and the child's id. `POST /plugins/ops.visitors/visitors` writes the visit with a
`V-` badge.

The desk then requests pickup: `POST /visitors/:id/pickup`. The handler reads the primary guardian's
phone from `app.guardians`, **normalises it before minting anything**, generates a CSPRNG six-digit
code, scrypt-hashes it with a random salt, and stores it in `plugin_visitors.pickup_otp` — the
kernel-only vault that denies the app role. The visit flips to `pickup_pending`.

Because Green Valley configured an SMS rail in Chapter 17, the rail sends. The provider accepts, so
the visit is not compensated away. The ledger gets a **redacted** body as evidence; the event is
`visitor.pickup.requested.v1`; the audit names the carrier and says the secret is in the kernel
vault.

The grandparent reads the code from their phone. The desk verifies it: `timingSafeEqual` on the
scrypt hash, TTL checked, attempts checked. On success the code is consumed (once), the visit is
`verified`, and the event fires. The desk completes the visit. A child is released to a verified
adult, and the ledger has the whole chain.

Had the grandparent been the *wrong* adult, every wrong code would have written a **high-risk** audit
row — an attempted release — and after five attempts the desk would have been sent to the audited
photo-ID override instead. The system's bias is to stop the child and force a human to explain.

### 31.5 7:55 a.m. — the first period

Ms. **Priya Iyer** opens `/attendance` on the staff-room tablet. She picks 6-A. `GET /attendance`
returns the roster with null statuses for today.

She marks the children. `POST /attendance/mark` with a marks array. The handler:
- validates the payload (≤300, valid statuses, UUIDs);
- resolves that she owns 6-A via `app.class_assignments` (the coordinator handed it to her in June);
- reads the prior register (empty today) to diff;
- upserts each mark (unique on student/date);
- writes **one audit row per changed student** (`recorded present`, `recorded absent`), stamping the
  authority as `class assignment`;
- for each newly absent child, resolves guardians from **both** family shapes and queues an
  `ABSENCE_NOTICE` (whatsapp) with a dedup key;
- emits `attendance.absences`;
- returns `{ marked, absent, noticesQueued, guardiansResolved }` — counting what happened.

Two children are absent. Two notices are queued. When the dispatcher later runs, two parents get an
honest message. And the audit ledger now answers, for any date, *who was changed, from what to what,
by whom, under what authority.*

### 31.6 8:40 a.m. — a late bus, a queued message, a dispatcher

Back to 6:15's approval. On the compose schedule, `comms-dispatcher.js` claims the transport
message (and the two absence notices) with `FOR UPDATE SKIP LOCKED`, resolves the WhatsApp rail, and
calls the provider. The provider accepts, so the rows become `sent` with `sent_at`. Only a real
carrier can ever set `delivered_at`. Had the school not configured WhatsApp, the rail would return
`logger`, the dispatcher would mark it sandbox, and `/metrics` would show a non-zero
`comms_sandbox_sent` — *the lie made measurable*, not hidden.

### 31.7 9:20 a.m. — the library

A Grade 8 student, **Diya**, comes to the library desk. Librarian **Kavita Nair** scans a copy
(`GET /plugins/library/scan`), finds it available, and issues it (`POST /loans`). The handler locks
the book, checks Diya's policy (max loans, no lost book), picks and locks an available copy, computes
the due date, inserts the loan, sets the copy `issued`, fulfils any of Diya's own active holds,
notifies her, emits `library.loan.issued.v1`, and audits. Fifteen days later a return will compute
the fine and advance the wait queue.

Because `library` is opt-in and was turned on in Chapter 4, and because a `librarian` account exists,
the desk works. Had the school not enabled it, `/library` would not even appear.

### 31.8 10:05 a.m. — a concern

A teacher notices a child withdrawn and files a **concern**: `POST /teacher/concern`. It is a
staff-only surface. The concern gets an append-only status trail. The teacher routes it — but the
sometimes-subtle rule holds: **a filer may not route their own concern** (a segregation-of-duties
pin). So it goes to the counselor's queue.

The counselor, **Meera Nair**, sees it on the wellbeing plane. If the child later files something in
the **safety box** (student-initiated), the safety box has structural anonymity: an anonymous report
stores `reporter_user_id` NULL, and the reader tier excludes the classroom teacher. The counselor is
a real, least-privileged role now — and the story has already noted, twice, that the counselor has
**doors but no screens**. So today, the counselor works the API or a typed URL. That gap is real.

### 31.9 11:30 a.m. — the clinic

A child is brought to the infirmary with a fever. The coordinator (nurse lane) logs a visit
(`POST /clinic/visits`), temperature 38.2, outcome `first_aid`. The visit is append-first. No notice
fires, because `first_aid` is not severe.

At 1:10 p.m., the child worsens and is sent home. Rather than editing the first visit — which the
system forbids — the nurse **appends a correction** that escalates the outcome to `sent_home`. The
correction handler notices the escalation and raises a per-instance kernel approval action
`clinic.notify.<visitId>`, owned by the **principal**, with a pre-drafted message. The clinic never
sends directly. Rekha approves it at 1:25 p.m., and a queued `CLINIC_SENT_HOME` message lands in the
comms queue. The medical history is a trail of appended facts, not an editable form.

### 31.10 12:00 p.m. — money

A parent, **Kavita Mehta** (Aarav's mother), opens `/parent/fees` and pays Term 2 tuition. She taps
**Pay ₹42,000**. `POST /fees/payments`:
- validates the obligation ids and method;
- checks the `Idempotency-Key` (none this time);
- (cash only) checks the counter-PIN — not applicable for UPI;
- locks the obligations in sorted order;
- confirms each belongs to her child via `family.child_link`;
- confirms no open payment exists (one open per obligation);
- allocates the amount and inserts the payment (`status='initiated'`) plus allocations;
- emits `payment.initiated`, records a `payment_events` row, audits `Initiated payment`.

The client then creates a gateway order (`POST /plugins/payments.razorpay/orders`) and hands Kavita
the checkout. She pays. **The gateway never settles the ledger.** It calls the public webhook, which
verifies the HMAC over wire bytes, checks freshness, dedupes the event, resolves the tenant, and
records a fact in `plugin_razorpay.order_log`.

Later, the finance head opens `/fees` and confirms: `POST /fees/payments/:id/confirm`. The handler
locks the payment, checks it is `initiated`, checks the obligation is not void, and — the key
security step — verifies the gateway reference **against the provider's own record**. It is found in
`plugin_razorpay.order_log`, so `verifiedBy = 'razorpay'`, `settledVia = 'gateway'`. Under a tenant
advisory lock it mints a deterministic receipt number, marks the payment `confirmed`, distributes
`paid_cents` across the allocations, settles installments in order, inserts the immutable
`fee_receipts` row, renders a PDF into `files.store` (scoped to the child so Kavita can download
it), and queues a `FEE_RECEIPT` WhatsApp with a dedup key. The audit says *"Confirmed payment
(gateway reference razorpay verified against the provider's own record)"*.

Money has moved exactly once, evidence exists, and the family can see the same number the office
sees.

### 31.11 2:00 p.m. — the admissions funnel

A walk-in family enquires. The admissions clerk captures an enquiry
(`POST /plugins/admissions.funnel/leads`): the duplicate guard checks one open enquiry per
(guardian, class, session); the phone is normalised; the lead and a `stage_history` row are written;
`admission.enquiry.captured` fires. The **default workflow rule** planted at signup — *"Admissions:
enquiry → follow-up pipeline"* — would fan out a follow-up topic… **if the workflow-worker were
scheduled.** It is not, by default. So today the fan-out does not happen, and the story names that
plainly rather than pretending.

Two weeks later, the family accepts an offer. Moving the lead `offer → enrolled` does **not** create
a student. It raises a kernel approval, `students.create.<leadId>`, owned by the principal. Rekha
approves. The admissions executor creates the `app.students` row **and** the `enrollment_history`
row in the same transaction. The funnel never wrote core records; the approval did.

### 31.12 3:30 p.m. — exams

A terminal exam is ready. The teacher entered marks over the week (including a bulk paste of 300
rows with per-row error reporting, and an attendance-floor check of 75%). The exam owner requests
publication: `POST /exams/:id/publish` raises `exams.publish.<examId>`. The **proposer cannot
execute it**. A second person (Rekha) opens the approvals queue and approves. Then the publisher
executes: the assembly is a pure function of `(marks, weightage, grade scale, board policy)`, a digest
is computed, a report snapshot is written per student, and the exam is marked `published` with
`weightage_locked`.

A month later, a senior review corrects one child's internal marks. **The exam report row is never
updated.** A moderation overlay is written with a new digest and the original digest preserved. Both
the office and the family (through the shared `servedReport` model) see the corrected 90/A2 — never
the pre-moderation score. The family's trust is preserved by a join, not a promise.

### 31.13 4:15 p.m. — a maintenance round

A janitor reports a leaking tap. A teacher logs a work order (`POST /work-orders`), priority
`medium`, and the SLA is set to 120 hours. The facilities desk assigns it; the technician accepts,
goes en route, arrives, repairs. Each step moves exactly one position along the ten-state machine.
At `resolved`, the system stamps `sla_breached` from the deadline set at creation. The job's
`wo_events` rows are its own history.

The technician's screen has live transitions but no client role check — the buttons render for
anyone, and the server refuses after the click. An honesty defect, noted.

### 31.14 5:00 p.m. — the day-worker (or not)

If the day-worker is scheduled, it runs four contained daily steps including dunning. Overdue
obligations produce queued reminders with IST quiet-hours awareness (during quiet hours it writes
**nothing**) and seven-day dedup. If no SMS rail is configured, those reminders drain log-only.

Because the day-worker is not scheduled by default, the story reports the truth: the reminders may
not fire on schedule. The door exists; the schedule does not.

### 31.15 6:30 p.m. — the audit, before sleep

Rekha opens `/audit` and scrolls. She sees, for one day: `Signed in (password)` rows for staff; the
GPS ingestion and the approval and the queueing; two attendance audit rows per absent child; a clinic
visit and an appended correction and a notice approval; a payment confirmation with the gateway
verification named; an enquiry captured; a work order resolved with its SLA outcome; and her own
decisions. Every row names the actor, the role, the policy, the risk, and an outcome.

She also, once a week, runs `GET /audit/verify`. It recomputes the chain and returns 200 with a
classification. It reports how many rows are hash-pinned (v2), how many are legacy (v1,
unverifiable), and how many are archived — and it states its own limitations. If a row had been
altered, the run would say so, and would audit itself as a high-risk event.

### 31.16 The term, in aggregate

Over eleven weeks, the school accumulated:

- **411 students**, each with a roster row, and 411 guardians rows plus child links for the families
  who use the app;
- **13 classes, 23 sections, 11 subjects**, one current academic year;
- **hundreds of attendance rows** (one per child per day), each an audited change;
- **fee plan templates** and, from one Generate, **thousands of obligations** and installments —
  generated idempotently and never double-billed;
- **dozens of payments**, each with a receipt, a PDF artifact, and a communications row;
- **a library** with copies, loans, holds, and fines;
- **a bus route** and its GPS log and delay actions;
- **a clinic log** with append-only corrections;
- **an admissions pipeline** with stage history;
- **a maintenance queue** with SLAs;
- **a case log** with append-only tickets;
- **a plugin catalog** mostly enabled, three credential rails configured;
- and an **audit ledger** with tens of thousands of hash-chained rows.

Every one of those rows was written by an authenticated, role-checked, tenant-scoped request that
left evidence and, usually, a promise in the outbox.

### 31.17 The loop, closed

Step back and the product's claim comes into focus. The loop is **Today → Attention → Ask → Action →
Memory**:

- **Today** is the assembled state of the school (the `/dataset`/live reads).
- **Attention** is the event feed and the queues.
- **Ask** is the copilots and the reports — deterministic, honest about their limits.
- **Action** is the action spine, where a human decides under segregation of duties.
- **Memory** is the ledger and `memory_entries`, where decisions and their expected-versus-actual
  outcomes are kept.

Under the loop, four mechanisms make it real rather than decorative: **RLS** (tenancy is enforced in
the database), the **audit ledger** (evidence with a hash chain), the **outbox** (promises kept by
workers, not by hope), and the **plugin registry** (a school runs only what it switched on). Around
them, the honesty rules keep the product from lying: queued is not sent, sent is not delivered;
sandbox is labelled; a deterministic copilot is called deterministic; a return that cannot be
produced is refused; a machine may notice but not decide; a report is frozen; a consent is
immutable; a name is not an identity.

That is what a full term looks like. It is not perfect — the story has marked dozens of flaws, from
the money UI to the counselor's missing screens to the unscheduled workers to the name-based
classroom identity. But the *architecture* is honest, and the school's records are its own.

<!-- END OF PART 31 -->

---

## Chapter 32 — The Door Census (Kernel): Every Registered API Surface

### 32.0 How to read this census

This chapter lists the kernel doors — the routes registered in `server/src/app.js`,
`server/src/routes.js`, and `server/src/onboarding.js` — grouped by domain. It is a map, not a
tutorial: for the story of a door, follow the chapter references. The **authoritative** live count
is generated by `scripts/permission-matrix.js` into `docs/PERMISSION-MATRIX.md`; the story uses the
230 doors extracted from the current source at the time of writing. Plugin doors are Chapter 33.

A note on honesty: no plugin door is ever *unguarded* — the project's matrix enforces "every route
gated or reviewed-public." Where a door is public it is stated; where it is `authenticate`-only it
is stated; otherwise a role list follows from the code.

### 32.1 Health and readiness

- **`GET /health`** — public. Returns 200 `ok` or 200 `degraded` when the DB is down, plus build
  identity. Never 503, so humans can see the state.
- **`GET /ready`** — public. 503 unless the DB answers and the server is not draining. This is what
  an orchestrator/LB must poll.

### 32.2 Authentication and session (app.js)

- **`POST /auth/login`** — public, 20/min. The four-outcome door (200 / 409 picker / 401 MFA / 403
  mustChange).
- **`POST /auth/renew`** — authenticated, 30/min. Re-issues a session and retires the old `jti`.
- **`POST /auth/logout`** — authenticated. Revokes the `jti`, clears cookies, `Clear-Site-Data`.
- **`POST /auth/otp/request`** — public, 5/min. Mints a phone OTP (kernel-only vault).
- **`POST /auth/otp/verify`** — public, 10/min. Consumes the OTP and issues a session.
- **`GET /auth/google/start`** — public. Begins server-side OAuth (off by default with honest copy).
- **`GET /auth/google/callback`** — public. Completes OAuth; account must pre-exist by email.
- **`POST /auth/google/demo`** — dev-only, `AUTH_DEV_SSO`-gated. Production-forbidden.
- **`GET /me`** — authenticated. Live identity from the user row.
- **`GET /me/effective`** — authenticated. Role capabilities/render hints for the client.
- **`GET /me/tenants`** — authenticated. The caller's cross-tenant memberships.
- **`POST /me/switch`** — authenticated, 10/min. Re-issues a session for a chosen school; supports
  inline password step-up on the 403 path.
- **`POST /me/password`** — authenticated, 10/min. Changes the password; bumps `session_epoch`.
- **`POST /me/reset-request`** — public-ish reset initiation (email rail; 503 if unconfigured).
- **`POST /me/reset-confirm`** — consumes a single-use reset token; code always redacted in the
  ledger.
- **`POST /me/mfa/enroll`** — authenticated, 10/min. Enrols a TOTP factor.
- **`POST /me/mfa/verify`** — authenticated. Verifies a TOTP/recovery code for the MFA challenge.
- **`POST /me/mfa/disable`** — authenticated, 5/min. Disables MFA (requires the password).
- **`POST /me/step-up`** — authenticated. Issues a short-lived step-up token for sensitive actions.

### 32.3 Machine credentials (app.js)

- **`GET /api-keys`** — owner/itadmin. Lists keys (hash only, raw shown once at creation).
- **`POST /api-keys`** — owner/itadmin. Mints a scoped read-only key.
- **`DELETE /api-keys/:id`** — owner/itadmin. Soft-revokes.
- **`GET /webhooks`** — owner/itadmin. Lists subscriptions (secret column-scoped away).
- **`POST /webhooks`** — owner/itadmin. Registers a signed webhook.
- **`DELETE /webhooks/:id`** — owner/itadmin. Soft-removes.

### 32.4 Tenant context (app.js)

- **`GET /dataset`** — authenticated. The server-owned demo dataset (allowlisted; empty for
  non-demo tenants).
- **`GET /capabilities`** — authenticated. Enabled plugin flags only.
- **`GET /metrics`** — owner/itadmin (or API key with `metrics.read`). Prometheus text with the
  honesty gauges.
- **`GET /usage`** — owner/itadmin. Plugin usage/metering reads.

### 32.5 AI and workflow (app.js)

- **`POST /ai/call`** — staff (not student), 30/min. The only mutating door with no audit row.
- **`GET /ai/calls`** — owner/itadmin. The AI ledger (no prompt text stored).
- **`POST /ai/eval`** — 5/hr. Batch eval harness.
- **`GET /workflow-rules`** — owner/principal/itadmin.
- **`POST /workflow-rules`** — owner/principal/itadmin, 20/min.
- **`DELETE /workflow-rules/:id`** — owner/principal/itadmin. Soft-disable (D-35).

### 32.6 Onboarding (onboarding.js)

- **`POST /onboard/signup`** — public, 3/min, kill-switched. The one owner-path tenant creation.
- **`POST /onboard/school`** — owner. Updates the school profile (locked JSONB read-modify-write).
- **`GET /onboard/status`** — authenticated. The setup checklist.

### 32.7 Custom roles (routes.js)

- **`GET /roles`** — authenticated read of custom roles.
- **`POST /roles`** — owner/itadmin. Creates a role (mask validated; amplification ceiling).
- **`PATCH /roles/:key`** — owner/itadmin. Edits a role.
- **`DELETE /roles/:key`** — owner/itadmin. Retire-in-place (rename out of the live namespace).
- **`POST /roles/:key/assign`** — owner/itadmin. Binds a role to a user.
- **`POST /roles/:key/unassign`** — owner/itadmin. Clears the binding.

### 32.8 People and roster

- **`GET /students`** — authenticated; parent-scoped to their children; student refused; phones
  hidden from non-roster roles.
- **`GET /students/:id`** — authenticated; parent own-child only; student 404.
- **`POST /students`** — owner/principal/coordinator/admissions/itadmin. Validated create (class
  must exist, admission number unique by name, duplicate name refused, DOB/gender validated).
- **`GET /students/:id/360`** — staff. Unified student view.
- **`POST /students/:id/identity`** — staff. Records identity documents.
- **`GET /school/staff`** — office roles. Minimal staff picker (id/name/role only).
- **`GET /school/classes`** — authenticated read of the school's class structure.
- **`PUT /school/classes`** — owner/principal/itadmin. Upserts classes/sections, retires removed.
- **`GET /school/subjects`** — authenticated read.
- **`POST /school/subjects`** — owner/principal/itadmin. Idempotent subject add.
- **`GET /class-assignments`** — authenticated; teachers see their own.
- **`POST /class-assignments`** — owner/principal/coordinator. One active owner per class.
- **`DELETE /class-assignments/:id`** — owner/principal/coordinator. Soft-retire.

### 32.9 Attendance

- **`GET /attendance`** — authenticated; parents own-children; student refused.
- **`POST /attendance/mark`** — owner/principal/coordinator/teacher. Class-ownership asserted from
  student rows; per-change audit; absence notices queued.
- **`GET /attendance/qr`** / **`GET /attendance/my-qr`** / **`POST /attendance/qr-mark`** — QR
  marking surfaces.

### 32.10 Calendar and academic structure

- **`GET /academic-years`** — authenticated.
- **`POST /academic-years`** — owner/principal/finance/finance_head. One-current enforced.
- **`POST /academic-years/:id/activate`** — owner/principal. Sets the single current year.
- **`POST /timetable/clash-check`** — staff. The shared clash lookup (`ops.timetable` mirrors it).

### 32.11 Fees and money

- **`GET /fees/settings`** — fee roles. Tenant fee policy.
- **`PUT /fees/settings`** — owner/finance_head. Late-fee rate/grace/cap, thresholds, receipt series.
- **`POST /fees/late-fees/run`** — owner/finance_head. Applies the configured late-fee policy.
- **`GET /fees/entitlements`** — fee roles. Plan feature gating.
- **`GET /fees/heads`** / **`POST /fees/heads`** — fee-head taxonomy.
- **`GET /fee-plans`** / **`POST /fee-plans`** — list/create fee-plan templates.
- **`POST /fee-plans/:id/generate`** — idempotent obligation generation with a billing run.
- **`GET /fees/obligations`** — role-tiered (staff whole tenant, parent own children).
- **`GET /fees/obligations/:id`** / **`GET /fees/obligations/:id/invoice`** — obligation + invoice.
- **`POST /fees/obligations/:id/void`** — owner only; refuses `paid_cents > 0`.
- **`GET /student/fees`** — student's own fee view.
- **`POST /fees/payments`** — parent/finance/owner/principal. Idempotent initiation, one open per
  obligation, counter-PIN for cash, allocations.
- **`POST /fees/payments/:id/confirm`** — finance/finance_head/owner. Maker/checker; gateway
  verification against the provider's own record; deterministic receipt; artifact; queued receipt.
- **`GET /payments`** / **`GET /payments/:id`** — payment ledger reads.
- **`POST /payments/:id/refund`** — gateway leg first; ledger byte-identical on refusal.
- **`POST /payments/reconcile`** — sweep for ghost/missing/orphan.
- **`POST /payments/:id/mark-matched`** — manual reconciliation marking.
- **`GET /payments/recon-runs`** — reconciliation run history.
- **`GET /reports/fees/summary`** — fee summary read model.
- **`POST /fees/pins`** — owner/finance_head. Enrolls counter-PINs.
- **`GET /fees/receipts`** / **`GET /fees/receipts/:id`** / **`GET /fees/receipts/:id/pdf`** —
  immutable receipts and their PDFs.
- **`GET /fees/delivery`** — delivery status of fee communications.
- **`GET /fees/installments`** — installment schedules.
- **`POST /fees/concessions`** / **`GET /fees/concessions`** /
  **`POST /fees/concessions/:id/decide`** — concession requests and decisions.
- **`POST /fees/dunning/run`** — queues overdue reminders (IST quiet hours, 7-day dedup).
- **`POST /billing-runs/:id/void`** — voids a generation run.

### 32.12 Transport (kernel)

- **`GET /transport/routes`** — fleet read.
- **`POST /transport/events`** — transport event write (delay etc.).
- **`GET /transport/runs`** / **`POST /transport/runs`** — daily run model.
- **`POST /transport/runs/:id/board`** / **`GET /transport/runs/:id/board`** — boarding/unboarding.
- **`GET /transport/runs/:id/eta`** — ETA read.
- **`GET /transport/attendants`** / **`POST /transport/attendants`** /
  **`PUT /transport/attendants/:id/verify`** — attendant model + verification.
- **`GET /transport/fares`** / **`PUT /transport/fares`** / **`POST /transport/fares/quote`** —
  fare policy and quoting.
- **`GET /transport/inspections`** / **`POST /transport/inspections`** — vehicle inspections.
- **`GET /transport/compliance-report`** — transport compliance read.

### 32.13 Facilities and work orders (kernel)

- **`GET /work-orders`** — 11 staff roles. Work-order list + SLA policy.
- **`POST /work-orders`** — report a job (SLA-typed).
- **`POST /work-orders/:id/status`** — technician/facilities/coordinator/principal/owner. Strict
  ten-state machine; breach stamping.
- **`GET /assets`** — staff. Asset inventory.

### 32.14 Cases

- **`GET /cases`** — staff only. The full school case log.
- **`GET /cases/:id`** — staff, or a parent who filed it.
- **`GET /my-cases`** — a parent's own complaints.
- **`POST /cases`** — any role; `origin`/`owner`/`priority`/`slaHours` derived, not trusted.
- **`POST /cases/:id/status`** — staff. Case state move.

### 32.15 Action spine and delegations

- **`GET /actions`** — staff. The approvals queue.
- **`POST /actions/:id/decide`** — staff, with the full SoD lattice.
- **`GET /actions/stale`** — staff. Overdue actions.
- **`POST /actions/stale/escalate`** — owner/principal. Escalation digest.
- **`GET /delegations`** / **`GET /delegations/roster`** / **`POST /delegations`** — bounded
  approval delegation (never owner/finance).
- **`POST /owner/actions`** — owner. Raise an owner action.

### 32.16 Events, audit, memory, notifications

- **`GET /events`** — event feed roles. Human-readable spine.
- **`GET /events/lineage`** — event feed roles. Event→action lineage.
- **`GET /audit`** — owner/principal/itadmin/finance tier. The ledger.
- **`GET /audit/verify`** — owner/itadmin (or `audit.verify` key). Always 200 with findings + limits.
- **`GET /memory`** — owner/principal/itadmin.
- **`POST /memory`** — owner/principal/coordinator/finance. Decision with expected-vs-actual.
- **`GET /notifications`** — authenticated. Own + broadcast.
- **`POST /notifications/read`** — authenticated. Own-only mark-read.
- **`GET /communications`** — comms roles. The communication ledger (redacted fields).

### 32.17 Governed platform

- **`GET /plugins`** — authenticated (a GET that self-heals the catalog; settings stripped for
  non-privileged).
- **`POST /plugins/:id/enable`** — owner/principal/itadmin. Manifest-resolved, entitlement,
  dependency-checked.
- **`POST /plugins/:id/disable`** — owner/principal/itadmin + step-up. Drain protocol.
- **`POST /plugins/:id/settings`** — owner/principal/itadmin. Schema-validated; secret-class
  audited by key name only.

### 32.18 Migration / import

- **`GET /migration/sources`** — owner/coordinator/itadmin.
- **`POST /migration/sources`** — register a source.
- **`POST /migration/sources/:id/stage`** — stage metadata.
- **`POST /migration/sources/:id/stage-rows`** — stage rows (SECURITY DEFINER purge).
- **`POST /migration/sources/:id/validate`** — validate + error report.
- **`POST /migration/sources/:id/commit`** — idempotent commit.
- **`POST /migration/activate`** — owner/principal. The trust receipt.

### 32.19 Oversight: reports, announcements, compliance, certificates

- **`GET /reports/board-pack`** / **`POST /reports/board-pack/snapshot`** /
  **`GET /reports/snapshots`** / **`GET /reports/snapshots/:id`** — board pack + verifiable snapshots.
- **`GET /brief/principal`** — the principal's brief.
- **`GET /owner/home`** / **`GET /principal/home`** — role home aggregates.
- **`GET /notices`** — notices read.
- **`GET /announcements`** / **`POST /announcements`** / **`POST /announcements/:id/approve`** —
  announcement lifecycle with approval.
- **`POST /announcements/:id/ack`** — acknowledge.
- **`GET /announcements/:id/acks`** / **`GET /announcements/:id/receipts`** /
  **`GET /announcements/:id/unacked`** — acknowledgement ledger.
- **`POST /announcements/emergency`** — emergency broadcast.
- **`GET /automation/templates`** — automation template list.
- **`GET /compliance`** / **`POST /compliance`** / **`POST /compliance/:id/file`** — compliance
  obligations.
- **`GET /compliance/mpd`** / **`POST /compliance/mpd/docs`** /
  **`POST /compliance/mpd/docs/:id/retire`** — the MPD disclosure vault.
- **`GET /certificates`** / **`POST /certificates`** / **`POST /certificates/:id/sign`** /
  **`GET /certificates/:id/artifact`** — certificate create/sign/artifact.
- **`GET /policy-documents`** / **`POST /policy-documents`** — the versioned constitution.
- **`GET /staff/appraisals`** / **`POST /staff/appraisals`** — appraisals (draft → shared →
  acknowledged).

### 32.20 Compliance datasets: RTE, MPD, payroll, billing, NEP

- **`GET /rte/overview`** / **`POST /rte/lottery/import`** / **`POST /rte/reimbursements`** — RTE/EWS.
- **`GET /payroll/overview`** / **`PUT /payroll/staff/:id`** / **`POST /payroll/runs`** /
  **`POST /payroll/runs/:id/disburse`** / **`GET /payroll/runs/:id/ecs-file`** — payroll-lite.
- **`GET /billing`** / **`POST /billing/checkout`** / **`POST /billing/webhook`** — the platform's
  own billing to the school.
- **`GET /nep/profile`** / **`PUT /nep/r3`** / **`GET/POST /nep/activities`** / **`POST /nep/hpc`** /
  **`GET /nep/hpc/:studentId`** / **`POST /nep/fln`** / **`GET /nep/fln`** — NEP profile/activities.
- **`GET /school/infra`** / **`PUT /school/infra`** — infrastructure register.
- **`GET /meetings`** / **`POST /meetings`** — committee meetings (used by fee-hike governance).
- **`GET /health-checks`** / **`POST /health-checks`** — health/safety checks.
- **`GET /meals`** / **`POST /meals`** — mid-day meal diary.
- **`GET /staff-trainings`** / **`POST /staff-trainings`** — staff training diary.
- **`GET /staff-verifications`** / **`POST /staff-verifications`** — staff verification records.
- **`GET /dpdp/breaches`** / **`POST /dpdp/breaches`** / **`POST /dpdp/breaches/:id/contain`** —
  breach register + contain.
- **`GET /safety/checklist`** / **`POST /safety/checks/:id/attest`** — safety checklist + attestation.
- **`GET /attendance/qr`** / **`POST /attendance/qr-mark`** / **`GET /attendance/my-qr`** — QR
  attendance.
- **`GET /staff-attendance/qr`** / **`POST /staff-attendance/scan`** /
  **`POST /staff-attendance/mark`** — staff attendance.
- **`GET /returns/udise/validate`** — UDISE return validation.
- **`GET /admissions/followups`** — deterministic stuck-first follow-up queue.
- **`GET /public/disclosure`** — public disclosure surface (parent-reviewed).
- **`GET /exams/:id/board-policy`** / **`POST /exams/:id/board-policy`** — per-exam board policy.

### 32.21 The census in one sentence

Two hundred and thirty kernel doors, every one gated or reviewed-public, spanning identity, roster,
attendance, money, transport, facilities, cases, the action spine, governance, compliance datasets,
and a long tail of India-specific returns. Read together with the plugin doors (next chapter), this
is the complete API surface of the product — and the map a future engineer would use to find the
door behind any button.

<!-- END OF PART 32 -->

---

## Chapter 33 — The Door Census (Plugins): Every Module's Surface

### 33.0 How to read this census

Each plugin registers its own doors under a prefix (usually `/plugins/<plugin-id>/...`). This
chapter lists them grouped by module, with the purpose the story has established. The authoritative
count comes from `scripts/permission-matrix.js`; the story extracted **249** plugin-door
registrations from the current source. Every one carries the **lifecycle gate** (`409` unless the
module is enabled for the tenant) and the plugin's role gate.

### 33.1 `people.admin` (born enabled)

- **`POST /plugins/people.admin/users`** — provision a staff/parent/student account. Refuses the
  owner role; principal only by owner; student requires a `studentId` binding; temp password shown
  once.
- **`GET /plugins/people.admin/users`** — list accounts (owner/itadmin; no password fields).
- **`POST /plugins/people.admin/users/:id/suspend`** — suspend (never the owner; principal only by
  owner).
- **`POST /plugins/people.admin/users/:id/activate`** — reactivate.
- **`POST /plugins/people.admin/users/:id/reset-password`** — issue a temp password (force_change).
- **`POST /plugins/people.admin/students/:id/transfer`** — the section-change flow; writes
  `enrollment_history` **before** the flip, same transaction.
- **`POST /plugins/people.admin/students/:id/promote`** — promote a student.
- **`POST /plugins/people.admin/students/promote/bulk`** — bulk promotion.
- **`POST /plugins/people.admin/students/:id/withdraw`** — withdraw a student.
- **`PATCH /plugins/people.admin/students/:id`** — record edits (shared parsers with create/import).
- **`GET /plugins/people.admin/students/:id/history`** — enrollment history.
- **`POST /plugins/people.admin/import/students`** — per-row CSV-style import (per-row savepoints).

### 33.2 `family.view` (has doors for parents)

- **`GET /parent/home`** — the family aggregate (children, attendance today, assignments, consents,
  attention, requests, actions).
- **`GET /parent/child/:id/assignments|timeline|academics|attendance|exams|transport|documents`** —
  per-child reads, each `assertOwnChild`-gated.
- **`GET /parent/consents`** — pending/decided consents for the family.
- **`POST /parent/consents`** — staff authority authors a consent (the school asks).
- **`POST /parent/consents/:id/decide`** — the parent decides; immutable once decided.
- **`POST /parent/requests`** / **`GET /parent/requests`** — the request center (append-only events).
- **`POST /parent/requests/:id/transition`** — staff advances the ticket (validated at door and DB).
- **`GET /parent/links`** / **`POST /parent/links`** / **`DELETE /parent/links/:id`** — staff manage
  guardian↔child links.
- **`POST /parent/report-discrepancy`** — a parent flags a record without editing it.
- **`POST /parent/leave-request`** — raises `parent.leave.<id>` kernel action (coordinator-owned).

### 33.3 `parent.assistant` (deterministic)

- **`GET /parent/brief`** — per-child brief.
- **`POST /parent/copilot/ask`** — keyword-ask confined to own children; `HONEST_UNKNOWN` fallback.
- **`POST /parent/copilot/draft`** — template drafts with a banned-word tone filter.
- **`GET /parent/explain/:topic`** — plain-language explanations (the `?topic=` mismatch flagged).

### 33.4 `student.world` (kiosk plane)

- **`GET /student/home`** — next class, homework (paper default, digital labelled), upcoming test,
  counts.
- **`GET /student/homework`** — own homework list.
- **`GET /student/results`** — published results via `servedReport`.
- **`POST /student/mistakes`** / **`GET /student/mistakes`** / **`DELETE /student/mistakes/:id`** —
  private notes; delete is the one D-35 exception.
- **`POST /student/flashcards`** / **`GET /student/flashcards`** — private flashcards.
- **`GET /student/tasks`** / **`POST /student/tasks`** — study tasks.
- **`POST /student/print`** / **`GET /student/print/mine`** — print jobs.
- **`GET /student/print/queue`** / **`POST /student/print/:id/done`** /
  **`POST /student/print/:id/cancel`** — staff queue + completion/cancel.
- **`GET /student/noticeboard`** — class-scoped noticeboard (not the tenant-wide event feed).
- **`POST /student/wellbeing`** / **`GET /student/wellbeing`** — anonymous-capable wellbeing intake
  and the counselor/principal reader.
- **`GET /student/session`** — the kiosk idle-countdown contract.

### 33.5 `teacher.classroom`

- **`POST /plugins/teacher.classroom/homework`** — post homework (attachment scheme allowlist).
- **`GET /plugins/teacher.classroom/homework`** — own homework only (`created_by = self`).
- **`GET /plugins/teacher.classroom/homework/:id`** — one assignment + submissions.
- **`POST /plugins/teacher.classroom/homework/:id/submit`** — student one-shot submission.
- **`POST /plugins/teacher.classroom/submissions/:id/review`** — assigning teacher only.
- **`GET /plugins/teacher.classroom/submissions`** — inbox (incl. `missing`, presence-not-
  attribution).
- **`GET /plugins/teacher.classroom/roster`** — class roster.
- **`POST /plugins/teacher.classroom/lessons`** / **`GET .../lessons`** /
  **`POST .../lessons/:id/reflect`** — lesson logs and reflection.
- **`GET /teacher/home`** — the teacher command-center aggregate.
- **`GET /teacher/leave/mine`** — own leave (the state-write-in-GET flag).
- **`POST /teacher/leave`** — request leave (→ kernel action).
- **`GET /duty/roster`** / **`GET /workload/mine`** — duty and workload reads.

### 33.6 `teacher.copilot` (deterministic)

- **`GET /teacher/brief`** — the day brief.
- **`POST /copilot/ask`** / **`POST /copilot/draft`** — keyword ask/draft.
- **`GET /curriculum/tree`** / **`POST /curriculum/progress`** — curriculum tree + audited check-off.
- **`GET /mastery/class/:grade`** / **`GET /mastery/student/:id`** — mastery maps (idempotent decay).
- **`GET /analytics/class/:grade`** — class analytics.
- **`GET /progress/story/:studentId`** — progress narrative.
- **`GET /teacher/usage`** — the capped private ledger (200/day).

### 33.7 `teacher.support` (safeguarding)

- **`POST /teacher/concern`** / **`GET /teacher/concerns`** — file/list concerns.
- **`POST /teacher/concern/:id/route`** — route (filer may not route own).
- **`POST /teacher/concern/:id/outcome`** — record an outcome.
- **`GET /teacher/concern/:id/events`** — append-only status trail.
- **`POST /safety/box`** — student files (anonymous-capable, structural anonymity).
- **`GET /safety/box`** / **`GET /safety/box/assignees`** / **`GET /safety/box/summary`** — readers.
- **`POST /safety/box/:id/assign`** / **`POST /safety/box/:id/close`** — assignment/closure.
- **`POST /plugins/teacher.support/doubt`** / **`GET /teacher/support/doubts`** /
  **`POST /teacher/support/doubts/:id/answer`** /
  **`POST /teacher/support/doubts/:id/promote-faq`** — doubts + FAQ promotion.
- **`POST /interventions`** / **`GET /interventions`** / **`POST /interventions/:id/transition`** /
  **`POST /interventions/:id/reassess`** — intervention plans.
- **`GET /ptm/slots`** / **`POST /ptm/slots`** / **`POST /ptm/book`** — PTM slots and booking.
- **`POST /ptm/:id/notes`** / **`GET /ptm/:id/notes`** — teacher-private PTM notes.

### 33.8 `coord.view` (coordinator/principal)

- **`GET /coord/home`** — staffing + gaps.
- **`GET /coord/curriculum-monitor`** — pace vs term.
- **`GET /coord/teacher-workload`** — aggregate workload, **no ranking**.
- **`GET /coord/escalations`** — concerns + open requests union.
- **`POST /coord/substitution/decide`** — decide a substitution payload (desk-aliased).
- **`POST /coord/duty/allocate`** — least-loaded duty allocation.
- **`POST /coord/copilot-lite`** — keyword-only copilot with a private capped ledger.

### 33.9 `ops.timetable`

- **`GET /plugins/ops.timetable/grid`** — the timetable grid.
- **`POST /plugins/ops.timetable/substitutions`** — UPSERT overlay `(slot, date)`.
- **`GET /plugins/ops.timetable/substitutions/suggest`** — deterministic substitute ranking.
- **`POST /plugins/ops.timetable/attendance/autofill`** — present-only, ownership-bound, idempotent.
- **`GET/POST /plugins/ops.timetable/periods`** / **`PATCH .../periods/:id`** /
  **`POST .../periods/:id/retire`** / **`POST .../periods/seed-default`** — period lifecycle.
- **`GET .../conflicts`** — clash reads.
- **`GET/POST /plugins/ops.timetable/slots`** / **`PATCH .../slots/:id`** /
  **`POST .../slots/:id/retire`** — slot lifecycle (one shared clash check).
- **`GET .../first-period-teacher`** — first-period read.

### 33.10 `ops.visitors` (born enabled)

- **`POST /plugins/ops.visitors/visitors`** — log a visitor; badge.
- **`GET /plugins/ops.visitors/visitors`** — list passes.
- **`GET /plugins/ops.visitors/guardian-lookup`** — child→guardian lookup, phone-tail masked.
- **`POST .../visitors/:id/checkin`** — check in.
- **`POST .../visitors/:id/pickup`** — mint+deliver guardian pickup OTP (vault, redaction,
  compensation).
- **`POST .../visitors/:id/pickup/verify`** — verify (constant-time, single-use, high-risk audit on
  rejection).
- **`POST .../visitors/:id/complete`** — fail-closed release with an audited override.
- **`POST .../visitors/:id/deny`** — deny entry.

### 33.11 `alone transport.gps`

- **`POST /plugins/transport.gps/positions`** — ingest a position (budget-checked; delay ≥ 10 raises
  an approval).
- **`GET /plugins/transport.gps/positions`** — read (30-day retention; labelled simulation when
  empty).
- **`GET/POST /plugins/transport.gps/routes`** / **`PATCH .../routes/:id`** /
  **`POST .../routes/:id/retire`** — route write model (retire, never delete).
- **`POST /plugins/transport.gps/stops`** / **`PATCH .../stops/:id`** /
  **`POST .../stops/:id/retire`** — stop write model (dense sequence).

### 33.12 `exams.assessment`

- **`POST /plugins/exams.assessment/exams`** — create (weightage must sum to 100).
- **`GET /plugins/exams.assessment/exams`** — list.
- **`POST .../exams/:id/marks`** / **`POST .../exams/:id/marks/bulk`** — per-write audit; attendance
  floor; per-row bulk errors.
- **`POST .../exams/:id/publish`** — raises a kernel approval.
- **`POST .../exams/:id/publish/execute`** — SoD-guarded deterministic assembly + freeze.
- **`GET .../exams/:id/reports/:studentId`** — report read with moderation overlay.
- **`POST .../exams/:id/reports/:studentId/moderate`** / **`POST .../moderations/:mid/decide`** —
  moderation (overlay; re-derived grades).
- **`GET .../moderations`** — moderation list.
- **`POST .../exams/:id/recompute`** — recompute.
- **`GET/PUT .../board-policy`** / **`POST /exams/:id/board-policy`** — board policy.

### 33.13 `pack.cbse` / `pack.dpdp`

- **`GET /plugins/pack.cbse/rules`** — read-only rules R1–R6.
- **`GET /plugins/pack.cbse/validate/exam/:examId`** — validation.
- **`GET /plugins/pack.cbse/export/oasis/:examId`** — OASIS CSV export.
- **`POST /plugins/pack.dpdp/consent`** / **`GET .../consent/state`** — immutable consent ledger.
- **`POST /plugins/pack.dpdp/dsr`** / **`GET .../dsr`** / **`GET .../dsr/:id/export`** /
  **`POST .../dsr/:id/execute`** — SAR export/erasure (approval + step-up; idempotent, PII-free).

### 33.14 Money rails: `payments.razorpay`, `payments.upi`, `accounting.tally`

- **`POST /plugins/payments.razorpay/orders`** — create a gateway order (503 unconfigured).
- **`POST /plugins/payments.razorpay/webhook`** — public, HMAC-verified, records facts; never settles.
- **`POST /plugins/payments.upi/links`** — build a `upi://` link.
- **`POST /plugins/payments.upi/webhook`** — public, HMAC-verified, replay-deduped.
- **`GET /plugins/accounting.tally/daybook`** — IST day-book of confirmed payments.
- **`POST /plugins/accounting.tally/export`** — content-addressed XML export.
- **`GET /plugins/accounting.tally/exports`** — export history.

### 33.15 Comms rails: `comms.whatsapp`, `rails.*`

- **`comms.whatsapp`**: **`GET /plugins/comms.whatsapp/templates`** /
  **`POST /plugins/comms.whatsapp/templates`** (DLT registry) /
  **`GET /plugins/comms.whatsapp/receipts`** (read-only receipts; no send door).
- **`rails.email` / `rails.sms` / `rails.whatsapp`**: headless (`routes: []`) — they expose provider
  adapters consumed by the dispatcher and the pickup/reset doors, not public HTTP doors.

### 33.16 Operations & BI: `ops.bi`, `ops.import`, `ops.udise`, `files.store`, `library`

- **`GET /plugins/ops.bi/attendance`** / **`/fees/aging`** / **`/funnel`** / **`/homework`** — BI
  read models (compute-on-read).
- **`GET /plugins/ops.import/schema/:kind`** / **`POST .../validate-mapping`** /
  **`POST .../shadow`** — dry-run import probes (JSON rows; not wired to the kernel staging path).
- **`GET /plugins/ops.udise/columns`** / **`GET /plugins/ops.udise/export`** — UDISE return
  (refuses without a UDISE code; gender `not_recorded`).
- **`files.store`**: **`POST /plugins/files.store/upload`** /
  **`GET /plugins/files.store/:id/download`** / **`GET /plugins/files.store`** — private storage,
  audited both on grant and refusal.
- **`library`** (26 doors): desk overview, books (create/bulk/edit/retire/copies), copies edit, scan,
  loans (issue/return/renew), overdue, reservations (request/fulfil/cancel/mine), members, fines
  (list/settle/mine), acquisitions (request/vote/decide/mine), catalog (desk + borrower), cover,
  desk settings + notification settings, reports.

### 33.17 HR and clinic

- **`hr.leave`**: **`POST /plugins/hr.leave/leave`** / **`POST .../leave/:id/cancel`** /
  **`GET .../roster/:date`** / **`GET .../leave`** — absence as a fact (no approval flow).
- **`health.clinic`**: **`POST /plugins/health.clinic/visits`** / **`POST .../visits/:id/correct`** /
  **`POST .../visits/:id/sick-pass`** / **`GET .../visits`** /
  **`POST .../sick-passes/:id/revoke`** — append-first, approval-gated notices, nurse-lane PII.

### 33.18 Admissions funnel

- **`POST /plugins/admissions.funnel/leads`** — capture (session window + dedupe).
- **`GET /plugins/admissions.funnel/leads`** — list (PII masked per role).
- **`PATCH .../leads/:id`** — correct.
- **`POST .../leads/:id/stage`** — lattice transition; offer→enrolled raises the kernel approval.
- **`GET .../leads/:id/history`** / **`GET .../leads/:id/activities`** /
  **`POST .../leads/:id/activities`** / **`POST .../leads/:id/documents`** /
  **`GET .../leads/:id/offer-letter`** — history, activities, documents, offer letter.
- **`GET .../summary`** / **`POST .../sla/run`** — summary and SLA run.

### 33.19 The census in one sentence

Two hundred and forty-plus plugin doors across twenty-nine modules, each gated by its role list and
its lifecycle, together with the kernel's two hundred and thirty — a complete, generated map of a
system that grew a domain at a time, each domain keeping its own tables, its own events, and its own
honest commentary about what it does not yet do.

<!-- END OF PART 33 -->

---

## Chapter 34 — The Screen Census: Every Route the Browser Knows

### 34.0 How to read this census

`app/src/App.tsx` registers 143 `<Route>` entries over ~141 distinct paths (some are relative
library sub-routes). This chapter lists them by area, with what each screen is, who sees it, and
whether it is live, demo, or a stub, based on the story's findings. Where a screen is unrouted or a
route is an orphan, it is stated.

### 34.1 Public and auth

- **`/login`** — the sign-in card. Email/password (four-outcome matrix), a phone OTP tab, a
  permanently-disabled Google button with honest copy, and a demo role grid in `DEMO_MODE`. The
  OTP wrappers in `liveApi` are dead; Login has its own fetches.
- **`/onboard`** — the three-step signup card (Chapter 2).
- **`/account/password`** — the forced password-change gate (rendered alone by the `mustChange`
  gate).
- **`/`** and **`*`** — role-aware redirect / NotFound.

### 34.2 The staff loop

- **`/today`** — the briefing. Live `/capabilities`+`/dataset` in live mode; demo money buttons
  mutate the demo store only.
- **`/attention`** — the event feed. Real `GET /events`; filters local.
- **`/action-center`** — the approvals queue. Real `GET /actions` + `POST /actions/:id/decide`.
- **`/next`** — honest "PREDICTED — by design not supported" placeholders.
- **`/ask`** (staff, via the shell Ask door / AiDock) — the question surface. In the demo, a
  keyword-regex fixture; on the server, deterministic copilots (Chapter 19).

### 34.3 People and academics

- **`/people`** — the roster screen (dataset-driven in demo).
- **`/people-admin`** — the People console (live lifecycle: create/suspend/activate/reset/transfer/
  promote/withdraw + CSV import). Destructive confirms use raw `window.confirm`.
- **`/people/:id`** — PersonDetail (a 360-style person view).
- **`/classes`** — classes & sections + subjects + class ownership (live write doors).
- **`/timetable`** — the timetable grid (reads `ops.timetable`).
- **`/calendar`** — the school calendar.
- **`/learning`** — the learning screen (local publish + six toast-only controls; the real exam
  surface is unrouted).
- **`/library`** and its sub-routes **`catalog`**, **`catalog/:id`**, **`catalog/new`**, **`issue`**,
  **`return`**, **`members`**, **`fines`**, **`holds`**, **`requests`**, **`reports`**,
  **`settings`** — the fully-real library desk (the app's only `grants.ts` consumer).
- **`/library/desk`**, **`/library/insights`**, **`/library/setup`** — library desk sub-screens.

### 34.4 Attendance, fees, money

- **`/attendance`** — the register. Live fetch + `POST /attendance/mark`; demo marking is in-memory.
- **`/fees`** — obligations tabs on real doors; the Payments tab is permanently empty; Collect/
  reminder/waive/export/receipt are demo store mutations or toasts (Chapter 7's central UI gap).
- **`/fees/plans`** — the one honest money flow: real create/generate/list.
- **`/billing`** — platform billing to the school.
- **`/returns`** — statutory returns (UDISE/OASIS/Tally) fetched-with-bearer.
- **`/payroll`** — payroll-lite.

### 34.5 Parent suite

- **`/parent`** / **`/parent/family`** — FamilyHome (children, today, consents, requests).
- **`/parent/child/:id`** — per-child detail.
- **`/parent/consents`** — consents (decide-or-nothing).
- **`/parent/requests`** — request tracking.
- **`/parent/fees`** — UPI/Razorpay payment initiation.
- **`/parent/copilot`** — the deterministic assistant.
- **`/parent/chat`** — a parent chat surface.
- **`/parent/complaints`** — a parent's own cases.

### 34.6 Student suite

- **`/student`** / **`/student/home2`** — StudentHome2 (next class, counts, session countdown,
  print/mine).
- **`/student/homework`** — homework list (paper default).
- **`/student/mistakes`** — private mistakes (deletable).
- **`/student/flashcards`** — private flashcards.
- **`/student/tasks`** — study tasks (only `kind==='task'` ticks persist).
- **`/student/results`** — results ("soon" toast / published reports).
- **`/student/learning`**, **`/student/portfolio`**, **`/student/fees`** — learning/portfolio/fees.
- **`/noticeboard`** — the class noticeboard.
- **`/print-queue`** — staff print queue.

### 34.7 Teacher suite (largely unrouted)

- **`/teacher`** — TeacherHome.
- **`/teacher/homework`**, **`/teacher/submissions`**, **`/teacher/leave`** — real doors (bulk
  review is sequential POSTs; promised progress counter never renders).
- **`/teacher/exam-marks`** — the REAL exam surface, **not routed in prod**.
- **`/teacher/copilot`**, **`/teacher/curriculum`**, **`/teacher/mastery`**,
  **`/teacher/progress-story`** — **unrouted** (files exist; `TeacherNav` links to NotFound).
- **`/teacher/concerns`**, **`/teacher/safety`**, **`/teacher/support`**, **`/teacher/doubts`**,
  **`/teacher/interventions`**, **`/teacher/ptm`**, **`/teacher/duties`**,
  **`/teacher/analytics`**, **`/teacher/lessons`** — the teacher's broader surfaces, many
  unrouted or fixture-backed.

### 34.8 Coordinator suite

- **`/coord/home`**, **`/coord/substitutions`**, **`/coord/workload`**, **`/coord/curriculum`**,
  **`/coord/escalations`**, **`/coord/approvals`** — all live via `coordApi`; all fetch before their
  own gate.

### 34.9 Operations and maintenance

- **`/operations`** — Ops board (work orders/assets/cases/route counts live; briefing prose
  sample-labelled).
- **`/operations/hr`** — the HR board (absences as facts).
- **`/maintenance`**, **`/maintenance/work-orders`**, **`/maintenance/work-orders/:id`**,
  **`/maintenance/assets`**, **`/maintenance/assets/:id`**, **`/maintenance/report`**,
  **`/maintenance/technician`**, **`/maintenance/preventive`**, **`/maintenance/inspections`**,
  **`/maintenance/intelligence`**, **`/maintenance/inventory`**, **`/maintenance/map`**,
  **`/maintenance/vendors`** — the wide maintenance family. Only WO list/status and assets have real
  doors; the rest are honest stubs or demo; inventory and vendors are orphan routes.
- **`/facilities`** — facilities overview.
- **`/visitors`** — the VisitorsBoard (real check-in → pickup OTP → verify → complete/deny).
- **`/reception`** — the AI Front Desk surface over demo data.
- **`/transport`** — the transport screen (live band + demo map/drill).
- **`/transport/setup`** — the route/stop write model.
- **`/clinic`** — the infirmary screen (nurse-lane; asks the role question first).
- **`/incidents`** — incidents.

### 34.10 Governance and admin

- **`/audit`** — the ledger (real read).
- **`/memory`** — institutional memory (reads; `apiMemory` dead export).
- **`/constitution`** — the policy reader (server store versioned; screen copy can self-contradict).
- **`/automation`** — the Automation screen (demo-only keyword compiler vs. the real rule engine).
- **`/ai-governance`**, **`/ai-usage`** — fixtures presented as telemetry, zero controls.
- **`/plugins`**, **`/plugins/settings`**, **`/plugins/settings/:id`** — plugin manager + settings
  forms (real doors; inline toggle applies local flip even on failure).
- **`/rails`** — RailsBoard (real `/capabilities` + plugin badges).
- **`/roles`** — RolesAdmin (real CRUD; retire-in-place; no delete button).
- **`/it`** — ItAdmin (largely disabled; the doors do not exist).
- **`/data-health`** — data health checks.
- **`/migration`** — the migration console (live path wired + a "simulated" toggle).
- **`/settings`** — user settings (theme, i18n, MFA, DSR).
- **`/group`** — multi-campus roll-up (seeded fiction; the only `permissionError` consumer).
- **`/owner/home`**, **`/principal/home`**, **`/principal-brief`**, **`/people-admin`** — role homes
  and briefs.
- **`/board-pack`**, **`/reports`**, **`/insights`** — oversight/reporting.
- **`/announcements`**, **`/certificates`**, **`/compliance`**, **`/mpd`**, **`/appraisals`**,
  **`/delegations`**, **`/rte`**, **`/nep`** — oversight and compliance screens (a mix of live and
  newer-door-without-polish).

### 34.11 The census in one sentence

One hundred and forty-one routes across six role families: a mature, real library and parent/student
core; a live coordinator and CASES/HR/clinic/transport/returns set; a largely demo Today/People/
Fees/Attendance set; an unrouted teacher tail; and an oversight/compliance set that is partly
finished and partly door-without-screen. The map is the product's surface; the server (Chapters
32–33) is the product's substance.

<!-- END OF PART 34 -->

---

## Chapter 35 — The Table Census: Every Cabinet Behind Every Door

### 35.0 How to read this census

SchoolOS keeps its data in **two core schemas and roughly two dozen domain schemas**. `app` is the
kernel; `auth` holds token rails; every plugin owns a schema named for it (`teacher`, `family`,
`student`, `plugin_exams`, `plugin_dpdp`, `library`, …). This chapter lists the tables by domain and
what each holds, based on the migrations and the code. The authoritative live table count comes from
a generated artifact; the story uses the schema/table names it has verified in code.

### 35.1 `app` — identity, tenancy, and the platform

- **`app.tenants`** — the school. `config` is the **only config JSONB column in the database**;
  `plan` drives entitlements; `onboarded_at`/`onboarded_via` record the signup.
- **`app.users`** — people who can sign in. `role` (CHECK of 16 roles), `session_epoch` for instant
  global logout, `force_change`, `phone`, `pg_role` (inert), and `role_key` (custom-role binding).
- **`app.roles`** — custom roles: key, label, base_role, `{allow, deny}` permissions, composite-FK'd
  from users, ON DELETE RESTRICT.
- **`app.plugins`** — the switchboard: version, class, a 14-state status CHECK, **manifest and
  settings carry real schema**, entitlement, trust T0–T4, event_budget, ai_budget, breaker_state,
  cert_score.
- **`app.capability_contracts`** — contracts as data, including five kernel primitives and an
  `optional` marker.
- **`app.api_keys`** — `sha256` hash only.
- **`app.oauth_states`** — pre-auth single-use OAuth states.
- **`app.schema_migrations`** — the checksum ledger (created by the runner, altered/pinned/revoked by
  migrations).
- **`app.ops_counters`** — heartbeat/backup counters (no tenant, no RLS, deliberately).
- **`app.audit_log`** / **`app.audit_log_cold`** — the ledger and its chain-preserving archive.
- **`app.memory_entries`** — institutional decisions with expected-vs-actual.
- **`app.workflow_rules`** — topic + condition + one action.
- **`app.ai_calls`** — the only AI ledger (no prompt text).
- **`app.files`** — file metadata (INSERT-only; UPDATE revoked).

### 35.2 `app` — people and academics

- **`app.students`** — the roster of record; `admission_no` unique per tenant; `class_id`/`section_id`
  derived by a trigger; `dob`, `gender`; `user_id` (the portal-account binding); `bus_route`;
  `status`.
- **`app.guardians`** — canonical guardian contacts (FK→students).
- **`app.enrollment_history`** — write-once; a transfer/promotion row is inserted **before** the flip.
- **`app.classes`** / **`app.sections`** — normalized structure (upsert + soft-retire).
- **`app.subjects`** — the school's own subject list.
- **`app.class_assignments`** — who owns which register (one active per class; partial unique).
- **`app.academic_years`** — one current per tenant (partial unique).
- **`app.timetable_periods`** / **`app.timetable_slots`** / **`app.timetable_substitutions`** — the
  grid and the per-date substitution **overlay** (UNIQUE(slot, date)); periods/slots soft-retire.
- **`app.attendance`** — UNIQUE(tenant, student, date); four statuses.
- **`app.event_action_link`** — lineage (event → action → downstream).
- **`app.events`** / **`app.outbox`** — the event and promise rivers.
- **`app.communications`** / **`app.notifications`** — comms queue and in-app notices.
- **`app.webhook_subscriptions`** / **`app.webhook_deliveries`** — outbound webhooks.
- **`app.cases`** — the unified intake.
- **`app.actions`** — the approval spine (kind, owner_role, policy_ref, ai_involved, UNIQUE
  (tenant, code)).
- **`app.action_delegations`** — bounded approval delegation.
- **`app.assets`** / **`app.work_orders`** / **`app.wo_events`** — the maintenance model.
- **`app.routes`** / **`app.route_stops`** / **`app.transport_events`** — the transport model
  (retire, never delete).
- **`app.policy_documents`** — the versioned constitution store.
- **`app.staff_appraisals`** — appraisals (draft → shared → acknowledged).
- **`app.mtgs`** — meetings (cited by fee-hike governance).

### 35.3 `app` — money

- **`app.fee_plans`** / **`app.fee_obligations`** — the plan and per-student obligations;
  `paid <= amount`, `net_amount_cents` generated.
- **`app.fee_plan_templates`** — grade-set × terms templates fanned out on generate.
- **`app.fee_installments`** — the installment schedule (settles in order).
- **`app.billing_runs`** — groups a generation run (voidable as a unit).
- **`app.fee_heads`** — fee-head taxonomy.
- **`app.fee_settings`** — per-tenant fee policy overrides.
- **`app.fee_pins`** — counter-PIN hashes.
- **`app.payments`** / **`app.payment_allocations`** — payments and their allocation across
  obligations; one **open** per obligation (partial unique); `gateway_ref` CHECK on confirmed.
- **`app.payment_events`** — the append-only money trail (best-effort).
- **`app.fee_receipts`** — immutable receipts (+ `pdf_file_id`).
- **`app.recon_match_queue`** — reconciliation match queue (latest migration).
- **`app.fee_concessions`** (concession requests/decisions).

### 35.4 `auth` — token rails

- **`auth.revoked_token`** — the jti denylist.
- **`auth.reset_tokens`** — single-use password-reset tokens (`sha256`).
- **`auth.mfa_secrets`** / **`auth.mfa_recovery_codes`** — TOTP secrets + hashed single-use recovery
  codes (kept out of `app.users` because rosters SELECT that table).
- **`auth.mfa_challenges`** — pending MFA challenges.
- **`auth.login_throttles`** — shared per-account failure windows.
- **`auth.session_activity`** — shared last-seen for student idle.
- **`auth.auth_otps`** (kernel-only OTP vault) — the extreme `USING(false)` vault.

### 35.5 Domain schemas (plugins)

- **`teacher`**: `homework`, `submission` (UNIQUE(homework, student)), `note` (owner-pinned RLS),
  `leave_request`, `lesson`, `concern` + `concern_status_event`. (Submissions key a roster id.)
- **`family`**: `child_link` (the parent↔student authorization spine), `request` + `request_event`
  (append-only), `consent` (**immutable once decided — DB trigger `034:68`**).
- **`student`**: `mistake_note`, `flashcard`, `study_task`, `print_job`, `wellbeing_request`
  (user-scoped RLS; anonymous ⇒ structural no-identity), `wellbeing_request` reader tier.
- **`curriculum`**: `node` (read-only for the app role), `progress`.
- **`mastery`**: `evidence` (+`expires_at`), `state` (derived + decay marker).
- **`duty`**: `assignment`.
- **`ptm`**: `slot`, `booking`.
- **`plugin_exams`**: `exam`, `mark`, `report` (frozen snapshot + digest), `moderation` (overlay).
- **`plugin_admissions`**: `lead`, `stage_history` (append-only; offer→enrolled raises a kernel
  action).
- **`plugin_dpdp`**: `consent` (append-only ledger), `sar` (SLA clock), `erasure_journal`
  (`sha256(subject)` + keyed surrogate; idempotent, zero PII).
- **`plugin_visitors`**: `visit`, `pickup_otp` (kernel-only vault; FK-free by design after the
  incident where pickup codes leaked into the login vault).
- **`plugin_transport_gps`**: `positions` (30-day read-enforced retention).
- **`plugin_hr`**: `leave` (partial UNIQUE per staff-day where marked).
- **`plugin_clinic`**: `visit` (append-first), `sick_pass`.
- **`plugin_upi`** / **`plugin_razorpay`**: webhook logs / order logs (facts only; never settlement).
- **`library`**: `book`, `copy`, `loan`, `reservation`, `fine`, `acquisition_request` (per-copy
  tracking, holds, fines, purchase requests).
- **`safety`**: `box` (structural anonymity: `reporter_user_id` NULL when anonymous).
- **`support`**: `doubt`, `faq`.
- **`intervention`**: `plan` + `_event`.
- **`plugin_cbse`** / **`plugin_dpdp`** compliance tables, **`plugin_mpd`**-equivalent MPD docs,
  **`ops_udise`**-equivalent returns, and the Master-Action-Plan tables (rte, payroll, billing,
  nep, infra, meetings, health-checks, meals, staff-trainings, safety checks, dpdp breaches).

### 35.6 The data-layer's honest gaps

The story has flagged these throughout; collected here:

- RLS is **ENABLE-but-not-FORCE** on ~30 tenant tables (all the plugin/domain schemas), inconsistent
  with the kernel's FORCE posture.
- The `postgres`-owned default ACL can re-arm DELETE on future `app` tables until a superuser runs
  the printed command.
- `users.password_hash` remains app-role-readable (login `SELECT *`).
- `app.ai_calls` has no retention and never feeds the audit log.
- Several plugin PII tables (admissions, dpdp, visitors) rely on application-level scoping plus
  ENABLE-only RLS.
- `schema_migrations` is created by the runner but altered/pinned/revoked by migrations — an ordering
  dependency SQL cannot express.
- Seed's migration replay historically hard-stopped at `048`, so later per-tenant hardening could
  silently unwind on re-seed.

### 35.7 The census in one sentence

Two schemas of kernel, one of token rails, and two dozen domain schemas containing roughly one
hundred tables — every one tenant-scoped by a `tenant_id`, every meaningful one audited by the
ledger, and most of the sensitive ones protected by RLS shapes the story has named: isolation,
owner-pinning, and the kernel-only vault.

<!-- END OF PART 35 -->

---

## Chapter 36 — The Migration History: How the Schema Learned

### 36.0 Why read this

The migration files are the system's autobiography. Each was written to fix something specific, and
many carry comments naming the failure. This chapter walks selected migrations — not all 145 — to
show how the schema grew and, more importantly, how it learned. It is a history of scars.

### 36.1 The kernel (001–020)

- **`001_init`** — the kernel: `app.tenants`, `app.users`, `app.students`, the `app.current_tenant()`
  helpers, and the single RLS predicate applied by a loop over the core tables (`ENABLE` + `FORCE`).
  It also added `admission_no UNIQUE (tenant_id, admission_no)`.
- **`006`** — the ledger behind `app.audit_append` (`SECURITY DEFINER`), and the original
  `fee_plans.paid <= amount` CHECK and the one-open-payment partial unique index.
- **`008`** — full authentication: phone OTP vault and Google SSO rails; the OTP `USING(false)`
  vault pattern.
- **`014`** — the attendance kernel primitive contract.
- **`018`** — `admissions.funnel` created its registry row with an inline manifest — the reason
  `plugin-catalog.js` later had to reconcile `settingsSchema` from the file (SEC-6).

### 36.2 The domain build-out (021–048)

- **`021`** — timetable periods/slots/substitutions.
- **`023`** — the DPDP pack: the consent ledger and SAR, with the invariant that the pack never
  writes core student rows (the "office lane").
- **`024`** — `ops.visitors`: visit + the pickup OTP vault, **deliberately not** `app.auth_otps`.
- **`025`** — exam tables; the story flagged that `family.view` once selected columns that did not
  exist here (`total_pct`, `published_at`), producing the silent-empty defect.
- **`031`** — `teacher.homework` and submissions (UNIQUE(homework, student)).
- **`032`** — `student.mistake_note` etc., with the owner-pinned `schoolos.user_id` GUC and the one
  documented DELETE exception.
- **`034`** — `family.view`: `child_link`, consents, and the **immutable consent trigger** at
  line 68. Also the lane that seeded `child_link` by name match — the convention the story has
  traced.
- **`036`** — `student.world`, including the kiosk-plane tables.
- **`038`** — the `auth` schema: the jti denylist.
- **`042`** — the outbox `next_attempt_at` backoff column.
- **`043`** — comms `attempts`/backoff.

### 36.3 The governance and security waves (049–077)

- **`049`** — swept RLS onto nine naked tables (the "all plugin PII writes were already through
  `withUser`" fix).
- **`051`** — the `optional` marker on capability contracts.
- **`053`** — the onboarding signup path's schema.
- **`054`** — the grants re-baseline: kills the default-privilege trap, blanks grants, and
  establishes the law that **new tables are born with ZERO grants**; each migration grants
  explicitly. Razor-blade for late tables.
- **`055`** — `academic_years` one-current partial unique index; `session_epoch` for global logout.
- **`056`** — `auth.reset_tokens`.
- **`057`** — MFA secrets and hashed recovery codes.
- **`060`** — refund columns; the erasure journal.
- **`061`** — custom roles.
- **`062`** — `board_policy` on exams (validation-only at the time).
- **`063`** — the custom-role feature.
- **`066`** — comms provider/provider_ref.
- **`070`** — plugin role SELECT-only on `app.ai_calls`.
- **`071`** — workflow rules (`SELECT/INSERT/UPDATE` only — no DELETE), and the outbox `dedup_key`
  + partial uniques.
- **`072`** — the DELETE ban (D-35): an AWS-style trap where a `postgres`-owned default ACL silently
  granted DELETE on tables postgres creates; three timetable tables were live violations.
- **`073`** — outbox `parked_at` — failure must not look like idleness.
- **`074`** — "a policy must DENY, never RAISE": the `app.current_tenant()`/`app.current_user_id()`
  helpers and a snapshot rewrite of all 94 policies, after catching that the first version hardened
  only 44.
- **`075`** — the audit integrity saga: the BEFORE INSERT trigger computes prev/hash/hash_version,
  `created_at` is ms-truncated, a per-tenant advisory lock lives inside the function, a BEFORE
  UPDATE immutability trigger is added, and `app.audit_verify()` is created.
- **`076`** — outbox `discovered_at`/`workflow_scanned_at` markers (state-based discovery).
- **`077`** — column scope; the `users UPDATE` seven-column ACL, `sign_secret` unreadable, files
  UPDATE revoked.

### 36.4 The roles, AI, and catalog fixes (078–110)

- **`078`** — catalog/role refinements.
- **`079`** — `counselor` made issuable (five server gate lists and a screen already named it, but
  no user could hold it — the safeguarding role was structurally absent).
- **`080`** — `app.tenants.plan` (entitlements).
- **`082`** — reference integrity: `submission.student_id` FK to `app.students(tenant_id, id)`; the
  seed's name-match and the FK combined to produce the 23503-then-500 bug the story narrated.
- **`083`** — `class_assignments`; the fix that gave the attendance door the data it needed.
- **`106`** — the `staff` name-picker read.
- **`108`/`109`** — role CHECK extensions and the fee maker/checker split, payment history, and the
  append-only money trail.
- **`110`** — `om_config`/settings and the `FEE_SETTING_DEFAULTS`.

### 36.5 The class-reference and compliance build (132–147)

- **`132`** — `app.students.user_id` — the structural account↔roster binding (student identity
  resolved at last), with the name-match fallback.
- **`134`/`135`/`140`/`141`** — classes/sections/subjects/assignments and `sync_student_class_ref`,
  including the rule that a grade change invalidates the derived `class_id`/`section_id`.
- **`136`** — route `retired_at` (retire, never delete).
- **`137`–`139`** — timetable/transport write models.
- **`142`** — MPD/RTE/payroll/billing.
- **`143`** — counter-PIN.
- **`144`–`146`** — action-plan batches and safety audit.
- **`147`** — reconciliation match queue.

### 36.6 The laws the migrations encode

By reading the sequence, several laws become visible:

1. **New tables are born with zero grants** (054), and each migration grants explicitly.
2. **A policy must deny, never raise** (074).
3. **The app role never gets DELETE** (072), with one documented exception (032).
4. **The database pins the audit hash** (075); callers cannot supply it.
5. **State markers are stamped last, in the same transaction** (076/042).
6. **Reference columns are kept correct by triggers** so no lane has to remember (140/141).
7. **Retire, never delete** for structure and estates (136, library, routes, classes).

### 36.7 Why the history matters

A schema is usually read as a snapshot. SchoolOS's schema is better read as a **narrative**, because
each constraint carries a reason and each reason is a story about a real failure. The story hopes
this chapter makes that visible: the constraints are not arbitrary; they are the residue of
incidents, and they are the best documentation the system has.

<!-- END OF PART 36 -->

---

## Epilogue — The Honest State of the System

### E.1 What this book has shown

The story began with an empty database and a hash-chained book nobody can tear. It ended with a
school in its eleventh week, a term of records, and a ledger of tens of thousands of rows. Along the
way it walked every major domain, every important click, and the corridor every request walks. Now
it must do the hardest thing a technical narrative can do: say plainly what is good, what is
unfinished, and what a reader should do next.

### E.2 What is genuinely strong

1. **The tenancy wall is real.** RLS is enforced by the database, the constrained role is the
   default, and the failure mode is fail-closed. This is the single most important architectural
   decision, and it is done right.
2. **The audit ledger is evidence.** Hash-pinned, append-only, with a verifier that states its own
   limits and audits its own runs. Nothing in the story is more trustworthy than the ledger.
3. **The action spine is governance as data.** Approval-required, owning-authority, no
   self-approval, finance and ownership non-delegable, machines raise but do not decide.
4. **The money invariants hold.** One open payment per obligation, idempotent generation, refusals
   that leave the ledger byte-identical, maker/checker separation, gateway verification against the
   provider's own record, deterministic receipts.
5. **The delivery honesty is explicit.** Queued ≠ sent ≠ delivered; sandbox is labelled; the lie is
   made measurable in `/metrics`.
6. **The library is a reference implementation** of per-copy modelling, holds, fines, and retire-
   never-delete.
7. **The safeguarding plane is principled.** Structural anonymity, a least-privileged counselor
   role, nurse-lane PII, fail-closed child release with audited override, student-owned notes with
   a real delete.
8. **The compliance surface is unusually complete** for an Indian product: DPDP consent/erasure with
   an idempotent PII-free journal, UDISE/CBSE/Tally returns that refuse rather than guess.
9. **The code explains itself.** Every non-obvious decision carries a comment naming the failure it
   prevents — which is why this story could be written at all.

### E.3 What is unfinished, in one place

This is the honest gaps register, consolidated. It is long because the project is honest, not
because the product is bad.

**Operational (the highest-priority class):**

1. **Six workers are unscheduled by default** (workflow, webhook, day, dunning, reconcile, and the
   scheduled half of retention). The rules engine, outbound webhooks, daily sweeps, and
   reconciliation silently no-op in a default deploy.
2. **The documented production start path is inverted** (bootstrap before migrate) and **CI never
   builds/smoke-runs the image**.
3. **Backups are unscheduled**, and on the reference host were world-readable PII outside
   `.gitignore`.
4. **No TLS/edge and no alerting** on the reference host; HSTS inert.

**Security:**

5. RLS ENABLE-but-not-FORCE on ~30 domain tables.
6. The `postgres` default ACL can re-arm DELETE until a superuser acts.
7. `users.password_hash` is app-role-readable.
8. TOTP comparison uses `===` while an unused `constantTimeEqual` ships.
9. `reconcile-payments` runs as owner with RLS bypassed; it writes `events` with no outbox row.
10. `q()`/`sysq` misuse is guarded by convention, not mechanism.

**Data & AI:**

11. `app.ai_calls` has no retention and no audit pairing; `POST /ai/call` writes no audit row and
    trusts caller attribution.
12. `degraded` plugin status is read by three gates, written by nobody.
13. Some declared settings are never read; some are stale (the visitors attempts setting turns out to
    be read).
14. `parent.brief_log` retains full child-name JSON with no purge path.
15. Migration replay historically hard-stopped at `048`, risking silent unwind on re-seed.

**Frontend:**

16. **Zero frontend tests.** 44k LOC behind `tsc` only.
17. **Money UI disconnected from money doors** (the biggest UI/server gap).
18. **Five bearer-only transports** would CSRF-fail under cookie deployment.
19. **No error differentiation** (403/409/429 collapse to `HTTP <code>`); no request timeouts.
20. **Counselor has doors and no screens**; five teacher screens are unrouted; the real exam surface
    is unrouted; the ItAdmin screen is mostly disabled.
21. **Demo fiction presented as telemetry** (`AiUsage`/`AiGovernance`), a dishonest demo store, and
    three divergent demo-account tables.
22. **i18n reaches five files** (~57% hi-IN) while marketing claims bilingual.
23. **The name-match identity remains** in `teacher.classroom` (submissions) even though
    `app.students.user_id` exists — the single most important inconsistency in the product.

### E.4 What to build next, in order

If the story's author were taking over tomorrow, the order would be:

1. **Schedule the workers.** This is a configuration change with disproportionate impact: it turns
   on the workflow engine, webhooks, dunning, and reconciliation. Do this first.
2. **Fix the deployment recipe and CI.** Migrate before bootstrap; build and smoke-run the image.
   A correct codebase behind an incorrect start path is a trap.
3. **Unify student identity.** Make `teacher.classroom` read `app.students.user_id` first, exactly as
   `student.world` does. Every downstream result depends on this.
4. **Wire the money UI to the money doors.** The server is ready; the buttons are not. This is the
   finance role's whole job.
5. **Unify the transports** onto the compliant cookie+CSRF path.
6. **Close the RLS posture gaps** (FORCE where missing; the default ACL with a superuser command).
7. **Give the counselor screens.** The safeguarding work is server-complete and humanly unfinished.
8. **Add frontend tests and error differentiation**, so the surface stops being the weak half.
9. **Retention for `ai_calls` and `brief_log`**, and an audit row for `/ai/call`.
10. **Then**, and only then, consider real AI: extend the gateway contract (model, temperature,
    output schema, PII redaction), have a plugin route through it, and keep the honesty labeling.

### E.5 The philosophical verdict

SchoolOS is an unusual artifact. It is a school operating system whose greatest strength is not any
feature but a **habit of honesty**: it labels sandbox sends, measures its own lies, refuses to guess
at returns, freezes exam reports, makes consents immutable, writes down why every constraint exists,
and publishes an audit that scores its own implementation at 53/100. The author of this document has
verified the mechanisms against the code and found the comments truthful far more often than not —
including the ones that confess weakness.

The product is therefore best described in two sentences:

> **The server is a serious, principled, evidence-first school operating system. The browser is,
> today, a strong core with a long tail of demo theatre and unfinished screens — and the distance
> between them is the product roadmap.**

A school could run on this system today and trust its records, provided an operator scheduled the
workers, fixed the start path, and told staff which buttons are real. A school that trusted the
demo, or that let the money screen stand in for the money doors, would be misled. The story's
purpose was to make that distinction impossible to miss.

### E.6 The last line

The book nobody can tear is real. The drawers that lock from the inside are real. The clerk who
checks the live list is real. What remains is to build the rest of the building's furniture — and to
keep telling the truth about which rooms are finished.

<!-- END OF EPILOGUE -->

---

## Appendix A — Glossary (SchoolOS terminology)

- **Action** — a row in `app.actions`; a decision requiring an owning authority. Kinds: approval,
  incident, exception, recommendation, reminder.
- **Audit ledger** (`app.audit_log`) — the append-only, hash-chained history river.
- **Capability** — a specific thing a user/plugin/provider can do; declared as data in
  `app.capability_contracts`.
- **Child link** (`family.child_link`) — the structural parent↔student authorization spine.
- **Corridor** — the fixed request pipeline: hooks → `authenticate` → `requireRole` → `withUser`.
- **D-35** — the law that the app role never gets table-level DELETE.
- **Door** — an API endpoint/route.
- **Down by the river** — informal for the audit (history) and outbox (promise) rivers.
- **Drain protocol** — disabling a plugin hands its open actions back to the principal desk.
- **Encounter** — not used; ignore.
- **Event** — a fact that something happened (`app.events`).
- **Failed / undeliverable / parked** — comms/outbox failure states that never masquerade as success.
- **History river** — `app.audit_log`.
- **jti** — the JWT id; mandatory, so every session is revocable.
- **Kernel** — `app.js` + `routes.js`; auth, tenancy, governance, registry.
- **Lifecycle gate** — the per-request check (409) that a plugin is enabled.
- **Live mode** — the real API path.
- **Manifest** — a plugin's declared identity, permissions, settings schema, capabilities.
- **Mask** — a custom-role `{allow, deny}` overlay; deny beats allow.
- **Obilateral** — not a term; ignore.
- **Outbox** (`app.outbox`) — the promise river; durable pending work.
- **Parked** — retried past the cap and set aside for an operator.
- **Plugin** — a separately registered module with its own routes and tables.
- **Promise river** — `app.outbox`.
- **Queued** — accepted by SchoolOS, not yet sent.
- **Rail** — a provider adapter (SMS, email, WhatsApp, payments).
- **RLS** — Postgres Row-Level Security; the tenancy wall.
- **SAR** — subject-access request (DPDP).
- **Sent** vs **Delivered** — carrier accepted vs carrier confirmed.
- **session_epoch** — the claim/column whose mismatch kills old sessions on a credential change.
- **SoD** — segregation of duties; proposer can't approve; owner/finance non-delegable.
- **Spine** — `app.actions` (approval spine) or the event/outbox spine, per context.
- **Tenant** — one school and its isolated data.
- **Vault** — a kernel-only table (`USING(false)`) such as OTPs/pickup codes/reset tokens.
- **withUser** — the tenant-scoped transaction helper that sets the GUCs and the app role.

---

## Appendix B — The Gaps Register (quick reference)

This appendix condenses the story's honest flags for a reader who wants the punch list without the
narrative. Each maps to a chapter.

**Correctness/architecture**
- `degraded` status written by nobody (Ch. 4).
- Name-match student identity in `teacher.classroom` vs `app.students.user_id` elsewhere (Ch. 9, 23).
- Board pack / multi-campus Group roll-up is seeded fiction; no server campus scoping (Ch. 3, 27).
- `family.view` silent-empty historical defect (Ch. 18).
- Six declared settings never read; some stale (Ch. 4, 24).

**Security**
- ~30 domain tables ENABLE-not-FORCE RLS (Ch. 26, 35).
- `postgres` default ACL can re-arm DELETE (Ch. 1, 26, 35).
- `users.password_hash` app-role-readable (Ch. 26, 35).
- TOTP `===` comparison; unused `constantTimeEqual` (Ch. 26).
- `reconcile-payments` owner path + no outbox for warnings (Ch. 25).
- `POST /ai/call` no audit row; caller-trusted attribution (Ch. 19, 21).
- `ai_calls` no retention (Ch. 19, 21).
- audit `ip` in hash material but written by nobody (Ch. 21).
- `075` trigger/verifier ordering can false-break same-millisecond rows (Ch. 21).
- `rails.email` cleartext AUTH LOGIN risk (Ch. 4).
- UPI/Tally injection/amount residues (Ch. 7, 24).
- transport GPS staff-JWT ingestion, no HMAC; `deviationM` unused (Ch. 12).

**Operations**
- Six workers unscheduled (Ch. 1, 25).
- Compose start inversion; CI never builds image (Ch. 1, 30).
- Backups unscheduled + PII perms (Ch. 1, 30).
- No TLS/edge/alerting (Ch. 26).

**Frontend**
- Zero frontend tests (Ch. 30).
- Money UI disconnected (Ch. 7).
- Five bearer-only transports (Ch. 26).
- No error differentiation/timeouts (Ch. 26).
- Counselor doors without screens (Ch. 5, 23).
- Multiple unrouted teacher/exam screens (Ch. 9, 34).
- ItAdmin largely disabled (Ch. 4, 27).
- Demo fiction as telemetry; dishonest store; divergent demo accounts (Ch. 19, 29).
- i18n 5 files / 57% (Ch. 29).
- `/live` harness flaws; dereferenced `void` wrapper; PrintButton a11y (Ch. 8, 23, 29).
- Campus switcher display-only (Ch. 3, 29).
- Pickup `apiVisitorVerify` bespoke fetch (Ch. 13).

**Process**
- Git history of uncommitted work behind one committer (Ch. 30).
- Dev DB sediment; scratch databases (Ch. 30).

---

## Appendix C — Running and Verifying the System

The story's claims can be checked. The commands:

```bash
# --- platform (once) ---
cd server
cp .env.example .env                 # set DATABASE_URL, JWT_SECRET, PLUGIN_SETTINGS_KEY, CORS_ORIGINS, SEED_GUARD=strict
npm ci
npm run migrate                      # BEFORE bootstrap on a fresh DB (the story's OPS-1 fix)
node scripts/bootstrap.js            # roles + grants (D-35 DELETE ban)
npm start                            # :8080

# --- workers (schedule these; the story's OPS-8) ---
node scripts/outbox-worker.js
node scripts/comms-dispatcher.js
node scripts/workflow-worker.js
node scripts/webhook-worker.js
node scripts/day-worker.js
node scripts/dunning-reminders.js
node scripts/homework-reminders.js
node scripts/reconcile-payments.js
node scripts/retention-worker.js

# --- frontend ---
cd ../app
npm ci
npx vite build && npx vite preview --port 4310

# --- the quality gates ---
cd ../server
npm test                             # the full suite (serial, slow)
node scripts/check.js                # the single pre-ship gate
node scripts/permission-matrix.js    # regenerate docs/PERMISSION-MATRIX.md
node scripts/parity-gate.js          # UI↔door parity
node scripts/verification-artifact.js# regenerate docs/VERIFICATION.md

# --- inventory ---
ls migrations | wc -l                # migration files
ls src/plugins -d */ | wc -l         # plugin directories
rg -c '<Route ' ../app/src/App.tsx   # route entries
```

Verification checklists the story used:

- **Tenancy**: with `schoolos.tenant_id` set to a foreign tenant, `SELECT count(*) FROM app.students`
  returns 0; the RLS boundary test pins both the boundary and that `/metrics` still returns data.
- **Ledger**: `GET /audit/verify` returns 200 with `ok`, counts, and limitations.
- **Delivery honesty**: a `sent` row whose provider is `logger` shows up in `comms_sandbox_sent`.
- **D-35**: `tests/acl-d35.test.js` guards the DELETE ban.
- **Role catalog**: `tests/rbac-catalog.test.js` pins the role list against the DB CHECK.

---

## Appendix D — The Cast and the Threads

- **Green Valley Public School, Nashik** — the new school. Ananya Kulkarni (owner), Suresh Pawar
  (itadmin), Rekha Deshmukh (principal), Priya Iyer (teacher), Kavita Nair (librarian), Meera Nair
  (counselor), Aarav Mehta (student) and Kavita Mehta (parent).
- **Saraswati Vidya Mandir Kothrud** — the mature school (Meera Deshpande, owner).
- **Meridian International Academy** — the demo tenant (375 students; the `/dataset` allowlist).

Threads to follow if you read again:

1. **Identity** — name → `app.students.user_id` (Ch. 5, 9, 22, 23).
2. **Honesty** — queued ≠ sent ≠ delivered; sandbox labeled; deterministic copilots (Ch. 18, 19).
3. **Governance** — the action spine and SoD (Ch. 10, 12, 16, 24).
4. **Evidence** — the ledger and its verifier (Ch. 21, 26).
5. **The two worlds** — server substance vs browser surface (Ch. 29, 34, Epilogue).

<!-- END OF PART 36 AND APPENDICES -->

---

## Chapter 37 — Thirty Small Mechanisms Worth Understanding

A product is made of large domains and small mechanisms. This chapter collects thirty small,
specific mechanisms — each a few lines of code doing something careful — because mastering them is
what it means to actually know this system. Each is cited to the domain where the story explained
it.

**1. The mandatory `jti`.** Every token carries a `jti`; a token without one is refused, because it
could never be revoked (Ch. 26). This is why logout is instantaneous rather than "eventually".

**2. Session-epoch invalidation.** A password change bumps `session_epoch`; every other token of
that user dies on its next request without any registry of live sessions (Ch. 5, 26).

**3. The timing-equalizing `dummyVerify`.** A missing user still burns the scrypt cost, so response
time does not reveal whether an email exists (Ch. 26).

**4. The identifier-keyed login lock.** Checked before the lookup, so a known and an unknown email
answer the same 429 — eliminating an enumeration oracle (Ch. 26).

**5. The restricted token.** A `mustChange` token can reach exactly three paths; the client renders
only the password gate (Ch. 5).

**6. The `SET LOCAL ROLE` transaction.** The role downgrade is transaction-scoped, so it cannot leak
onto a pooled connection (Ch. 26).

**7. Fail-closed RLS default.** `q()` runs as the constrained role, and an unset tenant GUC yields
zero rows rather than another tenant's rows (Ch. 26).

**8. The structural `family.child_link`.** Parent scoping is a join, not a name (Ch. 22).

**9. `app.students.user_id` first, name second.** The student identity pin, with an exactly-one-
match fallback (Ch. 23).

**10. User-scoped RLS for student notes.** `schoolos.user_id` pins private rows; a tenant match is not
enough (Ch. 23).

**11. Structural anonymity.** An anonymous wellbeing/safety report stores no identity columns at all,
and the audit actor is the literal string "anonymous" (Ch. 23).

**12. The one-open-payment partial unique index.** Makes double-count structurally impossible
(Ch. 7).

**13. `ON CONFLICT DO NOTHING` on obligation generation.** Re-clicking Generate can never double-bill
(Ch. 7).

**14. The generated `net_amount_cents`.** Concessions/waivers are reflected by the database, not by
code that might forget (Ch. 7).

**15. Gateway verification against the provider log.** No regex; a reference must exist in the
provider's own record for *this* payment (Ch. 7).

**16. The `MANUAL` sentinel.** Cash settlements store a reserved sentinel and label `settled_via`,
because the schema requires a reference on confirmed rows (Ch. 7).

**17. The tenant advisory lock for receipt numbers.** Deterministic, collision-hard, no silently
skipped receipts (Ch. 7).

**18. The `SAVEPOINT` on unique violations.** Turns a `23505` into a friendly 409 instead of a
poisoned transaction (Ch. 5, 9).

**19. `FOR UPDATE OF s`.** Locks only the submission row, not the joined homework (Ch. 9).

**20. The class-ownership assertion from student rows.** The payload's class is never trusted
(Ch. 8).

**21. One audit row per attendance change.** No-op re-submits are not mutations (Ch. 8).

**22. The audience resolver's union.** Notices resolve against both `app.guardians` and
`family.child_link` (Ch. 8, 17).

**23. The redacted OTP in the ledger.** The ledger is evidence, never the channel; a live code never
sits in a six-role-readable table (Ch. 13).

**24. The pickup compensation.** An undeliverable code is withdrawn and the visit restored, then a
503 tells the desk the truth (Ch. 13).

**25. High-risk audit on a rejected pickup code.** Every attempt is recorded, not just the ceiling
(Ch. 13).

**26. Deterministic assembly + digest for exams.** Reports are a pure function, frozen and verifiable
(Ch. 10).

**27. Moderation as an overlay.** The report row is never updated; grades are re-derived (Ch. 10).

**28. Proposal page marker stamped last in the transaction.** The workflow runner cannot silently
skip a page on crash (Ch. 25).

**29. Parking leaves `processed_at` NULL.** Relay failure is a positive signal, not a hole in the
gauge (Ch. 25).

**30. The verifier that states its own limits and audits itself.** The system's most honest single
endpoint (Ch. 21).

If a new engineer understood only these thirty things, they would understand why this codebase
behaves the way it does — and why its comments read like a confession log.

---

## Appendix E — A Role-by-Role Quick Guide

For each of the sixteen built-in roles: what they generate, what they read, and the one thing they
cannot do.

**owner** — generates the tenant profile, staff, roles, plugin settings, API keys, migrations,
delegations; reads everything tenant-scoped; cannot escape the ledger (and is the sole authority for
fee-obligation void and migration activation).

**principal** — generates approvals (exam publications, admissions conversions, announcements,
notices), decisions, briefs; reads the whole school; cannot decide finance-owned or owner-owned
actions, and cannot approve the coordinator desk's own work.

**coordinator** — generates substitutions, duty allocations, case movement, staffing reads, HR
absences; reads the operational plane; cannot reach the wellbeing plane or the audit ledger.

**counselor** — generates wellbeing follow-ups, concern outcomes, interventions; reads the wellbeing
plane only; is excluded from fees/audit/insights/data. (And has doors without screens.)

**finance** — initiates and confirms payments, manages plans, reconciles, exports Tally; reads the
ledger; cannot be a pure maker for large refunds (maker/checker), and cannot void (owner only).

**finance_head** — the checker: confirms, reconciles, refunds at/above threshold; cannot be
delegated to or from.

**finance_clerk** — the maker: initiates and collects; cannot confirm.

**admissions** — captures leads, moves the funnel, imports; reads the roster; cannot create a core
student (that waits for a principal's approval).

**transport** — routes, GPS ingestion, delay events, transport notices; reads the fleet; cannot
directly message guardians (approval).

**facilities** — work orders, assets, library write, file upload; reads ops; is not a fee/student-
PII/safeguarding reader.

**technician** — work-order status transitions and asset history only; reads its queue; cannot do
anything outside maintenance.

**teacher** — homework, submissions, concerns, leave, doubts, PTM; reads its classes; cannot read
another teacher's homework (the `created_by` pin) or decide wellness cases.

**itadmin** — plugins, settings, API keys, webhooks, metrics, roles, audit verify; reads platform
surfaces; has zero itadmin-only business doors and is not a fee-void authority.

**parent** — files requests/complaints/leave, decides consents, initiates payment, books PTM, files
DPDP requests; reads its own children only; can never edit a record (corrections are requests).

**student** — submits homework, files anonymous wellbeing, keeps private notes/flashcards/tasks,
prints; reads its own world only; can never read another student or the whole register.

**librarian** — the library desk: catalog, copies, loans, returns, holds, fines, acquisitions; reads
its library surfaces; is opt-in and requires the module enabled.

---

## Appendix F — The Event Topic Catalogue (representative)

`emitEvent` writes an `app.events` row and an `app.outbox` row. Representative topics, grouped:

- **People**: `people.user.created`, `people.user.suspended|activated|password_reset`,
  `people.student.transferred`, `people.import.completed`.
- **Learning**: `homework.v1`, `submission.v1`, `substitution.assigned`, `duty.assigned.v1`,
  `attendance.autofilled`, `attendance.absences`.
- **Assessment**: `exam.marks.updated.v1`, `exam.published.v1`, `cbse.obligation.due.v1`.
- **Support/safety**: `concern.filed|routed|closed.v1`, `safety.report.filed.v1`, `doubt.*.v1`,
  `student.wellbeing.v1`, `intervention.*`.
- **Family**: `family.consent.v1`, `family.request.v1`, `child.leave.requested.v1`, `ptm.booked.v1`.
- **Money**: `payment.link.created`, `payment.captured|failed`, `fee.payment.v1`, receipt/dunning
  events.
- **Admissions**: `admission.enquiry.captured`, `admission.stage.transitioned`,
  `admission.offer.accepted`.
- **Transport**: `gps.position`, `transport.*`.
- **Visitors/clinic/HR**: `visitor.logged|checked_in|pickup.requested|pickup.verified|completed.v1`,
  `clinic.visit.logged.v1`, `clinic.sick_pass.issued.v1`, `clinic.*.v1`, `hr.leave`.
- **Library**: `library.book.added|updated|retired`, `library.copy.*`, `library.loan.issued|returned|
  renewed`, `library.reservation.*`, `library.fine.settled`, `library.acquisition.*`.
- **Files**: `files.stored.v1`.
- **Platform/governance**: `platform.tenant.onboarded.v1`, `platform.school.updated.v1`,
  `platform.school.classes.updated.v1`, `platform.school.subject.added.v1`, `action.decided.v1`,
  `consent.recorded.v1`, `sar.opened.v1|fulfilled.v1`, `timetable.published`.
- **DPDP**: `consent.recorded.v1`, `sar.opened.v1`, `sar.fulfilled.v1`.

Who listens: the outbox relay logs; the comms dispatcher drains comms; the workflow runner fans out;
most topics reach no other subscriber today (Ch. 25).

---

## Appendix G — The Security Control Inventory (condensed)

- **Password**: scrypt N=2^17 r=8 p=1 + legacy fallback + `dummyVerify` timing parity.
- **OTP**: scrypt-hashed kernel-only vault; TTL; attempt-bounded; uniform 503 when the rail is off;
  undeliverable withdraws the code.
- **MFA**: TOTP RFC 6238 ±1 window (⚠️ `===` compare); single-use recovery codes; disable needs the
  password.
- **Session**: mandatory `jti`; denylist; live user re-read; `session_epoch`; restricted tokens;
  student TTL + idle + Clear-Site-Data.
- **CSRF**: double-submit on cookie mutations; bearer exempt.
- **API keys**: sha256, read-only, scoped, door allowlist.
- **Webhooks**: raw-bytes HMAC, tenant-bound secret, freshness, replay dedupe.
- **RLS**: isolation, owner-pinning, kernel-only vaults, platform read; `074` deny-never-raise.
- **D-35**: no app-role DELETE; scoped helpers; one exception.
- **Audit**: DB-pinned hash, immutability trigger, verifier with stated limits.
- **Secrets**: `isSecretKey` classification; encrypted settings; key-names-only audit; value-stripping
  reads.
- **Tenancy**: `withUser` GUCs + app role; tenant from the token, never the body.
- **Input**: `uuidParams`; format guards; CSV formula-injection defense; ILIKE escaping.
- **Delivery honesty**: sandbox labeling; `comms_sandbox_sent` gauge; `undeliverable` outcome.
- **Isolation of secrets**: pickup/reset/OTP codes kept out of `app.auth_otps` and out of
  `app.communications`.

---

## Appendix H — Three Worked Request Traces (compressed)

**Trace 1 — parent login.**
`POST /auth/login {email,password}` → rate limit 20/min → identifier lock → lookup joins
users+tenants+mfa → one match → scrypt verify (+rehash if legacy) → clear throttle → if MFA:
401 challenge; else `issueSession` (jti, ep, mustChange) → audit `Signed in (password)` → Set-Cookie
pair → `{ token, user }`. Client stores bearer in memory, cold-opens with `GET /me`.

**Trace 2 — teacher marks attendance.**
`POST /attendance/mark {date, marks[]}` → authenticate → `require(owner,principal,coordinator,
teacher)` → `withUser` → non-office: read `app.class_assignments`, if none 403; else
`assertTeacherOwnsClasses` (derive class from student rows) → read prior register → upsert each mark
→ per-changed-student audit → newly-absent guardians resolved (union) → queue `ABSENCE_NOTICE` rows
→ `emitEvent('attendance.absences')` → commit → `{marked, absent, noticesQueued, guardiansResolved}`.

**Trace 3 — payment webhook.**
`POST /plugins/payments.razorpay/webhook` (public) → raw-bytes parser → HMAC verify over wire bytes
(timing-safe, uniform 401) → freshness window → replay `ON CONFLICT (tenant,event_id) DO NOTHING`
(dup = silent 200) → resolve tenant from the referenced payment → lifecycle gate → write facts to
`plugin_razorpay.order_log` → `emitEvent('payment.captured')` → audit. **Settlement is not done
here**; the kernel confirm door verifies the reference against this same log before moving the
ledger.

---

## Appendix I — Operator FAQ

**Q: A message shows "sent" but nobody got it.** Check the provider: if it is `logger`/`log-only`,
it was sandbox. `GET /metrics` → `comms_sandbox_sent`. Configure a real rail (Ch. 18).

**Q: An approval does nothing.** Check whether the relevant worker is scheduled. The workflow,
webhook, day, dunning, and reconcile workers are not started by default (Ch. 1, 25).

**Q: A new school sees no data.** Correct — a fresh tenant's `/dataset` is empty by allowlist
(Ch. 2). Import or add students.

**Q: Login says "account disabled."** The user was suspended; the next request after suspension
fails because the kernel re-reads the user row (Ch. 26).

**Q: A teacher can't mark attendance.** They have no `class_assignments` row. Assign them a class
(Ch. 8).

**Q: A parent sees nothing for their child.** No `family.child_link`. Link them in the People
console (Ch. 5, 22).

**Q: The audit verify reports breaks.** Read the `limitations` array — legacy v1 rows cannot be
recomputed; cold is boundary-checked only. A real break is a high-risk event (Ch. 21).

**Q: A plugin disabled but its screen still shows.** The lifecycle gate 409s its doors per request;
the client should hide via `/plugins`. If it does not, the screen is stale (Ch. 4).

**Q: A pupil can't log in.** Their account must be created from the roster row
(`app.students.user_id`); an unbound account is refused (Ch. 5, 23).

**Q: Where do I start a new term?** Create and activate the academic year, then generate fee plans
for the new year (Ch. 3, 7).

---

## Appendix J — The "What Is Real" Map

A one-glance honesty map for an evaluator:

- **Fully live (server + surface)**: library; parent/family suite; student home/noticeboard;
  coord suite; CASES; HR; clinic; transport (write model + live band); statutory returns; fees
  *plans*; actions/approvals; audit read; plugins enable/disable/settings; visitors; onboarding.
- **Live server, partial/absent UI**: money collect/confirm/refund (no UI); counselor concerns/safety
  box (no screens); teacher exam marks and five teacher screens (unrouted); documents upload (dead
  wrappers); ItAdmin controls (no doors); newer Master-Action-Plan doors (no polished screens).
- **Demo/dataset**: Today, People, Attendance (in-memory marking), Fees (in-memory), Memory,
  Operations briefing prose, AI usage/governance telemetry, Group roll-up, the maintenance stubs,
  the transport map/drill, the AI Front Desk reception.
- **Fixture engines**: `aiService.ask` (keyword regex), teacher home/brief (server doors absent).
- **Fiction clearly labelled**: the voice receptionist (out of scope, D-25); sandbox sends.

---

## Appendix K — Reading Guide / Index

- **Want the mental model?** Prologue + Ch. 26.
- **Want onboarding?** Ch. 1 → 2 → 3 → 4 → 5 → 6.
- **Want a domain?** Fees Ch. 7; Attendance Ch. 8; Homework Ch. 9; Exams Ch. 10; Library Ch. 11;
  Transport Ch. 12; Visitors Ch. 13; Maintenance Ch. 14; HR/Clinic Ch. 17; Comms Ch. 18; AI Ch. 19;
  Files Ch. 20.
- **Want governance?** Ch. 16 (action spine), Ch. 21 (ledger/memory/constitution).
- **Want the parent/student story?** Ch. 22/23.
- **Want compliance?** Ch. 24.
- **Want operations?** Ch. 25 (workers), Ch. 30 (factory).
- **Want the surface?** Ch. 29 (shell/demo), Ch. 34 (screens).
- **Want the data model?** Ch. 35–36.
- **Want the verdict?** Epilogue + Appendix B.

<!-- END OF APPENDICES -->

---

## Chapter 38 — Twelve Hard Problems, and How Each Was Solved

A codebase reveals its character in the problems it struggled with. This chapter takes twelve of the
hardest bugs the story encountered and narrates the problem, the wrong fix, and the right one — drawn
from the code's own comments. It is, in effect, a casebook.

### 38.1 The ledger that stored a hash the caller chose

**Problem.** The audit ledger was *supposed* to be tamper-evident. But `app.audit_append` validated
`prev_hash` while storing the caller-supplied `hash` **verbatim**. Any app-role caller could write a
row whose fingerprint it had picked. When the chain was recomputed from live rows, **26 of 53
development rows did not reproduce**, and one row had matched a migration file's literal rather than
its column — proof of post-insert alteration.

**Wrong fix.** "Validate harder." The chain linked correctly, so ordinary checking saw nothing.

**Right fix (migration 075).** Move hash computation into the database: a `BEFORE INSERT` trigger
computes `prev_hash` and `hash`, pins `hash_version = 2`, and ignores the caller's hash. Truncate
`created_at` to the millisecond for determinism. Take a per-tenant advisory lock **inside** the
function, because the JS-only lock never protected the 33 migration replays. Add a `BEFORE UPDATE`
immutability trigger (but not DELETE — retention archives by DELETE). Add `app.audit_verify()`.
Leave the legacy v1 rows reported, not laundered.

**Lesson.** A security property belongs where it cannot be bypassed. Evidence must be computed, not
asserted.

### 38.2 The policies that raised instead of denying

**Problem.** Pre-074 policies inlined `current_setting('schoolos.tenant_id')`. When the GUC was an
empty string, the `::uuid` cast raised `22P02` → a **500**. A missing setting produced a crash, not a
denial.

**Wrong fix.** Add `current_setting(..., true)` (which returns NULL instead of raising) in one or two
places. Most policies remained.

**Right fix (074).** Add `app.current_tenant()` / `app.current_user_id()` helpers that return TEXT
and wrap `NULLIF(...,'')`, then rewrite **all 94 predicates from a snapshot**. The first version
hardened only 44; it was caught, and the migration then **refused to report success on a partial
rewrite**. No post-074 migration adds an inline policy.

**Lesson.** "A policy must DENY, never RAISE" is not a style preference; it is the difference between
a secure system and a crash loop.

### 38.3 The pool that ran as the owner by default

**Problem.** The Postgres pool authenticated as `schoolos`, which owns every table and carries
`BYPASSRLS`. RLS was not just unenforced for the owner — it was *skipped*. Only the 238 `withUser`
call sites were protected; the 74 bare `q()` call sites ran as owner, so any route using one was a
cross-tenant read/write waiting for a bug.

**Wrong fix.** "Be careful with `q()`."

**Right fix (SEC-1).** Invert the default: `q()` runs as the constrained app role, so RLS applies to
every ordinary query whether or not the author thought about tenancy. Privileged work must be
**explicit** (`sysq`/`tx`/`withUser`), making it greppable. The failure mode is fail-closed: an unset
tenant GUC yields zero rows.

**Lesson.** A boundary is only real if the role reaching the tables is subject to it. Make the safe
thing the default and the unsafe thing explicit.

### 38.4 The ACL that re-armed DELETE

**Problem.** Law D-35 says the app role never gets DELETE. But a **`postgres`-owned default ACL**
silently granted `{schoolos_app=arwd/postgres}` on any table created by the `postgres` role. Three
timetable tables were live violations.

**Wrong fix.** Revoke DELETE on those three tables.

**Right fix (072).** Revoke DELETE everywhere and leave one documented exception
(`student.mistake_note`). Then admit the residual: the default ACL itself cannot be removed without
superuser, so a future `postgres`-authored table re-arms it. Guard the *effect* with
`tests/acl-d35.test.js` and print the superuser command in two migrations.

**Lesson.** Fix the mechanism, and if you cannot, measure the residue and guard its effect
explicitly.

### 38.5 The gateway reference that was a regex

**Problem.** Confirming a payment decided whether it was "gateway-verified" by regex-matching the
**caller's own string** (`/^[A-Z0-9-]{10,}$/`). Any finance user could type `MANUAL-123456` and the
ledger would record *"gateway webhook verified."* The refund path synthesised references the same
way.

**Wrong fix.** Tighten the regex.

**Right fix (SEC-8).** Verify the reference against the **provider's own record**
(`plugin_razorpay.order_log` / `plugin_upi.webhook_log`), joined to **this** payment row and
tenant-scoped by RLS. A caller-invented reference matches nothing. If no provider vouches, human
settlement is still allowed but **labelled** `manual` and `settled_via`, and the audit says which.

**Lesson.** The claim the money depends on must be a property of reality, not of the input string's
shape. Charitably allow the human path, but name it honestly.

### 38.6 The message that was "sent" to nobody

**Problem.** A row whose status was `sent` but whose carrier was `logger`/`log-only` had been
delivered to nobody. That population existed in every environment and was **invisible**:
`comms_queued` fell as those rows drained, so a school with no SMS provider saw a clean, emptying
queue.

**Wrong fix.** Add a comment saying logger is sandbox.

**Right fix (PRD-13).** Add a fourth outcome `undeliverable`, a shared `isSandboxResult` /
`sandboxAllowed` helper, and a **separate `comms_sandbox_sent` gauge** so the lie is measurable.
Compensate at the point of harm: the visitors pickup door withdraws an undeliverable code and reverts
the visit.

**Lesson.** Honesty must be *measurable*, not merely intended. A gauge that counts the failure turns
a silent lie into a monitorable fact.

### 38.7 The pickup code handed to nobody (and the wrong vault)

**Problem.** The pickup OTP was minted, scrypt-hashed, and vaulted under RLS that denies the app role
— and **handed to nobody** (no rail call, no comms row, no queue). Yet the event announced "OTP sent
to primary guardian" and the audit said "OTP issued." Because release is fail-closed, every pickup
degraded to the photo-ID override **while the record claimed the identity check had happened**.
Separately, pickup codes must never ride `app.auth_otps`, because a row there is a *login* OTP and a
pickup code could be redeemed for a full guardian session.

**Wrong fix.** Set a flag, or reuse the login OTP vault for convenience.

**Right fix (T102 + PRD-13).** Store in `plugin_visitors.pickup_otp` (kernel-only, plugin-owned).
Send **directly** through the rail, not queued (so a live code never sits in a six-role-readable
table). Ledger a **redacted** body as evidence. Normalise the phone **before** minting (ordering is
the point). On undeliverable, withdraw the code and revert the visit; return a 503 telling the desk
to use the audited photo-ID override.

**Lesson.** Never claim an identity check happened when it did not — especially at a child's gate.
And keep secrets in the vault that matches their purpose.

### 38.8 Student identity was a name

**Problem.** There was no structural link from `app.users` to `app.students`; the only
correspondence was the **name**. The seed had three grade-8 rows named "Diya Nair"; 125 same-name
groups existed. A submission could be attributed to the wrong section-sibling.

**Wrong fix.** A cleverer name query.

**Right fix (migration 132 + G-1).** Add `app.students.user_id`, written when the school creates a
pupil's portal account **from the roster row** — the only place the binding can be made. Resolve
identity from `user_id` first, with an exactly-one-active-match name fallback for pre-account rows.
`student.world` now does this. **But** `teacher.classroom` still name-matches submissions — the
remaining half of the fix, and the product's most important open inconsistency.

**Lesson.** A name is not an identity. When you add the structural link, migrate **every** consumer,
or you have two truths.

### 38.9 The teacher door no teacher could use

**Problem.** `POST /attendance/mark` advertised `teacher` in its role gate but an in-handler
fallback refused everyone but the principal's office, because the only assignment-shaped tables
carried a `teacher_name` string with no grade/section binding — so *no query could answer "which
classes does this teacher own."*

**Wrong fix.** Relax the check (which would let any teacher mark any class).

**Right fix (PRD-2 + migration 083).** **Create the data**: `app.class_assignments`, one active owner
per class, written by the principal's office. Then bind marking to those rows. Do not weaken the
gate; give it what it needs. The same ownership rule was later applied to the sibling
`ops.timetable/attendance/autofill` door, which had reopened the bypass.

**Lesson.** When a gate cannot be enforced because the data does not exist, build the data. And fix
**every** sibling door, or the weakest one becomes the real policy.

### 38.10 The outbox that lied about failure

**Problem.** When the relay parked a poison row, it set `processed_at` — which made the only queue
gauge **fall** as rows failed. A total relay failure was metrically identical to an idle system.

**Wrong fix.** Log the failure more loudly.

**Right fix (073).** Add `parked_at`; park on `parked_at` and **deliberately leave `processed_at`
NULL**; add a separate parked counter. Separate "failed" from "idle."

**Lesson.** In observability, absence of a signal is not evidence of health. Give failure its own
counter.

### 38.11 The workflow runner that could only ever see 50 rows

**Problem.** The runner scanned `WHERE created_at > now() - interval '1 hour' ORDER BY created_at
LIMIT 50` with **no cursor and no marker**. Every tick re-read the same oldest 50 rows; once more than
50 matched in the window, the rest were never seen. A runner down for over an hour never looked at
the gap. *"The LIMIT did not bound the work per tick; it bounded what could EVER be processed."*

**Wrong fix.** Increase the limit.

**Right fix (DAT-14 + 076).** Add a per-consumer marker `workflow_scanned_at` and scan by state
(`IS NULL`), `FOR UPDATE SKIP LOCKED`; stamp the marker **last, in the caller's transaction**, so a
crash re-evaluates the page rather than skipping it.

**Lesson.** A window-based scan without a cursor starves. State-based discovery plus a marker stamped
last is the safe shape.

### 38.12 The boolean precedence that excluded the owner

**Problem.** The segregation-of-duties boolean was
`ownRole || (isOwnerOrPrincipal && owner !== finance)` because `&&` binds tighter than `||`. That
excluded the **owner** from deciding finance-owned actions, contradicting the adjacent comment. A
later variant also let the principal decide `owner_role='finance_head'` actions, because the
exclusion named only the literal string `finance`.

**Wrong fix.** Add a special case for the owner.

**Right fix (RTE-12, OVR-8).** Parenthesize the intended expression, exclude the whole finance
**tier**, and exempt owner-owned actions from the principal's authority. The corrected form:

```js
let ownerOk = a.owner_role === req.user.role
  || req.user.role === 'owner'
  || (req.user.role === 'principal' && !FINANCE_TIER.includes(a.owner_role) && a.owner_role !== 'owner');
```

**Lesson.** Security logic in a boolean deserves a test for every branch. Precedence bugs read as
intent, which is why they survive review.

### 38.13 What the casebook adds up to

Every one of these twelve has the same three-part shape: a real failure, a tempting narrow fix, and a
fix that repairs the **class** of failure and writes down the reasoning. That pattern is the closest
thing this codebase has to a house style, and it is why the story trusts the mechanisms even while it
catalogues the gaps. When a system documents its own scars, a reader can calibrate exactly how much
to trust it — which is more than most software allows.

<!-- END OF CHAPTER 38 -->

---

## Chapter 39 — A Thirty-Day Takeover Plan

A new engineering team inherits this codebase. What follows is a concrete, ordered plan, derived from
the story's gap register and the system's own priorities. It is not a wish list; it is the sequence
that reduces the most risk per unit of effort.

### 39.1 Week 1 — make the deployment honest

**Day 1–2: schedule the workers.** Add the workflow, webhook, day, dunning, and reconcile workers to
the deployment. Run the retention worker where it belongs. Verify with `GET /metrics` that the
`undiscovered`, `wh_queued`, `wh_failed`, and `wh_stalled` gauges move. This single change turns on
the rule engine, outbound webhooks, dunning, and reconciliation.

**Day 2–3: fix the start path.** Reorder compose to `migrate` then `bootstrap`. Add an image build +
smoke-run to CI. Build the image once locally and boot a fresh database from it to prove the path.

**Day 3–4: schedule backups and lock them down.** Install the backup timer; `chmod 600` existing
dumps; add `backups/` to `.gitignore`; rehearse one restore end-to-end, including `FILES_DIR` bytes.
A backup you have not restored is a hypothesis.

**Day 4–5: observability.** Add alert rules on `outbox_parked`, `comms_sandbox_sent`, `wh_stalled`,
`api_heartbeat_age`, and `backup_age`. Add TLS at the edge. Add a log/error sink. Verify that a
simulated relay failure produces an alert.

**Day 5: read the ledger.** Run `GET /audit/verify` on the production tenant and record the baseline
(rows, pinned, legacy, archived, breaks). Do this before any change, so you can prove nothing was
tampered with under your watch.

### 39.2 Week 2 — close the identity and money-.seams

**Day 6–8: unify student identity.** Make `teacher.classroom` resolve the submitting student from
`app.students.user_id` first, falling back exactly as `student.world` does. Then audit **every** other
name-match consumer (library accounts, family links) and migrate them or document why they remain.
This is the highest-value correctness fix in the product.

**Day 8–10: wire the money UI to the money doors.** Add the `liveApi` wrappers for payment
initiate/confirm, refund, void, dunning, and reconcile; wire the Fees screen's Collect / Send reminder
/ waive / receipt-print buttons to them; populate the Payments tab. The server is ready; this is
plumbing plus tests.

**Day 10–12: unify the transports.** Move `parentApi`, `studentApi`, `coordApi`, `teacherFixtures`,
and the inline visitors fetch onto the compliant cookie+CSRF path (or a single shared client). Then
test the whole app under a cookie session, not just a bearer.

**Day 12–14: error differentiation and timeouts.** Give the client real handling for 403/409/429/503
and a request timeout/AbortController. Right now a 403 shows `HTTP 403` to a human and a hung request
hangs the screen.

### 39.3 Week 3 — the security posture

**Day 15–17: RLS posture.** Add FORCE RLS to the ~30 domain tables that lack it, after verifying each
policy's shape. Run the RLS boundary test after every table.

**Day 17–18: the default ACL.** Have a superuser run the command migrations 072/077 print to remove
the `postgres`-owned default ACL. Confirm with `tests/acl-d35.test.js` and a manual new-table probe.

**Day 18–19: column scope.** Scope `password_hash` out of the login `SELECT *`, or move it to a
kernel-only view. Track the change against the `users UPDATE` ACL.

**Day 19–20: TOTP and worker privilege.** Wire `constantTimeEqual` into the TOTP comparison. Give the
reconcile worker a constrained client, or at minimum scope its queries and route its warnings through
`emitEvent`.

**Day 20–21: `ai_calls` and `/ai/call`.** Add retention to `app.ai_calls`; add an audit row to
`POST /ai/call`; store the plugin attribution server-side rather than trusting the caller.

### 39.4 Week 4 — the surface and the process

**Day 22–24: the counselor and teacher surfaces.** Build the wellbeing/concerns screens the counselor
has doors for. Route the real exam-marks screen and the five teacher screens, or delete them. Fix the
`/live` harness's lies or remove `/live` from production.

**Day 24–25: frontend tests.** Add a test runner and cover the critical live flows (login, attendance,
fee plans, library, parent consents). Even a thin suite catches the dead-wrapper and unrouted-screen
classes of bug.

**Day 25–27: the honest demo.** Replace the fake AI telemetry with either real data or a clear "demo"
label. Remove the three divergent demo-account tables' inconsistencies. Make the demo store stop
inventing audit policy-refs.

**Day 27–28: i18n and a11y.** Finish hi-IN or stop claiming bilingual. Fix nested buttons and the
1-pixel print confirmation.

**Day 28–30: institutionalize.** Stand up the factory loop you can actually run: a single pre-ship
gate (`check.js` + `permission-matrix.js` + `parity-gate.js` + the suite), a lane test-DB convention,
and a rule that the orchestrator holds git and commits at least daily. The project's process is its
greatest asset; make sure it survives the handover.

### 39.5 The one rule for the takeover

Do not treat the demo as the product, and do not treat the server as finished either. Read the code's
comments: they tell you what is real, what is risky, and why. The system has done most of the
documentation work for you. The risk is not ignorance; it is **skipping the comments**.

---

## Appendix L — The Plugin Manifest Surface

Every plugin ships a `manifest.js` next to its `index.js`. The loader mounts it; the catalog seeds
it; the settings door validates against it. A manifest declares:

- **`id`** — the plugin id (also the route prefix and the registry key).
- **`version`** — semver; enable/disable compare versions for dependencies.
- **`class`** — one of `A–E`, the trust/blast-radius class (enforced on enable).
- **`permissions`** — the kernel-vocabulary permissions the plugin needs (e.g. `students.read`,
  `events.emit`, `audit.request`, `comms.send`, `actions.raise`). These become the row's grant at
  signup/enable (PLG-1), so a stale row under-grants.
- **`entitlement`** — `{plan, billing}` (e.g. `{plan:'rails', billing:'usage-metered'}`).
- **`settingsSchema`** (or `settings_schema`) — the module's settings contract. The settings door
  validates against it; the client renders it; secrets are write-only. Six plugins store the key in
  snake_case, which is why reconciliation normalises to `settingsSchema`.
- **`capabilities`** — declared capabilities surfaced with the registry.
- **`dependencies`** — `id@version` specs checked on enable.
- **`kernel`** — the required kernel version range checked on enable.

The **catalog** (`plugin-catalog.js`) holds the canonical 29 rows and the `DEFAULT_ON` set
(`people.admin`, `ops.visitors`, `ops.timetable`, `files.store`). The catalog's comment is explicit
that it must be regenerated whenever a migration adds a catalog row, and that the credential rails
were once missing from it entirely (which made password reset permanently 503).

---

## Appendix M — The Role × Capability Matrix (representative)

| Capability | owner | principal | coord | counselor | finance | admissions | transport | facilities | technician | teacher | itadmin | parent | student |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Approve school actions | ✓ | ✓ | own | — | own | — | own | own | own | own | own | — | — |
| Fee obligation void | ✓ | — | — | — | — | — | — | — | — | — | — | — | — |
| Confirm payment | ✓ | — | — | — | ✓(head) | — | — | — | — | — | — | initiate | — |
| Publish exam | — | ✓(2nd) | — | — | — | — | — | — | — | propose | — | — | — |
| Class assignments | ✓ | ✓ | ✓ | — | — | — | — | — | — | read own | — | — | — |
| Mark register | office | office | office | — | — | — | — | — | — | own class | office | — | — |
| Wellbeing queue | ✓ | ✓ | ✓ | ✓ | — | — | — | — | — | — | ✓ | — | file |
| Plugin enable/settings | ✓ | ✓ | — | — | — | — | — | — | — | — | ✓ | — | — |
| Custom roles | ✓ | — | — | — | — | — | — | — | — | — | ✓ | — | — |
| API keys/webhooks | ✓ | — | — | — | — | — | — | — | — | — | ✓ | — | — |
| Audit read | ✓ | ✓ | — | — | ✓ | — | — | — | — | — | ✓ | — | — |
| Audit verify | ✓ | — | — | — | — | — | — | — | — | — | ✓ | — | — |
| Migration activate | ✓ | ✓ | — | — | — | — | — | — | — | — | — | — | — |
| Read own children | — | — | — | — | — | — | — | — | — | — | — | ✓ | — |
| Read own world | — | — | — | — | — | — | — | — | — | — | — | — | ✓ |

*(Representative, from the story's role readings; the authoritative matrix is generated by
`scripts/permission-matrix.js`.)*

---

## Appendix N — The Code's Own Best Warnings

A curated set of the comments this story found most valuable, quoted so a reader can feel the
codebase's voice. Each is a real comment (lightly trimmed for length) from the source.

1. *"a plugin that cannot mount must never half-exist."* — the loader's boot-fatal law (Ch. 1).

2. *"Loosening a security posture so a test passes is how postures erode."* — `config.js`, on
   refusing to relax the dev-door guard (Ch. 1).

3. *"A policy must DENY, never RAISE."* — migration `074` (Ch. 26, 38).

4. *"the failure mode ... a missed call site fails CLOSED ... rather than OPEN."* — `db.js`, on
   inverting the pool default (Ch. 26, 38).

5. *"A guard that can never fire reads as protection that does not exist."* — exams, on the dead
   `weightage_locked` guard (Ch. 10).

6. *"the old code set `processed_at` here, which made the only queue gauge FALL as rows failed — a
   total relay failure was indistinguishable from an idle system."* — outbox relay (Ch. 25, 38).

7. *"The LIMIT did not bound the work per tick; it bounded what could EVER be processed."* — workflow
   runner (Ch. 25, 38).

8. *"Counting it separately is what turns 'the ledger is honest' into 'the lie is measurable'."* —
   `/metrics`, on `comms_sandbox_sent` (Ch. 21, 38).

9. *"the desk believed a code was on its way and the guardian had nothing to read out."* — visitors
   pickup (Ch. 13, 38).

10. *"A label is not a selector."* — the notice resolver, refusing to fan out to everyone (Ch. 16).

11. *"the practical effect was that every pickup degraded to the photo-ID override WHILE THE RECORD
    CLAIMED THE IDENTITY CHECK HAD HAPPENED — the worst place in the product for the ledger to lie."*
    — visitors pickup (Ch. 13).

12. *"a name is not an identity."* — `teacher.classroom` (Ch. 9).

13. *"Grades are always recalculated."* — exams moderation (Ch. 10).

14. *"Audited on every rejection rather than only at the attempt ceiling, because 'it hit the ceiling'
    is not the question anyone asks — 'who was at the gate trying codes' is."* — visitors (Ch. 13).

15. *"A verification nobody can prove happened is not evidence."* — `/audit/verify` (Ch. 21).

16. *"the archived table is checked only at the hot→cold boundary; the cold chain itself is not
    walked."* — `/audit/verify` limitations (Ch. 21).

17. *"That is a false NEGATIVE — the safe direction for an absence check."* — the homework inbox
    (Ch. 9).

18. *"Refusing here changes nothing: the vault write and the status flip have not happened yet."* —
    visitors pickup ordering (Ch. 13).

19. *"The debt is real; the runner is not armed."* (paraphrase) — the story's own refrain about the
    unscheduled workers (Ch. 1, 25).

20. *"The structural repair is a `students.user_id` column ... and the teacher roster is the
    authority meanwhile."* — `teacher.classroom`, before the repair existed (Ch. 9, 38).

---

## Appendix O — The Decision-Log Digest (D-25 … D-44)

The project's `.coop` decision log records 43 rulings (D-28 absent). A digest of the load-bearing
ones the story leaned on:

- **D-25** — the AI voice receptionist is removed from scope. (Explains the mock front desk.)
- **D-27** — 90-minute-silence takeover in the factory.
- **D-32** — credentials-last: real provider keys land only in env/plugin settings, never code/git.
- **D-33** — the quality bar: code + negative tests + tsc + honest UI.
- **D-34** — the help channel (post findings there first).
- **D-35** — the app role never gets DELETE; deletes go through scoped helpers.
- **D-37** — auth-contract debts (five landed): restricted tokens, MFA challenges, shared issuance,
  etc.
- **D-40** — claim migration numbers before creating files.
- **D-41** — per-lane test databases.
- **D-43** — a mask ALLOW can lift a base refusal (the librarian preset).
- **D-44** — the cross-zone repair law; also the mustChange test contract.

Together these explain many of the code's choices: why a POST returns exactly one message name for a
temp password, why the loader is boot-fatal, why settings secrets are key-names-only in the audit, and
why the test harness walks a 403→password→session chain.

---

## Appendix P — The One-Page Summary

**What SchoolOS is.** An India-first, multi-tenant, AI-native-shaped school operating system: one
Postgres with database-enforced tenancy, one Fastify API, one React SPA, a governed plugin registry,
an append-only audit ledger, and an event/outbox spine. Staff loop: Today → Attention → Ask → Action
→ Memory. Parents and students get narrow portals inside the same app.

**What is real.** RLS tenancy; scrypt/JWT/OTP/MFA auth; the audit ledger with a verifier; the action
spine with segregation of duties; fees with maker/checker and gateway verification; per-copy library;
visitors with fail-closed child release; DPDP consent/erasure; statutory returns; clinic; HR; cases;
transport write model; a fully live parent suite and student kiosk.

**What is not.** The money UI is disconnected; the counselor has no screens; several teacher/exam
screens are unrouted; the maintenance family is mostly demo; six workers are unscheduled; the
production start recipe is inverted; RLS is FORCE on the kernel but not all domains; there are zero
frontend tests; and the classroom identity path still name-matches.

**The verdict.** The server is a serious, evidence-first system that a school could run on and trust.
The browser is a strong core with a long tail of demo theatre. The distance is the roadmap.

**The last word.** The ledger cannot be torn. Read the comments; they tell you why.

<!-- END OF DOCUMENT -->

---

## Chapter 40 — India-First: The Domain Terms and How SchoolOS Models Them

SchoolOS is explicitly India-first. Much of its vocabulary is regulatory, and a reader unfamiliar with
Indian school administration may miss what a feature is *for*. This chapter maps the terms to the
implementation.

### 40.1 UDISE / UDISE+ 

The **Unified District Information System for Education** is the annual national school-information
return. SchoolOS models it in `ops.udise`: `GET /plugins/ops.udise/export` produces a deterministic
aggregate by **academic year × grade × section**, and `GET /columns` shows the door's column mapping.
Two honest design choices: it **refuses without a configured UDISE code**, and it reports **gender as
`not_recorded`** because the schema has no gender column. It defends against CSV formula injection and
uses CRLF. `GET /returns/udise/validate` validates the return.

### 40.2 CBSE / affiliation / OASIS

The **Central Board of Secondary Education** affiliation is the school's board identity. SchoolOS
models it with the `pack.cbse` rules engine (`R1–R6`): weightage, grade scale, bounds, the 75%
attendance eligibility, report-integrity re-derivation, and board identity. The **OASIS** export
(`GET /plugins/pack.cbse/export/oasis/:examId`) produces the result file. The pack's "gate" raises
kernel **obligations** (e.g. `cbse.weightage.<exam>`) rather than blocking, so a school is told what
is non-compliant while still operating. The board's affiliation number lives in Returns settings.

### 40.3 MPD (Mandatory Public Disclosure)

The CBSE **Mandatory Public Disclosure** is the wall of documents an inspection may ask for. SchoolOS
models it as a vault: `GET /compliance/mpd`, `POST /compliance/mpd/docs`,
`POST /compliance/mpd/docs/:id/retire`. Each document has a state and a lifecycle; retirement is a
status change, not a delete. The wall is a disclosure surface with an audit trail.

### 40.4 RTE / EWS (Right to Education / Economically Weaker Section)

The **RTE Act** requires 25% of entry-level seats for the economically weaker section, with
reimbursement. SchoolOS models it as a ledger: `GET /rte/overview`, `POST /rte/lottery/import` (the
lottery result), `POST /rte/reimbursements` (the reimbursement claims). It is a quota-and-money
ledger, separate from the ordinary admissions funnel.

### 40.5 DPDP Act 2023 (Digital Personal Data Protection)

The **DPDP Act** is India's data-protection law. SchoolOS models it in `pack.dpdp` (Ch. 24): an
immutable **consent ledger** (with expiry derived, not stored), **SAR** export/erasure riding the
kernel approval spine, an **idempotent erasure journal storing only `sha256(subject)` plus a keyed
HMAC surrogate**, and a **breach register** (`GET/POST /dpdp/breaches`, `/contain`). It distinguishes
the plugin lane from the "office lane" and requests a named kernel action for the core student row
rather than writing it.

### 40.6 NEP (National Education Policy)

The **NEP 2020** introduced holistic progress cards (HPC) and foundational literacy/numeracy (FLN)
tracking. SchoolOS models these under `/nep`: `GET /nep/profile`, `PUT /nep/r3`, `GET/POST
/nep/activities`, `POST /nep/hpc`, `GET /nep/hpc/:studentId`, `POST /nep/fln`, `GET /nep/fln`. They
are newer doors and may not all have polished screens.

### 40.7 Tally (accounting)

**Tally** is the accounting software most Indian schools' accountants use. SchoolOS exports to it
read-only: `GET /plugins/accounting.tally/daybook` (an IST day-book of confirmed payments) and
`POST /plugins/accounting.tally/export` (content-addressed XML with an `sha256` ref, audit digest
never amounts). It does not push to Tally; it produces a file an accountant imports. (The
`?company=` injection surface is flagged.)

### 40.8 UPI and Razorpay (payments)

**UPI** is India's real-time payment system; **Razorpay** is a common gateway. SchoolOS models them
as rails that create links/orders (`UPI` intent links, Razorpay orders) and receive signed webhooks
that record **facts only**. Settlement is kernel-owned (Ch. 7). The `payments.upi` plugin builds a
`upi://pay?...` link for a parent; the `payments.razorpay` plugin creates a gateway order.

### 40.9 WhatsApp / SMS / DLT

Indian telecom rules require **DLT** registration of message templates for commercial SMS. SchoolOS
models a **DLT template registry** in `comms.whatsapp` and renders templates for the Meta Cloud API
provider and the SMS rail. The dispatcher drains queued messages through these rails, and delivery
honesty is enforced by callers (Ch. 18).

### 40.10 IST, academic years, terms, and the school day

**IST** (Asia/Kolkata) is the clock throughout: attendance dates, autofill defaults, substitution
defaults, dunning quiet hours, kiosk session windows, and copilot budgets all compute on the IST
clock, precisely because a UTC date lags the Indian school day by 5.5 hours. The **academic year**
(one current per tenant) is the root that terms, fees, and exams hang off.

### 40.11 Payroll, ECS, and staff compliance

Indian school payroll often uses **ECS** (Electronic Clearing Service) bank files. SchoolOS's
payroll-lite produces one (`GET /payroll/runs/:id/ecs-file`). Staff compliance diaries (training,
verification, health checks) exist as doors, because an inspection asks for them.

### 40.12 Why "India-first" is architectural, not cosmetic

The India-first claim is not a flag on a settings page. It is visible in: IST everywhere; the
section-grid model of Indian schools; the fee-plan-by-grade pattern; UDISE/CBSE/MPD/RTE/Tally/DPDP;
UPI/Razorpay; WhatsApp/DLT; the SMC consultation rule for fee hikes; the RTE lottery; the attendance
floor; and the `not_recorded` honesty about a missing gender column. A school in Maharashtra can use
this system in the shape its regulator expects. That is what India-first means here.

---

## Appendix Q — Event Consumers and Their Status

| Topic family | Emitter | Consumer today | Status |
|---|---|---|---|
| `platform.*` | onboarding/school | outbox relay (log) | no business subscriber |
| `people.*` | people.admin | relay (log) | no auto-provisioning |
| `attendance.*` | routes/mark, autofill | relay (log); notices queued directly | comms via dispatcher |
| `homework.v1`, `submission.v1` | teacher.classroom | relay (log) | the claimed guardian digest does **not** exist |
| `exam.*` | exams | relay (log) | publication is approval-driven |
| `fee.*`/gateway | fees/routes | relay (log); Tally reads kernel facts | settlement kernel-owned |
| `admission.*` | admissions.funnel | workflow rule (if runner scheduled) | inert by default |
| `gps.position` | transport.gps | relay (log); action raised directly | notice via approval |
| `visitor.*` / `clinic.*` / `hr.*` | plugins | relay (log) | notices via approval/queue |
| `library.*` | library | relay (log) | no comms (overdue list only) |
| `files.stored.v1` | files.store | relay (log) | no subscriber |
| `action.decided.v1` | action decide | relay (log) | lineage written |
| `consent.recorded.v1`, `sar.*` | pack.dpdp | relay (log) | compliance records |
| `substitution.assigned`, `duty.assigned.v1` | ops.timetable / coord | relay (log) | no subscriber |
| `*` (all) | any | **workflow runner** | real, but unscheduled |

The pattern: the emitters are consistent and the outbox is durable, but the subscriber layer is thin —
which is exactly why the spine exists (so a future rail can attach without touching emitters) and
exactly why scheduling the workers is the first takeover step.

---

## Appendix R — Verification Evidence and How to Reproduce Each Claim

The story's strongest claims, and how to check them.

- **"Tenancy is enforced in the database."** Set `schoolos.tenant_id` to a foreign tenant on an
  app-role connection and `SELECT count(*) FROM app.students` → 0. The `rls-boundary` test pins it.
- **"The ledger is hash-chained and verified."** `GET /audit/verify` → 200 with `ok`, counts, and
  limitations. Run `tests/audit-integrity.test.js`.
- **"The app role has no DELETE."** `tests/acl-d35.test.js`; inspect `information_schema.table_privileges`.
- **"Plugins enforce per request."** Disable a plugin and its doors 409 (`lifecycle-gate.js`).
- **"Money cannot double-settle."** The one-open-payment partial unique index (migration 006) and the
  confirm path's `FOR UPDATE`; `tests/fees*.test.js`.
- **"A caller cannot fabricate gateway verification."** `plugin_razorpay.order_log` /
  `plugin_upi.webhook_log` lookups in the confirm handler; the SEC-8 test.
- **"Anonymous wellbeing stores no identity."** Inspect `student.wellbeing_request` for an anonymous
  row (`creator_user_id` and `student_id` NULL).
- **"Pickup codes are not login OTPs."** `plugin_visitors.pickup_otp` vs `auth.auth_otps` (different
  vaults, different policies).
- **"The role list is single-sourced."** `role-catalog.js` pinned against the DB CHECK by
  `rbac-catalog.test.js`.
- **"The catalog is missing no shipped plugin."** `tests/plugin-catalog-drift.test.js`.
- **"The performance/no-op rules."** `tests/comms-honesty.test.js`; the `/metrics` sandbox gauge.
- **"Documentation counts are generated."** `docs/PERMISSION-MATRIX.md` (route census) and
  `docs/VERIFICATION.md` (test run) are regenerated, not hand-typed.

If a claim in this book cannot be reproduced by one of these, treat it as the author's narration
rather than a verified fact — and re-read the cited chapter's source.

---

## Appendix S — The Twenty-Five Honesty Rules of SchoolOS

These are the principles the story extracted, each backed by a mechanism. They are the closest thing
the product has to a constitution of behaviour.

1. Queued is not sent; sent is not delivered.
2. A sandbox send is never labelled delivered.
3. The ledger is evidence, never the channel.
4. A machine may notice; a human decides.
5. An approval queues; it does not claim delivery.
6. No self-approval; the proposer is never the decider.
7. Owner and finance authority are never delegable.
8. A return that cannot be produced correctly is refused, not guessed.
9. A report card is frozen; corrections are overlays.
10. Consent, once decided, is immutable.
11. Erasure is idempotent and PII-free by the end.
12. A child's disclosure can be structurally anonymous.
13. A child's private note is theirs to delete.
14. Release of a child is fail-closed; the only bypass is an audited override with a note.
15. A rejected release attempt is a high-risk event.
16. A name is not an identity.
17. A tenant is enforced by the database, not by a query filter.
18. Retrofit a human marks are never overwritten by an autofill.
19. Lease, retire — never delete — for structure and estates.
20. Every meaningful write leaves evidence.
21. The constraint carries the reason; read the comment.
22. Measure the lie (sandbox gauges, parked gauges, stalled gauges).
23. Fail closed, not open.
24. A guard that can never fire is not protection.
25. The coverage you do not have is the risk you cannot see.

---

## Appendix T — A Letter to the Next Engineer

Welcome. You are inheriting one of the more honest codebases you will ever read, and also one with a
wide gap between a strong server and an uneven browser. Here is what I would tell you over coffee.

**Read the comments first.** This code documents its failures. The comments are not noise; they are
the institutional memory. If you ignore them, you will "fix" something and reintroduce a bug that was
already fixed once, and the test that pins it will fail and you will not know why.

**Trust the database.** Tenancy, evidence, and money invariants live in Postgres, not in handlers.
When you add a table, give it a `tenant_id`, a policy, and no grants by default; then grant
explicitly. When you need a delete, write a scoped helper. When you need a secret, use a vault with
`USING(false)`.

**Do not strengthen a check by weakening it.** If a gate cannot be enforced because the data does not
exist, build the data (class assignments, the class-ref trigger, the student-link column). If a
different door has weaker rules, fix the sibling, because the weakest door is the real policy.

**Do not let a GET write.** `GET /plugins` self-heals; it is a known smell. Prefer the honesty of a
dedicated repair door.

**Schedule the workers.** The single highest-impact operational fix is to start the workflow, webhook,
day, dunning, and reconcile workers, and to alert on their gauges. The code is ready; the deployment
is not.

**Unify identity.** Finish the `students.user_id` migration across every consumer, starting with
`teacher.classroom`. Everything downstream depends on getting the child right.

**Keep the browser honest.** A dead button is a lie. Where the server is ready (money, counselor,
exams), wire the screen. Where it is not, say so, or remove the button. The product's credibility
rests on the gap between what it says and what it does, and that gap is currently widest in the SPA.

**Measure, don't hope.** The metrics here count failures, not just successes. Add a gauge for every
way the system can silently lie, and alert on it.

**And keep the habit.** Write down why. The reason this system is trustworthy is that every hard
decision has a paragraph next to it naming the failure it prevents. That paragraph is the product.
Protect it.

— The author of this story

---

## Final Note on Sources and Honesty

This document was written by tracing the code in `server/src`, `server/scripts`,
`server/migrations`, `app/src`, and the project's own `docs/`. Where the documentation and the code
disagreed, the story followed the code and said so in a flag. Where a mechanism could not be fully
verified, the story says so rather than asserting it. The counts (145 migrations, ~29 plugins + 
`_shared`, 143 route entries, 85 screen files, 150 test files, ~230 kernel doors, ~249 plugin-door
registrations) are drawn from the repository at the time of writing and will drift; the generated
artifacts (`docs/PERMISSION-MATRIX.md`, `docs/VERIFICATION.md`) are the live truth.

If a claim here is wrong, the correction belongs in the code comment that made the claim checkable
in the first place — which is, in the end, the whole spirit of the system this book describes.

*Fin.*

---

## Chapter 41 — The Plugin-by-Plugin Verdict

For each of the twenty-nine plugins: what it is, what is strongest, and the honest caveat. This is
the summary a reviewer wants before trusting any module.

1. **`people.admin`** — account lifecycle (provision/suspend/activate/reset/transfer/promote/
   withdraw + CSV import). *Strongest:* owner/principal protection and the roster-bound pupil
   account. *Caveat:* no role-change door; destructive confirms are raw `window.confirm`.

2. **`family.view`** — the parent read-plane. *Strongest:* structural child scoping and immutable
   consents. *Caveat:* historical silent-empty on exam columns (fixed path now); guardianship still
   needs office action.

3. **`admissions.funnel`** — the lead lattice. *Strongest:* `offer→enrolled` routes through a kernel
   approval, so the funnel never writes core students. *Caveat:* depends on the workflow runner for
   its follow-up fan-out.

4. **`ops.visitors`** — gate pass + guardian pickup. *Strongest:* fail-closed release, kernel vault,
   redacted ledger, per-attempt high-risk audit. *Caveat:* `apiVisitorVerify` bespoke fetch.

5. **`teacher.classroom`** — homework/submissions/lessons. *Strongest:* one-shot submissions and the
   `created_by` privacy pin. *Caveat:* **name-match student identity** — the biggest structural gap;
   the toast promises a digest the server never sends.

6. **`exams.assessment`** — exams/marks/reports/moderation. *Strongest:* deterministic assembly,
   digest, approval-gated publication, overlay moderation. *Caveat:* the screen is unrouted in prod;
   `weightage_strict` unread.

7. **`pack.cbse`** — the board rules engine + OASIS export. *Strongest:* obligations, not blocks.
   *Caveat:* `weightage_strict` unread.

8. **`student.world`** — the kiosk plane. *Strongest:* structural identity pin, user-scoped RLS,
   session isolation, anonymous wellbeing. *Caveat:* task ticks only persist `kind==='task'`;
   counselor reader exists but has no screen.

9. **`teacher.support`** — concerns/safety box/doubts/interventions/PTM. *Strongest:* structural
   anonymity and teacher-private PTM notes. *Caveat:* mostly no UI.

10. **`teacher.copilot`** — deterministic day-brief/mastery/curriculum. *Strongest:* ask cannot read
    more than the brief; idempotent decay. *Caveat:* it is not AI, and it says so; several screens
    unrouted.

11. **`coord.view`** — the coordinator command plane. *Strongest:* workload as aggregate, no
    rankings. *Caveat:* every screen fetches before its gate.

12. **`ops.timetable`** — grid/periods/slots/substitutions/autofill. *Strongest:* the overlay model
    and the one shared clash check. *Caveat:* autofill ignores its own default setting.

13. **`transport.gps`** — ingestion + delay guard + route write model. *Strongest:* budget before
    write; approval-required notices. *Caveat:* staff-JWT ingestion, no HMAC; `deviationM` unused.

14. **`library`** — the per-copy library. *Strongest:* the reference implementation for state,
    locks, holds, fines. *Caveat:* no comms; `loans/mine` name-match fallback.

15. **`health.clinic`** — infirmary log + sick passes. *Strongest:* append-first history and
    approval-gated notices. *Caveat:* read is nurse-lane; revoke is API-only.

16. **`hr.leave`** — staff absence as a fact. *Strongest:* IST past-date refusal. *Caveat:* declared
    `absence_feed` read by nobody.

17. **`ops.udise`** — the UDISE return. *Strongest:* deterministic; refuses without a code.
    *Caveat:* gender `not_recorded`.

18. **`ops.bi`** — BI read models. *Strongest:* compute-on-read truth. *Caveat:* `cache_seconds`
    unread.

19. **`ops.import`** — dry-run import probes. *Strongest:* shadow validation. *Caveat:* not wired to
    the kernel staging path.

20. **`files.store`** — private storage. *Strongest:* four-way upload cap, audited grant/refusal.
    *Caveat:* no presigned URLs; Documents upload wrappers dead.

21. **`comms.whatsapp`** — DLT registry + receipts. *Strongest:* non-clobbering merge. *Caveat:* no
    send door; `/receipts` RLS-only predicate.

22. **`rails.email` / `rails.sms` / `rails.whatsapp`** — provider adapters. *Caveat:* `ok:true` on
    missing creds; email cleartext AUTH LOGIN risk.

23. **`payments.razorpay` / `payments.upi`** — gateway rails. *Strongest:* hard gate stack, replay
    dedupe, never settle. *Caveat:* Razorpay has no idempotency keys; UPI never compares amount.

24. **`accounting.tally`** — read-only Tally export. *Strongest:* content-addressed. *Caveat:* XML
    injection surface.

25. **`pack.dpdp`** — consent/SAR/erasure. *Strongest:* immutable ledger, approval-gated erasure,
    PII-free idempotent journal. *Caveat:* office-lane redaction is a requested kernel action.

26. **`parent.assistant`** — deterministic parent copilot. *Strongest:* own-children-only, honest
    unknowns. *Caveat:* `brief_log` retains child-name JSON with no purge.

27. **The catalog / settings** — declared per-plugin. *Caveat:* six settings unread across plugins.

28. **Master-Action-Plan doors** — newer compliance surfaces. *Caveat:* door-without-polish for
    parts of it.

29. **The three credential rails** — born off. *Caveat:* enabling is an audited owner action; a rail
    without credentials reports sandbox (honestly).

The verdict in one line: **the plugins are individually careful and collectively under-surfaced; the
backends are the strength, the browser is the debt.**

---

## Appendix U — The SQL Idioms of SchoolOS

Thirty-nine patterns that, once recognised, let you read almost any query in this codebase.

1. **Tenant is never in the body.** `INSERT ... (tenant_id, ...) VALUES ($1, ...)` with `$1` from
   `req.user.tenant_id`.
2. **RLS does the filtering.** Queries often omit an explicit tenant predicate; the policy supplies
   it.
3. **`FOR UPDATE` on read-modify-write.** Locks a row before a JSONB or state change.
4. **`FOR UPDATE OF alias`.** Locks one joined table, not both.
5. **Stable lock order.** Sort ids before locking to prevent deadlocks (`[...ids].sort()`).
6. **`ON CONFLICT ... DO UPDATE`** for upserts (attendance, sections, substitutions).
7. **`ON CONFLICT ... DO NOTHING`** for idempotent generation (fee obligations, allocations).
8. **A partial unique index as law** (one open payment, one current year, one class owner).
9. **`ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING`** for comms dedupe.
10. **`SAVEPOINT` around a unique insert**, then `ROLLBACK TO SAVEPOINT` and a friendly 409.
11. **`NOT EXISTS` for idempotent inserts** (autofill present-only).
12. **`WHERE NOT EXISTS` for catalog self-heal.**
13. **`jsonb_array_elements` CROSS JOIN** to fan a template across students.
14. **`jsonb_build_object`** for structured evidence fields.
15. **Generated columns** for derived money (`net_amount_cents`).
16. **`current_setting('schoolos.tenant_id', true)::uuid`** in hand-written predicates.
17. **`app.current_tenant()`** in policies (the NULLIF-wrapped helper).
18. **`USING(false)`** for kernel-only vaults.
19. **Owner pins** via `schoolos.user_id` for private student rows.
20. **`pg_advisory_xact_lock`** for per-tenant serialisation (audit chain, receipt numbers).
21. **`FOR UPDATE SKIP LOCKED`** for worker queues.
22. **`make_interval(mins => $n)`** for TTL stamps.
23. **`now() + ($n || ' hours')::interval`** for SLA deadlines.
24. **`now() AT TIME ZONE 'Asia/Kolkata'`** for the school day.
25. **`date_trunc('month', now())`** for monthly budgets.
26. **`FILTER (WHERE status IN ('present','late'))`** for attendance aggregates.
27. **`DISTINCT ON (...) ... ORDER BY valid_from DESC`** for latest consent state.
28. **`count(*) OVER ()`** to detect ambiguity in one query (name matches).
29. **`to_regclass('schema.table') IS NOT NULL`** for optional plugin tables.
30. **`information_schema` probes** for sibling-schema drift.
31. **`catch` only on `42P01`** — missing table degrades; wrong column surfaces.
32. **`randomUUID()`** for codes and per-instance action codes.
33. **`sha256`/`scrypt`/`timingSafeEqual`** for hashing and constant-time compares.
34. **`regexp_replace(...,'\\D','','g')`** for phone digit-normalisation.
35. **Digit-normalised matching** across surfaces for erasure/format insensitivity.
36. **`LEFT JOIN` for the register**, so unmarked students show null.
37. **`UNION` of family shapes** in the audience resolver.
38. **`UPDATE ... AND active RETURNING`** for soft-retire.
39. **SQLSTATE branching** (`23505`, `23503`, `22P02`, `42703`, `42P01`) for friendly errors.

Recognising these turns a 453-kB `routes.js` from opaque into legible: most of it is these idioms
applied to a domain.

---

## Appendix V — Frequently Asked Architecture Questions

**Why is there no ORM?** The tenancy and audit guarantees are Postgres features (RLS, `SECURITY
DEFINER`, triggers, advisory locks) that an ORM would obscure.

**Why is `dataset` server-owned?** So demo and live share one data origin; the allowlist keeps a
real tenant's world empty.

**Why is the loader boot-fatal?** So a plugin that cannot mount never half-exists.

**Why is the lifecycle gate per request?** So enable/disable takes effect immediately.

**Why is the audit in the same transaction as the data?** Evidence cannot diverge from the change.

**Why does `emitEvent` write both `events` and `outbox`?** One for humans, one for machines.

**Why do so many doors queue instead of send?** Queued ≠ sent; a synchronous send couples a user to a
provider and lies about completion.

**Why the maker/checker split?** Because the person who collects money should not be the only one who
confirms it.

**Why is the student session short and the storage cleared?** Shared kiosks.

**Why is identity a column, not a name?** A name is ambiguous; an identity must be exclusive.

**Why are there so many comments?** Each encodes a failure the codebase already paid for.

**Why does the product admit so many gaps?** An admitted gap is a managed risk; a hidden gap is a
future incident.

---

## Chapter 42 — A Guided Tour of the Two Big Files

`server/src/routes.js` (≈453 KB) and `server/src/app.js` (≈152 KB) hold most of the kernel. To a
new reader they look impenetrable. This chapter walks their structure so you know where to look.

### 42.1 `app.js` — the platform frame

- **Preamble and imports** — pg, crypto, config, the shared helpers (`audit.js`, `db.js`,
  `custom-roles.js`, `role-catalog.js`, `governance.js`, settings/schema validators).
- **Cookie helpers** — `SESSION_COOKIE`, `CSRF_COOKIE`, `readCookie`, `issueSessionCookies`,
  `clearSessionCookies`, and the `app.decorate('issueSessionCookies', ...)` expose (the C-3 fix for
  `/onboard/signup`).
- **`API_DOOR_SCOPES`** — the API-key allowlist (`GET /me`, `/dataset`, `/students`, `/attendance`,
  `/metrics`, `/audit/verify`).
- **`studentIdle`** — the fallback idle map.
- **`app.decorate('authenticate', ...)`** — the corridor: API-key branch, cookie/bearer, CSRF, JWT,
  jti denylist, live user row, epoch, restricted tokens, student idle, mask, failure taxonomy.
- **Health** — `GET /health`, `GET /ready`.
- **Login/renew** — `POST /auth/login` (the four outcomes), `POST /auth/renew`, `issueSession`,
  `mfaChallenge`.
- **OTP/SSO/logout** — `/auth/otp/*`, `/auth/google/*`, `/auth/logout`.
- **Tenant switch** — `/me/tenants`, `/me/switch`.
- **Password/MFA/reset/step-up** — `/me/password`, `/me/mfa/*`, `/me/reset-*`, `/me/step-up`.
- **`/me`, `/me/effective`** and identity reads.
- **Custom roles** — the mount of `custom-roles` gates.
- **Workflow rules** — `/workflow-rules` (with the soft-delete).
- **Metrics** — `/metrics` with the honest gauges (tenant + fleet).
- **Onboarding mount** — `registerOnboarding(app)` before plugins.
- **Plugin loader mount** — `loadPlugins(...)`, boot-fatal.
- **Kernel routes mount** — `registerRoutes(app)`.
- **`/dataset` and `/capabilities`.**
- **`app.requireStepUp`, `app.requireRole`** — the shared gates handed to plugins.

If you are chasing an auth question, it is in the second half of `app.js`. If you are chasing a
governance question, it is in the metrics/workflow region.

### 42.2 `routes.js` — the school's operations

The file is organised in clearly-commented sections. In order:

- **`normalizeClasses`** and the structure helpers (module scope, exported).
- **Semver/kernel-compat helpers** (`KERNEL_VERSION`, `semverCmp`, `kernelSatisfies`,
  `dependencySpec`).
- **The notice audience resolver** (`NOTICE_ARMS`, `noticeArm`, `resolveNoticeRecipients`) and
  `assertTeacherOwnsClasses` — the ownership assertion.
- **Students** — `GET /students`, `GET /students/:id`, `POST /students`, `linkStudentUser`.
- **Attendance** — `GET /attendance`, `POST /attendance/mark`.
- **Classes/subjects** — `GET/PUT /school/classes`, `GET/POST /school/subjects`.
- **Class assignments** — `GET/POST /class-assignments`, `DELETE .../:id`, `GET /school/staff`.
- **Academic years** — `GET/POST`, `/activate`.
- **Master Action Plan** — MPD, RTE, payroll, billing, NEP, infra, meetings, health-checks, meals,
  trainings, staff-verifications, dpdp breaches, safety checks, attendance QR, staff-attendance,
  returns, careers, followups.
- **Fees** — settings, late fees, entitlements, heads, plans, generate, void, obligations, invoice,
  student fees, payments, confirm, refund, reconcile, receipts, delivery, installments, concessions,
  dunning, pins.
- **Work orders/assets** — `GET/POST /work-orders`, status, `GET /assets`.
- **Cases** — `GET /cases`, `/:id`, `/my-cases`, `POST /cases`, `/:id/status`.
- **Actions** — `GET /actions`, delegation reads/writes, the decide handler, `owner/actions`,
  stale actions.
- **Payments live loop** — refund + reconciliation + match queue.
- **Events/notifications/communications/audit/verify/memory/lineage.**
- **Plugins** — `GET /plugins`, enable, disable, settings.
- **Migration** — sources, stage, stage-rows, validate, commit, activate.
- **Oversight** — reports/board-pack, snapshots, briefs, home aggregates, announcements,
  compliance, MPD, certificates, policy-documents, appraisals.

The lesson: `routes.js` is not one file so much as a bookshelf. Read the section headers and you can
find any door in seconds.

### 42.3 The plugins folder

Each `server/src/plugins/<id>/` has an `index.js` (registers doors) and usually a `manifest.js`
(declaration). Shared seams live in `_shared/`:
`ai-gateway.js`, `lifecycle-gate.js`, `uuid-param.js`, `delivery-honesty.js`, `phone.js`,
`enrolment.js`, `exam-report.js`, `admissions-access.js`, `substitute-suggest.js`. If a rule is
duplicated in two plugins, look in `_shared/` — the project has been moving shared rules there.

### 42.4 The app folder

`app/src/` is organised as:

- **`screens/`** — one file per screen (85 `.tsx`), each usually with a demo/live split.
- **`services/`** — the transports: `liveApi.ts` (the compliant one), `parentApi`, `studentApi`,
  `coordApi`, `teacherFixtures`, `onboardingApi`, plus field-specific wrappers.
- **`data/`** — `dataset.ts` (`ensureDataset`), types.
- **`lib/`** — `roles.ts`, `grants.ts` (display-only), `demoMode.ts`, `effective.ts`, `format.ts`,
  `friendlyErrors.ts`, `theme.ts`.
- **`components/`** — the shell, nav, tables, modals, icons, the UI kit.
- **`plugins/`** — `pluginRegistry.ts`, `useKernel.tsx`, `PluginSettingsForm.tsx`, widgets.
- **`state/`** — the client store (the story's soft spot).
- **`i18n/`** — the hand-rolled translations.

Knowing this layout is the difference between "the money screen is somewhere" and "money is
`screens/Fees.tsx` + `screens/FeePlans.tsx`, the transport is `liveApi`, and the guard is
`grants.ts`."

---

## Appendix W — The Seed Dataset (Meridian) in Detail

`server/scripts/seed.js` builds a demo world for the Meridian tenant. The story references it; here
is what it creates (from the file's own description and the project map):

- **1 tenant** (meridian), **12 users** (one per role minus counselor, all password
  `schoolos-demo`).
- **375 students** (Grades 6–10 × 3 sections), 375 guardians.
- **375 fee plans** and **1,125 obligations**.
- **4 routes** + **17 stops**.
- **6 assets** + **4 work orders** + events.
- **3,750 attendance rows** (10 days).
- **1 case** + **1 action** (with `ai_involved`) + **1 GPS delay** + **5 events** + **1
  communication**.
- **5 migration sources**, **1 memory entry**, **1 genesis audit row**.
- **~8,030 rows total**; **zero outbox rows** and **zero custom roles**.
- Plugin rows come from **replaying migrations `009`–`048`** plus `ensurePluginCatalog` — with a
  recorded hazard that the hard-coded list historically stopped at `048`, so later per-tenant
  hardening could silently unwind on re-seed (patched by hand for `074`).

The seed is guarded: it **TRUNCATEs all tenants**, so it requires `--allow-nuke` since a 2026-09-12
incident. The demo user is `principal@meridian.edu` / `schoolos-demo`.

This dataset is what `/dataset` serves to the SPA for the demo tenant, and it is why a visitor can
see a populated world without a real school.

---

## Appendix X — Troubleshooting Matrix

| Symptom | Likely cause | Where to look |
|---|---|---|
| Every request 401 after a password change | session epoch bumped | Ch. 26; `/me` returns `session ended` |
| 409 on login | same email in multiple schools | the 409 picker (Ch. 26) |
| 403 `mustChange` | temp-password account | `/account/password` (Ch. 5) |
| Plugin doors 409 | module disabled/registered | lifecycle gate (Ch. 4) |
| Empty list everywhere | tenant GUC unset (fail-closed) | `withUser` path (Ch. 26) |
| Message "sent", nobody got it | sandbox rail | `comms_sandbox_sent` (Ch. 18) |
| Approval does nothing | worker unscheduled | Ch. 1, 25 |
| `/dataset` empty for a real school | allowlist by design | Ch. 2 |
| Parent sees nothing | no `family.child_link` | Ch. 5, 22 |
| Pupil portal empty | account not bound via `students.user_id` | Ch. 5, 23 |
| Teacher can't mark | no class assignment | Ch. 8 |
| Exam publish refused | weightage ≠ 100 or approval pending | Ch. 10 |
| Payment won't confirm | obligation void / no gateway evidence | Ch. 7 |
| Refund leaves ledger unchanged | gateway refused first | Ch. 7 |
| Audit verify breaks | legacy v1 or true alteration | Ch. 21 |
| Backup restore incomplete | missing roles/files/erasure replay | Ch. 1, 30 |
| `q()` route returns nothing | tenant GUC unset (by design) | Ch. 26 |

---

---

## Chapter 43 — The Human Story: Why Any of This Matters

Strip away the tables and the corridors and the hash chains, and a school office is a place where a
small number of adults try to keep promises to a large number of children. The promises are ordinary:
a bus will come, a fee will be recorded, a fever will be noticed, a form will be filed, a mark will
be fair, a child will be released to the right person. Systems like this exist because ordinary
promises are hard to keep at scale, and because when they break, the person who pays is usually
someone with no power to complain.

SchoolOS is interesting precisely because it takes those ordinary promises seriously enough to build
mechanisms for them:

- **A bus will come.** A GPS ping that crosses a threshold does not fire a message; it drafts one and
  waits for a person to approve. The machine notices; the human decides.
- **A fee will be recorded.** One open payment per obligation; gateway evidence verified against the
  provider's own record; a receipt number that cannot silently collide; a ledger that cannot be
  edited after the fact.
- **A fever will be noticed.** The clinic log cannot be rewritten, only appended to; a correction
  that escalates the danger re-fires a guardian notice through an approval, because a duty of care
  cannot be discharged by editing a form.
- **A child will be released to the right person.** A one-time code in a vault no request can read; a
  release that fails closed; a rejected attempt recorded at high risk; an override that forces a
  human to write down why.
- **A mark will be fair.** Reports are a pure function, frozen with a digest; a correction is an
  overlay that never rewrites history; the grade is re-derived, never typed.
- **A form will be filed.** A consent that, once decided, cannot be edited; a return that refuses to
  guess; an erasure that removes the person's name from every surface it owns and leaves a
  decision trail that contains no PII.

None of this is glamorous, and the product's marketing ("AI-native") overstates the intelligence by a
wide margin. But the machinery has a moral center: **it prefers stopping and asking to proceeding and
pretending.** That preference is implemented as fail-closed gates, approval queues, immutable records,
honesty gauges, and a ledger that is hard to lie to.

The flaws catalogued in this book are real, and some are serious — an unscheduled worker is a promise
not kept; a disconnected money screen is a job not doable; a name-based identity is a child who may be
confused for another. But the flaws live inside a system whose authors wrote down exactly what they
were, and that is the rarest quality in software. It means the system can be fixed by reading it.

So the final word is not about architecture. It is this: a school can be run on the strength of small
promises kept, and this system was built, with unusual care about not lying, to keep them.

---

## Appendix Y — Key File Reference Index

A quick index to the files the story leaned on most, so a reader can go to the source.

**Server kernel**
- `server/src/app.js` — auth corridor, login, MFA, tenant switch, workflow rules, metrics, loader
  mount.
- `server/src/routes.js` — every kernel door (Section 42.2 lists them in order).
- `server/src/onboarding.js` — signup, school profile, checklist.
- `server/src/db.js` — pool, `q`/`sysq`/`tx`/`withUser`, the constrained-default comment.
- `server/src/audit.js` — `auditLog`, `emitEvent`, `linkLineage`, `requestAudit`.
- `server/src/plugin-catalog.js` — the 29-row catalog and `DEFAULT_ON`.
- `server/src/plugin-permissions.js` — declared-permission reconciliation.
- `server/src/custom-roles.js` — masks, `applyMask`, `canReach`.
- `server/src/role-catalog.js` — the canonical role list and capability map.
- `server/src/custom-roles.js` / `entitlements.js` / `governance.js` — RBAC, plans, budgets.
- `server/src/effective-access.js` — render hints.
- `server/src/config.js` — fail-closed production guards, dev doors.

**Plugins (by path)**
- `server/src/plugins/_shared/ai-gateway.js`, `lifecycle-gate.js`, `uuid-param.js`,
  `delivery-honesty.js`, `phone.js`, `exam-report.js`, `admissions-access.js`,
  `substitute-suggest.js`.
- `server/src/plugins/<id>/index.js` and `manifest.js` for each of the 29 modules.

**Scripts**
- `server/scripts/migrate.js`, `bootstrap.js`, `seed.js`, `check.js`,
  `permission-matrix.js`, `parity-gate.js`, `verification-artifact.js`.
- `server/scripts/outbox-worker.js`, `workflow-worker.js`, `comms-dispatcher.js`,
  `webhook-worker.js`, `retention-worker.js`, `day-worker.js`, `dunning-reminders.js`,
  `reconcile-payments.js`, `replay-erasure-journal.js`.
- `server/scripts/backup.sh`.

**Frontend**
- `app/src/App.tsx` — routing and gates.
- `app/src/components/Shell.tsx` — nav, topbar, badges.
- `app/src/services/liveApi.ts` — the compliant transport; the other transports sit beside it.
- `app/src/screens/Onboard.tsx`, `Login.tsx`, `Fees.tsx`, `FeePlans.tsx`, `Attendance.tsx`,
  `PeopleAdmin.tsx`, `Cases.tsx`, `Library*`, `VisitorsBoard`-backing screens, `Returns.tsx`.
- `app/src/lib/roles.ts`, `grants.ts`, `demoMode.ts`, `effective.ts`.
- `app/src/plugins/useKernel.tsx`, `pluginRegistry.ts`.
- `app/src/state/store.tsx` — the client store.

**Migrations to read first**
- `001_init.sql` (tenancy), `006` (ledger + money invariants), `008` (auth), `053` (signup),
  `054` (grants), `055` (academic years/epoch), `063` (custom roles), `072` (DELETE ban),
  `073` (parking), `074` (deny-never-raise), `075` (audit pinning), `076` (discovery markers),
  `077` (column scope), `079` (counselor), `083` (class assignments), `132` (student identity).

**Docs of record**
- `docs/PROJECT-MAP.md`, `docs/DATA-FLOW.md`, `docs/BACKEND-MAP.md`,
  `docs/PERMISSION-MATRIX.md` (generated), `docs/VERIFICATION.md` (generated),
  `docs/PERFECT-100.md` (the audit of record), `docs/ONBOARDING-NEW-SCHOOL.md`,
  `docs/SYSTEM-WORKFLOW-GUIDE.md`, and `docs/SCHOOLOS-STORY.md` (this book).

---

## Appendix Z — Closing Checklist for a New Operator

Before inviting a real school:

- [ ] `NODE_ENV=production` with a real `DATABASE_URL`, explicit `CORS_ORIGINS`, a 32+ char
      `JWT_SECRET`, a 32+ char `PLUGIN_SETTINGS_KEY`, `SEED_GUARD=strict`.
- [ ] `npm run migrate` **then** `node scripts/bootstrap.js`.
- [ ] **All workers scheduled**: outbox, comms, workflow, webhook, day, dunning, homework-reminders,
      reconcile, retention.
- [ ] Backup timer installed; one restore rehearsed (DB + `FILES_DIR`).
- [ ] Alert rules on `outbox_parked`, `comms_sandbox_sent`, `wh_stalled`, `api_heartbeat_age`,
      `backup_age`.
- [ ] TLS at the edge; HSTS; no plain HTTP in production.
- [ ] `GET /audit/verify` baseline recorded.
- [ ] `SELF_SIGNUP_ENABLED` set deliberately.
- [ ] Credential rails configured (SMS/WhatsApp/email/UPI/Razorpay) or left off consciously.
- [ ] Tell staff which screens are real (Appendix J) before training.
- [ ] Confirm the class assignments exist before any teacher tries to mark attendance.
- [ ] Confirm every parent has a `family.child_link` and every pupil account is roster-bound.

Check every box and the system will keep its promises. Skip the workers, and the promises will pile
up in the outbox, looking exactly like a quiet, healthy queue.

---

## Chapter 44 — Thirty Questions, Answered in the System's Own Voice

Each question is one a real stakeholder would ask, and each answer is grounded in the code and the
chapters above.

**1. If two people mark the same child's attendance, what happens?**
One row per child per day (UNIQUE tenant/student/date). The second mark updates the first; a no-op
re-submit is not audited; a change is audited from→to. (Ch. 8)

**2. Can a teacher mark a class they don't own?**
No. The door derives the class from the student rows and checks `app.class_assignments`. (Ch. 8)

**3. Can a parent see another family's child by guessing an id?**
No — 403 with no data; scoping is a `family.child_link` join, and RLS is the backstop. (Ch. 22)

**4. Can a parent edit an attendance mistake?**
No. They file a discrepancy; the office corrects it, audited. (Ch. 22)

**5. What stops double-billing a term?**
UNIQUE `(tenant, student, term, label)` with `ON CONFLICT DO NOTHING`. (Ch. 7)

**6. What stops two payments for one obligation?**
A partial unique index on open payments; the initiate door also checks. (Ch. 7)

**7. Can a finance clerk confirm their own collection?**
No — confirm is finance/finance_head/owner; large refunds exclude the settler. (Ch. 7)

**8. Can a caller fake "gateway verified"?**
No — the reference must exist in the provider's own log for this payment. (Ch. 7)

**9. Can an audit row be edited?**
No — a BEFORE UPDATE trigger forbids it, and the app role has no UPDATE. (Ch. 21)

**10. How do I know the ledger wasn't tampered with?**
`GET /audit/verify` recomputes the chain and reports breaks and limits. (Ch. 21)

**11. What if the database is down?**
Auth answers 503, not 401; `/ready` is 503; `/health` is 200-degraded. (Ch. 26)

**12. Can a suspended user keep using a live token?**
No — the kernel re-reads the user row every request. (Ch. 26)

**13. Can an old token survive a password change?**
No — the epoch changed. (Ch. 26)

**14. What's the difference between queued, sent, and delivered?**
Accepted, carrier-accepted, carrier-confirmed. Only a real carrier sets `delivered`. (Ch. 18)

**15. A message says "sent" but nobody got it.**
Check the provider; sandbox sends are counted in `comms_sandbox_sent`. (Ch. 18, App. X)

**16. Can a machine text every parent by itself?**
No — it raises an approval with a drafted message; a human decides. (Ch. 12, 16)

**17. Can a principal approve their own proposal?**
No — self-approval is blocked; owner-owned actions are the owner's exception. (Ch. 16)

**18. Can the principal rubber-stamp the coordinator's desk?**
No — that routes to the owner. (Ch. 16)

**19. Can approval authority be delegated to finance?**
Never — owner and the finance tier are non-delegable. (Ch. 16)

**20. Can an exam's marks be silently changed after publication?**
No — reports are frozen; corrections are overlays; the family sees the same as the office. (Ch. 10)

**21. Can a consent be un-decided?**
No — a new consent supersedes; the DB trigger forbids editing a decided row. (Ch. 22, 24)

**22. Can erasure leave a copy of the phone somewhere?**
The pack erases every surface it owns to a keyed surrogate; the journal stores only a hash. (Ch. 24)

**23. Can an anonymous wellbeing report identify the child?**
No — anonymous rows store no identity columns, and the reader tier excludes the classroom teacher.
(Ch. 23)

**24. Can a rejected pickup code pass unnoticed?**
No — every rejection is a high-risk audit row. (Ch. 13)

**25. Can a child be released without guardian verification?**
Only by an owner/principal override with a mandatory note, audited high-risk. (Ch. 13)

**26. Can a plugin be disabled and abandon open work?**
No — the drain protocol hands open actions back to the principal desk. (Ch. 4)

**27. Can a disabled plugin's doors still run?**
No — the lifecycle gate reads the DB per request and 409s. (Ch. 4)

**28. Can a plugin write outside the tenant?**
No — every plugin request runs as the constrained role under RLS. (Ch. 26)

**29. Does the "AI" call a model?**
No shipped plugin calls the gateway; copilots are deterministic and say so. (Ch. 19)

**30. Can I run the system and trust the records?**
Yes, provided an operator schedules the workers, fixes the start path, and tells staff which screens
are real. (Epilogue, App. J, App. Z)

---

## Appendix AA — The Hardening Campaign Timeline

The project's git history and audit read as a series of campaigns. A condensed timeline:

- **Foundation** — kernel migrations `001`–`020`; the RLS predicate and the audit ledger established.
- **Domain build-out** — `021`–`048`: timetable, DPDP, visitors, exams, homework, student world,
  auth rails, outbox backoff.
- **The DATA-FLOW build-out wave** — RLS coverage grew 73→86 policies; SMS/WhatsApp/Razorpay rails,
  the comms dispatcher, library v2, files.store, people.admin, retention, `/metrics`,
  `/capabilities`; every module shipped disabled.
- **Governance and security waves** — `049`–`077`: RLS sweep, grants re-baseline, academic years,
  MFA, refunds, custom roles, the DELETE ban, parking, the deny-never-raise rewrite, audit pinning,
  column scope.
- **PERFECT-100 campaign** — 122 findings; implementation 53/100, enterprise-readiness 34/100; fixes
  landed across migrations `072`–`107` and new test files.
- **RBAC-2 / role work** — `counselor` made issuable (`079`); the catalog single-sourced; the custom
  mask unified across kernel and plugin gates.
- **Student identity repair** — `132`: `app.students.user_id`; the roster account binding; the
  structural pin in `student.world`.
- **Class-reference repair** — `134`/`135`/`140`/`141`: classes/sections/subjects/assignments and
  `sync_student_class_ref`.
- **Master Action Plan** — `142`–`147`: MPD/RTE/payroll/billing, counter-PIN, action-plan batches,
  safety audit, reconciliation match queue.
- **The current state** — a green suite (per the latest commit), migrations through `147`, and the
  post-sprint documentation (this book among it).

The campaign names matter because they explain the code: each migration and comment is the residue of
a campaign with a goal, not a random feature.

---

## Appendix AB — The Chain: From Click to Consequence

For twelve representative actions, the complete chain: the click, the request, the database writes,
the audit, the event, the worker, and the consequence the school actually sees. This is the story's
core loop, compressed into a reference table.

### AB.1 A new school signs up
- **Click**: "Create my school" on `/onboard`.
- **Request**: `POST /onboard/signup`.
- **DB**: `app.tenants` insert; `app.users` owner insert; 29 `app.plugins` rows; `app.audit_log`;
  `app.events` + `app.outbox`; `app.workflow_rules`.
- **Audit**: `Tenant onboarded (self-signup)`.
- **Event**: `platform.tenant.onboarded.v1`.
- **Worker**: outbox relay logs; no business subscriber.
- **Consequence**: an empty, owned, isolated world with a checklist.

### AB.2 The owner defines classes
- **Click**: save on `/classes`.
- **Request**: `PUT /school/classes`.
- **DB**: `app.tenants.config.setup.sections`; upsert `app.classes`/`app.sections`; soft-retire
  removed.
- **Audit**: `Updated classes & sections`.
- **Event**: `platform.school.classes.updated.v1`.
- **Worker**: relay logs.
- **Consequence**: every picker, roster, and fee plan now shares one structure.

### AB.3 Provision an IT admin
- **Click**: create on `/people-admin`.
- **Request**: `POST /plugins/people.admin/users`.
- **DB**: `app.users` with `force_change=true`; temp hash.
- **Audit**: `User provisioned` (medium).
- **Event**: `people.user.created`.
- **Worker**: relay logs.
- **Consequence**: a one-time temp password; first sign-in forces a change.

### AB.4 Admit a student
- **Click**: add person.
- **Request**: `POST /students`.
- **DB**: `app.students`; trigger sets class/section refs; `app.guardians`; maybe
  `family.child_link`.
- **Audit**: `Created student`.
- **Event**: `event.people`.
- **Worker**: relay logs.
- **Consequence**: the child is a joinable node for attendance/fees/exams/etc.

### AB.5 Mark attendance
- **Click**: mark register.
- **Request**: `POST /attendance/mark`.
- **DB**: upsert `app.attendance`; per-change `app.audit_log`; queued `app.communications`
  (ABSENCE_NOTICE); `app.events`+`app.outbox`.
- **Audit**: `Attendance for <id> on <date>: present → absent`.
- **Event**: `attendance.absences`.
- **Worker**: comms-dispatcher sends (if a rail is configured).
- **Consequence**: guardians of newly absent children get an honest notice.

### AB.6 Post homework
- **Click**: post on the teacher screen.
- **Request**: `POST /plugins/teacher.classroom/homework`.
- **DB**: `teacher.homework`.
- **Audit**: `Homework posted`.
- **Event**: `homework.v1`.
- **Worker**: relay logs; no guardian digest (the toast lies).
- **Consequence**: the assignment appears; the claimed message does not.

### AB.7 Submit homework
- **Click**: submit.
- **Request**: `POST .../homework/:id/submit`.
- **DB**: `teacher.submission` (UNIQUE), name-resolved student id.
- **Audit**: `Homework submitted`.
- **Event**: `submission.v1`.
- **Worker**: relay logs.
- **Consequence**: one submission, late-flagged at insert; the identity caveat applies.

### AB.8 Publish an exam
- **Click**: request publish → approve (by a second person) → execute.
- **Request**: `POST /exams/:id/publish`, `POST /actions/:id/decide`,
  `POST /exams/:id/publish/execute`.
- **DB**: `app.actions`; `plugin_exams.report` snapshots + digest; exam published.
- **Audit**: `publication requested`, `Approved action…`, `exam published (kernel-approved)`.
- **Event**: `exam.published.v1`.
- **Worker**: relay logs.
- **Consequence**: frozen, verifiable report cards; families see the moderated figure.

### AB.9 Pay a fee
- **Click**: Pay on `/parent/fees`.
- **Request**: `POST /fees/payments`; then gateway order; gateway webhook;
  `POST /fees/payments/:id/confirm`.
- **DB**: `app.payments`; `app.payment_allocations`; `app.fee_obligations.paid_cents`; `app.fee_receipts`;
  `app.communications` (FEE_RECEIPT); `app.payment_events`.
- **Audit**: `Initiated payment`; `Confirmed payment (gateway reference … verified …)`.
- **Event**: `payment.initiated`, `payment.confirmed`.
- **Worker**: comms-dispatcher sends the receipt.
- **Consequence**: money moved once, receipt immutable, family and office agree.

### AB.10 Issue a library book
- **Click**: issue at the desk.
- **Request**: `POST /plugins/library/loans`.
- **DB**: `library.loan`; `library.copy.status='issued'`; fulfil holds; notification.
- **Audit**: `Book issued`.
- **Event**: `library.loan.issued.v1`.
- **Worker**: relay logs.
- **Consequence**: the physical copy's state changes; due date set; fine at return.

### AB.11 Release a child
- **Click**: request pickup → guardian reads code → verify → complete.
- **Request**: `POST .../visitors/:id/pickup`; `.../pickup/verify`; `.../complete`.
- **DB**: `plugin_visitors.pickup_otp`; `plugin_visitors.visit`; redacted `app.communications`.
- **Audit**: `pickup OTP raised`; `guardian pickup verified`; or high-risk `… code rejected`.
- **Event**: `visitor.pickup.requested.v1`, `visitor.pickup.verified.v1`, `visitor.completed.v1`.
- **Worker**: rail send happens inline (not queued) for a live code.
- **Consequence**: a child is released to a verified adult, or the release is blocked and audited.

### AB.12 Erase a data principal
- **Click**: open SAR → approve → execute with step-up.
- **Request**: `POST /plugins/pack.dpdp/dsr`; `POST /actions/:id/decide`;
  `POST /plugins/pack.dpdp/dsr/:id/execute`.
- **DB**: `plugin_dpdp.sar`; `plugin_dpdp.consent` rewritten to surrogates; `plugin_admissions.lead`
  redacted; guardians/comms/OTP/_journal; a kernel action for the core student row.
- **Audit**: `SAR erasure opened`; approval; `SAR export/erasure …`; the kernel core-lane audit.
- **Event**: `sar.opened.v1`; `sar.fulfilled.v1`.
- **Worker**: erasure replay journal is idempotent.
- **Consequence**: the person's PII is gone from the surfaces the pack owns; the decision trail
  remains, PII-free.

### AB.13 The chain in one line

Every chain has the same shape: **click → authenticated request → tenant-scoped transaction →
audited write → event + outbox promise → worker → consequence.** Domain differences are differences
of tables and gates, not of architecture. That uniformity is the product's quiet achievement.

---

## Appendix AC — The System in Numbers

A snapshot card. These figures drift; the generated artifacts are authoritative.

| Measure | Figure (at writing) | Source |
|---|---|---|
| Migration files | 145 (latest `147_…`) | `server/migrations/` |
| Plugin directories | 30 (29 plugins + `_shared`) | `server/src/plugins/` |
| Kernel door registrations | ~230 | `routes.js`/`app.js`/`onboarding.js` |
| Plugin door registrations | ~249 | `src/plugins/**` |
| `<Route>` entries | 143 | `App.tsx` |
| Screen `.tsx` files | 85 | `app/src/screens/` |
| Server test files | 150 | `server/tests/` |
| React / Vite | 19 / 8 | `app/package.json` |
| Fastify / pg | 5 / 8 | `server/package.json` |
| Built-in roles | 16 | `role-catalog.js` |
| Catalog plugins | 29 (4 DEFAULT_ON) | `plugin-catalog.js` |
| Default audit archive | 365 days | `AUDIT_ARCHIVE_DAYS` |
| Default AI daily cap | 200 | `tenants.config.ai.dailyCallCap` |
| Default student session | 30 min | `STUDENT_SESSION_TTL` |
| Default student idle | 10 min | `STUDENT_IDLE_TIMEOUT_MINUTES` |
| Outbox max attempts | 8 | `OUTBOX_MAX_ATTEMPTS` |
| Comms max recipients | 500 (refuse, not truncate) | dispatcher |
| Examination attendance floor | 75% | exams default |
| Refund approval threshold | ₹5,000 | fee default |
| Audit implementation score | 53/100 | `docs/PERFECT-100.md` |
| Enterprise-readiness score | 34/100 | `docs/PERFECT-100.md` |

---

## Appendix AD — A Final Catechism

**Q:** What is the most important table?
**A:** `app.audit_log`. Everything else can be rebuilt; the ledger is the memory.

**Q:** What is the most important mechanism?
**A:** RLS. Without it, tenancy is a promise, not a wall.

**Q:** What is the most important rule?
**A:** The app role never deletes.

**Q:** What is the most important refusal?
**A:** A machine may raise an action but may not decide it.

**Q:** What is the most important honesty?
**A:** Queued is not sent, and sent is not delivered.

**Q:** What is the most important constraint?
**A:** A constraint the database enforces, not one a handler remembers.

**Q:** What is the most important comment?
**A:** The one that names the failure the code prevents.

**Q:** What is the biggest risk?
**A:** A worker that does not run, and a queue that looks healthy.

**Q:** What is the biggest inconsistency?
**A:** A name used as an identity.

**Q:** What is the biggest opportunity?
**A:** Wiring the finished server to the unfinished surface.

**Q:** What should a reader trust?
**A:** The mechanisms, and the code's willingness to admit what it is not.

**Q:** What should a reader verify?
**A:** Everything this book claims — with the tests and the generated artifacts.

---

## Appendix AE — A Note to the Reader

You have reached the end of a very long book about a fairly young system. If you read it all, you now
know more about SchoolOS than most people who have worked on it — because the code's authors scattered
their reasoning through the source, and this document gathered it up.

Three things are worth carrying away.

First, **the difference between a demo and a product is not visual.** SchoolOS looks finished in many
places where it is not, and looks unfinished in places where it is excellent. The only way to tell
them apart is to follow a click to a door and a door to a row. This book did that, repeatedly.

Second, **honesty is an engineering discipline, not a virtue.** The gauges that count sandbox sends,
the verifier that states its own limits, the comments that confess a shortcut — these are mechanisms.
They make lying *expensive*, which is the only durable way to make a system trustworthy.

Third, **a school is not a business and not a government; it is a promise.** The system's best
features — a drawer that locks from the inside, a book that cannot be torn, a gate that fails closed,
a report that cannot be quietly changed — are all ways of keeping promises to people who cannot audit
the adults themselves.

If this book helps you build or evaluate a system like this, use the patterns and avoid the gaps. And
if you change the code, change this book too, so the next reader inherits both.

*Fin.*


<!-- END OF DOCUMENT -->

---

## Appendix AF — The Data Dictionary (key columns)

A compact dictionary of the columns that matter most, so a reader can reason about the schema
without opening every migration.

**`app.tenants`** — `id`; `slug` (unique); `name`; `config` (jsonb — the platform's only config
column; holds `address`, `board`, `phone`, `setup.sections`, `ai.dailyCallCap`); `plan`;
`onboarded_at`; `onboarded_via`.

**`app.users`** — `id`; `tenant_id`; `email` (login identity; unique per tenant); `name`; `role`
(16-value CHECK); `password_hash`; `phone` (nullable, used for OTP/notices); `active`;
`session_epoch` (global logout); `force_change` (restricted session); `mfa_enrolled_at`;
`role_key` (custom-role binding); `pg_role` (inert).

**`app.students`** — `id`; `tenant_id`; `admission_no` (unique per tenant); `name`; `grade`;
`section`; `class_id`/`section_id` (derived by trigger); `dob`; `gender` (nullable); `user_id`
(portal-account binding, nullable); `guardian_name`; `guardian_phone`; `bus_route`; `status`
(active/…); `source`/`source_ref`.

**`app.guardians`** — `student_id`; `name`; `phone`; `relation`; `is_primary`.

**`family.child_link`** — `user_id`; `student_id`; `relation`; `is_primary`; unique
(tenant,user,student).

**`family.consent`** — `student_id`; `kind`; `title`; `status`; `due_at`; immutable once decided.

**`app.attendance`** — `student_id`; `school_date`; `status` (present/absent/late/leave); `note`;
`marked_by`; `marked_at`; unique (tenant,student,date).

**`app.academic_years`** — `name`; `starts_on`; `ends_on`; `is_current`; one-current partial unique.

**`app.classes`** — `name`; `sort_idx`; `active`.
**`app.sections`** — `class_id`; `name`; `active`.
**`app.subjects`** — `name` (unique per tenant); `code`; `active`; `is_elective`; `is_skill`.
**`app.class_assignments`** — `teacher_id`; `grade`; `section`; `active` (one active per class).

**`app.timetable_periods`** — `seq`; `label`; `start_time`; `end_time`; `is_break`; `sort_idx`;
`retired_at`.
**`app.timetable_slots`** — `period_id`; `day_of_week`; `subject`; `teacher_name`; `teacher_id`;
`room`; `grade`; `section`; `retired_at`.
**`app.timetable_substitutions`** — `slot_id`; `date`; `absent_teacher`; `substitute`; `reason`;
`status`; unique (slot,date).

**`app.fee_plan_templates`** — `name`; `grades`; `terms` (jsonb); `installments`; `academic_year_id`;
`fee_head_id`; `auto_concession`; `hike_pct`; `consultation_meeting_id`.
**`app.fee_obligations`** — `student_id`; `term`; `label`; `due_on`; `amount_cents`;
`paid_cents`; `concession_cents`; `net_amount_cents` (generated); `status`; `academic_year_id`;
`billing_run_id`; `fee_head_id`; unique (tenant,student,term,label).
**`app.fee_installments`** — `obligation_id`; `seq`; `due_on`; `amount_cents`; `status`; `payment_id`.
**`app.payments`** — `student_id`; `obligation_id` (legacy single); `amount_cents`; `method`;
`status`; `gateway_ref`; `receipt_no`; `settled_by`; `settled_via`; `reconciliation_status`;
`confirmed_at`; `idempotency_key`.
**`app.payment_allocations`** — `payment_id`; `obligation_id`; `amount_cents`; unique
(tenant,payment,obligation).
**`app.fee_receipts`** — `payment_id`; `receipt_no`; `student_id`; `amount_cents`; `pdf_file_id`;
`issued_by`.

**`app.actions`** — `code` (unique per tenant); `kind`; `title`; `detail`; `why`; `priority`;
`status`; `owner`; `owner_role`; `policy_ref`; `ai_involved`; `source_event`; `payload` (jsonb);
`source_plugin`; `decided_by`; `decided_at`; `decision_note`; `deadline`.
**`app.cases`** — `code`; `kind`; `title`; `detail`; `priority`; `owner`; `opened_by`; `origin`;
`sla_due_at`; `linked_refs`; `idempotency_key`; `status`.

**`app.events`** — `type`; `label`; `severity`; `ref`; `emitted_by`; `subject`; `correlation_id`;
`causation_id`; `schema_version`; `payload`.
**`app.outbox`** — `topic`; `payload`; `event_id`; `attempts`; `last_error`; `next_attempt_at`;
`processed_at`; `parked_at`; `dedup_key`; `discovered_at`; `workflow_scanned_at`.
**`app.communications`** — `audience_kind`; `audience_json`; `channel`; `template`; `body`; `status`;
`policy_ref`; `dedup_key`; `provider`; `provider_ref`; `attempts`; `last_error`; `next_attempt_at`;
`sent_at`; `delivered_at`.
**`app.notifications`** — `user_id` (or NULL); `group`; `title`; `body`; `ref`; `read_at`.

**`app.audit_log`** — `actor`; `actor_role`; `action`; `record_type`; `record_ref`; `reason`;
`policy_ref`; `ai_involved`; `risk`; `outcome`; `ip` (unused); `prev_hash`; `hash`; `hash_version`;
`created_at`.

**`app.plugins`** — `plugin_id`; `version`; `class`; `status` (14-state CHECK); `manifest` (jsonb);
`permissions`; `settings`; `entitlement`; `trust_level`; `event_budget`; `ai_budget`;
`breaker_state`; `cert_score`; `enabled_at`.

**`app.memory_entries`** — `kind`; `title`; `body`; `evidence`; `decided_by`; `expected`; `actual`.

**`app.memory_entries` / `app.policy_documents`** — the constitution store (`ref`, `title`,
`category`, `body`, `version`, `updated_by`).

**`app.files`** — `filename`; `mime`; `sha256`; `storage_path`; `scope`; `ref_id`; `uploaded_by`.

**Domain schemas** — `teacher.homework` (`class_grade`,`subject`,`title`,`detail`,`attachment_ref`,
`due_at`,`created_by`,`status`); `teacher.submission` (`homework_id`,`student_id`,`content_type`,
`content`,`status`,`grade`,`feedback`,`reviewed_by`,`submitted_at`); `plugin_exams.exam` (`name`,
`term`,`class_grade`,`status`,`weightage`,`digest`,`published_snapshot`,`published_at`);
`plugin_exams.mark` (`exam_id`,`student_id`,`component`,`marks`,`max_marks`); `plugin_exams.report`
(`snapshot`,`digest`); `plugin_exams.moderation` (`report_id`,`reason`,`proposed_by`,`status`,
`adjusted_snapshot`,`decided_by`); `library.book`/`copy`/`loan`/`reservation`/`fine`;
`plugin_admissions.lead` (`student_name`,`guardian_name`,`guardian_phone`,`class_applied`,`source`,
`stage`,`admission_year`,`documents`); `plugin_dpdp.consent` (`subject_ref`,`purpose`,`decision`,
`basis`,`channel`,`valid_from`,`valid_until`,`actor`,`evidence`); `plugin_dpdp.sar` (`kind`,
`subject_ref`,`status`,`action_id`,`sla_due_at`,`fulfilled_at`,`bundle`); `plugin_visitors.visit`
(`visitor_name`,`visitor_phone`,`purpose`,`detail`,`student_ref`,`badge_code`,`status`);
`plugin_visitors.pickup_otp` (`visit_id`,`phone`,`code_hash`,`attempts`,`expires_at`,`consumed_at`);
`plugin_transport_gps.positions` (`route_code`,`lat`,`lng`,`delay_mins`,`deviation_m`,`occurred_at`);
`plugin_hr.leave`; `plugin_clinic.visit` (`student_id`,`complaint`,`temperature_c`,`action`,`notes`,
`logged_by`); `plugin_clinic.sick_pass` (`visit_id`,`student_id`,`valid_until`,`status`);
`student.wellbeing_request` (`creator_user_id`,`student_id`,`category`,`detail`,`anonymous`);
`student.mistake_note`/`flashcard`/`study_task`/`print_job` (owner-pinned); `safety.box`;
`support.doubt`/`faq`; `intervention.plan`.

This dictionary is not exhaustive, but it covers the columns a reader needs to reason about the
system's behavior — and to know which field is the identity, which is the money, and which is the
evidence.

---

## Appendix AG — Colophon

**What this document is.** A single continuous narrative walkthrough of the SchoolOS codebase,
written to satisfy a request for an in-depth, example-driven story covering the full onboarding flow,
every domain, data collection, every click and every request — with no artificial length limit. It
is not an official product document and it is not maintained by the project; it is a reading.

**How it was produced.** By reading the code in `server/src`, `server/scripts`, `server/migrations`,
`app/src`, and the project's own `docs/`, and by tracing the flows the project's comments describe.
Where a mechanism was verified against the source, it is stated as fact; where a document and the
code disagreed, the story followed the code and flagged it; where something could not be verified, it
is framed as narration.

**Honesty contract.** The document contains an unusually large number of flagged gaps. That is
intentional: the project itself is unusually candid about its own limitations (it publishes an audit
that scores its implementation at 53/100), and a faithful reading must be equally candid. A reader
evaluating SchoolOS should treat the gaps register (Appendix B) and the "what is real" map
(Appendix J) as the most decision-relevant pages.

**Known limitations of this document.**
- Counts drift; the generated artifacts (`docs/PERMISSION-MATRIX.md`, `docs/VERIFICATION.md`) are
  authoritative.
- The code evolves faster than the prose; a claim may go stale between the writing and the reading.
- Some screens were described from the project's own honesty map rather than opened interactively;
  where that is the case, the story says so.
- The demo/mock boundaries were described from the code and the project's analysis, not from a live
  demo session.

**Naming note.** The new school in the story ("Green Valley Public School, Nashik") and its cast are
invented for narrative clarity; the mature school (Saraswati Vidya Mandir Kothrud) and the demo
tenant (Meridian International Academy) reflect the project's own examples. No real child's data is
used or implied.

**Index of appendices.**
- A — Glossary
- B — Gaps register
- C — Running and verifying
- D — Cast and threads
- E — Role-by-role quick guide
- F — Event topic catalogue
- G — Security control inventory
- H — Three worked request traces
- I — Operator FAQ
- J — The "what is real" map
- K — Reading guide / index
- L — Plugin manifest surface
- M — Role × capability matrix
- N — The code's own best warnings
- O — Decision-log digest
- P — One-page summary
- Q — Event consumers and status
- R — Verification evidence
- S — The twenty-five honesty rules
- T — A letter to the next engineer
- U — SQL idioms
- V — Frequently asked architecture questions
- W — Seed dataset in detail
- X — Troubleshooting matrix
- Y — Key file reference index
- Z — Closing checklist for a new operator
- AA — Hardening campaign timeline
- AB — The chain: click to consequence
- AC — The system in numbers
- AD — A final catechism
- AE — A note to the reader
- AF — Data dictionary
- AG — Colophon

**One last sentence.** A system that documents its failures can be trusted with its successes; this
document tried to do the same for the system.

---

## Appendix AH — The Ten Sentences

If the whole book had to survive in ten sentences, they would be these.

1. One Postgres holds many schools, and the wall between them is enforced by the database, not by the
   query.
2. Every request walks one corridor: authenticate, authorize, scope, transact, audit, emit, respond.
3. Every meaningful write leaves evidence in a hash-chained ledger that cannot be torn.
4. Every promise to act later lands in an outbox that a worker must drain — and a queue that looks
   empty may be a promise nobody kept.
5. A machine may notice; a human decides; the ledger records both.
6. Queued is not sent, sent is not delivered, and a sandbox send is never called delivered.
7. Money moves once, with maker/checker, gateway evidence, immutable receipts, and refusals that
   leave the ledger untouched.
8. A name is not an identity, an exam report is frozen, a consent is immutable, and a child's release
   fails closed.
9. The server is a serious, evidence-first system; the browser is a strong core with a long tail of
   demo theatre — and the distance is the roadmap.
10. Read the comments: they tell you why, and the why is the product.

---

## Appendix AI — The Small Print

**On scope.** This book covered the kernel, all twenty-nine plugins, the worker layer, the data
model, the SPA, the factory process, the compliance surface, and the honest state of each. It did not
exhaustively enumerate every one of the Master-Action-Plan doors or every line of every screen; where
it summarized, it says so.

**On certainty.** The story distinguishes, throughout, between *verified in code*, *described in the
project's own docs*, and *flagged as a gap*. A reader should treat unverified claims as the author's
narration and check them against the source.

**On change.** This document is a snapshot. The repository's generated artifacts are live. If the two
disagree, the artifacts win.

**On tone.** The author chose to praise what works and to name what does not, in the same breath,
because a school operating system is a promise to children and the stakes justify candor over
comfort.

**On gratitude to the code.** The reason this book could be written at all is that the codebase
insists on explaining itself. Whoever wrote those comments did the next reader an enormous favor.
The best way to honor that is to keep doing it.

---

## Appendix AJ — One-Page Brief for a School Trustee

**What you are buying.** A digital school office that keeps your records in one isolated database,
records who changed what and why in a ledger that cannot be edited, and routes consequential
decisions (transport notices, exam publications, admissions conversions, clinic referrals, staff
leave, erasures) to a human authority before anything happens.

**What is ready today.** Admissions, roster and people management; attendance; fees planning and
parent payment initiation; library; visitors and guardian-verified pickup; transport routes and delay
notices; clinic; HR leave; cases; statutory returns (UDISE/CBSE/Tally); DPDP consent and erasure; the
audit ledger and its verifier; the parent portal and the student kiosk.

**What is not ready.** The finance desk's collect/confirm buttons (the server works; the screen is
not wired); the counselor's screens; several teacher and exam screens; parts of the maintenance
suite; and the demo AI surfaces.

**What an operator must do before go-live.** Start all background workers; run migrations before
bootstrap; schedule and rehearse backups; put TLS in front; set alerts on the failure gauges; record
an audit-verify baseline; and train staff on which screens are real.

**What you should ask your vendor.** Which workers are scheduled? What is the restore procedure? How
is student identity bound (a name or a column)? Where does the audit ledger live and how is it
verified? What happens if the database is down? What is the erasure procedure, and is it idempotent?

**The bottom line.** A school can run on this system and trust its records, provided the operational
gaps are closed first. It is an unusually honest product, and honesty is the safest foundation a
school's data can rest on.

<!-- END OF DOCUMENT -->
