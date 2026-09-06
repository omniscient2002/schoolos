/* ============================================================
   FunnelBoard — live admissions.funnel surface (unit 14).
   Consumes the admissions.funnel plugin doors as server truth:
   - GET  /plugins/admissions.funnel/leads    → masked flag decides PII display
   - POST /plugins/admissions.funnel/leads/:id/stage → lattice enforced SERVER-side
   - GET  /plugins/admissions.funnel/summary  → funnel counts
   - GET  /plugins/admissions.funnel/leads/:id/history → transition trail
   House style: three-tier loading (SkeletonCard), ErrorState, Empty, tokens
   only, keyboard-accessible controls, sort-ready DataTable semantics.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import {
  PageHead, Card, Stat, Badge, Button, useToast, Empty, ErrorState, SkeletonCard, DataTable, Dropdown,
} from '../components/ui';
import { fmtRelative } from '../lib/format';
import { SegmentedBar } from '../components/Chart';
import { Icon } from '../components/Icon';
import {
  LIVE_API, apiFunnelLeads, apiFunnelMoveStage, apiFunnelHistory, apiFunnelSummary,
  type ApiFunnelLead,
} from '../services/liveApi';
import { useStore } from '../state/store';
import { useSession } from '../App'; /* live authenticated role (DemoBar precedent) */

/* server lattice — display order mirrors the forward path; side exits render in history */
const PATH: { id: string; label: string; color: string }[] = [
  { id: 'enquiry', label: 'Enquiry', color: 'var(--info)' },
  { id: 'form', label: 'Form', color: 'var(--chart-steel)' },
  { id: 'interaction', label: 'Interaction', color: 'var(--accent)' },
  { id: 'offer', label: 'Offer', color: 'var(--ai)' },
  { id: 'enrolled', label: 'Enrolled', color: 'var(--success)' },
];
const EXITS: { id: string; label: string }[] = [
  { id: 'rejected', label: 'Rejected' },
  { id: 'withdrawn', label: 'Withdrawn' },
];

type History = { from_stage: string | null; to_stage: string; actor: string; at: string }[];
const stageLabel = (id: string | null) => [...PATH, ...EXITS].find(s => s.id === id)?.label ?? id ?? '—';

const stageBadgeTone = (stage: string): 'info' | 'accent' | 'ai' | 'success' | 'warning' | 'danger' | 'neutral' =>
  stage === 'enquiry' ? 'info'
    : stage === 'form' ? 'info'
      : stage === 'interaction' ? 'accent'
        : stage === 'offer' ? 'ai'
          : stage === 'enrolled' ? 'success'
            : stage === 'rejected' ? 'danger' : 'warning';


export default function FunnelBoard() {
  const toast = useToast();
  const { session, actorName, dispatch } = useStore();
  /* gate on the LIVE server role, not the demo view switcher: the store's roleId
     could historically drift from the authenticated identity (AuthGate restore
     path — unit 14 finding). Unit 16 (A1) restores parity at the AuthGate
     source; the ADMIN set still mirrors the doors' require(...) preHandler, and
     the server 403s any mutation it disallows (UI mirrors, server decides). */
  const live = useSession();
  const canTransition = ['owner', 'principal', 'itadmin', 'finance', 'coordinator'].includes(live.role);

  const [data, setData] = useState<{ masked: boolean; leads: ApiFunnelLead[] } | null>(null);
  const [summary, setSummary] = useState<{ byStage: Record<string, number>; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true); setError(null);
    apiFunnelLeads()
      .then(leads => { if (live) { setData(leads); setLoading(false); } })
      .catch(e => { if (live) { setError(String(e)); setLoading(false); } });
    return () => { live = false; };
  }, [tick]);

  /* summary is an ADMIN-only door (server truth): fetch it only when the role
     can, and never let a summary failure kill the board — the stat row degrades
     to counts over the fetched leads page */
  useEffect(() => {
    let live = true;
    if (!canTransition) return;
    apiFunnelSummary()
      .then(sum => { if (live) setSummary(sum); })
      .catch(() => { if (live) setSummary(null); });
    return () => { live = false; };
  }, [canTransition]);

  const masked = data?.masked ?? false;
  const leads = useMemo(() => data?.leads ?? [], [data]);

  const move = async (id: string, to: string) => {
    setBusyId(id);
    try {
      const r = await apiFunnelMoveStage(id, to);
      /* server is the single brain: refetch instead of optimistic patch */
      setTick(t => t + 1);
      toast({
        title: `Moved to ${stageLabel(r.to)}`,
        sub: r.actionId
          ? 'Offer accepted — a students.create approval was raised for the Principal (kernel-gated core write).'
          : 'Stage transitioned on the server lattice. Audit entry recorded.',
        tone: 'success',
      });
      dispatch({
        type: 'audit/add',
        entry: {
          actor: actorName, actorRole: session.roleId, action: `Funnel stage → ${stageLabel(r.to)}`,
          recordType: 'Admission lead (plugin)', recordRef: id,
          reason: 'admissions.funnel stage transition', policyRef: 'Platform §3 (plugin governance)',
          aiInvolved: false, risk: r.to === 'enrolled' ? 'medium' : 'low',
          outcome: `${r.from} → ${r.to}${r.actionId ? ' · students.create raised via kernel approval' : ''}`,
        },
      });
    } catch (e) {
      toast({ title: 'Transition rejected', sub: String(e).replace('Error: ', '') || 'The server lattice did not accept this move.', tone: 'error' });
    } finally { setBusyId(null); }
  };

  const openHistory = async (id: string) => {
    setHistoryId(id);
    setHistoryLoading(true);
    try { setHistory((await apiFunnelHistory(id)).history); }
    catch { setHistory(null); }
    finally { setHistoryLoading(false); }
  };

  /* count fallback: server summary when the door is reachable for the role,
     otherwise counts over the fetched leads page (counts are not PII) */
  const stageCount = useMemo(() => {
    const by = summary?.byStage ?? {};
    return (id: string) => by[id] ?? leads.filter(l => l.stage === id).length;
  }, [summary, leads]);

  const parts = useMemo(() => {
    const at = (id: string) => stageCount(id);
    /* cumulative funnel for the bar: enquiry ≥ form ≥ … ≥ enrolled */
    const cum = PATH.map((_, i) => PATH.slice(i).reduce((a, s) => a + at(s.id), 0));
    return PATH.map((s, i) => ({ value: cum[i], color: s.color, label: `${s.label} — ${cum[i]}` }));
  }, [stageCount]);

  /* forward-lattice display mirror (server enforces); terminal stages move nowhere */
  const nextStages = (lead: ApiFunnelLead) => {
    const at = PATH.findIndex(x => x.id === lead.stage);
    if (at < 0) return []; /* terminal: enrolled / rejected / withdrawn are immutable */
    return PATH.filter((_, i) => i > at);
  };

  if (!LIVE_API) {
    return <Card pad><Empty icon={<Icon.Database size={22} />} title="Live API not enabled" sub="The admissions.funnel board reads the server plugin doors — run with VITE_LIVE_API=1." /></Card>;
  }
  if (loading) return <SkeletonCard lines={8} />;
  if (error) return <ErrorState title="Could not load the funnel" sub={error.replace('Error: ', '')} onRetry={() => setTick(t => t + 1)} />;

  const offerLeads = leads.filter(l => l.stage === 'offer');

  return (
    <div>
      <PageHead
        title="Admissions funnel"
        sub={masked
          ? 'Privacy-masked view — guardian contact details are hidden for your role (DPDP masking tiers).'
          : 'Admissions office view — guardian contacts visible per DPDP masking tier.'}
        actions={<Button variant="secondary" icon={<Icon.Refresh size={14} />} onClick={() => setTick(t => t + 1)}>Refresh</Button>}
      />

      <div className="grid grid-5" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))', gap: 16, marginBottom: 24 }}>
        <Stat label="Total enquiries" value={summary?.total ?? leads.length} sub="All stages, this session" />
        {PATH.slice(1, 4).map(s => <Stat key={s.id} label={s.label} value={stageCount(s.id)} sub={`Leads at ${s.label.toLowerCase()}`} />)}
        <Stat label="Enrolled" value={stageCount('enrolled')} sub="Offer accepted this cycle" />
      </div>

      <Card pad style={{ marginBottom: 24 }}>
        <div className="u-upper" style={{ marginBottom: 6 }}>Conversion funnel (cumulative)</div>
        <SegmentedBar parts={parts} height={12} />
        <div className="u-flex u-xs u-muted" style={{ gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
          {parts.map(p => (
            <span key={p.label} className="u-flex" style={{ gap: 5 }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 3, background: p.color }} /> {p.label}
            </span>
          ))}
        </div>
      </Card>

      {leads.length === 0 ? (
        <Empty icon={<Icon.Users size={22} />} title="No enquiries yet" sub="Captured enquiries land here, at the enquiry stage." />
      ) : (
        <>
          <DataTable<ApiFunnelLead>
            caption={masked ? 'Admission enquiries — PII masked for your role' : 'Admission enquiries — guardian contacts visible to admissions office roles'}
            rows={leads}
            rowKey={l => l.id}
            columns={[
              {
                key: 'student', label: 'Student', sortable: true, sortValue: l => l.studentName,
                render: l => (
                  <div>
                    <div style={{ fontWeight: 570 }}>{l.studentName}</div>
                    <div className="u-xs u-faint">{l.classApplied}</div>
                  </div>
                ),
              },
              {
                key: 'guardian', label: 'Guardian', sortable: true, sortValue: l => l.guardianName ?? '',
                render: l => masked
                  ? <span className="u-faint" title="Masked for your role — DPDP tiering">Masked</span>
                  : <div><div>{l.guardianName ?? '—'}</div><div className="u-xs u-faint">{l.guardianPhone ?? ''}</div></div>,
              },
              { key: 'source', label: 'Source', sortable: true, render: l => <span className="u-small u-muted">{l.source}</span> },
              { key: 'stage', label: 'Stage', sortable: true, render: l => <Badge tone={stageBadgeTone(l.stage)}>{stageLabel(l.stage)}</Badge> },
              { key: 'updated', label: 'Updated', sortable: true, sortValue: l => new Date(l.updatedAt).getTime(), render: l => <span className="u-small">{fmtRelative(l.updatedAt)}</span> },
              {
                key: 'actions', label: 'Actions', align: 'right',
                render: l => {
                  if (!canTransition) return <span className="u-faint u-small">Read-only</span>;
                  const nexts = nextStages(l);
                  const exits = EXITS.filter(() => !['enrolled', 'rejected', 'withdrawn'].includes(l.stage));
                  if (!nexts.length && !exits.length) return <span className="u-faint u-small">Terminal</span>;
                  return (
                    <div className="u-flex" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      {nexts.slice(0, 2).map(n => (
                        <Button key={n.id} size="sm" variant={n.id === 'enrolled' ? 'primary' : 'secondary'} disabled={busyId === l.id}
                          onClick={() => move(l.id, n.id)}>{n.id === 'enrolled' ? 'Accept offer' : n.label}</Button>
                      ))}
                      {exits.length > 0 && (
                        <Dropdown
                          label={`More actions for ${l.studentName}`}
                          trigger={() => (
                            <button className="btn btn-ghost btn-sm" aria-label={`More actions for ${l.studentName}`} title="More actions">
                              More
                            </button>
                          )}
                        >
                          {(close: () => void) => (
                            <div className="u-col" style={{ padding: 4 }}>
                              <div role="none" className="dropdown-label">Actions</div>
                              {exits.map(x => (
                                <button key={x.id} role="menuitem" className="dropdown-item" onClick={() => { close(); move(l.id, x.id); }}>
                                  Mark {x.label.toLowerCase()}
                                </button>
                              ))}
                              <button role="menuitem" className="dropdown-item" onClick={() => { close(); openHistory(l.id); }}>Stage history</button>
                            </div>
                          )}
                        </Dropdown>
                      )}
                      {!exits.length && <Button size="sm" variant="ghost" onClick={() => openHistory(l.id)}>History</Button>}
                    </div>
                  );
                },
              },
            ]}
          />
          <div style={{ height: 20 }} />
          <div className="u-small u-muted">
            Stage moves are validated server-side against the lattice (enquiry → form → interaction → offer → enrolled, side exits rejected/withdrawn).
            Terminal stages are immutable. Accepting an offer raises <strong>students.create</strong> as a kernel approval action for the Principal — the plugin never writes core student records.
            {masked && ' Guardian contact details are masked for your role (DPDP masking tiers by server truth).'}
          </div>
        </>
      )}

      {/* ---- stage history drawer ---- */}
      {historyId && (
        <Card pad style={{ marginTop: 24 }}>
          <div className="u-flex" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontWeight: 620 }}>Stage history — {leads.find(l => l.id === historyId)?.studentName ?? historyId}</div>
            <Button size="sm" variant="ghost" icon={<Icon.X size={13} />} onClick={() => { setHistoryId(null); setHistory(null); }}>Close</Button>
          </div>
          {historyLoading ? <SkeletonCard lines={2} /> : !history || history.length === 0 ? (
            <Empty icon={<Icon.Clock size={18} />} title="No history" sub="The server returned no transitions for this lead." />
          ) : (
            <ol style={{ margin: 0, paddingLeft: 20 }} className="u-col" >
              {history.map((h, i) => (
                <li key={i} className="u-small" style={{ padding: '3px 0' }}>
                  <span style={{ fontWeight: 570 }}>{stageLabel(h.from_stage)} → {stageLabel(h.to_stage)}</span>
                  <span className="u-faint"> · {h.actor} · {fmtRelative(h.at)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}

      {/* offer-acceptance preview: show what the kernel action will do (office roles see it in Action Center) */}
      {offerLeads.length > 0 && !masked && (
        <Card pad style={{ marginTop: 24, borderColor: 'var(--ai-weak-2)' }}>
          <div className="u-flex" style={{ gap: 8, alignItems: 'center' }}>
            <Icon.Sparkle size={13} style={{ color: 'var(--ai-text)' }} />
            <span className="u-small" style={{ fontWeight: 600 }}>{offerLeads.length} offer{offerLeads.length === 1 ? '' : 's'} awaiting a decision</span>
            <span className="u-small u-faint">— accepting one raises a students.create approval in the Action Center (Principal decides).</span>
          </div>
        </Card>
      )}
    </div>
  );
}
