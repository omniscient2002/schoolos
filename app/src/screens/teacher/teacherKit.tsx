/* ============================================================
   teacherKit.tsx — shared pieces for the TU-2 teacher flow
   screens (screens/teacher/**). House patterns only:
   - useAsync: the local async hook (APP-SPEC §async pattern,
     duplicated per screen historically; the teacher lane shares
     one because every flow screen needs the same 12-state spine)
   - AsyncGate: loading → skeleton, error → friendly ErrorState,
     empty → teaching Empty, otherwise content
   - staffGate: soft role mirror; the server still decides
   ============================================================ */
import { useEffect, useState, type ReactNode } from 'react';
import { Empty, ErrorState, SkeletonCard } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { friendly } from '../../lib/friendlyErrors';
import { useSession } from '../../App';
import { canSurface } from '../../lib/effective';

/* ---------- async hook (loading/error/data/retry) ---------- */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState(s => ({ ...s, loading: true, error: null }));
    fn().then(d => { if (live) setState({ data: d, loading: false, error: null }); })
      .catch(e => { if (live) setState({ data: null, loading: false, error: friendly(e) }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are caller-declared
  }, [...deps, tick]);
  return { ...state, retry: () => setTick(t => t + 1) };
}

/* ---------- 12-state gate: skeleton / error / empty / content ---------- */
export function AsyncGate<T>({ state, skeleton, empty, children }: {
  state: { data: T | null; loading: boolean; error: string | null; retry?: () => void };
  skeleton?: ReactNode;
  empty?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (state.loading) return <>{skeleton ?? <SkeletonCard lines={6} />}</>;
  if (state.error) return <ErrorState title="This did not load" sub={state.error} onRetry={state.retry} />;
  if (!state.data) return <>{empty ?? <Empty icon={<Icon.Info size={20} />} title="Nothing to show" />}</>;
  return <>{children(state.data)}</>;
}

/* ---------- role mirror (server decides; UI degrades kindly) ---------- */
export const TEACHER_STAFF_ROLES = ['teacher', 'principal', 'owner', 'coordinator', 'itadmin'];

/** RBAC-1: may the caller operate a teacher screen? The SERVER's capability answer wins, so a
 *  mask-granted custom role (built-in role not in the list) can still work the screen; the
 *  built-in list is the fallback only when the server has not spoken (demo preview / no payload).
 *  This is a render gate, never authorization — every door re-decides on the server. */
export function useTeacherAccess(surface = '/teacher/homework'): boolean {
  const live = useSession();
  const caps = live.effective?.capabilities;
  if (caps) return canSurface(live.effective, surface);
  return TEACHER_STAFF_ROLES.includes(live.role);
}

export function DeniedState({ role }: { role: string }) {
  return (
    <div style={{ maxWidth: 640, margin: '0 auto', paddingTop: 'var(--s-8, 40px)' }}>
      <Empty
        titleAs="h1"
        icon={<Icon.Lock size={22} />}
        title="Not available on this account"
        sub="These pages are for teachers. Your account can see the school areas that belong to your role — nothing here needs your action."
      />
      <div className="u-xs u-faint" style={{ textAlign: 'center' }}>Signed in as: {role}</div>
    </div>
  );
}

/* ---------- due-state helper for homework chips (plain words) ---------- */
export function dueState(dueAt: string, closed: boolean): { label: string; tone: 'danger' | 'warning' | 'success' | 'neutral' } {
  if (closed) return { label: 'Closed', tone: 'neutral' };
  const ms = new Date(dueAt).getTime() - Date.now();
  if (ms <= 0) return { label: 'Due — time is up', tone: 'danger' };
  const h = ms / 3600000;
  if (h < 1) return { label: `Due in ${Math.max(1, Math.round(ms / 60000))} min`, tone: 'danger' };
  if (h < 24) return { label: `Due in ${Math.round(h)} h`, tone: 'warning' };
  return { label: `Due in ${Math.round(h / 24)} days`, tone: 'success' };
}

/* ---------- small labelled field (uses the shared .field CSS) ---------- */
export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

/* ---------- keyboard-submit helper (Enter on a form row) ---------- */
export function onEnter(action: () => void) {
  return (e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); action(); } };
}
