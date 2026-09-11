/* ============================================================
   Preventive — the planned-work board.
   Answers in one screen: what maintenance is scheduled, what is
   late, which high-risk assets the plan windows touch, and what
   to do about each plan. Every number recomputed from the plan
   and asset records below it — nothing hardcoded in the UI.
   ============================================================ */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import { DEMO_MODE } from '../lib/demoMode';
import { maintenanceService } from '../services';
import * as m from '../data/dataset';
import { PageHead, Card, Stat, Badge, Button, Empty, ErrorState, SkeletonCard, useToast, Drawer, KeyValue } from '../components/ui';
import { AssetMini, AssetTag } from '../components/Maint';
import { Icon } from '../components/Icon';
import { fmtDateShort } from '../lib/format';
import type { MaintPlan, AssetRecord, CampusId, AssetStatus } from '../types/domain';

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

const DAY = 86400000;

/* calendar-day difference (0 = today, negative = past) */
function dayDiff(d: Date) {
  const a = new Date(d); a.setHours(0, 0, 0, 0);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((a.getTime() - t.getTime()) / DAY);
}

const CAMPUS_LABEL: Record<CampusId, string> = { north: 'North', city: 'City', east: 'East' };

const TYPE_TONE: Record<MaintPlan['type'], 'neutral' | 'info' | 'accent' | 'warning' | 'outline'> = {
  time: 'neutral', usage: 'accent', condition: 'info', seasonal: 'outline', compliance: 'warning',
};

const ASSET_DOT: Record<AssetStatus, string> = {
  operational: 'var(--accent)', watch: 'var(--chart-blue)', degraded: 'var(--chart-amber)', down: 'var(--chart-red)', maintenance: 'var(--ai)', retired: 'var(--chart-slate)',
};

/* ---------- days-until chip (overdue danger, ≤7d warning) ---------- */
function DueChip({ diff }: { diff: number }) {
  const label = diff < 0 ? `${-diff}d overdue` : diff === 0 ? 'Due today' : `in ${diff}d`;
  const danger = diff < 0, warn = diff >= 0 && diff <= 7;
  return (
    <span className="u-inline u-mono" style={{
      alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 580, whiteSpace: 'nowrap',
      color: danger ? 'var(--danger)' : warn ? 'var(--warning)' : 'var(--text-2)',
      background: danger ? 'color-mix(in srgb, var(--danger) 8%, transparent)' : warn ? 'color-mix(in srgb, var(--chart-amber) 8%, transparent)' : 'var(--surface-3)',
      border: `1px solid ${danger ? 'color-mix(in srgb, var(--danger) 24%, transparent)' : 'var(--border)'}`,
      padding: '2px 8px', borderRadius: 999,
    }}>
      {danger ? <Icon.Alert size={11} /> : <Icon.Clock size={11} />} {label}
    </span>
  );
}

/* ---------- mini month strip: 5-week grid, dot on plan nextDue days ---------- */
function MonthStrip({ plans, onPick }: { plans: MaintPlan[]; onPick: (p: MaintPlan) => void }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - 7);                       /* include the last week so overdue dates are visible */
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); /* back to Monday */
  const byDay = new Map<number, MaintPlan[]>();
  plans.forEach(p => {
    const off = Math.round((new Date(p.nextDue).setHours(0, 0, 0, 0) - start.getTime()) / DAY);
    if (off >= 0 && off < 35) byDay.set(off, [...(byDay.get(off) ?? []), p]);
  });
  const todayOff = Math.round((today.getTime() - start.getTime()) / DAY);
  const beyond = plans.filter(p => dayDiff(p.nextDue) > 34 - todayOff).length;
  return (
    <div className="u-col" style={{ gap: 8, minWidth: 0 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0,1fr))', gap: 3 }}>
        {Array.from({ length: 7 }, (_, i) => {
          const d = new Date(start); d.setDate(start.getDate() + i);
          return <div key={`w${i}`} className="u-upper" style={{ textAlign: 'center', fontSize: 9 }}>{d.toLocaleDateString('en-IN', { weekday: 'narrow' })}</div>;
        })}
        {Array.from({ length: 35 }, (_, i) => {
          const d = new Date(start); d.setDate(start.getDate() + i);
          const isToday = d.getTime() === today.getTime();
          const past = d.getTime() < today.getTime();
          const ps = byDay.get(i) ?? [];
          return (
            <div key={i} style={{
              minHeight: 42, borderRadius: 7, padding: '3px 4px',
              border: `1px solid ${isToday ? 'color-mix(in srgb, var(--accent) 45%, transparent)' : 'var(--border-subtle)'}`,
              background: past ? 'var(--bg-subtle)' : 'var(--surface-2)',
              display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start',
            }}>
              <span className="u-mono" style={{ fontSize: 9, lineHeight: 1.4, fontWeight: isToday ? 650 : 480, color: isToday ? 'var(--accent-text)' : past ? 'var(--text-3)' : 'var(--text-2)' }}>{d.getDate()}</span>
              <span style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                {ps.map(p => {
                  const diff = dayDiff(p.nextDue);
                  return (
                    <button key={p.id} title={`${p.id} · ${p.title} · due ${fmtDateShort(p.nextDue)}`} aria-label={`Open plan ${p.id}`}
                      onClick={() => onPick(p)}
                      style={{ width: 7, height: 7, borderRadius: 4, padding: 0, cursor: 'pointer', border: 'none', background: diff < 0 ? 'var(--danger)' : diff <= 7 ? 'var(--chart-amber)' : 'var(--accent)' }} />
                  );
                })}
              </span>
            </div>
          );
        })}
      </div>
      <div className="u-inline u-xs u-muted" style={{ gap: 12, flexWrap: 'wrap' }}>
        <span className="u-inline" style={{ gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: 4, background: 'var(--danger)' }} /> Overdue</span>
        <span className="u-inline" style={{ gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: 4, background: 'var(--chart-amber)' }} /> Due ≤ 7 days</span>
        <span className="u-inline" style={{ gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: 4, background: 'var(--accent)' }} /> Later</span>
        <span style={{ marginLeft: 'auto' }} className="u-faint">5-week view · {beyond} plan{beyond === 1 ? '' : 's'} due beyond this window · dots are plan due dates</span>
      </div>
    </div>
  );
}

/* ============================================================ */

export default function Preventive() {
  return DEMO_MODE ? <DemoPreventive /> : <LivePreventive />;
}

/* LIVE: no server door yet — honest empty, no fiction (L4-2.2). */
function LivePreventive() {
  return (
    <div>
      <PageHead
        title="Preventive maintenance"
        sub="Schedules, upcoming services and plan coverage."
      />
      <Card pad>
        <Empty
          icon={<Icon.Offline size={24} />}
          title="Not connected yet"
          sub="There is no preventive-schedule door on the server yet. Plans and schedules will appear here when the door exists."
        />
      </Card>
    </div>
  );
}

/* DEMO: fixture data over the mock service (demo world only) */
function DemoPreventive() {
  const navigate = useNavigate();
  const { session, domain, actorName } = useStore();
  const toast = useToast();
  const scope = session.activeCampus;
  const [planId, setPlanId] = useState<string | null>(null);

  const { data, loading, error, retry } = useAsync(() => maintenanceService.overview(scope), [scope]);

  /* plans are campus-wide programs; scope by the campus of their linked assets */
  const plans = m.maintPlans.filter(p =>
    p.assetIds.length === 0 || p.assetIds.some(id => m.assetById(id)?.campus === scope));

  const assetsFor = (p: MaintPlan): AssetRecord[] =>
    p.assetIds.map(id => m.assetById(id)).filter((a): a is AssetRecord => !!a);

  const withDiff = plans.map(p => ({ p, diff: dayDiff(p.nextDue) }));
  const overdue = withDiff.filter(x => x.diff < 0);
  const dueSoon = withDiff.filter(x => x.diff >= 0 && x.diff <= 7);
  const riskyIds = [...overdue, ...dueSoon]
    .flatMap(x => assetsFor(x.p))
    .filter(a => a.health < 65 || a.status === 'down')
    .map(a => a.id);
  const riskyAssets = [...new Set(riskyIds)].map(id => m.assetById(id)).filter((a): a is AssetRecord => !!a);
  const compliancePct = plans.length ? Math.round(((plans.length - overdue.length) / plans.length) * 100) : 100;

  /* an open work order already auto-raised from one of this plan's assets (e.g. MP-03 → WO-1043) */
  const planWO = (p: MaintPlan) =>
    domain.workOrders.find(w => w.source === 'inspection' && w.assetId && p.assetIds.includes(w.assetId) && !['resolved', 'closed', 'cancelled'].includes(w.status));

  const plan = planId ? m.maintPlans.find(p => p.id === planId) ?? null : null;
  const existingWO = plan ? planWO(plan) : undefined;

  const createWO = (p: MaintPlan) => {
    toast({
      title: `Work order created from plan ${p.id} · assigned to ${p.owner}`,
      sub: 'Local demo — in the live flow the plan checklist opens as a work order and is not persisted beyond this session.',
      tone: 'success',
    });
  };

  return (
    <div>
      <PageHead
        title="Preventive"
        sub={`${dueSoon.length} plan${dueSoon.length === 1 ? '' : 's'} due within 7 days · ${overdue.length} overdue · ${CAMPUS_LABEL[scope] + ' campus'}`}
        actions={
          <Button variant="secondary" icon={<Icon.Clipboard size={14} />} onClick={() => navigate('/maintenance/inspections')}>Inspections</Button>
        }
      />

      {loading && <div className="grid grid-4"><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>}
      {error && <ErrorState onRetry={retry} sub={error} />}

      {data && (
        <>
          {/* Stats header */}
          <div className="grid grid-4" style={{ marginBottom: 'var(--s-5)' }}>
            <Stat label="Plans" value={plans.length} sub={`${CAMPUS_LABEL[scope] + ' campus'} schedule`} />
            <Stat label="Overdue" value={overdue.length} sub={overdue.map(x => x.p.id).join(', ') || 'none'} />
            <Stat label="Due ≤ 7 days" value={dueSoon.length} sub={dueSoon.map(x => x.p.id).join(', ') || 'nothing in the window'} />
            <Stat label="Compliance" value={`${compliancePct}%`} sub="plans inside their window" onClick={() => navigate('/maintenance/intelligence')} />
          </div>

          {/* This week strip + mini month strip */}
          <Card head="This week" sub="What lands in the next 7 days, what is already late, and which high-risk assets the windows touch"
            actions={<Link to="/maintenance/inspections" className="u-small" style={{ color: 'var(--accent-text)' }}>Inspection schedule</Link>}
            style={{ marginBottom: 'var(--s-5)' }}>
            <div className="u-flex" style={{ gap: 28, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div className="u-col" style={{ gap: 14, flex: '1 1 210px', minWidth: 200 }}>
                <div className="u-inline" style={{ gap: 10, alignItems: 'baseline' }}>
                  <span className="u-mono" style={{ fontSize: 26, fontWeight: 650, letterSpacing: '-0.02em' }}>{dueSoon.length}</span>
                  <span className="u-small u-muted">plans due ≤ 7 days</span>
                </div>
                <div className="u-inline" style={{ gap: 10, alignItems: 'baseline' }}>
                  <span className="u-mono" style={{ fontSize: 26, fontWeight: 650, letterSpacing: '-0.02em', color: overdue.length ? 'var(--danger)' : undefined }}>{overdue.length}</span>
                  <span className="u-small u-muted">overdue {overdue.length ? `· ${overdue.map(x => x.p.id).join(', ')}` : ''}</span>
                </div>
                <div className="u-col" style={{ gap: 6 }}>
                  <span className="u-inline" style={{ gap: 8 }}>
                    <span className="u-mono" style={{ fontSize: 26, fontWeight: 650, letterSpacing: '-0.02em' }}>{riskyAssets.length}</span>
                    <span className="u-small u-muted">high-risk assets affected</span>
                  </span>
                  {riskyAssets.length > 0
                    ? <div className="u-inline" style={{ gap: 6, flexWrap: 'wrap' }}>{riskyAssets.map(a => <AssetTag key={a.id} id={a.id} onClick={() => navigate(`/maintenance/assets/${a.id}`)} />)}</div>
                    : <span className="u-xs u-faint">No asset below health 65 in these windows.</span>}
                </div>
              </div>
              <div style={{ flex: '2 1 420px', minWidth: 300 }}>
                <MonthStrip plans={plans} onPick={p => setPlanId(p.id)} />
              </div>
            </div>
          </Card>

          {/* Plans list */}
          <Card head="Plans" sub="Preventive and compliance schedules — click a plan for its checklist, safety notes and linked assets">
            {plans.length === 0 && <Empty icon={<Icon.Wrench size={22} />} title="No plans in scope" sub="No preventive plans are linked to this campus yet." />}
            <div className="u-col" style={{ gap: 9, padding: plans.length ? 'var(--s-4) var(--s-5)' : 0 }}>
              {[...withDiff].sort((a, b) => a.diff - b.diff || a.p.id.localeCompare(b.p.id)).map(({ p, diff }) => {
                const linked = assetsFor(p);
                const mine = p.owner === actorName;
                return (
                  <button key={p.id} className="wo-card u-col" style={{ gap: 7 }} onClick={() => setPlanId(p.id)}>
                    <div className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <span className="u-mono" style={{ fontSize: 11.5, fontWeight: 640, color: 'var(--text-3)' }}>{p.id}</span>
                      <span style={{ fontWeight: 600, fontSize: 'var(--text-md)' }}>{p.title}</span>
                      <Badge tone={TYPE_TONE[p.type]}>{p.type}</Badge>
                      <Badge tone={p.compliance === 'overdue' ? 'danger' : p.compliance === 'due-soon' ? 'warning' : 'success'} dot>
                        {p.compliance === 'overdue' ? 'Overdue' : p.compliance === 'due-soon' ? 'Due soon' : 'On track'}
                      </Badge>
                    </div>
                    <div className="u-inline u-small u-muted" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <span>{p.frequency}</span>
                      <span>· owner {p.owner}{mine ? ' (you)' : ''}</span>
                      {linked.map(a => <AssetTag key={a.id} id={a.id} onClick={() => navigate(`/maintenance/assets/${a.id}`)} />)}
                      {linked.length === 0 && <span>campus-wide program</span>}
                    </div>
                    <div className="u-inline u-small" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      {p.lastDone && <span className="u-muted">Last done {fmtDateShort(p.lastDone)}</span>}
                      <span className="u-muted">· Next {fmtDateShort(p.nextDue)}</span>
                      <DueChip diff={diff} />
                      {p.policyRef && <span className="u-mono u-xs u-faint" style={{ border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '1px 6px' }}>{p.policyRef}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>

          <div style={{ height: 24 }} />
          <div className="u-small u-muted">
            Compliance % counts plans inside their window; the day chips are computed from each plan's next-due date, so an overdue plan always reads as overdue regardless of its badge.
            Work-order creation from a plan is a facilities action — the demo raises it locally with the plan checklist attached.
          </div>
        </>
      )}

      {/* Plan drawer */}
      <Drawer
        open={!!plan}
        onClose={() => setPlanId(null)}
        title={plan?.title ?? ''}
        sub={plan ? `${plan.id} · ${plan.type} plan · ${plan.frequency}` : undefined}
        footer={plan && (
          existingWO ? (
            <>
              <Button variant="secondary" onClick={() => setPlanId(null)}>Close</Button>
              <Link to={`/maintenance/work-orders/${existingWO.id}`}>
                <Button variant="primary" icon={<Icon.ArrowRight size={14} />}>View {existingWO.id}</Button>
              </Link>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setPlanId(null)}>Close</Button>
              <Button variant="primary" icon={<Icon.Zap size={14} />} onClick={() => createWO(plan)}>Create work order</Button>
            </>
          )
        )}
      >
        {plan && (
          <div className="u-col" style={{ gap: 20 }}>
            <KeyValue
              items={[
                { k: 'Owner', v: plan.owner },
                { k: 'Last done', v: plan.lastDone ? fmtDateShort(plan.lastDone) : '—' },
                { k: 'Next due', v: <span className="u-inline" style={{ gap: 8 }}><span className="u-mono">{fmtDateShort(plan.nextDue)}</span><DueChip diff={dayDiff(plan.nextDue)} /></span> },
                { k: 'Policy ref', v: plan.policyRef ? <span className="u-mono u-small">{plan.policyRef}</span> : '—' },
              ]}
            />

            {existingWO && (
              <div className="u-inline u-small" style={{ gap: 8, alignItems: 'center', background: 'var(--info-weak)', border: '1px solid color-mix(in srgb, var(--info) 25%, transparent)', borderRadius: 'var(--r-md)', padding: '8px 12px' }}>
                <Icon.Info size={14} style={{ color: 'var(--info)', flexShrink: 0 }} />
                <span>A work order for this plan window already exists — <Link className="u-mono" to={`/maintenance/work-orders/${existingWO.id}`}>{existingWO.id}</Link>. Raising another would duplicate it.</span>
              </div>
            )}

            <div className="u-col" style={{ gap: 8 }}>
              <span className="u-upper">Check list</span>
              <ul className="u-col" style={{ gap: 6, margin: 0, padding: 0, listStyle: 'none' }}>
                {plan.checklist.map(c => (
                  <li key={c} className="u-inline" style={{ gap: 8, alignItems: 'flex-start', fontSize: 'var(--text-sm)' }}>
                    <Icon.Check size={13} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} /> {c}
                  </li>
                ))}
              </ul>
            </div>

            {plan.safetyNotes && plan.safetyNotes.length > 0 && (
              <div className="u-col" style={{ gap: 8 }}>
                <span className="u-upper">Safety notes</span>
                <ul className="u-col" style={{ gap: 6, margin: 0, padding: 0, listStyle: 'none' }}>
                  {plan.safetyNotes.map(s => (
                    <li key={s} className="u-inline" style={{ gap: 8, alignItems: 'flex-start', fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>
                      <Icon.Alert size={13} style={{ flexShrink: 0, marginTop: 2 }} />
                      <span style={{ color: 'var(--text-2)' }}>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="u-col" style={{ gap: 8 }}>
              <span className="u-upper">Linked assets</span>
              {assetsFor(plan).length === 0 && <span className="u-small u-muted">Campus-wide program — no single asset record.</span>}
              <div className="u-col" style={{ gap: 8 }}>
                {assetsFor(plan).map(a => (
                  <AssetMini key={a.id} asset={a} onClick={() => navigate(`/maintenance/assets/${a.id}`)} />
                ))}
              </div>
              {assetsFor(plan).length > 0 && (
                <div className="u-inline u-xs u-faint" style={{ gap: 10 }}>
                  {assetsFor(plan).map(a => (
                    <span key={a.id} className="u-inline" style={{ gap: 5 }}>
                      <span style={{ width: 7, height: 7, borderRadius: 4, background: ASSET_DOT[a.status] }} /> {a.status}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
