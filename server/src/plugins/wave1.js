// Wave-1 plugin runtimes (docs/11 §2.2/§2.3) — the approved wave-1 set:
//   comms.whatsapp · payments.upi · transport.gps · ops.timetable
// The loop is the OS: EVENT → POLICY → AI/REASON → APPROVAL → ACTION → VERIFICATION → AUDIT.
// No plugin bypasses the kernel: sends ride the orchestrator (+ receipts), money settles
// kernel-side, transport raises approval-required actions, timetable writes are audited.
// All writes run through withUser (RLS) with the caller's tenant + role.
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { checkEventBudget } from '../governance.js';

const ADEVA = { lat: 12.9352, lng: 77.6245 };   // demo campus anchor (Koramangala, Bengaluru)
const STREETS = ['80 Feet Rd', '5th Block', 'Jyoti Nivas', 'W Catalyst', 'Sector 12 bridge', 'HSR loop'];

export function registerPluginRuntimes(app, { withUser, auditLog, emitEvent, requestAudit, q }) {
  const require = (...roles) => async (req, reply) => {
    await app.authenticate(req, reply);
    if (reply.sent) return;
    if (!roles.includes(req.user.role)) {
      return reply.code(403).send({ error: `role ${req.user.role} not permitted` });
    }
    return req.user;
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // comms.whatsapp — WhatsApp BSP rail beneath the kernel Communication Orchestrator.
  // Sends are NOT direct: an approved action (kind 'message') executes through the
  // orchestrator; the rail renders the DLT-registered template and emits receipts.
  // ─────────────────────────────────────────────────────────────────────────────
  app.post('/plugins/comms.whatsapp/templates', { preHandler: require('owner','itadmin') }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.name || !b.body) return reply.code(400).send({ error: 'name and body required' });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // Templates live in plugin settings (DLT registry), never as fake communication rows.
      // jsonb_set + per-key merge: template registrations accumulate, never clobber.
      const r = await c.query(
        `UPDATE app.plugins SET settings = jsonb_set(settings, '{templates}',
            COALESCE(settings->'templates', '{}'::jsonb) || jsonb_build_object($2::text, $3::jsonb), true),
         updated_at = now()
         WHERE tenant_id=$1 AND plugin_id='comms.whatsapp'
         RETURNING settings->'templates' AS templates`,
        [req.user.tenant_id, b.name, JSON.stringify({ body: b.body, dltId: b.dltId ?? null })]);
      await requestAudit(c, req.user.tenant_id, 'comms.whatsapp', {
        actor: req.user.name, action: `WhatsApp template registered: ${b.name}`, recordType: 'Plugin',
        recordRef: b.name, reason: 'DLT template registry', policyRef: 'Comms §1.2',
        risk: 'low', outcome: 'template available to the orchestrator' });
      return { templates: r.rows[0]?.templates ?? {} };
    });
  });

  app.get('/plugins/comms.whatsapp/templates', { preHandler: require('owner','itadmin','principal','coordinator','transport','finance') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const s = (await c.query(`SELECT settings FROM app.plugins WHERE tenant_id=$1 AND plugin_id='comms.whatsapp'`, [req.user.tenant_id])).rows[0];
      return { templates: s?.settings?.templates ?? {}, policyRef: 'Comms §1.2' };
    });
  });

  app.get('/plugins/comms.whatsapp/receipts', { preHandler: require('owner','itadmin','principal','coordinator','transport','finance') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `SELECT id, template, body, status, policy_ref, sent_at, delivered_at, created_at
         FROM app.communications WHERE channel='whatsapp' ORDER BY created_at DESC LIMIT 100`);
      return { receipts: r.rows };
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // payments.upi — UPI collection rails. Money-touching: creates links + records
  // signed-webhook facts; settlement is kernel-only (staff confirm, Fees §4.2).
  // ─────────────────────────────────────────────────────────────────────────────
  app.post('/plugins/payments.upi/links', { preHandler: require('finance','owner','principal') }, async (req, reply) => {
    const { obligationId } = req.body ?? {};
    if (!obligationId) return reply.code(400).send({ error: 'obligationId required' });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const o = (await c.query(`SELECT o.*, s.name AS student_name FROM app.fee_obligations o
        JOIN app.students s ON s.id = o.student_id WHERE o.id=$1 AND o.status <> 'void'`, [obligationId])).rows[0];
      if (!o) return reply.code(404).send({ error: 'obligation not found' });
      const due = BigInt(o.amount_cents) - BigInt(o.paid_cents);
      if (due <= 0n) return reply.code(409).send({ error: 'obligation already settled' });
      const linkId = `plink_${randomUUID().slice(0, 12)}`;
      const r = await c.query(
        `INSERT INTO app.payments (tenant_id, student_id, obligation_id, amount_cents, method, status)
         VALUES ($1,$2,$3,$4,'upi','initiated') RETURNING id`,
        [req.user.tenant_id, o.student_id, obligationId, due.toString()]);
      const paymentId = r.rows[0].id;
      const link = `upi://pay?pa=schoolos@${o.student_name.slice(0, 12).replace(/\s+/g, '')}&tr=${paymentId}&am=${Number(due) / 100}&cu=INR&tn=${encodeURIComponent(`Fees — ${o.label}`)}`;
      await emitEvent(c, req.user.tenant_id,
        { type: 'fees', label: `payment.link.created — ${o.student_name} · ₹${Number(due) / 100} (${o.label})`, ref: paymentId },
        'payment.link.created', { paymentId, obligationId, amountCents: due.toString(), linkId });
      await requestAudit(c, req.user.tenant_id, 'payments.upi', {
        actor: req.user.name, action: 'Payment link created', recordType: 'Payment', recordRef: paymentId,
        reason: `obligation ${o.label}`, policyRef: 'Fees §4.2', risk: 'medium',
        outcome: `link ${linkId} · ₹${Number(due) / 100} · settlement remains kernel-only` });
      return { paymentId, linkId, link, amountCents: due.toString(), studentName: o.student_name, obligationLabel: o.label };
    });
  });

  app.post('/plugins/payments.upi/webhook', async (req, reply) => {
    const sig = req.headers['x-razorpay-signature'];
    const secret = process.env.UPI_WEBHOOK_SECRET;
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    let verified = false;
    if (secret && sig) {
      const mac = createHmac('sha256', secret).update(raw).digest();
      try { verified = timingSafeEqual(mac, Buffer.from(String(sig), 'hex')); } catch { verified = false; }
      if (!verified) return reply.code(401).send({ error: 'invalid signature' });
    }
    const body = typeof req.body === 'string' ? JSON.parse(raw) : (req.body ?? {});
    const eventId = body?.payload?.payment?.entity?.id ?? body?.eventId ?? body?.event;
    if (!eventId) return reply.code(400).send({ error: 'event id required' });
    const type = body?.event ?? 'payment.captured';
    // resolve the tenant from the payment id (gateway payloads do not carry tenant context).
    // Service-path read via the owner pool: withUser cannot be opened before the tenant is
    // known (RLS would hide the row). The fact-writes below run as the constrained app role.
    const paymentId = body?.payload?.payment?.entity?.notes?.paymentId ?? body?.paymentId;
    if (!paymentId || !/^[0-9a-f-]{36}$/i.test(paymentId)) return reply.code(400).send({ error: 'paymentId (uuid) required in notes' });
    const p = (await q(`SELECT tenant_id FROM app.payments WHERE id=$1`, [paymentId])).rows[0];
    if (!p) return reply.code(404).send({ error: 'payment not found' });
    // webhook facts are tenant-resolved from the payment row, then written on that tenant's path
    await withUser(p.tenant_id, 'system', async (c) => {
      await c.query(`INSERT INTO plugin_upi.webhook_log (tenant_id, gateway, event_id, event_type, payload, signature_verified)
        VALUES ($1,'razorpay',$2,$3,$4,$5) ON CONFLICT (tenant_id, event_id) DO NOTHING`,
        [p.tenant_id, eventId, type, JSON.stringify(body).slice(0, 16384), verified]);
      await emitEvent(c, p.tenant_id,
        { type: 'fees', label: `${type} — webhook fact recorded (${eventId})`, ref: paymentId },
        type, { paymentId, eventId, verified });
      await requestAudit(c, p.tenant_id, 'payments.upi', {
        actor: 'gateway webhook', action: `UPI webhook ${type}`, recordType: 'Payment', recordRef: paymentId,
        reason: `event ${eventId}`, policyRef: 'Fees §4.2', risk: 'low',
        outcome: `fact recorded${verified ? ' · HMAC verified' : ' · dev mode (unsigned)'} · settlement untouched (kernel-only)` });
    });
    return { ok: true, outcome: 'fact recorded; settlement is kernel-only (staff confirm)' };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // transport.gps — vendor GPS ingestion: normalize positions, deterministic guard
  // (delay >= 10 → approval-required guardian notice), 30d position retention.
  // ─────────────────────────────────────────────────────────────────────────────
  app.post('/plugins/transport.gps/positions', { preHandler: require('transport','coordinator','principal','owner') }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.routeCode || typeof b.lat !== 'number' || typeof b.lng !== 'number') {
      return reply.code(400).send({ error: 'routeCode, lat, lng required' });
    }
    const delayMins = Number.isFinite(b.delayMins) ? Math.round(b.delayMins) : null;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const route = (await c.query(`SELECT id, code FROM app.routes WHERE code=$1`, [b.routeCode])).rows[0];
      if (!route) return reply.code(404).send({ error: 'route not found' });
      // budget + breaker BEFORE any write (docs/12 §10) — plugin-attributed
      const gov = await checkEventBudget(c, req.user.tenant_id, 'transport.gps', 512);
      if (!gov.allowed) {
        await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role,
          action: 'GPS ingestion rejected by governance', recordType: 'Plugin', recordRef: 'transport.gps',
          policyRef: 'Platform §10 (event budgets)', outcome: gov.code });
        return reply.code(429).send({ error: gov.code, ...gov });
      }
      const deviationM = Number.isFinite(b.deviationM) ? Math.round(b.deviationM) : null;
      const pos = await c.query(
        `INSERT INTO plugin_transport_gps.positions (tenant_id, route_code, lat, lng, delay_mins, deviation_m)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, occurred_at`,
        [req.user.tenant_id, route.code, b.lat, b.lng, delayMins, deviationM]);
      await c.query(
        `INSERT INTO app.transport_events (tenant_id, route_id, kind, delay_mins, note)
         VALUES ($1,$2,$3,$4,$5)`,
        [req.user.tenant_id, route.id, delayMins != null ? 'gps_delay' : 'gps_ping', delayMins, b.note ?? null]);
      const riders = (await c.query(`SELECT count(*)::int AS n FROM app.students WHERE bus_route=$1`, [route.code])).rows[0].n;
      const ev = await emitEvent(c, req.user.tenant_id,
        { type: 'transport', label: `GPS ping — Bus ${route.code} (${b.lat.toFixed(4)}, ${b.lng.toFixed(4)})${delayMins ? ` · +${delayMins} min` : ''}${riders ? ` · ${riders} riders` : ''}`, severity: delayMins >= 10 ? 'warn' : 'info', ref: route.code },
        'gps.position', { routeCode: route.code, lat: b.lat, lng: b.lng, delayMins, riders },
        { emittedBy: 'plugin:transport.gps', subject: `route:${route.code}`, schemaVersion: 1 });
      // deterministic guard precedes anything else (docs/11 §7): delay >= 10 → action
      let action = null;
      if (delayMins != null && delayMins >= 10) {
        const a = await c.query(
          `INSERT INTO app.actions (tenant_id, code, kind, title, detail, why, priority, status, owner, owner_role, policy_ref, ai_involved, source_event, payload)
           VALUES ($1,$2,'approval',$3,$4,$5,'high','open','Principal','principal','Transport §3.1',false,$6,$7::jsonb) RETURNING *`,
          [req.user.tenant_id, `act_${randomUUID().slice(0, 8)}`,
           `Notify ${riders} guardians — Bus ${route.code} +${delayMins} min`,
           `GPS ingestion raised this notice (template TRANSPORT_DELAY). Audience resolved from ${route.code} roster.`,
           'Transport §3.1 — delay ≥ 10 min triggers guardian notice; approval before send.',
           ev.id,
           JSON.stringify({ kind: 'message', audience: `Route ${route.code} guardians`, audienceCount: riders, channel: 'WhatsApp', template: 'TRANSPORT_DELAY', draft: `Bus ${route.code} is running approximately ${delayMins} minutes late today. Expected delay at each stop accordingly. — Transport Desk` })]);
        action = a.rows[0];
        await c.query(
          `INSERT INTO app.event_action_link (tenant_id, event_id, action_id, relation, policy_ref)
           VALUES ($1,$2,$3,'raised','Transport §3.1') ON CONFLICT DO NOTHING`,
          [req.user.tenant_id, ev.id, action.id]);
      }
      await requestAudit(c, req.user.tenant_id, 'transport.gps', {
        actor: req.user.name, action: 'GPS position ingested', recordType: 'Transport', recordRef: route.code,
        reason: b.note ?? 'vendor feed', policyRef: 'Transport §3.1', risk: 'low',
        outcome: action ? 'position recorded · approval-required notice raised' : 'position recorded' });
      return { positionId: pos.rows[0].id, riders, action };
    });
  });

  app.get('/plugins/transport.gps/positions', { preHandler: require('transport','coordinator','principal','owner') }, async (req) => {
    const { routeCode, hours = '24' } = req.query ?? {};
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // 30d retention: older rows are invisible (manifest retention policy, docs/11 §9)
      const r = await c.query(
        `SELECT route_code, lat, lng, delay_mins, deviation_m, occurred_at
         FROM plugin_transport_gps.positions
         WHERE ($1::text IS NULL OR route_code=$1) AND occurred_at > now() - interval '30 days'
           AND occurred_at > now() - ($2 || ' hours')::interval
         ORDER BY occurred_at DESC LIMIT 500`,
        [routeCode ?? null, String(Math.min(parseInt(hours, 10) || 24, 720))]);
      const latest = await c.query(
        `SELECT DISTINCT ON (route_code) route_code, lat, lng, delay_mins, occurred_at
         FROM plugin_transport_gps.positions
         WHERE occurred_at > now() - interval '30 days'
         ORDER BY route_code, occurred_at DESC`);
      // simulation seed on a quiet board — clearly labeled vendor-feed simulation
      let simulated = null;
      if (!latest.rows.length) {
        const routes = (await c.query(`SELECT code FROM app.routes ORDER BY code LIMIT 4`)).rows;
        simulated = routes.map((r, i) => ({
          routeCode: r.code,
          lat: ADEVA.lat + 0.004 * Math.sin(i * 1.7),
          lng: ADEVA.lng + 0.004 * Math.cos(i * 1.3),
          note: `vendor-feed simulation — ${STREETS[i % STREETS.length]}`,
          delayMins: i === 0 ? 12 : 0,
        }));
      }
      return { positions: r.rows, latest: latest.rows, simulated };
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // ops.timetable — Class C primitives provider: grid, slots, substitutions,
  // deterministic period-autofill. Every write audited.
  // ─────────────────────────────────────────────────────────────────────────────
  const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  app.get('/plugins/ops.timetable/grid', { preHandler: require('owner','principal','coordinator','teacher','itadmin','finance','admissions','transport','facilities','technician') }, async (req) => {
    const { dayOfWeek } = req.query ?? {};
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const periods = (await c.query(`SELECT id, seq, label, start_time, end_time, is_break FROM app.timetable_periods ORDER BY sort_idx`)).rows;
      const slots = (await c.query(
        `SELECT s.id, s.period_id, s.day_of_week, s.subject, s.teacher_name, s.room
         FROM app.timetable_slots s
         WHERE ($1::text IS NULL OR s.day_of_week=$1)
         ORDER BY s.day_of_week, s.subject`,
        [DAYS.includes(dayOfWeek) ? dayOfWeek : null])).rows;
      const subs = (await c.query(
        `SELECT su.slot_id, su.date, su.absent_teacher, su.substitute, su.status
         FROM app.timetable_substitutions su
         WHERE su.status='assigned' AND su.date = COALESCE($1::date, current_date)`,
        [req.query?.date ?? null])).rows;
      const subBySlot = new Map(subs.map(s => [s.slot_id, s.substitute]));
      return {
        periods,
        days: DAYS,
        slots: slots.map(s => ({ ...s, effectiveTeacher: subBySlot.get(s.id) ?? null })),
        substitutions: subs,
        note: 'slots are section-agnostic in v1 (one grid per school); substitutions overlay the effective teacher for the day',
      };
    });
  });

  app.post('/plugins/ops.timetable/substitutions', { preHandler: require('coordinator','principal','owner','itadmin') }, async (req, reply) => {
    const { slotId, date, substitute, reason } = req.body ?? {};
    if (!slotId || !substitute) return reply.code(400).send({ error: 'slotId and substitute required' });
    const day = date ?? new Date().toISOString().slice(0, 10);
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const slot = (await c.query(
        `SELECT s.id, s.subject, s.teacher_name, s.day_of_week, p.label, p.start_time, p.end_time
         FROM app.timetable_slots s JOIN app.timetable_periods p ON p.id = s.period_id
         WHERE s.id=$1`, [slotId])).rows[0];
      if (!slot) return reply.code(404).send({ error: 'slot not found' });
      const r = await c.query(
        `INSERT INTO app.timetable_substitutions (tenant_id, slot_id, date, absent_teacher, substitute, reason, assigned_by)
         VALUES ($1,$2,$3::date,$4,$5,$6,$7)
         ON CONFLICT (slot_id, date) DO UPDATE SET substitute=EXCLUDED.substitute, reason=EXCLUDED.reason,
           status='assigned', assigned_by=EXCLUDED.assigned_by
         RETURNING *`,
        [req.user.tenant_id, slotId, day, slot.teacher_name, substitute, reason ?? null, req.user.id]);
      const ev = await emitEvent(c, req.user.tenant_id,
        { type: 'timetable', label: `Substitution — ${slot.subject} ${slot.label} (${slot.start_time}) → ${substitute} for ${slot.teacher_name}`, ref: r.rows[0].id },
        'substitution.assigned', { slotId, date: day, absentTeacher: slot.teacher_name, substitute },
        { emittedBy: 'plugin:ops.timetable', subject: `slot:${slotId}`, schemaVersion: 1 });
      await requestAudit(c, req.user.tenant_id, 'ops.timetable', {
        actor: req.user.name, action: 'Substitution assigned', recordType: 'Plugin', recordRef: r.rows[0].id,
        reason: `${slot.subject} · ${slot.teacher_name} → ${substitute}`, policyRef: 'Platform §3 (plugin governance)',
        risk: 'low', outcome: `effective ${day} · event ${ev.id}` });
      return { substitution: r.rows[0] };
    });
  });

  // deterministic-first candidate ranking (docs/11 §7): same-subject free teachers first
  app.get('/plugins/ops.timetable/substitutions/suggest', { preHandler: require('coordinator','principal','owner','itadmin') }, async (req, reply) => {
    const { absentTeacher, dayOfWeek } = req.query ?? {};
    if (!absentTeacher) return reply.code(400).send({ error: 'absentTeacher required' });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const day = DAYS.includes(dayOfWeek) ? dayOfWeek : DAYS[(new Date().getDay() + 6) % 7];
      const missed = (await c.query(
        `SELECT s.id, s.subject, s.room, p.label, p.start_time, p.end_time, p.sort_idx
         FROM app.timetable_slots s JOIN app.timetable_periods p ON p.id = s.period_id
         WHERE s.tenant_id=$1 AND s.day_of_week=$2 AND s.teacher_name=$3 ORDER BY p.sort_idx`,
        [req.user.tenant_id, day, absentTeacher])).rows;
      const busy = new Set((await c.query(
        `SELECT DISTINCT s.teacher_name, p.sort_idx FROM app.timetable_slots s
         JOIN app.timetable_periods p ON p.id = s.period_id
         WHERE s.tenant_id=$1 AND s.day_of_week=$2`,
        [req.user.tenant_id, day])).rows.map(r => `${r.teacher_name}|${r.sort_idx}`));
      const candidates = (await c.query(
        `SELECT DISTINCT teacher_name FROM app.timetable_slots WHERE tenant_id=$1 AND teacher_name <> $2`,
        [req.user.tenant_id, absentTeacher])).rows.map(r => r.teacher_name);
      const teaches = new Set((await c.query(
        `SELECT DISTINCT teacher_name, subject FROM app.timetable_slots WHERE tenant_id=$1`,
        [req.user.tenant_id])).rows.map(r => `${r.teacher_name}|${r.subject}`));
      const suggestions = missed.map(m => ({
        slot: { id: m.id, subject: m.subject, label: m.label, start: m.start_time, end: m.end_time, room: m.room },
        candidates: candidates
          .filter(t => !busy.has(`${t}|${m.sort_idx}`)) // actually free that period
          .map(t => ({
            teacher: t,
            // same-subject teachers rank first (compared against the teacher pool, not the subject)
            score: (teaches.has(`${t}|${m.subject}`) ? 100 : 0) + (t.length % 3), // stable tiebreak
          }))
          .sort((a, b) => b.score - a.score || a.teacher.localeCompare(b.teacher))
          .slice(0, 3),
      }));
      return { day, absentTeacher, suggestions, rule: 'same-subject free teacher first, then any free teacher — deterministic ranking, never a model' };
    });
  });

  app.post('/plugins/ops.timetable/attendance/autofill', { preHandler: require('teacher','coordinator','principal') }, async (req, reply) => {
    const { date, grade, section, periodSeq } = req.body ?? {};
    if (!date || !grade || !section) return reply.code(400).send({ error: 'date, grade, section required' });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // Deterministic, idempotent, safe: insert ONLY for students with no attendance row
      // today (absent/present/human-marked rows are never touched — Attendance §1.1).
      // Single statement, unique-index-safe on concurrent replays.
      const ins = await c.query(
        `INSERT INTO app.attendance (tenant_id, student_id, school_date, status, marked_by)
         SELECT $1, s.id, $4::date, 'present', $5
         FROM app.students s
         WHERE s.tenant_id=$1 AND s.status='active' AND s.grade=$2 AND s.section=$3
           AND NOT EXISTS (
             SELECT 1 FROM app.attendance a
             WHERE a.tenant_id=$1 AND a.student_id = s.id AND a.school_date=$4::date)
         RETURNING student_id`,
        [req.user.tenant_id, grade, section, date, req.user.id]);
      const marked = ins.rows.length;
      const rosterN = (await c.query(
        `SELECT count(*)::int AS n FROM app.students
         WHERE tenant_id=$1 AND status='active' AND grade=$2 AND section=$3`,
        [req.user.tenant_id, grade, section])).rows[0].n;
      const ev = await emitEvent(c, req.user.tenant_id,
        { type: 'attendance', label: `Period autofill — ${grade}-${section} ${periodSeq ?? ''} · ${marked} unmarked marked present (${date})`, severity: 'info', ref: `${grade}-${section}` },
        'attendance.autofilled', { date, grade, section, periodSeq: periodSeq ?? null, marked },
        { emittedBy: 'plugin:ops.timetable', subject: `class:${grade}-${section}`, schemaVersion: 1 });
      await requestAudit(c, req.user.tenant_id, 'ops.timetable', {
        actor: req.user.name, action: 'Attendance period autofill', recordType: 'Plugin', recordRef: `${grade}-${section}`,
        reason: `unmarked students only · ${periodSeq ?? 'period n/a'}`, policyRef: 'Attendance §1.1', risk: 'low',
        outcome: `${marked} rows inserted · ${rosterN - marked} already marked · absences untouched` });
      return { marked, alreadyMarked: rosterN - marked, date, grade, section };
    });
  });
}
