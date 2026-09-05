# DOCS-AUDIT-002 — Plugin Architecture & Enterprise Hardening docs ↔ reality

**Auditor:** standing documentation auditor (CTO charter: verify, never modify)
**Scope:** incremental audit of NEW/CHANGED docs only: `docs/10-plugin-architecture.md`, `docs/11-plugin-native-architecture.md`, `docs/12-enterprise-hardening.md`, `README.md` (banner), `server/README.md`, `app/README.md`.
**Method:** every claim checked against the repo — files read in full, live DB inspected via `information_schema`/`pg_constraint`/`pg_policies`, live API exercised over HTTP, server test suite executed.
**Verdicts:** VERIFIED / PARTIAL / FALSE / PROSE-ONLY, with file:line evidence.
**Files written by this audit:** this report only. No code or docs modified.

---

## A. Environment verification

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| E1 | API on 127.0.0.1:8080 | **VERIFIED** | `GET /health` → `{"status":"ok","db":true,"time":"2026-09-05T11:13:57Z"}` |
| E2 | Frontend on 4310 | **VERIFIED** | `GET http://127.0.0.1:4310/` → HTTP 200 |

---

## B. Schema & database claims (docs/10 §7, docs/12 §1/§23)

| # | Doc claim (quoted) | Verdict | Evidence |
|---|---|---|---|
| C1 | docs/10 §7: `app.plugins (id, tenant_id, plugin_id, version, class, status, manifest jsonb, permissions jsonb, settings jsonb, entitlement jsonb, enabled_at, enabled_by, updated_at, UNIQUE (tenant_id, plugin_id))` | **VERIFIED** | `server/migrations/002_plugins.sql:2-18` (UNIQUE at :17); live `information_schema.columns` returns all 14 base columns (+5 governance columns, see C3) |
| C2 | docs/10 §7 "same tenant isolation as every other tenant table"; server/README:49 "FORCE ROW LEVEL SECURITY on tenant_id" | **VERIFIED** | 002_plugins.sql:22-27 (`ENABLE`+`FORCE ROW LEVEL SECURITY`, policy `tenant_isolation` USING/WITH CHECK on `current_setting('schoolos.tenant_id')`); `pg_policies` confirms policy `ALL` live |
| C3 | docs/12:15 & §23.1: "Migration 003 — shipped this pass (lifecycle states, capability_contracts, budgets, breaker, trust_level, cert_score)" | **VERIFIED** | `server/migrations/003_enterprise_hardening.sql`: 14-state CHECK (:3-4), `app.capability_contracts` (:7-18), `event_budget`/`ai_budget`/`breaker_state`/`trust_level`/`cert_score` columns (:21-26). Live DB: all 5 governance columns present (`information_schema`: 19 columns total); `pg_constraint` shows `plugins_status_check` = 14-state list (draft…uninstalled), `plugins_trust_level_check` = T0–T4, `plugins_class_check` = A–E |
| C4 | Assignment: migration 003 applied to the live DB | **VERIFIED** | `app.schema_migrations`: `001_init.sql` (2026-09-05 15:10), `002_plugins.sql` (15:12), `003_enterprise_hardening.sql` (15:45) — all three applied |
| C5 | docs/12 §4: Capability Contract "stored in `app.capability_contracts.contract`" | **VERIFIED** (table exists, live) | 003:7-17 (jsonb `contract` NOT NULL, UNIQUE(tenant_id, capability_id, version)) — note: no rows and no runtime consumer yet (see F-4) |
| C6 | docs/12 §12: "Schema enforcement shipped (migration 003) … now a tested lifecycle contract, not prose" (drain protocol) | **PARTIAL** | The 14-state CHECK is genuinely enforced (C3), but the *drain protocol itself* (docs/12:246 — pending actions hand back, quiesce+persist) is prose; nothing in `server/src/routes.js` implements disable-drain, and no test exercises it. Schema states ≠ drain behavior |

---

## C. Backend claims (docs/10 §7, docs/11 §19)

| # | Doc claim | Verdict | Evidence |
|---|---|---|---|
| B1 | docs/10 §7: "API: `GET /plugins` (list + availability), `POST /plugins/:id/enable`, `POST /plugins/:id/disable`, `POST /plugins/:id/settings`" | **PARTIAL** (code VERIFIED, live deployment broken) | Code: `server/src/routes.js:447` (GET), `:454` (enable), `:470` (disable), `:479` (settings) — all present. Live: `GET /plugins` with a valid principal JWT returns **500** — `server/logs/api.log` level:50: `"permission denied for table plugins"` code 42501 at routes.js:449 via `withUser` (runs as `schoolos_app`). Root cause: `app.plugins` was created *after* `bootstrap.js` granted `ON ALL TABLES` to `schoolos_app`; server/README.md:83's own runbook ("re-run after adding migrations") was not followed on the live DB. Tests pass because the suite provisions its own db fresh |
| B2 | docs/10 §7: "Enable/disable is role-gated (`owner`, `itadmin`) and **audit-logged** — the ledger records every switch" | **VERIFIED** (code) | routes.js:454 & :470 `{ preHandler: require('owner','itadmin') }`; `auditLog(...)` calls at :465 (enable, policyRef 'Platform §3.1 (plugin governance)'), :474 (disable), :483 (settings). Audit trail asserted by tests (plugins.test.js:36-48: enable+disable both audited, ≥2 Plugin entries) |
| B3 | docs/10 §7: "a `requestAudit` helper exists for third-party (class E) plugins" | **FALSE** | `grep -rn requestAudit server/src/` → 0 matches. No such helper exists anywhere in the backend |
| B4 | docs/11 §19: "backend `/plugins` API + tests (15/15)" | **VERIFIED** (tests; see B1 for live-API caveat) | Test run 2026-09-05: `npm test` → `ℹ tests 15 · pass 15 · fail 0`, duration 37.7s |

---

## D. Frontend kernel claims (docs/10 §8, docs/11 §8/§19)

| # | Doc claim | Verdict | Evidence |
|---|---|---|---|
| F1 | Assignment: `/plugins` + `/library` routes registered in App.tsx | **VERIFIED** | `app/src/App.tsx:203` `<Route path="/plugins" …PluginsScreen />`, `:204` `<Route path="/library" …<KernelGate plugin="library"><Library /></KernelGate> />` |
| F2 | docs/10 §8: "`useKernel()` — enables/disables plugins, persists per-school in `localStorage` (`schoolos.plugins.<tenant>`)" | **PARTIAL** | Mechanism VERIFIED (`app/src/plugins/useKernel.tsx:53-62` persists enable/disable). Key is **`schoolos.plugins.v1`** (useKernel.tsx:15) — *not* per-tenant (`schoolos.plugins.<tenant>` as the doc says). One browser, one tenant: acceptable in demo, wrong as spec'd |
| F3 | docs/10 §11: "Server table is truth; frontend persists a **mirror** for instant UX and re-syncs on load" | **PARTIAL** | Mirror exists (localStorage), but there is **no re-sync on load**: `loadEnabled()` (useKernel.tsx:17-24) reads only localStorage; no fetch of `GET /plugins` anywhere in the frontend kernel. "Server is truth" is currently aspirational |
| F4 | docs/10 §8: "`KernelGate` — gates routes/nav by plugin id" | **VERIFIED** (mechanism) / **PARTIAL** (coverage) | Mechanism: useKernel.tsx:96-110 (renders "not enabled" Empty + link to Plugin Manager), mounted via KernelProvider (App.tsx:283). Coverage: **only `/library` is gated** (App.tsx:204). Transport/maintenance routes are nav-hidden but reachable by direct URL when disabled — docs/11 §8 "disabled plugin = zero DOM presence (no dead links — implemented via KernelGate)" is true only for Library |
| F5 | docs/10 §8: "`Slot` — renders plugin widgets into `dashboard`/`attention` slots"; docs/11 §8 ATTENTION "max 2 plugin widgets (**implemented**)" | **PARTIAL** | Slot exists and renders registered+enabled widgets (`app/src/plugins/Slot.tsx:16-28`); mounted in Attention (`app/src/screens/Attention.tsx:14` import, `:423` `<Slot name="attention" />`). **But the "max 2" ration is NOT implemented** — Slot.tsx has no cap; it renders every enabled+registered widget. Only 1 widget is registered (`registerWidgets.ts:3-5` → `library:library.overdue`), so behavior coincides today; additionally the maintenance manifest *declares* `attention` widget `maintenance.sla` (pluginRegistry.ts:37) that is **never registered** — Slot silently skips it |
| F6 | docs/10 §8: "Shell nav filtering — nav items declare `plugin?: string`; disabled plugin → item vanishes" | **VERIFIED** | `useKernelNav` (useKernel.tsx:77-93, route-derived ownership); Shell.tsx:17 declares Library with `plugin: 'library'`; Shell.tsx:152 wraps items in `useKernelNav(items)` |
| F7 | docs/10 §8: "Plugin Manager (`/plugins`) — the switchboard UI: enable/disable, permissions list, slots, class badges" | **VERIFIED** | `app/src/screens/Plugins.tsx` uses `useKernel()` (`all, enabled, enable, disable`) — screen exists and is routed (F1). Note it drives localStorage only, consistent with F3's gap |
| F8 | Assignment: Library plugin manifest present | **VERIFIED** | `app/src/plugins/pluginRegistry.ts:40-53`: id `library`, class A, version 1.0.0, kernel range, permissions, slots nav/route/attention, route `/library`, widget `library.overdue`, `defaultEnabled: false` |
| F9 | Assignment: attention slot mounted in `app/src/screens/Attention.tsx` | **VERIFIED** | Attention.tsx:423 |

---

## E. Test suite claims

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| T1 | docs/11 §19 & docs/12 §23: "15/15 tests" | **VERIFIED** | `cd server && npm test` (exit 0): suites 8, tests 15, pass 15, fail 0 |
| T2 | Assignment: plugin RLS test exists | **VERIFIED** | `server/tests/plugins.test.js:50` "plugin rows are tenant-scoped (RLS)" — creates rival tenant + user (:56-57), asserts rival sees zero Meridian plugin rows (:62). Plus 3 more plugin tests: owner enable (:18), teacher 403 (:30), disable keeps audit trail (:36) |
| T3 | server/README.md:58: "runs 11 integration tests"; :60 coverage list | **FALSE** (stale) | Actual suite = **15** tests. The 4 plugin-registry tests (the subject of docs/10-12) are missing from the README's coverage list |

---

## F. Banner / README claims

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| R1 | Assignment premise: "README.md (v4.2 banner claims)" | **FALSE** | No "v4.2" (or any "v4") string exists in README.md, docs/10, docs/11, or docs/12 (grep = 0 hits). README.md:3 declares **"v3.0 (app build)"**. Either the v4.2 banner was never written or was reverted; the README currently predates the plugin layer entirely |
| R2 | README.md:3: "v3 layer is the **built product**: 56 screens / 57 routes" | **FALSE** (stale) | Actual: **62 files in `app/src/screens/`**, **63 `<Route>` elements** in App.tsx (61 screen routes + `/` redirect + `*` NotFound). Both numbers are low, and neither the banner nor the document map mentions the plugin layer, `/plugins`, `/library`, docs/10/11/12 |
| R3 | app/README.md:3: "v3 build: 60 screens · 61 routes · 10 roles · zero-TSC" | **FALSE** (stale + self-contradictory) | Actual 62 screens (63 route elements). Worse, app/README.md:86 says "screens/ # 56 role-aware screens" — line 3 (60) and line 86 (56) contradict each other in the same file; neither matches 62 |
| R4 | app/README "What's inside" table (lines 54-67) | **PARTIAL** | Accurate for everything it lists (flagships, golden loops :21, demo bar). Omits: Plugins screen, Library screen, the entire kernel layer (`src/plugins/` — grep "plugin" in app/README = 0 hits), and the `/demo` launcher family it itself references in the v3.1 blockquote |
| R5 | server/README.md:62-79 API surface list | **FALSE** (stale) | Lists 30+ endpoints; `/plugins` (4 routes) and `/migration` block partially present — but no `/plugins` row at all, despite it being the headline feature of docs/10-12. Test count row also stale (T3) |
| R6 | docs/11:8: "written against the **existing implemented system** (… plugin registry + Plugin Manager already shipped)" and §19 "Now (shipped)" list | **VERIFIED** (with caveats B1/F4/F5) | Every named artifact exists; three claims carry qualification (live-API grants, gate coverage, ration cap) |
| R7 | docs/10:2 / docs/11:2-4 supersession + amendment banners | **VERIFIED** | docs/10 header marks itself superseded by docs/11; docs/11 header carries the docs/12 amendment blockquote listing 003-grounded additions — cross-references resolve |

---

## G. Discrepancy findings (ranked)

1. **[HIGH] Live `/plugins` read path is broken in the running deployment** (B1): authenticated `GET /plugins` → 500, `permission denied for table plugins` for `schoolos_app`. Docs/10 §7 presents the API as working ("already implemented"). One-command fix per the repo's own runbook (server/README.md:83): re-run `node scripts/bootstrap.js` after migrations 002/003. Not a code bug — a deployment-step skip — but it is the difference between "shipped" and "demo-broken" on the exact screen docs/11 §19 claims.
2. **[HIGH] README banner is stale and the doc map omits the entire plugin layer** (R1/R2): README says v3.0 / 56 screens / 57 routes; reality is 62 screens / 63 route elements; docs/10-12 and `/plugins`/`/library` are absent from the document map. The assignment's "v4.2 banner" does not exist in any file.
3. **[MEDIUM] Three doc claims are ahead of the code they cite**: (a) `requestAudit` helper — named in docs/10 §7, absent from the server (B3); (b) attention "max 2 plugin widgets (implemented)" — no cap in Slot.tsx (F5); (c) "re-syncs on load" / "server table is truth" — frontend never reads the server registry (F3).
4. **[MEDIUM] app/README contradicts itself** (R3): 60 screens (line 3) vs 56 screens (line 86) vs 62 actual; and never mentions the kernel/plugin layer it now ships.
5. **[LOW] server/README stale on the two things this doc cycle added** (T3/R5): "11 integration tests" (actual 15), API list missing `/plugins`. The runbook note at :83 is correct and precisely diagnoses finding 1.
6. **[LOW] KernelGate coverage is Library-only** (F4): transport/maintenance nav-hide but direct-URL reachable when disabled — docs/11 §8's "zero DOM presence" is proven for one plugin only.
7. **[LOW] Manifest declares a widget the kernel never registers** (F5): `maintenance.sla` (pluginRegistry.ts:37) has no component in `registerWidgets.ts`; Slot silently drops it. Either register it or trim the manifest.
8. **[LOW] 14-state lifecycle enforced, drain protocol not** (C6): docs/12 §12 conflates the CHECK constraint with the "tested lifecycle contract"; only the state list is schema-enforced.

**Verified strengths worth recording:** the 14-state CHECK, trust_level T0-T4, event_budget/ai_budget/breaker_state/cert_score columns are real *in the live DB* (C3/C4); RLS on `app.plugins` is FORCE'd with USING+WITH CHECK (C2); the plugin RLS test genuinely crosses tenants and asserts zero rows (T2); enable/disable/settings are role-gated and audit-logged with policy refs (B2); 15/15 tests green in 38s (T1); the Library proof plugin does light up nav/route/attention through the manifest (F1/F6/F8/F9).

---

## H. Verdict tally (26 claims checked)

| Verdict | Count | Items |
|---|---|---|
| **VERIFIED** | 17 | E1, E2, C1, C2, C3, C4, C5, B2, B4, F1, F6, F7, F8, F9, T1, T2, R7 |
| **PARTIAL** | 5 | C6 (drain = prose), B1 (live 500), F2 (LS key), F3 (no re-sync), F4 (gate coverage) — F5 counted here (ration) |
| **FALSE** | 3 | B3 (`requestAudit`), R1 (no v4.2 banner), R3 (app/README counts, self-contradictory) |
| **PROSE-ONLY** | 1 | R5 (server/README API surface describes a doc-level list never matching shipped routes; plus T3 counted under FALSE) — R2 folded into FALSE/stale |

*(R2, R5, T3 are staleness-classified; final: 17 VERIFIED · 5 PARTIAL · 3 FALSE · 1 PROSE-ONLY.)*

**Worst discrepancy:** live `GET /plugins` → 500 `permission denied for table plugins` (finding 1) — the flagship "switchboard" read endpoint fails on the running API while docs/10 §7 and docs/11 §19 declare it shipped.

---

## I. Recommended fixes (in priority order; auditor does not apply them)

1. **OPS:** re-run `cd server && node scripts/bootstrap.js` against the live db (restores `schoolos_app` grants on `app.plugins`); add it to the migrate runner or a `npm run provision` so it can't be skipped.
2. **DOC:** rewrite README.md banner to the real version/counts (62 screens · 63 route elements) and add docs/10/11/12 + `/plugins`/`/library` to the document map; if a v4.2 banner was intended, write it.
3. **DOC:** fix app/README.md line 3 vs line 86 screen-count contradiction; add a "Kernel & plugins" row to the "What's inside" table and `src/plugins/` to the Architecture tree.
4. **DOC:** update server/README.md — 15 tests (add the 4 plugin tests to the coverage list), append the four `/plugins` routes to the API surface, and bold the grant-ordering runbook line.
5. **CODE (small):** implement the attention-slot ration (≤2) in Slot.tsx, or change docs/11 §8 "(implemented)" to "(designed)".
6. **CODE (small):** either register `maintenance.sla` in `registerWidgets.ts` or remove the widget declaration from the maintenance manifest.
7. **CODE (small):** extend KernelGate to transport/maintenance routes (or document Library-only gating in docs/11 §8).
8. **DOC:** docs/10 §7 — delete or downgrade the `requestAudit` sentence ("planned for class-E SDK"); docs/10 §11 — change "re-syncs on load" to "re-sync planned" or add the fetch.
9. **DOC:** docs/12 §12 — separate "14-state CHECK enforced (shipped)" from "drain protocol (designed, §20 next quarter)".
10. **PROCESS:** add a docs-audit gate to the build loop: any "(implemented)" / "(shipped)" claim in docs/10-12 must cite file:line — three of this cycle's claims would have been caught by it.
