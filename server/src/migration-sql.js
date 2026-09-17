// DATX-6 (PERFECT-100 §9.2) — strip TOP-LEVEL BEGIN;/COMMIT; from a migration file before the runner wraps
// it in its own transaction.
//
// Eight files (031, 034-040) contain a top-level `BEGIN; … COMMIT;`. The runner already wraps each file in
// BEGIN/COMMIT to make it atomic and roll back on failure, so the file's own COMMIT closes the runner's
// transaction EARLY — the `INSERT INTO app.schema_migrations` (and anything after the COMMIT) then runs
// outside it, and a later failure can no longer roll the file back. Editing an applied migration is
// forbidden (checksum drift), so the runner strips them instead.
//
// The stripper is dollar-quote/string/comment aware: PL/pgSQL bodies use `BEGIN … END` INSIDE `$$ … $$`,
// and a naive regex would corrupt them. Only a `BEGIN;`/`COMMIT;` seen at the top level (outside any string,
// dollar-quoted block, or comment) is removed.

export function stripTopLevelTransactions(sql) {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    // line comment — copy verbatim
    if (c === '-' && sql[i + 1] === '-') {
      const j = sql.indexOf('\n', i);
      const end = j === -1 ? n : j + 1;
      out += sql.slice(i, end); i = end; continue;
    }
    // block comment
    if (c === '/' && sql[i + 1] === '*') {
      const j = sql.indexOf('*/', i + 2);
      const end = j === -1 ? n : j + 2;
      out += sql.slice(i, end); i = end; continue;
    }
    // single-quoted string (handles '' escapes)
    if (c === "'") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") { j++; break; }
        j++;
      }
      out += sql.slice(i, j); i = j; continue;
    }
    // dollar-quoted block ($tag$ … $tag$)
    if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const j = sql.indexOf(tag, i + tag.length);
        const end = j === -1 ? n : j + tag.length;
        out += sql.slice(i, end); i = end; continue;
      }
    }
    // top-level BEGIN;/COMMIT; — replace with whitespace of the same length so line numbers stay readable
    const mm = /^(?:BEGIN|COMMIT)\s*;/i.exec(sql.slice(i));
    if (mm) { out += ' '.repeat(mm[0].length); i += mm[0].length; continue; }
    out += c; i++;
  }
  return out;
}
