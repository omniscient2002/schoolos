/* ============================================================
   Explain — plain-language meaning for a complex metric (PU-2).
   Server truth: GET /parent/explain/:topic (attendance|report|fees),
   built from the guardian's own children's real numbers.
   ============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { Card, Empty } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { ParentError, ParentLoading } from '../../../components/parent/states';
import { getExplain } from '../../../services/parentApi';
import { str } from './helpers';

const TOPICS = [
  { id: 'attendance', label: 'Attendance' },
  { id: 'report', label: 'Report card' },
  { id: 'fees', label: 'Fees' },
];

export default function Explain({ topic = 'attendance' }: { topic?: string }) {
  const [active, setActive] = useState(TOPICS.some(t => t.id === topic) ? topic : 'attendance');
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<unknown>(null);

  const load = useCallback(() => {
    setErr(null); setData(null);
    getExplain(active)
      .then(d => setData(d as unknown as Record<string, unknown>))
      .catch(e => setErr(e));
  }, [active]);
  useEffect(() => { load(); }, [load]);

  const label = TOPICS.find(t => t.id === active)?.label ?? active;

  return (
    <div className="u-col" style={{ gap: 16 }}>
      <div role="group" aria-label="Choose a topic" className="u-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
        {TOPICS.map(t => {
          const on = t.id === active;
          return (
            <button key={t.id} onClick={() => setActive(t.id)} aria-pressed={on} style={{
              minHeight: 44, padding: '8px 14px', borderRadius: 999, cursor: 'pointer',
              border: `1px solid ${on ? 'var(--accent)' : 'var(--border-strong)'}`,
              background: on ? 'var(--accent-weak)' : 'var(--surface)', color: 'var(--text-1)',
              fontWeight: on ? 620 : 480, fontSize: 'var(--text-sm)',
            }}>{t.label}</button>
          );
        })}
      </div>

      {err ? (
        <ParentError err={err} onRetry={load} />
      ) : !data ? (
        <ParentLoading cards={3} />
      ) : (
        <ExplainBody topic={label} data={data} />
      )}
    </div>
  );
}

function ExplainBody({ topic, data }: { topic: string; data: Record<string, unknown> }) {
  const meaning = str(data.meaning);
  const why = str(data.why);
  const action = str(data.what_you_can_do, data.whatYouCanDo);

  if (!meaning && !why && !action) {
    return (
      <Empty
        icon={<Icon.Info size={22} />}
        title="Explanation not available"
        sub={`The school has not published an explanation for ${topic.toLowerCase()} yet.`}
        titleAs="h3"
      />
    );
  }

  return (
    <div className="u-col" style={{ gap: 14 }}>
      <div className="u-small u-muted">Understanding {topic.toLowerCase()}</div>
      {meaning && (
        <Card headAs="h3" head="What it means">
          <p className="u-small" style={{ margin: 0, lineHeight: 1.6 }}>{meaning}</p>
        </Card>
      )}
      {why && (
        <Card headAs="h3" head="Why it matters">
          <p className="u-small" style={{ margin: 0, lineHeight: 1.6 }}>{why}</p>
        </Card>
      )}
      {action && (
        <Card headAs="h3" head="What you can do">
          <p className="u-small" style={{ margin: 0, lineHeight: 1.6 }}>{action}</p>
        </Card>
      )}
    </div>
  );
}
