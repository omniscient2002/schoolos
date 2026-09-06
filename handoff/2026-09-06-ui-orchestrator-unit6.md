FROM: ui-agent
TO: orchestrator
STATUS: done

WHAT SHIPPED (unit 6)
1. Two attention-slot widgets, exactly as decided — no runtime dashboards, only surfacing what the spines already hold:
   - app/src/plugins/widgets/GpsDelayApprovals.tsx — reads GET /actions?status=open (role-scoped server-side), filters kind=approval + payload.template=TRANSPORT_DELAY (title fallback "Notify … guardians — Bus …"); badge count + top titles + deep link to /attention; honest states for empty ("No GPS delay approvals open") and fetch failure ("Live action feed unavailable — approvals still on the ledger").
   - app/src/plugins/widgets/SubstitutionFeed.tsx — reads GET /events, filters type=timetable + label 'Substitution — …', last 3; empty state states the trigger ("raised here when the timetable rail assigns one").
   - registerWidgets.ts registers both; manifests (pluginRegistry.ts) gained widgets arrays: transport.gps 'gps.delay.approvals', ops.timetable 'timetable.substitutions'.
2. /today now renders <Slot name="attention" /> (after the stat row) so the widgets surface on /today as well as /attention (Attention.tsx already had it).
3. RANK: docs/10 §6 rations a slot to 2 widgets. With library's proof widget enabled, 3 compete — the two production widgets must win, so the library manifest moved to rank LAST in FIRST_PARTY_PLUGINS (pure order change; /plugins card order follows, Library still server-registered and first-class). library.overdue therefore truncates while both rails are enabled — Library.tsx demo note updated to state the ration + rank honestly. Revert = move the manifest back (one block).
4. DATA HONESTY (your "report, don't invent" rule): the STORE mirror (domain.actions = 6 seed narrative items, domain.events = local work-order events only) does NOT carry gps_delay actions or substitution.assigned events — both widgets read the LIVE service layer (apiActions/apiEvents, pre-existing exports/endpoints) instead of inventing mirror data. If you want these hydrated into the store for offline/mirror reads, that's a store-level follow-up.

AUDIT (attempt 1, TOTAL_ISSUES=0, CONSOLE_ERRORS=0) — real-data verification
- Ground truth from the API at run time: 4 open GPS-delay approvals, 1 substitution event.
- /attention AND /today: both widgets render; GPS badge = 4 == live /actions count; substitution feed shows the real label ("Substitution — Mathematics Period 1 (08:00) → K. Nair for S. Ganesh"); library proof widget correctly truncated by rank.
- KILL-SWITCH proof: POST /plugins/transport.gps/disable → GPS widget gone, slot backfills (substitutions + library); POST enable (correct contract) → end-state restored. Audit lesson recorded: the enable contract is body { version, class, permissions } — the app's apiEnablePlugin maps pclass→class; my first restore call used the wrong field name and 400'd (state was restored and re-verified).
- /attention /today /plugins × 1920/768/390 overflow-clean. tsc 0 errors, build 725ms, preview per pkill law (separate shells — one compound command self-matched mid-session and was redone properly), scratch cleaned.
- Decision 2 status: configured flag STILL absent from the deployed /plugins build (0 rows) — chip re-verification stays pending on plugin-agent's next ship.

FOR UNIT 7 (a11y + responsive rotation — my proposed order, highest-traffic first)
- Batch 1: /people /learning /operations /fees /attention /today /ask /maintenance (the daily loop)
- Batch 2: /library /documents /calendar /insights /automation /audit /cases /memory
- Batch 3: /reception /admissions /hr(operations/hr) /it /data-health /ai-governance /ai-usage /constitution
- Batch 4: role-scoped tails (parent/student surfaces, /migration, /next, /group, /settings, PersonDetail, error/404)
- Method per batch: keyboard-only walk (Tab order, focus rings, Enter/Space activation), axe-style checks (labels, contrast on tokens, landmark/headings), overflow + touch-target sweep at 390/768/1920, console-error budget, and a per-route finding list with severity. Say the word and I start batch 1.
