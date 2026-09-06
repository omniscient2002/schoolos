/* ============================================================
   transport.gps attention widget — GPS delay approvals.
   docs/11 §2.3: the rail is headless; this widget only SURFACES
   the approval actions the runtime already raised on the action
   spine (kind=approval, payload.template=TRANSPORT_DELAY).
   Role scoping is the server's (RLS on /actions) — the widget
   renders whatever the current role may see.
   ============================================================ */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { apiActions } from '../../services/liveApi';

interface Row { kind?: unknown; title?: unknown; payload?: unknown }

function isGpsDelayApproval(a: Row): a is { kind: string; title: string } {
  if (a.kind !== 'approval') return false;
  const p = a.payload as { template?: unknown } | null | undefined;
  if (p?.template === 'TRANSPORT_DELAY') return true;
  return typeof a.title === 'string' && /^Notify .* guardians — Bus /.test(a.title);
}

export default function GpsDelayApprovalsWidget() {
  const [state, setState] = useState<{ loading: boolean; error: boolean; items: { kind: string; title: string }[] }>({ loading: true, error: false, items: [] });

  useEffect(() => {
    let live = true;
    apiActions('open')
      .then(d => {
        if (!live) return;
        const items = ((d.actions ?? []) as Row[]).filter(isGpsDelayApproval);
        setState({ loading: false, error: false, items });
      })
      .catch(() => { if (live) setState({ loading: false, error: true, items: [] }); });
    return () => { live = false; };
  }, []);

  const n = state.items.length;
  return (
    <Link to="/attention" className="plugin-widget" style={{ display: 'block', padding: '12px 14px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-lg)', background: 'var(--surface-2)', textDecoration: 'none' }}>
      <div className="u-between">
        <div className="u-inline" style={{ gap: 8 }}>
          <Icon.Compass size={15} />
          <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>GPS delay approvals</span>
          {state.loading ? (
            <Badge tone="outline">…</Badge>
          ) : (
            <Badge tone={n > 0 ? 'warning' : 'success'}>{n}</Badge>
          )}
        </div>
        <span className="u-xs u-faint">plugin</span>
      </div>
      <div className="u-xs u-muted" style={{ marginTop: 6, lineHeight: 1.6 }}>
        {state.loading
          ? 'Reading the approval spine…'
          : state.error
            ? 'Live action feed unavailable — approvals still on the ledger.'
            : n === 0
              ? 'No GPS delay approvals open — guardian notices clear.'
              : state.items.slice(0, 2).map(a => a.title).join('  ·  ') + (n > 2 ? `  ·  +${n - 2} more` : '')}
      </div>
    </Link>
  );
}
