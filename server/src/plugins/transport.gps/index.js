// transport.gps — vendor GPS ingestion: normalize positions, deterministic guard
// (delay >= 10 → approval-required guardian notice), 30d position retention.
// Decoupled: zero kernel logic — mounts its own doors only (docs/11 §2.3).
const ID = 'transport.gps';
export { default as manifest } from './manifest.js';
import { randomUUID } from 'node:crypto';
import { checkEventBudget } from '../../governance.js';

const ADEVA = { lat: 12.9352, lng: 77.6245 };   // demo campus anchor (Koramangala, Bengaluru)
const STREETS = ['80 Feet Rd', '5th Block', 'Jyoti Nivas', 'W Catalyst', 'Sector 12 bridge', 'HSR loop'];

export function register(app, kernel) {
  const { withUser, auditLog, requestAudit, emitEvent, require } = kernel;

  app.post(`/plugins/${ID}/positions`, { preHandler: require('transport','coordinator','principal','owner') }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.routeCode || typeof b.lat !== 'number' || typeof b.lng !== 'number') {
      return reply.code(400).send({ error: 'routeCode, lat, lng required' });
    }
    const delayMins = Number.isFinite(b.delayMins) ? Math.round(b.delayMins) : null;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const route = (await c.query(`SELECT id, code FROM app.routes WHERE code=$1`, [b.routeCode])).rows[0];
      if (!route) return reply.code(404).send({ error: 'route not found' });
      // budget + breaker BEFORE any write (docs/12 §10) — plugin-attributed
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
      const riders = (await c.query(`SELECT count(*)::int AS n FROM app.students WHERE bus_route=$1`, [route.code])).rows[0].n;
      const ev = await emitEvent(c, req.user.tenant_id,
        { type: 'transport', label: `GPS ping — Bus ${route.code} (${b.lat.toFixed(4)}, ${b.lng.toFixed(4)})${delayMins ? ` · +${delayMins} min` : ''}${riders ? ` · ${riders} riders` : ''}`, severity: delayMins >= 10 ? 'warn' : 'info', ref: route.code },
        'gps.position', { routeCode: route.code, lat: b.lat, lng: b.lng, delayMins, riders },
        { emittedBy: `plugin:${ID}`, subject: `route:${route.code}`, schemaVersion: 1 });
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
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'GPS position ingested', recordType: 'Transport', recordRef: route.code,
        reason: b.note ?? 'vendor feed', policyRef: 'Transport §3.1', risk: 'low',
        outcome: action ? 'position recorded · approval-required notice raised' : 'position recorded' });
      return { positionId: pos.rows[0].id, riders, action };
    });
  });

  app.get(`/plugins/${ID}/positions`, { preHandler: require('transport','coordinator','principal','owner') }, async (req) => {
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
}
