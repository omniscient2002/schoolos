/* DAT-2 — the reference columns that anchor a student, a user or a guardian are constrained by the schema.
 *
 * The register (P0) says 40 FK-less reference columns exist and that this is *why* DPDP erasure is
 * incomplete, proposing `ON DELETE CASCADE` for derived rows and `RESTRICT` for ledgers. Investigation
 * showed all three parts of that row are wrong, and the corrections are the substance of this file:
 *
 *   1. The count is 86 (78 `uuid`, 8 `text`), not 40. Six narrower definitions give 69/57/54/65/58 — none is
 *      40, so the number was not derived from anything.
 *   2. **The proposed mechanism cannot fire.** `ON DELETE CASCADE` needs somebody to delete the parent, and
 *      nothing in this codebase ever deletes a student or a user: there is no `DELETE FROM app.students`
 *      anywhere, and `app.students.status` is CHECK-constrained to `active|alumni|transferred` (all 375 live
 *      students are `active`). Erasure here is redaction, not deletion.
 *   3. The columns that survive an erasure are on the PARENT (`app.students.name`, `guardian_name`,
 *      `guardian_phone`), which no child-side `ON DELETE` can reach. When this file was written the existing
 *      suite conceded that gap at tests/l2-dpdp-erasure.test.js:119 — "office-lane surfaces untouched …
 *      documented gap". CORRECTION 2026-09-14 (DAT-16, owner decision): the two GUARDIAN columns on the parent
 *      are now erased by the DPDP pack's office-lane extension (it requests the kernel-executed core-lane
 *      action `students.redactGuardianPii`, src/core-lane-actions.js), and that assertion is now the opposite
 *      one. What deliberately remains outside erasure is `app.students.name`: the erasure is scoped to a data
 *      principal identified by a GUARDIAN PHONE, and the pupil's own name is a different data principal.
 *
 * So what migration 082 fixes is the part that IS a live P0: a row in tenant A could point at tenant B's
 * pupil or teacher, and RLS then hid that row from BOTH schools rather than the database refusing it. The
 * erasure gap is real but it is a different defect (DAT-16) needing a product decision about the office lane.
 *
 * GOING GREEN HERE MEANS BEING ABLE TO ACCOUNT FOR EVERY FK-LESS COLUMN, not merely constraining some. That
 * is the design of the last test: it enumerates the census and requires each entry to be EITHER constrained
 * by 082 or named on a reviewed allowlist WITH A REASON. A column added next month with the old habit fails,
 * and so does silently deleting an allowlist entry to make the suite pass.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setupTestDb } from './helpers.js';

const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION = join(SERVER_ROOT, 'migrations', '082_reference_integrity.sql');

let sql;
const A = 'aaaaaaaa-1111-1111-1111-111111111111';
const B = 'bbbbbbbb-2222-2222-2222-222222222222';
const STU_A = 'aaaa1111-1111-1111-1111-111111111111';
const STU_B = 'bbbb1111-1111-1111-1111-111111111111';

before(async () => {
  await setupTestDb();
  const { pool } = await import('../src/db.js');
  sql = (text, params = []) => pool.query(text, params);
});
after(async () => {
  const { pool } = await import('../src/db.js');
  await pool.end().catch(() => {});
});

/** Every `%_id`/`user_%` column that carries an FK means the column is NOT in this list. */
async function fkLessReferenceColumns() {
  const r = await sql(`
    SELECT n.nspname || '.' || t.relname AS tbl, a.attname AS col, ty.typname AS typ
      FROM pg_attribute a
      JOIN pg_class t ON t.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_type ty ON ty.oid = a.atttypid
     WHERE a.attnum > 0 AND NOT a.attisdropped AND t.relkind = 'r'
       AND (a.attname LIKE '%\\_id' OR a.attname LIKE 'user\\_%')
       AND NOT EXISTS (SELECT 1 FROM pg_constraint c
                        WHERE c.conrelid = t.oid AND c.contype = 'f' AND a.attnum = ANY(c.conkey))
       AND n.nspname NOT IN ('pg_catalog', 'information_schema')
     ORDER BY 1, 2`);
  return r.rows;
}

/** The (table, column) pairs migration 082 declares — parsed from the file, never retyped. */
function declaredRefs() {
  // Two things this parser has to get right, both learned the hard way:
  //
  //  1. The parent fields are spelled `app.students` / `app.users` / `app.guardians` — DOTTED. A parser using
  //     `[a-z_]+` there silently matched only 54 of the 55 rows, so the "all 55 exist" assertion was weaker
  //     than it read. The `assert.equal(declared.size, 55)` below is what turns any future silent under-parse
  //     into a loud failure, which matters more than the one name it was missing.
  //  2. The constraint name is built from the TABLE, not the schema (`mastery_evidence_student_id_ref_fkey`,
  //     not `evidence_...`). Deriving it from the schema-qualified path is the same mistake that made me
  //     retype three constraint names wrong in the DAT-1 test, so the name is built from column 2 only.
  const text = readFileSync(MIGRATION, 'utf8');
  const pairs = new Map();
  for (const m of text.matchAll(/\('([a-z_]+)','([a-z_]+)','([a-z_]+)','([a-z_.]+)','([a-z_.]+)'\)/g)) {
    pairs.set(`${m[1]}.${m[2]}.${m[3]}`, `${m[2]}_${m[3]}_ref_fkey`);
  }
  return pairs;
}

describe('DAT-2 · the declared references are really in the catalogue and really enforced', () => {
  test('every one of the 55 references exists as a composite, tenant-aligned FK', async () => {
    const declared = declaredRefs();
    assert.equal(declared.size, 55,
      `expected migration 082 to declare 55 references, parsed ${declared.size}. If the change is intended, `
      + 'this constant and the migration header must move together.');
    const absent = [];
    for (const [key, cname] of declared) {
      const [sch, tbl] = key.split('.');
      const r = await sql(`
        SELECT array_length(con.conkey, 1) n
          FROM pg_constraint con
          JOIN pg_class c ON c.oid = con.conrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE con.contype = 'f' AND n.nspname = $1 AND c.relname = $2
           AND con.conname = $3`, [sch, tbl, cname]);
      if (!r.rows[0]) absent.push(`${key} (${cname} missing)`);
      else if (r.rows[0].n !== 2) absent.push(`${key} (single-column FK — not tenant-aligned)`);
    }
    assert.deepEqual(absent, [],
      'these declared references are missing or are not tenant-aligned, so a row in one tenant can again '
      + 'point at another tenant\'s pupil or teacher while RLS hides it from both');
  });

  test('the composite FK actually refuses a cross-tenant reference', async () => {
    await sql(`INSERT INTO app.tenants (id, slug, name) VALUES ($1,'dat2a','DAT-2 A'), ($2,'dat2b','DAT-2 B')`, [A, B]);
    await sql(`INSERT INTO app.students (id, tenant_id, admission_no, name, grade, section)
               VALUES ($1,$3,'DAT2-A','Pupil A','5','A'), ($2,$4,'DAT2-B','Pupil B','5','A')`,
      [STU_A, STU_B, A, B]);
    // THE DEFECT: tenant A's row referencing tenant B's pupil. Accepted before 082, invisible to both after.
    // NOTE on the choice of table: the first version of this test used `student.flashcard`, and it FAILED for
    // the wrong reason — that table requires `creator_user_id`, so the insert died on a NOT NULL constraint
    // before the foreign key was ever consulted, and the assertion would have "passed" against any error at
    // all. `mastery.evidence` needs only (tenant_id, student_id, subject, kind, observed_at), so the refusal
    // it produces can only come from the constraint under test.
    await assert.rejects(
      () => sql(`INSERT INTO mastery.evidence (tenant_id, student_id, subject, kind, observed_at)
                 VALUES ($1,$2,'maths','quiz', now())`, [A, STU_B]),
      (e) => {
        assert.match(String(e.message), /foreign key constraint/i,
          `expected a foreign key refusal, got: ${e.message}`);
        assert.match(String(e.message), /mastery_evidence|student/i,
          'the refusal must name the tenant-aligned constraint, not something incidental');
        return true;
      },
      'a cross-tenant student reference must be refused by the database, not merely hidden by RLS');
    // and the same-tenant write must still work — a guard that blocks everything is not a fix
    await sql(`INSERT INTO mastery.evidence (tenant_id, student_id, subject, kind, observed_at)
               VALUES ($1,$2,'maths','quiz', now())`, [A, STU_A]);
    const ok = await sql(`SELECT count(*)::int n FROM mastery.evidence WHERE student_id = $1`, [STU_A]);
    assert.equal(ok.rows[0].n, 1, 'a legitimate same-tenant write must be unaffected');
    await sql(`DELETE FROM mastery.evidence WHERE student_id IN ($1,$2)`, [STU_A, STU_B]);
    await sql(`DELETE FROM app.students WHERE id IN ($1,$2)`, [STU_A, STU_B]);
    await sql(`DELETE FROM app.tenants WHERE id IN ($1,$2)`, [A, B]);
  });

  test('every constraint is ON DELETE RESTRICT — this migration cannot destroy a row', async () => {
    // The register asked for CASCADE on "derived" rows. That classification is too coarse in at least nine
    // places: a blanket cascade on plugin_exams.mark, teacher.submission, library.loan, plugin_clinic.*,
    // app.ai_calls or plugin_dpdp.erasure_journal would destroy academic, clinical, AI-ledger or
    // erasure-audit history. RESTRICT is the choice that cannot lose data, so a later silent widening to
    // CASCADE must fail here rather than in production.
    const declared = [...declaredRefs().values()];
    // `con.conname` is type `name`, not `text` — without the cast PostgreSQL has no operator for
    // `name = ANY(text[])` and this threw instead of returning rows, which would have made the assertion
    // below unreachable while still appearing to be "about" delete actions.
    const r = await sql(`SELECT conname, confdeltype FROM pg_constraint
                          WHERE contype = 'f' AND conname::text = ANY($1::text[])`, [declared]);
    assert.equal(r.rows.length, declared.length, 'all declared constraints must be present to judge their action');
    const notRestrict = r.rows.filter((x) => x.confdeltype !== 'r').map((x) => `${x.conname}=${x.confdeltype}`);
    assert.deepEqual(notRestrict, [],
      'these were changed away from RESTRICT (r). Widening to CASCADE destroys history the school is '
      + 'required to keep, and ON DELETE SET NULL on a composite FK nulls tenant_id as well — creating a '
      + 'tenant-less row, a design this project already rejected in migration 063:5-11.');
  });

  test('the two references that must NEVER be re-added are still absent, and say why', async () => {
    // These are the two traps a well-meaning future sweep would "helpfully" close.
    const traps = [
      { name: 'plugin_visitors.pickup_otp.visit_id', constraint: 'pickup_otp_visit_id_ref_fkey',
        why: 'migration 054:29-36 DROPPED this after a live-verified 55P03 deadlock — the handler holds '
           + 'FOR UPDATE on plugin_visitors.visit while the vault INSERT rides the owner-path connection, so '
           + 'an FK demands a KEY SHARE lock from a second connection and times out. Re-adding it reinstates '
           + 'a proven production deadlock.' },
      { name: 'app.capability_contracts.plugin_id', constraint: 'capability_contracts_plugin_id_ref_fkey',
        why: 'one REAL orphan live: plugin_id=\'people.import\' has no app.plugins row (the import plugin '
           + 'registers as ops.import). An FK here fails on real data, so the fix is a data correction for '
           + 'the owner (DAT-19), not a constraint.' },
    ];
    for (const t of traps) {
      const r = await sql(`SELECT 1 FROM pg_constraint WHERE conname = $1`, [t.constraint]);
      assert.equal(r.rows.length, 0, `${t.constraint} was added. ${t.why}`);
      assert.ok(t.why.length > 40, `${t.name} must carry a real reason, not a placeholder`);
    }
  });

  test('guardian_id is pinned to the parent it ACTUALLY references — app.users, not app.guardians', async () => {
    // The column name lies, and this assertion exists because I believed it. My first version of 082 pointed
    // `family.request.guardian_id` and `ptm.booking.guardian_id` at `app.guardians` and added a
    // `UNIQUE (tenant_id, id)` there to make that legal. The full suite caught it:
    // `violates foreign key constraint "request_guardian_id_ref_fkey"`, because
    // tests/coord-view.test.js:307 inserts a parent USER id into that column — as does the application:
    // `family.view/index.js:251,282,311` passes `req.user.id`, and `teacher.support/index.js:727` does the
    // same for `ptm.booking`. So the column references app.users.
    //
    // A scratch database could not have caught this: `family.request` and `ptm.booking` were EMPTY in it, so
    // the "0 orphans" measurement I had taken proved nothing whatever about the parent's identity. Measuring
    // emptiness is not measuring correctness. This test now pins the parent, so a future edit that "fixes" the
    // naming by re-pointing at app.guardians fails here.
    for (const [tbl, cname] of [['request', 'request_guardian_id_ref_fkey'],
                                ['booking', 'booking_guardian_id_ref_fkey']]) {
      const r = await sql(`
        SELECT pn.nspname || '.' || pc.relname AS parent
          FROM pg_constraint con
          JOIN pg_class c ON c.oid = con.conrelid
          JOIN pg_class pc ON pc.oid = con.confrelid
          JOIN pg_namespace pn ON pn.oid = pc.relnamespace
         WHERE con.contype = 'f' AND con.conname = $1`, [cname]);
      assert.equal(r.rows.length, 1, `${cname} must exist (table ${tbl})`);
      assert.equal(r.rows[0].parent, 'app.users',
        `${cname} points at ${r.rows[0].parent}. Despite the column name, guardian_id holds an app.users id — `
        + 'both the application (family.view/index.js:251, teacher.support/index.js:727) and the suite '
        + '(coord-view.test.js:307) write a user id. Re-pointing this at app.guardians breaks the parent '
        + 'request door at runtime.');
    }
    // and the key added on the wrong assumption must not have been left behind
    const gk = await sql(`SELECT 1 FROM pg_constraint WHERE conname = 'guardians_tenant_id_id_key'`);
    assert.equal(gk.rows.length, 0,
      'guardians_tenant_id_id_key was added only to make the WRONG parent legal. Nothing references it now, '
      + 'so leaving it behind is a redundant unique index justified by a mistake.');
  });
});

describe('DAT-2 · the census: every FK-less reference column is a recorded decision', () => {
  /* Reviewed allowlist. Each entry: the column, a category, and WHY it is not constrained. Categories:
   *   tenant-root   → the column IS tenant_id; app.tenants has no tenant_id column, so no composite target
   *                   can exist. These are a distinct architectural decision (see DAT-20), not an omission.
   *   event-spine   → correlation/causation ids, deliberately not keys
   *   external      → ids minted by a third party (Razorpay, UPI)
   *   type-mismatch → text where the parent key is uuid, so an FK is not expressible without a cast
   *   polymorphic   → the target table depends on a sibling discriminator column
   *   natural-key   → the column IS the table's own natural key
   *   unresolved    → no identifiable parent exists yet (a real gap, kept visible on purpose)
   *   policy        → FK-free on purpose, for a recorded reason (plugin isolation, deadlock avoidance)
   *   orphan-blocked→ a parent exists but real data violates the constraint
   */
  const ALLOWLIST = new Map(Object.entries({
    // ── tenant-root: the column IS tenant_id; the parent app.tenants has no tenant_id column ────────────
    'app.ai_calls.tenant_id': 'tenant-root',
    'app.audit_log_cold.tenant_id': 'tenant-root',
    'app.capability_contracts.tenant_id': 'policy',
    'app.workflow_rules.tenant_id': 'tenant-root',
    'auth.mfa_recovery_codes.tenant_id': 'tenant-root',
    'auth.mfa_secrets.tenant_id': 'tenant-root',
    'auth.reset_tokens.tenant_id': 'tenant-root',
    'auth.revoked_token.tenant_id': 'tenant-root',
    'family.child_link.tenant_id': 'tenant-root',
    'family.consent.tenant_id': 'tenant-root',
    'family.request.tenant_id': 'tenant-root',
    'parent.brief_log.tenant_id': 'tenant-root',
    'parent.copilot_call.tenant_id': 'tenant-root',
    'plugin_dpdp.erasure_journal.tenant_id': 'tenant-root',
    'plugin_visitors.pickup_otp.tenant_id': 'tenant-root',
    'teacher.homework.tenant_id': 'tenant-root',
    'teacher.leave_request.tenant_id': 'tenant-root',
    // 086 added `teacher.submission_needs_linking` (submissions moved out of teacher.submission because
    // their student_id was an unresolvable pre-082 user id); 087 made its homework_id FK tenant-aligned.
    // Three of its columns are FK-less BY DESIGN and are recorded here rather than left as absences:
    'teacher.submission_needs_linking.tenant_id': 'tenant-root',
    // the PK holds the id of the teacher.submission row that was MOVED here and then DELETED at source, so
    // there is no parent row to reference.
    'teacher.submission_needs_linking.submission_id': 'policy',
    // the raw pre-082 app.users id that could NOT be resolved to a roster student — an FK is exactly what
    // was impossible, and storing the unresolvable value is the table's entire purpose.
    'teacher.submission_needs_linking.prior_student_id': 'policy',
    // ── event-spine: correlation/causation, deliberately not keys ───────────────────────────────────────
    'app.events.causation_id': 'event-spine',
    'app.events.correlation_id': 'event-spine',
    'app.outbox.causation_id': 'event-spine',
    'app.outbox.correlation_id': 'event-spine',
    // ── polymorphic / natural key / unresolved ──────────────────────────────────────────────────────────
    'app.files.ref_id': 'polymorphic',
    'copilot.call.approved_action_id': 'unresolved',
    'safety.box.page_action_id': 'unresolved',
    'teacher.note.booking_id': 'unresolved',
    'app.webhook_deliveries.event_id': 'unresolved',
    'plugin_dpdp.sar.action_id': 'unresolved',
    'plugin_exams.exam.action_id': 'unresolved',
    'plugin_visitors.visit.otp_request_id': 'unresolved',
    // FK-free on purpose for the SAME recorded reason: migration 054:29-36 dropped it after a live-verified
    // 55P03 deadlock. (This entry was missing from the first version of the allowlist, and the census test is
    // what caught it — which is precisely why "no FK" is asserted to be a written decision rather than an
    // absence.)
    'plugin_visitors.pickup_otp.visit_id': 'policy',
    'plugin_clinic.sick_pass.visit_id': 'policy',
    // ── type-mismatch: `text` columns whose would-be parent key is `uuid` (or another natural key) ──────
    'app.ai_calls.plugin_id': 'type-mismatch',
    'app.plugins.plugin_id': 'natural-key',
    'app.capability_contracts.capability_id': 'natural-key',
    'plugin_upi.webhook_log.event_id': 'type-mismatch',
    'plugin_razorpay.order_log.razorpay_order_id': 'external',
    'plugin_razorpay.order_log.razorpay_payment_id': 'external',
    'plugin_razorpay.webhook_log.event_id': 'type-mismatch',
    // ── orphan-blocked: a parent exists, real data refuses ──────────────────────────────────────────────
    'app.capability_contracts.plugin_id': 'orphan-blocked',
  }));

  test('no FK-less reference column is outside the allowlist', async () => {
    const found = await fkLessReferenceColumns();
    assert.ok(found.length >= 20,
      `the census only found ${found.length} FK-less reference columns — the catalogue query is broken, so a `
      + 'green result here would be meaningless');

    const unaccounted = found
      .map((r) => `${r.tbl}.${r.col}`)
      .filter((key) => !ALLOWLIST.has(key) && !declaredRefs().has(key));
    assert.deepEqual(unaccounted, [],
      'these columns look like references but carry no FK and are not on the reviewed allowlist. Either '
      + 'constrain them (migration 082 is the worked example), or add them to ALLOWLIST above WITH a reason. '
      + 'The point of this failure is that "not covered" has to be a decision somebody wrote down.');

    // Deliberately NOT asserting the reverse direction. Some tables are created only when their owning plugin
    // is enabled, so a test database holds a SUBSET of what the development database holds — and a check
    // that every allowlist entry was observed here would fail for an environment reason, which teaches
    // nothing. The direction that matters is above: nothing may be unaccounted for.
  });

  test('the allowlist names a real category for every entry and is not a dumping ground', async () => {
    const VALID = new Set(['tenant-root', 'event-spine', 'external', 'type-mismatch', 'polymorphic',
      'natural-key', 'unresolved', 'policy', 'orphan-blocked']);
    const bad = [...ALLOWLIST.entries()].filter(([, v]) => !VALID.has(v));
    assert.deepEqual(bad, [], 'every exemption must carry a recognisable reason');
    // `unresolved` is the honest bucket for "we could not find a parent". It must not quietly become the
    // majority of the list, because that would mean the census is being used to launder ignorance.
    const unresolved = [...ALLOWLIST.values()].filter((v) => v === 'unresolved');
    assert.ok(unresolved.length <= 8,
      `${unresolved.length} columns are exempt merely because no parent could be identified. That is a real `
      + 'gap being tracked, not a resolution — if this number grows, the census is laundering ignorance.');
  });

  test('the 8 text-typed reference columns cannot take an FK without a cast, and are counted', async () => {
    // Measured: 86 FK-less reference columns, 78 uuid and 8 text. An FK from `text` to a `uuid` key is not
    // expressible, which is why the type-mismatch category exists rather than a silent omission.
    const r = await sql(`
      SELECT n.nspname || '.' || t.relname AS tbl, a.attname AS col
        FROM pg_attribute a JOIN pg_class t ON t.oid = a.attrelid JOIN pg_namespace n ON n.oid = t.relnamespace
        JOIN pg_type ty ON ty.oid = a.atttypid
       WHERE a.attnum > 0 AND NOT a.attisdropped AND t.relkind = 'r'
         AND (a.attname LIKE '%\\_id' OR a.attname LIKE 'user\\_%') AND ty.typname = 'text'
         AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = t.oid AND c.contype='f' AND a.attnum = ANY(c.conkey))
         AND n.nspname NOT IN ('pg_catalog','information_schema')`);
    assert.ok(r.rows.length >= 5,
      `expected the text-typed reference columns to still be present (measured 8, found ${r.rows.length})`);
    const unbudgeted = r.rows.map((x) => `${x.tbl}.${x.col}`).filter((k) => !ALLOWLIST.has(k));
    assert.deepEqual(unbudgeted, [],
      'these text columns were not in the census when the count of 86 (78 uuid + 8 text) was taken — the '
      + 'measurement has moved, so re-measure and update the migration header rather than leaving a number '
      + 'that no longer describes the schema');
  });
});
