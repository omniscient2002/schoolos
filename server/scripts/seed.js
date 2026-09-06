// Seed: Meridian International Academy — the demo tenant.
// Idempotent: wipes the tenant and reinserts. Values match the frontend demo corpus.
import pg from 'pg';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';
import { hashPassword } from '../src/auth.js';

const client = new pg.Client({ connectionString: config.databaseUrl });
await client.connect();

const DEMO_PW = 'schoolos-demo';

// ---- tenant (clean re-seed: truncate all tenant-scoped tables) ----
await client.query(`TRUNCATE app.tenants CASCADE`);
const t = (await client.query(
  `INSERT INTO app.tenants (slug, name, config) VALUES ('meridian', 'Meridian International Academy', '{"campuses":["north","south"]}'::jsonb) RETURNING id`
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
await client.query(`UPDATE app.guardians SET name='Kavita Sharma' WHERE student_id=$1`, [aarav.id]);
// guardians for 8-B riders
const guardians8B = students.filter(s => s.grade === '8' && s.section === 'B').slice(0, 15);
for (const s of guardians8B) {
  await client.query(
    `INSERT INTO app.guardians (tenant_id, student_id, name, phone, relation, is_primary) VALUES ($1,$2,$3,$4,'mother',true)`,
    [T, s.id, `Guardian of ${s.name}`, `+91 97${String(20000000+students.indexOf(s)).slice(0,8)}`]);
}

// ---- fee plans & obligations ----
for (const s of students) {
  await client.query(
    `INSERT INTO app.fee_plans (tenant_id, student_id, term, total_cents, installments) VALUES ($1,$2,'Term 2',6350000,3)`,
    [T, s.id]);
  const parts = [
    ['Installment 1 — July', 2250000, '2026-07-05'],
    ['Term 2 installment — September', 1850000, '2026-10-05'],
    ['Installment 3 — November', 2250000, '2026-11-05'],
  ];
  for (const [label, cents, due] of parts) {
    const paid = label.includes('July') ? cents : (label.includes('November') ? 0 : (Math.random() < 0.8 ? 0 : 1850000));
    await client.query(
      `INSERT INTO app.fee_obligations (tenant_id, student_id, term, label, due_on, amount_cents, paid_cents, status, source_ref)
       VALUES ($1,$2,'Term 2',$3,$4,$5,$6,$7,'TALLY-txn-${Math.floor(Math.random()*9000)+1000}')`,
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
    if (is8B && disrupted) status = s.route === 'Route 7' ? 'absent' : (Math.random() < 0.9 ? 'present' : 'absent');
    else if (Math.random() < 0.055) status = 'absent';
    else if (Math.random() < 0.02) status = 'late';
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
for (const mig of ['009_school_plugin_catalog.sql', '010_wave1_plugin_runtime.sql']) {
  const catalogSql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations', mig), 'utf8');
  await client.query(catalogSql);
}

console.log(`Seeded tenant meridian: ${students.length} students, ${users.length} users, ${wos.length} WOs, 5 migration sources, 7 catalog plugins (2 migrations replayed).`);
await client.end();
