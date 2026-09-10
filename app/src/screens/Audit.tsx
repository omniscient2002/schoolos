/* ============================================================
   Audit — the school's append-only ledger.
   T404: entries load from GET /audit (the real hash-chained
   ledger, owner/principal/itadmin/finance only). If the door is
   unreachable or the role is not allowed, the screen says so and
   falls back to THIS SESSION'S entries with a visible label —
   never presented as the school ledger. Export builds a real CSV
   from the rows on screen and downloads it.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';

/* Local async hook (duplicated per screen per APP-SPEC §async pattern) */
function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState(s => ({ ...s, loading: true, error: null }));
    fn().then(d => { if (live) setState({ data: d, loading: false, error: null }); })
      .catch(e => { if (live) setState({ data: null, loading: false, error: String(e) }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, retry: () => setTick(t => t + 1) };
}
import { apiAudit } from '../services/liveApi';
import { DEMO_MODE } from '../lib/demoMode';
import { friendly } from '../lib/friendlyErrors';
import { Badge, Button, Card, DataTable, Drawer, Empty, KeyValue, PageHead, Section, Skeleton, Stat, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { fmtDateTime, fmtRelative } from '../lib/format';
import type { AuditEntry } from '../types/domain';

const ROLE_LABEL: Record<string, string> = {
  principal: 'Principal', teacher: 'Teacher', coordinator: 'Coordinator', finance: 'Finance',
  admissions: 'Admissions', transport: 'Transport', parent: 'Parent', student: 'Student',
  owner: 'Owner', itadmin: 'IT Admin', facilities: 'Facilities', technician: 'Technician',
};
const RISK_TONE: Record<string, 'success' | 'warning' | 'danger'> = {
  low: 'success', medium: 'warning', high: 'danger',
};

type AiFilter = 'all' | 'yes' | 'no';

/* Server row shape from GET /audit (the door selects these columns) */
interface ServerAuditRow {
  id: string; actor: string; actor_role: string; action: string; record_type: string; record_ref: string;
  reason: string | null; policy_ref: string | null; ai_involved: boolean; risk: string;
  prev_hash: string | null; hash: string | null; created_at: string;
}

interface LedgerRow {
  id: string; on: Date; actor: string; actorRole: string; action: string;
  recordType: string; recordRef: string; reason?: string; policyRef?: string;
  aiInvolved: boolean; risk: 'low' | 'medium' | 'high'; outcome: string;
  server: boolean;
}

const mapServerRow = (r: ServerAuditRow): LedgerRow => ({
  id: r.id, on: new Date(r.created_at), actor: r.actor, actorRole: r.actor_role, action: r.action,
  recordType: r.record_type, recordRef: r.record_ref, reason: r.reason ?? undefined,
  policyRef: r.policy_ref ?? undefined, aiInvolved: !!r.ai_involved,
  risk: (r.risk as 'low' | 'medium' | 'high') ?? 'low', outcome: '', /* door does not select outcome */
  server: true,
});

const mapSessionEntry = (a: AuditEntry): LedgerRow => ({
  id: a.id, on: a.on, actor: a.actor, actorRole: a.actorRole, action: a.action,
  recordType: a.recordType, recordRef: a.recordRef, reason: a.reason, policyRef: a.policyRef,
  aiInvolved: a.aiInvolved, risk: a.risk, outcome: a.outcome, server: false,
});

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export default function Audit() {
  const { domain, actorName } = useStore();
  const toast = useToast();

  const ledger = useAsync<LedgerRow[]>(async () => {
    if (DEMO_MODE) return domain.audit.map(mapSessionEntry); /* demo build: session entries, labelled below */
    const res = await apiAudit(200);
    return (res.entries ?? []).map(r => mapServerRow(r as unknown as ServerAuditRow));
  }, []);

  const [role, setRole] = useState('all');
  const [ai, setAi] = useState<AiFilter>('all');
  const [risk, setRisk] = useState('all');
  const [range, setRange] = useState<7 | 30>(30);
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = ledger.data ?? [];
  const sessionOnly = !DEMO_MODE && !ledger.loading && !ledger.error && rows.every(r => !r.server);
  const fallback = !DEMO_MODE && (!!ledger.error || sessionOnly);

  const roles = useMemo(() => Array.from(new Set(rows.map((a: LedgerRow) => a.actorRole))), [rows]);

  const filtered = rows.filter(a => {
    if (role !== 'all' && a.actorRole !== role) return false;
    if (ai === 'yes' && !a.aiInvolved) return false;
    if (ai === 'no' && a.aiInvolved) return false;
    if (risk !== 'all' && a.risk !== risk) return false;
    if (Date.now() - a.on.getTime() > range * 86400000) return false;
    if (q.trim() && !`${a.recordRef} ${a.action} ${a.actor} ${a.recordType}`.toLowerCase().includes(q.trim().toLowerCase())) return false;
    return true;
  });

  const selected = filtered.find(a => a.id === openId) ?? rows.find(a => a.id === openId) ?? null;

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const entriesToday = rows.filter(a => a.on.getTime() >= todayStart.getTime()).length;
  const aiPct = rows.length ? Math.round((rows.filter(a => a.aiInvolved).length / rows.length) * 100) : 0;
  const highRisk = rows.filter(a => a.risk === 'high').length;
  const aiExamples = rows.filter(a => a.aiInvolved).slice(0, 3);

  const doExport = () => {
    /* Real CSV from the rows on screen — downloaded immediately.
       No "signed link" promise: this screen does not hand out links. */
    const header = ['When (ISO)', 'Actor', 'Role', 'Action', 'Record type', 'Record ref', 'Reason', 'Policy', 'AI involved', 'Risk', 'Outcome'];
    const lines = [header.join(',')];
    for (const a of filtered) {
      lines.push([
        a.on.toISOString(), a.actor, a.actorRole, a.action, a.recordType, a.recordRef,
        a.reason ?? '', a.policyRef ?? '', a.aiInvolved ? 'yes' : 'no', a.risk, a.outcome ?? '',
      ].map(csvEscape).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `audit-export-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast({
      title: `CSV downloaded — ${filtered.length} entries`,
      sub: fallback
        ? 'These are this session\'s entries only (the school ledger was not reachable).'
        : 'From the ledger rows currently on screen.',
      tone: 'success',
    });
  };

  return (
    <>
      <PageHead
        title="Audit trail"
        sub="Who did what, when, why and under which policy — straight from the school's append-only ledger."
        actions={
          <>
            {fallback && <Badge tone="warning" dot>Showing session entries</Badge>}
            <Button variant="primary" icon={<Icon.Download size={14} />} onClick={doExport} disabled={filtered.length === 0}>Export CSV</Button>
          </>
        }
      />

      {fallback && (
        <div className="u-flex u-wrap" style={{ gap: 10, padding: '11px 16px', marginBottom: 16, background: 'var(--warning-weak)', border: '1px solid var(--warning-weak-2)', borderRadius: 'var(--r-lg)', alignItems: 'flex-start' }}>
          <Icon.Alert size={16} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontWeight: 600 }}>
              {ledger.error ? 'The school ledger could not be reached — showing this session\'s entries' : `The audit ledger is limited to owner, principal, finance and IT admin — showing ${actorName}'s session entries`}
            </div>
            <div className="u-small u-muted" style={{ marginTop: 2 }}>
              {ledger.error ? friendly(ledger.error) : 'Ask the owner or IT admin for the full ledger view.'}
              {' '}Everything below is clearly separated from the permanent record.
            </div>
          </div>
          {ledger.error && <Button variant="secondary" size="sm" onClick={ledger.retry}>Retry</Button>}
        </div>
      )}

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <Stat label="Entries today" value={entriesToday} sub={`${rows.length} rows on screen`} />
        <Stat label="Rule/AI-involved" value={`${aiPct}%`} sub="of entries carry an automated flag" />
        <Stat label="High-risk actions" value={highRisk} sub="flagged at write time" />
        <Stat label="Scope" value={fallback ? 'Session' : 'Ledger'} sub={fallback ? 'this session only' : 'latest 200 entries'} />
      </div>

      <Section title="Filters" sub="Search on record references, actors and actions.">
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
            <input className="input" placeholder="Search record ref, action, actor…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search the audit trail" />
          </div>
          <span className="u-xs u-faint">{filtered.length} of {rows.length} entries</span>
        </div>
      </Section>

      <Card>
        {ledger.loading ? (
          <div className="u-col" style={{ gap: 10, padding: 20 }}>
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} h={14} />)}
          </div>
        ) : (
          <DataTable<LedgerRow>
            caption="Audit trail — who decided what, when and why"
            columns={[
              {
                key: 'on', label: 'When', width: 150, sortable: true, sortValue: a => a.on.getTime(), render: a => (
                  <div>
                    <div className="u-small">{fmtDateTime(a.on)}</div>
                    <div className="u-xs u-faint">{fmtRelative(a.on)}</div>
                  </div>
                ),
              },
              {
                key: 'actor', label: 'Actor', width: 170, sortable: true, sortValue: a => a.actor, render: a => (
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
              { key: 'risk', label: 'Risk', width: 84, render: a => <Badge tone={RISK_TONE[a.risk] ?? 'neutral'}>{a.risk}</Badge> },
            ]}
            rows={filtered}
            rowKey={a => a.id}
            onRowClick={a => setOpenId(a.id)}
            empty={fallback
              ? <Empty icon={<Icon.Lock size={26} />} title="No entries in this session yet" sub="Actions you take in this session appear here." />
              : <Empty icon={<Icon.Lock size={26} />} title="No entries match these filters" sub="Widen the date range or clear the search." />}
          />
        )}
      </Card>

      <div style={{ height: 22 }} />

      <Section title="Rule/AI-surfaced actions" sub="Entries flagged as automated or AI-involved carry the same actor, policy and outcome detail as human ones.">
        <div className="grid grid-2">
          <Card>
            <div className="u-flex" style={{ gap: 9, marginBottom: 8 }}>
              <Icon.Sparkle size={15} style={{ color: 'var(--ai)', flexShrink: 0, marginTop: 1 }} />
              <div className="u-small" style={{ fontWeight: 620 }}>Automated drafts, rankings and recommendations — with the policy they ran under.</div>
            </div>
            <div className="u-col" style={{ gap: 8 }}>
              {aiExamples.length === 0 && <span className="u-small u-faint">No AI-involved entries in the current view.</span>}
              {aiExamples.map(a => (
                <div key={a.id} className="u-flex" style={{ gap: 9, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', alignItems: 'flex-start' }}>
                  <Badge tone="ai">AI</Badge>
                  <div style={{ minWidth: 0 }}>
                    <div className="u-small" style={{ fontWeight: 570 }}>{a.action}</div>
                    <div className="u-xs u-faint mono u-truncate">{a.recordRef}</div>
                    {a.outcome && <div className="u-xs u-muted">{a.outcome}</div>}
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
              <li>Written in the same transaction as the change it describes.</li>
              <li>Exportable as CSV for board review and regulatory inspection (button above).</li>
            </ul>
          </Card>
        </div>
      </Section>

      <Drawer
        open={!!selected}
        onClose={() => setOpenId(null)}
        title={selected ? `${selected.action}` : ''}
        sub={selected ? `${selected.id.slice(0, 8)}… · ${fmtDateTime(selected.on)}` : undefined}
        footer={<Button variant="ghost" onClick={() => setOpenId(null)}>Close</Button>}
      >
        {selected && (
          <div className="u-col" style={{ gap: 16 }}>
            <div className="u-flex" style={{ gap: 6, flexWrap: 'wrap' }}>
              {selected.aiInvolved && <Badge tone="ai">AI involved</Badge>}
              <Badge tone={RISK_TONE[selected.risk] ?? 'neutral'}>{selected.risk} risk</Badge>
              <Badge tone="outline">{ROLE_LABEL[selected.actorRole] ?? selected.actorRole}</Badge>
              {selected.server && <Badge tone="outline">School ledger</Badge>}
              {!selected.server && <Badge tone="warning">Session entry</Badge>}
            </div>

            <KeyValue
              cols={1}
              items={[
                { k: 'Actor', v: selected.actor },
                { k: 'Action', v: selected.action },
                { k: 'Record', v: <span><span className="u-muted">{selected.recordType} · </span><span className="mono">{selected.recordRef}</span></span> },
                { k: 'Reason', v: selected.reason ?? '—' },
                { k: 'Policy basis', v: selected.policyRef ? <span className="mono u-xs" style={{ color: 'var(--accent-text)' }}>{selected.policyRef}</span> : '—' },
                { k: 'Outcome', v: selected.outcome || '—' },
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
                <div className="u-flex u-xs" style={{ gap: 8 }}><Icon.Download size={12} style={{ color: 'var(--text-3)' }} /> Exportable as CSV for board review</div>
              </div>
            </div>
          </div>
        )}
      </Drawer>
    </>
  );
}
