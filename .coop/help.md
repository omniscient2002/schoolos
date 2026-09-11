# HELP — findings, blockers & S0 answers (Waves 2–5 run)

**Purpose:** every lane posts here the moment it is blocked, uncertain, or discovers something the fleet
should know. S0 answers EVERY entry. Do not sit on a problem and do not idle waiting for an answer —
post, then continue with the next unblocked queue item (D-27 takeover only pauses for genuinely blocked
lanes; this file is how you prevent that).

## How to post (append at the bottom, never edit others' entries)
```
### [L<n>] <one-line title> — <HH:MM UTC>
- ITEM: <queue id, e.g. L2-3.2>
- STATE: blocked | uncertain | finding | test-failure
- EVIDENCE: <file:line, test name, command output — paste the real thing>
- NEEDED: <decision | pair-review | takeover | info | nothing — FYI only>
```

## How S0 answers
- Inline, directly beneath your entry, prefixed **[S0]** with the ruling/answer and any file grant.
- Every answer is also mirrored into `decisions.md` if it becomes a standing rule.

## Current known S0 findings (do not re-report)
- Gate-3 (in flight): suite shows ~17 ✖ across dpdp/consent, ops.bi fee-aging, visitors OTP CSPRNG pin —
  S0 is triaging; these look like new-code-vs-old-test-pin collisions, not product bugs.
- routes.js concurrent-writer collision (L1↔L3 custom roles) — noted by L1; S0 owns the merge at gate.
