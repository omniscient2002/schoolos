/* ============================================================
   MaintVendors — who does the work we can't do in-house.
   Contract status, SLA performance, spend and ratings per
   vendor, an expiry watch naming the contracts that need
   review, and the work orders currently escalated to vendor
   partners. Every figure on the callout is computed from the
   records below it.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../state/store';
import { maintenanceService } from '../services';
import * as m from '../data/dataset';
import {
  PageHead, Section, Card, Stat, Badge, Empty, ErrorState, SkeletonCard, KeyValue, Progress, Drawer,
} from '../components/ui';
import { Icon } from '../components/Icon';
import { WOStatusChip, PriorityBadge } from '../components/Maint';
import { fmtDate, fmtDateShort, fmtDuration, fmtMoneyShort } from '../lib/format';
import type { VendorRecord } from '../types/domain';

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

/* asset category for a work order / plan / inspection reference (register lookup) */
const catOf = (assetId?: string) => (assetId ? m.assetById(assetId)?.category ?? '' : '');

function Stars({ rating, size = 13 }: { rating: number; size?: number }) {
  const filled = Math.round(rating);
  return (
    <span className="u-inline" style={{ gap: 2 }} role="img" aria-label={`Rated ${rating.toFixed(1)} of 5`}>
      {[0, 1, 2, 3, 4].map(i => (
        <Icon.Star key={i} size={size} style={{ color: i < filled ? 'var(--chart-amber)' : 'var(--border)' }} />
      ))}
    </span>
  );
}

export default function MaintVendors() {
  const { domain } = useStore();
  const vendorsQ = useAsync(() => maintenanceService.vendors(), []);
  const [selected, setSelected] = useState<VendorRecord | null>(null);

  const vendors = useMemo(() => vendorsQ.data ?? [], [vendorsQ.data]);
  const now = Date.now();
  const isExpired = (v: VendorRecord) => !!v.contractUntil && v.contractUntil.getTime() < now;
  const expired = useMemo(() => vendors.filter(isExpired), [vendors]); // eslint-disable-line react-hooks/exhaustive-deps
  const vendorWorkOrders = useMemo(() => domain.workOrders.filter(w => w.escalation === 'vendor'), [domain.workOrders]);

  /* contract-expiry watch — jobs & visits touching the vendor's trade, computed from records */
  const linkedJobsAndVisits = (v: VendorRecord) => {
    const cats = new Set(v.categories);
    const wos = domain.workOrders.filter(w => cats.has(w.category) || cats.has(catOf(w.assetId))).length;
    const insp = m.inspections.filter(i => cats.has(catOf(i.assetId))).length;
    const plans = m.maintPlans.filter(p => p.assetIds.some(aid => cats.has(catOf(aid)))).length;
    return wos + insp + plans;
  };

  const totalSpend = vendors.reduce((s, v) => s + v.spendYTD, 0);
  const avgSla = vendors.length ? Math.round(vendors.reduce((s, v) => s + v.slaPct, 0) / vendors.length) : 0;

  return (
    <div>
      <PageHead
        title="Vendors"
        sub="Empanelled service partners · contracts, SLA performance, spend and ratings."
      />

      {vendorsQ.loading && <div className="grid grid-2"><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>}
      {vendorsQ.error && <ErrorState title="Could not load vendors" sub={vendorsQ.error} onRetry={vendorsQ.retry} />}

      {vendorsQ.data && (
        <>
          {/* ---- Contract review callout (computed from expired contracts) ---- */}
          {expired.length > 0 && (
            <Card pad style={{ marginBottom: 24, background: 'var(--danger-weak)', borderColor: 'var(--danger-weak-2)' }}>
              <div className="u-col" style={{ gap: 8 }}>
                <span className="u-inline" style={{ gap: 8, fontWeight: 640, color: 'var(--danger-text)' }}>
                  <Icon.Alert size={15} /> Contract review needed
                </span>
                {expired.map(v => (
                  <span key={v.id} className="u-small" style={{ lineHeight: 1.6 }}>
                    {v.name} — expired{' '}
                    {Math.max(0, Math.round((now - (v.contractUntil?.getTime() ?? now)) / 86400000))} day
                    {Math.round((now - (v.contractUntil?.getTime() ?? now)) / 86400000) === 1 ? '' : 's'} ago ·{' '}
                    {v.slaPct}% on-time · {linkedJobsAndVisits(v)}{' '}
                    {v.categories.map(c => c.toLowerCase()).join(' & ')} jobs & visits on record. Renegotiate or
                    re-empanel before the next dispatch — a lapsed contract no longer binds response times.
                  </span>
                ))}
              </div>
            </Card>
          )}

          {/* ---- Stats ---- */}
          <div className="grid grid-4" style={{ marginBottom: 24 }}>
            <Stat label="Vendors on panel" value={vendors.length} sub={`${vendors.filter(v => v.empanelled).length} empanelled`} />
            <Stat label="Avg on-time SLA" value={`${avgSla}%`} sub="Across all contracts" />
            <Stat label="Spend YTD" value={fmtMoneyShort(totalSpend)} sub="All vendors · this year" />
            <Stat label="Contracts expired" value={expired.length} sub="Review before next dispatch" />
          </div>

          {/* ---- Vendor cards ---- */}
          <Section
            title="Empanelment"
            sub="Tap a vendor for the performance record behind these numbers."
            actions={
              <span className="u-small u-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Icon.Shield size={13} /> Group-held contracts
              </span>
            }
          >
            <div className="grid grid-2" style={{ alignItems: 'stretch' }}>
              {vendors.map(v => {
                const exp = isExpired(v);
                return (
                  <Card key={v.id} onClick={() => setSelected(v)} style={exp ? { borderColor: 'var(--danger-weak-2)' } : undefined}>
                    <div className="u-col" style={{ gap: 9, padding: 'var(--s-4)' }}>
                      <div className="u-inline u-between" style={{ gap: 10, flexWrap: 'wrap' }}>
                        <span className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 620 }}>{v.name}</span>
                          <Badge tone={v.empanelled ? 'success' : 'neutral'} dot>{v.empanelled ? 'Empanelled' : 'Not empanelled'}</Badge>
                        </span>
                        {exp && <Badge tone="danger">Expired</Badge>}
                      </div>

                      <div className="u-inline" style={{ gap: 6, flexWrap: 'wrap' }}>
                        {v.categories.map(c => <Badge key={c} tone="outline">{c}</Badge>)}
                      </div>

                      <div className="u-col" style={{ gap: 4 }}>
                        <div className="u-inline u-between u-small">
                          <span>On-time SLA</span>
                          <span className="u-mono" style={{ fontWeight: 620, color: v.slaPct < 90 ? 'var(--danger-text)' : 'var(--text-1)' }}>{v.slaPct}%</span>
                        </div>
                        <Progress value={v.slaPct} tone={v.slaPct < 90 ? 'danger' : v.slaPct < 95 ? 'warn' : undefined} />
                      </div>

                      <div className="u-inline u-small u-muted" style={{ gap: 12, flexWrap: 'wrap' }}>
                        <span>Responds in <b className="u-mono">{fmtDuration(v.avgResponseMins)}</b></span>
                        <span><b className="u-mono">{v.jobsYTD}</b> jobs YTD</span>
                        <span><b className="u-mono">{fmtMoneyShort(v.spendYTD)}</b> spend YTD</span>
                      </div>

                      <div className="u-inline u-between" style={{ gap: 8 }}>
                        <Stars rating={v.rating} />
                        <span className="u-small u-muted">
                          <span className="u-mono">{v.rating.toFixed(1)}</span>
                          {v.contractUntil ? <> · contract until {fmtDateShort(v.contractUntil)}</> : ' · no contract on record'}
                        </span>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </Section>

          {/* ---- Vendor-linked work orders ---- */}
          <Section
            title="Vendor-linked work orders"
            sub="Jobs escalated to vendor partners — in-house skills or SLA shortfall."
            style={{ marginTop: 'var(--s-5)' }}
          >
            <Card>
              {vendorWorkOrders.length === 0 ? (
                <Empty
                  icon={<Icon.ExternalLink size={22} />}
                  title="No vendor escalations right now"
                  sub="When a job is escalated from its work-order page, it appears here until the vendor closes it."
                />
              ) : (
                <div className="u-col" style={{ gap: 9 }}>
                  {vendorWorkOrders.map(wo => (
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
                    </Link>
                  ))}
                </div>
              )}
            </Card>
          </Section>
        </>
      )}

      {/* ---- Vendor drawer ---- */}
      <Drawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name ?? ''}
        sub={selected ? `${selected.categories.join(' · ')} · ${selected.empanelled ? 'empanelled' : 'not empanelled'}` : ''}
      >
        {selected && (
          <div className="u-col" style={{ gap: 16 }}>
            <KeyValue
              cols={2}
              items={[
                { k: 'On-time SLA', v: <span className="u-mono">{selected.slaPct}%</span> },
                { k: 'Avg response', v: <span className="u-mono">{fmtDuration(selected.avgResponseMins)}</span> },
                { k: 'Jobs YTD', v: <span className="u-mono">{selected.jobsYTD}</span> },
                { k: 'Spend YTD', v: <span className="u-mono">{fmtMoneyShort(selected.spendYTD)}</span> },
                {
                  k: 'Contract until',
                  v: selected.contractUntil ? (
                    <span className="u-inline" style={{ gap: 6 }}>
                      <span className="u-mono">{fmtDate(selected.contractUntil)}</span>
                      {isExpired(selected) ? <Badge tone="danger">Expired</Badge> : <Badge tone="success">Active</Badge>}
                    </span>
                  ) : <span className="u-muted">No contract on record</span>,
                },
                {
                  k: 'Rating',
                  v: (
                    <span className="u-inline" style={{ gap: 6 }}>
                      <Stars rating={selected.rating} size={12} />
                      <span className="u-mono u-small u-muted">{selected.rating.toFixed(1)}</span>
                    </span>
                  ),
                },
              ]}
            />
            <div>
              <div className="u-upper u-xs" style={{ fontWeight: 620, marginBottom: 6 }}>Trade categories</div>
              <div className="u-inline" style={{ gap: 6, flexWrap: 'wrap' }}>
                {selected.categories.map(c => <Badge key={c} tone="outline">{c}</Badge>)}
              </div>
            </div>
            <p className="u-small u-muted" style={{ margin: 0, lineHeight: 1.6 }}>
              SLA% is the share of vendor jobs completed inside their contracted window this year; response time averages
              dispatch to on-site. Rating averages every reporter rating on completed jobs. Contracts are held at group
              level, so figures cover all campuses.
            </p>
          </div>
        )}
      </Drawer>
    </div>
  );
}
