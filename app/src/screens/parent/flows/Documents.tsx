/* Documents — the school's shared files for this child (PRD-5 tail).
   Door: GET /parent/child/:id/documents (metadata); the download rides
   files.store's guardian-scoped access check. */
import { useEffect, useState } from 'react';
import { Button, Card, Empty, ErrorState, SkeletonCard, useToast } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { friendly } from '../../../lib/friendlyErrors';
import { getDocuments, downloadDocument, type ParentDocumentsData } from '../../../services/parentApi';

const fmtBytes = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;

export default function Documents({ childId }: { childId: string }) {
  const toast = useToast();
  const [data, setData] = useState<ParentDocumentsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    getDocuments(childId)
      .then(d => { if (alive) setData(d); })
      .catch(e => { if (alive) setError(friendly(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [childId, tick]);

  const download = async (id: string, filename: string) => {
    try { await downloadDocument(id, filename); }
    catch (e) { toast({ title: 'Download failed', sub: friendly(e), tone: 'error' }); }
  };

  if (loading) return <SkeletonCard lines={4} />;
  if (error) return <ErrorState title="Documents did not load" sub={error} onRetry={() => setTick(t => t + 1)} />;
  if (!data || data.documents.length === 0) {
    return <Empty icon={<Icon.File size={22} />} title="No documents yet" sub={data?.note ?? 'Files the school shares for this child appear here.'} />;
  }
  return (
    <Card>
      <div className="u-col" style={{ gap: 10 }}>
        {data.documents.map(d => (
          <div key={d.id} className="u-between u-wrap" style={{ gap: 10, alignItems: 'center' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 570 }}>{d.filename}</div>
              <div className="u-xs u-faint">{fmtBytes(d.bytes)} · {new Date(d.created_at).toLocaleDateString()}</div>
            </div>
            <Button size="sm" variant="secondary" icon={<Icon.Download size={12} />} onClick={() => download(d.id, d.filename)}>Download</Button>
          </div>
        ))}
        <div className="u-xs u-faint">{data.note}</div>
      </div>
    </Card>
  );
}
