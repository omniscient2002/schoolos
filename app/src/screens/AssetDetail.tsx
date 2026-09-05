/* ============================================================
   AssetDetail — one asset, whole story. Identity and location,
   the health model with its factors, failure history, work
   orders and preventive plans attached to it, and the
   rule-based replacement evaluation (shown honestly as a
   heuristic, not a prediction).
   ============================================================ */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../state/store';
import { maintenanceService } from '../services';
import {
  PageHead, Card, Badge, Button, Empty, ErrorState, SkeletonCard, KeyValue, Timeline, Modal, useToast,
} from '../components/ui';
import { Icon } from '../components/Icon';
import { AssetTag, HealthRing, StatusDot, assetStatusLabel, WOStatusChip, PriorityBadge, QRPattern } from '../components/Maint';
import { fmtDate, fmtDateShort, fmtMoney, fmtMoneyShort, fmtRelative } from '../lib/format';
import type { AssetRecord, MaintPlan, WorkOrderRecord } from '../types/domain';

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

type ReplacementView = NonNullable<Awaited<ReturnType<typeof maintenanceService.replacement>>>;

const CAMPUS_LABEL: Record<string, string> = { north: 'North', city: 'City', east: 'East' };

export default function AssetDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const [qrOpen, setQrOpen] = useState(false);

  const assetQ = useAsync(() => maintenanceService.asset(id ?? ''), [id]);
  const replacementQ = useAsync(() => maintenanceService.replacement(id ?? ''), [id]);
  /* preventive plans referencing this asset */
  const plansQ = useAsync(async () => {
    const plans: MaintPlan[] = await maintenanceService.plans();
    return plans.filter(p => p.assetIds.includes(id ?? ''));
  }, [id]);

  const asset: AssetRecord | null = assetQ.data ?? null;

  if (assetQ.loading) {
    return (
      <div>
        <PageHead title="Asset" back={{ to: '/maintenance/assets', label: 'Asset registry' }} />
        <div className="grid grid-2"><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
      </div>
    );
  }

  if (assetQ.error || !asset) {
    return (
      <div>
        <PageHead title="Asset" back={{ to: '/maintenance/assets', label: 'Asset registry' }} />
        <ErrorState
          title={assetQ.error ? 'Could not load asset' : 'Asset not found'}
          sub={assetQ.error ?? (id ? `No asset tagged “${id}” exists in the registry.` : 'Open an asset from the registry.')}
          onRetry={assetQ.error ? assetQ.retry : undefined}
        />
        <div style={{ marginTop: 14 }}>
          <Button variant="secondary" icon={<Icon.ChevronLeft size={14} />} onClick={() => navigate('/maintenance/assets')}>Back to asset registry</Button>
        </div>
      </div>
    );
  }

  const ageYears = (Date.now() - asset.installedOn.getTime()) / (365.25 * 86400000);
  const warrantyOut = asset.warrantyUntil ? asset.warrantyUntil.getTime() < Date.now() : null;
  const campusName = CAMPUS_LABEL[asset.campus] ?? asset.campus;
  const factorMax = Math.max(...asset.healthFactors.map(f => Math.abs(f.impact)), 1);

  return (
    <div>
      <PageHead
        title={asset.name}
        sub={`${asset.category} · ${asset.manufacturer} ${asset.model} · ${campusName} campus`}
        back={{ to: '/maintenance/assets', label: 'Asset registry' }}
        actions={
          <div className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Button variant="primary" icon={<Icon.Zap size={14} />} onClick={() => navigate(`/maintenance/report?asset=${asset.id}`)}>Report problem</Button>
            <Button variant="secondary" icon={<Icon.Grid size={14} />} onClick={() => setQrOpen(true)}>View QR</Button>
            <Button
              variant="secondary"
              icon={<Icon.Clipboard size={14} />}
              onClick={() => toast({
                title: 'Inspection scheduled',
                sub: 'Added to Manoj Patil\u2019s queue — he\u2019ll pick it up on his next round (demo).',
                tone: 'success',
              })}
            >
              Start inspection
            </Button>
          </div>
        }
      />

      {/* ---- Identity header ---- */}
      <Card style={{ marginBottom: 'var(--s-5)' }}>
        <div className="u-inline" style={{ gap: 18, alignItems: 'center', flexWrap: 'wrap', padding: 'var(--s-4) var(--s-5)' }}>
          <HealthRing score={asset.health} size={72} />
          <div className="u-col" style={{ gap: 6, minWidth: 0, flex: 1 }}>
            <div className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
              <AssetTag id={asset.id} />
              <StatusDot status={asset.status} />
              <Badge tone="outline">{asset.criticality} criticality</Badge>
              {warrantyOut === false && <Badge tone="success" dot>Under warranty</Badge>}
              {warrantyOut === true && <Badge tone="neutral" dot>Warranty ended</Badge>}
            </div>
            <div className="u-inline u-small u-muted" style={{ gap: 6, flexWrap: 'wrap' }}>
              <Icon.Building size={13} />
              <span>{campusName} · {asset.building} · Floor {asset.floor} · {asset.room}</span>
            </div>
            <div className="u-inline u-small u-muted" style={{ gap: 14, flexWrap: 'wrap' }}>
              <span>Last service {asset.lastService ? fmtDateShort(asset.lastService) : '—'}</span>
              <span>Repair spend YTD <b className="u-mono">{fmtMoney(asset.repairSpendYTD)}</b></span>
              <span>{asset.failures.length} logged failure{asset.failures.length === 1 ? '' : 's'}</span>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        {/* ---- Health ---- */}
        <Card head="Health">
          <div className="u-small u-muted" style={{ marginBottom: 10 }}>Factor model — deterministic, recomputed from records</div>
          <div className="u-col" style={{ gap: 12 }}>
            <div className="u-inline" style={{ gap: 14, alignItems: 'center' }}>
              <HealthRing score={asset.health} size={56} />
              <div className="u-col" style={{ gap: 2 }}>
                <span style={{ fontWeight: 620 }}>{assetStatusLabel(asset.status)}</span>
                <span className="u-small u-muted">
                  {asset.health >= 80 ? 'Reliable — routine care only.'
                    : asset.health >= 60 ? 'Serviceable — watch the trend.'
                    : asset.health >= 40 ? 'Degrading — plan an intervention.'
                    : 'Unreliable — expect repeat failures.'}
                </span>
              </div>
            </div>
            {asset.healthFactors.length > 0 && <div className="divider" />}
            {asset.healthFactors.length === 0 && <Empty icon={<Icon.Check size={20} />} title="No negative factors" sub="Every tracked factor is currently neutral." />}
            {asset.healthFactors.map(f => (
              <div key={f.factor} className="u-col" style={{ gap: 3 }}>
                <div className="u-inline" style={{ justifyContent: 'space-between', fontSize: 'var(--text-sm)' }}>
                  <span style={{ fontWeight: 560 }}>{f.factor}</span>
                  <span className="u-mono u-small" style={{ color: 'var(--danger-text)', fontWeight: 600 }}>{f.impact}</span>
                </div>
                <div style={{ height: 4, borderRadius: 4, background: 'var(--surface-3)', overflow: 'hidden' }}>
                  <div style={{ width: `${(Math.abs(f.impact) / factorMax) * 100}%`, height: '100%', background: 'var(--danger)', borderRadius: 4 }} />
                </div>
                <span className="u-small u-muted">{f.note}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* ---- Identity ---- */}
        <Card head="Identity" sub="Register entry — purchase and warranty record">
          <KeyValue
            items={[
              { k: 'Manufacturer', v: asset.manufacturer },
              { k: 'Model', v: asset.model },
              {
                k: 'Installed on',
                v: (
                  <span className="u-inline" style={{ gap: 6 }}>
                    {fmtDate(asset.installedOn)}
                    <span className="u-small u-muted">· {ageYears.toFixed(1)} yrs old</span>
                  </span>
                ),
              },
              {
                k: 'Warranty until',
                v: asset.warrantyUntil ? (
                  <span className="u-inline" style={{ gap: 6 }}>
                    {fmtDate(asset.warrantyUntil)}
                    <Badge tone={warrantyOut ? 'neutral' : 'success'}>{warrantyOut ? 'Out of warranty' : 'In warranty'}</Badge>
                  </span>
                ) : <span className="u-muted">No warranty on record</span>,
              },
              { k: 'Purchase cost', v: <span className="u-mono">{fmtMoney(asset.purchaseCost)}</span> },
              { k: 'Expected life', v: asset.expectedLifeYears ? `${asset.expectedLifeYears} years` : <span className="u-muted">Not set</span> },
              {
                k: 'Manual / doc',
                v: asset.manualDoc ? (
                  <Link to="/documents" className="u-inline" style={{ gap: 5, color: 'var(--accent-text)', textDecoration: 'none' }}>
                    <Icon.Document size={13} /> {asset.manualDoc}
                  </Link>
                ) : <span className="u-muted">Not filed</span>,
              },
              { k: 'Location', v: `${asset.building} · Floor ${asset.floor} · ${asset.room}` },
            ]}
          />
        </Card>

        {/* ---- Failure history ---- */}
        <Card head="Failure history" sub={`${asset.failures.length} logged failure${asset.failures.length === 1 ? '' : 's'} · cost is parts + labour`}>
          {asset.failures.length === 0 ? (
            <Empty icon={<Icon.Check size={22} />} title="No failures on record" sub="A clean history — preventive visits only." />
          ) : (
            <Timeline
              items={[...asset.failures]
                .sort((a, b) => b.on.getTime() - a.on.getTime())
                .map(f => ({
                  time: fmtDate(f.on),
                  title: f.summary,
                  body: (
                    <span className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <span className="u-mono">{fmtMoney(f.cost)}</span>
                      {f.workOrderId && (
                        <Link to={`/maintenance/work-orders/${f.workOrderId}`} className="u-mono" style={{ color: 'var(--accent-text)', textDecoration: 'none' }}>
                          {f.workOrderId}
                        </Link>
                      )}
                    </span>
                  ),
                  dot: 'danger' as const,
                }))}
            />
          )}
        </Card>

        {/* ---- Work orders ---- */}
        <Card head="Work orders" sub="Every job raised against this asset — live list">
          <AssetWorkOrders assetId={asset.id} />
        </Card>

        {/* ---- Preventive plans ---- */}
        <Card head="Preventive plans" sub="Recurring schedules covering this asset">
          {plansQ.loading && <div className="u-col" style={{ gap: 8 }}><SkeletonCard lines={1} /><SkeletonCard lines={1} /></div>}
          {plansQ.error && <ErrorState sub={plansQ.error} onRetry={plansQ.retry} />}
          {plansQ.data && plansQ.data.length === 0 && (
            <Empty icon={<Icon.Calendar size={20} />} title="No preventive plan" sub="This asset is maintained reactively — consider adding a schedule." />
          )}
          {plansQ.data && plansQ.data.map(p => (
            <div key={p.id} className="u-col" style={{ gap: 4, marginBottom: 10 }}>
              <div className="u-inline" style={{ gap: 8, justifyContent: 'space-between' }}>
                <span className="u-inline" style={{ gap: 7 }}>
                  <span className="u-mono u-small u-muted">{p.id}</span>
                  <span style={{ fontWeight: 570, fontSize: 'var(--text-sm)' }}>{p.title}</span>
                </span>
                <Badge tone={p.compliance === 'overdue' ? 'danger' : p.compliance === 'due-soon' ? 'warning' : 'success'}>
                  {p.compliance === 'overdue' ? 'Overdue' : p.compliance === 'due-soon' ? 'Due soon' : 'On track'}
                </Badge>
              </div>
              <span className="u-small u-muted">{p.frequency} · owner {p.owner} · next due {fmtDateShort(p.nextDue)}</span>
            </div>
          ))}
        </Card>

        {/* ---- Replacement evaluation ---- */}
        <ReplacementCard asset={asset} view={replacementQ.data} loading={replacementQ.loading} error={replacementQ.error} onRetry={replacementQ.retry} />
      </div>

      {/* ---- QR modal ---- */}
      <Modal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        title={`Asset QR — ${asset.id}`}
        sub={`${asset.name} · ${asset.building} · ${asset.room}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setQrOpen(false)}>Close</Button>
            <Link to={`/maintenance/report?asset=${asset.id}`} className="btn btn-primary" style={{ textDecoration: 'none' }}>
              <Icon.Zap size={14} /> Report a problem
            </Link>
          </>
        }
      >
        <div className="u-col" style={{ gap: 12, alignItems: 'center' }}>
          <div style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 'var(--r-lg)' }}>
            <QRPattern seedText={asset.id} size={140} />
          </div>
          <p className="u-small u-muted" style={{ margin: 0, textAlign: 'center', lineHeight: 1.6 }}>
            Scan to report — opens the flow pre-identified with this asset, room and history.
          </p>
        </div>
      </Modal>
    </div>
  );
}

/* ---------- work orders for this asset (store-backed, live) ---------- */
function AssetWorkOrders({ assetId }: { assetId: string }) {
  const { domain } = useStore();
  const mine: WorkOrderRecord[] = domain.workOrders
    .filter(w => w.assetId === assetId)
    .sort((a, b) => b.reportedOn.getTime() - a.reportedOn.getTime());
  if (mine.length === 0) {
    return <Empty icon={<Icon.Wrench size={20} />} title="No work orders yet" sub="Nothing has been raised against this asset." />;
  }
  return (
    <div className="u-col" style={{ gap: 9 }}>
      {mine.map(wo => (
        <Link
          key={wo.id}
          to={`/maintenance/work-orders/${wo.id}`}
          className="u-col"
          style={{ gap: 4, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', textDecoration: 'none', color: 'inherit' }}
        >
          <span className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="u-mono u-small" style={{ fontWeight: 640, color: 'var(--text-3)' }}>{wo.id}</span>
            <WOStatusChip s={wo.status} />
            <PriorityBadge p={wo.priority} size="sm" />
          </span>
          <span style={{ fontWeight: 560, fontSize: 'var(--text-sm)' }}>{wo.title}</span>
          <span className="u-small u-muted">Reported {fmtRelative(wo.reportedOn)} · {wo.assignedTo ? `assigned to ${wo.assignedTo}` : 'unassigned'}</span>
        </Link>
      ))}
    </div>
  );
}

/* ---------- replacement evaluation (rule-based, honestly framed) ---------- */
function ReplacementCard({ asset, view, loading, error, onRetry }: {
  asset: AssetRecord; view: ReplacementView | null; loading: boolean; error: string | null; onRetry: () => void;
}) {
  if (loading) return <Card head="Replacement evaluation"><SkeletonCard /></Card>;
  if (error) return <Card head="Replacement evaluation"><ErrorState sub={error} onRetry={onRetry} /></Card>;
  if (!view) return null;
  return (
    <Card
      head="Replacement evaluation"
      sub="Rule-based evaluation from logged spend and failures — not a predictive model."
      style={view.trigger ? { borderColor: 'var(--danger-weak-2)' } : undefined}
    >
      <div className="u-col" style={{ gap: 12 }}>
        <div className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Badge tone={view.trigger ? 'warning' : 'neutral'}>
            <Icon.Scale size={11} /> {view.verdict}
          </Badge>
        </div>
        <p style={{ margin: 0, fontSize: 'var(--text-md)', lineHeight: 1.65 }}>{view.rationale}</p>
        <KeyValue
          cols={2}
          items={[
            { k: 'Age', v: <span className="u-mono">{view.ageYears} yrs</span> },
            { k: 'Logged failures', v: <span className="u-mono">{view.failureCount}</span> },
            { k: 'Repair spend YTD', v: <span className="u-mono">{fmtMoney(asset.repairSpendYTD)}</span> },
            { k: 'Est. replacement', v: <span className="u-mono">{fmtMoneyShort(view.estReplacement)}</span> },
          ]}
        />
      </div>
    </Card>
  );
}
