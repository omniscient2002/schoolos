# PLAN-V2 — Waves 2–5 Continuous Run (48h target)

**Directive (owner):** run without stopping until all phases are achieved or T+46h, whichever first. No
human-in-loop except two irreducible externals (live provider credentials, external staging infra) — S0
builds everything else code-complete and self-verifies.

## Run architecture (differs from Wave 1)
1. **Queued briefs:** each lane has a QUEUE — `.coop/queue/L<n>.md` — containing its Wave 2→3→4→5 tasks in
   priority order. Workers never stop after one task: finish item → journal DONE → next item immediately.
2. **Session mortality handled by takeover:** a lane silent for 90 min (no journal line, no file changes)
   is declared dead by S0 (standing order D-27) and S0 executes that queue directly. No lane is ever a
   blocker; no work waits for a human.
3. **S0 is executor-of-last-resort AND integrator:** all commits, pushes, gates (every 4h), conflicts,
   rulings. Workers never run the shared test DB (D-10 still applies).
4. **Priority order is strict:** P2 (Wave 2) → P3 (Wave 3) → P4 (Wave 4) → P5 (Wave 5). Within a lane,
   never skip ahead past an unfinished P2 item.
5. **STOP:** S0 posts `RUN-STOP` in decisions.md at T+46h → all workers halt → S0 runs final regression →
   delivers `STILL NOT GOOD_3.md` with re-grades.

## 48h scope ruling (D-26) — what "done" means at T+46
- **Committed:** Wave 2 complete; Wave 3 code-complete (rails/MFA/httpOnly/PITR tooling/scheduler/retention/
  DPDP completion); Wave 4 majority (migration engine, payments loop, exam depth, timetable clashes).
- **Built-but-unverifiable without owner credentials** (honest status, not failures): live SMS/WhatsApp/SMTP
  sends, external staging. Code ships with sandbox adapters + settings + 503 semantics + tests.
- **Explicitly out (T+46 halt):** Wave 5 remainder → recorded as the post-48h backlog.
- **Honest projection:** ~82/100 · ~70/100 readiness. 90+ requires live-credential verification + DR drill
  + load-test results — the irreducibly external tail.

## Owner actions already removed from the critical path by S0
- Secrets rotation: S0 executes in-repo (server/.env) this run. Provider accounts (SMS/BSP/SMTP) remain the
  only true human dependency — all code is written to light up the moment credentials exist.

## Gates
T+4h, T+8h, … T+44h: full server suite + app build + per-lane diff review + commits + push + rulings.
Final gate T+46h: freeze, full regression, parity gate, re-grade, `STILL NOT GOOD_3.md`.
