## What and why

<!-- One or two sentences: what changed, and the problem it closes. Link the issue. -->

## Surface

<!-- Tick every area this touches. -->

- [ ] Server routes / doors
- [ ] Plugins / manifests
- [ ] Migrations / RLS
- [ ] Frontend screens
- [ ] Docs / verification
- [ ] Ops / CI

## Verification

<!-- The repository's closure law: never mark work done without pin/mutation evidence. -->

- [ ] `cd server && npm test` (state the result: N tests, N pass, N fail, N cancelled)
- [ ] `cd server && node scripts/check.js`
- [ ] `cd app && npm run build` (tsc + vite)
- [ ] `cd app && npm test`
- [ ] New/changed behaviour is pinned by a test (name it)

## Honesty checks

- [ ] No fabricated data presented as the school's own record (or it carries `SampleNote`).
- [ ] No secrets, tokens or `.env` values committed.
- [ ] Any deferred work is named in `docs/INCOMPLETE-AND-PARTIAL-FIXES.md`, not left silent.
