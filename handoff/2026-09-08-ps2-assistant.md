PS-2 progress log
migration 035_parent_assistant.sql written (tables copilot_call+brief_log, RLS+grants, registry row parent.assistant class C, contracts parent.brief.v1+parent.copilot.v1, guarded ledger record_ref parent-assistant@1, idempotent)
manifest.js written (mirrors migration 035 registry row: id parent.assistant, class C, T1, contracts parent.brief.v1/parent.copilot.v1, deterministic-only invariants)
index.js written (4 doors: GET /parent/brief, POST /parent/copilot/ask, POST /parent/copilot/draft, GET /parent/explain/:topic — guardian-only, lifecycle-gated, deterministic, P-copilot 100/month, own-child scoping)
tests/parent-assistant.test.js written (9 pins: brief shape+banned-words scan, bad when 400, ask hits real family.request data via POST /parent/requests, all intents+honest unknown, ai_draft labels, explain topics, budget 429 at 100/month, cross-guardian 403, teacher 403)
verify: 9/9 pass, 0 fail (node --test tests/parent-assistant.test.js, fresh schoolos_test) · migration 035 idempotent x2 (2nd pass 0 rows; 1 ledger row parent-assistant@1, 1 registry row, 2 contracts, parent.copilot_call + parent.brief_log with RLS+grants) · PS-2 complete
