# SchoolOS visual direction — prompt for a frontend design agent

## Your assignment

Make SchoolOS feel like a thoughtfully designed, premium school workspace: calm, trustworthy, warm and exceptionally easy to scan. Improve the **visual and interaction layer**—colour, typography, spacing, surfaces, navigation chrome, buttons, fields, cards, tables, dialogs, feedback and motion—while preserving existing functionality. A parent on a phone and a teacher rushing between classes should both understand what matters immediately.

Implement the visual improvements in the frontend when given repository write access. Do not interpret this brief as permission to redesign backend workflows or fabricate data. If you have read-only access, return a visual specification and proposed file-level changes instead of editing.

## Scope and constraints

- Work only within `app/src/**`. Do not edit the server, migrations, API contracts, authentication, permissions, integrations, deployment, CI or data fixtures. Do not change what a button does merely to improve how it looks.
- Start with shared tokens, CSS and UI primitives. Apply them to representative high-traffic screens before extending them elsewhere. Avoid a screen-by-screen pile of one-off styles.
- Preserve existing accessible semantics, focus management, honest loading/empty/error states, `SampleNote`, role-aware navigation and permission gates. Never make a disabled or unconnected action appear active.
- Read only the files needed for the current visual task: `app/src/styles/{tokens,base,components,polish,dark,contrast}.css`, `app/src/components/{ui,Shell,DemoBar,motion}.tsx`, and a small sample of actual screens (`Today`, `Attendance`, `Fees`, `parent/FamilyHome`, `student/StudentHome2`). Open additional files only when implementing them. Do not ingest the entire repository or historical audits.
- Keep existing light, dark and high-contrast modes. A visual change is incomplete if it works only in one theme or only at desktop width.

## The feeling to create

**A modern school office with the composure of a well-made banking app and the friendliness of a good classroom.** Clear hierarchy and quiet confidence, not a crowded command centre or generic neon SaaS dashboard. Give the eye an obvious first place to land, a comfortable path through the task, and unmistakable feedback after an action.

Design adjectives: **warm · precise · human · orderly · confident · restrained**.

Avoid: glassmorphism everywhere, gratuitous gradients, loud purple/blue dashboard themes, playful bounces on serious actions, excess cards-within-cards, red for routine reminders, status represented only by colour, decorative charts with no decision attached, tiny grey text and walls of uppercase metadata.

## Colour system — evolve the existing palette

The current light-mode foundation is already strong (`tokens.css`): warm paper `#F7F6F3`, white `#FFFFFF`, ink `#1C1D20`, muted ink `#55575C`, deep teal `#0F766E`, and a restrained violet AI accent `#5D53B8`. **Keep this identity.** Tune contrast and usage rather than swapping the brand.

| Role | Direction | Usage |
|---|---|---|
| Canvas | Warm paper `#F7F6F3`; a slightly deeper warm neutral for grouped areas | Page background; make white surfaces stand out without artificial glow |
| Surface | White or very light warm ivory (`--surface`, `--surface-2`) | Content panels and input areas; avoid tinted backgrounds on every card |
| Border | Subtle warm grey (`--border`), stronger on interactive boundaries | Structure before shadow; a card should not need a heavy shadow to look separate |
| Text | Near-black primary, legible muted secondary | Headings and numbers lead; explanatory text remains comfortably readable |
| Brand action | Deep teal `#0F766E`, darker on hover | One primary task per view; links, focus and selected navigation |
| AI | Restrained iris/violet | Only explicitly AI-labelled actions and explanatory surfaces; never a substitute for the brand accent |
| Status | Green success, amber attention, red critical, blue information | Use for meanings, not decoration; always pair with words/icons |

Use the existing semantic tokens rather than hardcoded screen-specific colours. Preserve dark mode's warm near-black surfaces and lighter teal (`dark.css`) and the high-contrast theme (`contrast.css`). Verify text and controls against their **actual** tinted backgrounds; ordinary text should meet WCAG AA contrast, and focus/critical controls should remain unmistakable. Do not rely on pale teal text on pale teal backgrounds or amber text on white without checking contrast.

**Gradients:** The existing primary-button gradient can remain as an extremely subtle identity touch. Do not spread gradients across every card, chart and banner. The premium effect comes from proportion, typography and care—not gloss.

## Typography and spacing

- Use the existing sans family (`Inter` with system fallback). Make typography feel intentional: page title around 26–30px on desktop and 23–26px on a phone; section titles around 17–20px; body copy around 14–16px; labels and supporting copy readable rather than microscopic. Treat these as **targets to test**, not values to paste into every component.
- Give each view three levels of emphasis: **what this page is → what needs action → supporting detail**. One strong heading, a short useful subtitle and an immediately recognisable next action.
- Reduce the number of 11–12px labels in task-critical areas. Small text is for metadata, never for payment status, a child's attendance or a primary instruction.
- Keep the existing 4px-based spacing scale. Favour consistent 8/12/16/24/32px relationships. Use more air **between groups** than between elements inside a group; do not enlarge all padding indiscriminately.
- Present amounts, dates and counts with stable numeric alignment and India-appropriate formatting. Weight meaningful values over decoration; preserve truthful data and existing formatting helpers.

## Shared components: desired visual treatment

### Buttons and actions

- Establish a visually consistent hierarchy: **primary** teal for the next consequential action, **secondary** outlined for a useful alternative, **tertiary/ghost** for quiet tools, **danger** only for a destructive confirmation. At most one visually dominant primary action per task area.
- Primary buttons should feel solid, not oversized or glossy: clear label, comfortable horizontal padding, modest 8–10px radius, crisp focus ring. On mobile, important actions need a generous tap target (aim for at least 44px); do not squeeze multiple tiny buttons into a fee row.
- Hover is a small contrast/elevation shift; press is a subtle tactile response. Disabled controls need a discernible explanation nearby, not only opacity and a mouse tooltip.
- When an action is busy, preserve button width, show an inline progress indicator and prevent repeat submission. Distinguish **saved**, **queued**, **started**, **confirmed** and **failed** in feedback; visual polish must not make a pending operation look complete.

### Cards and boxes

- Stop treating every fact as an equally prominent bordered box. Use three levels: (1) one focal task panel, (2) simple content cards for grouped information, (3) quiet rows/dividers for details. Prefer fewer, stronger containers over nested cards.
- Standard cards: warm-white surface, subtle border, roughly 10–14px corners, balanced 16–24px padding depending on density. Save stronger elevation for overlays or active focus, not the ordinary dashboard grid.
- An actionable card should clearly indicate *why it is actionable* and its actual action. Keep title, key detail, status and next step in a predictable order. Do not make a whole card appear clickable when only an inner button works.
- Empty boxes should explain what belongs there and what a permitted user can do next. A true zero, a loading result, a permission denial and a failed request must look—and read—different.

### Fields, filters and tables

- Pair each input with a visible label; helper text says what a person needs to know before submitting. Display errors next to the relevant field and keep entered values when a request fails.
- Keep filter bars visually quieter than the records they filter. Give search clear prominence on directory/catalogue screens and make active filters easy to understand and clear.
- Tables work for dense desk tasks on desktop: readable row height, restrained rules, aligned amounts, strong row labels, clear sorting and no icon-only high-stakes action. On a phone, put each record into a labelled, scannable card with the most important amount/status/action visible **without sideways scrolling**. Do not simply hide columns containing important information.
- Treat high-stakes tasks as a guided flow: identify record → confirm detail → take action → explain outcome. For example, the Fees desk should make it visually obvious how to find a student's due and record a payment, without altering payment logic.

### Dialogs, drawers and notifications

- A modal is for a short decision; a drawer is for inspecting detail while retaining page context; use a full page for longer multi-step work. Avoid placing a complicated form in a cramped modal.
- On narrow screens, let overlays use the available height safely, keeping the heading and action footer reachable while the content scrolls. Support the on-screen keyboard, safe-area insets and escape/focus return.
- Destructive actions require a specific, plain-language description of the effect and an obvious Cancel option. Never rely on `window.confirm`, `window.prompt` or `window.alert` if an accessible in-app dialog already exists.
- Toasts should confirm an outcome briefly; errors should retain a visible recovery path rather than disappearing with the toast. Use icons and explicit text as well as colour.

### Navigation chrome

- Calm the sidebar and top bar visually: fewer equally loud links, clear active state, predictable grouping and one obvious place for less-used tools. Don't make the chrome compete with the page's primary task.
- On mobile, keep the bottom bar legible and thumb-reachable. A More destination should open a deliberate, accessible sheet; every option must be reachable for that role. Do not use a transparent decorative bar that reduces readability over busy content.
- Keep the signed-in school's identity clear. Do not surface demo-school names or invented school status as a visual badge.

## Motion: deliberate, quiet and truthful

The project already has `--t-fast: 120ms`, `--t-med: 200ms`, `--t-slow: 320ms`, motion helpers and a `prefers-reduced-motion` override. **Reuse that foundation.** Motion should explain a change of state, not ask to be admired.

| Interaction | Direction |
|---|---|
| Button hover/press | 120–160ms gentle background/border change; at most a 1px-feeling press, never a playful bounce |
| Card focus/hover | 120–180ms quiet border/shadow emphasis only if it is truly interactive |
| Dialog/drawer open | 180–240ms fade/short slide, with focus moving correctly; close no slower than open |
| Tab or filter change | Small fade or direct replacement; avoid animating entire data tables |
| Load | Skeleton that resembles the real layout; subtle shimmer or static in reduced-motion mode |
| Saved/failed action | Immediate readable state or toast; motion does not substitute for confirmation |
| Counters and live indicators | Animate only where the number is truly live and the animation helps comprehension; never imply live telemetry from sample data |

No scroll-jacking, looping pulses on routine work, big parallax or page-by-page entrance choreography. Disable nonessential transforms and shimmer under reduced motion. Motion must not delay attendance marking, fee recording or form recovery.

## Example feel by journey (visual only)

- **Owner Today:** a quiet morning overview. First show the one item needing a decision; then a concise health row and a small number of secondary sections. Clear sources for figures. No crowded wall of equally weighted KPIs.
- **Teacher home + attendance:** current class and **Take attendance** visually dominate; roster rows are generous, marks are distinct by word and shape, and the submit bar stays findable. Fast to scan, no animation that slows a register.
- **Finance Fees:** lead with finding a student or fee due, the amount and a plain **Record payment** path. Keep reconciliation and policy tools visibly secondary. A started payment must look different from a confirmed one.
- **Parent Family/Fees on phone:** one child at a time, a readable today card, fees immediately findable, large easy-to-understand actions. No dense dashboard analytics above a parent's urgent task.
- **Student My Day:** welcoming and clear without cartoon styling. Use familiar words and a few obvious destinations; make homework/results cards legible and calm, including honest unpublished/empty states.

## Working sequence for the agent

1. **Visual baseline:** inspect the scoped design files and a few representative screens. Briefly state what is already working and the three shared visual inconsistencies with the greatest user impact. If browser access is available, compare screenshots at 390px and a desktop width; do not claim a pixel-level issue you have not seen.
2. **Token/primitives pass:** harmonise typography, spacing, button hierarchy, card/drawer/modal treatment, focus and status presentation. Build on current components and variables rather than adding a second design system.
3. **Representative screens:** apply the system to the owner, teacher, finance, parent and student examples above. Preserve API use, role gates, wording accuracy and empty/error behaviour.
4. **Extend thoughtfully:** use the proven shared patterns for other screens only after the first group is coherent. Keep a concise log of deliberate exceptions for desk-specific density.
5. **Verify:** inspect at 390px and desktop; check light, dark and high contrast; keyboard navigation and reduced motion; confirm no horizontal page scroll, unreachable modal actions, hidden critical data or ambiguous payment/attendance feedback. Run frontend type, lint, test and build checks when editing code. Report what was actually verified.

## Acceptance bar

The result should feel premium **because the user knows what to do, can read it comfortably and trusts what they see**. A teacher can finish a register quickly; a parent finds a child's fees from a phone; a finance user knows whether a payment is merely started or truly recorded. Shared components look and behave like one family. Light, dark, high contrast, desktop and mobile all feel intentionally designed. Accessibility and truthful states remain intact.

Deliver a brief before/after summary of the visual system, the screens changed, the decisions made and the checks performed. Do not claim that uninspected screens were redesigned or that backend capabilities were added.
