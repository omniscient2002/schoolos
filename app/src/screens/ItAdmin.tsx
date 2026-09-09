/* ============================================================
   IT Admin console — platform health, access & sessions,
   API keys / integrations, feature flags, data residency and
   backups. Every control is wired with toasts + audit entries.
   ============================================================ */
import { useMemo, useState } from 'react';
import * as seed from '../data/dataset';
import { makeRng } from '../lib/rng';
import { useStore } from '../state/store';
import { Badge, Button, Card, DataTable, Modal, PageHead, Section, Stat, useToast } from '../components/ui';
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
  const { session, actorName, dispatch } = useStore();
  const toast = useToast();
  const isIt = session.roleId === 'itadmin';

  const [revoked, setRevoked] = useState<Set<string>>(new Set());
  const [rotating, setRotating] = useState<typeof API_KEYS[number] | null>(null);
  const [flags, setFlags] = useState<Record<string, boolean>>({
    'offline-mode': true, 'live-events': true, 'ai-shield': true, 'parent-digest': true, 'transport-leniency': true,
  });

  const sessions = useMemo(() => SESSION_ROWS.filter(s => !revoked.has(s.id)), [revoked]);

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

  const audit = (action: string, recordRef: string, outcome: string) => dispatch({
    type: 'audit/add',
    entry: { actor: actorName, actorRole: session.roleId, action, recordType: 'IT Admin', recordRef, aiInvolved: false, risk: 'low' as const, outcome },
  });

  const revoke = (row: SessionRow) => {
    setRevoked(prev => new Set(prev).add(row.id));
    toast({ title: `Session revoked — ${row.person.name}`, sub: 'Device signs out on its next poll (≤ 60s).', tone: 'success' });
    audit('Revoked access session', `${row.person.name} · ${row.device}`, 'Session terminated; event sent to device');
  };

  const rotate = () => {
    if (!rotating) return;
    toast({ title: `${rotating.name} key rotated`, sub: 'Previous key stays valid for 24h for in-flight calls.', tone: 'success' });
    audit('Rotated API key', rotating.name, 'New secret issued · old key grace 24h');
    setRotating(null);
  };

  const toggleFlag = (id: string) => {
    setFlags(f => ({ ...f, [id]: !f[id] }));
    toast({ title: 'Flag changed — rollout updated (audit entry recorded)', tone: 'info' });
    audit('Toggled feature flag', FLAGS.find(x => x.id === id)?.label ?? id, `Flag → ${flags[id] ? 'off' : 'on'} for all campuses`);
  };

  return (
    <>
      <PageHead
        title="IT Admin"
        sub={isIt
          ? 'Platform posture for all three campuses. Key rotations, flag rollouts and session revocations are audited.'
          : `Viewing as ${actorName}. In this demo role every control works and records to the audit trail.`}
        actions={<Badge tone={isIt ? 'accent' : 'outline'} dot>{isIt ? 'Full access' : 'Demo role'}</Badge>}
      />

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <Stat label="Uptime · 30d" value="99.97%" sub="Target 99.9 · 0 sev-2 incidents" />
        <Stat label="Active sessions" value="214" sub={`${sessions.filter(s => s.status === 'active').length} staff sessions in this view`} />
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
      <Section title="Access & sessions" sub="Staff sign-ins across campuses. Revoking signs the device out within a minute." style={{ marginBottom: 4 }}>
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
            { key: 'act', label: '', align: 'right', render: r => (
              <Button size="sm" variant="danger-ghost" disabled={r.status === 'expired'} onClick={() => revoke(r)}>Revoke</Button>
            ) },
          ]}
          rows={sessions}
          rowKey={r => r.id}
          empty={<Card pad><EmptyInline title="No sessions" sub="Everyone is signed out." /></Card>}
        />
      </Section>

      {/* ---------- API keys & integrations ---------- */}
      <Section title="API keys & integrations" sub="Outbound systems. Rotating a key issues a new secret with a 24-hour overlap." style={{ marginBottom: 4 }}>
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
                  <Button size="sm" variant="secondary" icon={<Icon.Key size={13} />} onClick={() => setRotating(k)}>Rotate key</Button>
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
            The feature-flag toggles below write through this registry — flipping one records {`control_plane.changed`} with actor, scope and reason.
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
              <label className="switch" title={flags[f.id] ? 'On — click to disable' : 'Off — click to enable'}>
                <input type="checkbox" checked={flags[f.id]} onChange={() => toggleFlag(f.id)} aria-label={`Toggle ${f.label}`} />
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
              <Icon.Download size={15} style={{ color: 'var(--accent-text)', flexShrink: 0, marginTop: 1 }} />
              <span>
                Last backup <strong>today 03:00 IST</strong> — success, encrypted (AES-256), verified restore-check.
                Point-in-time recovery covers the last 14 days.
              </span>
            </div>
            <div className="u-faint" style={{ paddingLeft: 23 }}>
              Snapshots are pulled from the Mumbai region only and are watermarked for this demo.
            </div>
            <div className="u-flex" style={{ gap: 8, paddingLeft: 23 }}>
              <Button size="sm" variant="secondary" icon={<Icon.Download size={13} />} onClick={() => { toast({ title: 'Snapshot download started', sub: 'Encrypted backup · ap-south-1 · you will get a signed link by email.', tone: 'info' }); audit('Requested backup snapshot', 'nightly snapshot 03:00', 'Signed download link issued'); }}>
                Download snapshot
              </Button>
              <Button size="sm" variant="ghost" icon={<Icon.File size={13} />} onClick={() => { toast({ title: 'Export queued — attendance & fees (CSV)', sub: 'You will be notified when the export is ready.', tone: 'info' }); audit('Requested data export', 'attendance + fees CSV', 'Export job queued'); }}>
                Export data
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {/* ---------- rotate-key confirm modal ---------- */}
      <Modal
        open={rotating !== null}
        onClose={() => setRotating(null)}
        title={`Rotate ${rotating?.name ?? ''} key`}
        sub="The new secret applies immediately; the old key stays valid for 24 hours."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRotating(null)}>Cancel</Button>
            <Button variant="primary" icon={<Icon.Key size={14} />} onClick={rotate}>Rotate now</Button>
          </>
        }
      >
        <p className="u-small" style={{ lineHeight: 1.6 }}>
          Integrations using the old key keep working during the overlap. This action is recorded in the audit trail
          with your name and the timestamp. Rotation does not interrupt {rotating?.name === 'Payment gateway' ? 'pending settlements' : 'in-flight jobs'}.
        </p>
      </Modal>
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
