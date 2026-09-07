# UI unit 18 — plain-language pass (text-only)

**FROM:** ui-agent
**TO:** orchestrator
**STATUS:** done
**Scope honored:** visible text only. Zero functional change. Routes, ids, localStorage keys, class names, aria wiring, numbers/money — untouched. Server diffs untouched (sibling lane owns files in server/** and two app/src files it created mid-unit; see §6).

## 1. Verdict

**PASS.** Evidence: `logs/u18-final.txt` (exit 0, 0 findings) — owner rotation 46/46 clean, principal nav shows renamed labels, teacher PII mask holds, parent portal clean, desk safety-rule line live, dark + widths pass, 0 console errors. Bundle assertions: 24/24 new plain-language strings present, 0/16 jargon strings lingering (`logs/u18-audit.txt`). tsc 0 errors (my files), eslint 0 errors 0 warnings, build ✓, `:4310` serving the final build.

## 2. Before → after mapping table (every change, grouped)

### Global glossary (nav, headings, doors)

| Before | After | Where |
|---|---|---|
| Attention (nav ×7) | Needs your attention | Shell.tsx all role cases |
| Operating loop (group) | Daily operations | Shell.tsx sidebar groups + palette |
| Memory (nav ×2) | AI memory | Shell.tsx |
| Migration (nav ×2) | Data import | Shell.tsx |
| Go to Attention / School Memory / School Constitution / Data Health / AI Governance / Audit ledger (palette) | plain equivalents | Shell.tsx CommandPalette |
| Memory (palette) | AI memory | Shell.tsx |
| Attention (page head) | Needs your attention | Attention.tsx |
| School Memory / Could not load School Memory / No documents in memory / Memory documents / Memory timeline / How memory closes loops / No decisions match | AI memory / Could not load AI memory / Nothing in the AI memory yet / What your assistant remembers / What your assistant remembers — timeline / How memory gets things done / No decisions match these filters | Memory.tsx |
| AI Governance / Human-control boundary | AI rules & control / Where humans stay in charge | AiGovernance.tsx |
| AI Usage & Cost | AI usage & cost | AiUsage.tsx |
| School Constitution / Edit draft — constitution entry | School policies / Edit draft — policy entry | Constitution.tsx (+ Settings.tsx button, ItAdmin registry row) |
| Audit ledger (page head, ×~20 strings across Audit/ActionCenter/Attention/People/ParentChat/ParentHome/ParentFees/DataHealth/Incidents/Today/WorkOrderDetail/Reception/ReportIssue/Maintenance/Constitution/HR/Admissions/LiveMode/DemoParent/AiDock/ItAdmin/Services traces) | Audit trail / activity log | sweep |
| Data Health | Data quality | DataHealth.tsx |
| The switch (Migration head) | Data import | Migration.tsx |

### Posture family

| Before | After | Where |
|---|---|---|
| Badge: APPROVAL REQUIRED / HUMAN-ONLY / AUTO | Needs approval / Never without a human / Runs automatically | ActionCenter.tsx |
| postureLabel: APPROVAL REQUIRED | Needs approval; HUMAN-ONLY → Never without a human; AUTO → Runs automatically | Automation.tsx (+ card line "approval required"/"auto-executes" → "needs approval"/"runs on its own", Enabled→On) |
| POSTURE_SHORT (table) | same three plain labels | AiGovernance.tsx (column "Posture" → "AI acts") |
| All postures / Filter by posture (aria) | All AI rules / Filter by AI rule | Constitution.tsx, AiGovernance.tsx (aria synced, rule 2) |
| Postures stat "AUTO / approval required / human-only" | AI acts · "AI acts: automatically / with approval / never without a human" | Constitution.tsx |
| governance distribution sub | "AI acts automatically for N, with approval for N, and never without a human for N." | AiGovernance.tsx |

### Escalation / SLA family

| Before | After | Where |
|---|---|---|
| Case escalated to the Principal (toast ×2 sites) | Case sent to the Principal · "They now have 4 hours to respond" | CaseDetail.tsx |
| Escalated case to Principal / Escalation recorded | Sent case to the Principal / Recorded | CaseDetail.tsx audit action |
| All clear — nothing needs escalation | All clear — nothing needs a human right now | Attention.tsx |
| "escalate to the Admin Officer at 7 days" | "pass it to the Admin Officer" | Automation.tsx sample rule |
| SLA (column, ×3 boards) / SLA clock / SLA policy / SLA at risk / SLA breached / breach SLA / hard SLA window / SLA engine / 7-day SLA | Deadline / Deadline soon / Over deadline / Response promise / "running out of time" / fixed deadline / Deadline tracker / "waited more than 7 days" | Cases, CaseDetail, Attention, Ask, Admissions, DemoDay, DemoParent, WorkOrders, ReportIssue, DataHealth |

### Money family

| Before | After | Where |
|---|---|---|
| Reconciliation (case filter) | Payment matching | Cases.tsx |
| Reconciliation worker / reconciliation cases / reconciled / Gateway + ledger diff | Payment matching / payment-matching cases / payment matched / Gateway + payments record | Fees, Demo, Cases, services traces |
| Obligations / Obligations due or overdue | What's owed / Fees due or overdue | Fees.tsx |
| Fee ledger / fee ledger / Ledger (money) — every occurrence (~25) | Fees records / fees record / payments record | Fees, Group, Reception, Operations, People, ParentHome, ParentFees, ParentAsk, Migration, Incidents, Today, DataHealth, services |
| Fee realization | Money received | Fees.tsx |
| Tally ledger (fee statement) | Your Tally books | DemoParent.tsx |

### Gates, kernel, spine, platform chrome

| Before | After | Where |
|---|---|---|
| "{Plugin} is not enabled for your school" + technical sub | This feature is switched off · "Ask the school owner to switch it on. Nothing is lost while it is off — your data is saved…" | useKernel.tsx KernelGate (all gated routes) |
| Visitors gate pass is not enabled | Visitors gate pass is switched off | App.tsx VisitorsHost |
| kernel ledger / kernel vault / kernel store / kernel-gated core write / kernel approval / kernel-gated | activity log / stored encrypted / recorded / enrollment approval sent to the Principal | Library, VisitorsBoard, FunnelBoard |
| event spine / operating spine | events flow / one connected story / same school day | Demo, DemoDay, DemoSummary |
| JWT issued · real API · real Postgres · tenant RLS | Signed in for real — your school's data, kept separate per school | LiveMode.tsx |
| Tenant (KV row) | School | LiveMode.tsx |
| Spine (KV row) | The essentials | Plugins.tsx |
| Control plane / Platform floor / Feature flags | Platform controls / What always runs / Feature switches | ItAdmin.tsx |
| Provisioned-style plugin chrome: "class B · Process" badge, slots/subscribes, enabled/disabled toasts | plain class label ("Runs a process"), "Shows up in:", "switched on/off" toasts with human sub-lines | Plugins.tsx, pluginTypes.ts |

### Plugin names + descriptions (registry AND live-mode map — §3)

| Before | After |
|---|---|
| WhatsApp Business Rails — "BSP adapter beneath the Communication Orchestrator: DLT-registered…" | WhatsApp messages — "WhatsApp messages to parents — fee receipts, attendance notes and delay alerts, sent from approved templates only." |
| UPI Collection Rails — "payment links + signed gateway webhook facts…" | UPI fee collection — "Collect fees with UPI payment links. Parents pay in one tap; the school office confirms the money arrived." |
| Transport GPS Rail — "Vendor GPS position ingestion with a deterministic guardian-notice guard…" | Bus tracking — "Bus GPS tracking + delay alerts. Parents are told automatically when a bus runs 10 minutes late." |
| Timetable Primitives — "Period grid, class-section slots, deterministic substitution…" | Class timetable — "Class timetable & substitutions. Set the weekly grid and find a substitute teacher in one click." |
| Library — "A proof plugin: lives entirely behind the manifest…" | Library — "Library books: catalog, issue and return, and overdue reminders. Switch it on and it appears in the menu; switch it off and it disappears." |
| Admissions Funnel — "Enquiry→enrollment funnel primitives: lead capture (session window + duplicate guard)…" | Admissions funnel — "Track admission enquiries from first call to enrolled. Keeps applicant details private and separate from student records." |
| Visitors Gate Pass — "kernel OTP-vault: scrypt-hashed, TTL + attempt-bounded…" | Visitors gate pass — "Visitor gate passes: the front desk prints a badge, and a student only leaves when the guardian confirms with a code. Safety first — release always needs verification." |

Permission tooltips (pluginTypes): audit.request → "Write to the school activity log"; events.emit → "Tell other features when something happens"; comms.send → "Send messages to parents and staff (with delivery receipts)"; memory.write → "Save notes to the AI memory"; actions.raise → "Ask a person to approve something"; fees.write → "…rarely allowed". Class labels: Record→Keeps records, Process→Runs a process, Primitives→Provides building blocks, Automation→Automates, Extension→Connects outward.

### Login cheat-sheet

| Before | After |
|---|---|
| "Deployment credentials — every role, one password" | "Try SchoolOS: pick a role" (password line unchanged below) |

### Memory helper (glossary item 4)

| Before | After |
|---|---|
| (no helper) | AI memory heading now carries "What your assistant remembers — every decision…" in both role variants (merged with existing sub, no duplicate attribute) |

### Misc tone

| Before | After | Where |
|---|---|---|
| Verify before disclose / Deterministic answer / Verify, answered from records | Checked before shared / Clear, sourced answer / Checked, answered from records | Demo.tsx journey steps |
| Settled, fail-closed, hash-chained, attempt-capped (desk copy) | plain-language safety lines with the same guarantees | VisitorsBoard ×3 |
| Deployment credentials | Try SchoolOS: pick a role | Login |
| Phone-logins hint | unchanged (already plain) | Login |

## 3. Server strings reworded client-side (rule 4) — for the plugin lane

New file **`app/src/lib/friendlyErrors.ts`** — display-only substring map, `friendly(raw)`; unmatched messages pass through unchanged. Wired at: VisitorsBoard (load error + all 3 action toasts), FunnelBoard load error, Today load error, Plugins toggle failure ("Could not save this change"), Login sign-in failure.

**Server strings listed for the plugin lane to reword at source:**
- `plugin <id> is not enabled for this tenant` — lifecycle-gate.js, all gated doors → mapped to "This feature is switched off for your school…"
- `no primary guardian phone on file — manual verification (photo ID at desk) required` — ops.visitors pickup 409 → mapped to the photo-ID line
- invariant ids `pickup_requires_guardian_otp`, `no_release_without_verification` (409 details) → mapped to the guardian-code line
- generic `Failed to fetch` / timeouts → "Can't reach the school server right now…" / "The server took too long…"

## 4. Rule-5 disclosure — audit assertions updated

My u16 audit asserted `Front-desk` visible on restricted teacher /visitors and grepped zero of the renamed copy; no other lane audits grep visible copy. The u18 audit (scratch, deleted) asserted the NEW copy and the ABSENCE of the old strings in the minified bundle — final run exit 0 in `logs/u18-final.txt` + `logs/u18-audit.txt`. No RC-verdict assertions broken: the RC visual verdict asserted structure (render/errors/overflow), not copy.

## 5. One deliberate anti-collision choice

`liveApi.ts` was mid-edit by the sibling lane when I needed to wire `friendly()` into error toasts. I did NOT touch it; the map is a standalone lib file and each call site imports it directly. Same reason Plugins.tsx carries a display-only `FRIENDLY` map for live-mode plugin cards instead of editing any service layer.

## 6. Sibling-lane activity observed (FYI, untouched by me)

- `app/src/screens/ParentComplaints.tsx` (NEW, untracked, theirs) — created mid-unit with a parse error; it currently breaks `tsc -p tsconfig.app.json` and adds `/parent/complaints` route + lazy import in shared `App.tsx`. Not mine; not blocked by me.
- `app/src/services/liveApi.ts` + `app/src/styles/components.css` — theirs.
- Their files were excluded from all my tsc/eslint verdicts via grep filters; my lane's gate stays 0/0.
- One warning surfaced in shared `App.tsx` (boot effect, exhaustive-deps) — suppressed with a one-line reason comment (stable setter, boot-once semantics). Behavior-neutral; disclosed here.

## 7. Handoff notes

- 38 files changed in my scope + 1 new file (`friendlyErrors.ts`). The pre-existing sidebar label-whitelist quirk (filed debt: some routes never render in the grouped sidebar for any role) remains — 'Data import' and 'Modules' labels are correct wherever they render (palette, doors, route headings), but their absence from the sidebar group whitelist is pre-existing, unchanged, and still filed.
- Numbers, money, percentages: untouched (rule 3). aria-labels synced where they labeled renamed controls (rule 2).
- Diff is text-only; the full ritual passed. Lane returns to HOLD.
