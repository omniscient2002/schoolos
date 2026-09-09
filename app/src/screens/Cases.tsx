/* ============================================================
   Cases — unified case management across every channel:
   WhatsApp, phone, walk-in, system events and staff referrals.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as seed from '../data/dataset';
import { useStore } from '../state/store';
import { Badge, Button, Card, DataTable, Empty, Modal, PageHead, Section, Stat, Tabs, useToast } from '../components/ui';
import { AiTraceCard, EvidenceChain } from '../components/Ai';
import { Icon } from '../components/Icon';
import { fmtDateShort, fmtNum, fmtRelative } from '../lib/format';
import type { AiTrace, CaseKind, SchoolCase } from '../types/domain';

/* ---------- ticking clock for SLA countdowns ---------- */
function useNow(ms = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const KIND_TABS: { id: string; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'complaint', label: 'Complaint' },
  { id: 'request', label: 'Request' },
  { id: 'reconciliation', label: 'Payment matching' },
  { id: 'compliance', label: 'Compliance' },
  { id: 'transport', label: 'Transport' },
  { id: 'facilities', label: 'Facilities' },
];
const STATUSES: SchoolCase['status'][] = ['open', 'triaged', 'in-progress', 'resolved', 'closed'];
const STATUS_LABEL: Record<SchoolCase['status'], string> = {
  open: 'Open', triaged: 'Triaged', 'in-progress': 'In-progress', resolved: 'Resolved', closed: 'Closed',
};
const STATUS_TONE: Record<SchoolCase['status'], 'info' | 'warning' | 'accent' | 'success' | 'neutral'> = {
  open: 'info', triaged: 'warning', 'in-progress': 'accent', resolved: 'success', closed: 'neutral',
};
const PRIORITY_TONE: Record<SchoolCase['priority'], 'danger' | 'warning' | 'neutral' | 'outline'> = {
  critical: 'danger', high: 'warning', normal: 'neutral', low: 'outline',
};
const ORIGIN_LABEL: Record<SchoolCase['origin'], string> = {
  'parent-whatsapp': 'WhatsApp', phone: 'Phone', 'walk-in': 'Walk-in', system: 'System', staff: 'Staff',
};
const ORIGIN_TONE: Record<SchoolCase['origin'], 'success' | 'info' | 'neutral' | 'ai' | 'accent'> = {
  'parent-whatsapp': 'success', phone: 'info', 'walk-in': 'neutral', system: 'ai', staff: 'accent',
};
const KIND_TONE: Record<CaseKind, 'warning' | 'info' | 'ai' | 'danger' | 'accent' | 'neutral'> = {
  complaint: 'warning', request: 'info', reconciliation: 'ai', compliance: 'danger', transport: 'accent', facilities: 'neutral', incident: 'danger', exception: 'neutral',
};
const KIND_SLA: Record<CaseKind, number> = {
  complaint: 24, request: 48, reconciliation: 12, compliance: 240, transport: 24, facilities: 72, incident: 24, exception: 96,
};
const CAMPUS_LABEL: Record<SchoolCase['campus'], string> = { north: 'North', city: 'City', east: 'East' };

function fmtH(hours: number): string {
  if (Math.abs(hours) < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  return `${Math.round(hours)}h`;
}

function slaInfo(c: SchoolCase, now: number) {
  const elapsedH = (now - c.openedOn.getTime()) / 3600000;
  const leftH = c.slaHours - elapsedH;
  const pct = Math.max(0, Math.min(100, (leftH / c.slaHours) * 100));
  if (leftH <= 0) return { label: `SLA breached ${fmtH(-leftH)} ago`, tone: 'danger' as const, pct, breached: true, atRisk: false };
  if (pct < 25) return { label: `Deadline soon — ${fmtH(leftH)} left`, tone: 'warning' as const, pct, breached: false, atRisk: true };
  return { label: `${fmtH(leftH)} of ${c.slaHours}h left`, tone: 'neutral' as const, pct, breached: false, atRisk: false };
}

const TRIAGE_TRACE: AiTrace = {
  trigger: 'Inbound parent WhatsApp message classified as a case',
  policy: 'Communication §1.1 (WhatsApp-first) · Privacy §1.2 (reads logged)',
  dataUsed: ['guardian thread', 'fees records', 'transport roster', 'incident index'],
  reasoningRole: 'Triage (classify + link only)',
  action: 'Opened the case, set priority, attached linked records',
  approvalStatus: 'Auto-triage allowed; the first reply to the guardian needs staff approval',
  verification: 'Linked records verified against IDs before attachment',
  model: 'Fast (classification) · ap-south-1',
  latencyMs: 310,
  tokens: 420,
  cost: '₹0.01',
};

export default function Cases() {
  const { session, domain, dispatch, actorName } = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const now = useNow();

  const [kind, setKind] = useState('all');
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState<{ kind: CaseKind; title: string; priority: SchoolCase['priority']; owner: string; origin: SchoolCase['origin'] }>({
    kind: 'complaint', title: '', priority: 'normal', owner: seed.staff[0]?.name ?? 'Admin Officer', origin: 'parent-whatsapp',
  });

  const owners = useMemo(
    () => Array.from(new Set([...seed.staff.map(s => s.name), ...seed.cases.map(c => c.owner)])),
    [],
  );

  const filtered = domain.cases.filter(c =>
    (kind === 'all' || c.kind === kind) &&
    (status === 'all' || c.status === status) &&
    (!q.trim() || `${c.id} ${c.title} ${c.owner}`.toLowerCase().includes(q.trim().toLowerCase())),
  );

  const hasReplied = (c: SchoolCase) => c.messages.some(m => !m.from.toLowerCase().includes('guardian'));
  const openCases = domain.cases.filter(c => c.status !== 'resolved' && c.status !== 'closed');
  const atRisk = openCases.filter(c => { const s = slaInfo(c, now); return s.atRisk; }).length;
  const breached = openCases.filter(c => { const s = slaInfo(c, now); return s.breached && !hasReplied(c); }).length;

  const createCase = () => {
    if (!form.title.trim()) { toast({ title: 'Give the case a short title', tone: 'info' }); return; }
    const id = `case_u${Date.now().toString(36).slice(-6)}`;
    const c: SchoolCase = {
      id, kind: form.kind, title: form.title.trim(), openedOn: new Date(), openedBy: actorName,
      origin: form.origin, owner: form.owner, priority: form.priority, slaHours: KIND_SLA[form.kind],
      status: 'open', campus: session.activeCampus,
      messages: [{
        on: new Date(), from: 'SchoolOS (auto)',
        text: `Case opened by ${actorName} · SLA ${KIND_SLA[form.kind]}h · AI triage attached: language detected, sentiment scored, linked records added`,
        internal: true,
      }],
      linkedRecords: [],
    };
    dispatch({ type: 'case/add', c });
    dispatch({
      type: 'audit/add',
      entry: {
        actor: actorName, actorRole: session.roleId, action: 'Opened case',
        recordType: 'Case', recordRef: `${id} — ${c.title}`,
        reason: `Origin: ${ORIGIN_LABEL[form.origin]}`, aiInvolved: false, risk: 'low',
        outcome: `Case created · SLA ${KIND_SLA[form.kind]}h · owner ${form.owner}`,
      },
    });
    toast({ title: 'Case created — deadline clock started', sub: `${id} · ${form.owner} owns it · AI triage attached`, tone: 'success' });
    setNewOpen(false);
    setForm(f => ({ ...f, title: '' }));
    navigate(`/cases/${id}`);
  };

  return (
    <>
      <PageHead
        title="Cases"
        sub={session.roleId === 'finance'
          ? 'Payment matching and fee-linked cases surface first for your role. Every case carries a deadline.'
          : 'One queue for every channel. Guardians never have to repeat themselves; nothing falls through.'}
        actions={<Button variant="primary" icon={<Icon.Plus size={14} />} onClick={() => setNewOpen(true)}>New case</Button>}
      />

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <Stat label="Open cases" value={openCases.length} sub={`${domain.cases.length} total · ${fmtNum(domain.cases.filter(c => c.origin === 'parent-whatsapp').length)} from WhatsApp`} />
        <Stat label="Deadline soon" value={atRisk} sub="unresolved · less than a quarter of the time left" />
        <Stat label="Over deadline" value={breached} sub="unresolved · past its deadline with no reply yet" />
        <Stat label="Avg first response" value="18m" sub="median, last 30 days · target 1h" />
      </div>

      <Tabs tabs={KIND_TABS.map(t => ({ id: t.id, label: t.label, count: t.id === 'all' ? domain.cases.length : domain.cases.filter(c => c.kind === t.id).length }))} active={kind} onChange={setKind} />

      <div className="u-flex" style={{ gap: 10, margin: '14px 0 16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="select" style={{ width: 170 }} value={status} onChange={e => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="all">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <div style={{ width: 280 }}>
          <input className="input" placeholder="Search by id, title or owner…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search cases" />
        </div>
        <span className="u-xs u-faint">{filtered.length} shown</span>
      </div>

      <Card>
        <DataTable<SchoolCase>
          columns={[
            { key: 'id', label: 'Case', width: 92, render: c => <span className="mono u-xs" style={{ fontWeight: 620 }}>{c.id}</span> },
            { key: 'kind', label: 'Kind', width: 110, render: c => <Badge tone={KIND_TONE[c.kind]}>{c.kind}</Badge> },
            {
              key: 'title', label: 'Title', render: c => (
                <div style={{ minWidth: 220 }}>
                  <div style={{ fontWeight: 580 }}>{c.title}</div>
                  <div className="u-xs u-faint">{CAMPUS_LABEL[c.campus]} campus · {c.messages.length} {c.messages.length === 1 ? 'entry' : 'entries'} in file</div>
                </div>
              ),
            },
            { key: 'openedOn', label: 'Opened', width: 130, render: c => <div><div className="u-small">{fmtDateShort(c.openedOn)}</div><div className="u-xs u-faint">{fmtRelative(c.openedOn)}</div></div> },
            { key: 'origin', label: 'Origin', width: 100, render: c => <Badge tone={ORIGIN_TONE[c.origin]}>{ORIGIN_LABEL[c.origin]}</Badge> },
            { key: 'owner', label: 'Owner', width: 140 },
            { key: 'priority', label: 'Priority', width: 84, render: c => <Badge tone={PRIORITY_TONE[c.priority]}>{c.priority}</Badge> },
            {
              key: 'sla', label: 'Deadline', width: 150, render: (c) => {
                const s = slaInfo(c, now);
                return (
                  <div>
                    <Badge tone={s.tone}>{s.label}</Badge>
                    <div className="progress" style={{ height: 3, marginTop: 5, maxWidth: 130 }}><div style={{ width: `${s.pct}%`, background: s.tone === 'danger' ? 'var(--danger)' : s.tone === 'warning' ? 'var(--warning)' : 'var(--accent)' }} /></div>
                  </div>
                );
              },
            },
            { key: 'status', label: 'Status', width: 100, render: c => <Badge tone={STATUS_TONE[c.status]} dot>{STATUS_LABEL[c.status]}</Badge> },
          ]}
          rows={filtered}
          rowKey={c => c.id}
          onRowClick={c => navigate(`/cases/${c.id}`)}
          empty={<Empty icon={<Icon.Clipboard size={26} />} title="No cases match" sub="Try another kind or status, or open a new case." />}
        />
      </Card>

      <div style={{ height: 22 }} />

      <Section title="AI triage on every inbound case" sub="Cases opened from parent WhatsApp are auto-triaged before a human sees them.">
        <Card>
          <div className="grid grid-2" style={{ gap: 16 }}>
            <div className="u-col" style={{ gap: 10 }}>
              <p className="u-small u-muted" style={{ margin: 0 }}>
                Language is detected so replies use the guardian's language template. Sentiment is scored to raise priority when
                a guardian contacts us repeatedly. Linked records — ledger entries, routes, prior cases — are attached before the
                case reaches a queue, so the owner starts with the full picture.
              </p>
              <EvidenceChain
                title={domain.cases.some(c => c.id === 'case_1') ? 'Triage chain — case_1 (Bus 14 complaint)' : 'Triage chain — how cases are processed'}
                steps={domain.cases.some(c => c.id === 'case_1') ? [
                  { label: 'Origin', detail: 'WhatsApp inbound · guardian thread · received 08:15 (inside allowed hours)', source: 'Communication log' },
                  { label: 'Language', detail: 'Detected: English · Hindi template attached for the reply', source: 'Reply classifier · Fast model' },
                  { label: 'Sentiment', detail: 'Frustrated — third contact about the same route this week', source: 'Sentiment scorer' },
                  { label: 'Linked records', detail: 'Bus 14 · Route 7 · Attendance 8-B · incident inc_1', source: 'Record linker · verified IDs', refType: 'transport' },
                ] : [
                  { label: 'Origin', detail: 'Channel and timestamp checked against communication windows', source: 'Communication log' },
                  { label: 'Language', detail: 'Detected per message; the guardian\u2019s template language is attached to the reply', source: 'Reply classifier · Fast model' },
                  { label: 'Sentiment', detail: 'Scored to raise priority when a guardian contacts us repeatedly', source: 'Sentiment scorer' },
                  { label: 'Linked records', detail: 'Ledger entries, routes and prior cases attach automatically', source: 'Record linker · verified IDs' },
                ]}
              />
            </div>
            <AiTraceCard trace={TRIAGE_TRACE} defaultOpen />
          </div>
        </Card>
      </Section>

      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="New case"
        sub="The deadline clock starts the moment you save. AI triage attaches automatically."
        footer={
          <>
            <Button variant="ghost" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button variant="primary" icon={<Icon.Check size={13} />} onClick={createCase} disabled={!form.title.trim()}>Create case</Button>
          </>
        }
      >
        <div className="u-col" style={{ gap: 12 }}>
          <div>
            <label className="u-xs" style={{ fontWeight: 640, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-3)' }} htmlFor="nc-kind">Kind</label>
            <select id="nc-kind" className="select" style={{ width: '100%', marginTop: 5 }} value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value as CaseKind }))}>
              {(['complaint', 'request', 'reconciliation', 'compliance', 'transport', 'facilities'] as CaseKind[]).map(k => <option key={k} value={k}>{k} · SLA {KIND_SLA[k]}h</option>)}
            </select>
          </div>
          <div>
            <label className="u-xs" style={{ fontWeight: 640, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-3)' }} htmlFor="nc-title">Title</label>
            <input id="nc-title" className="input" style={{ width: '100%', marginTop: 5 }} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Transport fee charged twice — September" />
          </div>
          <div className="grid grid-2" style={{ gap: 12 }}>
            <div>
              <label className="u-xs" style={{ fontWeight: 640, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-3)' }} htmlFor="nc-priority">Priority</label>
              <select id="nc-priority" className="select" style={{ width: '100%', marginTop: 5 }} value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value as SchoolCase['priority'] }))}>
                {(['low', 'normal', 'high', 'critical'] as SchoolCase['priority'][]).map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="u-xs" style={{ fontWeight: 640, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-3)' }} htmlFor="nc-origin">Origin</label>
              <select id="nc-origin" className="select" style={{ width: '100%', marginTop: 5 }} value={form.origin} onChange={e => setForm(f => ({ ...f, origin: e.target.value as SchoolCase['origin'] }))}>
                {(Object.keys(ORIGIN_LABEL) as SchoolCase['origin'][]).map(o => <option key={o} value={o}>{ORIGIN_LABEL[o]}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="u-xs" style={{ fontWeight: 640, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-3)' }} htmlFor="nc-owner">Owner</label>
            <select id="nc-owner" className="select" style={{ width: '100%', marginTop: 5 }} value={form.owner} onChange={e => setForm(f => ({ ...f, owner: e.target.value }))}>
              {owners.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div className="u-xs u-faint">Campus: {CAMPUS_LABEL[session.activeCampus]} (follows your active campus scope).</div>
        </div>
      </Modal>
    </>
  );
}
