/* ============================================================
   MaintInventory — spare parts and consumables. What's in the
   stores, what's below threshold, what's already requested,
   and what each item costs to hold. Restock requests land
   locally (demo) and on the procurement desk.
   Inventory decrements automatically when technicians record
   parts on work orders — see maintenanceService.complete().
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../state/store';
import { DEMO_MODE } from '../lib/demoMode';
import { maintenanceService } from '../services';
import {
  PageHead, Section, Card, Stat, Badge, Button, Empty, ErrorState, SkeletonCard, KeyValue, Progress, Modal, useToast,
} from '../components/ui';
import { Sparkline } from '../components/Chart';
import { Icon } from '../components/Icon';
import { fmtMoney, fmtMoneyShort, fmtRelative } from '../lib/format';
import type { InventoryItem } from '../types/domain';

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

/* local demo overlay: restock requests raised from this screen */
type LocalRequest = { id: string; itemId: string; qty: number; on: Date };

export default function MaintInventory() {
  return DEMO_MODE ? <DemoMaintInventory /> : <LiveMaintInventory />;
}

/* LIVE: no server door yet — honest empty, no fiction (L4-2.2). */
function LiveMaintInventory() {
  return (
    <div>
      <PageHead
        title="Spare-parts inventory"
        sub="Stock levels, consumption and reorder points."
      />
      <Card pad>
        <Empty
          icon={<Icon.Offline size={24} />}
          title="Not connected yet"
          sub="There is no inventory door on the server yet (L4-2.2 note filed). The demo world shows the mock registry; a live school sees nothing here rather than invented stock numbers."
        />
      </Card>
    </div>
  );
}

/* DEMO: fixture data over the mock service (demo world only) */
function DemoMaintInventory() {
  const { session } = useStore();
  const toast = useToast();
  const scope: string = session.activeCampus;

  const stockQ = useAsync(() => maintenanceService.inventory(), []);

  const [restockItem, setRestockItem] = useState<InventoryItem | null>(null);
  const [restockQty, setRestockQty] = useState('');
  const [localRequests, setLocalRequests] = useState<LocalRequest[]>([]);

  const items: InventoryItem[] = useMemo(() => stockQ.data ?? [], [stockQ.data]);

  /* store names carry the campus ("North store", "Central store") —
     scope the list to the active campus plus the shared central store */
  const visible = useMemo(() => {
    if (scope === 'all') return items;
    const campusWord = scope === 'north' ? 'North' : scope === 'city' ? 'City' : 'East';
    return items.filter(i => i.store.includes(campusWord) || i.store === 'Central store');
  }, [items, scope]);

  const belowThreshold = useMemo(() => visible.filter(i => i.stock <= i.threshold), [visible]);
  const pendingCount = useMemo(
    () => visible.reduce((s, i) => s + (i.pendingRequests?.length ?? 0), 0) +
      localRequests.filter(r => visible.some(i => i.id === r.itemId)).length,
    [visible, localRequests],
  );
  const stockValue = useMemo(() => visible.reduce((s, i) => s + i.stock * i.unitCost, 0), [visible]);

  const submitRestock = () => {
    const item = restockItem;
    if (!item) return;
    const qty = Math.round(Number(restockQty));
    if (!Number.isFinite(qty) || qty <= 0) {
      toast({ title: 'Enter a quantity', sub: 'How many units should procurement order?', tone: 'error' });
      return;
    }
    setLocalRequests(prev => [{ id: `pr_${Date.now()}`, itemId: item.id, qty, on: new Date() }, ...prev]);
    setRestockItem(null);
    setRestockQty('');
    toast({
      title: 'Purchase request created',
      sub: `Procurement notified · ${qty} ${item.unit} of ${item.name} (demo).`,
      tone: 'success',
    });
  };

  const scopeLabel = scope === 'all'
    ? 'all stores'
    : scope === 'north' ? 'North + Central stores'
    : scope === 'city' ? 'City + Central stores'
    : 'East + Central stores';

  return (
    <div>
      <PageHead
        title="Inventory"
        sub={`Spare parts and consumables across ${scopeLabel} · stock vs reorder thresholds.`}
      />

      {/* ---- Stats ---- */}
      <div className="grid grid-4" style={{ marginBottom: 24 }}>
        <Stat label="SKUs tracked" value={visible.length} sub={`${new Set(visible.map(i => i.category)).size} categories`} />
        <Stat label="Below threshold" value={belowThreshold.length} sub="At or under reorder point" />
        <Stat label="Pending requests" value={pendingCount} sub="Awaiting procurement action" />
        <Stat label="Stock value" value={fmtMoneyShort(stockValue)} sub="On the shelf right now" />
      </div>

      {stockQ.loading && (
        <div className="grid grid-2"><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
      )}
      {stockQ.error && <ErrorState title="Could not load inventory" sub={stockQ.error} onRetry={stockQ.retry} />}

      {stockQ.data && (
        <>
          {/* ---- Item cards ---- */}
          <Section
            title="Stock on hand"
            sub="Ordered by urgency — lowest stock-to-threshold ratio first."
            actions={<Button size="sm" variant="ghost" icon={<Icon.Refresh size={13} />} onClick={stockQ.retry}>Reload</Button>}
          >
            <div className="u-col" style={{ gap: 10 }}>
              {visible.length === 0 && (
                <Card><Empty icon={<Icon.Grid size={22} />} title="No items in scope" sub="No inventory is tracked for this campus yet." /></Card>
              )}
              {[...visible]
                .sort((a, b) => a.stock / a.threshold - b.stock / b.threshold || a.name.localeCompare(b.name))
                .map(item => {
                  const low = item.stock <= item.threshold;
                  const pct = item.threshold > 0 ? (item.stock / item.threshold) * 100 : 100;
                  const locals = localRequests.filter(r => r.itemId === item.id);
                  const seedReqs = item.pendingRequests ?? [];
                  return (
                    <Card key={item.id} style={low ? { borderColor: 'var(--danger-weak-2)' } : undefined}>
                      <div className="u-col" style={{ gap: 10 }}>
                        <div className="u-inline" style={{ gap: 10, justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                          <div className="u-col" style={{ gap: 3, minWidth: 0 }}>
                            <span className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: 620 }}>{item.name}</span>
                              <Badge tone="outline">{item.category}</Badge>
                              {low && <Badge tone="danger" dot>Below threshold</Badge>}
                            </span>
                            <span className="u-small u-muted">{item.store} · {fmtMoney(item.unitCost)} / {item.unit}</span>
                          </div>
                          <div className="u-inline" style={{ gap: 12, alignItems: 'center' }}>
                            <span className="u-inline u-small u-muted" style={{ gap: 5 }}>
                              <Icon.TrendDown size={13} /> {item.consumed30d} {item.unit} used · 30d
                            </span>
                            <Sparkline points={item.consumptionTrend} width={72} height={22} color={low ? 'var(--danger)' : 'var(--accent)'} />
                            {!low && <Badge tone="success">{item.stock} in stock</Badge>}
                          </div>
                        </div>

                        <div className="u-col" style={{ gap: 4 }}>
                          <div className="u-inline u-between">
                            <span className="u-small u-muted">Stock vs threshold</span>
                            <span className="u-mono u-small" style={{ color: low ? 'var(--danger-text)' : 'var(--text-2)', fontWeight: low ? 620 : 480 }}>
                              {item.stock} / {item.threshold} {item.unit}
                            </span>
                          </div>
                          <Progress value={pct} tone={low ? 'danger' : undefined} />
                        </div>

                        <div className="u-inline u-small u-muted" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                          <span>Used by:</span>
                          {item.linkedCategories.map(c => <Badge key={c} tone="outline">{c}</Badge>)}
                        </div>

                        {/* pending requests — service data + locally raised ones */}
                        {(seedReqs.length > 0 || locals.length > 0) && (
                          <div className="u-col" style={{ gap: 6, padding: '9px 12px', border: '1px solid var(--warning-weak-2)', borderRadius: 'var(--r-md)', background: 'var(--surface-3)' }}>
                            <span className="u-upper u-xs" style={{ fontWeight: 620, color: 'var(--text-2)' }}>Pending requests</span>
                            {seedReqs.map((pr, i) => (
                              <span key={`seed_${i}`} className="u-inline u-small" style={{ gap: 8, flexWrap: 'wrap' }}>
                                <Icon.Clock size={12} />
                                <span><b className="u-mono">{pr.qty} {item.unit}</b> requested {fmtRelative(pr.on)}</span>
                                {pr.forWo && (
                                  <Link to={`/maintenance/work-orders/${pr.forWo}`} className="u-mono" style={{ color: 'var(--accent-text)', textDecoration: 'none' }}>
                                    {pr.forWo}
                                  </Link>
                                )}
                              </span>
                            ))}
                            {locals.map(r => (
                              <span key={r.id} className="u-inline u-small" style={{ gap: 8 }}>
                                <Icon.Check size={12} />
                                <span><b className="u-mono">{r.qty} {item.unit}</b> requested just now — procurement notified</span>
                              </span>
                            ))}
                          </div>
                        )}

                        {low && (
                          <div>
                            <Button
                              variant="secondary"
                              size="sm"
                              icon={<Icon.Plus size={13} />}
                              onClick={() => { setRestockItem(item); setRestockQty(String(item.threshold * 2)); }}
                            >
                              Restock
                            </Button>
                          </div>
                        )}
                      </div>
                    </Card>
                  );
                })}
            </div>
          </Section>

          <Card pad style={{ marginTop: 18 }}>
            <div className="u-inline" style={{ gap: 10, alignItems: 'flex-start' }}>
              <Icon.Info size={14} style={{ color: 'var(--text-3)', marginTop: 2 }} />
              <span className="u-small u-muted" style={{ lineHeight: 1.6 }}>
                Inventory decrements automatically when technicians record parts on work orders — no separate stock entry.
                Thresholds are per store; consumption trends cover the last five reporting windows.
              </span>
            </div>
          </Card>
        </>
      )}

      {/* ---- Restock modal ---- */}
      <Modal
        open={!!restockItem}
        onClose={() => setRestockItem(null)}
        title="Restock request"
        sub={restockItem ? `${restockItem.name} · ${restockItem.store}` : ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRestockItem(null)}>Cancel</Button>
            <Button variant="primary" icon={<Icon.Send size={14} />} onClick={submitRestock}>Create purchase request</Button>
          </>
        }
      >
        {restockItem && (
          <div className="u-col" style={{ gap: 14 }}>
            <KeyValue
              cols={2}
              items={[
                { k: 'Current stock', v: <span className="u-mono">{restockItem.stock} {restockItem.unit}</span> },
                { k: 'Threshold', v: <span className="u-mono">{restockItem.threshold} {restockItem.unit}</span> },
                { k: 'Used last 30d', v: <span className="u-mono">{restockItem.consumed30d} {restockItem.unit}</span> },
                { k: 'Unit cost', v: <span className="u-mono">{fmtMoney(restockItem.unitCost)}</span> },
              ]}
            />
            <div>
              <label htmlFor="restock-qty" className="u-upper" style={{ display: 'block', marginBottom: 6 }}>
                Order quantity ({restockItem.unit})
              </label>
              <input
                id="restock-qty"
                className="input"
                type="number"
                min={1}
                value={restockQty}
                onChange={e => setRestockQty(e.target.value)}
                style={{ width: '100%' }}
                              />
              <span className="u-small u-muted" style={{ display: 'block', marginTop: 6 }}>
                Suggested: 2× threshold ({restockItem.threshold * 2} {restockItem.unit}) · est. {fmtMoney(restockItem.threshold * 2 * restockItem.unitCost)}
              </span>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
