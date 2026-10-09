/* Library overdue widget — real data from the desk's overdue door while the plugin is enabled.
   Rendered in the attention slot for the roles that can actually reach the desk; hidden when
   nothing is overdue.

   P3-8: the fetch used to run in a BARE useEffect with no role check, so every signed-in account
   that mounted the attention slot fired `GET /plugins/library/overdue`, whose gate is DESK =
   ['librarian'] alone. Measured in a ten-account sign-in run: 16 × `403 role itadmin not permitted`
   from a widget nobody sees. The header claimed "rendered for staff who can reach the desk" — the
   code did not. Gate the CALL, not just the render. */
import { useEffect, useState } from 'react';
import { Badge } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { Link } from 'react-router-dom';
import { libraryOverdue, type LibraryLoan } from '../../services/adminApi';
import { fmtDate } from '../../lib/format';
import { useRoleOrGrant } from '../../lib/access';

export default function LibraryOverdueWidget() {
  const [loans, setLoans] = useState<LibraryLoan[] | null>(null);
  // the door's own gate, and nothing else: `GET /plugins/library/overdue` is DESK = ['librarian'] alone.
  // (The P2-4 drift guard caught the wider list I first wrote here — owner and principal are ops-tier for
  // the desk but hold no overdue door, so offering them the widget would have been a 403 with a badge on it.)
  const canRead = useRoleOrGrant(['librarian'], ['GET /plugins/library/overdue']);
  useEffect(() => {
    if (!canRead) { setLoans([]); return; }
    let dead = false;
    libraryOverdue().then((r) => { if (!dead) setLoans(r.loans ?? []); }).catch(() => { if (!dead) setLoans([]); });
    return () => { dead = true; };
  }, [canRead]);
  if (!loans || loans.length === 0) return null;
  const shown = loans.slice(0, 3);
  return (
    <Link to="/library/desk" className="plugin-widget" style={{ display: 'block', padding: '12px 14px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-lg)', background: 'var(--surface-2)', textDecoration: 'none' }}>
      <div className="u-between">
        <div className="u-inline" style={{ gap: 8 }}>
          <Icon.Book size={15} />
          <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>Library — overdue books</span>
          <Badge tone="warning">{loans.length}</Badge>
        </div>
        <span className="u-xs u-faint">add-on</span>
      </div>
      <div className="u-xs u-muted" style={{ marginTop: 6, lineHeight: 1.6 }}>
        {shown.map((l) => `${l.borrowerName ?? l.studentName ?? 'Borrower'} · "${l.bookTitle}" (due ${fmtDate(l.dueOn)})`).join('  ·  ')}
      </div>
    </Link>
  );
}
