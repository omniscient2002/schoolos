/* ============================================================
   Maintenance intelligence — the "read the operations" screen.
   Where the money goes, how SLA is holding, which assets fail
   repeatedly, what a replacement would cost, how technicians
   are performing and where preventive compliance stands.
   Deterministic arithmetic over the maintenance records —
   rule-based insight, honestly labelled as such.
   ============================================================ */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import { DEMO_MODE } from '../lib/demoMode';
import { maintenanceService } from '../services';
import * as m from '../data/dataset';
import { PageHead, Section, Card, Stat, Badge, Button, Empty, ErrorState, SkeletonCard, DataTable, SegmentedBar, useToast } from '../components/ui';
import { BarChart, Donut } from '../components/Chart';
import { AssetTag, PriorityBadge, WOStatusChip } from '../components/Maint';
import { Icon } from '../components/Icon';
import { fmtDateShort, fmtMoneyShort } from '../lib/format';
import type { AssetRecord, CampusId, WorkOrderRecord } from '../types/domain';

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

const CAMPUS_LABEL: Record<CampusId, string> = { north: 'North', city: 'City', east: 'East' };

/* ============================================================ */

export default function MaintIntelligence() {
  return DEMO_MODE ? <DemoMaintIntelligence /> : <LiveMaintIntelligence />;
}

/* LIVE: no server door yet — honest empty, no fiction (L4-2.2). */
function LiveMaintIntelligence() {
  return (
    <div>
      <PageHead
        title="Maintenance intelligence"
        sub="Failure patterns, repeat-fault detection and replacement forecasts."
      />
      <Card pad>
        <Empty
          icon={<Icon.Offline size={24} />}
          title="Not connected yet"
          sub="There is no analytics door behind these forecasts yet. Showing them without a data source would be fiction, so this screen stays empty until the door lands."
        />
      </Card>
    </div>
  );
}

/* DEMO: fixture data over the mock service (demo world only) */
function DemoMaintIntelligence() {
  const navigate = useNavigate();
  const { session, domain, actorName } = useStore();
  const toast = useToast();
  const scope = session.activeCampus;

  const overview = useAsync(() => maintenanceService.overview(scope), [scope]);
  const techs = useAsync(() => maintenanceService.technicians(scope), [scope]);
  const ac04 = useAsync(() => maintenanceService.replacement('NOR-AC-04'), [scope]);

  const a = overview.data?.analytics;
  const wos = domain.workOrders.filter(w => w.campus === scope);
  const open = wos.filter(w => !['resolved', 'closed', 'cancelled'].includes(w.status));
  const resolved = wos.filter(w => ['resolved', 'closed'].includes(w.status));
  const met = wos.length - wos.filter(w => w.slaBreached || (['resolved', 'closed'].includes(w.status) && w.completedOn && w.completedOn.getTime() > w.sla.resolveBy.getTime())).length;
  const breached = wos.length - met;
  const spendMTD = wos
    .filter(w => (w.completedOn ?? w.reportedOn).getTime() >= new Date(new Date().setDate(1)).setHours(0, 0, 0, 0))
    .reduce((acc, w) => acc + (w.partsUsed?.reduce((x, p) => x + p.cost, 0) ?? 0) + Math.round((w.labourMins ?? 0) * 2), 0);

  /* repeat failures — assets with ≥2 logged failures in scope, NOR-AC-04 first */
  const repeatAssets: AssetRecord[] = (overview.data?.assets ?? [])
    .filter(as => (as.campus === scope) && as.failures.length >= 2)
    .sort((x, y) => y.failures.length - x.failures.length || y.repairSpendYTD - x.repairSpendYTD);

  const techRows = (techs.data ?? []).map(t => ({
    name: t.name,
    jobs30d: t.jobs30d,
    fixPct: Math.round(t.firstTimeFixRate * 100),
    avg: t.avgResolutionMins,
    current: t.currentJobs,
  }));

  const pmTasks = a?.pmTasks ?? m.maintPlans.length;
  const pmOverdue = a?.pmOverdue ?? 0;
  const pmDueSoon = m.maintPlans.filter(p => p.compliance === 'due-soon').length;
  const pmOnTrack = pmTasks - pmOverdue - pmDueSoon;
  const slaPct = wos.length ? Math.round((met / wos.length) * 100) : 100;
  const avgRes = a?.avgResolutionHrs ?? 0;

  const soWhat = (text: string) => (
    <p className="u-small" style={{ margin: '0 0 12px', color: 'var(--text-2)', lineHeight: 1.55 }}>
      <b style={{ fontWeight: 620, color: 'var(--text)' }}>So what:</b> {text}
    </p>
  );

  return (
    <div>
      <PageHead
        title="Maintenance intelligence"
        sub={`${open.length} open jobs · SLA ${slaPct}% · read the operations before the weekly review · ${CAMPUS_LABEL[scope] + ' campus'}`}
        actions={
          <Button variant="secondary" icon={<Icon.Clipboard size={14} />} onClick={() => navigate('/maintenance/preventive')}>Preventive plans</Button>
        }
      />

      {overview.loading && <div className="grid grid-4"><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>}
      {overview.error && <ErrorState onRetry={overview.retry} sub={overview.error} />}

      {overview.data && a && (
        <>
          <div className="grid grid-4" style={{ marginBottom: 'var(--s-5)' }}>
            <Stat label="Open jobs" value={a.openCount} sub={`${a.emergency} emergency or critical`} onClick={() => navigate('/maintenance/work-orders')} />
            <Stat label="SLA compliance" value={`${slaPct}%`} sub={`${met} met · ${breached} breached this cycle`} />
            <Stat label="Avg resolution" value={`${avgRes.toFixed(1)}h`} sub={`${a.resolvedCount} resolved this cycle`} />
            <Stat label="Spend MTD" value={fmtMoneyShort(spendMTD)} sub={`parts + labour · ${fmtMoneyShort(a.spend)} this cycle`} />
          </div>

          {/* ---------- where the money goes ---------- */}
          <Section
            title="Where the money goes"
            sub="Spend by building — parts and labour combined, from the work-order ledger"
            actions={<Link to="/maintenance/work-orders" className="u-small" style={{ color: 'var(--accent-text)' }}>Ledger</Link>}
            style={{ marginBottom: 'var(--s-6)' }}
          >
            <div className="grid grid-2">
              <Card head="Spend by building" sub="Open + recent work orders in scope">
                <BarChart
                  data={(a.byBuilding.length ? a.byBuilding : [{ building: 'no spend recorded', spend: 0 }]).slice(0, 6).map(b => ({ label: b.building.split(' · ')[1] ?? b.building, value: Math.round(b.spend) }))}
                  format={v => `₹${v.toLocaleString('en-IN')}`}
                  height={190}
                />
              </Card>
              <Card head="Reading the concentration" sub="The pattern behind the bars">
                {soWhat(`Block A is the top spend, and most of it is one asset: repeat repairs on NOR-AC-04 (Science Lab AC) — ₹18,400 this year across 4 visits in 63 days. The money is not spread across small jobs; it is circling a unit that keeps failing.`)}
                <div className="u-col" style={{ gap: 8 }}>
                  {a.byBuilding.slice(0, 4).map(b => (
                    <div key={b.building} className="u-inline u-small" style={{ gap: 8, justifyContent: 'space-between' }}>
                      <span className="u-muted">{b.building}</span>
                      <span className="mono u-faint">{fmtMoneyShort(b.spend)}</span>
                    </div>
                  ))}
                  <div className="divider" />
                  <div className="u-inline u-small" style={{ gap: 8 }}>
                    <AssetTag id="NOR-AC-04" onClick={() => navigate('/maintenance/assets/NOR-AC-04')} />
                    <span className="u-small u-muted">4 failures · 63 days · ₹18,400 YTD — the single largest repeat line.</span>
                  </div>
                </div>
              </Card>
            </div>
          </Section>

          {/* ---------- SLA & flow ---------- */}
          <Section
            title="SLA & flow"
            sub="Response and resolution windows against the deterministic SLA policy"
            actions={<Link to="/maintenance/work-orders" className="u-small" style={{ color: 'var(--accent-text)' }}>Board</Link>}
            style={{ marginBottom: 'var(--s-6)' }}
          >
            <div className="grid grid-2">
              <Card head="Met vs breached" sub="This cycle, in scope">
                <div className="u-flex" style={{ gap: 26, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="u-mono" style={{ fontSize: 44, fontWeight: 650, letterSpacing: '-0.03em', lineHeight: 1 }}>{slaPct}<span style={{ fontSize: 20, color: 'var(--text-3)' }}>%</span></span>
                  <Donut
                    size={132}
                    thickness={15}
                    centerLabel={`${met}/${wos.length}`}
                    centerSub="inside window"
                    segments={[
                      { label: 'SLA met', value: met, color: 'var(--accent)' },
                      { label: 'SLA breached', value: breached, color: 'var(--danger)' },
                    ]}
                  />
                </div>
              </Card>
              <Card head="Response position" sub="Where the remaining time sits">
                {soWhat(`Every open job has been responded to — the risk now is resolution windows, not response. Closest to the line: ${open.slice().sort((x, y) => x.sla.resolveBy.getTime() - y.sla.resolveBy.getTime())[0]?.id ?? 'none'}; the emergency bus job (WO-1041) is already at verification.`)}
                <div className="u-col" style={{ gap: 8 }}>
                  {open.slice().sort((x, y) => x.sla.resolveBy.getTime() - y.sla.resolveBy.getTime()).slice(0, 4).map(w => (
                    <Link key={w.id} to={`/maintenance/work-orders/${w.id}`} className="u-inline" style={{ gap: 10, justifyContent: 'space-between', textDecoration: 'none', color: 'inherit' }}>
                      <span className="u-inline" style={{ gap: 8, minWidth: 0 }}>
                        <span className="u-mono u-small u-muted">{w.id}</span>
                        <PriorityBadge p={w.priority} size="sm" />
                      </span>
                      <span className="u-mono u-small u-muted">
                        {w.respondedOn ? `res ${Math.max(0, Math.round((w.sla.resolveBy.getTime() - Date.now()) / 3600000))}h left` : 'awaiting response'}
                      </span>
                    </Link>
                  ))}
                </div>
              </Card>
            </div>
          </Section>

          {/* ---------- repeat failures ---------- */}
          <Section
            title="Repeat failures"
            sub="Assets with 2 or more logged failures — the candidates for deeper intervention"
            style={{ marginBottom: 'var(--s-6)' }}
          >
            <Card>
              {repeatAssets.length === 0 ? (
                <Empty icon={<Icon.Check size={22} />} title="No repeat failures" sub="No asset in scope has 2 or more logged failures." />
              ) : (
                <div style={{ padding: 'var(--s-3) var(--s-4)' }}>
                  <DataTable
                    columns={[
                      { key: 'id', label: 'Asset', render: (r: AssetRecord) => <AssetTag id={r.id} onClick={() => navigate(`/maintenance/assets/${r.id}`)} /> },
                      { key: 'name', label: 'Name', render: (r: AssetRecord) => <span className="u-small">{r.name}</span> },
                      { key: 'count', label: 'Failures', align: 'right', width: 90, render: (r: AssetRecord) => (
                        <Badge tone={r.failures.length >= 3 ? 'danger' : 'warning'}>{r.failures.length}</Badge>
                      ) },
                      { key: 'last', label: 'Last failure', width: 110, render: (r: AssetRecord) => {
                        const last = r.failures[r.failures.length - 1];
                        return <span className="u-mono u-small">{last ? fmtDateShort(last.on) : '—'}</span>;
                      } },
                      { key: 'spend', label: 'Spend YTD', align: 'right', width: 110, render: (r: AssetRecord) => <span className="mono u-small">{fmtMoneyShort(r.repairSpendYTD)}</span> },
                    ]}
                    rows={repeatAssets}
                    rowKey={r => r.id}
                    empty={null}
                  />
                </div>
              )}
              <div className="u-small u-muted" style={{ padding: '0 var(--s-5) var(--s-5)' }}>
                {soWhat(`${repeatAssets[0]?.id ?? 'No asset'} leads with ${repeatAssets[0]?.failures.length ?? 0} failures — its repair spend (₹${(repeatAssets[0]?.repairSpendYTD ?? 0).toLocaleString('en-IN')}) is now the argument for replacement, not another repair. The list below the leader is where preventive intervals should tighten first.`)}
              </div>
            </Card>
          </Section>

          {/* ---------- replacement candidates ---------- */}
          <Section
            title="Replacement candidates"
            sub="Rule-based evaluation — spend ratio + failure count + age"
            style={{ marginBottom: 'var(--s-6)' }}
          >
            <div className="grid grid-2">
              <Card head="NOR-AC-04 — Science Lab AC (Voltas)" sub="The active evaluation · Science Lab 204, Block A">
                {ac04.data ? (
                  <div className="u-col" style={{ gap: 12 }}>
                    <Badge tone={ac04.data.trigger ? 'warning' : 'success'} dot>{ac04.data.verdict}</Badge>
                    <div className="u-col" style={{ gap: 8 }}>
                      {[
                        { k: 'Age', v: `${ac04.data.ageYears} yrs of a 10-yr design life` },
                        { k: 'Repair spend ratio', v: `${Math.round(ac04.data.repairRatio * 100)}% of replacement cost (₹18,400 / ₹74,000)` },
                        { k: 'Failures', v: `${ac04.data.failureCount} in the last 63–90 days` },
                        { k: 'Estimated replacement', v: `₹${ac04.data.estReplacement.toLocaleString('en-IN')} installed` },
                      ].map(row => (
                        <div key={row.k} className="u-inline u-small" style={{ gap: 10, justifyContent: 'space-between' }}>
                          <span className="u-muted">{row.k}</span>
                          <span className="u-mono" style={{ textAlign: 'right' }}>{row.v}</span>
                        </div>
                      ))}
                    </div>
                    <p className="u-small u-muted" style={{ margin: 0, lineHeight: 1.55 }}>{ac04.data.rationale}</p>
                    <div className="u-inline" style={{ gap: 8 }}>
                      <Button variant="primary" size="sm" iconRight={<Icon.ArrowUpRight size={12} />} onClick={() => navigate('/maintenance/assets/NOR-AC-04')}>Open asset</Button>
                      <Button variant="secondary" size="sm" onClick={() => toast({ title: 'Evaluation shared', sub: 'Demo: the replacement note was copied to the facilities review queue — not persisted beyond this session.', tone: 'info' })}>Share evaluation</Button>
                    </div>
                  </div>
                ) : (
                  <span className="u-small u-muted">Evaluating…</span>
                )}
              </Card>
              <Card head="How to read this" sub="What the rule does and does not claim">
                {soWhat(`The trigger has fired: one more capacitor-and-gas visit costs a third of what a new unit does. Treat the number as a budgeting input for the next capital cycle, not a purchase order.`)}
                <p className="u-small u-muted" style={{ margin: 0, lineHeight: 1.65 }}>
                  Rule-based (spend ratio + failure count + age). Predictive failure modelling is a later-stage capability — today the evaluation recomputes deterministic arithmetic over logged failures and repair spend, so every figure traces to the asset record.
                </p>
              </Card>
            </div>
          </Section>

          {/* ---------- technician performance ---------- */}
          <Section
            title="Technician performance"
            sub="Workload and outcomes over the last 30 days — read as a team picture, not a leaderboard"
            style={{ marginBottom: 'var(--s-6)' }}
          >
            <Card>
              <div style={{ padding: 'var(--s-3) var(--s-4)' }}>
                <DataTable
                  columns={[
                    { key: 'name', label: 'Technician', render: (r: typeof techRows[number]) => <span className="u-inline" style={{ gap: 8 }}>{r.name}{r.name === actorName && <Badge tone="accent">you</Badge>}</span> },
                    { key: 'jobs30d', label: 'Jobs (30d)', align: 'right', width: 100, render: (r: typeof techRows[number]) => <span className="mono u-small">{r.jobs30d}</span> },
                    { key: 'fix', label: 'First-time fix', align: 'right', width: 110, render: (r: typeof techRows[number]) => (
                      <span className="mono u-small" style={{ color: r.fixPct >= 92 ? 'var(--success)' : 'var(--text-2)' }}>{r.fixPct}%</span>
                    ) },
                    { key: 'avg', label: 'Avg resolution', align: 'right', width: 120, render: (r: typeof techRows[number]) => <span className="mono u-small">{r.avg}m</span> },
                    { key: 'current', label: 'On hand now', align: 'right', width: 110, render: (r: typeof techRows[number]) => (
                      <Badge tone={r.current === 0 ? 'success' : r.current <= 1 ? 'info' : 'neutral'}>{r.current} job{r.current === 1 ? '' : 's'}</Badge>
                    ) },
                  ]}
                  rows={techRows}
                  rowKey={r => r.name}
                  empty={<Empty icon={<Icon.Users size={20} />} title="No technicians in scope" />}
                />
              </div>
              <div className="u-small u-muted" style={{ padding: '0 var(--s-5) var(--s-5)' }}>
                {soWhat(`First-time-fix sits between ${Math.min(...techRows.map(t => t.fixPct), 100)}% and ${Math.max(...techRows.map(t => t.fixPct), 0)}% across the team — the spread tracks specialisation, not effort. Where it dips, the usual cause is a job outside the technician's certified skill, which is an assignment-rule question.`)}
              </div>
            </Card>
          </Section>

          {/* ---------- preventive compliance ---------- */}
          <Section
            title="Preventive compliance"
            sub="Plans inside their window — the cheapest work is the work that prevents a breakdown"
            actions={<Link to="/maintenance/preventive" className="u-small" style={{ color: 'var(--accent-text)' }}>Open plans</Link>}
            style={{ marginBottom: 'var(--s-4)' }}
          >
            <div className="grid grid-2">
              <Card head="Plan position" sub={`${pmTasks} plans · ${pmOverdue} overdue · ${pmDueSoon} due soon`}>
                <SegmentedBar
                  height={10}
                  parts={[
                    { value: pmOnTrack, color: 'var(--accent)', label: `On track ${pmOnTrack}` },
                    { value: pmDueSoon, color: 'var(--chart-amber)', label: `Due soon ${pmDueSoon}` },
                    { value: pmOverdue, color: 'var(--danger)', label: `Overdue ${pmOverdue}` },
                  ]}
                />
                <div className="u-flex u-small u-muted" style={{ gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
                  <span className="u-inline" style={{ gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: 'var(--accent)' }} /> On track {pmOnTrack}</span>
                  <span className="u-inline" style={{ gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: 'var(--chart-amber)' }} /> Due soon {pmDueSoon}</span>
                  <span className="u-inline" style={{ gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: 'var(--danger)' }} /> Overdue {pmOverdue}</span>
                </div>
                <div className="divider" />
                {soWhat(`One overdue plan (MP-03, generator inspection) is a compliance item, not just a maintenance one — it auto-raised WO-1043. Every week it slips, the exam-week power contingency runs unaudited.`)}
              </Card>
              <Card head="Where the overdue work sits" sub="The plan behind the compliance gap">
                <div className="u-col" style={{ gap: 10 }}>
                  {m.maintPlans.filter(p => p.compliance !== 'on-track').map(p => (
                    <div key={p.id} className="u-inline" style={{ gap: 10, justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div className="u-col" style={{ gap: 2 }}>
                        <span className="u-inline" style={{ gap: 7 }}>
                          <span className="u-mono u-small u-muted">{p.id}</span>
                          <span className="u-small" style={{ fontWeight: 560 }}>{p.title}</span>
                        </span>
                        <span className="u-xs u-faint">{p.frequency} · owner {p.owner}{p.policyRef ? ` · ${p.policyRef}` : ''}</span>
                      </div>
                      <Badge tone={p.compliance === 'overdue' ? 'danger' : 'warning'}>{p.compliance === 'overdue' ? 'Overdue' : 'Due soon'}</Badge>
                    </div>
                  ))}
                  {m.maintPlans.every(p => p.compliance === 'on-track') && (
                    <Empty icon={<Icon.Check size={20} />} title="All plans on track" />
                  )}
                </div>
              </Card>
            </div>
          </Section>

          {/* resolved ledger footnote — ties charts to records */}
          {resolved.length > 0 && (
            <Card head="Resolved this cycle" sub="The records behind the averages above" style={{ marginBottom: 24 }}>
              <div className="u-col" style={{ padding: 'var(--s-4) var(--s-5)', gap: 10 }}>
                {resolved.map((w: WorkOrderRecord) => (
                  <Link key={w.id} to={`/maintenance/work-orders/${w.id}`} className="u-inline" style={{ gap: 10, justifyContent: 'space-between', textDecoration: 'none', color: 'inherit' }}>
                    <span className="u-inline" style={{ gap: 8, minWidth: 0 }}>
                      <span className="u-mono u-small u-muted">{w.id}</span>
                      <WOStatusChip s={w.status} />
                      <span className="u-small u-truncate">{w.title}</span>
                    </span>
                    <span className="u-mono u-xs u-faint" style={{ flexShrink: 0 }}>{w.completedOn ? fmtDateShort(w.completedOn) : '—'}</span>
                  </Link>
                ))}
              </div>
            </Card>
          )}

          <div style={{ height: 16 }} />
          <div className="u-small u-muted">
            Rule-based (spend ratio + failure count + age). Predictive failure modelling is a later-stage capability. All figures recompute from the work-order ledger, the asset register and the SLA policy table — no model in the loop.
          </div>
        </>
      )}
    </div>
  );
}
