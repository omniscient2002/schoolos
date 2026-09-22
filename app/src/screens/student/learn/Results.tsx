/* ============================================================
   Results — StudentOS learn lane (SU-2, PRD-6).

   Published reports only, each with the school's plain-language
   explain lines. A report that has not been published is not
   invented here; the empty state says so.

   Door: GET /student/results.
   ============================================================ */
import { useEffect, useState } from 'react';
import { PageHead, Card, Badge, Empty, ErrorState, SkeletonCard } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { friendly } from '../../../lib/friendlyErrors';
import { fmtDate } from '../../../lib/format';
import { getStudentResults, type StudentResultReport } from '../../../services/studentApi';

function dateLabel(v: string | null): string | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? v : fmtDate(v);
}

export default function Results() {
  const [reports, setReports] = useState<StudentResultReport[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getStudentResults()
      .then(d => { if (alive) setReports(d.reports); })
      .catch(e => { if (alive) setError(friendly(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [tick]);

  const rows = reports ?? [];

  return (
    <div>
      <PageHead
        title="Results"
        sub="Reports your school has published for you, with a plain explanation of what each one means."
      />

      {loading && <SkeletonCard lines={6} />}

      {!loading && error && (
        <ErrorState title="Your results did not load" sub={error} onRetry={() => setTick(t => t + 1)} />
      )}

      {!loading && !error && rows.length === 0 && (
        <Empty
          icon={<Icon.Insights size={22} />}
          title="No reports published yet"
          sub="When your school publishes a report, it appears here with an explanation. Nothing is shown before it is published."
        />
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="u-col" style={{ gap: 14 }}>
          {rows.map(r => (
            <Card key={r.id} headAs="h2" head={r.title}>
              <div className="u-flex u-wrap" style={{ gap: 8, marginBottom: 10 }}>
                {r.period && <Badge tone="outline">{r.period}</Badge>}
                {dateLabel(r.publishedOn) && <span className="u-small u-muted">Published {dateLabel(r.publishedOn)}</span>}
              </div>
              {r.summary && <div style={{ fontWeight: 550 }}>{r.summary}</div>}
              {r.explain.length > 0 && (
                <ul style={{ margin: '10px 0 0', padding: 0, listStyle: 'none' }} className="u-col">
                  {r.explain.map((line, i) => (
                    <li key={i} className="u-flex u-small" style={{ gap: 9, padding: '5px 0' }}>
                      <span aria-hidden="true" style={{ color: 'var(--accent-text)', marginTop: 2, flexShrink: 0 }}><Icon.Check size={13} /></span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
          <div className="u-xs u-faint">Reports are published by your school. If something looks wrong, speak to your teacher.</div>
        </div>
      )}
    </div>
  );
}
