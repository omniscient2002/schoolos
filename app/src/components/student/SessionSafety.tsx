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
   idle timeout.

   On wiping the device: the server attaches `Clear-Site-Data` to
   /student/* and to logout, but the browser REFUSES that header on a
   cross-origin fetch whose credentials mode prohibits modifying local
   data — which is how this client calls the API — so it never fires.
   The client half therefore does the work itself: signOut() wipes every
   app-owned storage key (see clearAppStorage in lib/theme.ts). Both the
   manual button and the idle timeout go through that one path.
   ============================================================ */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiLogoutAudit, setToken, redirectToLoginWithReturn } from '../../services/liveApi';
import { clearAppStorage } from '../../lib/theme';
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
       then clear storage + token, then leave for the front door.
       This lane is the shared-computer one — the banner says so on every
       student session — so it wipes ALL app storage, not just the session.
       Preferences go too: a kiosk that hands the next student the last
       student's language and appearance is a leak in everything but name. */
    try { await apiLogoutAudit(); } catch { /* ledger best-effort */ }
    /* P2-16: await the wipe before handing the device on. `clearAppStorage` now also empties the
       Cache API, which is async — without the await, redirectToLoginWithReturn() could run while
       cached responses were still on the device. The order below is the guarantee: revoke the
       session on the ledger, purge this browser, drop the in-memory token, then leave. */
    await clearAppStorage();
    setToken(null);
    setGone(true);
    redirectToLoginWithReturn();
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
