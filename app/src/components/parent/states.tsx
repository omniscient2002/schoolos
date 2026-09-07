/* ============================================================
   states.tsx — shared loading / error / denied states for the
   ParentOS screens (PU-1). Every parent door degrades the same
   calm way: skeletons while waiting, a plain-language retry on
   failure, a lock screen when the account is not authorized.
   ============================================================ */
import { ErrorState, Empty, SkeletonCard } from '../ui';
import { Icon } from '../Icon';
import { friendly } from '../../lib/friendlyErrors';
import { isDeniedError } from '../../services/parentApi';

/* Parent doors that come back 403/forbidden (wrong account, child not
   linked) get the lock screen — never a stack trace, never a retry loop
   that cannot succeed. */
export function DeniedEmpty({ sub }: { sub?: string }) {
  return (
    <Empty
      icon={<Icon.Lock size={26} />}
      title="Not available on this account"
      sub={sub ?? 'This page shows only your own children\u2019s records. If something looks wrong, call the school office.'}
    />
  );
}

/* Full-width error with the verbatim server string passed through
   friendly() — numbers and ids survive, jargon does not. */
export function ParentError({ err, onRetry }: { err: unknown; onRetry: () => void }) {
  if (isDeniedError(err)) return <DeniedEmpty />;
  return <ErrorState title="Could not load this page" sub={friendly((err as Error)?.message ?? err)} onRetry={onRetry} />;
}

/* Standard loading skeleton block (three cards). */
export function ParentLoading({ cards = 3 }: { cards?: number }) {
  return (
    <div className="u-col" style={{ gap: 14 }} aria-busy="true" aria-label="Loading">
      {Array.from({ length: cards }).map((_, i) => <SkeletonCard key={i} />)}
    </div>
  );
}
