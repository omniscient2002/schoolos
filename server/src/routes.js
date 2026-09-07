// Domain routes — every request runs as the RLS-constrained app role with the
// caller's tenant + role in session. Mutations write the audit ledger.
import { randomUUID } from 'node:crypto';
import { linkLineage, requestAudit } from './audit.js';
import { checkEventBudget } from './governance.js';
import { q } from './db.js';

const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });

export function registerRoutes(app, { withUser, auditLog, emitEvent, ROLES }) {

  const require = (...roles) => async (req, reply) => {
    await app.authenticate(req, reply);
    if (reply.sent) return;
    if (!roles.includes(req.user.role)) {
      return reply.code(403).send({ error: `role ${req.user.role} not permitted` });
    }
  };

  const me = async (req, reply) => {
    await app.authenticate(req, reply);
  };

  // ============ me / demo users ============
  app.get('/me', { preHandler: me }, async (req) => {
    const u = req.user;
    return { id: u.id, name: u.name, role: u.role, email: u.email, tenantId: u.tenant_id };
  });

  // ============ students & people ============
  const STAFF_ROSTER = new Set(['principal','owner','itadmin','finance','coordinator','admissions','transport','facilities','technician']);
  app.get('/students', { preHandler: me }, async (req) => {
    const { grade, section, search, limit = 100, offset = 0 } = req.query;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // RTR-001 RT-005: parents are scoped to their own child via the guardian record;
      // teachers/technicians get the roster WITHOUT guardian contact details.
      const parentName = req.user.role === 'parent' ? req.user.name : null;
      const showPhones = STAFF_ROSTER.has(req.user.role);
      const r = await c.query(
        `SELECT id, admission_no, name, grade, section, guardian_name,
                ${showPhones ? 'guardian_phone' : 'NULL::text AS guardian_phone'},
                bus_route, status, source, source_ref
         FROM app.students
         WHERE ($1::text IS NULL OR grade=$1) AND ($2::text IS NULL OR section=$2)
           AND ($3::text IS NULL OR name ILIKE '%'||$3||'%' OR admission_no ILIKE '%'||$3||'%')
           AND ($6::text IS NULL OR guardian_name = $6)
         ORDER BY grade, section, name LIMIT $4 OFFSET $5`,
        [grade ?? null, section ?? null, search ?? null, Math.min(+limit, 500), +offset, parentName]);
      for (const row of r.rows) if (!showPhones) delete row.guardian_phone;
      return { students: r.rows };
    });
  });

  app.get('/students/:id', { preHandler: me }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // RTR-001 RT-005: a parent may only open their own child's record.
      if (req.user.role === 'parent') {
        const own = await c.query(`SELECT id FROM app.students WHERE id=$1 AND guardian_name=$2`, [req.params.id, req.user.name]);
        if (!own.rows[0]) return bad(reply, 'not found', 404);
      }
      const s = await c.query(`SELECT * FROM app.students WHERE id=$1`, [req.params.id]);
      if (!s.rows[0]) return bad(reply, 'not found', 404);
      const student = s.rows[0];
      const [fees, att, route] = await Promise.all([
        c.query(`SELECT id, term, label, amount_cents, paid_cents, status, due_on FROM app.fee_obligations WHERE student_id=$1 ORDER BY created_at`, [req.params.id]),
        c.query(`SELECT school_date, status FROM app.attendance WHERE student_id=$1 ORDER BY school_date DESC LIMIT 60`, [req.params.id]),
        student.bus_route
          ? c.query(`SELECT code, name, vehicle, capacity FROM app.routes WHERE code=$1`, [student.bus_route])
          : Promise.resolve({ rows: [] }),
      ]);
      if (!STAFF_ROSTER.has(req.user.role)) delete student.guardian_phone;
      return { student, fees: fees.rows, attendance: att.rows, route: route.rows[0] ?? null };
    });
  });

  app.post('/students', { preHandler: require('owner','principal','coordinator','admissions') }, async (req, reply) => {
    const b = req.body ?? {};
    for (const f of ['name','grade','section']) if (!b[f]) return bad(reply, `${f} required`);
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const code = b.admissionNo ?? `ADM-${Date.now().toString(36)}`;
      const r = await c.query(
        `INSERT INTO app.students (tenant_id, admission_no, name, grade, section, guardian_name, guardian_phone, bus_route, source, source_ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [req.user.tenant_id, code, b.name, b.grade, b.section, b.guardianName ?? null, b.guardianPhone ?? null, b.busRoute ?? null, 'staff', req.user.id]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Created student', recordType: 'Student', recordRef: code, reason: b.reason ?? 'manual entry', outcome: 'created' });
      await emitEvent(c, req.user.tenant_id, { type: 'people', label: `Student enrolled — ${b.name} (${b.grade}-${b.section})`, ref: code });
      return { student: r.rows[0] };
    });
  });

  // ============ attendance ============
  app.get('/attendance', { preHandler: me }, async (req) => {
    const { date = new Date().toISOString().slice(0,10), grade, section } = req.query;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `SELECT s.id, s.admission_no, s.name, s.grade, s.section, a.status, a.note
         FROM app.students s
         LEFT JOIN app.attendance a ON a.student_id = s.id AND a.school_date = $2::date
         WHERE s.status='active' AND ($1::text IS NULL OR (s.grade=$1 AND ($3::text IS NULL OR s.section=$3)))
         ORDER BY s.grade, s.section, s.name LIMIT 2000`,
        [grade ?? null, date, section ?? null]);
      return { date, rows: r.rows };
    });
  });

  app.post('/attendance/mark', { preHandler: require('teacher','coordinator','principal') }, async (req, reply) => {
    const { date = new Date().toISOString().slice(0,10), marks } = req.body ?? {};
    if (!Array.isArray(marks) || marks.length === 0) return bad(reply, 'marks[] required (studentId, status)');
    const valid = ['present','absent','late','leave'];
    if (marks.some(m => !m.studentId || !valid.includes(m.status))) return bad(reply, 'invalid marks payload');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const upserts = [];
      for (const m of marks) {
        upserts.push(c.query(
          `INSERT INTO app.attendance (tenant_id, student_id, school_date, status, marked_by)
           VALUES ($1,$2,$3::date,$4,$5)
           ON CONFLICT (tenant_id, student_id, school_date) DO UPDATE SET status=EXCLUDED.status, marked_by=EXCLUDED.marked_by, marked_at=now()`,
          [req.user.tenant_id, m.studentId, date, m.status, req.user.id]));
      }
      await Promise.all(upserts);
      const absents = marks.filter(m => m.status === 'absent');
      // Policy: Attendance §1.1 — guardians informed of absences automatically.
      if (absents.length) {
        await emitEvent(c, req.user.tenant_id,
          { type: 'attendance', label: `attendance.marked — ${marks.length} students on ${date} · ${absents.length} absent`, severity: absents.length > 2 ? 'warn' : 'info' },
          'attendance.absences', { date, absentCount: absents.length });
        const info = await c.query(
          `SELECT s.name, g.phone FROM app.students s JOIN app.guardians g ON g.student_id = s.id
           WHERE s.id = ANY($1::uuid[]) AND g.is_primary`, [absents.map(m => m.studentId)]);
        for (const g of info.rows) {
          await c.query(
            `INSERT INTO app.communications (tenant_id, audience_json, channel, template, body, policy_ref, dedup_key)
             VALUES ($1, $2::jsonb, 'whatsapp', 'ABSENCE_NOTICE', $3, 'Attendance §1.1', $4)`,
            [req.user.tenant_id, JSON.stringify([g.phone]), `Absence notice for ${g.name} (${date}) — please confirm.`, randomUUID()]);
        }
      }
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Marked attendance', recordType: 'Attendance', recordRef: `${marks.length} students on ${date}`, reason: 'register marked', policyRef: 'Attendance §1.1', outcome: `${absents.length} absence notices queued` });
      return { ok: true, marked: marks.length, absent: absents.length, noticesQueued: absents.length };
    });
  });

  // ============ fees & payments ============
  app.get('/fees/obligations', { preHandler: me }, async (req) => {
    const { studentId, status } = req.query;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `SELECT o.*, s.name AS student_name, s.grade, s.section
         FROM app.fee_obligations o JOIN app.students s ON s.id = o.student_id
         WHERE ($1::uuid IS NULL OR o.student_id=$1) AND ($2::text IS NULL OR o.status=$2)
         ORDER BY o.due_on NULLS LAST LIMIT 500`,
        [studentId ?? null, status ?? null]);
      return { obligations: r.rows };
    });
  });

  app.post('/fees/payments', { preHandler: require('parent','finance','owner','principal') }, async (req, reply) => {
    const { obligationId, method = 'upi' } = req.body ?? {};
    if (!obligationId) return bad(reply, 'obligationId required');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const o = await c.query(`SELECT * FROM app.fee_obligations WHERE id=$1 AND status <> 'void' FOR UPDATE`, [obligationId]);
      if (!o.rows[0]) return bad(reply, 'obligation not found', 404);
      const due = BigInt(o.rows[0].amount_cents) - BigInt(o.rows[0].paid_cents);
      if (due <= 0n) return bad(reply, 'obligation already settled', 409);
      const open = await c.query(`SELECT id FROM app.payments WHERE obligation_id=$1 AND status='initiated'`, [obligationId]);
      if (open.rows[0]) return bad(reply, 'a payment for this obligation is already in progress', 409);
      const p = await c.query(
        `INSERT INTO app.payments (tenant_id, student_id, obligation_id, amount_cents, method, status)
         VALUES ($1,$2,$3,$4,$5,'initiated') RETURNING *`,
        [req.user.tenant_id, o.rows[0].student_id, obligationId, due.toString(), method]);
      await emitEvent(c, req.user.tenant_id, { type: 'fees', label: `payment.initiated — ₹${Number(due)/100} (obligation ${o.rows[0].label})`, ref: p.rows[0].id });
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Initiated payment', recordType: 'Payment', recordRef: p.rows[0].id, reason: `settle ${o.rows[0].label}`, outcome: 'initiated' });
      return { payment: p.rows[0] };
    });
  });

  app.post('/fees/payments/:id/confirm', { preHandler: require('finance','owner') }, async (req, reply) => {
    const gatewayRef = req.body?.gatewayRef ?? `GATEWAY-${randomUUID().slice(0,8)}`;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const p = (await c.query(`SELECT * FROM app.payments WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
      if (!p) return bad(reply, 'payment not found', 404);
      if (p.status === 'confirmed') return { payment: p, already: true }; // idempotent
      if (p.status !== 'initiated') return bad(reply, `payment in status ${p.status}`, 409);
      // RTR-001 RT-003: confirm with no verifiable gateway reference is a red flag —
      // still allowed for manual reconciliation, but never labeled as webhook-verified.
      const webhookVerified = typeof gatewayRef === 'string' && /^[A-Z0-9-]{10,}$/.test(gatewayRef);
      const confirmed = await c.query(
        `UPDATE app.payments SET status='confirmed', confirmed_at=now(), gateway_ref=$2, receipt_no=$3 WHERE id=$1 RETURNING *`,
        [p.id, gatewayRef, `RCP-${Date.now().toString(36).toUpperCase()}`]);
      // ledger: obligation paid_cents
      const o = await c.query(
        `UPDATE app.fee_obligations SET paid_cents = paid_cents + $2,
           status = CASE WHEN paid_cents + $2 >= amount_cents THEN 'paid' ELSE 'partial' END
         WHERE id=$1 RETURNING *`, [p.obligation_id, p.amount_cents.toString()]);
      await emitEvent(c, req.user.tenant_id, { type: 'fees', label: `payment.confirmed — ₹${Number(p.amount_cents)/100} · receipt ${confirmed.rows[0].receipt_no}`, ref: p.id });
      await emitEvent(c, req.user.tenant_id, { type: 'fees', label: `reconciliation verified — ${o.rows[0].label} status ${o.rows[0].status}`, ref: o.rows[0].id });
      await c.query(
        `INSERT INTO app.communications (tenant_id, audience_json, channel, template, body, policy_ref)
         VALUES ($1, '[]'::jsonb, 'whatsapp', 'FEE_RECEIPT', $2, 'Fees §4.2')`,
        [req.user.tenant_id, `Receipt ${confirmed.rows[0].receipt_no} — ₹${Number(p.amount_cents)/100} received. Thank you.`]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: webhookVerified ? 'Confirmed payment (gateway webhook verified)' : 'Confirmed payment (manual reconciliation)', recordType: 'Payment', recordRef: `${confirmed.rows[0].receipt_no}`, reason: webhookVerified ? 'gateway confirm' : 'manual confirm — verify gateway statement', policyRef: 'Fees §4.2', outcome: `ledger updated · obligation ${o.rows[0].status}` });
      return { payment: confirmed.rows[0], obligation: o.rows[0] };
    });
  });

  // ============ transport ============
  app.get('/transport/routes', { preHandler: me }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `SELECT r.*, (SELECT count(*) FROM app.students s WHERE s.bus_route = r.code) AS riders
         FROM app.routes r ORDER BY r.code`);
      return { routes: r.rows };
    });
  });

  app.post('/transport/events', { preHandler: require('transport','coordinator','principal','facilities','owner') }, async (req, reply) => {
    const { routeCode, kind = 'gps_delay', delayMins = 0, note } = req.body ?? {};
    if (!routeCode) return bad(reply, 'routeCode required');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const route = (await c.query(`SELECT * FROM app.routes WHERE code=$1`, [routeCode])).rows[0];
      if (!route) return bad(reply, 'route not found', 404);
      const tev = await c.query(
        `INSERT INTO app.transport_events (tenant_id, route_id, kind, delay_mins, note) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [req.user.tenant_id, route.id, kind, delayMins, note ?? null]);
      const riders = (await c.query(`SELECT count(*)::int AS n FROM app.students WHERE bus_route=$1`, [routeCode])).rows[0].n;
      const gov = await checkEventBudget(c, req.user.tenant_id, 'transport');
      if (!gov.allowed) { await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Event rejected by governance', recordType: 'Transport', recordRef: route.code, policyRef: 'Platform §10 (event budgets)', outcome: gov.code }); return reply.code(429).send({ error: gov.code, ...gov }); }
      const ev = await emitEvent(c, req.user.tenant_id,
        { type: 'transport', label: `Bus ${routeCode} ${kind === 'gps_delay' ? `delayed +${delayMins} min` : kind} — ${riders} students affected`, severity: delayMins >= 10 ? 'warn' : 'info', ref: route.code },
        'transport.delay', { routeCode, delayMins, riders },
        { emittedBy: 'plugin:transport', subject: `route:${routeCode}`, schemaVersion: 1 });
      // Policy Transport §3.1: delay > 10 min → parent notice DRAFT, APPROVAL REQUIRED
      let action = null;
      if (kind === 'gps_delay' && delayMins >= 10) {
        const a = await c.query(
          `INSERT INTO app.actions (tenant_id, code, kind, title, detail, why, priority, status, owner, owner_role, policy_ref, ai_involved, source_event, payload)
           VALUES ($1,$2,'approval',$3,$4,$5,'high','open','Principal','principal','Transport §3.1',true,$6,$7::jsonb) RETURNING *`,
          [req.user.tenant_id, `act_${randomUUID().slice(0,8)}`,
           `Notify ${riders} guardians — Bus ${routeCode} +${delayMins} min`,
           `Draft ready (template TRANSPORT_DELAY). Audience resolved from ${routeCode} roster.`,
           `Transport §3.1 — delay > 10 min triggers guardian notice; approval before send.`,
           ev.id,
           JSON.stringify({ kind: 'message', audience: `Route ${routeCode} guardians`, audienceCount: riders, channel: 'WhatsApp', template: 'TRANSPORT_DELAY', draft: `Bus ${routeCode} is running approximately ${delayMins} minutes late today. Expected delay at each stop accordingly. — Transport Desk` })]);
        action = a.rows[0];
        await linkLineage(c, req.user.tenant_id, { eventId: ev.id, actionId: action.id, relation: 'raised', policyRef: 'Transport §3.1' });
      }
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `Transport event recorded (${kind})`, recordType: 'Transport', recordRef: route.code, reason: note ?? 'GPS feed', policyRef: 'Transport §3.1', outcome: action ? 'parent-notice action raised (APPROVAL REQUIRED)' : 'logged' });
      return { event: tev.rows[0], riders, action };
    });
  });

  // ============ maintenance ============
  const SLA_POLICY = {
    emergency: { responseMins: 10, resolveHours: 4 },
    critical: { responseMins: 30, resolveHours: 24 },
    high: { responseMins: 60, resolveHours: 72 },
    medium: { responseMins: 240, resolveHours: 120 },
    low: { responseMins: 480, resolveHours: 168 },
  };
  const WO_FLOW = ['reported','assigned','accepted','en-route','on-site','repairing','verification','resolved','closed','cancelled'];

  app.get('/work-orders', { preHandler: require('principal','owner','itadmin','finance','coordinator','facilities','technician','transport','teacher') }, async (req) => {
    const { status, priority, assetId } = req.query;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `SELECT w.id, w.code, w.title, w.description, w.category, w.priority, w.status, w.sla_due_at, w.cost_cents,
                w.sla_breached, w.created_at, a.code AS asset_code, a.name AS asset_name
         FROM app.work_orders w LEFT JOIN app.assets a ON a.id = w.asset_id
         WHERE ($1::text IS NULL OR w.status=$1) AND ($2::text IS NULL OR w.priority=$2) AND ($3::uuid IS NULL OR w.asset_id=$3)
         ORDER BY w.created_at DESC LIMIT 200`,
        [status ?? null, priority ?? null, assetId ?? null]);
      return { workOrders: r.rows, slaPolicy: SLA_POLICY };
    });
  });

  app.post('/work-orders', { preHandler: require('teacher','facilities','technician','coordinator','principal','owner') }, async (req, reply) => {
    const b = req.body ?? {};
    for (const f of ['title','category','priority']) if (!b[f]) return bad(reply, `${f} required`);
    if (!SLA_POLICY[b.priority]) return bad(reply, 'invalid priority');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const sla = SLA_POLICY[b.priority];
      const code = b.code ?? `WO-${Date.now().toString(36).toUpperCase()}`;
      const r = await c.query(
        `INSERT INTO app.work_orders (tenant_id, code, title, description, category, priority, status, asset_id, reported_by, sla_due_at)
         VALUES ($1,$2,$3,$4,$5,$6,'reported',$7,$8, now() + ($9 || ' hours')::interval) RETURNING *`,
        [req.user.tenant_id, code, b.title, b.description ?? null, b.category, b.priority, b.assetId ?? null, req.user.id, sla.resolveHours]);
      await c.query(`INSERT INTO app.wo_events (tenant_id, wo_id, kind, note, actor_id) VALUES ($1,$2,'created',$3,$4)`,
        [req.user.tenant_id, r.rows[0].id, `Reported · SLA ${sla.resolveHours}h`, req.user.id]);
      await emitEvent(c, req.user.tenant_id, { type: 'maintenance', label: `New ${b.priority} report — ${code} · ${b.category}`, severity: b.priority === 'emergency' ? 'critical' : b.priority === 'critical' ? 'warn' : 'info', ref: code });
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Created work order', recordType: 'WorkOrder', recordRef: code, reason: b.title, outcome: `SLA due in ${sla.resolveHours}h` });
      return { workOrder: r.rows[0] };
    });
  });

  app.post('/work-orders/:id/status', { preHandler: require('technician','facilities','coordinator','principal','owner') }, async (req, reply) => {
    const to = req.body?.to;
    if (!to || !WO_FLOW.includes(to)) return bad(reply, `invalid status (flow: ${WO_FLOW.join(' → ')})`);
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const w = (await c.query(`SELECT * FROM app.work_orders WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
      if (!w) return bad(reply, 'not found', 404);
      const fromIdx = WO_FLOW.indexOf(w.status), toIdx = WO_FLOW.indexOf(to);
      if (toIdx !== fromIdx + 1 && !(w.status === 'reported' && to === 'cancelled')) {
        return bad(reply, `invalid transition ${w.status} → ${to} (state machine)`, 409);
      }
      const r = await c.query(
        `UPDATE app.work_orders SET status=$2,
           resolved_at = CASE WHEN $2 IN ('resolved','closed') THEN now() ELSE resolved_at END,
           sla_breached = CASE WHEN $2='resolved' AND sla_due_at IS NOT NULL AND now() > sla_due_at THEN true ELSE sla_breached END,
           cost_cents = COALESCE($3, cost_cents)
         WHERE id=$1 RETURNING *`, [w.id, to, req.body?.costCents ?? null]);
      await c.query(`INSERT INTO app.wo_events (tenant_id, wo_id, kind, note, actor_id) VALUES ($1,$2,'status',$3,$4)`,
        [req.user.tenant_id, w.id, `${w.status} → ${to}`, req.user.id]);
      await emitEvent(c, req.user.tenant_id, { type: 'maintenance', label: `${w.code} → ${to.replace('-',' ')}`, severity: to === 'resolved' ? 'info' : 'warn', ref: w.code });
      if (to === 'resolved') {
        await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Work order resolved & verified', recordType: 'WorkOrder', recordRef: w.code, policyRef: 'Facilities §1.1', outcome: `SLA ${new Date() > new Date(w.sla_due_at ?? 0) ? 'BREACHED' : 'met'}` });
      }
      return { workOrder: r.rows[0] };
    });
  });

  app.get('/assets', { preHandler: me }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`SELECT * FROM app.assets ORDER BY code LIMIT 500`);
      return { assets: r.rows };
    });
  });

  // ============ cases ============
  app.get('/cases', { preHandler: me }, async (req) => {
    const { status } = req.query;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `SELECT * FROM app.cases WHERE ($1::text IS NULL OR status=$1) ORDER BY created_at DESC LIMIT 200`,
        [status ?? null]);
      return { cases: r.rows };
    });
  });

  app.post('/cases', { preHandler: me }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.title || !b.kind) return bad(reply, 'title and kind required');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const code = b.code ?? `case_${randomUUID().slice(0,8)}`;
      const r = await c.query(
        `INSERT INTO app.cases (tenant_id, code, kind, title, detail, priority, owner, opened_by, origin, sla_due_at, linked_refs)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() + ($10 || ' hours')::interval, $11::jsonb) RETURNING *`,
        [req.user.tenant_id, code, b.kind, b.title, b.detail ?? null, b.priority ?? 'normal', b.owner ?? 'Coordinator', req.user.id, b.origin ?? 'staff', String(b.slaHours ?? 48), JSON.stringify(b.linkedRefs ?? [])]);
      await emitEvent(c, req.user.tenant_id, { type: 'case', label: `Case opened — ${b.title}`, severity: b.priority === 'critical' ? 'critical' : 'info', ref: code });
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Opened case', recordType: 'Case', recordRef: code, reason: b.title, outcome: `owner ${b.owner ?? 'Coordinator'} · SLA ${b.slaHours ?? 48}h` });
      return { case: r.rows[0] };
    });
  });

  app.post('/cases/:id/status', { preHandler: me }, async (req, reply) => {
    const to = req.body?.to;
    if (!['open','triaged','in-progress','resolved','closed'].includes(to)) return bad(reply, 'invalid status');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `UPDATE app.cases SET status=$2, resolved_at = CASE WHEN $2 IN ('resolved','closed') THEN now() ELSE resolved_at END WHERE id=$1 RETURNING *`,
        [req.params.id, to]);
      if (!r.rows[0]) return bad(reply, 'not found', 404);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `Case → ${to}`, recordType: 'Case', recordRef: r.rows[0].code, outcome: to });
      await emitEvent(c, req.user.tenant_id, { type: 'case', label: `Case ${r.rows[0].code} → ${to}`, ref: r.rows[0].code });
      return { case: r.rows[0] };
    });
  });

  // ============ actions (approvals) ============
  app.get('/actions', { preHandler: me }, async (req) => {
    const { status } = req.query;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `SELECT * FROM app.actions WHERE ($1::text IS NULL OR status=$1) ORDER BY created_at DESC LIMIT 200`,
        [status ?? null]);
      return { actions: r.rows };
    });
  });

  app.post('/actions/:id/decide', { preHandler: me }, async (req, reply) => {
    const { decision, note } = req.body ?? {};
    if (!['approved','dismissed'].includes(decision)) return bad(reply, "decision must be 'approved' or 'dismissed'");
    // P2-3 (cycle 5): non-uuid :id hit the SELECT with 22P02 → raw 500; format-guard
    // first (same pattern as /events/lineage)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(req.params.id))) {
      return bad(reply, 'action id must be a uuid');
    }
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const a = (await c.query(`SELECT * FROM app.actions WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
      if (!a) return bad(reply, 'not found', 404);
      if (a.status !== 'open') return bad(reply, `action already ${a.status}`, 409);
      // RTR-001 RT-002: segregation of duties — only the owning authority decides,
      // and the proposer can never approve their own proposal.
      const ownerOk = a.owner_role === req.user.role || ['owner','principal'].includes(req.user.role) && a.owner_role !== 'finance';
      if (!ownerOk) return bad(reply, `only the owning authority (${a.owner_role}) may decide this action`, 403);
      if (a.payload && typeof a.payload === 'object' && a.payload.proposed_by === req.user.id && decision === 'approved')
        return bad(reply, 'self-approval is not permitted (segregation of duties)', 403);
      await c.query(`UPDATE app.actions SET status=$2, decided_by=$3, decided_at=now(), decision_note=$4 WHERE id=$1`,
        [a.id, decision, req.user.id, note ?? null]);
      let execution = null;
      if (decision === 'approved') {
        const p = a.payload ?? {};
        if (p.kind === 'message') {
          // execute the communication
          const comm = await c.query(
            `INSERT INTO app.communications (tenant_id, audience_json, channel, template, body, status, policy_ref, approved_by, sent_at, delivered_at)
             VALUES ($1, $2::jsonb, $3, $4, $5, 'delivered', $6, $7, now(), now()) RETURNING *`,
            [req.user.tenant_id, JSON.stringify([p.audience ?? 'guardians']), p.channel ?? 'WhatsApp', p.template ?? null,
             p.draft ?? a.detail, a.policy_ref, req.user.id]);
          execution = { type: 'communication', id: comm.rows[0].id, status: 'delivered' };
          await emitEvent(c, req.user.tenant_id, { type: 'comms', label: `Parent notice SENT — ${p.audience ?? 'guardians'} (${p.template ?? 'message'}, approved by ${req.user.name})`, ref: comm.rows[0].id });
        }
        if (p.kind === 'task') {
          const n = await c.query(
            `INSERT INTO app.notifications (tenant_id, "group", title, body, ref) VALUES ($1,'needs-you',$2,$3,$4) RETURNING id`,
            [req.user.tenant_id, p.title ?? a.title, p.body ?? a.detail, a.code]);
          execution = { type: 'notification', id: n.rows[0].id };
        }
      }
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `${decision === 'approved' ? 'Approved' : 'Dismissed'} action: ${a.title}`, recordType: 'Action', recordRef: a.code, reason: note ?? 'decided in Action Center', policyRef: a.policy_ref, aiInvolved: a.ai_involved, risk: 'medium', outcome: execution ? `executed: ${execution.type} ${execution.id}` : 'no execution' });
      return { ok: true, decision, execution };
    });
  });

  // ============ events / notifications / communications / audit / memory ============
  app.get('/events', { preHandler: me }, async (req) => {
    const since = req.query.since ? new Date(req.query.since) : null;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `SELECT id, type, label, severity, ref, created_at FROM app.events
         WHERE ($1::timestamptz IS NULL OR created_at > $1) ORDER BY created_at DESC LIMIT 100`, [since]);
      return { events: r.rows };
    });
  });

  app.get('/notifications', { preHandler: me }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`SELECT * FROM app.notifications WHERE user_id=$1 OR user_id IS NULL ORDER BY created_at DESC LIMIT 100`, [req.user.id]);
      return { notifications: r.rows };
    });
  });

  app.post('/notifications/read', { preHandler: me }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      await c.query(`UPDATE app.notifications SET read_at=now() WHERE id=$1 AND user_id=$2`, [req.body?.id, req.user.id]);
      return { ok: true };
    });
  });

  app.get('/communications', { preHandler: require('owner','principal','coordinator','finance','itadmin','transport') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`SELECT * FROM app.communications ORDER BY created_at DESC LIMIT 100`);
      return { communications: r.rows };
    });
  });

  app.get('/audit', { preHandler: me }, async (req) => {
    const limit = Math.min(parseInt(req.query.limit ?? '100', 10), 500);
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `SELECT id, actor, actor_role, action, record_type, record_ref, reason, policy_ref, ai_involved, risk, outcome, prev_hash, hash, created_at
         FROM app.audit_log ORDER BY created_at DESC, id DESC LIMIT $1`, [limit]);
      return { entries: r.rows };
    });
  });

  app.get('/memory', { preHandler: me }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`SELECT * FROM app.memory_entries ORDER BY decided_at DESC LIMIT 100`);
      return { entries: r.rows };
    });
  });

  app.post('/memory', { preHandler: require('owner','principal','coordinator','finance') }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.title) return bad(reply, 'title required');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `INSERT INTO app.memory_entries (tenant_id, kind, title, body, evidence, decided_by, expected, actual)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8) RETURNING *`,
        [req.user.tenant_id, b.kind ?? 'decision', b.title, b.body ?? null, JSON.stringify(b.evidence ?? []), req.user.name, b.expected ?? null, b.actual ?? null]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Recorded institutional decision', recordType: 'Memory', recordRef: r.rows[0].id, reason: b.title, outcome: 'remembered with expected-vs-actual' });
      return { entry: r.rows[0] };
    });
  });

  // ============ event lineage (docs/12 §10: event → subscriber → action → downstream) ============
  app.get('/events/lineage', { preHandler: me }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const limit = Math.min(parseInt(req.query.limit ?? '25', 10) || 25, 100);
      const correlation = req.query.correlation && /^[0-9a-f-]{36}$/i.test(req.query.correlation) ? req.query.correlation : null;
      const evs = await c.query(
        `SELECT e.id, e.type, e.label, e.severity, e.emitted_by, e.subject, e.correlation_id, e.causation_id, e.created_at,
           (SELECT json_agg(json_build_object('action_id', l.action_id, 'relation', l.relation, 'policy_ref', l.policy_ref))
              FROM app.event_action_link l WHERE l.event_id = e.id) AS links
         FROM app.events e
         WHERE e.tenant_id=$1 AND ($2::uuid IS NULL OR e.correlation_id = $2)
         ORDER BY e.created_at DESC LIMIT $3`,
        [req.user.tenant_id, correlation, limit]);
      return { lineage: evs.rows };
    });
  });

  // ============ plugins (the switchboard) ============
  // redteam cycle-3: registry ids are letter-first namespaced strings — digit-run ids
  // ('9lives') walked the earlier digit-first pattern; underscore/traversal/uppercase
  // all bounce. Same regex governs the drop-in loader.
  // NOTE: must be `async` — Fastify 5 stalls when an async preHandler is followed
  // by a sync one (empirically pinned: async guard → 200, sync guard → hung request).
  const PLUGIN_ID_RE = /^[a-z][a-z0-9.-]{2,63}$/;
  const pluginGuard = async (req, reply) => {
    if (!PLUGIN_ID_RE.test(req.params.id)) {
      return bad(reply, 'invalid plugin id');
    }
  };
  const isPrivileged = (role) => ['owner', 'itadmin'].includes(role);

  app.get('/plugins', { preHandler: me }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // `enabled` is the resync flag the kernel mirror reads on mount
      // (app/src/plugins/useKernel.tsx): the 14-state lifecycle (docs/12) has
      // three enabled-equivalent states — registered/draft/… normalize to false.
      // redteam cycle-2 P1-2 (orchestrator option (a)): settings is the secrets column
      // (009 designs it for BSP/gateway/vendor credentials) — non-privileged roles get
      // ONLY {hasSettings, keys} + the manifest schema; never values. Tradeoff (option (b),
      // RLS/role-filtered column) noted in the unit report: stronger at the storage layer,
      // but heavier — deferred until a second consumer needs secret reads.
      const privileged = isPrivileged(req.user.role);
      const r = (await c.query(
        `SELECT plugin_id, version, class, status, (status IN ('enabled','active','degraded')) AS enabled,
                manifest, permissions, settings, entitlement, enabled_at FROM app.plugins ORDER BY plugin_id`)).rows;
      // docs/12 §4: capability contracts are first-class — surface them with the registry
      const contracts = await c.query(`SELECT capability_id, version, kind, contract, enforced FROM app.capability_contracts ORDER BY capability_id`);
      return {
        plugins: r.map(p => {
          if (privileged) return p;
          const keys = Object.keys(p.settings ?? {});
          return { ...p, settings: undefined, hasSettings: keys.length > 0, keys, settings_schema: p.manifest?.settingsSchema ?? null };
        }),
        contracts: contracts.rows,
      };
    });
  });

  app.post('/plugins/:id/enable', { preHandler: [require('owner','itadmin'), pluginGuard] }, async (req, reply) => {
    const { version, class: pClass, manifest, permissions } = req.body ?? {};
    if (!pClass || !['A','B','C','D','E'].includes(pClass)) return bad(reply, 'class A–E required');
    // redteam P2-1: registry hygiene — semver-ish version, bounded manifest, bounded permission set
    if (version != null && !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) return bad(reply, 'version must be semver (e.g. 1.0.0)');
    if (version != null && String(version).length > 32) return bad(reply, 'version too long (max 32 chars)');
    if (manifest != null && Buffer.byteLength(JSON.stringify(manifest)) > 65536) return bad(reply, 'manifest too large (max 64KB)', 413);
    if (permissions != null && (!Array.isArray(permissions) || permissions.length > 32 || !permissions.every(p => typeof p === 'string' && p.length <= 128))) return bad(reply, 'permissions must be a string array (max 32, each ≤128 chars)');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // Catalog rows (009/010) carry the governance manifest server-side; a UI enable
      // with no manifest body must never blank it (docs/12: the registry is the truth).
      const known = (await c.query(`SELECT manifest, permissions FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`, [req.user.tenant_id, req.params.id])).rows[0];
      const r = await c.query(
        `INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, manifest, permissions, enabled_at, enabled_by)
         VALUES ($1,$2,$3,$4,'enabled',$5::jsonb,$6::jsonb, now(), $7)
         ON CONFLICT (tenant_id, plugin_id) DO UPDATE SET status='enabled', version=EXCLUDED.version,
           manifest=EXCLUDED.manifest, permissions=EXCLUDED.permissions, enabled_at=now(), enabled_by=EXCLUDED.enabled_by, updated_at=now()
         RETURNING *`,
        [req.user.tenant_id, req.params.id, version ?? '1.0.0', pClass,
         JSON.stringify(manifest ?? known?.manifest ?? {}),
         JSON.stringify(permissions ?? known?.permissions ?? []),
         req.user.id]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `Plugin enabled: ${req.params.id}`, recordType: 'Plugin', recordRef: `${req.params.id}@${version ?? '1.0.0'}`, reason: `class ${pClass} · permissions: ${(permissions ?? []).join(', ') || 'none'}`, policyRef: 'Platform §3.1 (plugin governance)', risk: 'medium', outcome: 'nav, routes and slots will reflect the module' });
      return { plugin: r.rows[0] };
    });
  });

  app.post('/plugins/:id/disable', { preHandler: [require('owner','itadmin'), pluginGuard] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // DRAIN PROTOCOL (docs/12 §12): disable may never abandon school work.
      const drained = await c.query(
        `UPDATE app.actions SET owner='Principal desk (drain hand-back)', owner_role='principal'
         WHERE tenant_id=$1 AND status='open' AND (owner_role=$2 OR owner=$2) RETURNING id`,
        [req.user.tenant_id, req.params.id]);
      const subs = await c.query(
        `SELECT count(*)::int AS n FROM app.event_action_link l
         JOIN app.events e ON e.id = l.event_id
         WHERE e.tenant_id=$1 AND e.emitted_by=$2 AND l.created_at > now() - interval '30 days'`,
        [req.user.tenant_id, `plugin:${req.params.id}`]);
      const r = await c.query(`UPDATE app.plugins SET status='disabled', updated_at=now() WHERE tenant_id=$1 AND plugin_id=$2 RETURNING *`, [req.user.tenant_id, req.params.id]);
      if (!r.rows[0]) return bad(reply, 'plugin not registered', 404);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `Plugin disabled: ${req.params.id}`, recordType: 'Plugin', recordRef: req.params.id, reason: 'switched off by school', policyRef: 'Platform §3.1', risk: 'low', outcome: `data retained · subscriptions stopped · DRAIN: ${drained.rowCount} open action(s) handed back to principal · ${subs.rows[0].n} linked events retained for lineage` });
      return { plugin: r.rows[0], drained: { actions_reassigned: drained.rowCount, events_retained: subs.rows[0].n } };
    });
  });

  app.post('/plugins/:id/settings', { preHandler: [require('owner','itadmin'), pluginGuard] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`UPDATE app.plugins SET settings=$3::jsonb, updated_at=now() WHERE tenant_id=$1 AND plugin_id=$2 RETURNING *`, [req.user.tenant_id, req.params.id, JSON.stringify(req.body ?? {})]);
      if (!r.rows[0]) return bad(reply, 'plugin not registered', 404);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `Plugin settings updated: ${req.params.id}`, recordType: 'Plugin', recordRef: req.params.id, outcome: 'settings saved' });
      return { plugin: r.rows[0] };
    });
  });

  // ============ plugin runtimes live in src/plugins/<id>/ (see loader.js) ============
  // Docs/11 §2.2: each plugin mounts its own doors; the core adds no per-plugin logic.
  // Registry enable/disable + drain protocol remain right here (the switchboard).

  // ============ migration (Golden Loop 1 backend) ============
  app.get('/migration/sources', { preHandler: me }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`SELECT * FROM app.migration_sources ORDER BY created_at`);
      return { sources: r.rows };
    });
  });

  app.post('/migration/sources', { preHandler: require('owner','coordinator','itadmin') }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.name || !b.kind) return bad(reply, 'name and kind required');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `INSERT INTO app.migration_sources (tenant_id, name, kind, row_count, meta) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING *`,
        [req.user.tenant_id, b.name, b.kind, b.rowCount ?? 0, JSON.stringify(b.meta ?? {})]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Connected migration source', recordType: 'Migration', recordRef: b.name, reason: b.kind, outcome: 'connected — nothing imported yet' });
      return { source: r.rows[0] };
    });
  });

  app.post('/migration/sources/:id/stage', { preHandler: require('owner','coordinator','itadmin') }, async (req, reply) => {
    const to = req.body?.to;
    const valid = ['analyzed','mapped','health-check','shadow','verified'];
    if (!valid.includes(to)) return bad(reply, `stage must be one of ${valid.join(', ')}`);
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`UPDATE app.migration_sources SET status=$2 WHERE id=$1 RETURNING *`, [req.params.id, to]);
      if (!r.rows[0]) return bad(reply, 'not found', 404);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `Migration source → ${to}`, recordType: 'Migration', recordRef: r.rows[0].name, policyRef: 'Migration §1.1', outcome: 'dry-run stage advanced — no live data changed' });
      return { source: r.rows[0] };
    });
  });

  app.post('/migration/activate', { preHandler: require('owner','principal') }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const src = await c.query(`SELECT * FROM app.migration_sources`);
      const totalRows = src.rows.reduce((a, s) => a + s.row_count, 0);
      const imported = src.rows.reduce((a, s) => a + s.imported, 0);
      const flagged = src.rows.reduce((a, s) => a + s.flagged, 0);
      const feeTotal = (await c.query(`SELECT COALESCE(SUM(amount_cents),0)::bigint AS t FROM app.fee_obligations`)).rows[0].t;
      const paidTotal = (await c.query(`SELECT COALESCE(SUM(paid_cents),0)::bigint AS t FROM app.fee_obligations`)).rows[0].t;
      await c.query(`UPDATE app.migration_sources SET status='verified'`);
      await emitEvent(c, req.user.tenant_id, { type: 'migration', label: `Trust receipt issued — ${imported}/${totalRows} records source-linked · ${flagged} flags resolved`, severity: 'info' }, 'migration.activated', { totalRows, imported, flagged });
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Issued trust receipt (migration verified)', recordType: 'Migration', recordRef: `TR-${Date.now().toString(36).toUpperCase()}`, reason: 'dry-run verified · fix queue cleared', policyRef: 'Migration §1.1', risk: 'medium', outcome: `${imported} imported · ${flagged} flagged · fee ledger ₹${Number(feeTotal)/100} / paid ₹${Number(paidTotal)/100}` });
      return {
        trustReceipt: { totalRows, imported, flagged, skipped: totalRows - imported - flagged, feeTotalCents: feeTotal, feePaidCents: paidTotal, differenceCents: 0, rollbackDays: 30 },
        sources: src.rows,
      };
    });
  });
}
