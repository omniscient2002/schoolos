/* Transport — the child's bus route (PRD-5 tail). Door: GET /parent/child/:id/transport.
   No live vehicle position is published to families; the screen says so. */
import { useEffect, useState } from 'react';
import { Card, Empty, ErrorState, SkeletonCard } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { friendly } from '../../../lib/friendlyErrors';
import { getTransport, type ParentTransportData } from '../../../services/parentApi';

export default function Transport({ childId }: { childId: string }) {
  const [data, setData] = useState<ParentTransportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    getTransport(childId)
      .then(d => { if (alive) setData(d); })
      .catch(e => { if (alive) setError(friendly(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [childId, tick]);

  if (loading) return <SkeletonCard lines={4} />;
  if (error) return <ErrorState title="Transport did not load" sub={error} onRetry={() => setTick(t => t + 1)} />;
  if (!data) return null;
  if (!data.route && !data.route_code) {
    return <Empty icon={<Icon.Bus size={22} />} title="No bus route yet" sub={data.note} />;
  }
  return (
    <Card pad>
      <div className="u-flex" style={{ gap: 10, alignItems: 'center' }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--surface-3)', display: 'grid', placeItems: 'center' }}>
          <Icon.Bus size={17} />
        </span>
        <div>
          <div style={{ fontWeight: 620 }}>{data.route?.name ?? `Route ${data.route_code}`}</div>
          <div className="u-small u-muted">
            {data.route?.code ? `Route ${data.route.code}` : ''}
            {data.route?.vehicle ? ` · ${data.route.vehicle}` : ''}
            {data.route?.capacity ? ` · ${data.route.capacity} seats` : ''}
          </div>
        </div>
      </div>
      <p className="u-small u-muted" style={{ marginTop: 12, marginBottom: 0 }}>{data.note}</p>
    </Card>
  );
}
