/* Library overdue widget — real data from the desk's overdue door while the plugin is enabled.
   Rendered in the attention slot for staff who can reach the desk; hidden when nothing is overdue. */
import { useEffect, useState } from 'react';
import { Badge } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { Link } from 'react-router-dom';
import { libraryOverdue, type LibraryLoan } from '../../services/adminApi';

export default function LibraryOverdueWidget() {
  const [loans, setLoans] = useState<LibraryLoan[] | null>(null);
  useEffect(() => {
    let dead = false;
    libraryOverdue().then((r) => { if (!dead) setLoans(r.loans ?? []); }).catch(() => { if (!dead) setLoans([]); });
    return () => { dead = true; };
  }, []);
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
        <span className="u-xs u-faint">plugin</span>
      </div>
      <div className="u-xs u-muted" style={{ marginTop: 6, lineHeight: 1.6 }}>
        {shown.map((l) => `${l.borrowerName ?? l.studentName ?? 'Borrower'} · "${l.bookTitle}" (due ${new Date(l.dueOn).toLocaleDateString()})`).join('  ·  ')}
      </div>
    </Link>
  );
}
