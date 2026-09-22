// Seed: Meridian International Academy — the demo tenant.
// Idempotent: wipes the tenant and reinserts. Values match the frontend demo corpus.
import pg from 'pg';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';
import { hashPassword } from '../src/auth.js';

// ── PERFECT-100 §5.7 TST-2 / item 30 — DETERMINISTIC SEED ─────────────────────
// The seed used `Math.random()` for attendance status and a couple of ledger values,
// which made the WHOLE SUITE NON-DETERMINISTIC. Measured: three fresh seeds of the same
// database gave the same student 70%, 80% and 90% attendance —
//
//   seed1: MER-2601:100% MER-2602:100% MER-2603:70%
//   seed2: MER-2601:100% MER-2602:100% MER-2603:80%
//   seed3: MER-2601:90%  MER-2602:100% MER-2603:90%
//
// Because the exams eligibility gate enforces a 75% attendance floor, a 70% draw made
// `tests/exam-depth.test.js` fail at publish → the suite went red for reasons that had
// nothing to do with the code under test. Same defect class as the calendar-dependent
// tests: a fixture that answers differently each run turns a green suite into a coin
// flip and destroys its value as evidence.
//
// `rand()` keeps the same distribution and call sequence but starts from a fixed point,
// so the demo corpus is identical on every run while the data still looks varied.
// Change SEED_RNG_SEED only to deliberately reshuffle the demo dataset.
const SEED_RNG_SEED = 0x5c40010 % 0xffffffff;
let _rngState = SEED_RNG_SEED >>> 0;
/** mulberry32 — tiny, fast, well-distributed, and reproducible across platforms. */
const rand = () => {
  _rngState = (_rngState + 0x6D2B79F5) >>> 0;
  let t = _rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};


// ── P0 guard (ops audit): seed wipes tenant data. Refuse in production unless
// the operator passes --i-know-this-wipes-data explicitly.
if ((process.env.NODE_ENV === 'production' || process.env.SEED_GUARD === 'strict')
    && !process.argv.includes('--i-know-this-wipes-data')) {
  console.error('REFUSING to seed: NODE_ENV=production would TRUNCATE tenant data.\n'
    + 'For a deliberate demo reset re-run with: node scripts/seed.js --i-know-this-wipes-data');
  process.exit(1);
}

/* ── Incident guard (L2, 2026-09-12): the TRUNCATE below is CASCADE over
   app.tenants — it nukes EVERY tenant, not just the demo one. A dev DB that
   carries real self-signup schools must never be silently wiped (one was:
   tenant 'lkmmm' and its two users). Count non-demo tenants and refuse
   unless the operator says --allow-nuke. A fresh DB (no tables yet) is, by
   definition, safe — the migrate step runs before seed in every pipeline. ── */
{
  const c = new pg.Client({ connectionString: config.databaseUrl });
  await c.connect();
  try {
    const { rows: [extra] } = await c.query(`SELECT count(*)::int AS n FROM app.tenants WHERE slug <> 'meridian'`);
    if (extra.n > 0 && !process.argv.includes('--allow-nuke')) {
      console.error(`REFUSING to seed: this DB holds ${extra.n} non-demo tenant(s); the CASCADE wipe would destroy them.\n`
        + 'For a deliberate full reset re-run with: node scripts/seed.js --allow-nuke');
      process.exit(1);
    }
  } catch (e) {
    if (e.code !== '42P01') throw e; // missing tables = fresh DB = nothing to lose
  } finally {
    await c.end();
  }
}

const client = new pg.Client({ connectionString: config.databaseUrl });
await client.connect();

const DEMO_PW = 'schoolos-demo';

// ---- tenant (clean re-seed: truncate all tenant-scoped tables) ----
await client.query(`TRUNCATE app.tenants CASCADE`);
// DATX-5: TRUNCATE app.tenants CASCADE cannot reach tables with NO FK path to app.tenants, so a re-seed
// left their rows behind (8 tables the re-audit named). Truncate them explicitly. `capability_contracts`
// keeps its PLATFORM rows (tenant_id IS NULL — migration 007 dropped the FK on purpose) and only clears
// tenant-scoped ones; the rest are tenant-scoped and safe to empty. Guarded by to_regclass so a deployment
// without a given plugin table is unaffected.
{
  const noFkTables = ['teacher.homework', 'teacher.submission', 'teacher.submission_needs_linking',
    'plugin_visitors.pickup_otp', 'plugin_dpdp.erasure_journal', 'auth.revoked_token',
    'app.audit_log_cold', 'auth.request_throttles'];
  for (const tbl of noFkTables) {
    if ((await client.query('SELECT to_regclass($1) AS oid', [tbl])).rows[0]?.oid) {
      // CASCADE: some of these reference each other (e.g. teacher.submission → teacher.homework).
      await client.query(`TRUNCATE ${tbl} CASCADE`);
    }
  }
  if ((await client.query(`SELECT to_regclass('app.capability_contracts') AS oid`)).rows[0]?.oid) {
    await client.query(`DELETE FROM app.capability_contracts WHERE tenant_id IS NOT NULL`);
  }
}
/* The demo school's class structure lives in `config.setup.sections` — the SAME list every class
   picker and transfer reads (owner/principal/IT admin edit it on the Classes & sections screen).
   Meridian runs grades 6–10 with sections A/B/C, matching the students seeded below. */
const meridianConfig = {
  /* No campuses — a school is one site. A second site is a separate tenant. */
  setup: {
    source: 'seed',
    sections: ['6', '7', '8', '9', '10'].map((grade) => ({ grade, sections: ['A', 'B', 'C'] })),
  },
};
const t = (await client.query(
  `INSERT INTO app.tenants (slug, name, config) VALUES ('meridian', 'Meridian International Academy', $1::jsonb) RETURNING id`,
  [JSON.stringify(meridianConfig)]
)).rows[0];
const T = t.id;

// ---- users (12 demo roles) ----
const users = [
  ['principal@meridian.edu', 'Dr. Meera Krishnan', 'principal'],
  ['teacher@meridian.edu', 'Priya Iyer', 'teacher'],
  ['coordinator@meridian.edu', 'Rahul Verma', 'coordinator'],
  ['finance@meridian.edu', 'Ms. Rao', 'finance'],
  ['admissions@meridian.edu', 'Sneha Kulkarni', 'admissions'],
  ['transport@meridian.edu', 'Vikram Joshi', 'transport'],
  ['facilities@meridian.edu', 'Vikram Joshi', 'facilities'],
  ['technician@meridian.edu', 'Arif Shaikh', 'technician'],
  ['owner@meridian.edu', 'A. Meridian', 'owner'],
  ['itadmin@meridian.edu', 'Sam Dsouza', 'itadmin'],
  ['parent@meridian.edu', 'Kavita Sharma', 'parent'],
  ['student@meridian.edu', 'Aarav Sharma', 'student'],
];
const userIds = {};
const PHONES = {
  principal: '+919845000101', coordinator: '+919845000102', finance: '+919845000103',
  admissions: '+919845000104', transport: '+919845000105', facilities: '+919845000106',
  technician: '+919845000107', teacher: '+919845000108', itadmin: '+919845000109',
  parent: '+919845000201', student: '+919845000202', owner: '+919845000301',
};
for (const [email, name, role] of users) {
  const r = await client.query(
    `INSERT INTO app.users (tenant_id, email, name, role, password_hash, phone) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [T, email, name, role, hashPassword(DEMO_PW), PHONES[role] ?? null]);
  userIds[role] = r.rows[0].id;
}

// ---- students (Grade 8 section B gets the full demo cast) ----
const sections = ['A','B','C'];
const first = ['Aarav','Diya','Vihaan','Ananya','Ishaan','Myra','Kabir','Sara','Advait','Naina','Reyansh','Kiara','Dhruv','Aisha','Ved','Zara','Arjun','Meher','Rohan','Tara','Yuvan','Ira','Dev','Pari','Kian'];
const last = ['Sharma','Iyer','Patel','Reddy','Khan','Mehta','Singh','Nair','Gupta','Bose','Rao','Joshi','Kapoor','Das','Menon'];
let students = [];
let pinnedAdmission = null;
let n = 0;
for (let g = 6; g <= 10; g++) {
  for (const sec of sections) {
    for (let i = 0; i < 25; i++) {
      n++;
      let name = `${first[(g*3+i) % first.length]} ${last[(i*7+g) % last.length]}`;
      if (name === 'Aarav Sharma' && !(g === 8 && sec === 'B' && i === 0)) name = 'Aarav S. ' + last[(i*7+g) % last.length];
      if (g === 8 && sec === 'B' && i === 0) { name = 'Aarav Sharma'; pinnedAdmission = `MER-${2600+n}`; }
      const route = i % 3 === 0 ? (i % 6 === 0 ? 'Route 7' : 'Route 4') : null;
      const r = await client.query(
        `INSERT INTO app.students (tenant_id, admission_no, name, grade, section, guardian_name, guardian_phone, bus_route, source, source_ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'migration',$9) RETURNING id`,
        [T, `MER-${2600+n}`, name, String(g), sec, `Guardian of ${name}`, `+91 98${String(10000000+n).slice(0,8)}`, route, `row ${200+n}`]);
      students.push({ id: r.rows[0].id, name, grade: String(g), section: sec, route });
    }
  }
}
// pin the demo cast (Aarav: 8-B, Route 7, guardian Kavita)
const aarav = students.find(s => s.name === 'Aarav Sharma'); // exactly one by construction
await client.query(`UPDATE app.students SET bus_route='Route 7', guardian_name='Kavita Sharma' WHERE id=$1`, [aarav.id]);
aarav.route = 'Route 7';
// UI lane #3: EVERY student gets a primary guardian — the pickup flow is demo-complete
// across the whole roster (was: 15 of 25 8-B students only). Documented drill phones
// stay pinned (Aarav …0176, Diya …0177).
const pinnedGuardianPhones = { 'Aarav Sharma': '+91 9720000176', 'Diya Nair': '+91 9720000177' };
for (const s of students) {
  const phone = pinnedGuardianPhones[s.name] ?? `+91 97${String(20000000+students.indexOf(s)).slice(0,8)}`;
  const gname = s.id === aarav.id ? 'Kavita Sharma' : `Guardian of ${s.name}`;
  await client.query(
    `INSERT INTO app.guardians (tenant_id, student_id, name, phone, relation, is_primary) VALUES ($1,$2,$3,$4,'mother',true)`,
    [T, s.id, gname, phone]);
}

// ---- fee obligations (the legacy app.fee_plans table was dropped in migration 109) ----
for (const s of students) {
  const parts = [
    ['Installment 1 — July', 2250000, '2026-07-05'],
    ['Term 2 installment — September', 1850000, '2026-10-05'],
    ['Installment 3 — November', 2250000, '2026-11-05'],
  ];
  for (const [label, cents, due] of parts) {
    const paid = label.includes('July') ? cents : (label.includes('November') ? 0 : (rand() < 0.8 ? 0 : 1850000));
    await client.query(
      `INSERT INTO app.fee_obligations (tenant_id, student_id, term, label, due_on, amount_cents, paid_cents, status, source_ref)
       VALUES ($1,$2,'Term 2',$3,$4,$5,$6,$7,'TALLY-txn-${Math.floor(rand()*9000)+1000}')`,
      [T, s.id, label, due, cents, paid, paid >= cents ? 'paid' : 'open']);
  }
}
// Aarav's September installment: unsettled (the demo story)
await client.query(
  `UPDATE app.fee_obligations SET paid_cents=0, status='open' WHERE student_id=$1 AND label LIKE 'Term 2 installment%'`,
  [aarav.id]);

// ---- routes ----
const routes = [
  ['Route 4', 'Green Park circuit', 'KA-01-F-2841', 40, 38],
  ['Route 7', 'Sector 12 — HSR loop', 'KA-01-F-2214', 45, 38],
  ['Route 9', 'Market — Old Town', 'KA-05-E-0917', 40, 40],
  ['Route 11', 'Lake view extension', 'KA-03-M-5522', 32, 32],
];
const routeIds = {};
for (const [code, name, vehicle, cap, permit] of routes) {
  const r = await client.query(
    `INSERT INTO app.routes (tenant_id, code, name, vehicle, capacity, permit_capacity) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [T, code, name, vehicle, cap, permit]);
  routeIds[code] = r.rows[0].id;
  const stops = code === 'Route 7'
    ? ['Main Gate', 'Sector 12 Bridge', 'HSR Layout', 'Census Colony', 'School']
    : ['Depot', 'Market', 'Old Town', 'School'];
  for (let i = 0; i < stops.length; i++) {
    await client.query(
      `INSERT INTO app.route_stops (tenant_id, route_id, seq, name, eta_offset_mins) VALUES ($1,$2,$3,$4,$5)`,
      [T, r.rows[0].id, i+1, stops[i], i*6]);
  }
}

// ---- assets ----
const assets = [
  ['NOR-AC-04', 'Classroom AC — room 204', 'HVAC', 'North', '204', 'degraded', 42],
  ['NOR-PRJ-204', 'Projector — room 204', 'AV', 'North', '204', 'operational', 88],
  ['NOR-WC-07', 'Water cooler — Block B', 'Water', 'North', 'B-lobby', 'operational', 76],
  ['NOR-EL-02', 'Passenger lift — Block A', 'Power', 'North', 'A', 'watch', 61],
  ['NOR-CCTV-02', 'CCTV — Gate 2', 'Security', 'North', 'gate-2', 'operational', 90],
  ['NOR-GEN-01', 'Diesel generator', 'Power', 'South', 'yard', 'operational', 70],
];
const assetIds = {};
for (const [code, name, cat, bld, room, status, health] of assets) {
  const r = await client.query(
    `INSERT INTO app.assets (tenant_id, code, name, category, building, room, status, health_score) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [T, code, name, cat, bld, room, status, health]);
  assetIds[code] = r.rows[0].id;
}

// ---- work orders (the demo set) ----
const wos = [
  ['WO-1042', 'AC-04 trips breaker after a few minutes', 'HVAC', 'critical', 'repairing', 'NOR-AC-04', 'Sunita Yadav', 3],
  ['WO-1044', 'Water cooler leaking from base', 'Plumbing', 'critical', 'on-site', 'NOR-WC-07', 'Ravi Kumar', 2],
  ['WO-1045', 'Projector shows red tint — room 204', 'AV', 'high', 'reported', 'NOR-PRJ-204', 'Priya Iyer', 1],
  ['WO-1046', 'CCTV gate 2 — night mode dead', 'Security', 'high', 'en-route', 'NOR-CCTV-02', 'Arif Shaikh', 4],
];
for (const [code, title, cat, prio, status, assetCode, reporter, slaH] of wos) {
  const reportedBy = reporter === 'Priya Iyer' ? userIds.teacher : userIds.facilities;
  await client.query(
    `INSERT INTO app.work_orders (tenant_id, code, title, description, category, priority, status, asset_id, reported_by, sla_due_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() + ($10 || ' hours')::interval)`,
    [T, code, title, 'Seeded from maintenance demo', cat, prio, status, assetIds[assetCode], reportedBy, slaH]);
  await client.query(
    `INSERT INTO app.wo_events (tenant_id, wo_id, kind, note, actor_id) VALUES ($1, (SELECT id FROM app.work_orders WHERE code=$2), 'created', 'Seeded report', $3)`,
    [T, code, reportedBy]);
}

// ---- attendance: 10 days history; 8-B disruption day (23% present on Oct 14) ----
const today = new Date();
for (let d = 10; d >= 1; d--) {
  const day = new Date(today); day.setDate(day.getDate() - d);
  const iso = day.toISOString().slice(0,10);
  for (const s of students) {
    const is8B = s.grade === '8' && s.section === 'B';
    const disrupted = iso === today.toISOString().slice(0,10);
    let status = 'present';
    if (is8B && disrupted) status = s.route === 'Route 7' ? 'absent' : (rand() < 0.9 ? 'present' : 'absent');
    else if (rand() < 0.055) status = 'absent';
    else if (rand() < 0.02) status = 'late';
    await client.query(
      `INSERT INTO app.attendance (tenant_id, student_id, school_date, status, marked_by) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id, student_id, school_date) DO NOTHING`,
      [T, s.id, iso, status, userIds.teacher]);
  }
}

// ---- cases ----
await client.query(
  `INSERT INTO app.cases (tenant_id, code, kind, title, detail, priority, status, owner, opened_by, origin, sla_due_at, linked_refs)
   VALUES ($1,'case_rt7_seed','transport','Route 7 parents — Bus 14 delay complaints (cluster)','4 inbound messages deduplicated into one case.','high','in-progress','Transport desk',$2,'system', now() + '24 hours'::interval, $3::jsonb)`,
  [T, userIds.coordinator, JSON.stringify([{ label: 'Bus 14 GPS', ref: 'Route 7' }, { label: 'Attendance 8-B', ref: '8-B' }])]);

// ---- actions ----
await client.query(
  `INSERT INTO app.actions (tenant_id, code, kind, title, detail, why, priority, status, owner, owner_role, policy_ref, ai_involved, payload)
   VALUES ($1,'act_seed_sla','exception','Maintenance SLA closing — WO-1042 (AC-04, 4th failure)','Resolution window closes soon; parts hold flagged on R32 refrigerant.','SLA engine — breach escalates to supervisor + vendor AMC.','critical','open','Principal','principal','Facilities §1.2',true,'{}'::jsonb)`,
  [T]);

// ---- transport event (this morning's delay) ----
await client.query(
  `INSERT INTO app.transport_events (tenant_id, route_id, kind, delay_mins, note) VALUES ($1,$2,'gps_delay',13,'Sector 12 bridge block — GPS deviation')`,
  [T, routeIds['Route 7']]);

// ---- events ----
const events = [
  ['transport','08:31 · Bus 14 delayed — Route 7 deviation near Sector 12 (+13 min, GPS)','warn'],
  ['attendance','08:37 · Attendance deviation building — 15 Bus 14 riders absent in 8-B (early registers)','warn'],
  ['comms','08:42 · Parent complaints classified — 4 inbound on Route 7, intent: transport','warn'],
  ['fees','08:49 · Payment-failure cluster forming — Route 7 households (3 new UPI timeouts this morning)','warn'],
  ['maintenance','09:05 · Maintenance SLA closing — WO-1042 AC-04 repair due, escalation armed','critical'],
];
for (const [type, label, severity] of events) {
  await client.query(`INSERT INTO app.events (tenant_id, type, label, severity) VALUES ($1,$2,$3,$4)`, [T, type, label, severity]);
}

// ---- communications ----
await client.query(
  `INSERT INTO app.communications (tenant_id, audience_json, channel, template, body, status, policy_ref, sent_at, delivered_at)
   VALUES ($1, '["Route 7 guardians"]'::jsonb, 'whatsapp', 'TRANSPORT_DELAY', 'Bus Route 7 is running approximately 13 minutes late today due to a deviation near Sector 12. — Transport Desk', 'delivered', 'Transport §3.1', now() - interval '1 hour', now() - interval '58 minutes')`,
  [T]);

// ---- migration sources (Golden Loop 1 backend mirror) ----
const sources = [
  ['Students & guardians', 'excel', 1472, 1441, 24, 7, 'verified'],
  ['Fee ledger Term 1+2', 'tally', 2913, 2870, 31, 12, 'verified'],
  ['Admissions leads', 'excel', 68, 68, 0, 0, 'verified'],
  ['Routes, buses & riders', 'whatsapp-logs', 418, 402, 16, 0, 'verified'],
  ['Assets & maintenance history', 'amc-pdf', 228, 209, 14, 5, 'verified'],
];
for (const [name, kind, rows, imported, flagged, skipped, status] of sources) {
  await client.query(
    `INSERT INTO app.migration_sources (tenant_id, name, kind, row_count, imported, flagged, skipped, status, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'{}'::jsonb)`,
    [T, name, kind, rows, imported, flagged, skipped, status]);
}

// ---- memory ----
await client.query(
  `INSERT INTO app.memory_entries (tenant_id, kind, title, body, evidence, decided_by, expected, actual)
   VALUES ($1,'decision','Pre-route inspection for Bus 14','After the Sector 12 delay cluster, driver + attendant run a 5-point inspection before departure. Cites case_rt7_seed.',
     '["case_rt7_seed","Route 7 delay events","Attendance 8-B"]'::jsonb, 'Dr. Meera Krishnan', '0 route delays per term', 'tracking — 1 delay this term')`,
  [T]);

// ---- audit genesis (chain-valid: hash recomputes from stored columns) ----
{
  const at = new Date();
  const material = JSON.stringify({
    tenant: T, actor: 'SchoolOS seed', actorRole: 'system', action: 'Seeded Meridian demo data',
    recordType: 'System', recordRef: 'meridian', outcome: '375 students · 15 routes-worth of fees · 4 work orders',
    at: at.toISOString(),
  });
  const hash = createHash('sha256').update('GENESIS' + material).digest('hex');
  await client.query(
    `SELECT * FROM app.audit_append($1,'SchoolOS seed','system','Seeded Meridian demo data','System','meridian','demo parity with frontend','—',false,'low','375 students · 15 routes-worth of fees · 4 work orders','GENESIS',$2,$3)`,
    [T, hash, at]);
}

// ---- plugin catalog (009) + wave-1 runtime (010) — platform data wiped by the
// TRUNCATE above, so re-apply. The migration files are the single source of truth
// and are idempotent by design (conflict guards + NOT EXISTS); the audit entries
// they write chain onto the genesis row just inserted.
for (const mig of ['009_school_plugin_catalog.sql', '010_wave1_plugin_runtime.sql', '011_comms_whatsapp.sql', '013_accounting_tally.sql', '014_exams_assessment_registration.sql', '015_payments_upi.sql', '016_redteam3_cleanup.sql', '017_forged_window_cleanup.sql', '018_admissions_funnel.sql', '019_redteam4_residue_purge.sql', '020_transport_gps.sql', '021_ops_timetable.sql', '022_admissions_india_semantics.sql', '023_dpdp_pack.sql', '024_ops_visitors.sql', '025_exams_assessment_runtime.sql', '026_pack_cbse_runtime.sql', '027_cycle5_remediation.sql', '028_ui_lane_visitors.sql', '029_hr_clinic_runtime.sql', '030_cycle6_hardening.sql', '031_teacher_classroom.sql', '032_teacher_support_runtime.sql', '033_teacheros_ai_runtime.sql', '034_parent_family.sql', '035_parent_assistant.sql', '036_student_world.sql', '037_coord_view.sql', '043_comms_dispatch.sql', '044_razorpay.sql', '045_capability_seed.sql', '046_enrollment_history.sql', '047_library.sql', '048_files.sql', '083_class_assignments.sql', '132_student_user_link.sql']) {
  const catalogSql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations', mig), 'utf8');
  await client.query(catalogSql);
}

// ---- catalog rows the replay above does not contain (078 + every future catalog addition) ------------
// The replay list is hard-coded and stops at 048; `TRUNCATE app.tenants CASCADE` above wipes app.plugins, so
// any plugin added to the registry by a LATER migration, or seeded by src/plugin-catalog.js, silently
// disappears in every seeded environment — which is every test and the demo (found by independent review of
// migration 078: the three credential rails vanished here, taking the new OTP/reset channel gates with
// them). Rather than grow the list until the next person forgets it too, run the catalog itself: the same
// function /onboard/signup and the GET /plugins self-heal call, so the seed can never drift from it again.
{
  const { ensurePluginCatalog } = await import('../src/plugin-catalog.js');
  for (const t of (await client.query('SELECT id FROM app.tenants')).rows) {
    await ensurePluginCatalog(client, t.id);
  }
  // The demo tenant was just rebuilt, so its core modules must match the
  // modules enabled for a fresh signup. The catalog function remains
  // non-destructive for normal existing tenants.
  const { DEFAULT_ON } = await import('../src/plugin-catalog.js');
  await client.query(
    `UPDATE app.plugins SET status='enabled', enabled_at=COALESCE(enabled_at, now()), updated_at=now()
     WHERE tenant_id=$1 AND plugin_id = ANY($2::text[])`,
    [(await client.query("SELECT id FROM app.tenants WHERE slug='meridian'")).rows[0]?.id, [...DEFAULT_ON]],
  );
}

// ---- RLS predicate hardening MUST come after the replay above ────────────────
// PERFECT-100 §8 / migration 074. This is not a redundancy — it is load-bearing.
//
// The replay above re-CREATES the RLS policies defined in migrations 009–048, and those
// files write their predicates with an inline `current_setting('schoolos.tenant_id', true)`.
// So the replay UNDOES migration 074. Measured on one database, step by step:
//
//     after migrate     → inline=0  helper=91
//     after bootstrap   → inline=0  helper=91
//     after seed        → inline=50 helper=44      ← the replay rewound 47 policies
//
// A predicate that inlines current_setting can RAISE instead of DENY — 22P02 when the GUC
// is an empty string, 42704 when it was never set — which turns an access-control rule into
// a 500 for the whole request. Because `migrate.js` refuses to run once a recorded
// migration's checksum drifts, the old migrations CANNOT be edited to fix this at source.
// The hardening migration is idempotent, so re-applying it here is safe and cheap.
//
// RULE FOR FUTURE WORK: anything that hardens, replaces or constrains a policy created by
// the migrations above must be re-applied here too, or the seed silently reverts it on
// every run and the regression appears only in seeded (i.e. every test and demo)
// environments. `tests/rls-policy-hardening.test.js` asserts the invariant and fails when
// this block is removed.
for (const mig of ['074_rls_policy_hardening.sql']) {
  const catalogSql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations', mig), 'utf8');
  await client.query(catalogSql);
}

console.log(`Seeded tenant meridian: ${students.length} students, ${users.length} users, ${wos.length} WOs, 5 migration sources, 7 catalog plugins (3 migrations replayed).`);

// ---- D-35 grant tightening MUST be the LAST thing this script does -----------------------------
// The replay above re-runs migrations 010/018/020/021/036, several of which `GRANT ... DELETE` to the app role
// explicitly. `bootstrap.js` revokes those, but bootstrap runs BEFORE seed in the documented order
// (migrate → bootstrap → seed, and `tests/helpers.js` does exactly that), so whatever this file grants last is
// the posture the database keeps. Measured on a freshly built database: with this block absent, the app role
// held table-level DELETE on 12 tables, including both Razorpay money ledgers (`plugin_razorpay.order_log`,
// `plugin_razorpay.webhook_log`) — D-35 says it must never hold DELETE at all. That is the same 12-table
// violation SEC-2b recorded as fixed; it was not fixed, it was re-created by the next seed.
//
// So the tightening lives in a shared module and is applied at the END of every path that can widen grants,
// which is what makes the ordering safe to change rather than a trap for the next person.
{
  const { tightenAppRoleDeletes, tightenAppRoleColumns, dropRedundantIndexes } = await import('../src/grant-tightening.js');
  const { revoked, granted } = await tightenAppRoleDeletes(client);
  console.log(`app-role table DELETE tightened after replay: revoked in ${revoked.length} schema(s), re-granted on ${granted.length || 0} (${granted.join(', ') || 'none'})`);
  // DATX-1: the replay also re-grants table-level UPDATE/SELECT on schema app, undoing 077's
  // column scope. Re-apply the column tightening as the same final step.
  const cols = await tightenAppRoleColumns(client);
  console.log(`app-role column grants tightened after replay (077 scope): ${cols.join(', ') || 'none'}`);
  // DATX-12: the replay re-runs 032, which re-creates `intervention_plan_student_idx` — an index 106 drops
  // as fully covered. A migration-only drop is invisible after a seed, so the shared last-run module owns it.
  const droppedIdx = await dropRedundantIndexes(client);
  console.log(`redundant indexes dropped after replay: ${droppedIdx.join(', ') || 'none'}`);
}

await client.end();
