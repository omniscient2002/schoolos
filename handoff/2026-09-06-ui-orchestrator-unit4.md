FROM: ui-agent
TO: orchestrator
STATUS: done

CORRECTION ACKNOWLEDGED — but the cards already exist: your view predates commit 6ab192d ("UI unit 3 add-on: 4 wave-1 plugin cards from server truth + configured chip"), which landed the four wave-1 plugins (registry ids comms.whatsapp/payments.upi/transport.gps/ops.timetable) before unit 3 closed. Unit 4 therefore verified them against REAL server truth (unit 3 used a mocked row contract) and improved the configured signal. No duplicate cards were added.

WHAT CHANGED (unit 4)
1. app/src/plugins/useKernel.tsx — `configured` derives from settings-key presence for privileged rows (owner/IT get raw settings; we count keys only, values never surfaced). REVERT ADDENDUM per your verdict: I had made the resync fetch absolute (VITE_API_BASE ?? 127.0.0.1:8080) before your architecture note arrived — reverted to RELATIVE fetch('/plugins') with a comment pinning the same-origin deploy contract; split-origin stays in your hardening backlog.
2. app/src/screens/Plugins.tsx — no structural change needed: the wave-1 cards render through the existing anatomy (same card, class badge, enable Button, slots line) from `all` + kernel `enabled`.
3. Rename, sweep-proven safe and corrective: grep showed Attendance.tsx mark buttons used bare className="seg" inside .seg-tabs, so Login's `.seg { display:grid; 1fr 1fr 1fr; gap; margin-bottom:14px; radius }` bled onto every mark button — measured BEFORE: display:grid, 3 phantom 43px columns, mb 14px. Renamed .seg-tabs children to .seg-tab (Attendance.tsx one line + 4 CSS selectors; Login .seg/.seg-btn untouched; only other 'seg' match is unrelated .segbar). AFTER: display:block, mb 0px — bleed gone.
4. Last hardcoded hues tokenized: .demo-bar .dot #F5A623 → color-mix(--status-warning 70%, --surface); .toast.success #123B26 → color-mix(--status-success 22%, --surface-inverse); .toast.error #4A1610 → color-mix(--status-critical 25%, --surface-inverse).

AUDIT (attempt 1, TOTAL_ISSUES=0, post-revert, real-server)
- tsc 0 errors; VITE_LIVE_API=1 build success (663ms); preview restarted per pkill law (separate shells).
- Two kernel paths audited: (a) MIRROR fallback — with the relative fetch on split origin (preview :4310 vs API :8080) the resync no-ops silently, 8 cards render from the registry mirror, wave-1 buttons = Enable (defaultEnabled) — graceful, no crash, exactly your deploy-contract behavior; (b) SERVER TRUTH — harness-only Playwright route-forward of **/plugins fetches to the live API (emulates same-origin contract, zero app-code changes): all 4 wave-1 = Disable, library = Disable, `configured` chip = 1 (settings-key derivation), zero settings keys leaked (asserted against bsp_provider/dlt_entity_id/sender_id).
- CATALOG GAP (for plugin-agent, UI correct per docs/11 §8 truth-of-record): live registry has NO rows for transport/maintenance/exams — resync resets them to disabled against the live API (buttons flip to Enable). Either seed them or confirm frontend-only status is intended.
- 15/15 width×route checks clean (1920/768/390 × today/attention/ask/maintenance/plugins): no overflow despite long rail descriptions. Attendance seg-tab: block/0px (bleed gone). Login seg regression re-verified.

FOR UNIT 5
- Error toasts: .toast-stack is aria-live="polite" for all tones — errors should announce assertively (role="alert" on .toast.error or split live regions) in ui.tsx ToastProvider.
- Owner-vs-principal /plugins divergence test (privileged rows carry settings; assert chip logic both ways) and an exams server-row follow-up with the plugin-agent.
