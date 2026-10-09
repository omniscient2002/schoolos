/* LibraryInsights — the owner/principal operations dashboard (aggregates only; no borrower identity).
   Server truth: GET /plugins/library/ops/overview. Also readable by the librarian. */
import { useEffect, useState } from 'react';
import { PageHead, Card, Badge, Button, ErrorState, SkeletonCard } from '../../components/ui';
import { friendly } from '../../lib/friendlyErrors';
import { pluginLabel } from '../../lib/labels';
import { libraryOps } from '../../services/adminApi';

const inr = (c: number) => `₹${(c / 100).toFixed(2)}`;

export default function LibraryInsights() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Awaited<ReturnType<typeof libraryOps>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let dead = false;
    setError(null);
    libraryOps(days).then((r) => { if (!dead) setData(r); }).catch((e) => { if (!dead) setError(friendly(e)); });
    return () => { dead = true; };
  }, [days, tick]);

  if (error) return <div style={{ maxWidth: 1080, margin: '0 auto' }}><ErrorState title="Could not load" sub={error.replace('Error: ', '')} onRetry={() => setTick(t => t + 1)} /></div>;
  if (!data) return <div style={{ maxWidth: 1080, margin: '0 auto' }}><SkeletonCard /></div>;

  const t = data.totals;
  const maxTrend = Math.max(1, ...data.trend.map((x) => x.loans));
  const maxTop = Math.max(1, ...data.topTitles.map((x) => x.loans));

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto' }}>
      <PageHead title="Library — operations" sub="Circulation, collection and demand at a glance (aggregates only)" actions={<Badge tone="accent" dot>{pluginLabel('library')}</Badge>} />
      <div style={{ display: 'flex', gap: 6, marginBottom: 'var(--s-4)' }}>
        {[7, 30, 90, 365].map((d) => <Button key={d} variant={days === d ? 'primary' : 'secondary'} onClick={() => setDays(d)}>{d === 365 ? '1y' : `${d}d`}</Button>)}
      </div>

      <div style={{ display: 'grid', gap: 'var(--s-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: 'var(--s-4)' }}>
        {[
          ['On loan', t.onLoan], ['Overdue', t.overdue], ['Available', `${t.available}/${t.copies}`],
          ['Collection in use', `${t.utilizationPct}%`], ['Loans this period', t.loansPeriod], ['Titles', t.titles],
        ].map(([label, value]) => (
          <Card key={String(label)}><div className="u-xs u-muted">{label}</div><div style={{ fontSize: 22, fontWeight: 800 }}>{value}</div></Card>
        ))}
      </div>

      <div style={{ display: 'grid', gap: 'var(--s-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <Card headAs="h2" head="Loans per day">
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 90 }}>
            {data.trend.map((x) => (
              <div key={x.day} title={`${x.day}: ${x.loans}`} style={{ flex: 1, height: `${Math.round((x.loans / maxTrend) * 100)}%`, minHeight: 2, background: 'var(--accent)', borderRadius: 2 }} />
            ))}
          </div>
        </Card>

        <Card headAs="h2" head="Most borrowed">
          {data.topTitles.length ? data.topTitles.map((x) => (
            <div key={x.title} style={{ marginBottom: 8 }}>
              <div className="u-between"><span style={{ fontSize: 13 }}>{x.title}</span><span className="u-xs u-muted">{x.loans}</span></div>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-2)' }}><div style={{ width: `${Math.round((x.loans / maxTop) * 100)}%`, height: '100%', borderRadius: 3, background: 'var(--accent)' }} /></div>
            </div>
          )) : <div className="u-muted">No loans in this period.</div>}
        </Card>

        <Card headAs="h2" head="Overdue aging">
          {data.overdueAging.length ? data.overdueAging.map((x) => (
            <div key={x.bucket} className="u-between" style={{ padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}><span>{x.bucket} days</span><b>{x.n}</b></div>
          )) : <div className="u-muted">Nothing overdue.</div>}
        </Card>

        <Card headAs="h2" head="Demand and collection">
          <div className="u-between" style={{ padding: '6px 0' }}><span>Reservations waiting</span><b>{data.holds?.waiting ?? 0}</b></div>
          <div className="u-between" style={{ padding: '6px 0' }}><span>Holds ready</span><b>{data.holds?.ready ?? 0}</b></div>
          <div className="u-between" style={{ padding: '6px 0' }}><span>Open purchase requests</span><b>{data.acquisition?.open_requests ?? 0}</b></div>
          <div className="u-between" style={{ padding: '6px 0' }}><span>Votes on requests</span><b>{data.acquisition?.votes ?? 0}</b></div>
          <div className="u-between" style={{ padding: '6px 0' }}><span>Lost / damaged / withdrawn</span><b>{(data.collectionHealth?.lost ?? 0)} / {(data.collectionHealth?.damaged ?? 0)} / {(data.collectionHealth?.withdrawn ?? 0)}</b></div>
        </Card>

        <Card headAs="h2" head="Fines">
          <div className="u-between" style={{ padding: '6px 0' }}><span>Outstanding</span><b>{inr(t.fines.outstanding)}</b></div>
          <div className="u-between" style={{ padding: '6px 0' }}><span>Collected</span><b>{inr(t.fines.collected)}</b></div>
          <div className="u-between" style={{ padding: '6px 0' }}><span>Waived</span><b>{inr(t.fines.waived)}</b></div>
        </Card>

        <Card headAs="h2" head="Reach and value">
          <div className="u-between" style={{ padding: '6px 0' }}><span>Reader penetration</span><b>{t.readerPenetrationPct}%</b></div>
          <div className="u-between" style={{ padding: '6px 0' }}><span>Dead stock (no loans 180d)</span><b>{t.deadStock}</b></div>
          <div className="u-between" style={{ padding: '6px 0' }}><span>Collection value</span><b>{inr(t.collectionValueCents)}</b></div>
          <div className="u-between" style={{ padding: '6px 0' }}><span>Cost per circulation</span><b>{inr(t.costPerCirculationCents)}</b></div>
        </Card>
      </div>
    </div>
  );
}
