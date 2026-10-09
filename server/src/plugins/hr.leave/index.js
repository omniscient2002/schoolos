import { makeLifecycleGate } from '../_shared/lifecycle-gate.js';
import { uuidParams } from '../_shared/uuid-param.js';
// hr.leave — staff leave marking + duty roster (wave 3, locked list).
// Emits staff.leave.marked.v1 / staff.leave.cancelled.v1 — the absence FACTS that
// ops.timetable consumes when its absence_feed setting is 'hr.leave' (021 contract).
// Leave marking is an office operation (principal/owner lane); the roster read is the
// coordination desk lane. Absence is a fact, not a parent notice — no comms rail use.
const ID = 'hr.leave';
export { default as manifest } from './manifest.js';

export function register(app, kernel) {
  const { withUser, requestAudit, emitEvent, require } = kernel;
  const lifecycleGate = makeLifecycleGate(kernel.sysq, ID);
  const OFFICE = ['owner', 'principal', 'itadmin']; // leave-marking authority
  const DESK = ['owner', 'principal', 'itadmin', 'coordinator', 'teacher'];

  app.post(`/plugins/${ID}/leave`, { preHandler: [require(...OFFICE), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.staffId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(b.staffId)))
      return bad(reply, 'Please pick a staff member');
    if (!b.leaveDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.leaveDate))) return bad(reply, 'Please pick a date');
    const KINDS = ['sick', 'casual', 'duty', 'comp', 'unpaid', 'training'];
    if (!KINDS.includes(b.kind)) return bad(reply, 'Choose a leave type: sick, casual, duty, comp, unpaid or training');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // staff are users: resolve within the tenant
      const staff = (await c.query(`SELECT id, name, role FROM app.users WHERE id=$1 AND tenant_id=$2`,
        [b.staffId, req.user.tenant_id])).rows[0];
      if (!staff) return bad(reply, 'We couldn\'t find that staff member', 404);
      if (staff.role === 'parent') return bad(reply, 'Parents aren\'t staff, so leave can\'t be marked for them', 400);
      // IST calendar day (cycle-5 hygiene: date math on the Asia/Kolkata clock)
      const istNow = new Date(Date.now() + 5.5 * 3600 * 1000);
      const today = istNow.toISOString().slice(0, 10);
      if (String(b.leaveDate) < today) return bad(reply, `Leave can\'t be marked in the past (today is ${today})`, 400);
      // the per-staff-day unique index is the race backstop; inside withUser a failed
      // statement aborts the transaction, so the catch must ROLLBACK TO SAVEPOINT
      // before it can query for the friendly 409
      await c.query('SAVEPOINT leave_insert');
      let r;
      try {
        r = (await c.query(
          `INSERT INTO plugin_hr.leave (tenant_id, staff_id, leave_date, kind, reason, marked_by)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, staff_id, leave_date, kind, status`,
          [req.user.tenant_id, staff.id, b.leaveDate, b.kind, b.reason ? String(b.reason).slice(0, 500) : null, req.user.id])).rows[0];
        await emitEvent(c, req.user.tenant_id,
          { type: 'hr', label: `Leave marked: ${staff.name} (${b.kind}) on ${b.leaveDate}`, ref: r.id },
          'staff.leave.marked.v1',
          { leaveId: r.id, staffId: staff.id, staffName: staff.name, leaveDate: b.leaveDate, kind: b.kind });
        await requestAudit(c, req.user.tenant_id, ID, {
          actor: req.user.name, action: `Staff leave marked (${b.kind})`, recordType: 'Leave', recordRef: r.id,
          reason: b.reason ?? 'office marking', policyRef: 'HR §1.4 · timetable absence_feed=hr.leave', risk: 'low',
          outcome: `absence fact published for ${b.leaveDate} (staff.leave.marked.v1)` });
        await c.query('RELEASE SAVEPOINT leave_insert'); // P3-4 (cycle 6): before the return — dead code otherwise
        return { ok: true, leaveId: r.id, staffId: staff.id, staffName: staff.name, leaveDate: b.leaveDate, kind: b.kind, status: r.status };
      } catch (e) {
        if (e?.code === '23505') { // leave_staff_day_unique backstop (cycle-5 P1-2 pattern)
          await c.query('ROLLBACK TO SAVEPOINT leave_insert');
          const dupe = (await c.query(
            `SELECT id FROM plugin_hr.leave WHERE tenant_id=$1 AND staff_id=$2 AND leave_date=$3 AND status='marked'`,
            [req.user.tenant_id, staff.id, b.leaveDate])).rows[0];
          return reply.code(409).send({ error: 'This staff member already has leave marked for that day', leaveId: dupe?.id });
        }
        throw e;
      }
    });
  });

  app.post(`/plugins/${ID}/leave/:id/cancel`, { preHandler: [require(...OFFICE), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const l = (await c.query(
        `SELECT id, staff_id, leave_date, kind, status FROM plugin_hr.leave WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!l) return bad(reply, 'We couldn\'t find that leave record', 404);
      if (l.status === 'cancelled') return bad(reply, 'This leave is already cancelled', 409);
      await c.query(`UPDATE plugin_hr.leave SET status='cancelled', updated_at=now() WHERE id=$1`, [l.id]);
      await emitEvent(c, req.user.tenant_id,
        { type: 'hr', label: `Leave cancelled for ${l.leave_date}`, ref: l.id },
        'staff.leave.cancelled.v1',
        { leaveId: l.id, staffId: l.staff_id, leaveDate: l.leave_date, kind: l.kind });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Staff leave cancelled', recordType: 'Leave', recordRef: l.id,
        reason: 'office correction', policyRef: 'HR §1.4', risk: 'low', outcome: 'absence fact withdrawn (staff.leave.cancelled.v1)' });
      return { ok: true, status: 'cancelled' };
    });
  });

  // duty roster for a date: who is absent (facts from this plugin) × who is present.
  // Safety (4.5): every row carries its police-verification state, and staff whose
  // verification has EXPIRED are listed in `blocked` — they must not be rostered
  // until re-verified. Missing verification warns (state 'missing') but never blocks,
  // so a school that never recorded anything is nagged, not locked out day one.
  app.get(`/plugins/${ID}/roster/:date`, { preHandler: [require(...DESK), lifecycleGate] }, async (req, reply) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(req.params.date))) return bad(reply, 'Please use a valid date (YYYY-MM-DD)');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const absent = (await c.query(
        `SELECT l.id, l.staff_id, l.kind, l.reason, u.name, u.role
         FROM plugin_hr.leave l JOIN app.users u ON u.id = l.staff_id
         WHERE l.tenant_id=$1 AND l.leave_date=$2 AND l.status='marked'
         ORDER BY u.name`, [req.user.tenant_id, req.params.date])).rows;
      const onDuty = (await c.query(
        `SELECT u.id, u.name, u.role FROM app.users u
         WHERE u.tenant_id=$1 AND u.role <> 'parent' AND u.active
           AND NOT EXISTS (SELECT 1 FROM plugin_hr.leave l
                           WHERE l.tenant_id=$1 AND l.staff_id=u.id AND l.leave_date=$2 AND l.status='marked')
         ORDER BY u.name`, [req.user.tenant_id, req.params.date])).rows;
      let verifyBy = new Map();
      try {
        // dates read as TEXT: pg returns DATE columns as JS Date objects, whose
        // toString is locale-shaped — comparing those lexicographically never matches.
        const vers = (await c.query(`SELECT user_id, to_char(expires_on,'YYYY-MM-DD') AS exp FROM app.staff_verifications`)).rows;
        verifyBy = new Map(vers.map((v) => [v.user_id, v.exp]));
      } catch { verifyBy = new Map(); } // pre-146 database: every row reads 'missing', nothing blocks
      const day = String(req.params.date);
      const stateOf = (id) => {
        if (!verifyBy.has(id)) return 'missing';
        const exp = verifyBy.get(id);
        if (exp < day) return 'expired';
        const soon = new Date(`${day}T00:00:00Z`); soon.setUTCDate(soon.getUTCDate() + 60);
        return exp <= soon.toISOString().slice(0, 10) ? 'expiring' : 'valid';
      };
      const tag = (r, staffId) => ({ ...r, verification: stateOf(staffId) });
      const blocked = [...absent, ...onDuty]
        .filter((r) => stateOf(r.staff_id ?? r.id) === 'expired')
        .map((r) => ({ staffId: r.staff_id ?? r.id, name: r.name, role: r.role,
          reason: 'Police verification expired — re-verify before rostering' }));
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Duty roster read', recordType: 'Leave', recordRef: req.params.date,
        reason: 'coordination desk', policyRef: 'HR §1.4', risk: 'low',
        outcome: `${absent.length} absent, ${onDuty.length} on duty for ${req.params.date}${blocked.length ? ` · ${blocked.length} blocked (verification expired)` : ''}` });
      return { date: req.params.date,
        absent: absent.map((a) => tag({ leaveId: a.id, staffId: a.staff_id, name: a.name, role: a.role, kind: a.kind, reason: a.reason }, a.staff_id)),
        onDuty: onDuty.map((d) => tag({ staffId: d.id, name: d.name, role: d.role }, d.id)),
        blocked };
    });
  });

  app.get(`/plugins/${ID}/leave`, { preHandler: [require(...DESK), lifecycleGate] }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const rows = (await c.query(
        `SELECT l.id, l.staff_id, l.leave_date, l.kind, l.status, l.reason, u.name AS staff_name
         FROM plugin_hr.leave l JOIN app.users u ON u.id = l.staff_id
         WHERE l.tenant_id=$1 ORDER BY l.leave_date DESC, l.created_at DESC LIMIT 200`,
        [req.user.tenant_id])).rows;
      return { leaves: rows.map((r) => ({ leaveId: r.id, staffId: r.staff_id, staffName: r.staff_name, leaveDate: r.leave_date, kind: r.kind, status: r.status, reason: r.reason })) };
    });
  });

  function bad(reply, error, code = 400) { return reply.code(code).send({ error }); }
}
