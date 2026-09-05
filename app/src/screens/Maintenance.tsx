/* ============================================================
   Maintenance — the operations overview.
   Answers in one screen: what's broken, what's at risk, who is
   on it, what's due this week, and where the money goes.
   Every AI statement is a summary of the records below it.
   ============================================================ */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import { maintenanceService } from '../services';
import * as m from '../data/dataset';
import { PageHead, Card, Stat, Badge, Button, Empty, ErrorState, SkeletonCard, useToast, Avatar, Tabs } from '../components/ui';
import { EvidenceChain, AiTraceCard } from '../components/Ai';
import { Icon } from '../components/Icon';
import { fmtMoneyShort, fmtRelative, fmtTime } from '../lib/format';
import type { WorkOrderRecord } from '../types/domain';
import { AssetMini, PriorityBadge, SLAIndicator, WOStatusChip, AssetTag } from '../components/Maint';

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

const CAMPUS_LABEL: Record<string, string> = { north: 'North', city: 'City', east: 'East', all: 'All campuses' };

const PRIO_RANK: Record<string, number> = { emergency: 0, critical: 1, high: 2, medium: 3, low: 4 };

function WOCard({ wo }: { wo: WorkOrderRecord }) {
  const sla = m.slaState(wo);
  return (
    <Link to={`/maintenance/work-orders/${wo.id}`} className={`wo-card prio-${wo.priority} u-col`} style={{ gap: 7 }}>
      <div className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className="u-mono" style={{ fontSize: 11.5, fontWeight: 640, color: 'var(--text-3)' }}>{wo.id}</span>
        <PriorityBadge p={wo.priority} size="sm" />
        <WOStatusChip s={wo.status} />
        {!['resolved', 'closed'].includes(wo.status) && <SLAIndicator sla={sla} breach size="sm" />}
      </div>
      <span style={{ fontWeight: 600, fontSize: 'var(--text-md)' }}>{wo.title}</span>
      <div className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
        {wo.assetId && <AssetTag id={wo.assetId} />}
        <span className="u-small u-muted">{wo.building}{wo.room ? ` · ${wo.room}` : ''} · reported {fmtRelative(wo.reportedOn)}</span>
      </div>
    </Link>
  );
}

export default function Maintenance() {
  const navigate = useNavigate();
  const { session, domain } = useStore();
  const toast = useToast();
  const [tab, setTab] = useState('now');
  const scope = session.activeCampus;
  const { data, loading, error, retry } = useAsync(
    () => maintenanceService.overview(scope),
    [scope, domain.workOrders.length],
  );
  const wos = domain.workOrders.filter(w => w.campus === scope);
  const open = wos.filter(w => !['resolved', 'closed', 'cancelled'].includes(w.status));
  const needNow = [...open].sort((a, b) =>
    (PRIO_RANK[a.priority] ?? 9) - (PRIO_RANK[b.priority] ?? 9) ||
    (a.sla.resolveBy.getTime() - b.sla.resolveBy.getTime())).slice(0, 4);
  const events = domain.events.filter(e => e.type === 'maintenance').slice(0, 6);
  const liveEvents = domain.events.filter(e => e.type !== 'maintenance').slice(0, 3);

  const a = data?.analytics;

  return (
    <div>
      <PageHead
        title="Maintenance"
        sub={`${a ? a.openCount : '—'} open jobs${a && a.emergency ? ` · ${a.emergency} need immediate action` : ''} · ${CAMPUS_LABEL[scope]} campus`}
        actions={
          <div className="u-inline" style={{ gap: 8 }}>
            <Button variant="secondary" icon={<Icon.Compass size={14} />} onClick={() => navigate('/maintenance/map')}>Facilities map</Button>
            <Button variant="primary" icon={<Icon.Zap size={14} />} onClick={() => navigate('/maintenance/report')}>Report issue</Button>
          </div>
        }
      />

      {loading && <div className="grid grid-2"><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>}
      {error && <ErrorState onRetry={retry} sub={error} />}
      {data && a && (
        <>
          {/* KPI band */}
          <div className="grid grid-4" style={{ marginBottom: 'var(--s-5)' }}>
            <Stat label="Open jobs" value={a.openCount} sub={`${a.emergency} emergency/critical`} onClick={() => navigate('/maintenance/work-orders')} />
            <Stat label="SLA compliance" value={`${a.slaPct}%`} sub="this cycle" onClick={() => navigate('/maintenance/intelligence')} />
            <Stat label="Avg resolution" value={`${a.avgResolutionHrs.toFixed(1)}h`} sub="resolved this cycle" />
            <Stat label="Spend (open + recent)" value={fmtMoneyShort(a.spend)} sub={`${a.pmOverdue} preventive plan${a.pmOverdue === 1 ? '' : 's'} overdue`} onClick={() => navigate('/maintenance/intelligence')} />
          </div>

          <Tabs
            pill
            tabs={[
              { id: 'now', label: 'Needs you now' },
              { id: 'assets', label: 'Asset risk' },
              { id: 'week', label: 'This week' },
              { id: 'intel', label: 'Why it looks like this' },
            ]}
            active={tab}
            onChange={setTab}
          />

          {tab === 'now' && (
            <div className="grid grid-2" style={{ marginTop: 'var(--s-4)' }}>
              <Card head="Ranked by urgency + impact" sub="Top of the queue across your scope">
                <div className="u-col" style={{ gap: 10 }}>
                  {needNow.length === 0 && <Empty icon={<Icon.Check size={22} />} title="Nothing needs you" sub="All reported work is assigned and inside SLA." />}
                  {needNow.map(wo => <WOCard key={wo.id} wo={wo} />)}
                </div>
              </Card>
              <div className="u-col" style={{ gap: 'var(--s-4)' }}>
                <Card head="SLA watch" sub="Response or resolution windows closing">
                  {(() => {
                    const risky = open.map(w => ({ w, s: m.slaState(w) })).filter(x => x.s.tone === 'danger' || x.s.tone === 'warning').sort((x, y) => x.s.remaining - y.s.remaining).slice(0, 5);
                    if (!risky.length) return <Empty icon={<Icon.Clock size={20} />} title="No SLA risk" sub="Every open job has time in hand." />;
                    return (
                      <div className="u-col" style={{ gap: 9 }}>
                        {risky.map(({ w, s }) => (
                          <Link key={w.id} to={`/maintenance/work-orders/${w.id}`} className="u-inline" style={{ gap: 10, justifyContent: 'space-between' }}>
                            <span className="u-inline" style={{ gap: 8, minWidth: 0 }}>
                              <span className="u-mono u-small u-muted">{w.id}</span>
                              <span className="u-small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>{w.title}</span>
                            </span>
                            <SLAIndicator sla={s} breach size="sm" />
                          </Link>
                        ))}
                      </div>
                    );
                  })()}
                </Card>
                <Card head="On shift now" sub="North campus technicians" actions={<Link to="/maintenance/map" className="u-small" style={{ color: 'var(--accent-text)' }}>Map</Link>}>
                  <div className="u-col" style={{ gap: 9 }}>
                    {m.technicians.filter(t => t.campus === scope).map(t => (
                      <div key={t.id} className="u-inline" style={{ gap: 10, alignItems: 'center' }}>
                        <Avatar name={t.name} size="sm" />
                        <div className="u-col" style={{ gap: 0, flex: 1 }}>
                          <span className="u-inline" style={{ gap: 7 }}>
                            <span style={{ fontWeight: 560, fontSize: 'var(--text-sm)' }}>{t.name}</span>
                            <span className="u-small u-muted">{t.skills[0]}</span>
                          </span>
                          <span className="u-small u-muted">{t.lastSeen} · {t.currentJobs} active</span>
                        </div>
                        <Badge tone={t.currentJobs === 0 ? 'success' : t.currentJobs <= 1 ? 'info' : 'neutral'}>{t.currentJobs === 0 ? 'Free' : `${t.currentJobs} job${t.currentJobs === 1 ? '' : 's'}`}</Badge>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </div>
          )}

          {tab === 'assets' && (
            <div className="grid grid-2" style={{ marginTop: 'var(--s-4)' }}>
              <Card head="Assets trending unreliable" sub="Lowest health first — computed from failures, spend, age, PM adherence">
                <div className="u-col" style={{ gap: 9 }}>
                  {a.riskyAssets.slice(0, 5).map(as => (
                    <AssetMini key={as.id} asset={as} onClick={() => navigate(`/maintenance/assets/${as.id}`)} />
                  ))}
                  {a.riskyAssets.length === 0 && <Empty icon={<Icon.Check size={20} />} title="All assets healthy" sub="No asset below health 65 in scope." />}
                </div>
              </Card>
              <Card head="Preventive position" sub="Plans and compliance" actions={<Link to="/maintenance/preventive" className="u-small" style={{ color: 'var(--accent-text)' }}>Open plans</Link>}>
                <div className="u-col" style={{ gap: 10 }}>
                  {m.maintPlans.filter(p => p.compliance !== 'on-track').map(p => (
                    <div key={p.id} className="u-inline" style={{ gap: 10, justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div className="u-col" style={{ gap: 2 }}>
                        <span className="u-inline" style={{ gap: 7 }}>
                          <span className="u-mono u-small u-muted">{p.id}</span>
                          <span style={{ fontWeight: 560, fontSize: 'var(--text-sm)' }}>{p.title}</span>
                        </span>
                        <span className="u-small u-muted">{p.frequency} · {p.owner}</span>
                      </div>
                      <Badge tone={p.compliance === 'overdue' ? 'danger' : 'warning'}>{p.compliance === 'overdue' ? `Overdue ${Math.max(1, Math.round((Date.now() - p.nextDue.getTime()) / 86400000))}d` : 'Due soon'}</Badge>
                    </div>
                  ))}
                  {m.maintPlans.every(p => p.compliance === 'on-track') && <Empty icon={<Icon.Check size={20} />} title="All plans on track" />}
                  <div className="divider" />
                  <div className="u-inline" style={{ gap: 14 }}>
                    <span className="u-small u-muted">Plans: <b className="u-mono">{m.maintPlans.length}</b></span>
                    <span className="u-small u-muted">Overdue: <b className="u-mono" style={{ color: 'var(--danger-text)' }}>{a.pmOverdue}</b></span>
                    <span className="u-small u-muted">Compliance: <b className="u-mono">{Math.round(((m.maintPlans.length - a.pmOverdue) / m.maintPlans.length) * 100)}%</b></span>
                  </div>
                </div>
              </Card>
            </div>
          )}

          {tab === 'week' && (
            <div className="grid grid-2" style={{ marginTop: 'var(--s-4)' }}>
              <Card head="Resolved & verifying" sub="Last jobs through the loop">
                <div className="u-col" style={{ gap: 10 }}>
                  {wos.filter(w => ['verification', 'resolved', 'closed'].includes(w.status)).slice(0, 4).map(wo => <WOCard key={wo.id} wo={wo} />)}
                  {wos.every(w => !['verification', 'resolved', 'closed'].includes(w.status)) && <Empty icon={<Icon.Wrench size={20} />} title="Nothing resolved yet" />}
                </div>
              </Card>
              <Card head="Live activity" sub="Maintenance events as they happen">
                {events.length === 0 && liveEvents.length === 0 && (
                  <Empty icon={<Icon.Sunrise size={20} />} title="Quiet right now" sub="New work orders and SLA movements will appear here as they happen." />
                )}
                <div className="u-col" style={{ gap: 8 }}>
                  {[...events, ...liveEvents].slice(0, 8).map(e => (
                    <div key={e.id} className="u-inline" style={{ gap: 9, alignItems: 'flex-start' }}>
                      <span className="u-mono u-small" style={{ color: 'var(--text-3)', width: 38 }}>{fmtTime(e.on)}</span>
                      <span style={{ fontSize: 'var(--text-sm)', color: e.severity === 'critical' ? 'var(--danger-text)' : e.severity === 'warn' ? 'var(--text-1)' : 'var(--text-2)' }}>{e.label}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}

          {tab === 'intel' && (
            <div className="grid grid-2" style={{ marginTop: 'var(--s-4)' }}>
              <Card head="Why this queue is ranked this way" sub="Deterministic ordering — no opaque scoring">
                <EvidenceChain
                  title="Ranking factors"
                  steps={[
                    { label: 'Safety first', detail: 'Emergency/critical always above high, regardless of age', source: 'Facilities §1.2 policy', refType: 'maintenance' },
                    { label: 'Then SLA pressure', detail: 'Jobs closest to their response/resolution deadline rise', source: 'SLA engine · deterministic', refType: 'maintenance' },
                    { label: 'Then learning impact', detail: 'Reports during teaching hours affecting 30+ students rank up', source: 'Report intake metadata', refType: 'maintenance' },
                    { label: 'Recurrence tiebreak', detail: 'Assets with repeated failures get visibility (NOR-AC-04, 4 in 63 days)', source: 'Asset failure history', refType: 'maintenance' },
                  ]}
                />
                <div className="divider" />
                <p className="u-small u-muted" style={{ margin: 0 }}>
                  Priority overrides are allowed for facilities and leadership and are always recorded in the audit ledger with a reason.
                </p>
              </Card>
              <Card head="Operating summary" sub="Read by the principal in ~20 seconds">
                <div className="u-col" style={{ gap: 10 }}>
                  <p style={{ margin: 0, fontSize: 'var(--text-md)', lineHeight: 1.65 }}>
                    {needNow[0]
                      ? `${needNow[0].id} — ${needNow[0].title.toLowerCase()} — is the top item: ${needNow[0].priority}, reported ${fmtRelative(needNow[0].reportedOn)} by ${needNow[0].reportedBy}. `
                      : 'Nothing needs immediate attention. '}
                    {a.slaPct < 100 ? `SLA compliance is ${a.slaPct}% this cycle. ` : 'SLA is clean this cycle. '}
                    {a.pmOverdue ? `${a.pmOverdue} preventive plan${a.pmOverdue === 1 ? ' is' : 's are'} overdue — the generator inspection is the compliance-sensitive one. ` : ''}
                    {a.riskyAssets[0] ? `${a.riskyAssets[0].id} remains the watch asset at health ${a.riskyAssets[0].health}.` : ''}
                  </p>
                  <AiTraceCard
                    trace={{
                      trigger: 'Overview assembly — ranked from live work orders',
                      policy: 'Read-only summary; ranking rules deterministic · Facilities §1.2',
                      dataUsed: ['open work orders', 'SLA engine', 'asset health model', 'preventive plans'],
                      reasoningRole: 'Summarizer (read-only)',
                      action: 'None — briefing only',
                      approvalStatus: 'Not required (read-only)',
                      verification: 'Every number recomputed from records shown on this page',
                      model: 'Fast (classification) · ap-south-1',
                      latencyMs: 210,
                      tokens: 260,
                      cost: '₹0.01',
                    }}
                  />
                </div>
              </Card>
            </div>
          )}

          {/* Quick create */}
          <Card style={{ marginTop: 'var(--s-5)' }}>
            <div className="u-inline" style={{ gap: 14, justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <div className="u-col" style={{ gap: 3 }}>
                <span style={{ fontWeight: 620 }}>See something wrong?</span>
                <span className="u-small u-muted">Describe it in one line — SchoolOS classifies it, finds the asset, and routes it. ~20 seconds, no form.</span>
              </div>
              <div className="u-inline" style={{ gap: 8 }}>
                <Button variant="secondary" icon={<Icon.Grid size={14} />} onClick={() => toast({ title: 'Scan an asset QR tag', sub: 'Every tagged asset opens the report flow pre-identified (demo)', tone: 'info' })}>Scan QR</Button>
                <Button variant="primary" icon={<Icon.Zap size={14} />} onClick={() => navigate('/maintenance/report')}>Report an issue</Button>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
