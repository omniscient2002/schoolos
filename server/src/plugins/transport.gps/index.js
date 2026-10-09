// transport.gps — vendor GPS ingestion: normalize positions, deterministic guard
// (delay >= threshold [setting delay_threshold_mins, default 10] → approval-required
// guardian notice), 30d position retention.
// Decoupled: zero kernel logic — mounts its own doors only (docs/11 §2.3).
const ID = 'transport.gps';
export { default as manifest } from './manifest.js';
import { makeLifecycleGate } from '../_shared/lifecycle-gate.js';
import { uuidParams } from '../_shared/uuid-param.js';
import { randomUUID } from 'node:crypto';
import { checkEventBudget } from '../../governance.js';
import { meterPlugin } from '../../plugin-usage.js'; // J7: the manifest declares positions_ingested

const ADEVA = { lat: 12.9352, lng: 77.6245 };   // demo campus anchor (Koramangala, Bengaluru)
const STREETS = ['80 Feet Rd', '5th Block', 'Jyoti Nivas', 'W Catalyst', 'Sector 12 bridge', 'HSR loop'];

export function register(app, kernel) {
  const { withUser, auditLog, requestAudit, emitEvent, require } = kernel;
  const lifecycleGate = makeLifecycleGate(kernel.sysq, 'transport.gps');

  app.post(`/plugins/${ID}/positions`, { preHandler: [require('transport','coordinator','principal','owner'), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.routeCode || typeof b.lat !== 'number' || typeof b.lng !== 'number') {
      return reply.code(400).send({ error: 'routeCode, lat, lng required' });
    }
    const delayMins = Number.isFinite(b.delayMins) ? Math.round(b.delayMins) : null;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const route = (await c.query(`SELECT id, code FROM app.routes WHERE code=$1`, [b.routeCode])).rows[0];
      if (!route) return reply.code(404).send({ error: 'route not found' });
      // budget + breaker BEFORE any write (docs/12 §10) — plugin-attributed
      // F-22: the delay threshold is a setting (default 10), not a constant.
      const threshold = await c.query(`SELECT settings->>'delay_threshold_mins' AS t FROM app.plugins WHERE tenant_id=$1 AND plugin_id='transport.gps'`, [req.user.tenant_id])
        .then((r) => { const n = Number(r.rows[0]?.t); return Number.isFinite(n) && n > 0 ? Math.round(n) : 10; })
        .catch(() => 10);
      const gov = await checkEventBudget(c, req.user.tenant_id, ID, 512);
      if (!gov.allowed) {
        await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role,
          action: 'GPS ingestion rejected by governance', recordType: 'Plugin', recordRef: ID,
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
      // J7: the manifest declares `positions_ingested` metered; count it.
      await meterPlugin(c, req.user.tenant_id, ID, 'positions_ingested');
      const riders = (await c.query(`SELECT count(*)::int AS n FROM app.students WHERE bus_route=$1`, [route.code])).rows[0].n;
      const ev = await emitEvent(c, req.user.tenant_id,
        { type: 'transport', label: `GPS ping — Bus ${route.code} (${b.lat.toFixed(4)}, ${b.lng.toFixed(4)})${delayMins ? ` · +${delayMins} min` : ''}${riders ? ` · ${riders} riders` : ''}`, severity: delayMins >= threshold ? 'warn' : 'info', ref: route.code },
        'gps.position', { routeCode: route.code, lat: b.lat, lng: b.lng, delayMins, riders },
        { emittedBy: `plugin:${ID}`, subject: `route:${route.code}`, schemaVersion: 1 });
      // deterministic guard precedes anything else (docs/11 §7): delay >= 10 → action
      let action = null;
      if (delayMins != null && delayMins >= threshold) {
        const a = await c.query(
          `INSERT INTO app.actions (tenant_id, code, kind, title, detail, why, priority, status, owner, owner_role, policy_ref, ai_involved, source_event, payload, source_plugin)
           VALUES ($1,$2,'approval',$3,$4,$5,'high','open','Principal','principal','Transport §3.1',false,$6,$7::jsonb,'transport.gps') RETURNING *`,
          [req.user.tenant_id, `act_${randomUUID().slice(0, 8)}`,
           `Notify ${riders} guardians — Bus ${route.code} +${delayMins} min`,
           `GPS ingestion raised this notice (template TRANSPORT_DELAY). Audience resolved from ${route.code} roster.`,
           `Transport §3.1 — delay ≥ ${threshold} min triggers guardian notice; approval before send.`,
           ev.id,
           JSON.stringify({ kind: 'message', audience: `${/^route\b/i.test(String(route.code)) ? route.code : `Route ${route.code}`} guardians`, routeCode: route.code, audienceCount: riders, channel: 'WhatsApp', template: 'TRANSPORT_DELAY', draft: `Bus ${route.code} is running approximately ${delayMins} minutes late today. Expected delay at each stop accordingly. — Transport Desk`, proposed_by: req.user.id, proposed_by_role: req.user.role })]);
        action = a.rows[0];
        await c.query(
          `INSERT INTO app.event_action_link (tenant_id, event_id, action_id, relation, policy_ref)
           VALUES ($1,$2,$3,'raised','Transport §3.1') ON CONFLICT DO NOTHING`,
          [req.user.tenant_id, ev.id, action.id]);
      }
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'GPS position ingested', recordType: 'Transport', recordRef: route.code,
        reason: b.note ?? 'vendor feed', policyRef: 'Transport §3.1', risk: 'low',
        outcome: action ? 'position recorded · approval-required notice raised' : 'position recorded' });
      return { positionId: pos.rows[0].id, riders, action };
    });
  });

  app.get(`/plugins/${ID}/positions`, { preHandler: [require('transport','coordinator','principal','owner'), lifecycleGate] }, async (req) => {
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
        const routes = (await c.query(`SELECT code FROM app.routes WHERE retired_at IS NULL ORDER BY code LIMIT 4`)).rows;
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

  /* ══ H1 · the transport WRITE model ═══════════════════════════════════════════
     `app.routes` / `app.route_stops` were seed-only: a self-signup school had zero routes and no
     door to create one, so the transport module was unreachable for exactly the schools it exists
     for. Retirement, never deletion — `app.route_stops` is referenced by an ON DELETE CASCADE and
     the app role holds no DELETE on these tables; `retired_at` (migration 136) is the status, so a
     retired route keeps its history and leaves every read. */

  /* The desk that owns the fleet: the transport in-charge, plus the roles that can stand in.
     The gate is spelled out at each registration rather than held in a variable — a preHandler held in
     a `const` is invisible to the route scanner, so plugin-conformance cannot see that these doors
     carry the lifecycle gate at all, and an ungated door is one enable/disable does not switch off. */
  const FLEET = ['transport', 'coordinator', 'principal', 'owner'];
  const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });
  // a route code is what the roster, the GPS feed and every notice key on — bound it hard
  const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,15}$/;
  const cleanCode = (v) => String(v ?? '').trim().toUpperCase();

  app.get(`/plugins/${ID}/routes`, { preHandler: [require(...FLEET), lifecycleGate] }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const rows = (await c.query(
        `SELECT r.id, r.code, r.name, r.vehicle, r.capacity, r.permit_capacity, r.created_at,
                (SELECT count(*)::int FROM app.students s WHERE s.bus_route = r.code) AS riders,
                (SELECT count(*)::int FROM app.route_stops st WHERE st.route_id = r.id AND st.retired_at IS NULL) AS stops
           FROM app.routes r
          WHERE r.tenant_id=$1 AND r.retired_at IS NULL
          ORDER BY r.code`, [req.user.tenant_id])).rows;
      return { routes: rows };
    });
  });

  app.post(`/plugins/${ID}/routes`, { preHandler: [require(...FLEET), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    const code = cleanCode(b.code);
    const name = String(b.name ?? '').trim();
    if (!code || !name) return bad(reply, 'A route needs a code and a name');
    if (!CODE_RE.test(code)) return bad(reply, 'A route code is up to 16 characters: letters, digits and dashes');
    const capacity = b.capacity == null ? null : Number(b.capacity);
    if (capacity != null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 500)) {
      return bad(reply, 'Capacity must be a whole number between 1 and 500');
    }
    const vehicle = b.vehicle == null ? null : String(b.vehicle).trim().slice(0, 40);
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const dupe = (await c.query(`SELECT 1 FROM app.routes WHERE tenant_id=$1 AND code=$2`, [req.user.tenant_id, code])).rows[0];
      if (dupe) return bad(reply, `Route ${code} already exists`, 409);
      const r = (await c.query(
        `INSERT INTO app.routes (tenant_id, code, name, vehicle, capacity)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, code, name, vehicle, capacity, permit_capacity, created_at`,
        [req.user.tenant_id, code, name, vehicle, capacity ?? 40])).rows[0];
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'transport route created', recordType: 'Route', recordRef: r.id,
        reason: b.reason ?? 'fleet setup', policyRef: 'Transport §3.1', risk: 'low',
        outcome: `${code} · ${name} · capacity ${r.capacity}` });
      return { route: r };
    });
  });

  app.patch(`/plugins/${ID}/routes/:id`, { preHandler: [require(...FLEET), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    const sets = []; const params = [req.user.tenant_id, req.params.id];
    const put = (col, val) => { params.push(val); sets.push(`${col}=$${params.length}`); };
    if (b.name != null) {
      const name = String(b.name).trim();
      if (!name) return bad(reply, 'A route needs a name');
      put('name', name);
    }
    if (b.vehicle !== undefined) put('vehicle', b.vehicle == null ? null : String(b.vehicle).trim().slice(0, 40));
    if (b.capacity !== undefined) {
      const capacity = Number(b.capacity);
      if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500) return bad(reply, 'Capacity must be a whole number between 1 and 500');
      put('capacity', capacity);
    }
    if (!sets.length) return bad(reply, 'Nothing to change');
    const r = await withUser(req.user.tenant_id, req.user.role, async (c) => {
      const row = (await c.query(
        `UPDATE app.routes SET ${sets.join(', ')} WHERE tenant_id=$1 AND id=$2 AND retired_at IS NULL
         RETURNING id, code, name, vehicle, capacity, permit_capacity, created_at`, params)).rows[0];
      if (!row) return null;
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'transport route edited', recordType: 'Route', recordRef: row.id,
        reason: b.reason ?? 'fleet maintenance', policyRef: 'Transport §3.1', risk: 'low',
        outcome: `${row.code} · ${row.name}` });
      return row;
    });
    if (!r) return bad(reply, 'We could not find that route (retired routes cannot be edited)', 404);
    return { route: r };
  });

  app.post(`/plugins/${ID}/routes/:id/retire`, { preHandler: [require(...FLEET), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = (await c.query(
        `UPDATE app.routes SET retired_at=now() WHERE tenant_id=$1 AND id=$2 AND retired_at IS NULL RETURNING id, code`,
        [req.user.tenant_id, req.params.id])).rows[0];
      if (!r) return bad(reply, 'We could not find that route to retire', 404);
      // a retired route takes its stops with it — a live stop on a retired route is a lie on the board
      const stops = await c.query(
        `UPDATE app.route_stops SET retired_at=now() WHERE tenant_id=$1 AND route_id=$2 AND retired_at IS NULL`,
        [req.user.tenant_id, r.id]);
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'transport route retired', recordType: 'Route', recordRef: r.id,
        reason: req.body?.reason ?? 'route withdrawn from service', policyRef: 'Transport §3.1', risk: 'medium',
        outcome: `${r.code} retired · ${stops.rowCount} stop(s) retired with it · history retained` });
      return { ok: true, retired: r, stopsRetired: stops.rowCount };
    });
  });

  app.post(`/plugins/${ID}/stops`, { preHandler: [require(...FLEET), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    const name = String(b.name ?? '').trim();
    if (!b.routeId || !name) return bad(reply, 'A stop needs a route and a name');
    const eta = b.etaOffsetMins == null ? 0 : Number(b.etaOffsetMins);
    if (!Number.isInteger(eta) || eta < -240 || eta > 240) return bad(reply, 'Minutes from the first stop must be a whole number between -240 and 240');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const route = (await c.query(
        `SELECT id, code FROM app.routes WHERE tenant_id=$1 AND id=$2 AND retired_at IS NULL`,
        [req.user.tenant_id, b.routeId])).rows[0];
      if (!route) return bad(reply, 'We could not find that route (it may be retired)', 404);
      // seq is dense and ordered: next position on the route, not a caller-supplied number
      const next = (await c.query(
        `SELECT COALESCE(max(seq), 0) + 1 AS seq FROM app.route_stops WHERE tenant_id=$1 AND route_id=$2`,
        [req.user.tenant_id, route.id])).rows[0].seq;
      const s = (await c.query(
        `INSERT INTO app.route_stops (tenant_id, route_id, seq, name, eta_offset_mins)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, route_id, seq, name, eta_offset_mins`,
        [req.user.tenant_id, route.id, next, name, eta])).rows[0];
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'route stop added', recordType: 'RouteStop', recordRef: s.id,
        reason: req.body?.reason ?? 'fleet setup', policyRef: 'Transport §3.1', risk: 'low',
        outcome: `${route.code} stop ${s.seq} · ${s.name}` });
      return { stop: s };
    });
  });

  app.patch(`/plugins/${ID}/stops/:id`, { preHandler: [require(...FLEET), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    const sets = []; const params = [req.user.tenant_id, req.params.id];
    if (b.name != null) {
      const name = String(b.name).trim();
      if (!name) return bad(reply, 'A stop needs a name');
      params.push(name); sets.push(`name=$${params.length}`);
    }
    if (b.etaOffsetMins !== undefined) {
      const eta = Number(b.etaOffsetMins);
      if (!Number.isInteger(eta) || eta < -240 || eta > 240) return bad(reply, 'Minutes from the first stop must be a whole number between -240 and 240');
      params.push(eta); sets.push(`eta_offset_mins=$${params.length}`);
    }
    if (!sets.length) return bad(reply, 'Nothing to change');
    const s = await withUser(req.user.tenant_id, req.user.role, async (c) => {
      const row = (await c.query(
        `UPDATE app.route_stops SET ${sets.join(', ')}
          WHERE tenant_id=$1 AND id=$2 AND retired_at IS NULL
        RETURNING id, route_id, seq, name, eta_offset_mins`, params)).rows[0];
      if (!row) return null;
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'route stop edited', recordType: 'RouteStop', recordRef: row.id,
        reason: b.reason ?? 'fleet maintenance', policyRef: 'Transport §3.1', risk: 'low',
        outcome: `stop ${row.seq} · ${row.name}` });
      return row;
    });
    if (!s) return bad(reply, 'We could not find that stop (retired stops cannot be edited)', 404);
    return { stop: s };
  });

  app.post(`/plugins/${ID}/stops/:id/retire`, { preHandler: [require(...FLEET), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const s = (await c.query(
        `UPDATE app.route_stops SET retired_at=now() WHERE tenant_id=$1 AND id=$2 AND retired_at IS NULL
         RETURNING id, route_id, seq, name`, [req.user.tenant_id, req.params.id])).rows[0];
      if (!s) return bad(reply, 'We could not find that stop to retire', 404);
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'route stop retired', recordType: 'RouteStop', recordRef: s.id,
        reason: req.body?.reason ?? 'stop withdrawn from the route', policyRef: 'Transport §3.1', risk: 'low',
        outcome: `stop ${s.seq} · ${s.name} retired (history retained)` });
      return { ok: true, retired: s };
    });
  });
}
