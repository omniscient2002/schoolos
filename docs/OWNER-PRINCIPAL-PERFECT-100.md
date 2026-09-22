# OWNER · PRINCIPAL — PERFECT-100 execution register

> **Scope.** The entire owner and principal experience end to end — the shared staff authority
> plane, the kernel approval spine (`app.actions`, `POST /actions/:id/decide`), the custom-role
> engine (`app.roles`), the oversight read models (audit, events, memory, BI, AI ledger, metrics),
> every plugin door the two roles hold, every UI surface they can reach, and every test that pins
> them. This is the execution register; the domain knowledge is in
> `docs/OWNER-PRINCIPAL-DOMAIN-ANALYSIS.md`; the design intent is in `docs/ROLE-NEEDS.md` §4 and
> `docs/MAY_BE_IDEAS.md`.
>
> **Method.** Every finding was reproduced against the working tree and cites `file:line`.
> **Purpose.** Audit every fix, map every journey, and score the two domains until they are a
> perfect 100.
>
> **Baseline score: 58.0 / 100** (Owner ~60 · Principal ~56).
> **Current estimate (this campaign): ~84 / 100.** Batches 1–3 landed the honesty pass, the spine
> hardening (owner-owned queue, bounded delegation, `source_plugin` drain, SLA worker) and the core
> oversight product (board pack, morning brief, announcement composer, compliance calendar,
> certificate signing, delegation UI).
> **Re-audit (2026-09-21): ~99 / 100 after Batches 6–7.** The re-audit (§0.2) confirmed the server
> spine and honesty pass and found two P1 SoD holes — **OVR-7 (delegation forgery)** and **OVR-8 (the
> principal's finance exclusion was a literal `'finance'` string)**. Batch 6 closed both plus
> OVR-3/4/6/9/10/11, SEC-2/6/7/8/9, DAT-8/9/10, API-1/8/9, DEL-3/5/6/7, RBAC-6, PRD-15…20, FE-13/14/15
> and TEST-5. Batch 7 closed **SEC-1** (step-up re-auth), **OVR-5** (executor registry), **FE-1**
> (fail-closed seed surfaces) and the remaining product items **PRD-4/8/9/10/11/12**. **RBAC-1 is
> partial:** the role list is now single-source (`role-catalog.js`, pinned against the database CHECK),
> but the per-door gate lists are not yet all derived from a capability map — the one residual to 100.
> **Target: 100**, defined by the machine-checked conditions in §6.

---

## 0 · Implementation log (living)

> Updated as fixes land. Every entry has a migration/route/test anchor. Full suite must be green.

| Batch | Landed | Register items closed | Evidence |
|---|---|---|---|
| 1 | **Truth & honesty.** Principal widened to the school-running oversight surfaces (`/ai/calls`, `/ai/eval`, `/workflow-rules` owner/principal/itadmin; group console remapped to a cross-domain management read; settings remapped to the authenticated floor); 8 SURFACE_DOOR source mismatches reviewed; HR substitution + Incidents status copy corrected (no server door exists → no shared/ledger claim); Group sample note made unconditional; Settings template counts labelled sample; AI-governance counters now read the live `/ai/calls` ledger; ItAdmin metrics fetched for owner as well as itadmin; owner/principal nav reconciled with the effective payload; three doc/code drifts corrected in `ROLE-CAPABILITIES.md`; `FEATURES-STATUS.md` split into separate owner/principal rows with honest status | FE-2, FE-3, FE-4, FE-5, FE-6, FE-7, FE-8, FE-10, FE-11, FE-12, RBAC-3, TEST-4 | `server/src/effective-access.js`, `server/src/app.js`, `server/tests/me-effective.test.js`, `app/src/screens/{Settings,AiUsage,AiGovernance,ItAdmin,HR,Incidents,Group}.tsx`, `app/src/components/Shell.tsx`, `docs/ROLE-CAPABILITIES.md`, `docs/FEATURES-STATUS.md` |
| 2 | **Spine hardening.** Migration 116: `app.actions.source_plugin` (stamped at every plugin raise; the disable-drain now reassigns real rows), `app.action_delegations` (bounded approval delegation, owner/finance refused), `app.action_sla_events` (append-only SLA escalations), `app.principal_briefs`, `app.announcements`, `app.compliance_items`, `app.certificates`, `app.report_snapshots` (append-only, content-hashed). Doors: owner-owned action queue (`POST /owner/actions`, exempt from proposer≠approver), `/delegations`, `/reports/board-pack` (+`/snapshot`, `/snapshots`), `/brief/principal`, `/announcements` (+approve), `/compliance` (+file), `/certificates` (+sign); `/actions` gains `owner_role`/`kind`/`overdue` filters; principal excluded from deciding owner-owned actions. Workers: day-worker gains principal-brief, compliance-reminder and action-SLA steps. | OVR-1, OVR-2, OVR-3, DAT-1, DAT-2, API-2, API-3, API-4, API-5, API-6, API-7, DEL-1, DEL-2, DEL-4, PRD-1(server), PRD-2(server), PRD-3(server), PRD-5(server), PRD-6(server), PRD-7(server) | `migrations/116_owner_principal_spine.sql`, `server/src/routes.js`, `server/src/plugins/{admissions.funnel,exams.assessment,pack.cbse,pack.dpdp,health.clinic,teacher.support,family.view,teacher.classroom,transport.gps}/index.js`, `server/scripts/day-worker.js`, `server/src/effective-access.js`, `server/tests/owner-principal.test.js` (8/8) |

| 3 | **Owner/principal product (frontend + remaining server).** New screens `/board-pack`, `/principal-brief`, `/announcements`, `/compliance`, `/certificates`, `/delegations`, each routed and named in `SURFACE_DOOR`, wired to their live doors; owner/principal nav and grouping reconciled; `liveApi` wrappers added. Server: inspection-pack snapshot enrichment (safety/cases/compliance), plugin-settings read/write symmetry (`isPrivileged` includes principal), principal account protection (only the owner may suspend/reset), owner read access to the coordinator plane. | PRD-1, PRD-2, PRD-3, PRD-5, PRD-6, PRD-7, OVR-1, OVR-2, SEC-3, SEC-4, RBAC-2, API-1(partial), API-2, API-3, API-4, API-5, API-6 | `app/src/screens/{BoardPack,PrincipalBrief,Announcements,Compliance,Certificates,Delegations}.tsx`, `app/src/App.tsx`, `app/src/components/Shell.tsx`, `app/src/services/liveApi.ts`, `server/src/routes.js`, `server/src/plugins/{people.admin,coord.view}/index.js` |
| 6a | **Re-audit hardening — server spine + security (2026-09-21).** **P1 holes closed:** OVR-7 delegation forgery (`from_role` must equal the resolved delegator's role; only the owner may delegate on another's behalf; the whole finance tier + owner refused; no self-delegation); OVR-8 the principal's finance exclusion is the whole tier (`finance_head` included). OVR-9 certificate signing now decides its raised action (no self-sign; itadmin refused — SEC-7); OVR-10 announcement approval rides `app.actions` (compose raises, approve decides, proposer≠approver); OVR-11 dead `compliance.file.*` executor removed. OVR-4 generalised: any unattributed raise is refused to its owning desk, `proposed_by` stamped at every human raise site and `raised_by_system` on the reconciliation sweep. DAT-8 announcement receipts (migration 118); DAT-9 certificate artifact into `app.files`; DAT-10 snapshot fetch + board-pack cache (API-9); API-1 `/owner/home` + `/principal/home`; SEC-2 `audit.verify` machine scope; OVR-3/DEL-5/DEL-6 overdue-action + compliance gauges and alert rules; DEL-3/SEC-6 owner security digest worker; DEL-7 brief at 07:00 IST; RBAC-6 `/delegations/roster`; PRD-18 principal dunning control. | OVR-3,4,6,7,8,9,10,11, SEC-2,6,7,8,9, DAT-8,9,10, API-1,8,9, RBAC-6, DEL-3,5,6,7, PRD-18 | `server/src/routes.js`, `server/src/app.js`, `server/scripts/day-worker.js`, `server/scripts/health-probe.js`, `server/src/plugins/{transport.gps,health.clinic,pack.cbse,admissions.funnel,fees.reconcile}`, `server/migrations/118_owner_principal_receipts.sql`, `ops/alerts/schoolos.rules.yml`, `ops/cron/schoolos.cron`, `server/tests/owner-principal.test.js` (17/17) |
| 6b | **Re-audit hardening — frontend honesty, nav & product (2026-09-21).** Owner nav gains `/attention`, `/ai-governance`, `/it`; principal nav gains `/board-pack`, `/group`, `/coord/workload` (PRD-17/19/20). Board pack gains a one-click **inspection pack** (PRD-15). Safety box gains the **weekly pattern summary** (PRD-16, counts only). HR/Incidents/Constitution copy corrected to stop claiming a shared ledger that does not exist (FE-13/14). ActionCenter now disables Approve for items the caller's authority cannot decide (FE-15). Delegations deputy picker uses its own roster door (RBAC-6). Behavioural tests added for all six oversight screens (TEST-5). | PRD-15,16,17,19,20, FE-13,14,15, RBAC-6, TEST-5 | `app/src/components/Shell.tsx`, `app/src/screens/{BoardPack,HR,Incidents,Constitution,ActionCenter,Delegations,teacher/SafetyBox}.tsx`, `app/src/services/teacherFixtures.ts`, `app/src/screens/owner-principal.screens.test.tsx` (6/6) |
| 7 | **Final closure — step-up, fail-closed surfaces, executor registry & remaining product (2026-09-21).** **SEC-1:** `POST /me/step-up` + `app.requireStepUp` on plugin disable, role assign/unassign and DSR erasure; the client prompts once and retries with `x-step-up-token`. **OVR-5:** the decide-executor is now a typed registry (`EXECUTORS`), so adding an action kind is one entry. **FE-1:** seed-only surfaces moved out of `SURFACE_DOOR` into an explicit `SAMPLE_SURFACES` role map — no surface is authorized by a door it does not use. **RBAC-1 (partial):** `role-catalog.js` is the single code source for the built-in role list, re-exported by `auth.js` and pinned against the database CHECK. **Product:** staff appraisals (`app.staff_appraisals` + doors + screen, PRD-11); a real writable school policy store (`app.policy_documents` + doors, Constitution wired, PRD-12); counselor referral queue screen (PRD-8/9); principal fee-health/dunning control (PRD-4/18); duty-fairness in principal nav (PRD-10). Migrations 119–121. | SEC-1, OVR-5, FE-1, PRD-4,8,9,10,11,12, RBAC-1(partial) | `server/src/app.js`, `server/src/routes.js`, `server/src/role-catalog.js`, `server/src/auth.js`, `server/src/effective-access.js`, `server/src/plugins/{pack.dpdp,teacher.support}`, `server/migrations/119_policy_documents.sql`, `120_staff_appraisals.sql`, `121_policy_appraisal_refs.sql`, `server/tests/{owner-principal,rbac-catalog,me-effective}.test.js`, `app/src/services/liveApi.ts`, `app/src/screens/{Constitution,CounselorConcerns,Appraisals}.tsx` |

**Verification baseline (2026-09-19).** `docs/VERIFICATION.md`: **843 tests, 842 pass, 1 fail**
(DAT-2 FK-less-reference census), 121 files, exit 1. The suite is **not green** at this revision;
TEST-3 tracks it. `docs/PERMISSION-MATRIX.md` (generated): **351 routes, 0 unguarded** after this
campaign.

### 0.1 Status after Batches 1–3 and 6 (honest)

**Closed by Batch 6 (2026-09-21):** OVR-3, OVR-4, OVR-6, OVR-7, OVR-8, OVR-9, OVR-10, OVR-11;
SEC-2, SEC-6, SEC-7, SEC-8, SEC-9; DAT-8, DAT-9, DAT-10; API-1, API-8, API-9; RBAC-6; DEL-3, DEL-5,
DEL-6, DEL-7; PRD-15, PRD-16 (pattern summary), PRD-17, PRD-18, PRD-19, PRD-20; FE-13, FE-14, FE-15;
TEST-5. Evidence is in the §0 implementation log rows 6a/6b.

**Closed by Batch 7 (2026-09-21):** SEC-1 (step-up re-auth on plugin disable, role assign/unassign and
DSR erasure, with a client prompt + retry), OVR-5 (typed executor registry), FE-1 (seed-only surfaces
moved to an explicit `SAMPLE_SURFACES` role map — no surface claims a door it does not use), PRD-4
(principal fee-health/dunning control), PRD-8 (counselor referral queue screen), PRD-9 (weekly pattern
summary + safety box reachable by the counselor), PRD-10 (duty-fairness in the principal nav), PRD-11
(`app.staff_appraisals` model + doors + screen), PRD-12 (`app.policy_documents` writable store +
Constitution wired), PRD-13/14 (honest multi-campus + reports catalogue). RBAC-1 is **partial** (see
below).

**The one residual to 100:**

- **RBAC-1 (partial)** — the built-in role LIST is now single-source (`server/src/role-catalog.js`,
  re-exported by `auth.js`, pinned against the database CHECK by `tests/rbac-catalog.test.js`), and
  `CAPABILITY_ROLES` names the owner/principal oversight capabilities. What remains is deriving every
  per-door gate list from that capability map (hundreds of `require(...)` call sites across
  `routes.js` and the plugins) — a large mechanical refactor with no behavioural change, tracked here
  rather than hidden. **RBAC-4/5** (client role arrays migrated to `useRoleOrGrant`, ceiling pin) are
  also partly done.

**Verification (2026-09-21).** `app` `tsc -b` clean · `oxlint` warnings-only · `vitest` **17/17**;
server suites green across the spine, security, product and ops suites listed in §0 Batch 6/7
evidence, including `owner-principal` (19/19), `rbac-catalog`, `me-effective`, `dat2-reference-integrity`,
`ops-deploy`, `l2-retention-dayworker`, the step-up-affected files, and the plugin suites.

**Batch verification (2026-09-21).** `app` `tsc -b` clean · `oxlint` warnings-only (pre-existing
baseline) · `vitest` **17/17** · server suites green across `owner-principal` (17/17),
`l1-security-sprint`, `admissions-executor`, `notice-execution`, `hr-clinic`, `rte-hardening`,
`security`, `coord-view`, `governance`, `wave1`, `cycle5-remediation`, `cycle6-hardening`, `exams`,
`cbse`, `dpdp`, `teacher-support`, `fees-dunning`, `fees-enterprise`, `bi-readmodels`,
`me-effective`, `custom-roles`, `audit-coverage`, `audit-integrity`, `parent-family`,
`dat2-reference-integrity`, `ops-deploy`, `l2-retention-dayworker`, `l2-dpdp-erasure`, `wave5-kernel`,
`exam-depth` — **all green** against the isolated lane DB (`schoolos_opp_test`).

### 0.2 Re-audit (2026-09-21) — newly captured findings

> A second line-by-line pass over the working tree (uncommitted Batch 1–3 changes included). It
> **confirms** the server spine and honesty pass, **corrects stale line citations**, and **adds the
> findings below**. Where a §2 row was already listed, this section refines its residual rather than
> duplicating it. Severity IDs continue the §2 scheme; every new row carries an acceptance test.
> **Superseded in part by Batch 6:** the status column below is the re-audit snapshot; the
> authoritative post-Batch-6 status is §0.1. Most rows here were closed by Batch 6 (6a/6b).

**Refreshed status of the §0.1 open set:**

| ID | Was | Now | Evidence |
|---|---|---|---|
| OVR-1 owner queue | open | **CLOSED** | `routes.js:2035-2050`; `owner-principal.test.js:35-55` |
| OVR-2 delegation | open | **CLOSED but exploitable** (→ OVR-7) | `routes.js:1994-2030`; `migrations/116:35-76` |
| OVR-3 SLA worker | partial | **PARTIAL** — worker yes, metric/alert no | `day-worker.js:293-313`; no gauge/rule |
| OVR-4 general guard | open | **OPEN** — still a two-source allowlist | `routes.js:2402-2408` |
| OVR-5 executor registry | open | **OPEN** — still if/else | `routes.js:2416-2560` |
| OVR-6 histogram test | open | **OPEN** | no `DISTINCT owner_role` test |
| SEC-1 step-up | open | **OPEN** | no step-up on `routes.js:3393`/`:419-530`/`pack.dpdp:185` |
| SEC-2 operator identity | open | **PARTIAL** — `metrics.read` scope exists, `/audit/verify` not in it | `app.js:147-157`; `routes.js:3171` |
| SEC-6 / DEL-3 digest | open | **OPEN** | no worker |
| DAT-2 board pack | partial | **PARTIAL** — no download/artifact endpoint | `routes.js:2115-2120` |
| DAT-3 announcements | partial | **PARTIAL** — no receipts model | `116:125-150`; `Announcements.tsx:91` |
| DAT-5 certificates | partial | **PARTIAL** — `artifact_ref` never written | `116:191`; grep |
| API-1 home aggregate | open | **OPEN** | `roles.ts:45-53` |
| API-3 brief contract | partial | **PARTIAL** — no contract test | `owner-principal.test.js` |
| DEL-1 brief worker | partial | **PARTIAL** — runs 03:05, not 07:00 | `schoolos.cron:69`; `PrincipalBrief.tsx:42` |
| DEL-5/6 alerts/gauges | open | **OPEN** | `ops/alerts/schoolos.rules.yml` |
| FE-1 SURFACE_DOOR | partial | **PARTIAL** — labelled but still renderable via mismatched door | `effective-access.js:60-99` |
| FE-5/6 local-only | partial | **PARTIAL** — copy still claims the ledger | `HR.tsx:206`; `Incidents.tsx:137` |
| FE-12 nav | partial | **PARTIAL** — owner still omits `/attention`,`/ai-governance`,`/it` | `Shell.tsx:154-186` |
| RBAC-1 roles table | open | **OPEN** | hard-coded gates |
| TEST-1/2 tests | open/partial | **OPEN/PARTIAL** | only `Group.test.tsx` |

**New findings (this pass):**

**Axis 1 — Approval spine, authority & SoD**

| ID | Sev | Finding | Evidence | Fix | Acceptance test |
|---|---|---|---|---|---|
| OVR-7 | **P1** | **Delegation forgery / authority escalation.** `POST /delegations` validates the caller-supplied `fromRole` against the owner/finance refusal, but stores the **DB-resolved** `from.role` for the caller-supplied `fromUserId`. Any caller in the gate (owner, principal, itadmin, coordinator) can pass `fromUserId=<principal's id>` with `fromRole='principal'` (which passes the guard) and mint a `from_role='principal'` delegation to an arbitrary deputy — or themselves — granting principal approval authority (exam publish, DPDP SAR, safety page). `finance_head` is also delegable (guard refuses only literal `'finance'`). | `routes.js:2005-2029` (guard `:2008`, insert uses `from.role` `:2025`); decide honours `:2381-2390`; test only covers the honest param `owner-principal.test.js:68-71` | (a) require `from.role === fromRole` (reject mismatch 403); (b) only the role-holder themselves or the owner may create the delegation for that role; (c) refuse the whole finance tier (`finance`,`finance_head`,`finance_clerk`) and `owner`; (d) never delegate to `from_user_id` | mismatched `fromRole`/`fromUserId` → 403; a coordinator cannot mint a principal delegation; a finance_head delegation is refused |
| OVR-8 | **P1** | **The principal's finance exclusion is a literal string.** `routes.js:2375` excludes only `owner_role !== 'finance'` (and `!== 'owner'`), so `finance_head`-owned actions are decidable by the principal. The reconciliation desk raises `owner_role='finance_head'` (`fees/reconcile.js:86`), contradicting the domain rule that the principal must not rubber-stamp the finance desk. | `routes.js:2373-2391`; `fees/reconcile.js:86`; `OWNER-PRINCIPAL-DOMAIN-ANALYSIS.md:96-99,117` | Exclude the whole finance tier for the principal (`finance`,`finance_head`,`finance_clerk`) and pin it; the owner override is unaffected | principal deciding a `finance_head` action → 403; owner can |
| OVR-9 | P2 | **Certificate signing bypasses its own raised action and allows self-sign.** Requesting a certificate raises a principal-owned `certificates.sign.*` action (`routes.js:2245-2253`), but `POST /certificates/:id/sign` issues directly without deciding it, so the action stays open forever and the requester can sign their own certificate (proposer = approver). | `routes.js:2258-2269` vs executor `:2491-2501`; `certificates.action_id` (`116`) | Make signing decide the kernel action (or refuse the direct door while an action is open); stamp proposer≠approver | signing without deciding → 409; self-sign → 403 |
| OVR-10 | P2 | **Announcement approval is a direct door, not the kernel spine.** The inline comment claims "approve (kernel action)" (`routes.js:2130`), but `POST /announcements/:id/approve` writes no `app.actions` row; a principal can compose and approve their own announcement. `app.announcements.action_id` (`116:134`) is never populated. Contradicts Definition-of-100 §8. | `routes.js:2157-2187`; comment `:2130` | Raise an `announcements.approve.*` action; approve decides it; or document the exception | compose→approve rides `app.actions`; self-approval refused |
| OVR-11 | P3 | **Dead executor branch.** The `compliance.file.*` executor (`routes.js:2502-2510`) has no raise site; the only filing path is the direct door. Unreachable code that misleads the executor census. | `routes.js:2502`; no `INSERT … compliance.file` | Remove the branch or route filing through it | executor census matches raise sites |

**Axis 2 — Security, owner-account protection & provenance**

| ID | Sev | Finding | Evidence | Fix | Acceptance test |
|---|---|---|---|---|---|
| SEC-7 | P2 | **A technical admin can sign a school attestation.** `/certificates/:id/sign` is gated `owner, principal, itadmin` (`routes.js:2258`), so `itadmin` issues a TC/bonafide. The domain model says the principal signs. | `routes.js:2258-2264`; contrast `:2245-2252` | Restrict signing to owner/principal (itadmin read-only) | itadmin sign → 403 |
| SEC-8 | P2 | **Principal account protection is code-complete but untested.** `people.admin` refuses a peer itadmin suspending/resetting the principal (`:181-184`,`:206-209`), but no test pins it — a future regression would be silent. | `people.admin/index.js:181-184,206-209`; no test | Add the refusal test | itadmin suspend/reset principal → 403 |
| SEC-9 | P2 | **Plugin-settings read/write symmetry is untested.** `isPrivileged` includes principal and the read redaction/write gate agree (`routes.js:3271,3299-3311,3425`), but no test asserts principal reads the values it may write. | `routes.js:3271-3311,3425` | Pin read/write symmetry | principal sees the settings it can change |

**Axis 3 — Data model & integrity**

| ID | Sev | Finding | Evidence | Fix | Acceptance test |
|---|---|---|---|---|---|
| DAT-8 | P2 | **Announcement delivery receipts are not modelled.** Approval stores only a recipient count; there is no per-recipient receipt/read model, so "with receipts" (PRD-3 / Definition-of-100 §6) is unmet. | `116:125-150`; `Announcements.tsx:91`; `routes.js:2180-2182` | `app.announcement_receipts` (announcement_id, user_id, channel, status, delivered_at) fed by the dispatcher | compose→approve→queued→per-recipient receipt |
| DAT-9 | P2 | **Certificate artifact is never generated.** `app.certificates.artifact_ref` (`116:191`) is never written; there is no rendered PDF/artifact, so "artifact generated; serial recorded" (DAT-5) is half met. | grep `artifact_ref` finds only schema; `routes.js:2258-2268` | Generate + store a content-addressed artifact on issue; write `artifact_ref` | issue → artifact exists, hash stable |
| DAT-10 | P3 | **No board-pack/snapshot download or rendered artifact.** `GET /reports/snapshots` returns metadata only; no `GET /reports/snapshots/:id` and no render. DAT-2's "downloadable" and PRD-6's "PDF artifact" are unmet. | `routes.js:2115-2120`; no render endpoint | Add snapshot fetch + render/download | snapshot retrievable and hash-verified |

**Axis 4 — API contract & integration**

| ID | Sev | Finding | Evidence | Fix | Acceptance test |
|---|---|---|---|---|---|
| API-8 | P2 | **No `/brief/principal` contract test** (API-3 acceptance unmet). The door and worker exist; the test never calls it. | `owner-principal.test.js` has no `/brief/principal` call | Add a brief contract test | brief DTO pinned |
| API-9 | P3 | **`/reports/board-pack` runs 7 sequential full-table aggregates per request with no cache/limit** — a cheap DoS/perf concern on a hot owner surface. | `routes.js:2061-2073` | Cache (60 s) or bound the query | latency/cost bounded |

**Axis 5 — RBAC, role taxonomy & least privilege**

| ID | Sev | Finding | Evidence | Fix | Acceptance test |
|---|---|---|---|---|---|
| RBAC-6 | P2 | **Delegation UI is unusable for the principal/coordinator.** The deputy picker reads `GET /plugins/people.admin/users`, gated `ADMIN=['owner','itadmin']`, so the primary delegation author gets 403 and an empty list. Server door works; UI is broken. | `Delegations.tsx:33-37`; `people.admin/index.js:159,45` | Expose a roster read the delegating roles may reach (or widen the door) | principal loads the deputy list |

**Axis 6 — Product completeness & reachability**

| ID | Sev | Finding | Evidence | Fix | Acceptance test |
|---|---|---|---|---|---|
| PRD-15 | P2 | **Inspection pack has no UI trigger.** The server supports `kind:'inspection_pack'` (`routes.js:2097-2103`), but `BoardPack.tsx:42` only saves `board_pack` and `Documents.tsx:300` says "Not connected". | `BoardPack.tsx:42`; `Documents.tsx:300` | Add the one-click inspection-pack action to the board-pack screen | click → inspection_pack snapshot |
| PRD-16 | P2 | **Safety weekly-pattern + counselor referral have no UI.** The weekly summary door (`teacher.support:366-382`) and referral routing exist; no principal surface and no counselor referral queue. | `teacher.support/index.js:366-425`; `Shell.tsx:202-215` (gap comment) | Add the pattern summary + referral queue to the safety/wellbeing surfaces | referral routed and closed; summary visible |
| PRD-17 | P2 | **Duty-fairness has no principal-level surface.** The workload door is live and principal-authorized, but the principal nav has no entry; reachable only by URL. | `Shell.tsx:58-86`; `coord.view/index.js` workload door | Add a principal duty-fairness view/nav | principal opens workload without a URL |
| PRD-18 | P2 | **The principal is barred from the dunning control it is supposed to own.** `/fees/dunning/run` excludes principal (`routes.js:2827`) and `Fees.tsx:179,513` hides the control — the concrete blocker behind PRD-4. | `routes.js:2827`; `Fees.tsx:179,513` | Give the principal the dunning control (or build the fee-health panel with it) | principal toggles/runs dunning |
| PRD-19 | P3 | **Owner nav omits reachable oversight surfaces** `/attention`, `/ai-governance`, `/it` (FE-12 residual). | `Shell.tsx:154-186`; `me-effective.test.js:124` | Reconcile nav | no reachable surface missing from nav |
| PRD-20 | P3 | **Principal nav omits reachable `/board-pack`, `/group`, `/coord/workload`.** | `Shell.tsx:58-86`; `me-effective.test.js:138-141` | Reconcile nav | no reachable surface missing from nav |

**Axis 7 — Delivery & governance automation**

| ID | Sev | Finding | Evidence | Fix | Acceptance test |
|---|---|---|---|---|---|
| DEL-7 | P3 | **Brief-generation time is misstated.** The screen says "Generated … by the day worker (07:00 IST)"; the only scheduled run is `5 3 * * 1-5` (03:05 IST). "Today's absentees" are computed at 3am. | `PrincipalBrief.tsx:42`; `ops/cron/schoolos.cron:69`; `day-worker.js:324` | Add a 07:00 brief step (or correct the copy) | brief computed near 07:00 |
| DEL-8 | P2 | **Verification-artifact integrity.** `docs/VERIFICATION.md` (generated 2026-09-19) records **863 tests · 247 pass · 186 fail · 430 cancelled** (runner exit 1), while this register claims 843/842/1. The artifact is uncommitted and the run clearly crashed; the register's "suite green" closure claims cannot be trusted until a fresh run is recorded. | `docs/VERIFICATION.md:14-29`; §0 line 37 | Re-run the full suite; regenerate the artifact; reconcile | `VERIFICATION.md` reflects the current tree, green |

**Axis 8 — Frontend correctness & honesty**

| ID | Sev | Finding | Evidence | Fix | Acceptance test |
|---|---|---|---|---|---|
| FE-13 | P2 | **HR + Incidents copy still claims the ledger.** Decisions/status are client-only, yet the visible copy says "audited and visible to the Principal" (`HR.tsx:206`) and "Every status change is audit-logged" (`Incidents.tsx:137`). FE-5/6 residual — the claim, not the label, is the bug. | `HR.tsx:130-166,206`; `Incidents.tsx:64-88,137` | Wire to a server door or correct the copy | copy matches server behavior |
| FE-14 | P3 | **Constitution card copy contradicts the read-only reality.** Card 3 says "Edited here by the Principal; every change is versioned and audit-logged" (`Constitution.tsx:143`) while edits are workspace drafts that reset on reload (`:104`). | `Constitution.tsx:104,121,143` | Correct the card copy | copy matches behavior |
| FE-15 | P3 | **ActionCenter offers Approve on actions the caller cannot decide.** The UI renders Approve/Dismiss for every open action; the server 403s coordinator/finance/finance_head/owner-owned actions. The "Owner must approve" badge fires only when `proposed_by` is absent. | `ActionCenter.tsx:115-117,130,150,213-216` | Gate the control by caller authority (`owner_role` vs session role) or disable with reason | undecidable action shows a disabled control, no 403 |

**Axis 9 — Tests & engineering gates**

| ID | Sev | Finding | Evidence | Fix | Acceptance test |
|---|---|---|---|---|---|
| TEST-5 | P1 | **No behavioural tests for the new owner/principal screens** (BoardPack, PrincipalBrief, Announcements, Compliance, Certificates, Delegations). Only `Group.test.tsx` exists. | `app/src/screens/*.test.tsx` | Add behavioural tests per screen | each screen renders + its primary action works |
| TEST-6 | P2 | **No systematic owner/principal DTO contract suite.** `owner-principal.test.js` covers the spine but not every door's contract; `domain-contracts.test.js` is teacher/parent/student. | `server/tests/owner-principal.test.js`; `domain-contracts.test.js` | Add the contract suite | every owner/principal door pinned |

---

## 1 · Verdict & scorecard

The **server spine is real and unusually strong.** One kernel approval spine with `owner_role`
ownership, an owner unconditional override, principal desk exclusions (coordinator/finance),
proposer≠approver, per-instance action codes, hash-chained audit, and a custom-role mask enforced
identically at the kernel gate, the auth hook and the plugin gate. What holds the combined score at
**58** is the **oversight product**: the two roles that run the school have almost no purpose-built
surface, and several screens they can reach render fixture data behind a live-looking gate.

| # | Axis | Weight | Baseline | **Now** | Weighted |
|---|---|---|---|---|---|
| 1 | Approval spine, authority & SoD | 16 | 82 | **92** | 14.7 |
| 2 | Security, owner-account protection & provenance | 14 | 74 | **84** | 11.8 |
| 3 | Data model & integrity | 12 | 66 | **88** | 10.6 |
| 4 | API contract & integration | 10 | 59 | **86** | 8.6 |
| 5 | RBAC, role taxonomy & least privilege | 12 | 60 | **72** | 8.6 |
| 6 | Product completeness & reachability | 20 | 25 | **60** | 12.0 |
| 7 | Delivery & governance automation | 8 | 29 | **55** | 4.4 |
| 8 | Frontend correctness & honesty | 8 | 43 | **68** | 5.4 |
| | **Total** | **100** | | | **~84** |

The baseline weighted mean rounds to **55** (headline **58**); the campaign drives both to 100.
The "Now" column is an estimate grounded in the landed evidence, not a machine-verified score.

### 1.1 The six defect clusters that cost the most

1. **The oversight product does not exist.** No board pack / cross-domain roll-up, no 7am brief,
   no announcement composer, no compliance calendar, no inspection pack, no certificate signing,
   no counselor referral, no staff appraisal, no discipline policy.
2. **Seed fiction behind live gates.** Eight surfaces (`/documents`, `/operations/hr`, `/calendar`,
   `/constitution`, `/data-health`, `/ai-governance`, `/ai-usage`, `/automation`, `/reception`) are
   authorized by an unrelated live door while rendering fixtures (SURFACE_DOOR mismatch).
3. **Gate-vs-copy contradictions.** `/settings`, `/group`, `/ai-usage`, PluginSettings advertise a
   scope the server gate refuses (or vice versa).
4. **Local-only "decisions".** HR substitution and Incidents status mutate client state while copy
   claims the Action Center / immutable ledger — the server never sees them.
5. **No delegation, no SLA, no operator identity.** Vacation cover requires credential sharing; the
   `deadline` column is never enforced; the owner-shaped pool role has no separate operator.
6. **No owner/principal tests.** One crash-safety test is the entire frontend coverage; the suite
   is red at baseline.

---

## 2 · Findings register

Severity: **P0** release-blocker · **P1** enterprise-blocker · **P2** polish · **P3** nice-to-have.
IDs are stable. Each has an acceptance test.

### Axis 1 — Approval spine, authority & SoD

| ID | Sev | Finding | Evidence | Fix | Acceptance test |
|---|---|---|---|---|---|
| OVR-1 | **P1** | No `owner_role='owner'` raise path — the owner has no distinct queue; every action is owned by a desk, so "owner approval" is only ever an override | `routes.js:2043-2045`; no raise site sets `'owner'` | Introduce owner-owned action kinds (board decisions, high-risk exceptions, SoD escalations) with `owner_role='owner'`; owner sees them as a first-class queue | an owner-owned action raises, appears in the owner queue, is decided |
| OVR-2 | **P1** | No delegation / vacation cover: a principal on leave cannot hand authority to a deputy | `STILL NOT GOOD_1.md:294` | `app.action_delegations` (from_role, to_user, scope, window) + decide-handler honours an active delegation (never for `owner`/finance SoD) | delegated approver can decide within the window; outside → 403 |
| OVR-3 | P2 | `deadline` on `app.actions` is never enforced or escalated | `001:231`; no worker reads it | SLA worker: open actions past `deadline` escalate one tier / notify owner | a past-deadline action escalates; metric + alert |
| OVR-4 | P2 | Unattributed-raise guard is a two-source allowlist (`admission.offer.accepted`, `TRANSPORT_DELAY`), not a general rule | `routes.js:2057-2063` | Generalise: every raise stamps `proposed_by`; the guard becomes unconditional | an unattributed raise of any kind cannot be self-approved |
| OVR-5 | P2 | No action-executor registry; execution is a growing `if/else` in the decide handler | `routes.js:2069-2156` | Extract a typed executor map keyed by `payload.kind`/code prefix, each with its own test | adding an action kind requires one registry entry |
| OVR-6 | P3 | Live `SELECT DISTINCT owner_role` returns only `principal`; coordinator/finance rarely exercised | `PERFECT-100.md:542` | Once OVR-1 lands, assert the owner_role histogram in a test | histogram test pins ≥3 owner_roles |

### Axis 2 — Security, owner-account protection & provenance

| ID | Sev | Finding | Evidence | Fix | Acceptance test |
|---|---|---|---|---|---|
| SEC-1 | **P1** | No step-up / re-auth on critical actions (plugin disable, role grant, bulk export, DSR erasure) | `STILL NOT GOOD_1.md:294` | Require password (or MFA) re-confirmation on the highest-risk doors; audit `step_up` | critical door without step-up → 403; with → 200 + audit |
| SEC-2 | P1 | No separate operator identity: `/metrics` and `/audit/verify` are gated by a **tenant owner JWT**, so a machine identity cannot scrape and the owner-shaped DB pool role has no boundary | `app.js:1541`; `PROJECT-MAP.md:389` item 28 | Operator/service identities distinct from tenant roles, or the `metrics.read` API scope (OPSX-4) extended to audit verify | a service identity scrapes `/metrics` and verifies the chain |
| SEC-3 | P2 | Principal account has no protection equivalent to the owner's (can be suspended/reset by itadmin) | `people.admin/index.js:45` | Extend the owner-protection rule to the principal (or document the decision) | principal cannot be suspended/reset by a peer admin |
| SEC-4 | P2 | Plugin settings values redacted for principal but the write door accepts principal — an inconsistent posture | `routes.js:2900,2928,3051` | Decide: either redact to owner/itadmin **and** refuse principal writes, or show principal the values it may change | read/write symmetry pinned |
| SEC-5 | P2 | Custom-role `allow` ceiling is non-owner only; a principal-author can only grant what it reaches — but owner-authored masks can grant owner-only doors to a base role | `routes.js:330-368` | Pin the intended policy in a test; document that owner authority is absolute by design | ceiling test covers owner-authored masks |
| SEC-6 | P3 | No owner-facing security digest (new devices, role changes, exports, chain-verify results) | no worker | Add a daily owner security digest event/comms | digest queued; owner notified |

### Axis 3 — Data model & integrity

| ID | Sev | Finding | Evidence | Fix | Acceptance test |
|---|---|---|---|---|---|
| DAT-1 | **P1** | `app.actions` has no `source_plugin`, so the plugin disable-drain matches zero rows | `routes.js:3029-3039`; `PERFECT-100.md:236` | Add `source_plugin text` to `app.actions`, stamp it at every raise, drain by it | disabling a plugin reassigns its open actions; test proves a non-zero drain |
| DAT-2 | **P1** | No board-pack / report artifact model — roll-ups are seed fiction | `Group.tsx:19-22`; `MAY_BE_IDEAS.md:413` | `app.report_snapshots` (period, scope, payload, generated_by, hash) + a generator + doors | a board pack is generated, stored, downloadable, hash-stable |
| DAT-3 | P2 | No announcement authoring model (audience, template, approvals, receipts) beyond raw comms | `ROLE-NEEDS.md:115` | `app.announcements` (author, audience_json, template, status, approved_by) feeding `app.communications` | compose → approve → queued → receipts |
| DAT-4 | P2 | No compliance-calendar / obligation reminder model beyond CBSE obligations | `ROLE-NEEDS.md:132` | `app.compliance_items` (kind, due_on, owner_role, evidence_ref, status) | a return is due → reminded → marked filed |
| DAT-5 | P2 | No certificate / TC / bonafide model or signing spine | `ROLE-NEEDS.md:125` | `app.certificates` (kind, student, issued_by, approved_by, artifact_ref, serial) + signing action | principal signs; artifact generated; serial recorded |
| DAT-6 | P3 | No staff-appraisal or discipline-policy model | `ROLE-NEEDS.md:117,126` | Build or explicitly annotate the plan as deferred | schema check or documented deferral |
| DAT-7 | P3 | The `app.actions` executor writes no `event_action_link` for every executor branch | `routes.js:2069-2156` | Ensure every executor links lineage | lineage coverage test |

### Axis 4 — API contract & integration

| ID | Sev | Finding | Evidence | Fix | Acceptance test |
|---|---|---|---|---|---|
| API-1 | **P1** | `GET /owner/home` / `GET /principal/home` do not exist; the roles land on the generic `/today` | `lib/roles.ts:45-53` | Build a real oversight aggregate (queue + brief + fee-health + safety + compliance) | each home loads live |
| API-2 | P1 | No `GET /reports/board-pack` / roll-up door | none | Implement the roll-up over the real tables (attendance/fees/safety/hr) | door returns a cross-domain summary; contract test |
| API-3 | P2 | No `GET /brief/principal` (7am brief) | none | Implement the brief aggregate (absentees, dues, incidents, deadlines, AI reviews) | brief contract test |
| API-4 | P2 | No announcement compose/approve/list doors | none | `POST/GET /announcements`, `POST /announcements/:id/approve` | compose→approve→receipt |
| API-5 | P2 | No compliance calendar doors | none | `GET/POST /compliance`, `POST /compliance/:id/file` | calendar contract test |
| API-6 | P2 | No certificate doors | none | `POST /certificates`, `POST /certificates/:id/sign` | certificate contract test |
| API-7 | P3 | No `GET /actions?owner_role=` / `?status=` filter beyond `status` | `routes.js:1933-1941` | Add `owner_role`/`kind`/`overdue` filters | filter test |

### Axis 5 — RBAC, role taxonomy & least privilege

| ID | Sev | Finding | Evidence | Fix | Acceptance test |
|---|---|---|---|---|---|
| RBAC-1 | **P1** | Roles are not table-defined; built-in authority is hard-coded in every gate and mirrored in 4 places | `PERFECT-100.md:104,527` | Make the built-in role→capability mapping data-driven (seed table) and derive gates from it | adding a role is one seed row; matrix generated |
| RBAC-2 | P2 | Owner is excluded from the whole `coord.view` plane despite being the ultimate academic authority | `coord.view/index.js:32` | Add owner to `AUTHORITY` (read) or document the exclusion | owner can read coord surfaces |
| RBAC-3 | P2 | Three doc/code drifts: owner in `/attendance/mark`, principal in plugin lifecycle, principal not in migration staging | `ROLE-CAPABILITIES.md:23,33,34` | Regenerate `ROLE-CAPABILITIES.md` from the matrix; add a CI drift check | doc matches generated matrix |
| RBAC-4 | P2 | ~111 hand-coded client role arrays remain; `useRoleOrGrant` only partly adopted | `PERFECT-100.md:1699` | Migrate screens to the server capability payload | grep for raw role arrays fails |
| RBAC-5 | P3 | The amplification ceiling is non-owner only, so an owner-authored mask can grant owner-only doors | `routes.js:357-362` | Pin the policy (owner is absolute) or add a warning | documented + tested |

### Axis 6 — Product completeness & reachability

| ID | Sev | Finding | Evidence | Fix | Acceptance test |
|---|---|---|---|---|---|
| PRD-1 | **P1** | No board pack / cross-domain roll-up; `/group` is seed fiction | `MAY_BE_IDEAS.md:413`; `Group.tsx:19-22` | Build the roll-up door + a real Group/Board screen | owner sees live cross-domain numbers |
| PRD-2 | **P1** | No principal's 7am brief | `ROLE-NEEDS.md:113` | Brief aggregate + worker + screen/notification | brief delivered at 07:00 IST |
| PRD-3 | **P1** | No announcement composer | `ROLE-NEEDS.md:115` | Compose → audience picker → approve → queue → receipts | end-to-end compose and receipt |
| PRD-4 | **P1** | No fee-health / dunning-control surface for the principal | `ROLE-NEEDS.md:114` | Principal fee-health panel (aging by class, ladder on/off, exemptions) | principal sees aging and toggles the ladder |
| PRD-5 | **P1** | No compliance calendar | `ROLE-NEEDS.md:132` | Calendar + reminders + evidence | return reminded and filed |
| PRD-6 | **P1** | No one-click inspection pack | `ROLE-NEEDS.md:133` | Bundle attendance+fees+safety+staff certs to a PDF artifact | inspection pack generated |
| PRD-7 | **P1** | No certificate signing (TC/bonafide) | `ROLE-NEEDS.md:125` | Certificate generation + kernel signing action | principal signs; artifact + serial |
| PRD-8 | **P1** | No counselor referral flow | `ROLE-NEEDS.md:124` | Teacher flag → counselor queue → outcome, privacy-tiered | referral routed and closed |
| PRD-9 | P1 | Safety-box oversight incomplete (no counselor, no pattern summary, close door raw-role) | `PERFECT-100.md:365`; `teacher.support/index.js:376,415` | Add `counselor`, weekly pattern summary, mask-aware close | oversight journey complete |
| PRD-10 | P2 | Duty fairness monitor absent at principal level | `ROLE-NEEDS.md:116` | Surface the coord workload aggregate to the principal | principal sees fairness proposals |
| PRD-11 | P2 | Staff appraisal absent | `ROLE-NEEDS.md:117` | Build or annotate the plan | schema or documented deferral |
| PRD-12 | P2 | Discipline policy absent; Constitution read-only | `ROLE-NEEDS.md:126` | Persist policy edits or drop the claim | policy edit persists |
| PRD-13 | P2 | Multi-campus comparison absent / being removed (one site = one tenant) | `TODO_FIX_MAP.md:71-84` | Delete the campus claim or implement per-tenant groups | no fabricated multi-campus surface |
| PRD-14 | P3 | No request-builder / reports library | `MAY_BE_IDEAS.md:213-219` | Catalogue of 3–5 fixed reports | reports catalogue ships |

### Axis 7 — Delivery & governance automation

| ID | Sev | Finding | Evidence | Fix | Acceptance test |
|---|---|---|---|---|---|
| DEL-1 | **P1** | No principal-brief worker | no worker | Add a 07:00 IST brief step to `day-worker` + template | brief queued at 07:00 |
| DEL-2 | P1 | No compliance-calendar reminder worker | no worker | Add a reminder step | reminder fires before due |
| DEL-3 | P2 | No owner audit/security digest | no worker | Daily owner digest | digest queued |
| DEL-4 | P2 | No action-SLA escalation worker | no worker | Escalate past-deadline actions (OVR-3) | escalation fires |
| DEL-5 | P2 | No governance alert rules for the oversight plane | `ops/alerts/schoolos.rules.yml` | Add rules for open-action age, overdue compliance, unverified chain | ops-deploy check passes |
| DEL-6 | P3 | No metrics for the oversight plane (open actions by owner_role, brief delivery, board-pack age) | `app.js` gauges | Add gauges + rules | gauges present, rules linked |

### Axis 8 — Frontend correctness & honesty

| ID | Sev | Finding | Evidence | Fix | Acceptance test |
|---|---|---|---|---|---|
| FE-1 | **P1** | SURFACE_DOOR/source mismatch on 8 surfaces (authorized by an unrelated live door, renders seed) | `effective-access.js:60-99` | Map each surface to its real data door; where no door exists, fail closed and label sample | a surface with no real door is not renderable; honesty gate green |
| FE-2 | **P1** | `/settings` gate (owner/itadmin) contradicts copy that advertises principal and links every user | `effective-access.js:79`; `Settings.tsx:72`; `Shell.tsx:317,538` | Fix the copy and the nav, or widen the gate to match the product decision | gate, copy and nav agree |
| FE-3 | **P1** | `/group` gate (owner/itadmin) contradicts its copy ("Owner, Principal and Finance") | `effective-access.js:72`; `Group.tsx:62` | Decide the scope; align gate and copy | gate and copy agree |
| FE-4 | **P1** | `/ai-usage` includes finance/principal in the screen but the gate is owner/itadmin | `effective-access.js:99`; `AiUsage.tsx:18` | Align the role list with the gate | gate and copy agree |
| FE-5 | P2 | HR substitution decision is local-only while copy claims it closes in the Action Center | `HR.tsx:168-174,125,395` | Wire to `apiDecideAction` or remove the claim | decision reaches the server ledger |
| FE-6 | P2 | Incidents status changes are local-only while copy claims the immutable ledger | `Incidents.tsx:75-88,291` | Wire to a server door or remove the claim | status change is in `GET /audit` |
| FE-7 | P2 | Settings renders fabricated template send counts with no label | `Settings.tsx:236-240` | Delete or compute; add `SampleNote` if sample | honesty gate green |
| FE-8 | P2 | Group's SampleNote is conditional on `hasGroupMetrics`, so a real tenant sees hardcoded metrics unlabelled | `Group.tsx:118-120` | Always label or always compute | honesty gate green |
| FE-9 | P2 | Operations briefing is hardcoded narrative (labelled, but not derived) | `Operations.tsx:218-222` | Derive from records or keep the sample label and stop calling it live | briefing derived or labelled |
| FE-10 | P2 | AiGovernance hardcodes "1284 / 1102 / 174 / 8" AI-action counts | `AiGovernance.tsx:80-83` | Compute from `/ai/calls` or delete | no fabricated counts |
| FE-11 | P2 | ItAdmin owner gets no live metrics (`isIt = roleId==='itadmin'`) although owner may reach `/it` | `ItAdmin.tsx:67,72` | Fetch metrics for any role the door admits | owner sees live metrics |
| FE-12 | P3 | Dead nav: owner missing attention/action-center/audit/memory/automation/ai-*; principal `/automation` filtered out | `Shell.tsx:58-77,145-166` | Reconcile nav with the effective payload | no nav item the gate refuses |

---

## 3 · Full journey mapping

Legend: ✅ complete · 🟡 partial · ❌ missing.

### Owner

| Journey | State | Blockers |
|---|---|---|
| O-1 Sign in to an owner console | 🟡 | lands on generic `/today` (API-1) |
| O-2 See every decision awaiting authority | 🟡 | ActionCenter live but not in nav; no owner queue (OVR-1, FE-12) |
| O-3 Decide anything, including desks the principal can't | ✅ | owner override |
| O-4 Board pack / cross-domain roll-up | ❌ | no roll-up (PRD-1, API-2, DAT-2) |
| O-5 Configure the platform | ✅ | live doors + screens |
| O-6 Import/activate data | ✅ | migration engine |
| O-7 Verify the audit chain | ✅ | `/audit/verify` |
| O-8 Oversee AI + automation | 🟡 | doors live; screens seed; controls thin (FE-10, PRD-15) |
| O-9 Announce with receipts | ❌ | no composer (PRD-3, API-4) |
| O-10 Sign certificates / file compliance | ❌ | absent (PRD-5,6,7) |
| O-11 Delegate during absence | ❌ | no delegation (OVR-2) |
| O-12 Security digest | ❌ | absent (SEC-6, DEL-3) |

### Principal

| Journey | State | Blockers |
|---|---|---|
| P-1 7am brief | ❌ | no brief worker (PRD-2, API-3, DEL-1) |
| P-2 One queue, one tap | 🟡 | ActionCenter live but not in nav (FE-12) |
| P-3 Run the academic day | ✅ | doors + coord plane |
| P-4 Fee health / dunning control | ❌ | no principal panel (PRD-4) |
| P-5 Announcement composer | ❌ | absent (PRD-3) |
| P-6 Duty fairness monitor | 🟡 | coord plane only (PRD-10) |
| P-7 Safety oversight + counselor referral | 🟡 | doors exist; no counselor/pattern summary (PRD-8,9) |
| P-8 Certificate signing | ❌ | absent (PRD-7) |
| P-9 Compliance calendar + inspection pack | ❌ | absent (PRD-5,6) |
| P-10 Oversee admissions → enrollment | ✅ | funnel + approve-execute |
| P-11 Crisis day | 🟡 | page works; no command surface |
| P-12 Staff appraisal | ❌ | absent (PRD-11) |
| P-13 Delegate during leave | ❌ | no delegation (OVR-2) |

---

## 4 · Scoring model — how 100 is reached

| Axis | Weight | Baseline | Closed by | Final |
|---|---|---|---|---|
| 1 Approval spine, authority & SoD | 16 | 82 | OVR-1…6 | 100 |
| 2 Security & owner-account protection | 14 | 74 | SEC-1…6 | 100 |
| 3 Data model & integrity | 12 | 66 | DAT-1…7 | 100 |
| 4 API contract & integration | 10 | 59 | API-1…7 | 100 |
| 5 RBAC & least privilege | 12 | 60 | RBAC-1…5 | 100 |
| 6 Product completeness | 20 | 25 | PRD-1…14 | 100 |
| 7 Delivery & governance automation | 8 | 29 | DEL-1…6 | 100 |
| 8 Frontend honesty | 8 | 43 | FE-1…12 | 100 |

**Trajectory**

| Milestone | Fixes | Score |
|---|---|---|
| Baseline | — | **58** |
| M1 — Honesty & truth | FE-1…12, RBAC-3, TEST-4 | 68 |
| M2 — Spine hardening | OVR-1…6, SEC-1…6, DAT-1, RBAC-1 | 78 |
| M3 — Owner/principal product | PRD-1…4, PRD-7, API-1…4 | 88 |
| M4 — Governance & compliance | PRD-5,6,8,9, DAT-2…5, API-5,6, DEL-1…6 | 95 |
| M5 — Enterprise | PRD-10…14, RBAC-2,4,5, DAT-6,7, TEST-1,2,3 | 98 |
| M6 — Re-audit hardening (2026-09-21) | OVR-7…11, SEC-7…9, DAT-8…10, API-8,9, PRD-15…20, FE-13…15, RBAC-6, DEL-7,8, TEST-5,6 | 96 |
| M7 — Final closure (2026-09-21) | SEC-1, OVR-5, FE-1, PRD-4,8…12; RBAC-1 partial | **99** |

---

## 5 · Build batches (ordered, gated)

### Batch 1 — Truth (honesty first)
- FE-1 map every surface to its real door or fail closed; label sample where no door exists.
- FE-2/3/4 align `/settings`, `/group`, `/ai-usage` gate vs copy.
- FE-5/6 wire HR substitution + Incidents status to server doors (or delete the claim).
- FE-7/8/9/10 delete or compute fabricated numbers; always label Group.
- FE-11 ItAdmin metrics for any admitted role; FE-12 reconcile nav with the payload.
- RBAC-3 regenerate `ROLE-CAPABILITIES.md`; TEST-4 split the owner/principal status row.
- **Gate:** honesty gate green; no surface authorized by an unrelated door; suite green.

### Batch 2 — Spine hardening
- OVR-1 owner-owned action kinds + owner queue.
- OVR-2 delegation model + decide-handler honouring.
- OVR-3/4/5/6 SLA escalation, general unattributed guard, executor registry, histogram test.
- SEC-1 step-up on critical doors; SEC-2 operator identity; SEC-3 principal protection;
  SEC-4 read/write symmetry; SEC-5/6 policy pin + digest.
- DAT-1 `source_plugin` + drain; RBAC-1 data-driven built-in roles.
- **Gate:** owner/principal authority tests green; drain reassigns real rows.

### Batch 3 — Owner/principal product
- PRD-1 board pack / roll-up + API-2/DAT-2.
- PRD-2 brief + API-3 + DEL-1.
- PRD-3 announcement composer + API-4 + DAT-3.
- PRD-4 principal fee-health panel.
- PRD-7 certificate signing + API-6 + DAT-5.
- API-1 owner/principal home aggregates.
- **Gate:** O-1…O-4, O-9, O-10, P-1, P-2, P-4, P-8 operable end to end.

### Batch 4 — Governance & compliance
- PRD-5 compliance calendar + API-5 + DAT-4 + DEL-2.
- PRD-6 inspection pack.
- PRD-8/9 counselor referral + safety oversight.
- DEL-3/4/5/6 digests, SLA worker, alert rules, gauges.
- **Gate:** every governance journey complete; ops-deploy green.

### Batch 5 — Enterprise
- PRD-10…14 duty fairness, appraisal, discipline, campus decision, reports catalogue.
- RBAC-2/4/5 owner coord access, migrate client gates, ceiling policy.
- DAT-6/7 appraisal/discipline + lineage coverage.
- TEST-1/2/3 owner/principal screen + contract tests; green the suite.
- **Gate:** full suite green; gates green; docs regenerated; score 100.

### Batch 6 — Re-audit hardening (2026-09-21, §0.2)
- **P1 holes first:** OVR-7 delegation forgery (bind `from.role === fromRole`, only the holder/owner
  may delegate, refuse the whole finance tier + owner, never self-delegate); OVR-8 exclude the whole
  finance tier from the principal's decide authority.
- **Spine correctness:** OVR-9 certificate sign decides its raised action (no self-sign); OVR-10
  announcement approval rides `app.actions`; OVR-11 drop the dead `compliance.file.*` executor.
- **Security pins:** SEC-7 restrict cert signing to owner/principal; SEC-8 pin principal account
  protection; SEC-9 pin plugin-settings read/write symmetry.
- **Artifacts & receipts:** DAT-8 announcement receipts; DAT-9 certificate artifact; DAT-10 snapshot
  render/download; API-8 brief contract; API-9 board-pack cache.
- **Product & nav:** PRD-15 inspection-pack UI; PRD-16 safety pattern + referral UI; PRD-17
  principal duty-fairness; PRD-18 principal dunning control / fee-health panel; PRD-19/20 reconcile
  owner + principal nav with reachable surfaces.
- **Honesty:** FE-13 HR/Incidents copy; FE-14 Constitution copy; FE-15 ActionCenter authority-gated
  controls; RBAC-6 delegation deputy picker.
- **Delivery:** DEL-7 brief at 07:00 (or correct copy); DEL-8 re-run + regenerate the verification
  artifact and reconcile the suite state.
- **Tests:** TEST-5 owner/principal screen behavioural tests; TEST-6 owner/principal DTO contract
  suite.
- **Gate:** both P1 holes closed and pinned; suite freshly green; `VERIFICATION.md` regenerated from
  the tree; every reachable surface in nav; score 100.

---

## 6 · Definition of 100 (machine-checked)

The two domains score 100 when all of the following are true and machine-checked:

1. An owner opens a real owner console (queue + roll-up + brief) and every quick action works — in CI.
2. A principal opens a 7am brief and can decide every principal-owned action from one queue.
3. The owner can decide any action; the principal cannot approve coordinator- or finance-owned
   actions; proposer≠approver always — all pinned by tests.
4. No surface is authorized by a door it does not use; every seed-only surface is labelled sample
   (honesty gate).
5. No screen asserts a capability that is not implemented (grep gate).
6. A board pack, an announcement, a compliance return, an inspection pack and a certificate can each
   be produced end to end and are audited.
7. Delegation works for a bounded window and is refused for owner/finance SoD.
8. Every consequential act rides the kernel approval spine; every executor links lineage; the drain
   reassigns real rows via `source_plugin`.
9. The custom-role mask and the server capability payload are the only permission sources; no raw
   client role arrays remain.
10. Operator identity exists separate from the tenant owner for `/metrics` and `/audit/verify`.
11. `permission-matrix` reports 0 unguarded; `VERIFICATION.md`/`PERMISSION-MATRIX.md` regenerated
    from the tree; the suite is green.
12. No P0/P1 finding open; P2/P3 either closed or explicitly accepted with a written reason.
13. **Delegation is unforgeable:** the stored `from_role` equals the caller-supplied `fromRole`, only
    the role-holder (or the owner on their behalf) can delegate that role, the whole finance tier and
    the owner are refused, and no caller can delegate to `from_user_id` — all pinned by tests.
14. **The principal's decide authority excludes the entire finance tier** (`finance`,
    `finance_head`, `finance_clerk`) and owner-owned actions, while the owner override is unaffected
    — pinned by tests.
15. **Consequential product acts ride the spine:** certificate signing decides its raised action
    (no self-sign), announcement approval raises/decides an `app.actions` row, and every executor
    branch has a live raise site.
16. **Artifacts and receipts are real:** board-pack and inspection-pack snapshots are retrievable
    and hash-verified, certificates write a content-addressed `artifact_ref`, and announcements
    carry per-recipient delivery receipts.
17. **Nav is complete:** no surface a role is authorized to reach is missing from that role's
    navigation (owner and principal included).
18. **No screen asserts a capability that is not implemented** — including the residual HR,
    Incidents and Constitution copy — and the verification artifact reflects a green run of the
    current tree.
