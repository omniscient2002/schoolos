/* Desk dashboard — the librarian's first screen: circulation at a glance, what needs attention today,
   quick actions, and the latest activity. Server truth: GET /plugins/library/desk/overview. */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Button, Badge, ErrorState, SkeletonCard, Empty } from '../../../components/ui';
import { DeskIcon as Icon } from './shared';
import { friendly } from '../../../lib/friendlyErrors';
import { statusLabel } from '../../../lib/labels';
import { libraryDeskOverview, type LibraryDeskOverview } from '../../../services/adminApi';
import { inr, Kpi, fmtDate } from './shared';

export default function Dashboard() {
  const nav = useNavigate();
  const [data, setData] = useState<LibraryDeskOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let dead = false; setError(null);
    libraryDeskOverview().then((r) => { if (!dead) setData(r); }).catch((e) => { if (!dead) setError(friendly(e)); });
    return () => { dead = true; };
  }, [tick]);

  if (error) return <ErrorState title="Could not load the desk" sub={error.replace('Error: ', '')} onRetry={() => setTick((t) => t + 1)} />;
  if (!data) return <SkeletonCard />;

  const allNeeds: Array<{ n: number; label: string; to: string; tone: 'success' | 'danger' | 'warning' }> = [
    { n: data.holdsReady, label: 'holds ready to collect', to: '/library/desk/holds', tone: 'success' },
    { n: data.overdue, label: 'books overdue', to: '/library/desk/return', tone: 'danger' },
    { n: data.purchaseRequests, label: 'purchase requests waiting', to: '/library/desk/requests', tone: 'warning' },
    { n: data.unavailable, label: 'copies lost / damaged / withdrawn', to: '/library/desk/catalog', tone: 'warning' },
  ];
  const needs = allNeeds.filter((x) => x.n > 0);

  return (
    <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
      <div style={{ display: 'grid', gap: 'var(--s-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        <Kpi label="On loan" value={data.onLoan} sub={`${data.available} of ${data.copies} on the shelf`} />
        <Kpi label="Overdue" value={data.overdue} tone={data.overdue ? 'danger' : undefined} onClick={() => nav('/library/desk/return')} />
        <Kpi label="Holds ready" value={data.holdsReady} sub={`${data.holdsWaiting} waiting in queue`} tone={data.holdsReady ? 'success' : undefined} onClick={() => nav('/library/desk/holds')} />
        <Kpi label="Issued today" value={data.issuedToday} sub={`${data.returnedToday} returned`} />
        <Kpi label="Fines outstanding" value={inr(data.outstandingCents)} sub={`${inr(data.collectedCents)} collected`} tone={data.outstandingCents ? 'warn' : undefined} onClick={() => nav('/library/desk/fines')} />
        <Kpi label="Members" value={data.members.students + data.members.staff} sub={`${data.members.students} students · ${data.members.staff} staff`} />
      </div>

      <div style={{ display: 'grid', gap: 'var(--s-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <Card headAs="h2" head="Quick actions">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="primary" onClick={() => nav('/library/desk/issue')}><Icon name="ArrowRight" size={15} /> Issue a book</Button>
            <Button onClick={() => nav('/library/desk/return')}><Icon name="Refresh" size={15} /> Return a book</Button>
            <Button onClick={() => nav('/library/desk/catalog/new')}><Icon name="Plus" size={15} /> Add a book</Button>
            <Button onClick={() => nav('/library/desk/members')}><Icon name="Users" size={15} /> Members</Button>
            <Button onClick={() => nav('/library/desk/settings')}><Icon name="Settings" size={15} /> Settings</Button>
          </div>
        </Card>

        <Card headAs="h2" head="Needs you" sub="Nothing here is a count you have to go looking for">
          {needs.length ? (
            <div style={{ display: 'grid', gap: 6 }}>
              {needs.map((x) => (
                <button key={x.label} type="button" onClick={() => nav(x.to)} className="row-action">
                  <span>{x.label}</span>
                  <Badge tone={x.tone}>{x.n}</Badge>
                </button>
              ))}
            </div>
          ) : <Empty title="All clear" sub="No holds waiting, nothing overdue, no open requests." />}
        </Card>
      </div>

      <Card headAs="h2" head="Recent activity" actions={<Button variant="ghost" onClick={() => setTick((t) => t + 1)}><Icon name="Refresh" size={14} /> Refresh</Button>}>
        {data.recent.length ? (
          <div style={{ display: 'grid', gap: 0 }}>
            {data.recent.map((r) => (
              <div key={r.id} className="u-between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 13 }}>
                <span>
                  <Badge tone={r.status === 'issued' ? 'info' : r.status === 'lost' ? 'danger' : 'success'}>{statusLabel(r.status)}</Badge>
                  <span style={{ marginLeft: 8 }}><b>{r.book_title}</b> <span className="u-muted">({r.book_code})</span></span>
                </span>
                <span className="u-muted">
                  {r.borrower ?? '—'} · {r.status === 'issued' ? `due ${fmtDate(r.due_on)}` : `returned ${r.returned_at ? fmtDate(r.returned_at) : ''}`}
                  {r.fine_cents ? ` · ${inr(r.fine_cents)}` : ''}
                </span>
              </div>
            ))}
          </div>
        ) : <Empty title="No circulation yet" sub="Issued and returned books will show here." />}
      </Card>
    </div>
  );
}
