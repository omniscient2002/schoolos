/* ============================================================
   ops.timetable attention widget — substitution feed.
   Reads the kernel event spine (GET /events, type=timetable,
   label 'Substitution — …') emitted by the runtime when a
   substitution is assigned. Headless rail: this widget only
   surfaces events that already exist.
   ============================================================ */
import { useEffect, useState } from 'react';
import { Badge } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { apiEvents } from '../../services/liveApi';

interface EvRow { id?: unknown; type?: unknown; label?: unknown }

const N = 3;

export default function SubstitutionFeedWidget() {
  const [state, setState] = useState<{ loading: boolean; error: boolean; items: string[] }>({ loading: true, error: false, items: [] });

  useEffect(() => {
    let live = true;
    apiEvents()
      .then(d => {
        if (!live) return;
        const items = ((d.events ?? []) as EvRow[])
          .filter(e => e.type === 'timetable' && typeof e.label === 'string' && /^Substitution/.test(e.label))
          .map(e => e.label as string)
          .slice(0, N);
        setState({ loading: false, error: false, items });
      })
      .catch(() => { if (live) setState({ loading: false, error: true, items: [] }); });
    return () => { live = false; };
  }, []);

  const n = state.items.length;
  return (
    <div className="plugin-widget" style={{ padding: '12px 14px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-lg)', background: 'var(--surface-2)' }}>
      <div className="u-between">
        <div className="u-inline" style={{ gap: 8 }}>
          <Icon.Grid size={15} />
          <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>Timetable substitutions</span>
          {state.loading ? (
            <Badge tone="outline">…</Badge>
          ) : (
            <Badge tone={n > 0 ? 'accent' : 'outline'}>{n}</Badge>
          )}
        </div>
        <span className="u-xs u-faint">add-on</span>
      </div>
      <div className="u-xs u-muted" style={{ marginTop: 6, lineHeight: 1.6 }}>
        {state.loading
          ? 'Checking the timetable…'
          : state.error
            ? 'Live event feed unavailable — assignments are still saved.'
            : n === 0
              ? 'No substitutions assigned yet — raised here when the timetable rail assigns one.'
              : state.items.join('  ·  ')}
      </div>
    </div>
  );
}
