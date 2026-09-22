/* ============================================================
   Admissions — SAMPLE preview of the enrollment funnel, shown only while
   the `admissions.funnel` plugin is switched off for the school (the live
   server-backed board is FunnelBoard.tsx). It renders the SAME stage lattice
   the server enforces (enquiry → form → interaction → offer → waitlisted →
   enrolled, side exits rejected/withdrawn) so there is one vocabulary across
   the product. Sample leads come from the demo dataset; nothing here writes
   to a server, and no money or AI claim is made.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import * as seed from '../data/dataset';
import { admissionsService } from '../demo/seedServices';
import {
  PageHead, Card, Stat, Badge, Avatar, Button, useToast,
  Dropdown, Empty, ErrorState, SkeletonCard, SampleNote } from '../components/ui';
import { SegmentedBar } from '../components/Chart';
import { Icon } from '../components/Icon';
import type { Lead, LeadStage } from '../types/domain';

/* ---------- standard async hook (APP-SPEC pattern, local copy) ---------- */
function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState(s => ({ ...s, loading: true, error: null }));
    fn().then(d => live && setState({ data: d, loading: false, error: null }))
      .catch(e => live && setState({ data: null, loading: false, error: String(e) }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, retry: () => setTick(t => t + 1) };
}

/* ---------- the server lattice (mirrors _shared/admissions-access.js) ---------- */
const STAGES: { id: LeadStage; label: string; color: string }[] = [
  { id: 'enquiry', label: 'Enquiry', color: 'var(--info)' },
  { id: 'form', label: 'Form', color: 'var(--chart-steel)' },
  { id: 'interaction', label: 'Interaction', color: 'var(--accent)' },
  { id: 'offer', label: 'Offer', color: 'var(--ai)' },
  { id: 'waitlisted', label: 'Waitlisted', color: 'var(--warning)' },
  { id: 'enrolled', label: 'Enrolled', color: 'var(--success)' },
];
const COLLAPSED: { id: LeadStage; label: string }[] = [
  { id: 'rejected', label: 'Rejected' },
  { id: 'withdrawn', label: 'Withdrawn' },
];
const ALL_STAGES = [...STAGES.map(s => s.id), ...COLLAPSED.map(s => s.id)];

/* the demo dataset predates the India lattice — normalise old names so the
   sample renders in the same columns as the live server board. */
const LEGACY: Record<string, LeadStage> = {
  inquiry: 'enquiry', contacted: 'form', visit: 'interaction', interview: 'interaction',
  accepted: 'waitlisted', offer: 'offer', enrolled: 'enrolled', rejected: 'rejected', withdrawn: 'withdrawn',
};
const stageOf = (l: Lead): LeadStage => (ALL_STAGES.includes(l.stage) ? l.stage : LEGACY[l.stage] ?? 'enquiry');

function daysInStage(l: Lead) {
  return Math.max(0, Math.round((Date.now() - l.lastTouch.getTime()) / 86400000));
}

function sourceTone(source: string): 'neutral' | 'info' | 'accent' | 'ai' | 'outline' {
  if (source.startsWith('Referral')) return 'accent';
  if (source === 'Sibling') return 'info';
  if (source === 'Website') return 'ai';
  return 'outline';
}

/* ---------- kanban card ---------- */
function LeadCard({ lead, onMove, dragging, busy, onDragStart, onDragEnd }: {
  lead: Lead; onMove: (stage: LeadStage) => void; dragging: boolean; busy: boolean;
  onDragStart: () => void; onDragEnd: () => void;
}) {
  const stage = stageOf(lead);
  const days = daysInStage(lead);
  const stale = days > 7;
  return (
    <div
      className="card card-click"
      draggable
      onDragStart={e => { e.dataTransfer.setData('text/plain', lead.id); e.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
      onDragEnd={onDragEnd}
      style={{
        padding: '10px 12px', marginBottom: 8, cursor: 'grab',
        opacity: dragging ? 0.45 : busy ? 0.7 : 1,
        borderColor: stale ? 'var(--warning-weak-2)' : undefined}}
    >
      <div className="u-between" style={{ gap: 8 }}>
        <span className="u-truncate" style={{ fontWeight: 590, fontSize: 'var(--text-md)' }}>{lead.name}</span>
        <Badge tone={sourceTone(lead.source)} className="u-truncate">{lead.source}</Badge>
      </div>
      <div className="u-small u-muted" style={{ marginTop: 3 }}>
        Grade {lead.grade} · {lead.guardian}
      </div>
      <div className="u-between" style={{ marginTop: 7, gap: 8 }}>
        <span className="u-xs u-flex" style={{ gap: 4, color: stale ? 'var(--warning)' : 'var(--text-3)' }}>
          {stale && <Icon.Clock size={11} />} {days}d in stage
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Avatar name={lead.owner} size="sm" />
          <Dropdown
            label="Stage move"
            width={172}
            align="left"
            trigger={() => (
              <button className="btn btn-ghost btn-sm" aria-label={`Move ${lead.name} to another stage`} title="Move to stage">
                <Icon.ArrowRight size={12} />
              </button>
            )}
          >
            {close => (
              <div className="u-col" style={{ padding: 4 }}>
                <div role="none" className="dropdown-label">Move to</div>
                {ALL_STAGES.filter(s => s !== stage).map(s => (
                  <button key={s} role="menuitem" className="dropdown-item" onClick={() => { close(); onMove(s); }}>
                    {STAGES.find(x => x.id === s)?.label ?? s}
                  </button>
                ))}
              </div>
            )}
          </Dropdown>
        </span>
      </div>
    </div>
  );
}

/* ---------- kanban column ---------- */
function KanbanColumn({ stage, leads, collapsedOpen, onToggleCollapsed, onMove, dragLeadId, setDragLeadId, busyLeadId }: {
  stage: { id: LeadStage; label: string; color: string };
  leads: Lead[];
  collapsedOpen?: boolean;
  onToggleCollapsed?: () => void;
  onMove: (leadId: string, stage: LeadStage) => void;
  dragLeadId: string | null;
  setDragLeadId: (id: string | null) => void;
  busyLeadId: string | null;
}) {
  const [hover, setHover] = useState(false);
  const hidden = collapsedOpen === false;
  return (
    <div
      style={{
        minWidth: 218, width: 218, flexShrink: 0, display: 'flex', flexDirection: 'column',
        background: 'var(--surface-2)', border: `1px solid ${hover ? 'var(--accent-weak-2)' : 'var(--border)'}`,
        borderRadius: 'var(--r-lg)', padding: 8, transition: 'border-color var(--t-fast) var(--ease)'}}
      onDragOver={e => { e.preventDefault(); setHover(true); }}
      onDragLeave={() => setHover(false)}
      onDrop={e => {
        e.preventDefault(); setHover(false);
        const id = e.dataTransfer.getData('text/plain');
        if (id) onMove(id, stage.id);
        setDragLeadId(null);
      }}
    >
      <div className="u-between" style={{ padding: '2px 4px 8px' }}>
        <span className="u-flex" style={{ gap: 6, minWidth: 0 }}>
          <span style={{ width: 8, height: 8, borderRadius: 3, background: stage.color, flexShrink: 0 }} />
          {onToggleCollapsed ? (
            <button
              className="u-flex"
              style={{ gap: 5, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 620, fontSize: 'var(--text-sm)', color: 'var(--text-2)' }}
              onClick={onToggleCollapsed}
              aria-expanded={collapsedOpen}
            >
              <Icon.ChevronDown size={12} style={{ transform: collapsedOpen ? 'none' : 'rotate(-90deg)' }} />
              {stage.label}
            </button>
          ) : (
            <span style={{ fontWeight: 620, fontSize: 'var(--text-sm)' }}>{stage.label}</span>
          )}
        </span>
        <span className="u-xs u-faint tnum">{leads.length}</span>
      </div>
      <div className="scroll-thin" style={{ flex: 1, overflowY: 'auto', maxHeight: 560 }}>
        {leads.length === 0 ? (
          <div className="u-small u-faint" style={{ padding: '14px 6px', textAlign: 'center' }}>
            {hidden ? 'Collapsed' : 'No sample leads'}
          </div>
        ) : hidden ? (
          <button
            className="u-small u-muted"
            style={{ background: 'none', border: '1px dashed var(--border-strong)', borderRadius: 'var(--r-md)', width: '100%', padding: '10px 8px', cursor: 'pointer' }}
            onClick={onToggleCollapsed}
          >
            {leads.length} lead{leads.length === 1 ? '' : 's'} — open to view
          </button>
        ) : (
          leads.map(l => (
            <LeadCard
              key={l.id}
              lead={l}
              dragging={dragLeadId === l.id}
              busy={busyLeadId === l.id}
              onDragStart={() => setDragLeadId(l.id)}
              onDragEnd={() => setDragLeadId(null)}
              onMove={s => onMove(l.id, s)}
            />
          ))
        )}
      </div>
    </div>
  );
}

/* ============================================================ */

export default function Admissions() {
  const { session, dispatch, actorName } = useStore();
  const toast = useToast();
  const campus = session.activeCampus;

  const leads = useAsync(() => admissionsService.leads(campus), [campus]);

  const [localLeads, setLocalLeads] = useState<Lead[]>([]);
  useEffect(() => { if (leads.data) setLocalLeads(leads.data); }, [leads.data]);

  const [gradeFilter, setGradeFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [dragLeadId, setDragLeadId] = useState<string | null>(null);
  const [collapsedOpen, setCollapsedOpen] = useState(false);
  const [movingId, setMovingId] = useState<string | null>(null);

  const filtered = useMemo(
    () => localLeads.filter(l =>
      (gradeFilter === 'all' || String(l.grade) === gradeFilter) &&
      (sourceFilter === 'all' || l.source === sourceFilter),
    ),
    [localLeads, gradeFilter, sourceFilter],
  );

  const columns = useMemo(() => STAGES.map(stage => ({
    stage,
    leads: filtered.filter(l => stageOf(l) === stage.id)})), [filtered]);

  const collapsedColumns = useMemo(() => COLLAPSED.map(stage => ({
    stage: { ...stage, color: 'var(--text-3)' },
    leads: filtered.filter(l => stageOf(l) === stage.id)})), [filtered]);

  const stats = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86400000;
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const newThisWeek = filtered.filter(l => l.createdOn.getTime() >= weekAgo).length;
    const inInteraction = filtered.filter(l => stageOf(l) === 'interaction').length;
    const offersOut = filtered.filter(l => stageOf(l) === 'offer' || stageOf(l) === 'waitlisted').length;
    const enrolledThisMonth = filtered.filter(l => stageOf(l) === 'enrolled' && l.lastTouch.getTime() >= monthStart.getTime()).length;
    return { newThisWeek, inInteraction, offersOut, enrolledThisMonth };
  }, [filtered]);

  const funnelParts = useMemo(() => {
    const at = (id: LeadStage) => filtered.filter(l => stageOf(l) === id).length;
    const enrolled = at('enrolled');
    const waitlisted = at('waitlisted') + enrolled;
    const offers = at('offer') + waitlisted;
    const interaction = at('interaction') + offers;
    const form = at('form') + interaction;
    const enquiry = at('enquiry') + form;
    return [
      { value: enquiry, color: 'var(--info)', label: `Enquiry — ${enquiry}` },
      { value: form, color: 'var(--chart-steel)', label: `Form — ${form}` },
      { value: interaction, color: 'var(--accent)', label: `Interaction — ${interaction}` },
      { value: offers, color: 'var(--ai)', label: `Offer — ${offers}` },
      { value: waitlisted, color: 'var(--warning)', label: `Waitlisted — ${waitlisted}` },
      { value: enrolled, color: 'var(--success)', label: `Enrolled — ${enrolled}` }];
  }, [filtered]);

  const sources = useMemo(() => Array.from(new Set(localLeads.map(l => l.source))).sort(), [localLeads]);
  const grades = useMemo(() => Array.from(new Set(localLeads.map(l => l.grade))).sort((a, b) => a - b), [localLeads]);

  const moveLead = async (leadId: string, stage: LeadStage) => {
    const lead = localLeads.find(l => l.id === leadId);
    if (!lead || stageOf(lead) === stage) return;
    setMovingId(leadId);
    const label = STAGES.find(s => s.id === stage)?.label ?? stage;
    try {
      await admissionsService.moveLead(leadId, stage);
      setLocalLeads(prev => prev.map(l => l.id === leadId ? { ...l, stage, lastTouch: new Date() } : l));
      dispatch({
        type: 'audit/add',
        entry: {
          actor: actorName, actorRole: session.roleId, action: `Moved lead to ${label}`,
          recordType: 'Admission lead', recordRef: `${lead.name} (Grade ${lead.grade})`,
          reason: 'Stage change from admissions funnel (sample)',
          policyRef: 'Approvals §1.2 · offers remain human-decided (pol_14)',
          aiInvolved: false, risk: 'low', outcome: `Stage → ${stage}`}});
      toast({ title: `${lead.name} → ${label}`, sub: 'Sample lead moved. Enable the Admissions plugin for the live, server-enforced funnel.', tone: 'success' });
    } catch {
      toast({ title: 'Could not move lead', sub: 'The sample service did not accept the change. Try again.', tone: 'error' });
    } finally {
      setMovingId(null);
    }
  };

  return (
    <div>
      <SampleNote>Sample funnel data — this preview is illustrative. Turn on the Admissions plugin to capture real enquiries, schedule visits, and convert offers on the server-enforced lattice.</SampleNote>
      <PageHead
        title="Admissions"
        sub="Sample preview of the enrollment funnel. The live board (enquiry → form → interaction → offer → waitlisted → enrolled) is server-enforced; offers and rejections stay human-decided (pol_14)."
        actions={<Button variant="secondary" icon={<Icon.Refresh size={14} />} onClick={leads.retry}>Refresh</Button>}
      />

      {/* ---- Stats ---- */}
      <div className="grid grid-5" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 16, marginBottom: 24 }}>
        <Stat label="New this week" value={stats.newThisWeek} sub="Enquiries logged in 7 days" />
        <Stat label="In interaction" value={stats.inInteraction} sub="Visits and interviews in progress" />
        <Stat label="Offers out" value={stats.offersOut} sub="Offer + waitlisted, awaiting join" />
        <Stat label="Enrolled this month" value={stats.enrolledThisMonth} sub="Since the 1st" />
      </div>

      {/* ---- conversion funnel (no money, no fabricated AI) ---- */}
      <Card pad style={{ marginBottom: 28 }}>
        <div className="u-col" style={{ gap: 12 }}>
          <div>
            <div className="u-upper" style={{ marginBottom: 6 }}>Enrollment conversion funnel</div>
            <SegmentedBar parts={funnelParts} height={12} />
            <div className="u-flex u-xs u-muted" style={{ gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
              {funnelParts.map(p => (
                <span key={p.label} className="u-flex" style={{ gap: 5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 3, background: p.color }} /> {p.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* ---- Filters ---- */}
      <div className="u-flex" style={{ gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="u-flex" style={{ gap: 6 }}>
          <label className="u-small u-muted" htmlFor="adm-grade">Grade</label>
          <select id="adm-grade" className="input" value={gradeFilter} onChange={e => setGradeFilter(e.target.value)} style={{ width: 120 }}>
            <option value="all">All grades</option>
            {grades.map(g => <option key={g} value={String(g)}>Grade {g}</option>)}
          </select>
        </div>
        <div className="u-flex" style={{ gap: 6 }}>
          <label className="u-small u-muted" htmlFor="adm-source">Source</label>
          <select id="adm-source" className="input" value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} style={{ width: 180 }}>
            <option value="all">All sources</option>
            {sources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        {(gradeFilter !== 'all' || sourceFilter !== 'all') && (
          <Button variant="ghost" size="sm" icon={<Icon.X size={12} />} onClick={() => { setGradeFilter('all'); setSourceFilter('all'); }}>
            Clear filters
          </Button>
        )}
        <span className="u-xs u-faint" style={{ marginLeft: 'auto' }}>
          {filtered.length} of {localLeads.length} leads · {seed.campuses.find(c => c.id === campus)?.name}
        </span>
      </div>

      {/* ---- Kanban ---- */}
      {leads.loading ? (
        <div className="grid grid-3"><SkeletonCard lines={5} /><SkeletonCard lines={5} /><SkeletonCard lines={5} /></div>
      ) : leads.error ? (
        <Card pad><ErrorState title="Could not load the funnel" sub={leads.error} onRetry={leads.retry} /></Card>
      ) : filtered.length === 0 ? (
        <Card pad><Empty icon={<Icon.Graduation size={22} />} title="No leads match the filters" sub="Adjust grade or source filters to see the funnel." /></Card>
      ) : (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8 }}>
          {columns.map(col => (
            <KanbanColumn
              key={col.stage.id}
              stage={col.stage}
              leads={col.leads}
              onMove={moveLead}
              dragLeadId={dragLeadId}
              setDragLeadId={setDragLeadId}
              busyLeadId={movingId}
            />
          ))}
          {collapsedColumns.map(col => (
            <KanbanColumn
              key={col.stage.id}
              stage={col.stage}
              leads={col.leads}
              collapsedOpen={collapsedOpen}
              onToggleCollapsed={() => setCollapsedOpen(o => !o)}
              onMove={moveLead}
              dragLeadId={dragLeadId}
              setDragLeadId={setDragLeadId}
              busyLeadId={movingId}
            />
          ))}
        </div>
      )}

      <div style={{ height: 20 }} />
      <div className="u-small u-muted">
        This is sample data. The live funnel validates every move server-side and keeps a full audit trail.
        Offers, rejections and waitlists are decided by the Admissions Head only — SchoolOS ranks logistics and drafts follow-ups (Constitution, pol_14).
      </div>
    </div>
  );
}
