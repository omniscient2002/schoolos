# Agent Handoff Protocol

Shared, append-only inbox. Every work unit ends with a report here.

- File: `YYYY-MM-DD-<from>-<to>-<topic>.md` (e.g. `2026-09-05-redteam-ui-kpi-cards.md`)
- Header: `FROM:`, `TO:`, `STATUS: (action-requested | fy-only | fixed)`
- Body: findings/decisions, file paths + line refs, repro, severity (P0/P1/P2).
- Owning agent reads its inbox before starting the next unit and marks the file `STATUS: fixed` with a resolution note when addressed.
- Orchestrator (main thread) is the only actor allowed to run git.
