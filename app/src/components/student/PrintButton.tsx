/* ============================================================
   PrintButton — reusable student print control (SU-1).
   kind → POST /student/print → toast: "Sent to the school
   printer — collect from the office." School-printed, never
   phone push (StudentOS plan: print jobs are school-controlled).
   ============================================================ */
import { useState } from 'react';
import { Button } from '../ui';
import { Icon } from '../Icon';
import { requestPrint, PRINT_KIND_LABEL, type StudentPrintKind } from '../../services/studentApi';
import { friendly } from '../../lib/friendlyErrors';

export function PrintButton({ kind, payload, label, size }: {
  kind: StudentPrintKind;
  payload?: unknown;
  /** defaults to the kind's plain label; override for context ("Print checklist") */
  label?: string;
  size?: 'sm' | 'lg';
}) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const text = label ?? `Print ${PRINT_KIND_LABEL[kind].toLowerCase()}`;

  const send = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    setSent(false);
    try {
      await requestPrint(kind, payload);
      setSent(true);
    } catch (e) {
      setErr(friendly(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="print-btn-wrap" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <Button
        variant="secondary"
        size={size}
        icon={busy ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} /> : <Icon.File size={14} />}
        loading={busy}
        onClick={send}
        aria-label={err ? `${text} — failed, try again` : text}
      >
        {text}
      </Button>
      {/* the status node is INSERTED on outcome — content mutation is what
          triggers the aria-live announcement (a static node never announces);
          visible inline on failure, visually hidden on success */}
      {err && <span role="status" className="u-small" style={{ color: 'var(--danger)' }}>{err}</span>}
      {!err && sent && (
        <span role="status" className="u-small" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
          Sent to the school printer — collect from the office
        </span>
      )}
    </span>
  );
}
