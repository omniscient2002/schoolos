/* ============================================================
   Student fees — the student's own read-only money view (FEE-PRD-9).
   Reads GET /student/fees, which is structurally scoped through
   app.student_accounts: a student sees ONLY their own dues, payments
   and receipts. There is no payment action here — settlement is a
   staff act and the student portal never moves money.
   ============================================================ */
import { useEffect, useState } from 'react';
import {
  PageHead, Card, Section, Stat, Badge, Button, Empty, ErrorState, SkeletonCard, DataTable,
} from '../components/ui';
import { Icon } from '../components/Icon';
import { fmtMoney, fmtMoneyShort, fmtDate } from '../lib/format';
import { friendly } from '../lib/friendlyErrors';
import { apiStudentFees, type StudentFeeView } from '../services/liveApi';

function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then((d) => live && setState({ data: d, loading: false, error: null }))
      .catch((e) => live && setState({ data: null, loading: false, error: String(e) }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, retry: () => setTick((t) => t + 1) };
}

const obStatus = (s: string) =>
  s === 'paid' ? <Badge tone="success" dot>Paid</Badge>
    : s === 'partial' ? <Badge tone="info" dot>Part paid</Badge>
      : s === 'void' ? <Badge tone="outline">Void</Badge>
        : <Badge tone="warning" dot>Open</Badge>;

export default function StudentFees() {
  const view = useAsync<StudentFeeView>(() => apiStudentFees(), []);
  const data = view.data;
  const outstanding = (data?.outstandingCents ?? 0) / 100;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <PageHead
        title="My fees"
        sub="Your own dues, payments and receipts — read-only."
        actions={<Button variant="secondary" icon={<Icon.Refresh size={14} />} onClick={view.retry}>Refresh</Button>}
      />

      {view.loading ? (
        <div className="grid grid-3" style={{ marginBottom: 20 }}><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
      ) : view.error ? (
        <Card pad><ErrorState title="Could not load your fees" sub={friendly(view.error)} onRetry={view.retry} /></Card>
      ) : !data?.linked ? (
        <Card pad>
          <Empty
            icon={<Icon.Wallet size={24} />}
            title="No fee account linked"
            sub="Your student account is not linked to a fee record yet. Ask the school office to link it, and your dues will appear here."
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-3" style={{ marginBottom: 20 }}>
            <Stat label="Outstanding" value={fmtMoneyShort(outstanding)} sub="What remains to be paid" />
            <Stat label="Paid to date" value={fmtMoneyShort((data.obligations ?? []).reduce((a, o) => a + Number(o.paid_cents ?? 0) / 100, 0))} sub="Settled amounts" />
            <Stat label="Receipts" value={data.receipts.length} sub="Available to view" />
          </div>

          <Section title="My dues" sub="One row per fee raised for you." style={{ marginBottom: 20 }}>
            <Card>
              <DataTable
                rows={data.obligations}
                rowKey={(o: Record<string, unknown>) => String(o.id)}
                empty={<Empty icon={<Icon.Wallet size={22} />} title="No dues on record" sub="Fees raised for you will appear here." />}
                columns={[
                  { key: 'term', label: 'Term', render: (o: Record<string, unknown>) => <span className="u-small">{String(o.term ?? '')}</span> },
                  { key: 'label', label: 'Towards', render: (o: Record<string, unknown>) => <span className="u-small u-muted">{String(o.label ?? '')}</span> },
                  { key: 'due', label: 'Due', render: (o: Record<string, unknown>) => <span className="u-small">{o.due_on ? fmtDate(String(o.due_on)) : '—'}</span> },
                  { key: 'amount', label: 'Amount', align: 'right', render: (o: Record<string, unknown>) => <span className="tnum">{fmtMoney(Number(o.net_amount_cents ?? o.amount_cents ?? 0) / 100)}</span> },
                  { key: 'paid', label: 'Paid', align: 'right', render: (o: Record<string, unknown>) => <span className="tnum u-muted">{Number(o.paid_cents ?? 0) ? fmtMoney(Number(o.paid_cents) / 100) : '—'}</span> },
                  { key: 'status', label: 'Status', align: 'right', render: (o: Record<string, unknown>) => obStatus(String(o.status ?? 'open')) },
                ]}
              />
            </Card>
          </Section>

          <Section title="My receipts" sub="A receipt is issued when the school confirms a payment.">
            <Card>
              <DataTable
                rows={data.receipts}
                rowKey={(r: Record<string, unknown>) => String(r.id)}
                empty={<Empty icon={<Icon.Document size={22} />} title="No receipts yet" />}
                columns={[
                  { key: 'no', label: 'Receipt', render: (r: Record<string, unknown>) => <span className="mono u-small">{String(r.receipt_no ?? '')}</span> },
                  { key: 'amount', label: 'Amount', align: 'right', render: (r: Record<string, unknown>) => <span className="tnum">{fmtMoney(Number(r.amount_cents ?? 0) / 100)}</span> },
                  { key: 'issued', label: 'Issued', render: (r: Record<string, unknown>) => <span className="u-small">{fmtDate(String(r.issued_at ?? ''))}</span> },
                  { key: 'status', label: 'Status', align: 'right', render: (r: Record<string, unknown>) => r.voided_at ? <Badge tone="danger" dot>Voided</Badge> : <Badge tone="success" dot>Valid</Badge> },
                ]}
              />
            </Card>
          </Section>
        </>
      )}
    </div>
  );
}
