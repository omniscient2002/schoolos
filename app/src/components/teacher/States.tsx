/* ============================================================
   teacher/States.tsx — the 12-state contract for every teacher
   card (plan §P12) + the section landings + flow stubs.

   State rule: every card zone must be able to show each of —
   empty / loading / error / partial / offline / denied / pending
   / approval / archived / locked / conflict / sync. The five a
   teacher hits on real data (empty, loading, error, denied,
   partial) render fully; the other seven render through one
   honest Notice component so the surface never lies.

   All copy is plain language per the glossary commits —
   "Needs your attention", "This feature is switched off",
   never jargon.
   ============================================================ */
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Card, Empty, ErrorState, Skeleton } from '../ui';
import { Icon } from '../Icon';

/* ---------- 12-state notice (one component, all stub states) ---------- */

export type TeacherState =
  | 'empty' | 'loading' | 'error' | 'partial' | 'offline' | 'denied'
  | 'pending' | 'approval' | 'archived' | 'locked' | 'conflict' | 'sync';

const STATE_COPY: Record<Exclude<TeacherState, 'empty' | 'loading' | 'error' | 'denied'>, { title: string; sub: string; icon: ReactNode; tone?: 'info' | 'warning' | 'ai' }> = {
  partial: { title: 'Partly loaded', sub: 'Some of this could not be fetched. The rest is shown.', icon: <Icon.Info size={20} />, tone: 'info' },
  offline: { title: 'You are offline', sub: 'This is the last saved version. Changes are queued and will sync when you are back online.', icon: <Icon.Offline size={20} /> },
  pending: { title: 'Waiting on someone else', sub: 'This has been sent to the right person. It moves as soon as they act.', icon: <Icon.Clock size={20} /> },
  approval: { title: 'Waiting for approval', sub: 'A decision is needed before this can move. You will see it change here.', icon: <Icon.Clipboard size={20} />, tone: 'warning' },
  archived: { title: 'Archived', sub: 'This record is closed. It stays readable but cannot be changed.', icon: <Icon.Document size={20} /> },
  locked: { title: 'Locked', sub: 'This was made final by the school office. Nothing can be edited here.', icon: <Icon.Lock size={20} /> },
  conflict: { title: 'Needs a second look', sub: 'Two versions were saved for this. Nothing was lost — open it to pick the correct one.', icon: <Icon.Alert size={20} />, tone: 'warning' },
  sync: { title: 'Saving…', sub: 'Your change is on its way to the school server. It is safe on this device meanwhile.', icon: <Icon.Refresh size={20} />, tone: 'info' },
};

/** The non-interactive stub states, rendered honestly in place. */
export function StateNotice({ state, label }: { state: TeacherState; label?: string }) {
  const c = STATE_COPY[state as keyof typeof STATE_COPY];
  if (!c) return null;
  return (
    <div className="t-state-notice" role="status">
      <span className="t-state-icon" aria-hidden="true">{c.icon}</span>
      <div>
        <div className="u-small" style={{ fontWeight: 620 }}>{c.title}{label ? <span className="u-faint" style={{ fontWeight: 480 }}> — {label}</span> : null}</div>
        <div className="u-xs u-muted" style={{ lineHeight: 1.5 }}>{c.sub}</div>
      </div>
    </div>
  );
}

/* ---------- per-card state surface (loading / empty / error / denied) ---------- */

export function CardStates({ state, title, sub, emptySub, onRetry, children, minHeight = 120 }: {
  state: TeacherState;
  title: string;
  sub?: string;
  emptySub?: string;
  onRetry?: () => void;
  children: ReactNode;
  minHeight?: number;
}) {
  const skeleton = (
    <div className="u-col" style={{ gap: 8 }}>
      <Skeleton w="42%" h={12} />
      <Skeleton w="100%" h={11} />
      <Skeleton w="72%" h={11} />
    </div>
  );
  if (state === 'loading') {
    return (
      <Card pad className="t-state-card" style={{ minHeight }}>
        <span className="sr-only" role="status">Loading {title}…</span>
        {skeleton}
      </Card>
    );
  }
  if (state === 'denied') {
    return (
      <Card pad className="t-state-card" style={{ minHeight }}>
        <Empty titleAs="h3" icon={<Icon.Lock size={20} />} title="This feature is switched off for your account" sub="Your school has not given this account access. Ask the school office if you need it." />
      </Card>
    );
  }
  if (state === 'error') {
    return (
      <Card pad className="t-state-card" style={{ minHeight }}>
        <ErrorState title={`${title} could not load`} sub={sub ?? 'The school server did not answer. Nothing was lost.'} onRetry={onRetry} />
      </Card>
    );
  }
  if (state === 'empty') {
    return (
      <Card pad className="t-state-card" style={{ minHeight }}>
        <Empty titleAs="h3" icon={<Icon.Check size={20} />} title={title} sub={emptySub ?? 'Nothing needs you here right now.'} />
      </Card>
    );
  }
  /* real content (any of the remaining states render content + inline notice) */
  return <>{children}</>;
}

/* ---------- small state chip used inside live cards ---------- */

export function StateChip({ state, source }: { state?: TeacherState; source?: 'live' | 'fixture' }) {
  const show = state && ['pending', 'approval', 'archived', 'locked', 'conflict', 'sync', 'partial', 'offline', 'loading', 'empty', 'error', 'denied'].includes(state);
  if (!show && !source) return null;
  const label = state && show
    ? { pending: 'Waiting on someone else', approval: 'Waiting for approval', archived: 'Archived', locked: 'Locked', conflict: 'Needs a second look', sync: 'Saving…', partial: 'Partly loaded', offline: 'Offline — showing last saved', loading: 'Loading…', empty: 'Nothing here yet', error: 'Could not load — try again', denied: 'Not available for your role' }[state]
    : undefined;
  return (
    <span className="t-state-chips">
      {source === 'fixture' && <Badge tone="accent">Demo data</Badge>}
      {label && <Badge tone={state === 'conflict' || state === 'offline' ? 'warning' : 'neutral'} dot>{label}</Badge>}
    </span>
  );
}

/* ============================================================
   Section landings — §1 IA groups whose screens belong to other
   lanes. Until those lanes land, each group answers with an
   honest landing card pointing at what exists today. These are
   placeholders by design — NOT the other lanes' screens.
   ============================================================ */

export interface SectionEntry { label: string; to: string; note: string; ready: boolean }

export function SectionLanding({ title, sub, entries }: { title: string; sub: string; entries: SectionEntry[] }) {
  const navigate = useNavigate();
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          <div className="sub">{sub}</div>
        </div>
      </div>
      <div className="grid grid-2">
        {entries.map(e => (
          <Card key={e.label} pad className="card-click" onClick={() => navigate(e.to)}>
            <div className="u-flex" style={{ gap: 10, alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="u-flex" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 620 }}>{e.label}</span>
                  {!e.ready && <Badge tone="outline">Coming in this build</Badge>}
                </div>
                <div className="u-small u-muted" style={{ marginTop: 3, lineHeight: 1.5 }}>{e.note}</div>
              </div>
              <Icon.ChevronRight size={15} style={{ color: 'var(--text-3)', marginTop: 3, flexShrink: 0 }} />
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

/* ---------- TU-2 flow screen placeholder (deep-link target) ---------- */

/** The flow screens (homework, submissions, attendance, leave,
 *  concerns, PTM, announce, messages, copilot) are TU-2 lane
 *  files. Until they land, their routes render this: it names
 *  the flow, honours the prefill that QuickActions sent, and
 *  hands off cleanly — no fake forms. */
export function FlowPlaceholder({ title, comingSub, prefillNote }: { title: string; comingSub?: string; prefillNote?: string }) {
  const prefill = (window.history.state?.usr as { prefill?: Record<string, unknown> } | null)?.prefill;
  return (
    <div className="page-head">
      <h1>{title}</h1>
      <div className="sub">{comingSub ?? 'This screen is being built in the current release. The link from your home page is already wired.'}</div>
      {prefill && Object.keys(prefill).length > 0 && (
        <Card pad style={{ marginTop: 16 }}>
          <div className="u-small" style={{ fontWeight: 620, marginBottom: 4 }}>Carried over from where you opened it</div>
          <div className="u-xs u-muted" style={{ lineHeight: 1.7 }}>
            {Object.entries(prefill)
              .filter(([k, v]) => v != null && v !== '' && k !== 'actionId')
              .map(([k, v]) => `${({ classGrade: 'Class', subject: 'Subject', room: 'Room', period: 'Period', teacher: 'Teacher', kind: 'Type' } as Record<string, string>)[k] ?? k}: ${String(v)}`)
              .join(' · ')}
          </div>
          {prefillNote && <div className="u-xs u-faint" style={{ marginTop: 6 }}>{prefillNote}</div>}
        </Card>
      )}
    </div>
  );
}
