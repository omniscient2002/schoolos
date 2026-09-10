/* ============================================================
   IT Admin console — platform health, access & sessions,
   API keys / integrations, feature flags, data residency and
   backups. T305 (§9.5): session revocation, key rotation, flag
   rollout, snapshot download and data export have no server
   doors — those controls render disabled with honest copy.
   ============================================================ */
import * as seed from '../data/dataset';
import { makeRng } from '../lib/rng';
import { useStore } from '../state/store';
import { Badge, Button, Card, DataTable, PageHead, Section, Stat } from '../components/ui';
import { Sparkline } from '../components/Chart';
import { Icon } from '../components/Icon';
import { fmtRelative } from '../lib/format';
import type { CampusId, Person } from '../types/domain';

/* ---------- deterministic demo data (makeRng 4040 per spec) ---------- */
const rng = makeRng(4040);

interface SessionRow {
  id: string; person: Person; role: string; lastActive: Date;
  device: string; campus: CampusId; status: 'active' | 'expired';
}
const DEVICES = ['Chrome · macOS', 'Safari · iPhone', 'Edge · Windows', 'SchoolOS App · Android', 'Firefox · Ubuntu', 'Chrome · Windows'];
const SESSION_ROWS: SessionRow[] = (() => {
  const pool = [...seed.teachers, ...seed.staff];
  /* Empty-world law: no people → no synthetic session rows. */
  if (!pool.length) return [] as SessionRow[];
  return Array.from({ length: 10 }, (_, i) => {
    const person = pool[(i * 7 + rng.int(0, 2)) % pool.length];
  const lastActive = new Date(Date.now() - rng.int(2, 900) * 60000);
  return {
    id: `sess_${i + 1}`, person,
    role: person.role ?? (person.type === 'staff' ? 'Admin Staff' : 'Teacher'),
      lastActive, device: rng.pick(DEVICES), campus: person.campus,
      status: rng.chance(0.7) ? 'active' : 'expired',
    };
  });
})();

const spark = (seedN: number) => {
  const r = makeRng(seedN);
  return Array.from({ length: 14 }, (_, i) => 30 + r.next() * 40 + (i % 4) * 4);
};

const HEALTH = [
  { name: 'Postgres primary', metric: '14ms query p95', note: 'Replication lag 0.2s · 3 read replicas', status: 'healthy' as const, icon: <Icon.Database size={15} />, points: spark(11) },
  { name: 'Queue (jobs)', metric: '0 backlog', note: '1,240 jobs/hr · oldest 2s', status: 'healthy' as const, icon: <Icon.Layers size={15} />, points: spark(22) },
  { name: 'AI gateway', metric: 'p95 1.4s', note: 'Frontier + Fast + Batch routes', status: 'healthy' as const, icon: <Icon.Sparkle size={15} />, points: spark(33) },
  { name: 'WhatsApp BSP', metric: '99.2% delivery', note: 'Template quality: high · 0 blocks', status: 'healthy' as const, icon: <Icon.Message size={15} />, points: spark(44) },
  { name: 'GPS provider', metric: '1 vehicle offline', note: 'Bus 14 pinging every 10s from depot wifi', status: 'degraded' as const, icon: <Icon.Bus size={15} />, points: spark(55) },
  { name: 'Tally gateway', metric: 'Last sync 06:00', note: '38 vouchers imported today', status: 'connected' as const, icon: <Icon.Refresh size={15} />, points: spark(66) },
];

const API_KEYS = [
  { id: 'tally', name: 'Tally gateway', icon: <Icon.Refresh size={15} />, status: 'connected', tone: 'success' as const, scope: 'Ledger sync · vouchers read/write', lastUse: 'Today 06:00' },
  { id: 'pay', name: 'Payment gateway', icon: <Icon.CreditCard size={15} />, status: 'active', tone: 'success' as const, scope: 'Collect · refunds · UPI mandates', lastUse: '12 min ago' },
  { id: 'sms', name: 'SMS (DLT)', icon: <Icon.Message size={15} />, status: 'active', tone: 'success' as const, scope: 'Send only · registered templates', lastUse: 'Yesterday 16:40' },
  { id: 'wa', name: 'WhatsApp BSP', icon: <Icon.Message size={15} />, status: 'active', tone: 'success' as const, scope: 'Session + template messages', lastUse: '4 min ago' },
  { id: 'gps', name: 'GPS provider', icon: <Icon.Bus size={15} />, status: 'degraded', tone: 'warning' as const, scope: 'Telemetry · 10s ping · geofence', lastUse: 'Live (1 vehicle offline)' },
];

const FLAGS = [
  { id: 'offline-mode', label: 'Offline mode', desc: 'Attendance and messages queue locally when the network drops, then sync.' },
  { id: 'live-events', label: 'Live event stream', desc: 'Operational events (attendance, payments, transport, maintenance) emit into the live stream.' },
  { id: 'ai-shield', label: 'AI Shield — strict', desc: 'Block AI suggestions that need a human decision, instead of passing them on.' },
  { id: 'parent-digest', label: 'Parent digest v2', desc: 'Nightly batched WhatsApp digest per guardian; replaces per-event pings.' },
  { id: 'transport-leniency', label: 'Transport attendance leniency', desc: 'Students on verified-delayed routes are marked present until 09:30.' },
];

/* ---------- screen ---------- */
export default function ItAdmin() {
  const { session, actorName } = useStore();
  const isIt = session.roleId === 'itadmin';

  /* T305 (§9.5): revocation, rotation and flag toggles have no doors — the
     mutable states behind them are gone; the controls render disabled. */
  const FLAG_DEFAULTS: Record<string, boolean> = {
    'offline-mode': true, 'live-events': true, 'ai-shield': true, 'parent-digest': true, 'transport-leniency': true,
  };

  /* Control Plane registry (docs/06 §2.A/§4.1) — one auditable home for every
     governance object. Read-only here; changes land as control_plane.changed events. */
  const CONTROL_PLANE = [
    { kind: 'Feature flag', name: 'offline-mode', value: 'on', scope: 'all campuses', lastChange: '8 days ago · IT admin', policy: 'Platform §3.2' },
    { kind: 'Feature flag', name: 'ai-shield (student queries)', value: 'on · strict', scope: 'student/parent surfaces', lastChange: '12 days ago · IT admin', policy: 'AI Gov §4.1' },
    { kind: 'AI capability', name: 'ask.investigate', value: 'allowed · cites evidence', scope: 'staff roles', lastChange: '15 days ago · principal', policy: 'AI Gov §2.3' },
    { kind: 'AI capability', name: 'maintenance.priority', value: 'suggests · a human always has the final say', scope: 'facilities', lastChange: 'with v3 release', policy: 'Facilities §1.2' },
    { kind: 'AI capability', name: 'reception.answer', value: 'allowed · grounded + consent line', scope: 'front desk', lastChange: 'with v3 release', policy: 'Front Desk §1.1' },
    { kind: 'Policy version', name: 'School policies', value: 'v2026.1', scope: 'all campuses', lastChange: 'On record · board-approved', policy: 'School policies' },
    { kind: 'Integration scope', name: 'payments.gateway', value: 'read + reconcile', scope: 'finance', lastChange: '6 days ago · IT admin', policy: 'Fees §5.1' },
    { kind: 'Integration scope', name: 'whatsapp.business', value: 'send + receive · templates locked', scope: 'comms', lastChange: '6 days ago · IT admin', policy: 'Communication §1.2' },
  ];

  return (
    <>
      <PageHead
        title="IT Admin"
        sub={isIt
          ? 'Platform posture for all three campuses. Security operations (session revoke, key rotation, exports) require server support and are disabled in this build.'
          : `Viewing as ${actorName}. Security operations require server support and are disabled in this build.`}
        actions={<Badge tone={isIt ? 'accent' : 'outline'} dot>{isIt ? 'Full access' : 'Demo role'}</Badge>}
      />

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <Stat label="Uptime · 30d" value="99.97%" sub="Target 99.9 · 0 sev-2 incidents" />
        <Stat label="Active sessions" value="214" sub={`${SESSION_ROWS.filter(s => s.status === 'active').length} staff sessions in this view`} />
        <Stat label="API p95" value="380ms" sub="Read p50 88ms · write p50 160ms" />
        <Stat label="Failed logins · 24h" value="3" sub="All rate-limited · 0 lockouts" />
      </div>

      {/* ---------- system health ---------- */}
      <Section title="System health" sub="Live service posture — checked every 30s from the status worker." style={{ marginBottom: 4 }}>
        <div className="grid grid-3">
          {HEALTH.map(h => (
            <Card key={h.name} pad>
              <div className="u-between" style={{ marginBottom: 8 }}>
                <span className="u-flex u-small u-bold" style={{ gap: 8 }}>{h.icon}{h.name}</span>
                <StatusDot status={h.status} />
              </div>
              <div className="u-between">
                <div>
                  <div className="u-small" style={{ fontWeight: 600 }}>{h.metric}</div>
                  <div className="u-xs u-faint" style={{ marginTop: 2 }}>{h.note}</div>
                </div>
                <Sparkline points={h.points} color={h.status === 'degraded' ? 'var(--warning)' : 'var(--success)'} width={92} height={30} />
              </div>
            </Card>
          ))}
        </div>
      </Section>

      {/* ---------- access & sessions ---------- */}
      <Section title="Access & sessions" sub="Staff sign-ins across campuses. Not connected — revoking a session requires server support." style={{ marginBottom: 4 }}>
        <DataTable
          columns={[
            { key: 'name', label: 'Staff', render: r => <span style={{ fontWeight: 570 }}>{r.person.name}</span> },
            { key: 'role', label: 'Role', render: r => <span className="u-muted">{r.role}</span> },
            { key: 'lastActive', label: 'Last active', render: r => <span className="tnum">{fmtRelative(r.lastActive)}</span> },
            { key: 'device', label: 'Device', render: r => <span className="u-muted">{r.device}</span> },
            { key: 'campus', label: 'Location', render: r => seed.campuses.find(c => c.id === r.campus)?.name },
            { key: 'status', label: 'Status', render: r => r.status === 'active'
              ? <Badge tone="success" dot>active</Badge>
              : <Badge tone="neutral">expired</Badge> },
            { key: 'act', label: '', align: 'right', render: () => (
              <Button size="sm" variant="danger-ghost" disabled title="Not connected — operations require server support">Revoke</Button>
            ) },
          ]}
          rows={SESSION_ROWS}
          rowKey={r => r.id}
          empty={<Card pad><EmptyInline title="No sessions" sub="Everyone is signed out." /></Card>}
        />
      </Section>

      {/* ---------- API keys & integrations ---------- */}
      <Section title="API keys & integrations" sub="Outbound systems on record. Not connected — key rotation requires server support." style={{ marginBottom: 4 }}>
        <div className="grid grid-3">
          {API_KEYS.map(k => (
            <Card key={k.id} pad>
              <div className="u-col" style={{ gap: 8 }}>
                <div className="u-between">
                  <span className="u-flex u-small u-bold" style={{ gap: 8 }}>{k.icon}{k.name}</span>
                  <Badge tone={k.tone} dot={k.tone === 'warning'}>{k.status}</Badge>
                </div>
                <div className="u-col u-small u-muted" style={{ gap: 3 }}>
                  <span><span className="u-faint">Scope:</span> {k.scope}</span>
                  <span><span className="u-faint">Last use:</span> {k.lastUse}</span>
                  <span className="mono u-xs u-faint">key •••• {k.id.padEnd(4, 'x').slice(0, 4).toUpperCase()}</span>
                </div>
                <div>
                  <Button size="sm" variant="secondary" icon={<Icon.Key size={13} />} disabled title="Not connected — operations require server support">Rotate key</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </Section>

      {/* ---------- control plane registry ---------- */}
      <Section title="Platform controls" sub="One activity log of every switch, AI rule and connection. Every change is recorded." style={{ marginBottom: 4 }}>
        <Card pad>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-3)' }}>
                  <th style={{ padding: '8px 10px 8px 0', fontWeight: 560 }}>Kind</th>
                  <th style={{ padding: '8px 10px', fontWeight: 560 }}>Name</th>
                  <th style={{ padding: '8px 10px', fontWeight: 560 }}>Value</th>
                  <th style={{ padding: '8px 10px', fontWeight: 560 }}>Scope</th>
                  <th style={{ padding: '8px 10px', fontWeight: 560 }}>Policy</th>
                  <th style={{ padding: '8px 10px', fontWeight: 560 }}>Last change</th>
                </tr>
              </thead>
              <tbody>
                {CONTROL_PLANE.map((r, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '9px 10px 9px 0' }}><Badge tone={r.kind === 'Feature flag' ? 'info' : r.kind === 'AI capability' ? 'ai' : r.kind === 'Policy version' ? 'accent' : 'neutral'}>{r.kind}</Badge></td>
                    <td style={{ padding: '9px 10px', fontWeight: 560 }}>{r.name}</td>
                    <td style={{ padding: '9px 10px' }}>{r.value}</td>
                    <td style={{ padding: '9px 10px' }} className="u-muted">{r.scope}</td>
                    <td style={{ padding: '9px 10px' }}><span className="u-mono u-xs u-faint">{r.policy}</span></td>
                    <td style={{ padding: '9px 10px' }} className="u-small u-muted">{r.lastChange}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="u-xs u-faint" style={{ marginTop: 10, lineHeight: 1.55 }}>
            Display-only in this build — the feature switches below do not write to a registry; rollout requires server support.
          </div>
        </Card>
      </Section>

      {/* ---------- feature flags ---------- */}
      <Section title="Feature switches" sub="Rolled out campus by campus. Changes apply on the next refresh." style={{ marginBottom: 4 }}>
        <Card pad>
          {FLAGS.map((f, i) => (
            <div key={f.id} className="u-between" style={{ gap: 14, padding: '11px 0', borderBottom: i < FLAGS.length - 1 ? '1px solid var(--border-subtle)' : undefined }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 580 }}>{f.label}</div>
                <div className="u-small u-muted">{f.desc}</div>
              </div>
              <label className="switch" title="Not connected — flag rollout requires server support">
                <input type="checkbox" checked={FLAG_DEFAULTS[f.id]} disabled aria-label={`Toggle ${f.label} (not connected)`} />
                <span className="track" />
              </label>
            </div>
          ))}
        </Card>
      </Section>

      {/* ---------- residency + backup ---------- */}
      <div className="grid grid-2" style={{ alignItems: 'stretch' }}>
        <Card head="Data residency & compliance" actions={<Badge tone="accent">Compliance pack: India CBSE v2026.1</Badge>}>
          <div className="u-col u-small" style={{ gap: 10 }}>
            <div className="u-flex" style={{ gap: 8 }}>
              <Icon.Shield size={15} style={{ color: 'var(--accent-text)', flexShrink: 0, marginTop: 1 }} />
              <span>
                All student and guardian data is stored in <strong>ap-south-1 (Mumbai)</strong>. No cross-border transfer.
                Processing is purpose-limited under the <strong>DPDP Act 2023</strong> — consent artifacts are kept per guardian,
                and any breach is reported to the Data Protection Board within 72 hours.
              </span>
            </div>
            <div className="u-col" style={{ gap: 5, paddingLeft: 23 }}>
              <span className="u-faint">Retention — attendance <strong className="tnum">5 years</strong> · fees <strong className="tnum">10 years</strong> · chats <strong className="tnum">90 days</strong></span>
              <span className="u-faint">Guardian chat exports exclude other children&apos;s records (Privacy §1.3).</span>
            </div>
          </div>
        </Card>

        <Card head="Backup & export">
          <div className="u-col u-small" style={{ gap: 10 }}>
            <div className="u-flex" style={{ gap: 8 }}>
              <Icon.Download size={15} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 1 }} />
              <span>
                <strong>No backups are configured for this school yet.</strong> Snapshot download, exports and
                point-in-time recovery require server support and are disabled in this build.
              </span>
            </div>
            <div className="u-faint" style={{ paddingLeft: 23 }}>
              Until a backup job is connected, treat the data in SchoolOS as the only copy.
            </div>
            <div className="u-flex" style={{ gap: 8, paddingLeft: 23 }}>
              <Button size="sm" variant="secondary" icon={<Icon.Download size={13} />} disabled title="Not connected — operations require server support">
                Download snapshot
              </Button>
              <Button size="sm" variant="ghost" icon={<Icon.File size={13} />} disabled title="Not connected — operations require server support">
                Export data
              </Button>
            </div>
            <div className="u-xs u-faint" style={{ paddingLeft: 23 }}>
              Not connected — snapshot download and data export require server support and are disabled in this build.
            </div>
          </div>
        </Card>
      </div>

    </>
  );
}

/* ---------- small pieces ---------- */
function StatusDot({ status }: { status: 'healthy' | 'degraded' | 'connected' }) {
  const color = status === 'degraded' ? 'var(--warning)' : 'var(--success)';
  const label = status === 'healthy' ? 'healthy' : status === 'connected' ? 'connected' : 'degraded';
  return (
    <span className="badge" style={{ background: `color-mix(in srgb, ${color} 12%, transparent)`, color }}>
      <span className="dot" style={{ background: color }} />{label}
    </span>
  );
}

function EmptyInline({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="u-col" style={{ alignItems: 'center', gap: 4, padding: 20, textAlign: 'center' }}>
      <span style={{ fontWeight: 600 }}>{title}</span>
      {sub && <span className="u-small u-faint">{sub}</span>}
    </div>
  );
}
