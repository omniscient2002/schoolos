// Wave-1 plugin runtime tests: rails ride the kernel loop (docs/11 §2.3), timetable
// primitives are deterministic + audited. Fresh schoolos_test per file (setupTestDb).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setupTestDb, loginAs } from './helpers.js';

let app;

before(async () => {
  // fail-closed webhook posture (cycle-3 P0): the dev-unsigned mode is GONE — the
  // route refuses entirely when the secret is absent. Force '' before importing
  // app.js (dotenv never overrides existing vars) so this suite pins that posture.
  process.env.UPI_WEBHOOK_SECRET = '';
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.ready();
  // uniform lifecycle gating (redteam P2-1): module doors 409 while registered —
  // the suite owner-enables its plugins up front (audited, same as production flow).
  const owner = await loginAs(app, 'owner@meridian.edu');
  for (const [id, cls] of [['ops.timetable','C'], ['transport.gps','B'], ['comms.whatsapp','B'], ['payments.upi','B']]) {
    const en = await app.inject({ method: 'POST', url: `/plugins/${id}/enable`,
      headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' }, payload: { version: '1.0.0', class: cls } });
    if (en.statusCode !== 200) throw new Error(`enable ${id} → ${en.statusCode} ${en.body}`);
  }
});

after(async () => { if (app) await app.close(); });

const sql = (text, params = []) => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  return c.connect().then(() => c.query(text, params)).then(async r => { await c.end(); return r; });
};
const H = (t) => ({ authorization: `Bearer ${t}` });

// India-first: the school day is an IST day (UTC date lags 05:30 — past-midnight-IST
// runs would otherwise disagree with the DB's current_date)
const IST_TODAY = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

describe('wave-1 plugin runtimes', () => {
  test('ops.timetable: grid, substitution lifecycle (assign → overlay → suggest), audited', async () => {
    const c = await loginAs(app, 'coordinator@meridian.edu');
    const grid = await app.inject({ method: 'GET', url: '/plugins/ops.timetable/grid', headers: H(c.token) });
    assert.equal(grid.statusCode, 200);
    const g = grid.json();
    assert.ok(g.periods.length >= 8, 'period grid seeded');
    assert.ok(g.slots.length > 0, 'slots seeded');
    assert.equal(g.note.includes('section-agnostic'), true);

    // deterministic suggester: same-subject free teachers first, suggestions never execute
    const teacher = g.slots.find(s => s.day_of_week === 'Monday')?.teacher_name;
    assert.ok(teacher, 'a Monday teacher exists');
    const sug = await app.inject({ method: 'GET', url: `/plugins/ops.timetable/substitutions/suggest?absentTeacher=${encodeURIComponent(teacher)}&dayOfWeek=Monday`, headers: H(c.token) });
    assert.equal(sug.statusCode, 200);
    assert.ok(sug.json().rule.includes('never a model'));

    // assign a substitution for the teacher's first Monday slot
    const slot = g.slots.find(s => s.day_of_week === 'Monday' && s.teacher_name === teacher);
    const date = IST_TODAY();
    const assign = await app.inject({ method: 'POST', url: '/plugins/ops.timetable/substitutions',
      payload: { slotId: slot.id, date, substitute: 'A. Sharma' }, headers: H(c.token) });
    assert.equal(assign.statusCode, 200);
    const sub = assign.json().substitution;
    assert.equal(sub.absent_teacher, teacher);
    assert.equal(sub.status, 'assigned');

    // grid overlay shows the effective teacher for that day
    const grid2 = await app.inject({ method: 'GET', url: `/plugins/ops.timetable/grid?date=${date}`, headers: H(c.token) });
    const overlaid = grid2.json().slots.find(s => s.id === slot.id);
    assert.equal(overlaid.effectiveTeacher, 'A. Sharma');

    // teacher cannot assign (governance role-gating)
    const t = await loginAs(app, 'teacher@meridian.edu');
    const denied = await app.inject({ method: 'POST', url: '/plugins/ops.timetable/substitutions',
      payload: { slotId: slot.id, date, substitute: 'X' }, headers: H(t.token) });
    assert.equal(denied.statusCode, 403);

    // event + audit trail
    const ev = await sql(`SELECT emitted_by FROM app.events WHERE emitted_by='plugin:ops.timetable' ORDER BY created_at DESC LIMIT 1`);
    assert.ok(ev.rows[0], 'substitution event emitted under plugin provenance');
    const aud = await sql(`SELECT action FROM app.audit_log WHERE actor_role='plugin:ops.timetable' ORDER BY created_at DESC LIMIT 1`);
    assert.match(aud.rows[0].action, /Substitution assigned/);
  });

  test('ops.timetable: period autofill is deterministic — unmarked only, absences untouched, idempotent', async () => {
    const p = await loginAs(app);
    // 8-B seed: some students absent (human-marked), rest unmarked
    const victims = (await sql(`SELECT id FROM app.students WHERE grade='8' AND section='B' ORDER BY admission_no LIMIT 2`)).rows;
    await sql(`INSERT INTO app.attendance (tenant_id, student_id, school_date, status)
               SELECT tenant_id, id, current_date, 'absent' FROM app.students WHERE id = ANY($1)`, [victims.map(v => v.id)]);
    const before = (await sql(`SELECT count(*)::int n FROM app.attendance WHERE school_date=current_date`)).rows[0].n;

    const r1 = await app.inject({ method: 'POST', url: '/plugins/ops.timetable/attendance/autofill',
      payload: { date: IST_TODAY(), grade: '8', section: 'B' }, headers: H(p.token) });
    assert.equal(r1.statusCode, 200);
    const { marked, alreadyMarked } = r1.json();
    assert.equal(marked + alreadyMarked > 0, true);
    const after1 = (await sql(`SELECT count(*)::int n FROM app.attendance WHERE school_date=current_date`)).rows[0].n;
    assert.equal(after1, before + marked, 'only unmarked rows inserted');
    // absences untouched
    const abs = await sql(`SELECT status FROM app.attendance WHERE student_id=$1 AND school_date=current_date`, [victims[0].id]);
    assert.equal(abs.rows[0].status, 'absent', 'human-marked absence never overwritten');

    // idempotent replay
    const r2 = await app.inject({ method: 'POST', url: '/plugins/ops.timetable/attendance/autofill',
      payload: { date: IST_TODAY(), grade: '8', section: 'B' }, headers: H(p.token) });
    assert.equal(r2.json().marked, 0, 'replay marks nobody new');
    const after2 = (await sql(`SELECT count(*)::int n FROM app.attendance WHERE school_date=current_date`)).rows[0].n;
    assert.equal(after2, after1);
  });

  test('transport.gps: ingestion → deterministic guard → approval-required notice → lineage → audit', async () => {
    const tr = await loginAs(app, 'transport@meridian.edu');
    const HH = { ...H(tr.token), 'content-type': 'application/json' };
    const res = await app.inject({ method: 'POST', url: '/plugins/transport.gps/positions',
      payload: { routeCode: 'Route 7', lat: 12.9352, lng: 77.6245, delayMins: 13, note: 'vendor feed' }, headers: HH });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.positionId, 'position recorded');
    assert.ok(body.riders > 0, 'riders resolved');
    assert.equal(body.action.kind, 'approval', 'delay ≥ 10 raises approval-required notice');
    assert.equal(body.action.status, 'open');
    assert.equal(body.action.payload.template, 'TRANSPORT_DELAY');

    // below threshold → no action
    const quiet = await app.inject({ method: 'POST', url: '/plugins/transport.gps/positions',
      payload: { routeCode: 'Route 7', lat: 12.936, lng: 77.625, delayMins: 4 }, headers: HH });
    assert.equal(quiet.json().action, null);

    // lineage link event → action (the spine)
    const link = await sql(
      `SELECT l.relation FROM app.event_action_link l JOIN app.events e ON e.id = l.event_id
       WHERE e.emitted_by='plugin:transport.gps' AND l.action_id=$1`, [body.action.id]);
    assert.equal(link.rows[0].relation, 'raised');

    // audit with plugin provenance (approval-raising entry from the ≥10min call)
    const aud = await sql(`SELECT outcome FROM app.audit_log WHERE actor_role='plugin:transport.gps'
      AND outcome LIKE '%approval-required%' LIMIT 1`);
    assert.ok(aud.rows[0], 'approval-raising ingest audited');
  });

  test('payments.upi: link creation respects kernel invariants; webhook records facts, never settles', async () => {
    const fin = await loginAs(app, 'finance@meridian.edu');
    const FH = { ...H(fin.token), 'content-type': 'application/json' };
    // an unsettled obligation from seed (seed uses status 'open')
    const o = (await sql(`SELECT id FROM app.fee_obligations WHERE status IN ('open','partial') AND paid_cents < amount_cents LIMIT 1`)).rows[0];
    assert.ok(o, 'an open obligation exists');
    const link = await app.inject({ method: 'POST', url: '/plugins/payments.upi/links', payload: { obligationId: o.id }, headers: FH });
    assert.equal(link.statusCode, 200);
    const { paymentId, linkId } = link.json();
    assert.match(linkId, /^plink_/);
    assert.match(link.json().link, /^upi:\/\//);

    // money invariant: the link must NOT settle anything
    const ob = await sql(`SELECT status, paid_cents FROM app.fee_obligations WHERE id=$1`, [o.id]);
    assert.notEqual(ob.rows[0].status, 'paid', 'link creation never settles');

    // webhook (fail-closed posture, cycle-3 P0): with UPI_WEBHOOK_SECRET forced empty
    // in before(), the route is OFF → unsigned is 403 'webhook not configured', never 200
    const whOff = await app.inject({ method: 'POST', url: '/plugins/payments.upi/webhook',
      payload: { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_TEST1', notes: { paymentId } } } } } });
    assert.equal(whOff.statusCode, 403, 'secret unset → webhook refused entirely');
    assert.match(whOff.json().error, /not set up/); // plain-language copy pass
    const logOff = await sql(`SELECT count(*)::int n FROM plugin_upi.webhook_log WHERE event_id='pay_TEST1'`);
    assert.equal(logOff.rows[0].n, 0, 'no facts recorded while unconfigured');
    const ob2 = await sql(`SELECT status FROM app.fee_obligations WHERE id=$1`, [o.id]);
    assert.notEqual(ob2.rows[0].status, 'paid', 'webhook never settles the ledger');

    // settlement is staff-only through the kernel
    const staff = await app.inject({ method: 'POST', url: `/fees/payments/${paymentId}/confirm`, payload: {}, headers: { ...H(fin.token), 'content-type': 'application/json' } });
    assert.equal(staff.statusCode, 200, 'kernel confirm path still works');

    // teacher cannot create links
    const t = await loginAs(app, 'teacher@meridian.edu');
    const denied = await app.inject({ method: 'POST', url: '/plugins/payments.upi/links', payload: { obligationId: o.id }, headers: H(t.token) });
    assert.equal(denied.statusCode, 403);
  });

  test('comms.whatsapp: DLT template registry in settings + receipts surface; teacher denied', async () => {
    const o = await loginAs(app, 'owner@meridian.edu');
    const OH = { ...H(o.token), 'content-type': 'application/json' };
    const reg = await app.inject({ method: 'POST', url: '/plugins/comms.whatsapp/templates',
      payload: { name: 'fee_digest', body: 'Dear guardian, {{fee_due}} is due. Pay: {{pay_link}}', dltId: 'DLT-1001' }, headers: OH });
    assert.equal(reg.statusCode, 200);
    assert.equal(reg.json().templates.fee_digest.dltId, 'DLT-1001');
    // merge-upsert semantics
    const reg2 = await app.inject({ method: 'POST', url: '/plugins/comms.whatsapp/templates',
      payload: { name: 'absence_notice', body: '{{student}} was marked absent today.' }, headers: OH });
    assert.equal(Object.keys(reg2.json().templates).length, 2, 'templates accumulate');
    const list = await app.inject({ method: 'GET', url: '/plugins/comms.whatsapp/templates', headers: H(o.token) });
    assert.equal(list.json().templates.absence_notice.body.includes('{{student}}'), true);

    const t = await loginAs(app, 'teacher@meridian.edu');
    const denied = await app.inject({ method: 'POST', url: '/plugins/comms.whatsapp/templates', payload: { name: 'x', body: 'y' }, headers: H(t.token) });
    assert.equal(denied.statusCode, 403);
  });

  test('registry integrity: ops.timetable listed; catalog enable preserves the server manifest', async () => {
    const p = await loginAs(app);
    const list = await app.inject({ method: 'GET', url: '/plugins', headers: H(p.token) });
    const tt = list.json().plugins.find(x => x.plugin_id === 'ops.timetable');
    assert.ok(tt, 'ops.timetable registered');
    assert.equal(tt.class, 'C');
    assert.equal(tt.manifest.settingsSchema.properties.autofill_default.default, 'present');
    const contracts = list.json().contracts.map(x => x.capability_id);
    for (const cap of ['timetable.substitute.assign', 'attendance.period.autofill', 'suggest.substitution']) {
      assert.ok(contracts.includes(cap), `${cap} registered`);
    }
    // enable without a manifest body must not blank the catalog manifest (routes fix)
    const o = await loginAs(app, 'owner@meridian.edu');
    const en = await app.inject({ method: 'POST', url: '/plugins/ops.timetable/enable', payload: { version: '1.0.0', class: 'C' }, headers: { ...H(o.token), 'content-type': 'application/json' } });
    assert.equal(en.statusCode, 200);
    assert.ok(en.json().plugin.manifest.settingsSchema, 'catalog manifest preserved through enable');
    // restore registered state for other suites
    await sql(`UPDATE app.plugins SET status='registered', enabled_at=NULL WHERE plugin_id='ops.timetable'`);
  });
});
