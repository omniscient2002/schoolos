# SchoolOS — Security Attack Matrix & Threat Model (v1)

Scope: the SchoolOS codebase + its local dev/test environments only. Aligned to the
master directive §24–§28. Status vocabulary: PINNED (automated regression exists) ·
FIXED-UNPINNED (fix applied, regression pending) · OPEN · N/A (documented risk acceptance).

## 1. Authentication
| # | Attack | Vector | Control | Status |
|---|---|---|---|---|
| A1 | Credential brute force | POST /auth/login | rate limiter + uniform 401 | PINNED (security.test Track F: X-Forwarded-For rotation defeated) |
| A2 | Account enumeration | OTP door | uniform response shape (registered vs not indistinguishable) | PINNED (app.js comment + api tests) |
| A3 | Token lifetime abuse | stolen staff JWT | 12h staff TTL + mandatory `jti` revocation denylist + session_epoch | **DONE/PINNED** (038 + jti mandatory + auth-revocation regression) — reconciled with §7 (C6) |
| A4 | Abandoned student kiosk session | shared lab computer | 30m student TTL (studentSessionTtl) + Clear-Site-Data on logout + no-store + **server-enforced idle** (per-jti, `STUDENT_IDLE_TIMEOUT_MINUTES`) | PINNED (auth smoke + student-world headers + `student-idle.test.js`) |
| A5 | Password storage | DB dump | scram-hashed (seed), no plaintext | PINNED (migration seeds) |

## 2. Authorization / tenancy
| # | Attack | Vector | Control | Status |
|---|---|---|---|---|
| B1 | Cross-guardian child read | /parent/child/:id/* | assertOwnChild → 403 no data shape | PINNED (parent-family 8/8) |
| B2 | Teacher reaches parent doors | /parent/* with teacher JWT | GUARDIAN=['parent'] strict allowlist | PINNED (teacher-403 pin) |
| B3 | Student reaches staff doors | /student/print/queue with student JWT | STAFF role gate | PINNED (student-world role gates) |
| B4 | Cross-student study data | mistakes/flashcards/tasks | owner_scoped RESTRICTIVE RLS + user_id GUC | PINNED (student-world DB-layer pin) |
| B5 | Same-tenant cross-user read via permissive-OR | RLS policy stacking | **AS RESTRICTIVE** lesson — permissive policies OR; restrictive AND | PINNED (036) — audit note: grep for other dual-policy tables |
| B6 | Cross-tenant read | all doors | tenant GUC via withUser + RLS | PINNED (001 + suite) |
| B7 | Cross-tenant REGISTRY row (plugin enable) | migration guards | tenant-correlated NOT EXISTS (031–037 patch) | PINNED (migration re-run) |
| B8 | Coordinators decide own proposal | app.actions | SoD self-approve refused | PINNED (coord-view decide test) |
| B9 | Counselor/medical confidentiality | teacher/parent/student eyes | clinic/counselor tables staff-tiered; AI never in retrieval path | **DONE/PINNED** (b9-confidentiality 6/6) — reconciled with §7 (C6) |
| B10 | Teacher reads another teacher's submissions | review desk | assigning-teacher-only WHERE created_by | PINNED (teacher-classroom.test.js) |
| B11 | Privilege escalation via onboarding | account provisioning / custom roles | **Only the owner may create a `principal`/`owner` account or a custom role based on `principal`/`owner`.** itadmin is the onboarding authority for students and every non-owner/non-principal role, but the principal-refusal is audited (`risk:'high'`, commit-before-send). | PINNED (wave-b.test.js, custom-roles.test.js) |

## 3. Business logic
| # | Attack | Vector | Control | Status |
|---|---|---|---|---|
| C1 | Double-submit homework | UNIQUE(homework_id, student_id) + resubmit only after teacher request | PINNED (031 + test in flight) |
| C2 | Late-status manipulation | decided at insert (submitted_at > due_at) | PINNED (031) |
| C3 | Consent re-decision | immutability BEFORE UPDATE trigger | PINNED (parent-family 8/8) |
| C4 | Request history rewrite | append-only event tables + grant shape | PINNED (family.view) |
| C5 | Copilot budget bypass | monthly COUNT ledger → 429 | PINNED (parent-assistant 9/9) |
| C6 | Duty fairness gaming | least-loaded deterministic pick | PINNED (coord-view 8/9 → fixture GRANT fix in flight) |
| C7 | Payment replay | idempotency + unique open-payment | PINNED (security.test RT-004) |
| C8 | Parent decides others' actions | owner_role + decide gate | PINNED (RT-002) |
| C9 | Anonymous safety-box deanonymization | identity CHECK constraint on anonymous rows | PINNED (032/036 CHECK) |
| C10 | Audit ledger tamper | hash chain + INSERT-proof for app role | PINNED (Track E) |

## 4. AI surfaces
| # | Attack | Vector | Control | Status |
|---|---|---|---|---|
| D1 | AI data leakage across children | copilot answers | answers composed ONLY from family.child_link-scoped queries + sources[] | PINNED (parent-assistant) |
| D2 | Interpretive-harm output | banned-words scan (failing/disengaged/risk) | PINNED (payload scan test) |
| D3 | Hallucinated facts | deterministic v0, honest unknown | PINNED |
| D4 | Budget DoS via AI | monthly ledger 429 | PINNED |
| D5 | Prompt injection → tool escalation | no LLM in v0; tools are fixed doors | N/A v0 — re-open when LLM tier lands |

## 5. Input / platform
| # | Attack | Vector | Control | Status |
|---|---|---|---|---|
| E1 | SQL injection | parameterized queries house-wide | PINNED (convention + suite) |
| E2 | uuid-cast 500→error-leak | uuidParams guard before WHERE id::uuid | PINNED (family/student/coord doors) |
| E3 | Bodyless JSON POST crash | FST_ERR_CTP_EMPTY_JSON_BODY | house note: no content-type on bodyless writes | PINNED (suite) |
| E4 | Oversized/malformed payloads | Fastify bodyLimit + validators | PINNED (default) |
| E5 | Log injection / secret leakage | structured logs, no secrets | **DONE/PINNED** (scripts/secret-scan.mjs fail-closed, clean) — reconciled with §7 (C6) |
| E6 | Response caching of personal data | no-store on /auth,/me,/parent,/student | PINNED (auth smoke) |

## 6. Red-team → blue-team ledger (this cycle)
| Finding | Root cause | Fix | Regression |
|---|---|---|---|
| RT-7 tableExists probed wrong schema → parent assignments permanently dead | information_schema query hardcoded public | split_part fix | deterministic both-ways degradation pin |
| RT-8 registry guards uncorrelated → later tenants never get plugin rows | NOT EXISTS missing p.tenant_id=t.id | patched 031–037 | idempotent ×2 re-run |
| RT-9 permissive policy OR hole | Postgres ORs permissive policies | AS RESTRICTIVE owner_scoped | DB-layer zero-rows pin |
| RT-10 duty schema USAGE missing (lane fixture) | fixture grants table but not schema | GRANT USAGE ON SCHEMA duty | coord-view 9/9 target |
| RT-11 vacuous degradation test | conditional skipped both branches | forced drop → assert null → recreate → assert array | parent-family green |
| RT-7cyc7/P1-1 name-match bridge leaked cross-child submissions (grade-10 parent saw grade-8 same-name student) | bridge matched ANY user with the child's name; seed has 6× Diya Nair | fail-closed: bridge requires EXACTLY ONE roster row AND ONE student user with the name; timeline grade-scoped | parent-family 8/8 + bridge guards |
| RT-7cyc7/P1-2 dev registry drift (4 lanes dark, duty table gone) | tenant-correlated seeds ran before tenant existed | 031–039 replayed idempotently + all lanes enabled via owner door | enable-door flow verified live |
| RT-7cyc7/P2-6 jti-less tokens bypassed revocation; logout audit overclaimed | `if (payload.jti)` allowed unrevokable tokens; exp hardcoded +13h | jti MANDATORY (401 without), denylist exp = token's real exp | auth-revocation 2/2 (legacy-token pin flipped to refuse) |
| RT-7cyc7/B9 concern routing 42501 since 032 (SELECT…FOR UPDATE needs UPDATE grant) | 032 granted SELECT,INSERT only | migration 039 grants UPDATE on concern tables | b9-confidentiality 6/6 |
| RT-7cyc7/B9 concerns list 42P18 (unused $1) | param list misaligned after tiering | rebound $1=oversight,$2=status,$3=user | b9 tiered-visibility pin |

**RT-7 cycle 7 #5 — implemented, not waived**: kernel decide now REFUSES a principal approving a coordinator-owned action (403 "Segregation of duties — ask the owner to decide this"), keyed on owner_role + approval-only so principal-owned flows (dpdp SARs, cbse publications, principal dismissal) are untouched. Contractual SoD elsewhere: filer≠router within a concern (pinned), coordinator self-approval (pinned), finance actions owner-only (pinned).

## 7. Remaining open (prioritized)
1. ~~A3 JWT revocation/rotation~~ — DONE (038 + jti mandatory + regression suite)
2. ~~B9 counselor/clinic confidentiality matrix~~ — DONE (b9-confidentiality.test.js 6/6)
3. ~~Permission-matrix generator~~ — DONE (scripts/permission-matrix.js; route/guard counts are generated into `docs/PERMISSION-MATRIX.md`, 0 unguarded — the "177 routes" once written here was a stale snapshot)
4. ~~E5 secret-scan cron~~ — DONE (scripts/secret-scan.mjs fail-closed, clean)
5. Multi-tenant synthetic second school — cross-tenant door sweep (RT-7 cycle 7 disproved cross-tenant takeover at the RLS layer; full second-tenant E2E sweep still worthwhile)
6. Blue-team in flight: #3 cross-class grade gate, #4 decide-door aliasing, #6 duty 409
