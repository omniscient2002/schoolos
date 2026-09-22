# OWNER & PRINCIPAL DOMAIN — full-depth analysis

> **Scope.** The complete owner and principal experience as built on the current tree: the shared
> staff authority plane, the kernel approval spine they run, every plugin door they hold, the BI /
> audit / memory / governance read models they oversee, every UI surface they can reach, and every
> test that pins them. This is the domain-knowledge companion to `docs/OWNER-PRINCIPAL-PERFECT-100.md`
> (the execution register). Every claim cites `file:line`.
>
> **Method.** Read `server/src/auth.js`, `custom-roles.js`, `effective-access.js`, `routes.js`,
> `app.js`, every owner/principal-relevant plugin `index.js`/`manifest.js`, migrations 001–115,
> `server/scripts/*.js`, the owner/principal screens under `app/src/screens/`, `Shell.tsx`,
> `App.tsx`, `lib/roles.ts`, `lib/effective.ts`, `services/liveApi.ts`, `services/adminApi.ts`, and
> the audit corpus (`PERFECT-100.md`, `ROLE-NEEDS.md`, `ROLE-CAPABILITIES.md`, `MASTER-CLASS.md`,
> `PROJECT-MAP.md`, `STILL NOT GOOD_1/2.md`, `MAY_BE_IDEAS.md`). Findings are reproduced against the
> working tree; nothing was edited.
>
> **Status (living).** This is the **first** owner/principal domain analysis. Before it, owner and
> principal were the only two major role planes with **no** dedicated deep-dive document — the
> corpus has `TEACHER-`, `PARENT-` and `STUDENT-DOMAIN-ANALYSIS.md` but no owner/principal
> companion. The master register (`docs/PERFECT-100.md`) audits them only as consumers of
> cross-cutting RBAC/product findings. Baseline score in the register: **58/100** (owner ~60,
> principal ~56). Target: **100**.

---

## 0 · Verdict at a glance

The owner/principal **server spine is real and unusually strong**: a single kernel approval spine
with `owner_role` ownership, an owner unconditional override, principal desk exclusions
(coordinator/finance), proposer≠approver, per-instance action codes, hash-chained audit, and a
custom-role mask that is enforced identically at the kernel gate, the auth hook and the plugin gate.
What holds the domain at **~58/100** is **product completeness and reachability**: the two roles
that are supposed to *run the school* have almost no purpose-built surface. Their "console" is the
generic staff shell plus a seed-fiction group page; the features `ROLE-NEEDS.md` §4 names as the
principal's reason to exist (brief, fee-health control, announcement composer, compliance calendar,
inspection pack, certificate signing, safety oversight) are absent; and several screens the roles can
reach render fixture data behind a live-looking gate.

| Area | Score | One-line reason |
|---|---|---|
| Approval spine & SoD | 82 | Correct, audited, owner override; no delegation, no SLA, no action registry |
| Security & owner-account protection | 74 | Owner-takeover defects closed; no step-up, no operator identity, principal unprotected |
| Data model & integrity | 66 | `app.actions` real; no `source_plugin`, no board-pack artifact, no announcement model |
| RBAC & role taxonomy | 60 | Owner/principal not table-defined; ~111 client role arrays; doc/code drift |
| Product completeness & reachability | 30 | No board pack, brief, composer, compliance calendar, inspection pack, cert signing, referral |
| Delivery & governance automation | 28 | No brief/SLA/compliance workers; no owner audit digest; no governance alert rules |
| Frontend correctness & honesty | 42 | Systemic SURFACE_DOOR/source mismatch; gate-vs-copy contradictions; local-only "decisions" |
| Tests & engineering gates | 55 | Strong spine tests; almost no owner/principal screen or contract tests; suite 842/843 |
| **Overall** | **~58** | Server spine real; the oversight product largely does not exist |

---

## 1 · Purpose & the authority north star

**Owner** (`docs/STILL NOT GOOD_1.md:289`) is "MOSTLY COMPLETE as an identity concept; EMPTY as a
product experience." The owner is the tenant's ultimate authority: the unconditional action
override, the only role that may grant any custom-role permission, the owner-account that cannot be
created/suspended/reset by another admin, and the tenant configuration authority (plugins, roles,
migration, metrics).

**Principal** (`docs/ROLE-NEEDS.md:107`) is *"One screen to run the school, one tap to decide."* The
principal is the day-to-day academic and operational head: the approver of record for every
consequential desk action (transport delay, admissions conversion, exam publication, CBSE
obligation, DPDP SAR, clinic notice, safeguarding escalation, safety page), the authority over the
whole coordinator execution plane, and the only non-owner role that may mark attendance and decide
principal-owned actions.

**Five principles the domain must satisfy:**

1. **One queue, one tap** — every consequential act lands in `app.actions`, is owned by a role, and
   is decided at one door with proposer≠approver and audit.
2. **The owner is the backstop** — the owner can decide anything, including the actions the
   principal is barred from (coordinator-desk, finance-desk, unattributed raises).
3. **The principal decides the school's day** — academic, admissions, exam, safety and compliance
   decisions are principal-owned; the principal does not rubber-stamp the coordinator's or finance's
   own desk work.
4. **Oversight is read over real records, never a separate warehouse** — BI, audit, memory and the
   event feed are SQL over the live tables under RLS.
5. **Governance is governed** — AI, plugins, roles and data-subject rights are all owner/principal
   gated, audited, and budget-bounded.

---

## 2 · Roles & authority tiers

### 2.1 The authority lattice

The kernel defines a single ordered authority chain, enforced in the decide handler at
`server/src/routes.js:2016-2066`:

```
owner          → unconditional override (decides ANY owner_role)         routes.js:2043-2045
principal      → decides owner_role='principal' + all non-coordinator,
                 non-finance desks; blocked on coordinator-desk approval  routes.js:2034-2037
                 and on finance-owned actions                             routes.js:2045
coordinator    → decides coordinator-owned actions (child leave, staff
                 leave, substitutions)                                    coord.view/index.js:331
finance/finance_head → decide finance/finance_head-owned actions         fees/reconcile.js:86
everyone else  → decides only actions whose owner_role equals their role
```

Two hard SoD rules sit on top: **proposer ≠ approver** (`routes.js:2064-2065`) and the
**unattributed-raise guard** for admissions/legacy-transport sources (`routes.js:2057-2063`).

### 2.2 Owner vs principal — the exact capability difference (code, not docs)

| Capability | owner | principal | Citation |
|---|---|---|---|
| `POST /attendance/mark` | **yes** | yes | `routes.js:609` `require('owner','principal','coordinator','teacher')` |
| `coord.view` suite (`/coord/*`) | **no** | yes | `coord.view/index.js:32` `AUTHORITY=['coordinator','principal']` |
| `GET /roles` + custom-role CRUD/assign | yes | no | `routes.js:377` `ROLES_ADMIN=['owner','itadmin']` |
| `GET /metrics`, `/ai/calls`, `/ai/eval`, `/workflow-rules`, `/audit/verify` | yes | no | `app.js:1488,1496,1507,1513,1528,1541`; `routes.js:2803` |
| `POST /plugins/:id/enable\|disable\|settings` | yes | **yes in code** (docs say no) | `routes.js:2948,3022,3051` |
| Unredacted plugin settings values | yes | no | `routes.js:2900,2928` |
| `POST /fees/obligations/:id/void` | yes | no | `routes.js:1059` `require('owner')` |
| Decide a **finance-owned** action | yes (override) | no | `routes.js:2043-2045` |
| Approve a **coordinator-owned** action | yes | no (403 SoD) | `routes.js:2034-2037` |
| `POST /migration/activate` | yes | yes | `routes.js:3311` |
| `POST /migration/sources*` staging | yes | **no** | `routes.js:3147` (owner/coordinator/itadmin) |
| API keys / webhooks | yes | no | `app.js:1252-1311` `adminOnly` |
| Can carry a custom role | **no** | yes | `routes.js:474-475` |
| Can be created/suspended/reset by another admin | **no** | yes | `people.admin/index.js:45` |

**Three doc/code drifts** (`docs/ROLE-CAPABILITIES.md:23,33,34` vs code): owner **is** in
`/attendance/mark`; principal **is** in plugin enable/disable/settings; principal is **not** in
migration staging. The generated `docs/PERMISSION-MATRIX.md` is authoritative.

### 2.3 Custom-role overlay

`app.roles` (`063_custom_roles.sql:13-23`) is the only persisted RBAC overlay: `key, label,
base_role, permissions {allow,deny}`. Resolution is deny > allow > base role
(`custom-roles.js:73-117`), cached 30 s (`:44-54`). A custom `allow` may only cover doors the
*author* can reach; `owner` is exempt (`routes.js:330-368`). Owner accounts cannot be overlaid
(`routes.js:474-475`).

### 2.4 The two DB roles

`schoolos_app` (RLS-subject, `NOBYPASSRLS`) is the default query path; `schoolos` (table owner,
`BYPASSRLS`) is the privileged `sysq()` path (`db.js:49-51,79,90,115-131`). The owner-role app
account and the DB `schoolos` role are **different things**; the "owner-shaped pool role"
(`PROJECT-MAP.md:389` item 28) is the DB role, and it is the largest residual trust item because
there is no operator identity separate from the tenant owner.

---

## 3 · Plugins & schemas

Owner/principal-relevant plugins, their gates and the action each raises:

| Plugin | default | Migration | Owner/principal gate | Action raised (`owner_role`) |
|---|---|---|---|---|
| `coord.view` | false | 037 | `AUTHORITY=['coordinator','principal']` `index.js:32` | substitution decide (own door) |
| `ops.bi` | true | none (stateless) | `STAFF` incl. owner/principal `index.js:36` | none (read models) |
| `accounting.tally` | true | 013 | `owner,itadmin,finance` | none |
| `admissions.funnel` | true | 018/022 | `ADMIN` incl. owner/principal `index.js:57` | `students.create.<leadId>` → principal `:183` |
| `exams.assessment` | true | 014/025 | `EXAM_ADMIN` incl. owner/principal `index.js:89` | `exams.publish.<examId>` → principal `:209` |
| `hr.leave` | false | 029 | `OFFICE=['owner','principal','itadmin']` `:14` | none |
| `ops.timetable` | true | 021 | subs `coordinator,principal,owner,itadmin` `:38` | none |
| `ops.visitors` | true | 024/028 | `DESK` incl. owner/principal `:21` | none |
| `pack.cbse` | true | 009/026 | `CBSE_TIER` incl. owner/principal `:22` | obligation → principal `:136` |
| `pack.dpdp` | true | 009/023 | `DPO` incl. owner/principal `:33` | `dpdp.dsr.<kind>.<sarId>` → principal `:131` |
| `health.clinic` | false | 029 | `NURSE` incl. owner/principal `:19` | `clinic.notify.<ref>` → principal `:162` |
| `transport.gps` | true | 020 | `transport,coordinator,principal,owner` `:17` | delay notice → principal `:52` |
| `comms.whatsapp` | true | 011 | template registration **owner-only** `:13` | none |
| `family.view` | false | 034 | `STAFF_AUTHORITY` incl. owner/principal `:26` | `parent.leave.<id>` → coordinator `:544` |
| `teacher.support` | false | 032/039/113 | `SAFEGUARD_AUTHORITY=['owner','principal','itadmin']` `:51` | `concern.escalate`/`safety.page` → principal `:127,295` |
| `people.admin` | true | 046 | `ADMIN=['owner','itadmin']` `:45`; roster incl. principal `:46` | none |
| `ops.udise` / `ops.import` | true | — / 082 | owner/principal/itadmin/coordinator | none |
| `files.store` | true | 048 | `UPLOAD_STAFF` incl. owner/principal `:64` | none |
| `library` | false | 047/108/111 | `OPS=['librarian','owner','principal']` `:26` | none |
| `payments.upi`/`razorpay` | true | 015/044 | finance tiers + owner/principal | none |
| `teacher.classroom` | false | 031 | teacher-only doors | `teacher.leave.<id>` → coordinator `:687` |
| `teacher.copilot` | false | 033 | `STAFF` incl. owner/principal `:51` | none |

All plugin doors additionally pass `lifecycleGate` (`plugins/_shared/lifecycle-gate.js:24`).

---

## 4 · Data model

### 4.1 Owner/principal-relevant tables

| Table | Migration | Purpose | RLS | Append-only |
|---|---|---|---|---|
| `app.actions` | `001:215-237` | the approval spine; `owner_role`, `payload`, `status`, `decided_by` | FORCE `001:342-363` | status flips only; audit row per decide |
| `app.audit_log` | `001:281-299` | hash-chained ledger; `prev_hash`/`hash` | FORCE | UPDATE/DELETE revoked `005:13`; trigger `075:135-147` |
| `app.audit_log_cold` | `067:8-19` | chain-preserving archive | policy `067:14-18` | `REVOKE ALL` `067:19` |
| `app.events` | `001:240-249` + `004:5-11` | oversight feed (v2 envelope) | FORCE | append-only |
| `app.outbox` | `001:302-310` + `004:13-26` | relay; parked/state markers | FORCE | append-only |
| `app.event_action_link` | `004:29-48` | event→action→downstream lineage | FORCE `004:43-48` | append-only |
| `app.communications` | `001:251-266` | notices; `approved_by`, status | FORCE | queued→sent transitions |
| `app.notifications` | `001:268-278` | in-app notices | FORCE | append-only |
| `app.memory_entries` | `001:328-339` | institutional decisions | FORCE | free-form writes |
| `app.roles` | `063:13-43` | custom-role masks | `063:34-39` | CRUD audited |
| `app.plugins` | `002:2-27` | lifecycle/settings/budgets | `002:22-27` | lifecycle audited |
| `app.ai_calls` | `070:9-36` | AI oversight ledger | `070:28-33` | kernel writes only |
| `app.tenants` | `001:8-14` + `080:12-19` | plan/entitlement/config | self-policy `049:47-49` | — |
| `app.api_keys`/`webhook_subscriptions`/`webhook_deliveries` | `069:7-74` | owner/itadmin integrations | `069:57-70` | deliveries append-only |
| `app.ops_counters` | `050:10-14` | gauges (no tenant) | none by design | — |
| `app.workflow_rules` | `071:6-29` | automation rules | `071` | CRUD |

`ops.bi` is **stateless** (`ops.bi/manifest.js` data.schema `stateless`): 60 s cache, 500-row cap,
SQL over `app.attendance`/`app.fee_obligations`/`plugin_admissions.lead`/`teacher.homework`
(`ops.bi/index.js:15-26`). There is **no persisted board-pack / roll-up table**.

### 4.2 Audit integrity (the owner's ledger)

`075_audit_integrity.sql` makes tamper-evidence a DB property: canonical material
(`:59-82`), `audit_row_hash` (`:84-95`), a BEFORE INSERT trigger that pins `prev_hash/hash/
created_at` in-DB (`:98-129`), a BEFORE UPDATE trigger that raises `42501` (`:135-147`), a
SECURITY DEFINER `audit_append` that ignores a caller-supplied `p_hash` and pins the tenant
(`:153-212`), and `audit_verify` (`:215-298`, boundary made unconditional by `105`). The owner-only
verifier door is `GET /audit/verify` (`routes.js:2803`, owner/itadmin).

### 4.3 Missing structures (owner/principal)

- **No `source_plugin` on `app.actions`** → the plugin disable-drain (`routes.js:3029-3039`)
  reassigns `WHERE owner_role = <plugin id>`, which matches **zero** rows because no action ever
  carries a plugin id (`PLG-6`/`A22`, `PERFECT-100.md:236,542`).
- **No board-pack / report artifact** model; `/group` is seed fiction (`Group.tsx:19-22`).
- **No announcement-composer authoring model** (audience picker + template + receipts); only the
  generic `app.communications` queue.
- **No compliance-calendar / obligation reminder** table beyond `plugin_cbse` obligations.
- **No certificate / TC / bonafide** model or signing spine.
- **No staff-appraisal** model; **no discipline-policy** model.

---

## 5 · Doors & capabilities

Full owner/principal door census is generated in `docs/role-matrices/owner.txt` (95 doors) and
`docs/role-matrices/principal.txt` (94), and authoritatively in `docs/PERMISSION-MATRIX.md` (334
routes, 0 unguarded). Grouped:

### 5.1 Identity, platform & configuration
`GET/POST /roles` + assign/unassign (owner/itadmin, `routes.js:378-483`); `POST /api-keys`,
`GET/DELETE /api-keys`, `POST/GET/DELETE /webhooks` (owner/itadmin, `app.js:1257-1311`);
`GET /metrics` (owner/itadmin, `app.js:1541`); `GET /ai/calls`, `POST /ai/eval`, workflow rules
(owner/itadmin, `app.js:1488-1528`); `GET/POST /plugins/:id/{enable,disable,settings}` (owner/
principal/itadmin, `routes.js:2948-3051`); `GET /plugins` (me; values redacted unless owner/itadmin,
`routes.js:2914-2941`).

### 5.2 People, classes, attendance
`GET /students`, `GET /students/:id` (`routes.js:498,531`); `POST /students` (owner/principal/
coordinator/admissions, `:558`); `GET/PUT /school/classes` (owner/principal/itadmin, `:706,714`);
`GET/POST/DELETE /class-assignments` (owner/principal/coordinator, `:745-801`);
`GET/POST /academic-years`, activate (owner/principal, `:822-862`); `GET /attendance`,
`POST /attendance/mark` (owner/principal/coordinator/teacher, `:579,609`).

### 5.3 Money
Fee heads/plans/obligations/payments/concessions/receipts/dunning/reconciliation; owner-only
`POST /fees/obligations/:id/void` (`routes.js:1059`); principal is a **payer/initiator**
(`POST /fees/payments` `:1209`) but **not** a confirmer (`:1307`) or refunder (`:2282`).

### 5.4 Admissions, exams, timetable, compliance
Funnel leads/summary/stage (`admissions.funnel`); migration staging (owner/coordinator/itadmin) and
activate (owner/principal); `POST /timetable/clash-check` (owner/principal/coordinator/itadmin,
`routes.js:2535`); `POST /exams/:id/board-policy` (owner/principal/itadmin, `:2620`);
`pack.cbse` rules/validate/export; `pack.dpdp` consent/dsr/execute.

### 5.5 HR, visitors, transport, health, safety
`hr.leave` roster/leave (owner/principal/itadmin); `ops.visitors` full desk; transport routes/events
(raises principal action, `routes.js:1700-1739`); `health.clinic` visits/sick-passes (principal
notices); `teacher.support` safety box (owner/principal/itadmin readers; principal pages).

### 5.6 Oversight reads
`GET /actions` + `POST /actions/:id/decide` (`routes.js:1933,2016`); `GET /events`,
`GET /events/lineage` (`:2745,2871`); `GET /communications` (`:2774`); `GET /audit` (`:2782`);
`GET /memory`, `POST /memory` (`:2850,2857`); `GET /reports/fees/summary` (`:2696`);
`ops.bi` attendance/aging/funnel/homework.

---

## 6 · The approval spine

**Raise.** Rows are inserted directly into `app.actions` with `status='open'` and an `owner_role`
set by the raising desk; `payload.proposed_by` is stamped where the desk can include the decider's
role (`routes.js:1729-1739`). Raise sites: transport delay (`:1730`), fee escalation (`:2512`),
fee reconciliation (`fees/reconcile.js:86`), admissions conversion
(`admissions.funnel/index.js:183`), exam publish (`exams.assessment/index.js:209`), CBSE obligation
(`pack.cbse/index.js:136`), DPDP SAR (`pack.dpdp/index.js:131`), clinic notice
(`health.clinic/index.js:162`), concern escalation + safety page (`teacher.support/index.js:127,295`),
child leave (`family.view/index.js:544`), staff leave (`teacher.classroom/index.js:687`).

**Own.** `owner_role` values actually raised: `principal` (9 sites), `coordinator` (3), `finance`
(1), `finance_head` (1). There is **no `owner_role='owner'` raise path** — the owner exists as the
override/escalation authority, not as a distinct queue.

**Decide.** `POST /actions/:id/decide` (`routes.js:2016-2255`): `FOR UPDATE`; 404/409; coordinator-
desk principal SoD (`:2034`); authority rule (`:2043`); unattributed-raise guard (`:2057`);
proposer≠approver (`:2064`); status flip (`:2066`); executor (`:2069-2156`); audit (`:2252`).

**Execute.** Typed side-effects on approval: `message` → resolve real E.164 recipients and **queue**
`app.communications status='queued'` (`:2096-2102`; >500 → 413); `task` → notification
(`:2105`); `parent.leave.*` → mark attendance `leave` (`:2111-2143`); `students.create.*` →
student+guardian+enrollment_history (`executeStudentCreation` `:1955-2014`); `teacher.leave.*` →
notification + handover packet (`:2179-2251`); dismissal mirrors parent-leave closure (`:2157`).

**Plugin-side decide doors** mirror the kernel: `/coord/substitution/decide`
(`coord.view/index.js:320-372`), DPDP DSR execute (`pack.dpdp/index.js:185-370`), exam publish +
moderation (`exams.assessment/index.js:226-361`).

**Drain.** Plugin disable reassigns open actions to `owner_role='principal'` (`routes.js:3029-3039`)
— currently a no-op (`PLG-6`).

---

## 7 · Events, workers & delivery

- **Emit/lineage.** `emitEvent` writes `app.events` + `app.outbox` (`audit.js:37-59`);
  `linkLineage` writes `app.event_action_link` (`:62-67`). Plugins emit as `plugin:<id>`
  (`plugin-permissions.js:139-144`).
- **Workers** (`server/scripts/`): `outbox-worker`, `comms-dispatcher`, `webhook-worker`,
  `workflow-worker` (long-lived pollers); `day-worker` (daily 03:05 IST: retention, dunning),
  `reconcile-payments` (03:30), `homework-reminders` (16:30), `health-probe` (02:45),
  `money-dr-drill` (04:00), `backup.sh` (02:17) — scheduled in `ops/cron/schoolos.cron`.
  **There is no principal-brief worker, no compliance-calendar worker, and no action-SLA worker.**
- **Delivery honesty.** Approved notices are queued, never pre-claimed delivered (`PRD-17`, closed);
  sandbox carriers become `failed` in production (`delivery-honesty.js`).

---

## 8 · BI, insights & oversight surfaces

| Surface | Door | Shape |
|---|---|---|
| Attendance | `GET /plugins/ops.bi/attendance` | % by class, per-student drill, below-75% flag |
| Fee aging | `GET /plugins/ops.bi/fees/aging` | d1_7/d8_30/d31_90/d90p buckets by term |
| Funnel | `GET /plugins/ops.bi/funnel` | stage counts, enrolled %, avg days |
| Homework | `GET /plugins/ops.bi/homework` | completion by class |
| Fee summary | `GET /reports/fees/summary` | billed/collected/outstanding by term + head |
| Audit | `GET /audit`, `GET /audit/verify` | ledger + chain verification |
| Events | `GET /events`, `GET /events/lineage` | oversight feed + action lineage |
| Memory | `GET/POST /memory` | institutional decisions |
| AI | `GET /ai/calls`, `POST /ai/eval` | per-call ledger, eval harness |
| Metrics | `GET /metrics` | tenant + fleet gauges, 22 alert rules |

Aggregation is SQL-over-real-records under RLS — not a materialized warehouse. The owner/principal
oversight plane is therefore **action-centric**, not a separate analytics product.

---

## 9 · UI surfaces & data travel ("every request")

The real gate is the server's `GET /me/effective` capability payload (`effective-access.js:22-145`,
`lib/effective.ts:28-51`), not a client role list. `canSurface` fails closed on an unnamed surface.

### 9.1 Owner/principal route → screen (App.tsx:428-576)

Both roles share the full staff route tree. Owner/principal-relevant routes: `/today` (Today),
`/attention` (Attention), `/next` (Next), `/people[/:id]`, `/learning`, `/attendance`, `/classes`,
`/operations`, `/fees`, `/fees/plans`, `/admissions`, `/visitors`, `/transport`, `/documents`,
`/maintenance/*` (10 screens), `/reception`, `/migration`, `/plugins`, `/people-admin`, `/library`,
`/library/insights`, `/rails`, `/operations/hr`, `/calendar`, `/cases[/:id]`, `/incidents`,
`/insights`, `/reports`, `/automation`, `/constitution`, `/memory`, `/data-health`, `/action-center`,
`/audit`, `/ai-governance`, `/ai-usage`, `/group`, `/it`, `/settings`, `/roles`, `/plugins/settings`.

### 9.2 Screen → service → endpoint, and live vs seed

| Screen | Service → endpoint | Live? |
|---|---|---|
| ActionCenter / Attention | `apiActions`/`apiDecideAction` → `GET /actions`, `POST /actions/:id/decide` | **LIVE** |
| Reports (BI) | `apiBi*` → `/plugins/ops.bi/{attendance,fees/aging,funnel,homework}` | **LIVE** |
| Audit | `apiAudit` → `GET /audit` | **LIVE** |
| Fees / FeePlans | `apiFee*` → `/fees/*`, `/fee-plans*` | **LIVE** |
| Migration | `apiMigration*` → `/migration/*` | **LIVE** |
| RolesAdmin | `apiGet('/roles')` etc. | **LIVE** |
| PluginSettings | `apiGet('/plugins')` | **LIVE** |
| PeopleAdmin | `adminApi.*` → `/plugins/people.admin/*` | **LIVE** |
| Classes | `apiSchoolClasses` → `GET/PUT /school/classes` | **LIVE** |
| VisitorsBoard / FunnelBoard | `apiVisitors*` / `apiFunnel*` | **LIVE** |
| LibraryInsights | `libraryOps` → `GET /plugins/library/ops/overview` | **LIVE** |
| Maintenance / WorkOrders / Assets | `apiWorkOrders`/`apiAssets` | **LIVE** |
| Insights | `apiFeesSummary` → `GET /reports/fees/summary` (+ seed cards) | **MIXED** |
| ItAdmin | `apiGet('/metrics')` only when `roleId==='itadmin'` | **LIVE (itadmin) / empty (owner)** |
| Group | `seed.campuses` + `CAMPUS_METRICS` | **SEED** |
| Operations | `seed.*`, `feeService` | **SEED** |
| HR | `actionService`, `seed.*`, local reducer | **SEED + LOCAL** |
| Transport | `transportService`, `seed.busRoutes` | **SEED** |
| Memory | `memoryService` | **SEED** |
| DataHealth | `seed.healthIssues` | **SEED** |
| AiGovernance | `seed.policies`, hardcoded counts | **SEED** |
| AiUsage | `seed.aiUsage` | **SEED** |
| Constitution | `seed.policies` (drafts) | **SEED** |
| Automation | `workflowService` | **SEED** |
| Documents / Calendar / Reception / Cases / Incidents | seed / domain | **SEED** |

### 9.3 Navigation

- **Owner** (`Shell.tsx:145-166`): today, group, classes, libraryOps, peopleAdmin, kernel(Modules),
  rails, people, operations, maintenance, reception, visitors, migration, insights, reports, fees,
  fees/plans, roles, plugins/settings. **Missing from nav:** attention, action-center, audit,
  memory, automation, constitution, ai-governance, ai-usage, data-health, it.
- **Principal** (`Shell.tsx:58-77`): today, attention, next, people, classes, learning, operations,
  maintenance, reception, visitors, insights, reports, fees/plans, automation, memory, libraryOps,
  kernel. **Missing:** fees, audit, action-center, constitution, group, data-health, ai-*, it,
  rails, roles, plugins/settings, migration, people-admin. `/automation` is filtered out by the
  effective gate (`/workflow-rules` is owner/itadmin) — a dead nav item.

### 9.4 The systemic honesty gap

`SURFACE_DOOR` maps each surface to **one representative door** (`effective-access.js:22-145`). For
several owner/principal screens that door is unrelated to the screen's actual data source, so the
screen is authorized by a live door while rendering fixtures:

| Surface | Mapped door | Screen actually reads |
|---|---|---|
| `/documents` | `GET /plugins/files.store` | nothing (seed) |
| `/operations/hr` | `GET /plugins/hr.leave/leave` | `actionService` seed |
| `/calendar` | `GET /academic-years` | seed |
| `/constitution` | `GET /academic-years` | seed |
| `/data-health` | `GET /audit` | seed |
| `/ai-governance`, `/ai-usage` | `GET /ai/calls` | seed |
| `/automation` | `GET /workflow-rules` | `workflowService` seed |
| `/reception` | `GET /plugins/ops.visitors/visitors` | seed |

Plus four **gate-vs-copy contradictions**: `/settings` (gate `GET /metrics` owner/itadmin, but
`Settings.tsx:72` advertises principal/itadmin/owner and every user is linked to it); `/group` (gate
owner/itadmin, copy says "Owner, Principal and Finance", `Group.tsx:62`); `/ai-usage`
(`AiUsage.tsx:18` includes finance/principal, gate is owner/itadmin); PluginSettings UI
(`PluginSettings.tsx:46`) claims owner+itadmin only while the server accepts principal.

---

## 10 · Full journey mapping

Legend: ✅ complete · 🟡 partial · ❌ missing.

### Owner

| Journey | State | Blockers |
|---|---|---|
| O-1 Sign in, land on the school's command surface | 🟡 | lands on generic `/today`; no owner console |
| O-2 See every decision awaiting authority | 🟡 | ActionCenter live but **not in owner nav**; owner has no distinct queue |
| O-3 Decide anything, including desks the principal can't | ✅ | owner override `routes.js:2043` |
| O-4 See the whole school at a glance (board pack / cross-domain roll-up) | ❌ | no roll-up; `/group` is seed fiction (PRD-1) |
| O-5 Configure the platform (plugins, roles, settings, metrics) | ✅ | live doors + screens |
| O-6 Import/activate data | ✅ | migration engine + screen |
| O-7 Verify the audit chain | ✅ | `/audit/verify` (owner/itadmin) |
| O-8 Oversee AI use and automation | 🟡 | `/ai/calls`+`/workflow-rules` live; screens seed; controls thin |
| O-9 Approve a whole-school announcement with receipts | ❌ | no composer (PRD-3) |
| O-10 Sign certificates / authorise compliance returns | ❌ | no cert signing (PRD-7); CBSE export exists |
| O-11 Monthly board pack / inspection pack | ❌ | absent (PRD-1, PRD-6) |
| O-12 Vacation cover via delegation | ❌ | no delegation; credential sharing only (GOV-1) |

### Principal

| Journey | State | Blockers |
|---|---|---|
| P-1 7am brief: absentees, dues, incidents, deadlines, AI reviews | ❌ | no brief worker (DEL-1); Today bands partial |
| P-2 One queue, one tap to decide the day | 🟡 | ActionCenter live; not in principal nav either |
| P-3 Run the academic day (attendance, exams, timetable) | ✅ | doors + coordinator plane |
| P-4 Fee health with dunning control | ❌ | aging orphaned; dunning not principal-exposed (PRD-4) |
| P-5 Announcement composer with audience + receipts | ❌ | absent (PRD-3) |
| P-6 Duty fairness monitor | 🟡 | coord plane only |
| P-7 Safety-box oversight + counselor referral | 🟡 | doors exist; no counselor, no pattern summary, close door raw-role (PRD-9) |
| P-8 Certificate signing (TC/bonafide) | ❌ | absent (PRD-7) |
| P-9 Compliance calendar + inspection pack | ❌ | absent (PRD-5, PRD-6) |
| P-10 Oversee admissions → enrollment | ✅ | funnel + approve-execute |
| P-11 Handle a crisis day (safety page, escalation) | 🟡 | page action works; no incident command surface |
| P-12 Staff appraisal inputs | ❌ | absent (PRD-11) |

---

## 11 · RBAC, custom roles & gates

- **Roles are not table-defined.** Built-in authority is hard-coded in each door's gate list; the
  canonical list lives in `auth.js:75` and is mirrored into the DB CHECK by `001`, `079`, `108`,
  `109`. Adding a role is a multi-file, two-layer change (`PERFECT-100.md:104,527`).
- **Custom roles** are the only persisted overlay, enforced identically at kernel gate
  (`routes.js:201-223`), auth hook and plugin gate (`app.js:1339-1366`) via the shared
  `custom-roles.js`. The amplification ceiling (`routes.js:330-368`) is non-owner only.
- **Client gates**: `canSurface` from `GET /me/effective` is the real gate, but ~111 hand-coded role
  arrays remain across screens (`FEX-4`); `lib/access.ts` `useRoleOrGrant` is only partly adopted.
- **Plugin permissions** are a separate vocabulary from roles (`plugin-permissions.js:26-31`); the
  manifest is the ceiling and the stored row is the grant (`lifecycle-gate.js:48-58`).

---

## 12 · Tests & gates

**Spine tests (strong).** `security.test.js` (principal-cannot-approve-coordinator 403, owner may),
`rte-hardening.test.js` (RTE-12 owner decides finance-owned), `admissions-executor.test.js` (SoD
unattributed), `custom-roles.test.js` (ceiling), `me-effective.test.js` (owner surfaces),
`coord-view.test.js` (substitution SoD), `exams/cbse/dpdp/hr-clinic/teacher-support` (principal-
owned raises), `audit-integrity.test.js` (forged hash, `/audit/verify` owner-only),
`audit-coverage.test.js` (privileged mutations), `bi-readmodels.test.js` (staff gates),
`governance.test.js` (drain hands actions to principal), `wave5-kernel.test.js` (owner followups/fee
summary), `ops-deploy.test.js` (alerts/backups/scheduling).

**Frontend tests (thin).** `app/` has vitest (`app/package.json:9`); the only owner/principal screen
test is `screens/Group.test.tsx` (crash-safety on a real campus id). No ActionCenter decide test, no
nav/gate test, no board/BI/audit/memory contract test.

**Current suite state.** `docs/VERIFICATION.md` (generated 2026-09-19) reports **843 tests, 842
pass, 1 fail** — the failure is the DAT-2 FK-less-reference census ("no FK-less reference column is
outside the allowlist"). The suite is not green at this revision.

---

## 13 · Gap register (baseline snapshot)

This is the original baseline; the authoritative, up-to-date status is the §0 implementation log in
`docs/OWNER-PRINCIPAL-PERFECT-100.md`. IDs are defined there.

| ID | Sev | Gap | Evidence |
|---|---|---|---|
| PRD-1 | P1 | No board pack / cross-domain roll-up; `/group` seed fiction | `MAY_BE_IDEAS.md:413`; `Group.tsx:19-22` |
| PRD-2 | P1 | No principal's 7am brief | `ROLE-NEEDS.md:113`; no worker |
| PRD-3 | P1 | No announcement composer | `ROLE-NEEDS.md:115` |
| PRD-4 | P1 | No fee health / dunning control surface | `ROLE-NEEDS.md:114`; `Fees.tsx` |
| PRD-5 | P1 | No compliance calendar | `ROLE-NEEDS.md:132` |
| PRD-6 | P1 | No inspection pack | `ROLE-NEEDS.md:133` |
| PRD-7 | P1 | No certificate signing | `ROLE-NEEDS.md:125` |
| PRD-8 | P1 | No counselor referral flow | `ROLE-NEEDS.md:124` |
| PRD-9 | P1 | Safety-box oversight incomplete | `teacher.support/index.js:376,415`; `PERFECT-100.md:365` |
| PRD-10 | P2 | Duty fairness monitor absent at principal level | `ROLE-NEEDS.md:116` |
| PRD-11 | P2 | Staff appraisal absent | `ROLE-NEEDS.md:117` |
| PRD-12 | P2 | Discipline policy absent; Constitution read-only | `ROLE-NEEDS.md:126` |
| PRD-13 | P2 | Multi-campus comparison absent/being removed | `ROLE-NEEDS.md:134`; `TODO_FIX_MAP.md:71-84` |
| PRD-14 | P2 | No delegated approval | `STILL NOT GOOD_1.md:294` |
| PRD-15 | P2 | AI governance controls thin | `PERFECT-100.md:324` |
| GOV-1 | P1 | No delegation / vacation cover | `STILL NOT GOOD_1.md:294` |
| GOV-2 | P1 | No `owner_role='owner'` raise path | `routes.js:2043-2045` |
| GOV-3 | P2 | Live actions only `principal`-owned | `PERFECT-100.md:542` |
| GOV-4 | P2 | Unattributed guard is a two-source allowlist | `routes.js:2057-2063` |
| GOV-5 | P2 | No action executor registry | `routes.js:2069-2156` |
| GOV-6 | P2 | `deadline` never enforced | `001:231`; no worker |
| DAT-1 | P1 | No `source_plugin` on actions → drain no-op | `PERFECT-100.md:236` |
| RBAC-1 | P1 | Roles not table-defined; gates duplicated | `PERFECT-100.md:104,527` |
| RBAC-2 | P2 | Owner excluded from `coord.view` | `coord.view/index.js:32` |
| RBAC-3 | P2 | Three doc/code drifts | `ROLE-CAPABILITIES.md:23,33,34` |
| RBAC-4 | P2 | ~111 hard-coded client role arrays | `PERFECT-100.md:1699` |
| FE-1 | P1 | SURFACE_DOOR/source mismatch (8 surfaces) | `effective-access.js:60-99` |
| FE-2 | P1 | `/settings` gate vs copy | `effective-access.js:79`; `Settings.tsx:72` |
| FE-3 | P1 | `/group` gate vs copy | `effective-access.js:72`; `Group.tsx:62` |
| FE-4 | P1 | `/ai-usage` gate vs copy | `effective-access.js:99`; `AiUsage.tsx:18` |
| FE-5 | P2 | HR substitution local-only | `HR.tsx:168-174` |
| FE-6 | P2 | Incidents status local-only | `Incidents.tsx:75-88` |
| FE-7 | P2 | Settings fabricated send counts | `Settings.tsx:236-240` |
| FE-8 | P2 | Group SampleNote conditional | `Group.tsx:118-120` |
| FE-9 | P2 | Operations hardcoded briefing | `Operations.tsx:218-222` |
| FE-10 | P2 | AiGovernance hardcoded counts | `AiGovernance.tsx:80-83` |
| FE-11 | P2 | ItAdmin owner gets no live metrics | `ItAdmin.tsx:67,72` |
| DEL-1 | P1 | No principal-brief worker | no worker |
| DEL-2 | P1 | No compliance-calendar worker | no worker |
| DEL-4 | P2 | No action-SLA escalation worker | no worker |
| TEST-1 | P1 | Only Group.test.tsx covers an owner/principal screen | `app/src/screens/Group.test.tsx` |
| TEST-2 | P1 | No owner/principal contract tests | — |
| TEST-3 | P2 | Suite 842/843 (DAT-2 census) | `docs/VERIFICATION.md:14-36` |
| TEST-4 | P2 | `FEATURES-STATUS.md` one merged GA row | `FEATURES-STATUS.md:13` |
| SEC-7 | P1 | No step-up on critical actions | `STILL NOT GOOD_1.md:294` |
| SEC-8 | P2 | No operator identity (owner-shaped pool role) | `PROJECT-MAP.md:389` |

---

## 14 · Docs honesty

The owner/principal plane is the **worst-documented** role area:

- `docs/FEATURES-STATUS.md:13` merges owner and principal into one row ("Owner / Principal · core
  registry + kernel · lifecycle doors · Action Center, Insights, Approvals · ✅ GA") — far narrower
  than the actual 95/94-door surface, and it hides the absent features.
- `docs/ROLE-CAPABILITIES.md` cites a stale `App.tsx:307-403` route range and labels screens MOCK
  inconsistently.
- `docs/ROLE-NEEDS.md` has **no Owner section at all**; the principal section (§4) is the only
  requirement source, and most of its 🔨 items are still absent.
- `MASTER-CLASS.md` describes a role switcher and demo mode that **no longer exist**
  (`DemoBar.tsx` exports only `MobileTabbar`; `LIVE_API=true`), and lists phantom routes
  (`/ask`, `/demo*`, `/live`, `/parent/ask`, `/student/ask`, `LibraryLive`).
- `app/APP-SPEC.md` is a stale frontend-only v2 contract ("No backend exists") that contradicts the
  live system.
- `app/README.md` is internally contradictory (says demo removed, then describes demo features).

The generated artifacts (`docs/PERMISSION-MATRIX.md`, `docs/VERIFICATION.md`,
`docs/role-matrices/*.txt`) are the only trustworthy numbers.
