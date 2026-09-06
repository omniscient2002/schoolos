/* ============================================================
   Audit — the immutable ledger. Filters, full-text search,
   entry drawer with the immutability explainer, CSV export.
   ============================================================ */
import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { Badge, Button, Card, DataTable, Drawer, Empty, KeyValue, PageHead, Section, Stat, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { fmtDateTime, fmtRelative } from '../lib/format';
import type { AuditEntry } from '../types/domain';

const ROLE_LABEL: Record<string, string> = {
  principal: 'Principal', teacher: 'Teacher', coordinator: 'Coordinator', finance: 'Finance',
  admissions: 'Admissions', transport: 'Transport', parent: 'Parent', student: 'Student',
  owner: 'Owner', itadmin: 'IT Admin',
};
const RISK_TONE: Record<AuditEntry['risk'], 'success' | 'warning' | 'danger'> = {
  low: 'success', medium: 'warning', high: 'danger',
};

type AiFilter = 'all' | 'yes' | 'no';

export default function Audit() {
  const { domain, dispatch, actorName, session } = useStore();
  const toast = useToast();

  const ledger = domain.audit;

  const [role, setRole] = useState('all');
  const [ai, setAi] = useState<AiFilter>('all');
  const [risk, setRisk] = useState('all');
  const [range, setRange] = useState<7 | 30>(30);
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const roles = useMemo(() => Array.from(new Set(ledger.map(a => a.actorRole))), [ledger]);

  const filtered = ledger.filter(a => {
    if (role !== 'all' && a.actorRole !== role) return false;
    if (ai === 'yes' && !a.aiInvolved) return false;
    if (ai === 'no' && a.aiInvolved) return false;
    if (risk !== 'all' && a.risk !== risk) return false;
    if (Date.now() - a.on.getTime() > range * 86400000) return false;
    if (q.trim() && !`${a.recordRef} ${a.action} ${a.actor} ${a.recordType}`.toLowerCase().includes(q.trim().toLowerCase())) return false;
    return true;
  });

  const selected = filtered.find(a => a.id === openId) ?? ledger.find(a => a.id === openId) ?? null;

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const entriesToday = ledger.filter(a => a.on.getTime() >= todayStart.getTime()).length;
  const aiPct = ledger.length ? Math.round((ledger.filter(a => a.aiInvolved).length / ledger.length) * 100) : 0;
  const highRisk = ledger.filter(a => a.risk === 'high').length;
  const aiExamples = ledger.filter(a => a.aiInvolved).slice(0, 3);

  const doExport = () => {
    toast({
      title: `Audit export queued — CSV with ${ledger.length} entries`,
      sub: 'A signed download link will appear in Documents. Exports are themselves audit-logged.',
      tone: 'success',
    });
    dispatch({
      type: 'audit/add',
      entry: {
        actor: actorName, actorRole: session.roleId, action: 'Audit exported',
        recordType: 'Audit ledger', recordRef: `CSV · ${ledger.length} entries · signed`,
        reason: 'Board review / compliance archive', aiInvolved: false, risk: 'low',
        outcome: 'Export queued — a signed download link was generated',
      },
    });
  };

  return (
    <>
      <PageHead
        title="Audit ledger"
        sub={session.roleId === 'itadmin'
          ? 'Append-only. Even you cannot edit or delete an entry — nightly verification proves the chain.'
          : 'Who did what, when, why and under which policy. AI actions appear here exactly like human ones.'}
        actions={<Button variant="primary" icon={<Icon.Download size={14} />} onClick={doExport}>Export CSV</Button>}
      />

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <Stat label="Entries today" value={entriesToday} sub={`${ledger.length} in the visible ledger`} />
        <Stat label="AI-involved" value={`${aiPct}%`} sub="of all actions name a model run" />
        <Stat label="High-risk actions" value={highRisk} sub="each requires a named approver" />
        <Stat label="Exports this month" value="2" sub="signed CSV · board review" />
      </div>

      <Section title="Filters" sub="The ledger is searchable on record references, actors and actions.">
        <div className="u-flex" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <select className="select" style={{ width: 160 }} value={role} onChange={e => setRole(e.target.value)} aria-label="Filter by actor role">
            <option value="all">All roles</option>
            {roles.map(r => <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>)}
          </select>
          <select className="select" style={{ width: 160 }} value={risk} onChange={e => setRisk(e.target.value)} aria-label="Filter by risk">
            <option value="all">All risk levels</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
          <div className="tabs-pill" role="tablist" aria-label="AI involvement filter">
            {([['all', 'All'], ['yes', 'AI involved'], ['no', 'Human only']] as [AiFilter, string][]).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={ai === id} className={`tab ${ai === id ? 'active' : ''}`} onClick={() => setAi(id)}>{label}</button>
            ))}
          </div>
          <div className="tabs-pill" role="tablist" aria-label="Date range">
            {([7, 30] as const).map(r => (
              <button key={r} role="tab" aria-selected={range === r} className={`tab ${range === r ? 'active' : ''}`} onClick={() => setRange(r)}>Last {r} days</button>
            ))}
          </div>
          <div style={{ width: 260 }}>
            <input className="input" placeholder="Search record ref, action, actor…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search the audit ledger" />
          </div>
          <span className="u-xs u-faint">{filtered.length} of {ledger.length} entries</span>
        </div>
      </Section>

      <Card>
        <DataTable<AuditEntry>
          caption="AI audit ledger — who decided what, when and why"
          columns={[
            {
              key: 'on', label: 'When', width: 150, render: a => (
                <div>
                  <div className="u-small">{fmtDateTime(a.on)}</div>
                  <div className="u-xs u-faint">{fmtRelative(a.on)}</div>
                </div>
              ),
            },
            {
              key: 'actor', label: 'Actor', width: 170, render: a => (
                <div>
                  <div className="u-small" style={{ fontWeight: 590 }}>{a.actor}</div>
                  <div className="u-xs u-faint">{ROLE_LABEL[a.actorRole] ?? a.actorRole}</div>
                </div>
              ),
            },
            { key: 'action', label: 'Action', width: 200, render: a => <span className="u-small" style={{ fontWeight: 560 }}>{a.action}</span> },
            {
              key: 'record', label: 'Record', width: 210, render: a => (
                <div>
                  <div className="u-xs u-faint">{a.recordType}</div>
                  <div className="u-small mono u-truncate" style={{ maxWidth: 200 }}>{a.recordRef}</div>
                </div>
              ),
            },
            { key: 'reason', label: 'Reason', render: a => <span className="u-small u-muted">{a.reason ?? '—'}</span> },
            { key: 'policyRef', label: 'Policy', width: 150, render: a => a.policyRef ? <span className="u-xs mono" style={{ color: 'var(--accent-text)' }}>{a.policyRef}</span> : <span className="u-faint u-xs">—</span> },
            { key: 'aiInvolved', label: 'AI', width: 64, render: a => a.aiInvolved ? <Badge tone="ai">AI</Badge> : <span className="u-xs u-faint">—</span> },
            { key: 'risk', label: 'Risk', width: 84, render: a => <Badge tone={RISK_TONE[a.risk]}>{a.risk}</Badge> },
            { key: 'outcome', label: 'Outcome', width: 220, render: a => <span className="u-small u-muted u-truncate" style={{ maxWidth: 220, display: 'inline-block' }}>{a.outcome}</span> },
          ]}
          rows={filtered}
          rowKey={a => a.id}
          onRowClick={a => setOpenId(a.id)}
          empty={<Empty icon={<Icon.Lock size={26} />} title="No entries match these filters" sub="Widen the date range or clear the search." />}
        />
      </Card>

      <div style={{ height: 22 }} />

      <Section title="AI reads are logged too" sub="It is not only actions: every model read of student data lands here with its policy basis.">
        <div className="grid grid-2">
          <Card>
            <div className="u-flex" style={{ gap: 9, marginBottom: 8 }}>
              <Icon.Sparkle size={15} style={{ color: 'var(--ai)', flexShrink: 0, marginTop: 1 }} />
              <div className="u-small" style={{ fontWeight: 620 }}>Reads, rankings, drafts and recommendations — all with the data they used.</div>
            </div>
            <div className="u-col" style={{ gap: 8 }}>
              {aiExamples.length === 0 && <span className="u-small u-faint">No AI-involved entries in the current view.</span>}
              {aiExamples.map(a => (
                <div key={a.id} className="u-flex" style={{ gap: 9, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', alignItems: 'flex-start' }}>
                  <Badge tone="ai">AI</Badge>
                  <div style={{ minWidth: 0 }}>
                    <div className="u-small" style={{ fontWeight: 570 }}>{a.action}</div>
                    <div className="u-xs u-faint mono u-truncate">{a.recordRef}</div>
                    <div className="u-xs u-muted">{a.outcome}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <div className="u-flex" style={{ gap: 9, marginBottom: 8 }}>
              <Icon.Lock size={15} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
              <div className="u-small" style={{ fontWeight: 620 }}>Why the ledger can be trusted</div>
            </div>
            <ul className="u-small u-muted" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
              <li>Append-only — each entry carries a hash of the previous one; edits would break the chain.</li>
              <li>Verified nightly at 02:00 against the hash chain; drift raises a critical incident.</li>
              <li>Exportable as a signed CSV/PDF for board review and regulatory inspection.</li>
              <li>Retention: 7 years. Purges require two-person approval and are themselves logged.</li>
            </ul>
          </Card>
        </div>
      </Section>

      <Drawer
        open={!!selected}
        onClose={() => setOpenId(null)}
        title={selected ? `${selected.action}` : ''}
        sub={selected ? `${selected.id} · ${fmtDateTime(selected.on)}` : undefined}
        footer={<Button variant="ghost" onClick={() => setOpenId(null)}>Close</Button>}
      >
        {selected && (
          <div className="u-col" style={{ gap: 16 }}>
            <div className="u-flex" style={{ gap: 6, flexWrap: 'wrap' }}>
              {selected.aiInvolved && <Badge tone="ai">AI involved</Badge>}
              <Badge tone={RISK_TONE[selected.risk]}>{selected.risk} risk</Badge>
              <Badge tone="outline">{ROLE_LABEL[selected.actorRole] ?? selected.actorRole}</Badge>
            </div>

            <KeyValue
              cols={1}
              items={[
                { k: 'Actor', v: selected.actor },
                { k: 'Action', v: selected.action },
                { k: 'Record', v: <span><span className="u-muted">{selected.recordType} · </span><span className="mono">{selected.recordRef}</span></span> },
                { k: 'Reason', v: selected.reason ?? '—' },
                { k: 'Policy basis', v: selected.policyRef ? <span className="mono u-xs" style={{ color: 'var(--accent-text)' }}>{selected.policyRef}</span> : '—' },
                { k: 'Outcome', v: selected.outcome },
                { k: 'When', v: `${fmtDateTime(selected.on)} · ${fmtRelative(selected.on)}` },
              ]}
            />

            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 12, background: 'var(--surface-2)' }}>
              <div className="u-flex u-small" style={{ gap: 7, fontWeight: 620, marginBottom: 6 }}>
                <Icon.Info size={14} style={{ color: 'var(--accent)' }} /> Why this entry exists
              </div>
              <div className="u-small u-muted" style={{ marginBottom: 10 }}>
                {selected.actor} performed “{selected.action.toLowerCase()}” on {selected.recordType.toLowerCase()}.
                SchoolOS records who, what, when, why and under which policy — so any future question about this record has an answer.
                Nobody, including IT Admin, can edit or delete it.
              </div>
              <div className="u-col" style={{ gap: 6 }}>
                <div className="u-flex u-xs" style={{ gap: 8 }}><Icon.Lock size={12} style={{ color: 'var(--text-3)' }} /> Append-only · hash-chained to the previous entry</div>
                <div className="u-flex u-xs" style={{ gap: 8 }}><Icon.Refresh size={12} style={{ color: 'var(--text-3)' }} /> Verified nightly at 02:00</div>
                <div className="u-flex u-xs" style={{ gap: 8 }}><Icon.Download size={12} style={{ color: 'var(--text-3)' }} /> Exportable as signed CSV for board review</div>
              </div>
            </div>
          </div>
        )}
      </Drawer>
    </>
  );
}
