# Org Roster — AI Employee Bench (as of 2026-09-05)

Standing workforce for the SchoolOS engineering org. **Hiring protocol:** check this
roster first; re-task an existing employee via `send_message` before hiring anyone new.
Hire only for a capability gap no standing charter covers, and re-charter (don't
duplicate) when an existing charter can stretch.

## Standing employees

| Employee | Agent ID (short) | Charter | State |
|----------|------------------|---------|-------|
| **QA-1** (release certification) | `3d1e522d` | Verify-only release certification → `docs/ops/RELEASE-CERT-*.md`. Never fixes code. | standing — last: REL-CERT-001; REL-CERT-002 in flight |
| **REDTEAM-1** (adversarial security) | `e0e6aef9` | Full-stack red team engagements → `docs/red-team/RTR-*.md` with live PoCs. Never fixes code. | standing — last: RTR-001 (Grade D → remediated, see RTR-001-REMEDIATION.md) |
| **DOC-AUDITOR** | `doc-auditor` | Claim-by-claim verification of docs vs code → `docs/ops/DOCS-AUDIT-*.md` | standing — last: DOCS-AUDIT-002 (17✓/5◐/3✗/1prose — all ✗ remediated) |
| **Market Analyst** | research | Standing market analyst: India school-ERP market, pricing, procurement → `docs/research/` | standing |
| **Global SIS Analyst** | research | Standing: global SIS landscape, standards (OneRoster, SIF), interoperability → `docs/research/` | standing |
| **UK/IB Competitive Analyst** | research | Standing: UK & IB-school competitive set, compliance (Ofsted, ISI, IB evidence) → `docs/research/` | standing |
| **Privacy/Regulation Analyst** | research | Standing: DPDP, RTE, POCSO, data-residency → `docs/research/privacy-regulation.md`; feeds tenancy-mode decisions (docs/12 §16) | standing |

## Retired (2026-09-05)

The following duplicate build-agent pairs were identified by the roster audit and
**retired in favor of a single build bench**: job-lifecycle (×2), asset-registry (×2),
preventive/map/intelligence (×2). Their charters were task-shaped, not standing; any
new build work re-tasks the surviving bench via `send_message` with a bounded,
self-contained brief instead of spawning lookalike agents.

## Rules of engagement

1. **Check roster → re-task → only then hire.** Duplicates come from skipping step 1.
2. Charters are **standing with bounded deliverables** (reports into a `docs/` lane),
   not one-shot tasks — re-tasking keeps context and costs less than re-hiring.
3. Verify-only roles (QA-1, REDTEAM-1, DOC-AUDITOR) **never modify product code**.
   Fixes flow through the orchestrator.
4. Sandbox notes for every employee: `/tmp` and scratch dirs are ephemeral between
   calls — keep artifacts inside the workspace; never put `pkill` and a matching
   start string in the same shell command.
