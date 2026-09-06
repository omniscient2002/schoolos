# STATE OF THE INTERFACE — UI lane closing report (units 1–12)

FROM: ui-agent
TO: orchestrator
STATUS: done — lane caught up after unit 12

---

## The arc

Twelve units took the app from "34 routes that render" to an interface with a **real design system**: one component library with documented house patterns, a 116-token design language with zero stray color decisions in screens/components (outside two documented exemptions), a11y wired as mechanics rather than audit-day patches, and — unit 12 — a dark theme that fell out of that discipline in a single unit.

## Unit ledger (what each left behind)

1–6 (foundation): route coverage across 3 roles; token discipline established (104 tokens, screens weaned off raw hex); Guard/Frame role derivation; live↔demo session bridge; DataTable/Empty/Section/Card primitives with keyboard rows; mirror-hydration gap found and owned by server lane.
7 — full-route a11y sweep (34 routes × 3 roles): keyboard parity on every interactive surface, focus rings, overflow sweep clean at 390/768/1920.
8 — structural a11y: sr-only captions on all 26 tables with honest fallback, tabpanel wiring (Maintenance/Fees/Learning/Attendance/Login), coarse-pointer 44px floors, persistent `audit-lib.mjs`.
9 — character pass: Today ribbon, severity rails, drawn-check empty states, tabular numerals, cite-slip, reduced-motion-gated reveals, schematic route strips. Zero layout change, zero new API calls.
10 — the rigor unit: Dropdown rebuilt as APG menu-button (house pattern #9), table-class decisions documented (34–60px band, zebra NONE, em-dash cells), accessible-name gaps closed, Login aria-invalid exemplar verified by deliberate wrong-password probe.
11 — sort + assessment: DataTable SORT API (deterministic in-memory, aria-sort, rowKey tie-break — proven by same-state-twice), sign-out tokenized, dark-mode feasibility (which became unit 12).
12 — dark mode: token sweep with pixel-level bit-identity proof, `dark.css` dual-path layer (media + attribute), campus-hue channel per your ruling, /settings theme control (radiogroup, persisted, no-flash boot), both-ways dark/light audit.

## Now house style (the systemic fixes)

- **Patterns**: Empty.titleAs · Card.headAs · skip-link · keyboard table rows · tabpanel convention · sr-only caption · focus-ring detection · three-tier loading · APG menu-button · sortable DataTable (asc→desc→none, deterministic, aria-sort) · theme radiogroup.
- **Motion**: reduced-motion is gated both-ways on every motion unit — an assertion, not an intention.
- **Proof standard**: this lane's claims are audit-backed — bit-identity now means *pixel equality against a worktree build of the accepted commit*, not eyeballing.
- **Honesty ledger**: probe artifacts, wrong-password 401s, and dataset-honest MINORs are disclosed, not papered over.

## Backlog (owners as of lane close)

| Item | Owner | Note |
|---|---|---|
| Mirror hydration (audit ledger + a few live lists render empty in live mode) | **server lane** | known since unit 6; also gates /audit sort UX visibility |
| `/library` role flip | **plugin/server** | not staffOnly by design; needs plugin config plumbing |
| Configured-widget chip re-verify | **plugin lane** | after their deploy settles |
| Split-origin /plugins deploy | **infra** | |
| Campus-hue data contract | **closed by your ruling** — client derives via `--campus-hue` channel | no server change needed |
| `Learning` schedule-grid caption decision | **product** | timetable matrix kept caption-less deliberately |
| Weekday-ribbon dataset assertion | **ui (next touch)** | Sunday-clock MINOR, dataset-honest |
| Remaining tables get `sortable` columns | **ui (next touch)** | API shipped; 3 exemplars done; mechanical rollout |
| `--chart-red-deep` / `--chart-steel` naming | **orchestrator blessing** | disclosed in unit-12 handoff |
| Token count blessing: 116 | **orchestrator blessing** | 104 + 12 |

## Standing risks / honest limits

- Dark palette values are my craft judgment (AA-checked on the probes that run); a designer pass over `dark.css` before broad exposure would be cheap and worth it.
- The multiset computed-style comparator methodology is retired — future units should reuse the pixel-worktree proof directly (documented in `logs/u12-pixel-verdict.txt`).
- Demo-mode theme control works but demo sessions reset on switch; acceptable for the demo surface.

The lane is caught up. Ready for red-team cycle 5 — and now the red team has a *system* to attack, not a pile of screens.
