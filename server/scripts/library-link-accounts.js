#!/usr/bin/env node
// LMS-16 · link student USER accounts to their roster STUDENT row (app.student_accounts).
//
// WHY THIS EXISTS. Library notifications and "my loans" resolve a student's identity through
// app.student_accounts; when no link exists the plugin falls back to the 034/036 name-match pin, which is
// fragile (two children can share a name). This tool creates the stable links deliberately, with a guard
// that refuses ambiguity — it NEVER auto-links a name that matches more than one student, because a wrong
// link would show one child's loans to another.
//
// USAGE
//   node scripts/library-link-accounts.js            # dry run: report what WOULD be linked
//   node scripts/library-link-accounts.js --apply    # write the links
//
// It is idempotent: a user already linked, or a student already linked, is skipped. It only ever links
// users whose role is 'student' (a staff account is never linked to a roster child).
import pg from 'pg';
import { config } from '../src/config.js';

const APPLY = process.argv.includes('--apply');
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2 });
const line = (kind, data) => console.log(JSON.stringify({ kind, ...data }));

async function main() {
  const tenants = (await pool.query(`SELECT id FROM app.tenants`)).rows;
  let candidates = 0, linked = 0, ambiguous = 0, already = 0;
  for (const { id: tenantId } of tenants) {
    const users = (await pool.query(
      `SELECT u.id, u.name FROM app.users u
        WHERE u.tenant_id=$1 AND u.role='student' AND u.active
          AND NOT EXISTS (SELECT 1 FROM app.student_accounts sa WHERE sa.tenant_id=u.tenant_id AND sa.user_id=u.id)`,
      [tenantId])).rows;
    for (const u of users) {
      const matches = (await pool.query(
        `SELECT s.id FROM app.students s
          WHERE s.tenant_id=$1 AND s.status='active' AND lower(s.name)=lower($2)
            AND NOT EXISTS (SELECT 1 FROM app.student_accounts sa WHERE sa.tenant_id=s.tenant_id AND sa.student_id=s.id)`,
        [tenantId, u.name])).rows;
      if (matches.length === 0) continue;
      if (matches.length > 1) { ambiguous++; line('library.link.ambiguous', { tenantId, user: u.name, matches: matches.length }); continue; }
      candidates++;
      if (APPLY) {
        await pool.query(
          `INSERT INTO app.student_accounts (tenant_id, student_id, user_id) VALUES ($1,$2,$3)
           ON CONFLICT DO NOTHING`, [tenantId, matches[0].id, u.id]);
        linked++;
      }
    }
    already += (await pool.query(`SELECT count(*)::int n FROM app.student_accounts WHERE tenant_id=$1`, [tenantId])).rows[0].n;
  }
  line(APPLY ? 'library.link.applied' : 'library.link.dryrun', { candidates, linked, ambiguous, existingLinks: already });
  if (!APPLY) console.log('dry run — re-run with --apply to write the links');
  await pool.end();
}

main().catch(async (e) => { console.error('library-link-accounts failed:', e.message); await pool.end().catch(() => {}); process.exit(1); });
