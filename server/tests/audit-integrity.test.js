// SEC-20 / DAT-5 — the audit ledger must be tamper-EVIDENT, not merely append-only.
//
// WHAT WAS WRONG (measured, and the reason this file's first test exists):
//   `app.audit_append` validated `p_prev_hash` but stored `p_hash` VERBATIM, and the app role holds
//   EXECUTE on that function. So any app-role caller — any plugin, any path reachable from a request
//   — could write a ledger row whose hash it had chosen. The row still LINKED correctly, because
//   prev_hash was computed server-side, so ordinary "is the chain intact?" checking saw nothing.
//   Reproducing the dev ledger's 53 rows from their own stored columns: 27 reproduced, 26 did not,
//   and one ('migration 013 (plugin factory)') had a hash matching the MIGRATION FILE's outcome
//   literal rather than the outcome the row contained — i.e. it had been altered after insertion.
//
// The first test below is the one that fails if migration 075 is reverted: today's code stores
// 'deadbeef'. Everything else here pins a property that would otherwise be assumed rather than
// proven — that the link is computed rather than accepted, that a stale caller is still told, that
// the timestamp is truncated so a hash is reproducible at all, that a rewrite is detectable in BOTH
// directions (hash mismatch and link break), and that the endpoint never reports success-shaped
// silence.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { setupTestDb, loginAs, TEST_URL } from './helpers.js';

let app;
let pool;
let T; // tenant under test

// The app role connects with its own credentials; schoolos_app_pw is the bootstrap-set password.
const APP_URL = TEST_URL.replace('schoolos:', 'schoolos_app:').replace('schoolos_dev_pw', 'schoolos_app_pw');

/** Run a statement block AS the RLS-constrained app role with its tenant GUC pinned.
 *  COMMITS on success: the ledger rows written here are the fixtures later assertions read back.
 *  Rolls back only on error, so a refused call leaves nothing behind. */
async function asApp(tenant, sql) {
  const c = new pg.Client({ connectionString: APP_URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL ROLE schoolos_app`);
    await c.query(`SELECT set_config('schoolos.tenant_id', $1, true)`, [tenant]);
    const r = await c.query(sql);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { await c.end(); }
}

/** Simulate a privileged rewrite: the owner CAN disable a trigger, which is precisely the threat
 *  the verifier exists to detect. Nothing here weakens the control — it is used to prove the
 *  detector works, and it is always re-enabled. */
async function withTriggersOff(fn) {
  await pool.query(`ALTER TABLE app.audit_log DISABLE TRIGGER audit_ledger_immutable_bu`);
  try { return await fn(); }
  finally { await pool.query(`ALTER TABLE app.audit_log ENABLE TRIGGER audit_ledger_immutable_bu`); }
}

const breaks = async (tenant = T) =>
  (await pool.query(`SELECT break_kind, row_id, expected_hash, actual_hash, hash_version FROM app.audit_verify($1)`, [tenant])).rows;

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  pool = (await import('../src/db.js')).pool;
  T = (await pool.query(`SELECT id FROM app.tenants ORDER BY created_at LIMIT 1`)).rows[0].id;
});
after(async () => { await app?.close(); });

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

describe('SEC-20: the database pins the hash, so the caller cannot choose it', () => {
  test('THE REGRESSION GATE — a forged p_hash supplied by the app role is IGNORED', async () => {
    // The door is granted on purpose: the fix is that the argument no longer decides the stored value.
    const r = await asApp(T, `SELECT hash, prev_hash, hash_version, outcome, actor
        FROM app.audit_append('${T}','sec20-attacker','admin','SEC20 FORGED','X','X',null,null,false,'low','forged outcome',NULL,'deadbeef',now())`);
    const row = r.rows[0];
    assert.notEqual(row.hash, 'deadbeef', 'a caller-supplied hash must never reach the ledger (this is the SEC-20 hole)');
    assert.match(row.hash, /^[0-9a-f]{64}$/, 'the stored hash must be a real sha256');
    assert.equal(row.hash_version, 2, 'rows written after 075 are hash-pinned');

    // and the stored hash must be the one the DATABASE computes from the row's own columns
    const db = await pool.query(
      `SELECT app.audit_row_hash(prev_hash, tenant_id, actor, actor_role, action, record_type, record_ref,
                                 reason, policy_ref, ai_involved, risk, outcome, ip, created_at) AS h
         FROM app.audit_log WHERE actor='sec20-attacker'`);
    assert.equal(db.rows[0].h, row.hash, 'the ledger must be reproducible from its own columns');
  });

  test('the hash covers the fields an auditor actually reads, not just the 8 the old writer hashed', async () => {
    // The pre-075 material covered tenant/actor/actorRole/action/recordType/recordRef/outcome/at — so
    // `reason` (why), `policyRef` (which rule authorised it), `aiInvolved` and `risk` could all be
    // rewritten without disturbing the hash: the row still linked and still looked verified. A hash
    // over the least interesting half of the row is worse than none, because it invites trust.
    const id = (await pool.query(`SELECT id FROM app.audit_log WHERE actor='sec20-attacker'`)).rows[0].id;
    const columns = [['reason', `'rewritten reason'`], ['policy_ref', `'rewritten policy'`],
                     ['ai_involved', `NOT ai_involved`], ['risk', `'high'`]];
    for (const [col, expr] of columns) {
      const original = (await pool.query(`SELECT ${col} AS v FROM app.audit_log WHERE id=$1`, [id])).rows[0].v;
      await withTriggersOff(() => pool.query(`UPDATE app.audit_log SET ${col} = ${expr} WHERE id=$1`, [id]));
      const found = await breaks();
      assert.equal(found.filter((b) => b.break_kind === 'hash_mismatch').length, 1,
        `changing ${col} MUST be detected — it was invisible to the old material`);
      await withTriggersOff(() => pool.query(`UPDATE app.audit_log SET ${col} = $2 WHERE id=$1`, [id, original]));
    }
    assert.equal((await breaks()).length, 0, 'restoring every field must return the ledger to clean');
  });

  test('the formula belongs to the database — the old JS material must NOT reproduce a pinned row', async () => {
    const row = (await pool.query(`SELECT * FROM app.audit_log WHERE actor='sec20-attacker'`)).rows[0];
    // The pre-075 writer's material, recomputed by hand. If someone reverts to JS hashing, this
    // becomes equal again and the assertion fires.
    const jsMaterial = JSON.stringify({
      tenant: row.tenant_id, actor: row.actor, actorRole: row.actor_role, action: row.action,
      recordType: row.record_type, recordRef: row.record_ref, outcome: row.outcome,
      at: new Date(row.created_at).toISOString(),
    });
    assert.notEqual(createHash('sha256').update(row.prev_hash + jsMaterial).digest('hex'), row.hash,
      'a hash-pinned row must not reproduce under the legacy JS material — 075 moved hashing into the DB');
  });

  test('the link is computed, and a caller with a stale view of the chain is still told', async () => {
    // (a) an honest caller passing the true prev is accepted and the stored link is the real one
    const prev = (await pool.query(`SELECT hash FROM app.audit_log WHERE tenant_id=$1 ORDER BY created_at DESC, id DESC LIMIT 1`, [T])).rows[0].hash;
    const ok = await asApp(T, `SELECT prev_hash FROM app.audit_append('${T}','sec20-link','admin','SEC20 LINK','X','X',null,null,false,'low','o','${prev}',NULL,now())`);
    assert.equal(ok.rows[0].prev_hash, prev, 'the stored link must be the chain tip, not the argument');
    // (b) a caller whose view is WRONG is rejected — the argument is a conflict detector, not the link
    await assert.rejects(
      () => asApp(T, `SELECT 1 FROM app.audit_append('${T}','sec20-stale','admin','SEC20 STALE','X','X',null,null,false,'low','o','0000000000000000000000000000000000000000000000000000000000000000',NULL,now())`),
      /audit chain conflict/,
      'a genuinely stale prev_hash must still raise');
  });

  test('created_at is millisecond-truncated, otherwise no written row could ever be reproduced', async () => {
    // to_char(...,'MS') TRUNCATES microseconds. Without the truncation in the trigger, the verifier
    // could never reproduce rows the trigger itself wrote — a permanent false-positive generator.
    const r = await asApp(T, `SELECT created_at, hash_version,
        (to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')::timestamptz = created_at) AS exact
        FROM app.audit_append('${T}','sec20-ms','admin','SEC20 MS','X','X',null,null,false,'low','o',NULL,NULL,now())`);
    assert.equal(r.rows[0].exact, true, 'created_at must carry exactly the precision the material renders');
    assert.equal(r.rows[0].hash_version, 2);
  });
});

describe('SEC-20: the ledger refuses rewrites, and reports them when they happen anyway', () => {
  test('UPDATE is refused by the TABLE, not only by the absence of a GRANT', async () => {
    // A future accidental GRANT to the app role must not silently re-open the ledger. The trigger
    // makes the control structural.
    await assert.rejects(
      () => pool.query(`UPDATE app.audit_log SET outcome='tampered' WHERE tenant_id=$1 AND id=(SELECT id FROM app.audit_log WHERE tenant_id=$1 LIMIT 1)`, [T]),
      /append-only/,
      'the owner path must be refused too — the ACL was the only control before 075');
    await assert.rejects(
      () => asApp(T, `UPDATE app.audit_log SET outcome='tampered' WHERE id=(SELECT id FROM app.audit_log LIMIT 1)`),
      /permission denied/i,
      'the app role keeps its ACL denial (both controls now hold)');
  });

  test('a forged AFTER-THE-FACT rewrite is DETECTED as exactly one hash mismatch', async () => {
    const target = (await pool.query(`SELECT id FROM app.audit_log WHERE actor='sec20-attacker'`)).rows[0].id;
    assert.equal((await breaks()).length, 0, 'precondition: the chain verifies before the rewrite');

    // Simulate the DBA-level rewrite the verifier exists to catch: swap the outcome, leave the hash.
    await withTriggersOff(() => pool.query(`UPDATE app.audit_log SET outcome='TAMPERED' WHERE id=$1`, [target]));

    const found = await breaks();
    const mismatches = found.filter((b) => b.break_kind === 'hash_mismatch');
    assert.equal(mismatches.length, 1, `exactly one row was rewritten (got ${JSON.stringify(found)})`);
    assert.equal(mismatches[0].row_id, target);
    assert.notEqual(mismatches[0].expected_hash, mismatches[0].actual_hash, 'the report must carry both hashes, not just a verdict');
    // A rewrite of one row's CONTENT must not look like a broken link — the two failure modes are
    // distinguished so an operator knows whether the chain or a row was attacked.
    assert.equal(found.filter((b) => b.break_kind === 'link_break').length, 0);

    // restore, and prove detection is not sticky
    await withTriggersOff(() => pool.query(`UPDATE app.audit_log SET outcome='forged outcome' WHERE id=$1`, [target]));
    assert.equal((await breaks()).length, 0, 'a repaired ledger must verify clean again');
  });

  test('a DELETED row is detected as a link break', async () => {
    const ins = await asApp(T, `SELECT id, hash FROM app.audit_append('${T}','sec20-del-a','admin','SEC20 DEL A','X','X',null,null,false,'low','o',NULL,NULL,now())`);
    await asApp(T, `SELECT 1 FROM app.audit_append('${T}','sec20-del-b','admin','SEC20 DEL B','X','X',null,null,false,'low','o',NULL,NULL,now())`);
    // Removing a chained row (allowed by design — retention archives with DELETE ... RETURNING, which
    // is why there is no DELETE trigger) must leave evidence behind, not a silently shorter chain.
    await pool.query(`DELETE FROM app.audit_log WHERE id=$1`, [ins.rows[0].id]);
    const found = await breaks();
    assert.equal(found.filter((b) => b.break_kind === 'link_break').length, 1, 'removing a row must surface as a link break');
    await pool.query(`DELETE FROM app.audit_log WHERE actor IN ('sec20-del-a','sec20-del-b')`);
    assert.equal((await breaks()).length, 0);
  });

  test('legacy (hash_version=1) rows are counted, never asserted either way', async () => {
    // A pre-075 row cannot be recomputed, because the material itself changed. Calling it "verified"
    // would launder a known-bad history; calling it "tampered" would be a false accusation.
    const legacy = (await pool.query(
      `INSERT INTO app.audit_log (tenant_id, actor, actor_role, action, record_type, prev_hash, hash, hash_version)
       VALUES ($1,'sec20-legacy','system','SEC20 LEGACY','X','GENESIS','not-a-real-hash',1) RETURNING id`, [T])).rows[0].id;
    const found = await breaks();
    assert.equal(found.filter((b) => b.row_id === legacy).length, 0, 'a v1 row must not be reported as a fresh mismatch');
    await pool.query(`DELETE FROM app.audit_log WHERE id=$1`, [legacy]);
  });
});

describe('SEC-20: the verifier cannot be used to read another tenant', () => {
  test('the app role is pinned to its own tenant', async () => {
    // app.audit_verify is SECURITY DEFINER and returns actor/action details, so without the pin an
    // app-role caller could read another school's ledger.
    await assert.rejects(
      () => asApp('00000000-0000-0000-0000-000000000000', `SELECT * FROM app.audit_verify('${T}')`),
      /tenant pin violated/,
      'a cross-tenant verification attempt must be refused, not simply return empty');
  });

  test('a second tenant verifies independently and sees none of our rows', async () => {
    // The seeded harness ships exactly one tenant, so the second is created here: the point is to
    // prove the walk is per-tenant, not to rely on fixture luck.
    const other = (await pool.query(
      `INSERT INTO app.tenants (id, slug, name, config) VALUES (gen_random_uuid(), $1, 'SEC-20 Other School', '{}'::jsonb) RETURNING id`,
      [`sec20-other-${Date.now()}`])).rows[0].id;

    // it has an empty ledger, so it verifies clean — and crucially it must not inherit ours
    assert.deepEqual(await breaks(other), [], 'an empty tenant must verify clean');
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM app.audit_log WHERE tenant_id=$1`, [other])).rows[0].n, 0);

    // and our own findings must not be attributed to it: plant a break in OUR tenant, then re-check
    const target = (await pool.query(`SELECT id FROM app.audit_log WHERE actor='sec20-attacker'`)).rows[0].id;
    await withTriggersOff(() => pool.query(`UPDATE app.audit_log SET outcome='TAMPERED' WHERE id=$1`, [target]));
    assert.ok((await breaks()).length >= 1, 'our tenant has the break');
    assert.deepEqual(await breaks(other), [], 'the other tenant must stay clean while ours is broken');
    await withTriggersOff(() => pool.query(`UPDATE app.audit_log SET outcome='forged outcome' WHERE id=$1`, [target]));
  });
});

describe('SEC-20: GET /audit/verify reports evidence, never success-shaped silence', () => {
  test('owner gets 200, a classified result, and a ledger row proving the check ran', async () => {
    const o = await loginAs(app, 'owner@meridian.edu');
    const before = (await pool.query(`SELECT count(*)::int AS n FROM app.audit_log WHERE action='Audit chain verified'`)).rows[0].n;

    const r = await app.inject({ method: 'GET', url: '/audit/verify', headers: H(o.token) });
    assert.equal(r.statusCode, 200, r.body);
    const b = r.json();
    assert.equal(b.ok, true, `expected a clean chain, got ${JSON.stringify(b.broken)}`);
    assert.ok(Array.isArray(b.broken) && b.broken.length === 0);
    assert.ok(b.checked.hotRows > 0, 'the run must report how much it actually checked');
    assert.ok(b.checked.hashPinned > 0, 'and how many rows were recomputable rather than merely counted');
    assert.ok(Array.isArray(b.limitations) && b.limitations.length >= 2,
      'what was NOT verified must travel with the verdict');

    // A verification nobody can prove happened is not evidence.
    const after = (await pool.query(`SELECT count(*)::int AS n FROM app.audit_log WHERE action='Audit chain verified'`)).rows[0].n;
    assert.equal(after, before + 1, 'the run itself must be audited');
    const row = (await pool.query(`SELECT actor_role, risk, outcome FROM app.audit_log WHERE action='Audit chain verified' ORDER BY created_at DESC, id DESC LIMIT 1`)).rows[0];
    assert.equal(row.actor_role, 'system');
    assert.match(row.outcome, /0 breaks/, 'the stored outcome must state the result');
  });

  test('a dirty ledger is reported as ok:false with the break, still on a 200', async () => {
    const target = (await pool.query(`SELECT id FROM app.audit_log WHERE actor='sec20-attacker'`)).rows[0].id;
    await withTriggersOff(() => pool.query(`UPDATE app.audit_log SET risk='high' WHERE id=$1`, [target]));
    try {
      const o = await loginAs(app, 'owner@meridian.edu');
      const r = await app.inject({ method: 'GET', url: '/audit/verify', headers: H(o.token) });
      // 200 deliberately: a 5xx would make "cannot verify" indistinguishable from "no problems" to
      // any monitor that alerts on non-2xx only.
      assert.equal(r.statusCode, 200);
      assert.equal(r.json().ok, false, 'a break must never be reported as ok');
      assert.ok(r.json().broken.length >= 1);
      const audited = (await pool.query(`SELECT risk, outcome FROM app.audit_log WHERE action='Audit chain verified' ORDER BY created_at DESC, id DESC LIMIT 1`)).rows[0];
      assert.equal(audited.risk, 'high', 'the ledger row must record that the check FAILED');
      assert.match(audited.outcome, /BREAK/, 'and say so in words');
    } finally {
      await withTriggersOff(() => pool.query(`UPDATE app.audit_log SET risk='low' WHERE id=$1`, [target]));
    }
  });

  test('only owner/itadmin may verify, and garbage input never 500s', async () => {
    for (const who of ['teacher@meridian.edu', 'parent@meridian.edu']) {
      const u = await loginAs(app, who);
      const r = await app.inject({ method: 'GET', url: '/audit/verify', headers: H(u.token) });
      assert.equal(r.statusCode, 403, `${who} must not be able to verify the ledger`);
    }
    const o = await loginAs(app, 'owner@meridian.edu');
    for (const q of ['?limit=abc', '?limit=-1', '?limit=0', '?limit=1e9']) {
      const r = await app.inject({ method: 'GET', url: `/audit/verify${q}`, headers: H(o.token) });
      assert.equal(r.statusCode, 200, `${q} must be handled, not 500 (got ${r.statusCode}: ${r.body})`);
    }
  });
});
