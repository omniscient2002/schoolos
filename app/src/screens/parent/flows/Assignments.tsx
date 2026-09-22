/* ============================================================
   Assignments — per-child homework buckets (PU-2).
   Server truth: GET /parent/child/:id/assignments. Status comes from
   the class teacher's records; paper homework needs no upload here.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Card, DataTable, Empty, Tabs } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { ParentError, ParentLoading } from '../../../components/parent/states';
import { fmtDate } from '../../../lib/format';
import { getAssignments } from '../../../services/parentApi';
import { list, str } from './helpers';

interface HwRow { id: string; title: string; subject: string; due: string | null; status: string | null }

const BUCKETS = [
  { id: 'upcoming', label: 'Upcoming', tone: 'info' as const },
  { id: 'submitted', label: 'Submitted', tone: 'info' as const },
  { id: 'reviewed', label: 'Reviewed', tone: 'success' as const },
  { id: 'overdue', label: 'Overdue', tone: 'warning' as const },
  { id: 'missing', label: 'Missing', tone: 'danger' as const },
];

export default function Assignments({ childId }: { childId: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [tab, setTab] = useState('upcoming');

  const load = useCallback(() => {
    setErr(null);
    getAssignments(childId)
      .then(d => setData(d as unknown as Record<string, unknown>))
      .catch(e => setErr(e));
  }, [childId]);
  useEffect(() => { load(); }, [load]);

  const rowsByBucket = useMemo(() => {
    const out: Record<string, HwRow[]> = {};
    for (const b of BUCKETS) {
      out[b.id] = list<Record<string, unknown>>(data?.[b.id]).map((r, i) => ({
        id: str(r.id) ?? `${b.id}-${i}`,
        title: str(r.title) ?? 'Homework',
        subject: str(r.subject) ?? '—',
        due: str(r.due, r.due_at),
        status: str(r.status, r.submission_status),
      }));
    }
    return out;
  }, [data]);

  if (err) return <ParentError err={err} onRetry={load} />;
  if (!data) return <ParentLoading cards={2} />;

  const explain = str(data.explain);
  const columns = [
    { key: 'title', label: 'Homework', render: (r: HwRow) => <span style={{ fontWeight: 550 }}>{r.title}</span> },
    { key: 'subject', label: 'Subject' },
    {
      key: 'due', label: 'Due', sortable: true, sortValue: (r: HwRow) => r.due ?? '',
      render: (r: HwRow) => (r.due ? fmtDate(r.due) : <span className="u-faint">—</span>),
    },
  ];
  const activeLabel = BUCKETS.find(b => b.id === tab)?.label ?? 'Homework';

  return (
    <div className="u-col" style={{ gap: 16 }}>
      {explain && (
        <div className="u-small u-muted" style={{ background: 'var(--surface-2)', borderRadius: 'var(--r-md)', padding: '10px 12px', lineHeight: 1.55 }}>
          {explain}
        </div>
      )}

      <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap' }} aria-label="Homework buckets">
        {BUCKETS.map(b => (
          <Badge key={b.id} tone={b.tone} dot={rowsByBucket[b.id].length > 0}>
            {b.label}: {rowsByBucket[b.id].length}
          </Badge>
        ))}
      </div>

      <Tabs
        tabs={BUCKETS.map(b => ({ id: b.id, label: b.label, count: rowsByBucket[b.id].length }))}
        active={tab}
        onChange={setTab}
        panelId="assignments"
      />

      <div role="tabpanel" id={`assignments-panel-${tab}`} aria-labelledby={`assignments-tab-${tab}`}>
        <Card pad={false}>
          <DataTable<HwRow>
            columns={columns}
            rows={rowsByBucket[tab] ?? []}
            rowKey={r => r.id}
            caption={`${activeLabel} homework — ${rowsByBucket[tab]?.length ?? 0} items`}
            empty={
              <Empty
                icon={<Icon.Clipboard size={22} />}
                title={`Nothing ${activeLabel.toLowerCase()}`}
                sub="Items move between these buckets as the teacher records submissions."
                titleAs="h3"
              />
            }
          />
        </Card>
      </div>
    </div>
  );
}
