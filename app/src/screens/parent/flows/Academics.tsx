/* ============================================================
   Academics — per-child published report cards (U-15).
   Server truth: GET /parent/child/:id/academics. Only results the
   school has published appear; a moderated result reads the same to
   the family as it does to staff. Nothing is invented here.
   ============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { Badge, Card, Empty } from '../../../components/ui';
import { ParentError, ParentLoading } from '../../../components/parent/states';
import { fmtDate } from '../../../lib/format';
import { gradeLabel } from '../../../lib/labels';
import { getAcademics, type ParentAcademicsData } from '../../../services/parentApi';

export default function Academics({ childId }: { childId: string }) {
  const [data, setData] = useState<ParentAcademicsData | null>(null);
  const [err, setErr] = useState<unknown>(null);

  const load = useCallback(() => {
    setErr(null);
    getAcademics(childId).then(setData).catch(setErr);
  }, [childId]);
  useEffect(() => { load(); }, [load]);

  if (err) return <ParentError err={err} onRetry={load} />;
  if (!data) return <ParentLoading cards={2} />;
  const reports = data.reports ?? [];

  return (
    <div className="u-col" style={{ gap: 16 }}>
      {reports.length === 0 ? (
        <Empty title="No published results yet" sub="Report cards appear here once the school publishes them." />
      ) : reports.map((r, i) => (
        <Card key={`${r.exam}-${i}`} head={r.exam} actions={<Badge tone="info">{r.term ?? 'Result'}</Badge>}>
          <div className="u-col" style={{ gap: 8 }}>
            <div className="u-flex" style={{ gap: 16, alignItems: 'baseline' }}>
              <span className="tnum" style={{ fontSize: 'var(--text-2xl)', fontWeight: 650 }}>{r.pct ?? '—'}%</span>
              {r.grade ? <Badge tone="success">{gradeLabel(r.grade)}</Badge> : null}
              {r.publishedAt ? <span className="u-xs u-faint">Published {fmtDate(r.publishedAt)}</span> : null}
            </div>
            {r.explain ? <div className="u-small u-muted" style={{ lineHeight: 1.6 }}>{r.explain}</div> : null}
          </div>
        </Card>
      ))}
    </div>
  );
}
