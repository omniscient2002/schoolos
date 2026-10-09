-- 139_action_substitution_kind.sql — L6 (TODO_FIX_MAP): the leave-cover substitution proposal.
--
-- An approved staff leave raises a coordinator-owned substitution PROPOSAL so the cover decision
-- has a desk (the coord SubstitutionReview screen filters `kind === 'substitution'`). The original
-- app.actions kind CHECK (001) predates that screen and rejects the value, so the proposal insert
-- aborted the decide transaction. Widen the vocabulary; every existing value is preserved.
-- Idempotent (DROP CONSTRAINT IF EXISTS before ADD), so a replay is safe.

ALTER TABLE app.actions DROP CONSTRAINT IF EXISTS actions_kind_check;
ALTER TABLE app.actions
  ADD CONSTRAINT actions_kind_check
  CHECK (kind IN ('approval', 'incident', 'case', 'exception', 'recommendation', 'reminder', 'substitution'));
