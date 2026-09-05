# SchoolOS Plugin Architecture
**Version 1.0 · 2026-09 · Status: superseded by [docs/11-plugin-native-architecture.md](11-plugin-native-architecture.md) — kept for the record. docs/11 is the adopted target architecture (kernel + capability runtime + four plugin classes + policy packs); this v1 doc described the first working slice (registry, Plugin Manager, Library proof plugin), all of which carries forward unchanged.**

> "Everything is a plugin; the school chooses what it wants."

---

## 1. The Boundary (the only hard rule)

**The SchoolOS Kernel is everything a school cannot opt out of and still call it a school.**

| Kernel (not pluggable) | Why it cannot be a plugin |
|---|---|
| Tenancy + roles + RLS | Isolation is not optional |
| Attendance, enrollment, people | The legal/operational spine |
| Fees, payments, receipts, reconciliation | Money and statutory record |
| Audit ledger (append-only) | Trust substrate — plugins write to it, never around it |
| Approvals (action spine) + notifications | Governance |
| Events, comms log, guardian verification | Consent + safety |
| Plugin Manager, entitlements, plugin audit | The switchboard itself |

**Everything else is a plugin:** transport, maintenance, library, exams, hostel, canteen, inventory, visitor management, sports, alumni — even front-desk telephony.

Nuance: **policies are kernel, tables are plugins.** "Safeguarding net" (who may message a child) is kernel; "library circulation" is a plugin. Transport is a plugin *that the kernel knows about* via the Attendance/People spines (`bus_route` on the student record is kernel-owned data; routes/vehicles/GPS are plugin-owned).

## 2. Why this architecture (analysis)

- **The kernel already behaves like one.** Migration, actions, audit, and policy refs (Transport §3.1, Fees §4.2) have been feature-agnostic from day one. The audit ledger has no `module` column — it records *what happened*, not *which product did it*. Events, cases, actions, and memory were built as shared primitives, not feature tables.
- **Schools differ by compliance, not by core.** Every school must do attendance, fees, audit. Only some run hostels, canteens, libraries. Forcing optional domains into the core creates bloat the 80% must pay for.
- **The acquisition story improves.** Small school: kernel + attendance + fees + comms. The plugin menu is the expansion path (and the expansion revenue).
- **Demo coherence survives.** The three golden loops touch only kernel surfaces. Plugins *enhance*; they never gate the story.

## 3. Contract Taxonomy — five plugin classes

| Class | Example | Contract with kernel | Integration |
|---|---|---|---|
| **A · Record plugin** | Library | Owns its tables; contributes config UI | Low: own routes/screens |
| **B · Process plugin** | Transport | Uses kernel workflow + approval spine | Medium: raises actions, consumes events |
| **C · Primitives provider** | Exam/Timetable | Others consume its outputs | Medium-high: stable read APIs |
| **D · Automation plugin** | Voice/Telephony front desk | Extends channels + triggers on kernel events | High: event subscriptions + outbound via orchestrator |
| **E · Extension plugins** | Marketplace integrations | Out-of-process, restricted API | High: signed requests, scoped tokens, egress allowlist |

Golden rule: **plugins may never write to the audit ledger directly; they request the kernel to record.** Even first-party plugins use the same pathway — otherwise the audit guarantee is negotiable and therefore worthless.

## 4. Plugin Manifest (the contract, in code)

```ts
interface PluginManifest {
  id: string;                    // 'library', 'transport'
  name: string;                  // 'Library'
  version: string;               // semver
  class: 'A'|'B'|'C'|'D'|'E';
  description: string;
  kernel: string;                // '>=1.0.0 <2.0.0'
  permissions: Permission[];     // scoped, reviewed, user-visible
  slots: SlotId[];               // where it appears
  routes?: { path: string; label: string; icon: string }[];
  widgets?: SlotId[];            // attention/today slot widgets
  eventSubscriptions?: string[]; // e.g. ['attendance.absences']
  settingsSchema?: JSONSchema7;  // admin-configurable
  dependsOn?: string[];          // other plugins
  defaultEnabled?: boolean;      // B-class often true for Indian schools
}
type Permission =
  | 'students.read' | 'attendance.read' | 'attendance.write'
  | 'fees.read' | 'fees.write' | 'audit.request' | 'events.emit'
  | 'actions.raise' | 'comms.send' | 'memory.write';
```

**Permission → kernel surface mapping:** `students.read` → People spine read API · `attendance.read/write` → Attendance · `fees.read/write` → Fees · `events.emit` → event bus (outbox) · `actions.raise` → action spine · `comms.send` → Communication Orchestrator (dedup, quiet hours, receipts) · `audit.request` → ledger write via kernel · `memory.write` → institutional memory.

## 5. Slots — where plugins may appear

`nav` · `route` · `dashboard` (post-login cards) · `attention` (items in the principal's list) · `today` (timeline items) · `student-record` (tabs on a child's page) · `settings` (admin config sections) · `reports` (exportable views) · `mobile` (PWA tabs).

A plugin absent from a slot **does not exist** on the user's screen — no dead links, no phantom nav.

## 6. Lifecycle & state machine

`registered → enabled → disabled → unregistered` (also `suspended` for policy violations).

```
register (owner/itadmin) → enable (entitlement checked) → [disable] → re-enable
                                    ↘ suspend (kernel-level, audit-logged, appeal path)
```

Rules:
- **Enable** requires: kernel compat ✓, permissions accepted ✓, entitlement ✓ (if commercial), no unmet `dependsOn`.
- **Disable** is soft: data is retained and exportable; nav/routes/widgets disappear; subscriptions stop firing.
- **Unregister** requires 30-day export window (DPDP-friendly); audit trail of the plugin's writes persists (ledger is forever).
- **Updates** re-run the compat gate; breaking kernel changes bump major → plugins re-consent permissions.

## 7. Server-side truth (already implemented)

```sql
app.plugins (
  id, tenant_id, plugin_id, version, class, status,        -- registered|enabled|disabled|suspended
  manifest jsonb, permissions jsonb, settings jsonb,
  entitlement jsonb,                                        -- { plan, seats, valid_until }
  enabled_at, enabled_by, updated_at, UNIQUE (tenant_id, plugin_id)
)
```

- **API:** `GET /plugins` (list + availability), `POST /plugins/:id/enable`, `POST /plugins/:id/disable`, `POST /plugins/:id/settings`. Enable/disable is role-gated (`owner`, `itadmin`) and **audit-logged** — the ledger records every switch.
- **Entitlements** live on the row (`entitlement jsonb`) — the Control Plane reads the same truth.
- **Kernel audit:** plugins call the same `auditLog()` pathway; a `requestAudit` helper exists for third-party (class E) plugins.

## 8. Frontend kernel (already implemented)

- **`pluginTypes.ts` + `pluginRegistry.ts`** — manifest types + first-party registry (Transport, Maintenance, Library as proof, plus descriptive entries for future classes).
- **`useKernel()`** — enables/disables plugins, persists per-school in `localStorage` (`schoolos.plugins.<tenant>`); one switch updates nav, routes, widgets everywhere.
- **`KernelGate`** — gates routes/nav by plugin id.
- **`Slot`** — renders plugin widgets into `dashboard`/`attention` slots.
- **Shell nav filtering** — nav items declare `plugin?: string`; disabled plugin → item vanishes.
- **Plugin Manager (`/plugins`)** — the switchboard UI: enable/disable, permissions list, slots, class badges, seeded-state summary, kernel note.

## 9. Why not microservices / not third-party-first

Microservices would multiply operational cost (ten schools' worth of deploys, tracing, version skew) for zero school-visible benefit — the domain is one coherent spine, not twelve bounded contexts. Third-party-first would hand the audit trail to parties who don't sign the audit contract. So: **modular monolith kernel + first-party in-process plugins (A–D) + tightly-gated out-of-process extensions (E) later.** The seam is real (manifest + slots + permissions), so E-class can arrive without re-architecture.

## 10. Economics

- **Kernel price** covers attendance/fees/comms/audit — the must-haves.
- **Plugins price per module** (transport, maintenance, library…) — schools pay for what they switch on; the plugin manager makes entitlement visible.
- **E-class marketplace** later: revenue share, security review, revocable tokens, egress allowlist.
- **Migration trust receipt** extends naturally: "5,099 records imported · N plugins configured on day one."

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Manifest sprawl / slot abuse | Slot registry is finite and kernel-owned; `attention` slot is rationed (**max 2 plugin widgets — enforced in code**: `MAX_WIDGETS_PER_SLOT` in `app/src/plugins/Slot.tsx`) |
| Plugin breaks money data | Money surfaces are kernel-only; plugins get scoped `fees.read` |
| Dead plugins rot in nav | Disabled = invisible (nav/routes/widgets all gate) |
| Permission fatigue | Permission bundles per class (A read-only, B read+act, D comms+events) with plain-language summaries in the Manager |
| Two sources of truth for state | Server table is truth; frontend persists a **mirror** for instant UX and re-syncs on load (**implemented**: live-API builds re-sync enablement from `GET /plugins` on mount — `useKernel.tsx`) |
| Kernel split confusion | §1 table is the constitution; changes require the same review weight as schema migrations |

## 12. What this changes in the demo

Plugin Manager joins the IT-admin tour (one minute: "everything the school doesn't need is a switch, not a feature request"). Migration Act 0 can show "3 plugins configured on day one." Nothing else changes — the golden loops stay kernel-pure.
