# CoordinatorOS — Build Plan (compact)

The middle-management plane: principal↔teacher↔student↔parent bridge. Coordinator = **execution authority between policy and classroom** — approves, routes, balances, monitors; never replaces teacher autonomy or principal authority. Companion to the other *OS plans; same spine, same grammar.

## Reuse map (coordinator powers already live)
✅ Action Center (kernel approvals) · substitution suggester (ops.timetable) · duty roster + fairness inputs (hr.leave, duty.assignment contract in TS-1) · concern routing (teacher.support: coordinator is ROUTE_AUTHORITY) · child-leave + request approval (family.view raises parent.leave.<id> actions owned by coordinator) · exam moderation tier (exams.assessment MOD_TIER) · curriculum progress data (teacher.copilot tables) · workload door (TS-1 /workload/mine pattern → aggregate view here)

## Gap → v1 build (migration 037, plugin `coord.view`)
1. GET /coord/home — command center: today's staffing (absent teachers from teacher.leave_request pending/approved today), substitution gaps (timetable slots uncovered), pending approvals queue (all open kernel actions owned by coordinator), curriculum delays (covered_pct vs expected pace per class), unresolved issues (open concerns routed to coordinator)
2. GET /coord/curriculum-monitor — per class×subject: planned vs actual coverage, delay weeks, revision need (reads curriculum.progress + tree)
3. GET /coord/teacher-workload — aggregate workload per teacher (periods, subs, invigilation, grading est.) — fairness framing, NEVER rankings; flag overload >threshold
4. POST /coord/substitution/decide — review proposals: absent teacher, period, class, proposed substitute + workload impact → approve/reject (kernel action decide; audit)
5. POST /coord/duty/allocate — fairness-aware duty proposals for events/invigilation (uses duty.assignment + fair_load_seq) → approve
6. GET /coord/escalations — parent/student escalations landing on coordinator (family.request owner_role=coordinator open items + re-evaluation queue) with status timelines
7. POST /coord/copilot-lite — deterministic v0 (same pattern as parent.assistant): "which classes need intervention" / "curriculum delays" / "substitution gaps tomorrow" / "summarize grade 8 this week" → answers from own data + sources

## UI (1 lane)
CoordHome (command center per §1) · SubstitutionReview · WorkloadBoard · CurriculumMonitor · EscalationsQueue · ApprovalCenter (surfaces existing action-center filtered to coordinator-owned)

## Lanes
| Lane | Scope | Files |
|---|---|---|
| **CS-1** server | migration 037 + coord.view plugin: all 7 doors | `server/src/plugins/coord.view/**`, `migrations/037_*`, `tests/coord-view.test.js` |
| **CU-1** UI | 6 screens + minimal route/nav diffs | `app/src/screens/coord/**` |

Est: **3–4h** both lanes parallel. Acceptance: coordinator opens one screen → staffing/gaps/approvals/delays all visible; every decision kernel-audited; fairness framing everywhere (no surveillance rankings).
