FROM: redteam
TO: orchestrator
STATUS: action-requested
DATE: 2026-09-06
CYCLE: 5 — plugin-agent surface brief executed (pack.dpdp 023, admissions v1.1, UPI regression, lifecycle doors, IST hunt) + carry-over P2s
METHOD: live black-box with real role tokens; stack traces corroborated read-only from `server/logs/api.log`. Full evidence + clean-list in the companion report: `handoff/2026-09-06-redteam-cycle5-dpdp-admissions.md`.

## Headline
**SoD architecture held everywhere — every net the brief asked me to test refused under direct attack.** But the *system* around those nets has a **P1 that breaks both DPDP SARs and admissions enrollment on their second use**: kernel-approval actions carry a static `code` against `UNIQUE (tenant_id, code)`, so the second SAR/enrollment of a lifetime hits `23505` → 500. Plus a lead-capture race 500, an erasure normalization gap (spaced-vs-compact phone survives erasure — proven live), and an `admissionYear` body bypass. **Verdict: FIX-FIRST** (one systemic P1; everything else P2).

## The P1 (systemic, two modules, one root cause)
`app.actions` code is static per workflow (`dpdp.dsr.export`, `dpdp.dsr.erasure`, `students.create`) while the table enforces `UNIQUE (tenant_id, code)`:
- 2nd erasure SAR ever → 500 (`pack.dpdp/index.js:91`, log: 23505) — DPDP workflow dead for every future subject;
- 2nd export SAR, different subject → 500 (repro'd);
- 2nd offer→enrolled ever → 500 (`admissions.funnel/index.js:129`) — enrollment permanently blocked; my offer→enrolled walk hit it live.
Half-created state leaks on the crash path (SAR row exists, action_id NULL). **Fix:** suffix codes with the workflow instance (`dpdp.dsr.${kind}.${sarId}`, `students.create.${leadId}`) + regression tests for the *second* raise. Full repro chain in the plugin report.

## P2s (details + repros in the companion report)
- **Erasure normalization gap:** consent recorded as `+91 98000 55001` survives an approved erasure raised as `+919800055001` (exact-match `subject_ref`); `consent/state` still shows the spaced artifact `granted` post-erasure. The 023 comment says "normalized" — nothing is. Fix: E.164-normalize at the door + one-shot data normalization. (Live artifact exists on this box; leave it for the fix verification.)
- **Lead-capture race:** concurrent same-phone POSTs → one 200, one raw 23505/500 — no DB unique backstop behind the check-then-insert guard.
- **`admissionYear` body bypass:** `"1999-00"` accepted → new enquiry for the same (phone,class) outside dedupe and cycle semantics; no format validation.
- **`/actions/:id/decide` non-uuid `:id` → 500** (no uuid guard; `/events/lineage` is the in-repo precedent).
- **IST drift candidate (same class as your timetable fix):** `admissions.funnel` `currentSessionYear()`/`mmdd()` use `getUTC*` (`index.js:27-32`) — 5.5h divergence windows at IST boundaries (e.g. IST Apr 1 00:00–05:30 computes the previous session year). No live impact today (cycle settings unset), but same species as the timetable production bug — normalize with the `+5.5h` pattern from `ops.timetable/index.js:43`.

## What held (attacked, clean — the full list is in the companion report)
- **DPDP SoD, all nets:** pre-approval execute 409; bundle pre-fulfilment 409; duplicate open SAR 409; proposer-net 403 **even against the owner**; coordinator self-approval 403 (kernel); finance on principal-owned action 403; double-erasure 409; parent/teacher/finance 403 on all doors; parent bundle 403.
- **Expiry forgery:** body-supplied `validUntil` ignored; stamping is settings-driven with clamped numeric interpolation — injection-safe.
- **Column-scoped UPDATE grant:** no counter-example via any door; ledger decision/timestamps unreachable by the app role.
- **UPI regression:** future ts (+1h) → **400 "outside ±15 min window"** (your cycle-4 P2 fix verified); raw-bytes MAC discriminator still discriminates (wire 200 / re-serialized 401); replay 1/1/1.
- **Lifecycle doors:** disable → instant 409 on a warm connection (no cache); finance cannot enable; itadmin can (owner+itadmin is current code — flag if you want owner-only).
- **Admissions guardrails:** dedupe 409 (sequential), stage lattice enforced, terminal immutable, teacher PII masking (no full-phone leak), homoglyph phones 400, decide replay 409.

## Carry-over P2s — re-confirmed open (as accepted)
Per-account throttle absent (5×401 → valid 200); token revocation absent (`/me` 200 post-logout); localStorage persistence (code unchanged since the cycle-3 live repro); CORS wildcard (allow-credentials absent).

## Residue (zz.redteam5.*, itemized for migration 024 — full list in the plugin report)
`plugin_dpdp.consent` ×2 (incl. the spaced-phone artifact that survived erasure — **keep it for fix verification**), 1 fulfilled + 1+ orphan open SAR rows (action_id NULL), `app.actions` ×2 approved, `plugin_admissions.lead` ×3 + stage_history, `app.payments` ×1 initiated + 2 webhook_log rows + events/audit, pack.dpdp enable/disable audit pairs. Scope held: read-only code, no git, no kills/restarts, all writes via public API.

## Verdict
**FIX-FIRST** — the SoD/lifecycle/UPI layers are demo-ready and the plugin agent's brief was accurate; the static action-code design is the one systemic defect standing between you and SHIP. After its fix + the normalization pass, this surface should be clean.
