> **VERSION NOTE (v3 build).** Parts of this contract are superseded by the v3 build. The current truth: **12 roles** (adds `facilities`, `technician`), the store also holds `workOrders` with `wo/create | wo/patch | wo/advance` actions, `maintenanceService` + `maintenanceAsk` exist in services, routes total **57** (maintenance ×13, `/reception`, `/migration`), and new routes ARE allowed when they follow the same conventions (route registered in `App.tsx`, guard list updated, nav added in `Shell.tsx`). For the maintenance subsystem contract see `APP-MAINT-SPEC.md`; for the flagship/demo documentation see `../docs/07-build-flagships-and-demo.md`. Everything below remains valid except where this note conflicts.

# SchoolOS Frontend — Implementation Contract (READ FULLY BEFORE CODING)

You are implementing **part of the production frontend of SchoolOS** — "the intelligent operating system for schools". It is a **frontend-only demo**: every screen must look and behave like the product of a funded, enterprise-grade company whose backend simply hasn't been connected yet. No backend exists. The mock layer is your "backend".

## The product in one paragraph

SchoolOS is a calm, evidence-driven operating system for schools. Its signature is **trust through evidence**: every AI claim shows its source records, every action follows the School Constitution (policy engine), every decision lands in an immutable audit ledger, and every loop closes in School Memory. The design language is warm paper (#F7F6F3), deep-teal accent (#0E7568), iris AI accent (#5D53B8), Inter-ish system stack, 1px hairline borders, soft shadows, tabular numerals. It should feel like Linear/Stripe/Notion quality — **not** generic blue SaaS, **no** purple-gradient AI clichés, **no** emoji in headings, **no** lorem ipsum, **no** dead buttons.

## Non-negotiable conventions

1. **Only edit the screen files assigned to you** (listed below). Do NOT edit any shared file (`App.tsx`, `components/*`, `state/*`, `services/index.ts`, `mock/*`, `styles/*`, `types/*`, `lib/*`). If you believe a shared file is broken or missing something, **work around it** and note it in your final report instead of editing it.
2. Each screen file must `export default function ScreenName()` (named exactly as listed). React 19 + TypeScript. Must pass `npx tsc -b --force` with **zero errors** (run `export npm_config_cache=/tmp/npm-cache` first in every shell).
3. Data comes ONLY from `import * as seed from '../mock/seed'` and services from `import { ... } from '../services'`. Never invent your own data arrays for seeded domains (students, fees, etc.). Local UI state (filters, tab, modal open) is fine.
4. Cross-screen state (actions, cases, notifications, audit, chat, live events) comes from `const { session, domain, dispatch, actorName, setRole } = useStore()` (see below). Use it rather than seed copies for anything the demo mutates.
5. Async data fetching: use the `useAsync` hook pattern shown below with the services layer (or a Promise over seed data), always with loading skeleton → content → error state with retry.
6. **Every interactive element does something** — opens a modal/drawer, filters, navigates, dispatches a store action, or shows a toast (`const toast = useToast()`). A button that does nothing is a defect.
7. **AI claims always show provenance**: use `EvidenceChain`, `AiTraceCard`, `AiResponseView`, `SuggestedActions` from `components/Ai`. An AI suggestion without an evidence chain is a defect.
8. **Loading, empty, error, and no-permission states** are required wherever a list/table can be empty. Use `Empty`, `ErrorState`, `Skeleton`, `SkeletonCard` from `components/ui`.
9. Accessibility: focusable cards need `role="button"`/`tabIndex`/keyboard handlers (the `Card` component handles this when `onClick` is passed); every icon-only button needs `aria-label`; form inputs need labels; tables need `<th scope>`-equivalent semantics (the `DataTable` component handles it).
10. Currency in ₹ with `fmtMoney`/`fmtMoneyShort`, dates with `fmtDate/fmtDateShort/fmtTime/fmtDateTime/fmtRelative` from `lib/format`. Numbers that compare across rows use class `tnum` or `mono`.
11. Navigation: `useNavigate` from react-router-dom. In-page drawers/modals for detail views. Do not add new routes.
12. Copy: precise, calm, human. e.g. "Guardians of 38 students will be notified within 15 minutes (Transport §3.1)". Reference policy clauses like `Fees §4.2`. No exclamation marks, no hype.

## Shared API cheat-sheet

### `state/store.tsx` — `useStore()`
```ts
const { session, domain, dispatch, actorName, setRole, permissionError } = useStore();
session           // { roleId, campusScope: 'north'|'city'|'east'|'all', activeCampus }
domain.actions    // ActionItem[] — the Action Center (seeded 6 items; statuses mutate)
domain.cases      // SchoolCase[]
domain.notifications
domain.chat       // ChatMsg[] — the parent WhatsApp thread
domain.audit      // audit entries (grows when you dispatch decisions)
domain.events     // LiveEvent[] — live simulated event stream (DemoBar emits)
dispatch({ type: 'action/decide', id, decision: 'approved'|'dismissed', actor: actorName, role: session.roleId, note? })
dispatch({ type: 'case/advance', id, status: 'in-progress'|'resolved'|..., note?, actor? })
dispatch({ type: 'chat/add', msg: { id, from: 'guardian'|'school', text, on: new Date(), status: 'sent' } })
dispatch({ type: 'notification/read', id? } | { type: 'notification/read', all: true })
dispatch({ type: 'event/add', e: { id: `ev_${Date.now()}`, on: new Date(), type: 'x', label: '...', severity: 'info'|'warn'|'critical' } })
dispatch({ type: 'audit/add', entry: { actor, actorRole, action, recordType, recordRef, reason?, policyRef?, aiInvolved, risk, outcome } })
```
`session.roleId` is one of: `principal | teacher | coordinator | finance | admissions | transport | parent | student | owner | itadmin`. **Role-awareness**: screens should adapt header copy, visible tabs, and data scope to the role where sensible (e.g. Finance sees fee ledger first; Teacher sees their sections). Use `permissionError('fees'|'admissions'|'transport'|'group')` to gate.

### `mock/seed.ts` (import `* as seed`)
`SCHOOL`, `campuses`, `students` (~500 `Person`), `teachers` (52), `staff` (20), `guardians` (~700), `guardianLinks`, `sections` (30 `Section`), `timetable` (`TimeSlot[]`), `attendance` (`AttendanceRecord[]`, 30 school days; Grade 8-B anomaly last 5 days), `TERM_DAYS` (last 30 school days), `feeObligations`, `payments`, `leads` (68), `busRoutes` (10; `route_7`/Bus 14 is delayed +13min), `documents` (`DocRecord[]`), `incidents` (`IncidentRecord[]`), `cases`, `actionItems`, `decisions`, `meetings`, `memoryDocs`, `policies` (14 `PolicyRule`), `workflows` (6 `WorkflowDef`), `workflowRuns`, `obligations`, `calendarEvents`, `healthIssues`, `healthScore()`, `notifications`, `auditEntries`, `insights`, `aiUsage`, `models`, `guardianChat`, plus helpers:
```ts
seed.studentsOfSection(sectionId)      // Person[]
seed.sectionOfStudent(st)              // Section
seed.guardiansOfStudent(studentId)     // { link, guardian }[]
seed.studentFeeSummary(studentId)      // { items, due, overdue, paid, hasFailed }
seed.studentAttendanceRate(studentId)  // { rate, absent, late, excused, series }
seed.sectionAttendanceToday(sectionId) // { total, absent, late, pct, unmarked }
seed.findPerson(id)
seed.peopleAll()
```

### `mock/scenarios.ts`
`SCENARIOS` — 4 demo scenarios with steps (already surfaced in the DemoBar; you don't need it unless a screen references scenario state).

### `services/index.ts`
`peopleService.search(query, { campus, type, grade })` → `Promise<Person[]>`; `peopleService.student(id)`, `.guardiansOf(id)`, `.feeSummary(id)`, `.attendance(id)`; `feeService.obligations(campus)`, `.payments(campus)`, `.simulatePayments()`, `.recordRetry(id)`; `attendanceService.today(sectionId)`, `.mark(sectionId, entries)`, `.syncPending()`; `admissionsService.leads(campus)`, `.moveLead(id, stage)`; `transportService.routes(campus)`, `.simulateBreakdown()`; `aiService.ask(question, ctx)` → `Promise<AiResponse>`, `.draftStudentBriefing(id, viewer)`; `workflowService.list()`, `.runs()`, `.toggle(id, enabled)`, `.compileFromNaturalLanguage(text)`; `memoryService.searchDecisions(q)`, `.everything()`; `actionService.list()`.
All async with simulated latency — always handle loading + error.

### `components/ui.tsx`
`Button({variant: 'primary'|'secondary'|'ghost'|'danger'|'danger-ghost'|'ai', size: 'sm'|'lg', icon, iconRight, loading, ...})`, `Badge({tone: 'neutral'|'success'|'warning'|'danger'|'info'|'ai'|'accent'|'outline', dot})`, `Avatar({name, size:'sm'|'md'|'lg', square})`, `Card({head, actions, pad, onClick, className})`, `Stat({label, value, delta:{value,dir}, sub, spark, onClick})`, `Empty({icon, title, sub, action})`, `ErrorState({title, sub, onRetry})`, `Skeleton({w,h,r})`, `SkeletonCard({lines})`, `Dropdown({trigger(open), children(close), align, width})`, `Modal({open, onClose, title, sub, children, footer, size:'lg'})`, `Drawer({open, onClose, title, sub, children, footer})`, `Tabs({tabs:[{id,label,count}], active, onChange, pill})`, `DataTable({columns:[{key,label,render,width,align}], rows, rowKey, onRowClick, empty})`, `PageHead({title, sub, actions, back:{to,label}})`, `useToast()` → `toast({title, sub, tone:'info'|'success'|'error'})`, `Section({title, sub, actions, children})`, `Progress({value, tone:'warn'|'danger'})`, `SegmentedBar({parts:[{value,color,label}], height})`, `KeyValue({items:[{k,v}], cols})`, `Timeline({items:[{time,title,body,dot:'accent'|'ai'|'danger'}]})`.

### `components/Chart.tsx`
`LineChart({series:[{name,color,points,dashed}], labels, height, yFormat, area})`, `BarChart({data:[{label,value,color}], horizontal, format, highlightMax})`, `Sparkline({points, color, height, width})`, `Donut({segments:[{label,value,color}], centerLabel, centerSub})`, `Heatmap({weeks, data, colorFor})`.

### `components/Icon.tsx`
`Icon.Today, Attention, Ask, Next, People, Learning, Operations, Insights, Automation, Memory, Search, Bell, Check, X, Plus, ChevronRight, ChevronDown, ChevronLeft, ArrowRight, ArrowUpRight, ArrowDown, Money, Bus, Calendar, Document, Shield, Alert, Clock, Send, Mic, Sparkle, User, Settings, Building, File, Grid, Layers, Workflow, Wrench, Book, Award, ExternalLink, Refresh, Play, Pause, Trash, Eye, Lock, Database, Code, Home, Heart, Star, Filter, Download, Edit, Message, Phone, Mail, CreditCard, Clipboard, Sunrise, Zap, Target, Users, Graduation, Wallet, Info, Copy, Compass, Flag, Key, Offline` — each `(p) => <svg/>`, pass `size={n}`.

### `components/Ai.tsx`
`AiHeader({label, confidence})`, `EvidenceChain({title, steps:[{label,detail,source,refType}]})`, `AiTraceCard({trace, defaultOpen, compact})` — the signature "Why did SchoolOS do this?" expander, `AiResponseView({response, onAction})` — renders `AiBlock[]` (text/chain/draft/list/note), `SuggestedActions({actions, onApprove, compact})`, `EventLine({e})`.

### `components/Chart.tsx` + `components/ui.tsx` + CSS utilities
`u-flex u-col u-between u-grow u-gap-1..5 u-muted u-faint u-small u-xs u-bold u-truncate u-clamp2 u-upper u-mono(u-mono? use 'mono' class) u-tnum(.tnum) u-hide-mobile u-hide-desktop`; layout: `.page` is applied by App; use `PageHead`, `Section`, `Card`, `grid grid-2/3/4`.

### `components/Shell.tsx`
Nothing to import for screens (App owns it). If you need the AI panel in-page, build your own layout with `AiResponseView` etc.

### `lib/format.ts`
`fmtMoney(n)`, `fmtMoneyShort(n)`, `fmtNum(n)`, `fmtPct(n)`, `fmtDate(d)`, `fmtDateShort(d)`, `fmtTime(d)`, `fmtDateTime(d)`, `fmtRelative(d)`, `initials(name)`, `clamp(n,min,max)`, `fmtDuration(mins)`, `weekday(d)`.

### Standard async pattern
```tsx
import { useEffect, useState } from 'react';
function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState(s => ({ ...s, loading: true, error: null }));
    fn().then(d => live && setState({ data: d, loading: false, error: null }))
        .catch(e => live && setState({ data: null, loading: false, error: String(e) }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, retry: () => setTick(t => t + 1) };
}
```
(Put this hook inside ONE of your screen files or duplicate it locally per file — do not create new shared files.)

## The narrative (bake it in, it's what reviewers check)

- **Bus 14 / Route 7** broke down 2 days ago (coolant leak, 38 students, 22-min delay). It explains: Grade 8-B attendance collapse (23% vs 94% avg — 5 of 6 absentees ride Bus 14), the fee-collection dip (41 of 47 failed payments are Route 7 households), 2 WhatsApp complaints, incident `inc_1`, decision `dec_4` (pre-route inspections), and today's Morning Briefing "NEEDS YOU" items.
- **Fee intelligence**: collection 82.3% vs 88% 4-week avg; 23 gateway timeouts pending settlement-file import (case `case_3`).
- Today is a school day. The Principal briefing bands: NEEDS YOU / CHANGED OVERNIGHT / TODAY / WATCH (with "Coming due"/"Tomorrow" forward band).

## Quality bar

Before declaring done: `npx tsc -b --force` passes with zero errors from YOUR files; no placeholder text like "TODO"; no `console.log`; every button wired; realistic density (tables have 8–20 rows visible or pagination, not 3); headers use `PageHead`; filters actually filter.

Report back: files written, screens completed, any shared-file issues you worked around (do not fix shared files yourself).
