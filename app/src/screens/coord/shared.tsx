/* ============================================================
   shared.tsx — CU-1 coordinator-lane helpers (screens/coord/**).
   Access gate (server authority = coordinator | principal, coord.view
   plugin index.js), one async-data hook, and the shared denied /
   banner primitives so every screen answers loading / error /
   empty / denied the same way.
   ============================================================ */
import { useEffect, useState } from 'react';
import { useSession } from '../../App';
import { Empty } from '../../components/ui';
import { Icon } from '../../components/Icon';

/** server AUTHORITY set (coord.view index.js) — the UI mirrors it, the server decides */
export const COORD_AUTHORITY = ['coordinator', 'principal'];

export function useCoordAccess() {
  const live = useSession();
  return { allowed: COORD_AUTHORITY.includes(live.role), role: live.role };
}

export function CoordDenied({ what }: { what: string }) {
  return (
    <Empty
      icon={<Icon.Lock size={22} />}
      title="Coordinator desk only"
      sub={`${what} is restricted to the coordination authority (coordinator, principal). The server rejects these doors for every other role — there is no masked view.`}
    />
  );
}

/** Fairness / privacy framing banner — the same idiom as the VisitorsBoard rule card. */
export function CoordBanner({ icon, strong, faint }: { icon: React.ReactNode; strong: string; faint?: string }) {
  return (
    <div className="card card-pad u-flex" style={{ gap: 8, alignItems: 'flex-start', marginBottom: 20, borderColor: 'var(--warning-weak-2)' }}>
      <span style={{ color: 'var(--warning)', marginTop: 1 }}>{icon}</span>
      <div>
        <div className="u-small" style={{ fontWeight: 600 }}>{strong}</div>
        {faint && <div className="u-xs u-faint" style={{ marginTop: 2, lineHeight: 1.55 }}>{faint}</div>}
      </div>
    </div>
  );
}

export function CoordPrivacyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="u-flex u-xs u-faint" style={{ gap: 6, marginTop: 10, lineHeight: 1.55 }}>
      <Icon.Lock size={11} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>{children}</span>
    </div>
  );
}

/* local async pattern (per APP-SPEC, same idiom as Insights/ActionCenter) */
export function useCoordData<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState(s => ({ ...s, loading: true, error: null }));
    fn()
      .then(d => { if (live) setState({ data: d, loading: false, error: null }); })
      .catch(e => { if (live) setState({ data: null, loading: false, error: String(e) }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps + manual retry tick
  }, [...deps, tick]);
  return { ...state, retry: () => setTick(t => t + 1) };
}
