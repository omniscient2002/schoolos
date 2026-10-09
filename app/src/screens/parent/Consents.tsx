/* ============================================================
   Consents — the parent consent center (PU-1).
   The school asks for permission here (trips, photos, medical,
   activities, transport). One decision per form; once decided
   the record is final and read-only. Server truth:
   GET/POST /parent/consents (+/:id/decide {granted|declined}).
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, Empty, Modal, PageHead, useToast } from '../../components/ui';
import { Icon } from '../../components/Icon';
import {ParentError, ParentLoading} from '../../components/parent/states';
import { humanize } from '../../lib/labels';
import { friendly } from '../../lib/friendlyErrors';
import { fmtDateShort } from '../../lib/format';
import { getConsents, decideConsent, type ParentConsent } from '../../services/parentApi';

const KIND_WORD: Record<string, string> = {
  trip: 'Trip', photo: 'Photographs', medical: 'Medical', activity: 'Activity', transport: 'Transport',
};

export default function Consents() {
  const toast = useToast();
  const [rows, setRows] = useState<ParentConsent[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [review, setReview] = useState<ParentConsent | null>(null);
  const [busy, setBusy] = useState<'granted' | 'declined' | null>(null);
  const [decideErr, setDecideErr] = useState<string | null>(null);

  const load = useCallback(() => {
    setErr(null);
    getConsents().then(r => setRows(r.consents)).catch(e => setErr(e));
  }, []);
  useEffect(() => { load(); }, [load]);

  const decide = async (c: ParentConsent, decision: 'granted' | 'declined') => {
    setBusy(decision); setDecideErr(null);
    try {
      await decideConsent(c.id, decision);
      toast({
        title: decision === 'granted' ? 'Permission recorded' : 'Decline recorded',
        sub: `${c.title} — the school sees your answer immediately.`,
        tone: 'success',
      });
      setReview(null);
      load();
    } catch (e) {
      setDecideErr(friendly((e as Error).message || e));
    } finally {
      setBusy(null);
    }
  };

  const { pending, past } = useMemo(() => {
    const list = rows ?? [];
    const byDue = (a: ParentConsent, b: ParentConsent) => String(a.due_at ?? '9999').localeCompare(String(b.due_at ?? '9999'));
    return {
      pending: list.filter(c => c.status === 'pending').sort(byDue),
      past: list.filter(c => c.status !== 'pending').sort((a, b) => String(b.decided_at ?? '').localeCompare(String(a.decided_at ?? ''))),
    };
  }, [rows]);

  if (err) return <ParentError err={err} onRetry={load} />; // covers denied via DeniedEmpty
  if (!rows) return <ParentLoading cards={2} />;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', display: 'grid', gap: 16 }}>
      <PageHead
        title="Consent forms"
        sub="The school asks your permission here — trips, photographs, activities. One decision per form, then it is final."
      />

      {pending.length === 0 && past.length === 0 && (
        <Empty
          icon={<Icon.Check size={24} style={{ color: 'var(--success)' }} />}
          title="No consent forms right now"
          sub="When the school asks for your permission, the form appears here and in Needs your attention."
        />
      )}

      {pending.length > 0 && (
        <Card headAs="h2" head={`Waiting for you (${pending.length})`}>
          <div className="u-col" style={{ gap: 10 }}>
            {pending.map(c => {
              const overdue = !!c.due_at && new Date(c.due_at).getTime() < Date.now();
              return (
                <div key={c.id} className="u-col" style={{ gap: 8, padding: 14, border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)' }}>
                  <div className="u-between u-flex" style={{ gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 620 }}>{c.title}</div>
                      <div className="u-xs u-faint" style={{ marginTop: 2 }}>
                        {KIND_WORD[c.kind] ?? humanize(c.kind)}{c.child_name ? ` · ${c.child_name}` : ''}
                      </div>
                    </div>
                    {c.due_at && <Badge tone={overdue ? 'danger' : 'warning'} dot>{overdue ? `Was due ${fmtDateShort(c.due_at)}` : `Due ${fmtDateShort(c.due_at)}`}</Badge>}
                  </div>
                  {c.detail && <div className="u-small u-muted" style={{ lineHeight: 1.55 }}>{c.detail}</div>}
                  <div>
                    <Button variant="primary" icon={<Icon.Edit size={14} />} onClick={() => { setDecideErr(null); setReview(c); }}>
                      Review
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {past.length > 0 && (
        <Card headAs="h2" head="Decided">
          <div className="u-col" style={{ gap: 10 }}>
            {past.map(c => (
              <div key={c.id} className="u-between u-flex" style={{ gap: 10, padding: 14, border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 570 }}>{c.title}</div>
                  <div className="u-xs u-faint" style={{ marginTop: 2 }}>
                    {KIND_WORD[c.kind] ?? humanize(c.kind)}{c.child_name ? ` · ${c.child_name}` : ''}
                    {c.decided_at ? ` · decided ${fmtDateShort(c.decided_at)}` : ''}
                  </div>
                </div>
                <div className="u-flex" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Badge tone={c.status === 'granted' ? 'success' : 'neutral'} dot={c.status === 'granted'}>
                    {c.status === 'granted' ? 'You approved' : 'You declined'}
                  </Badge>
                  <span className="u-xs u-faint">Final — recorded, cannot be changed</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ---------- review dialog (Modal = APG useDialogFocus: focus trap, Esc, scrim, focus return) ---------- */}
      <Modal
        open={!!review}
        onClose={() => { if (!busy) setReview(null); }}
        title={review?.title ?? ''}
        sub={review ? `${KIND_WORD[review.kind] ?? humanize(review.kind)}${review.child_name ? ` · ${review.child_name}` : ''}${review.due_at ? ` · due ${fmtDateShort(review.due_at)}` : ''}` : undefined}
        footer={
          <>
            <Button variant="ghost" disabled={!!busy} onClick={() => setReview(null)}>Cancel</Button>
            <Button variant="danger-ghost" loading={busy === 'declined'} disabled={!!busy} onClick={() => review && decide(review, 'declined')}>
              Decline
            </Button>
            <Button variant="primary" loading={busy === 'granted'} disabled={!!busy} onClick={() => review && decide(review, 'granted')}>
              I give permission
            </Button>
          </>
        }
      >
        {review && (
          <div className="u-col" style={{ gap: 10 }}>
            {review.detail && <div className="u-small" style={{ lineHeight: 1.6 }}>{review.detail}</div>}
            <div className="u-small u-muted" style={{ background: 'var(--surface-2)', borderRadius: 'var(--r-md)', padding: '10px 12px', lineHeight: 1.55 }}>
              Your answer is recorded in the school&apos;s permanent record and cannot be changed afterwards. If you are unsure, you can call the class teacher before deciding.
            </div>
            {decideErr && <div className="login-error" role="alert">{decideErr}</div>}
          </div>
        )}
      </Modal>
    </div>
  );
}
