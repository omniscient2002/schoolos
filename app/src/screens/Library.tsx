/* ============================================================
   Library — the proof plugin (class A: record plugin).
   Demonstrates the full contract: manifest, nav slot, route,
   attention widget, event emission, audit-requested writes.
   ============================================================ */
import { useMemo, useState } from 'react';
import { PageHead, Card, Badge, Button, Stat, Empty, useToast } from '../components/ui';
import { EventTimeline } from '../components/Flow';
import { useStore } from '../state/store';

interface Book { id: string; title: string; author: string; copies: number; issued: number }
interface Loan { bookId: string; student: string; gradeSec: string; out: string; due: string; back: boolean }

const BOOKS: Book[] = [
  { id: 'lib-1', title: 'Wings of Fire', author: 'A.P.J. Abdul Kalam', copies: 6, issued: 6 },
  { id: 'lib-2', title: 'Malgudi Days', author: 'R.K. Narayan', copies: 4, issued: 3 },
  { id: 'lib-3', title: 'The Jungle Book', author: 'Rudyard Kipling', copies: 5, issued: 2 },
  { id: 'lib-4', title: 'A Brief History of Time', author: 'Stephen Hawking', copies: 3, issued: 1 },
];
const LOANS: Loan[] = [
  { bookId: 'lib-1', student: 'Diya Mehta', gradeSec: '8-A', out: 'Sep 01', due: 'Sep 12', back: false },
  { bookId: 'lib-1', student: 'Kabir Singh', gradeSec: '9-B', out: 'Aug 28', due: 'Sep 08', back: false },
  { bookId: 'lib-2', student: 'Sara Nair', gradeSec: '7-C', out: 'Sep 03', due: 'Sep 14', back: false },
  { bookId: 'lib-4', student: 'Advait Bose', gradeSec: '10-A', out: 'Aug 20', due: 'Aug 31', back: false },
];

export default function Library() {
  const toast = useToast();
  const { dispatch } = useStore();
  const [loans, setLoans] = useState(LOANS);
  const overdue = useMemo(() => loans.filter(l => !l.back && l.due < 'Sep 05'), [loans]);

  const ret = (l: Loan) => {
    setLoans(ls => ls.map(x => x === l ? { ...x, back: true } : x));
    dispatch({ type: 'event/add', e: { id: `ev_${Date.now()}`, on: new Date(), type: 'library', label: `Library — ${l.student} returned "${BOOKS.find(b => b.id === l.bookId)?.title}"`, severity: 'info' as const } });
    dispatch({ type: 'audit/add', entry: { actor: 'Library desk', actorRole: 'coordinator', action: 'Book returned', recordType: 'LibraryLoan', recordRef: BOOKS.find(b => b.id === l.bookId)?.title ?? l.bookId, reason: 'return counter', policyRef: 'Library §1.1', aiInvolved: false, risk: 'low', outcome: 'copy back on shelf' } });
    toast({ title: 'Returned', sub: `${l.student} · recorded on the kernel ledger`, tone: 'success' });
  };

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto' }}>
      <PageHead
        title="Library"
        sub="A plugin, not a feature — this whole module (nav, route, widget, audit) exists because the school switched it on"
        actions={<Badge tone="ai" dot>Plugin · class A (record)</Badge>}
      />

      <div className="grid grid-4" style={{ marginBottom: 'var(--s-4)' }}>
        <Stat label="Titles" value={String(BOOKS.length)} sub="catalog" />
        <Stat label="Copies out" value={String(BOOKS.reduce((a, b) => a + b.issued, 0))} sub="circulating" />
        <Stat label="Open loans" value={String(loans.filter(l => !l.back).length)} sub="with students" />
        <Stat label="Overdue" value={String(overdue.length)} sub={overdue.length ? `${overdue.length} past due — chase from here` : 'past due: none'} />
      </div>

      <div className="grid grid-2">
        <Card head="Catalog" sub="Owned tables — the kernel never sees inside">
          <div className="u-col" style={{ gap: 8 }}>
            {BOOKS.map(b => (
              <div key={b.id} className="u-between" style={{ padding: '8px 10px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)' }}>
                <div className="u-col" style={{ gap: 1 }}>
                  <span style={{ fontWeight: 570, fontSize: 'var(--text-sm)' }}>{b.title}</span>
                  <span className="u-xs u-faint">{b.author}</span>
                </div>
                <Badge tone={b.issued >= b.copies ? 'warning' : 'neutral'}>{b.copies - b.issued >= 0 ? `${b.copies - b.issued} on shelf` : 'all out'}</Badge>
              </div>
            ))}
          </div>
        </Card>

        <Card head="Circulation" sub="Issue/return writes events + audit via the kernel">
          {loans.length === 0 ? <Empty title="No loans" /> : (
            <div className="u-col" style={{ gap: 8 }}>
              {loans.map((l, i) => (
                <div key={i} className="u-between" style={{ padding: '8px 10px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)', opacity: l.back ? 0.55 : 1 }}>
                  <div className="u-col" style={{ gap: 1 }}>
                    <span style={{ fontWeight: 550, fontSize: 'var(--text-sm)' }}>{BOOKS.find(b => b.id === l.bookId)?.title}</span>
                    <span className="u-xs u-faint">{l.student} · {l.gradeSec} · due {l.due}{!l.back && l.due < 'Sep 05' ? ' · OVERDUE' : ''}</span>
                  </div>
                  {!l.back
                    ? <Button size="sm" variant="secondary" onClick={() => ret(l)}>Return</Button>
                    : <Badge tone="success" dot>Returned</Badge>}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card head="How this plugin integrates" sub="The exact contract from docs/10 — visible in the code" style={{ marginTop: 'var(--s-4)' }}>
        <EventTimeline compact items={[
          { time: '08:20', label: 'Manifest declares slots: nav · route · attention', detail: 'pluginRegistry.ts → Library entry', kind: 'note' },
          { time: '08:21', label: 'Nav item appears only while enabled', detail: 'Shell filters through useKernelNav', kind: 'note' },
          { time: '08:22', label: 'Route gated by KernelGate', detail: 'App.tsx wraps /library — disabled shows the "not enabled" state, not a 404', kind: 'note' },
          { time: '08:23', label: 'Attention widget renders in the principal list', detail: 'Slot name="attention" → library:overdue widget (max 2 plugin widgets allowed)', kind: 'note' },
          { time: '08:25', label: 'Return writes: events.emit + audit.request', detail: 'This screen just dispatched both through the kernel store', kind: 'verify' },
        ]} />
      </Card>
    </div>
  );
}
