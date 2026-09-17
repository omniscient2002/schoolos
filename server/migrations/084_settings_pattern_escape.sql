-- 084 · settings-pattern over-escaping — make the stored regex patterns able to match a real value.
-- Claimed via .coop/help.md. Arises from SEC-6: `validateSettingsAgainstSchema` is now enforced on the
-- PERSISTING settings door (`POST /plugins/:id/settings`), where it had only ever run on the non-persisting
-- preview door (`/settings-form/validate`). This is the first migration whose reason for existing is that
-- validation started working.
--
-- THE DEFECT. Migration 022 writes the admissions.funnel settingsSchema as JSON-inside-SQL with four
-- backslashes. SQL leaves `\\` as `\\` and JSON unescaping turns `\\` into a single backslash, so a reader
-- expects the stored pattern to be `^\d{4}-\d{2}$` — "four digits, dash, two digits". MEASURED (not inferred)
-- on a freshly seeded database, it is not:
--   length(stored) = 15                       -- the single-backslash form is 13
--   replace(stored, chr(92), '#') = '^##d{2}-##d{2}$'
--   new RegExp('12-01') with that pattern      -> false
-- Two backslashes mean the pattern matches a LITERAL BACKSLASH followed by the letter `d`. It cannot match
-- `2026-27`, `12-01`, or any real value. The three affected keys are `admission_year`, `cycle_start` and
-- `cycle_end` — the session year stamped on every captured lead, and the window that decides whether
-- admissions are open (admissions.funnel/index.js:79-89).
--
-- WHY IT WAS INVISIBLE. The settings door persisted `req.body` verbatim and never consulted the schema, so a
-- school's payload was stored whether or not it satisfied the manifest. The schema's patterns were decoration.
-- The moment SEC-6 wired validation into the persisting door, the plugin began REJECTING ITS OWN VALID
-- SETTINGS: the admissions session window became unconfigurable, which is a worse failure than the one being
-- fixed. Fixing the escaping is what makes SEC-6 safe to turn on, which is why this migration is part of SEC-6
-- rather than follow-up work.
--
-- WHY THE FILE MANIFEST IS NOT ENOUGH. `src/plugins/admissions.funnel/manifest.js` is the canonical module
-- definition and now declares these three keys with correct patterns — that edit is necessary, and it is what
-- a tenant gets at onboarding (`ensurePluginCatalog`, onboarding.js:101) or plugin registration
-- (routes.js:1828). But that function does NOT run at boot, so an existing tenant keeps its registry row as
-- written by the DDL. The seeded `meridian` tenant in every test database is exactly that case: measured, its
-- row still carries the 15-character pattern. Both halves are required; neither alone is sufficient. I deleted
-- an earlier version of this file believing the manifest alone sufficed, and fresh databases kept failing.
--
-- ON THE ESCAPING OF THIS FILE. Every backslash below is `chr(92)`, never a string literal. Writing `'\\'` and
-- reasoning about which of SQL's, JSON's or psql's escaping layers consumes it is precisely how the original
-- defect was introduced, and I got it wrong twice while writing this migration. With `chr(92)` there is no
-- escaping left to misread: the character code IS the character.
--
-- SAFE ON A FRESH DATABASE. `app.plugins` is EMPTY during migrations — `scripts/seed.js` populates it, and seed
-- runs AFTER migrate — so verification is conditional on rows existing and inspects only the rows it finds. An
-- earlier version asserted a row must be present, aborted on every fresh database, and took the entire
-- admissions suite down through its `before` hook.
--
-- Idempotent: the repair matches only the doubled form, so a second run changes nothing.

DO $$
DECLARE
  bs text := chr(92);          -- one backslash, with no escaping to get wrong
  fixed integer := 0;
BEGIN
  /* Repair by HALVING the run of backslashes rather than substituting a pattern I typed, so a future schema
   * gaining a `\s` or `\w` is repaired by this same statement instead of needing its own migration. */
  UPDATE app.plugins p
     SET manifest = jsonb_set(
           manifest,
           '{settingsSchema,properties}',
           (
             SELECT jsonb_object_agg(
                      kv.key,
                      CASE
                        WHEN strpos(translate(kv.value->>'pattern', bs, '#'), '##') > 0
                          THEN jsonb_set(kv.value, '{pattern}',
                                         to_jsonb(replace(kv.value->>'pattern', bs || bs, bs)))
                        ELSE kv.value
                      END)
               FROM jsonb_each(p.manifest->'settingsSchema'->'properties') AS kv
           )
         ),
         updated_at = now()
   WHERE p.manifest->'settingsSchema'->'properties' IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM jsonb_each(p.manifest->'settingsSchema'->'properties') AS kv
        WHERE strpos(translate(kv.value->>'pattern', bs, '#'), '##') > 0);
  GET DIAGNOSTICS fixed = ROW_COUNT;
  RAISE NOTICE '084: repaired over-escaped settings patterns on % plugin row(s)', fixed;
END $$;

-- VERIFY, in the same transaction. Both checks are the kind that would have caught the original defect, and a
-- migration leaving a silently-unmatchable pattern in the database must FAIL rather than warn.
DO $$
DECLARE
  bs text := chr(92);
  bad integer;
  live integer;
BEGIN
  -- (1) No stored pattern may still carry a doubled backslash.
  SELECT count(*) INTO bad
    FROM app.plugins p
    CROSS JOIN LATERAL jsonb_each(p.manifest->'settingsSchema'->'properties') AS kv
   WHERE strpos(translate(kv.value->>'pattern', bs, '#'), '##') > 0;
  IF bad > 0 THEN
    RAISE EXCEPTION '084: % settings pattern(s) still carry a doubled backslash after repair', bad;
  END IF;

  -- (2) POSITIVE CONTROL, on whatever rows exist. A check that only asserted "not doubled" would pass on an
  --     empty or absent pattern, so this proves the repaired pattern both ACCEPTS a valid value and REJECTS a
  --     malformed one. Skipped cleanly when no such row exists (fresh database, migrate before seed).
  SELECT count(*) INTO live
    FROM app.plugins p
    CROSS JOIN LATERAL jsonb_each(p.manifest->'settingsSchema'->'properties') AS kv
   WHERE p.plugin_id = 'admissions.funnel' AND kv.key = 'cycle_start' AND kv.value->>'pattern' IS NOT NULL;

  IF live > 0 THEN
    PERFORM 1 FROM app.plugins p
      CROSS JOIN LATERAL jsonb_each(p.manifest->'settingsSchema'->'properties') AS kv
     WHERE p.plugin_id = 'admissions.funnel' AND kv.key = 'cycle_start'
       AND NOT ('12-01' ~ (kv.value->>'pattern'));
    IF FOUND THEN
      RAISE EXCEPTION '084: cycle_start pattern does not accept a valid MM-DD value';
    END IF;

    PERFORM 1 FROM app.plugins p
      CROSS JOIN LATERAL jsonb_each(p.manifest->'settingsSchema'->'properties') AS kv
     WHERE p.plugin_id = 'admissions.funnel' AND kv.key = 'cycle_start'
       AND ('nonsense' ~ (kv.value->>'pattern'));
    IF FOUND THEN
      RAISE EXCEPTION '084: cycle_start pattern accepts a malformed value — it is not discriminating';
    END IF;
  ELSE
    RAISE NOTICE '084: no admissions.funnel settings pattern on this database yet (migrate ran before seed) — '
                 'the repair will apply when the row appears, and validateSettingsAgainstSchema will enforce it';
  END IF;
END $$;
