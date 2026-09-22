// ops.bi — BI read models (L3-4.3). Headless, class B, read-only: attendance
// percentage by class, fee aging buckets, admissions funnel conversion, homework
// completion. SQL over the tenant's real records; 500-row caps on every detail
// listing; a 60-second in-process cache per (door, query) because read models are
// allowed to be slightly stale — never wrong by more than a minute. Rides the same
// RLS session as every door (withUser), so a parent can never reach these doors and
// staff see only their own tenant's numbers.
//
// H8 · multi-replica note: the cache is PER PROCESS, so two replicas may serve a
// read model up to 60 s apart. That is within the stated staleness bound and every
// value is a real SQL aggregate (never fabricated); a shared store is deliberately
// not used because the read models are cheap and a cross-replica cache would add a
// shared dependency for no correctness gain. If a deployment ever needs identical
// reads across replicas, put them behind the same sticky routing or a shared cache.
import { makeLifecycleGate } from '../_shared/lifecycle-gate.js';
import { registerSettingsFormDoors } from '../../settings-contract.js';
import { FORWARD, CLOSED_STAGES } from '../_shared/admissions-access.js';

const ID = 'ops.bi';
import manifestDef from './manifest.js';
export { default as manifest } from './manifest.js';

const CACHE_TTL_MS = 60_000;
const ROW_CAP = 500;
const cache = new Map(); // key → {at, payload}

async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ...hit.payload, cached: true };
  const payload = await fn();
  if (cache.size > 300) cache.clear();
  cache.set(key, { at: Date.now(), payload });
  return { ...payload, cached: false };
}

export function invalidateBiCache(tenantId) {
  for (const k of cache.keys()) if (k.startsWith(`${tenantId}:`)) cache.delete(k);
}

export function register(app, kernel) {
  registerSettingsFormDoors(app, kernel, ID, manifestDef);
  const { withUser, require, sysq } = kernel;
  const lifecycleGate = makeLifecycleGate(sysq, ID);
  const STAFF = ['owner', 'principal', 'coordinator', 'finance', 'finance_head', 'finance_clerk', 'itadmin'];
  const windowDays = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 1 || n > 365) return 30;
    return Math.floor(n);
  };

  // ── attendance %: by class, and per-student within a class (capped) ──────────
  app.get('/plugins/ops.bi/attendance', { preHandler: [require(...STAFF), lifecycleGate] }, async (req, reply) => {
    const { grade, section } = req.query ?? {};
    const days = windowDays(req.query?.days);
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const key = `${req.user.tenant_id}:att:${grade ?? ''}:${section ?? ''}:${days}`;
      return cached(key, async () => {
        const byClass = (await c.query(
          `SELECT s.grade, s.section,
                  count(*)::int AS marks,
                  count(*) FILTER (WHERE a.status='present')::int AS present,
                  count(*) FILTER (WHERE a.status='late')::int AS late,
                  count(*) FILTER (WHERE a.status='absent')::int AS absent,
                  count(*) FILTER (WHERE a.status='leave')::int AS leave,
                  round(100.0 * count(*) FILTER (WHERE a.status IN ('present','late')) / NULLIF(count(*),0), 1) AS pct
           FROM app.attendance a
           JOIN app.students s ON s.id = a.student_id
           WHERE a.tenant_id=$1 AND a.school_date >= current_date - $2::int
             AND ($3::text IS NULL OR s.grade=$3) AND ($4::text IS NULL OR s.section=$4)
           GROUP BY s.grade, s.section ORDER BY s.grade, s.section`,
          [req.user.tenant_id, days, grade ?? null, section ?? null])).rows;
        let flagged = [];
        let capped = false;
        if (grade) {
          const det = (await c.query(
            `SELECT s.id AS "studentId", s.admission_no AS "admissionNo", s.name,
                    s.grade, s.section,
                    count(a.id)::int AS marks,
                    round(100.0 * count(*) FILTER (WHERE a.status IN ('present','late')) / NULLIF(count(a.id),0), 1) AS pct
             FROM app.students s
             LEFT JOIN app.attendance a ON a.student_id = s.id AND a.school_date >= current_date - $3::int
             WHERE s.tenant_id=$1 AND s.status='active' AND s.grade=$2
             GROUP BY s.id ORDER BY s.grade, s.section, s.name LIMIT $4`,
            [req.user.tenant_id, grade, days, ROW_CAP + 1])).rows;
          capped = det.length > ROW_CAP;
          flagged = det.slice(0, ROW_CAP)
            .filter((r) => Number(r.pct ?? 0) < 75)
            .sort((a, b) => Number(a.pct ?? 0) - Number(b.pct ?? 0));
        }
        return { window: { days, tz: 'Asia/Kolkata' }, grade: grade ?? null, section: section ?? null, byClass, belowThreshold: flagged, rowCap: ROW_CAP, capped, cacheSeconds: CACHE_TTL_MS / 1000 };
      });
    });
  });

  // ── fee aging: overdue obligations in buckets, by term ────────────────────────
  app.get('/plugins/ops.bi/fees/aging', { preHandler: [require(...STAFF), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const key = `${req.user.tenant_id}:aging`;
      return cached(key, async () => {
        const buckets = (await c.query(
          `SELECT x.term,
                  count(*) FILTER (WHERE NOT overdue) AS not_due,
                  count(*) FILTER (WHERE days_over BETWEEN 1 AND 7) AS d1_7,
                  count(*) FILTER (WHERE days_over BETWEEN 8 AND 30) AS d8_30,
                  count(*) FILTER (WHERE days_over BETWEEN 31 AND 90) AS d31_90,
                  count(*) FILTER (WHERE days_over > 90) AS d90p,
                  COALESCE(SUM(CASE WHEN days_over BETWEEN 1 AND 7 THEN amount_cents - paid_cents END),0)::bigint AS c1_7,
                  COALESCE(SUM(CASE WHEN days_over BETWEEN 8 AND 30 THEN amount_cents - paid_cents END),0)::bigint AS c8_30,
                  COALESCE(SUM(CASE WHEN days_over BETWEEN 31 AND 90 THEN amount_cents - paid_cents END),0)::bigint AS c31_90,
                  COALESCE(SUM(CASE WHEN days_over > 90 THEN amount_cents - paid_cents END),0)::bigint AS c90p
           FROM (
             SELECT ob.term, ob.amount_cents, ob.paid_cents,
                    (current_date - ob.due_on) AS days_over,
                    (ob.due_on < current_date AND ob.paid_cents < ob.amount_cents AND ob.status <> 'void') AS overdue
             FROM app.fee_obligations ob
             WHERE ob.tenant_id=$1
           ) x GROUP BY x.term ORDER BY x.term`,
          [req.user.tenant_id])).rows;
        const worst = (await c.query(
          `SELECT ob.id, s.name, s.admission_no, s.grade, s.section, ob.term, ob.label,
                  ob.amount_cents, ob.paid_cents, (ob.amount_cents - ob.paid_cents) AS outstanding_cents,
                  (current_date - ob.due_on) AS days_over
           FROM app.fee_obligations ob JOIN app.students s ON s.id = ob.student_id
           WHERE ob.tenant_id=$1 AND ob.due_on < current_date AND ob.paid_cents < ob.amount_cents
             AND ob.status <> 'void'
           ORDER BY days_over DESC, outstanding_cents DESC LIMIT $2`,
          [req.user.tenant_id, ROW_CAP + 1])).rows;
        return { buckets, oldestFirst: worst.slice(0, ROW_CAP), capped: worst.length > ROW_CAP, rowCap: ROW_CAP, cacheSeconds: CACHE_TTL_MS / 1000 };
      });
    });
  });

  // ── admissions funnel: stage counts + conversion + stage age ─────────────────
  app.get('/plugins/ops.bi/funnel', { preHandler: [require(...STAFF), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const key = `${req.user.tenant_id}:funnel`;
      return cached(key, async () => {
        const stages = (await c.query(
          `SELECT stage, count(*)::int AS leads
           FROM plugin_admissions.lead WHERE tenant_id=$1 GROUP BY stage ORDER BY leads DESC`,
          [req.user.tenant_id])).rows;
        const total = stages.reduce((a, s) => a + s.leads, 0);
        // D-3: the order was the OLD lattice, so every live stage landed in `extraStages`
        // and `enrolledPct` was computed against a `dropped` key that no longer exists. The
        // forward order and the closed set now come from the shared module the plugin uses.
        const order = [...FORWARD, ...CLOSED_STAGES];
        const byStage = Object.fromEntries(stages.map((s) => [s.stage, s.leads]));
        const enrolled = byStage['enrolled'] ?? 0;
        const conversions = (await c.query(
          `SELECT from_stage, to_stage, count(*)::int AS n
           FROM plugin_admissions.stage_history WHERE tenant_id=$1 AND from_stage IS NOT NULL
           GROUP BY from_stage, to_stage`,
          [req.user.tenant_id])).rows;
        const aging = (await c.query(
          `SELECT stage, round(avg(extract(epoch FROM (now() - updated_at))/86400)::numeric, 1) AS avg_days_in_stage
           FROM plugin_admissions.lead WHERE tenant_id=$1 GROUP BY stage`,
          [req.user.tenant_id])).rows;
        return {
          totalLeads: total,
          byStage: order.filter((s) => byStage[s] !== undefined).map((s) => ({ stage: s, leads: byStage[s], sharePct: total ? Math.round((byStage[s] / total) * 1000) / 10 : 0 })),
          extraStages: stages.filter((s) => !order.includes(s.stage)),
          enrolled, enrolledPct: total ? Math.round((enrolled / total) * 1000) / 10 : 0,
          rejected: byStage['rejected'] ?? 0,
          withdrawn: byStage['withdrawn'] ?? 0,
          waitlisted: byStage['waitlisted'] ?? 0,
          transitions: conversions, avgDaysInStage: Object.fromEntries(aging.map((a) => [a.stage, Number(a.avg_days_in_stage)])),
          cacheSeconds: CACHE_TTL_MS / 1000,
        };
      });
    });
  });

  // ── homework completion: by class and per assignment (capped) ─────────────────
  app.get('/plugins/ops.bi/homework', { preHandler: [require(...STAFF), lifecycleGate] }, async (req, reply) => {
    const { grade } = req.query ?? {};
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const key = `${req.user.tenant_id}:hw:${grade ?? ''}`;
      return cached(key, async () => {
        const byClass = (await c.query(
          `SELECT h.class_grade AS grade,
                  count(DISTINCT h.id)::int AS assignments,
                  count(sb.id)::int AS submissions,
                  count(*) FILTER (WHERE sb.status IN ('submitted','late','reviewed','graded'))::int AS turned_in,
                  count(*) FILTER (WHERE sb.status='late')::int AS late
           FROM teacher.homework h
           LEFT JOIN teacher.submission sb ON sb.homework_id = h.id
           WHERE h.tenant_id=$1 AND ($2::text IS NULL OR h.class_grade=$2)
           GROUP BY h.class_grade ORDER BY h.class_grade`,
          [req.user.tenant_id, grade ?? null])).rows;
        const recent = (await c.query(
          `SELECT h.id, h.class_grade AS grade, h.subject, h.title, h.due_at AS "dueAt", h.status,
                  (SELECT count(*)::int FROM teacher.submission sb WHERE sb.homework_id = h.id) AS submissions
           FROM teacher.homework h
           WHERE h.tenant_id=$1 AND ($2::text IS NULL OR h.class_grade=$2)
           ORDER BY h.due_at DESC LIMIT $3`,
          [req.user.tenant_id, grade ?? null, ROW_CAP + 1])).rows;
        return { byClass, recent: recent.slice(0, ROW_CAP), capped: recent.length > ROW_CAP, rowCap: ROW_CAP, cacheSeconds: CACHE_TTL_MS / 1000 };
      });
    });
  });

}
