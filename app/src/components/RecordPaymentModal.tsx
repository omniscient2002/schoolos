/* One record-payment modal, used by the Fees desk and Person 360 (FEE-FE-3).
 *
 * It initiates a payment through the real kernel door and confirms its settlement in one intent — the desk
 * records money that has actually arrived (UPI intent, webhook or bank statement is the proof). The METHOD
 * is a picker (FEE-PRD-5b): the desk is not always taking UPI. The gateway reference is optional; when it is
 * absent the server records the settlement as explicit manual provenance — nothing here is invented.
 */
import { useState } from 'react';
import { Modal, Button, useToast } from './ui';
import { fmtMoney } from '../lib/format';
import { friendly } from '../lib/friendlyErrors';
import { apiPost } from '../services/liveApi';
import { useStore } from '../state/store';

export interface RecordPaymentTarget {
  id: string;
  studentName: string;
  term: string;
  category: string;
  amount: number;
  paidAmount: number;
}

const METHODS: Array<{ value: string; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'card', label: 'Card' },
  { value: 'upi', label: 'UPI' },
  { value: 'razorpay', label: 'Razorpay / gateway' },
  { value: 'netbanking', label: 'Net banking' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'manual', label: 'Other / manual' },
];

export function RecordPaymentModal({ row, onClose, onDone }: {
  row: RecordPaymentTarget | null; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const { actorName, session } = useStore();
  const [method, setMethod] = useState('cash');
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  if (!row) return null;
  const due = Math.max(0, row.amount - row.paidAmount);

  const record = async () => {
    setBusy(true);
    try {
      const init = await apiPost<{ payment: { id: string } }>('/fees/payments', { obligationId: row.id, method });
      const conf = await apiPost<{ payment: { receipt_no: string | null }, obligation: { status: string } }>(
        `/fees/payments/${init.payment.id}/confirm`, ref.trim() ? { gatewayRef: ref.trim() } : {});
      toast({
        title: `Payment recorded — receipt ${conf.payment.receipt_no ?? 'issued'}`,
        sub: `${fmtMoney(due)} by ${method} against ${row.studentName} · ${row.term} ${row.category} · obligation now ${conf.obligation.status}.`,
        tone: 'success'});
      onDone();
      onClose();
    } catch (e) {
      toast({ title: 'Could not record the payment', sub: friendly(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Record a payment"
      sub={`${row.studentName} · ${row.term} ${row.category} · outstanding ${fmtMoney(due)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={record}>Record payment</Button>
        </>
      }
    >
      <div className="u-col" style={{ gap: 12 }}>
        <p className="u-small u-muted" style={{ margin: 0 }}>
          This initiates the payment and immediately records its settlement against the ledger. Use it when
          the money has actually arrived — the UPI intent, gateway webhook or bank statement is your proof.
          Every entry is audited with your name ({actorName}, {session.roleId}).
        </p>
        <label className="u-col u-small" style={{ gap: 6 }}>
          <span>Payment method</span>
          <select className="input" value={method} onChange={e => setMethod(e.target.value)}>
            {METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>
        <label className="u-col u-small" style={{ gap: 6 }}>
          <span>Gateway / UPI reference <span className="u-faint">(optional — from your gateway dashboard or bank statement)</span></span>
          <input className="input" value={ref} onChange={e => setRef(e.target.value)} placeholder="e.g. UPI-4821… or RZP-…" />
        </label>
      </div>
    </Modal>
  );
}
