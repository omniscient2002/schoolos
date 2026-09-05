/* ============================================================
   Proof-plugin widget — renders in the principal's attention
   slot only while Library is enabled (Slot name="attention").
   ============================================================ */
import { Badge } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { Link } from 'react-router-dom';

export default function LibraryOverdueWidget() {
  const overdue = [
    { student: 'Diya Mehta', title: 'Wings of Fire', due: 'Sep 12' },
    { student: 'Advait Bose', title: 'A Brief History of Time', due: 'Aug 31' },
  ];
  return (
    <Link to="/library" className="plugin-widget" style={{ display: 'block', padding: '12px 14px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-lg)', background: 'var(--surface-2)', textDecoration: 'none' }}>
      <div className="u-between">
        <div className="u-inline" style={{ gap: 8 }}>
          <Icon.Book size={15} />
          <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>Library — overdue books</span>
          <Badge tone="warning">{overdue.length}</Badge>
        </div>
        <span className="u-xs u-faint">plugin</span>
      </div>
      <div className="u-xs u-muted" style={{ marginTop: 6, lineHeight: 1.6 }}>
        {overdue.map(o => `${o.student} · "${o.title}" (due ${o.due})`).join('  ·  ')}
      </div>
    </Link>
  );
}
