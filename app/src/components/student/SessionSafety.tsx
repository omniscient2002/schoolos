/* ============================================================
   SessionSafety — shared-computer banner for student sessions
   (SU-1 session-isolation UX; plan §"New in StudentOS v1").

   Shows a CALM banner (no red, no alarm): a standing "log out
   when done" nudge, an idle countdown pill in minutes (driven by
   /student/session → STUDENT_IDLE_TIMEOUT, plan default 10), and
   a Log out button that clears the session the same way the
   profile menu does.

   The countdown is honest UX, not enforcement: it tracks real
   user activity (pointer/keys/wheel) and mirrors the server's
   idle timeout, which remains the pinned, tested guard
   (no-store + Clear-Site-Data on logout are server-side).
   ============================================================ */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiLogoutAudit, setToken } from '../../services/liveApi';
import { Button } from '../ui';
import { Icon } from '../Icon';
import { fmtTime } from '../../lib/format';

const TICK_MS = 10_000;
const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'wheel', 'touchstart'];

export function SessionSafety({ idleMinutes = 10, signedInAt = null }: {
  idleMinutes?: number;
  signedInAt?: string | null;
}) {
  const lastActivity = useRef(Date.now());
  const signingOut = useRef(false);
  const [gone, setGone] = useState(false);
  const [remaining, setRemaining] = useState(() => Math.max(1, idleMinutes));

  const signOut = useCallback(async () => {
    if (signingOut.current) return;
    signingOut.current = true;
    /* same sequence as ProfileMenu's sign-out: audit best-effort,
       then clear storage + token, then leave for the front door */
    try { await apiLogoutAudit(); } catch { /* ledger best-effort */ }
    localStorage.removeItem('schoolos.session');
    setToken(null);
    setGone(true);
    window.location.href = '/login';
  }, []);

  useEffect(() => {
    const mark = () => { lastActivity.current = Date.now(); };
    ACTIVITY_EVENTS.forEach(ev => window.addEventListener(ev, mark, { passive: true }));
    const timer = window.setInterval(() => {
      const idleMin = (Date.now() - lastActivity.current) / 60_000;
      const left = Math.max(0, Math.ceil(idleMinutes - idleMin));
      setRemaining(left);
      if (left <= 0) void signOut();
    }, TICK_MS);
    return () => {
      ACTIVITY_EVENTS.forEach(ev => window.removeEventListener(ev, mark));
      window.clearInterval(timer);
    };
  }, [idleMinutes, signOut]);

  if (gone) return null;
  const soon = remaining <= 2;

  return (
    <div
      className="card"
      role="note"
      aria-label={`Shared computer reminder. This page signs out automatically after ${idleMinutes} quiet minutes. Log out when you are done.`}
      style={{ borderColor: 'var(--accent-weak-2)', background: 'var(--accent-weak)', padding: '11px 14px', marginBottom: 18 }}
      data-print="hide"
    >
      <div className="u-flex" style={{ gap: 10, alignItems: 'flex-start' }}>
        <Icon.Shield size={16} style={{ color: 'var(--accent-text)', flexShrink: 0, marginTop: 2 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 570 }}>
            {soon ? 'Signing you out soon — finish up and log out.' : 'Using a shared computer? Log out when done.'}
          </div>
          <div className="u-small" style={{ color: 'var(--text-2)', marginTop: 2, lineHeight: 1.5 }}>
            This page signs out automatically after {idleMinutes} quiet minutes — that keeps your work private on school
            computers.{signedInAt ? ` You signed in at ${fmtTime(signedInAt)}.` : ''}
          </div>
        </div>
        {/* minutes only — calm granularity; aria-hidden because the banner's
            aria-label already carries the same fact without ticking chatter */}
        <span className="badge badge-outline tnum" aria-hidden="true" style={{ flexShrink: 0 }} title="Time left before automatic sign-out (resets when you use the page)">
          {remaining} min
        </span>
        <Button variant="secondary" size="sm" icon={<Icon.Lock size={13} />} onClick={() => void signOut()}>
          Log out
        </Button>
      </div>
    </div>
  );
}
