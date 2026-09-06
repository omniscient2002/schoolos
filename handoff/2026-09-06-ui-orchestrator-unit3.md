FROM: ui-agent
TO: orchestrator
STATUS: done

WHAT CHANGED
1. app/src/screens/Login.tsx — seg tablist a11y (handling/attributes only): roving tabindex (selected tab tabIndex 0, others -1), role="tab" + aria-selected + ids (seg-tab-*), keydown handler ArrowLeft/Right (wrapping), Home/End; selection calls the same setMethod clicks used — no auto-submit, no auth logic, no API/session code. One handling detail: panel inputs carry autoFocus, so a keyboard-only flag (useRef) returns focus to the tab after arrow switches (WAI-ARIA tabs pattern); mouse-click UX unchanged. Visual classes/CSS untouched.
2. app/src/styles/components.css — .login-error → var(--danger) (bg 9% / text / border 25%), .login-devcode → var(--warning) (bg 8% / border 30%); hardcoded #ef4444/#b91c1c/#f59e0b gone.
3. My one pick — motion polish on overlays: .ai-scrim fadeIn 160ms → var(--t-fast) and scrim bg → color-mix(--surface-inverse 18%); .ai-dock shadow color → color-mix(--surface-inverse 28%); .modal-overlay rgba→color-mix 40%; .drawer-overlay rgba→color-mix 32%. Every overlay now animates on the motion scale and colors from tokens (visually near-identical: surface-inverse IS #17181A).

AUDIT (attempt 1, TOTAL_ISSUES=0 — re-run after the display add-on below; final numbers)
- tsc --noEmit: 0 errors. VITE_LIVE_API=1 vite build: success (663ms final). Preview restarted per pkill law (separate shells).
- Seg keyboard walk ×3 widths, all pass: Tab lands on active tab only (roving); ArrowRight → focus=seg-tab-phone AND aria-selected follows AND panel switches to phone (tel input, email gone); focus ring 2px visible on the focused tab; ArrowLeft restores Email; End→Google; Home→Email; url stays /login, no error alert, no busy state — no submit.
- .login-error renders rgb(179,55,46) = --danger (triggered via empty-field client validation only — no API call).
- Authed 15/15 clean: 1920/768/390 × today/attention/ask/maintenance/plugins — no overflow, 0 clipped stats, 0 tiny-text.
- Built-CSS check: zero `160ms` remaining; overlays on --t-fast/--surface-inverse.

DISPLAY ADD-ON (folded into unit 3): four new production plugins
- app/src/plugins/pluginRegistry.ts — added comms.whatsapp (B, WhatsApp Business Rails), payments.upi (B, UPI Collection Rails), transport.gps (B, Transport GPS Rail), ops.timetable (C, Timetable Primitives) mirroring server/src/plugins/*/index.js manifests (permissions/slots/descriptions); all headless rails → slots ['settings','reports'], no routes, defaultEnabled=false mirroring server rows landing as 'registered'. Icons: Message/CreditCard/Compass/Grid (all pre-existing exports).
- app/src/plugins/useKernel.tsx — the existing /plugins resync now also surfaces the server's `configured` flag per row (redteam P1-2: non-privileged roles get configured:<bool> instead of settings values). Exposed as `configured` on the kernel context.
- app/src/screens/Plugins.tsx — subtle "configured" chip (u-xs + Icon.Check, title explains values stay owner/IT-admin-only) on cards whose server row says configured. No settings values are ever rendered. Card anatomy identical to existing cards (same card, class badge, enable Button) — no class-C special-casing needed; enablement state comes only from the server's `enabled` flag via kernel resync (never hardcoded).
- Audit proof (mocked /plugins row contract per docs/12 §4): 4/4 new cards render; configured chips = exactly 2 (whatsapp+upi per fixture); transport.gps shows Disable with fixture enabled=true despite defaultEnabled=false (server flag wins); comms.whatsapp shows Enable with enabled=false. /plugins included in audit widths, 0 issues.

FOR UNIT 4
- .seg-tabs (attendance mark buttons) share the .seg class name but are a different control — rename risk-free later; also .demo-bar .dot #F5A623 and .toast.success/#123B26 / .toast.error/#4A1610 remain the last hardcoded hues in components.css — map to --warning/--status-success/--status-critical mixes.
