# APP-MAINT-SPEC — Maintenance & Facilities build-out contract

You are building screens for SchoolOS, an existing production-quality React 19 + TS frontend at `/home/cassandra/schoolOS/app`.
Read this fully. **Edit ONLY the files assigned to you.** Shared files (App.tsx, Shell.tsx, store, services, mock/seed, mock/maintenance, components/*, styles/*) are owned by the orchestrator and must not be edited — if something is missing, note it in your report.

## Conventions (match existing screens — copy patterns from src/screens/Fees.tsx or Attention.tsx)

- Local async hook pattern (copy `useAsync` from Attention.tsx top).
- Page scaffold: `<PageHead title sub actions />` then `<Section>` / `<Card>` from `components/ui`.
- Icons: `import { Icon } from '../components/Icon';` — available names: Today Attention Ask Next People Learning Operations Insights Automation Memory Search Bell Check Plus ChevronRight ChevronDown ChevronLeft ArrowRight ArrowUpRight ArrowDown Money Bus Calendar Document Shield Alert Clock Send Mic Sparkle User Settings Building File Grid Layers Workflow Wrench Book Award ExternalLink Refresh Play Pause Trash Eye Lock Database Code Home Heart Star Filter Download Edit Message Phone Mail CreditCard Clipboard Sunrise Zap Target TrendDown Users Graduation Wallet Info Copy Compass Flag Key Offline Scale
- No emoji in headings, no lorem ipsum, no dead buttons, no console.log.
- Design language: warm paper, hairline borders, tabular numerals (`u-mono`), no gradients, calm.
- Every async surface: loading (SkeletonCard) → error (ErrorState with retry) → empty (Empty) → data.

## Data & service API (DO NOT EDIT — consume only)

`import { maintenanceService } from '../services';`
- `overview(campus)` → `{ analytics, open: WorkOrderRecord[], slaRisk: {wo, sla}[], assets, plans }` (analytics: openCount, emergency, resolvedCount, slaPct, avgResolutionHrs, spend, byBuilding[{building,spend}], pmTasks, pmOverdue, riskyAssets)
- `workOrders(campus)` / `workOrder(id)` / `technicians(campus)` / `recommend(category, campus)` → `{tech, score, skillMatch, why[]}[]`
- `assets(campus)` / `asset(id)` / `replacement(id)` (→ replacementView | null)
- `plans()` / `inspections()` / `inventory()` / `vendors()`
- `advance(id, to, actor, note?)` / `assign(id, techName, actor)` / `complete(id, actor, {resolution, rootCause, parts?, labourMins?, preventiveNote?})` / `addVoiceNote(id, transcript, actor)` / `rate(id, stars, note?)`
- All async, throw on failure; wrap in useAsync or try/catch.

Store (domain state, live-updating):
`const { session, domain, dispatch, actorName, permissionError } = useStore();`
- `domain.workOrders: WorkOrderRecord[]` — authoritative current list (seed + user actions).
- `dispatch({ type:'wo/advance', id, to: WOStatus, actor, note?, actorRole? })`
- `dispatch({ type:'wo/create', wo })` — NOT needed in your screens; report flow owns it.
- `session: { roleId, campusScope: CampusId|'all', activeCampus }` — scope lists by activeCampus.
- New roles exist: 'facilities' (manager), 'technician'. permissionError('maintenance-manage') true unless facilities/principal/owner.

`import * as m from '../mock/maintenance';` (read-only helpers): `SLA_POLICY, assets, technicians, maintPlans, inspections, inventory, vendors, woById, assetById, technicianByName, woSpend, openWorkOrders, slaState(wo) → {label, tone:'success'|'warning'|'danger'|'neutral', breached}, recommendTechnicians, replacementView(a), maintAnalytics(campus)`.

Types: `import type { AssetRecord, WorkOrderRecord, WOStatus, WOCategory, MaintPriority, TechnicianRecord, MaintPlan, InspectionRecord, InventoryItem, VendorRecord, CampusId } from '../types/domain';` plus `WO_FLOW` (value import) = ['reported','assigned','accepted','en-route','on-site','repairing','verification','resolved'].

## Shared component kit — `import { PriorityBadge, WOStatusChip, woStatusLabel, SLAIndicator, HealthRing, AssetTag, QRPattern, WOStepper, AiUnderstanding, PriorityWhy, TechnicianWhy, AssetMini, StatusDot, assetStatusLabel } from '../components/Maint';`

- `SLAIndicator({ sla: {label, tone}, breach? , size? })` — pill with clock/alert icon.
- `WOStepper({ wo })` — horizontal lifecycle stepper with timestamps.
- `AiUnderstanding({ wo })` — the AI-understanding block (badges + numbered reasoning).
- `PriorityWhy({ factors })` — weighted bars for priority explanation.
- `TechnicianWhy({ why, score? })` — check-list of assignment reasons.
- `AssetMini({ asset, onClick })` / `AssetTag({ id, onClick })` / `HealthRing({ score, size? })` / `QRPattern({ seedText, size? })`.
- `AssetMini` accepts `style`.

## Narrative anchors (keep consistent)

- Flagship: **NOR-PRJ-204** — Epson EB-X49 projector, Science Lab 204, Block A, North. WO-1045 reported 34 min ago by Priya Iyer (teacher), status `reported`, priority `high`, AI match 97%.
- **NOR-AC-04** — Voltas Science Lab AC, health 42, 4 failures/63 days, ₹18,400 YTD, WO-1042 `repairing` (Sunita Yadav). Replacement evaluation triggers (25% spend ratio).
- **NOR-WC-07** — water cooler leaking, WO-1044 `on-site` (Ravi Kumar), critical SLA.
- **NOR-GEN-01** — generator inspection overdue (MP-03, 5 days), WO-1043 assigned (Manoj Patil).
- **NOR-BSW-12** — Bus 14 in workshop (WO-1041, verification) — ties to the existing transport narrative inc_1/dec_4.
- Technicians: Ravi Kumar (plumbing), Sunita Yadav (HVAC), Arif Shaikh (AV — the signed-in tech), Manoj Patil (fire/DG), Leena D'Souza (city), Imran Qureshi (east).
- WO ids are WO-10xx; assets CAMPUS-TYPE-NN (NOR-AC-04).

## Screen specs (yours)

[Agent A — WorkOrders / WorkOrderDetail / TechnicianWorkspace]
[Agent B — Assets / AssetDetail / MaintInventory / MaintVendors]
[Agent C — Preventive / Inspections / MaintMap / MaintIntelligence]
(see individual prompts for the detailed briefs)

## Quality bar

- `export default function ScreenName()` matching the lazy import name in App.tsx.
- Mobile: works at 390px (grid → single column, tables → cards or horizontal scroll).
- Role awareness: technician sees their own jobs; facilities/principal see everything; scope by session.activeCampus.
- After finishing: run `export npm_config_cache=/tmp/npm-cache && cd /home/cassandra/schoolOS/app && npx tsc --noEmit -p tsconfig.json` — your files must contribute ZERO errors. Fix your own; never touch shared files.
