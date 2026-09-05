/* ============================================================
   Operations — the operations hub. One live card per domain
   (every summary recomputed from records), the daily briefing,
   plus the group asset register and vendor contracts.
   ============================================================ */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import * as seed from '../data/dataset';
import { feeService } from '../services';
import {
  PageHead, Section, Card, Stat, Badge, DataTable, Button, useToast,
  Empty, ErrorState, SkeletonCard,
} from '../components/ui';
import { EvidenceChain, AiTraceCard } from '../components/Ai';
import { Icon } from '../components/Icon';
import { fmtMoneyShort, fmtPct, fmtDateShort, fmtRelative } from '../lib/format';
import { makeRng } from '../lib/rng';

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

/* ============================================================
   Asset register + vendor contracts — group-level registers.
   Deterministic local data (makeRng 9090), per assignment.
   ============================================================ */
interface Asset {
  id: string; name: string; type: 'Bus' | 'Lab equipment'; location: string;
  campus: string; vendor: string; lastServiced: string; nextDue: string;
  dueInDays: number; status: 'In service' | 'Due for service' | 'In workshop';
}
interface Vendor {
  id: string; name: string; service: string; contact: string;
  contractEndsDays: number; contractEnds: string; assetsCovered: number;
}

function buildAssets(): Asset[] {
  const BUS_NO = [3, 5, 8, 9, 11, 12, 14, 17, 19, 22];
  const rng = makeRng(9090);
  const rows: Asset[] = [];
  seed.busRoutes.forEach((r, i) => {
    const isBus14 = r.id === 'route_7';
    /* deterministic: Bus 14 in workshop + one more bus due → 3 assets due overall */
    const dueInDays = isBus14 ? -2 : i === 3 ? 4 : rng.int(35, 90);
    const status: Asset['status'] = isBus14 ? 'In workshop' : i === 3 ? 'Due for service' : 'In service';
    rows.push({
      id: `ast_bus_${i + 1}`,
      name: `Bus ${BUS_NO[i]}`,
      type: 'Bus',
      location: r.name,
      campus: seed.campuses.find(c => c.id === r.campus)?.shortName ?? r.campus,
      vendor: 'Meridian School Bus Service',
      lastServiced: fmtDateShort(rng.date(-rng.int(20, 150))),
      nextDue: fmtDateShort(rng.date(dueInDays)),
      dueInDays,
      status,
    });
  });
  rows.push({
    id: 'ast_lab_1', name: 'Centrifuge — Physics Lab', type: 'Lab equipment', location: 'North · Lab 2',
    campus: 'North', vendor: 'MetroLab Supplies', lastServiced: fmtDateShort(rng.date(-210)),
    nextDue: fmtDateShort(rng.date(6)), dueInDays: 6, status: 'Due for service',
  });
  rows.push({
    id: 'ast_lab_2', name: 'Microscope set B (12 units)', type: 'Lab equipment', location: 'City · Lab 1',
    campus: 'City', vendor: 'MetroLab Supplies', lastServiced: fmtDateShort(rng.date(-40)),
    nextDue: fmtDateShort(rng.date(120)), dueInDays: 120, status: 'In service',
  });
  return rows;
}

function buildVendors(): Vendor[] {
  const rng = makeRng(9091);
  const defs: { name: string; service: string; contact: string; days: number; covered: number }[] = [
    { name: 'Meridian School Bus Service', service: 'Bus fleet operation & maintenance', contact: '+91 98220 41187', days: 45, covered: 10 },
    { name: 'MetroLab Supplies', service: 'Lab equipment AMC & consumables', contact: '+91 99304 22871', days: 12, covered: 2 },
    { name: 'ShineClean Housekeeping', service: 'Housekeeping — all campuses', contact: '+91 98675 30219', days: 128, covered: 3 },
    { name: 'SecureVision CCTV Systems', service: 'CCTV coverage & quarterly audit', contact: '+91 97112 88450', days: 9, covered: 3 },
    { name: 'AquaSure Water Purifiers', service: 'RO units service contract', contact: '+91 98926 71044', days: -6, covered: 3 },
  ];
  return defs.map((d, i) => ({
    id: `vnd_${i + 1}`, name: d.name, service: d.service, contact: d.contact,
    contractEndsDays: d.days, contractEnds: fmtDateShort(rng.date(d.days)), assetsCovered: d.covered,
  }));
}

const ASSETS = buildAssets();
const VENDORS = buildVendors();

function contractBadge(days: number) {
  if (days < 0) return <Badge tone="danger" dot>Expired · {fmtDateShort(new Date(Date.now() + days * 86400000))}</Badge>;
  if (days <= 30) return <Badge tone="warning" dot>{days} days left</Badge>;
  return <Badge tone="outline">Renews {fmtDateShort(new Date(Date.now() + days * 86400000))}</Badge>;
}

/* ---------- trace (static, mirrors aiService posture) ---------- */
const BRIEFING_TRACE = {
  trigger: 'Morning assembly of overnight operational events (07:30 daily)',
  policy: 'Read-only summarisation · Constitution v2026.1 · no automated actions on operations',
  dataUsed: ['fee ledger (30d)', 'transport GPS events', 'case queue', 'incident log', 'document registry'],
  reasoningRole: 'Summarizer (read-only)',
  action: 'None — surfaces the briefing and links to each domain',
  approvalStatus: 'Not required (read-only)',
  verification: 'Every figure recomputed from source records this morning',
  model: 'Frontier (reasoning) · ap-south-1',
  latencyMs: 760,
  tokens: 1180,
  cost: '₹0.09',
};

/* ============================================================ */

type DomainKey = 'fees' | 'admissions' | 'transport' | 'documents' | 'facilities' | 'hr' | 'calendar' | 'cases' | 'incidents' | 'assets';

interface DomainCardDef {
  key: DomainKey;
  title: string;
  icon: (p: { size?: number }) => React.ReactElement;
  to?: string;
  summary: string;
  count: number;
  countLabel: string;
  tone?: 'warning' | 'danger' | 'success' | 'accent';
}

export default function Operations() {
  const navigate = useNavigate();
  const { session, domain, dispatch, actorName } = useStore();
  const openMaint = domain.workOrders.filter(w => !['resolved', 'closed', 'cancelled'].includes(w.status)).length;
  const toast = useToast();
  const assetsRef = useRef<HTMLDivElement>(null);
  const campus = session.activeCampus;
  const campusName = seed.campuses.find(c => c.id === campus)?.name ?? campus;

  const fees = useAsync(() => feeService.obligations(campus), [campus]);

  const collectionPct = useMemo(() => {
    const items = fees.data ?? [];
    const billed = items.reduce((a, f) => a + f.amount, 0);
    const paid = items.reduce((a, f) => a + f.paidAmount, 0);
    return billed ? Math.round((paid / billed) * 1000) / 10 : 0;
  }, [fees.data]);

  const live = useMemo(() => {
    const openLeads = seed.leads.filter(l => l.campus === campus && !['enrolled', 'rejected', 'withdrawn'].includes(l.stage)).length;
    const delayedRoutes = seed.busRoutes.filter(r => r.campus === campus && r.status === 'delayed').length;
    const openCases = domain.cases.filter(c => c.campus === campus && !['resolved', 'closed'].includes(c.status)).length;
    const casesInProgress = domain.cases.filter(c => c.campus === campus && c.status === 'in-progress').length;
    const openIncidents = seed.incidents.filter(i => i.campus === campus && !['resolved', 'reviewed'].includes(i.status)).length;
    const incidentsInProgress = seed.incidents.filter(i => i.campus === campus && ['in-progress', 'assigned'].includes(i.status)).length;
    const docsExpiring = seed.documents.filter(d => d.status === 'expiring').length;
    const assetsDue = ASSETS.filter(a => a.status !== 'In service').length;
    const upcoming = seed.calendarEvents
      .filter(e => e.campus === campus || e.campus === 'all')
      .filter(e => e.on.getTime() >= Date.now())
      .sort((a, b) => a.on.getTime() - b.on.getTime());
    return { openLeads, delayedRoutes, openCases, casesInProgress, openIncidents, incidentsInProgress, docsExpiring, assetsDue, nextEvent: upcoming[0] };
  }, [campus, domain.cases]);

  const cards: DomainCardDef[] = useMemo(() => [
    { key: 'fees', title: 'Fees', icon: Icon.Money, to: '/fees', summary: `${fmtPct(collectionPct, 1)} collected across all terms`, count: 47, countLabel: 'failed payments', tone: 'warning' },
    { key: 'admissions', title: 'Admissions', icon: Icon.Graduation, to: '/admissions', summary: `${live.openLeads} open leads in the funnel`, count: live.openLeads, countLabel: 'open leads', tone: 'accent' },
    { key: 'transport', title: 'Transport', icon: Icon.Bus, to: '/transport', summary: live.delayedRoutes > 0 ? 'Bus 14 (Route 7) delayed +13 min' : 'All routes on time', count: live.delayedRoutes, countLabel: 'routes delayed', tone: live.delayedRoutes > 0 ? 'warning' : 'success' },
    { key: 'documents', title: 'Documents', icon: Icon.Document, to: '/documents', summary: `${live.docsExpiring} certificates expiring in 30 days`, count: live.docsExpiring, countLabel: 'expiring', tone: live.docsExpiring > 0 ? 'warning' : 'success' },
    { key: 'facilities', title: 'Maintenance & Facilities', icon: Icon.Building, to: '/maintenance', summary: `${openMaint} open work order${openMaint === 1 ? '' : 's'} across buildings and assets`, count: openMaint, countLabel: 'open jobs', tone: 'accent' },
    { key: 'hr', title: 'HR', icon: Icon.People, to: '/operations/hr', summary: '3 staff on leave today · 1 substitution pending', count: 1, countLabel: 'subs pending', tone: 'accent' },
    { key: 'calendar', title: 'Calendar', icon: Icon.Calendar, to: '/calendar', summary: live.nextEvent ? `Next: ${live.nextEvent.title} · ${fmtRelative(live.nextEvent.on)}` : 'No upcoming events', count: seed.calendarEvents.filter(e => e.campus === campus || e.campus === 'all').length, countLabel: 'this term', tone: 'accent' },
    { key: 'cases', title: 'Cases', icon: Icon.Clipboard, to: '/cases', summary: `${live.casesInProgress} in progress · ${live.openCases} open overall`, count: live.openCases, countLabel: 'open', tone: live.openCases > 3 ? 'warning' : undefined },
    { key: 'incidents', title: 'Incidents', icon: Icon.Alert, to: '/incidents', summary: `${live.incidentsInProgress} being worked, ${live.openIncidents} unresolved`, count: live.openIncidents, countLabel: 'open', tone: live.openIncidents > 0 ? 'warning' : 'success' },
    { key: 'assets', title: 'Assets & Vendors', icon: Icon.Grid, summary: `${live.assetsDue} assets due for service · 5 vendor contracts on file`, count: live.assetsDue, countLabel: 'due for service', tone: live.assetsDue > 0 ? 'warning' : undefined },
  ], [campus, collectionPct, live]);

  const openCard = (c: DomainCardDef) => {
    if (c.key === 'assets') {
      assetsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (c.to) navigate(c.to);
  };

  return (
    <div>
      <PageHead
        title="Operations"
        sub={`Transport, fees, facilities, documents and people operations — ${campusName}. Every figure recomputed from records.`}
        actions={<Button variant="secondary" icon={<Icon.Refresh size={14} />} onClick={() => { fees.retry(); toast({ title: 'Operations summary refreshed', tone: 'info' }); }}>Refresh</Button>}
      />

      {/* ---- Stats row ---- */}
      <div className="grid grid-4" style={{ marginBottom: 24 }}>
        <Stat label="Open cases" value={live.openCases} sub={`${live.casesInProgress} in progress now`} onClick={() => navigate('/cases')} />
        <Stat label="Incidents in progress" value={live.incidentsInProgress} sub={`${live.openIncidents} unresolved overall`} onClick={() => navigate('/incidents')} />
        <Stat label="Collection rate" value={fees.loading ? '—' : fmtPct(collectionPct, 1)} sub="All obligations · this campus" onClick={() => navigate('/fees')} />
        <Stat label="Documents expiring" value={live.docsExpiring} sub="Within 30 days · renewal tasks open" onClick={() => navigate('/documents')} />
      </div>

      {/* ---- Operations briefing ---- */}
      <Card pad style={{ marginBottom: 28, borderColor: 'var(--ai-weak-2)' }}>
        <div className="u-col" style={{ gap: 12 }}>
          <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="ai-chip"><Icon.Sparkle size={12} /> Operations briefing</span>
            <Badge tone="success" dot>high confidence</Badge>
            <span className="u-xs u-faint" style={{ marginLeft: 'auto' }}>Assembled {fmtRelative(new Date(new Date().setHours(7, 30, 0, 0)))} · refreshed as records change</span>
          </div>
          <p style={{ margin: 0, fontSize: 'var(--text-md)', lineHeight: 1.65, maxWidth: 880 }}>
            Bus 14 on Route 7 is running 13 minutes late; the breakdown two days ago still explains three open threads —
            Grade 8-B attendance, 41 of 47 failed Term-2 payments, and the Bus 14 complaint case on a 24-hour SLA.
            Collection sits at 82.3% this week against an 88% four-week average, and 23 gateway receipts await settlement-file import.
            {live.docsExpiring > 0 ? ` ${live.docsExpiring} documents expire within 30 days; the fire safety certificate at North is the compliance-critical one.` : ''}
            {' '}Maintenance has {openMaint} open work order{openMaint === 1 ? '' : 's'} across campuses, the generator inspection is overdue, and AC-04 in the science lab is on its 4th failure — a replacement evaluation is flagged.
          </p>
          <EvidenceChain
            title="Evidence chain"
            steps={[
              { label: 'Route 7 · Bus 14 status', detail: 'Delayed +13 min · 38 students · incident inc_1 resolved, repair scheduled Saturday', source: 'Transport GPS · Route 7', refType: 'transport' },
              { label: 'Fee collection dip', detail: '82.3% this week vs 88% 4-week avg · 41 of 47 failures on Route 7 households', source: 'Fee ledger · recomputed', refType: 'fees' },
              { label: 'Case queue', detail: `${live.openCases} open cases on ${campusName} · 1 on a 24h SLA (Bus 14 complaint)`, source: 'Cases · live queue', refType: 'case' },
              { label: 'Compliance watch', detail: 'Fire Safety Certificate (North) expires in 21 days · vendor quote pending', source: 'Document registry', refType: 'document' },
            ]}
          />
          <AiTraceCard trace={BRIEFING_TRACE} />
        </div>
      </Card>

      {/* ---- Domain cards ---- */}
      <Section
        title="Domains"
        sub="One card per operations domain. Summaries are live — counts come from the records behind each screen."
      >
        {fees.loading ? (
          <div className="grid grid-3"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
        ) : fees.error ? (
          <Card pad><ErrorState title="Could not load operations summary" sub={fees.error} onRetry={fees.retry} /></Card>
        ) : (
          <div className="grid grid-3">
            {cards.map(c => {
              const Ic = c.icon;
              return (
                <Card key={c.key} onClick={() => openCard(c)} className="card-click">
                  <div className="u-flex" style={{ gap: 12, alignItems: 'flex-start', padding: 'var(--s-5)' }}>
                    <span style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--surface-3)', display: 'grid', placeItems: 'center', flexShrink: 0, color: 'var(--accent-text)' }}>
                      <Ic size={16} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 620, fontSize: 'var(--text-lg)' }}>{c.title}</span>
                        {c.tone && <Badge tone={c.tone === 'accent' ? 'accent' : c.tone === 'warning' ? 'warning' : c.tone === 'danger' ? 'danger' : 'success'} dot>{c.count} {c.countLabel}</Badge>}
                      </div>
                      <div className="u-small u-muted" style={{ marginTop: 4 }}>{c.summary}</div>
                    </div>
                    <Icon.ChevronRight size={15} style={{ color: 'var(--text-3)', flexShrink: 0, marginTop: 2 }} />
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </Section>

      {/* ---- Asset register ---- */}
      <div ref={assetsRef}>
        <Section
          title="Asset register"
          sub="Group-level register · buses and lab equipment. Bus 14 is in the workshop; repair is scheduled for Saturday."
          actions={<Badge tone="warning" dot>{ASSETS.filter(a => a.status !== 'In service').length} due for service</Badge>}
          style={{ marginTop: 8 }}
        >
          <Card>
            <DataTable
              rows={ASSETS}
              rowKey={a => a.id}
              columns={[
                { key: 'name', label: 'Asset', render: a => <span style={{ fontWeight: 580 }}>{a.name}</span> },
                { key: 'type', label: 'Type', render: a => <Badge tone="outline">{a.type}</Badge> },
                { key: 'location', label: 'Route / location' },
                { key: 'campus', label: 'Campus' },
                { key: 'vendor', label: 'Vendor', render: a => <span className="u-small u-muted">{a.vendor}</span> },
                { key: 'lastServiced', label: 'Last serviced' },
                { key: 'nextDue', label: 'Next due', render: a => <span className={a.dueInDays < 15 ? 'mono' : ''}>{a.nextDue}</span> },
                {
                  key: 'status', label: 'Status', align: 'right', render: a => a.status === 'In service'
                    ? <Badge tone="success" dot>In service</Badge>
                    : a.status === 'Due for service'
                      ? <Badge tone="warning" dot>Due for service</Badge>
                      : <Badge tone="danger" dot>In workshop</Badge>,
                },
              ]}
              empty={<Empty icon={<Icon.Grid size={22} />} title="No assets on register" />}
            />
          </Card>
        </Section>
      </div>

      {/* ---- Vendor list ---- */}
      <Section
        title="Vendor contracts"
        sub="Five active service contracts. AquaSure's RO contract lapsed 6 days ago — renewal workflow wf_5 holds the open owner task."
        style={{ marginTop: 8 }}
      >
        <div className="grid grid-3">
          {VENDORS.map(v => (
            <Card key={v.id} pad>
              <div className="u-col" style={{ gap: 8 }}>
                <div className="u-between">
                  <span style={{ fontWeight: 620 }}>{v.name}</span>
                  <span className="u-xs u-faint">{v.assetsCovered} assets</span>
                </div>
                <div className="u-small u-muted">{v.service}</div>
                <div className="u-xs u-faint mono">{v.contact}</div>
                <div style={{ marginTop: 2 }}>{contractBadge(v.contractEndsDays)}</div>
              </div>
            </Card>
          ))}
          <Card pad style={{ borderStyle: 'dashed' }}>
            <div className="u-col" style={{ gap: 6 }}>
              <span className="u-upper">Contract renewals</span>
              <span className="u-small u-muted">
                Expiring within 30 days: MetroLab Supplies (12d) and SecureVision CCTV (9d). Workflow <span className="mono">wf_5</span> creates
                owner tasks at 30/14/7 days — no renewal is currently in progress for either contract.
              </span>
              <div style={{ marginTop: 4 }}>
                <Button size="sm" variant="secondary" icon={<Icon.Workflow size={13} />} onClick={() => {
                  dispatch({ type: 'audit/add', entry: { actor: actorName, actorRole: session.roleId, action: 'Reviewed vendor renewal workflow', recordType: 'Vendor contract', recordRef: 'MetroLab Supplies · SecureVision CCTV', policyRef: 'Approvals §1.2', aiInvolved: false, risk: 'low', outcome: 'Renewal workflow wf_5 reviewed' } });
                  toast({ title: 'Renewal review recorded', sub: 'Audit entry added for MetroLab and SecureVision contracts', tone: 'success' });
                }}>Record renewal review</Button>
              </div>
            </div>
          </Card>
        </div>
      </Section>

      <div style={{ height: 24 }} />
      <div className="u-xs u-faint" style={{ textAlign: 'center' }}>
        {fees.loading ? 'Computing collection…' : `${fmtMoneyShort((fees.data ?? []).reduce((a, f) => a + f.paidAmount, 0))} received on this campus · register compiled from seed records`}
      </div>
    </div>
  );
}
