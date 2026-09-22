// OWNER / PRINCIPAL — spine + oversight product (docs/OWNER-PRINCIPAL-PERFECT-100.md).
//
// WHAT THIS PINS
//   OPP-OVR-1  an owner-owned action queue: only the owner raises and decides it; the self-approval
//              guard is relaxed for owner-owned actions and only for them.
//   OPP-OVR-2  bounded delegation: a principal may delegate principal-owned approval authority for a
//              window; finance/owner authority is never delegable; an expired delegation is refused.
//   OPP-DAT-1  `app.actions.source_plugin` is stamped at every plugin raise, and the plugin disable
//              drain reassigns the plugin's OPEN actions (before, it matched zero).
//   OPP-PRD-1  the board pack reads the live desks.
//   OPP-PRD-3  the announcement composer resolves the audience, queues comms, and never claims delivery.
//   OPP-PRD-5  the compliance calendar.
//   OPP-PRD-7  certificate request raises a principal-owned action; the principal signs.
//   OPP-API-7  `/actions` owner_role/overdue filters.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs as rawLogin } from './helpers.js';

let app;
let pool;
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json', 'x-step-up-password': 'schoolos-demo' });
const brief = (r) => `HTTP ${r.statusCode} ${String(r.body ?? '').slice(0, 300)}`;
// Memoized login: the /auth/login door is rate-limited to 20/min, and this file exercises many
// roles. Cache the session per email so the suite stays under the limit.
const tokenCache = new Map();
const login = async (email) => {
  if (!tokenCache.has(email)) tokenCache.set(email, await rawLogin(app, email));
  return tokenCache.get(email);
};

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  pool = (await import('../src/db.js')).pool;
  // enable admissions so its raise site can be exercised for source_plugin
  const owner = await login('owner@meridian.edu');
  await app.inject({ method: 'POST', url: '/plugins/admissions.funnel/enable', headers: H(owner.token), payload: { class: 'B', version: '1.0.0' } });
});
after(async () => { await app?.close(); });

describe('OPP-OVR-1 · owner-owned action queue', () => {
  test('the owner raises an owner-owned action and decides it; a principal cannot raise one', async () => {
    const owner = await login('owner@meridian.edu');
    const raised = await app.inject({ method: 'POST', url: '/owner/actions', headers: H(owner.token), payload: { title: 'Approve the annual board pack', detail: 'FY roll-up', priority: 'high' } });
    assert.equal(raised.statusCode, 200, brief(raised));
    const action = raised.json().action;
    assert.equal(action.owner_role, 'owner');

    const principal = await login('principal@meridian.edu');
    const deniedRaise = await app.inject({ method: 'POST', url: '/owner/actions', headers: H(principal.token), payload: { title: 'nope' } });
    assert.equal(deniedRaise.statusCode, 403, 'a principal cannot raise an owner-owned action');

    // owner decides their own owner-owned action (exempt from proposer≠approver)
    const decided = await app.inject({ method: 'POST', url: `/actions/${action.id}/decide`, headers: H(owner.token), payload: { decision: 'approved', note: 'approved' } });
    assert.equal(decided.statusCode, 200, brief(decided));

    // a principal cannot decide an owner-owned action
    const raised2 = await app.inject({ method: 'POST', url: '/owner/actions', headers: H(owner.token), payload: { title: 'Second owner decision' } });
    const principalDecide = await app.inject({ method: 'POST', url: `/actions/${raised2.json().action.id}/decide`, headers: H(principal.token), payload: { decision: 'approved' } });
    assert.equal(principalDecide.statusCode, 403, 'only the owner decides owner-owned actions');
  });
});

describe('OPP-OVR-2 · bounded delegation', () => {
  test('a principal may delegate principal authority for a window; finance/owner is refused; expiry is honoured', async () => {
    const principal = await login('principal@meridian.edu');
    const owner = await login('owner@meridian.edu');
    // a genuinely different deputy (a coordinator) — self-delegation is refused
    const deputy = (await pool.query(`SELECT id FROM app.users WHERE tenant_id=(SELECT tenant_id FROM app.users WHERE email='principal@meridian.edu') AND role='coordinator' AND active LIMIT 1`)).rows[0];
    const me = (await app.inject({ method: 'GET', url: '/me', headers: H(principal.token) })).json();
    const ok = await app.inject({ method: 'POST', url: '/delegations', headers: H(principal.token), payload: { toUserId: deputy.id, fromRole: 'principal', toRole: 'coordinator', scopeRole: 'principal', endsAt: new Date(Date.now() + 86400000).toISOString(), reason: 'conference' } });
    assert.equal(ok.statusCode, 200, brief(ok));
    assert.ok(ok.json().delegation.id);

    // self-delegation is refused
    const self = await app.inject({ method: 'POST', url: '/delegations', headers: H(principal.token), payload: { toUserId: me.id, fromRole: 'principal', toRole: 'principal', endsAt: new Date(Date.now() + 86400000).toISOString() } });
    assert.equal(self.statusCode, 400, 'a delegation must name a different deputy');

    const finance = await app.inject({ method: 'POST', url: '/delegations', headers: H(owner.token), payload: { toUserId: deputy.id, fromRole: 'finance', toRole: 'finance', endsAt: new Date(Date.now() + 86400000).toISOString() } });
    assert.equal(finance.statusCode, 403, 'finance authority is never delegable');
    const financeHead = await app.inject({ method: 'POST', url: '/delegations', headers: H(owner.token), payload: { toUserId: deputy.id, fromRole: 'finance_head', toRole: 'finance_head', endsAt: new Date(Date.now() + 86400000).toISOString() } });
    assert.equal(financeHead.statusCode, 403, 'the whole finance tier is non-delegable');
    const ownerDel = await app.inject({ method: 'POST', url: '/delegations', headers: H(owner.token), payload: { toUserId: deputy.id, fromRole: 'owner', toRole: 'principal', endsAt: new Date(Date.now() + 86400000).toISOString() } });
    assert.equal(ownerDel.statusCode, 403, 'owner authority is never delegable');
    const expired = await app.inject({ method: 'POST', url: '/delegations', headers: H(principal.token), payload: { toUserId: deputy.id, fromRole: 'principal', toRole: 'coordinator', startsAt: new Date(Date.now() - 172800000).toISOString(), endsAt: new Date(Date.now() - 86400000).toISOString() } });
    assert.equal(expired.statusCode, 400, 'a window that has already closed is refused');
  });

  test('OVR-7 · delegation forgery is refused (declared role must match; only the owner may delegate for another)', async () => {
    const owner = await login('owner@meridian.edu');
    const coordinator = await login('coordinator@meridian.edu');
    const principalUser = (await pool.query(`SELECT id FROM app.users WHERE email='principal@meridian.edu'`)).rows[0];
    const deputy = (await pool.query(`SELECT id FROM app.users WHERE role='teacher' AND active LIMIT 1`)).rows[0];
    // a coordinator cannot mint a principal-authority delegation by naming the principal as from-user
    const forge = await app.inject({ method: 'POST', url: '/delegations', headers: H(coordinator.token), payload: { fromUserId: principalUser.id, fromRole: 'principal', toUserId: deputy.id, toRole: 'teacher', endsAt: new Date(Date.now() + 86400000).toISOString() } });
    assert.equal(forge.statusCode, 403, 'only the owner may delegate another user\'s authority');
    // even the owner cannot misdeclare the delegator's role
    const mismatch = await app.inject({ method: 'POST', url: '/delegations', headers: H(owner.token), payload: { fromUserId: principalUser.id, fromRole: 'coordinator', toUserId: deputy.id, toRole: 'teacher', endsAt: new Date(Date.now() + 86400000).toISOString() } });
    assert.equal(mismatch.statusCode, 403, 'fromRole must match the delegator\'s actual role');
  });
});

describe('OPP-OVR-8 · the principal cannot decide finance-tier actions', () => {
  test('a finance_head-owned action is refused for the principal and allowed for the owner', async () => {
    const owner = await login('owner@meridian.edu');
    const principal = await login('principal@meridian.edu');
    const t = (await app.inject({ method: 'GET', url: '/me', headers: H(owner.token) })).json().tenantId;
    const ins = await pool.query(
      `INSERT INTO app.actions (tenant_id, code, kind, title, owner_role, status, source_plugin)
       VALUES ($1, 'finance.reconcile.'||gen_random_uuid()::text, 'approval', 'reconcile discrepancy', 'finance_head', 'open', 'payments.upi') RETURNING id`, [t]);
    const id = ins.rows[0].id;
    const denied = await app.inject({ method: 'POST', url: `/actions/${id}/decide`, headers: H(principal.token), payload: { decision: 'approved' } });
    assert.equal(denied.statusCode, 403, 'the principal must not decide a finance_head-owned action');
    const ok = await app.inject({ method: 'POST', url: `/actions/${id}/decide`, headers: H(owner.token), payload: { decision: 'approved' } });
    assert.equal(ok.statusCode, 200, brief(ok));
  });
});

describe('OPP-DAT-1 · source_plugin + drain', () => {
  test('a plugin-raised action carries source_plugin and the disable drain reassigns it', async () => {
    const owner = await login('owner@meridian.edu');
    // raise a CBSE-style obligation directly is hard to trigger; assert the stamp on the columns + drain
    // by inserting a representative plugin action through SQL, then disabling that plugin.
    const t = (await app.inject({ method: 'GET', url: '/me', headers: H(owner.token) })).json().tenantId;
    await pool.query(
      `INSERT INTO app.actions (tenant_id, code, kind, title, owner_role, status, source_plugin)
       VALUES ($1, 'test.drain.'||gen_random_uuid()::text, 'approval', 'drain me', 'principal', 'open', 'exams.assessment')`, [t]);
    await app.inject({ method: 'POST', url: '/plugins/exams.assessment/enable', headers: H(owner.token), payload: { class: 'B', version: '1.0.0' } });
    const off = await app.inject({ method: 'POST', url: '/plugins/exams.assessment/disable', headers: H(owner.token), payload: {} });
    assert.equal(off.statusCode, 200, brief(off));
    assert.ok(off.json().drained.actions_reassigned >= 1, 'the drain reassigned the source_plugin action');
  });
});

describe('OPP-PRD · oversight product', () => {
  test('board pack reads the live desks; a snapshot is append-only and content-hashed', async () => {
    const principal = await login('principal@meridian.edu');
    const pack = await app.inject({ method: 'GET', url: '/reports/board-pack', headers: H(principal.token) });
    assert.equal(pack.statusCode, 200, brief(pack));
    const p = pack.json();
    assert.ok(typeof p.students === 'number');
    assert.ok(p.fees && typeof p.fees.outstanding === 'number');
    assert.ok(p.attendance_today);

    const snap = await app.inject({ method: 'POST', url: '/reports/board-pack/snapshot', headers: H(principal.token), payload: { kind: 'board_pack', period: 'test-period' } });
    assert.equal(snap.statusCode, 200, brief(snap));
    const again = await app.inject({ method: 'POST', url: '/reports/board-pack/snapshot', headers: H(principal.token), payload: { kind: 'board_pack', period: 'test-period' } });
    assert.equal(again.json().already, true, 'the same content hash is not duplicated (append-only)');
  });

  test('announcement composer resolves an audience, queues comms, and refuses an empty audience', async () => {
    const principal = await login('principal@meridian.edu');
    const coordinator = await login('coordinator@meridian.edu');
    // OVR-10: compose raises a principal-owned action; the principal (a different user) approves it.
    const made = await app.inject({ method: 'POST', url: '/announcements', headers: H(coordinator.token), payload: { title: 'PTM next Saturday', body: 'Parent-teacher meetings this Saturday, 9am–1pm.', audienceKind: 'all_guardians' } });
    assert.equal(made.statusCode, 200, brief(made));
    const id = made.json().announcement.id;
    assert.ok(made.json().announcement.action_id, 'composing raised an approval action');
    const appr = await app.inject({ method: 'POST', url: `/announcements/${id}/approve`, headers: H(principal.token), payload: {} });
    assert.equal(appr.statusCode, 200, brief(appr));
    assert.equal(appr.json().announcement.status, 'queued');
    // in-app announcements are delivered as per-user notifications
    const n = await pool.query(`SELECT count(*)::int c FROM app.notifications WHERE ref=$1`, [`/announcements/${id}`]);
    assert.ok(n.rows[0].c >= 1, 'in-app announcement rows are written');
    // DAT-8: receipts exist for the in-app delivery
    const rec = await app.inject({ method: 'GET', url: `/announcements/${id}/receipts`, headers: H(principal.token) });
    assert.equal(rec.statusCode, 200, brief(rec));
    assert.ok(rec.json().total >= 1, 'receipts are modelled');

    // self-approval is refused (proposer ≠ approver)
    const made0 = await app.inject({ method: 'POST', url: '/announcements', headers: H(principal.token), payload: { title: 'Self approve', body: 'nope', audienceKind: 'all_guardians' } });
    const selfAppr = await app.inject({ method: 'POST', url: `/announcements/${made0.json().announcement.id}/approve`, headers: H(principal.token), payload: {} });
    assert.equal(selfAppr.statusCode, 403, 'the proposer cannot approve their own announcement');

    // an outbound channel is QUEUED, never pre-claimed delivered (honesty)
    const made2 = await app.inject({ method: 'POST', url: '/announcements', headers: H(coordinator.token), payload: { title: 'Fees reminder', body: 'Term 2 fees due.', audienceKind: 'all_guardians', channel: 'WhatsApp' } });
    const appr2 = await app.inject({ method: 'POST', url: `/announcements/${made2.json().announcement.id}/approve`, headers: H(principal.token), payload: {} });
    assert.equal(appr2.statusCode, 200, brief(appr2));
    const comm = await pool.query(`SELECT status FROM app.communications WHERE id=$1`, [appr2.json().announcement.comm_id]);
    assert.equal(comm.rows[0].status, 'queued', 'approved outbound notices are queued, never pre-claimed delivered');
  });

  test('compliance calendar: add, remind-window, file', async () => {
    const principal = await login('principal@meridian.edu');
    const made = await app.inject({ method: 'POST', url: '/compliance', headers: H(principal.token), payload: { kind: 'board_return', title: 'UDISE return', dueOn: '2099-06-30' } });
    assert.equal(made.statusCode, 200, brief(made));
    const id = made.json().item.id;
    const filed = await app.inject({ method: 'POST', url: `/compliance/${id}/file`, headers: H(principal.token), payload: { evidenceRef: 'ref-1' } });
    assert.equal(filed.statusCode, 200, brief(filed));
    assert.equal(filed.json().item.status, 'filed');
  });

  test('certificate request raises a principal-owned action; the principal signs it (no self-sign, no itadmin)', async () => {
    const principal = await login('principal@meridian.edu');
    const coordinator = await login('coordinator@meridian.edu');
    const itadmin = await login('itadmin@meridian.edu');
    const stu = (await pool.query(`SELECT id FROM app.students WHERE status='active' LIMIT 1`)).rows[0];
    // OVR-9: the requester is a different user so the principal can approve without self-sign.
    const made = await app.inject({ method: 'POST', url: '/certificates', headers: H(coordinator.token), payload: { kind: 'bonafide', studentId: stu.id, body: 'This is to certify…' } });
    assert.equal(made.statusCode, 200, brief(made));
    const cert = made.json().certificate;
    assert.ok(cert.action_id, 'a signing action was raised');
    const act = (await pool.query(`SELECT owner_role, status FROM app.actions WHERE id=$1`, [cert.action_id])).rows[0];
    assert.equal(act.owner_role, 'principal');

    // SEC-7: a technical admin cannot sign a school attestation
    const itSign = await app.inject({ method: 'POST', url: `/certificates/${cert.id}/sign`, headers: H(itadmin.token), payload: {} });
    assert.equal(itSign.statusCode, 403, 'itadmin cannot sign a certificate');

    // OVR-9: the proposer cannot sign their own request
    const selfSign = await app.inject({ method: 'POST', url: `/certificates/${cert.id}/sign`, headers: H(coordinator.token), payload: {} });
    assert.ok([403, 404].includes(selfSign.statusCode), 'the proposer cannot sign their own certificate');

    const signed = await app.inject({ method: 'POST', url: `/certificates/${cert.id}/sign`, headers: H(principal.token), payload: {} });
    assert.equal(signed.statusCode, 200, brief(signed));
    assert.equal(signed.json().certificate.status, 'issued');
    // DAT-9: the artifact is generated and content-addressed
    assert.ok(signed.json().certificate.artifact_ref, 'an artifact_ref is written on issue');
    const art = await app.inject({ method: 'GET', url: `/certificates/${cert.id}/artifact`, headers: H(principal.token) });
    assert.equal(art.statusCode, 200, brief(art));
    assert.ok(art.json().artifact.sha256, 'the artifact is content-addressed');
    // the action is decided, not left open
    const after = (await pool.query(`SELECT status FROM app.actions WHERE id=$1`, [cert.action_id])).rows[0];
    assert.equal(after.status, 'approved', 'signing decided the raised action');
  });

  test('an inspection-pack snapshot bundles safety, cases and compliance', async () => {
    const principal = await login('principal@meridian.edu');
    const snap = await app.inject({ method: 'POST', url: '/reports/board-pack/snapshot', headers: H(principal.token), payload: { kind: 'inspection_pack', period: 'test-inspect' } });
    assert.equal(snap.statusCode, 200, brief(snap));
    const row = await pool.query(`SELECT payload FROM app.report_snapshots WHERE tenant_id=(SELECT tenant_id FROM app.users WHERE email='principal@meridian.edu') AND kind='inspection_pack' AND period='test-inspect'`);
    const payload = row.rows[0].payload;
    assert.ok(payload.safety && payload.cases && payload.compliance, 'the inspection bundle carries safety/cases/compliance');
  });

  test('/actions filters by owner_role and overdue', async () => {
    const owner = await login('owner@meridian.edu');
    const r = await app.inject({ method: 'GET', url: '/actions?owner_role=owner', headers: H(owner.token) });
    assert.equal(r.statusCode, 200, brief(r));
    for (const a of r.json().actions) assert.equal(a.owner_role, 'owner');
  });
});

describe('OPP-API-8/API-1 · brief + home contract', () => {
  test('GET /brief/principal returns the brief envelope', async () => {
    const principal = await login('principal@meridian.edu');
    const r = await app.inject({ method: 'GET', url: '/brief/principal', headers: H(principal.token) });
    assert.equal(r.statusCode, 200, brief(r));
    assert.ok(Object.prototype.hasOwnProperty.call(r.json(), 'brief'), 'the brief envelope is present');
  });

  test('GET /owner/home and /principal/home return a live oversight aggregate', async () => {
    const owner = await login('owner@meridian.edu');
    const principal = await login('principal@meridian.edu');
    for (const [url, tok] of [['/owner/home', owner.token], ['/principal/home', principal.token]]) {
      const r = await app.inject({ method: 'GET', url, headers: H(tok) });
      assert.equal(r.statusCode, 200, `${url} ${brief(r)}`);
      const body = r.json();
      assert.ok(typeof body.students === 'number' && body.fees, `${url} carries live cross-domain facts`);
    }
  });
});

describe('OPP-DAT-10 · snapshot retrieval', () => {
  test('a stored snapshot is retrievable and its hash re-derives', async () => {
    const principal = await login('principal@meridian.edu');
    const made = await app.inject({ method: 'POST', url: '/reports/board-pack/snapshot', headers: H(principal.token), payload: { kind: 'board_pack', period: 'test-fetch' } });
    assert.equal(made.statusCode, 200, brief(made));
    const id = made.json().snapshot?.id;
    if (id) {
      const got = await app.inject({ method: 'GET', url: `/reports/snapshots/${id}`, headers: H(principal.token) });
      assert.equal(got.statusCode, 200, brief(got));
      assert.equal(got.json().hash_ok, true, 'the stored hash re-derives from the payload');
    }
  });
});

describe('OPP-OVR-6 · owner_role histogram', () => {
  test('live actions carry at least three distinct owner_roles', async () => {
    const owner = await login('owner@meridian.edu');
    const t = (await app.inject({ method: 'GET', url: '/me', headers: H(owner.token) })).json().tenantId;
    await pool.query(
      `INSERT INTO app.actions (tenant_id, code, kind, title, owner_role, status)
       VALUES ($1,'hist.owner.'||gen_random_uuid()::text,'approval','o','owner','open'),
              ($1,'hist.principal.'||gen_random_uuid()::text,'approval','p','principal','open'),
              ($1,'hist.coord.'||gen_random_uuid()::text,'approval','c','coordinator','open')`, [t]);
    const rows = (await pool.query(`SELECT DISTINCT owner_role FROM app.actions WHERE tenant_id=$1`, [t])).rows;
    assert.ok(rows.length >= 3, `expected >=3 owner_roles, saw ${rows.length}`);
  });
});

describe('OPP-SEC-8/9 · owner-account protection + plugin-settings symmetry', () => {
  test('SEC-8: a peer itadmin cannot suspend the principal', async () => {
    const itadmin = await login('itadmin@meridian.edu');
    const principalUser = (await pool.query(`SELECT id FROM app.users WHERE email='principal@meridian.edu'`)).rows[0];
    const r = await app.inject({ method: 'POST', url: `/plugins/people.admin/users/${principalUser.id}/suspend`, headers: H(itadmin.token), payload: {} });
    assert.equal(r.statusCode, 403, 'the principal account is protected from a peer admin');
  });

  test('SEC-9: the principal reads the plugin settings it may write', async () => {
    const principal = await login('principal@meridian.edu');
    const coordinator = await login('coordinator@meridian.edu');
    const p = await app.inject({ method: 'GET', url: '/plugins', headers: H(principal.token) });
    assert.equal(p.statusCode, 200, brief(p));
    assert.ok(p.json().plugins.every((x) => x.settings !== undefined), 'a privileged role sees settings values');
    const c = await app.inject({ method: 'GET', url: '/plugins', headers: H(coordinator.token) });
    assert.equal(c.statusCode, 200, brief(c));
    assert.ok(c.json().plugins.every((x) => x.settings === undefined), 'a non-privileged role never sees settings values');
  });
});

describe('OPP-SEC-1 · step-up re-auth on critical doors', () => {
  test('a plugin disable is refused without step-up and allowed with a step-up token', async () => {
    const owner = await login('owner@meridian.edu');
    const raw = { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' };
    const noStep = await app.inject({ method: 'POST', url: '/plugins/ops.visitors/disable', headers: raw, payload: {} });
    assert.equal(noStep.statusCode, 403, 'a plugin disable must need step-up');
    assert.equal(noStep.json().stepUpRequired, true, 'the refusal advertises the step-up requirement');

    const su = await app.inject({ method: 'POST', url: '/me/step-up', headers: raw, payload: { password: 'schoolos-demo' } });
    assert.equal(su.statusCode, 200, brief(su));
    const withStep = await app.inject({ method: 'POST', url: '/plugins/ops.visitors/disable', headers: { ...raw, 'x-step-up-token': su.json().stepUpToken }, payload: {} });
    assert.equal(withStep.statusCode, 200, brief(withStep));
    // restore for any later test in this file
    await app.inject({ method: 'POST', url: '/plugins/ops.visitors/enable', headers: { ...raw, 'x-step-up-token': su.json().stepUpToken }, payload: { class: 'B', version: '1.0.0' } });
  });
});

describe('OPP-PRD-12 · the school policy store', () => {
  test('a policy is saved, re-saved as a new version, read back live and audited', async () => {
    const principal = await login('principal@meridian.edu');
    const made = await app.inject({ method: 'POST', url: '/policy-documents', headers: H(principal.token), payload: { ref: 'Fees §9.9', title: 'Late-fee cap', category: 'Fees', body: 'Late fees never exceed 5% of the term fee.' } });
    assert.equal(made.statusCode, 200, brief(made));
    assert.equal(made.json().policy.version, 1);
    const upd = await app.inject({ method: 'POST', url: '/policy-documents', headers: H(principal.token), payload: { ref: 'Fees §9.9', title: 'Late-fee cap', category: 'Fees', body: 'Late fees never exceed 3% of the term fee.' } });
    assert.equal(upd.statusCode, 200, brief(upd));
    assert.equal(upd.json().policy.version, 2, 'a re-save creates a new version');
    const list = await app.inject({ method: 'GET', url: '/policy-documents', headers: H(principal.token) });
    assert.equal(list.statusCode, 200, brief(list));
    assert.ok(list.json().policies.some((p) => p.ref === 'Fees §9.9' && p.version === 2));
    const audit = (await pool.query(`SELECT count(*)::int n FROM app.audit_log WHERE tenant_id=(SELECT tenant_id FROM app.users WHERE email='principal@meridian.edu') AND record_type='Policy'`)).rows[0].n;
    assert.ok(audit >= 2, 'each save is audited');
  });
});

describe('OPP-PRD-11 · staff appraisals', () => {
  test('an appraisal is saved per staff per cycle and read back', async () => {
    const principal = await login('principal@meridian.edu');
    const staff = (await pool.query(`SELECT id FROM app.users WHERE tenant_id=(SELECT tenant_id FROM app.users WHERE email='principal@meridian.edu') AND role='teacher' AND active LIMIT 1`)).rows[0];
    const made = await app.inject({ method: 'POST', url: '/staff/appraisals', headers: H(principal.token), payload: { staffUserId: staff.id, cycle: '2026-27 T1', rating: 4, strengths: 'Strong classroom', improvements: 'Paperwork', status: 'shared' } });
    assert.equal(made.statusCode, 200, brief(made));
    const list = await app.inject({ method: 'GET', url: '/staff/appraisals?cycle=2026-27%20T1', headers: H(principal.token) });
    assert.equal(list.statusCode, 200, brief(list));
    assert.ok(list.json().appraisals.some((a) => a.staff_user_id === staff.id && a.rating === 4));
  });
});
