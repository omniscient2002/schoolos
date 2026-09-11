// ops.udise — UDISE+-style export door (L3-3.2).
//   GET /plugins/ops.udise/export?year=YYYY-YY[&format=csv|json]
//   GET /plugins/ops.udise/columns              — the documented column mapping
//
// LAWS honoured here:
//   · deterministic_only — same records + same year ⇒ byte-identical CSV
//     (every query carries ORDER BY; no timestamps in the body).
//   · aggregates only — counts by class/section/gender-bucket, staff by role,
//     assets by category/status. No names, no phones, no PII leaves the door.
//   · honesty about schema limits — app.students has NO gender column (001/054),
//     so the gender split reports not_recorded = the true count and boys/girls/
//     other = 0 rather than inventing numbers. When L1 adds students.gender the
//     two marked SQL sites flip and the mapping doc /columns updates with it.
//   · configured-first — without the school's UDISE code in plugin settings the
//     export refuses with actionable copy (rails 503 precedent, D-32 spirit).
import { makeLifecycleGate } from '../_shared/lifecycle-gate.js';
import { registerSettingsFormDoors } from '../../settings-contract.js';

const ID = 'ops.udise';
import manifestDef from './manifest.js';
export { default as manifest } from './manifest.js';

const AY_RE = /^\d{4}-\d{2}$/;
const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/* current Indian academic year (April–March), computed in IST */
export function currentAy(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).formatToParts(now);
  const y = Number(p.find((x) => x.type === 'year').value);
  const m = Number(p.find((x) => x.type === 'month').value);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function register(app, kernel) {
  registerSettingsFormDoors(app, kernel, ID, manifestDef);
  const { withUser, requestAudit, emitEvent, require, q } = kernel;
  const lifecycleGate = makeLifecycleGate(q, ID);
  const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });

  // ── the documented column mapping (self-describing contract) ──────────────────
  app.get('/plugins/ops.udise/columns', { preHandler: [require('owner', 'principal', 'itadmin', 'coordinator'), lifecycleGate] }, async () => ({
    file: 'udise-style-statistical-export',
    year_semantics: 'Indian academic year April–March, format YYYY-YY (e.g. 2026-27). Defaults to the current AY in IST.',
    sections: {
      enrollment: {
        grain: 'one row per (grade, section) — on-roll students only (status = active)',
        columns: {
          udise_code: "school's UDISE code from plugin settings (blank cell refused at the door — export needs it)",
          academic_year: 'the ?year= parameter',
          grade: 'app.students.grade (free text; ordered by length then text so 1..9 sort before 10+ and LKG/UKG follow)',
          section: 'app.students.section',
          enrollment_total: 'count of on-roll students in that grade-section',
          boys: 'RESERVED — 0 until a students.gender column exists (L1 migration 055+); flip site marked in index.js',
          girls: 'RESERVED — 0 until a students.gender column exists',
          other_gender: 'RESERVED — 0 until a students.gender column exists',
          not_recorded: 'count of students whose gender is not recorded (currently ALL — honest bucket, never a fabricated split)',
        },
      },
      staff: { grain: 'one row per role', columns: { udise_code: 'settings', academic_year: 'parameter', role: 'app.users.role (builtin roles)', staff_count: 'count of active users in that role' } },
      infrastructure: { grain: 'one row per asset category', columns: { udise_code: 'settings', academic_year: 'parameter', category: 'app.assets.category', total: 'count', operational: "status='operational'", watch: "status='watch'", degraded: "status='degraded'", down: "status='down'", maintenance: "status='maintenance'", retired: "status='retired'" } },
    },
    determinism: 'queries ordered; body carries no timestamps; two exports over unchanged records are byte-identical',
  }));

  // ── the export ────────────────────────────────────────────────────────────────
  app.get('/plugins/ops.udise/export', { preHandler: [require('owner', 'principal', 'itadmin', 'coordinator'), lifecycleGate] }, async (req, reply) => {
    const year = req.query?.year != null && String(req.query.year).trim() !== '' ? String(req.query.year).trim() : currentAy();
    if (!AY_RE.test(year)) return bad(reply, 'The academic year must look like 2026-27 (April–March)');
    const format = String(req.query?.format ?? 'csv').toLowerCase();
    if (!['csv', 'json'].includes(format)) return bad(reply, 'format must be csv or json');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const st = (await q(`SELECT settings->>'udise_code' AS code, settings->>'school_name' AS name FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`,
        [req.user.tenant_id, ID])).rows[0] ?? {};
      const code = (st.code ?? '').trim();
      if (!code) return bad(reply, "Set the school's UDISE code first — Modules → UDISE+ → Settings (every export row carries it)", 409);
      // ── enrollment (gender flip-site: L1 migration adds students.gender) ──
      const enr = (await c.query(
        `SELECT grade, section, count(*)::int AS total
         FROM app.students
         WHERE tenant_id=$1 AND status='active'
         GROUP BY grade, section
         ORDER BY length(grade), grade, section`,
        [req.user.tenant_id])).rows;
      // ── staff by role ──
      const staff = (await c.query(
        `SELECT role, count(*)::int AS n FROM app.users WHERE tenant_id=$1 AND active=true GROUP BY role ORDER BY role`,
        [req.user.tenant_id])).rows;
      // ── infrastructure by category × status ──
      const infra = (await c.query(
        `SELECT category, count(*)::int AS total,
                count(*) FILTER (WHERE status='operational')::int AS operational,
                count(*) FILTER (WHERE status='watch')::int AS watch,
                count(*) FILTER (WHERE status='degraded')::int AS degraded,
                count(*) FILTER (WHERE status='down')::int AS down,
                count(*) FILTER (WHERE status='maintenance')::int AS maintenance,
                count(*) FILTER (WHERE status='retired')::int AS retired
         FROM app.assets WHERE tenant_id=$1 GROUP BY category ORDER BY category`,
        [req.user.tenant_id])).rows;

      const L = [];
      L.push(['udise_code', 'academic_year', 'section', 'record_type', 'grade_or_category_or_role', 'count_or_total', 'boys', 'girls', 'other_gender', 'not_recorded', 'operational', 'watch', 'degraded', 'down', 'maintenance', 'retired'].join(','));
      for (const r of enr) {
        // not_recorded carries the true count; boys/girls/other stay 0 — an honest
        // gap beats an invented split (audit §8.3 two-Meridians lesson).
        L.push([code, year, r.section, 'enrollment', r.grade, r.total, 0, 0, 0, r.total, '', '', '', '', '', ''].map(csvCell).join(','));
      }
      for (const r of staff) {
        L.push([code, year, '', 'staff', r.role, r.n, '', '', '', '', '', '', '', '', '', ''].map(csvCell).join(','));
      }
      for (const r of infra) {
        L.push([code, year, '', 'infrastructure', r.category, r.total, '', '', '', '', r.operational, r.watch, r.degraded, r.down, r.maintenance, r.retired].map(csvCell).join(','));
      }
      const csv = L.join('\r\n') + '\r\n';
      const meta = {
        udiseCode: code, schoolName: st.name ?? null, academicYear: year,
        enrollmentRows: enr.length, staffRows: staff.length, infrastructureRows: infra.length,
        onRollTotal: enr.reduce((a, r) => a + r.total, 0),
        genderBuckets: 'not_recorded (no students.gender column yet — see /plugins/ops.udise/columns)',
      };
      await emitEvent(c, req.user.tenant_id,
        { type: 'ops', label: `UDISE+ export generated: AY ${year} — ${meta.onRollTotal} on-roll, ${staff.length} staff roles, ${infra.length} asset categories`, ref: null },
        'udise.export.completed', { ...meta });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'UDISE+ export generated', recordType: 'Plugin', recordRef: ID,
        reason: 'statistical return', policyRef: 'Platform §5.2 (artifacts) · aggregates only, no PII', risk: 'low',
        outcome: `AY ${year} · on-roll ${meta.onRollTotal} across ${enr.length} grade-sections · ${infra.length} asset categories · deterministic CSV` });
      if (format === 'json') return { meta, csv };
      return reply.header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="udise-style-${code}-${year}.csv"`)
        .send(csv);
    });
  });
}
