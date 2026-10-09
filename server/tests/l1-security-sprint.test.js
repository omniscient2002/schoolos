// L1 security sprint (migration 054) — negative tests for the sprint's P0/P1 fixes.
// Covers: T101 dev-flag fail-closed · T102/T110 pickup-OTP vault isolation ·
// T103 tenant-bound OTP/SSO resolution · T104 dataset allowlist · T105 object
// predicates (students/fees/attendance/actions) · T106 razorpay RLS · T107
// audit append-only (behavioral) · T108 case-insensitive email uniqueness ·
// T109 audit_append tenant pin.
/* This file models a DEVELOPER MACHINE, and says so before the app is imported (the app and config are
   imported dynamically in before(), so these assignments win). NODE_ENV is set for the same reason the flag
   is: `config.js` arms the OTP dev echo only when env === 'development', deliberately — CI runs the suite
   with NODE_ENV=test, where a code must come from a configured channel instead. Three tests below need the
   issued code itself to probe vault isolation and tenant binding, so the file declares the posture it is
   testing rather than depending on the ambient one. The REAL production/staging/test postures are pinned
   separately by T101, which spawns fresh processes with explicit envs and asserts the flags stay off. */
process.env.NODE_ENV = 'development';
process.env.OTP_DEV_ECHO = '1'; // before app import — dev-only echo parity (T101 arms it in development)
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { setupTestDb, loginAs } from './helpers.js';

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let app;
let sql;
let sqlTx;
let T;   // meridian tenant id
let TB;  // planted second tenant (T103/T106/T109 probes)
const PARENT_PHONE = '+919845000201'; // seed: parent@meridian.edu

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.ready();
  sql = async (text, params = []) => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try { return await c.query(text, params); } finally { await c.end(); }
  };
  // multi-statement probes (SET ROLE + GUC + query) — node-pg's extended protocol
  // refuses parameterized multi-command strings, so each statement runs separately
  // inside one transaction; always rolls back (also on error, which is rethrown).
  sqlTx = async (steps) => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try {
      await c.query('BEGIN');
      const out = [];
      for (const s of steps) out.push(await c.query(s.text, s.params ?? []));
      await c.query('ROLLBACK');
      return out;
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
    finally { await c.end(); }
  };
  T = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  TB = (await sql(`INSERT INTO app.tenants (slug, name, config) VALUES ('sprint-l1-b', 'Sprint L1 School B', '{}'::jsonb) RETURNING id`)).rows[0].id;
  // the P0-3 plant: the victim's phone provisioned into an attacker's school
  await sql(`INSERT INTO app.users (tenant_id, email, name, role, password_hash, phone)
             VALUES ($1, 'plant@b.test', 'Planted User', 'teacher', 'not-a-real-hash', $2)`, [TB, PARENT_PHONE]);
});

describe('L1 security sprint (054)', () => {
  // ── T101 ────────────────────────────────────────────────────────────────────
  describe('T101 · dev doors fail closed', () => {
    const probe = (over = {}) => {
      const env = {
        ...process.env,
        JWT_SECRET: 'x'.repeat(40),
        DATABASE_URL: 'postgres://u:p@db.example.com:5432/db',
        CORS_ORIGINS: 'https://school.example',
        // SEC-23: production now REFUSES to boot without a plugin-settings key (secret settings are
        // encrypted with it), so a production probe must supply one or the config throws before the flags
        // are even read — which is what this test is checking.
        PLUGIN_SETTINGS_KEY: 'x'.repeat(40),
        OTP_DEV_ECHO: '1', AUTH_DEV_SSO: '1', // flags explicitly set in EVERY case
        ...over,
      };
      const out = execSync(
        `node --input-type=module -e "const c = await import('./src/config.js'); console.log(JSON.stringify({e:c.config.env, devEcho:c.config.otp.devEcho, devSso:c.config.devSsoEnabled}))"`,
        { env, cwd: SERVER_ROOT, encoding: 'utf8' });
      return JSON.parse(out.trim().split('\n').pop());
    };
    test('production cannot arm the flags even when explicitly set', () => {
      const r = probe({ NODE_ENV: 'production' });
      assert.equal(r.devEcho, false, 'OTP_DEV_ECHO must not arm in production');
      assert.equal(r.devSso, false, 'AUTH_DEV_SSO must not arm in production');
    });
    test('staging/test NODE_ENV never arms the flags (staging inherits nothing)', () => {
      assert.equal(probe({ NODE_ENV: 'staging' }).devSso, false);
      assert.equal(probe({ NODE_ENV: 'test' }).devSso, false);
      assert.equal(probe({ NODE_ENV: 'staging' }).devEcho, false);
    });
    test('development + explicit opt-in arms both (dev UX preserved)', () => {
      const r = probe({ NODE_ENV: 'development' });
      assert.equal(r.devEcho, true);
      assert.equal(r.devSso, true);
    });
    test('dev echo never arms beside a real SMS provider', () => {
      const r = probe({ NODE_ENV: 'development', SMS_PROVIDER: 'gupshup' });
      assert.equal(r.devEcho, false);
      assert.equal(r.devSso, true);
    });
  });

  // ── T102 + T110 ─────────────────────────────────────────────────────────────
  describe('T102/T110 · visitor pickup OTP vault isolation', () => {
    let pickupVisit, pickupDevCode, guardian, studentId;
    test('pickup code can never verify as a login OTP (P0-1 negative)', async () => {
      const o = await loginAs(app, 'owner@meridian.edu');
      const en = await app.inject({ method: 'POST', url: '/plugins/ops.visitors/enable', headers: H(o.token), payload: { version: '1.0.0', class: 'C' } });
      assert.equal(en.statusCode, 200);
      guardian = (await sql(`SELECT g.phone FROM app.guardians g WHERE g.is_primary AND g.phone IS NOT NULL LIMIT 1`)).rows[0].phone;
      studentId = (await sql(`SELECT s.id FROM app.students s JOIN app.guardians g ON g.student_id=s.id AND g.is_primary AND g.phone IS NOT NULL LIMIT 1`)).rows[0].id;
      const co = await loginAs(app, 'coordinator@meridian.edu');
      const r = await app.inject({ method: 'POST', url: '/plugins/ops.visitors/visitors', payload: { visitorName: 'L1 Gate Uncle', purpose: 'pickup', studentId }, headers: H(co.token) });
      assert.equal(r.statusCode, 200);
      pickupVisit = r.json().visitId;
      await app.inject({ method: 'POST', url: `/plugins/ops.visitors/visitors/${pickupVisit}/checkin`, payload: {}, headers: H(co.token) });
      const p = await app.inject({ method: 'POST', url: `/plugins/ops.visitors/visitors/${pickupVisit}/pickup`, payload: {}, headers: H(co.token) });
      assert.equal(p.statusCode, 200);
      pickupDevCode = p.json().devCode;
      assert.match(pickupDevCode, /^\d{6}$/);
      // the login vault holds NOTHING for the guardian phone
      const vault = await sql(`SELECT count(*)::int n FROM app.auth_otps WHERE phone=$1`, [guardian]);
      assert.equal(vault.rows[0].n, 0, 'pickup OTP must never land in app.auth_otps');
      // redeeming the pickup code at the LOGIN door yields no session
      const login = await app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { phone: guardian.replace(/\s+/g, ''), code: pickupDevCode } });
      assert.equal(login.statusCode, 401, 'a pickup code is worthless as a login OTP');
      const desk = await sql(`SELECT count(*)::int n FROM plugin_visitors.pickup_otp WHERE phone=$1 AND consumed_at IS NULL`, [guardian]);
      assert.equal(desk.rows[0].n, 1, 'the code lives in the pickup vault');
    });
    test('a login OTP can never verify as a pickup code, and the pickup flow completes (T110)', async () => {
      const co = await loginAs(app, 'coordinator@meridian.edu');
      // issue a genuine LOGIN OTP to the teacher's phone
      const req = await app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone: '+919845000108' } });
      assert.equal(req.statusCode, 200);
      const loginCode = req.json().devCode;
      assert.ok(loginCode, 'dev echo armed in development');
      // the login code is rejected at the desk (hash mismatch → 422, never verified)
      const wrong = await app.inject({ method: 'POST', url: `/plugins/ops.visitors/visitors/${pickupVisit}/pickup/verify`, payload: { code: loginCode }, headers: H(co.token) });
      assert.equal(wrong.statusCode, 422, 'a login OTP must not release a student');
      // the real pickup code completes the flow end-to-end
      const ok = await app.inject({ method: 'POST', url: `/plugins/ops.visitors/visitors/${pickupVisit}/pickup/verify`, payload: { code: pickupDevCode }, headers: H(co.token) });
      assert.equal(ok.statusCode, 200);
      assert.equal(ok.json().status, 'verified');
    });
  });

  // ── T103 ────────────────────────────────────────────────────────────────────
  describe('T103 · OTP resolution is tenant-bound', () => {
    test('phone planted in a second tenant → 409 multiTenant + X-Tenant-Hint, never rows[0]', async () => {
      const r = await app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone: PARENT_PHONE } });
      assert.equal(r.statusCode, 409);
      assert.equal(r.json().multiTenant, true);
      assert.equal(r.json().schools.length, 2); // L2-4.2 picker contract: schools is now [{tenantId, name}]
      const hint = (r.headers['x-tenant-hint'] ?? '').split(',');
      assert.ok(hint.includes(T) && hint.includes(TB), 'X-Tenant-Hint lists both candidate tenants');
      assert.equal(r.json().devCode, undefined, 'no code is issued for an ambiguous phone');
    });
    test('OTP issued in tenant A cannot verify in tenant B (negative) — and verifies in A', async () => {
      const scoped = await app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone: PARENT_PHONE, tenantId: T } });
      assert.equal(scoped.statusCode, 200);
      const code = scoped.json().devCode;
      assert.ok(code);
      // unscoped verify still refuses to pick a side
      const ambiguous = await app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { phone: PARENT_PHONE, code } });
      assert.equal(ambiguous.statusCode, 409);
      // THE negative: explicitly targeting tenant B with tenant A's code → no session
      const wrong = await app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { phone: PARENT_PHONE, code, tenantId: TB } });
      assert.equal(wrong.statusCode, 401, 'a tenant-A code can never issue a tenant-B session');
      // the right tenant verifies into the right account
      const right = await app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { phone: PARENT_PHONE, code, tenantId: T } });
      assert.equal(right.statusCode, 200);
      assert.equal(right.json().user.tenantId, T);
    });
  });

  // ── T104 ────────────────────────────────────────────────────────────────────
  describe('T104 · /dataset empty world is an allowlist', () => {
    test('non-demo tenant payload contains zero demo strings and no seed-derived keys', async () => {
      const s = await app.inject({ method: 'POST', url: '/onboard/signup', payload: {
        schoolName: 'Sprint Field Academy', ownerName: 'Sprint Owner',
        ownerEmail: 'owner@sprintfield.test', ownerPassword: 'sprint-owner-pw' } });
      assert.equal(s.statusCode, 200, s.body);
      const d = await app.inject({ method: 'GET', url: '/dataset', headers: H(s.json().token) });
      assert.equal(d.statusCode, 200);
      const body = d.json();
      const flat = JSON.stringify(body);
      assert.doesNotMatch(flat, /Aarav|Kavita|Meridian|North Campus/, 'no demo identity may reach a real tenant');
      for (const k of ['DEMO_STUDENT', 'DEMO_GUARDIAN', 'DEMO_SECTION_ID', 'FEE_STORY', 'SLA_POLICY', 'deskSettings', 'SCENARIOS']) {
        assert.ok(!(k in body), `${k} must be absent from the empty world`);
      }
      assert.deepEqual(body.students, []);
      assert.ok(Array.isArray(body.workOrders) && Array.isArray(body.visitors) && Array.isArray(body.gatePasses));
      assert.equal(body.SCHOOL.name, 'Sprint Field Academy');
    });
    test('control: the demo tenant still receives the demo blob', async () => {
      const o = await loginAs(app, 'owner@meridian.edu');
      const d = await app.inject({ method: 'GET', url: '/dataset', headers: H(o.token) });
      assert.equal(d.statusCode, 200);
      assert.match(JSON.stringify(d.json()), /Aarav/, 'demo world intact for the demo tenant');
    });
  });

  // ── T105 ────────────────────────────────────────────────────────────────────
  describe('T105 · object predicates', () => {
    test('a) student role cannot read the roster or another student\'s record', async () => {
      const st = await loginAs(app, 'student@meridian.edu');
      const roster = await app.inject({ method: 'GET', url: '/students', headers: H(st.token) });
      assert.equal(roster.statusCode, 403);
      const anyId = (await sql(`SELECT id FROM app.students LIMIT 1`)).rows[0].id;
      const one = await app.inject({ method: 'GET', url: `/students/${anyId}`, headers: H(st.token) });
      assert.equal(one.statusCode, 404);
    });
    test('b) parent cannot initiate payment on another family\'s obligation', async () => {
      const p = await loginAs(app, 'parent@meridian.edu');
      const mine = (await sql(`SELECT student_id FROM family.child_link WHERE user_id=$1`, [(await sql(`SELECT id FROM app.users WHERE email='parent@meridian.edu'`)).rows[0].id])).rows.map((r) => r.student_id);
      const other = (await sql(`SELECT o.id FROM app.fee_obligations o WHERE o.status <> 'void' AND NOT (o.student_id = ANY($1::uuid[])) LIMIT 1`, [mine])).rows[0];
      assert.ok(other, 'seed must contain an obligation outside the parent\'s children');
      const pay = await app.inject({ method: 'POST', url: '/fees/payments', payload: { obligationId: other.id }, headers: H(p.token) });
      assert.equal(pay.statusCode, 404, 'other families\' obligations must not be payable (existence hidden)');
      const own = (await sql(`SELECT o.id FROM app.fee_obligations o WHERE o.student_id = ANY($1::uuid[]) AND o.status <> 'void' AND o.paid_cents < o.amount_cents LIMIT 1`, [mine])).rows[0];
      if (own) {
        const ok = await app.inject({ method: 'POST', url: '/fees/payments', payload: { obligationId: own.id }, headers: H(p.token) });
        assert.ok([200, 409].includes(ok.statusCode), `own-child payment path stays open (got ${ok.statusCode}: ${ok.body})`);
      }
    });
    /* PRD-2 CORRECTION (migration 083). This test previously asserted that ONLY principal+ could mark the
     * register, with a note that "no class-assignment data binds them to a class". That was true and it was
     * the defect: the separation-of-duties fallback refused the single most-used daily workflow in any school,
     * so a coordinator had to take every class's register. `app.class_assignments` now exists, so the question
     * has a real answer and the assertion changes with the model rather than being deleted.
     *
     * The replacement is STRICTLY STRONGER, not weaker: it still requires an unassigned teacher to be refused,
     * and it now also pins that the guard is not merely a role list — the audit trail must record WHICH
     * authority granted each write, so "the office did it" can never be laundered into "the class owner did". */
    test('c) the register admits the office, refuses an unassigned teacher, and stamps which authority applied', async () => {
      // Clear every assignment, so the refusal below is tested against a genuinely unbound teacher rather
      // than depending on 083's seed arithmetic. (Note the test database has NO `librarian@meridian.edu` —
      // the seeded teachers are teacher@ / teacher2@; assuming a name instead of measuring it is a mistake I
      // have now made repeatedly this session.)
      const t1 = (await sql(`SELECT id FROM app.users WHERE email='teacher@meridian.edu'`)).rows[0].id;
      await sql(`UPDATE app.class_assignments SET active=false`);

      const anyStudent = (await sql(`SELECT id FROM app.students LIMIT 1`)).rows[0].id;
      const mark = { marks: [{ studentId: anyStudent, status: 'present' }] };

      const unbound = await loginAs(app, 'teacher@meridian.edu');
      const refused = await app.inject({ method: 'POST', url: '/attendance/mark', payload: mark, headers: H(unbound.token) });
      assert.equal(refused.statusCode, 403,
        'a teacher with no class assignment must still be refused — the door opened, the default did not');

      // The office may mark any class: that authority did not disappear, it stopped being the ONLY authority.
      const pr = await loginAs(app, 'principal@meridian.edu');
      const ok = await app.inject({ method: 'POST', url: '/attendance/mark', payload: mark, headers: H(pr.token) });
      assert.equal(ok.statusCode, 200, ok.body);
      // DAT-6 rewrote the register audit from one summary row ("Marked attendance") to one row per changed
      // student ("Attendance for …"). The authority stamp moved with it, so read the per-student row shape.
      const ledger = await sql(`SELECT outcome FROM app.audit_log WHERE action ILIKE 'Attendance for %' ORDER BY created_at DESC LIMIT 1`);
      assert.ok(ledger.rows[0], 'the register writes an audit row');
      assert.match(ledger.rows[0].outcome, /principal office/,
        'the OFFICE authority must be stamped into the audit trail, not inferred from the actor\'s role');
    });
    test('d) unattributed funnel conversions cannot be approved by the owning desk; owner decides', async () => {
      const o = await loginAs(app, 'owner@meridian.edu');
      const en = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/enable', headers: H(o.token), payload: { version: '1.0.0', class: 'C' } });
      assert.equal(en.statusCode, 200);
      // the P1-9 exploit path, end to end: the PRINCIPAL accepts an admission offer
      // (raising an unattributed students.create action), then tries to approve it
      const pr = await loginAs(app, 'principal@meridian.edu');
      const lead = await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/leads',
        payload: { studentName: 'L1 Probe Kid', guardianName: 'L1 Guardian', guardianPhone: '9876511111', classApplied: '6-B' }, headers: H(pr.token) });
      assert.equal(lead.statusCode, 200, lead.body);
      const leadId = lead.json().leadId;
      for (const to of ['form', 'interaction', 'offer', 'enrolled']) {
        const mv = await app.inject({ method: 'POST', url: `/plugins/admissions.funnel/leads/${leadId}/stage`, payload: { to }, headers: H(pr.token) });
        assert.equal(mv.statusCode, 200, `${to}: ${mv.body}`);
      }
      const act = (await sql(`SELECT id FROM app.actions WHERE payload->>'leadId'=$1`, [leadId])).rows[0];
      assert.ok(act, 'students.create action raised');
      const selfDesk = await app.inject({ method: 'POST', url: `/actions/${act.id}/decide`, payload: { decision: 'approved' }, headers: H(pr.token) });
      assert.equal(selfDesk.statusCode, 403, 'principal cannot approve their own unattributed conversion');
      const ownerDecides = await app.inject({ method: 'POST', url: `/actions/${act.id}/decide`, payload: { decision: 'approved' }, headers: H(o.token) });
      assert.equal(ownerDecides.statusCode, 200, ownerDecides.body);
    });
    test('d-control) a lower desk\'s attributed notice is still approvable by the principal (health.clinic shape)', async () => {
      // OVR-4: the real clinic raise now stamps a proposer; a principal approving a coordinator's
      // notice is a genuine second authority, so it must still work.
      const proposer = (await sql(`SELECT id FROM app.users WHERE tenant_id=$1 AND role='coordinator' LIMIT 1`, [T])).rows[0];
      const act = (await sql(`INSERT INTO app.actions (tenant_id, code, kind, title, detail, why, priority, status, owner, owner_role, policy_ref, ai_involved, source_event, payload)
        VALUES ($1,'act_l1_clinic','approval','Guardian notice: sent home','clinic notice','duty of care','normal','open',NULL,'principal','Comms §1.2',false,'l1-visit-ref',$2::jsonb) RETURNING id`, [T,
        JSON.stringify({ kind: 'message', visitId: 'l1-visit-ref', audience: 'guardians', channel: 'WhatsApp', template: 'CLINIC_SENT_HOME', proposed_by: proposer.id, proposed_by_role: 'coordinator' })])).rows[0];
      const pr = await loginAs(app, 'principal@meridian.edu');
      const ok = await app.inject({ method: 'POST', url: `/actions/${act.id}/decide`, payload: { decision: 'approved' }, headers: H(pr.token) });
      assert.equal(ok.statusCode, 200, `clinic guardian-notice flow must keep working: ${ok.body}`);
    });
    test('d-general) ANY unattributed raise is refused to its owning desk (OVR-4)', async () => {
      const act = (await sql(`INSERT INTO app.actions (tenant_id, code, kind, title, detail, why, priority, status, owner, owner_role, policy_ref, ai_involved, payload)
        VALUES ($1,'act_l1_unattributed','approval','Unattributed notice','no proposer','sod','normal','open',NULL,'principal','Test §1',false,$2::jsonb) RETURNING id`, [T,
        JSON.stringify({ kind: 'message', audience: 'guardians', template: 'X' })])).rows[0];
      const pr = await loginAs(app, 'principal@meridian.edu');
      const denied = await app.inject({ method: 'POST', url: `/actions/${act.id}/decide`, payload: { decision: 'approved' }, headers: H(pr.token) });
      assert.equal(denied.statusCode, 403, 'an unattributed raise cannot be self-approved by the owning desk');
    });
  });

  // ── T106 ────────────────────────────────────────────────────────────────────
  describe('T106 · razorpay rails are RLS-pinned', () => {
    test('FORCE RLS is on and the app role sees only its own tenant\'s rows', async () => {
      for (const tbl of ['order_log', 'webhook_log']) {
        const flags = await sql(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='plugin_razorpay' AND c.relname=$1`, [tbl]);
        assert.ok(flags.rows[0].relrowsecurity && flags.rows[0].relforcerowsecurity, `${tbl} must be ENABLE+FORCE RLS`);
      }
      await sql(`INSERT INTO plugin_razorpay.webhook_log (tenant_id, event_id, event_type) VALUES ($1,'evt-l1-a','payment.captured'), ($2,'evt-l1-b','payment.captured')`, [T, TB]);
      const probe = (tenant) => sqlTx([
        { text: `SET ROLE schoolos_app` },
        { text: `SELECT set_config('schoolos.tenant_id', $1, true)`, params: [tenant] },
        { text: `SELECT count(*)::int n FROM plugin_razorpay.webhook_log` },
      ]);
      assert.equal((await probe(T))[2].rows[0].n, 1, 'tenant A sees only its own webhook row');
      assert.equal((await probe(TB))[2].rows[0].n, 1, 'tenant B sees only its own webhook row');
    });
  });

  // ── T107 ────────────────────────────────────────────────────────────────────
  describe('T107 · audit ledger stays append-only for the app role', () => {
    test('UPDATE is denied', async () => {
      const entry = (await sql(`SELECT id FROM app.audit_log LIMIT 1`)).rows[0];
      await assert.rejects(
        sqlTx([{ text: `SET ROLE schoolos_app` }, { text: `UPDATE app.audit_log SET actor='tampered' WHERE id=$1`, params: [entry.id] }]),
        (e) => /permission denied/i.test(String(e.message)));
    });
    test('DELETE is denied', async () => {
      const entry = (await sql(`SELECT id FROM app.audit_log LIMIT 1`)).rows[0];
      await assert.rejects(
        sqlTx([{ text: `SET ROLE schoolos_app` }, { text: `DELETE FROM app.audit_log WHERE id=$1`, params: [entry.id] }]),
        (e) => /permission denied/i.test(String(e.message)));
    });
  });

  // ── T108 ────────────────────────────────────────────────────────────────────
  describe('T108 · case-insensitive email uniqueness per tenant', () => {
    test('the functional unique index exists and its name matches onboarding\'s 409 mapper', async () => {
      const idx = await sql(`SELECT indexname FROM pg_indexes WHERE schemaname='app' AND tablename='users' AND indexname='users_email_tenant_unique_lower_idx'`);
      assert.equal(idx.rows.length, 1, '054 functional index present');
      /* TST-4: this matched a regex against a LITERAL string — `assert.match('users_email_tenant_unique_lower_idx',
         /users_.*unique/)` is true by construction and could never fail, whatever the database contained. The
         claim is that the index NAME is load-bearing for the 409 mapping, so the honest assertion compares the
         DATABASE's index name with the name the mapper actually looks for. */
      const actual = idx.rows[0].indexname;
      // The mapper (onboarding.js:120) decides 409-vs-500 by testing the CONSTRAINT NAME it gets back from
      // Postgres against a regex. So the load-bearing fact is that the index really is named to match that
      // predicate — rename the index and every duplicate-email signup becomes a 500. Asserting the predicate
      // against a literal string (what this test used to do) proves nothing; asserting it against the name the
      // DATABASE reports is the claim.
      const PREDICATE = /users_.*unique|unique.*users_/iu;
      const onboarding = readFileSync(join(SERVER_ROOT, 'src', 'onboarding.js'), 'utf8');
      assert.ok(onboarding.includes('users_.*unique|unique.*users_'),
        'onboarding.js still maps 409 by this predicate — if you change it, change this test with it');
      assert.match(actual, PREDICATE,
        `the index is named "${actual}", which the 409 mapper does NOT recognise — a duplicate email would answer 500`);
    });
    test('duplicate differing-case email in one tenant is refused (001\'s case-sensitive UNIQUE alone would allow it)', async () => {
      await sql(`INSERT INTO app.users (tenant_id, email, name, role, password_hash) VALUES ($1, 'CaseProbe@Sprint.Test', 'Case Probe', 'teacher', 'not-a-real-hash')`, [T]);
      await assert.rejects(
        sql(`INSERT INTO app.users (tenant_id, email, name, role, password_hash) VALUES ($1, 'caseprobe@sprint.test', 'Case Probe 2', 'teacher', 'not-a-real-hash')`, [T]),
        (e) => e.code === '23505' && e.constraint === 'users_email_tenant_unique_lower_idx');
    });
  });

  // ── T109 ────────────────────────────────────────────────────────────────────
  describe('T109 · audit_append pins the tenant', () => {
    const call = (guc, tenant) => sqlTx([
      { text: `SET ROLE schoolos_app` },
      { text: `SELECT set_config('schoolos.tenant_id', $1, true)`, params: [guc] },
      { text: `SELECT * FROM app.audit_append($1, 'probe','teacher.role','l1 pin probe','T','ref',null,null,false,'low','o',NULL,'probe-hash', now())`, params: [tenant] },
    ]);
    test('app-role call for ANOTHER tenant raises (42501)', async () => {
      await assert.rejects(call(T, TB), (e) => e.code === '42501' || /tenant pin/i.test(String(e.message)));
    });
    test('app-role call for its OWN tenant appends (chain intact)', async () => {
      const r = await call(T, T);
      assert.equal(r[2].rows[0].tenant_id, T);
      assert.notEqual(r[2].rows[0].prev_hash, 'GENESIS', 'row chained onto the existing ledger');
    });
    test('owner path (BYPASSRLS, no GUC) stays exempt — migrations/seed keep working', async () => {
      const r = await sql(`SELECT * FROM app.audit_append($1, 'system','system','owner-path probe','T','ref',null,null,false,'low','o',NULL,'probe-hash-2', now())`, [TB]);
      assert.equal(r.rows[0].tenant_id, TB);
    });
  });
});
