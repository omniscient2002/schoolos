/* ============================================================
   Inspections — the compliance check register.
   Answers in one screen: what is scheduled, what completed this
   month, which checks failed, and whether each failure already
   has a work order behind it. Findings come from the records;
   counts are recomputed, never hardcoded.
   ============================================================ */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import { maintenanceService } from '../services';
import * as m from '../data/dataset';
import { PageHead, Card, Stat, Badge, Button, Empty, ErrorState, SkeletonCard, useToast, Drawer, DataTable, KeyValue } from '../components/ui';
import { AssetTag } from '../components/Maint';
import { Icon } from '../components/Icon';
import { fmtDateShort, fmtDateTime } from '../lib/format';
import type { InspectionRecord, CampusId } from '../types/domain';

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

const STATUS_TONE: Record<InspectionRecord['status'], 'neutral' | 'info' | 'success'> = {
  scheduled: 'neutral', 'in-progress': 'info', completed: 'success',
};

const RESULT_META: Partial<Record<NonNullable<InspectionRecord['result']>, { tone: 'success' | 'warning' | 'danger'; label: string }>> = {
  pass: { tone: 'success', label: 'Pass' },
  'pass-with-notes': { tone: 'warning', label: 'Pass with notes' },
  fail: { tone: 'danger', label: 'Fail' },
};

/* ============================================================ */

export default function Inspections() {
  const navigate = useNavigate();
  const { session, domain, actorName } = useStore();
  const toast = useToast();
  const scope = session.activeCampus;
  const [selId, setSelId] = useState<string | null>(null);

  const { data, loading, error, retry } = useAsync(() => maintenanceService.inspections(), [scope]);

  const inspections = (data ?? []).filter(i => i.campus === scope);
  const scheduled = inspections.filter(i => i.status !== 'completed');
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const completedThisMonth = inspections.filter(i => i.status === 'completed' && i.on.getTime() >= monthStart.getTime());
  const failedFindings = inspections
    .filter(i => i.findings?.some(f => !f.ok))
    .flatMap(i => i.findings!.filter(f => !f.ok).map(f => ({ ins: i, f })));
  const followUps = inspections.filter(i => i.followUpWorkOrderId).length;

  /* IN-0209 (plan MP-03, generator) is already covered by WO-1043 in the seed — detect it, don't hardcode the row */
  const woForPlan = (planId: string) =>
    domain.workOrders.find(w => w.source === 'inspection' && w.assetId && m.maintPlans.find(p => p.id === planId)?.assetIds.includes(w.assetId) && !['resolved', 'closed', 'cancelled'].includes(w.status));

  const sel = inspections.find(i => i.id === selId) ?? null;
  const selWO = sel
    ? (sel.followUpWorkOrderId ? domain.workOrders.find(w => w.id === sel.followUpWorkOrderId) : (sel.planId ? woForPlan(sel.planId) : undefined))
    : undefined;
  const selPlan = sel?.planId ? m.maintPlans.find(p => p.id === sel.planId) : undefined;
  const selAsset = sel?.assetId ? m.assetById(sel.assetId) : undefined;


  const raiseWO = (ins: InspectionRecord) => {
    const existing = ins.planId ? woForPlan(ins.planId) : undefined;
    if (existing) {
      toast({ title: 'Already raised as WO-1043', sub: `An open work order (${existing.id}) already covers this inspection — opening it avoids a duplicate.`, tone: 'info' });
    } else {
      toast({ title: 'Work order raised from inspection', sub: `Demo action recorded against ${ins.id} · assigned to ${ins.inspector} — not persisted beyond this session.`, tone: 'success' });
    }
  };

  /* scheduled rows whose window has passed get the raise action (IN-0209 today) */
  const raiseable = (r: InspectionRecord) => r.status === 'scheduled' && r.on.getTime() < Date.now();

  const columns = [
    { key: 'id', label: 'ID', width: 88, render: (r: InspectionRecord) => <span className="u-mono u-small u-muted">{r.id}</span> },
    { key: 'title', label: 'Inspection', render: (r: InspectionRecord) => (
      <div className="u-col" style={{ gap: 2 }}>
        <span style={{ fontWeight: 570, fontSize: 'var(--text-md)' }}>{r.title}</span>
        {r.assetId && <span><AssetTag id={r.assetId} /></span>}
      </div>
    ) },
    { key: 'campus', label: 'Campus', width: 90, render: (r: InspectionRecord) => <span className="u-small">{CAMPUS_LABEL[r.campus]}</span> },
    { key: 'on', label: 'Date', width: 100, render: (r: InspectionRecord) => <span className="u-mono u-small">{fmtDateShort(r.on)}</span> },
    { key: 'inspector', label: 'Inspector', width: 150, render: (r: InspectionRecord) => <span className="u-small">{r.inspector}{r.inspector === actorName ? ' (you)' : ''}</span> },
    { key: 'status', label: 'Status', width: 110, render: (r: InspectionRecord) => <Badge tone={STATUS_TONE[r.status]} dot>{r.status === 'in-progress' ? 'In progress' : r.status[0].toUpperCase() + r.status.slice(1)}</Badge> },
    { key: 'result', label: 'Result', width: 140, render: (r: InspectionRecord) => {
      const res = r.result ? RESULT_META[r.result] : undefined;
      return res ? <Badge tone={res.tone}>{res.label}</Badge> : <span className="u-small u-muted">Awaiting</span>;
    } },
    { key: 'actions', label: '', width: 210, render: (r: InspectionRecord) => {
      if (!raiseable(r)) return null;
      const existing = r.planId ? woForPlan(r.planId) : undefined;
      return (
        <span className="u-inline" style={{ gap: 8 }} onClick={e => e.stopPropagation()}>
          <Button size="sm" variant={existing ? 'secondary' : 'primary'} icon={<Icon.Zap size={12} />} onClick={() => raiseWO(r)}>Raise work order</Button>
          {existing && <Link to={`/maintenance/work-orders/${existing.id}`} className="u-mono u-small" style={{ color: 'var(--accent-text)' }}>{existing.id} →</Link>}
        </span>
      );
    } },
  ];

  return (
    <div>
      <PageHead
        title="Inspections"
        sub={`${scheduled.length} scheduled · ${completedThisMonth.length} completed this month · ${failedFindings.length} failed finding${failedFindings.length === 1 ? '' : 's'} · ${CAMPUS_LABEL[scope]} campus`}
        actions={
          <Button variant="secondary" icon={<Icon.Clipboard size={14} />} onClick={() => navigate('/maintenance/preventive')}>Preventive plans</Button>
        }
      />

      {loading && <div className="grid grid-4"><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>}
      {error && <ErrorState onRetry={retry} sub={error} />}

      {data && (
        <>
          <div className="grid grid-4" style={{ marginBottom: 'var(--s-5)' }}>
            <Stat label="Scheduled" value={scheduled.length} sub="open checks on the calendar" />
            <Stat label="Completed this month" value={completedThisMonth.length} sub={completedThisMonth.map(i => i.id).join(', ') || 'none logged yet'} />
            <Stat label="Failed findings" value={failedFindings.length} sub={failedFindings.length ? failedFindings.map(x => x.ins.id).join(', ') : 'all checks clean'} />
            <Stat label="Follow-up WOs" value={followUps} sub="inspections with a linked work order" onClick={() => navigate('/maintenance/work-orders')} />
          </div>

          <Card head="Register" sub="Every inspection with its result. Completed checks open a findings drawer — failed rows show whether a work order already exists."
            actions={<span className="u-xs u-faint">Sorted by date · newest first</span>}>
            {inspections.length === 0 ? (
              <Empty icon={<Icon.Clipboard size={22} />} title="No inspections in scope" sub="Nothing is scheduled or completed for this campus yet." />
            ) : (
              <div style={{ padding: 'var(--s-3) var(--s-4)' }}>
                <DataTable
                  columns={columns}
                  rows={[...inspections].sort((a, b) => b.on.getTime() - a.on.getTime() || a.id.localeCompare(b.id))}
                  rowKey={r => r.id}
                  onRowClick={r => setSelId(r.id)}
                  empty={<Empty icon={<Icon.Clipboard size={20} />} title="No inspections" />}
                />
                <div className="u-xs u-faint" style={{ marginTop: 8 }}>
                  Completed rows open the findings drawer. Scheduled rows stay read-only until the check is logged.
                </div>
              </div>
            )}
          </Card>

          {/* failed-findings follow-through strip */}
          {failedFindings.length > 0 && (
            <Card head="Failed findings to close" sub="Each failed item and where its follow-up stands" style={{ marginTop: 'var(--s-5)' }}>
              <div className="u-col" style={{ gap: 10, padding: 'var(--s-4) var(--s-5)' }}>
                {failedFindings.map(({ ins, f }) => {
                  const woRec = ins.followUpWorkOrderId ? domain.workOrders.find(w => w.id === ins.followUpWorkOrderId) : (ins.planId ? woForPlan(ins.planId) : undefined);
                  return (
                    <div key={`${ins.id}-${f.item}`} className="u-inline" style={{ gap: 10, justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <div className="u-col" style={{ gap: 2, minWidth: 0 }}>
                        <span className="u-inline" style={{ gap: 8 }}>
                          <Icon.X size={13} style={{ color: 'var(--danger)' }} />
                          <span className="u-small" style={{ fontWeight: 560 }}>{f.item}</span>
                          <span className="u-mono u-xs u-muted">{ins.id}</span>
                        </span>
                        {f.note && <span className="u-small u-muted" style={{ paddingLeft: 21 }}>{f.note}</span>}
                      </div>
                      {woRec
                        ? <Link to={`/maintenance/work-orders/${woRec.id}`} className="u-mono u-small" style={{ color: 'var(--accent-text)' }}>{woRec.id} →</Link>
                        : <Badge tone="warning">Follow-up needed</Badge>}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          <div style={{ height: 24 }} />
          <div className="u-small u-muted">
            Inspection results feed the preventive compliance number on the intelligence page. A failed check without a linked work order is the one state this screen treats as action-needed.
          </div>
        </>
      )}

      {/* Findings drawer */}
      <Drawer
        open={!!sel}
        onClose={() => setSelId(null)}
        title={sel?.title ?? ''}
        sub={sel ? `${sel.id} · ${fmtDateTime(sel.on)} · ${sel.inspector}` : undefined}
        footer={sel && (
          <>
            <Button variant="secondary" onClick={() => setSelId(null)}>Close</Button>
          </>
        )}
      >
        {sel && (
          <div className="u-col" style={{ gap: 20 }}>
            <KeyValue
              items={[
                { k: 'Inspector', v: sel.inspector },
                { k: 'Campus', v: CAMPUS_LABEL[sel.campus] },
                { k: 'Date', v: fmtDateTime(sel.on) },
                { k: 'Result', v: sel.result ? <Badge tone={RESULT_META[sel.result]!.tone}>{RESULT_META[sel.result]!.label}</Badge> : 'Not logged' },
              ]}
            />

            {selAsset && (
              <div className="u-col" style={{ gap: 6 }}>
                <span className="u-upper">Asset</span>
                <AssetTag id={selAsset.id} onClick={() => navigate(`/maintenance/assets/${selAsset.id}`)} />
                <span className="u-small u-muted">{selAsset.name}</span>
              </div>
            )}

            {selPlan && (
              <div className="u-col" style={{ gap: 6 }}>
                <span className="u-upper">From plan</span>
                <span className="u-inline" style={{ gap: 8 }}>
                  <span className="u-mono u-small u-muted">{selPlan.id}</span>
                  <span className="u-small">{selPlan.title}</span>
                  <Link to="/maintenance/preventive" className="u-small" style={{ color: 'var(--accent-text)' }}>Plan</Link>
                </span>
              </div>
            )}

            <div className="u-col" style={{ gap: 8 }}>
              <span className="u-upper">Findings</span>
              {sel.findings?.length ? (
                <ul className="u-col" style={{ gap: 9, margin: 0, padding: 0, listStyle: 'none' }}>
                  {sel.findings.map(f => (
                    <li key={f.item} className="u-inline" style={{ gap: 9, alignItems: 'flex-start' }}>
                      {f.ok
                        ? <Icon.Check size={14} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 1 }} />
                        : <Icon.X size={14} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 1 }} />}
                      <div className="u-col" style={{ gap: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 550 }}>{f.item}</span>
                        {f.note && <span className="u-small u-muted">{f.note}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="u-small u-muted">No itemised findings were recorded for this check.</span>
              )}
            </div>

            {selWO && (
              <div className="u-col" style={{ gap: 6 }}>
                <span className="u-upper">Follow-up work order</span>
                <Link to={`/maintenance/work-orders/${selWO.id}`} className="u-inline u-small" style={{ gap: 8, color: 'var(--accent-text)' }}>
                  <span className="u-mono">{selWO.id}</span> {selWO.title} →
                </Link>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
