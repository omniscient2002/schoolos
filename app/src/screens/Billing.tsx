/* ============================================================
   Billing — the school's own plan with SchoolOS.

   What this proves: what the school pays for, what it uses, and
   what changes on upgrade — quoted from the server, never estimated.

   Doors: GET /billing (owner), POST /billing/checkout (owner).
   When the payment gateway is unconfigured the checkout door
   answers 503 with operator guidance — shown honestly, with no
   order faked. The plan never changes and no money moves.
   ============================================================ */
import { useEffect, useState } from 'react';
import { Badge, Button, Card, DataTable, Empty, ErrorState, PageHead, Section, SkeletonCard, Stat, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { useRoleOrGrant } from '../lib/access';
import { friendly } from '../lib/friendlyErrors';
import { fmtMoney } from '../lib/format';
import { billingCheckout, billingGet, type BillingUsage } from '../services/complianceApi';

function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: unknown }>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState(s => ({ ...s, loading: true, error: null }));
    fn().then(d => { if (live) setState({ data: d, loading: false, error: null }); })
      .catch(e => { if (live) setState({ data: null, loading: false, error: e }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, retry: () => setTick(t => t + 1) };
}

export default function Billing() {
  const toast = useToast();
  const canRead = useRoleOrGrant(['owner'], ['GET /billing']);

  const billing = useAsync(() => billingGet(), []);
  const [plan, setPlan] = useState('');
  const [busy, setBusy] = useState(false);
  const [gatewayDown, setGatewayDown] = useState<string | null>(null);
  const [order, setOrder] = useState<{ id: string; amount_cents: number } | null>(null);

  if (!canRead) {
    return (
      <Card>
        <Empty icon={<Icon.File size={24} />} title="Billing is the owner's page"
          sub="Only the school owner sees the plan, the usage and the checkout." />
      </Card>
    );
  }

  const usage = billing.data?.usage ?? [];

  const checkout = async () => {
    if (!plan.trim()) { toast({ title: 'Name the plan to move to', sub: 'The upgrade note below says which plan fits.', tone: 'info' }); return; }
    setBusy(true);
    setGatewayDown(null);
    try {
      const r = await billingCheckout(plan.trim());
      setOrder(r.order);
      toast({ title: `Order raised — ${r.order.id}`, sub: `${fmtMoney(r.order.amount_cents / 100)} due. Pay it to complete the move.`, tone: 'success' });
    } catch (e) {
      /* 503 + guidance means the gateway was never configured: an honest
         operator state, not a failure to retry. The plan is unchanged and
         no money moved — the screen says exactly that. */
      const err = e as Error & { status?: number; payload?: { guidance?: string } };
      if (err.status === 503) {
        setGatewayDown(err.payload?.guidance ?? friendly(e));
      }
      toast({ title: friendly(e), tone: 'error' });
    }
    finally { setBusy(false); }
  };

  return (
    <div>
      <PageHead
        title="Billing & plan"
        sub="What this proves: what the school pays for, what it uses, and what changes on upgrade — quoted from the server, never estimated."
      />

      {billing.loading ? (
        <div className="grid grid-3"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
      ) : billing.error ? (
        <ErrorState title="Could not read billing" sub={friendly(billing.error)} onRetry={billing.retry} />
      ) : (
        <>
          <div className="grid grid-3" style={{ marginBottom: 20 }}>
            <Stat label="Current plan" value={billing.data?.plan ?? '—'} sub="Quoted from the server" />
            <Stat label="Meters tracked" value={usage.length} sub="Usage against allowance" />
            <Stat label="At limit" value={usage.filter(u => u.limit != null && u.count >= u.limit).length} sub="Meters needing the upgrade" />
          </div>

          <Section title="Usage against the plan" sub="Live counts from the school's own records, beside what the plan allows.">
            <Card pad={false}>
              <DataTable<BillingUsage>
                columns={[
                  { key: 'label', label: 'Meter', render: u => <span style={{ fontWeight: 570 }}>{u.label}</span> },
                  { key: 'used', label: 'Used', align: 'right', render: u => <span className="tnum">{u.count}</span> },
                  { key: 'limit', label: 'Allowed', align: 'right', render: u => (
                    <span className="tnum">{u.limit == null ? 'unlimited' : u.limit}</span>
                  ) },
                  { key: 'state', label: 'State', width: 130, render: u => u.limit == null || u.count < u.limit
                    ? <Badge tone="success">within plan</Badge>
                    : <Badge tone="warning">at limit</Badge> },
                ]}
                rows={usage}
                rowKey={u => u.key}
                empty={<Empty title="No usage counted yet" sub="Meters appear here once the school starts using the features the plan covers." />}
              />
            </Card>
          </Section>

          <Section title="Change plan" sub={billing.data?.upgrade?.note ?? 'The server says when a move is worth it.'}>
            <Card pad>
              {gatewayDown ? (
                <div role="alert">
                  <div style={{ fontWeight: 620, marginBottom: 6 }}>Online checkout is not switched on</div>
                  <p className="u-small u-muted" style={{ margin: '0 0 12px' }}>
                    {gatewayDown} Your plan has not changed and no money has moved.
                    To pay online, the owner adds the payment keys first — or settle at the office as usual.
                  </p>
                  <Button variant="secondary" icon={<Icon.Refresh size={14} />} onClick={() => setGatewayDown(null)}>Try a different plan</Button>
                </div>
              ) : order ? (
                <div role="status">
                  <div style={{ fontWeight: 620, marginBottom: 6 }}>Order {order.id} is raised</div>
                  <p className="u-small u-muted" style={{ margin: '0 0 12px' }}>
                    {fmtMoney(order.amount_cents / 100)} due. The move completes when this order is paid —
                    until then the school stays on {billing.data?.plan}.
                  </p>
                  <Button variant="secondary" onClick={() => { setOrder(null); billing.retry(); }}>Back to usage</Button>
                </div>
              ) : (
                <div className="u-flex u-gap-2 u-wrap" style={{ alignItems: 'flex-end' }}>
                  <label className="u-small">New plan
                    <input className="input" value={plan} onChange={e => setPlan(e.target.value)} placeholder="Plan code from the upgrade note" style={{ display: 'block', marginTop: 4, minWidth: 220 }} />
                  </label>
                  <Button variant="primary" disabled={busy || !plan.trim()} onClick={checkout}>
                    {busy ? 'Raising order…' : 'Start checkout'}
                  </Button>
                  <span className="u-xs u-faint">Checkout only raises the order — the plan changes when it is paid.</span>
                </div>
              )}
            </Card>
          </Section>
        </>
      )}
    </div>
  );
}
