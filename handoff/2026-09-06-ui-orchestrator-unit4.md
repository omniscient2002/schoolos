FROM: ui-agent
TO: orchestrator
STATUS: done

CORRECTION ACKNOWLEDGED — but the cards already exist: your view predates commit 6ab192d ("UI unit 3 add-on: 4 wave-1 plugin cards from server truth + configured chip"), which landed the four wave-1 plugins (registry ids comms.whatsapp/payments.upi/transport.gps/ops.timetable) before unit 3 closed. Unit 4 therefore verified them against REAL server truth (unit 3 used a mocked row contract) and improved the configured signal. No duplicate cards were added.

WHAT CHANGED (unit 4)
1. app/src/plugins/useKernel.tsx — kernel resync fetch now targets the API origin explicitly (VITE_API_BASE ?? 127.0.0.1:8080): the old RELATIVE fetch('/plugins') silently no-oped whenever the UI origin ≠ API origin (preview served at :4310, API at :8080) — server truth never arrived. This is the load-bearing fix that makes "cards from server truth" actually true outside vite dev. Also: `configured` now derives from settings-key presence for privileged rows (owner/IT get raw settings; we count keys only, values are never surfaced or rendered).
2. app/src/screens/Plugins.tsx — no structural change needed: the wave-1 cards render through the existing anatomy (same card, class badge, enable Button, slots line) from `all` + kernel `enabled`.
3. Rename, sweep-proven safe and corrective: grep showed Attendance.tsx mark buttons used bare className="seg" inside .seg-tabs, so Login's `.seg { display:grid; 1fr 1fr 1fr; gap; margin-bottom:14px; radius }` bled onto every mark button — measured BEFORE: display:grid, 3 phantom 43px columns, mb 14px. Renamed .seg-tabs children to .seg-tab (Attendance.tsx one line + 4 CSS selectors; Login .seg/.seg-btn untouched; only other 'seg' match is unrelated .segbar). AFTER: display:block, mb 0px — bleed gone.
4. Last hardcoded hues tokenized: .demo-bar .dot #F5A623 → color-mix(--status-warning 70%, --surface); .toast.success #123B26 → color-mix(--status-success 22%, --surface-inverse); .toast.error #4A1610 → color-mix(--status-critical 25%, --surface-inverse).

AUDIT (attempt 1, TOTAL_ISSUES=0, all real-server, no mocks)
- tsc 0 errors; VITE_LIVE_API=1 build success (757ms); preview restarted per pkill law (separate shells).
- Live GET /plugins (principal): 13 server rows — spine ../../kernel, com.rtprobe.test, the 4 wave-1 (all enabled=true), library/maintenance enabled, tally/packs registered, 3 zz.redteam rows disabled. `configured` absent from rows today → chip shows only via the new settings-key derivation (principal IS privileged): exactly 1 chip rendered, zero settings keys leaked to DOM (asserted against bsp_provider/dlt_entity_id/sender_id).
- /plugins REAL assertions: 8 cards render (4 first-party + 4 wave-1; spine/packs/redteam correctly have no frontend cards), all four wave-1 buttons read "Disable" matching server enabled=true — enablement provably not hardcoded. `exams` exists in the frontend registry but has no server row — kernel mirror (keeps localStorage enablement for registry-known ids) handles it; flagged as a server-catalog follow-up, not a UI bug.
- 15/15 width×route checks clean (1920/768/390 × today/attention/ask/maintenance/plugins): no overflow despite long rail descriptions, 0 clipped stats, 0 tiny-text. Attendance seg-tab probe: block/0px. Login seg regression (arrows switch, no submit) re-verified at 1920.

FOR UNIT 5
- Error toasts: .toast-stack is aria-live="polite" for all tones — errors should announce assertively (role="alert" on .toast.error or split live regions) in ui.tsx ToastProvider.
- Owner-vs-principal /plugins divergence test (privileged rows carry settings; assert chip logic both ways) and an exams server-row follow-up with the plugin-agent.
