/* ============================================================
   Exams — per-child upcoming exams + published results (PU-2).
   Server truth: GET /parent/child/:id/exams. Only exams the school
   has published appear. No preparation material exists server-side,
   so the screen says that instead of inventing any.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Card, Empty, Tabs } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { ParentError, ParentLoading } from '../../../components/parent/states';
import { fmtDate } from '../../../lib/format';
import { getExams } from '../../../services/parentApi';
import { list, str, text } from './helpers';

export default function Exams({ childId }: { childId: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [tab, setTab] = useState('upcoming');

  const load = useCallback(() => {
    setErr(null);
    getExams(childId)
      .then(d => setData(d as unknown as Record<string, unknown>))
      .catch(e => setErr(e));
  }, [childId]);
  useEffect(() => { load(); }, [load]);

  const upcoming = useMemo(() => list<Record<string, unknown>>(data?.upcoming).map((e, i) => ({
    key: str(e.id) ?? `${str(e.title, e.name) ?? 'exam'}-${i}`,
    title: str(e.title, e.name) ?? 'Exam',
    subject: str(e.subject, e.term),
    date: str(e.date, e.exam_date, e.scheduled_at),
    syllabus: str(e.syllabus),
  })), [data]);

  const published = useMemo(() => list<Record<string, unknown>>(data?.published).map((r, i) => ({
    key: str(r.id) ?? `${str(r.title, r.exam, r.name) ?? 'result'}-${i}`,
    title: str(r.title, r.exam, r.name) ?? 'Result',
    subject: str(r.subject, r.term),
    score: text(r.score, r.total_pct, r.grade),
    publishedAt: str(r.published_at, r.publishedAt),
  })), [data]);

  if (err) return <ParentError err={err} onRetry={load} />;
  if (!data) return <ParentLoading cards={2} />;

  const explain = str(data.explain);

  return (
    <div className="u-col" style={{ gap: 16 }}>
      <Tabs
        tabs={[
          { id: 'upcoming', label: 'Upcoming', count: upcoming.length },
          { id: 'published', label: 'Published results', count: published.length },
        ]}
        active={tab}
        onChange={setTab}
        panelId="exams"
      />

      {tab === 'upcoming' && (
        <div role="tabpanel" id="exams-panel-upcoming" aria-labelledby="exams-tab-upcoming" className="u-col" style={{ gap: 16 }}>
          <div className="u-small u-muted" style={{ background: 'var(--surface-2)', borderRadius: 'var(--r-md)', padding: '10px 12px', lineHeight: 1.55 }}>
            Preparation material is not available here yet — the school has not connected that content. Ask the class teacher for the syllabus.
          </div>
          {upcoming.length === 0 ? (
            <Empty
              icon={<Icon.Book size={22} />}
              title="No exams scheduled"
              sub="When the school schedules an exam for this class, it appears here with its date."
              titleAs="h3"
            />
          ) : (
            <Card pad={false}>
              <div className="u-col">
                {upcoming.map((e, i) => (
                  <div key={e.key} className="u-between u-flex" style={{ gap: 12, padding: 14, borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 570 }}>{e.title}</div>
                      <div className="u-xs u-faint" style={{ marginTop: 2 }}>{e.subject ?? 'Subject not listed'}</div>
                      {e.syllabus && <div className="u-small u-muted" style={{ marginTop: 6, lineHeight: 1.5 }}>{e.syllabus}</div>}
                    </div>
                    <Badge tone="info" dot>{e.date ? fmtDate(e.date) : 'Date to be announced'}</Badge>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {tab === 'published' && (
        <div role="tabpanel" id="exams-panel-published" aria-labelledby="exams-tab-published" className="u-col" style={{ gap: 16 }}>
          {published.length === 0 ? (
            <Empty
              icon={<Icon.Award size={22} />}
              title="No results published yet"
              sub="Only exams the school has published appear here. Nothing is shown before that."
              titleAs="h3"
            />
          ) : (
            <Card pad={false}>
              <div className="u-col">
                {published.map((r, i) => (
                  <div key={r.key} className="u-between u-flex" style={{ gap: 12, padding: 14, borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 570 }}>{r.title}</div>
                      <div className="u-xs u-faint" style={{ marginTop: 2 }}>
                        {r.subject ?? 'Subject not listed'}{r.publishedAt ? ` · published ${fmtDate(r.publishedAt)}` : ''}
                      </div>
                    </div>
                    {r.score && <Badge tone="neutral">{r.score}</Badge>}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {explain && <div className="u-small u-muted" style={{ lineHeight: 1.55 }}>{explain}</div>}
    </div>
  );
}
