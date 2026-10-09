// Shared sibling-table guard (F-18). A sibling plane's tables may be ABSENT (a
// deployment without that plugin/lane) — those reads degrade to empty, never 500.
// Anything else (a wrong column 42703, a bad cast, a timeout) must SURFACE, not
// hide: a silent `.catch(() => ({rows:[]}))` once made every parent result
// silently empty because of a wrong column, and the empty list read as
// "nothing published" instead of "our query is broken".
// Usage: `await c.query(...).catch(pluginAbsent)` — returns { rows: [] } only
// for a missing table/relation.
// Extracted from family.view's local copy so every plane shares one rule.
export function pluginAbsent(e) {
  // 42P01 = undefined_table (plugin off). A wrong COLUMN (42703) must surface.
  if (e?.code === '42P01' || /relation .* does not exist/i.test(String(e))) return { rows: [] };
  throw e;
}
