FROM: ui-agent
TO: orchestrator
STATUS: done

WHAT CHANGED
- app/src/styles/tokens.css: compat aliases added — --bg-2→--surface-2, --text-1→--text, --surface-1→--surface, --success-text/--warning-text/--danger-text→their semantic bases (unit-2 sweep found 2 undefined refs in components.css and 4 in TSX inline styles; aliases chosen over ~25 scattered edits so the ramp stays single-source).
- app/src/styles/components.css: login surface tokenized — .seg/.login-role/.login-hint code now var(--surface-2) (was --bg-2 with stale hex fallbacks), all --text-1 uses → var(--text), .google-btn off hardcoded #fff/#1f2937/#f9fafb, .login-card shadow → var(--shadow-xl). Character moment: .logo-mark = var(--gradient-accent) + var(--shadow-sm); .seg-btn:focus-visible = var(--focus-ring); .login-form input:focus unified to the same ring + accent border.
- Full re-sweep after fixes: 85 CSS + 58 TSX var() references, ALL resolve against 112 declared tokens. No renames, no removals.

AUDIT
- tsc --noEmit -p tsconfig.app.json: 0 errors. VITE_LIVE_API=1 vite build: success (772ms).
- Preview restarted per pkill law (separate kill/start shells). Playwright audit, attempt 1, TOTAL_ISSUES=0.
- Authed 12/12 clean: 1920/768/390 × today/attention/ask/maintenance (no overflow, 0 clipped stats, 0 tiny-text).
- LOGIN (unauthenticated) 3/3 widths: no overflow, no squished text, focus rings verified by real keyboard walk — email input, Sign in, and seg-btn all show the 2px accent ring (seg reached via Shift+Tab from the form; Tab skips it by Chrome's native tablist behavior).
- Computed-style probes: .logo-mark = linear-gradient(135deg …#0E7568…) + shadow-sm; .login-card = radius 16px + shadow-xl; .seg = rgb(250,249,247) = --surface-2. One env note: a sibling preview cycle died mid-debug (same class as unit 1); restart + audit unaffected.

FOR UNIT 3 (2 suggestions)
- Login.tsx seg tablist has no roving-tabindex/arrow-key handling (Tab skips it by spec; arrows do nothing) — needs tabIndex roving + ArrowLeft/Right in Login.tsx (auth-screen JSX, needs orchestrator sign-off since it borders auth semantics).
- .login-error/.login-devcode hardcode #ef4444/#b91c1c/#f59e0b — map to --danger/--warning status tokens for one consistent error/warning language.
