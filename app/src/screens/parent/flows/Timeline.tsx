/* ============================================================
   Timeline — per-child chronological record (PU-2).
   Server truth: GET /parent/child/:id/timeline (evidence-only events:
   attendance, homework, published results). Newest is shown last so
   the story reads forward.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, Empty, Timeline as TimelineList } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { ParentError, ParentLoading } from '../../../components/parent/states';
import { fmtDate, fmtDateTime } from '../../../lib/format';
import { getTimeline } from '../../../services/parentApi';
import { list, str } from './helpers';

function dotFor(kind: string): 'accent' | 'ai' | 'danger' | undefined {
  if (kind === 'result') return 'ai';
  if (kind === 'attendance') return 'accent';
  if (kind === 'concern' || kind === 'incident') return 'danger';
  return undefined;
}

const when = (at: string) => (at.length === 10 ? fmtDate(at) : fmtDateTime(at));

export default function Timeline({ childId }: { childId: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<unknown>(null);

  const load = useCallback(() => {
    setErr(null);
    getTimeline(childId)
      .then(d => setData(d as unknown as Record<string, unknown>))
      .catch(e => setErr(e));
  }, [childId]);
  useEffect(() => { load(); }, [load]);

  const events = useMemo(() => {
    return list<Record<string, unknown>>(data?.events, data?.timeline)
      .map(e => ({
        at: str(e.at, e.date, e.created_at),
        kind: str(e.kind) ?? 'event',
        title: str(e.title, e.text) ?? 'Update',
        detail: str(e.detail, e.note),
      }))
      .filter((e): e is { at: string; kind: string; title: string; detail: string | null } =>
        !!e.at && !Number.isNaN(new Date(e.at).getTime()))
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [data]);

  if (err) return <ParentError err={err} onRetry={load} />;
  if (!data) return <ParentLoading cards={2} />;

  return (
    <Card headAs="h2" head="Activity" sub="Attendance, homework and published results, oldest first.">
      {events.length === 0 ? (
        <Empty
          icon={<Icon.Clock size={22} />}
          title="Nothing recorded yet"
          sub="As the school marks attendance, records homework and publishes results, each event appears here."
          titleAs="h3"
        />
      ) : (
        <TimelineList
          items={events.map(e => ({
            time: when(e.at),
            title: e.title,
            body: e.detail ?? undefined,
            dot: dotFor(e.kind),
          }))}
        />
      )}
    </Card>
  );
}
